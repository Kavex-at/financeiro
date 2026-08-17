# Shared metrics — run 2026-08-17-1402 (escopo: DELTA da feature nde-painel-lista, --quick)

> Worktree: /tmp/nde-painel-wt · branch `fix/nde-painel-lista` · base `main`.
> **Escopo restrito ao delta** — não é auditoria full-repo. Use o diff abaixo como recorte.

## Diff da feature (`git diff main --stat`)
```
 CHANGELOG.md                                       |  30 ++++++
 ontology/_coverage.json                            |  14 +--
 ontology/_index.json                               |  27 +++--
 ontology/entities/nota-debito-eletronica.md        |  30 +++++-
 .../domain/interface/recebimentos/constants.ts     |  19 ++++
 src/backend/domain/interface/recebimentos/ports.ts |  55 +++++++++-
 .../repository/recebimentos/NdeRepository.test.ts  | 116 ++++++++++++++++++++
 .../repository/recebimentos/NdeRepository.ts       | 115 +++++++++++++++++++-
 .../recebimentos/RecebimentoNumerarioService.ts    |   4 +-
 .../recebimentos/RecebimentosPainelService.test.ts | 118 ++++++++++++++++++++-
 .../recebimentos/RecebimentosPainelService.ts      | 114 ++++++++++++++++++--
 src/backend/package.json                           |   2 +-
 src/backend/routes/recebimentos.e2e.falhas.test.ts |   5 +
 src/backend/routes/recebimentos.e2e.gates.test.ts  |   5 +
 ...entos.e2e.hmlTituloCondicao.integration.test.ts |   3 +
 ...bimentos.e2e.hmlTituloOrdem.integration.test.ts |   3 +
 ...ebimentos.e2e.hmlTituloZero.integration.test.ts |   3 +
 .../recebimentos.e2e.hmlWrite.integration.test.ts  |   5 +
 .../recebimentos.e2e.prodWrite.integration.test.ts |   3 +
 .../routes/recebimentos.e2e.retomada.test.ts       |   5 +
 src/backend/routes/recebimentos.e2e.test.ts        |   5 +
 .../app/recebimentos/components/NdeTable.tsx       |  70 +++++++++---
 .../app/recebimentos/components/status-badges.tsx  |  45 ++++++++
 src/frontend/lib/recebimentos.test.ts              |   7 +-
 src/frontend/lib/recebimentos.ts                   |  48 ++++++++-
 src/frontend/package.json                          |   2 +-
 26 files changed, 795 insertions(+), 58 deletions(-)
```

## Backend LOC por camada (não-teste)
```
domain/service:  12015 total
domain/repository:   4572 total
domain/client:   5892 total
domain/interface:   3976 total
routes:  2329 total
```

## Contagens
```
backend test files:  114
frontend test files: 24
frontend LOC (não-teste):  16183 total
terraform modules: NÃO EXISTE (infra/ não existe — deploy é Render hook; ver CLAUDE.md)
tenants provisionados: NÃO EXISTE (sem infra/tenants)
```

## Baselines de gate (medidos neste worktree)
```
backend typecheck: OK (tsc --noEmit sem erros)
frontend typecheck: OK
backend lint (biome): exit 0 — 35 warnings (todas pré-existentes; main tem 37)
frontend lint (eslint): 15 problems, 0 errors, 15 warnings (nenhum nos arquivos do delta)
backend jest: 1127 passed / 14 failed / 1141 total
  ^ as 14 falhas estão em 4 suítes e2e JÁ VERMELHAS na main (17 falhas lá).
    causa: env COM297_GCD_NOTA_DEBITO ausente no ambiente local.
    diff por teste (main x worktree) confirma ZERO regressão introduzida pelo delta.
frontend jest: 148 passed / 148 total (6 novos em NdeTable.test.tsx)
```

## Dependências
```
backend deps: 16 | devDeps: 14
frontend deps: 23 | devDeps: 17
```

## Notas de escopo para os agentes

- `--quick`: NÃO rodar coverage, `npm audit` profundo, build de produção ou terraform.
- `infra/` **não existe** neste repo (estado atual = Express no Render + Vercel). Deployability/availability
  devem medir o que existe (GitHub Actions + Render hook + BootMigrator), não inventar Terraform.
- O recorte é o DELTA. Findings sobre dívida pré-existente fora do delta entram no máximo como P3
  contextual, e precisam dizer explicitamente que são pré-existentes.
