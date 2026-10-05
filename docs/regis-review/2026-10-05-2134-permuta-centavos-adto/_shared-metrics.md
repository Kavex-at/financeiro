# Shared metrics — run 2026-10-05-2134-permuta-centavos-adto (--quick, delta-scoped)

**Scope:** delta of commit `c099a55` on branch `fix/permuta-centavos-adto` (vs `origin/main` 8daee5b).
Feature: I-Write-10 / ADR-0062 — cap each permuta baixa's net (`bxaMnyValor + juros − desconto`) at the
adto's live available balance (`bxaMnyValorPermuta`, fin010 step 3); excess ≤ R$1,00 is taken out of the
variation (juros ↓ / desconto ↑); larger excess or negative juros → no change + BUSINESS_WARN.

## Delta
| File | Change |
|---|---|
| `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts` | +71 (new private `limitarAoDisponivelDoAdto`, call in `baixarTitulo` after `ancorarVariacaoNoAdto`) — file now 1231 LOC |
| `src/backend/domain/service/permutas/ReconciliacaoPermutaService.test.ts` | +146 (4 new tests, I-Write-10 describe) — 54 tests in file |
| `src/backend/domain/interface/permutas/ToleranciaResiduo.ts` | +2 (doc comment) |
| `src/backend/jobs/validate-permuta-centavos-adto-v1.ts` | +124 (new read-only ground-truth script, DB only, zero ERP calls) |
| `ontology/*` | I-Write-10 in fin010-write-contract, ADR-0062, CHANGELOG v0.35.0, tasks.md |

## Baselines (measured in the worktree, 2026-10-05)
| Metric | Value |
|---|---|
| Backend test files | 226 |
| Backend `domain/service` LOC (non-test) | 22.776 |
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` (Biome) | ✅ 0 errors, 78 warnings (pre-existing on main) |
| `npm test` (backend) | ✅ 203 suites / 3773 tests passing |
| Ground truth (`validate-permuta-centavos-adto-v1`, prod ledger, read-only) | 196 real executions: 192 IDENTICO, 3 FECHADO (borderôs 16596, 23184, 23188), 1 FORA_TETO (2646, excess R$921k untouched), **0 DIVERGENTE** |
| Infra / Terraform | ⚠️ Não medível: no `infra/` in this repo (deploy via Render hook) |
| Frontend | not touched by the delta |

## Production evidence that motivated the change
- Borderô 23184 refused at Finalizar: "O TOTAL PERMUTADO DE ADIANTAMENTO (49.873,83) É MAIOR QUE O VALOR DISPONÍVEL (49.873,82)".
- Ledger scan: 3 of 196 real executions sent net 0,01 above the ERP-reported available balance.
