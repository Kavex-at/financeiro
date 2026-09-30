# Shared metrics — run 2026-09-30-1459-metricas-sispag

Escopo: delta `fix/metricas-sispag` vs `origin/main` (commit 882cc82). Repo usa `src/backend`/`src/frontend`; não há `infra/`.

## Delta (git diff --stat origin/main)
```
 ontology/CHANGELOG.md                              |  10 +
 ontology/_coverage.json                            |   2 +-
 ontology/_inbox/metricas-sispag-mapa.md            | 101 ++++++++
 ...as-do-ciclo-medem-o-sispag-por-titulo-aceito.md |  77 ++++++
 .../sispag/RemessaExecucaoRepository.test.ts       |  34 +++
 .../repository/sispag/RemessaExecucaoRepository.ts |   6 +
 .../migrations/0070_metricas_ciclo_sispag.sql      | 264 +++++++++++++++++++++
 .../migrations/vwMetricasCiclo.integration.test.ts | 167 ++++++++++++-
 src/backend/migrations/vwMetricasCiclo.test.ts     |  59 +++++
 src/frontend/app/metricas/page.test.tsx            |  35 +++
 src/frontend/app/metricas/page.tsx                 |  38 ++-
 src/frontend/lib/metricas.ts                       |   3 +
 12 files changed, 788 insertions(+), 8 deletions(-)
```

## Backend LOC por camada (sem testes)
```
domain/service       20411
domain/repository    7635
domain/client        8240
routes               3667
migrations           479
```
- lambda/api, lambda/job: ⚠️ Não medível — não existem (runtime é Express).
- Backend test files: 196
- Frontend LOC (sem testes): 25840
- Frontend test files: 64
- Terraform modules / tenants: ⚠️ Não medível — não há `infra/`.
- Backend deps: 16 deps / 14 devDeps
- Frontend deps: 23 deps / 17 devDeps

## Gates medidos neste delta (2026-09-30)
- Backend: typecheck ✅ · lint ✅ (0 erros, 75 warnings pré-existentes) · jest 178 suites / 3242 testes ✅ · test:sql (Postgres 17 real) 4 suites / 48 testes ✅
- Frontend: typecheck ✅ · lint ✅ (0 erros, 19 warnings) · jest 64 suites / 658 testes ✅ · next build ✅
- PatternGuardian: PASS (3× P3) · DesignSystemReviewer: APROVADO após fix (KPIGrid 6→2 colunas)
- Leitura read-only em produção: semana 18–25/09 = 2 títulos (R$ 2.131,16), 25/09–02/10 = 11 (R$ 8.832,91), 0 aceitos (situacao NULL até o cron sincronizar-lotes-sispag rodar).
