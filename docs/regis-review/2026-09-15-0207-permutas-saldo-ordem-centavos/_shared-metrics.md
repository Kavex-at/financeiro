# Shared metrics — Regis-Review 2026-09-15-0207-permutas-saldo-ordem-centavos (scope: delta `permutas-saldo-ordem-centavos`, --quick)

Worktree: `/home/inteli/kavex-worktrees/permutas-saldo-ordem-centavos` · branch `fix/permutas-saldo-ordem-centavos` · base `origin/main` 3872903 (v0.36.4)

## Delta (git diff --stat origin/main..HEAD)
```
 ontology/CHANGELOG.md                              |  21 +
 ontology/_coverage.json                            |  18 +-
 .../permutas-pagamento-parcial-regis-followups.md  |   8 +-
 .../permutas-painel-elegiveis-regis-followups.md   |   2 +-
 .../permutas-saldo-ordem-centavos-interview.md     | 146 ++++
 .../_inbox/permutas-saldo-ordem-centavos-tasks.md  | 364 ++++++++++
 ontology/_index.json                               |  31 +-
 ontology/actions/avaliar-elegibilidade.md          |  41 +-
 ontology/actions/expor-no-painel.md                |  10 +-
 ontology/business-rules/elegibilidade-permuta.md   |  55 +-
 .../business-rules/elegibilidade-titulo-lote.md    |   4 +-
 ...ia-residuo-prioridade-motivos-saldo-restante.md | 225 +++++++
 ontology/entities/adiantamento.md                  |  12 +-
 ontology/entities/invoice.md                       |   4 +-
 ontology/entities/permuta.md                       |  36 +-
 ontology/integrations/conexos.md                   |  17 +-
 .../elegibilidade-permuta-candidata.md             |  32 +-
 src/backend/domain/client/ConexosTitulosClient.ts  |   6 +-
 .../domain/interface/permutas/Adiantamento.ts      |   7 +-
 .../interface/permutas/EstadoElegibilidade.ts      |  17 +-
 src/backend/domain/interface/permutas/Gestao.ts    |   5 +-
 .../domain/interface/permutas/PermutaCandidata.ts  |   4 +-
 .../interface/permutas/ToleranciaResiduo.test.ts   |  90 +++
 .../domain/interface/permutas/ToleranciaResiduo.ts |  50 ++
 .../permutas/PermutaAlocacaoRepository.test.ts     |  29 +-
 .../permutas/PermutaAlocacaoRepository.ts          |  24 +-
 .../permutas/PermutaExecucaoRepository.test.ts     | 120 ++++
 .../permutas/PermutaExecucaoRepository.ts          |  96 ++-
 .../permutas/AlocacaoPermutasService.test.ts       | 102 ++-
 .../service/permutas/AlocacaoPermutasService.ts    |  15 +-
 .../service/permutas/ElegibilidadeService.test.ts  | 113 ++++
 .../service/permutas/ElegibilidadeService.ts       |  54 +-
 .../permutas/EleicaoPermutasService.test.ts        |  75 ++-
 .../service/permutas/EleicaoPermutasService.ts     |  25 +-
 .../service/permutas/GestaoPermutasService.test.ts | 172 +++++
 .../service/permutas/GestaoPermutasService.ts      |  21 +-
 .../permutas/ReconciliacaoPermutaService.ts        |   3 +-
 .../SaldoAlocacaoAdiantamentoService.test.ts       | 170 +++++
 .../permutas/SaldoAlocacaoAdiantamentoService.ts   | 108 +++
 .../validate-permutas-saldo-ordem-centavos-v1.ts   | 736 +++++++++++++++++++++
 .../app/permutas/components/historico.test.ts      | 273 ++++++++
 src/frontend/app/permutas/components/historico.ts  | 121 ++++
 src/frontend/app/permutas/page.tsx                 |  84 +--
 src/frontend/lib/types.ts                          |   3 +-
 44 files changed, 3328 insertions(+), 221 deletions(-)
```

## Delta commits
```
74d65e6 docs(ontology): ADR-0046 — R$1 residual tolerance, full motive priority, saldo without double counting
8469bf3 docs(ontology): close ADR-0046 ahead-of-code gaps after implementation
2b22134 test(permutas): live read-only ground-truth probe for ADR-0046
9b6097e fix(permutas): keep ja-permutado advances with panel borderô in history
6639663 fix(permutas): stop double-counting ERP-consumed allocations in saldo
ce571d9 fix(permutas): absorb R$1 residual in eligibility and fix motive priority
```

## Backend LOC by layer (non-test)
```
domain/service       16308
domain/repository    6036
domain/client        7405
domain/interface     5279
routes               2765
jobs                 11918
permutas services    6422
```

- Backend test files: 149
- Frontend LOC (non-test): 20617
- Frontend test files: 40
- Terraform/infra: ⚠️ Não medível — repo não tem `infra/` (deploy Render/Vercel).
- Backend deps: 16 deps / 14 devDeps
- Frontend deps: 23 deps / 17 devDeps

## Gate results at green (AutoLoopRunner, 2026-09-14)
- Backend: typecheck 0 errors · lint 0 errors (complexity warnings pre-existing) · 135 suites / 1953 tests passing
- Frontend: typecheck 0 · lint 0 errors (19 pre-existing warnings) · 40 suites / 328 tests
- PatternGuardian PASS · DesignSystemReviewer PASS · SpecVerifier 64 APROVADO / 0 REPROVADO
- Ground truth LIVE (read-only, Conexos prod): 247 lines, 0 DIVERGENTE (script `src/backend/jobs/validate-permutas-saldo-ordem-centavos-v1.ts`)

## Backend lint baseline (tail)
```
  
  i Please refactor this function to reduce its complexity score from 28 to the max allowed complexity 15.
  

The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 53.
Checked 476 files in 608ms. No fixes applied.
Found 73 warnings.
```

## Backend typecheck baseline (tail)
```

> financeiro-backend@0.36.4 typecheck
> tsc --noEmit

```

## Context docs
- Spec: `ontology/_inbox/permutas-saldo-ordem-centavos-interview.md`
- Tasks: `ontology/_inbox/permutas-saldo-ordem-centavos-tasks.md`
- ADR: `ontology/decisions/0046-tolerancia-residuo-prioridade-motivos-saldo-restante.md`
