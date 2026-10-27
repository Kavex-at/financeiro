# Shared metrics — 2026-10-27-1444-sispag-numdoc-desempate (reduced: modifiability, testability, performance; --quick; feature scope)

## Changed files vs main
```
 ontology/CHANGELOG.md                              |  17 ++
 ontology/_coverage.json                            |   8 +-
 ontology/_inbox/_watchlist.md                      |   8 +
 ontology/_index.json                               |  11 +-
 .../business-rules/sugestao-boleto-dda-sispag.md   |  20 +--
 ontology/entities/decisao-sugestao-boleto.md       |   4 +-
 .../domain/interface/sispag/SugestaoBoleto.ts      |  18 +++
 .../sispag/TituloAPagarRepository.test.ts          |  14 ++
 .../repository/sispag/TituloAPagarRepository.ts    |  27 ++++
 .../service/sispag/BoletoSuggestionService.test.ts |  38 +++++
 .../service/sispag/BoletoSuggestionService.ts      |  42 +++--
 .../domain/service/sispag/MotorSugestaoBoleto.ts   | 177 ++++++++++++++++++---
 .../service/sispag/RegraSugestaoBoleto.test.ts     |  14 ++
 .../domain/service/sispag/RegraSugestaoBoleto.ts   |  11 ++
 .../components/sugestaoBoleto.desfecho.test.ts     |   7 +
 .../app/sispag/components/sugestaoBoleto.ts        |   5 +
 src/frontend/lib/sispag.sugestaoBoleto.test.ts     |  19 +++
 src/frontend/lib/sispag.ts                         |   2 +
 18 files changed, 387 insertions(+), 55 deletions(-)
?? docs/regis-review/2026-10-27-1444-sispag-numdoc-desempate/
?? ontology/_inbox/sispag-numdoc-desempate-tasks.md
?? ontology/decisions/0079-sispag-ancora-numero-documento.md
?? src/backend/domain/service/sispag/MotorSugestaoBoleto.numero.test.ts
```
## LOC of touched sispag files
```
  1148 src/backend/domain/service/sispag/MotorSugestaoBoleto.ts
  1161 src/backend/domain/service/sispag/BoletoSuggestionService.ts
   216 src/backend/domain/service/sispag/RegraSugestaoBoleto.ts
   395 src/backend/domain/repository/sispag/TituloAPagarRepository.ts
   183 src/backend/domain/service/sispag/MotorSugestaoBoleto.dps.test.ts
   380 src/backend/domain/service/sispag/MotorSugestaoBoleto.numero.test.ts
   878 src/backend/domain/service/sispag/MotorSugestaoBoleto.test.ts
  4361 total
main MotorSugestaoBoleto.ts: 1023
```
## Gates (2026-10-27, clean npm ci)
- backend: typecheck ok; lint 0 errors / 112 warnings (= main); jest 283 suites / 5313 tests pass
- frontend: typecheck ok; lint 0 errors / 20 warnings (= main); jest 114 suites / 1260 tests pass
