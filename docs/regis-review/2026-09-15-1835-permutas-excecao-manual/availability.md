---
qa: Availability
qa_slug: availability
run_id: 2026-09-15-1835-permutas-excecao-manual
agent: qa-availability
generated_at: 2026-09-15T18:35:00-03:00
scope: backend
score: 7.5
findings_count: 5
cards_count: 5
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Postgres (pool/conn transiente) | Falha na leitura da tabela de config `permuta_excecao_manual` durante uma run | `EleicaoPermutasService.aplicarExcecoesManuais` → `ExcecaoPermutaRepository.listAtivas()` (chamado em `computeCandidatas`) | Cron `ingest-permutas.yml` 3×/dia (06/12/18 BRT) + botão Ingestão manual (`POST /permutas/ingestao`) + `POST /permutas/eleicao` | Idealmente: tratar `listAtivas` como config table de "baixa consequência" (a ausência dela **não** invalida a eleição — só significa "sem exceções ativas") e emitir `BUSINESS_WARN` fail-open. Atualmente: propaga, `abortController.abort()` e o `flow` da run vai para `error` — 3×/dia perdidas se o transiente coincidir | 0 runs perdidas por erro numa tabela de config de poucas linhas; MTTR ≤ 1 run (a run seguinte às 06:00/12:00/18:00 se recompõe sozinha) |
| Operador do painel (Ana, cliente Columbia) | Erro transiente no `SELECT` da mesma tabela durante `GET /permutas/gestao` | `GestaoPermutasService.exporGestao` → `Promise.all([… (9 leituras), listAtivas])` | Uso normal do painel de Permutas (não é demo) | A leitura da exceção é acessória (só ativa tag/detalhe); alvo: degradar (`excecaoByAdto` vazio + `BUSINESS_WARN`) em vez de derrubar o payload | Painel exibido com dados completos exceto tag "Exceção manual" (0 pendentes ficam invisíveis; só o rótulo some) em vez de 500 → fallback do frontend `fetchGestaoPermutas` sobe o erro na tela |
| Deploy do backend (Render + `BootMigrator`) e/ou passo `npm run migrate` do `ingest-permutas.yml` | Migration 0059 aplicada por 2 caminhos concorrentes (boot da API + step do cron), ambos protegidos por `pg_try_advisory_lock` mas com `VALIDATE CONSTRAINT` sobre `permuta_adiantamento` e `permuta_candidata_snapshot` (tabelas cumulativas de snapshots) | `MigrationRunner.run` → arquivo `0059_excecao_permuta.sql` | Janela de deploy + primeiro cron pós-deploy | Migration idempotente, com `SET LOCAL lock_timeout='30s'` + `statement_timeout='10min'`; ADR-0047 declara "nenhuma linha carrega o motivo novo antes desta migration, então a validação passa" → determinística | Boot não trava indefinidamente (30s teto); Render mantém versão anterior no ar em caso de falha; cron seguinte às 3h reintroduz |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Dependências obrigatórias em `Promise.all` do `exporGestao` (`GET /permutas/gestao`) | 9 (era 8; +`excecaoPermutaRepository.listAtivas()`) | ≥ 1 fallback para leituras de tabelas de config auxiliares | ⚠️ | `src/backend/domain/service/permutas/GestaoPermutasService.ts:81-103` |
| Dependências novas na fase pós-compute da eleição (`computeCandidatas`) | +1 leitura obrigatória (`listAtivas`) sem `try/catch` local | Fail-open com `BUSINESS_WARN` (config table) | ❌ | `EleicaoPermutasService.ts:406, 437` |
| `withTransaction` cobre `insertAtiva` + `reclassificarAdiantamento` (marcar) | Sim — 1 tx única, com `throw` em `reclassificadas === 0` para forçar rollback (concorrência) | Marcar atômico com efeito imediato na linha | ✅ | `ExcecaoPermutaService.ts:135-149` |
| `withTransaction` cobre `softDeleteAtiva` + `reclassificarAdiantamento` (desfazer) | Sim; 0 linhas reclassificadas **não** é erro (exceção inativa) | Desfazer atômico | ✅ | `ExcecaoPermutaService.ts:172-187` |
| Idempotência do `POST /adiantamentos/:docCod/excecao-manual` | Sem `Idempotency-Key`; duplo POST cai no índice parcial → 409 (`UNIQUE_VIOLATION` traduzido) | Aceitar reenvio com mesma key sem 409 | ⚠️ | `ExcecaoPermutaService.ts:151-154, 196-200`; `routes/permutas.ts:452-483` |
| Guarda de identidade (`autor` nulo) | 401 explícito quando não há `sub`/`email` no JWT (I-Exc-4) — nada de `'unknown'` gravado | Bloquear escrita sem identidade | ✅ | `routes/permutas.ts:437-447, 462-466, 492-496` |
| Migration 0059: idempotência (`CREATE TABLE IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`+`ADD`, `CREATE UNIQUE INDEX IF NOT EXISTS`) | Idempotente ponta a ponta; aplicada 2×+ seguidas sem erro (declarado nas tasks) | Idempotência total | ✅ | `src/backend/migrations/0059_excecao_permuta.sql:1-100` |
| Migration 0059: `SET LOCAL lock_timeout='30s'` / `statement_timeout='10min'` (prefixado por `runMigrations.ts`) | Presente para toda migration | Ambos definidos e finitos | ✅ | `src/backend/migrations/runMigrations.ts:26-29` |
| Rollback file `0059_*.rollback.sql` | **Ausente**, por decisão explícita nas tasks (`CREATE TABLE`/`INDEX` + `VALIDATE` sobre CHECKs que os reverses da 0055 derrubam por nome; política do `rollbacks/README.md` só exige reverse para `UPDATE > 1.000` linhas) | Ausente **com justificativa registrada** | ✅ | `ontology/_inbox/permutas-excecao-manual-tasks.md:87-92`; ausência em `src/backend/migrations/rollbacks/` |
| `VALIDATE CONSTRAINT` sobre `permuta_adiantamento` + `permuta_candidata_snapshot` | 2 `ALTER TABLE … VALIDATE CONSTRAINT` em tabelas cumulativas (snapshot inteiro por run, sem TTL de escrita) | `NOT VALID` sem `VALIDATE` **ou** validação em janela fora-de-cron | ⚠️ | `migrations/0059_excecao_permuta.sql:71-100` |
| Migrations aplicadas por 2 caminhos independentes (boot API + step `npm run migrate` do cron) | Boot usa `pg_try_advisory_lock` (`BootMigrator.ts:117-145`); o step do cron **não** — depende do lock do próprio Postgres | Serializar ambos os caminhos | ⚠️ | `.github/workflows/ingest-permutas.yml:44-45`; `BootMigrator.ts:125-145` |
| `BUSINESS_WARN` por exceção inativa (I-Exc-2) | 1 emissão por run **por doc**; 3 runs/dia = 3 warns/doc/dia; sem dedup, sem TTL, sem `retry-suppression` | Suprimir repetição por `(docCod, motivoCalculado)` dentro de uma janela de 24h (dedup) | ⚠️ | `EleicaoPermutasService.ts:443-457`; documentado como intencional em `tasks.md` R3 (`ontology/_inbox/permutas-excecao-manual-tasks.md:145`) |
| Fallback do frontend `fetchGestaoPermutas` (fora de demo) | Erro sobe (`throw`); em `demoMode` retorna fixture — sem meio-termo em produção | Degradar a tag "Exceção manual" sem derrubar o painel (equivalente do `filiaisComFalha` do RelatorioAdiantamento) | ❌ | `src/frontend/lib/api.ts:79-119` |
| MTTR real, taxa de erro `listAtivas`, alarme dedicado no CloudWatch/APM | ⚠️ **Não medível localmente**: sem `infra/` (Terraform é estado-alvo, `CLAUDE.md` §Bootstrap). O `ingest-permutas.yml` já tem passo "Alertar falha (ADR-0042)" via `job:alerta-workflow-falhou`, então falha total do cron **é** alarmada — só não por classe de erro | Instrumentar métrica derivada de `BUSINESS_WARN` (`type=EXCECAO_INAPLICAVEL`) e alarme se `> 1% das runs` falharem em `listAtivas` | ⚠️ | `.github/workflows/ingest-permutas.yml:60-70`; `ontology/decisions/0042-*.md` |

> ⚠️ **Não medível localmente**: MTTR real, taxa de erro por endpoint, alarmes por classe. O repo não tem `infra/` (Terraform é estado-alvo por `CLAUDE.md`). O `detect-staleness.yml` + o step "Alertar falha (ADR-0042)" do próprio `ingest-permutas.yml` cobrem a falha **total** do cron (a análise que aqui é feita distingue "cron morreu" vs "1 leitura de config falhou dentro de um cron que sobreviveria com fail-open").

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Cron `ingest-permutas.yml` roda 3×/dia contra o Conexos + Postgres; falha do workflow dispara `job:alerta-workflow-falhou` (ADR-0042) — cumpre o papel de "eco periódico" para o pipeline como um todo | ✅ presente | `.github/workflows/ingest-permutas.yml:11-13, 60-70` |
| Heartbeat | Não aplicável ao delta (não introduz processo persistente) | N/A | Rota síncrona + cron |
| Monitor | `logService.warn(BUSINESS_WARN)` para exceção inaplicável (transiente vs mudança real); `logService.info(BUSINESS_INFO)` para marcar/desfazer (auditoria); `detect-staleness.yml` para run travada em `running` | ⚠️ parcial | `EleicaoPermutasService.ts:443-457`; `ExcecaoPermutaService.ts:158-163, 189-193` |
| Timestamp | `criado_em`/`removido_em` (`TIMESTAMPTZ`, default `now()`) e o payload `excecaoManual.criadoEm` em ISO; snapshot da run herda o timestamp existente | ✅ presente | `migrations/0059_excecao_permuta.sql:41-49`; `GestaoPermutasService.ts:453-463` |
| Sanity Checking | 3 CHECKs no banco: `char_length(justificativa) BETWEEN 10 AND 500`, pareamento `(removido_em IS NULL) = (removido_por IS NULL)`, e a extensão da guarda de estado colapsado da 0055 para incluir `permutado-fora-do-painel`. `guardaSatisfeita` reusa o MESMO predicado em `aplicarExcecoes` e em `marcar` (I-Exc-1). `reclassificarAdiantamento` só atualiza se `WHERE estado_elegibilidade = $deEstado AND motivo_bloqueio = $deMotivo` casar — bloqueia a corrida silenciosa | ✅ presente | `migrations/0059_excecao_permuta.sql:51-92`; `ExcecaoPermutaService.ts:69-107` |
| Condition Monitoring | Sem contador dedicado para "N runs seguidas com `listAtivas` falhando"; sem métrica derivada da taxa de aviso `EXCECAO_INAPLICAVEL` | ❌ ausente | — |
| Voting | N/A — decisão do analista é única fonte de verdade (não há voto/quórum) | N/A | Config unilateral |
| Exception Detection | `ExcecaoPermutaRecusadaError` tipada com 4 códigos (`EXCECAO_GUARDA_RECUSADA` 422, `ADIANTAMENTO_NAO_ENCONTRADO` 404, `EXCECAO_NAO_ENCONTRADA` 404, `EXCECAO_JA_ATIVA` 409) e `userMessage` pt-BR; `isUniqueViolation` traduz SQLSTATE `23505` em 409 | ✅ presente | `src/backend/domain/errors/ExcecaoPermutaRecusadaError.ts`; `ExcecaoPermutaService.ts:151-154, 196-200` |
| Self-Test | Sem canário/dry-run que verifique periodicamente que `listAtivas` responde e retorna a exceção esperada (só o warn diário emitido pela eleição sinaliza) | ❌ ausente | — |
| Active Redundancy | N/A — instância única | N/A | Render single-region |
| Passive Redundancy | Snapshot de cada run (`permuta_candidata_snapshot`) preserva o resultado auditável e sobrevive à recarga; a próxima run recompõe a linha com base no cálculo + exceção. Cache local do `RelatorioAdiantamento` não muda | ✅ presente | `EleicaoPermutasService.ts:410-413`; `PermutaSnapshotRepository.ts:397-398` |
| Spare | N/A — serverless / single instance | N/A | Render |
| Exception Handling | `try/catch` em torno da tx de `marcar` traduz `23505` (índice parcial) em 409, `throw` em `reclassificadas === 0` reverte tudo. `desfazer` roda a tx e ignora `reclassificadas === 0` (exceção inativa) — comportamento correto e explícito | ✅ presente | `ExcecaoPermutaService.ts:135-156, 172-187` |
| Rollback | `withTransaction` faz rollback automático em `throw` dentro do bloco; o índice parcial (`uq_permuta_excecao_manual_ativa`) impede duplicata durante `insertAtiva`; `reclassificarAdiantamento` com `WHERE de = …` impede sobrescrita cega. Deploy: rollback do binário volta a rota, mas a 0059 fica no banco (a 1ª ingestão do binário antigo reverte o adto 8721 a `bloqueada/sem-saldo-permutar` sem corromper — R4 documentado) | ✅ presente | `ExcecaoPermutaService.ts:135-156`; R4 em `ontology/_inbox/permutas-excecao-manual-tasks.md:146-147` |
| Software Upgrade | Migration idempotente + limites de execução (`lock_timeout=30s`, `statement_timeout=10min`) prefixados a toda migration pelo `runMigrations.ts`. Boot em Render é serializado por `pg_try_advisory_lock` (`BootMigrator`); o step do cron `npm run migrate` **não** compartilha esse advisory lock — depende só do lock do Postgres para não colidir com o boot | ⚠️ parcial | `runMigrations.ts:26-29`; `BootMigrator.ts:117-145`; `.github/workflows/ingest-permutas.yml:44-45` |
| Retry | Sem retry em torno de `listAtivas` (leitura de config) nem em torno de `reclassificarAdiantamento`. O caminho de escrita **não** precisa de retry (o operador retenta pelo botão); o caminho de eleição/cron precisaria de fail-open ou de retry curto para tolerar transiente em `listAtivas` | ⚠️ parcial | `ExcecaoPermutaRepository.ts:28-37`; `EleicaoPermutasService.ts:437` |
| Ignore Faulty Behavior | Deliberadamente **não**: exceção com estado calculado diferente é reportada como aviso (`transiente` explícito para `detail-indisponivel`), o ERP vence (I-Exc-2). Correto — silenciar violaria a ADR-0047 D4 ("o ERP vence") | ✅ presente | `ExcecaoPermutaService.ts:96-104`; `EleicaoPermutasService.ts:443-457` |
| Degradation | Frontend degrada `podeMarcarExcecao` (esconde botão fora do estado permitido); banner `Exceção inativa` na UI. Backend **não** degrada em falha de `listAtivas` — cai para 500 | ⚠️ parcial | `src/frontend/app/permutas/components/format.ts` (helper `podeMarcarExcecao`); `GestaoPermutasService.ts:81-103` |
| Reconfiguration | Aplicação da exceção é um pós-passe reutilizado pela ingestão E pela eleição (mesma coleção `candidatas`), o que evita configuração dupla; a exceção fica "registrada mas inativa" quando o ERP muda, sem exigir reconfiguração manual | ✅ presente | `EleicaoPermutasService.ts:401-413`; ADR-0047 D4 |
| Shadow | N/A — a exceção não roda em paralelo com regra automática rival | N/A | Domínio unilateral |
| State Resynchronization | A cada run a guarda é reavaliada sobre o dado relido: se `valorPermutado > 0`, o motivo do ERP vence; se saldo reaparece, o cálculo vence. Snapshot da run grava o estado inteiro (auditoria) | ✅ presente | ADR-0047 D4; `EleicaoPermutasService.ts:401-413` |
| Escalating Restart | N/A — Render gerencia lifecycle do container | N/A | Fora do delta |
| Non-Stop Forwarding | N/A — sem plane de dados persistente | N/A | — |
| Removal from Service | Deploy do binário novo com boot-migrate em `pg_try_advisory_lock` (Render mantém instância antiga no ar enquanto migration não conclui — `BootMigrator.ts` explica). Boot-migrate falha ⇒ `app.listen` não roda ⇒ Render não mata a antiga | ✅ presente | `BootMigrator.ts` |
| Transactions | `withTransaction` em `marcar`/`desfazer` cobre insert + reclassificação; índice parcial + CHECK de pareamento no schema; SQL 100% parametrizado (Rule #5) | ✅ presente | `ExcecaoPermutaRepository.ts`; `ExcecaoPermutaService.ts:135-187` |
| Predictive Model | Ausente — sem heurística de "operador vai marcar em X" ou de "run tende a falhar" | ❌ ausente | — |
| Exception Prevention | Zod no boundary (`justificativa.trim().min(10).max(500)`) espelha o CHECK do banco; guarda estreita (só `bloqueada/sem-saldo-permutar`) impede que a exceção esconda falta de pagamento, D.I ou invoice; identidade obrigatória (401 sem `sub`/`email`) impede escrita anônima. Migration com `NOT VALID` + `VALIDATE` é o padrão da ADR-0055 que impede downtime em ADD CONSTRAINT | ✅ presente | `routes/permutas.ts:169-171, 462-466`; ADR-0047 D2; `migrations/0059_excecao_permuta.sql:71-100` |
| Increase Competence Set | Reuso do estado `JA_PERMUTADO` (terminal, já suportado desde 0054) — não introduz estado novo na state-machine, então tudo que já sabe fechar `ja-permutado` (BALDE_DO_ESTADO, contarPorEstado, snapshot, export) continua funcionando sem mudança | ✅ presente | ADR-0047 D3; `EstadoElegibilidade.ts:54-95` |

## 4. Findings (achados)

### F-availability-1: `listAtivas` em `computeCandidatas` é fail-closed sem fallback (cron 3×/dia depende de uma tabela de config)

- **Severidade**: P1
- **Tactic violada**: Degradation / Retry (parciais)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:401-413, 437` · repositório em `src/backend/domain/repository/permutas/ExcecaoPermutaRepository.ts:28-37`
- **Evidência (objetiva)**:
  ```ts
  const candidatas = await this.aplicarExcecoesManuais(calculadas, flowId);
  // …
  private aplicarExcecoesManuais = async (calculadas, flowId) => {
      const ativas = await this.excecaoPermutaRepository.listAtivas(); // sem try/catch local
      const docCods = new Set(ativas.map((e) => e.adiantamentoDocCod));
      const { candidatas, avisos } = this.excecaoPermutaService.aplicarExcecoes(calculadas, docCods);
      // …
  };
  ```
  O outer `try/catch` de `computeCandidatas` chama `abortController.abort()` e lança — o cron termina com `error`. O `job:alerta-workflow-falhou` dispara. Mas o resultado do compute (`calculadas`, com fan-out do Conexos já feito) **é descartado**.
- **Impacto técnico**: Um erro transiente no pool de conexões durante `listAtivas` invalida uma run inteira — com o custo do fan-out do Conexos já pago. `permuta_excecao_manual` é config: nas tasks (A5) o delta comprovou que **1 doc-cod** justifica a introdução da tabela. A ausência dela **é** um estado semanticamente equivalente a "sem exceções ativas".
- **Impacto de negócio**: 1 das 3 runs diárias de Columbia pode ser perdida por um blip do Postgres em uma tabela que tem menos linhas que qualquer outra do painel. Fan-out do Conexos re-pago (custo API + latência) na run seguinte. Alarme dispara e cria falso-positivo de "cron caiu".
- **Métrica de baseline**: 0 fallbacks; 1 leitura obrigatória a mais que o ideal em `computeCandidatas`. Alvo defensável: `try/catch` retornando `[]` + `logService.warn(BUSINESS_WARN, message: 'listAtivas indisponível — run seguirá sem exceções manuais nesta rodada')`.

### F-availability-2: `listAtivas` entra em `Promise.all` do `/permutas/gestao` sem `try/catch`, ampliando de 8 para 9 dependências obrigatórias

- **Severidade**: P2
- **Tactic violada**: Degradation
- **Localização**: `src/backend/domain/service/permutas/GestaoPermutasService.ts:81-103`
- **Evidência (objetiva)**:
  ```ts
  const [
      adiantamentos, invoices, casamentos, processamentos, declaracoes,
      alocacoes, ultimaIngestao, consumosByAdto,
      excecoesAtivas, // <-- +1 dep obrigatória sem fallback
  ] = await Promise.all([
      this.relationalRepository.listAdiantamentosAtivos(),
      // …
      this.excecaoPermutaRepository.listAtivas(),
  ]);
  ```
  O frontend `fetchGestaoPermutas` (`src/frontend/lib/api.ts:79-119`) sobe o erro em produção (fixture só em `demoMode`) → painel em branco.
- **Impacto técnico**: Uma falha na leitura de uma tabela onde vive **1 exceção** derruba o painel inteiro (adiantamentos, invoices, casamentos, processamentos, declarações, alocações — tudo). Assimetria: as outras 8 dependências são a **carteira**; esta é rótulo/detalhe.
- **Impacto de negócio**: A analista abre a tela e vê erro genérico ("API 500") em vez do painel funcional (com ou sem a tag "Exceção manual"). O caminho de reparar/analisar o próprio 8721 fica bloqueado por um transiente em outra transação.
- **Métrica de baseline**: 9 dependências obrigatórias no `Promise.all`, 0 fallbacks. Alvo defensável: encapsular `listAtivas()` num `try/catch` local que devolve `[]` e emite `BUSINESS_WARN` — a UI perde a tag mas mostra a carteira; mesma tática usada para `filiaisComFalha` no `RelatorioAdiantamentoService` do fluxo Contas a Pagar (`_shared-metrics` da run 2026-08-31-1435).

### F-availability-3: Migration 0059 aplicada por 2 caminhos independentes (boot da API + step `npm run migrate` do cron) sem advisory lock compartilhado

- **Severidade**: P2
- **Tactic violada**: Software Upgrade (Reintroduction)
- **Localização**: `.github/workflows/ingest-permutas.yml:44-45` (`npm run migrate`) e `src/backend/migrations/BootMigrator.ts:117-145` (`pg_try_advisory_lock`)
- **Evidência (objetiva)**:
  ```yaml
  - name: Aplicar migrations pendentes (idempotente)
    run: npm run migrate
  - name: Ingestão de permutas
    run: npm run job:ingest-permutas
  ```
  O `npm run migrate` do workflow chama `MigrationRunner.run` diretamente, **sem** passar pelo `BootMigrator.comLock` (o wrapper que usa `pg_try_advisory_lock` para serializar). Se um deploy na Render iniciar `BootMigrator` ao mesmo tempo que o cron rodar `npm run migrate`, os dois competem pelo lock do Postgres (30s `lock_timeout`, migrations idempotentes evitam corrupção, mas o mais lento morre com erro).
- **Impacto técnico**: Janela pequena de colisão (deploy + 06:00/12:00/18:00 BRT). Idempotência protege o schema; mas o cron pode falhar exatamente na primeira run pós-deploy — quando o operador mais quer ver o dashboard atualizado.
- **Impacto de negócio**: Baixo em regime, alto em incidente: rebase/deploy no meio da tarde + cron das 18h coincidindo é o cenário em que o operador liga pedindo "cadê o cron?".
- **Métrica de baseline**: 2 caminhos de migração; 1 usa advisory lock; 1 não. Alvo: `npm run migrate` do workflow também passar pelo `BootMigrator.comLock` (ou lock equivalente).

### F-availability-4: `VALIDATE CONSTRAINT` da 0059 sobre `permuta_adiantamento` e `permuta_candidata_snapshot` — tabelas cumulativas

- **Severidade**: P2
- **Tactic violada**: Software Upgrade / Prevent Faults (Increase Competence Set)
- **Localização**: `src/backend/migrations/0059_excecao_permuta.sql:71-100`
- **Evidência (objetiva)**:
  ```sql
  ALTER TABLE permuta_adiantamento
      ADD CONSTRAINT permuta_adiantamento_sem_estado_colapsado
          CHECK (NOT (estado_elegibilidade = 'bloqueada'
                      AND motivo_bloqueio IN ('ja-permutado','permutado-fora-do-painel')))
          NOT VALID;
  -- …
  ALTER TABLE permuta_adiantamento
      VALIDATE CONSTRAINT permuta_adiantamento_sem_estado_colapsado;
  ALTER TABLE permuta_candidata_snapshot
      VALIDATE CONSTRAINT permuta_candidata_snapshot_sem_status_colapsado;
  ```
  A `VALIDATE CONSTRAINT` sob `SHARE UPDATE EXCLUSIVE` faz varredura sequencial. `permuta_candidata_snapshot` é cumulativo (uma linha por adto por run — em regime, 3 runs/dia × N adtos), sem TTL de escrita no delta. Comentário da ADR-0047 declara a validação determinística ("nenhuma linha carrega o motivo novo antes desta migration"), então correção é garantida; mas o **tempo de execução** cresce com o tamanho do snapshot histórico.
- **Impacto técnico**: Em ~1 ano de operação o snapshot pode ter dezenas de milhares de linhas. Ainda dentro dos 10min de `statement_timeout`, mas a janela cresce.
- **Impacto de negócio**: Baixo hoje (tabelas jovens); atenção para quando o backlog acumular. Sem rollback file (decisão registrada em Task 2 AC), uma `VALIDATE` que estoure `statement_timeout` no futuro exigirá intervenção manual.
- **Métrica de baseline**: 2× `VALIDATE CONSTRAINT` full-scan; 0 mecanismos de sharding/TTL no delta. Alvo defensável: (a) manter só `NOT VALID` (a integridade fica garantida para linhas novas, e as antigas já são consistentes por construção); ou (b) ADR que rediscuta TTL do snapshot antes de 0060.

### F-availability-5: `BUSINESS_WARN` por exceção inativa sem dedup — 3×/dia por doc, geraria alert-fatigue em escala

- **Severidade**: P3
- **Tactic violada**: Condition Monitoring / Ignore Faulty Behavior (repetição não-actionable)
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.ts:443-457`
- **Evidência (objetiva)**:
  ```ts
  for (const aviso of avisos) {
      await this.logService.warn({
          type: LOG_TYPE.BUSINESS_WARN,
          message: aviso.transiente
              ? 'Exceção manual … detalhe do Conexos indisponível nesta run (transitório …)'
              : 'Exceção manual … estado calculado mudou no ERP (…)',
          data: { flowId, docCod: aviso.docCod, estadoCalculado, motivoCalculado, transiente },
      });
  }
  ```
  R3 nas tasks (`permutas-excecao-manual-tasks.md:145`) declara **intencionalmente**: "exceção inativa gera 1 `BUSINESS_WARN` por run (3×/dia) até ser desfeita". Enquanto for 1 doc é irrelevante; para 20 docs seria 60 warns/dia da mesma classe.
- **Impacto técnico**: Sem dedup por `(docCod, motivoCalculado)`, log cresce linearmente com N × 3/dia. Sem métrica derivada, ninguém distinguirá "sinal novo" de "ruído acumulado".
- **Impacto de negócio**: Baixo em regime atual (1 doc). Vira ruído quando N exceções ficarem "inativas" ao longo do tempo (ex.: o operador esqueceu de desfazer 5 exceções antigas — vira 15 warns/dia).
- **Métrica de baseline**: 1 warn / run / doc; 0 dedup. Alvo: dedup por `(docCod, motivoCalculado)` em janela 24h (ou métrica agregada + alarme só quando o **volume** subir).

## 5. Cards Kanban

### [availability-1] Fail-open em `listAtivas` da eleição/cron com `BUSINESS_WARN`

- **Problema**
  > `EleicaoPermutasService.aplicarExcecoesManuais` (`EleicaoPermutasService.ts:437`) chama `excecaoPermutaRepository.listAtivas()` fora de qualquer `try/catch` local. Um erro transiente do Postgres em uma tabela de config com pouquíssimas linhas (`permuta_excecao_manual`) invalida a run inteira, descarta o resultado do fan-out do Conexos e dispara o `job:alerta-workflow-falhou` como se o cron estivesse quebrado. A ausência do dado é semanticamente equivalente a "sem exceções manuais nesta run", que é o estado do sistema em 99% do backlog (o 8721 é um caso).

- **Melhoria Proposta**
  > Encapsular `listAtivas()` em `try/catch` dentro de `aplicarExcecoesManuais`; em caso de erro, `logService.warn({ type: LOG_TYPE.BUSINESS_WARN, message: 'listAtivas indisponível — run seguirá sem exceções manuais nesta rodada', data: { flowId, cause } })` e retornar `calculadas` intocado. Espelhar o padrão de `filiaisComFalha` do `RelatorioAdiantamentoService` do Fluxo Financeiro (Regis-Review 2026-08-31-1435, F-availability e §3 Degradation). Adicionar teste em `EleicaoPermutasService.test.ts` que injeta `listAtivas` lançando `Error('conn reset')` e verifica: (i) `computeCandidatas` retorna com sucesso; (ii) 1 warn emitido; (iii) `totals` calculado sobre `calculadas` original.

- **Resultado Esperado**
  > Blip transiente em `permuta_excecao_manual` não invalida run 3×/dia da Columbia. A tela do painel reflete o cálculo (sem tag "Exceção manual"), e a run seguinte aplica de novo automaticamente. Métrica: runs perdidas por erro em `listAtivas` = potencialmente 3/dia → 0.

- **Tactic alvo**: Degradation + Ignore Faulty Behavior (só para leitura de config)
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Dependências obrigatórias em `computeCandidatas` sem fallback: +1 → 0
  - Runs interrompidas por erro em tabela de config: baseline atual (⚠️ não medível localmente) → 0
- **Risco de não fazer**: Um transiente no Postgres na hora do cron interrompe a ingestão da Columbia. O operador reclama, o alarme de ADR-0042 acorda o time e o problema é "reiniciar o cron" — trabalho de análise por engano evitável.
- **Dependências**: Nenhuma.

### [availability-2] Fail-open em `listAtivas` do `GET /permutas/gestao`

- **Problema**
  > `GestaoPermutasService.exporGestao` (`GestaoPermutasService.ts:81-103`) coloca `excecaoPermutaRepository.listAtivas()` como 9ª dependência de um `Promise.all` sem `try/catch` local. Se ela falha, o `GET /permutas/gestao` cai para 500 — e `fetchGestaoPermutas` do frontend (fora de `demoMode`) propaga o erro, deixando a tela sem carteira. Assimetria: a exceção manual controla um **rótulo** de 1 linha, não a carteira inteira.

- **Melhoria Proposta**
  > Extrair `listAtivas()` do `Promise.all` para um `try/catch` isolado antes de compor `excecaoByAdto`. Em erro, `excecoesAtivas = []`, `excecaoByAdto = new Map()` e `logService.warn(BUSINESS_WARN, 'exceções manuais indisponíveis nesta leitura — painel exibido sem as tags')`. Efeito na UI: a tag "Exceção manual" some naquela leitura; ao clicar "Atualizar" (`load()`), na tentativa seguinte a tag reaparece. Sem quebrar o `TypeScript`/`Zod` do payload — `excecaoManual` é opcional.

- **Resultado Esperado**
  > A analista sempre vê a carteira, mesmo quando a leitura de exceções falha transientemente. Métrica: painéis servidos com dados parciais em vez de 500 (⚠️ não medível localmente sem instrumentação) → objetivo qualitativo.

- **Tactic alvo**: Degradation (parcial visível)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Dependências obrigatórias em `exporGestao`: 9 → 8 + 1 opcional
  - Códigos-fim do `GET /permutas/gestao` atribuíveis a `listAtivas` falhando: baseline atual → 0
- **Risco de não fazer**: Painel de permutas cai por conta de uma tabela de rótulo. Amplia superfície sem contramedida — cada rota nova que compõe `Promise.all` sem fallback repete o padrão.
- **Dependências**: Nenhuma; pode ir junto com [availability-1] no mesmo commit.

### [availability-3] Serializar `npm run migrate` do cron pelo mesmo advisory lock do boot

- **Problema**
  > `.github/workflows/ingest-permutas.yml:44-45` chama `npm run migrate` direto no `MigrationRunner.run`, **fora** do `BootMigrator.comLock` (que usa `pg_try_advisory_lock` — `BootMigrator.ts:117-145`). O deploy da API (que executa boot-migrate) pode coincidir com o cron das 06/12/18 BRT rodando o mesmo step. Migrations são idempotentes, então não há corrupção — mas o mais lento morre com erro de lock, e o cron fica marcado como "failed" na Actions.

- **Melhoria Proposta**
  > Trocar o script `migrate` (ou o step do workflow) para invocar o mesmo caminho do `BootMigrator` (`pg_try_advisory_lock(BOOT_MIGRATION_LOCK_KEY)` + espera com `LOCK_ATTEMPTS`). Alternativa mais leve: acrescentar `pg_advisory_lock` no início do runner do cron. Cobrir com teste de integração local (opcional): 2 processos concorrentes rodam `npm run migrate` — o segundo espera até o primeiro terminar em vez de falhar.

- **Resultado Esperado**
  > Cron não falha por colisão com boot-migrate; janela de deploy deixa de ser "não fazer deploy perto do topo da hora". Métrica: falhas do cron atribuíveis a lock (⚠️ não medível localmente) → 0.

- **Tactic alvo**: Software Upgrade (Reintroduction)
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Caminhos de migração serializados por advisory lock: 1 de 2 → 2 de 2
- **Risco de não fazer**: Deploy em janelas próximas ao topo da hora ficam contraindicados, criando gate operacional invisível.
- **Dependências**: Nenhuma.

### [availability-4] Rediscutir necessidade de `VALIDATE CONSTRAINT` retroativo em `permuta_candidata_snapshot`

- **Problema**
  > A migration 0059 executa `VALIDATE CONSTRAINT` em `permuta_adiantamento` e `permuta_candidata_snapshot` (`0059_excecao_permuta.sql:96-100`). A ADR-0047 declara determinística ("nenhuma linha carrega o motivo novo antes desta migration") — mas o custo do full-scan cresce com o histórico do snapshot, que hoje não tem TTL de escrita no delta. Sem rollback file (decisão registrada em Task 2 AC), uma `VALIDATE` que estoure `statement_timeout='10min'` no futuro exige intervenção manual no banco.

- **Melhoria Proposta**
  > Duas opções, decidir por ADR-companion ao 0047:
  > 1. **Manter só `NOT VALID`** para as CHECKs — a garantia continua para linhas novas (que é o objetivo defensivo) e as antigas já são consistentes por construção. Custo: `VALIDATE CONSTRAINT` fica pendente e o `pg_dump` sinaliza `NOT VALID`.
  > 2. **Manter o `VALIDATE`** mas escrever ADR que documente TTL/rotação de `permuta_candidata_snapshot` antes da 0060 (que seria o cenário-alvo).
  > Documentar a decisão em `ontology/decisions/0047-*.md` (§Consequências).

- **Resultado Esperado**
  > Migrações futuras não pagam o custo cumulativo do snapshot; ou o custo é reconhecido e limitado por política de retenção. Métrica: `VALIDATE CONSTRAINT` full-scans em migrations futuras: baseline atual (⚠️ não medível localmente) → 0 (ou dentro de janela documentada).

- **Tactic alvo**: Software Upgrade (Prevent Faults)
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Tempo de `VALIDATE CONSTRAINT` sobre `permuta_candidata_snapshot`: ⚠️ não medível localmente
- **Risco de não fazer**: Migration `NNNN_extender_a_guarda_de_novo` (equivalente ao padrão da 0055/0059) pode estourar `statement_timeout` em 12–18 meses, exigindo intervenção manual no banco de produção.
- **Dependências**: Nenhuma no delta; a ADR-companion deveria acompanhar 0047 (mesma frente).

### [availability-5] Dedup de `BUSINESS_WARN` por exceção inativa (`(docCod, motivoCalculado)` em 24h)

- **Problema**
  > `EleicaoPermutasService.ts:443-457` emite 1 `BUSINESS_WARN` por run por doc-cod inativo, sem dedup. R3 nas tasks documenta isso como intencional. Enquanto for 1 doc é irrelevante; à medida que exceções antigas acumulam ("registrada, não aplicada"), o log vira ruído — 3 warns/dia por doc, sem TTL.

- **Melhoria Proposta**
  > Adicionar coluna `warn_dedup_ate TIMESTAMPTZ` na tabela `permuta_excecao_manual` (ou tabela separada `permuta_excecao_warn`, se o schema puro deve ficar limpo), atualizada a cada emissão para `now() + interval '24 hours'`. `aplicarExcecoesManuais` só emite o warn quando `warn_dedup_ate IS NULL OR warn_dedup_ate < now()`. Alternativa mais leve: cache em memória (`Map<docCod, expiry>`) — sobrevive só à Lambda/instância, o que é aceitável para dedup de ruído.

- **Resultado Esperado**
  > Warns por exceção inativa: 3/dia/doc → ≤ 1/dia/doc, sem perder o sinal (a repetição diária ainda existe, só menos frequente que o cron).

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Warns/dia/doc para exceção inativa: 3 → ≤ 1
- **Risco de não fazer**: Log noise cresce linearmente com o backlog de exceções esquecidas. Detecção de novos casos fica no meio de repetições antigas.
- **Dependências**: Nenhuma.

## 6. Notas do agente

- **Decisão de escopo**: focado no delta (`origin/main..HEAD`, 9 commits). Não recoletei métricas globais do repositório; onde precisei de comparação, referenciei a run anterior de Permutas (`2026-08-31-1435`, `availability.md`) e a `ontology/decisions/0047-*.md`.
- **Não medível localmente**: MTTR real, taxa de erro por endpoint, alarme por classe de warn — repo não tem `infra/` (Terraform estado-alvo, `CLAUDE.md` §Bootstrap). Nenhum P0/P1 foi baseado nessas métricas ausentes; o P1 tem baseline concreto no diff.
- **Fatos positivos do delta**: `withTransaction` cobre marcar/desfazer com rollback em `reclassificadas === 0`; `guardaSatisfeita` é predicado ÚNICO reusado em `aplicarExcecoes` + `marcar` (fonte única, tática Sanity Checking); ADR-0047 D4 ("o ERP vence") é implementada como aviso não-invasivo em vez de silenciar; identidade obrigatória (401) impede escrita anônima (`autor='unknown'` foi banido — I-Exc-4).
- **Correlação cross-QA para o consolidator**: F-availability-3 tem eco em **deployability** (2 caminhos de migração + 1 sem lock); F-availability-4 mora em **modifiability** (política de retenção do snapshot deveria virar ADR antes de a próxima extensão de CHECK acumular custo); F-availability-5 é gêmeo de **testability** (métrica derivada do warn é o que provaria SLO).
- **Migration 0059 idempotente e minimamente invasiva** é o feito arquitetural do delta — a extensão da 0055 para incluir `permutado-fora-do-painel` mantém o reverse da 0054/0055 correto sem código novo de rollback (Task 2 AC verifica `git diff --stat migrations/005[45]*` vazio).
