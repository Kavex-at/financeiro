---
qa: Security
qa_slug: security
run_id: 2026-09-29-2020
agent: qa-security
generated_at: 2026-09-29T20:40:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 4
---

# Security — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário sem `sispag:executar`, insider com acesso ao repo/Actions, ou operador com tela antiga em cache | Chamada a `POST /sispag/lotes/:id/sincronizar` ou `/retorno`; leitura dos secrets `CONEXOS_*` do workflow horário | Rota `routes/sispag.ts`, `SincronizacaoLoteService`, workflow `sincronizar-lotes-sispag.yml`, credencial Conexos | Produção Render + cron GitHub Actions, sem `infra/` | Rota exige permissão e valida entrada; acesso ao ERP é somente leitura (sem write-back); `/retorno` responde 410; falha de credencial gera exit != 0 e alerta | 0 escrita no ERP pelo job; 100% das rotas novas com `exigirPermissao` + Zod; ação com ator identificável no registro |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Segredos hardcoded no delta | 0 | 0 | ✅ | grep de padrão password/secret/token nos arquivos novos |
| `.env` / tfstate versionados | 0 (só `.env.example`) | 0 | ✅ | `git ls-files` |
| Rotas novas com `exigirPermissao(SISPAG_EXECUTAR)` | 2/2 (`/sincronizar`, `/retorno` 410) | 100% | ✅ | `routes/sispag.ts:319-366` |
| Rotas novas com validação Zod | 1/1 (`loteIdSchema` uuid) | 100% | ✅ | `routes/sispag.ts:339` |
| Rate limit na rota nova | `heavyRouteLimiter` | presente | ✅ | `routes/sispag.ts:343` |
| SQL não parametrizado novo no delta | 0 (interpolação no repositório só de fragmentos fixos/placeholders nomeados, pré-existente) | 0 | ✅ | grep `${` no diff do repositório |
| Segredos no workflow via `secrets.*` | 3/3 (DB, URL, senha) | 100% | ✅ | `sincronizar-lotes-sispag.yml:39-43` |
| `permissions:` mínimas declaradas no workflow | ausente (default do repo) | `contents: read` | ⚠️ | `sincronizar-lotes-sispag.yml` |
| Ator (quem) propagado ao sync manual | não passado ao service | ator registrado | ⚠️ | `routes/sispag.ts:343-360` vs helper `ator()` linha 108 |
| Redação de erro em job | `redactErrorMessage` no FATAL | presente | ✅ | `jobs/sincronizar-lotes-sispag.ts` |
| `dangerouslySetInnerHTML` / `localStorage` no delta frontend | 0 | 0 | ✅ | grep no diff de `src/frontend` |
| Alarme de falha de autenticação | ⚠️ **Não medível localmente**: requer logs de produção (Render/Supabase). Recomendação: métrica 401/403 no Painel de Operação | presente | ⚠️ | — |
| `npm audit` | ⚠️ **Não medível**: não executado (--quick) | crit=0/high=0 | ⚠️ | fora do escopo |
| CloudTrail/GuardDuty, IAM, CORS de infra | ⚠️ **Não medível**: não existe `infra/` | n/a | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Sem IDS; falha de credencial Conexos vira exit 1 + alerta ADR-0042 | ⚠️ parcial | passo "Alertar falha" do workflow |
| Detect Service Denial | `heavyRouteLimiter` na rota nova | ⚠️ parcial | `routes/sispag.ts:343` |
| Verify Message Integrity | Versão otimista (`LoteVersaoConflitoError`) protege escrita concorrente | ⚠️ parcial | `SincronizacaoLoteService.ts:163` |
| Detect Message Delay | N/A — sem mensageria assinada neste delta | N/A | sem fila/assinatura |
| Identify Actors | `req.user` existe; o sync não o usa | ⚠️ parcial | `routes/sispag.ts:108` |
| Authenticate Actors | JWT Supabase / e-mail Columbia (middleware pré-existente) | ✅ presente | pré-existente |
| Authorize Actors | `exigirPermissao(SISPAG_EXECUTAR)` na rota nova e no 410 | ✅ presente | `routes/sispag.ts:322,342` |
| Limit Access | Job só lê o ERP (I11a); sem flags de escrita | ✅ presente | cabeçalho do workflow |
| Limit Exposure | Mesmo secret Conexos compartilhado entre crons | ⚠️ parcial | workflow (comentário sobre sessões) |
| Encrypt Data | TLS em trânsito; segredos em GH Secrets | ✅ presente | workflow |
| Separate Entities | Sem contas por tenant hoje (alvo) | ⚠️ parcial | CLAUDE.md |
| Change Default Settings | Workflow sem `permissions:` explícito | ⚠️ parcial | workflow |
| Validate Input | Zod uuid no param | ✅ presente | `routes/sispag.ts:339` |
| Revoke Access | Depende de permissões no banco (PR #93) | ⚠️ parcial | auth em 3 passos |
| Lock Computer | N/A — sem infra própria | N/A | — |
| Inform Actors | Alerta em falha do workflow | ✅ presente | passo ADR-0042 |
| Restore | Rollback SQL da 0069 testado | ✅ presente | `0069_*.rollback.sql`, `rollbacks.test.ts` |
| Audit Trail | Log do service + `job_execucao`; ator do clique manual não gravado | ⚠️ parcial | `SincronizacaoLoteService.ts` |

## 4. Findings

### F-security-1: Sincronização manual não registra o ator (in-delta)

- **Severidade**: P2
- **Tactic violada**: Audit Trail / Identify Actors
- **Localização**: `src/backend/routes/sispag.ts:343-360`
- **Evidência (objetiva)**:
  ```
  const sincronizado = await service.sincronizarLote(parsed.data.id);   // sem ator(req)
  // as demais transições usam ator = (req) => req.user?.sub ?? ...  (linha 108)
  ```
- **Impacto técnico**: a mudança de status disparada por clique (lote vai a RETORNADO/BAIXADO) não liga ao usuário; só ao log genérico.
- **Impacto de negócio**: a proposta exige trilha de quem/quando/o quê; a transição muda estado financeiro do lote e não é atribuível em auditoria.
- **Métrica de baseline**: 0 de 1 endpoints de sync com ator gravado.

### F-security-2: Workflow sem `permissions:` mínimas e com secret Conexos compartilhado (in-delta)

- **Severidade**: P3
- **Tactic violada**: Change Default Settings / Limit Exposure
- **Localização**: `.github/workflows/sincronizar-lotes-sispag.yml`
- **Evidência (objetiva)**:
  ```
  grep permissions => 0 ocorrências; reutiliza CONEXOS_USERNAME/PASSWORD dos demais crons
  ```
- **Impacto técnico**: GITHUB_TOKEN com escopo padrão do repositório; uma conta única com sessão simultânea limitada amplia o raio de dano de um vazamento e causa disputa de sessão.
- **Impacto de negócio**: a credencial do robô acessa o ERP inteiro; vazamento afeta todos os crons.
- **Métrica de baseline**: 0 blocos `permissions:`; 1 credencial para N workflows.

### F-security-3: Rota `/retorno` aposentada permanece como stub (in-delta, positivo com ressalva)

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/routes/sispag.ts:321-332`
- **Evidência (objetiva)**: rota responde 410 atrás de `exigirPermissao`; `marcarRetorno` foi removido do service (`LotePagamentoService.ts`, -11 linhas).
- **Impacto técnico**: sem risco de escrita; resta só uma rota morta.
- **Impacto de negócio**: baixo. Foi removida a via que levava o lote a RETORNADO sem prova.
- **Métrica de baseline**: 0 escritas possíveis; 1 rota stub.

### F-security-4: Auth em transição e sem detecção de falha de login (pré-existente)

- **Severidade**: P2
- **Tactic violada**: Detect Intrusion / Revoke Access
- **Localização**: middleware de auth e `exigirPermissao` (fora do delta)
- **Evidência (objetiva)**: transição de auth em 3 passos incompleta (permissões no banco = PR #93 pendente); sem alarme de falha de autenticação medível; sem CloudTrail/GuardDuty por ausência de `infra/`.
- **Impacto técnico**: revogação e detecção dependem de implementação futura.
- **Impacto de negócio**: uma ação financeira (finalizar lote) depende de uma permissão única `sispag:executar`.
- **Métrica de baseline**: 0 alarmes de falha de autenticação medidos.

Nenhum P0 mensurado no delta: 0 segredos hardcoded, 0 SQL interpolado com dado do usuário, rota nova autorizada e validada, ERP somente leitura.

## 5. Cards Kanban

### [security-1] Gravar o ator no sincronizar manual

- **Problema**
  > `POST /lotes/:id/sincronizar` chama `sincronizarLote(id)` sem o usuário; a transição de status do lote disparada por clique não é atribuível.
- **Melhoria Proposta**
  > Passar `ator(req)` para `sincronizarLote` e registrá-lo no log/evento da transição (`SincronizacaoLoteService`, `routes/sispag.ts`). O cron grava `cron` como ator.
- **Resultado Esperado**
  > Toda transição de status do lote com ator identificável (0/1 → 1/1 endpoints).
- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Endpoints de sync com ator: 0/1 → 1/1
- **Risco de não fazer**: a auditoria não consegue dizer quem sincronizou/fechou um lote.
- **Dependências**: nenhuma

### [security-2] Endurecer o workflow de sincronização

- **Problema**
  > O workflow não declara `permissions:` e usa a mesma credencial Conexos dos outros crons.
- **Melhoria Proposta**
  > Adicionar `permissions: contents: read` (e nos demais crons); avaliar usuário Conexos dedicado, somente leitura, para o job.
- **Resultado Esperado**
  > Token com escopo mínimo; disputa de sessão eliminada e raio de vazamento reduzido.
- **Tactic alvo**: Change Default Settings
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Workflows com `permissions:` explícito: 0 → todos os do escopo
- **Risco de não fazer**: vazamento de um secret compartilhado abre todos os crons.
- **Dependências**: criação de usuário no Conexos (pelo cliente)

### [security-3] Remover a rota 410 após a janela de cache

- **Problema**
  > `/lotes/:id/retorno` permanece como stub apenas para telas antigas.
- **Melhoria Proposta**
  > Remover a rota depois de uma janela (p. ex. 2 semanas) e confirmar 0 chamadas nos logs.
- **Resultado Esperado**
  > Superfície mínima; 1 rota stub → 0.
- **Tactic alvo**: Limit Exposure
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Rotas stub: 1 → 0
- **Risco de não fazer**: baixo; acúmulo de rotas mortas.
- **Dependências**: deploy do frontend novo

### [security-4] Alarme de falha de autenticação e conclusão da auth em 3 passos

- **Problema**
  > Não há alarme de falha de login nem revogação fina de permissões concluída; ações financeiras dependem de uma permissão única.
- **Melhoria Proposta**
  > Concluir o PR #93 (permissões no banco) e agregar 401/403 em métrica com alerta por limiar no Painel de Operação.
- **Resultado Esperado**
  > Falhas de autenticação/autorização detectáveis; revogação imediata.
- **Tactic alvo**: Detect Intrusion / Revoke Access
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-security-4
- **Métricas de sucesso**:
  - Alarmes de falha de auth: 0 → 1
- **Risco de não fazer**: força bruta ou uso indevido de credencial passam sem alerta.
- **Dependências**: PR #93

## 6. Notas do agente

- Escopo: só o delta e os diretórios listados; `npm audit`, IAM, CloudTrail e CORS de infra não são mensuráveis (`--quick`, sem `infra/`).
- Cross-QA: Audit Trail sobrepõe Fault Tolerance; Limit Exposure sobrepõe Availability; Validate Input sobrepõe Integrability; Restore (rollback 0069) sobrepõe Deployability.
- Confirmado no delta: job read-only, secrets via `secrets.*`, SQL parametrizado, nenhum P0.
