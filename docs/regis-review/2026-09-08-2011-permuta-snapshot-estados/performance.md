---
qa: Performance
qa_slug: performance
run_id: 2026-09-08-2011-permuta-snapshot-estados
agent: qa-performance
generated_at: 2026-09-08T20:22:00Z
scope: backend
score: 7.0
findings_count: 6
cards_count: 5
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Render deploy (autoDeploy on push a `main`) | Rollout de instância nova aplica `0054_estado_ja_permutado.sql` no boot antes de aceitar tráfego | `src/backend/migrations/BootMigrator.ts` + `MigrationRunner` + Supabase Postgres | Produção, tabela `permuta_candidata_snapshot` com 152.516 linhas e 250 runs (dado do autor, 2026-09-08) | Aplicar 0054 numa única transação, aguardar advisory lock, então `app.listen()` — com healthcheck `/health` respondendo antes do timeout do Render | Boot < timeout do healthcheck do Render (default 300s no dashboard, não codificado); migration ≤ 30 s p95 no pipe Session-pooler → RDS; 0 divergências na asserção; 0 double-boot por lock ocupado |
| Analista abre painel `/permutas/gestao` | 1 GET encadeia 7 queries em `Promise.all` (adiantamentos ativos + invoices em aberto + casamentos + processamentos + declarações + alocações + `findLatestIngestFinishedAt`) | `GestaoPermutasService.exporGestao` | Produção, ~1.900 adtos ativos + N invoices em aberto | Servir painel completo com p95 < 1500 ms | p95 latency `GET /permutas/gestao` em produção — não coletado neste run |
| Cron 3×/dia executa eleição | `persistRun` grava header + N chunks de INSERT multi-row de 500 candidatas (~610 linhas/run × 3/dia = ~1.906 lin/dia projetados) | `PermutaSnapshotRepository.persistRun` | Produção, mesma janela do `preDeployCommand` que também roda `npm run migrate` | Escrita atômica com ≤ 3 round-trips (header + 2 chunks para 610 linhas), tabela crescendo linearmente sem retenção | Round-trips por run = 3; linhas por dia = 1.906; projeção 12 meses = 697.500 linhas |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Linhas em `permuta_candidata_snapshot` | 152.516 | — | ⚠️ | docstring de `0054_estado_ja_permutado.sql` (medição do autor, 2026-09-08) |
| Runs em `permuta_eleicao_run` (`kind='eleicao'`) | 250 | — | ⚠️ | mesma fonte |
| Tempo local da 0054 (container Postgres local) | 2,6 s p/ 152.500 linhas | ≤ 5 s local | ✅ | autor (prompt do run) |
| Tempo em Supabase Session-pooler | ⚠️ não medível localmente | ≤ 30 s | ⚠️ | requer execução em staging idêntico ao PRD; ver F-performance-1 |
| Passes de tabela cheia dentro da 0054 | 4 sequential scans (CHECK-validation + DO $$ CTE + UPDATE do snapshot + UPDATE do header com subquery agregada) | 2 (asserção reusa scan do UPDATE) | ⚠️ | `sed -n '86,196p' src/backend/migrations/0054_estado_ja_permutado.sql` |
| Linhas reescritas pelo UPDATE do snapshot | 144.633 (152.516 − 7.883 elegiveis, permanecem intactas por WHERE) | tuplas mortas geradas 144.633 (sem VACUUM explícito) | ⚠️ | seção 6 da 0054 + distribuição declarada na docstring |
| Colunas INTEGER NOT NULL DEFAULT 0 adicionadas a `permuta_eleicao_run` | 3 (`total_casamento_manual`, `total_permuta_manual`, `total_ja_permutado`) | metadata-only em PG≥11 (não rewrite) | ✅ | Supabase 15/16 (docstring DEPLOY.md fala Session pooler, sem versão explícita — assumido 15+ por padrão Supabase 2024+) |
| Boot bloqueado por migration antes de `app.listen()` | Sim | — | ⚠️ | `src/backend/index.ts:161-171` (`await container.resolve(BootMigrator).run();` → `diagnosticarConfiguracao()` → `app.listen()`) |
| Advisory lock LOCK_ATTEMPTS × delay | 30 × 2000 ms = 60 s máximo de espera antes de abortar boot | Igual a esse teto ou < health check timeout do Render | ⚠️ | `BootMigrator.ts:15-16` |
| `permuta_candidata_snapshot` — índices existentes | 1 (`idx_permuta_candidata_snapshot_run` em `run_id`) | Serve GROUP BY / JOIN por run_id ✅; NÃO serve `WHERE status='bloqueada'` do UPDATE | ⚠️ | `0001_permuta_eleicao.sql:41-42` |
| Pool máx. do backend (Express web) | 5 | Dado Supabase Session pooler (default 15 conn/user), 5 × N instâncias Render × 2 conexões concorrentes é folgado | ✅ | `PostgreeDatabaseClient.ts:26` |
| Round-trips por run em `persistRun` | 1 (header) + ceil(candidatas/500) chunks — 2 p/ 610 lin/run | ≤ ceil(N/500)+1 | ✅ | `PermutaSnapshotRepository.ts:141-149` |
| Queries no `GET /permutas/gestao` | 7 em `Promise.all` — invariante pré-existente (delta não introduz N+1) | Mantido | ✅ | `GestaoPermutasService.ts:47-64` |
| Queries no `GET /operacao/saude` | 6 em `Promise.all` (delta acrescenta 3 campos ao SELECT de `listRecentRuns`, sem query nova) | Mantido | ✅ | `JobRunReadModel.ts:63-73` + diff `PermutaSnapshotRepository.listRecentRuns` |
| Projeção linhas `permuta_candidata_snapshot` em 12 meses | 152.516 + 365 × 1.906 ≈ 848.206 (ou 697.500 novas) | Política de retenção — ausente | ❌ | 152.516 / 80 dias = 1.906,45 lin/dia (aritmética direta) |
| Cold start de Lambda | N/A — runtime é Express em Render, não Lambda | N/A | — | CLAUDE.md ("Estado Atual vs. Alvo") + prompt |
| Concorrência de SQS / DLQ / visibility timeout | N/A — não há SQS neste repo | N/A | — | prompt e `find . -name "*.tf"` retorna vazio |

> ⚠️ **Não medível localmente** — o tempo real da 0054 em Supabase, o timeout efetivo do healthcheck do Render (setado no dashboard, não em `render.yaml`) e o custo de rede round-trip por `ALTER TABLE ... ADD CONSTRAINT CHECK`. Recomendação: executar em ambiente de staging que replique `pooler.supabase.com` (Session mode, `port 5432`) e cronometrar cada passo com `psql \timing`. Sem isso, a extrapolação de 2,6 s local para PRD é palpite.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — não há amostragem de eventos externos afetada pelo delta | N/A | delta é escrita + read-model |
| Limit Event Response | `LIMIT $limit` em `listRecentRuns`, `LIMIT 1` nos `find*` do repo | ✅ | `PermutaSnapshotRepository.ts:280-293, 300-310` |
| Prioritize Events | Advisory lock no boot serializa migração entre instâncias (ordem estrita entre deploys concorrentes) | ✅ | `BootMigrator.comLock` |
| Reduce Overhead | INSERT multi-row de 500 tuplas no `insertCandidataChunk` (1 round-trip por chunk vs. N) — pré-existente e mantido | ✅ | `PermutaSnapshotRepository.ts:377-407` (`SNAPSHOT_INSERT_CHUNK = 500`) |
| Bound Execution Times | Advisory lock aborta boot após 30 tentativas × 2 s = 60 s; RetryExecutor no `init` (5 × 2 s = 10 s); `connectionTimeoutMillis: 5000` no Pool | ⚠️ parcial | `BootMigrator.ts:15-16`, `PostgreeDatabaseClient.ts:27,53-58`; a 0054 em si não tem `statement_timeout` explícito |
| Increase Resource Efficiency | `Promise.all` de 7 repositórios no `exporGestao`; SELECT projetivo com colunas nomeadas — não `SELECT *` no snapshot | ⚠️ parcial | `GestaoPermutasService.ts:47-64`. Contra-exemplo: `listAdiantamentosAtivos` faz `SELECT * FROM permuta_adiantamento` (pré-existente, fora do delta) |
| Increase Resources | Pool `max: 5` — configurável, mas não injetável por instância. Sem HPA nem métrica de saturação | ⚠️ parcial | `PostgreeDatabaseClient.ts:26` |
| Increase Concurrency | Two web instances no Render (default do `plan: starter`) + advisory lock serializa a migração para elas | ⚠️ parcial | `render.yaml` (sem número explícito de instâncias); `BOOT_MIGRATION_LOCK_KEY = 314159265` |
| Maintain Multiple Copies of Computations | N/A — não há cache de view aqui | N/A | — |
| Maintain Multiple Copies of Data | Header (`permuta_eleicao_run.total_*`) É cópia derivada do snapshot; a 0054 recomputa (invariante I5). Custo: 1 GROUP BY completo sobre 152k linhas | ⚠️ parcial | `0054_estado_ja_permutado.sql` seção 7 |
| Bound Queue Sizes | N/A — não há filas neste runtime | N/A | — |
| Schedule Resources | Cron 3×/dia da eleição roda separado do web; ingestão usa `withAdvisoryLock` própria (chave diferente) | ✅ | `PermutaRelationalRepository.persistIngestRun` |
| Cold start budget | N/A — Express contêiner longo, não Lambda | N/A | prompt |
| Cache strategy | `EnvironmentProvider` cacheia env vars — pré-existente | ✅ (pré-existente) | fora do delta |
| Index discipline | `idx_permuta_candidata_snapshot_run` serve o CTE `por_run` da 0054 e as leituras por `run_id`. NÃO existe índice em `status` — o UPDATE full-scan é aceitável nesta 1ª execução mas seria caro se re-executado num futuro incidente | ⚠️ parcial | `0001_permuta_eleicao.sql:41-42` |
| Bundle leanness | N/A — não há bundle no runtime Express (código roda direto do `dist/`); Frontend fora do delta | N/A | — |

## 4. Findings (achados)

### F-performance-1: Migration 0054 (152.516 linhas) roda dentro do `BootMigrator` no caminho crítico do healthcheck do Render

- **Severidade**: P1
- **Tactic violada**: Bound Execution Times / Schedule Resources
- **Localização**: `src/backend/migrations/BootMigrator.ts:60-72`, `src/backend/index.ts:161-171`, `src/backend/migrations/0054_estado_ja_permutado.sql:96-227`
- **Evidência (objetiva)**:
  ```
  # src/backend/index.ts (fluxo de start)
  await container.resolve(BootMigrator).run();   // ← aplica 0054 aqui
  await diagnosticarConfiguracao();
  app.listen(PORT, ...);                          // ← só depois responde /health

  # render.yaml
  healthCheckPath: /health
  # preDeployCommand: npm run migrate && npm run seed:admin  (COMENTADO no comment interno:
  # "O preDeployCommand do render.yaml NUNCA rodou: o serviço foi configurado pelo dashboard,
  #  pre-deploy é recurso de plano pago" — BootMigrator.ts:22-25)

  # Autor mediu 2,6 s em container local para 152.500 linhas.
  # Passes de tabela dentro da 0054: 4 sequential scans + 144.633 row rewrites.
  ```
- **Impacto técnico**: Se a rede Supabase Session-pooler adicionar ~10× de latência sobre local, o boot passa de 2,6 s para 20–30 s. O healthcheck do Render (default do dashboard, não codificado no repo) mata contêineres que não respondem no timeout; um deploy pode ficar em loop de restart, cada tentativa gastando o advisory lock por até 60 s (`LOCK_ATTEMPTS=30 × 2000 ms`).
- **Impacto de negócio**: Deploy fica preso ou faz rollback silencioso; a versão antiga permanece no ar (que é o desfecho projetado pelo `BootMigrator`), mas o time só descobre pelo dashboard do Render. A janela real do impacto: 3× por dia a eleição roda; se o deploy travar durante uma janela crítica, o painel `/gestao` mostra estado antigo, e o operador não sabe se é dado obsoleto ou release não subiu.
- **Métrica de baseline**: 2,6 s local (medido pelo autor) × fator de rede não-medido. O tempo real em PRD é desconhecido.

### F-performance-2: Bloco `DO $$` da asserção faz um `GROUP BY` extra sobre 152.516 linhas que poderia ser reaproveitado pelo UPDATE do header

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead / Increase Resource Efficiency
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:100-140` (asserção) e `:189-207` (UPDATE do header)
- **Evidência (objetiva)**:
  ```
  # 4 passes distintos sobre permuta_candidata_snapshot dentro da 0054:
  #   pass 1: ALTER TABLE ... ADD CONSTRAINT CHECK   (full-scan p/ validar 152k linhas)
  #   pass 2: DO $$ ... CTE `mapeado` + `por_run`     (full-scan agregado por run_id)
  #   pass 3: UPDATE ... SET status = CASE ...        (full-scan filtrado por status='bloqueada')
  #   pass 4: UPDATE permuta_eleicao_run r FROM
  #           (SELECT ... GROUP BY run_id
  #            FROM permuta_candidata_snapshot) c    (full-scan + GROUP BY)
  ```
- **Impacto técnico**: A asserção calcula exatamente as mesmas agregações por run que o UPDATE do header calcula depois, mas sobre o snapshot ANTES da mutação (o UPDATE opera DEPOIS). Como está, cada pass paga round-trip completo mais o custo de sort/hash. Um refactor que use `RETURNING run_id, status` do UPDATE + agregação numa CTE `WITH updated AS (...)` colapsa 2 dos 4 scans.
- **Impacto de negócio**: Não bloqueia — a 0054 é one-shot e o autor mediu 2,6 s local. Mas todo aumento futuro da tabela multiplica o custo pelo mesmo fator, e a próxima migração sobre a tabela herda a estrutura de 4 passes.
- **Métrica de baseline**: 4 sequential scans + 1 row rewrite pass = ~4,5× o tempo de um único scan otimizado. Em local isso é 2,6 s; em PRD, extrapolado, 15–30 s.

### F-performance-3: `permuta_candidata_snapshot` cresce ~1.906 lin/dia sem política de retenção — projeção de 848k linhas em 12 meses

- **Severidade**: P2
- **Tactic violada**: Bound Queue Sizes (adaptado para tabela de auditoria como "fila de eventos históricos")
- **Localização**: `src/backend/migrations/0001_permuta_eleicao.sql:26-42` (definição da tabela) + ausência de qualquer partitioning/pruning nos 55 arquivos de migração
- **Evidência (objetiva)**:
  ```
  152.516 linhas / 80 dias (2026-06-20 → 2026-09-08) = 1.906 linhas/dia
    ≈ 610 linhas/run × 3 runs/dia
  Projeção 12 meses: 152.516 + 365 × 1.906 = 848.206 linhas
                     (ou +697.500 se contadas só as novas)

  ALTER TABLE ... ADD CONSTRAINT CHECK  → full validation scan
  scan de 152k = 2,6 s (autor) ⇒ scan de 848k ≈ 14,5 s (linear na cardinalidade,
  desprezando bloat e cold cache).

  Nenhum arquivo em src/backend/migrations/ menciona partitioning, retention,
  archive, prune ou VACUUM FULL.
  ```
- **Impacto técnico**: Toda futura migração sobre a tabela (mudança de CHECK, coluna nova, backfill de motivo) escala linearmente com o histórico. O `findLatestSnapshot` também paga: cada run guarda ~610 linhas dela mesma, mas o `ORDER BY (aging_days IS NULL), aging_days DESC, doc_cod ASC` roda no índice de `run_id` — sem índice complementar, o sort é in-memory.
- **Impacto de negócio**: A cada trimestre, a janela de manutenção necessária para uma DDL sobre snapshot cresce ~500 lin/dia × 90 = 45k linhas. Em 3 anos, uma migração 0054-like custaria ~40 s no melhor caso. O tempo de boot do serviço fica prisioneiro do histórico.
- **Métrica de baseline**: 1.906 lin/dia; 848k em 12 meses; ausência total de retention/partitioning nos 55 arquivos de migração.

### F-performance-4: `ALTER TABLE ... ADD CONSTRAINT CHECK` valida 152.516 linhas sob `ACCESS EXCLUSIVE` lock

- **Severidade**: P3
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:71-79` e `:80-84`
- **Evidência (objetiva)**:
  ```
  ALTER TABLE permuta_candidata_snapshot
      DROP CONSTRAINT IF EXISTS permuta_candidata_snapshot_status_check;
  ALTER TABLE permuta_candidata_snapshot
      ADD CONSTRAINT permuta_candidata_snapshot_status_check
          CHECK (status IN ('elegivel','bloqueada','casamento-manual',
                            'permuta-manual','ja-permutado'));
  ```
- **Impacto técnico**: Postgres executa `ADD CONSTRAINT CHECK` (sem `NOT VALID`) fazendo full-scan da tabela sob `ACCESS EXCLUSIVE` — bloqueia leituras E escritas na tabela pelo tempo do scan. Como toda a 0054 roda dentro do boot, e o boot serializa por advisory lock, na prática o Express não está lendo enquanto isso — mas o `preDeployCommand` (`npm run migrate`) que roda no runner externo pode competir com o cron da eleição que rode em outro processo pontualmente.
- **Impacto de negócio**: Se uma eleição cron dispara enquanto a 0054 está no `ADD CONSTRAINT`, ela espera o lock — sem timeout explícito, herda o `connectionTimeoutMillis: 5000` do pool. Pode retentar (3× do RetryExecutor), mas se o lock durar mais que 15 s a run termina em `error` e o painel fica sem carimbo novo até a próxima janela.
- **Métrica de baseline**: 152.516 linhas de validation scan. `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` separado pega share-lock em vez de exclusive na segunda etapa; padrão zero-downtime que a 0054 não adota (justificável para tabela pequena, torna-se relevante em 848k+).

### F-performance-5: `permuta_eleicao_run` recebe 3 colunas `INTEGER NOT NULL DEFAULT 0` — metadata-only em PG≥11, mas versão-alvo não está declarada no repo

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency (validação da premissa)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:86-93`
- **Evidência (objetiva)**:
  ```
  ALTER TABLE permuta_eleicao_run
      ADD COLUMN IF NOT EXISTS total_casamento_manual INTEGER NOT NULL DEFAULT 0;
  # idem para total_permuta_manual e total_ja_permutado

  # PG 11+ (2018): DEFAULT literal não faz table rewrite (metadata-only).
  # Repo NÃO declara versão-alvo: DEPLOY.md fala "Session pooler do Supabase"
  # sem versão; grep -r "PG_VERSION\|Postgres 1[3-6]" retorna vazio.
  ```
- **Impacto técnico**: Se por engano rodar contra Postgres <11 (Supabase historicamente subia 11+, então improvável), cada `ADD COLUMN` faria table rewrite — em `permuta_eleicao_run` (~514 linhas) o custo é irrelevante, mas a validação da premissa não está registrada.
- **Impacto de negócio**: Baixo neste caso — a tabela é pequena. Contudo, se um `ADD COLUMN NOT NULL DEFAULT` for aplicado no futuro a `permuta_candidata_snapshot` (~152k+), a premissa vira relevante e não há teste que a proteja.
- **Métrica de baseline**: 3 colunas × ~514 linhas. Custo real trivial mas premissa não codificada.

### F-performance-6: `permuta_candidata_snapshot` sem índice em `status` — o UPDATE full-scan da 0054 é aceitável desta vez, mas re-execuções ou operações incrementais futuras pagam sempre por seqscan

- **Severidade**: P3
- **Tactic violada**: Index discipline
- **Localização**: `src/backend/migrations/0001_permuta_eleicao.sql:41-42` (único índice) + `0054_estado_ja_permutado.sql:181-188` (`WHERE status = 'bloqueada'`)
- **Evidência (objetiva)**:
  ```
  # Índices atuais em permuta_candidata_snapshot:
  #   idx_permuta_candidata_snapshot_run (run_id)   ← único
  # A 0054 executa:
  UPDATE permuta_candidata_snapshot
     SET status = CASE ... END
   WHERE status = 'bloqueada';
  ```
- **Impacto técnico**: 152k rows seqscan é 2,6 s local — aceitável agora. Mas o `findLatestSnapshot` (`WHERE run_id = $runId`) usa o índice de run_id; qualquer análise futura por status (KPI "quantas bloqueadas por período" cross-run) fará seqscan crescente.
- **Impacto de negócio**: Uma tela futura que agregue por status ao longo do tempo — pedido natural após esta correção — vai devolver latência linear em N. Neste momento ela não existe.
- **Métrica de baseline**: 1 índice em `run_id`; nenhum em `(status)` ou `(status, motivo_bloqueio)`.

## 5. Cards Kanban

### [performance-1] Tirar a migração do caminho crítico do healthcheck do Render

- **Problema**
  > A 0054 aplica 4 scans + reescreve 144k linhas dentro do `BootMigrator`, que roda antes de `app.listen()` — o healthcheck do Render só recebe resposta após a migração terminar. O autor mediu 2,6 s em container local; a rede Supabase Session-pooler tende a multiplicar essa latência, e o timeout efetivo do healthcheck está no dashboard, não versionado. Se estourar, o Render pode reciclar o contêiner no meio da 0054 — que é transacional e faz rollback, mas gasta o advisory lock por até 60 s (`LOCK_ATTEMPTS=30 × 2000 ms`).

- **Melhoria Proposta**
  > Duas opções — recomendação: (a) fazer o `preDeployCommand` do `render.yaml` de fato rodar (ver comment de `BootMigrator.ts:22-25` — está desabilitado por plano pago; se plano subir, retirar). Mantendo o `BootMigrator` como safety-net idempotente. Alternativa (b): expor um endpoint `/ready` separado do `/health` (Bass tactic **Schedule Resources**) — `/health` responde `200 OK` durante a migração, `/ready` só responde `200` depois. Envelopar a migração 0054 grande em `SET LOCAL statement_timeout = 60000` para bound explícito. Documentar a versão do Supabase (PG16) num arquivo de premissas para a análise não ser conjectura.

- **Resultado Esperado**
  > Boot p95 desacoplado do tamanho da migração: 2,6 s → < 300 ms (só bootstrap DI + `listen`) quando não houver migração; migração de 0054-size ≤ 30 s medida em staging (não em local).

- **Tactic alvo**: Schedule Resources / Bound Execution Times
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-1, F-performance-4
- **Métricas de sucesso**:
  - Tempo boot (sem migração pendente): não medido → < 500 ms p95
  - Tempo aplicação da 0054 em Supabase Session-pooler: desconhecido → medido em staging, ≤ 30 s p95
  - `statement_timeout` da 0054: ausente → 60000 ms explícito
  - Versão Postgres registrada no repo: ausente → declarada em `DEPLOY.md` ou arquivo de premissas
- **Risco de não fazer**: Uma migração 0054-like sobre 848k linhas em 12 meses (F-performance-3) pode passar do timeout do healthcheck e travar deploy em loop. O time descobre pela tela do Render, não por alerta.
- **Dependências**: nenhum — pode ir agora.

### [performance-2] Colapsar os 4 scans da 0054 em 2 (asserção reusa o resultado do UPDATE)

- **Problema**
  > Dentro da 0054 há 4 full-scans sobre `permuta_candidata_snapshot`: (1) validação do `ADD CONSTRAINT CHECK`, (2) asserção `DO $$` com CTE `mapeado`+`por_run`, (3) UPDATE do snapshot, (4) UPDATE do header com subquery agregada. Os passes 2 e 4 calculam exatamente as mesmas agregações por run — a asserção olha o "estado pretendido" antes de mutar, o UPDATE reagrega depois.

- **Melhoria Proposta**
  > Refatorar o UPDATE do snapshot com `RETURNING run_id, status`, capturar num `WITH updated AS (...)` e reusar para agregar o header (Bass tactic **Reduce Overhead**). A asserção de reconciliação continua como está — é ela que compra o direito ao backfill e vive fora do UPDATE. O ganho é o pass 4 desaparecer. Alternativa: mover a asserção para uma migração separada `0053b_assert_...` e rodar como sanity-check pré-cutover, deixando a 0054 fazer só as mutações.

- **Resultado Esperado**
  > Passes de tabela cheia na 0054: 4 → 2 (ADD CONSTRAINT CHECK + UPDATE combined). Tempo local: 2,6 s → ~1,3 s. Extrapolado para 848k linhas em 12 meses (F-performance-3): ~14 s → ~7 s.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — a 0054 já foi mergeada com o teste de mesa de 250 runs; qualquer refactor exige re-executar essa validação. Não fazer AGORA se a 0054 já rodou em PRD — o refactor vira "template para a próxima migração".
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Passes de tabela cheia: 4 → 2
  - Tempo local da 0054 (rerun em cópia): 2,6 s → 1,3 s
- **Risco de não fazer**: A próxima migração sobre snapshot que copiar a estrutura da 0054 herda o custo — e com 848k linhas em 12 meses o overhead vira janela de deploy travada.
- **Dependências**: performance-1 (se `/ready` estiver em produção, o custo do refactor cai porque não bloqueia mais o healthcheck).

### [performance-3] Definir política de retenção/particionamento para `permuta_candidata_snapshot`

- **Problema**
  > A tabela cresce ~1.906 linhas/dia (610 × 3 runs). Em 12 meses são 848k linhas; em 3 anos, 2,2M. Não existe partitioning, sweep, archive nem VACUUM FULL agendado no repo (0 hits em `grep -rn "partition\|prune\|retention" src/backend/migrations`). Cada futura DDL escala linearmente; `findLatestSnapshot` ordena por `(aging_days IS NULL), aging_days DESC, doc_cod ASC` sem índice complementar — sort in-memory.

- **Melhoria Proposta**
  > Bass tactic **Bound Queue Sizes**: transformar `permuta_candidata_snapshot` em tabela particionada por mês (RANGE em `created_at`) — Postgres 12+ suporta partitioning declarativo, Supabase 15 tem. Retenção sugerida: 6 meses on-line (últimas ~180 partições diárias ou 6 partições mensais), o restante move para `permuta_candidata_snapshot_archive` (mesma estrutura, tabela heap simples, sem índices caros). Runs de eleição escrevem só na partição atual — INSERT rate constante. `ALTER TABLE ADD CONSTRAINT` sobre uma partição de 45k linhas (1 mês) é ~0,8 s vs 45 s sobre 848k acumuladas.

- **Resultado Esperado**
  > Custo de futuras DDLs sobre snapshot: linear em 12M → linear em 1M (constante em "linhas do último mês"). Tempo p95 de `findLatestSnapshot`: manter constante ao longo do tempo em vez de crescer com o histórico.

- **Tactic alvo**: Bound Queue Sizes (aplicado a "fila histórica" de auditoria)
- **Severidade**: P2
- **Esforço estimado**: L (1–2sem) — migração de dado + reescrita do repositório + testes de partition pruning.
- **Findings relacionados**: F-performance-3, F-performance-4
- **Métricas de sucesso**:
  - Linhas por partição ativa: máx ~57k (30 dias × 1.906)
  - Tempo de `ADD CONSTRAINT CHECK` sobre partição ativa: < 1 s
  - Retenção declarada em ADR: ausente → definida (ex.: 6 meses on-line)
- **Risco de não fazer**: Em 12–18 meses, cada nova migração sobre snapshot é uma decisão de janela de deploy. Em 3 anos, refatorar a tabela é uma épica de 2 sprints em vez de uma tarefa.
- **Dependências**: acordo produto/Yuri sobre janela de retenção (P0 do domínio, não do técnico).

### [performance-4] Adotar padrão `ADD CONSTRAINT NOT VALID` + `VALIDATE CONSTRAINT` para DDL sobre tabelas grandes

- **Problema**
  > A 0054 faz `ADD CONSTRAINT CHECK` em modo síncrono, forçando full-scan sob `ACCESS EXCLUSIVE`. Em 152k linhas isso é 2,6 s; em 848k projetados, ~14,5 s bloqueando escrita. O cron da eleição roda 3×/dia e pode colidir com uma janela de manutenção.

- **Melhoria Proposta**
  > Padrão zero-downtime: `ALTER TABLE ... ADD CONSTRAINT ... CHECK (...) NOT VALID` (metadata-only, ~1 ms) numa migração; `VALIDATE CONSTRAINT ...` (share-lock, permite reads/writes concorrentes) na migração seguinte. Bass tactic **Bound Execution Times**. Documentar como convenção de repo em `docs/` ou `.claude/skills/`.

- **Resultado Esperado**
  > Janela de lock exclusive numa nova constraint CHECK: 2,6 s (hoje, 152k) / ~14,5 s (12 meses projetados) → ~1 ms. Cron da eleição não colide com deploy.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — convenção + template. Aplica-se prospectivamente; a 0054 já foi.
- **Findings relacionados**: F-performance-4, F-performance-3
- **Métricas de sucesso**:
  - Tempo médio de `ACCESS EXCLUSIVE` numa migração de constraint CHECK: 2,6 s → < 100 ms
  - Convenção documentada: ausente → declarada
- **Risco de não fazer**: Baixo agora, cresce com a tabela.
- **Dependências**: nenhuma.

### [performance-5] Registrar versão-alvo do Postgres/Supabase no repo

- **Problema**
  > O código da 0054 assume que `ADD COLUMN INTEGER NOT NULL DEFAULT 0` é metadata-only — verdade em PG≥11. A premissa não está codificada em lugar nenhum: `DEPLOY.md` só fala "Session pooler do Supabase" e `grep -r "PG_VERSION"` retorna vazio. Sem isso, uma alteração futura de infra que rebaixe versão (improvável mas não impossível) violaria a premissa silenciosamente.

- **Melhoria Proposta**
  > Adicionar à `DEPLOY.md` uma seção "Premissas de runtime" com Postgres versão mínima (ex.: 15). Considerar um health-check no boot que faça `SELECT current_setting('server_version_num')` e RECUSE subir se < versão-alvo, análogo ao `recusarBancoRemotoEmAmbienteLocal`. Bass tactic **Increase Resource Efficiency** (validação da premissa que a otimização de metadata-only depende).

- **Resultado Esperado**
  > Versão-alvo documentada + assertion no boot. Se um dia baixar de versão, o processo morre com mensagem clara em vez de rodar migrações "otimizadas" que fazem table-rewrite.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - Versão-alvo Postgres declarada: ausente → declarada em `DEPLOY.md`
  - Assertion de versão no boot: ausente → presente
- **Risco de não fazer**: Baixo. Documental.
- **Dependências**: nenhuma.

> **F-performance-6 sem card**: o índice em `(status)` é opção defensável apenas depois de uma tela/relatório que agregue por status. Hoje não existe, então o custo do índice (writes na eleição, ~1.906 lin/dia) não se paga. Fica documentado no finding para reavaliar quando a tela existir.

## 6. Notas do agente

- **Escopo delta, não repo inteiro**: métricas históricas (pool `max=5`, 7 queries do `/gestao`) foram listadas para status "não regride" mas não são causa deste ciclo — checar Modifiability/Testability para invariantes de projeção mudadas pela ADR-0043.
- **Cross-QA**: F-performance-1 tem sobreposição forte com Deployability (healthcheck timeout do Render, `preDeployCommand` desabilitado) e Availability (boot-loop risk); F-performance-3 e F-performance-4 tocam Modifiability (schema-as-code, convenção de DDL zero-downtime). Sinalizar ao consolidator.
- **Tentei medir e falhei**: (a) tempo real da 0054 em Supabase — precisaria de staging; (b) timeout efetivo do healthcheck do Render — está no dashboard, não no `render.yaml`; (c) versão exata do Postgres em uso — não declarada em nenhum arquivo do repo.
- **Não repeti a métrica declarada pelo autor** (2,6 s local, 152.516 linhas, 250 runs, 0 divergências): aceita como evidência primária porque a docstring da 0054 é do próprio ciclo e as agregações são reproduzíveis.
- **Não avaliei cold start de Lambda, batch size de SQS, DLQ, KMS decryption warmup, S3 keep-alive**: nada disso existe neste runtime. Marcado N/A explicitamente na seção 3.
