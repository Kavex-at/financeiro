# Shared metrics — run 2026-09-14-1624-metricas-ciclo

Escopo: **backend, --quick, delta da feature `metricas-ciclo`** (diff `14ca71a..HEAD`). Coletado da raiz do worktree `.claude/worktrees/feat+metricas-ciclo`.

## Delta da feature
```
 ontology/_inbox/metricas-ciclo-gap.md              |  61 +++++
 ontology/_inbox/metricas-ciclo-interview.md        | 111 +++++++++
 ontology/_inbox/metricas-ciclo-tasks.md            | 100 ++++++++
 ...etricas-do-ciclo-leem-o-ledger-e-nao-a-spine.md |  97 ++++++++
 src/backend/migrations/0058_vw_metricas_ciclo.sql  | 271 ++++++++++++++++++++
 .../migrations/vwMetricasCiclo.integration.test.ts | 277 +++++++++++++++++++++
 src/backend/migrations/vwMetricasCiclo.test.ts     | 109 ++++++++
 7 files changed, 1026 insertions(+)
```

## Backend LOC por camada (sem testes)
| Camada | LOC |
|---|---|
| src/backend/domain/service | 16153 |
| src/backend/domain/repository | 5944 |
| src/backend/domain/client | 7403 |
| src/backend/routes | 2765 |
| src/backend/http | 1411 |
| src/backend/jobs | 11170 |
| src/backend/migrations | 282 |
| src/backend/services | 983 |
| src/backend/lambda/api, lambda/job | ⚠️ Não medível: diretórios não existem (alvo) |

## Migrations SQL
- arquivos aplicáveis: 59
- 0058_vw_metricas_ciclo.sql: 271 linhas

## Testes
- backend *.test.ts: 149 (inclui 15 *.integration.test.ts, excluídos do npm test)
- frontend *.test.ts(x): 38
- npm test (backend, 2026-09-14): 134 suites, 1898 testes, exit 0
- vwMetricasCiclo.test.ts (estático): 9 testes verdes
- vwMetricasCiclo.integration.test.ts (Postgres 17-alpine descartável): 13 testes verdes; mutação `< janela_fim`→`<=` derrubou 2

## Validação contra ledger vivo (read-only)
- corpo de `metricas.metricas_ciclo` vs consulta independente (date_bin + NOT EXISTS), série recuada para 2026-06-19 só na validação: 12 janelas, 48 comparações, 0 divergências — EQUIVALENTE

## Infra
- Terraform modules: ⚠️ Não medível: `infra/` não existe (deploy Render hook)
- Tenants: ⚠️ Não medível: sem `infra/tenants`

## Dependências
- src/backend/package.json: 16 deps, 14 devDeps
- src/frontend/package.json: 23 deps, 17 devDeps
- delta da feature: 0 dependências novas

## Lint / typecheck backend
```
> financeiro-backend@0.36.2 typecheck
> tsc --noEmit

typecheck exit=0
The number of diagnostics exceeds the limit allowed. Use --max-diagnostics to increase it.
Diagnostics not shown: 50.
Checked 473 files in 694ms. No fixes applied.
Found 70 warnings.
```

## Contexto de produção (sondagem read-only 2026-09-14)
- Postgres 17.6 (Supabase), TimeZone da sessão = UTC; migrations aplicadas no boot pelo BootMigrator (última aplicada: 0057)
- permuta_alocacao_execucao: 190 linhas (177 settled, 13 error), 0 dry-run; 20 settled em borderô cancelado (R$ 3,03 mi)
- solicitacao_numerario_execucao: 23 linhas reais; recebimento / recebimento_execucao / rateio_recebimento: 0 linhas
- default ACL do schema public para postgres: anon/authenticated recebem só Dxtm (sem SELECT); RLS ligado nas tabelas de origem
