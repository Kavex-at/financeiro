---
qa: Testability
qa_slug: testability
run_id: 2026-08-19-1603
agent: qa-testability
generated_at: 2026-08-19T16:03:00-03:00
scope: backend + frontend (delta Frente V)
score: 6
findings_count: 8
cards_count: 8
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado à Frente V)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev que altera regra de derivação (`EtapaStatusResolver`, `StatusWorkflowResolver`, `DuracaoCalculator`) | Mudança em precedência de status, mapeamento de ação, ou fórmula de duração | `domain/service/aprovacoes/*` + rota `/aprovacoes` + tabela `aprovacao_titulo` | Desenvolvimento local, sem Postgres nem ERP disponíveis | Suite congela o comportamento anterior; regressão em precedência de INDETERMINADO, contagem de etapas abertas ou "parada há" quebra teste específico e nomeado; SQL invalidável (nome de param ausente, mistura `$1`/`$nome`) quebra `AprovacoesSql.test.ts` | Detecção em ≤ 90 s de `npm test`; 100% das 5 transições do workflow (SEM_WORKFLOW → INDETERMINADO/AGUARDANDO/APROVADO/REJEITADO) cobertas; 0 defeitos de sintaxe SQL escapando para o deploy |

> "Dev troca o mapa `ETAPA_STATUS_ERP` (PV-01) achando que `7` é `CONCLUIDA` → `EtapaStatusResolver.test.ts` reprova em ≤ 90 s → 0 títulos classificados como aprovados por chute chegam a `aprovacao_titulo`."

O cenário **que a suíte da Frente V não defende hoje**: mudança em `EtapaAprovacaoRepository.sincronizarTrilha` que produz SQL sintaticamente válido para o `SqlBuilder` mas semanticamente errado no Postgres (ex.: `<> ALL($chaves)` com `chaves` de tipo diferente do CHECK constraint). A migration `0049_aprovacao_trilha.sql` nunca foi aplicada — ver F-testability-1.

## 2. Métricas observadas

### 2.1 Métrica obrigatória #1 — Presença de teste por camada (Frente V)

Contagem restrita ao delta `feat/frente-v-aprovacoes` (arquivos listados em `_shared-metrics.md`).

| Camada | Arquivos-fonte | Arquivos-teste | Ratio | Casos (`it`/`test`) | Alvo | Status |
|---|---|---|---|---|---|---|
| `domain/service/aprovacoes` | 5 (`AprovacoesPainelService`, `IngestaoAprovacoesService`, `EtapaStatusResolver`, `StatusWorkflowResolver`, `DuracaoCalculator`) | 5 | 1.00 | 56 | ≥ 0.8 | ✅ |
| `domain/repository/aprovacoes` | 3 (`TituloAprovacaoRepository`, `EtapaAprovacaoRepository`, `AprovacaoIngestaoRunRepository`) | 1 (agregado `AprovacoesSql.test.ts`) | 0.33 | 8 (só consistência de params, **zero contra Postgres**) | ≥ 0.66 (um por repo) + ≥ 1 integração real | ❌ |
| `domain/client` (delta) | 1 (`ConexosAprovacoesClient`) | 1 | 1.00 | 11 | ≥ 1.0 | ✅ |
| `domain/interface/aprovacoes` (DTOs + ports + constants) | 4 | 0 | 0.00 | 0 | tipos puros — N/A | ⚠️ (não medível para dados/tipos, mas `constants.ts` tem tabelas de mapeamento sem contra-teste) |
| `routes` | 1 (`routes/aprovacoes.ts`) | 1 | 1.00 | 8 | ≥ 1.0 | ✅ |
| `jobs` (Frente V) | 3 (`ingest-aprovacoes.ts`, `probe-aprovacoes-fin026.ts`, `probe-aprovacoes-trilha.ts`) | 0 | 0.00 | 0 | ≥ 0.33 para o job de produção (`ingest-aprovacoes`); probes ok sem teste | ❌ |
| `migrations` | 1 (`0049_aprovacao_trilha.sql`, 143 LOC) | 0 (nunca aplicada) | 0.00 | 0 | ≥ 1 apply→rollback→apply | ❌ |
| `frontend/app/aprovacoes` | 4 (`page.tsx`, `layout.tsx`, `TrilhaDrawer.tsx`, `snapshot-faixa.tsx`, `status-badges.tsx`) | 2 (`page.test.tsx`, `TrilhaDrawer.test.tsx`) | 0.40 | 32 | ≥ 0.5 | ⚠️ (componentes `snapshot-faixa` e `status-badges` sem teste isolado; cobertos indiretamente) |

**Total Frente V**: 83 casos backend + 32 casos frontend = **115 casos** para a fatia (~832 LOC de service + 518 LOC repo + 5128 LOC client novo + 632 LOC page + 345 LOC lib). Densidade backend: 1 caso/20 LOC de service — folgada por padrão da indústria.

### 2.2 Demais métricas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Ratio global `# .test.ts` / `# source .ts` backend | 269 / (269 + n_source) — ver `_shared-metrics.md` (269 testes / total repo) | ≥ 0.5 | ✅ | `_shared-metrics.md` L79 |
| Total testes backend passando | 1372 em 110 suítes | verde | ✅ | `_shared-metrics.md` L81 |
| Total testes frontend passando | 203 em 27 suítes | verde | ✅ | `_shared-metrics.md` L82 |
| Cobertura backend por diretório | ⚠️ **Não medível localmente** (flag `--quick`; coverage pulada) | `./domain/service/`: `lines ≥ 88`, `branches ≥ 60` (piso do `jest.config.cjs`) | — | `src/backend/jest.config.cjs:34-45` |
| Cobertura frontend por diretório | ⚠️ **Não medível localmente** (idem `--quick`) | `global: lines ≥ 20, branches ≥ 9, functions ≥ 14` | — | `src/frontend/jest.config.js:35-42` |
| Testes de integração real contra Postgres | 0 na Frente V | ≥ 1 por repository crítico | ❌ | `find … -name '*.integration.test.ts'` — só existe para Frente IV (`recebimentos.e2e.*.integration.test.ts`) |
| Testes contra ERP fake in-process | 0 na Frente V | ≥ 1 (ingestão ponta a ponta) | ❌ | Frente IV usa `buildErp()` em `routes/recebimentos.e2e.test.ts:640`; Frente V não |
| `new Date()` / `Date.now()` no código-fonte da Frente V (não teste) | 6 sítios: `AprovacoesPainelService.ts:139,180`; `IngestaoAprovacoesService.ts:91,163`; `jobs/ingest-aprovacoes.ts:52` | 0 sítios sem injeção clara de `agora` no boundary | ⚠️ | `grep new Date\(\)\|Date\.now\(\)` — ver F-testability-4 |
| `Math.random` / `crypto.randomUUID` na Frente V | 0 | 0 | ✅ | `grep -rn "Math.random\|crypto.random"` — sem hits em Frente V |
| Testes que fazem HTTP real (axios/fetch) no delta | 0 (fake `postGeneric` sempre) | 0 em unit | ✅ | `ConexosAprovacoesClient.test.ts` — cliente injetado |
| Testes com `beforeAll` compartilhando estado entre `it` (Frente V) | 0 | 0 | ✅ | `grep beforeAll src/backend/domain/*/aprovacoes/*.test.ts` — só `beforeEach` no frontend |
| DI seam usage: testes que resolvem via `container.resolve` (Frente V) | 1 (`routes/aprovacoes.test.ts` registra fakes por token e sobe Express de verdade — mas o `bootstrapAppContainer` é mockado) | preferir `new Service(mockRepo)` — CLAUDE.md | ✅ | `routes/aprovacoes.test.ts:12-24, 87-105` |
| Testes com injeção construtor direto (Frente V) | 6 (`AprovacoesPainelService`, `IngestaoAprovacoesService`, `DuracaoCalculator`, `EtapaStatusResolver`, `StatusWorkflowResolver`, `ConexosAprovacoesClient`, `AprovacoesSql`) | ≥ 80% dos testes de service | ✅ | `grep "new .*Service("` nos testes |
| Coverage gate no CI | ✅ presente (`npm test -- --coverage` em `ci.yml:26,44`) + `coverageThreshold` em ambos configs | presente + valores defensáveis | ✅ para presença; ⚠️ para valor frontend (`lines ≥ 20`) | `.github/workflows/ci.yml:26` |
| Property-based testing (fast-check) usado | 0 (não instalado — `grep` no `package.json` de ambos: sem hits) | opcional | ⚠️ | `grep fast-check src/*/package.json` |
| Log assertions em testes da Frente V | 0 em 83 casos backend | ≥ 1 por caminho de erro (F-testability-5) | ❌ | `grep logService.*mock src/backend/domain/*/aprovacoes/*.test.ts` — sem hits |
| Test file size (top da Frente V) | `page.test.tsx` 210 LOC / `AprovacoesPainelService.test.ts` 393 LOC / `TrilhaDrawer.test.tsx` ~340 LOC | < 500 LOC | ✅ | `wc -l` |
| CI blocking merge | ✅ workflow `ci.yml` roda em PR `main`/`dev`, includes `npm test`, `npm audit --audit-level=high`, `npm run typecheck`, `npm run lint` | presente | ✅ | `.github/workflows/ci.yml:5-40` |
| Testes de transição de estado (`aprovacao-titulo` state-machine) | 5 transições modeladas (SEM_WORKFLOW / INDETERMINADO / REJEITADO / AGUARDANDO / APROVADO); todas cobertas em `StatusWorkflowResolver.test.ts` (7 casos) e reforçadas em `AprovacoesPainelService.test.ts` | 100% das transições | ✅ | `StatusWorkflowResolver.test.ts:8-40` |

**⚠️ Não medível localmente**: cobertura em % por diretório (flag `--quick` desativou `jest --coverage`). O piso do `jest.config.cjs` para `./domain/service/` é `lines ≥ 88` — assumindo que a suíte da Frente V herda ≥ 88% conforme a média histórica, o número real precisa ser verificado no próximo run sem `--quick`.

## 3. Tactics — Cobertura no delta Frente V

Mapa completo Bass & Clements. Nomes em inglês canônico.

### Control & Observe System State

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** | `TrilhaAprovacaoGatewayInterface` (2 métodos, **read-only por construção** — ADR-0038 D2); `TituloAprovacaoRepositoryInterface`, `EtapaAprovacaoRepositoryInterface`, `AprovacaoIngestaoRunRepositoryInterface`; parâmetro `agora: Date` explícito em `listar(filtro, agora)` e `detalhar(id, {agora})`. Um teste específico (`ConexosAprovacoesClient.test.ts:155-170`) trava a superfície: `expect(metodos.sort()).toEqual(['listTrilha', 'listUniverso'])` — tornar a escrita inexpressável em vez de proibida por disciplina. | ✅ | `src/backend/domain/interface/aprovacoes/ports.ts:20-100`; `AprovacoesPainelService.ts:139,180`; `ConexosAprovacoesClient.test.ts:155-170` |
| **Recordable Test Cases** | Fixtures inline capturadas da sondagem em produção 2026-08-18/19: doc 4156/1 (CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA), 84.534 s de duração — reaparece em 4 dos 5 testes de service e nos 2 do frontend. **Sem fixture externa** (`__fixtures__/`, `.fixture.json`); as amostras vivem inline no teste. | ⚠️ parcial | `EtapaStatusResolver.test.ts:11-32` ("Os casos vêm da sondagem read-only em produção…"); `DuracaoCalculator.test.ts:7-10` |
| **Sandbox** | Fakes de repository e gateway construídos a mão em cada teste (`montar()` em `IngestaoAprovacoesService.test.ts:60-133`); `PostgreeDatabaseClient` substituído por `criarClienteCaptura()` que só registra queries (`AprovacoesSql.test.ts:28-49`). **Zero sandbox real**: nenhum Postgres in-container, nenhum ERP fake in-process. A Frente IV mantém um ERP fake HTTP (`routes/recebimentos.e2e.test.ts:640` — `buildErp()` + `describe('E2E Recebimentos — extrato novo → NDe emitida (ERP fake, escrita ligada)')`) e a Frente V **não o reaproveita**. | ⚠️ parcial (dublês por dependência, mas nenhum sandbox integrado) | ver F-testability-1, F-testability-2 |
| **Executable Assertions** | Zod nos boundaries de rota (`routes/aprovacoes.ts` — schema não colado, mas invocado em `validateInput`); invariantes explícitos em comentários e cobertos por teste: I5 (filial do registro, `IngestaoAprovacoesService.test.ts:177-186`), I4 (precedência de INDETERMINADO, `StatusWorkflowResolver.test.ts:30-43`), I7 (snapshotEm obrigatório, `page.test.tsx:66-79`). CHECK constraints no SQL (`0049_aprovacao_trilha.sql:35`, mas **nunca executados**). | ✅ para código; ❌ para o SQL | `IngestaoAprovacoesService.test.ts:177-186`; `0049_aprovacao_trilha.sql:35-37` |
| **Abstract Data Sources** | `TituloAprovacaoRepositoryInterface` + `EtapaAprovacaoRepositoryInterface` + `AprovacaoIngestaoRunRepositoryInterface` como tokens `Symbol`; `TrilhaAprovacaoGatewayInterface` idem; troca de implementação = trocar linha no `aprovacoesContainer.ts`. Contrato de rota é `TituloAprovacaoComTrilha` e não o objeto do Postgres direto. | ✅ | `domain/interface/aprovacoes/ports.ts:57-100`; `domain/aprovacoesContainer.ts:16-31` |

### Limit Complexity

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Limit Structural Complexity** | Cada resolver é uma classe pequena (`DuracaoCalculator` 90 LOC, `EtapaStatusResolver` 89 LOC, `StatusWorkflowResolver` 41 LOC); teste mais gordo é `AprovacoesPainelService.test.ts` com 393 LOC — abaixo do limiar de 500 LOC. Serviço maior (`AprovacoesPainelService.ts` 340 LOC) já tem 20 casos de teste, com 8 sub-`describe` claros. **Alerta**: `AprovacoesPainelService.ts` acumula parseId + listar + detalhar + montarItem + montarEtapaAtual + montarEtapa; separar tornaria a superfície de teste mais fina. | ✅ | `wc -l` |
| **Limit Non-Determinism** | Parcial. Os cálculos temporais tomam `agora: Date` como parâmetro explícito em `listar(filtro, agora)` e `detalhar(id, {agora})` — a tactic está **desenhada**; os 20 testes de `AprovacoesPainelService.test.ts` congelam `AGORA = new Date('2026-05-16T07:12:46.000Z')`. **Vazamentos**: (a) `AprovacoesPainelService.ts:139` tem default `agora: Date = new Date()` e o **route caller não passa** (`routes/aprovacoes.ts:114` chama `service.listar({…})` sem `agora`); (b) `IngestaoAprovacoesService.ts:91,163` faz `new Date()` embed para `startedAt` e `observadoEm` — não é injetável e os testes de ingestão não asseram sobre esses timestamps; (c) `jobs/ingest-aprovacoes.ts:52` `Date.now()` para janela de backfill. `Math.random`/UUID: ausentes na Frente V (bom sinal). | ⚠️ parcial | ver F-testability-4 |

## 4. Findings

### F-testability-1: SQL da Frente V nunca foi executado contra Postgres

- **Severidade**: **P0** — sintaxe/tipo/CHECK constraint são invalidados até o deploy; regressão passaria calada pela suíte.
- **Tactic violada**: *Sandbox* + *Executable Assertions* (o SQL DDL é uma asserção que nunca foi executada)
- **Localização**: `src/backend/migrations/0049_aprovacao_trilha.sql` (143 LOC) + `src/backend/domain/repository/aprovacoes/{TituloAprovacaoRepository,EtapaAprovacaoRepository,AprovacaoIngestaoRunRepository}.ts` (518 LOC) + `src/backend/domain/repository/aprovacoes/AprovacoesSql.test.ts:1-25` (comentário-cabeçalho já reconhece a lacuna).
- **Evidência (objetiva)**:
  ```
  # 0 integration tests para a Frente V:
  grep -c "describe.*integration:" src/backend/domain/repository/aprovacoes/*.test.ts → 0
  # A migração nunca aplicada:
  ls src/backend/migrations/0049_*.sql → 143 LOC, ADD 2 tabelas, 3 CHECK, 4 índices
  # O teste que a substitui só valida named-param consistency:
  AprovacoesSql.test.ts:16-25 "O que NÃO pega: erro de sintaxe SQL e semântica de tipos.
  Isso exige um Postgres de verdade e fica registrado como lacuna conhecida no roteiro de QA."
  ```
- **Impacto técnico**: `<> ALL($chaves::…)` com cast implícito errado, tipo `TIMESTAMPTZ` vs `TIMESTAMP` na coluna `observado_em`, CHECK `IN ('SEM_WORKFLOW', 'AGUARDANDO', …)` desalinhado com a constante `STATUS_WORKFLOW`, índice sobre coluna renomeada — nada disso quebra teste até `npm run migrate` bater no Postgres alvo.
- **Impacto de negócio**: primeiro deploy do Frente V pode falhar na migration (rollback manual do release); pior cenário — CHECK sobre `status_workflow` aceitando valor não previsto e serializando "APROVADO" para uma linha com etapa `INDETERMINADO`, o que a arquitetura da Frente V é feita para nunca deixar acontecer.
- **Métrica de baseline**: **0 execuções de DDL, 0 execuções DML** de queries da Frente V contra Postgres real (nem local, nem HML, nem CI).

### F-testability-2: Ingestão contra ERP nunca exercitada ponta a ponta

- **Severidade**: **P0** — o caminho `psq014/list` → `fin026/infoTitulo/list` só existe em fake construído no próprio teste. O harness ERP-fake que a Frente IV mantém (`buildErp` in-process) **não é reaproveitado**.
- **Tactic violada**: *Sandbox* + *Recordable Test Cases*
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.test.ts:47-133` (montar()) — fake de gateway inline; `src/backend/routes/recebimentos.e2e.test.ts:625-700` (harness que existe e não foi estendido para aprovações).
- **Evidência (objetiva)**:
  ```
  # Frente IV mantém 7 arquivos *e2e*:
  ls src/backend/routes/recebimentos.e2e*.ts → 7 arquivos, ~3.8k LOC de cenário
  # Frente V:
  ls src/backend/routes/aprovacoes.e2e*.ts → nada
  # IngestaoAprovacoesService.test.ts fake:
  L47: const gateway: TrilhaAprovacaoGatewayInterface = { listUniverso: async ({pageNumber}) => (...) }
  # Nenhuma passagem pela camada de transporte HTTP nem pelo repository real.
  ```
- **Impacto técnico**: comportamento observado em produção — filtro `docTip#EQ` como número, `docDtaEmissao#GE` como epoch em **milissegundos** (documentado em `ConexosAprovacoesClient.test.ts:60-77`) — é a única defesa contra regressão desses formatos exigentes; se o `ConexosBaseClient.postGeneric` mudar assinatura ou header, o fake in-process continua verde e o Conexos responde 500 no primeiro deploy.
- **Impacto de negócio**: backfill de 23.632 títulos da filial 2 quebra na primeira chamada em produção; retomada não valida em ambiente controlado; PV-07 (fin103) — quando resolver — não tem baseline de comparação.
- **Métrica de baseline**: **0 execuções** do fluxo `ingest-aprovacoes` contra qualquer sandbox HTTP (fake ou HML); **0/7** harness E2E reaproveitado da Frente IV.

### F-testability-3: `jobs/ingest-aprovacoes.ts` sem cobertura de teste

- **Severidade**: **P1** — o entrypoint faz parsing de `FILS`, `APROVACOES_BACKFILL_DESDE`, `RETOMAR`, chama `bootstrapAppContainer`, `withAdvisoryLock`, e não tem um único teste.
- **Tactic violada**: *Specialized Interfaces* (o boundary env → filCods não é testado)
- **Localização**: `src/backend/jobs/ingest-aprovacoes.ts` (todo o arquivo)
- **Evidência (objetiva)**:
  ```
  ls src/backend/jobs/ingest-aprovacoes.test.ts → não existe
  # Superfície não testada:
  L34-41  resolverFilCods()      — parse "1,2,3" → number[] (filtra <=0)
  L43-50  resolverEmissaoDesde() — parse APROVACOES_BACKFILL_DESDE ou fallback 12m
  L56-63  early-exit quando filCods vazio → process.exit(1)
  L70     RETOMAR === '1'
  L75     db.withAdvisoryLock(APROVACOES_INGEST_LOCK_KEY, …)
  ```
- **Impacto técnico**: `FILS="1, 2, "` produz `[1, 2, NaN]` mas o filter `Number.isInteger` corta — sem teste, refactor desatento pode quebrar; timezone da janela `emissaoDesde` (`Date.now() - 12m`) nunca reproduzido; lock key errada roda dois jobs simultâneos sem alarme.
- **Impacto de negócio**: job de produção pode varrer filial errada ou omitir emissãoDesde e trazer o histórico inteiro do ERP (custo em requests + tempo de execução).
- **Métrica de baseline**: **3 arquivos** em `jobs/` relacionados à Frente V (`ingest-aprovacoes.ts` + 2 probes), **0** testes. Ratio 0/3 = 0%.

### F-testability-4: `agora` não fecha o loop até a rota — default `new Date()` na produção

- **Severidade**: **P1** — a tactic *Limit Non-Determinism* está desenhada no service (`listar(filtro, agora)`, `detalhar(id, {agora})`) mas a rota **não passa `agora` explícito**, então produção usa o default `= new Date()` do próprio service. Testes sempre passam `AGORA` — paridade rompida.
- **Tactic violada**: *Limit Non-Determinism*
- **Localização**: `src/backend/routes/aprovacoes.ts:114-125` (chama `service.listar({…})` sem `agora`), `:152-154` (chama `service.detalhar(parsed.data.id, {filCodsPermitidos: …})` sem `agora`); `src/backend/domain/service/aprovacoes/AprovacoesPainelService.ts:139` (`agora: Date = new Date()`), `:180` (`opts.agora ?? new Date()`); `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts:91` (`startedAt: new Date()`), `:163` (`observadoEm = new Date()`).
- **Evidência (objetiva)**:
  ```
  routes/aprovacoes.ts:114  service.listar({ page: …, filCods, … })      ← sem agora
  routes/aprovacoes.ts:152  service.detalhar(parsed.data.id, { filCodsPermitidos: … })  ← sem agora
  service:139   public listar = async (filtro, agora: Date = new Date())  ← fallback silencioso
  ```
- **Impacto técnico**: dois títulos servidos na mesma request podem ter `paradaHaSegundos` calculado com `agora` = `T` e `agora` = `T + ε` (fração de ms diferente por linha se o default for chamado dentro de `map`); pior: `IngestaoAprovacoesService.executar` grava `observadoEm` linha-a-linha com `new Date()`, então dois títulos da mesma run podem ter snapshots com timestamps diferentes — quebra o `snapshotEm` do painel como "a idade única do dado desta consulta".
- **Impacto de negócio**: invariante I7 (a UI diz a idade do snapshot) fica frágil — a rota `/aprovacoes` mostra `snapshotEm` do repository, mas "parada há" da resposta usa outro relógio (`new Date()` na service); auditoria de duração vira aproximação em vez de fato.
- **Métrica de baseline**: **6 sítios** de `new Date()`/`Date.now()` em código-fonte da Frente V, dos quais **2** são fallback silencioso na service e **1** é chamada da rota sem `agora` explícito (a rota deveria passar `agora = new Date()` na entrada e propagar para o service — controlabilidade real).

### F-testability-5: Zero log assertions em caminhos de erro

- **Severidade**: **P2** — `IngestaoAprovacoesService.executar` lança quando o ERP falha (`IngestaoAprovacoesService.test.ts:208-218`) mas nenhum teste verifica que o erro é **logado com contexto** (run id, filial, docCod). O service atualmente sequer tem `LogService` injetado.
- **Tactic violada**: *Executable Assertions* (observabilidade dos caminhos de erro)
- **Localização**: `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts` (não há `logService`); `src/backend/domain/service/aprovacoes/*.test.ts` (nenhum `mockLogService`).
- **Evidência (objetiva)**:
  ```
  grep -c logService src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.ts → 0
  grep -c logService src/backend/domain/service/aprovacoes/*.test.ts → 0
  grep -c logService src/backend/routes/aprovacoes.test.ts → 0
  ```
- **Impacto técnico**: run interrompida propaga a exceção — o `runRepository.finalizar(id, 'error', 'ERP fora do ar')` cobre o rastro no Postgres, mas em CloudWatch/journal você não sabe **qual título** derrubou a run (`chamadasTrilha` é só assertion de teste, não é log real).
- **Impacto de negócio**: no primeiro backfill que quebrar em produção, o time descobrirá qual `filCod`/`docCod` derrubou olhando a última linha de `aprovacao_ingestao_run.cursor_doc_cod` — não pela mensagem de log.
- **Métrica de baseline**: **0 / 83** (0%) casos da Frente V asseram sobre chamadas de `LogService`; `LogService` **não é injetado** em nenhum service da Frente V.

### F-testability-6: Property-based testing ausente onde ele daria alto ROI

- **Severidade**: **P2** — `StatusWorkflowResolver.resolver` e `EtapaStatusResolver.resolver` são funções puras com **regra de precedência estrita**; `fast-check` faria a auditoria de propriedade "INDETERMINADO em qualquer posição ⇒ resultado é INDETERMINADO" em uma linha. `fast-check` **não está instalado** em nenhum dos dois `package.json`.
- **Tactic violada**: *Executable Assertions* (asserções paramétricas em vez de exemplos)
- **Localização**: `src/backend/domain/service/aprovacoes/StatusWorkflowResolver.test.ts` (7 casos exemplo); `src/backend/domain/service/aprovacoes/EtapaStatusResolver.test.ts` (10 casos exemplo).
- **Evidência (objetiva)**:
  ```
  grep "fast-check" src/backend/package.json src/frontend/package.json → sem hits
  # Regra que grita por PBT (StatusWorkflowResolver.resolver):
  # ∀ estados ∈ EtapaStatus[]: se INDETERMINADO ∈ estados ⇒ resultado = INDETERMINADO
  ```
- **Impacto técnico**: uma reordenação inadvertida do `if` no `StatusWorkflowResolver` (regra 2 depois da regra 3) hoje só quebra 3 casos de teste; com PBT, quebraria em ~centenas de amostras geradas.
- **Impacto de negócio**: a invariante I4 (INDETERMINADO precede tudo) é a defesa contra "aprovado por chute em painel financeiro auditável"; ela merece ser expressa como propriedade, não como amostra.
- **Métrica de baseline**: **0** propriedades geradas (fast-check nem em dep); 7 + 10 = 17 casos exemplo para 2 resolvers com espaço combinatório finito de ~5 estados por etapa × N etapas.

### F-testability-7: `AprovacoesSql.test.ts` valida named-params, mas cobertura de caminhos é rasa

- **Severidade**: **P2** — o teste declara honestamente a lacuna, mas o número de queries capturadas é pequeno (8 casos) e não força os principais caminhos: `list` com `busca` LIKE, filtro por `emissaoAte` sem `emissaoDe`, `sincronizarTrilha` com trilha de 100 etapas (para trigger de UPSERT batch), `listByTitulos` com chave duplicada.
- **Tactic violada**: *Executable Assertions* (branch coverage do SQL builder)
- **Localização**: `src/backend/domain/repository/aprovacoes/AprovacoesSql.test.ts:87-206`
- **Evidência (objetiva)**:
  ```
  8 testes exercitam:
    - sincronizarTrilha (2 casos: nominal + trilha vazia)
    - listByTitulos (2 casos: 100 chaves + vazio)
    - upsert título (1)
    - list título com filtros (1) — mas sem varrer combinações
    - list título sem filial (1)
    - ultimoSnapshot (1)
  ```
- **Impacto técnico**: `list` monta `WHERE` por concatenação condicional (padrão comum): 5 filtros → 32 combinações; o teste cobre 1 combinação nominal e 1 negativa (filial vazia).
- **Impacto de negócio**: mudança no SQL sob `if (filtro.busca)` que introduz `$nome` não fornecido só é pega se o teste montar exatamente essa combinação — hoje não monta.
- **Métrica de baseline**: **8 queries capturadas** em `AprovacoesSql.test.ts`; ~15 queries distintas emitidas pelo delta (contando os 3 repositories e as ramificações condicionais).

### F-testability-8: Frente V ignora o harness ERP-fake da Frente IV (reuso zero)

- **Severidade**: **P3** — a Frente IV construiu um `buildErp()` in-process (`recebimentos.e2e.test.ts:625-700`) com estado, endpoints POST fake, snapshot de env — 3.867 LOC de cenário E2E. A Frente V criou seus fakes inline e não estendeu o harness. Reaproveitamento evitaria drift.
- **Tactic violada**: *Sandbox* (reutilizar sandbox comum entre módulos)
- **Localização**: `src/backend/routes/recebimentos.e2e.test.ts:625-700` (o harness); `src/backend/domain/service/aprovacoes/IngestaoAprovacoesService.test.ts:47-133` (o duplicado inline).
- **Evidência (objetiva)**:
  ```
  Frente IV — 7 arquivos e2e/integration + buildErp() reusável:
    src/backend/routes/recebimentos.e2e.test.ts                    (973 LOC)
    src/backend/routes/recebimentos.e2e.falhas.test.ts             (1062 LOC)
    src/backend/routes/recebimentos.e2e.gates.test.ts              (903 LOC)
    src/backend/routes/recebimentos.e2e.retomada.test.ts           (929 LOC)
    src/backend/routes/recebimentos.e2e.hml*.integration.test.ts   (varreduras contra HML real)
  Frente V — 0 arquivos e2e ou integration.
  ```
- **Impacto técnico**: comportamentos exigentes do `ConexosBaseClient` (sessão, retry, ensureSid, headers `filCod`) só são exercitados no client-teste isolado; a interação com a service e o repository nunca passa pelos mesmos wireframes que a Frente IV já modelou.
- **Impacto de negócio**: PV-07 (fin103) — quando destravar — vai forçar reescrever o `TrilhaAprovacaoGatewayInterface` binding; sem harness E2E, a troca fica dependente de teste em produção.
- **Métrica de baseline**: **0 / 7** cenários E2E reaproveitados; **0** casos ponta-a-ponta na Frente V.

## 5. Cards Kanban

### [testability-1] Aplicar migration 0049 contra Postgres real e blindar o SQL

- **Problema**
  > Nenhuma query da Frente V jamais tocou um Postgres. A migration `0049_aprovacao_trilha.sql` (143 LOC, 2 tabelas, 3 CHECK, índices) nunca foi aplicada; `AprovacoesSql.test.ts` só valida consistência de nomes de parâmetros no `SqlBuilder`. Sintaxe SQL, semântica de tipos, CHECK constraints, casts implícitos — tudo passa em branco até o primeiro `npm run migrate` em ambiente real.

- **Melhoria Proposta**
  > Adicionar `docker-compose.test.yml` com Postgres efêmero + `AprovacoesSqlRepository.integration.test.ts` (padrão `describe('integration: …')` do CLAUDE.md) que aplica todas as migrations, executa `upsert`, `sincronizarTrilha` (trilha vazia e trilha com 3 etapas), `list` com cada combinação de filtro, `listByTitulos` com 100 chaves, e valida shape do resultado. Tactic Bass: **Sandbox** + **Executable Assertions**. Reaproveitar o setup de Postgres que a Frente IV documenta em `docs/e2e/hml-setup-executado.md`.

- **Resultado Esperado**
  > Migration 0049 aplicada em CI (`ci.yml` novo passo `npm run test:integration`); toda query da Frente V exercida contra Postgres pelo menos 1 vez.
  > - Queries executadas contra Postgres: 0 → ≥ 15 (todas as queries emitidas pelos 3 repositories)
  > - Integration tests da Frente V: 0 → ≥ 3 (`TituloAprovacao`, `EtapaAprovacao`, `AprovacaoIngestaoRun`)
  > - Migrations exercidas em CI: 0 (Frente V) → 1 (aplicação + rollback + reaplicação)

- **Tactic alvo**: Sandbox + Executable Assertions
- **Severidade**: P0
- **Esforço estimado**: L (1-2sem)
- **Findings relacionados**: F-testability-1, F-testability-7
- **Métricas de sucesso**:
  - Integration test files na Frente V: 0 → ≥ 3
  - Queries exercidas em Postgres real: 0 → ≥ 15
  - Job step `npm run test:integration` em `ci.yml`: ausente → presente e bloqueando
- **Risco de não fazer**: primeiro deploy do Frente V falha no `npm run migrate` OU pior — passa e serializa `status_workflow = 'APROVADO'` para linhas com etapa `INDETERMINADO` porque o CHECK aceitou o valor errado; retrabalho de correção em produção sob pressão.
- **Dependências**: nenhuma (o docker-compose é local ao repo)

### [testability-2] Cenário E2E de ingestão contra ERP fake in-process

- **Problema**
  > `IngestaoAprovacoesService.test.ts` usa fake de gateway construído inline; a rota `psq014/list` + `fin026/infoTitulo/list` nunca passou pela camada HTTP do `ConexosBaseClient`. A Frente IV mantém `buildErp()` em `routes/recebimentos.e2e.test.ts:640` que serve exatamente esse propósito para NDe. Formatos exigentes (docTip como número, docDtaEmissao#GE em epoch ms, orderList estável) são defendidos hoje só por asserção contra o postGeneric fake do teste unitário.

- **Melhoria Proposta**
  > Criar `routes/aprovacoes.e2e.test.ts` que sobe o ERP fake do padrão Frente IV, injeta `CONEXOS_BASE_URL` para o fake, dispara o `IngestaoAprovacoesService.executar` real (com registry de ports registrado) e observa: (a) as requests HTTP feitas ao fake — path literal `fin026/infoTitulo/list/{filCod}/{docTip}/{docCod}/{titCod}`, header `filCod`, filtro `docDtaEmissao#GE` como number; (b) o UPSERT no Postgres efêmero; (c) o resultado do painel via `GET /aprovacoes`. Tactic Bass: **Sandbox** + **Recordable Test Cases** (reproduzir o doc 4156/1 canônico ponta a ponta).

- **Resultado Esperado**
  > Ao menos um cenário happy-path (universo com 3 títulos, trilha canônica CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA) e um cenário de erro (ERP devolve 500 na página 2, retomada acerta) percorrem toda a stack.
  > - Cenários E2E da Frente V: 0 → ≥ 2
  > - Cenários E2E reaproveitando o harness da Frente IV: 0 → 1 (`buildErp` estendido com endpoints `psq014/list` + `fin026/infoTitulo/list`)
  > - Cobertura do path `route → service → repository → SQL → resposta`: hoje só em fakes isolados → 100% num cenário integrado

- **Tactic alvo**: Sandbox + Recordable Test Cases
- **Severidade**: P0
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-testability-2, F-testability-8
- **Métricas de sucesso**:
  - E2E test files Frente V: 0 → ≥ 1
  - Requests HTTP ao ERP fake validadas: 0 → ≥ 3 (universo + trilha + retomada)
  - Reuso do `buildErp()` da Frente IV: 0% → estendido para 2 endpoints novos
- **Risco de não fazer**: quando `ConexosBaseClient` mudar assinatura ou header de sessão, os testes da Frente V continuam verdes e o backfill em produção falha na primeira request; PV-07 (fin103) não terá baseline para comparar.
- **Dependências**: cross-QA com Integrability (o mesmo card serve como contract test do ERP)

### [testability-3] Suíte de teste para `jobs/ingest-aprovacoes.ts`

- **Problema**
  > O entrypoint do único job de produção da Frente V não tem teste. `resolverFilCods` parseia `FILS` de `process.env`, `resolverEmissaoDesde` calcula janela default de 12 meses, `main` valida presença de filiais e faz early-exit, orquestra `withAdvisoryLock` com `APROVACOES_INGEST_LOCK_KEY`, honra `RETOMAR=1`. Nenhum caminho testado — refactor desatento passa pelo CI.

- **Melhoria Proposta**
  > Extrair `resolverFilCods`, `resolverEmissaoDesde` e o `main` num módulo isolado (ou fazer inject de `process.env` no boundary) e adicionar `jobs/ingest-aprovacoes.test.ts` cobrindo: (a) `FILS="1, 2, "` → `[1, 2]`; (b) `FILS=""` → `process.exit(1)`; (c) `APROVACOES_BACKFILL_DESDE` inválido cai no fallback; (d) `RETOMAR=1` propaga `retomar: true` para `executar`. Tactic Bass: **Specialized Interfaces** (env como interface do boundary).

- **Resultado Esperado**
  > Todo caminho do entrypoint coberto por ao menos 1 caso.
  > - Test files em `jobs/` para a Frente V: 0/3 → 1/3 (probes ficam como scripts one-shot)
  > - Casos de teste do entrypoint: 0 → ≥ 6
  > - Superfície `resolverFilCods` / `resolverEmissaoDesde` isolada e testável direto

- **Tactic alvo**: Specialized Interfaces
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Casos de teste do job de produção: 0 → ≥ 6
  - Ratio `jobs/aprovacoes` com teste: 0/3 → 1/3
- **Risco de não fazer**: em produção, um `FILS` malformado varre filial errada; timezone da janela `emissaoDesde` (calculada com `Date.now()`) sofre drift de 3h em relação a `America/Sao_Paulo` sem que ninguém perceba.
- **Dependências**: nenhuma

### [testability-4] Injetar `ClockProvider` e propagar `agora` da rota

- **Problema**
  > `AprovacoesPainelService.listar(filtro, agora: Date = new Date())` tem fallback silencioso; `routes/aprovacoes.ts:114` e `:152` chamam sem passar `agora`. `IngestaoAprovacoesService.ts:91,163` faz `new Date()` embed para `startedAt` e `observadoEm`. Tests sempre passam `AGORA` explícito, o que quebra a paridade de comportamento entre teste e produção — a tactic *Limit Non-Determinism* está desenhada no service mas o loop não se fecha na rota.

- **Melhoria Proposta**
  > Introduzir `ClockProvider` (`@injectable()`, `now(): Date`) usado por `AprovacoesPainelService` e `IngestaoAprovacoesService`; **remover o default `= new Date()`** de `listar`/`detalhar` (torná-los mandatórios); rota `routes/aprovacoes.ts:114,152` passa `agora` calculado no boundary da request. Cross-QA com Modifiability (clock injetável é o mesmo lugar). Tactic Bass: **Limit Non-Determinism** + **Specialized Interfaces**.

- **Resultado Esperado**
  > Zero `new Date()` embed no código-fonte da Frente V; teste consegue congelar tempo via bind do `ClockProvider`.
  > - `new Date()`/`Date.now()` em código-fonte Frente V (não teste): 6 sítios → 0 (permitido apenas no `ClockProvider` e no boundary do job)
  > - Rota que passa `agora` explícito: 0/2 chamadas → 2/2
  > - Default `agora = new Date()` removido de `AprovacoesPainelService.listar`/`detalhar` (compilação passa a exigir passagem explícita)

- **Tactic alvo**: Limit Non-Determinism
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Sítios de `new Date()` fora de `ClockProvider`: 6 → 0 (na Frente V)
  - Tests que passam `agora` explícito: já 100% — manter
  - Chamadas de rota que passam `agora`: 0 → 2
- **Risco de não fazer**: `snapshotEm` reportado ao frontend não corresponde ao instante usado para "parada há" nas linhas do mesmo grid — a invariante I7 (a UI diz a idade única do dado) fica frágil e o painel financeiro auditável mostra números que divergem entre si por ms.
- **Dependências**: cross-QA com Modifiability

### [testability-5] Log assertions em caminhos de erro da ingestão

- **Problema**
  > `IngestaoAprovacoesService.executar` lança quando o ERP falha; nenhum teste verifica que o erro é logado com contexto (run id, filial, docCod, cursor). `LogService` sequer é injetado no service.

- **Melhoria Proposta**
  > Injetar `LogService` no `IngestaoAprovacoesService` (via constructor, `@inject(LogService)`); registrar `logService.error(err, { runId, filCod, cursor })` no `catch` antes de propagar; adicionar assertions em `IngestaoAprovacoesService.test.ts` sobre a chamada de `LogService.error`. Tactic Bass: **Executable Assertions** (observabilidade dos caminhos de erro).

- **Resultado Esperado**
  > Todo caminho `throw` no `IngestaoAprovacoesService` passa por `logService.error` com contexto estruturado, e há teste que asserta.
  > - Casos que asseram sobre log: 0/83 → ≥ 3 (ERP fora do ar, título com chave inválida, título com trilha vazia — os 3 caminhos de saída anormais)
  > - `LogService` injetado: 0/2 services novos → 2/2

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-5
- **Métricas de sucesso**:
  - Log calls asseridas em teste: 0 → ≥ 3
  - Services com `LogService` injetado (Frente V): 0/2 → 2/2
- **Risco de não fazer**: primeira falha em produção obriga o time a reconstruir o contexto do erro a partir do `aprovacao_ingestao_run.error_message` (limitado a 1 string) em vez de ler a stack de log com filCod/docCod.
- **Dependências**: nenhuma

### [testability-6] Property-based tests (fast-check) para os dois resolvers

- **Problema**
  > `StatusWorkflowResolver` e `EtapaStatusResolver` são funções puras cujas regras se expressam melhor como propriedades ("INDETERMINADO em qualquer posição ⇒ resultado INDETERMINADO", "todas CONCLUIDA ⇒ APROVADO"); hoje são exercitadas por 17 exemplos que passam com reordenação silenciosa dos `if`s se a amostra não pegar a permutação certa. `fast-check` **não está instalado** no repo.

- **Melhoria Proposta**
  > `cd src/backend && npm i -D fast-check` (o dep é 0-runtime); expressar as invariantes I4 e a precedência do `StatusWorkflowResolver` como propriedades em `StatusWorkflowResolver.property.test.ts`. Exemplos: `fc.assert(fc.property(fc.array(fc.constantFrom(...ETAPA_STATUS)), (estados) => (estados.includes('INDETERMINADO') ? resolver(estados) === 'INDETERMINADO' : true)))`. Tactic Bass: **Executable Assertions** (asserções paramétricas).

- **Resultado Esperado**
  > As duas invariantes centrais do workflow expressas como propriedade, com ≥ 100 amostras.
  > - Propriedades expressas: 0 → ≥ 4 (I4 do workflow, precedência de rejeição, mapeamento de rótulo, timestamps invertidos)
  > - Amostras geradas por run: 0 → ≥ 100 por propriedade
  > - Dependência: `fast-check` ausente → dev-dep presente

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-6
- **Métricas de sucesso**:
  - Propriedades ativas em CI: 0 → ≥ 4
  - Amostras por run: 0 → ≥ 400 (4 propriedades × 100)
- **Risco de não fazer**: reordenação inadvertida dos `if`s no `StatusWorkflowResolver` (regra 2 depois da 3) fica invisível aos 17 casos exemplo até que uma etapa específica em produção acuse.
- **Dependências**: nenhuma

### [testability-7] Ampliar `AprovacoesSql.test.ts` para combinações de filtro do `list`

- **Problema**
  > O teste captura 8 queries e valida named-param consistency, mas `TituloAprovacaoRepository.list` monta `WHERE` por concatenação condicional de 5 filtros — 32 combinações; o teste cobre apenas 1 combinação nominal e 1 negativa. Uma introdução de `$nome` órfão em ramificação não exercitada só cai no `SqlBuilder` no deploy.

- **Melhoria Proposta**
  > Adicionar 6 casos de `list` cobrindo os principais atalhos: (a) só `status`; (b) só `fornecedorCod`; (c) só `busca` (LIKE); (d) só janela `emissaoDe`/`emissaoAte` isoladas; (e) `sincronizarTrilha` com 100 etapas; (f) `listByTitulos` com chaves duplicadas. Cada caso submete a query capturada ao `SqlBuilder` real. Tactic Bass: **Executable Assertions** (branch coverage do builder de query).

- **Resultado Esperado**
  > Todas as ramificações condicionais do `list` exercitadas.
  > - Casos em `AprovacoesSql.test.ts`: 8 → ≥ 14
  > - Combinações de filtro do `list` cobertas: 2/32 (nominal + vazio) → ≥ 8 (todos os filtros isolados + duas combinações)
  > - Queries distintas capturadas: 6 → ≥ 12

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-testability-7
- **Métricas de sucesso**:
  - Casos capturados: 8 → ≥ 14
  - Filtros exercitados isoladamente: 1 → 5 (todos)
- **Risco de não fazer**: primeira query composta com filtro inédito emite `$nome` órfão em produção; 500 opaco na rota do painel.
- **Dependências**: `testability-1` (idealmente rodar as mesmas queries também contra Postgres)

### [testability-8] Integration test que roda ingestão + rota em pipeline único

- **Problema**
  > Frente V tem tests unitários fortes por camada, mas nenhum que **encadeie** as camadas. A Frente IV faz isso em `routes/recebimentos.e2e.test.ts:625-` com ERP fake + Postgres real; a Frente V não reaproveita.

- **Melhoria Proposta**
  > `routes/aprovacoes.e2e.test.ts`: `buildErp()` (estendido para os endpoints do fin026), Postgres efêmero, `bootstrapAppContainer()` real, executar `IngestaoAprovacoesService`, depois `GET /aprovacoes` e `GET /aprovacoes/1:4156:1/trilha`, e conferir que os dados batem com o que o ERP fake serviu. Tactic Bass: **Sandbox**.

- **Resultado Esperado**
  > O caso canônico do doc 4156/1 (CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA, 84.534 s) reproduzido ponta a ponta.
  > - Cenários ponta-a-ponta na Frente V: 0 → ≥ 1
  > - Cobertura do path `job → service → repo → SQL → rota → resposta`: 0 → 1 caso canônico + 1 caminho de erro

- **Tactic alvo**: Sandbox
- **Severidade**: P3 (após [testability-1] e [testability-2] estarem em pé, este vira consequência)
- **Esforço estimado**: M (2-5d)
- **Findings relacionados**: F-testability-8, F-testability-2
- **Métricas de sucesso**:
  - E2E encadeados: 0 → ≥ 1
  - Reuso do harness Frente IV: 0 → 1 arquivo estendido
- **Risco de não fazer**: refactors que atravessam camadas (ex.: quando PV-07 destravar e o binding do gateway trocar) não têm rede de segurança fora do teste em produção.
- **Dependências**: `testability-1` (Postgres em test); `testability-2` (buildErp estendido)

## 6. Notas do agente

- Cross-QA: F-testability-4 (Clock injetável) sobrepõe-se a Modifiability; F-testability-1/testability-1 e testability-2 sobrepõem-se a Integrability (contract tests do ERP e do Postgres) e a Deployability (coverage gate + migration apply-back em CI). F-testability-5 (log assertions) sobrepõe-se a Fault Tolerance (observabilidade dos erros de ingestão).
- Não medível localmente com `--quick`: cobertura em % por diretório da Frente V (piso do `jest.config.cjs` `./domain/service/`: `lines ≥ 88`, `branches ≥ 60` — herdado, não específico da fatia). Rodar `cd src/backend && npm test -- --coverage --collectCoverageFrom='**/aprovacoes/**'` num próximo run sem `--quick` para consolidar.
- `fast-check` foi mencionado no briefing como dep existente; **não está instalado** em nenhum `package.json` deste repo. Card `testability-6` ajusta.
- Score 6/10: seams excelentes (ports com `Symbol`, container idempotente, superfície read-only forçada, `agora` como parâmetro), business rules muito bem testadas (28 casos para os 3 resolvers, propriedades embutidas em comentário), mas os dois gaps estruturais (SQL nunca contra Postgres, ingestão nunca contra sandbox HTTP) são P0 — quem quiser subir a nota precisa fechar `testability-1` e `testability-2` primeiro.
