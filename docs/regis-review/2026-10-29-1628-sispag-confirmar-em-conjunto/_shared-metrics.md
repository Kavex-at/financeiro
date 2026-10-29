# Shared metrics — sispag-confirmar-em-conjunto (ADR-0080)

Scope: feature diff vs origin/main 14765216 (uncommitted working tree).

## Feature diff
```
 18 files changed, 623 insertions(+), 21 deletions(-)
?? docs/regis-review/2026-10-29-1628/
?? ontology/_inbox/sispag-confirmar-em-conjunto-interview.md
?? ontology/_inbox/sispag-confirmar-em-conjunto-ontology-diff.md
?? ontology/_inbox/sispag-confirmar-em-conjunto-tasks.md
?? ontology/actions/sispag/confirmar-sugestoes-em-conjunto.md
?? ontology/decisions/0080-sispag-confirmacao-em-conjunto.md
?? src/backend/domain/errors/BatchConfirmationTooLargeError.ts
?? src/backend/domain/interface/sispag/ConfirmacaoEmConjunto.ts
?? src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.test.ts
?? src/backend/domain/service/sispag/ConfirmacaoEmConjuntoService.ts
?? src/backend/domain/service/sispag/RegraIrmaosConjunto.test.ts
?? src/backend/domain/service/sispag/RegraIrmaosConjunto.ts
?? src/frontend/app/sispag/components/ConfirmacaoEmConjuntoSecao.test.tsx
?? src/frontend/app/sispag/components/ConfirmacaoEmConjuntoSecao.tsx
?? src/frontend/lib/sispag.confirmacaoEmConjuntoApi.test.ts
```
## Backend LOC (non-test) by layer
```
domain/service 40104
domain/repository 13335
domain/client 10869
domain/interface 10141
routes 5035
http 1936
src/backend/lambda: não existe (alvo)
```
- Backend test files: 357
- Frontend LOC (non-test): 42717
- Frontend test files: 127
- Terraform modules / tenants: não medível (não existe infra/)
- Backend deps: 17 deps / 14 devDeps
- Frontend deps: 24 deps / 17 devDeps

## Gates (run in this session, 2026-10-29)
- Backend: typecheck OK; biome lint 125 warnings, 0 errors (touched files: no new warnings vs main); jest 6243 tests, 316 suites, all green after route-table fix (+targeted reruns: BoletoSuggestionService 127, ConfirmacaoEmConjuntoService 13, AjusteCentavos 38, routes 50, routePermissions 534).
- Frontend: tsc OK; eslint 0 errors / 21 warnings (new files 0); jest 127 suites / 1424 tests green (+ new 7 component + 3 client tests).
- PatternGuardian PASS; DesignSystemReviewer PASS.
- Live measurement (disposable clone of local PRD copy, Conexos stub, writes off): GET irmaos ~30 ms (warm cache), 86 eligible NELSON HEUSI f2; POST 30 rows 36.5 s with per-row scenario -> 1.3 s with one scenario per batch (D9); replay = 30 JA_CONFIRMADA; 31 rows = 422; other creditor row = RECUSADA.
