---
qa: Performance
qa_slug: performance
run_id: 2026-09-15-0207-permutas-saldo-ordem-centavos
agent: qa-performance
generated_at: 2026-09-15T02:35:00Z
scope: backend
score: 7.5
findings_count: 6
cards_count: 5
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abre `/permutas/gestao` | 8 queries em `Promise.all` (delta: +1 query nova `carregarConsumosPorAdiantamento` que dispara `listConsumosFinalizados` sem filtro de adto — JOIN 4-way execucao × bordero × adiantamento × eleicao_run) | `GestaoPermutasService.exporGestao` (`src/backend/domain/service/permutas/GestaoPermutasService.ts:83-96`) | Prod (dado do prompt): ~800 adtos, ~200 alocações, ~250 execuções | Servir painel completo com p95 < 1500 ms | ⚠️ **Não medível localmente**: exige `EXPLAIN ANALYZE` em Supabase pooler. Baseline do ciclo anterior (2026-09-08): 7 queries `Promise.all`; delta soma 1. |
| Analista clica "Alocar" (permuta-manual/cross-process) | 1 request POST `/permutas/alocar` → o teto I-Permuta-1 substitui 1 `SELECT SUM` escalar por 2 queries em `Promise.all` (list rows + `listConsumosFinalizados` do adto) — mesma parede de latência, mais 1 round-trip | `AlocacaoPermutasService.alocar` (`src/backend/domain/service/permutas/AlocacaoPermutasService.ts:244-256`) via `SaldoAlocacaoAdiantamentoService.somaNaoConsumidaDoAdiantamento` (`SaldoAlocacaoAdiantamentoService.ts:98-107`) | Prod, 1 adto ↔ poucas alocações (poucas linhas) | Aceitar/rejeitar alocação com p95 < 800 ms | ⚠️ **Não medível localmente**: exige log de tempo no server. Baseline: mesma parede que `sumByAdiantamento` (Promise.all), +1 round-trip por invocação. |
| Job `validate-permutas-saldo-ordem-centavos-v1.ts` (24 awaits) | Bateria de asserções LIVE read-only vs Conexos + Postgres | `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts` (736 linhas) | Rodado manualmente antes do PR; sessão única, sequencial | 247 linhas / 0 DIVERGENTE em ~minutos | Documentado em `_shared-metrics.md` (2026-09-14). Delta: script novo; não bloqueia hot path. |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Queries em `Promise.all` no `exporGestao` | 8 (delta: 7 → 8, `+1` = `carregarConsumosPorAdiantamento`) | ≤ 8 mantidas paralelas | ✅ | `src/backend/domain/service/permutas/GestaoPermutasService.ts:83-96` |
| Cardinalidade do JOIN novo em prod (declarada pelo prompt) | `permuta_alocacao_execucao ≈ 250` × `permuta_bordero ≈ 500-2k` × `permuta_adiantamento ≈ 800` × `permuta_eleicao_run ≈ 250` | Small-set — driving side (execucao filtrado por status IN + dry_run=false) reduz a poucas dezenas | ✅ | prompt + `PermutaExecucaoRepository.listConsumosFinalizados` (`src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211`) |
| Índices que o `listConsumosFinalizados` pode aproveitar | `idx_permuta_alocacao_execucao_status` (status) ✅ · `permuta_bordero_pkey (fil_cod, bor_cod)` ✅ · `permuta_adiantamento.doc_cod PK` ✅ · `permuta_eleicao_run.id PK` ✅ | Todos joins são por PK; filtros de igualdade `b.bor_vld_finalizado=1` + `b.bor_cod_estornado IS NULL` + range `b.atualizado_em < r.started_at` NÃO têm índice (varredura do bordero cache) | ⚠️ | `src/backend/migrations/0015_permuta_alocacao_execucao.sql:38-42`, `0020_permuta_bordero_filial_pk.sql:12`, `0019_permuta_perf_indexes.sql` |
| Índice em `permuta_adiantamento.last_ingest_run_id` (FK usada no novo JOIN) | AUSENTE — só a FK declarada em `0003_permuta_relational.sql:44` | Se PG escolher hash-join a partir do lado `permuta_adiantamento`, a coluna `last_ingest_run_id` fica sem índice; hoje o driving side é `execucao` e resolve a via PK, mas EXPLAIN não foi capturado | ⚠️ | `src/backend/migrations/0003_permuta_relational.sql:44` |
| Queries por `alocar` (backend) | 2 em `Promise.all` (delta: 1 → 2 — `listByAdiantamento` + `listConsumosFinalizados` do adto) | Mesma parede de latência (Promise.all) | ✅ (parede)  ⚠️ (round-trips) | `SaldoAlocacaoAdiantamentoService.ts:98-107`; antes: `AlocacaoPermutasService.ts:244-256` chamava `alocacaoRepository.sumByAdiantamento` (1 scalar) — ver diff `origin/main..HEAD` |
| Agregação por adto: DB → app tier | delta trocou `SELECT COALESCE(SUM(valor_alocado),0)` (1 tupla escalar) por `SELECT ... FROM permuta_alocacao WHERE adiantamento_doc_cod=$1 ORDER BY criado_em` (N tuplas) + soma em memória em `SaldoAlocacaoAdiantamentoService.somaNaoConsumida` | N pequeno por adto (poucas alocações) — payload extra desprezível | ✅ | `PermutaAlocacaoRepository.ts:114-123` (novo `listByAdiantamento`); `SaldoAlocacaoAdiantamentoService.ts:76-83` (soma em app) |
| Frontend `montarHistorico` — complexidade | O(C·A) casamentos + O(M)+O(O)+O(CP)+O(J) pendentes + O(H log H) sort, deduplicado por `adto:borCod` (Map) | Linear no delta; adiciona filtro O(P) sobre `data.pendentes` para `jaPermutados` (`page.tsx:601`) e agrupamento `usadoPorChave` que somava N linhas de auto em uma só (redução) | ✅ | `src/frontend/app/permutas/components/historico.ts:50-121` |
| Freshness guard do cache de borderô (grava `atualizado_em` só quando situação MUDA) | Reduz churn de writes: refresh do "Atualizar" e a ingestão não renovam mais o carimbo à toa | Ganho colateral: MENOS writes no `permuta_bordero` no refresh (ADR-0046 D3) | ✅ | `PermutaExecucaoRepository.ts:574-585` (`replaceBorderoCache`) + `:602-616` (`updateBorderoCacheSituacao`) |
| Chamadas ao Conexos no hot path (delta) | 0 introduzidas — `listConsumosFinalizados` é 100% Postgres | Ø regressão de I/O externo | ✅ | `PermutaExecucaoRepository.ts:188-211` |
| Executor pattern respeitado | Sem novo `setTimeout`/`setInterval` no delta; nada de busy-loop | Compliant | ✅ | `git diff origin/main..HEAD -- src/backend` (nenhum novo timer) |
| Testes verdes ao final (baseline) | 135 suites / 1953 tests · 40 suites / 328 tests frontend · Ground-Truth LIVE 247/0 DIVERGENTE | Mantido | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente** — não há acesso a Supabase para `EXPLAIN (ANALYZE, BUFFERS)` do novo JOIN nem para medir p95 do `GET /permutas/gestao` e `POST /permutas/alocar`. Recomendação: (i) rodar `EXPLAIN ANALYZE` do `listConsumosFinalizados` em staging com dados reais; (ii) log de duração de request no `LogService` do painel para colher p95/p99 por 24h após o merge; (iii) verificar buffer misses e plan (nested-loop vs hash-join) em prod.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — delta é orientado a requisição, sem amostragem de eventos | N/A | — |
| Limit Event Response | `LIMIT 1` em `borderoDoPar`; paginação `PAGE_SIZE` no frontend; `LIMIT $lim` (interno) em `listBorderoCache` | ✅ pré-existente | `PermutaExecucaoRepository.ts:141-155, 505-533` |
| Prioritize Events | N/A no delta (leituras de painel + validação de alocação — não há priorização) | N/A | — |
| Reduce Overhead | Delta: (a) 1 query única (`listConsumosFinalizados` sem `adtoDocCod`) alimenta todos os adtos do painel — evita N+1 clássico; (b) freshness guard corta writes redundantes no cache do bordero; (c) frontend `montarHistorico` dedupa auto com `usadoPorChave` — antes emitia N linhas com mesma `key`. | ✅ | `SaldoAlocacaoAdiantamentoService.ts:84-91`, `PermutaExecucaoRepository.ts:574-585`, `historico.ts:58-75` |
| Bound Execution Times | `BoundedConcurrency` (INVOICES_CONCURRENCY=8) no `buscarInvoices` — pré-existente. Delta NÃO introduz timeout novo no `listConsumosFinalizados` (statement_timeout implícito do pool). | ⚠️ parcial | `AlocacaoPermutasService.ts:18, 130-179`; `PermutaExecucaoRepository.ts:188-211` |
| Increase Resource Efficiency | `Promise.all` de 8 repositórios no `exporGestao`; `Promise.all` de 2 repositórios no `somaNaoConsumidaDoAdiantamento` (paralelismo). Contra-exemplo: `listAtivas()` full-scan em `autoAlocarSeElegivel`/`autoAlocarDeCasamento` — **pré-existente, fora do delta**. | ⚠️ parcial | `GestaoPermutasService.ts:83-96`, `SaldoAlocacaoAdiantamentoService.ts:98-107` |
| Increase Resources | Pool `max=5` (pré-existente); nenhum ajuste no delta | ✅ pré-existente | `PostgreeDatabaseClient.ts` (fora do delta) |
| Increase Concurrency | Duas web instances Render (pré-existente); delta não altera | N/A no delta | — |
| Maintain Multiple Copies of Computations | Cache do borderô (`permuta_bordero`) é uma cópia derivada do ERP — delta refina o carimbo `atualizado_em` para servir de âncora de frescor da regra ADR-0046 D3 | ✅ | `PermutaExecucaoRepository.ts:548-585` |
| Maintain Multiple Copies of Data | `SaldoAlocacaoAdiantamentoService` é fonte única (backend); o frontend calcula `saldoRestante` local no card (`page.tsx:557-564`) mas o SERVIDOR devolve `saldoRestante` já calculado — sem divergência UI×API | ✅ | `GestaoPermutasService.ts:317-323` |
| Bound Queue Sizes | N/A — sem filas neste runtime | N/A | — |
| Schedule Resources | N/A no delta — não altera scheduling | N/A | — |
| Cold start budget | N/A — Express contêiner longo em Render, não Lambda | N/A | prompt |
| Cache strategy | Cache do bordero (Postgres-side) refinado no delta; `EnvironmentProvider` cacheia env vars (pré-existente) | ✅ | ver acima |
| Index discipline | Delta NÃO adiciona índice para o novo JOIN. `permuta_bordero.bor_vld_finalizado` e `bor_cod_estornado` sem índice; `permuta_adiantamento.last_ingest_run_id` sem índice (FK só). Impacto atual pequeno (cardinalidades prod), mas cresce linearmente com trilha de execuções e bordero cache. | ⚠️ parcial | `src/backend/migrations/0003_permuta_relational.sql:44`, `0018_permuta_bordero_cache.sql`, `0019_permuta_perf_indexes.sql` |
| Bundle leanness | N/A — não há bundle no runtime Express; frontend delta é 1 função (~121 LOC) extraída — code-split preservado (dynamic imports pré-existentes) | ✅ | `page.tsx:79-95` |

## 4. Findings (achados)

### F-performance-1: `listConsumosFinalizados` usa JOIN 4-way sem índice de suporte para os predicados do `permuta_bordero`

- **Severidade**: P2
- **Tactic violada**: Index discipline / Reduce Overhead
- **Localização**: `src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts:188-211`
- **Evidência (objetiva)**:
  ```
  SELECT e.adiantamento_doc_cod, e.invoice_doc_cod, e.status, e.valor_residual_usd, e.criado_em
    FROM permuta_alocacao_execucao e
    JOIN permuta_bordero b ON b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod        -- PK (fil_cod,bor_cod) ✅
    JOIN permuta_adiantamento a ON a.doc_cod = e.adiantamento_doc_cod                -- doc_cod PK ✅
    JOIN permuta_eleicao_run r ON r.id = a.last_ingest_run_id                        -- r.id PK ✅ ; a.last_ingest_run_id SEM ÍNDICE
   WHERE e.dry_run = false AND e.status IN ('settled','parcial')                     -- idx_...status ✅ (mas sem dry_run)
     AND b.bor_vld_finalizado = 1 AND b.bor_cod_estornado IS NULL                    -- SEM ÍNDICE (filtro do cache)
     AND b.atualizado_em < r.started_at                                              -- SEM ÍNDICE (range cross-tabela)
     AND ($adtoDocCod::text IS NULL OR e.adiantamento_doc_cod = $adtoDocCod)         -- idx_...adto (parcial)
  ```
  Cardinalidades declaradas em prompt (2026-09-15): `permuta_alocacao_execucao ≈ 250`, `permuta_adiantamento ≈ 800`, `permuta_eleicao_run ≈ 250`.
- **Impacto técnico**: hoje o driving side é `permuta_alocacao_execucao` filtrado por `status IN (...)` (dezenas de linhas), então os PK-joins nas outras 3 tabelas ficam baratos. Se o volume de execuções crescer 10× (2.500 linhas de trilha, plausível em 6-12 meses de operação), o custo escala linearmente e passa a valer a pena índice parcial `(dry_run, status)` ou `(status) WHERE dry_run = false`. O predicado `b.atualizado_em < r.started_at` é o único cross-tabela sem apoio.
- **Impacto de negócio**: baixo agora; o `/permutas/gestao` chama esta query uma vez por render, e cada segundo extra pesa na percepção do analista (esperando o painel). Sem EXPLAIN ANALYZE em Supabase, o custo real é desconhecido.
- **Métrica de baseline**: 4-way JOIN + 3 filtros de igualdade + 1 range, sobre ≈250 exec × ≈500-2k bordero × 800 adto × 250 run em prod. Índices que apoiam: 4 PK joins + `idx_...status`. Índices ausentes: `permuta_adiantamento.last_ingest_run_id`, `permuta_bordero.bor_vld_finalizado` (parcial), `permuta_bordero.atualizado_em`.

### F-performance-2: `alocar` passa a fazer 2 queries no teto de I-Permuta-1 (era 1 escalar) — mesma parede de latência, +1 round-trip

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/permutas/AlocacaoPermutasService.ts:244-256` → `src/backend/domain/service/permutas/SaldoAlocacaoAdiantamentoService.ts:98-107`
- **Evidência (objetiva)**:
  ```
  # ANTES (main): AlocacaoPermutasService.alocar
  const jaAdto = await this.alocacaoRepository.sumByAdiantamento(adiantamentoDocCod, invoiceDocCod);
  # 1 SELECT COALESCE(SUM(valor_alocado),0) — 1 tupla, 1 round-trip.

  # DEPOIS (delta): via SaldoAlocacaoAdiantamentoService
  const jaAdto = await this.saldoAlocacaoService.somaNaoConsumidaDoAdiantamento(adto, invoice);
  # que faz:
  const [alocacoes, consumos] = await Promise.all([
      this.alocacaoRepository.listByAdiantamento(adiantamentoDocCod),          // SELECT rows
      this.execucaoRepository.listConsumosFinalizados(adiantamentoDocCod),     // JOIN 4-way filtrado
  ]);
  ```
- **Impacto técnico**: `Promise.all` mantém a parede de latência (max das 2 queries) ~igual à parede da query única anterior, mas custa +1 conexão no pool durante o span. Pool `max=5` × 2 instâncias — margem confortável em prod atual. Como benefício, a soma agora respeita ADR-0046 D3 (só desconta o não-consumido), o que é a razão de existir do delta — sem isso o teto reprovava alocações válidas (adto 12860, 9328 no interview).
- **Impacto de negócio**: correção de bug de negócio (super/sub-alocação bloqueada), zero regressão perceptível de latência.
- **Métrica de baseline**: 1 → 2 queries por `alocar`; parede constante (Promise.all); pool usage +1 conexão por request no span das queries.

### F-performance-3: `PermutaAlocacaoRepository.listByAdiantamento` retorna N linhas onde antes havia soma escalar — soma migrou para o app tier

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead / Increase Resource Efficiency
- **Localização**: `src/backend/domain/repository/permutas/PermutaAlocacaoRepository.ts:114-123` (novo); `SaldoAlocacaoAdiantamentoService.ts:76-83` (soma em memória)
- **Evidência (objetiva)**:
  ```
  # DIFF (origin/main..HEAD): sumByAdiantamento REMOVIDO; listByAdiantamento ADICIONADO.
  # Antes: 1 tupla (COALESCE(SUM(valor_alocado),0)) — payload trivial.
  # Depois: N tuplas com 15 colunas cada (adto, invoice, valorAlocado, moeda, variação, taxas,
  #         dataBase, criadoPor/Em, atualizadoEm, observacao). Soma feita em SaldoAlocacaoAdiantamentoService.
  ```
- **Impacto técnico**: cardinalidade prod: poucas alocações por adto (a interview cita 35-49 mil de valor em 1 alocação, não múltiplas linhas). Payload extra por request é desprezível (dezenas de bytes → poucos KB). A justificativa é correta: `SaldoAlocacaoAdiantamentoService` PRECISA da coluna `atualizadoEm` de cada alocação para casar versão com consumo (ADR-0046 D3, "regra por versão"). Não dá para calcular a soma no DB sem duplicar essa lógica em SQL — a agregação em app-tier é o preço da regra por-versão.
- **Impacto de negócio**: nenhum agora; observar se `permuta_alocacao` acumular >100 linhas por adto (cenário improvável).
- **Métrica de baseline**: 1 tupla escalar → N tuplas com 15 colunas (N=poucas por adto em prod).

### F-performance-4: `exporGestao` passa de 7 para 8 queries em `Promise.all` — carrega `listConsumosFinalizados` sem filtro para todos os ~800 adtos

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead / Increase Resource Efficiency
- **Localização**: `src/backend/domain/service/permutas/GestaoPermutasService.ts:83-96`
- **Evidência (objetiva)**:
  ```
  const [
      adiantamentos, invoices, casamentos, processamentos, declaracoes, alocacoes,
      ultimaIngestao,
      consumosByAdto,          // +1 no delta
  ] = await Promise.all([...]);
  # A 8ª chamada é: this.saldoAlocacaoService.carregarConsumosPorAdiantamento()
  #   -> this.execucaoRepository.listConsumosFinalizados()  // adto=undefined => devolve TODOS
  ```
- **Impacto técnico**: uma query única para o painel inteiro é a decisão CERTA (evita N+1 clássico — 800 adtos × 1 query cada = 800 queries seria o antipadrão). O custo hoje é a do JOIN descrito em F-performance-1. Parede de latência do painel: `max(8 queries)` — enquanto uma delas domina, +1 query não altera a parede.
- **Impacto de negócio**: nulo se a nova query não for a mais lenta; risco se ela vier a ser (F-performance-1).
- **Métrica de baseline**: 7 → 8 queries em `Promise.all`; a nova é a única do lote que envolve JOIN 4-way.

### F-performance-5: Sem índice em `permuta_adiantamento.last_ingest_run_id` — FK usada no novo JOIN

- **Severidade**: P3
- **Tactic violada**: Index discipline
- **Localização**: `src/backend/migrations/0003_permuta_relational.sql:44` (FK declarada, sem índice) + JOIN em `PermutaExecucaoRepository.ts:197`
- **Evidência (objetiva)**:
  ```
  last_ingest_run_id  UUID REFERENCES permuta_eleicao_run (id) ON DELETE SET NULL,
  # Nenhum CREATE INDEX cobre esta coluna em nenhum arquivo de migração.
  ```
- **Impacto técnico**: no JOIN `a.last_ingest_run_id = r.id`, o lado `r.id` é PK (indexado). Se o planner escolher nested-loop iniciando por `a`, precisa varrer `a` (~800 rows) para cada `r`. Como o driving side vem de `e` (execucao filtrada), este risco é baixo hoje. Se PG mudar plano (hash-join), o custo cai naturalmente. `EXPLAIN ANALYZE` esclareceria — não capturado.
- **Impacto de negócio**: baixo; puramente defensivo. Índice em FK é boa prática geral (não só para este JOIN — também para `ON DELETE SET NULL` limpar orfãos).
- **Métrica de baseline**: 800 adtos sem índice na FK; plano exato em prod não medido.

### F-performance-6: Delta não instrumentou log de duração do `GET /permutas/gestao` nem do novo JOIN — regressão silenciosa possível

- **Severidade**: P3
- **Tactic violada**: (meta-tactic) observabilidade de perf para validar as decisões acima
- **Localização**: `GestaoPermutasService.ts:190-198` (log só de `pendentes.length`, `invoicesEmAberto.length`, `casamentos.length` — nada de tempo); `PermutaExecucaoRepository.ts:188-211` (query sem trace de latência)
- **Evidência (objetiva)**:
  ```
  await this.logService.info({
      type: LOG_TYPE.BUSINESS_INFO,
      message: 'permuta gestao served',
      data: { requestId, pendentes: ..., invoicesEmAberto: ..., casamentos: ... },
  });
  # NÃO grava start/end/durationMs.
  ```
- **Impacto técnico**: o post-merge não terá dado numérico para dizer se a query nova é O(1) ou O(N²) em prod — só perceberá se um analista reclamar. As findings 1-5 são inspeções estáticas; a validação delas exige trace.
- **Impacto de negócio**: sem instrumento, uma regressão só é vista pelo humano na tela. Baixo custo de adicionar.
- **Métrica de baseline**: 0 métricas de tempo no log do `exporGestao`.

## 5. Cards Kanban

### [performance-1] Medir p95 do `GET /permutas/gestao` e EXPLAIN ANALYZE do `listConsumosFinalizados` antes de decidir índices

- **Problema**
  > O delta acrescenta 1 query nova ao `Promise.all` do painel — um JOIN 4-way com 3 filtros de igualdade sem índice de suporte no `permuta_bordero` e 1 range cross-tabela (`b.atualizado_em < r.started_at`). Cardinalidades declaradas em prod (250/500-2k/800/250) sugerem custo baixo hoje, mas nenhum `EXPLAIN ANALYZE` foi capturado. Sem número, qualquer decisão de indexação vira palpite.

- **Melhoria Proposta**
  > Rodar `EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM permuta_alocacao_execucao e JOIN ... WHERE ...` em staging/pooler com dados atuais. Logar `durationMs` no `logService.info('permuta gestao served', ...)`. Bass tactics: **Reduce Overhead** + medir antes de otimizar. Depois de 24h de dados, decidir se cria `(1)` índice parcial `permuta_alocacao_execucao (adiantamento_doc_cod) WHERE dry_run = false AND status IN ('settled','parcial')` e/ou `(2)` índice `permuta_bordero (bor_vld_finalizado, bor_cod_estornado)` — só se o plano mostrar seqscan dominante.

- **Resultado Esperado**
  > (a) Log de p50/p95/p99 de `/permutas/gestao` disponível no LogService. (b) EXPLAIN ANALYZE do JOIN documentado num ADR/inbox. (c) Índices criados APENAS se justificados por número — ou decisão explícita de não criar registrada.

- **Tactic alvo**: Reduce Overhead / Index discipline
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1, F-performance-4, F-performance-6
- **Métricas de sucesso**:
  - Duração média `listConsumosFinalizados()` (adto=NULL): desconhecida → medida em ms
  - p95 `/permutas/gestao`: desconhecida → medida; alvo < 1500 ms
  - EXPLAIN ANALYZE colado em ADR: ausente → presente
- **Risco de não fazer**: a próxima duplicação do volume de execução (rotina de 6-12 meses) vira degradação silenciosa; só descoberta pela queixa do analista.
- **Dependências**: acesso a staging/PRD para EXPLAIN.

### [performance-2] Adicionar índice em `permuta_adiantamento.last_ingest_run_id` (FK sem índice)

- **Problema**
  > `permuta_adiantamento.last_ingest_run_id UUID REFERENCES permuta_eleicao_run(id) ON DELETE SET NULL` é usada em (i) o novo JOIN de `listConsumosFinalizados` e (ii) a semântica `ON DELETE SET NULL` (que hoje precisa varrer `permuta_adiantamento` a cada delete de run). Sem índice, o Postgres pode escolher planos ruins conforme o volume crescer.

- **Melhoria Proposta**
  > `CREATE INDEX IF NOT EXISTS idx_permuta_adiantamento_last_ingest_run ON permuta_adiantamento (last_ingest_run_id) WHERE last_ingest_run_id IS NOT NULL;` numa migração dedicada — pequena, idempotente, sem downtime. Bass tactic **Index discipline**.

- **Resultado Esperado**
  > FK indexada; JOIN do `listConsumosFinalizados` estável mesmo se PG mudar de nested-loop para hash-join no futuro; `ON DELETE SET NULL` de run passa a usar index-scan.

- **Tactic alvo**: Index discipline
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — 1 arquivo `NNNN_idx_permuta_adiantamento_last_ingest.sql`
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - `pg_indexes WHERE tablename='permuta_adiantamento' AND indexdef LIKE '%last_ingest_run_id%'`: 0 → 1
  - Plan do `listConsumosFinalizados` continua estável quando volume dobrar (medir com EXPLAIN)
- **Risco de não fazer**: baixo hoje; cresce com o volume.
- **Dependências**: performance-1 (medir antes ajuda a evidenciar necessidade).

### [performance-3] Instrumentar `durationMs` no log do `exporGestao` e no `listConsumosFinalizados`

- **Problema**
  > O log atual do painel só emite `pendentes.length`, `invoicesEmAberto.length`, `casamentos.length` — não emite tempo. As findings 1/4/5 são inspeção estática; sem `durationMs` no LogService, uma regressão só será notada por queixa do analista.

- **Melhoria Proposta**
  > No `exporGestao`, wrap do `Promise.all` com `const t0 = performance.now(); ...; const durationMs = performance.now() - t0;` e adicionar ao `data` do `logService.info`. Idem para o repositório em queries "quentes" do delta (`listConsumosFinalizados`). Alternativa mais rica: middleware Express de duração por rota — se ainda não existir. Bass tactic **Increase Resource Efficiency** via observabilidade.

- **Resultado Esperado**
  > Log de cada request `permuta gestao served` inclui `durationMs`, `querysDurationsMs` (opcional por query) — permitindo dashboards de p50/p95/p99 no Render logs ou destino de logs downstream.

- **Tactic alvo**: Increase Resource Efficiency (via medição)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-6
- **Métricas de sucesso**:
  - Campo `durationMs` presente em 100% dos logs `permuta gestao served`: 0% → 100%
  - Painel/consulta de p95 disponível: ausente → presente
- **Risco de não fazer**: regressões silenciosas de performance no delta seguinte ficam invisíveis.
- **Dependências**: nenhuma.

### [performance-4] Documentar limites de crescimento previstos de `permuta_alocacao_execucao` (trilha)

- **Problema**
  > O custo do novo JOIN escala linearmente com a cardinalidade de `permuta_alocacao_execucao` filtrada por `status IN ('settled','parcial') AND dry_run=false`. Hoje: ~250 linhas. Sem política de retenção nem estimativa de crescimento documentada, não há gatilho claro para agir (ex.: "quando passar de 10k, criar índice parcial").

- **Melhoria Proposta**
  > Adicionar seção em `ontology/business-rules/idempotencia-reconciliacao.md` (ou num inbox `_inbox/permuta-execucao-perf.md`) com: (a) taxa média de novos `settled`/`parcial` por semana observada em prod; (b) gatilho para revisitar (ex.: 5.000 linhas terminais); (c) opções de mitigação (índice parcial, particionamento por ano). Bass tactic **Bound Queue Sizes** (trilha como fila histórica).

- **Resultado Esperado**
  > Time sabe QUANDO agir sem depender de perceber degradação. `regis-review` futuros comparam contra o gatilho.

- **Tactic alvo**: Bound Queue Sizes
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Documento de gatilho de retenção/particionamento: ausente → presente
  - Métrica "linhas terminais em `permuta_alocacao_execucao`" incluída no `retro-ontology` semanal: ausente → presente
- **Risco de não fazer**: quando o número cruzar um limiar, ninguém percebe até virar dor.
- **Dependências**: performance-1 (medição informa o gatilho).

### [performance-5] Consolidar `listAdiantamentosAtivos()`/`listAtivas()` full-scans dos auto-alocadores (não-delta; opcional)

- **Problema**
  > `AlocacaoPermutasService.autoAlocarSeElegivel` (`AlocacaoPermutasService.ts:305-345`) e `autoAlocarDeCasamento` (`:381-406`) chamam `listAtivas()` (SELECT * `permuta_alocacao`) apenas para checar "há alguma alocação deste adto?" — e `listAdiantamentosAtivos()` para filtrar por `priCod`. **Pré-existente**, não introduzido por este delta, mas o delta amplia o uso da regra "por-versão" que passa por estes caminhos.

- **Melhoria Proposta**
  > Substituir por `existsByAdiantamento(docCod)` (SELECT 1 ... WHERE ... LIMIT 1) e `countByProcessoEEstado(priCod, estado)` — queries dedicadas. Bass tactic **Limit Event Response**. Fora do escopo estrito do delta; recomendação para o inbox `permutas-saldo-ordem-centavos-regis-followups.md`.

- **Resultado Esperado**
  > Auto-alocação decide com O(1) round-trip por check em vez de puxar toda a tabela.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: (contextual — não é finding do delta; nota do agente)
- **Métricas de sucesso**:
  - Tamanho médio de resultset de `listAtivas()` chamado por `autoAlocar*`: N linhas → 1 linha ou contagem
- **Risco de não fazer**: quando `permuta_alocacao` crescer, cada `Baixar` do auto puxa a tabela inteira; hoje é pequena.
- **Dependências**: nenhuma; **card opcional**, sinaliza dívida.

> **F-performance-2 e F-performance-3 sem card dedicado**: são consequências desejadas do fix (Promise.all + soma em app tier são o preço da "regra por-versão" — não são débitos, apenas escolhas de arquitetura que constam no ADR-0046). Documentados como findings para transparência.

## 6. Notas do agente

- **Escopo delta-only** conforme prompt: não re-levantei P0/P1 do ciclo anterior (2026-09-08) — o painel de perf herdado (`_shared-metrics.md`, F-performance-1/2/3/4/5/6 do anterior sobre migration 0054 e retenção do snapshot) segue válido, sem regressão neste delta.
- **Cross-QA**: F-performance-1 e F-performance-2 tocam Modifiability (schema-as-code, índices como parte da migração) — sinalizar ao consolidator. F-performance-6 (log de duração) tem sobreposição com Testability/observabilidade (Bass também trata como QA "monitoring").
- **Métricas que tentei coletar e falharam**: (a) `EXPLAIN ANALYZE` do novo JOIN em Supabase — sem credenciais, proibido pelo prompt; (b) p95 de `/permutas/gestao` em prod — não instrumentado. Ambos viram os cards `performance-1` e `performance-3`.
- **Cardinalidades declaradas no prompt** (~800 adtos, ~200 alocações, ~250 execuções) usadas como referência — não medidas por este agente.
- **Ground-truth LIVE (247/0 DIVERGENTE)** já validou a correção funcional; não substitui medida de latência mas descarta correção computacional errada em prod.
