# Shared metrics — run 2026-09-29-2020 (feature sync-status-lote-sispag, --quick, escopo restrito)

Escopo (diretórios tocados): src/backend/domain/service/sispag, src/backend/domain/client, src/backend/domain/repository/sispag, src/backend/jobs, src/backend/routes, src/backend/migrations, src/frontend/app/sispag, src/frontend/lib, .github/workflows

Diff da feature: `git diff origin/main...HEAD` (branch fix/sync-status-lote-sispag).
```
 .github/workflows/sincronizar-lotes-sispag.yml     |  73 +++
 ontology/_coverage.json                            |  19 +-
 ontology/_inbox/_watchlist.md                      |   6 +
 ontology/_inbox/sync-status-lote-sispag-gt-gap.md  |  56 ++
 .../sync-status-lote-sispag-ontology-diff.md       | 540 ++++++++++++++++++
 ontology/_index.json                               |  41 +-
 ontology/business-rules/retomada-remessa-sispag.md |  15 +-
 .../sincronizacao-status-lote-sispag.md            |  89 +++
 ...tatus-do-lote-sispag-segue-a-baixa-do-titulo.md | 114 ++++
 ontology/entities/alerta.md                        |   5 +-
 ontology/entities/lote-pagamento.md                |  71 ++-
 ontology/entities/titulo-a-pagar.md                |  16 +-
 ontology/integrations/conexos.md                   |  21 +-
 ontology/state-machines/lote-pagamento.md          | 158 +++---
 .../domain/client/ConexosSispagClient.test.ts      |  99 ++++
 src/backend/domain/client/ConexosSispagClient.ts   |  95 ++++
 .../domain/client/ConexosTitulosClient.test.ts     | 107 ++++
 src/backend/domain/client/ConexosTitulosClient.ts  |  81 +++
 src/backend/domain/interface/operacao/Alerta.ts    |   4 +
 src/backend/domain/interface/operacao/JobRun.ts    |   5 +
 .../domain/interface/operacao/stalenessLimits.ts   |  11 +
 .../domain/interface/sispag/SincronizacaoLote.ts   | 106 ++++
 .../domain/interface/sispag/SispagInterface.ts     |  93 ++-
 .../sispag/LotePagamentoRepository.test.ts         | 206 +++++++
 .../repository/sispag/LotePagamentoRepository.ts   | 189 ++++++-
 .../service/operacao/JobRunReadModel.test.ts       |   1 +
 .../domain/service/operacao/JobRunReadModel.ts     |  19 +-
 .../sispag/ConciliacaoRetornoService.test.ts       | 296 +++++-----
 .../service/sispag/ConciliacaoRetornoService.ts    | 185 +++---
 .../domain/service/sispag/DebitDateService.test.ts |   1 +
 .../service/sispag/DecisaoStatusLote.test.ts       | 376 +++++++++++++
 .../domain/service/sispag/DecisaoStatusLote.ts     | 409 ++++++++++++++
 .../service/sispag/LotePagamentoService.test.ts    |  28 +-
 .../domain/service/sispag/LotePagamentoService.ts  |  11 -
 .../domain/service/sispag/RemessaService.test.ts   |   3 +
 .../sispag/SincronizacaoLoteService.test.ts        | 441 +++++++++++++++
 .../service/sispag/SincronizacaoLoteService.ts     | 626 +++++++++++++++++++++
 src/backend/http/routePermissions.test.ts          |   9 +-
 src/backend/jobs/SincronizarLotesSispagJob.ts      | 110 ++++
 src/backend/jobs/sincronizar-lotes-sispag.test.ts  | 130 +++++
 src/backend/jobs/sincronizar-lotes-sispag.ts       |  34 ++
 .../jobs/validate-sync-status-lote-sispag-v1.ts    | 209 +++++++
 ...item_situacao_sincronizacao.integration.test.ts | 249 ++++++++
 .../0069_sispag_item_situacao_sincronizacao.sql    |  66 +++
 ...0069_sispag_item_situacao_sincronizacao.test.ts | 103 ++++
 src/backend/migrations/rollbacks.test.ts           |   3 +
 ...sispag_item_situacao_sincronizacao.rollback.sql |  40 ++
 src/backend/package.json                           |   1 +
 src/backend/routes/sispag.test.ts                  | 137 +++++
 src/backend/routes/sispag.ts                       |  54 +-
 .../app/sispag/components/ConfirmarAcaoDialog.tsx  |  30 +-
 .../app/sispag/components/LoteCard.test.tsx        | 163 +++++-
 src/frontend/app/sispag/components/LoteCard.tsx    | 115 +++-
 src/frontend/lib/operacao.ts                       |   9 +-
 src/frontend/lib/sispag.ts                         |  49 +-
 55 files changed, 5629 insertions(+), 498 deletions(-)
```

## Backend LOC por camada (não-teste)

| camada | arquivos | linhas |
|---|---|---|
| domain/service | 67 | 20399 |
| domain/repository | 27 | 7629 |
| domain/client | 22 | 8240 |
| routes | 10 | 3667 |
| http | 23 | 1623 |
| jobs | 71 | 12912 |
| migrations | 7 | 479 |

Backend test files: 196 (60145 linhas)
Frontend não-teste: 137 arquivos, 25811 linhas
Frontend test files: 64
Terraform / tenants: Não medível — não existe `infra/` (deploy Render + crons GitHub Actions).

## Gates no HEAD (medidos nesta sessão)

- Backend typecheck: PASS (0 erros)
- Backend lint (biome): 0 erros, 77 warnings (complexidade pré-existente; nenhum novo no delta)
- Backend tests: 178 suites / 3233 testes PASS (antes da feature: 173 / 3126)
- Integração 0069 contra Postgres 16 local: 8/8 PASS
- Frontend: typecheck PASS; lint 0 erros / 19 warnings pré-existentes; 64 suites / 656 testes PASS
- npm audit: não executado (--quick)
