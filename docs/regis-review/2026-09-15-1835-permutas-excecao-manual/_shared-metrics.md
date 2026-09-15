# Shared metrics — Regis-Review 2026-09-15-1835-permutas-excecao-manual (scope: delta `permutas-excecao-manual`, --quick)

Worktree: `/home/inteli/kavex-worktrees/permutas-excecao-manual` · branch `fix/permutas-excecao-manual` · base `origin/main` 2f03116 (v0.36.5)

## Delta (git diff --stat origin/main..HEAD)
```
 ...0047-excecao-manual-permutado-fora-do-painel.md | 135 ++++++
 ontology/entities/excecao-permuta.md               | 108 +++++
 ontology/glossary.md                               |   1 +
 ontology/relationships.md                          |   1 +
 .../elegibilidade-permuta-candidata.md             |  17 +-
 .../domain/errors/ExcecaoPermutaRecusadaError.ts   | 112 +++++
 .../interface/permutas/EstadoElegibilidade.ts      |  14 +
 .../domain/interface/permutas/ExcecaoPermuta.ts    |  44 ++
 src/backend/domain/interface/permutas/Gestao.ts    |  20 +
 .../permutas/ExcecaoPermutaRepository.test.ts      | 155 +++++++
 .../permutas/ExcecaoPermutaRepository.ts           |  99 +++++
 .../permutas/PermutaRelationalRepository.test.ts   |  43 ++
 .../permutas/PermutaRelationalRepository.ts        |  30 ++
 .../permutas/EleicaoPermutasService.test.ts        | 208 ++++++++-
 .../service/permutas/EleicaoPermutasService.ts     |  49 ++-
 .../service/permutas/ExcecaoPermutaService.test.ts | 490 +++++++++++++++++++++
 .../service/permutas/ExcecaoPermutaService.ts      | 201 +++++++++
 .../service/permutas/GestaoPermutasService.test.ts | 126 ++++++
 .../service/permutas/GestaoPermutasService.ts      |  35 ++
 .../permutas/RelatorioExportService.test.ts        |  94 ++++
 .../service/permutas/RelatorioExportService.ts     |  31 ++
 src/backend/migrations/0059_excecao_permuta.sql    | 100 +++++
 src/backend/routes/permutas.test.ts                | 187 +++++++-
 src/backend/routes/permutas.ts                     |  93 ++++
 src/frontend/__tests__/excecao-manual-api.test.ts  |  89 ++++
 .../__tests__/permutas-components.test.tsx         | 210 ++++++++-
 .../permutas/components/DesfazerExcecaoDialog.tsx  |  72 +++
 .../permutas/components/ExcecaoManualDialog.tsx    | 146 ++++++
 .../app/permutas/components/VisaoGeralTable.tsx    |  63 ++-
 .../app/permutas/components/excecao.test.ts        |  78 ++++
 src/frontend/app/permutas/components/format.ts     |  25 ++
 .../app/permutas/components/historico.test.ts      |  29 ++
 src/frontend/app/permutas/components/ui.tsx        |  41 +-
 .../permutas/components/useExcecaoManual.test.tsx  |  83 ++++
 .../app/permutas/components/useExcecaoManual.ts    |  78 ++++
 src/frontend/app/permutas/page.tsx                 |  35 ++
 src/frontend/components/ui/textarea.tsx            |  25 ++
 src/frontend/lib/api.ts                            |  55 +++
 src/frontend/lib/types.ts                          |  16 +
 48 files changed, 3990 insertions(+), 52 deletions(-)
```

## Delta commits
```
2bcc949 docs(ontology): mark ExcecaoPermuta implemented and close the ADR-0047 ahead-of-code gaps
c31f77f fix(permutas-ui): derive the exception tag from the motive and align ADR-0047 export text
ad308c5 feat(permutas-ui): mark and undo the manual 'permutado fora do painel' exception
62334ce feat(permutas-ui): API client, types and guard helper for the manual exception
77fe82d refactor(permutas): isolate the exception cells of the adiantamentos export
016d096 feat(permutas): expose the manual exception in /permutas/gestao and the Excel export
5b96ef7 feat(permutas): admin routes to mark and undo the manual permuta exception
a07b149 feat(permutas): apply manual 'permutado-fora-do-painel' exception in the election compute
52718a9 docs(ontology): ADR-0047 manual 'permutado-fora-do-painel' exception, interview and tasks
```

## Backend LOC by layer (non-test)
```
domain/service       16620
domain/repository    6165
domain/client        7405
domain/interface     5357
routes               2858
jobs                 11918
migrations           282
```
- Backend test files: 151
- Frontend test files: 43
- Terraform/infra: ⚠️ Não medível — repo não tem `infra/` (deploy Render/Vercel).

## Gate results at green (AutoLoopRunner, 2026-09-15)
- Backend: typecheck 0 · lint 0 errors · 137 suites / 2012 tests
- Frontend: typecheck 0 · lint 0 errors (19 pre-existing warnings) · 43 suites / 361 tests
- PatternGuardian PASS · DesignSystemReviewer PASS (toast vs notify() — notify não existe no repo) · SpecVerifier APROVADO (0 REPROVADO)
- Migration 0059 aplicada 3× (idempotente) em Postgres 16 local descartável; nunca aplicada no Supabase compartilhado
- Ground truth: N/A (classificação, sem fórmula monetária)

## Context docs
- Spec: `ontology/_inbox/permutas-excecao-manual-interview.md`
- Tasks: `ontology/_inbox/permutas-excecao-manual-tasks.md`
- ADR: `ontology/decisions/0047-excecao-manual-permutado-fora-do-painel.md`
- Entity: `ontology/entities/excecao-permuta.md`
