---
qa: Availability
qa_slug: availability
run_id: 2026-09-22-2209
agent: qa-availability
generated_at: 2026-09-23T14:00:00-03:00
scope: backend+frontend (delta de sispag-reter-titulo-lote)
score: 8.3
findings_count: 5
cards_count: 3
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Postgres transitório (perda de conexão) OU deploy que trouxe a migration `0062_titulo_retencao_formacao.sql` OU pico de cliques admin na aba de títulos | (a) Boot da instância nova aplica `0062` e o `BootMigrator` roda antes do `app.listen`; (b) queda instantânea de uma sessão do pool durante o `withTransaction` de `retirarDoLote`/`liberarRetencao`; (c) SIGTERM da Render substituindo a instância enquanto uma retenção está a meio caminho | `BootMigrator`, `PostgreeDatabaseClient` (`withTransaction`, `withAdvisoryLock`), `LotePagamentoService.retirarDoLote`/`liberarRetencao`, `RetencaoFormacaoRepository`, `SispagPainelService.montarPainel` | Produção — Render (1 instância `starter`, `autoDeploy:true`, `healthCheckPath:/health`), Supabase Postgres, sem SQS/EventBridge nesta feature | (a) DDL inválido faz o processo sair com código 1, Render não promove, versão anterior segue no ar (fail-fast, sem downtime); (b) `ROLLBACK` do driver `pg` desfaz remoção + retenção atomicamente; a retentativa do cliente cai no índice parcial `uq_titulo_retencao_formacao_ativa` e não duplica; (c) `/health` responde 503 durante o drain, o LB para de rotear, requisições em voo terminam ou são cortadas no `drainTimeoutMs` | 0 escritas parciais confirmadas por 7 testes de corrida (`LotePagamentoService.test.ts:592-746`); 0 downtime perceptível em deploy aditivo (Render aguarda `/health` 200 antes de rotear); MTTR de rollback ≤5 min documentado (`docs/runbooks/rollback.md`); 0 escrita no ERP (blast radius confinado ao Postgres próprio) |

Este QA avalia o **delta** de `sispag-reter-titulo-lote`. A arquitetura de disponibilidade (Render 1 instância + `/health` 503 no drain + `gracefulShutdown` + `BootMigrator` + Supabase) é pré-existente e já foi endereçada por cards anteriores (`availability-1`, `deployability-3`, `rollback-adr-0043`). O que muda aqui é (i) uma tabela nova consultada em cada abertura do painel SISPAG, (ii) duas rotas admin de escrita que executam duas escritas dentro de uma transação, e (iii) uma retenção que muda o comportamento da formação automática (cron interno).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Escritas do delta em transação atômica (repair by rollback do DB) | 4/4 caminhos (`retirarDoLote` → `removerItemDoLote`, `liberarRetencao`, `incluirTitulo` libera retenção na MESMA tx, `removerTitulo` reaproveita `removerItemDoLote`) | 100% das escritas que tocam duas tabelas do delta | ✅ | `LotePagamentoService.ts:345-360,464-491,264-274` |
| Chamada de rede (Conexos) mantida FORA do `withTransaction`/lock do delta (evita starvation do pool) | 1/1 — `retirarDoLote` NÃO chama o ERP; `incluirTitulo` (tocado indiretamente pelo delta ao liberar a retenção) mantém `getTituloAPagar` antes do `withAdvisoryLock` (padrão pré-existente, preservado) | 100% | ✅ | `LotePagamentoService.ts:194-229,321-339` |
| Endpoint de escrita do delta com árbitro de concorrência no servidor (constraint/lock) | 2/2 (`retirar-do-lote` via índice parcial `uq_titulo_retencao_formacao_ativa` + `SELECT FOR UPDATE` no lote; `DELETE /retencao` via `UPDATE ... WHERE removido_em IS NULL` idempotente) | 100% para escritas do delta | ✅ | `RetencaoFormacaoRepository.ts:59-90`, `LotePagamentoRepository.ts:157-176` |
| Endpoint de escrita do delta com rate-limit dedicado (surge protection próprio) | 0/2 — herdam só o `globalLimiter` (100 req/min/IP, teto único para todo o app) | Nenhum alvo formal para rotas admin de baixa taxa; padrão do repo é `heavyRouteLimiter` (10/min) apenas em fan-outs pesados (ingestão, remessa, conciliação) | ✅ (consistente com o padrão) | `src/backend/http/buildApp.ts:54,126`, `routes/sispag.ts:276,311` |
| Leituras do painel que tornaram-se `Promise.all` de 4 depois do delta (falha em qualquer uma cai o painel inteiro) | 4/4 no `montarPainel`: `tituloRepo.listAtivos`, `runRepo.findLatestSuccessFinishedAt`, `loteRepo.listTitulosEmRascunho`, **`retencaoRepo.listAtivas`** (adicionada pelo delta) — sem `Promise.allSettled` nem fallback ao contrário do padrão local `linhasDigitaveisDoLote`/`contarExecucoesParadas` | Toleração à falha per-leitura em consultas de painel (padrão existente no mesmo serviço) | ⚠️ parcial (a 4ª leitura amplia levemente a superfície de falha do all-or-nothing) | `SispagPainelService.ts:91-97,254-280,388-412` |
| Migration 0062 aditiva e idempotente (deploy pode voltar sem tocar schema) | Sim — `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT` (3×); nenhum `UPDATE`/`DROP TABLE` | Migrations do delta caem na linha "aditiva = seguro reverter só o código" da matriz de `rollback.md` | ✅ | `0062_titulo_retencao_formacao.sql:26-56`, `retencaoFormacao.test.ts:17,32,49` |
| Migration 0062 exercitada contra Postgres real em CI | 0 de 1 (só o teste de forma via regex sobre o texto SQL) — o único integration test de migration do repo é `vwMetricasCiclo.integration.test.ts` | Migrations com DDL não-trivial (índice parcial + 3 `CHECK`s) deveriam entrar no job `backend-sql` (padrão já presente) | ⚠️ | `retencaoFormacao.test.ts` (regex) vs. `vwMetricasCiclo.integration.test.ts` |
| Escritas do delta que atingem o ERP (Conexos) | 0 — feature 100% interna ao Postgres | Blast radius do delta confinado ao próprio banco, não ao ERP | ✅ | `_shared-metrics.md:8` |
| Tratamento explícito de erros de estado (fail-fast + userMessage acionável) | 3/3 — `TituloForaDeLoteError` (409), `RetencaoInexistenteError` (404), `LoteEstadoInvalidoError` (409) com `userMessage` em PT-BR pedindo recarga | Cada modo de falha vira mensagem que o analista consegue agir; nada é silenciado | ✅ | `TituloForaDeLoteError.ts`, `RetencaoInexistenteError.ts`, `LotePagamentoService.ts:326,354,499-505` |
| Kill-switch/feature-flag dedicado para desligar sem redeploy | 0 — nem `SISPAG_RETENCAO_ENABLED` nem gate por header/env; herda só `SISPAG_ENABLED` do painel (já `true` em prod) | Compatível com o padrão do repo: `CONEXOS_WRITE_ENABLED`/`SISPAG_LIVE_WRITE_ENABLED` só existem em caminhos que escrevem no ERP (não é o caso aqui) | ✅ (consistente com o padrão existente) | `routes/sispag.ts:276,311` (nenhum `process.env` novo no delta) |
| `/health` retorna 503 durante drain (não roteia requisição nova em cima da instância morrendo) | Sim (pré-existente, card `availability-1`; a nova rota `POST .../retirar-do-lote` herda a proteção) | 100% das rotas admin protegidas pelo drain | ✅ | `src/backend/http/buildApp.ts:88-100`, `gracefulShutdown.test.ts:41,99,272-345` |
| Auditoria persistida da ação (não depende de log de aplicação) | Sim — `marcado_por/marcado_em/removido_por/removido_em/motivo/motivo_remocao` na própria tabela; sobrevive a rotação de log | Consulta SQL confiável de "quem fez, quando" | ✅ (delta melhora sobre o padrão só-stdout do resto do serviço) | `0062_titulo_retencao_formacao.sql:24-34` |

> ⚠️ **Não medível localmente**: MTTR real observado nesta feature (o runbook define ≤5 min como meta, mas 0 rollbacks reais foram cronometrados — mesma lacuna reportada em `deployability.md#F-deployability-3`). Requer instrumentar `docs/runbooks/rollback.md` com uma linha por incidente executado.
> ⚠️ **Não medível localmente**: taxa real de indisponibilidade transitória do Postgres Supabase (quantas vezes/mês uma conexão do pool cai no meio de um `COMMIT`). Requer consulta ao Supabase Insights + logs do Render agregados por mês. A garantia atual (`ROLLBACK` do driver `pg`) é lógica, não medida sob falha real de I/O — cross-QA com `F-fault-tolerance-1`.
> ⚠️ **Não medível localmente**: percentual de deploys em que a instância nova falha o `healthCheck` e o Render mantém a anterior no ar. Requer dashboard/Events do Render em produção.

## 3. Tactics — Cobertura no financeiro (Bass canon completo)

### Detect Faults

| Tactic | Status | Evidência |
|---|---|---|
| **Ping/Echo** | ✅ presente (pré-existente, herdado) | `GET /health` em `buildApp.ts:93` responde 200/503 ao poller do Render (`render.yaml:31`). Nova rota admin roda atrás do mesmo processo. |
| **Heartbeat** | ⚠️ parcial (pré-existente, fora do delta) | `GET /health/pipelines` (`routes/health.ts`) devolve 503 quando há execução `reconciling` órfã há mais de N min — mas cobre remessa/conciliação, não uma "batida" própria da retenção. Como a retenção não é assíncrona (é síncrona sobre HTTP), a ausência de heartbeat dedicado não representa lacuna. |
| **Monitor** | ⚠️ parcial | `LogService.info/warn` emite BUSINESS_INFO nas duas ações (`LotePagamentoService.ts:333-337,355-359`); mas o repo não tem dashboard/alerta consumindo isso — o log vai para `process.stdout` (padrão sistêmico, `F-fault-tolerance-2`). |
| **Timestamp** | ✅ presente | Colunas `marcado_em`/`removido_em` (`TIMESTAMPTZ NOT NULL DEFAULT now()`) e `atualizado_em` no lote garantem timestamp autoritativo em cada transição — a analista consegue reconstruir a linha do tempo (0062_titulo_retencao_formacao.sql:23-33). |
| **Sanity Checking** | ✅ presente | Zod nos boundaries (`chaveTituloSchema`, `retirarDoLoteSchema` com `.max(500)` em `routes/sispag.ts:110-127`); frontend espelha o limite (`MOTIVO_RETENCAO_MAX = 500` em `retencao.ts:9`); Postgres reforça em `CHECK char_length(motivo) <= 500` (`0062:39-41`). Três camadas concordantes. |
| **Condition Monitoring** | ✅ presente | `CHECK (removido_em IS NULL) = (removido_por IS NULL) AND (removido_em IS NULL) = (motivo_remocao IS NULL)` bloqueia estado parcial mesmo se um bug tentar gravar assimétrico (`0062:43-47`). `CHECK motivo_remocao IN ('liberado','incluido-no-lote')` bloqueia valor fora do domínio (`0062:49-53`). |
| **Voting** | N/A | Feature não tem redundância de fontes para votar — retenção é decisão única da analista. |
| **Exception Detection** | ✅ presente | 3 erros de domínio dedicados com `statusCode`/`userMessage`/`retryable`; nenhum `catch { return null }` nas rotas ou no serviço (`routes/sispag.ts:298-306,326-331`). Handler central `respondLoteError` propaga `HandlerError` sem silenciar. |
| **Self-Test** | ❌ ausente (fora do delta) | Nenhum endpoint/job faz self-test da retenção (ex.: assertar que "há retenção ativa E o título aparece em `NOT EXISTS` da formação automática"). Marginal para o escopo desta feature. |

### Recover from Faults — Preparation & Repair

| Tactic | Status | Evidência |
|---|---|---|
| **Active Redundancy** | N/A | Deploy Render `starter` = 1 instância; não há réplica ativa. Pré-existente. |
| **Passive Redundancy** | N/A | Idem — sem stand-by quente. Pré-existente. |
| **Spare** | N/A | Sem cold spare. Pré-existente. |
| **Exception Handling** | ✅ presente | `respondLoteError` mapeia HandlerErrors → HTTP; erros não-HandlerError sobem para `asyncHandler` (log central) sem serem engolidos. `routes/sispag.ts:129-140`. |
| **Rollback (transacional)** | ✅ presente | `withTransaction` cobre remoção do item + `insertAtiva` — se qualquer uma falhar, `ROLLBACK` do driver `pg` desfaz ambas (testado em `LotePagamentoService.test.ts:696-707`, "a transação desfaz a remoção"). |
| **Rollback (deploy)** | ✅ presente (pré-existente) | Migration aditiva → runbook `docs/runbooks/rollback.md` classifica como "seguro reverter só o código, deixe a migration aplicada" — ≤5 min de meta. |
| **Software Upgrade** | ✅ presente (pré-existente) | `BootMigrator` roda ANTES de `app.listen`, então `0062` sobe atomicamente com o novo código; migration idempotente permite re-boot sem repetir efeito colateral. |
| **Retry** | ⚠️ parcial | Nenhum `RetryExecutor` no delta — mas as escritas do delta são idempotentes por construção (índice parcial + `ON CONFLICT DO NOTHING`; `UPDATE ... WHERE removido_em IS NULL` no-op se já removida). O cliente pode retentar sem `RetryExecutor` dedicado. Padrão coerente com o resto do agregado `LotePagamentoService`. |
| **Ignore Faulty Behavior** | ⚠️ parcial | `SispagPainelService.linhasDigitaveisDoLote` e `contarExecucoesParadas` demonstram o padrão "falha vira `BUSINESS_WARN` e resposta vazia — não derruba o painel". A nova leitura `retencaoRepo.listAtivas()` foi adicionada dentro do `Promise.all` do `montarPainel`, sem essa proteção — ver F-availability-2. |
| **Degradation** | ⚠️ parcial | Se `retencaoRepo.listAtivas()` falhar, o painel inteiro cai (a retenção é apenas um badge decorativo — perder o badge é degradação aceitável; perder o painel inteiro por causa dele não é). |
| **Reconfiguration** | ❌ ausente (fora do delta) | Sem feature-flag dedicada — desligar `retirarDoLote` sem redeploy só é possível revertendo o deploy inteiro. Consistente com deployability F-2. |

### Recover from Faults — Reintroduction

| Tactic | Status | Evidência |
|---|---|---|
| **Shadow** | N/A | Feature vai direto a 100% dos admins no deploy. |
| **State Resynchronization** | ✅ presente | A cada abertura do painel, `retencaoRepo.listAtivas()` re-lê o estado autoritativo (Postgres) — não há cache local no cliente que possa divergir. Recarregar a tela após um 409 (`toast.error` + `Promise.all([recarregarPainel(), recarregarLotes()])` em `page.tsx:315-322`) traz o estado atual. |
| **Escalating Restart** | ✅ presente (pré-existente) | `gracefulShutdown` termina o processo em `drainTimeoutMs`; PM (Render) reinicia; migration é idempotente, boot é seguro (`gracefulShutdown.test.ts:99,272-345`). |
| **Non-Stop Forwarding** | N/A | Render `starter` = 1 instância, sem tráfego em voo durante o drain a ser encaminhado a par. Pré-existente. |

### Prevent Faults

| Tactic | Status | Evidência |
|---|---|---|
| **Removal from Service** | ✅ presente (pré-existente) | `/health` → 503 durante drain retira a instância do LB antes de o `server.close` começar (`buildApp.ts:88-100`; testes em `gracefulShutdown.test.ts:189-210`). Nova rota herda a proteção. |
| **Transactions** | ✅ presente | Cada escrita do delta corre dentro de `withTransaction`; `SELECT ... FOR UPDATE` em `lerEstadoParaEdicao` fecha a janela TOCTOU entre checagem de status e escrita (`LotePagamentoRepository.ts:157-176`). |
| **Predictive Model** | ❌ ausente | Sem instrumentação preditiva (taxa de crescimento de retenções ativas, `motivo_remocao='liberado'`/dia etc.). Marginal. |
| **Exception Prevention** | ✅ presente | Índice parcial + `ON CONFLICT DO NOTHING`: duas remoções concorrentes do MESMO título não viram exceção 500 nem duplicata — a segunda simplesmente não escreve (`RetencaoFormacaoRepository.ts:55-71`). |
| **Increase Competence Set** | ✅ presente | `SELECT FOR UPDATE` em `lerEstadoParaEdicao` (invocado por `removerItemDoLote`) — reaproveitamento correto do padrão pré-existente; a chamada Conexos de `incluirTitulo` fica FORA do lock para não starve o pool (`LotePagamentoService.ts:194-229` — princípio preservado pelo delta ao liberar retenção dentro da mesma tx sem chamada externa). |

## 4. Findings (achados)

### F-availability-1: Migration 0062 sem integration test contra Postgres real — boot em produção é a primeira execução real

- **Severidade**: P2
- **Tactic violada**: Software Upgrade / Self-Test (verificação pré-deploy)
- **Localização**: `src/backend/migrations/0062_titulo_retencao_formacao.sql`, `src/backend/migrations/retencaoFormacao.test.ts`
- **Evidência (objetiva)**:
  ```
  # o teste do delta valida só o TEXTO da migration via regex:
  const SQL = MIGRATION.replace(/--.*$/gm, '');
  expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_titulo_retencao_formacao_ativa.../);

  # único *.integration.test.ts do repo em migrations/:
  $ find src/backend/migrations -iname "*.integration.test.ts"
  src/backend/migrations/vwMetricasCiclo.integration.test.ts
  ```
- **Impacto técnico**: DDL não-trivial (índice único parcial + 3 CHECKs) só é validado no boot da instância nova em produção. Se o Postgres recusar a sintaxe, o `BootMigrator` sai com código 1, o Render mantém a instância anterior (fail-fast, sem downtime) e a nova rota simplesmente não é servida — mas cada falha consome um ciclo completo push→CI verde→boot falha→diagnosticar→corrigir→re-deploy.
- **Impacto de negócio**: nenhuma corrupção nem downtime (a rede de segurança do `BootMigrator`+`/health` 503+`healthCheck` do Render cobre isso), mas atraso na disponibilização da feature. **Availability real** do serviço permanece 100% no cenário-limite; a métrica que cai é *time-to-availability* da feature em si.
- **Métrica de baseline**: 0 de 1 migration do delta com integration test em CI; 1 de ~62 migrations do repo inteiro (`vwMetricasCiclo`) usa esse padrão. Cross-QA idêntico ao `F-deployability-1` — o consolidator deve mesclar.

### F-availability-2: `montarPainel` faz `Promise.all` de 4 leituras Postgres; falha da nova `retencaoRepo.listAtivas()` derruba o painel inteiro em vez de degradar o badge

- **Severidade**: P2
- **Tactic violada**: Degradation / Ignore Faulty Behavior (o mesmo serviço já implementa esse padrão em `linhasDigitaveisDoLote` e `contarExecucoesParadas`)
- **Localização**: `src/backend/domain/service/sispag/SispagPainelService.ts:91-97`
- **Evidência (objetiva)**:
  ```ts
  // SispagPainelService.montarPainel:
  const [titulosRaw, ultimaRun, emRascunho, retencoes] = await Promise.all([
      this.tituloRepo.listAtivos(),
      this.runRepo.findLatestSuccessFinishedAt(),
      this.loteRepo.listTitulosEmRascunho(),
      this.retencaoRepo.listAtivas(),           // ← adicionada pelo delta
  ]);
  ```
  Compare com o padrão local, na MESMA classe (`linhasDigitaveisDoLote`, linhas 267-280) e (`contarExecucoesParadas`, linhas 388-412), onde falha em leitura secundária vira `BUSINESS_WARN` + resposta parcial (lista vazia / zeros), sem derrubar a resposta.
- **Impacto técnico**: se o Postgres estiver momentaneamente saturado e a query `SELECT ... FROM titulo_retencao_formacao WHERE removido_em IS NULL` (uma das quatro) der `ETIMEDOUT` ou `PoolConnectionError`, o painel inteiro devolve 500 para o operador. As outras 3 leituras podem ter completado com sucesso. A retenção, funcionalmente, é apenas um **badge decorativo** (`RetencaoBadge` em `page.tsx:882`) — perder o badge é degradação aceitável; perder o painel de pagamentos inteiro por causa dele não é.
- **Impacto de negócio**: em janela de instabilidade transitória do Supabase, a analista da Columbia perde a tela em que decide TODOS os pagamentos do dia — não só a coluna que informa "não lotar automaticamente". Rebaixado a P2 (e não P1) porque (i) a tabela `titulo_retencao_formacao` é local e barata (uma SELECT com índice parcial já cobre o filtro), portanto a probabilidade prática de esta ser a query que falha é baixa; (ii) o mesmo `Promise.all` já continha 3 leituras antes do delta e nunca foi coberto por `Promise.allSettled` — o delta apenas amplia a superfície de falha em ~25%, não introduz o padrão.
- **Métrica de baseline**: 4 leituras críticas do painel em `Promise.all` (3 pré-existentes + 1 nova); 2 leituras auxiliares do MESMO serviço já usam padrão tolerante (`linhasDigitaveisDoLote`, `contarExecucoesParadas`) → 2/6 leituras auxiliares tolerantes. Alvo razoável: 6/6 quando a leitura é ornamento (retenção é ornamento; título/lote/última-run são dados de decisão).

### F-availability-3: Sem kill-switch dedicado — desligar "Retirar do lote" em produção exige rollback do deploy

- **Severidade**: P3 (pré-existente, fora do delta — padrão da plataforma, não regressão desta feature)
- **Tactic violada**: Reconfiguration
- **Localização**: `render.yaml` (não tocado pelo delta), `routes/sispag.ts:276,311`
- **Evidência (objetiva)**:
  ```
  # nenhuma env/flag nova para desligar a feature sem redeploy:
  $ git diff main...HEAD -- render.yaml DEPLOY.md
  (sem alterações)
  $ grep -n "process.env" src/backend/routes/sispag.ts src/backend/domain/service/sispag/LotePagamentoService.ts
  (nenhuma leitura direta de env — bom, mas também nenhum feature-flag por env)
  ```
- **Impacto técnico**: se `retirarDoLote`/`liberarRetencao` mostrar defeito em produção, a única forma de desligar é o rollback do deploy. Não há `SISPAG_RETENCAO_ENABLED` como existe `SISPAG_LIVE_WRITE_ENABLED`/`CONEXOS_WRITE_ENABLED` para caminhos que escrevem no ERP.
- **Impacto de negócio**: baixo — a feature não escreve no ERP; o pior caso é retenções incorretas, reversíveis via `liberarRetencao` (a ação simétrica existe). Rollback aditivo é rápido (meta ≤5 min).
- **Métrica de baseline**: 0 kill-switches específicos da retenção; padrão consistente do repo (kill-switch existe só para caminhos ERP-writing). Pré-existente.

### F-availability-4: Auditoria da ação sobrevive à rotação de log (positivo, sem ação)

- **Severidade**: N/A (nota positiva)
- **Tactic**: Timestamp / Monitor / audit persistido — implementadas corretamente
- **Localização**: `0062_titulo_retencao_formacao.sql:24-34`, `LotePagamentoService.ts:333-337,355-359`
- **Evidência (objetiva)**: `marcado_por/marcado_em/removido_por/removido_em/motivo/motivo_remocao` ficam gravados na tabela — consulta SQL responde "quem retirou o título X do lote Y e quando" mesmo depois de o log do Render rotacionar. Isso é **melhor** que o padrão pré-existente do mesmo `LotePagamentoService`, onde `criarLote`/`finalizarLote`/`cancelarLote` deixam rastro só em `process.stdout` (`F-fault-tolerance-2`).
- **Impacto**: positivo para availability *observacional* — o operador consegue diagnosticar sem depender de log de aplicação. Recomendação (não card): estender o padrão às demais transições do lote via card `fault-tolerance-1`.
- **Métrica de baseline**: 2/2 ações do delta com trilha persistida em tabela, versus ~5/5 outras ações do mesmo serviço com trilha só em stdout.

### F-availability-5: Não medível localmente — MTTR real, taxa de falha de boot, sazonalidade Postgres

- **Severidade**: N/A (declaração de não-medibilidade)
- **Tactic**: Monitor / Predictive Model — não instrumentadas
- **Localização**: `docs/runbooks/rollback.md:5` (meta ≤5 min sem histórico), ausência de dashboard próprio
- **Evidência**: nenhum log estruturado do repo captura MTTR de rollback executado; nenhum histórico de failed boots (a Render mantém 7 dias em Events, mas não há coletor local). O `retencaoRepo.listAtivas()` não tem métrica de latência p95/p99 para a query — a única forma de saber se ela virou gargalo do painel é reproduzir em prod.
- **Impacto**: sem baseline não dá para justificar investimento futuro em (i) `Promise.allSettled` no painel, (ii) alarme dedicado sobre `LotePagamentoService.retirarDoLote` p99, (iii) chaos test do `BootMigrator`. Instrumentar isso é pré-requisito para transformar o `F-availability-2` em P1 defensável.
- **Métrica de baseline**: 0 rollbacks reais com tempo medido; 0 dashboards com p99 das queries do delta.

## 5. Cards Kanban

### [availability-1] Tolerar falha da nova leitura de retenções sem derrubar o painel SISPAG

- **Problema**
  > O `montarPainel` passou a fazer `Promise.all` de 4 leituras Postgres (a leitura de `titulo_retencao_formacao` foi adicionada pelo delta na linha 91-96 do `SispagPainelService.ts`). Se qualquer uma falhar, o painel inteiro devolve 500 — inclusive quando a que falha é apenas a leitura ornamental que alimenta o `RetencaoBadge`. O mesmo arquivo já demonstra o padrão certo em `linhasDigitaveisDoLote` (`try/catch` → `BUSINESS_WARN` + lista vazia) e em `contarExecucoesParadas`.

- **Melhoria Proposta**
  > Tactic alvo: **Degradation** (Recover from Faults — Preparation & Repair) + **Ignore Faulty Behavior**. Trocar `Promise.all` por `Promise.allSettled` para as leituras ornamentais e emitir `BUSINESS_WARN` quando `retencaoRepo.listAtivas()` falhar; a tela mostra o painel sem badges de retenção (funcionalmente igual ao estado antes do delta) em vez de 500. Aplicável também a `runRepo.findLatestSuccessFinishedAt` (ornamento) e, com cuidado, ao `loteRepo.listTitulosEmRascunho` (que marca `emLote` para bloqueio de I3 — este é dado de decisão, deveria continuar mandatório).

- **Resultado Esperado**
  > Painel SISPAG serve sob falha transitória da SELECT de retenções (perde o badge, mantém a tomada de decisão). Métrica: leituras auxiliares tolerantes no `SispagPainelService.montarPainel` — 0/2 (retenção + última-run) → 2/2 tolerantes; leituras críticas (títulos + emLote) permanecem mandatórias e explicitamente rotuladas.

- **Tactic alvo**: Degradation / Ignore Faulty Behavior
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — mudança localizada em `SispagPainelService.montarPainel`, teste equivalente ao já existente em `SispagPainelService.test.ts`
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Falhas em `retencaoRepo.listAtivas()` derrubam o painel: sim → não
  - Cobertura de teste do caminho degradado (mock rejeita → resposta 200 com badges vazios): 0 → 1
- **Risco de não fazer**: em janela de saturação transitória do Supabase, a analista perde a tela de pagamentos inteira por causa de uma leitura ornamental adicionada por esta feature. Baixo risco em regime normal; alto em incidente.
- **Dependências**: nenhuma; padrão já existe no mesmo arquivo.

### [availability-2] Adicionar integration test do `0062_titulo_retencao_formacao.sql` contra Postgres real no job `backend-sql`

- **Problema**
  > A migration só é validada por regex sobre o texto SQL — DDL não-trivial (índice único parcial + 3 CHECKs) só executa contra o Postgres real no boot da instância nova em produção. `BootMigrator` + `/health` 503 protegem contra downtime, mas cada falha consome um ciclo de deploy sem necessidade.

- **Melhoria Proposta**
  > Tactic alvo: **Self-Test** aplicada ao pipeline. Adicionar `src/backend/migrations/tituloRetencaoFormacao.integration.test.ts` no padrão do `backend-sql` job (`postgres:17-alpine` já disponível em CI, seguindo `vwMetricasCiclo.integration.test.ts`). Cenários: (i) migration aplica limpo, (ii) reaplicar é no-op, (iii) índice parcial rejeita segunda retenção ativa com mesmo `(fil_cod, doc_cod, tit_cod)`, (iv) os 3 CHECKs rejeitam estado inválido (`motivo` >500 chars, `removido_em` sem `removido_por`, `motivo_remocao` fora do enum).

- **Resultado Esperado**
  > Falhas de sintaxe/semântica DDL aparecem no PR, não no boot de produção. Métrica: migrations do delta validadas contra Postgres real em CI — 0/1 → 1/1.

- **Tactic alvo**: Self-Test / Software Upgrade
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — infra de CI já existe (`postgres:17-alpine`)
- **Findings relacionados**: F-availability-1 (idêntico a `F-deployability-1`; cross-QA: consolidar em UM card)
- **Métricas de sucesso**:
  - Migrations do delta validadas em CI: 0/1 → 1/1
  - `time-to-availability` da feature no cenário de defeito de DDL: 2 ciclos de deploy → 0 (o defeito é pego no CI)
- **Risco de não fazer**: cada nova migration com DDL não-trivial mantém a mesma janela cega; se o volume acumular, sobe a probabilidade de um boot falho por sintaxe, mesmo com a rede de segurança limitando a "deploy não promovido".
- **Dependências**: nenhuma — reaproveita infra do job `backend-sql`.

### [availability-3] Registrar histórico de MTTR real de rollback para a próxima janela de 3 incidentes

- **Problema**
  > `docs/runbooks/rollback.md` define meta ≤5 min "sem consultar ninguém", mas 0 rollbacks reais foram cronometrados. Sem baseline, defender no comitê que o delta é reversível em ≤5 min depende de aspiração, não de medida.

- **Melhoria Proposta**
  > Tactic alvo: **Monitor** (deployment observability). Adicionar ao runbook uma seção "Histórico" com 1 linha por rollback: data, hora do deploy quebrado, hora do `/health` 200 confirmado, cumpriu ≤5 min?. Baixo custo — o próprio "Depois" do runbook já pede timeline pós-incidente.

- **Resultado Esperado**
  > Após 3 rollbacks reais, a meta ≤5 min vira métrica observada. O card também alimenta `F-availability-5` (ainda "não medível localmente") — depois de instrumentado, essa lacuna desaparece.

- **Tactic alvo**: Monitor
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — disciplina de preenchimento, sem código
- **Findings relacionados**: F-availability-5 (idêntico ao `deployability-2`; cross-QA: consolidar)
- **Métricas de sucesso**:
  - Rollbacks com tempo real registrado: 0 → ≥3 (janela dos próximos 6 meses)
- **Risco de não fazer**: nenhum risco técnico direto; o custo é seguir defendendo "≤5 min" como aspiração em vez de fato.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Escopo real**: avaliei o delta como um todo — o mais relevante para availability é a nova
  leitura em `SispagPainelService.montarPainel` (que é o hot path do painel) e a mecânica de
  boot da migration 0062. As duas rotas admin em si são baixo risco: escritas curtas, dentro
  de transação, com árbitro no índice parcial. A ausência de SQS/EventBridge/escrita ERP faz
  boa parte do plano de inspeção genérico (DLQ, timeouts em client externo, blast-radius
  multi-tenant) recair no rótulo "N/A a este delta" — pertence a outras fatias do SISPAG.
- **Cross-QA** — três cards convergem com outras seções e devem ser consolidados:
  - `[availability-2]` ↔ `[deployability-1]` (mesmo integration test da migration). O consolidator
    deve mesclar em UM card com Tactic dupla (Self-Test / Idempotent Deploys).
  - `[availability-3]` ↔ `[deployability-2]` (mesmo histórico de MTTR).
  - `[availability-1]` (`Promise.allSettled` no painel) é próprio deste QA — não aparece em
    fault-tolerance porque lá o foco é atomicidade da escrita, aqui é degradação de leitura.
- **Score 8.3** — feature entrega bem os tactics essenciais (Transactions, Exception Prevention,
  Rollback transacional, `/health` no drain, timestamp/audit persistido), com duas lacunas
  concretas de degradação (`F-availability-2`) e verificação pré-boot (`F-availability-1`) que
  merecem virar cards; o restante é aspiracional/marginal para o escopo. Nenhum finding é P0.
- **Nenhum P0 nesta seção**: as duas escritas do delta não tocam o ERP, são transacionais, têm
  árbitro de concorrência no DB, e a queda de qualquer uma reverte-se atomicamente. Um duplo-
  clique não duplica retenção (índice parcial + `ON CONFLICT DO NOTHING`); um SIGTERM no meio
  da transação é coberto por `/health` 503 (não roteia nova requisição) e `ROLLBACK` do driver.
