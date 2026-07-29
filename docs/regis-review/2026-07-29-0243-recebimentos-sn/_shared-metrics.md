# Shared Baseline Metrics — Regis-Review

- **run_id:** `2026-07-29-0243-recebimentos-sn`
- **scope:** feature gate — `gerarSolicitacaoNumerario` (SN) delta on branch `fix/recebimentos-alocar-sn`
- **worktree:** `~/kavex-worktrees/recebimentos-alocar-sn`
- **app version:** backend/frontend `0.17.6`

## Feature delta under review (touched files)

Backend (new):
- `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts` (122 LOC)
- `src/backend/domain/service/recebimentos/stubs/ProcessoProviderStub.ts` (31)
- `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.test.ts`
- `src/backend/domain/service/recebimentos/stubs/ProcessoProviderStub.test.ts`
- `src/backend/domain/interface/recebimentos/GerDocProcesso.ts` (135)
- `src/backend/domain/interface/recebimentos/__fixtures__/processo.fixture.ts`
- `src/backend/domain/errors/NotImplementedError.ts` (26)

Backend (modified):
- `src/backend/domain/interface/recebimentos/constants.ts`
- `src/backend/domain/interface/recebimentos/ports.ts`
- `src/backend/domain/recebimentosContainer.ts`
- `src/backend/routes/recebimentos.ts` (+105 lines)
- `src/backend/routes/recebimentos.test.ts`

Frontend (new/modified):
- `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx` (240) + test
- `src/frontend/app/recebimentos/page.tsx`
- `src/frontend/lib/recebimentos.ts` (+188) + test

Ontology:
- `ontology/actions/recebimentos/gerar-solicitacao-numerario.md` (new)
- `ontology/integrations/conexos-com299-gerdoc.md` (new)
- `ontology/_index.json`, `ontology/_coverage.json`

## Codebase baseline

| Metric | Value |
|---|---|
| Backend LOC (non-test) | 47,976 |
| Backend test files | 219 |
| Frontend LOC (non-test) | 14,274 |
| Frontend test files | 20 |
| SN feature LOC (5 core files) | 554 |
| Terraform module count | 0 (no `infra/` — Express/Render today, per CLAUDE.md) |
| Tenant count | 0 (none provisioned) |
| Backend deps / devDeps | 14 / 13 |
| Frontend deps / devDeps | 23 / 17 |

## Gate baselines (measured 2026-07-29)

| Gate | Result |
|---|---|
| Backend typecheck (`tsc --noEmit`) | ✅ pass |
| Backend tests (jest) | ✅ 740/740 (75 suites) |
| Backend lint (biome) | ✅ exit 0 — 28 warnings, all `noExcessiveCognitiveComplexity` in **pre-existing** permutas/sispag/conexos files; **0** in SN feature files |
| Frontend typecheck | ✅ pass |
| Frontend tests (jest) | ✅ 104/104 (20 suites) |

## Architectural context (from CLAUDE.md)

- **Current runtime:** Express (`src/backend/routes/` + `http/`), Next.js frontend, Supabase auth/DB, deploy Render/Vercel. **Target:** AWS Lambda + Terraform (not present today).
- **Feature nature:** `gerarSolicitacaoNumerario` is **DRY-RUN only**. Builds a com299 `gerDocProcesso` "Solicitação de Numerário – Encomenda" payload and returns it (`dryRun:true`). The real ERP-write seam (`enviarAoErp`) throws `NotImplementedError` — **no reachable write path to Conexos** until HML creds + HAR confirm `gcdCod` and payload shape.
- **Known unresolved domain rule:** encomenda percentuais (0,1% / 0,9%) — NOT resolved; SN value uses raw transaction amount with `TODO(encomenda-percentuais)`.
- **Ports/DI:** candidate processes come from an in-memory `ProcessoProviderStub` behind `PROCESSO_PROVIDER_TOKEN` / `ProcessoProviderInterface` — swappable for Conexos/matching-engine without touching route/service.
