# Shared Baseline Metrics — run 2026-07-24-2153

**Scope:** Frente IV base scaffold (uncommitted) in worktree `/tmp/frente-iv-base-scaffold-wt`.
**Mode:** `--quick` (skip coverage re-run, npm audit deep, terraform plan). Judge architecture/seams/DI/
ledger/migrations/gate of a **contracts-first, fully-stubbed** scaffold — business logic is intentionally
stubbed; do NOT file findings for "missing feature logic." Spec: `ontology/_inbox/frente-iv-arquitetura-modular.md`.

## Scaffold inventory (the ONLY files in scope)
- **Interfaces/DTOs:** `src/backend/domain/interface/recebimentos/` — constants, 7 entity DTOs+Zod,
  `recebimentoTransitions.ts` (state-machine guards), `ports.ts` (all module interfaces + Symbol DI tokens),
  `__fixtures__/*`, tests `recebimentoTransitions.test.ts`, `schemas.test.ts`.
- **Repositories:** `src/backend/domain/repository/recebimentos/` — `TransacaoRepository`, `RecebimentoRepository`,
  `RecebimentoExecucaoRepository` (write-ahead ledger, mirrors `PermutaExecucaoRepository`),
  `CreditoClienteRepository`, `RegraRecebimentoRepository`, `NdeRepository`.
- **Service:** `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts` (coordinator, injects TOKENS)
  + `stubs/` (8 port stubs) + `RecebimentoPipelineService.test.ts`.
- **DI/routes/http:** `domain/recebimentosContainer.ts`, `routes/recebimentos.ts`, `http/recebimentosGate.ts`.
- **Migrations:** `0032_transacao_bancaria.sql` … `0038_nota_debito_eletronica.sql` (7 tables).
- **Modified:** `domain/appContainer.ts`, `index.ts`, `domain/libs/environment/EnvironmentProvider.ts` + `model/EnvironmentVars.ts`.

## Baseline measurements
| Metric | Value | Source |
|---|---|---|
| New scaffold LOC (interface+repository+service) | 2256 | `find … -name '*.ts' \| xargs wc -l` |
| Migrations added | 7 (0032–0038) | `ls migrations/003[2-8]_*.sql` |
| New test files | 3 (`RecebimentoPipelineService.test.ts`, `recebimentoTransitions.test.ts`, `schemas.test.ts`) | find |
| Backend test files total | 207 | `find src/backend -name '*.test.ts' \| wc -l` |
| Test suite | 63 suites / **675 tests passed** (~22s) | `npm test` (verified by orchestrator) |
| typecheck | clean, 0 errors | `npm run typecheck` (verified) |
| lint (biome) | 0 errors, 28 warnings (all pre-existing legacy `services/conexos.ts`) | `npm run lint` (verified) |
| DocumentoAReceber | Conexos read-through (no table — by design) | scope override |

## Context every agent must honor
- Coordinator injects **DI tokens** (`Symbol()`), never concrete stubs — the stub→real swap is one token change.
- The write-ahead ledger (`recebimento_execucao`) is the idempotency/reversibility seam (I-Receb-2).
- `recebimentosGate` mirrors `sispagGate` (403 when disabled, enabled outside prod).
- 6 teammates will build the real module logic behind the ports — judge whether the SEAMS are sound.
