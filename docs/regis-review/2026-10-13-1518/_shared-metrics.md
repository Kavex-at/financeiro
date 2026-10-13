# Shared metrics — 2026-10-13-1518 (escopo: delta fix/sispag-sync-ao-abrir, --quick)

## Delta
```
 .github/workflows/sincronizar-lotes-sispag.yml     |   5 +
 DEPLOY.md                                          |   2 +
 ontology/_coverage.json                            |   6 +-
 .../_inbox/sispag-sync-ao-abrir-ontology-diff.md   | 113 +++++++++
 ontology/_inbox/sispag-sync-ao-abrir-tasks.md      |  55 +++++
 ontology/_index.json                               |   9 +-
 .../sincronizacao-status-lote-sispag.md            |  22 +-
 ...066-sispag-lotes-sincronizam-ao-abrir-a-tela.md |  58 +++++
 ontology/state-machines/lote-pagamento.md          |   2 +-
 .../libs/environment/EnvironmentProvider.test.ts   |  20 ++
 .../domain/libs/environment/EnvironmentProvider.ts |   4 +
 .../libs/environment/model/EnvironmentVars.ts      |  14 ++
 .../sispag/SincronizacaoPassadaService.test.ts     | 256 +++++++++++++++++++
 .../service/sispag/SincronizacaoPassadaService.ts  | 270 +++++++++++++++++++++
 src/backend/http/routePermissions.test.ts          |   8 +-
 src/backend/jobs/SincronizarLotesSispagJob.ts      | 117 +++------
 src/backend/jobs/sincronizar-lotes-sispag.test.ts  | 100 +++-----
 src/backend/routes/sispag.test.ts                  | 162 +++++--------
 src/backend/routes/sispag.ts                       |  63 ++---
 .../app/sispag/components/LoteCard.test.tsx        |  24 +-
 src/frontend/app/sispag/components/LoteCard.tsx    |  13 -
 src/frontend/app/sispag/page.test.tsx              |  89 ++++++-
 src/frontend/app/sispag/page.tsx                   |  75 +++++-
 src/frontend/app/sispag/useCarteiraAoAbrir.test.ts |  86 ++++++-
 src/frontend/app/sispag/useCarteiraAoAbrir.ts      |  68 ++++--
 src/frontend/lib/sispag.ts                         |  69 +++++-
 26 files changed, 1350 insertions(+), 360 deletions(-)
```
## Backend LOC (não-teste)
  80562 total
## Backend test files
252
## Frontend LOC (não-teste)
  31983 total
## Frontend test files
88
## Infra
⚠️ Não medível: não existe infra/ (deploy Render/Vercel).
## Gates desta branch
- backend: typecheck OK; npm test 4058/4058; build OK; biome limpo nos arquivos do delta (erros de complexidade pré-existentes fora do delta).
- frontend: tsc OK; npm test 893/893; lint 0 erros (19 warnings pré-existentes, nenhum no delta).
- PatternGuardian PASS; DesignSystemReviewer PASS; SpecVerifier PASS após doc DEPLOY.md.
## Fato operacional
- Cron sincronizar-lotes-sispag (48 11-22 * * 1-5) rodou 2–3x/dia em 07–09/10/2026; pool Postgres por processo = 5 (PostgreeDatabaseClient.ts:37); passada L11 ~25 s (log do run 37860107255).
