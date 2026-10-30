# Shared metrics — 2026-10-30-2243-dda-pool-limpo (escopo: diff não commitado da feature dda-pool-limpo; backend+frontend; infra: não existe)
## Arquivos tocados
 M ontology/entities/boleto-dda.md
 M src/backend/domain/interface/sispag/BoletoDda.ts
 M src/backend/domain/repository/sispag/TituloAPagarRepository.ts
 M src/backend/domain/service/sispag/BoletoDdaService.test.ts
 M src/backend/domain/service/sispag/BoletoDdaService.ts
 M src/backend/domain/service/sispag/ConsolidacaoBoletoDda.test.ts
 M src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts
 M src/backend/domain/service/sispag/ConsolidacaoBoletoDdaCache.test.ts
 M src/backend/domain/service/sispag/IngestaoPagamentosService.ts
 M src/backend/domain/service/sispag/PaginacaoBoletoDda.test.ts
 M src/backend/domain/service/sispag/PaginacaoBoletoDda.ts
 M src/frontend/app/sispag/boletos-dda/FiltroSituacaoDdaBarra.tsx
 M src/frontend/app/sispag/boletos-dda/RegrasBoletoDda.tsx
 M src/frontend/app/sispag/boletos-dda/TabelaBoletosDda.tsx
 M src/frontend/app/sispag/boletos-dda/filtrosBoletosDda.ts
 M src/frontend/app/sispag/boletos-dda/rotulosDda.ts
 M src/frontend/app/sispag/components/BoletosDdaTab.grupos.test.tsx
 M src/frontend/app/sispag/components/BoletosDdaTab.test.tsx
 M src/frontend/app/sispag/components/BoletosDdaTab.tsx
 M src/frontend/app/sispag/components/BoletosDoTituloDialog.test.tsx
 M src/frontend/app/sispag/components/CardsBoletosDda.tsx
 M src/frontend/lib/sispag.test.ts
 M src/frontend/lib/sispag.ts
?? docs/regis-review/2026-10-30-2243-dda-pool-limpo/
?? src/backend/domain/libs/calendar/JanelaCarteira.ts

## Backend LOC (sem testes)
 120250 total
Backend tests: 361
Frontend LOC:   44241 total
Frontend tests: 134
Terraform: não existe (infra/ ausente)
Diff stat:
 ontology/entities/boleto-dda.md                    |  13 +-
 src/backend/domain/interface/sispag/BoletoDda.ts   |  26 ++-
 .../repository/sispag/TituloAPagarRepository.ts    |  23 +++
 .../domain/service/sispag/BoletoDdaService.test.ts |  65 ++++++-
 .../domain/service/sispag/BoletoDdaService.ts      |  49 +++++-
 .../service/sispag/ConsolidacaoBoletoDda.test.ts   | 192 +++++++++++++++++++++
 .../domain/service/sispag/ConsolidacaoBoletoDda.ts | 165 ++++++++++++++++--
 .../sispag/ConsolidacaoBoletoDdaCache.test.ts      |  10 +-
 .../service/sispag/IngestaoPagamentosService.ts    |   8 +-
 .../service/sispag/PaginacaoBoletoDda.test.ts      |  55 ++++++
 .../domain/service/sispag/PaginacaoBoletoDda.ts    |  36 +++-
 .../sispag/boletos-dda/FiltroSituacaoDdaBarra.tsx  |   7 +
 .../app/sispag/boletos-dda/RegrasBoletoDda.tsx     |   2 +-
 .../app/sispag/boletos-dda/TabelaBoletosDda.tsx    |  12 +-
 .../app/sispag/boletos-dda/filtrosBoletosDda.ts    |  16 +-
 src/frontend/app/sispag/boletos-dda/rotulosDda.ts  |  12 ++
 .../components/BoletosDdaTab.grupos.test.tsx       |   3 +-
 .../app/sispag/components/BoletosDdaTab.test.tsx   |  40 +++++
 .../app/sispag/components/BoletosDdaTab.tsx        |   3 +
 .../components/BoletosDoTituloDialog.test.tsx      |   3 +
 .../app/sispag/components/CardsBoletosDda.tsx      |  24 ++-
 src/frontend/lib/sispag.test.ts                    |   1 +
 src/frontend/lib/sispag.ts                         |  12 +-
 23 files changed, 742 insertions(+), 35 deletions(-)
Backend typecheck: passa. Lint: 0 erros. Jest backend sispag: 1760 passam; frontend 900 passam.
LOC dos arquivos tocados:
  412 src/backend/domain/service/sispag/ConsolidacaoBoletoDda.ts
  425 src/backend/domain/service/sispag/PaginacaoBoletoDda.ts
  463 src/backend/domain/service/sispag/BoletoDdaService.ts
    7 src/backend/domain/libs/calendar/JanelaCarteira.ts
 1307 total
