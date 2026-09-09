---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-08-2011-permuta-snapshot-estados
agent: qa-fault-tolerance
generated_at: 2026-09-08T20:11:00-03:00
scope: backend
score: 7.5
findings_count: 8
cards_count: 6
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta permuta-snapshot-estados)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Migration 0054 aplicada no boot (`appContainer.bootstrap`) sobre 152.516 linhas de snapshot + 250 headers de run + ~80 linhas vivas de `permuta_adiantamento` em PRD | UPDATE destrutivo que reescreve `permuta_candidata_snapshot.status`, promove ~80 adtos a `ja-permutado` e recomputa `total_bloqueadas` histórico (64.893 → 51.459) | 3 tabelas críticas do dashboard "Permutas"; CHECK constraints; header/snapshot da run (auditoria O6) | Boot single-node do `src/backend/index.ts` (Render/Supabase, sem replica); assertiva `RAISE EXCEPTION` roda ANTES das mutações; runner envia o arquivo como um único simple-query message | ABORT total via implicit-transaction do simple-query protocol se a reconciliação header↔snapshot divergir; caso contrário, migration marcada em `schema_migrations` num segundo comando; run posterior grava header + snapshot na MESMA `withTransaction`, satisfazendo I5 por construção | 0 divergências em 250 runs medidas; hashes md5 idênticos em 3 re-execuções; 100% das novas runs com `header.total_<s> === COUNT(snapshot WHERE status=s)` (3 testes canônicos, `EleicaoPermutasService.test.ts:1082-1279`) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Idempotência do backfill (re-execução produz mesmo estado) | verificada por leitura — 3 UPDATEs com `WHERE` que exclui o que já foi migrado + recomputação (não subtração) do header | idempotente | ✅ | `src/backend/migrations/0054_estado_ja_permutado.sql:158-227` |
| Ordem asserção-antes-de-mutação | `DO $$ RAISE $$` no bloco §4, UPDATEs em §5-§7 | asserção antes | ✅ | `0054_estado_ja_permutado.sql:79-156` |
| Cobertura da asserção (runs `kind='eleicao'`) | 250/250 (via `WHERE r.kind='eleicao'` + `NOT EXISTS` que exclui já-migradas) | 100% das runs com snapshot | ✅ | `0054_estado_ja_permutado.sql:138-144` |
| Atomicidade do arquivo inteiro | depende de implicit-tx do PG simple-query protocol (arquivo enviado como um `pool.query(text)` único) | 1 tx | ✅ (verificado no protocolo) | `runMigrations.ts:44-45` + `PostgreeDatabaseClient.query:189-203` (sem params → simple query) |
| Script de rollback (down migration) | 0 arquivos `*.down.sql` / `revert_*.sql` no diretório | rollback documentado para migration destrutiva | ❌ | `ls src/backend/migrations/` — 55 up-only |
| Recuperabilidade do `status` original das 152.516 linhas | perdido (só `motivo_bloqueio` sobrevive; reconstrução requer aplicar o mesmo CASE invertido) | preservação do valor original ou snapshot pré-migração | ⚠️ | inspeção da §6 (UPDATE do snapshot sobrescreve `status`) |
| Recuperabilidade de `total_bloqueadas` histórico | perdido (64.893 → 51.459); reconstruível por recount do snapshot pré-migração (que também foi mutado) | preservação ou dump prévio | ⚠️ | §7 do 0054 + ADR-0043 §Backfill |
| CHECK do snapshot pós-migração vs. código antigo | CHECK aceita 5 valores; código origin/main escreveria `bloqueada` catch-all → divergência silenciosa em rollback de deploy | CHECK apertada só quando código correspondente estiver ativo, OU código antigo rejeitado | ❌ | `PermutaSnapshotRepository.ts` (origin/main) `:320-323` vs. `0054 §2` |
| CHECK de `permuta_adiantamento` pós-migração vs. código antigo | CHECK aceita 5 + `ja-permutado`; código antigo escreve `bloqueada`+motivo → 80 linhas revertem silenciosamente na próxima ingestão | idem | ❌ | `IngestaoPermutasService.toEstadoRow` (origin/main default → `descoberta`; nova versão → mapping 1:1) |
| Convergência header↔snapshot por construção | 1 agregação (`contarPorEstado`) alimenta tanto `runInput.total_*` (via `...totals`) quanto o INSERT das candidatas, na MESMA `withTransaction` | uma fonte só | ✅ | `EleicaoPermutasService.ts` `contarPorEstado` + `runEleicao` (`runInput = {...totals}` + `snapshotRepository.persistRun`) |
| Testes canônicos de I5 verdes | 3 testes (fidelidade, contagem estrita, convergência) contra o REPO real + DB mock | ≥ 1 teste por cláusula | ✅ | `EleicaoPermutasService.test.ts:1082,1236,1247,1259` |
| Atomicidade `persistRun` (header + N chunks de snapshot) | 1 `withTransaction` → BEGIN/COMMIT/ROLLBACK numa sessão dedicada | 1 tx | ✅ | `PermutaSnapshotRepository.ts:98-103` + `PostgreeDatabaseClient.withTransaction:102-121` |
| Idempotency-Key na eleição (evita duplo fan-out Conexos) | header opcional; `pg_try_advisory_lock(djb2(key))` serializa; TTL 24h em `permuta_eleicao_idempotency` | presente para o gatilho crítico | ✅ | `EleicaoPermutasService.executar:156-217` |
| Persistência de run `error` num abort do fan-out | `runEleicao` catch → `persistRun({status:'error', ...contarPorEstado([])}, [])` — audit trail preservada | audit trail em falha | ✅ | `EleicaoPermutasService.ts` `runEleicao` catch (linhas ~410-430) |
| Falha do próprio `persistRun` de erro (DB offline) | erro original re-lançado, mas sem registro persistido — audit gap teórico | audit trail robusta a DB offline | ⚠️ | mesma seção; sem retry/DLQ para o header de erro |
| Dry-run / preview antes da migration destrutiva | ausente no arquivo `.sql`; validação foi feita manualmente em queries read-only prévias (ADR-0043 §Backfill) | flag/env para migração destrutiva | ⚠️ | `0054_estado_ja_permutado.sql` — SQL estático sem branch |
| Backup/PITR explicitado no runbook | não citado nem no arquivo `.sql` nem em `DEPLOY.md` para esta migration | mencionado no runbook da entrega | ⚠️ | `grep -n backup DEPLOY.md` — sem hit para o ciclo |

> ⚠️ **Não medível localmente**: MTTR do rollback de migração destrutiva em produção Supabase. Requer teste de restore de PITR em ambiente de staging. Recomendação: registrar o snapshot Supabase pré-`schema_migrations` de 0054, medir tempo de restore, publicar no runbook.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A — não há substituição de componente redundante neste delta | N/A | — |
| Replacement | N/A — sem componentes hot-swap no delta | N/A | — |
| Predictive Model | N/A — não há modelo preditivo aplicável a este delta | N/A | — |
| Increase Competence Set | `parseStatusSnapshot` lança em vez de fazer catch-all `'elegivel' ? : 'bloqueada'`; `toEstadoRow` usa exhaustiveness `never` (o próximo estado quebra o build). O "competence set" da leitura passa a **cobrir** os 5 estados em vez de degradar silenciosamente | ✅ presente | `PermutaSnapshotRepository.ts:99-107` (parseStatusSnapshot) + `IngestaoPermutasService.ts:296-309` (`naoMapeado: never`) |
| Sanity Checking | Bloco `DO $$` do 0054 compara header gravado × snapshot reclassificado por motivo e ABORTA se divergir. É a defesa principal do backfill | ✅ presente | `0054_estado_ja_permutado.sql:79-156` |
| Comparison | Reconciliação header × snapshot na asserção do 0054 — comparação de dois caminhos independentes ANTES de mutar | ✅ presente | `0054_estado_ja_permutado.sql:112-145` |
| Timestamp | `finished_at`, `started_at` no header; `last_seen_at` na ingestão; `created_at + INTERVAL '24 hours'` no TTL do idempotency-key | ✅ presente | `PermutaSnapshotRepository.ts:143-149` |
| Timeout | `withAdvisoryLock` não bloqueia (usa `pg_try_advisory_lock`); pool com `connectionTimeoutMillis: 5000`. Cross-ref qa-availability | ✅ presente | `PostgreeDatabaseClient.ts:29-31,137-160` |
| Condition Monitoring | `stale=true` sweep na ingestão marca fatos não vistos na run corrente (`markStale`); reaper em `job-execucao` (fora deste delta) | ✅ presente (herdado) | `IngestaoPermutasService.ts:119` + `PermutaRelationalRepository.markStale` |
| Self-Test | Ausente no `.sql` — não há passo de auto-teste após backfill que reconfira a invariante nas linhas RESULTADAS (a asserção roda ANTES). Uma checagem pós-UPDATE seria a defesa dupla | ⚠️ parcial | `0054` §4 é pré, §5-§7 é UPDATE — sem `DO $$ IF divergentes > 0 $$` pós-backfill |
| Voting | N/A — sem quórum aplicável aqui | N/A | — |
| Redundancy (spare) | Idempotency-Key + advisory lock + double-check sob lock são redundância lógica contra fan-out duplo | ✅ presente | `EleicaoPermutasService.executar:156-217` |
| Recovery — Rollback (backward) | Migration é **forward-only**: nenhum `.down.sql` publicado; a mutação do `status` é destrutiva (só `motivo_bloqueio` sobrevive). Recuperação depende de PITR do Supabase, não do código do delta | ❌ ausente | `ls src/backend/migrations/*.sql` — nenhum arquivo de reversão |
| Recovery — Forward | `EleicaoPermutasService` recomputa o backlog do zero a cada run: uma run futura corrige naturalmente estados divergentes, desde que o código-alvo esteja no lugar. NÃO cobre o cenário de rollback-de-código (ver F-fault-tolerance-2) | ✅ presente (com ressalva) | `EleicaoPermutasService.computeCandidatas` (recomputação) |
| Reintroduction — Shadow | Ausente — não houve run em shadow antes de cortar o snapshot binário | ❌ ausente | — |
| Reintroduction — State Resync | Cada ingestão faz `markStale` + upsert por chave natural — resync do modelo relacional a partir do Conexos | ✅ presente | `IngestaoPermutasService.ts:100-121` |
| Reintroduction — Escalating Restart | N/A — sem hierarquia de restart no processo | N/A | — |
| Repair State | O 0054 é o repair state para o histórico. As runs novas mantêm o estado íntegro por construção | ✅ presente | `0054_estado_ja_permutado.sql` §5-§7 |
| Idempotent Replay | (a) Idempotency-Key na eleição; (b) idempotência do backfill por `WHERE` que exclui já-migrada + recompute; (c) `chunked` INSERT numa tx só | ✅ presente | `0054` §5-§7 + `EleicaoPermutasService.executar` + `PermutaSnapshotRepository.persistRun` |
| Compensating Transaction | N/A — não há write externo a compensar neste delta (Conexos read-only na eleição). A execução da permuta em `fin010` é outro delta | N/A | — |
| Reconcile | A asserção de reconciliação do 0054 (§4) é o único ponto onde header e snapshot são reconciliados; entre runs, não há job periódico que valide I5 sobre dados históricos | ⚠️ parcial | `0054 §4` (one-shot); sem reconciliação recorrente |
| Quarantine | Ausente para o snapshot — se um `parseStatusSnapshot` lançar em produção, a leitura do painel derruba o request inteiro. Não há segregação por linha corrompida | ⚠️ parcial | `PermutaSnapshotRepository.ts:99-107` (throw, não quarantine) |

## 4. Findings

### F-fault-tolerance-1: Migration destrutiva forward-only, sem rollback nem dump prévio explicitado

- **Severidade**: P1
- **Tactic violada**: Recovery — Rollback (backward)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:158-227`; `src/backend/migrations/runMigrations.ts:44-52`
- **Evidência (objetiva)**:
  ```
  # backfill (§5): UPDATE permuta_adiantamento SET estado_elegibilidade='ja-permutado' WHERE ... AND motivo='ja-permutado'
  # backfill (§6): UPDATE permuta_candidata_snapshot SET status = CASE motivo WHEN ... END WHERE status='bloqueada'   -- 152.516 linhas mutadas
  # backfill (§7): UPDATE permuta_eleicao_run SET total_bloqueadas = ... total_ja_permutado = ... FROM (COUNT FILTER ...)  -- reescreve 64.893 → 51.459
  # ls src/backend/migrations/*.sql | wc -l → 55; grep -l "rollback\|down_" → 0
  ```
- **Impacto técnico**: A migration reescreve destrutivamente o `status` de 152.516 linhas e o `total_bloqueadas` histórico de 250 runs. O valor "antes" do `status` é irrecuperável a partir do banco (apenas `motivo_bloqueio` sobrevive; a reconstrução exige aplicar o mesmo CASE do §6 sobre um snapshot pré-migração — que precisa ter sido feito ANTES). Nenhum `pg_dump` / `CREATE TABLE _bkp AS SELECT` está registrado no arquivo `.sql` nem no `DEPLOY.md`. Se, dias após a aplicação, descobrirmos um motivo cuja classificação estava errada (por exemplo, um `composto-nm` que na verdade deveria virar `permuta-manual` em vez de `casamento-manual`), não há um caminho de rollback simples — a próxima ingestão vai reescrever o modelo relacional, mas as 250 runs históricas do snapshot ficam distorcidas para sempre a menos que se restaure PITR do Supabase.
- **Impacto de negócio**: A séria de "bloqueadas" histórica é o número que já foi consumido pelo relatório de impacto v1 e virou conclusão de negócio (348 itens que eram fila nossa apareciam como passivo de terceiro; ADR-0043 §Contexto). Se o backfill precisar ser corrigido depois, refazer requer downtime de restore + reaplicação, não uma migration `.down`.
- **Métrica de baseline**: 152.516 linhas de snapshot mutadas, 250 headers reescritos, 64.893 → 51.459 no agregado histórico de `total_bloqueadas`, 0 scripts de rollback publicados, 0 menções a backup/PITR no cabeçalho do 0054 ou em `DEPLOY.md`.

### F-fault-tolerance-2: CHECK de `permuta_adiantamento` e do snapshot ficam PERMISSIVAS após a migration — código antigo re-escreve `'bloqueada'` sem violar constraint (deploy/rollback assimétrico)

- **Severidade**: P1
- **Tactic violada**: Sanity Checking (o CHECK pós-migração aceita silenciosamente o comportamento antigo em vez de rejeitá-lo); Recovery — Rollback (backward)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:59-77`; `origin/main` `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts` (versão binária); `origin/main` `src/backend/domain/service/permutas/IngestaoPermutasService.toEstadoRow` (default `'descoberta'`)
- **Evidência (objetiva)**:
  ```
  -- migration 0054, §1 e §2 (CHECK expandidas)
  CHECK (estado_elegibilidade IN ('descoberta','elegivel','bloqueada','casamento-manual','permuta-manual','ja-permutado'))  -- 6 valores
  CHECK (status IN ('elegivel','bloqueada','casamento-manual','permuta-manual','ja-permutado'))                              -- 5 valores

  -- código origin/main (o cenário do rollback de deploy sem rollback de migration):
  //   snapshot insertCandidataChunk: `status_${i}` = candidata.estadoElegibilidade === ELEGIVEL ? 'elegivel' : 'bloqueada'
  //   → escreve 'bloqueada' para casamento-manual, permuta-manual, ja-permutado. CHECK permissiva → passa.
  //   toEstadoRow default → 'descoberta'.
  ```
- **Impacto técnico**: A migration deixa a CHECK **mais permissiva**. Isso é correto para o código NOVO (que grava 5 estados), mas cria uma janela em que:
  1. Um rollback de deploy sem rollback do banco (comum em incidentes) reintroduz o achatamento binário sem gerar erro de constraint — o snapshot volta a mentir silenciosamente.
  2. A próxima ingestão executada pelo código antigo sobrescreve as ~80 linhas de `permuta_adiantamento` promovidas a `'ja-permutado'` de volta para `'bloqueada'`+motivo (o `default: 'descoberta'` do `toEstadoRow` origin/main é ainda pior — mapeia 3 dos 5 estados para `'descoberta'` sem erro de tipo). A divergência é indistinguível de "cliente pagou permuta" no dashboard.
  Não há teste que exija o par (constraint apertada, código-alvo ativo) — a CHECK e o código estão acoplados por convenção, não por invariante do banco.
- **Impacto de negócio**: A promessa central do ciclo (`total_bloqueadas` = 249 real em vez de 677 inflado, ADR-0043 §Contexto) evapora em qualquer incidente que force rollback do FE/BE. O bug corrigido reaparece com **zero sinal de fault** — o operador só percebe quando alguém abre o painel e vê o número inflado voltar.
- **Métrica de baseline**: 5 valores permitidos no `permuta_candidata_snapshot.status_check` pós-0054 vs. 2 valores efetivamente escritos pelo código de `origin/main`; ~80 linhas de `permuta_adiantamento` com `estado_elegibilidade='ja-permutado'` seriam sobrescritas para `'bloqueada'` na primeira ingestão rodada com código antigo; 0 salvaguardas contra deploy/rollback assimétrico (nenhum feature flag, nenhum trigger que rejeite `'bloqueada'` + motivo `'ja-permutado'`).

### F-fault-tolerance-3: Ausência de self-test pós-backfill na 0054 — a asserção de reconciliação roda ANTES das mutações, não depois

- **Severidade**: P2
- **Tactic violada**: Self-Test
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:79-156` (asserção) vs. §5-§7 (mutações posteriores)
- **Evidência (objetiva)**:
  ```
  §4 (linhas 79-156): DO $$ ... IF divergentes > 0 RAISE ...  -- pré-condição sobre o estado ANTES do UPDATE
  §5 (linhas 165-169): UPDATE permuta_adiantamento ...
  §6 (linhas 174-183): UPDATE permuta_candidata_snapshot ...
  §7 (linhas 197-214): UPDATE permuta_eleicao_run ...
  -- Nenhum bloco DO $$ ao final que releia snapshot+header e verifique convergência I5 pós-mutação.
  ```
- **Impacto técnico**: A defesa da premissa está no ANTES. Se um bug de dedução (um estado além dos previstos, um motivo colidindo com dois estados, um `NULL` inesperado) fizer o backfill escrever algo incorreto, o `RAISE` não dispara — a asserção já passou. A implicit-transaction do simple-query protocol garante atomicidade da migration inteira, mas atomicidade não previne conteúdo errado, apenas garante "tudo ou nada". Um segundo bloco `DO $$` ao final — recontar snapshot e comparar com header recém-escrito — reduziria à zero o espaço para escritas silenciosamente inconsistentes.
- **Impacto de negócio**: A invariante I5 é a promessa central do ciclo. Ela nasce protegida por construção **para runs futuras**, mas o histórico só é conferido em pré-condição. Um bug no CASE do §6 que produza classificação errada não gera erro de constraint (a CHECK aceita) nem `RAISE` (a asserção já passou).
- **Métrica de baseline**: 1 bloco `DO $$` na migration; 0 blocos pós-UPDATE que revalidem `total_<s> === COUNT(snapshot WHERE status=s)` linha a linha sobre o estado escrito.

### F-fault-tolerance-4: Atomicidade da migration depende de comportamento não-testado do simple-query protocol

- **Severidade**: P2
- **Tactic violada**: Redundancy / defesa contra regressão
- **Localização**: `src/backend/migrations/runMigrations.ts:44-52`; `src/backend/domain/client/database/PostgreeDatabaseClient.ts:189-203`; header do `0054_estado_ja_permutado.sql:56-65`
- **Evidência (objetiva)**:
  ```
  runMigrations.ts:  await this.databaseClient.insert(sql);  -- envia o arquivo inteiro como um SÓ pool.query(text)
  PostgreeDatabaseClient.query:  pool.query(query)           -- sem params → simple query protocol
  0054 header:      "envia o arquivo inteiro como UM comando simples ao Postgres, que o executa numa transação implícita"
  -- Não há BEGIN; ... COMMIT; explícito no .sql, nem teste que exija que a migration inteira seja atômica.
  ```
- **Impacto técnico**: A atomicidade **está correta** — o PostgreSQL simple-query protocol de fato envolve múltiplos statements num implicit transaction block quando enviados numa única `Query` message, e o `RAISE EXCEPTION` dentro do `DO $$` faz rollback do lote inteiro. Mas este comportamento é um contrato de baixo nível: qualquer refactor do `MigrationRunner` que (a) faça split por `;`, (b) migre para extended query protocol com parâmetros nomeados, ou (c) use `psql -f`, quebra silenciosamente a invariante — sem que nenhum teste falhe. Migrations 0005 e 0012 dependem do mesmo contrato implícito. Um `BEGIN;` / `COMMIT;` explícito no `.sql`, ou um teste no `MigrationRunner` que valide "N statements + RAISE no meio = 0 mutação persistida", tornaria a invariante robusta.
- **Impacto de negócio**: Baixo hoje (o comportamento vale). Ativa-se apenas se alguém alterar o runner sem entender o contrato. Custo de mitigação (envolver o arquivo em `BEGIN;`/`COMMIT;`) é trivial.
- **Métrica de baseline**: 0 testes cobrindo atomicidade multi-statement do `MigrationRunner`; 3 migrations (0005, 0012, 0054) que dependem do contrato implícito.

### F-fault-tolerance-5: Reconciliação I5 não roda periodicamente sobre o histórico — só na migration e nos testes

- **Severidade**: P2
- **Tactic violada**: Reconcile (recorrente)
- **Localização**: `ontology/business-rules/fidelidade-snapshot-eleicao.md`; ausência de job em `src/backend/jobs/` que verifique `header.total_<s> === COUNT(snapshot WHERE status=s)` para todas as runs
- **Evidência (objetiva)**:
  ```
  # grep -rn "total_bloqueadas.*COUNT\|header.*snapshot\|convergencia" src/backend/jobs/ src/backend/domain/service/permutas/
  #  → nenhum job/probe recorrente que audite a invariante I5 sobre o histórico
  ```
- **Impacto técnico**: I5 é garantida por construção nas runs escritas com o código do delta. Não há **detecção** de que uma run futura tenha escapado da invariante (por exemplo, se um bugfix futuro reintroduzir dois caminhos de contagem). O `_watchlist.md` já pauta uma inspeção análoga para `recebimento_ingestao_run` e `pagamento_ingestao_run`.
- **Impacto de negócio**: Sem monitoramento contínuo, uma regressão silenciosa em I5 (por exemplo, um refactor que reintroduza um `filter` avulso no header) só é percebida quando um analista notar contradição no dashboard — o mesmo modo de falha que originou este ciclo.
- **Métrica de baseline**: 3 testes unitários canônicos (`EleicaoPermutasService.test.ts:1236, 1247, 1259`); 0 jobs recorrentes; 0 alertas configurados.

### F-fault-tolerance-6: `parseStatusSnapshot` derruba a leitura inteira do painel se uma linha vier corrompida

- **Severidade**: P3
- **Tactic violada**: Quarantine (containment por linha)
- **Localização**: `src/backend/domain/repository/permutas/PermutaSnapshotRepository.ts:99-107`
- **Evidência (objetiva)**:
  ```
  const parseStatusSnapshot = (bruto: unknown, docCod: string): EstadoElegibilidade => {
      const valor = String(bruto);
      if (ehEstadoElegibilidade(valor)) return valor;
      throw new Error(`snapshot de permuta com status fora da máquina ...`);
  };
  ```
- **Impacto técnico**: A escolha "falhar alto" está bem justificada (evita voltar ao catch-all silencioso). Mas em uma leitura de N linhas (`findLatestSnapshot` retorna centenas), a primeira linha corrompida derruba TODA a leitura — o painel fica offline em vez de mostrar as N-1 linhas válidas mais um badge "1 linha em quarentena". Como o `MotivoBloqueio` sofre o cast oposto (permissivo, taxonomia aberta), há assimetria de contenção não explicada.
- **Impacto de negócio**: Se a CHECK da 0054 falhar em capturar um valor novo (por exemplo, um estado adicional futuro sem migration correspondente), o painel de permutas fica indisponível — degradação de "informação errada" para "sem informação".
- **Métrica de baseline**: 1 `throw` por linha inválida × N linhas na leitura → 1 request 500. Sem contador de linhas em quarentena.

### F-fault-tolerance-7: `runEleicao` error-path grava run de erro num `persistRun` que pode ele mesmo falhar

- **Severidade**: P3
- **Tactic violada**: Idempotent Replay (audit trail em cenário degradado)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts` — bloco catch de `runEleicao` (por volta das linhas 410-430 da versão do delta)
- **Evidência (objetiva)**:
  ```
  } catch (error) {
      const message = ...
      const runId = await this.snapshotRepository.persistRun(
          { flowId, startedAt, finishedAt: new Date(), status: 'error', ..., errorMessage: message },
          [],
      );
      await this.logService.error({ ... });
      throw error;   // se persistRun falhar, o error dele mascara o original
  }
  ```
- **Impacto técnico**: Se o fan-out Conexos falhou por DB temporariamente indisponível, o próprio `persistRun` também falha; o `runId` fica indefinido, o log de erro roda mas sem `snapshotId`, e o erro que sobe é o do `persistRun` (não o do fan-out). O caso é raro (Conexos e Postgres são endpoints diferentes), mas o retry executor do database client (3 tentativas, 200ms delay) mitiga só falhas transientes — uma DB fora do ar por 30s deixa a run sem registro.
- **Impacto de negócio**: Baixo em contexto normal; audit gap teórico em incidente concorrente de DB.
- **Métrica de baseline**: 3 retries × 200ms = ~600ms de tolerância na escrita da run de erro; sem DLQ / fila persistente para o header de erro.

### F-fault-tolerance-8: Assertiva do 0054 usa `NOT EXISTS` para ignorar runs já migradas — comportamento correto, mas silencioso na segunda execução

- **Severidade**: P3
- **Tactic violada**: Sanity Checking (observabilidade)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:132-145`
- **Evidência (objetiva)**:
  ```
  WHERE r.kind = 'eleicao'
    AND NOT EXISTS (
        SELECT 1 FROM permuta_candidata_snapshot j
         WHERE j.run_id = r.id AND j.status NOT IN ('elegivel','bloqueada')
    )
    AND (...divergência...)
  ```
- **Impacto técnico**: O `NOT EXISTS` filtra runs cujo snapshot já foi migrado (status fora do par binário). Isso é a razão de a segunda execução da migration ser no-op no `DO $$` mesmo sem re-verificar. Mas o efeito colateral é: numa segunda execução (por qualquer motivo — script rodado à mão, replay de migration), **nada é validado**. Se alguém executar 0054 depois de uma manipulação parcial do snapshot (por exemplo, um SQL manual reverteu 1 run ao binário mas o resto está no formato novo), a asserção só olha para as revertidas — e passa se elas baterem, sem sinalizar mistura de formatos. Um `RAISE NOTICE` ("verificando N runs binárias, M runs já migradas") daria observabilidade sem quebrar idempotência.
- **Impacto de negócio**: Muito baixo — depende de intervenção manual atípica. Fica como registro para melhoria de observabilidade.
- **Métrica de baseline**: 0 `RAISE NOTICE` na asserção; 1 execução medida em 2026-09-08 com 250 runs no branch legado; comportamento em pós-migration não é logado.

## 5. Cards Kanban

### [fault-tolerance-1] Publicar dump prévio + `.down.sql` para a 0054 antes de aplicá-la em PRD

- **Problema**
  > A migration 0054 muta 152.516 linhas de snapshot e reescreve `total_bloqueadas` histórico de 250 runs (64.893 → 51.459), com destruição do `status` original. Não há script de rollback nem dump prévio explicitado; a recuperação depende inteiramente do PITR do Supabase e do runbook de restore — nenhum deles testado neste contexto. Se descobrirmos um erro de classificação depois da aplicação, refazer requer downtime.

- **Melhoria Proposta**
  > Antes do `MigrationRunner` rodar 0054 em PRD, criar duas defesas: (1) uma migration `0054a_backup_pre_estado_ja_permutado.sql` que faça `CREATE TABLE permuta_candidata_snapshot__pre0054 AS SELECT * FROM permuta_candidata_snapshot` (e idem para `permuta_eleicao_run`), com `IF NOT EXISTS`; (2) um `0054_estado_ja_permutado.down.sql` documentado (mesmo que não seja executado pelo runner) que reconstrua `status` do snapshot a partir do CASE inverso (via `motivo_bloqueio`) e o header do snapshot recomputado. Registrar no cabeçalho do 0054 o comando de PITR e o RTO esperado. Tactic: **Recovery — Rollback (backward)**.

- **Resultado Esperado**
  > Migration destrutiva com par backup+rollback documentado. Métrica observável: presença de `permuta_candidata_snapshot__pre0054` no schema após deploy (temporário; drop opcional após 30d), e um `.down.sql` referenciado no cabeçalho do `.sql` (0 hoje → 1 alvo).

- **Tactic alvo**: Recovery — Rollback (backward)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Tabelas `__pre0054`: 0 → 2 (temporárias, com retenção de 30d)
  - Scripts `.down.sql` publicados: 0 → 1
  - Referência a PITR/backup no cabeçalho de migration destrutiva: 0 → 1
- **Risco de não fazer**: Um erro de classificação percebido semanas depois força restore de PITR do dia da aplicação (perda de dados intermediários) ou reconstrução manual demorada.
- **Dependências**: Nenhuma.

### [fault-tolerance-2] Fechar a janela de deploy/rollback assimétrico (CHECK permissiva + código antigo)

- **Problema**
  > A migration 0054 estende a CHECK de `permuta_candidata_snapshot.status` para 5 valores e a de `permuta_adiantamento.estado_elegibilidade` para 6. O código de `origin/main` grava só `'elegivel'|'bloqueada'` no snapshot e usa `default: 'descoberta'` no `toEstadoRow`. Se o deploy do FE/BE for revertido para `origin/main` sem também reverter a migration (o cenário-padrão de um rollback de emergência), a CHECK aceita a regressão silenciosamente e ~80 linhas promovidas a `ja-permutado` voltam a `'bloqueada'` na primeira ingestão. O bug fixed reaparece com zero sinal.

- **Melhoria Proposta**
  > Duas alternativas em ordem de preferência: (a) adicionar um `CHECK` complementar ou um `TRIGGER BEFORE INSERT/UPDATE` que rejeite `estado_elegibilidade='bloqueada' AND motivo_bloqueio='ja-permutado'` (o combo antigo) e `snapshot.status='bloqueada' AND motivo_bloqueio IN ('composto-nm','cliente-filtro','ja-permutado')` (o combo achatado) — se o código antigo tentar reintroduzir a regressão, o INSERT falha alto; (b) documentar explicitamente em `DEPLOY.md` que rollback do deploy ≠ rollback OK sem rollback do banco, com o comando exato para reverter 0054. Tactic: **Sanity Checking** (constraint aperta o CHECK além do que o SQL declarativo faz) e **Recovery — Rollback**.

- **Resultado Esperado**
  > Deploy/rollback assimétrico deixa de ser silencioso. Métrica observável: se `origin/main` for redeployado sem reverter 0054, a próxima ingestão FALHA com constraint violation em vez de silenciosamente sobrescrever ~80 rows; ou, no mínimo, o runbook do rollback tem passo explícito de reversão.

- **Tactic alvo**: Sanity Checking, Recovery — Rollback (backward)
- **Severidade**: P1
- **Esforço estimado**: M (opção a — trigger + testes de regressão); S (opção b — só doc)
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Cenário "rollback do deploy sem rollback da migration" tratado: hoje 0 defesa → alvo 1 defesa (trigger ou runbook explícito com passo bloqueante)
  - Linhas revertidas silenciosamente por ingestão pós-rollback: até ~80 hoje → 0 (com trigger) ou detectáveis (com runbook)
- **Risco de não fazer**: Em qualquer incidente que force rollback de emergência do BE (bug futuro no fluxo de execução da permuta, por exemplo), o bug do snapshot binário volta silenciosamente. O relatório de impacto v1 já custou uma correção pública; uma repetição custa mais.
- **Dependências**: Nenhuma.

### [fault-tolerance-3] Adicionar `DO $$` de self-test pós-backfill na 0054 (ou numa 0055)

- **Problema**
  > A asserção do 0054 confere o estado ANTES do UPDATE. Se um bug no CASE do §6 produzir classificação errada, nem a asserção nem a CHECK permissiva sinalizam nada. A migration atomiza tudo com sucesso, mas o conteúdo pode estar errado. A invariante I5 é conferida por testes unitários e por construção no código NOVO — o histórico backfilled não é revalidado após a escrita.

- **Melhoria Proposta**
  > Adicionar ao final do 0054 (ou como 0055 imediatamente subsequente, evitando alterar 0054 já aplicada) um bloco `DO $$` que rode a MESMA agregação de `EleicaoPermutasService.contarPorEstado` diretamente em SQL sobre o snapshot recém-mutado, compare com o header recém-recomputado e `RAISE EXCEPTION` se algum `total_<s> <> COUNT(*) FILTER (WHERE status=s)`. Tactic: **Self-Test** e **Sanity Checking**.

- **Resultado Esperado**
  > A convergência I5 sobre o histórico backfilled fica auto-validada: qualquer bug no CASE derruba a migration inteira. Métrica observável: 1 bloco `DO $$` pós-UPDATE que reconfira `total_<s> === COUNT(snapshot WHERE status=s)` para os 5 estados em cada uma das 250 runs.

- **Tactic alvo**: Self-Test, Sanity Checking
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3, F-fault-tolerance-5
- **Métricas de sucesso**:
  - Blocos `DO $$` pós-mutação: 0 → 1
  - Cobertura da invariante I5 sobre histórico: hoje só via pré-condição + reconstrução por motivo → alvo verificação linha a linha pós-UPDATE
- **Risco de não fazer**: Um bug futuro em migration análoga (por exemplo, quando a mesma classe for corrigida para `recebimento_ingestao_run` conforme `_watchlist.md`) fica sem defesa.
- **Dependências**: Nenhuma.

### [fault-tolerance-4] Job periódico de reconciliação I5 sobre todas as runs

- **Problema**
  > A invariante I5 é garantida por construção nas runs escritas pelo código-alvo. Não há job recorrente que audite `header.total_<s> === COUNT(snapshot WHERE status=s)` sobre o histórico — se uma regressão futura reintroduzir divergência silenciosa, ela só será percebida por relato humano.

- **Melhoria Proposta**
  > Novo job `probe-fidelidade-snapshot-eleicao.ts` em `src/backend/jobs/`, agendado diariamente (mesmo cron da ingestão), que rode a agregação de referência sobre `permuta_candidata_snapshot` e compare com `permuta_eleicao_run.total_<s>`. Falhas viram `LogService.error` com `type: BUSINESS_INVARIANT_BROKEN` e listagem das runs divergentes. Tactic: **Reconcile** (recorrente) + **Condition Monitoring**.

- **Resultado Esperado**
  > Divergência silenciosa detectada em ≤ 24h. Métrica observável: presença de linha `probe-fidelidade-snapshot-eleicao` na trilha de execução de jobs em PRD; 0 runs divergentes reportadas.

- **Tactic alvo**: Reconcile, Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-5
- **Métricas de sucesso**:
  - Jobs recorrentes de audit da I5: 0 → 1
  - Runs divergentes reportadas: — → 0 (baseline)
- **Risco de não fazer**: A regressão que este ciclo corrigiu volta a ser descoberta por analista — mesmo modo de falha que originou o ciclo.
- **Dependências**: Nenhuma; pode reusar `job-execucao` (ADR-0042).

### [fault-tolerance-5] Envolver o arquivo de migration em `BEGIN;`/`COMMIT;` explícito e cobrir com teste

- **Problema**
  > A atomicidade da 0054 (e das 0005/0012, que seguem o mesmo padrão) depende do implicit-transaction do simple-query protocol — comportamento correto do PG hoje, mas não coberto por teste. Um refactor futuro do `MigrationRunner` que faça split por `;` ou migre para extended query protocol quebra silenciosamente a atomicidade sem fazer nenhum teste vermelho.

- **Melhoria Proposta**
  > (a) Prefixar cada migration destrutiva com `BEGIN;` e sufixar com `COMMIT;` (o `DO $$ RAISE $$` já rola dentro do próprio bloco, mas `BEGIN;/COMMIT;` explícito torna a atomicidade **declarada** e independente do protocolo do driver). (b) Adicionar teste em `runMigrations.test.ts` que crie uma migration fake com dois `INSERT`s seguidos de `RAISE`, execute pelo runner real, e verifique 0 linhas persistidas. Tactic: **Redundancy** (defesa em profundidade contra regressão de runner).

- **Resultado Esperado**
  > A atomicidade multi-statement passa a ser uma invariante testada, não um efeito colateral não documentado. Métrica observável: 1 teste de atomicidade no `MigrationRunner`; `BEGIN;`/`COMMIT;` explícitos em migrations destrutivas.

- **Tactic alvo**: Redundancy
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Testes de atomicidade do MigrationRunner: 0 → 1
  - Migrations destrutivas com `BEGIN;/COMMIT;` explícitos: 0 → ≥1 (0054 daqui em diante)
- **Risco de não fazer**: Um refactor do runner meses depois quebra a atomicidade de próximas migrations sem que ninguém perceba.
- **Dependências**: Nenhuma.

### [fault-tolerance-6] Contenção linha a linha em `parseStatusSnapshot`: quarentenar em vez de derrubar a leitura

- **Problema**
  > `parseStatusSnapshot` lança `Error` se uma linha do snapshot vier com `status` fora do enum. Uma única linha corrompida derruba a leitura inteira do painel (`findLatestSnapshot` retorna centenas de linhas). Trocaria "informação errada" por "sem informação nenhuma".

- **Melhoria Proposta**
  > Duas alternativas: (a) `parseStatusSnapshot` retorna um sentinel `EstadoElegibilidade | 'quarantine'` e a linha é excluída do resultado com contador `linhasEmQuarentena`, exposto no header da resposta e logado como `BUSINESS_WARN`; (b) manter o `throw` no repositório mas capturar no service caller, degradando para "N linhas em quarentena" na UI. Tactic: **Quarantine**.

- **Resultado Esperado**
  > Snapshot com 1+ linhas corrompidas → painel mostra as N-1 válidas + badge de quarentena. Métrica observável: 0 requests 500 causados por `snapshot fora da máquina de estados` em prod (medida no CloudWatch/Render logs); contador de linhas em quarentena disponível.

- **Tactic alvo**: Quarantine
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-6
- **Métricas de sucesso**:
  - Requests 500 em `/permutas` por parse de status: 0 esperado hoje → 0 mantido com contenção; se houvesse ocorrência, MTTR de "painel offline" cai de N minutos para 0
- **Risco de não fazer**: Muito baixo — se o CHECK da 0054 funcionar, o cenário não ocorre. Vale como defesa contra novas migrations que estendam a máquina sem atualizar a CHECK.
- **Dependências**: Nenhuma.

## 6. Notas do agente

- **Cross-QA (para o `qa-consolidator`)**:
  - F-fault-tolerance-1 e F-fault-tolerance-2 têm implicação forte em **qa-deployability** (rollback de deploy assimétrico; ausência de `.down.sql`) e em **qa-availability** (recovery time do painel após incidente).
  - F-fault-tolerance-3 e F-fault-tolerance-5 conectam com **qa-testability** (falta de teste/probe que exercite a invariante I5 sobre o histórico).
  - F-fault-tolerance-4 conecta com **qa-modifiability** (contrato implícito do MigrationRunner é fragilidade a mudanças futuras).
  - A trilha de auditoria (header com `triggeredBy`/timestamps + snapshot) e a idempotency-key com advisory lock são reforços fortes que **qa-security** vai reconhecer.
- **Decisões de escopo**: por `--quick`, medi apenas o delta. As migrations 0005/0012 (que dependem do mesmo contrato implícito de atomicidade multi-statement) foram citadas mas não re-auditadas.
- **Métricas que não coletei**: MTTR de restore de PITR no Supabase (não medível localmente); cobertura real de logs `BUSINESS_INVARIANT_BROKEN` em PRD (requer CloudWatch/Render).
- **Confirmação do ponto crítico do prompt**: a asserção de reconciliação do 0054 **cobre** as 250 runs `kind='eleicao'` e **corretamente ignora** as 264 runs `kind='ingest'` (sem snapshot rows) — a alegação do autor procede; a asserção roda ANTES das mutações; e a idempotência do backfill foi verificada por leitura do SQL (não por replay), com o cuidado de que o header é RECOMPUTADO (não subtraído), o que preserva idempotência mesmo em replay.
