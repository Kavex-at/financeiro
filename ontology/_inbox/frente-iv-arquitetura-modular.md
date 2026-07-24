# Frente IV — Arquitetura Modular & Plano de Trabalho em Equipe

> **Purpose:** organize the code so each of the 6 modules can be built **in parallel by a different
> person**, against stable contracts, without blocking each other. This describes the **base scaffold**
> (interfaces + aggregate + DI + stubs) that we build first, and how teammates "finish" each module.
> **Date:** 2026-07-24 · **Feature:** `frente-iv-recebimentos` · Companion to `-nde-plan.md` / `-tasks.md`.

## 1. The one principle: contracts-first, aggregate-as-spine

The 6 modules form a **pipeline** — each stage enriches one shared object and hands it on:

```
importarTransacoes → atribuirBaixa → ratearRecebimento → aplicarRegras → executarRecebimento
   (TransacaoBancaria)     (+ match)       (+ parcelas)      (+ ajustes)     (+ baixa + NDe)
                                    \______________ Recebimento (aggregate) ______________/
                          Observabilidade (Module 6) envolve tudo via correlation id + eventos
```

Two things make this parallelizable:

1. **Every module is a Service behind an `*Interface` port.** No module imports another module's
   *implementation* — only its *interface* and the shared DTOs. Swap a stub for a real class via DI and
   nothing else changes.
2. **`Recebimento` is the spine.** It flows through every stage. Each stage reads the fields it needs
   and writes its own slice. The state machine (`rascunho → aprovado → executado → estornado`) defines
   exactly which fields each stage may touch — so two people editing "the same object" never collide,
   because they own different states/fields.

This is exactly how the repo already works (route → service → repository → client, tsyringe DI, ports
for external systems). We are applying it deliberately as the *parallelization boundary*.

## 2. Directory layout (matches existing `src/backend/` conventions)

```
src/backend/
  domain/
    interface/recebimentos/         # ← THE BASE. Built first. Owned by "architecture", frozen early.
      TransacaoBancaria.ts          #   entity DTOs + Zod schemas (boundary validation)
      DocumentoAReceber.ts
      Recebimento.ts                #   the aggregate type + RecebimentoStatus constants
      RateioRecebimento.ts
      CreditoCliente.ts
      NotaDebitoEletronica.ts
      ports.ts                      #   ALL the interfaces below + DI tokens (one file = one glance)
    client/
      nexxera/                      # Module 1 team
        NexxeraGateway.ts           #   implements NexxeraGatewayInterface (channel-agnostic)
        adapters/ApiAdapter.ts      #   pluggable: chosen after O7 spike
        adapters/SftpCnabAdapter.ts
      ConexosReceivablesClient.ts   # Module 5 team — parametrized fin010 baixa + NDe emit (O3 spike)
    repository/recebimentos/
      TransacaoRepository.ts        # Module 1
      RecebimentoRepository.ts      # shared spine — Module 2 seeds it, others update
      RecebimentoExecucaoRepository.ts  # Module 5 — the idempotency ledger (mirrors permuta_alocacao_execucao)
    service/recebimentos/
      IngestaoTransacoesService.ts  # Module 1
      MatchingService.ts            # Module 2
      RateioService.ts              # Module 3
      RegrasService.ts              # Module 4 (+ rules/ registry of RegraRecebimento plugins)
      ExecucaoRecebimentoService.ts # Module 5
      RecebimentoPipelineService.ts # coordinator — wires the stages via ports (owned by architecture)
    libs/observabilidade/           # Module 6 — correlation context, metrics port (reuses LogService)
  routes/recebimentos.ts            # HTTP surface (thin; delegates to services)
  migrations/00NN_*.sql             # one migration per aggregate table, additive
  jobs/                             # O7/O3 probes; later the scheduled ingest trigger
```

## 3. The seams — the contract between each module (`ports.ts`)

These interfaces are the **hand-off points**. Freeze them early; teammates code against them. Illustrative
signatures (repo style: `*Interface` suffix, arrow methods, explicit modifiers, Zod at boundaries):

| Module | Port (interface) | Input → Output |
|--------|------------------|----------------|
| 1 Import | `NexxeraGatewayInterface` | `fetch(period): Promise<RawMovimento[]>` — adapter hides API/SFTP |
| 1 Import | `IngestaoTransacoesInterface` | run → persists `TransacaoBancaria[]` (raw+normalized, deduped) |
| 2 Match | `MatchingEngineInterface` | `(t: TransacaoBancaria, openDocs) => MatchResult` (única/múltiplas/parcial/nenhuma) |
| 3 Rateio | `RateioEngineInterface` | `(r: Recebimento) => RateioRecebimento[]` (invariant I-Receb-1 enforced) |
| 4 Rules | `RegrasEngineInterface` + `RegraRecebimentoInterface` | `(parcelas, ctx) => ParcelaAjustada[]` (+ rationale); rules are plugins |
| 5 Exec | `ErpReceivablesGatewayInterface` + `NdeEmitterInterface` | `(r: Recebimento) => { baixa, nde }` (idempotent I-Receb-2, reversible) |
| 6 Obs | `MetricsPortInterface` + `CorrelationContext` | every stage emits events under one correlation id |

Example (the two most contract-heavy ports):

```typescript
export interface MatchingEngineInterface {
    match: (transacao: TransacaoBancaria, abertos: DocumentoAReceber[]) => Promise<MatchResult>;
}
export interface MatchResult {
    classificacao: MatchClassificacao;      // 'unica' | 'multiplas' | 'parcial' | 'nenhuma'
    candidatos: DocumentoAReceber[];
    score: number;                          // drives the manual-queue threshold
}

export interface ErpReceivablesGatewayInterface {
    criarBordero: (p: CriarBorderoParams) => Promise<BorderoCriado>;   // borVldTipo is a PARAM (not hardcoded 2)
    gravarBaixa: (p: GravarBaixaParams) => Promise<BaixaGravada>;      // account routing is a PARAM
    // dry-run + single-attempt discipline handled in the service, reused from the Permutas pattern
}
```

## 4. What "the base" contains (built first, before any module)

The base scaffold is a **compiling, runnable, fully-stubbed pipeline**:

- All DTOs + Zod schemas in `interface/recebimentos/`.
- All ports + DI tokens in `ports.ts`.
- `Recebimento` aggregate + `RecebimentoStatus` constants + the state-machine transition guards.
- **Stub implementations** of every port (in-memory / echo / no-op) registered in the DI container.
- `RecebimentoPipelineService` wiring the stages through the ports.
- A route skeleton + one migration per table (columns can grow additively).
- **Fixtures**: sample `TransacaoBancaria`, `DocumentoAReceber`, `Recebimento` for every team to test against.

Result: `npm run typecheck && npm test` is green with zero real logic. Any teammate can run the whole
pipeline end-to-end from hour one, seeing their module's real output flow through everyone else's stubs.

## 5. Parallelization plan — who starts when

| Team | Module | Can start now? | External dependency | Builds against |
|------|--------|----------------|---------------------|----------------|
| B | 2 Matching | ✅ fully | none | `TransacaoBancaria` + `DocumentoAReceber` fixtures |
| C | 3 Rateio | ✅ fully | none | `Recebimento` fixtures |
| F | 6 Observability | ✅ fully | none | the event contract every stage emits |
| A | 1 Import | 🟡 partial | **O7 spike** (channel) | normalizer/repo/service now; adapter after O7 |
| D | 4 Rules | 🟡 partial | **Phase-4 interviews** | engine + registry + 1 sample rule now; real rules after interviews |
| E | 5 Execution | 🟡 partial | **O3/NDe spike** | ledger + dry-run + gateway *interface* now; real payload after O3 |

Matching, Rateio, Observability are **unblocked today**. Import, Rules, Execution build their
*non-external* half now (services, ledgers, engines, fixtures) and slot the confirmed contract in when
the spike/interview returns. Nobody waits on the pipeline being "done."

## 6. How a teammate finishes a module (the workflow)

1. Read the port interface + the module's acceptance criteria (ontology action + `-tasks.md`).
2. Implement the class `@injectable()` behind the interface — **TDD against the fixtures**.
3. Swap the stub → real in the DI container (one token change).
4. Run the coordinator integration test: your module real, the rest still stubbed → verify the hand-off.
5. Ship the slice through the pipeline (`/feature-tweak <entity> "..."` → gates → Regis-Review → PR).

Because the contract is frozen, step 3 never breaks anyone else. Integration is continuous, not a big-bang.

## 7. Alignment with the Lambda alvo (free, if we respect the ports)

Services are **trigger-agnostic** (no Express/Lambda type in a service — the route/handler adapts). So
later: Module 1 becomes an EventBridge/`job/` Lambda; Modules 2–5 become API Gateway Lambdas or a Step
Functions orchestration that mirrors `RecebimentoPipelineService`. The migration touches wiring, **not
business logic**, precisely because the modules talk through ports. Same reason the DDD/Lambda-ready
rules (tsyringe, Zod boundaries, parameterized SQL) apply to this code even while it runs on Express today.

## 8. Testing strategy that protects modularity

- **Unit** — each module behind its interface, against fixtures. Fast, isolated, owned by that team.
- **Contract** — the external gateways (`NexxeraGatewayInterface`, `ErpReceivablesGatewayInterface`,
  `NdeEmitterInterface`) get contract tests validated by the **spike HARs** — this is where O7/O3/NDe land.
- **Integration** — the coordinator with reals + stubs; grows greener as modules land.
- **Ledger/idempotency** — the `recebimento_execucao` write-ahead tests (retry never double-quita/emits,
  I-Receb-2) reuse the proven `permuta_alocacao_execucao` test shape.

## 9. Build order recommendation
1. **Base scaffold** (architecture) — interfaces + aggregate + DI + stubs + fixtures + coordinator. One
   coded slice through the pipeline; this is what unlocks the team.
2. Teams B/C/F start immediately; A/D/E build their non-external half.
3. Spikes O7 and O3/NDe run in parallel; their outputs fill the gateway adapters + Phase-4 rules.
