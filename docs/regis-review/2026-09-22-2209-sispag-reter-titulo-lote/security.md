---
qa: Security
qa_slug: security
run_id: 2026-09-22-2209-sispag-reter-titulo-lote
agent: qa-security
generated_at: 2026-09-22T22:45:00-03:00
scope: backend+frontend
score: 8.2
findings_count: 4
cards_count: 3
---

# Security — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado (role `admin`) mal-intencionado ou com conta comprometida | Chama `POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote` ou `DELETE .../retencao` para um `filCod` de OUTRA filial que não a sua | `titulo_retencao_formacao`, lote RASCUNHO da filial-alvo | Produção, SaaSo multi-filial (single-tenant Columbia, multi-filial dentro do tenant) | Sistema deve negar a ação fora do escopo de filial do ator, registrar a tentativa e manter o lote da filial-alvo intocado | 0 escritas cross-filial bem-sucedidas; tentativa aparece em log com `role`/`filCod` negado |

Este é o cenário mais relevante do delta: a feature adiciona 2 rotas de escrita (`retirar-do-lote`,
`retencao`) que tomam `filCod` cru da URL e não aplicam o guard de escopo de filial já existente no
repositório (`filialAuthz.ts`, usado em `recebimentos.ts`). Ver F-security-1.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Hardcoded secrets no delta | 0 | 0 | ✅ | `grep -rEn "(password|secret|token|api[_-]?key|credential)\s*[:=]\s*['\"]" ` nos 16 arquivos do delta — 0 hits além de nomes de campo (`autorDoToken`, `IDENTIDADE_AUSENTE`) |
| SQL não-parametrizado no delta | 0/2 novos arquivos SQL (`RetencaoFormacaoRepository.ts`, migration 0062) | 0 | ✅ | `SqlBuilder.build` converte `$nome` → `$1..$n` reais do driver `pg`; nenhum template literal com interpolação em `RetencaoFormacaoRepository.ts` |
| Rotas mutantes novas com `requireRole` | 2/2 (100%) | 100% | ✅ | `src/backend/routes/sispag.ts:277,312` |
| Rotas mutantes novas com input validado por Zod | 2/2 (100%) | 100% | ✅ | `chaveTituloSchema`/`retirarDoLoteSchema`, `src/backend/routes/sispag.ts:112-131` |
| Rotas mutantes SISPAG (total, pré-existentes + novas) com `assertUserCanActOnFilial` | 0/11 (0%) | 100% nas rotas com `filCod` no payload | ❌ | `grep -n "assertUserCanActOnFilial" src/backend/routes/sispag.ts` → 0 ocorrências; comparar com `recebimentos.ts` (8 ocorrências) |
| Ações de retenção com autor+timestamp persistidos (não só log) | 2/2 (`marcado_por`/`marcado_em`, `removido_por`/`removido_em`) | 100% | ✅ | `src/backend/migrations/0062_titulo_retencao_formacao.sql`, colunas `NOT NULL` para o par ativo |
| `dangerouslySetInnerHTML`/`innerHTML` nos componentes novos | 0 | 0 | ✅ | `grep` em `RetencaoBadge.tsx`, `RetirarDoLoteDialog.tsx`, `retencao.ts`, `page.tsx` (delta) |
| `localStorage`/`sessionStorage` nos arquivos novos | 0 | 0 | ✅ | `grep` mesmos arquivos |
| Autor aceito como `'unknown'` nas 2 rotas novas | 0 (401 explícito via `autorDoToken`) | 0 | ✅ | `src/backend/routes/sispag.ts:96-101, 281-285, 317-321` |
| `npm audit` (deps novas no delta) | não medido — sem dependência nova | N/A | ⚠️ **Não medível localmente**: nenhuma dependência nova entrou no `package.json` neste delta (confirmado por `_shared-metrics.md`); auditoria de deps é assunto do baseline do repo, fora do escopo desta feature. |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual (no delta) | Status | Evidência |
|---|---|---|---|
| Detect Intrusion | Nenhuma detecção nova; herda `console.warn` de 401/403 do middleware pré-existente (`auth.ts:187`), sem alarme agregado | ⚠️ parcial (pré-existente) | `src/backend/http/auth.ts:187` |
| Detect Service Denial | N/A para este delta — rotas são mutações pontuais de 1 linha, sem novo vetor de exaustão | N/A | — |
| Verify Message Integrity | `optimistic lock`/versão de lote não se aplica às novas rotas (chave natural, não `loteId`+`versao`); a trava é o índice único parcial + `travarRascunho` sob transação | ✅ presente | `src/backend/domain/service/sispag/LotePagamentoService.ts:487-521` (`travarRascunho`, `withTransaction`) |
| Detect Message Delay | N/A — sem SLA de mensageria no fluxo | N/A | — |
| Identify Actors | JWT Supabase verificado (assinatura, issuer, audience) — pré-existente, herdado por toda rota nova | ✅ presente | `src/backend/http/auth.ts:118-190` |
| Authenticate Actors | `autorDoToken` recusa autor `unknown`/ausente com 401 explícito nas 2 rotas novas — mais estrito que o `ator()` legado usado no resto do arquivo | ✅ presente (melhora o padrão legado) | `src/backend/routes/sispag.ts:91-101` |
| Authorize Actors | `requireRole('admin')` nas 2 rotas novas (RBAC por papel) | ✅ presente (role) / ❌ ausente (escopo de filial) | `src/backend/routes/sispag.ts:277, 312` vs. `filialAuthz.ts` não usado |
| Limit Access | Escopo de filial não aplicado (ver Authorize Actors) — qualquer `admin` da Columbia atua em qualquer filial via estas 2 rotas | ❌ ausente | F-security-1 |
| Limit Exposure | `TituloForaDeLoteError`/`RetencaoInexistenteError` devolvem só a chave do título (fil/doc/tit), nunca valor, CNPJ ou dados do favorecido | ✅ presente | `src/backend/domain/errors/TituloForaDeLoteError.ts`, `RetencaoInexistenteError.ts` |
| Encrypt Data | Sem dado novo em repouso sensível (a tabela guarda chave de título + autor + motivo texto livre, não CNPJ/valor); TLS/at-rest é infra pré-existente (Render/Supabase), fora do delta | N/A (nada novo a cifrar) | `src/backend/migrations/0062_titulo_retencao_formacao.sql` |
| Separate Entities | Tabela própria `titulo_retencao_formacao`, sem FK para `titulo_a_pagar` (decisão documentada — sobrevive a rebuild de carteira) | ✅ presente | migration 0062, comentário "Por que não há FK" |
| Change Default Settings | N/A — sem infra/config nova provisionada no delta | N/A | — |
| Validate Input | Zod nos params (`chaveTituloSchema`) e corpo (`retirarDoLoteSchema`, `motivo` ≤500) + `CHECK` redundante no banco (`titulo_retencao_formacao_motivo_tamanho`) — defesa em profundidade real | ✅ presente | `src/backend/routes/sispag.ts:112-131`; migration 0062 |
| Revoke Access | N/A — não é sessão/token, é registro de negócio; "Liberar" é a revogação de negócio da retenção, coberta | ✅ presente (equivalente de domínio) | `liberarRetencao`, `src/backend/routes/sispag.ts:310-333` |
| Lock Computer | N/A — não se aplica a API backend | N/A | — |
| Inform Actors | Erros de domínio (`409`, `404`, `401`) devolvem `userMessage` acionável ao analista via `respondLoteError` | ✅ presente | `RetencaoInexistenteError.userMessage`, `TituloForaDeLoteError.userMessage` |
| Restore | Soft-delete (nunca apaga linha) preserva histórico para reconstrução de estado; sem script de rollback de migration (política do repo dispensa para CREATE TABLE) | ✅ presente | migration 0062, comentário "Por que não há script de reverse" |
| Audit Trail | `marcado_por`/`marcado_em`/`removido_por`/`removido_em`/`motivo_remocao` persistidos na PRÓPRIA tabela de estado (não só log) — mais forte que o `audit()` genérico do resto do serviço, que só escreve em `stdout` via `LogService` | ✅ presente (delta) / ⚠️ parcial (padrão herdado do serviço, fora do escopo) | migration 0062; `src/backend/domain/service/LogService.ts:19-26` (stdout, sem tabela dedicada para as demais ações do lote) |

## 4. Findings (achados)

### F-security-1: Rotas novas de retenção não aplicam escopo de filial (`assertUserCanActOnFilial`)

- **Severidade**: P1
- **Tactic violada**: Limit Access / Authorize Actors
- **Localização**: `src/backend/routes/sispag.ts:275-333` (`POST .../retirar-do-lote`, `DELETE .../retencao`)
- **Evidência (objetiva)**:
  ```
  router.post(
      '/titulos/:filCod/:docCod/:titCod/retirar-do-lote',
      requireRole('admin'),
      asyncHandler(async (req, res) => {
          ...
          const autor = autorDoToken(req);
          if (autor === undefined) { res.status(401)...; return; }
          const service = container.resolve(LotePagamentoService);
          const lote = await service.retirarDoLote({ ...chave.data, ator: autor });
  ```
  Nenhuma chamada a `assertUserCanActOnFilial(req.user, chave.data.filCod)`. Comparar com o padrão
  já estabelecido em `src/backend/routes/recebimentos.ts` (8 ocorrências de
  `assertUserCanActOnFilial`) e com a própria documentação do guard em
  `src/backend/http/filialAuthz.ts:19`: *"The same tactic should be replicated on the SISPAG
  money-moving routes for parity."* — comentário já presente no repo ANTES deste delta, ou seja, o
  gap era conhecido e este delta adicionou 2 rotas de escrita sem fechá-lo.
  Baseline numérico: `grep -c assertUserCanActOnFilial src/backend/routes/sispag.ts` = 0; 11/11
  rotas mutantes de SISPAG (as 2 novas incluídas) não aplicam escopo de filial.
- **Impacto técnico**: um usuário com role `admin` provisionado para uma filial pode retirar
  título de lote ou liberar retenção de QUALQUER outra filial só trocando o `filCod` na URL — o
  guard de role não distingue filial.
- **Impacto de negócio**: em um contexto multi-filial (e, no roadmap SaaSo, potencialmente
  multi-tenant), um analista de uma filial pode interferir na formação de lote de pagamento de
  outra filial sem autorização de negócio — não move dinheiro diretamente (a feature é
  explicitamente "nenhuma escrita no ERP, nenhum cálculo monetário"), mas pode **atrasar ou
  bloquear pagamentos de fornecedor de uma filial que não é a sua**, com efeito operacional real e
  sem rastro de "por que este título nunca é lotado".
- **Métrica de baseline**: 0/11 rotas mutantes de SISPAG usam `assertUserCanActOnFilial` (0%);
  `recebimentos.ts` usa em 8/~10 rotas equivalentes (padrão já estabelecido no mesmo repo).

### F-security-2: `audit()` genérico do LotePagamentoService não persiste em tabela — só `stdout`

- **Severidade**: P2 — pré-existente, fora do delta (o helper `audit()` já existia antes desta
  feature; o delta o reusa para `removerTitulo` mas não o introduz)
- **Tactic violada**: Audit Trail
- **Localização**: `src/backend/domain/service/sispag/LotePagamentoService.ts:532-542`;
  `src/backend/domain/service/LogService.ts:19-26`
- **Evidência (objetiva)**:
  ```
  private writeLog = async (input: CreateLogInput): Promise<void> => {
      ...
      process.stdout.write(`${JSON.stringify(logBody)}\n`);
  };
  ```
  Todo `this.audit(...)` (criar/incluir/remover/finalizar/reabrir/cancelar lote) vira uma linha de
  `stdout`, capturada pelo agregador de log do Render — sem tabela própria, sem índice por
  `loteId`/`ator`, sem retenção garantida por política de compliance.
- **Impacto técnico**: reconstruir "quem fez o quê e quando" num lote de pagamento depende da
  retenção de log do provedor (Render), não de uma fonte de verdade no banco da aplicação.
- **Impacto de negócio**: em auditoria de compliance financeiro (ex.: investigação de um lote
  cancelado indevidamente), a trilha pode já ter expirado no provedor de log — a ÚNICA ação deste
  delta com trilha garantida em tabela é a retenção (`titulo_retencao_formacao`), não as demais
  transições de lote.
- **Métrica de baseline**: 0 tabelas de audit trail dedicadas para transições de lote (`criar`,
  `incluir`, `finalizar`, `reabrir`, `cancelar`) vs. 1 tabela dedicada só para retenção
  (`titulo_retencao_formacao`, nova neste delta).

### F-security-3: Detecção de tentativa de autorização negada não é agregada/alarmada

- **Severidade**: P2 — pré-existente, fora do delta (o padrão `console.warn` em 401/403 já existia
  em `auth.ts` antes desta feature; as 2 rotas novas apenas herdam o comportamento)
- **Tactic violada**: Detect Intrusion
- **Localização**: `src/backend/http/auth.ts:187` (403), `:221-224` (401 genérico);
  `src/backend/routes/sispag.ts:281-285, 317-321` (401 específico de identidade ausente nas rotas
  novas)
- **Evidência (objetiva)**: `console.warn` grava no `stdout`/`stderr` local; não há contador,
  métrica ou alarme de limiar (ex.: N tentativas 401/403 por usuário/IP em janela de tempo).
- **Impacto técnico**: uma tentativa de força bruta de `filCod`/`docCod`/`titCod` nas 2 rotas novas
  (ou em qualquer rota `admin`) não dispara nenhum sinal operacional além de uma linha de log.
- **Impacto de negócio**: sem alarme, um comprometimento de credencial só é percebido
  retroativamente (auditoria manual de log), não em tempo real.
- **Métrica de baseline**: 0 alarmes configurados para falha de autenticação/autorização em todo o
  repo (`grep -rn "alarm\|threshold" src/backend/http` = 0 hits).

### F-security-4: Ausência de rate limit dedicado nas 2 rotas novas de retenção

- **Severidade**: P3
- **Tactic violada**: Limit Exposure
- **Localização**: `src/backend/routes/sispag.ts:275-333`
- **Evidência (objetiva)**: `heavyRouteLimiter` é aplicado a `/ingestao`, `/lotes/formar`,
  `/lotes/:id/remessa`, `/retornos/conciliar` (rotas caras/externas); as 2 rotas novas de retenção
  não têm rate limit próprio — mutação de 1 linha, baixo custo, mas sem limite explícito um script
  autenticado pode iterar `filCod`/`docCod`/`titCod` em alta frequência.
- **Impacto técnico**: nenhum esgotamento de recurso relevante (a query é indexada, O(1)); o risco
  é de enumeração/varredura, não de negação de serviço.
- **Impacto de negócio**: baixo — mitigado por F-security-1 sendo corrigido (escopo de filial já
  reduz o raio de varredura útil).
- **Métrica de baseline**: 0/2 rotas novas com rate limit dedicado; 4/11 rotas mutantes do arquivo
  usam `heavyRouteLimiter` (as de maior custo).

## 5. Cards Kanban

### [security-1] Aplicar `assertUserCanActOnFilial` às rotas de retenção do SISPAG

- **Problema**
  > As 2 rotas novas de "Retirar do lote"/"Liberar" (ADR-0050) validam `role='admin'` mas não o
  > escopo de filial do ator, replicando um gap já documentado no próprio guard
  > (`filialAuthz.ts:19`, escrito antes deste delta) que pedia paridade com SISPAG. Um admin de uma
  > filial pode reter/liberar título de outra filial trocando `filCod` na URL — 0/11 rotas mutantes
  > de SISPAG aplicam o guard, contra 8/~10 em `recebimentos.ts`.

- **Melhoria Proposta**
  > Importar `assertUserCanActOnFilial` de `../http/filialAuthz.js` em `src/backend/routes/sispag.ts`
  > e chamá-lo com `req.user`/`chave.data.filCod` logo após `autorDoToken`, nas 2 rotas novas
  > (`retirar-do-lote`, `DELETE .../retencao`) e, no mesmo PR ou como follow-up P1 dedicado, nas
  > 9 rotas mutantes pré-existentes do arquivo (fora do escopo deste delta, mas mesma correção
  > mecânica). Tactic Bass: Authorize Actors / Limit Access.

- **Resultado Esperado**
  > `grep -c assertUserCanActOnFilial src/backend/routes/sispag.ts`: 0 → ≥2 (rotas do delta) → 11
  > (paridade total, se o follow-up for aceito). Requisição para `filCod` fora do allow-list do
  > usuário passa a devolver 403 `FILIAL_NAO_AUTORIZADA` em vez de 200.

- **Tactic alvo**: Authorize Actors, Limit Access
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) para as 2 rotas do delta; M (2-5d) para as 9 restantes
- **Findings relacionados**: F-security-1
- **Métricas de sucesso**:
  - Rotas com `assertUserCanActOnFilial`: 0/11 → 2/11 (mínimo, este delta) → 11/11 (alvo do repo)
  - Teste automatizado cobrindo 403 cross-filial nas 2 rotas novas: 0 → ≥2 casos
- **Risco de não fazer**: em 6 meses, com mais filiais e mais analistas com role `admin`, a
  ausência do guard vira um vetor real de interferência operacional entre filiais, sem log de
  "por que este título nunca é lotado" apontar para o ator errado.
- **Dependências**: nenhuma — `filialAuthz.ts` já existe e já é usado em `recebimentos.ts` como
  referência de uso.

### [security-2] Persistir audit trail de transições de lote em tabela, não só em `stdout`

- **Problema**
  > `LotePagamentoService.audit()` grava toda transição de lote (criar/incluir/remover/finalizar/
  > reabrir/cancelar) só via `LogService.info` → `process.stdout.write`, sem tabela dedicada. A
  > ÚNICA ação com trilha garantida em banco, neste ciclo, é a retenção (`titulo_retencao_formacao`,
  > nova neste delta) — as demais dependem da retenção de log do Render.

- **Melhoria Proposta**
  > Criar uma tabela `sispag_lote_evento` (ou reusar um padrão de audit já adotado em outra frente,
  > se existir) com `lote_id`, `acao`, `ator`, `criado_em`, `dados` (jsonb), e gravar nela dentro da
  > MESMA transação de cada `withTransaction` do `LotePagamentoService` — o padrão já existe neste
  > delta para `titulo_retencao_formacao`; a extensão é mecânica. Tactic Bass: Audit Trail. Overlap
  > com Fault Tolerance (mesma fonte de verdade serve reconciliação pós-incidente).

- **Resultado Esperado**
  > Toda transição de lote de pagamento reconstruível por query SQL, sem depender do provedor de
  > log externo. Retenção de auditoria alinhada à política de compliance financeiro do cliente
  > (a definir), não à retenção padrão de log do Render.

- **Tactic alvo**: Audit Trail
- **Severidade**: P2
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-security-2
- **Métricas de sucesso**:
  - Tabelas de audit trail dedicadas para transição de lote: 0 → 1
  - Transições de lote reconstruíveis via SQL sem depender de log externo: 0% → 100%
- **Risco de não fazer**: investigação de incidente de pagamento (ex.: lote cancelado
  indevidamente) fica refém da janela de retenção de log do provedor de hosting.
- **Dependências**: nenhuma. Cross-QA: Fault Tolerance (mesmo dado serve reconciliação).

### [security-3] Alarmar falhas de autenticação/autorização acima de um limiar

- **Problema**
  > 401/403 em todo o backend (incluindo as 2 rotas novas deste delta) só geram `console.warn`,
  > sem métrica agregada nem alarme. Um ataque de enumeração de `filCod`/`docCod`/`titCod` ou uma
  > credencial comprometida só aparece em auditoria manual retroativa de log.

- **Melhoria Proposta**
  > Instrumentar `buildAuthMiddleware`/`requireRole` com uma métrica contável (ex.: incremento em
  > `LogService` com `type: SECURITY_ALERT` mais um contador no provedor de observabilidade já em
  > uso) e configurar um alarme de limiar (ex.: >20 401/403 por usuário/IP em 5min). Tactic Bass:
  > Detect Intrusion.

- **Resultado Esperado**
  > Alarme de falha de autenticação/autorização presente e testado; MTTD de uma tentativa de
  > força bruta ou credencial vazada cai de "descoberto em auditoria manual" para minutos.

- **Tactic alvo**: Detect Intrusion
- **Severidade**: P2
- **Esforço estimado**: M (2-5d) — depende de qual provedor de observabilidade está disponível no
  Render/Supabase atual (não medido neste ciclo)
- **Findings relacionados**: F-security-3
- **Métricas de sucesso**:
  - Alarmes de falha de autenticação configurados: 0 → 1
- **Risco de não fazer**: compromisso de credencial de `admin` (que hoje pode agir em qualquer
  filial — ver security-1) passa despercebido até auditoria manual.
- **Dependências**: nenhuma direta; maior valor se combinado com security-1 (o alarme também cobre
  tentativas de `FILIAL_NAO_AUTORIZADA` depois que o guard existir).

## 6. Notas do agente

- Escopo: avaliei os 16 arquivos do delta (`git diff --stat origin/main...HEAD -- src`) listados em
  `_shared-metrics.md`; código de infra (SSM, Terraform, API Gateway) do briefing genérico não é
  medível neste repo (Express/Render, sem `infra/` — confirmado em `_shared-metrics.md`).
- F-security-1 é P1, não P0: a própria feature declara "nenhuma escrita no ERP, nenhum cálculo
  monetário" — o gap não move dinheiro diretamente, mas quebra o isolamento de filial em ação de
  escrita, daí P1 com baseline numérico (0/11), não P0.
- F-security-2 e F-security-3 são rotuladas P2 "pré-existente, fora do delta" — os padrões
  (`audit()` em stdout, `console.warn`) já existiam antes desta feature; cito porque o delta os
  reusa/estende (2 novas rotas herdam o mesmo padrão), mas não os introduz.
- Cross-QA: F-security-2 (Audit Trail) conecta com Fault Tolerance — mesma lacuna, ângulos
  diferentes; F-security-1 (Limit Access/filial) conecta com Availability (raio de impacto de um
  ator comprometido) mesmo dentro de um único tenant/multi-filial.
- Positivo digno de nota: SQL 100% parametrizado via `SqlBuilder` (nomeado → posicional real),
  Zod nos 2 boundaries novos, autor de escrita nunca aceita `'unknown'` (mais estrito que o padrão
  legado `ator()` do resto do arquivo), soft-delete com `CHECK` de pareamento no banco.
