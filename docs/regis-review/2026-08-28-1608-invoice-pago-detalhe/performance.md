---
qa: Performance
qa_slug: performance
run_id: 2026-08-28-1608-invoice-pago-detalhe
agent: qa-performance
generated_at: 2026-08-28T16:45:00-03:00
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Cron `financeiro-ingest-permutas` (`0 9 * * *` UTC = 06:00 SP) | Disparo diário roda `IngestaoPermutasService.executar()` → `EleicaoPermutasService.computeCandidatas()` (fan-out Conexos completo) | `EleicaoPermutasService` + `ConexosTitulosClient` + pool de sessões Conexos (~3 slots/usuário, `LOGIN_ERROR_MAX_SESSIONS`) | Produção Render, RootDir `src/backend`, plano `starter` (0.5 vCPU / 512 MB) | Ingestão completa sem estourar sessões, sem `capHit` silencioso, com payload de `/permutas/gestao` já filtrado por `pago` real | Wall-time de uma run ≤ 15 min (baseline atual estimado 8–12 min × N filiais); zero `LOGIN_ERROR_MAX_SESSIONS` no log; payload de `/permutas/gestao` cai ~75% (de ~1.146 → ~287 linhas de invoice na filial 2, agora que o filtro `NOT pago` é seletivo) |

Cenário secundário (usuário): analista abre `/permutas/gestao` — a query `SELECT * FROM permuta_invoice WHERE NOT stale AND NOT pago` volta apenas as invoices genuinamente em aberto, respondendo em < 300 ms P95 na filial 2 (índice parcial `idx_permuta_invoice_fil_aberto` finalmente seletivo).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas Conexos por run do cron (universo, filial 2) | 1× `listAdiantamentosProforma` + 1× `listInvoicesFinalizadas` + 1× `listProcessos` + **1.146× `listTitulosAPagar` (com308)** + ~M× `getDetalheTitulos` (M = adiantamentos elegíveis) | Sem alvo formal — precisa ser instrumentado (contagem de requests/run) | ⚠️ | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:295-320` (fan-out); probe `jobs/probe-invoice-pago.ts` mediu 1.146 INVOICEs finalizadas em filial 2 |
| `FILIAIS_CONCURRENCY` × `ADIANTAMENTOS_CONCURRENCY` (paralelismo teórico) | 5 × 10 = **50 requests concorrentes** possíveis | Alinhar ao pool de sessão Conexos (~3 slots/usuário) | ⚠️ | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:115-116` |
| Pool de sessões Conexos por usuário (`LOGIN_ERROR_MAX_SESSIONS`) | ~3 slots | Não configurável (limite ERP) — dimensionar concorrência a partir dele | ✅ (documentado) | `src/backend/services/conexos.ts:187`, `domain/client/ConexosSessionRegistry.ts:15` |
| `PAGE_SIZE` × `MAX_PAGES` (teto de linhas por `paginate`) | 500 × 50 = **25.000 linhas** | Filial 2 hoje: 1.146 (~2,3 páginas) → folga de ~22× | ✅ | `src/backend/domain/client/ConexosBaseClient.ts:107,116` |
| Comportamento no `capHit` de `listInvoicesFinalizadas` | WARN log + segue com universo truncado | Hard-fail ou continuação com cursor — truncamento silencioso do universo é perda de dinheiro no radar da analista | ⚠️ | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:302-309` |
| Custo do `derivarPagoDosTitulos` | 2× `reduce` O(n) sobre `titulos` (n = parcelas do doc, tipicamente 1–3) — sub-µs por invoice, sem alocação nova | Trivial — não é bottleneck | ✅ | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:103-113` |
| Chamadas Conexos ADICIONAIS introduzidas pelo delta | **0** (o `listTitulosAPagar` já era feito para hidratar valor/moeda/taxa negociada; o campo `titMnyTotPago` foi adicionado ao mesmo `fieldList`) | 0 | ✅ | Diff em `ConexosTitulosClient.ts:250-253` (`fieldList` cresce em 1 string) + `EleicaoPermutasService.ts:616-621` (usa `tit` que já estava em mãos) |
| Redução do payload de `/permutas/gestao` (filial 2) | **~1.146 → ~287 linhas** (assumindo ~75% de invoices pagas, mesmo perfil da amostra da sonda `probe-invoice-pago`) | ≥60% de redução com a correção | ✅ | Query em `PermutaRelationalRepository.ts:531-537` (`SELECT * FROM permuta_invoice WHERE NOT stale AND NOT pago`); antes do fix `pago` era sempre `false` → filtro no-op |
| Seletividade do índice parcial `idx_permuta_invoice_fil_aberto ... WHERE NOT pago AND NOT stale` | Antes do fix: **~100% das linhas** cabiam no predicado do índice (efetivamente inútil, ~mesmo tamanho da tabela); depois do fix: ~25% | Índice parcial < 30% da tabela | ✅ | `src/backend/migrations/0003_permuta_relational.sql:78-80` |
| Timeout HTTP do client Conexos | 40 s por request | ✅ presente | ✅ | `src/backend/services/conexos.ts:121` |
| Wall-time estimado por run do cron (com 3 filiais, ~1.146 invoices cada, pool efetivo de 3 slots) | (3 × 1.146 = 3.438 chamadas com308) / 3 slots × ~500 ms ≈ **~9,5 min** + adiantamentos + variação cambial ⇒ **~11–13 min** | ≤ 15 min p/ caber na janela pré-horário-comercial (06:00 SP → 08:00 SP) sem invadir tráfego do analista | ⚠️ (estimado — sem instrumentação) | Estimativa a partir de `FILIAIS_CONCURRENCY=5`, `ADIANTAMENTOS_CONCURRENCY=10` capados pelas ~3 sessões do ERP + latência típica com298/com308 documentada em `docs/regis-review/*/availability.md` prévias |
| Bundle backend / cold start | ⚠️ **Não medível** — Render é long-running (Express), não Lambda; não há cold-start budget aplicável | N/A | ✅ | `render.yaml` (type=web, startCommand=npm start) |
| Cobertura de índices sobre `WHERE ...` das queries do delta | `idx_permuta_invoice_fil_aberto` cobre exatamente o predicado da leitura da aba | ✅ presente e agora seletivo | ✅ | `migrations/0003_permuta_relational.sql:78-80` × `PermutaRelationalRepository.ts:531-537` |

> ⚠️ **Não medível localmente**: contagem real de requests/run e wall-time (o cron ainda não rodou em produção — a linha do `render.yaml` é NOVA). Recomendação: emitir contadores `conexos_requests_total{endpoint}` e `flow_duration_ms` no `LogService.info FLOW_COMPLETE` do `computeCandidatas` para termos baseline dentro de 3 execuções.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | Universo completo por run (não amostragem) — política correta para reconciliação diária | ✅ presente | `EleicaoPermutasService.ts:295-320` |
| Limit Event Response | Cron 1×/dia (`0 9 * * *`); no request-path o `heavyRouteLimiter` gata rotas caras | ✅ presente | `render.yaml` + `routes/permutas.ts:441` |
| Prioritize Events | Cron às 06:00 SP (fora do horário comercial) — dá janela para o analista abrir `/gestao` sem competir por slots | ✅ presente | `render.yaml` (`schedule: '0 9 * * *'` UTC) |
| Reduce Overhead | **Delta explicitamente escolheu reduzir overhead**: adicionou 1 campo (`titMnyTotPago`) ao `fieldList` do com308 que JÁ era chamado, em vez de emitir um `getDetalheTitulos` por invoice (que teria dobrado o fan-out). Custo marginal: 1 coluna extra no payload de resposta (~10 bytes/row) | ✅ presente | Diff em `ConexosTitulosClient.ts:250-253` + comentário `EleicaoPermutasService.ts:617-619` |
| Bound Execution Times | Timeout HTTP Conexos 40 s por request; nenhum timeout global para a run do cron | ⚠️ parcial | `services/conexos.ts:121`; ausência: nada no `ingest-permutas.ts` limita duração total |
| Increase Resource Efficiency | Batches (`fetchDeclaracoesBatched`, `fetchInvoicesBatched`, `fetchProcessosBatched`) eliminam N+1 no eixo `priCod`; `Promise.all` estrutura os 3 batches em paralelo | ✅ presente | `EleicaoPermutasService.ts:463-468`, comentário P0-7 |
| Increase Resources | Render plan `starter` (0.5 vCPU / 512 MB) — não é vinculante aqui: o gargalo é I/O (Conexos), não CPU | N/A (o gargalo é externo) | `render.yaml:6` |
| Increase Concurrency | `BoundedConcurrency.map` + `FILIAIS_CONCURRENCY=5` × `ADIANTAMENTOS_CONCURRENCY=10` — porém o efeito é **capado pelas ~3 sessões do ERP**: 50 workers concorrentes servem apenas para amortizar latência de mistura, não para paralelizar de verdade | ⚠️ parcial | `EleicaoPermutasService.ts:115-116` × `services/conexos.ts:187` |
| Maintain Multiple Copies of Computations | N/A — computação linear por doc, não há trabalho replicado | N/A | — |
| Maintain Multiple Copies of Data | `permuta_invoice`/`permuta_adiantamento` são cache local do estado Conexos, materializado pela ingestão. `/gestao` lê o cache; escritas ao ERP re-consultam. | ✅ presente | `migrations/0003_permuta_relational.sql`; `IngestaoPermutasService.ts` |
| Bound Queue Sizes | `BoundedConcurrency.map` limita filas de promessa; `paginate` limita a `MAX_PAGES=50` (25k rows) | ✅ presente | `libs/concurrency/BoundedConcurrency.ts:36-60`, `client/ConexosBaseClient.ts:277` |
| Schedule Resources | Advisory-lock `INGEST_LOCK_KEY=918273645` serializa cron × clique manual do analista (o perdedor sai com `IngestLockBusyError`, sem duplicar fan-out) | ✅ presente | `IngestaoPermutasService.ts:41`, `render.yaml` comentário |
| Cache strategy (facet moderno) | O universo hidratado é persistido em `permuta_invoice` (cache local do dia). Não há memoização em processo do `listTitulosAPagar` — cada invoice paga 1 chamada, mesmo quando o resultado é idêntico ao de ontem | ⚠️ parcial | Ausência de cache com TTL/ETag no eixo `docCod` |
| Index discipline (facet moderno) | O delta **restaura** a utilidade do índice parcial `idx_permuta_invoice_fil_aberto`, que era tautologicamente satisfeito (o predicado `NOT pago` era no-op enquanto `pago` era sempre false) | ✅ presente (agora seletivo) | `migrations/0003_permuta_relational.sql:78-80` × fix `EleicaoPermutasService.ts:620-621` |
| Bundle leanness (facet moderno) | N/A — deploy é Render long-running (não Lambda); sem cold-start budget | N/A | `render.yaml` |

## 4. Findings (achados)

### F-performance-1: Cron diário completa um fan-out de ~3.400 chamadas Conexos capado pelas 3 sessões do ERP, com wall-time estimado 11–13 min e sem instrumentação de duração

- **Severidade**: P1
- **Tactic violada**: *Bound Execution Times* + *Schedule Resources* (parcialmente); *Increase Concurrency* neutralizada pelo pool externo
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:115-116, 279-332`; `render.yaml` (bloco `financeiro-ingest-permutas`)
- **Evidência (objetiva)**:
  ```
  FILIAIS_CONCURRENCY = 5
  ADIANTAMENTOS_CONCURRENCY = 10          // src/backend/domain/service/permutas/EleicaoPermutasService.ts:115-116

  Pool efetivo por usuário Conexos ≈ 3    // services/conexos.ts:187, ConexosSessionRegistry.ts:15

  Sonda em PRD filial 2 (2026-08-28):     1.146 INVOICEs finalizadas
  Fan-out por filial:                     1.146 × listTitulosAPagar (com308)
                                        + M × getDetalheTitulos (M = adiantamentos)
  Com 3 filiais:                          ~3.438 chamadas com308 apenas p/ o universo
  Wall-time estimado:                     3.438 / 3 slots × ~500 ms ≈ 9,5 min
                                        + adiantamentos + variação cambial
                                        ⇒ ~11–13 min por run
  ```
- **Impacto técnico**: O paralelismo declarado (50) é ilusório — o pool de sessões do ERP força serialização em ~3 vias. O cron às 06:00 SP tem ~2h de folga antes do horário comercial (08:00), mas uma run que estoure 2h invade o tráfego do analista e produz `LOGIN_ERROR_MAX_SESSIONS` em `/permutas/gestao`. Sem `flow_duration_ms` no `FLOW_COMPLETE`, só descobrimos o problema quando um analista abrir ticket.
- **Impacto de negócio**: Uma ingestão que não termina antes das 08:00 SP faz a analista abrir a aba antes do dado do dia ficar pronto — retrabalho (ela olha número velho) e/ou travamento das rotas Conexos-dependentes (Frente III/IV competem pelos mesmos slots).
- **Métrica de baseline**: 3.438 chamadas com308 por run (estimadas via 3 filiais × 1.146 invoices da sonda `probe-invoice-pago`); wall-time real ainda **não instrumentado**.

### F-performance-2: `capHit` em `listInvoicesFinalizadas` é apenas WARN-logado — universo pode truncar em silêncio, sumindo invoices legítimas da aba

- **Severidade**: P2 (P1 se qualquer filial passar de 25k INVOICEs finalizadas)
- **Tactic violada**: *Bound Queue Sizes* (o teto é aplicado, mas a resposta é degradação silenciosa, não fail-loud)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:298-309`; teto em `src/backend/domain/client/ConexosBaseClient.ts:107,116` (`PAGE_SIZE=500`, `MAX_PAGES=50` → 25.000)
- **Evidência (objetiva)**:
  ```typescript
  const { invoices, capHit } = await this.conexosFinanceiroClient.listInvoicesFinalizadas(...);
  if (capHit) {
      await this.logService.warn({
          type: LOG_TYPE.BUSINESS_WARN,
          message: 'listInvoicesFinalizadas atingiu o teto de páginas — universo pode estar TRUNCADO',
          data: { flowId, filCod: filial.filCod, retornadas: invoices.length },
      });
  }
  // ... segue processando as 25.000 rows retornadas
  ```
- **Impacto técnico**: Filial 2 hoje tem 1.146 invoices (~4,6% do teto) — folga confortável. Mas o filtro `vldStatus#IN=FINALIZADO` acumula ao longo do tempo (não expira), então uma filial com histórico longo pode cruzar 25k em silêncio. O `IngestaoPermutasService.markStale` marcaria as invoices FORA das 25k retornadas como `stale=true` na próxima run — invoices podem sumir da aba porque o cron julgou incorretamente que a linha "não existe mais".
- **Impacto de negócio**: Invoice liquidada externamente desaparece por baixa lógica; invoice em aberto some da aba do analista. Ambos são exatamente o defeito de dinheiro-fora-do-radar que este PR tentou combater.
- **Métrica de baseline**: 1.146 / 25.000 = 4,6% (filial 2). Sem instrumentação de contagem em outras filiais, o gap até o teto é desconhecido.

### F-performance-3 (efeito colateral POSITIVO): fix restaura seletividade de `idx_permuta_invoice_fil_aberto` e reduz payload de `/permutas/gestao` em ~75%

- **Severidade**: P3 (positivo — documentação para o KPI de impacto)
- **Tactic violada**: nenhuma; **tactic reforçada** — *Index discipline* + *Reduce Overhead*
- **Localização**: `src/backend/migrations/0003_permuta_relational.sql:78-80` × `src/backend/domain/repository/permutas/PermutaRelationalRepository.ts:531-537`
- **Evidência (objetiva)**:
  ```sql
  -- migration 0003
  CREATE INDEX IF NOT EXISTS idx_permuta_invoice_fil_aberto
      ON permuta_invoice (fil_cod)
      WHERE NOT pago AND NOT stale;

  -- repo query (rota GET /permutas/gestao → GestaoPermutasService → listInvoicesEmAberto)
  SELECT * FROM permuta_invoice WHERE NOT stale AND NOT pago ORDER BY doc_cod ASC
  ```
  Antes do delta: `pago` gravado a partir da row do `com298/list` era `false` em 1.146/1.146 INVOICEs (sonda `probe-invoice-pago`, filial 2) — o predicado do índice cobria ~100% das linhas (índice inútil).
  Depois do delta: `pago` derivado dos títulos concorda com o ERP em 30/30 amostras; ~75% das invoices estão pagas → o índice cobre ~25%.
- **Impacto técnico**: Query `/permutas/gestao` passa de scan-completo-com-filter-no-op para bitmap-index-scan real. Payload JSON cai de ~1.146 rows para ~287 rows (filial 2) — menos serialização no backend e menos DOM/render no frontend.
- **Impacto de negócio**: Aba "Invoices em aberto" para de mostrar invoices já liquidadas (sintoma do relato Simone 2026-08-25).
- **Métrica de baseline**: filial 2, 1.146 rows → ~287 rows (redução de 75%). Latência da rota ainda não medida ponta-a-ponta antes/depois.

### F-performance-4: `derivarPagoDosTitulos` faz duas passadas de `reduce` sobre o mesmo array; micro-oportunidade

- **Severidade**: P3
- **Tactic violada**: *Reduce Overhead* (marginalmente)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:103-113`
- **Evidência (objetiva)**:
  ```typescript
  const face = titulos.reduce((acc, t) => acc + (t.valorBrl ?? 0), 0);
  const pago = titulos.reduce((acc, t) => acc + (t.valorPago ?? 0), 0);
  return face - pago === 0;
  ```
- **Impacto técnico**: Executado 1× por invoice hidratada (~1.146 vezes por run, por filial). `titulos.length` mediano = 1–3 parcelas. Duas passadas de reduce sobre 3 elementos ≈ 6 somas; consolidar em uma passada é micro-ganho sem qualquer impacto observável.
- **Impacto de negócio**: nenhum.
- **Métrica de baseline**: <1 µs por invoice; total <2 ms por run. Não implementar — registrado apenas para fechar a análise.

### F-performance-5: Ausência de instrumentação de duração e de contagem de requests Conexos por run

- **Severidade**: P2
- **Tactic violada**: *Bound Execution Times* (não podemos boundar o que não medimos)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:389-398` (`FLOW_COMPLETE` já grava `durationMs`) mas `computeCandidatas` **não** conta requests Conexos, e o `ingest-permutas.ts` não define timeout global
- **Evidência (objetiva)**:
  ```typescript
  // FLOW_COMPLETE emite durationMs — bom
  // Mas NÃO emite: total de chamadas com298/com308/imp021, tempo por endpoint,
  // reuso de sessão, contagem de `LOGIN_ERROR_MAX_SESSIONS` no run.
  ```
- **Impacto técnico**: F-performance-1 é uma estimativa exatamente porque não temos os contadores acima. Após 3 execuções do cron novo em produção, deveria haver baseline; sem contadores, não teremos.
- **Impacto de negócio**: descobriremos que o cron não cabe na janela pré-comercial pelo ticket do analista, não pelo alerta.
- **Métrica de baseline**: 0 métricas de request-counter emitidas por run.

## 5. Cards Kanban

### [performance-1] Instrumentar duração e contagem de requests do cron de ingestão

- **Problema**
  > O cron `financeiro-ingest-permutas` passa a rodar diariamente (delta atual — `render.yaml`) e vai emitir ~3.438 chamadas Conexos por run (3 filiais × 1.146 invoices via sonda `probe-invoice-pago`), capadas pelas ~3 sessões do usuário ERP. Wall-time estimado 11–13 min sem qualquer instrumentação — se estourar 2h a run invade o horário comercial e compete por slots com `/permutas/gestao`, `/recebimentos/*` e Frente III.

- **Melhoria Proposta**
  > Adicionar contadores por run em `EleicaoPermutasService.computeCandidatas` e propagá-los ao `FLOW_COMPLETE` já emitido:
  > - `conexos_requests_total{endpoint}` (com298/list, com298/{docCod}, com308/list, imp021)
  > - `conexos_login_errors_total{type}` (com foco em `LOGIN_ERROR_MAX_SESSIONS`)
  > - `flow_duration_ms` já existe; adicionar `per_filial_duration_ms`
  > Também definir um timeout global para o job (ex.: `AbortController` disparado se `flow_duration_ms > 30 min`) — o `AbortSignal` já existe no fan-out (linhas 271-289), basta cabear o timeout ao mesmo controller.
  > Tactic Bass: *Bound Execution Times*.

- **Resultado Esperado**
  > Após 3 execuções do cron temos baseline numérico real; o job aborta antes de invadir o horário comercial. Métrica observável: `flow_duration_ms` presente em 100% dos runs; alerta se p95 > 15 min; zero `LOGIN_ERROR_MAX_SESSIONS` no intervalo 08:00–20:00 SP.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-5
- **Métricas de sucesso**:
  - Contadores `conexos_requests_total` emitidos por run: 0 → 1 conjunto/run
  - Wall-time p95 do cron: desconhecido → medido, com alerta se > 15 min
  - Runs que invadem 08:00 SP: desconhecido → 0
- **Risco de não fazer**: em 6 meses uma filial cresce, o cron passa das 08:00 SP e derruba `/permutas/gestao` do analista sem que ninguém saiba por quê.
- **Dependências**: nenhuma.

### [performance-2] Falhar alto (não WARN) quando `listInvoicesFinalizadas.capHit === true`

- **Problema**
  > `EleicaoPermutasService.computeCandidatas` loga `BUSINESS_WARN` quando o `paginate` bate `MAX_PAGES=50` (25.000 rows) e **segue processando**. Filial 2 usa 4,6% do teto hoje; para uma filial com histórico longo pode cruzar 25k em silêncio. Como o `IngestaoPermutasService.markStale` marca como `stale=true` tudo que não voltou no run, invoices reais somem da aba.

- **Melhoria Proposta**
  > Duas opções (a preferida é a 1):
  > 1. **Fail-loud**: converter o `capHit` em `throw` (novo `UniversoTruncadoError`) — a run inteira falha, o cabeçalho da ingestão fica `error` e a `markStale` não roda (o ROLLBACK preserva o estado do dia anterior).
  > 2. **Continuação com cursor**: implementar paginação por chave (`docCod > lastSeen`) em `listInvoicesFinalizadas`, eliminando o teto de 25k.
  > Enquanto (2) não vier, (1) é a proteção mínima contra desaparecimento silencioso. Tactic Bass: *Bound Queue Sizes* (fail-loud em vez de degradação).

- **Resultado Esperado**
  > Nenhuma run consegue marcar invoices como `stale` quando o universo veio truncado. Métrica: 0 runs com `capHit=true AND status=success` — se `capHit=true`, o cabeçalho vira `error`.

- **Tactic alvo**: Bound Queue Sizes
- **Severidade**: P2 (P1 quando qualquer filial cruzar 20k rows)
- **Esforço estimado**: S (opção 1) / M (opção 2)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Runs com `capHit=true` completadas como `success`: potencial → 0
  - Rows por filial × dia (baseline): não medido → dashboard com % do teto
- **Risco de não fazer**: em 6 meses uma filial atinge o teto silenciosamente; invoices em aberto desaparecem da aba sem trilha.
- **Dependências**: depende do card `performance-1` para dashboardar as filiais que se aproximam do teto.

### [performance-3] Documentar o ganho de payload em `/permutas/gestao` como KPI de impacto (baseline vs. pós-fix)

- **Problema**
  > O fix (delta atual) restaura a utilidade do índice parcial `idx_permuta_invoice_fil_aberto ... WHERE NOT pago AND NOT stale` (`migration 0003_permuta_relational.sql:78-80`), que enquanto `pago` era sempre `false` cobria ~100% da tabela — inútil. O payload de `/permutas/gestao` para a filial 2 estimado cai de ~1.146 → ~287 linhas de invoice (~75% de redução), mas essa vitória fica **não medida** e não vai para o KPI de impacto da Columbia.

- **Melhoria Proposta**
  > Medir 1× ponta-a-ponta antes/depois: `bytes de resposta` + `linhas de invoice retornadas` + `latência p50/p95` da rota `/permutas/gestao` na filial 2 (usar `curl -w '%{time_total}\n%{size_download}\n'` contra prd). Registrar em `docs/impacto/` como evidência do fix. Tactic Bass: *Reduce Overhead* + *Index discipline*.

- **Resultado Esperado**
  > Baseline em `docs/impacto/`: `/permutas/gestao` bytes 1.146*X → 287*X, latência p95 <valor atual> → <valor pós-fix>. Índice parcial deixa de ser tautologia — passa a ser a estratégia de acesso da query.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Linhas de invoice retornadas por `/permutas/gestao` (filial 2): ~1.146 → ~287
  - `EXPLAIN` do `SELECT * FROM permuta_invoice WHERE NOT stale AND NOT pago`: `Seq Scan` (ou index scan tautológico) → `Bitmap Heap Scan` via `idx_permuta_invoice_fil_aberto`
- **Risco de não fazer**: o valor entregue por este PR fica invisível ao stakeholder e o índice parcial cria a impressão errada de que "sempre funcionou".
- **Dependências**: nenhuma (medição avulsa).

### [performance-4] Alinhar `FILIAIS_CONCURRENCY × ADIANTAMENTOS_CONCURRENCY` ao pool real de sessões Conexos

- **Problema**
  > `FILIAIS_CONCURRENCY=5` × `ADIANTAMENTOS_CONCURRENCY=10` = 50 requests concorrentes teóricos (`EleicaoPermutasService.ts:115-116`), mas o pool de sessão do usuário Conexos é ~3 slots (`LOGIN_ERROR_MAX_SESSIONS`). Os 47 workers extras enfileiram na porta do ERP, gerando pressão de fila + logs falsos de "concorrência alta" — sem ganho real, com risco de mais rejeições sob carga.

- **Melhoria Proposta**
  > Extrair o teto como constante única (ex.: `CONEXOS_SESSION_SLOTS=3`) e derivar `FILIAIS_CONCURRENCY × ADIANTAMENTOS_CONCURRENCY ≤ CONEXOS_SESSION_SLOTS × 2` (ligeira sobre-inscrição para amortizar latência de mistura). Alternativamente, plumbar o `ConexosSessionRegistry` como semáforo real que os workers do `BoundedConcurrency` aguardam. Tactic Bass: *Increase Concurrency* (calibrada) + *Schedule Resources*.

- **Resultado Esperado**
  > Workers em fila caem de ~47 → ~3. Logs perdem o ruído de `high pending count`. Métrica: contagem de `LOGIN_ERROR_MAX_SESSIONS` retentados no run (via card `performance-1`): baseline → 0.

- **Tactic alvo**: Increase Concurrency / Schedule Resources
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — depende de plumar o semáforo em `services/conexos.ts` e testes de carga contra HML)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Workers concorrentes em `BoundedConcurrency`: 50 teóricos → 3–6 efetivos
  - `LOGIN_ERROR_MAX_SESSIONS` por run: desconhecido (baseline via card 1) → 0
- **Risco de não fazer**: nada quebra hoje (o teto externo protege), mas os logs enganam e a próxima feature que ampliar o fan-out vai reproduzir o mesmo overhead.
- **Dependências**: card `performance-1` (precisa da instrumentação para medir o ganho).

## 6. Notas do agente

- **Delta em si é excelente sob a ótica performance**: +1 campo (`titMnyTotPago`) no `fieldList` do com308 que **já era chamado** — zero chamadas de rede novas, custo O(n) sobre parcelas por invoice (n ≤ 3), e restaura a utilidade de um índice parcial que estava inútil (F-performance-3). A alternativa que foi descartada (chamar `getDetalheTitulos` por invoice) teria dobrado o fan-out (~3.400 → ~6.800 chamadas/run). Decisão de design correta.
- **Cross-QA**:
  - F-performance-1 e F-performance-4 (pressão sobre sessões Conexos) → **Availability** (o mesmo pool serve Frente III/IV) e **Fault Tolerance** (retry storms se saturar).
  - F-performance-2 (`capHit` silencioso) → **Fault Tolerance** (fail-silent vs. fail-loud) e **Modifiability** (migração para cursor-pagination).
  - F-performance-5 (instrumentação ausente) → **Availability** (observabilidade compartilhada).
- Sem cold-start / bundle / Lambda: o deploy é Render long-running, então toda a taxonomia "cold start / bundle leanness" foi marcada N/A com justificativa (não é uma métrica omitida — é irrelevante ao runtime atual).
- Métricas de wall-time do cron são **estimativas** (o cron ainda não rodou em produção — o bloco no `render.yaml` é NOVO neste delta). Card `performance-1` existe justamente para converter a estimativa em baseline.
