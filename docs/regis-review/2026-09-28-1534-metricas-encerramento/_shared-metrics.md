# Shared metrics — Regis-Review 2026-09-28-1534-metricas-encerramento

**Scope:** DELTA of branch `worktree-metrica-ciclo-data-conclusao` vs `origin/main` (commits
`d35916a` fix, `eec0d9f` chore(release) v0.42.5). Feature: métricas do ciclo datam cada execução pelo
encerramento (ADR-0051, `/feature-tweak`). Findings must concern the delta; pre-existing debt outside it
is out of scope (at most P3 context).

## Delta (`git diff --stat origin/main..HEAD`)

| File | +/- |
|---|---|
| src/backend/migrations/0064_metricas_ciclo_data_pelo_encerramento.sql | +216 (new) |
| src/backend/migrations/vwMetricasCiclo.integration.test.ts | +151 −5 |
| src/backend/migrations/vwMetricasCiclo.test.ts | +68 |
| src/backend/domain/repository/permutas/PermutaExecucaoRepository.ts | +10 |
| src/backend/domain/repository/permutas/PermutaExecucaoRepository.test.ts | +50 |
| src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.ts | +6 |
| src/backend/domain/repository/recebimentos/SolicitacaoNumerarioExecucaoRepository.test.ts | +29 |
| ontology/decisions/0051-…md, ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md | docs |
| CHANGELOG.md, src/{backend,frontend}/package.json | release 0.42.5 |

Total: 12 files, +721 −5. Frontend: only version bump. Infra: none (no `infra/` in repo).

## Gates (measured 2026-09-28 in the worktree)

| Gate | Result |
|---|---|
| `npm run typecheck` (backend) | ✅ 0 errors |
| `npm run lint` (backend) | ✅ exit 0; 74 warnings, all pre-existing; `biome check` on the 6 touched TS/SQL files: 0 findings |
| `npm test` (backend) | ✅ 153 suites / 2297 tests passed |
| `npm run test:sql` — `vwMetricasCiclo.integration.test.ts` vs Postgres 17 (docker, local) | ✅ 24/24 (19 pre-existing + 5 new: retentativa permuta, retentativa SN, re-clique, backfill, contrato) |
| Static guards `vwMetricasCiclo.test.ts` | ✅ 21/21 (5 new for 0064) |
| Production ground truth | ⚠️ Não medível nesta sessão: leitura do banco de produção negada ao agente. Consulta read-only pronta em `ontology/_inbox/metricas-ciclo-data-encerramento-validacao.md`. Baseline conhecido (medido 18/09 por sessão anterior): 2 linhas em 190 com semana(criado_em) ≠ semana(atualizado_em), R$ 503.066,69. |

## Repo baselines

| Metric | Value |
|---|---|
| Backend test files | 153 suites run by jest |
| Migration runner | per-file transaction + advisory lock (`runMigrations.ts:141`) |
| Rows touched by 0064 backfill | ~190 permuta + SN ledger rows (below 1.000-row rollback-script threshold of `migrations/rollbacks/README.md`) |
| Terraform modules / tenants | Não medível: no `infra/` |
