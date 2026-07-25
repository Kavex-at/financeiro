# Tasks: frente-iv-base-scaffold

**Spec source:** `ontology/_inbox/frente-iv-arquitetura-modular.md` (companion:
`ontology/_inbox/frente-iv-recebimentos-nde-plan.md`)
**Ontology diff:** no — Frente IV entities/state-machines/actions already exist as `status: planned`
skeletons (ontology_version 0.11). This slice writes **code only**; it does NOT edit the ontology,
`_index.json`, or `_coverage.json`. Stubs do not count as coverage → entities stay `planned`.
**entity_changed:** false
**Estimated scope:** **L** — ~22 new source files across 4 layers (interface / repository / service /
route) + 4 migrations + 3 fixtures + tests. No real business logic, but wide surface (7 entities, ~10
ports, coordinator + stubs) that must compile, lint, and pass tests green.

**Migration numbers chosen:** next free is **0032** (last existing is `0031_sispag_modalidade.sql`).
**SCOPE OVERRIDE (Yuri, 2026-07-24): create tables for ALL persisted entities now — do NOT defer.**
This slice adds **`0032`–`0038`** (one table per persisted entity table, additive). `DocumentoAReceber`
stays a Conexos read-through (NO table — read-model of open receivables):
- `0032_transacao_bancaria.sql`
- `0033_recebimento.sql`
- `0034_rateio_recebimento.sql`
- `0035_recebimento_execucao.sql` (write-ahead ledger — mirrors `0015_permuta_alocacao_execucao.sql`)
- `0036_credito_cliente.sql`
- `0037_regra_recebimento.sql`
- `0038_nota_debito_eletronica.sql`

Thin repositories were also added for `credito_cliente`, `regra_recebimento`, and
`nota_debito_eletronica` (parameterized SQL, same style as the SISPAG/permutas repos).

**Test runner:** **jest** (`ts-jest`, `testMatch: **/*.test.ts`, `maxWorkers: 2`). Note the coverage
gate: `./domain/service/` floors at **88% lines / 60% branches** — the coordinator + service-layer
stubs MUST be exercised by tests (see Task 10) or CI trips.

---

## Task list

### Task 1: DTOs + Zod schemas + status constants — `interface/recebimentos/` (part 1: the 7 entities)
**Files to create:**
- `src/backend/domain/interface/recebimentos/TransacaoBancaria.ts`
- `src/backend/domain/interface/recebimentos/DocumentoAReceber.ts`
- `src/backend/domain/interface/recebimentos/Recebimento.ts`
- `src/backend/domain/interface/recebimentos/RateioRecebimento.ts`
- `src/backend/domain/interface/recebimentos/CreditoCliente.ts`
- `src/backend/domain/interface/recebimentos/NotaDebitoEletronica.ts`
- `src/backend/domain/interface/recebimentos/RegraRecebimento.ts`

**Notes / shape source:** properties come 1:1 from `ontology/entities/*.md` tables. Follow the SISPAG
interface style (`domain/interface/sispag/SispagInterface.ts`): `export interface X { ... }`, optional
fields as `field?: Type` (never `| undefined`), snake→camel DTO fields, Portuguese field names where they
mirror DB columns (`docCod`, `filCod`, `pesCod`).

**Status/enum constants (typed, never raw strings — ontology P3):**
- `RECEBIMENTO_STATUS = { RASCUNHO:'rascunho', APROVADO:'aprovado', EXECUTADO:'executado', ESTORNADO:'estornado' } as const`
  → `type RecebimentoStatus = (typeof RECEBIMENTO_STATUS)[keyof typeof RECEBIMENTO_STATUS]`
  (values exactly as `state-machines/recebimento.md`).
- `TRANSACAO_BANCARIA_STATUS = { IMPORTADA, CONCILIADA, PARCIAL, MANUAL, ERRO }` → `TransacaoBancariaStatus`
  (values from `state-machines/transacao-bancaria.md`).
- `TRANSACAO_TIPO = { CREDITO, DEBITO, ESTORNO, TARIFA, JUROS }` → `TransacaoTipo` (open enum per entity note; Fase 1 refines).
- `MATCH_CLASSIFICACAO = { UNICA:'unica', MULTIPLAS:'multiplas', PARCIAL:'parcial', NENHUMA:'nenhuma' }` → `MatchClassificacao`.
- `PARCELA_FINALIDADE`/`COMPONENTE = { PRINCIPAL, MULTA, JUROS, ENCOMENDA }` → `ParcelaFinalidade` (Fase 4 refines).
- `NDE_STATUS_EMISSAO = { PENDENTE, EMITIDA, ERRO }`; `CREDITO_CLIENTE_STATUS = { DISPONIVEL, PARCIAL, CONSUMIDO }`.

**Zod schemas (boundary validation — one per entity, colocated):** `export const transacaoBancariaSchema = z.object({...})`
etc. Use `z.enum([...])` (or `z.nativeEnum`) tied to the const objects above; `filCod` = `z.number().int().positive()`
(multi-filial invariant, never null); optional fields `.optional()`; `rawPayload`/`normalized`/`parametros` = `z.unknown()`/`z.record(...)`.
Derive DTO types with `z.infer<>` **or** hand-write the interface and keep the schema aligned (match repo
practice in `ConexosBaixaClient` — Zod at boundaries, explicit interfaces for shapes).

**Acceptance criteria:**
- [ ] Each of the 7 entities has an exported DTO type + a Zod schema.
- [ ] All 6 typed-constant enums exported (`RecebimentoStatus`, `TransacaoBancariaStatus`, `TransacaoTipo`,
      `MatchClassificacao`, `ParcelaFinalidade`, plus `NdeStatusEmissao`/`CreditoClienteStatus`).
- [ ] No raw string literals for status anywhere (P3).
- [ ] English identifiers; Portuguese only for DB-mirroring field names.
- [ ] `npm run typecheck` passes for these files.

**Dependencies:** none.

---

### Task 2: The aggregate type + state-machine transition guards (pure functions)
**Files to create/modify:**
- `src/backend/domain/interface/recebimentos/Recebimento.ts` (extend from Task 1 — the aggregate root type:
  embeds `rateios: RateioRecebimento[]`, `regrasAplicadas: RegraRecebimento[]`, derived `valorAlocado`/`diferencaNaoAlocada`,
  `resultadoExecucao?`, `ndeId?`, `versao`, audit actors).
- `src/backend/domain/interface/recebimentos/recebimentoTransitions.ts` — pure transition guards.

**Guards to implement (pure, no I/O — mirror `state-machines/recebimento.md` R1–R5 + `transacao-bancaria.md` TB1–TB5):**
- `canTransitionRecebimento(from: RecebimentoStatus, to: RecebimentoStatus): boolean` — allow only
  `rascunho→aprovado` (R2), `aprovado→rascunho` (R3), `aprovado→executado` (R4), `executado→estornado` (R5); reject all others.
- `assertTransitionRecebimento(from, to): void` — throws on illegal transition (use existing `HandlerError`
  shape from `domain/libs/handler/HandlerError.js` if a domain error is warranted; otherwise a typed `Error`).
- `canTransitionTransacao(from: TransacaoBancariaStatus, to: TransacaoBancariaStatus): boolean` — allow
  `importada→{conciliada,parcial,manual}` and `{importada,parcial,manual}→erro`.
- `computeValorAlocado(rateios)` / `computeDiferencaNaoAlocada(recebimento)` — pure derivations.

**Acceptance criteria:**
- [ ] `Recebimento` aggregate type compiles and references the member DTOs from Task 1.
- [ ] Guards are pure (no `container`, no DB, no `Date.now()` inside the decision).
- [ ] Illegal transitions (e.g. `rascunho→executado`, `executado→rascunho`, `estornado→*`) return `false` / throw.
- [ ] `computeValorAlocado` returns Σ of `rateio.valorAlocado`; invariant helper flags `Σ > valorRecebido`.
- [ ] Explicit access, arrow-function exports where methods; classes exported (functions may be exported
      as named consts per repo style for pure helpers — match how `utils/` exposes helpers).

**Dependencies:** Task 1.

---

### Task 3: `ports.ts` — all module interfaces + DI tokens
**Files to create:**
- `src/backend/domain/interface/recebimentos/ports.ts`

**Interfaces (all with `*Interface` suffix, arrow-method signatures, explicit types — §3 of the spec):**
- `NexxeraGatewayInterface` — `fetch(period): Promise<RawMovimento[]>`
- `IngestaoTransacoesInterface` — `run(input): Promise<IngestaoTransacoesResult>` (persists `TransacaoBancaria[]`)
- `MatchingEngineInterface` — `match(t: TransacaoBancaria, abertos: DocumentoAReceber[]): Promise<MatchResult>`
  (+ `MatchResult { classificacao: MatchClassificacao; candidatos: DocumentoAReceber[]; score: number }`)
- `RateioEngineInterface` — `ratear(r: Recebimento): Promise<RateioRecebimento[]>`
- `RegrasEngineInterface` — `aplicar(parcelas, ctx): Promise<ParcelaAjustada[]>` + `RegraRecebimentoInterface`
  (the plugin: `tipo`, `aplica(ctx): ParcelaAjustada[]` + rationale)
- `ErpReceivablesGatewayInterface` — `criarBordero(p: CriarBorderoParams): Promise<BorderoCriado>`;
  `gravarBaixa(p: GravarBaixaParams): Promise<BaixaGravada>` (**`borVldTipo`, account routing are PARAMS — never hardcoded**)
- `NdeEmitterInterface` — `emitir(r: Recebimento): Promise<NotaDebitoEletronica>` (idempotent)
- Repository interfaces: `TransacaoRepositoryInterface`, `RecebimentoRepositoryInterface`,
  `RecebimentoExecucaoRepositoryInterface`
- `MetricsPortInterface` + `CorrelationContext` (Module 6) — `emit(event): void`, `withCorrelationId(...)`.

**DI tokens:** one `Symbol(...)` per port, following `LEGACY_CONEXOS_TOKEN` in `ConexosBaseClient.ts`:
```
export const NEXXERA_GATEWAY_TOKEN = Symbol('NexxeraGatewayInterface');
export const MATCHING_ENGINE_TOKEN = Symbol('MatchingEngineInterface');
// ... one per port (10 tokens)
```
(Interface types can't be tsyringe tokens directly — tokens are the injection points teammates swap.)

**Acceptance criteria:**
- [ ] Every port from §3 present with the exact signatures (arrow methods, `Promise<>` returns).
- [ ] One exported `Symbol` token per port (≥10 tokens).
- [ ] `MatchResult`, `CriarBorderoParams`/`BorderoCriado`, `GravarBaixaParams`/`BaixaGravada`, `ParcelaAjustada`,
      `RawMovimento` supporting types defined (or imported from Fin010Baixa where reuse is clean).
- [ ] `borVldTipo` + account routing appear as parameters on `ErpReceivablesGatewayInterface`, not constants.
- [ ] `npm run typecheck` passes.

**Dependencies:** Tasks 1, 2.

---

### Task 4: Migration skeletons (0032–0038) — SCOPE OVERRIDE (Yuri): all persisted entities now
**Files to create:**
- `src/backend/migrations/0032_transacao_bancaria.sql`
- `src/backend/migrations/0033_recebimento.sql`
- `src/backend/migrations/0034_rateio_recebimento.sql`
- `src/backend/migrations/0035_recebimento_execucao.sql`
- `src/backend/migrations/0036_credito_cliente.sql`
- `src/backend/migrations/0037_regra_recebimento.sql`
- `src/backend/migrations/0038_nota_debito_eletronica.sql`

**DDL style (follow `0015_permuta_alocacao_execucao.sql`):** `CREATE TABLE IF NOT EXISTS`, `snake_case`
columns matching the entity `Coluna` tables, `TIMESTAMPTZ NOT NULL DEFAULT now()`, `CHECK (status IN (...))`
with the ontology status values, `UNIQUE` on natural/idempotency keys, `CREATE INDEX IF NOT EXISTS` on
lookup columns. Idempotent (re-runnable). `fil_cod INTEGER NOT NULL` on every table (multi-filial invariant).

- `0032`: `transacao_bancaria` — `id`, `correlation_id`, `fil_cod`, `data_movimento`, `tipo`, `valor`,
  `moeda`, `contraparte`, `referencia_bancaria`, `natural_key` (UNIQUE for dedup), `raw_payload JSONB`,
  `normalized JSONB`, `status` (CHECK importada/conciliada/parcial/manual/erro), `import_run_id`, `importado_em`.
- `0033`: `recebimento` — `id`, `correlation_id`, `transacao_id` (FK), `fil_cod`, `classificacao_match`,
  `status` (CHECK rascunho/aprovado/executado/estornado), `valor_recebido`, `resultado_execucao JSONB`,
  `nde_id`, `versao`, audit actors (`criado_por`/`aprovado_por`/`executado_por`/`estornado_por`), `criado_em`.
- `0034`: `rateio_recebimento` — `id`, `recebimento_id` (FK), `doc_cod`, `tit_cod`, `fil_cod`, `pri_cod`,
  `componente`, `finalidade` (NOT NULL — invariant), `valor_alocado`, `moeda`, `incluido_por`.
- `0035`: `recebimento_execucao` — write-ahead ledger mirroring `permuta_alocacao_execucao`:
  `idempotency_key TEXT UNIQUE`, `recebimento_id`, `fil_cod`, `status` (CHECK pending/reconciling/settled/error),
  `dry_run BOOLEAN NOT NULL DEFAULT TRUE`, `bor_cod`, `nde_id`, `request_payload JSONB`, `erp_response JSONB`,
  `erro_mensagem`, `executado_por`, `criado_em`/`atualizado_em`.

**Acceptance criteria:**
- [ ] Seven additive migrations, numbered 0032–0038, no gaps, no renumbering of existing files.
- [ ] Every table has `fil_cod` NOT NULL; every `status`/`status_emissao` has a `CHECK` matching ontology constants.
- [ ] `0035` (recebimento_execucao) + `0038` (nota_debito_eletronica) have `UNIQUE (idempotency_key)`;
      `0035` status CHECK identical in spirit to `0015`.
- [ ] `DocumentoAReceber` has NO table (Conexos read-through).
- [ ] Migrations are idempotent (`IF NOT EXISTS`) — safe to re-run.
- [ ] The migration runner picks them up (naming matches `00NN_name.sql`).

**Dependencies:** none (parallel with Tasks 1–3).

---

### Task 5: Repositories — `repository/recebimentos/` (real, thin — the spine persistence)
**Files to create:**
- `src/backend/domain/repository/recebimentos/TransacaoRepository.ts` (`implements TransacaoRepositoryInterface`)
- `src/backend/domain/repository/recebimentos/RecebimentoRepository.ts` (the shared spine)
- `src/backend/domain/repository/recebimentos/RecebimentoExecucaoRepository.ts` (idempotency ledger —
  mirror `PermutaExecucaoRepository`: `findByIdempotencyKey`, `beginExecution` write-ahead upsert,
  `markSettled`, `markError`)

**Style:** `@injectable()`, `@inject(PostgreeDatabaseClient)`, arrow methods, explicit modifiers,
**100% parameterized SQL** (named `$key` params like the existing repos — Rule #5), `mapRow` private helper.
These are thin CRUD/ledger over the 0032–0035 tables; **no business logic**.

**Acceptance criteria:**
- [ ] Each repo `@injectable()` and implements its port interface from Task 3.
- [ ] All SQL parameterized (no string interpolation of values) — Rule #5.
- [ ] `RecebimentoExecucaoRepository.beginExecution` mirrors the `settled`-preserving upsert (idempotency:
      re-execution with same key never regresses `settled`).
- [ ] `npm run typecheck` + PatternGuardian pass (DI + SQL safety).

**Dependencies:** Tasks 1, 3, 4.

---

### Task 6: Stub `@injectable()` implementations of every port (in-memory / echo / no-op)
**Files to create:**
- `src/backend/domain/service/recebimentos/stubs/NexxeraGatewayStub.ts`
- `src/backend/domain/service/recebimentos/stubs/IngestaoTransacoesStub.ts`
- `src/backend/domain/service/recebimentos/stubs/MatchingEngineStub.ts`
- `src/backend/domain/service/recebimentos/stubs/RateioEngineStub.ts`
- `src/backend/domain/service/recebimentos/stubs/RegrasEngineStub.ts`
- `src/backend/domain/service/recebimentos/stubs/ErpReceivablesGatewayStub.ts`
- `src/backend/domain/service/recebimentos/stubs/NdeEmitterStub.ts`
- `src/backend/domain/service/recebimentos/stubs/MetricsPortStub.ts`

**Behaviour (deterministic, no external I/O, no real logic):** e.g. `NexxeraGatewayStub.fetch` → `[]` or a
fixed sample; `MatchingEngineStub.match` → `{ classificacao: 'nenhuma', candidatos: [], score: 0 }`;
`RateioEngineStub.ratear` → `[]`; `RegrasEngineStub.aplicar` → echo parcelas unchanged; `ErpReceivablesGatewayStub`
→ echo a fake `borCod`/`bxaCodSeq` under `dry_run`; `NdeEmitterStub` → a `pendente` NDe; `MetricsPortStub` → no-op.
Each `@injectable()`, `implements XInterface`, arrow methods, explicit modifiers.

**Acceptance criteria:**
- [ ] One stub per port; each `@injectable()` and `implements` its interface (typecheck-enforced).
- [ ] Stubs are pure/deterministic — no DB, no network, no `EnvironmentProvider` needed.
- [ ] No real business logic (echo/no-op/fixed) — clearly commented as SKELETON/stub.
- [ ] `npm run typecheck` passes.

**Dependencies:** Tasks 1, 3.

---

### Task 7: DI registration — bind tokens → stubs (+ real repos)
**Files to create/modify:**
- `src/backend/domain/recebimentosContainer.ts` (new — `registerRecebimentosPorts()` binding each token to
  its stub via `container.register(TOKEN, { useClass: XStub })`; repos are class-injectable already).
- `src/backend/domain/appContainer.ts` (modify — call `registerRecebimentosPorts()` inside
  `bootstrapAppContainer()`, idempotently, next to the existing legacy-adapter registration).

**Acceptance criteria:**
- [ ] `container.resolve(TOKEN)` returns the stub for **every** port token (proven in Task 10 test).
- [ ] Registration is idempotent (guard like the existing `bootstrapped` flag / register-once).
- [ ] No raw `process.env` — any env read goes through `EnvironmentProvider` (Rule #8).
- [ ] PatternGuardian passes (tsyringe conventions, no direct client instantiation).

**Dependencies:** Tasks 3, 5, 6.

---

### Task 8: `RecebimentoPipelineService` — the coordinator
**Files to create:**
- `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts`

**Behaviour:** `@injectable()` coordinator that wires the stages **through the injected port tokens** (never
concrete stubs): `importarTransacoes → atribuirBaixa → ratearRecebimento → aplicarRegras → executarRecebimento`
(§1 pipeline). Constructor `@inject(TOKEN)` for each port + `@inject(...Repository)` for the spine +
`@inject(LogService)`. Each stage: read the fields it needs off the `Recebimento` spine, call the port, write
its slice back, emit a metrics event under the correlation id. Uses `assertTransitionRecebimento` guard (Task 2)
before each state change. Reuses `IngestaoPagamentosService` shape for the ingest stage (advisory-lock/idempotency
hooks are wired but delegate to the stub in the scaffold). **No real business logic** — orchestration only.

**Acceptance criteria:**
- [ ] Depends only on **port tokens + repo interfaces**, never on a concrete stub class (swap-a-token property).
- [ ] Runs all 5 stages end-to-end returning an enriched `Recebimento` (all stubbed).
- [ ] State transitions go through the Task 2 guards.
- [ ] `LogService` used for structured logs; a `MetricsPortInterface` event emitted per stage (correlation id).
- [ ] Explicit modifiers, arrow methods, exported class; `import 'reflect-metadata'` at entry where needed.
- [ ] `npm run typecheck` + PatternGuardian pass.

**Dependencies:** Tasks 2, 3, 5, 6, 7.

---

### Task 9: Route skeleton — `routes/recebimentos.ts` (thin, gated, delegates to coordinator)
**Files to create/modify:**
- `src/backend/routes/recebimentos.ts` (new — Router; delegates to `RecebimentoPipelineService`;
  `await bootstrapAppContainer()` per handler; Zod `safeParse` on body/query; `requireRole('admin')` on
  write-ish routes; `heavyRouteLimiter` on the ingest route — mirror `routes/sispag.ts`).
- `src/backend/http/recebimentosGate.ts` (new — feature gate mirroring `http/sispagGate.ts`; reads
  `recebimentosEnabled` via `EnvironmentProvider`, 403 when off). Add `resolveRecebimentosEnabled` to
  `EnvironmentProvider` (default: enabled outside production, like SISPAG).
- `src/backend/index.ts` (modify — `app.use('/recebimentos', recebimentosGate, recebimentosRouter)` in the
  same block as `/sispag`).

**Route surface (skeleton — read + trigger only):** `GET /recebimentos/painel` (echo/empty),
`POST /recebimentos/pipeline/run` (runs the stubbed coordinator, `Idempotency-Key` honored), and thin
`GET`s that return coordinator/repo reads.

**Acceptance criteria:**
- [ ] Router mounted behind `recebimentosGate` (403 when disabled), like `/sispag`.
- [ ] Every handler validates input with Zod at the boundary (Rule: Zod at boundaries).
- [ ] No business logic in the route — delegates to `RecebimentoPipelineService`.
- [ ] Env read via `EnvironmentProvider`, not raw `process.env` (Rule #8).
- [ ] `npm run typecheck` + `npm run lint` pass.

**Dependencies:** Task 8.

---

### Task 10: Fixtures + unit tests (the green proof)
**Files to create:**
- `src/backend/domain/interface/recebimentos/__fixtures__/transacaoBancaria.fixture.ts`
- `src/backend/domain/interface/recebimentos/__fixtures__/documentoAReceber.fixture.ts`
- `src/backend/domain/interface/recebimentos/__fixtures__/recebimento.fixture.ts`
- `src/backend/domain/interface/recebimentos/recebimentoTransitions.test.ts`
- `src/backend/domain/interface/recebimentos/schemas.test.ts`
- `src/backend/domain/service/recebimentos/RecebimentoPipelineService.test.ts`

**Fixtures:** typed sample `TransacaoBancaria`, `DocumentoAReceber`, `Recebimento` (valid against the Zod
schemas), reusable by all 6 teammate teams.

**Tests must prove (spec §8):**
1. **Stubbed pipeline runs end-to-end via the coordinator** — resolve `RecebimentoPipelineService` from the
   container (stubs bound), run all 5 stages, assert an enriched `Recebimento` comes out. (Covers the
   `./domain/service/` coverage floor — exercise every stage/branch of the coordinator.)
2. **State-machine guards reject illegal transitions** — `canTransitionRecebimento('rascunho','executado')`
   is `false`; `assertTransitionRecebimento('executado','rascunho')` throws; legal ones pass. Same for
   `canTransitionTransacao`.
3. **Zod schemas validate a fixture** — each entity schema `.parse(fixture)` succeeds; a malformed fixture
   (e.g. `filCod: null`, bad `status`) fails `.safeParse`.

**Acceptance criteria:**
- [ ] `npm test` green; new tests included in the run (`*.test.ts` under `src/backend/`).
- [ ] Coverage gate holds: `./domain/service/` ≥ 88% lines / 60% branches (coordinator + service stubs tested).
- [ ] Pipeline test resolves via `container.resolve` (proves Task 7 wiring), not by `new`-ing the service.
- [ ] Guard test asserts at least 3 illegal transitions rejected + all 4 legal ones allowed.
- [ ] Schema test validates all 7 fixtures/DTOs and rejects ≥1 malformed input.

**Dependencies:** Tasks 1, 2, 6, 7, 8.

---

### Task 11: ObservabilityAdvisor review (auto-trigger)
The scaffold introduces `MetricsPortInterface` + `CorrelationContext` (Module 6 seam) and a coordinator that
emits per-stage events — the "new handler/job → observability" auto-trigger applies at the **seam** level
(no real Lambda handler yet; Express today). Route: `ObservabilityAdvisor` reviews the correlation-id
propagation + metrics-port contract so Module 6 lands cleanly later.

**Acceptance criteria:**
- [ ] `MetricsPortInterface` + correlation-id contract reviewed; every coordinator stage emits under one id.
- [ ] No PII in event payloads; structured `LogService` reused (not a parallel logger).

**Dependencies:** Task 8. **Note:** AwsInfraArchitect is **NOT** triggered — no `infra/` files touched
(there is no Terraform in this repo today).

---

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (from `src/backend`)
- [ ] `npm run lint` ✅ (biome — 4 spaces, single quotes, trailing commas, width 100)
- [ ] `npm test` ✅ — including: **the stubbed pipeline runs end-to-end via the coordinator**, guards reject
      illegal transitions, Zod schemas validate the fixtures; coverage floors hold.
- [ ] PatternGuardian gate ✅ (DDD chain, tsyringe DI, parameterized SQL, `EnvironmentProvider`, arrow methods
      + explicit modifiers + exported classes, `reflect-metadata` at entry points)
- [ ] ObservabilityAdvisor review ✅ (metrics port + correlation-id seam)
- [ ] entity_changed = false → **no** ontology diff required; **do NOT** edit `_index.json`/`_coverage.json`;
      entities stay `status: planned` (stubs are not coverage)
- [ ] Frontend untouched → DesignSystemReviewer **not** required
- [ ] AwsInfraArchitect **not** triggered (no `infra/`)
- [ ] If the delta has `feat`/`fix`/`perf` in `src/` at Ship → app version bump (FE+BE lockstep) via
      `scripts/bump-version.ps1` + `CHANGELOG.md` (handled by AutoLoopRunner at Ship, not here)

---

## Files to create / modify (map)

**Create (interface layer):**
- `domain/interface/recebimentos/TransacaoBancaria.ts`, `DocumentoAReceber.ts`, `Recebimento.ts`,
  `RateioRecebimento.ts`, `CreditoCliente.ts`, `NotaDebitoEletronica.ts`, `RegraRecebimento.ts`,
  `recebimentoTransitions.ts`, `ports.ts`
- `domain/interface/recebimentos/__fixtures__/{transacaoBancaria,documentoAReceber,recebimento}.fixture.ts`

**Create (repository layer):**
- `domain/repository/recebimentos/TransacaoRepository.ts`, `RecebimentoRepository.ts`, `RecebimentoExecucaoRepository.ts`

**Create (service layer):**
- `domain/service/recebimentos/RecebimentoPipelineService.ts`
- `domain/service/recebimentos/stubs/{NexxeraGateway,IngestaoTransacoes,MatchingEngine,RateioEngine,RegrasEngine,ErpReceivablesGateway,NdeEmitter,MetricsPort}Stub.ts`

**Create (routes / http / DI):**
- `routes/recebimentos.ts`, `http/recebimentosGate.ts`, `domain/recebimentosContainer.ts`

**Create (migrations) — 0032–0038 (Yuri override: all persisted entities now):**
- `migrations/0032_transacao_bancaria.sql`, `0033_recebimento.sql`, `0034_rateio_recebimento.sql`,
  `0035_recebimento_execucao.sql`, `0036_credito_cliente.sql`, `0037_regra_recebimento.sql`,
  `0038_nota_debito_eletronica.sql`

**Create (repository layer — added thin repos per Yuri override):**
- `domain/repository/recebimentos/CreditoClienteRepository.ts`, `RegraRecebimentoRepository.ts`, `NdeRepository.ts`

**Create (tests):**
- `domain/interface/recebimentos/recebimentoTransitions.test.ts`, `schemas.test.ts`
- `domain/service/recebimentos/RecebimentoPipelineService.test.ts`

**Modify:**
- `domain/appContainer.ts` (call `registerRecebimentosPorts()`)
- `index.ts` (mount `/recebimentos` behind the gate)
- `domain/libs/environment/EnvironmentProvider.ts` (add `resolveRecebimentosEnabled`)

**Do NOT touch:** `ontology/_index.json`, `ontology/_coverage.json`, any `ontology/**/*.md`
(this is a code-only slice; entities remain `planned`).

---

## Risks / conventions to respect

- **tsyringe registration:** ports are interfaces → not tokens. Use `Symbol(...)` tokens (like
  `LEGACY_CONEXOS_TOKEN`) + `container.register(TOKEN, { useClass: XStub })`; resolve via
  `container.resolve(TOKEN)`. Registration must be **idempotent** (bootstrap-once). The coordinator must
  `@inject(TOKEN)` — never `new XStub()` — so a teammate swaps one token to go real (spec §6 step 3).
- **EnvironmentProvider, not raw `process.env`** (Rule #8) — including the new `recebimentosEnabled` gate.
- **Parameterized SQL only** (`$key` named params, Rule #5) — the ledger + repos; never interpolate values.
- **Class/method conventions** (Rule #9): export classes; `public method = () => {}` arrow methods; explicit
  access modifiers; optional as `field?: Type`; no `!` non-null assertions (biome `noNonNullAssertion: error`).
- **Zod at boundaries** — route inputs + external payloads validated; status/enums as typed constants (P3),
  never raw strings.
- **English identifiers** only (classes/vars/functions); Portuguese allowed for DB-mirroring field names.
- **`import 'reflect-metadata'`** at execution entry points (route module / any file that resolves DI at load).
- **Coverage gate risk:** `./domain/service/` floors at 88% lines / 60% branches — the coordinator + service
  stubs live under `domain/service/`, so Task 10 MUST exercise every pipeline stage/branch or CI trips.
- **Lambda-alvo alignment** (§7): keep services trigger-agnostic — **no** Express types inside services; the
  route/gate adapts. This is a code-only slice; Express today, Lambda-ready.

---

## Scope decisions / ambiguities (confirm with Yuri)

1. **Repos real vs stubbed.** The spec lists repos under `interface/recebimentos` seams AND as Module-owned
   classes. Decision taken: **repos are real-but-thin** (they must persist the spine for the coordinator to be
   "runnable"), while the **engines/gateways are stubbed**. If you'd rather the repos also be in-memory stubs
   for hour-one zero-DB runs, say so — the pipeline test runs DB-free either way (it uses stubs; repo tests
   can be unit-level with a mocked `PostgreeDatabaseClient`, matching existing repo tests).
2. **Feature gate.** Added `recebimentosGate` + `recebimentosEnabled` mirroring `sispagGate` (default:
   enabled outside production). Confirm you want the same 403-when-disabled posture.
3. **`CreditoCliente` / `RegraRecebimento` ports.** ~~Deferred~~ **SUPERSEDED by Yuri override (2026-07-24):**
   ships DTO + schema + the `RegraRecebimentoInterface` plugin seam + no-op stub rule **AND** the
   `credito_cliente` (0036) / `regra_recebimento` (0037) tables + thin repositories now.
4. **Migration count.** ~~4 tables~~ **SUPERSEDED by Yuri override:** **7 tables (0032–0038)** — all persisted
   entities now. `DocumentoAReceber` stays a Conexos read-through (no table).
5. **NDe as a port only.** ~~Table deferred to Fase 5~~ **SUPERSEDED by Yuri override:** `NdeEmitterInterface`
   + stub **AND** the `nota_debito_eletronica` (0038) table + `NdeRepository` ship now (idempotency via the
   UNIQUE `idempotency_key`). The emission contract (endpoint/wire) is still Fase 5.
