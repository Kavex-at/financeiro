---
qa: Security
qa_slug: security
run_id: 2026-10-13-1518
agent: qa-security
generated_at: 2026-10-13T15:40:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 2
---

# Security — Regis-Review

> Escopo: apenas o delta de `fix/sispag-sync-ao-abrir` vs `origin/main` (`--quick`, sem `npm audit`). Não existe `infra/`, então métricas de Terraform/IAM/CloudTrail são não mensuráveis.

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado com o menor papel (`sispag:ver`), ou sessão roubada dele | Dispara em loop `POST /sispag/lotes/sincronizar` (força passada, ignora TTL) ou `.../sincronizar-se-defasado` | `SincronizacaoPassadaService` → `SincronizacaoLoteService.sincronizarTodos` → Conexos (leitura) + escrita de estado observado local | Produção, horário comercial, sessão Conexos do robô compartilhada com o resto do SISPAG | Autoriza só quem tem `sispag:ver`, serializa por advisory lock, limita taxa, registra o ator em `job_execucao.triggered_by`, não escreve no ERP | 0 escritas no ERP; no máximo 1 passada simultânea; carga no Conexos limitada a N passadas/hora por ator; 100% das passadas com ator rastreável |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Rotas novas/alteradas no delta com `exigirPermissao` | 3/3 (`sincronizar-se-defasado`, `sincronizar`, `:id/sincronizar` 410) | 100% | ✅ | `src/backend/routes/sispag.ts` (diff) |
| Rotas novas com rate limit | 2/2 (`heavyRouteLimiter`, 10/min por IP) | 100% | ✅ | `src/backend/http/rateLimit.ts:154` |
| Rota nova com input do cliente (body/query/params) | 0 (sem corpo; ator vem de `req.user`) | validar com Zod se existir | ✅ | `routes/sispag.ts` (diff) |
| Rota 410 por lote ainda exige permissão (não revela existência de rota a anônimo) | Sim (`SISPAG_VER`) | sim | ✅ | `routes/sispag.ts` (diff) |
| Segredos hardcoded no delta | 0 | 0 | ✅ | leitura do diff |
| SQL não parametrizado no delta | 0 (advisory lock usa `$1`; repositórios existentes) | 0 | ✅ | `PostgreeDatabaseClient.ts:220` |
| Redação de mensagem de erro persistida | `redactErrorMessage` aplicada antes de `finishRun`/log | 100% | ✅ | `SincronizacaoPassadaService.ts` (`rodar`) |
| Teto de passadas forçadas por ator | Nenhum; só 10 req/min por IP e o lock (1 por vez, ~25 s cada) | cooldown por usuário | ⚠️ | `SincronizacaoPassadaService.forcar` |
| Trilha de ator por passada | `triggered_by = manual:<sub>` / `abertura:<sub>` em `job_execucao` | presente | ✅ | `routes/sispag.ts`, `SincronizacaoPassadaService.rodar` |
| Teste que trava a tabela de permissões | atualizado (45→47 rotas sispag) | presente | ✅ | `http/routePermissions.test.ts` |
| Dependências vulneráveis | ⚠️ **Não medível**: `--quick` pulou `npm audit`. | critical=0, high=0 | — | — |
| IAM, CloudTrail/GuardDuty, SSM, RDS público | ⚠️ **Não medível localmente**: não há `infra/`. Recomendação: medir quando o scaffold Terraform existir. | — | — | CLAUDE.md |

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Sem alarme para uso anômalo da passada; só log `FLOW_START` com `triggeredBy` | ⚠️ parcial | `SincronizacaoPassadaService.ts` `rodar` |
| Detect Service Denial | `heavyRouteLimiter` por IP; sem métrica de passadas forçadas por ator | ⚠️ parcial | `rateLimit.ts:154` |
| Verify Message Integrity | N/A no delta: não há mensagem assinada nova; leitura do ERP já existente | N/A | — |
| Detect Message Delay | N/A: sem mensageria no delta | N/A | — |
| Identify Actors | `ator(req)` gravado em `triggered_by` | ✅ presente | `routes/sispag.ts` |
| Authenticate Actors | Rotas sob o middleware de auth do router; teste 401 sem login | ✅ presente | `sispag.test.ts` (401) |
| Authorize Actors | `sispag:ver` para ação read-only no ERP; justificativa ADR-0066/I11a. Escreve estado local derivado do ERP (transição de status do lote) | ⚠️ parcial | `routes/sispag.ts`, F-security-1 |
| Limit Access | Advisory lock global (uma passada por vez), conexão dedicada | ✅ presente | `PostgreeDatabaseClient.ts:210-231` |
| Limit Exposure | Rota por lote aposentada (410): menos superfície; sem corpo nem parâmetros | ✅ presente | `routes/sispag.ts` |
| Encrypt Data | N/A no delta (transporte/repouso inalterados) | N/A | — |
| Separate Entities | Sem mudança; tenant único hoje | N/A | — |
| Change Default Settings | TTL/cooldown por env via `EnvironmentProvider` (defaults documentados em DEPLOY.md) | ✅ presente | `EnvironmentProvider.ts`, `DEPLOY.md` |
| Validate Input | Rotas sem entrada do cliente; `req.user` vindo do guard | ✅ presente | diff de `routes/sispag.ts` |
| Revoke Access | Sem mudança; permissões em banco (PR #93) valem a cada request | ✅ presente | `routePermissions.test.ts` |
| Lock Computer | N/A: sem mecanismo de bloqueio de conta no delta | N/A | — |
| Inform Actors | `motivo` com mensagem redigida devolvida ao cliente; `em_andamento` sem 409 | ⚠️ parcial | F-security-3 |
| Restore | Run `running` presa expira em 10 min (`RUN_PRESA_MS`); lock liberado em `finally` | ✅ presente | `SincronizacaoPassadaService.ts` |
| Audit Trail | `job_execucao` por passada com ator, métricas e resultado por lote nos logs; a transição do lote é atribuída ao job, não ao ator | ⚠️ parcial | `rodar`, `fechar` |

## 4. Findings (achados)

### F-security-1: Carga no Conexos disparável por qualquer `sispag:ver`, sem teto por ator

- **Severidade**: P2
- **Tactic violada**: Limit Access / Detect Service Denial
- **Localização**: `src/backend/routes/sispag.ts` (`POST /lotes/sincronizar`); `src/backend/domain/service/sispag/SincronizacaoPassadaService.ts` (`forcar`)
- **Evidência (objetiva)**:
  ```
  forcar = (...) => this.rodarOuEmAndamento(input.triggeredBy, ..., {})   // ignora TTL e cooldown
  heavyRouteLimiter: windowMs 60_000, limit 10  // chave padrão: IP
  passada ~25 s (log do run 37860107255); pool por processo = 5
  ```
- **Impacto técnico**: um viewer (ou sessão roubada dele) encadeia passadas de ~25 s em sequência. O lock impede paralelismo, mas não repetição. Cada passada faz a leitura completa de fin064/fin052/PSQ_018 com a sessão do robô, a mesma que as demais telas do SISPAG usam. O resultado é saturação do cap de sessões do Conexos ou da cota do robô e conexão do pool presa por ~25 s. O limite por IP não separa usuários atrás do mesmo NAT, e muda de IP contorna-o. O ADR-0055 já registra que o login do robô tem cap de sessões.
- **Impacto de negócio**: o atacante não move dinheiro, porque a rota é read-only no ERP. Mas degrada a operação do SISPAG da Columbia em horário de remessa, e a analista perde a sessão Conexos no meio de uma finalização.
- **Métrica de baseline**: 0 teto por usuário; 10 req/min por IP × ~25 s por passada. Pior caso: lock ocupado de forma contínua.

### F-security-2: Papel de menor privilégio altera estado local do lote

- **Severidade**: P3
- **Tactic violada**: Authorize Actors
- **Localização**: `src/backend/routes/sispag.ts`; `ontology/decisions/0066-*.md`
- **Evidência (objetiva)**:
  ```
  exigirPermissao(PERMISSION.SISPAG_VER) + sincronizarTodos()  → pode transicionar REMESSA_GERADA → BAIXADO
  ```
- **Impacto técnico**: a mudança é derivada do ERP e determinística (o viewer não escolhe o valor), então não há escalada de integridade. Mas `sispag:ver` agora produz escrita, e a transição fica atribuída ao job, não ao usuário que a provocou. O ator só aparece em `job_execucao.triggered_by`.
- **Impacto de negócio**: em auditoria ("quem fez o lote virar BAIXADO?") a resposta exige cruzar a run com o timestamp da transição. Risco baixo: a justificativa de I11a é coerente e está documentada.
- **Métrica de baseline**: 0 de N transições de lote com ator da passada gravado no evento de transição (não verificado no código do `SincronizacaoLoteService`, fora do delta).

### F-security-3: `motivo`/`errorMessage` de falha devolvido a papel `ver`

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `SincronizacaoPassadaService.ts` (`sincronizarSeDefasada`, ramo `FALHA_RECENTE`, e `rodarOuEmAndamento`)
- **Evidência (objetiva)**:
  ```
  ...(ultima.errorMessage ? { motivo: ultima.errorMessage } : {})
  ```
- **Impacto técnico**: o texto já passou por `redactErrorMessage` (connection string, cookie, token, IP de ECONNREFUSED). A redação é por padrão e conservadora, mas é blacklist: uma mensagem de erro de lib nova com host interno ou nome de tabela passa. Quem lê é o papel mais baixo.
- **Impacto de negócio**: vazamento de topologia, não de credencial. Baixo.
- **Métrica de baseline**: 1 campo de texto livre persistido exposto a `sispag:ver`; padrões de redação cobrem 6 classes.

## 5. Cards Kanban

### [security-1] Limitar passadas forçadas por usuário e por janela

- **Problema**
  > `POST /sispag/lotes/sincronizar` aceita `sispag:ver`, ignora TTL e cooldown e só é contido por 10 req/min por IP e pelo lock. Um viewer encadeia passadas de ~25 s e consome a sessão Conexos do robô em horário de remessa.

- **Melhoria Proposta**
  > Aplicar um cooldown mínimo para `forcar` (por exemplo, devolver `fresca` quando a última passada tiver menos de 60 s). Adicionar limiter por `req.user.sub` com `sessionLimiter`/`keyGenerator`, como já existe para busca de favorecido (`rateLimit.ts`). Contar passadas por `triggered_by` em `job_execucao` e alertar acima de um limiar. Tocar `SincronizacaoPassadaService.forcar` e `routes/sispag.ts`, com teste.

- **Resultado Esperado**
  > No máximo 1 passada forçada a cada 60 s por instalação e 6/min por usuário, contra o teto atual de uma passada contínua. O frontend continua mostrando "atualizada há X min".

- **Tactic alvo**: Limit Access
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Passadas forçadas por minuto por usuário: ilimitado (até o lock) → ≤ 1
  - Chaves de rate limit por usuário nas rotas pesadas do SISPAG: 0 → 2
- **Risco de não fazer**: o cap de sessões do Conexos é esgotado por um uso indevido (ou um loop de frontend), e o robô perde a sessão no meio de uma remessa.
- **Dependências**: nenhuma

### [security-2] Atribuir o ator da passada à transição de lote e sanear `motivo`

- **Problema**
  > A transição de status de lote provocada por `sispag:ver` fica atribuída ao job. O texto de falha é devolvido ao cliente por blacklist de padrões.

- **Melhoria Proposta**
  > Gravar `triggeredBy` (runId) no evento de transição do lote em `SincronizacaoLoteService`. Para papéis sem `sispag:executar`, devolver `motivo` genérico ("falha ao ler o Conexos, ver o painel de operação") e manter o detalhe redigido em `job_execucao`. Atualizar o ADR-0066 com a decisão.

- **Resultado Esperado**
  > 100% das transições de status com ator rastreável pelo `runId`, e nenhum texto livre de erro devolvido ao papel `ver`.

- **Tactic alvo**: Audit Trail
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-security-2, F-security-3
- **Métricas de sucesso**:
  - Transições de lote com runId/ator: não verificado → 100%
  - Campos de texto livre de erro expostos ao papel `ver`: 1 → 0
- **Risco de não fazer**: em uma auditoria de pagamento, a origem de uma transição de lote exige cruzar timestamps à mão.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: só o delta. Sem P0: não há segredo, SQL interpolado, rota sem guard nem escrita no ERP. A premissa "read-only no ERP" segue o ADR-0055 I11a, e não revalidei `SincronizacaoLoteService` (fora do delta).
- Não medíveis: IAM, CloudTrail, SSM, CORS de infra, `npm audit` (`--quick`).
- Cross-QA: F-security-1 liga-se a Availability/Performance (pool 5, sessão Conexos compartilhada, blast radius); F-security-2 liga-se a Fault Tolerance (Audit Trail).
