# Shared metrics: 2026-10-06-1807-sispag-filtros-data-boleto

**Scope:** delta of commit `65d1fdf` (feature `sispag-filtros-data-boleto`, `/feature-tweak`).
**Worktree:** `.claude/worktrees/agent-a67d85f33e89bea51`, branch `feat/sispag-filtros-data-boleto`.

## Delta (17 files, +818 / −16)

| File | Change |
|------|--------|
| `src/backend/domain/service/sispag/PaginacaoBoletoDda.ts` | +`vencimentoDe`/`vencimentoAte` (inclusive civil-date range, pure in-memory), `DATA_CIVIL_REGEX` |
| `src/backend/domain/service/sispag/BoletoDdaService.ts` | passes the range through |
| `src/backend/routes/sispag.ts` | Zod: `z.string().regex(DATA_CIVIL_REGEX).optional()` × 2 on `GET /sispag/boletos-dda` |
| `src/frontend/app/permutas/components/tabela-filtro.tsx` | opt-in `extras` (getDatas/getBoleto) in `useTabelaFiltro`; opt-in `rotuloData`/`filtroBoleto` in `FiltroBarra` |
| `src/frontend/app/sispag/page.tsx` | wires filters per tab; REM tab gains filial/busca/date + pagination + "Data de crédito" column; RET gains "Recebido em" column |
| `src/frontend/app/sispag/components/filtrosAbas.ts`, `filtroDatas.ts` | per-tab accessors, ERP-day vs. instant → civil-day conversion |
| `src/frontend/app/sispag/components/BoletosDdaTab.tsx`, `lib/sispag.ts` | server-side date range for DDA |
| tests | 4 test files touched/added (+327 lines) |

No SQL, no migration, no new endpoint, no new dependency, no Conexos write, no env var.

## Gates (measured on the commit)

| Gate | Backend | Frontend |
|------|---------|----------|
| typecheck | pass | pass |
| lint | 0 errors (86 warnings, pre-existing) | 0 errors (21 warnings, pre-existing) |
| tests | 223 suites / 4010 passed | 86 suites / 859 passed |
| PatternGuardian | PASS (P3 notes only) | n/a |

## Not measurable

- Terraform / tenants: no `infra/` in this repo.
