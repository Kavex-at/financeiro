---
qa: Performance
qa_slug: performance
run_id: 2026-09-03-1901-tapar-furos-backend
agent: qa-performance
generated_at: 2026-09-03T19:20:00-03:00
scope: backend
score: 8.5
findings_count: 4
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Supabase pooler (Supavisor) devolve `MaxClientsInSessionMode` / `too many clients` sob pressão; Render manda SIGTERM em todo deploy | Evento `error` no `pg.Pool` (cliente ocioso derrubado pelo servidor) **e/ou** SIGTERM chegando com requisições em voo | `src/backend/domain/client/database/PostgreeDatabaseClient.ts` (`pg.Pool`) + `src/backend/http/gracefulShutdown.ts` + `src/backend/index.ts` | Produção Render single-instance (`plan: starter`), Postgres via **Session pooler** do Supabase (`DEPLOY.md:12-14`), 5 sessões máx por processo, 6 crons GitHub Actions escalonados (`:00`, `:10-55`, `:20`, `:35`, `:45`) — cada job abre seu próprio pool | O handler de `error` do pool encerra a instância quebrada (`pool.end()`), zera a referência com guarda de reentrada e deixa a próxima `init()` reconstruir um pool limpo; o handler de SIGTERM/SIGINT drena o `app.listen`, chama `PostgreeDatabaseClient.close()` e sai `exit(0)` — com teto de 10s de drenagem | 0 sessões vazadas por evento `error` (antes: até `poolMaxConnections=5` por evento, multiplicadas pelo laço de auto-retry); 0 requisições cortadas no meio (antes: 100% das em voo no SIGTERM); saída graciosa em ≤ 10 s, dentro dos ~30 s que o Render espera entre SIGTERM e SIGKILL |

> Escopo do run: apenas o delta do commit `e575221` (5 arquivos). Findings de repositório fora
> deste delta não pertencem a este gate — foram cobertos em `docs/regis-review/2026-06-22-1658/`.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Sessões Supabase vazadas por evento `error` do pool | **0** (após o fix) — o handler chama `pool.end()` uma única vez, com guarda `ended` | 0 | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:79-93` + teste `ends the pool only once when the error event fires repeatedly` |
| Sessões vazadas por evento `error` do pool — **baseline anterior** | até **5** por evento (=`poolMaxConnections`) + até 5 abertos pela `init()` seguinte no mesmo laço de auto-retry (`'too many clients'` está em `transientErrorPatterns`) | 0 | ❌ (antes do delta) | `PostgreeDatabaseClient.ts:29-35` + `HEAD~1:PostgreeDatabaseClient.ts` (handler zerava só a referência) |
| `poolMaxConnections` por processo | 5 | Suficiente para `/painel` concorrer com o advisory-lock da eleicao (justificado no comentário `≥3 (P0-6)`) | ✅ | `PostgreeDatabaseClient.ts:26` |
| `poolIdleTimeoutMillis` | 10.000 ms | Curto o suficiente para o Supavisor não derrubar antes; longo o suficiente para não thrash o pool sob burst | ✅ | `PostgreeDatabaseClient.ts:27` |
| `poolConnectionTimeoutMillis` | 5.000 ms | Aceitável dado o cenário: melhor 5xx do que backpressure invisível | ✅ | `PostgreeDatabaseClient.ts:28` |
| `queryRetryExecutor` — tentativas × delay | 3 × (200 ms + jitter 200 ms) → cauda máxima de ~800 ms adicionados por query em erro transitório persistente | ≤ 1 s de cauda para não competir com o `connectionTimeoutMillis=5000` da próxima query | ✅ | `PostgreeDatabaseClient.ts:36-43` + `RetryExecutor.ts` |
| Drain timeout do SIGTERM | 10.000 ms (force-exit se estourar) | ≤ 30 s (teto do Render antes do SIGKILL) e ≥ p99 de request (dashboards de p99 não medíveis localmente — Render Free/Starter não expõe request duration histogram nativo) | ✅ | `gracefulShutdown.ts:26` |
| Teto do plano Supabase (max_client_conn no Session pooler) | ⚠️ **Não medível localmente**: `DEPLOY.md:9-15` diz "Session pooler porta 5432" mas não fixa o plano. Supabase Free hoje = 60 client conns; Pro = 200 por padrão. | Header total (todas as filas × cron × pool max) < 60% do teto | ⚠️ | Requer inspeção do dashboard Supabase (`Project Settings → Database → Connection pooling → Pool size`). Recomendação em `[performance-1]`. |
| Requisições HTTP cortadas por SIGTERM | **0** (após o fix) — `server.close` drena → `pool.end()` → `exit(0)` | 0 | ✅ | `gracefulShutdown.ts:47-104` + testes `stops accepting connections, then closes the pool, then exits 0 — in that order` |
| Cobertura do fix em teste | 93,61% stmts / 100% lines em `gracefulShutdown.ts`; 4 testes novos direto em `pool error handling (BE-05)` + 3 em `close (shutdown gracioso)` | ≥ 90% | ✅ | `_shared-metrics.md` (`http/gracefulShutdown.ts`) + `PostgreeDatabaseClient.test.ts:230-321` |
| p50/p95 de latência HTTP e p99 de query Postgres | ⚠️ **Não medível localmente** — o app loga `RES … (Xms)` por request mas o run é `--quick` e não há CloudWatch/APM configurado. | Não regride em relação ao pré-delta | ⚠️ | Instrumentar histogram no `errorMiddleware` + `PostgreeDatabaseClient.query` (recomendação em `[performance-3]`). |

## 3. Tactics — Cobertura no financeiro (delta)

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Resources — **Increase Resource Efficiency** | O handler de `error` agora libera a sessão para o servidor em vez de deixar o `pg.Pool` quebrado no GC segurando `poolMaxConnections` conexões — a raiz do vazamento que este delta corrige. | ✅ presente | `PostgreeDatabaseClient.ts:79-93`; teste `ends the broken pool and drops the reference on a pool error` |
| Manage Resources — **Increase Concurrency** | `poolMaxConnections=5` deliberado (justificado como piso para o advisory-lock da eleicao coexistir com `/painel`); o delta preserva. | ✅ presente | `PostgreeDatabaseClient.ts:23-26` |
| Manage Resources — **Increase Resources** | Não aplicável ao delta — nenhum ajuste vertical/horizontal aqui. A observação é o inverso: o delta **desestrangula** o teto do Supabase que estava sendo drenado silenciosamente. | N/A | — |
| Manage Resources — **Maintain Multiple Copies of Computations** | N/A no delta — não há load-balancing entre instâncias (Render single-instance). | N/A | `render.yaml:5-9` |
| Manage Resources — **Maintain Multiple Copies of Data** | N/A no delta — cache/CQRS fora do escopo. | N/A | — |
| Manage Resources — **Bound Queue Sizes** | Implícita: o `close()` chamado no SIGTERM impede que a fila do `pg.Pool` cresça durante o drain (novas queries falham com `Cannot use a pool after calling end`). Aceitável no shutdown; requisição nova nem chega ao service porque o `server.close` já bloqueou. | ✅ presente | `gracefulShutdown.ts:80-104` (sequência `close → drain → pool.end`) |
| Manage Resources — **Schedule Resources** | Fora do delta — orquestração de cron por escalonamento (`:00 / :20 / :35 / :45`) para respeitar `LOGIN_ERROR_MAX_SESSIONS`; herdada do repo. | N/A (fora do delta) | `.github/workflows/*.yml` |
| Control Resource Demand — **Manage Sampling Rate** | N/A — não há sampler no delta. | N/A | — |
| Control Resource Demand — **Limit Event Response** | `RetryExecutor` do query com `retries=3` limita a amplificação de um transiente (não retry ao infinito). Preservado — não foi tocado pelo delta. | ✅ presente | `PostgreeDatabaseClient.ts:36-43` |
| Control Resource Demand — **Prioritize Events** | N/A no delta. | N/A | — |
| Control Resource Demand — **Reduce Overhead** | O `close()` idempotente (zera referência **antes** do `await pool.end()`) evita segundo `end()` concorrente — remove overhead redundante no shutdown. | ✅ presente | `PostgreeDatabaseClient.ts:103-119` + teste `ends the pool and is idempotent` |
| Control Resource Demand — **Bound Execution Times** | `drainTimeoutMs = 10_000` com `setTimeout` unref-ado força saída em vez de deixar o processo pendurado até o SIGKILL do orquestrador (~30 s). O `unref()` também evita que o próprio timer segure o event loop se tudo drenar antes. | ✅ presente | `gracefulShutdown.ts:82-91` + teste `forces exit when drain exceeds the timeout` |
| Control Resource Demand — **Increase Resource Efficiency** | Mesmo achado do bloco Manage Resources (o `pool.end()` no handler de `error` libera sessão do Supavisor). | ✅ presente | (idem) |
| Cold Start Budget | N/A — o runtime é Express de longa duração no Render, não Lambda. Cold-start só existe no primeiro request pós-deploy. | N/A | `CLAUDE.md §Estado Atual vs. Alvo` |
| Cache Strategy | N/A no delta — o cache de `EnvironmentProvider.getEnvironmentVars` já existe fora do delta e não foi tocado. | N/A (fora do delta) | `PostgreeDatabaseClient.ts:63` (cache implícito no provider) |
| Index Discipline | N/A no delta — nenhuma SQL nova. | N/A | — |
| Bundle Leanness | N/A — servidor Node, não Lambda; bundle não é hot path. | N/A | — |

## 4. Findings (achados)

### F-performance-1: Vazamento de sessões Supabase por evento `error` do pool — CORRIGIDO no delta

- **Severidade**: P1 → **resolvido** neste delta (mantido no relatório como baseline)
- **Tactic violada**: Manage Resources — **Increase Resource Efficiency**
- **Localização**: `src/backend/domain/client/database/PostgreeDatabaseClient.ts:79-93` (código corrente); `HEAD~1:src/backend/domain/client/database/PostgreeDatabaseClient.ts` (handler zerava só a referência)
- **Evidência (objetiva)**:
  ```
  # ANTES (HEAD~1) — handler zerava referência, GC herdava sessões abertas
  pool.on('error', () => { this.connectionPool = undefined; });

  # DEPOIS — encerra o pool antes de soltar
  let ended = false;
  pool.on('error', (_err) => {
      if (!ended) { ended = true; void pool.end().catch(() => {}); }
      if (this.connectionPool === pool) this.connectionPool = undefined;
  });
  ```
- **Impacto técnico**: cada evento `error` vazava até `poolMaxConnections = 5` sessões PostgreSQL. Como `'too many clients'` e `'MaxClientsInSessionMode'` estão em `transientErrorPatterns` (`PostgreeDatabaseClient.ts:29-35`), a `queryRetryExecutor` classificava o próprio esgotamento como transitório e chamava `init()` de novo → +5 sessões novas → mais eventos `error` → laço explosivo até saturar o `max_client_conn` do Supavisor. O detector transformava-se em amplificador.
- **Impacto de negócio**: quando o Supabase saturasse, 100% das rotas passavam a retornar 5xx (o `pg.Pool` novo não conseguia sequer abrir a conexão), com o `reaper-sispag` incapaz de rodar (também depende do mesmo Postgres) — MTTR forçado a redeploy manual para reciclar as sessões.
- **Métrica de baseline**: até **5 sessões vazadas por evento**, multiplicadas pela cauda de `retries=3` do `queryRetryExecutor` = até **15 sessões abertas por query em erro transitório persistente**, antes de qualquer novo request. Após o fix: **0** (teste `ends the pool only once when the error event fires repeatedly` valida o teto de uma chamada `end()` por instância de pool).

### F-performance-2: `poolMaxConnections=5` × 6 workflows GitHub Actions + 1 Web Service = teto de sessões concorrentes não documentado

- **Severidade**: P2 (débito técnico — o delta não introduziu, mas expõe o gap agora que a régua funciona)
- **Tactic violada**: Manage Resources — **Increase Concurrency** (por falta de headroom explícito)
- **Localização**: `src/backend/domain/client/database/PostgreeDatabaseClient.ts:26` + `.github/workflows/*.yml` + `DEPLOY.md:9-15`
- **Evidência (objetiva)**:
  ```
  # Cada processo (Web Service + 6 crons) abre um pool próprio de 5 sessões:
  # - financeiro-backend  (contínuo)               → até 5
  # - ingest-permutas     (cron :00, 3x/dia)       → até 5
  # - ingest-sispag       (cron :00 diário)        → até 5
  # - ingest-extratos     (cron :20 horário)       → até 5
  # - reconciliar-nde     (cron :35 horário)       → até 5
  # - reaper-sispag       (cron :10,:25,:40,:55)   → até 5
  # - detect-staleness    (cron :45 horário)       → até 5
  # Teto teórico com todos os crons simultâneos: 7 × 5 = 35 sessões.
  # Escalonamento :00/:20/:35/:45 mitiga; :55 e :00 colidem em ~5 min de janela.
  ```
  `DEPLOY.md` não fixa o Pool size do Supabase Session pooler (`Project Settings → Database → Connection pooling`). Free plan = 60; Pro = 200 — não medível pelo repo.
- **Impacto técnico**: sem headroom explícito documentado, um bump legítimo de `poolMaxConnections` (por exemplo, para `10` para acomodar novo endpoint concorrente) pode empurrar o total sobre o teto do Supavisor sem alerta.
- **Impacto de negócio**: primeiro sintoma é `MaxClientsInSessionMode` — que o `queryRetryExecutor` esconde por 3 tentativas antes de aparecer como 5xx.
- **Métrica de baseline**: teto teórico 35 sessões (7 processos × pool 5). Teto real do plano Supabase = **não medível localmente** — requer print do dashboard.

### F-performance-3: Latência HTTP e de query não instrumentadas em histograma

- **Severidade**: P3 (oportunidade)
- **Tactic violada**: nenhuma diretamente — é pré-requisito para provar/refutar regressão de qualquer card futuro
- **Localização**: `src/backend/index.ts:51-65` (logger inline emite `(Xms)` por request) e `src/backend/domain/client/database/PostgreeDatabaseClient.ts:225-244` (sem timing na `query`)
- **Evidência (objetiva)**:
  ```
  # index.ts:60
  console.log(`[RES] ${requestId} ${method} ${url} → ${res.statusCode} (${ms}ms)`);
  ```
  Duração está em log de linha; não há histograma, nem p50/p95/p99 agregados, nem trace de query.
- **Impacto técnico**: qualquer regressão de latência introduzida por um card futuro (ex.: novo JOIN, retry mais agressivo) só é visível por inspeção manual de log — não por alerta.
- **Impacto de negócio**: o próprio delta corrigiu um P1 sem que fosse possível provar a redução por métrica de produção — a validação é por teste unitário e reprodução mental do laço.
- **Métrica de baseline**: 0 métricas p95/p99 exportadas; 100% de observabilidade de latência via `console.log`.

### F-performance-4: `queryRetryExecutor` captura o `pool` antes das retentativas — retentativas dentro da mesma call não pegam pool novo criado pelo próprio `error` handler

- **Severidade**: P3 (comportamental — não vaza recurso, apenas atrasa a recuperação)
- **Tactic violada**: Control Resource Demand — **Reduce Overhead** (marginal)
- **Localização**: `src/backend/domain/client/database/PostgreeDatabaseClient.ts:225-244`
- **Evidência (objetiva)**:
  ```typescript
  const pool = this.connectionPool;              // referência congelada
  return this.queryRetryExecutor.execute(async () => {
      return pool.query(query, params as any[]); // <— sempre no pool capturado
  });
  ```
  Se durante a retentativa o handler de `error` derrubar `this.connectionPool` e chamar `pool.end()`, as tentativas 2 e 3 rodam contra pool já encerrado (falham com erro não-transitório e param cedo, o que é aceitável, mas a call falha em vez de aproveitar o pool novo).
- **Impacto técnico**: 1 request pode ver `Cannot use a pool after calling end` mesmo com o pool já reconstruído — o próximo request abre pool novo via `init()`. Impacto: ~200-400 ms adicionais na cauda do 1º request afetado.
- **Impacto de negócio**: marginal. Só se manifesta na janela estreita entre o `error` event e o `init()` seguinte.
- **Métrica de baseline**: até **1 request adicional** com 5xx por evento `error`; corrigido implicitamente porque o próximo request abre pool novo.

## 5. Cards Kanban

### [performance-1] Documentar e monitorar o teto de sessões Supabase por processo

- **Problema**
  > Depois do fix do BE-05 o pool para de vazar, mas o teto do Supabase (`max_client_conn` do Session pooler) permanece invisível para quem lê `DEPLOY.md`. Com 6 crons + Web Service a `poolMaxConnections=5` já reserva até 35 sessões teóricas; um bump futuro pode estourar o plano sem alarme.

- **Melhoria Proposta**
  > Registrar em `DEPLOY.md §1` o Pool size configurado no Supavisor (print do dashboard) e a conta `Σ (processos × poolMaxConnections)` como budget. Complementar com um probe em `/health` (ou seção nova em `/operacao`) que faça `SELECT sum(numbackends) FROM pg_stat_database` e alerte acima de 70% do teto. Tactic: **Manage Resources — Increase Concurrency** (documentar headroom antes de precisar).

- **Resultado Esperado**
  > `DEPLOY.md` documenta budget = X sessões, teto = Y sessões, uso atual = Z; painel de operação exibe `sessoes_ativas / sessoes_teto`. Métrica: **budget documentado = 0 → 1** e **alerta acima de 70% do teto: ausente → presente**.

- **Tactic alvo**: Manage Resources — Increase Concurrency
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Budget de sessões documentado em `DEPLOY.md`: **0 → 1 tabela**
  - Alerta `sessoes_ativas > 0.7 × teto`: **ausente → presente**
  - `poolMaxConnections` justificado com cálculo (não só `≥3 (P0-6)`): **1 comentário → 1 comentário + tabela**
- **Risco de não fazer**: primeiro sintoma de saturação continua a ser 5xx mascarado por 3 retries — o mesmo padrão que escondia o BE-05. Fica olhando para o painel Supabase manualmente em incidente.
- **Dependências**: nenhuma (leitura direta do `pg_stat_database`).

### [performance-2] Instrumentar histograma p50/p95/p99 de latência HTTP e de query Postgres

- **Problema**
  > O único registro de duração é `console.log([RES] … (Xms))` por request; não existe agregação, alerta ou baseline. Isso deixa qualquer regressão de latência (ou ganho, como o deste delta) sem prova empírica — a validação vira leitura manual de log.

- **Melhoria Proposta**
  > No `index.ts` (middleware de logger) e no `PostgreeDatabaseClient.query`, cronometrar e agregar em contadores in-memory por rota/tabela; expor em `/operacao/metrics` (ou similar) como JSON com `count / p50 / p95 / p99`. Não precisa de Prometheus: um `TDigest` ou `hdr-histogram-js` em uma singleton `MetricsRegistry` já resolve o baseline. Tactic: **Monitor** (pré-requisito para toda tactic de perf).

- **Resultado Esperado**
  > Painel de operação passa a exibir p95 de request por rota e p95 de query por callsite. Métrica: **p50/p95/p99 exportados: 0 → ≥ 3 métricas por rota**; qualquer card futuro passa a poder mostrar `p95 antes → p95 depois` sem depender de CloudWatch externo.

- **Tactic alvo**: Monitor / Bound Execution Times (pré-requisito de observabilidade)
- **Severidade**: P3
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Métricas de latência agregadas expostas: **0 → 3** (p50, p95, p99) por rota
  - Histograma de query Postgres por callsite: **ausente → presente**
  - Log de request com `(Xms)`: **mantido** (não substituir, complementar)
- **Risco de não fazer**: continua-se comprovando ganhos/regressões por argumento e teste unitário, não por número de produção — os próprios `--quick` runs deste review reconhecem "p50/p95 não medível localmente".
- **Dependências**: nenhum bloqueio; combina bem com `[availability-*]` de painel de operação.

### [performance-3] Reavaliar `pool` capturado antes das retentativas do `queryRetryExecutor`

- **Problema**
  > `PostgreeDatabaseClient.query` congela `const pool = this.connectionPool` antes de entregar ao `RetryExecutor`. Se durante a retentativa o `error` handler encerrar esse pool e criar um novo (fluxo corrigido pelo BE-05), as tentativas 2 e 3 rodam contra o pool encerrado e falham com `Cannot use a pool after calling end` — que não é transitório e sai como 5xx, mesmo com pool novo já pronto para atender.

- **Melhoria Proposta**
  > Ler `this.connectionPool` dentro do callback do `RetryExecutor.execute`, com `await this.init()` no começo de cada tentativa. Custo: 1 `if (this.connectionPool)` extra por retry — sem cold-init novo (a `init()` é idempotente e retorna cedo se `connectionPool` já existe). Tactic: **Reduce Overhead** / **Increase Resource Efficiency** (aproveitar o pool novo em vez de fritar as retentativas).

- **Resultado Esperado**
  > A 1ª call afetada por um evento `error` do pool passa a aproveitar o pool novo no meio das retentativas, em vez de falhar com `Cannot use a pool after calling end`. Métrica: **5xx por request afetado por evento `error` do pool: ~1 → 0**.

- **Tactic alvo**: Control Resource Demand — Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - 5xx por evento `error` do pool na call em curso: **1 → 0** (medível com o histograma do card `[performance-2]`)
  - Teste dedicado (`retries pegam pool novo criado pelo error handler no meio da call`): **ausente → presente**
- **Risco de não fazer**: cenário raro (janela entre `error` e `init()` seguinte); ignorar por 6 meses = ~1 request 5xx marginal por incidente de pool. Não urgente.
- **Dependências**: nenhum; combina com `[performance-2]` para observar antes/depois.

## 6. Notas do agente

- Escopo: gate pós-implementação de tweak de 5 arquivos. Nenhum finding P0/P1 aberto — o único P1 (F-performance-1) foi corrigido por este delta; mantido no relatório como baseline com métrica quantificada (até 15 sessões vazadas por query em erro transitório persistente → 0).
- Métricas não medíveis: p50/p95/p99 de request/query (sem APM/CloudWatch — o app só loga `(Xms)` inline) e teto real do Supabase Session pooler (requer print do dashboard). Ambas declaradas como ⚠️ e enderecadas nos cards `[performance-2]` e `[performance-1]`.
- Cross-QA (para o consolidator):
  - **Availability**: `[performance-1]` (alerta de sessões) sobrepõe painel de operação de saúde; o BE-05 corrigido também era um cenário de disponibilidade (5xx em cascata quando saturava o Supavisor).
  - **Fault Tolerance**: o próprio BE-05 é "detector virando amplificador" — evidência de que a régua de detecção sem freio de amplificação é anti-padrão de fault tolerance.
  - **Deployability**: o drain de 10 s do `gracefulShutdown` adiciona latência ao pipeline de deploy (até +10 s por deploy), abaixo dos ~30 s de grace do Render — aceitável e recomendável documentar no `DEPLOY.md` como característica do handler.
  - **Testability**: cobertura 93,61% em `gracefulShutdown.ts` e 4+3 testes novos em `PostgreeDatabaseClient` — teto alto para um delta desta natureza.
