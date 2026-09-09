---
qa: Testability
qa_slug: testability
run_id: 2026-09-08-2011
agent: qa-testability
generated_at: 2026-09-08T20:35:00Z
scope: backend
score: 7.5
findings_count: 7
cards_count: 5
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista da Kavex modifica a taxonomia de estados da elegibilidade (adiciona `ja-permutado`, muda a definição de "bloqueada") | Uma mudança que atravessa 4 camadas: enum → schema (CHECK) → repositório (write + read) → agregador de header → apresentação | Delta da branch `fix/permuta-snapshot-estados`: `PermutaSnapshotRepository`, `PermutaRelationalRepository`, `EleicaoPermutasService`, `IngestaoPermutasService`, `GestaoPermutasService`, `migrations/0054_estado_ja_permutado.sql` | Desenvolvimento local com Jest + ts-jest e mocks de `PostgreeDatabaseClient`; sem harness de Postgres real. Migration roda pelo `MigrationRunner` em boot no Render. | O engenheiro consegue provar em unidade que (1) a invariante I5 (header ↔ snapshot) segura para o caso canônico dos 5 estados, (2) a nova coluna `status` propaga íntegra em cada uma das 4 camadas, (3) a migration é idempotente e aborta em divergência, e (4) o próximo estado novo quebra o build em vez de sumir em silêncio. | 5/5 estados exercitados no caso canônico; ≥1 teste asserindo header==COUNT(snapshot); 1 asserção `never` de exaustividade por switch sobre estado; ≥1 teste de re-execução da migration provando no-op na 2ª vez; RTO da suíte < 30s. |

Contra-caso concreto que este ciclo trata: o bug que motivou o delta atravessou 3 camadas em silêncio (write `insertCandidataChunk`, read `mapSnapshotRow`, ingestão `toEstadoRow` com `default: 'descoberta'`) e ficou invisível 3 meses (677 reportadas × 249 reais, 2,72× de inflação). A testabilidade que impedia esse silêncio era estrutural: um `default` genérico numa cadeia de mapeamento passava build sem alarme.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes por camada — arquivos `.test.ts` tocados vs sources tocados no delta | Repository permutas: 3/3 (100%). Service permutas: 5/5 (100%). Migration 0054: **0/1 (0%)** | ≥ 0.5 por camada; migration não-trivial (>50 LOC ou backfill) exige ≥1 teste | ⚠️ Migration sem teste | `git diff --stat origin/main` (metrics)  |
| Testes novos no delta (`it`/`test` count) | Snapshot repo +7 · Eleicao +5 · Elegibilidade +2 · Relational +3 · Ingestao +1 · Gestao +1 · Routes −2 · Painel deletado −2 · JobRunReadModel 0 (só fixture) = **+15 no delta** | ≥ +10 para um delta que altera invariante de projeção em 6 arquivos | ✅ | `grep -cE '^\s*(it\|test)\(' <file>` × 8 arquivos, antes/depois |
| Suíte agregada backend | 122 suítes / **1745** testes (baseline 1723 → +22) | +N > 0, gate verde | ✅ | `_shared-metrics.md` |
| Cobertura backend (`--coverage`) | Não coletada | 88% lines em `domain/service/` (threshold enforçado no `jest.config.cjs`) | ⚠️ Não medível localmente | Modo `--quick` explícito; `jest.config.cjs:34` (`coverageThreshold`) |
| Caso canônico dos 5 estados existe e passa | Existe em 2 lugares: `PermutaSnapshotRepository.test.ts:265` (`CASO CANÔNICO: 5 candidatas em 5 estados → 5 linhas com 5 status DISTINTOS`) e `EleicaoPermutasService.test.ts:1236` (`grava 5 linhas de snapshot com 5 status DISTINTOS`) | ≥1 teste asserindo 5 status distintos + `total_bloqueadas`=1 na run canônica | ✅ | `EleicaoPermutasService.test.ts:1249` prova `totalBloqueadas === 1` diretamente |
| Convergência I5 testada contra service+repo REAIS | ✅ `EleicaoPermutasService.test.ts:1259` (`convergência I5 (cláusula 2)`) instancia `new PermutaSnapshotRepository(clientMock)` + `new ElegibilidadeService(...)` e compara `headerParams[coluna]` contra `COUNT(status_i === estado)` dentro do MESMO `mock.calls` da transação | Real repo + real service, DB client mockado, asserção sobre parâmetros dos 2 INSERTs da mesma transação | ✅ | `EleicaoPermutasService.test.ts:1082-1281` |
| Convergência testada com >1 formato de input | 1 input canônico (5 estados, 1 candidata cada) | ≥3 formatos distintos (canônico, all-elegivel, empty, N>500) OU `fast-check` sobre a invariante | ❌ | Grep `fc\.\\|fast-check` retorna 0 no backend |
| Exaustividade compilada (`switch` + `: never`) — cobertura sobre sítios que despacham por estado | 1/6 sítios (só `IngestaoPermutasService.toEstadoRow:273-289`). Demais sítios usam `===` encadeado / ternário: `GestaoPermutasService.statusDoEstado:266` (ternário `descoberta ? bloqueada : estado`), `GestaoPermutasService:100/176-180/284/291/299/318-324/337` (7 comparações `===`), `EleicaoPermutasService:776/809` (2 `===`), `AlocacaoPermutasService:206/361` (2 `===`) | 100% dos sítios que despacham/filtram por estado devem falhar-alto na adição de um estado novo | ⚠️ Parcial | `grep -rn 'estadoElegibilidade' domain/service/permutas` |
| Fail-loud na leitura (specialized-interface): parsers de estado que ABORTAM em valor desconhecido | 2/2 sítios de leitura têm parser fail-loud e teste dedicado: `PermutaSnapshotRepository.ts:103` (`parseStatusSnapshot`) + teste `status fora do enum FALHA ALTO na leitura` (linha 336); `PermutaRelationalRepository.ts:54` (`parseEstadoElegibilidadeRow`) + teste `estado_elegibilidade fora do domínio FALHA ALTO na leitura — sem 'as' cego` | 100% dos parsers de estado devem rejeitar valor fora do enum com erro instrumentado | ✅ | Vistoriado nos dois arquivos e no diff dos testes |
| Migration 0054 — teste automatizado da idempotência / RAISE EXCEPTION | 0 testes. `BootMigrator.test.ts` cobre o RUNNER (lock, propagação de erro), não o CONTEÚDO SQL da migration. Não existe `docker-compose.test.yml`, `--group integration` no Jest, nem harness de test-pg. Referência a "0054" só em comentário (`GestaoPermutasService.test.ts:584`) | ≥1 teste que aplique a 0054 duas vezes num Postgres real e prove no-op na 2ª aplicação; ≥1 teste que injete uma row divergente e prove que `RAISE EXCEPTION` dispara | ❌ | `find … -name BootMigrator.test.ts` + `grep 152516\|64893\|51459` retornam 0 correspondências úteis |
| Tempo real em serviços (não-determinismo) | 8 chamadas `new Date()` / `Date.now()` em `IngestaoPermutasService.ts` (5×) + `EleicaoPermutasService.ts` (3×) — todas pré-existentes ao delta | Injetar `ClockProvider` para congelar em teste | ⚠️ Pré-existente (não introduzido por este delta) | `grep -n 'new Date()\|Date.now'` em service/permutas |
| Teste era falso-verde antes deste delta (regressão de testabilidade corrigida) | Sim: o probe de RBAC em `routes/permutas.test.ts` (removido pelo delta) mockava `PainelService` com o método ERRADO (`montarPainel` em vez de `exporNoPainel`), a rota estourava 500, e o `expect(leitura.status).not.toBe(403)` passava POR ACIDENTE sem exercitar o caminho não-gateado. O delta substitui por probe real (linha ~630) que responde 200. | 0 testes assertando por acidente | ✅ Corrigido no delta | Diff em `routes/permutas.test.ts` linhas 628-655 |
| Frontend tocado no delta | 0 arquivos | — | N/A (delta backend-only) | `_shared-metrics.md` |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `PermutaSnapshotRepository` expõe `persistRun`, `findRunSummaryById`, `findRunIdByIdempotencyKey`, `findLatestSnapshot` como métodos discretos e injetáveis via tsyringe. Parsers dedicados (`parseStatusSnapshot`, `parseEstadoElegibilidadeRow`) isolam narrowing tipado. | ✅ | `PermutaSnapshotRepository.ts:78-83` (`@injectable`); `EleicaoPermutasService.test.ts:1097` monta o repo real com `new PermutaSnapshotRepository(client)` sem precisar de container. |
| Record/Playback (Recordable Test Cases) | Ausente para o retorno do Conexos que alimenta a eleição. `buildConexos()` em `EleicaoPermutasService.test.ts:71` usa fixture inline pequena; sem `__fixtures__/*.json` gravados de PRD. | ❌ | `find … -name "__fixtures__" -path "*permutas*"` retorna vazio (só existe em `interface/sispag/__fixtures__/`). |
| Sandbox | Único sandbox real é o mock do `PostgreeDatabaseClient` (in-memory). Sem sandbox Postgres (nenhum `docker-compose.test.yml`, nenhum testcontainer). Migration 0054 não tem sandbox onde re-executar. | ⚠️ | `find … -name "docker-compose*"` vazio; `BootMigrator.test.ts` mocka `MigrationRunnerInterface`, não roda SQL. |
| Executable Assertions | Encoded no domínio: `parseStatusSnapshot` (`PermutaSnapshotRepository.ts:103`) e `parseEstadoElegibilidadeRow` (`PermutaRelationalRepository.ts:54`) abortam em valor fora do enum com mensagem instrumentada. `contarPorEstado` (`EleicaoPermutasService.ts:976`) é a fonte única de contagem por construção. RAISE EXCEPTION no `DO $$` da migration 0054 é uma asserção executável em SQL. | ✅ | Testes existem para os parsers (snapshot linha 336, relational linha 372). |
| Abstract Data Sources | `PostgreeDatabaseClient` é abstraído via tsyringe; `withTransaction` recebe callback (permite mock captura de INSERTs da tx). Time (`new Date()`) NÃO é abstraído — não há `ClockProvider`. | ⚠️ Parcial | DB: `buildDb()` com `withTransaction: jest.fn(async (fn) => fn(tx))` funciona limpo. Clock: 8 sítios `new Date()`/`Date.now` em service/permutas sem porta. |
| Limit Structural Complexity | `contarPorEstado` centraliza a contagem numa função só, alimentando header e persist pela mesma coleção `candidatas` (`EleicaoPermutasService.ts:355 + 382`) — a convergência I5 é por construção, não coincidência. Exhaustiveness com `: never` em `IngestaoPermutasService.toEstadoRow` (`:287`). | ✅ para eleição; ⚠️ para o resto (demais 5 sítios usam `===` encadeado sem sentinela `never`) | `grep -rn ':\s*never\s*=' domain/service` retorna só o `IngestaoPermutasService`. |
| Limit Non-Determinism | Tempo lido diretamente do relógio (`new Date()`, `Date.now()`) em 8 sítios de service/permutas. Pré-existente ao delta, mas continua atrapalhando qualquer teste que queira asserir `durationMs`, `startedAt`, `finishedAt` sem magia (`jest.useFakeTimers`). Nenhum teste do delta congela tempo. | ⚠️ | `grep -n 'new Date()\|Date.now'` em Eleicao/Ingestao/Snapshot. |

## 4. Findings (achados)

### F-testability-1: Migration `0054_estado_ja_permutado.sql` (227 LOC, backfill de 152.516 linhas) sem NENHUM teste automatizado

- **Severidade**: P1
- **Tactic violada**: Sandbox / Recordable Test Cases / Executable Assertions
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql` (nova, 227 linhas); `src/backend/migrations/BootMigrator.test.ts` (testa o RUNNER, não a migration)
- **Evidência (objetiva)**:
  ```
  find src/backend/migrations -name '*.test.ts'
    → BootMigrator.test.ts (mocka MigrationRunnerInterface, não executa SQL)
  find … -name 'docker-compose*'          → vazio
  grep -rn '0054\|estado_ja_permutado' src/backend/**/*.test.ts
    → apenas 1 hit em GestaoPermutasService.test.ts:584 — comentário, não teste
  ```
  A migration escreve, em sequência: DDL de CHECK (2 tabelas), asserção `DO $$ … RAISE EXCEPTION $$` que aborta se qualquer run divergir, e 3 UPDATEs de backfill (`permuta_adiantamento` ~80 rows, `permuta_candidata_snapshot` 152.516 rows, `permuta_eleicao_run` 250 rows recomputadas). O próprio arquivo (linhas 55-64) reivindica: *"Rodar duas vezes seguidas é no-op na segunda, `total_bloqueadas` incluído."* — reivindicação **não testada**.
- **Impacto técnico**: (1) a próxima pessoa que precisar re-verificar a migration (rollback, novo tenant, staging) refaz o setup à mão (dump + apply + query); (2) o guard `RAISE EXCEPTION` só é exercitado em produção — se a reconciliação divergir num tenant novo, ninguém sabe se a mensagem instrumentada é útil, se o rollback é limpo, ou se algum UPDATE parcial escapou. Toda migration futura com backfill vai herdar a mesma zona sem rede.
- **Impacto de negócio**: baseline mede que este bug custou "348 itens da NOSSA fila de trabalho classificados como passivo de terceiro por ~3 meses" (comentário da migration, linha 24). Uma segunda migration corretiva sem harness de teste tem custo simétrico se falhar em silêncio.
- **Métrica de baseline**: 0 testes cobrindo 227 LOC de SQL com efeito colateral em 152.516 linhas; 1 asserção `RAISE EXCEPTION` sem teste que a dispare; 250 runs históricas recomputadas sem teste de recomputação.

### F-testability-2: Invariante de convergência I5 é testada só contra 1 formato de input (o canônico dos 5 estados)

- **Severidade**: P2
- **Tactic violada**: Limit Non-Determinism (input space) — property-based testing ausente
- **Localização**: `src/backend/domain/service/permutas/EleicaoPermutasService.test.ts:1259-1281` (`convergência I5 (cláusula 2)`)
- **Evidência (objetiva)**: A asserção `for (const [estado, coluna] of Object.entries(colunaDoEstado)) { expect({ [coluna]: headerParams[coluna] }).toEqual({ [coluna]: noSnapshot }); }` percorre os 5 estados, mas a run em teste é **sempre a mesma** (`runCanonica()`: 5 candidatas, 1 de cada estado). Não há caso all-elegivel (N=200), all-bloqueada, vazio (validado só via `run ABORTADA`), N>500 (que dispara chunking), nem input aleatório. `fast-check` não é dependência (`grep -rn fast-check src/backend/package.json` vazio).
- **Impacto técnico**: a garantia é "convergência por construção no código + prova pontual no teste". Um refactor futuro que quebre a construção (por ex., alguém chama `persistRun` passando `totalBloqueadas` derivado de outra fonte) pode passar o teste canônico e regredir na produção com um input diferente.
- **Impacto de negócio**: o próprio ADR-0043 nasceu porque header e snapshot discordaram em produção. Repetir o padrão de defesa (uma coincidência de contagem para 5 rows) contra o mesmo perfil de bug é frágil.
- **Métrica de baseline**: 1 formato de input testado; 0 property-based tests sobre I5; `fast-check` não é dep do backend (frontend tem via herança do template).

### F-testability-3: Exhaustividade estrutural com `: never` aplicada em 1/6 sítios que despacham por `EstadoElegibilidade`

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity (compiler-checked exhaustiveness)
- **Localização**: sítios com `===` encadeado ou ternário que dependem só de type-narrowing implícito:
  - `src/backend/domain/service/permutas/GestaoPermutasService.ts:266` — `statusDoEstado = (estado) => estado === 'descoberta' ? 'bloqueada' : estado`
  - `GestaoPermutasService.ts:176-180` — 5 `filter` sequenciais (`p.status === 'elegivel' | 'bloqueada' | 'casamento-manual' | …`)
  - `GestaoPermutasService.ts:318-324` — ternário aninhado sobre `status`
  - `AlocacaoPermutasService.ts:206, 361` — `=== 'casamento-manual'`
  - `EleicaoPermutasService.ts:776, 809` — `=== ESTADO_ELEGIBILIDADE.BLOQUEADA / .ELEGIVEL`
  
  Comparação com o único sítio "certo": `IngestaoPermutasService.ts:273-289` (switch + `const naoMapeado: never = estado`).
- **Evidência (objetiva)**: `grep -rn ': never\s*=' src/backend/domain --include='*.ts'` retorna **1** ocorrência funcional (`IngestaoPermutasService.ts:287`). O próprio comentário nesse arquivo (linha 264-268) diz: *"A atribuição a `never` faz o PRÓXIMO estado novo quebrar o build em vez de sumir em silêncio."* — a lição não foi propagada para os outros sítios.
- **Impacto técnico**: quando o próximo estado for adicionado (ex: `EXECUTADA` na Fatia 2), o TS pega o `statusDoEstado` porque `StatusElegibilidade` não inclui o novo valor (return type mismatch), mas NÃO pega as cadeias de `filter`/ternário que somem em silêncio. Em `GestaoPermutasService.ts:176-180`, uma candidata do estado novo não vai ser contada em `res.totais.*` e o painel exibirá totais que não somam ao `pendentes.length`.
- **Impacto de negócio**: reintroduz exatamente o defeito que este ciclo corrige (informação perdida em silêncio numa transição de projeção).
- **Métrica de baseline**: 1/6 sítios usam sentinela `never`; 12 comparações `===` sobre estados espalhadas em service/permutas.

### F-testability-4: Teste de RBAC do painel era falso-verde (regressão de testabilidade agora corrigida)

- **Severidade**: P3 (histórico — já remediado)
- **Tactic violada**: Executable Assertions (a asserção assertiva de fato)
- **Localização**: `src/backend/routes/permutas.test.ts` (linhas removidas 685-692 do baseline vs linhas 628-655 do delta)
- **Evidência (objetiva)**: baseline registrava `PainelService` com o método errado (`montarPainel` em vez de `exporNoPainel`), a rota `GET /permutas/painel` estourava 500, e `expect(leitura.status).not.toBe(403)` passava porque 500 ≠ 403 — sem exercitar o caminho não-gateado. Comentário do próprio delta (linhas 628-633): *"o `not.toBe(403)` passava POR ACIDENTE, sem exercitar o caminho não-gateado."* O delta substitui por um probe real que registra `GestaoPermutasService` com `exporGestao` retornando payload válido e assere 200.
- **Impacto técnico**: RBAC de leitura ficou sem teste real por N releases; se alguém tivesse adicionado `requireRole` em `GET /permutas/painel` por engano, a suíte não pegaria.
- **Impacto de negócio**: nenhum dano observado — o painel foi removido de qualquer forma. Fica como sintoma da classe de bug: `expect(...).not.toBe(erro-específico)` sobre response de rota é vulnerável a passar por outros erros.
- **Métrica de baseline**: 1 teste falso-verde detectado e corrigido no próprio delta.

### F-testability-5: Falta teste que exercite a CHECK constraint da migration 0054 do lado do banco

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (asserções codificadas no schema não são exercitadas)
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:70-95` (CHECK `permuta_candidata_snapshot_status_check` estendida para 5 estados); `PermutaSnapshotRepository.test.ts:336-357` (teste do `parseStatusSnapshot` no lado da leitura)
- **Evidência (objetiva)**: o teste `status fora do enum FALHA ALTO na leitura` prova o parser TypeScript, mas NÃO prova que a CHECK do banco rejeitaria um INSERT com valor inválido — porque o teste usa um DB client mockado. O comentário do próprio parser (linha 106) diz: *"A CHECK da migration 0054 deveria impedir isto."* — condicionalidade sem verificação.
- **Impacto técnico**: se a CHECK for reformulada num futuro (ex: 0060) e alguém acidentalmente escapar um estado, o parser em TS continua defendendo, mas a integridade a longo prazo (writes de outros clientes, jobs one-shot, scripts) fica sem rede.
- **Impacto de negócio**: baixo hoje (write single-path); médio quando houver segundo writer ou ingestion externa.
- **Métrica de baseline**: 0 testes exercitando a CHECK contra Postgres real; 1 teste (correto) exercitando o parser TS.

### F-testability-6: Migration 0054 declara idempotência mas nenhum teste prova no-op na 2ª execução

- **Severidade**: P1
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/migrations/0054_estado_ja_permutado.sql:52-58` (bloco "Idempotência" no cabeçalho)
- **Evidência (objetiva)**: o cabeçalho da migration afirma:
  ```
  ## Idempotência
  DDL com IF EXISTS / IF NOT EXISTS; os UPDATEs têm WHERE que não reclassifica
  o que já foi reclassificado; e o header é RECOMPUTADO a partir do snapshot da
  própria run — nunca por subtração ... Rodar duas vezes seguidas é no-op na
  segunda, `total_bloqueadas` incluído.
  ```
  Não há teste que valide esse contrato. O `BootMigrator` só aplica migrations "pendentes" (`SELECT FROM schema_migrations`), então em produção só roda uma vez — o que significa que a idempotência **nunca é exercitada** naturalmente. É um contrato que só importa em cenários de recovery (`DELETE FROM schema_migrations WHERE name='0054…'` + re-boot).
- **Impacto técnico**: se algum tenant novo precisar reaplicar (schema mismatch, restore de backup pré-0054), o operador aposta na promessa do comentário — não há prova executável.
- **Impacto de negócio**: proporcional ao raio de tenants (hoje 0 provisionados; alto quando a infra Terraform for materializada).
- **Métrica de baseline**: 1 contrato de idempotência declarado, 0 testes que o exercitem.

### F-testability-7: Não-determinismo temporal pré-existente atrapalha asserção fina em `IngestaoPermutasService`/`EleicaoPermutasService`

- **Severidade**: P3 (pré-existente, não introduzido pelo delta)
- **Tactic violada**: Limit Non-Determinism / Abstract Data Sources (clock)
- **Localização**: 8 sítios: `IngestaoPermutasService.ts:74,90,132,161,191` + `EleicaoPermutasService.ts:372,379,421`
- **Evidência (objetiva)**: cada `new Date()` / `Date.now()` é uma leitura direta do relógio do sistema. O teste `runs the happy-path chain` (`EleicaoPermutasService.test.ts:142`) não congela tempo, então `runArg.startedAt` / `runArg.finishedAt` são não-determinísticos — os testes atuais só verificam `.toBe('success')` e o `flowId`, sem asserir a monotonia ou a `durationMs`.
- **Impacto técnico**: qualquer teste futuro que queira validar `durationMs > 0`, ordering de logs por timestamp, ou o `finishedAt` calculado depois de um retry timeout, precisa de `jest.useFakeTimers` boiler-plate porque não há `ClockProvider` para injetar.
- **Impacto de negócio**: baixo hoje; conta como custo de manutenção crescente.
- **Métrica de baseline**: 8 sítios de leitura direta de tempo em service/permutas; 0 injeções de `ClockProvider`.

## 5. Cards Kanban

### [testability-1] Criar harness de migration test-pg e adicionar teste da 0054 (idempotência + RAISE EXCEPTION)

- **Problema**
  > A migration `0054_estado_ja_permutado.sql` reescreve 152.516 linhas de snapshot + 250 headers de run com uma reconciliação que aborta via `RAISE EXCEPTION` se divergir. O cabeçalho reivindica "rodar duas vezes é no-op". Nada disso tem teste automatizado. `BootMigrator.test.ts` cobre o runner, não o conteúdo SQL. Sem harness, a próxima migration com backfill herda a mesma zona sem rede.

- **Melhoria Proposta**
  > Introduzir um `docker-compose.test.yml` com Postgres 16 + um novo `migrations/__integration__/` colocado ao lado do fonte, seguindo o padrão CLAUDE.md (`describe('integration: …')`). Escrever `0054_estado_ja_permutado.integration.test.ts` com 3 cenários: (a) aplica em schema virgem + fixture de 3 runs típicas, assere distribuição final; (b) reaplica sem apagar `schema_migrations` — assere no-op (row counts iguais); (c) injeta uma row divergente (header diz 100 elegíveis, snapshot só tem 50) e assere que `RAISE EXCEPTION` dispara com mensagem instrumentada. Tactic Bass: **Sandbox** + **Executable Assertions**.

- **Resultado Esperado**
  > Testes automatizados cobrindo `0054_estado_ja_permutado.sql` 0 → 3 cenários; harness reutilizável para próximas migrations com backfill; próxima pessoa consegue re-verificar sem refazer o setup à mão.

- **Tactic alvo**: Sandbox, Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: L (1–2sem — inclui o harness reutilizável, não só o teste)
- **Findings relacionados**: F-testability-1, F-testability-5, F-testability-6
- **Métricas de sucesso**:
  - Testes cobrindo migration 0054: 0 → 3 cenários
  - Migrations com harness Postgres real disponível: 0 → 1 template + 1 exemplo aplicado
  - Contratos de idempotência declarados mas não testados em migrations do delta: 1 → 0
- **Risco de não fazer**: próxima correção de projeção herda o mesmo padrão de "medi na PRD antes do commit e torci" — o próprio ADR-0043 nasceu de um bug assim que durou 3 meses.
- **Dependências**: nenhuma (pode ser feito em paralelo). Cruza com Deployability (gate de CI pode passar a rodar migrations reais antes de deploy).

### [testability-2] Propagar sentinela `never` para todos os sítios que despacham por `EstadoElegibilidade`

- **Problema**
  > O ciclo trocou `default: return 'descoberta'` por switch com `const naoMapeado: never = estado` em `IngestaoPermutasService.toEstadoRow` — a decisão certa. Mas os outros 5 sítios que despacham/filtram por estado (`GestaoPermutasService.statusDoEstado`, 5 `filter` em `GestaoPermutasService:176-180`, ternários aninhados em `:318-324`, 2 `===` em `AlocacaoPermutasService`, 2 em `EleicaoPermutasService`) continuam usando `===` encadeado. Um estado novo (ex.: `EXECUTADA` da Fatia 2) some em silêncio em cadeias de `filter` — precisamente o padrão de defeito que este ciclo corrige.

- **Melhoria Proposta**
  > Refatorar cada sítio para um `switch(estado) { case … case … default: const _: never = estado; throw }` OU introduzir um helper `contarPorEstado(candidatas)` reutilizável (já existe em `EleicaoPermutasService:976` — extrair para `domain/service/permutas/permutaContagem.ts` e reusar em `GestaoPermutasService`). Adicionar 1 teste que ateste, para cada consumidor de `EstadoElegibilidade`, que ele opera sobre TODOS os 5 valores do enum. Tactic Bass: **Limit Structural Complexity**.

- **Resultado Esperado**
  > Sítios com exaustividade compilada: 1/6 → 6/6. Um estado novo quebra o build em cada consumidor em vez de sumir em `filter`.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: M (2–3d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Sítios com switch + `: never`: 1 → ≥6
  - Comparações `===` avulsas sobre `EstadoElegibilidade` fora de switch: 12 → ≤2 (só onde é semanticamente pontual)
- **Risco de não fazer**: reintrodução exata do bug do delta na próxima ampliação da máquina de estados; a lição do ADR-0043 não sobrevive à Fatia 2.
- **Dependências**: cruza com Modifiability (a mesma abstração torna a máquina de estados mais fácil de mexer).

### [testability-3] Property-based test sobre a invariante I5 (fast-check)

- **Problema**
  > `EleicaoPermutasService.test.ts:1259` prova convergência I5 (`header.total_<s> === COUNT(snapshot com status s)`) SÓ para o input canônico dos 5 estados com 1 candidata cada. Um refactor que passe a derivar contagens de fontes distintas passa esse teste e regride em produção com um input diferente (all-elegivel, all-bloqueada, N > 500 disparando chunking).

- **Melhoria Proposta**
  > Adicionar `fast-check` como dev-dep no `src/backend/package.json` (frontend já usa via herança). Escrever `EleicaoPermutasService.invariants.test.ts` com um arbitrário de `PermutaCandidata[]` (tamanhos 0..1500, mix de 5 estados, com/sem motivo) e uma propriedade: para toda run, `contarPorEstado(candidatas).totalX === candidatas.filter(c => c.estado === X).length` e `headerParams === snapshotStatusCount`. Tactic Bass: **Executable Assertions** aplicada como propriedade.

- **Resultado Esperado**
  > Formatos de input testados para I5: 1 → ≥1000 (via 100 runs × dezenas de shrinks); property-based tests no backend: 0 → 1 (com precedente para expandir).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Property-based tests no backend: 0 → 1
  - Cenários distintos exercitando I5: 1 → ≥100 (fast-check default)
- **Risco de não fazer**: o próximo bug de projeção passa pela mesma peneira que este passou (uma coincidência para 5 rows).
- **Dependências**: nenhuma.

### [testability-4] Extrair `ClockProvider` injetável e migrar os 8 sítios de tempo de service/permutas

- **Problema**
  > `IngestaoPermutasService` e `EleicaoPermutasService` leem `new Date()` / `Date.now()` diretamente do relógio em 8 sítios. Nenhum teste do delta consegue asserir `durationMs`, `finishedAt` calculado ou monotonia de logs sem `jest.useFakeTimers` espalhado. Pré-existente ao delta, mas persiste como custo escondido.

- **Melhoria Proposta**
  > Criar `src/backend/domain/libs/clock/ClockProvider.ts` (`@injectable()`) com `now(): Date` e `nowMs(): number`. Injetar via construtor em `IngestaoPermutasService` e `EleicaoPermutasService`. Nos testes, injetar um `FrozenClockProvider` para asserir timestamps precisos. Tactic Bass: **Limit Non-Determinism** + **Abstract Data Sources**.

- **Resultado Esperado**
  > Sítios `new Date()` / `Date.now()` em service/permutas: 8 → 0. Testes futuros podem asserir `runArg.startedAt.toISOString() === '2026-06-17T10:00:00Z'` sem `jest.useFakeTimers`.

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — a superfície é local a 2 arquivos)
- **Findings relacionados**: F-testability-7
- **Métricas de sucesso**:
  - Sítios de leitura direta de tempo em service/permutas: 8 → 0
  - Testes assertando `durationMs`/`finishedAt` sem `jest.useFakeTimers`: 0 → ≥1
- **Risco de não fazer**: custo de manutenção crescente; qualquer teste que queira falar sobre tempo vira boilerplate.
- **Dependências**: cruza com Modifiability.

### [testability-5] Regra de linter contra `expect(...).not.toBe(<code>)` sobre response de rota

- **Problema**
  > O painel de `routes/permutas.test.ts` tinha um probe de RBAC que passava por acidente: o mock estava com o método errado, a rota estourava 500, e `expect(...).not.toBe(403)` passava porque 500 ≠ 403 — sem exercitar o caminho não-gateado. Esse padrão é reproduzível em qualquer rota; foi corrigido no delta, mas a classe do bug sobrevive.

- **Melhoria Proposta**
  > Adicionar uma regra ao PatternGuardian (ou uma custom rule do Biome se factível) que sinaliza `expect(<response>.status).not.toBe(<literal>)` em `routes/*.test.ts`. Substituir por `expect(<response>.status).toBe(200)` ou `.toBeLessThan(400)`. Tactic Bass: **Executable Assertions** (asserções que de fato asseveram).

- **Resultado Esperado**
  > Ocorrências de `.not.toBe(<código HTTP>)` em `routes/*.test.ts`: N → 0.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - `grep -rn '\.not\.toBe(4\|\.not\.toBe(5' src/backend/routes/*.test.ts`: N → 0
  - Novos testes falso-verdes desse padrão em code-review: contar via `PatternGuardian`
- **Risco de não fazer**: o mesmo padrão de falso-verde escapa em outras rotas.
- **Dependências**: nenhuma; requer só uma regra no `PatternGuardian`.

## 6. Notas do agente

- O caso canônico existe em DOIS lugares (`PermutaSnapshotRepository.test.ts:265` para o repo puro, `EleicaoPermutasService.test.ts:1236-1281` para o pipeline inteiro), e o segundo é o que a entrevista pede: instancia `new PermutaSnapshotRepository(clientMock)` + `new ElegibilidadeService(new CasamentoInvoiceService())` REAIS, mocka SÓ o `PostgreeDatabaseClient`, e assere `headerParams[coluna] === COUNT(snapshot_status === estado)` sobre `mock.calls[0]` e `mock.calls[1]` da mesma transação. Não é fachada; a convergência é provada pela gravação, não por reafirmação de mock. A limitação real é o **espaço de input** (F-testability-2), não a fidelidade do experimento.
- Modo `--quick` — não rodei `--coverage`. O threshold do `jest.config.cjs` (72 linhas global, 88 em `domain/service/`) é enforçado no `npm test` sem `--coverage`? Não — é só coletado quando `--coverage` roda. A confiança no gate é condicional a alguém rodar coverage no CI (fora de escopo deste review).
- Cross-QA a alertar o consolidator:
  - Card [testability-1] (harness de migration) cruza com **Deployability** — o gate certo é "migração roda contra Postgres real no CI antes de fazer merge".
  - Card [testability-2] (`never` propagação) cruza com **Modifiability** — a mesma abstração torna a extensão da máquina de estados (Fatia 2 `EXECUTADA`) mais barata.
  - Card [testability-4] (ClockProvider) cruza com **Modifiability** — reduz o acoplamento a I/O implícito.
  - Card [testability-3] (fast-check em I5) cruza com **Fault Tolerance** — a invariante testada é justamente a que impede um bug de projeção divergir header ↔ snapshot em produção.
- O delta REMOVE 2 testes (PainelService completo) e MELHORA 1 (probe RBAC de painel deixou de ser falso-verde). Net dos ARQUIVOS do delta pelo meu grep é +15 testes; o `_shared-metrics.md` reporta +22 na suíte agregada — a diferença provavelmente vem de outros arquivos indiretamente afetados que não medi granularmente. Uso o número da suíte agregada como fonte de verdade.
