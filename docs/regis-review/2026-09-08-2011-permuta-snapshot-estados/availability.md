---
qa: Availability
qa_slug: availability
run_id: 2026-09-08-2011
agent: qa-availability
generated_at: 2026-09-08T20:17:42Z
scope: backend
score: 7.5
findings_count: 5
cards_count: 4
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Deploy automático (Render `autoDeploy: true` no push da branch `fix/permuta-snapshot-estados` para `main`) | `BootMigrator` executa `0054_estado_ja_permutado.sql` antes de `app.listen()` — DDL (2 `ALTER TABLE ... ADD CONSTRAINT CHECK` sem `NOT VALID`) + reconciliação com `RAISE EXCEPTION` + 3 `UPDATE`s (152.516 linhas de `permuta_candidata_snapshot`, ~80 de `permuta_adiantamento`, 250 headers de `permuta_eleicao_run`) numa transação implícita simples-query do Postgres | Backend Node em Render (starter, 1 instância), Postgres/Supabase, endpoint `/health` do próprio serviço e leitores do painel de permutas | Boot (nenhum tráfego sendo servido pela nova instância; instância antiga continua no ar até o `/health` da nova responder) | O boot deve concluir a migration idempotente e começar a servir tráfego, ou morrer alto (`RAISE EXCEPTION`/`process.exit(1)`) mantendo a versão anterior no ar — em ambos os casos sem estado misto no banco e sem regressão observável no `/health` do serviço antigo | Zero linhas com `status` fora dos 5 estados após COMMIT; `total_bloqueadas` do header == contagem estrita do snapshot para toda run `kind='eleicao'` (invariante I5); boot da nova instância completa dentro da janela de health-check do Render OU a versão anterior segue servindo intacta; nenhum consumidor de rota removida (`GET /permutas/painel`) toma 404 |

> Cenário-limite (para dimensionar o risco): DDL de `ADD CONSTRAINT CHECK` sobre `permuta_candidata_snapshot` toma **ACCESS EXCLUSIVE** e valida os 152.516 registros por scan completo; sem `lock_timeout` nem `statement_timeout` na sessão do migration runner, um bloqueio em transação de outra sessão suspende o boot por tempo indefinido — e `/health` não responde porque `app.listen()` ainda não foi chamado.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Linhas da migration 0054 | 227 | — (referência de complexidade) | ℹ️ | `wc -l src/backend/migrations/0054_estado_ja_permutado.sql` |
| Rows no backfill de `permuta_candidata_snapshot` | 152.516 | — | ℹ️ | migration §6 (comentário, medido 2026-09-08) |
| Runs backfilladas em `permuta_eleicao_run` | 250 | — | ℹ️ | migration §7 e shared-metrics |
| Reescrita agregada de `total_bloqueadas` | 64.893 → 51.459 (Δ −13.434 / −20,7 %) | — (KPI muda de significado, cross-QA modifiability) | ⚠️ | migration §7 |
| `lock_timeout` fixado na sessão do migration runner | ausente | ≥1 (ex.: `SET LOCAL lock_timeout='30s'` antes dos `ALTER TABLE`) | ❌ | `grep -c "lock_timeout" src/backend/migrations/0054_estado_ja_permutado.sql` → 0; `grep -rn lock_timeout src/backend/migrations` → vazio |
| `statement_timeout` fixado na sessão do migration runner | ausente | ≥1 (defesa contra UPDATE preso) | ❌ | idem `statement_timeout` |
| `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` em dois passos | não usado | usado (evita full-scan sob ACCESS EXCLUSIVE) | ❌ | `grep -c "NOT VALID" src/backend/migrations/0054_estado_ja_permutado.sql` → 0 |
| Script de rollback / down para 0054 | 0 arquivos | ≥1 (SQL de reversão dos UPDATEs `bloqueada` do backfill) | ⚠️ | `ls src/backend/migrations/ \| grep -iE 'rollback\|down\|0054.*revert'` → vazio |
| `RAISE EXCEPTION` de reconciliação (Sanity Checking) | 1 (DO block, run-a-run) | ≥1 | ✅ | `src/backend/migrations/0054_estado_ja_permutado.sql:69-127` |
| Idempotência da assertion em re-execução | filtrada por `NOT EXISTS (... status NOT IN ('elegivel','bloqueada'))` — 2ª execução ignora runs já migradas | idempotente | ✅ | `src/backend/migrations/0054_estado_ja_permutado.sql:99-105` |
| Idempotência dos `UPDATE`s do backfill | `WHERE status='bloqueada'` (linhas reclassificadas caem fora do filtro) + recomputação por JOIN (não por subtração) | idempotente | ✅ | `src/backend/migrations/0054_estado_ja_permutado.sql:141-146` e §7 |
| Convergência header ↔ snapshot pós-fix (invariante I5 cláusula 2) | por construção — `EleicaoPermutasService.contarPorEstado` alimenta o mesmo objeto de totais que vai ao header (`...totals`) e o snapshot vem da mesma coleção `candidatas` | por construção | ✅ | `src/backend/domain/service/permutas/EleicaoPermutasService.ts:378-395,964-1000` |
| Timeout de aquisição do `BOOT_MIGRATION_LOCK_KEY` (advisory lock) | 30 × 2000 ms = 60 s | ≥ máxima duração esperada da migração 0054 | ⚠️ | `src/backend/migrations/BootMigrator.ts:15-16,116-125` |
| Timeout de conexão do pool Postgres | 5000 ms | 5000 ms | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:28,65` |
| Retry do pool na inicialização | `RetryExecutor` 5 × 2000 ms = 10 s | ≥3 | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:54-58` |
| Retry por-query em erros transientes | `RetryExecutor` 3 × (200 ms + jitter 200 ms) com `shouldRetry` por padrões (`MaxClientsInSessionMode`, `ECONNRESET`, ...) | ≥3 | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:36-43,204-...` |
| `/health` disponível durante `BootMigrator.run()` | não — `app.listen()` só é chamado após o `await container.resolve(BootMigrator).run()` | quando possível, expor `/health` antes do bloqueio de migration | ⚠️ | `src/backend/index.ts:160-173` |
| Consumidores de `GET /permutas/painel` (rota removida) | 0 no frontend, 0 em `src/backend`, 0 em testes fora do próprio arquivo removido | 0 | ✅ | `grep -rn 'permutas/painel\|permutasPainel' src/frontend src/backend` — só menções em comentários da própria migration/route |
| Falha loud na leitura do snapshot (Exception Detection) | `parseStatusSnapshot` lança se a coluna trouxer valor fora do enum (o fallback silencioso anterior `!== 'elegivel' ? 'bloqueada'` foi removido) | fail-loud com mensagem apontando a CHECK 0054 | ✅ | `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts:90-107,421` |
| CHECK constraint como Exception Prevention no banco | 2 CHECKs atualizados (relacional + snapshot) para os 5 estados do domínio | 2 | ✅ | `src/backend/migrations/0054_estado_ja_permutado.sql:52-66` |
| Namespace de advisory locks (evita colisão cross-frente) | 5 chaves distintas: boot 314159265; ingestão 726354819/726354820; permutas 918273645; formação lote 615243789; poller retorno 528417963 | sem colisão | ✅ | `src/backend/migrations/BootMigrator.ts:13-16`; `EleicaoPermutasService.ts`; `IngestaoPermutasService.ts:41` |
| Gates verdes independentes | typecheck ✅, lint ✅ (0 erros, 66 warnings legados), 1745 testes ✅ (+22 vs. baseline) | verde | ✅ | `_shared-metrics.md` §Gates |

> ⚠️ **Não medível localmente**: (a) duração real da migration 0054 em PRD; (b) tempo em que `/health` fica sem resposta durante o deploy; (c) MTTR observado num rollback via `git revert` + redeploy; (d) tempo do ACCESS EXCLUSIVE sobre `permuta_candidata_snapshot` no Supabase de produção. Requer logs do Render (`preDeployCommand` + start) e `pg_stat_activity` no janela do deploy. Recomendação: cronometrar o próximo deploy que inclua migração pesada e publicar o número em `docs/runbooks/`; instrumentar CloudWatch/Render alert para health-check FAIL > 30 s consecutivos durante deploy.
> ⚠️ **Não medível localmente**: cobertura de `--coverage` e `npm audit` — desativados por `--quick` (ver `_shared-metrics.md`).
> ⚠️ **Não medível**: métricas de IaC (`terraform plan`, módulos, tenants) — não há `infra/` neste repo (deploy via Render hook).

## 3. Tactics — Cobertura no delta

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping / Echo | `GET /health` (não-autenticado, público) responde `{status:'ok', version}`; frontend/Vercel e sonda externa podem bater. Indisponível durante a janela `BootMigrator.run()` | ⚠️ parcial | `src/backend/index.ts:79` |
| Heartbeat | Não há emissor periódico de heartbeat da nova instância — o Render infere disponibilidade pelo `/health` polling | ❌ ausente | — |
| Monitor | `GET /health/pipelines` (dead-man switch de pipelines) permanece existente; sem novo monitor introduzido pelo delta | ✅ presente (herdado) | `src/backend/routes/health.ts`; `src/backend/index.ts:83-84` |
| Timestamp | `permuta_eleicao_run.started_at/finished_at` + `duracaoMs` do `JobRunReadModel` continuam preenchidos; delta não regride | ✅ presente | `src/backend/domain/service/operacao/JobRunReadModel.ts:178-198` |
| Sanity Checking | `RAISE EXCEPTION` na DO block da 0054 reconcilia header vs. snapshot **antes** do backfill; `parseStatusSnapshot` lança se ler um valor fora do enum | ✅ presente | `src/backend/migrations/0054_estado_ja_permutado.sql:69-127`; `PermutaSnapshotRepository.ts:98-107` |
| Condition Monitoring | `/health/pipelines` (herdado) — não estendido pelo delta | ✅ presente (herdado) | `src/backend/routes/health.ts` |
| Voting | Instância única no plano Render starter; sem quorum | N/A | — |
| Exception Detection | Fail-loud generalizado: `parseStatusSnapshot` (leitura), `RAISE EXCEPTION` (migration), `BootMigrator.recusarBancoRemotoEmAmbienteLocal` (guard-rail); `process.exit(1)` no `start().catch` | ✅ presente | `PermutaSnapshotRepository.ts:98-107`; `BootMigrator.ts:87-101`; `src/backend/index.ts` |
| Self-Test | O bloco DO da 0054 é um self-test de deploy: fecha somando o snapshot reclassificado por motivo contra o header já gravado, run a run, e aborta se divergir; medido em 0/250 divergências no snapshot atual antes do commit | ✅ presente | `src/backend/migrations/0054_estado_ja_permutado.sql:69-127` |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | Render starter mantém 1 instância viva servindo enquanto a nova boota — a "redundância" é temporal, não paralela ativa | ⚠️ parcial | `render.yaml` (plano starter) |
| Passive Redundancy | Não há standby; a instância anterior serve como fallback se o boot falhar | ⚠️ parcial | idem |
| Spare | N/A no plano atual | N/A | — |
| Exception Handling | Retry transiente por padrão de erro no `PostgreeDatabaseClient.queryRetryExecutor`; catch com log em `LogService.warn` nos serviços de permutas (best-effort na leitura de ERP, mantendo o pipeline vivo) | ✅ presente (herdado, não regredido) | `PostgreeDatabaseClient.ts:36-43`; `IngestaoPermutasService.ts:143-150` |
| Rollback | Transação implícita do Postgres em simple-query cobre a 0054 inteira — falha no meio (inclusive o `RAISE`) reverte DDL + UPDATEs; **falta rollback SQL humano** para reverter o backfill semântico depois do deploy | ⚠️ parcial | `MigrationRunner.run` em `runMigrations.ts:38-42`; ausência de script `0054_*_down.sql` |
| Software Upgrade | `BootMigrator` aplica migrações **antes** de `listen()`, com advisory lock 314159265 serializando entre instâncias; falha de deploy = versão anterior mantida (Render `autoDeploy` + `healthCheckPath: /health`) | ✅ presente | `BootMigrator.ts:60-77`; `index.ts:160-173`; `render.yaml:16-21` |
| Retry | `RetryExecutor` (5×2s) no pool init e (3× 200 ms + jitter) por query; `BootMigrator` 30×2s no advisory lock; **não há retry sobre a migration em si** — falha mata o boot (comportamento desejado neste caso) | ✅ presente | `PostgreeDatabaseClient.ts:36-43,54-58`; `BootMigrator.ts:15-16` |
| Ignore Faulty Behavior | Delta REJEITA essa tática deliberadamente: substituiu o `!== 'elegivel' ? 'bloqueada'` (fallback silencioso) por `throw` fail-loud — troca "ignorar" por "detectar" | ✅ presente (revogada onde não devia estar) | `PermutaSnapshotRepository.ts:98-107` |
| Degradation | Endpoint `GET /permutas/painel` removido; leitura equivalente foi consolidada em `GestaoPermutasService` — não é degradação, é remoção sem consumidor | N/A | `src/backend/routes/permutas.ts:772-779` |
| Reconfiguration | N/A no delta | N/A | — |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | Não há execução shadow da nova taxonomia contra o snapshot antigo | N/A (mitigado pela Self-Test de deploy) | — |
| State Resynchronization | **A tática central do delta.** Header e snapshot agora derivam da MESMA agregação (`contarPorEstado(candidatas)`) na mesma transação — a "convergência por construção" é exatamente resincronização eliminada pelo desenho | ✅ presente | `EleicaoPermutasService.ts:378-395,964-1000` |
| Escalating Restart | `process.exit(1)` no `start().catch` deixa o Render marcar deploy como falho e manter a versão anterior — sem escalonar (fail-fast é a política) | ⚠️ parcial | `src/backend/index.ts` (bloco `void start().catch`) |
| Non-Stop Forwarding | N/A (serviço Express, sem load-balancer com estado) | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | `BootMigrator` só chama `app.listen()` **depois** que a migration completa — a nova instância fica fora de tráfego durante a janela de migração. Contraparte: se a migração travar (sem `lock_timeout`), a instância fica "removida" indefinidamente | ⚠️ parcial | `src/backend/index.ts:160-173` |
| Transactions | Migration inteira envelopada em transação implícita do Postgres; escritas de eleição usam `withAdvisoryLock` + `withTransaction` para atomicidade snapshot+header (não alterado pelo delta) | ✅ presente | `PostgreeDatabaseClient.ts:102-121`; `runMigrations.ts:38-42` |
| Predictive Model | Não há modelo preditivo de risco de deploy nem de crescimento de linhas por run | ❌ ausente | — |
| Exception Prevention | **A CHECK constraint do snapshot deixa de ser binária.** Escrita fora dos 5 estados falha na constraint, não em runtime na leitura — o defeito não pode mais ser gravado. Complementa `parseStatusSnapshot` no read-path | ✅ presente | `src/backend/migrations/0054_estado_ja_permutado.sql:57-66` |
| Increase Competence Set | ADR-0043 promove `ja-permutado` a estado de primeira classe da máquina — o domínio passa a saber lidar com ele em vez de tratá-lo como bug de projeção | ✅ presente | `ontology/decisions/0043-...md`; `ontology/state-machines/elegibilidade-permuta-candidata.md` |

## 4. Findings

### F-availability-1: Migration 0054 executa `ADD CONSTRAINT CHECK` sem `NOT VALID` e sem `lock_timeout`, validando 152.516 linhas sob ACCESS EXCLUSIVE dentro da janela de boot

- **Severidade**: P1 (alto — impacto direto na janela de disponibilidade do próximo deploy; risco quantificável)
- **Tactic violada**: Removal from Service (parcial — a instância nova pode ficar removida por tempo ilimitado) + Software Upgrade (o próprio upgrade se auto-bloqueia se houver contenção)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:53-66` (os dois `ALTER TABLE ... ADD CONSTRAINT`) e `src/backend/migrations/runMigrations.ts:35-42` (o runner não seta `lock_timeout`/`statement_timeout` antes)
- **Evidência (objetiva)**:
  ```
  $ grep -c "lock_timeout\|statement_timeout\|NOT VALID" src/backend/migrations/0054_estado_ja_permutado.sql
  0
  $ grep -rn "SET LOCAL lock_timeout\|SET LOCAL statement_timeout" src/backend/migrations
  (vazio — nenhuma migration da série 0001..0055 seta esses limites)
  ```
  Ordem no arquivo: `ALTER TABLE permuta_candidata_snapshot DROP CONSTRAINT ...` → `ADD CONSTRAINT ... CHECK (status IN (...))` sem `NOT VALID`. Postgres valida a constraint no ato, exigindo full scan de 152.516 linhas sob **ACCESS EXCLUSIVE** — bloqueando qualquer transação concorrente que já tenha lock em `permuta_candidata_snapshot`. `MigrationRunner.run` envia o arquivo cru via `databaseClient.insert(sql)` sem preludiar com `SET LOCAL lock_timeout='30s'`.
- **Impacto técnico**: se uma sessão qualquer estiver segurando lock em `permuta_candidata_snapshot` no momento do deploy (uma run de eleição em voo, um scan longo), o `ALTER TABLE` da nova instância fica em espera indefinida. Nesse tempo, `app.listen()` não é chamado — `/health` da nova instância não responde. O `preDeployCommand` do Render é declarado no `render.yaml` mas o próprio `BootMigrator.ts:19-25` documenta que **nunca rodou** (o serviço foi configurado via dashboard, e pre-deploy é feature paga), então a migração acontece no boot mesmo. Sem `lock_timeout`, o Render pode acabar matando o boot por health-check timeout — cenário no qual a versão anterior segue no ar, mas o deploy fica em ciclo de falha sem sinal claro do porquê.
- **Impacto de negócio**: janela de deploy com risco de suspender indefinidamente. O plano starter do Render tem 1 instância; o rollback é "reverter no git e esperar o próximo deploy". Um deploy preso hoje é um deploy preso por horas no pior caso, com o negócio (Columbia analistas) sem enxergar mudanças novas.
- **Métrica de baseline**: 152.516 linhas validadas por CHECK em ACCESS EXCLUSIVE; 0 sessões com `lock_timeout` ou `statement_timeout` no path do migration runner; 0 uso de `NOT VALID` em qualquer migration da série 0001..0055.

### F-availability-2: 0054 não tem script de rollback / down para o backfill semântico de 152.516 linhas + 250 runs

- **Severidade**: P1 (alto — desfazer o backfill hoje exige SQL escrito à mão sob pressão)
- **Tactic violada**: Rollback (ausente para a mudança de dados, presente apenas via `git revert` do código + transação implícita, que só cobre o instante da aplicação)
- **Localização**: `src/backend/migrations/` (ausência de arquivo `0054_*_down.sql` ou equivalente)
- **Evidência (objetiva)**:
  ```
  $ ls src/backend/migrations/ | grep -iE 'rollback|down|revert'
  (vazio)
  $ ls src/backend/migrations/ | grep 0054
  0054_estado_ja_permutado.sql
  ```
  A migration reescreve `total_bloqueadas` de 64.893 → 51.459 (−13.434 rows semanticamente movidas de "bloqueada" para `casamento-manual`/`permuta-manual`/`ja-permutado`) e distribui `permuta_candidata_snapshot.status` em 5 valores. O SQL de reverter isso (voltar tudo para `bloqueada` e recomputar `total_bloqueadas` como antes) **não existe no repositório** — precisaria ser derivado manualmente do `motivo_bloqueio` no momento do incidente.
- **Impacto técnico**: se algum consumidor downstream (relatório, exportação `.xlsx`, integração externa) quebrar por causa da mudança semântica de `total_bloqueadas`, não há caminho de reversão pré-testado. `git revert` no código não desfaz o backfill.
- **Impacto de negócio**: 3 meses foi o intervalo entre a decisão de back-compat inicial (migrations 0005/0012) e a descoberta do defeito de projeção (2,72× de inflação em bloqueadas). Se o backfill introduzir um defeito próprio, o MTTR de reversão fica limitado à velocidade de quem consegue escrever o SQL reverso sob pressão — não é um risco por si só, é um risco não instrumentado.
- **Métrica de baseline**: 0 scripts de rollback para 0054; 13.434 rows semanticamente movidas; 250 headers reescritos.

### F-availability-3: `/health` fica sem resposta durante toda a janela `BootMigrator.run()`

- **Severidade**: P2 (médio — comportamento herdado do template, não introduzido pelo delta; agrava-se com migração pesada como a 0054)
- **Tactic violada**: Ping/Echo / Monitor (parcial — o endpoint existe mas não responde no momento em que mais importaria)
- **Localização**: `src/backend/index.ts:160-176`
- **Evidência (objetiva)**:
  ```
  const start = async (): Promise<void> => {
      container.register(MIGRATION_RUNNER_TOKEN, { useClass: MigrationRunner });
      await container.resolve(BootMigrator).run();
      await diagnosticarConfiguracao();
      app.listen(PORT, () => { ... });   // ← só depois
  };
  ```
  Não há `app.listen()` "mínimo" (só `/health`) antes do `BootMigrator.run()`. Uma sonda externa (uptime checker, Render health-check) recebe TCP-refused durante a migração.
- **Impacto técnico**: cegueira sobre o estado da nova instância pelo tempo que a migração durar. Se a Columbia mudar de plano no Render para rolling deploy multi-instância, isso vira **prevenção contra o rolling deploy conseguir cutover** — a instância nova nunca fica "healthy" pela sonda até completar a migração.
- **Impacto de negócio**: hoje pequeno (1 instância, health-check só decide se o deploy sobe). Cresce se a migração 0054 encalhar por causa da F-availability-1.
- **Métrica de baseline**: 0 endpoints respondendo antes de `BootMigrator.run()` completar; 60 s é o teto de espera do advisory lock, mas o teto de duração da migração 0054 propriamente dita é **indefinido** (sem `lock_timeout`).

### F-availability-4: Sem verificação automática de que `motivo_bloqueio` esgota o mapeamento — a asserção reconcilia por soma, não por cobertura de motivos

- **Severidade**: P2 (médio — mitigado pela DO block, mas com uma janela lógica pequena)
- **Tactic violada**: Sanity Checking (parcial)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:76-105`
- **Evidência (objetiva)**: o CASE do mapeamento é fechado por `ELSE 'bloqueada'`. A DO block valida que **agregados** (elegiveis, bloqueadas totais, candidatas) batem entre header e snapshot reclassificado; ela detectaria um motivo desconhecido apenas se ele desloca o agregado — como todos os motivos-fora-do-mapa caem em `bloqueada` (a "outra ponta" do agregado), um motivo novo aparecendo ENTRE a medição de 2026-09-08 e a execução do deploy passaria silenciosamente para `bloqueada` **sem sinalizar** que o mapeamento ficou desatualizado.
- **Impacto técnico**: se um deploy futuro introduzir um `motivo_bloqueio` novo e essa migração for re-executada num banco intermediário sem esperar a nova taxonomia, o mapeamento estará silenciosamente incompleto. O comentário da migração cita "multiplas-invoices com 0 ocorrências históricas" — reconhece a fragilidade mas não a cobre com asserção específica.
- **Impacto de negócio**: risco lateral e pequeno; a mitigação natural é a taxonomia de motivos ser estável (histórico curto de mudanças). Nenhum evento produtivo pendente conhecido.
- **Métrica de baseline**: 1 caminho `ELSE 'bloqueada'` fallback silencioso no mapeamento; 0 asserções que enumeram os motivos esperados.

### F-availability-5 (positivo, para registro): Remoção de `GET /permutas/painel` sem consumidor — impacto zero verificado

- **Severidade**: P3 (informativo)
- **Tactic**: — (verificação de ausência de blast radius)
- **Localização**: `src/backend/routes/permutas.ts:772-779` (comentário), `src/backend/domain/service/permutas/PainelService.ts` (removido)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "permutas/painel\|permutasPainel" src/frontend
  (vazio)
  $ grep -rn "permutas/painel" src/backend | grep -v "^Binary"
  src/backend/migrations/0054_estado_ja_permutado.sql:23:-- Essa justificativa CADUCOU: `GET /permutas/painel` não tinha nenhum consumidor
  src/backend/domain/service/permutas/IngestaoPermutasService.ts:126: (comentário)
  src/backend/routes/permutas.ts:772: (comentário)
  ```
- **Impacto técnico**: nulo. O teste de RBAC de leitura foi migrado para exercitar `GestaoPermutasService.exporNoPainel` (o único implementador restante da ação), fortalecendo o teste que antes passava por acidente (mock com método errado devolvia 500 e o `not.toBe(403)` era vacuamente verdadeiro — `src/backend/routes/permutas.test.ts:628-655` do diff).
- **Impacto de negócio**: nulo.
- **Métrica de baseline**: 0 call-sites no frontend; 0 no backend fora dos próprios comentários da mudança.

## 5. Cards Kanban

### [availability-1] Blindar migrations pesadas com `lock_timeout` + `NOT VALID` no runner

- **Problema**
  > A migration 0054 valida uma `CHECK` sobre 152.516 linhas de `permuta_candidata_snapshot` sob ACCESS EXCLUSIVE, sem `lock_timeout`, sem `statement_timeout` e sem `NOT VALID`. Se qualquer sessão estiver segurando lock na tabela no momento do deploy, a instância nova espera indefinidamente pelo `ALTER TABLE` — e não responde `/health` enquanto isso (F-availability-1). O `MigrationRunner` também não prelude com `SET LOCAL lock_timeout`.

- **Melhoria Proposta**
  > No `MigrationRunner.run` (`src/backend/migrations/runMigrations.ts`), executar `SET LOCAL lock_timeout='30s'` e `SET LOCAL statement_timeout='5min'` antes do SQL de cada migration (dentro da mesma transação implícita). Adotar convenção: quando a migration usar `ADD CONSTRAINT CHECK`/`FOREIGN KEY` em tabela com >10k linhas, dividir em dois passos — `ADD CONSTRAINT ... NOT VALID` (instantâneo) + `VALIDATE CONSTRAINT ...` (não toma ACCESS EXCLUSIVE). Documentar no header da migration os limites que ela assume. Tactic Bass alvo: **Removal from Service** (bounded) + **Software Upgrade**.

- **Resultado Esperado**
  > Deploy que inclua migração pesada tem tempo máximo de espera por lock previsível. Se a espera for excedida, o boot morre alto (fail-fast) com mensagem apontando `lock_timeout`; Render mantém versão anterior no ar. Métricas observáveis: (a) `SET LOCAL lock_timeout` presente em 100 % das migrations 0055+; (b) `ADD CONSTRAINT ... NOT VALID` usado em `ALTER TABLE` sobre tabelas com >10k linhas; (c) tempo máximo do boot durante deploy com migration pesada ≤ `lock_timeout + statement_timeout + validate_time`.

- **Tactic alvo**: Removal from Service (bounded); Software Upgrade
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - `grep -c "SET LOCAL lock_timeout" src/backend/migrations/runMigrations.ts`: 0 → 1
  - Migrations com `ADD CONSTRAINT` sobre tabelas com > 10k linhas usando `NOT VALID`: 0 % → 100 %
  - Tempo máximo teórico de boot travado em lock: infinito → ≤ 30 s (`lock_timeout`)
- **Risco de não fazer**: um deploy futuro que coincidir com uma run longa de eleição fica preso até o Render matar o boot por health-check timeout. Rollback = git revert + esperar o próximo ciclo.
- **Dependências**: nenhuma (mudança isolada ao migration runner).

### [availability-2] Escrever e testar um script de reversão para 0054 (rollback semântico)

- **Problema**
  > O backfill da 0054 move 13.434 linhas de `bloqueada` para `casamento-manual` / `permuta-manual` / `ja-permutado` e reescreve `total_bloqueadas` em 250 headers (F-availability-2). Se o comportamento pós-deploy quebrar algum consumidor (relatório, exportação, integração), não há SQL de reversão versionado — quem for reverter escreve o script sob pressão do incidente.

- **Melhoria Proposta**
  > Adicionar `src/backend/migrations/0054_estado_ja_permutado.rollback.sql` (não incluído no runner automático; documentado em `docs/runbooks/`) que: (i) recolapsa `permuta_candidata_snapshot.status` para `elegivel|bloqueada` usando o `motivo_bloqueio` como âncora, (ii) recomputa `total_bloqueadas` no header como `elegiveis+bloqueadas+manuais+ja_permutado - elegiveis`, (iii) reverte as CHECKs para os valores anteriores. Testar o rollback num snapshot da produção (ambiente de staging). Tactic Bass alvo: **Rollback**.

- **Resultado Esperado**
  > MTTR de reversão do backfill semântico ≤ 15 min (executar 1 script conhecido, em vez de improvisar). Runbook publicado.

- **Tactic alvo**: Rollback
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Existência de `0054_estado_ja_permutado.rollback.sql`: não → sim
  - Runbook em `docs/runbooks/` referenciando o script: 0 → 1
  - Execução dry-run do rollback contra snapshot de PRD: não feita → feita e documentada
- **Risco de não fazer**: se um defeito latente aparecer no read-path que consome `total_bloqueadas` (ex.: relatório mensal enviado ao Yuri usando o número histórico), reverter fica no improviso.
- **Dependências**: acesso a um dump/staging com dados representativos.

### [availability-3] Expor `/health` mínimo antes do `BootMigrator.run()`

- **Problema**
  > `/health` só é servido após `app.listen()`, que só é chamado depois de `BootMigrator.run()` completar (F-availability-3). Durante a janela de migração — que hoje inclui a 0054 tocando 152 k linhas — a sonda externa recebe TCP-refused. Isso complica diagnóstico e é bloqueante para uma migração eventual para plano com rolling deploy.

- **Melhoria Proposta**
  > Iniciar um mini-server Express (só `/health` respondendo `{status:'migrating', version}`) antes de invocar `BootMigrator.run()`, e substituí-lo pelo app completo após a migração terminar. Alternativa mais simples: registrar o listener numa porta antes da migração e re-registrar o router `healthRouter` completo depois. Tactic Bass alvo: **Ping/Echo** + **Monitor** durante upgrade.

- **Resultado Esperado**
  > Sonda externa vê `HTTP 200 {status:'migrating'}` durante a janela de migração, `HTTP 200 {status:'ok'}` depois. Sem TCP-refused nunca. Habilita observabilidade da janela de migração e destrava rolling deploy quando o plano do Render permitir.

- **Tactic alvo**: Ping/Echo; Monitor
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Tempo com `/health` inalcançável durante deploy: `duração_da_migração` → 0
  - Estado do `/health` durante migração distinguível de "app up": mesma resposta hoje → `{status:'migrating'}` durante, `{status:'ok'}` depois
- **Risco de não fazer**: falso positivo de "serviço fora do ar" durante deploys longos; incapacidade de instrumentar duração real de boot migrations.
- **Dependências**: nenhuma.

### [availability-4] Fechar o mapeamento por motivo com asserção de cobertura, não apenas por soma

- **Problema**
  > A DO block da 0054 reconcilia agregados; um `motivo_bloqueio` novo que aparecesse entre a medição de 2026-09-08 e o deploy cairia em `ELSE 'bloqueada'` sem sinalizar (F-availability-4). Hoje é seguro porque a taxonomia é estável, mas nada no código enforça essa suposição.

- **Melhoria Proposta**
  > Antes do UPDATE do snapshot, executar `SELECT DISTINCT motivo_bloqueio FROM permuta_candidata_snapshot WHERE status='bloqueada'` e comparar contra a lista enumerada no CASE. `RAISE EXCEPTION` se aparecer motivo fora da lista esperada. Tactic Bass alvo: **Sanity Checking** com cobertura explícita.

- **Resultado Esperado**
  > Se a taxonomia de `motivo_bloqueio` mudar no futuro, a próxima migração que dependa dela falha alto **antes** de rodar o backfill, apontando exatamente qual motivo é inesperado.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Motivos silenciosamente absorvidos por `ELSE`: possível → 0 (asserção enumera)
- **Risco de não fazer**: pequeno hoje; cresce se a Frente I evoluir a taxonomia de motivos sem revisar migrações antigas.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: **delta**, não repo — o repo inteiro tem outros débitos de disponibilidade que não pertencem a esta review (ausência de infra multi-tenant, sem CloudWatch, etc.).
- O que a review NÃO conseguiu medir: (a) duração real da 0054 em PRD, (b) MTTR observado de rollback, (c) janela de `/health` fora — todos exigem logs do Render/Supabase que não estão no worktree. Instrumentar isso é pré-requisito para transformar as findings P1 em decisões defensáveis com número.
- Cross-QA: **modifiability** herda o card `availability-2` (rollback) porque a mudança de semântica de `total_bloqueadas` (KPI histórico) também é problema de manutenção; **testability** herda o registro de que a Self-Test da migration (`DO $$ RAISE EXCEPTION`) só existe em produção — cabe avaliar se um teste de integração da migration em CI/staging faria sentido.
- Nota positiva relevante: a **convergência header ↔ snapshot por construção** (State Resynchronization eliminada por design em `EleicaoPermutasService.contarPorEstado`) é a melhoria estrutural que o delta traz. É o que sobe o score deste QA acima de 6.
- Rebaixamentos aplicados: nenhum finding P0 foi levantado — a migração é bem construída (idempotente, com reconciliação, sem estado misto por transação implícita, sem consumidor órfão da rota removida). As lacunas restantes (lock_timeout, rollback, `/health` durante boot) são P1/P2 com baseline numérico.
