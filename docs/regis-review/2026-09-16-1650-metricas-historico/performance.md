---
qa: Performance
qa_slug: performance
run_id: 2026-09-16-1650-metricas-historico
agent: qa-performance
generated_at: 2026-09-18T00:00:00Z
scope: backend
score: 6
findings_count: 2
cards_count: 2
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro abrindo a tela `/metricas` (ou, no futuro, alguém que subir o piso `historico_inicio()` a cada revisão) | `GET /metricas/ciclo?historico=true` síncrono a cada carregamento de página, sobre um piso FIXO (`2026-08-07 18:00`) que nunca avança — o nº de janelas (`generate_series`) cresce +1 a cada sexta, para sempre | `metricas.metricas_ciclo()` (função SQL, migrations 0058/0060) via `MetricasCicloRepository.listar`, sobre `permuta_alocacao_execucao` e `solicitacao_numerario_execucao` | Produção, Postgres único (Supabase), pool `max=5` (`PostgreeDatabaseClient`), sem cache HTTP/servidor, sem paginação na rota | A latência da rota deve permanecer estável conforme o tempo passa desde o piso fixo (mais janelas) e conforme os dois ledgers crescem (mais linhas) | Medido localmente (Postgres 17, docker, EXPLAIN ANALYZE — ver seção 4): 19,6 ms → 333,9 ms (17×) só variando janelas de 6 para 111 com o ledger fixo em 5.000 linhas por tabela; plano confirma re-varredura do ledger inteiro por janela (`Materialize ... loops=111`, `Rows Removed by Join Filter = 555.000 = 5.000×111`). Hoje, na escala real (~200 linhas, 6 janelas), o custo é invisível: 5,5 ms |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Índice utilizável para o filtro por janela em `permuta_alocacao_execucao.criado_em` | Ausente (índices existentes: `adiantamento_doc_cod`, `status`, `bor_cod` parcial — nenhum em `criado_em`, nem expressão sobre `AT TIME ZONE`) | Índice de expressão em `(criado_em AT TIME ZONE 'America/Sao_Paulo')` ou bucketing que dispense range-join por janela | ❌ | `grep -n "CREATE INDEX" src/backend/migrations/0015_permuta_alocacao_execucao.sql src/backend/migrations/0019_permuta_perf_indexes.sql` |
| Índice utilizável para o filtro por janela em `solicitacao_numerario_execucao.criado_em` | Ausente (índices existentes: `pri_cod`, `status`, `txn_id`, parcial `(fil_cod, nd_doc_cod)` — nenhum em `criado_em`) | idem acima | ❌ | `src/backend/migrations/0041_solicitacao_numerario_execucao.sql`, `0042`, `0048` |
| Índice em `permuta_bordero (fil_cod, bor_cod)` para o `EXISTS` correlacionado | Presente — é a própria PK | Presente | ✅ | `src/backend/migrations/0020_permuta_bordero_filial_pk.sql` |
| Custo medido do plano (N=5.000 linhas/tabela fixo, variando só nº de janelas W) | W=6 → 19,6 ms · W=111 → 333,9 ms (17×, quase linear em W) | Crescimento independente de W (ideal: O(N) único, varredura amortizada) | ❌ | `EXPLAIN (ANALYZE, BUFFERS)` local, Postgres 17 via docker — ver seção 4 |
| "Rows Removed by Join Filter" (evidência direta de re-scan por janela) | 30.000 em W=6 (5.000×6) · 555.000 em W=111 (5.000×111) — bate exatamente com N×W | 0 (join deveria ser por equality/bucket, não filtro pós-`Materialize`) | ❌ | mesmo `EXPLAIN`, plano `Nested Loop Left Join` |
| Latência hoje, escala real do ledger (~200 linhas, conforme comentário da 0058: "em 2026-09-14, 177 settled") | 5,5 ms (W=6) | — | ✅ (hoje; mascarado) | `EXPLAIN` local com N=200 sintético |
| Crescimento do nº de janelas (W) | +1/semana, piso fixo, sem teto — a própria 0060 documenta "em dezembro a tela mostrará ~18 semanas, não 6" | Teto explícito (paginação, arquivamento ou piso deslizante) | ❌ | `src/backend/migrations/0060_metricas_historico_inicio.sql` (comentário) + `generate_series` |
| Paginação em `GET /metricas/ciclo` | Nenhuma — `MetricasCicloRepository.listar` não tem `LIMIT`/cursor; retorna todas as janelas de uma vez | Aceitável hoje (poucas janelas), mas sem teto para quando W crescer | ⚠️ | `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:59-75` |
| Cache (HTTP ou servidor) em `GET /metricas/ciclo` | Nenhum — sem `Cache-Control`, sem cache em memória; cada request recalcula do zero | Cache curto (ex. 60-300s), já que o dado só muda por execução de lote, não por leitura | ⚠️ | `src/backend/routes/metricas.ts` |
| `statement_timeout` / timeout explícito na query | Não observado no delta (`PostgreeDatabaseClient.connectionTimeoutMillis=5000` é timeout de CONEXÃO, não de execução) | `statement_timeout` ou timeout de query explícito | ⚠️ **Não medível no escopo do delta** — client é código pré-existente, fora dos 7 arquivos de produção tocados; citado aqui só como contexto do artefato que a query atravessa | `src/backend/domain/client/database/PostgreeDatabaseClient.ts` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — a rota lê estado já persistido pelo ledger local, não amostra eventos em tempo real | N/A | — |
| Limit Event Response | N/A — não é handler de evento (SQS/EventBridge); é leitura HTTP síncrona sob demanda | N/A | — |
| Prioritize Events | N/A — não há fila nem múltiplos tipos de evento concorrendo neste caminho | N/A | — |
| Reduce Overhead | Parcial: a função evita bater no Conexos a cada leitura ("Não toca o Conexos", comentário 0058) — bom. Mas reintroduz overhead ao re-varrer o ledger inteiro por janela em vez de varrê-lo uma vez | ⚠️ parcial | `0058_vw_metricas_ciclo.sql` (comentário "Não toca o Conexos"); plano `EXPLAIN` (seção 2/4) |
| Bound Execution Times | Ausente — sem `LIMIT` no nº de janelas devolvidas, sem timeout de execução explícito na query, sem teto no piso (`historico_inicio()` fixo, cresce sem parar) | ❌ ausente | `MetricasCicloRepository.ts:59-75`; `0060_metricas_historico_inicio.sql` |
| Increase Resource Efficiency | Ausente — plano confirmado O(N×W): nenhum índice funcional em `criado_em`, join por range força `Nested Loop` com `Materialize` relido uma vez por janela | ❌ ausente | `EXPLAIN` local (seção 4); migrations 0015/0019/0041/0042/0048 (sem índice em `criado_em`) |
| Increase Resources | N/A neste delta — não altera dimensionamento de infra (não há `infra/` no repo; deploy é Render) | N/A | — |
| Increase Concurrency | N/A neste delta — leitura single-query, não há paralelização a introduzir no escopo tocado | N/A | — |
| Maintain Multiple Copies of Computations | Ausente — `vw_metricas_ciclo` é view comum (não materializada), e a rota não cacheia a leitura; toda chamada recalcula do zero | ❌ ausente | `0058_vw_metricas_ciclo.sql` (`CREATE OR REPLACE VIEW`, não `MATERIALIZED VIEW`); `routes/metricas.ts` sem cache |
| Maintain Multiple Copies of Data | N/A — não é padrão de réplica de leitura; Postgres único (Supabase), fora do escopo do delta | N/A | — |
| Bound Queue Sizes | N/A — não há fila neste caminho (API Gateway/Express síncrono, sem SQS envolvido) | N/A | — |
| Schedule Resources | N/A — nenhum job/EventBridge tocado pelo delta (o piso é lido sob demanda, não por cron) | N/A | — |

## 4. Findings (achados)

### F-performance-1: `metricas_ciclo()` re-varre o ledger inteiro por janela — custo O(janelas × linhas), medido, sem teto de crescimento

- **Severidade**: P1 (alto — degrada QA mensurável; ainda não é incidente ativo hoje, mas o crescimento é matematicamente garantido, não contingente)
- **Tactic violada**: Increase Resource Efficiency / Bound Execution Times
- **Localização**:
  - `src/backend/migrations/0058_vw_metricas_ciclo.sql` (CTEs `permutas` e `recebimentos`, ambas com `LEFT JOIN` por range de data contra `janelas`)
  - `src/backend/migrations/0060_metricas_historico_inicio.sql` (piso `2026-08-07 18:00:00` FIXO, sem teto — o próprio comentário admite "em dezembro a tela mostrará ~18 semanas, não 6")
  - `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:59-75` (chamada sem `LIMIT`, repassa o crescimento sem filtro)
- **Evidência (objetiva)** — medida com Postgres 17 real (docker), aplicando as migrations 0001-0060 e semeando 5.000 linhas sintéticas em cada um dos dois ledgers (ver metodologia na seção 6):
  ```
  -- W=6 janelas (piso 2026-08-07 → agora=2026-09-18), N=5.000 linhas/tabela
  Nested Loop Left Join (actual time=2.908..9.759 rows=6 loops=1)
    Rows Removed by Join Filter: 30000   -- = 5.000 × 6
    ->  Materialize (actual time=0.002..0.384 rows=5000 loops=6)
          ->  Seq Scan on permuta_alocacao_execucao x (rows=5000 loops=1)
                Filter: (NOT dry_run)
  Execution Time: 19.868 ms

  -- W=111 janelas (piso 2026-08-07 → agora=2028-09-18, MESMO N=5.000), sem tocar em nada além do "agora"
  Nested Loop Left Join (actual time=2.788..167.392 rows=111 loops=1)
    Rows Removed by Join Filter: 555000  -- = 5.000 × 111
    ->  Materialize (actual time=0.000..0.176 rows=5000 loops=111)
          ->  Seq Scan on permuta_alocacao_execucao x (rows=5000 loops=1)
                Filter: (NOT dry_run)
  Execution Time: 333.929 ms  -- 17× mais lento para 18,5× mais janelas, MESMO dado
  ```
  Isolando as duas variáveis: com ledger VAZIO, W=6 → 260 janelas custam 1-4 ms (overhead de janela é desprezível). O custo inteiro vem da re-varredura: `Materialize` executa o `Seq Scan` no ledger UMA vez (`loops=1`), mas o `Nested Loop` externo relê o resultado materializado (e aplica o filtro de range) uma vez POR JANELA (`loops=W`) — não há índice funcional em `criado_em` (nem em `permuta_alocacao_execucao`, nem em `solicitacao_numerario_execucao`; confirmado por `grep` nas migrations 0015/0019/0041/0042/0048) que permita ao planner trocar isso por um range-scan indexado por janela.
- **Impacto técnico**: o custo é O(linhas_ledger × nº_janelas). `nº_janelas` cresce +1/semana PARA SEMPRE a partir de um piso fixo que a própria migration 0060 admite que "envelhece" — sem nenhuma migration futura, a query dobra de tamanho a cada ~ano (6 janelas hoje → ~58 em 1 ano → ~110 em 2 anos, mesma progressão usada nos casos medidos acima). `linhas_ledger` também cresce independentemente, com cada permuta/SN executada. As duas dimensões multiplicam.
- **Impacto de negócio**: `/metricas` é uma tela síncrona — o analista espera o `fetch` completar (sem loading incremental, `src/frontend/app/metricas/page.tsx`). Hoje, na escala real do ledger (~200 linhas somando os dois, conforme comentário da 0058: "em 2026-09-14, 177 settled"), o custo é invisível (5,5 ms medido) — o que explica por que isso não apareceu em nenhum teste ou review anterior. Extrapolando a lei de crescimento medida (custo ∝ N×janelas, e ambos N e janelas crescem ~linearmente com o tempo decorrido desde o piso fixo ⇒ custo cresce aproximadamente com o QUADRADO do tempo decorrido), a rota passa de dezenas de ms hoje para a ordem de centenas de ms dentro de ~1 ano e pode ultrapassar 1s dentro de ~2 anos — sem que nenhum código novo seja escrito, só pelo piso fixo não avançar e o ledger continuar crescendo.
- **Métrica de baseline**: 19,6 ms (N=5.000, W=6) → 333,9 ms (N=5.000, W=111), medido via `EXPLAIN (ANALYZE, BUFFERS)` em Postgres 17 real. Hoje (N≈200, W=6): 5,5 ms.

### F-performance-2: `GET /metricas/ciclo` sem cache e sem teto de paginação — cada carregamento paga o custo total do zero, e amplifica sob concorrência

- **Severidade**: P2 (débito técnico defensável — amplificador de F-performance-1, não um problema autônomo de mesma gravidade)
- **Tactic violada**: Maintain Multiple Copies of Computations / Bound Execution Times
- **Localização**: `src/backend/routes/metricas.ts` (sem `Cache-Control`, sem cache em memória); `src/backend/domain/repository/metricas/MetricasCicloRepository.ts:59-75` (`SELECT ... FROM metricas.metricas_ciclo(...)` sem `LIMIT`)
- **Evidência (objetiva)**:
  ```typescript
  // routes/metricas.ts — nenhum cabeçalho de cache, nenhuma camada de cache antes de bootstrapAppContainer()
  router.get('/ciclo', asyncHandler(async (req, res) => {
      ...
      await bootstrapAppContainer();
      const leitura = await container.resolve(MetricasCicloService).ler({ ...janela, ... });
      res.json(leitura);
  }));
  ```
  ```sql
  -- MetricasCicloRepository.listar — sem LIMIT, todas as janelas voltam de uma vez
  SELECT ... FROM metricas.metricas_ciclo(${piso}, now() AT TIME ZONE 'America/Sao_Paulo')
   WHERE (...) ORDER BY janela_inicio DESC, frente, metrica
  ```
- **Impacto técnico**: amplifica F-performance-1 — N analistas abrindo `/metricas` na mesma janela de tempo (ex. segunda de manhã) disparam N execuções completas e idênticas da varredura O(linhas×janelas); nenhuma reaproveita o resultado da anterior. O pool de conexões (`PostgreeDatabaseClient`, `max=5`, fora do escopo do delta mas relevante como teto de concorrência) satura antes que o índice ausente vire o gargalo dominante.
- **Impacto de negócio**: sob uso concorrente normal (não é caso extremo — é "vários analistas abrem a tela ao mesmo tempo"), a fila de conexão do pool cresce mais rápido do que se a leitura fosse cacheada, o que soma latência de espera de conexão POR CIMA da latência de query já degradada por F-performance-1.
- **Métrica de baseline**: 0% das leituras cacheadas (confirmado por leitura de código — sem `Cache-Control`, sem cache em memória, sem `LIMIT`/cursor na query).

## 5. Cards Kanban

### [performance-1] Eliminar a re-varredura do ledger por janela em `metricas_ciclo()`

- **Problema**
  > Medido com `EXPLAIN ANALYZE` em Postgres 17 real: a query de `metricas.metricas_ciclo()` custa O(linhas_ledger × nº_janelas), não O(linhas_ledger). Com ledger fixo em 5.000 linhas/tabela, passar de 6 para 111 janelas multiplicou o tempo de execução por 17× (19,6 ms → 333,9 ms), confirmado pelo plano (`Nested Loop Left Join` com `Materialize ... loops=111`, `Rows Removed by Join Filter = 555.000`). O piso fixo (`historico_inicio()`, migration 0060) cresce +1 janela/semana para sempre, e o ledger cresce independentemente — as duas dimensões multiplicam sem teto.

- **Melhoria Proposta**
  > Reescrever a atribuição linha→janela em `metricas.metricas_ciclo()` (migration nova, aditiva, ex. `0060`) para uma varredura ÚNICA do ledger, em vez de um range-join repetido por janela. Duas alternativas concretas:
  > 1. Bucketing por linha: computar a janela de cada linha do ledger diretamente por aritmética (`p_serie_inicio + floor(extract(epoch from criado_local - p_serie_inicio) / 604800) * interval '7 days'`, ou `date_bin('7 days', criado_local, p_serie_inicio)` no Postgres 14+) e agrupar por esse valor — troca o `LEFT JOIN` por range por um `GROUP BY` direto sobre uma expressão calculada uma vez por linha (O(N) total).
  > 2. Se o bucketing por expressão não bater exatamente com a regra "sexta 18:00 → sexta 18:00" em todos os casos de borda, criar um índice de expressão em `(criado_em AT TIME ZONE 'America/Sao_Paulo')` (`WHERE dry_run = false`) nas duas tabelas e reescrever o `JOIN` para permitir um `Index Range Scan` por janela em vez do atual `Seq Scan` + `Materialize` relido.
  > Tactic alvo: Increase Resource Efficiency. Tocar: `src/backend/migrations/0058_vw_metricas_ciclo.sql` (ou nova migration que redefine só a função, respeitando o contrato de saída), `vwMetricasCiclo.test.ts`/`.integration.test.ts` (já cobrem o comportamento — servem de regressão).

- **Resultado Esperado**
  > Tempo de execução da query deixa de crescer com o nº de janelas. Medido: 333,9 ms (N=5.000, W=111) → esperado ~20 ms (mesma ordem do caso W=6, já que N passa a ser escaneado uma única vez). Meta: p95 da rota permanece < 50 ms independentemente de quantas semanas o piso `historico_inicio()` acumular no futuro.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Tempo de execução (N=5.000, W=111): 333,9 ms → <50 ms
  - `Rows Removed by Join Filter` (evidência de re-scan): 555.000 → 0
- **Risco de não fazer**: em ~2 anos (W≈110, ledger também maior que os 5.000 linhas simuladas aqui), cada abertura da tela paga bem mais que os 334 ms medidos com N artificialmente fixo — o pior caso real cresce em AMBAS as dimensões ao mesmo tempo. A tela fica perceptivelmente lenta sem nenhum código ter mudado, e a correção vira uma otimização de última hora sob pressão, em vez de uma migration planejada.
- **Dependências**: nenhuma bloqueante — migration aditiva, não quebra 0058/0060 existentes nem o contrato consumido pelo `kavex-report-ciclo`.

### [performance-2] Cachear/tetar `GET /metricas/ciclo`

- **Problema**
  > `GET /metricas/ciclo` não tem cache (HTTP ou servidor) nem `LIMIT` no nº de janelas devolvidas. Cada request recalcula a leitura completa do zero, mesmo que o dado só mude por execução em lote (não por leitura) e mesmo que dois analistas abram a tela no mesmo minuto. Isso amplifica F-performance-1 sob concorrência.

- **Melhoria Proposta**
  > Aplicar cache com TTL curto (60-300s) na resposta de `GET /metricas/ciclo` — dado que os valores só mudam quando um borderô fecha ou uma SN é finalizada, não a cada leitura da tela. Complementar com um teto explícito no nº de janelas retornadas pela tela (ex. últimas 26 semanas), com paginação para além disso, já que hoje a resposta cresce sem parar junto com `historico_inicio()`. Tactic alvo: Maintain Multiple Copies of Computations / Bound Execution Times. Tocar: `src/backend/routes/metricas.ts`, `MetricasCicloRepository.listar`.

- **Resultado Esperado**
  > Nº de janelas por resposta deixa de ser ilimitado (hoje cresce +1/semana para sempre) e passa a ter um teto (ex. 26). Cache hit ratio de 0% hoje para ≥80% das leituras servidas dentro do TTL, reduzindo a pressão sobre o pool de conexões (`max=5`) sob uso concorrente.

- **Tactic alvo**: Maintain Multiple Copies of Computations
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para cache simples em memória; S–M se incluir paginação/`LIMIT` na query
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Janelas retornadas por chamada: ilimitado → tetado (ex. 26)
  - Cache hit ratio: 0% → ≥80%
- **Risco de não fazer**: combinado ao card performance-1 não feito, N usuários concorrentes multiplicam o pior caso O(linhas×janelas) por N execuções simultâneas, e o pool de conexões (`max=5`) forma fila sob uso normal de segunda de manhã, antes mesmo do índice virar o gargalo dominante.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Metodologia**: diferente do padrão `--quick` de declarar "não medível sem banco", este agente SUBIU um Postgres 17 real via docker (`postgres:17-alpine`), aplicou as 59 migrations do repo (`0001`..`0060`) e semeou dados sintéticos (5.000 linhas/tabela para isolar a variável "nº de janelas", depois 200 linhas para reproduzir a escala real de hoje) para medir `EXPLAIN (ANALYZE, BUFFERS)` de verdade, em vez de estimar. Os números da seção 2/4 são medidos, não extrapolados — só a PROJEÇÃO para 1-2 anos (seção 4, F-performance-1) é extrapolação explícita, apoiada na lei de crescimento medida.
- **Cross-QA — Modifiability**: `modifiability.md` já flagra `historico_inicio()` como constante que "envelhece" (drift de correção de negócio — a data para de fazer sentido como "seis semanas"). Este achado (F-performance-1) é uma consequência DIFERENTE da mesma causa raiz (piso fixo sem teto): aqui o ângulo é custo de execução medido, não coerência do rótulo "seis semanas". Os dois cards são independentes e não se substituem.
- **Cross-QA — Testability**: `vwMetricasCiclo.integration.test.ts` já roda contra Postgres 17 real no CI (`test:sql`) — é a infraestrutura de teste ideal para adicionar uma asserção de regressão de performance (ex. `EXPLAIN` sem `Seq Scan` no ledger após o card performance-1), mas isso não existe hoje.
- **Escopo respeitado**: findings e cards restritos ao delta (migrations 0058/0060 novas em 0060, `MetricasCicloRepository`, `routes/metricas.ts`); pool de conexões e `PostgreeDatabaseClient` citados só como contexto do artefato atravessado pela query, não como achado próprio (código pré-existente, fora dos 7 arquivos de produção do delta).
