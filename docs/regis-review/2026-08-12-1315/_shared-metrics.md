# Métricas compartilhadas — run 2026-08-12-1315 (escopo: backend, --quick)

> Gate do pipeline `/feature-tweak nde-descricao-item`. **Escopo restrito ao delta** da branch
> `fix/nde-descricao-item` sobre `main`.

## Delta sob review
```
 ontology/CHANGELOG.md                              |  23 ++
 ontology/_coverage.json                            |  12 +-
 .../nde-descricao-produto-nfe-diagnostico.md       | 156 +++++++++
 ontology/_index.json                               |  23 +-
 .../0036-descricao-item-nde-no-documento.md        |  83 +++++
 ontology/entities/nota-debito-eletronica.md        |   8 +
 ontology/integrations/conexos-nde-fiscal.md        |  24 +-
 .../domain/client/ConexosNdeFiscalClient.test.ts   | 133 ++++++++
 .../domain/client/ConexosNdeFiscalClient.ts        | 203 +++++++++++-
 .../domain/interface/recebimentos/NdeFiscal.ts     |  43 +++
 .../domain/libs/environment/EnvironmentProvider.ts |   2 +
 .../libs/environment/model/EnvironmentVars.ts      |  16 +
 ...ario.reformaTributaria.characterization.test.ts |  14 +
 .../RecebimentoNumerarioService.test.ts            | 187 +++++++++++
 .../recebimentos/RecebimentoNumerarioService.ts    | 120 ++++++-
 ...imentos.e2e.descricaoNfeNde.integration.test.ts | 356 +++++++++++++++++++++
 src/backend/routes/recebimentos.e2e.falhas.test.ts |  17 +
 src/backend/routes/recebimentos.e2e.gates.test.ts  |  17 +
 .../routes/recebimentos.e2e.retomada.test.ts       |  17 +
 src/backend/routes/recebimentos.e2e.test.ts        |  17 +
 20 files changed, 1458 insertions(+), 13 deletions(-)
```

## Baseline
- backend .ts (não-teste): 214 arquivos
- backend testes: 115 arquivos
- typecheck: OK (`tsc --noEmit` limpo)
- lint: exit 0 (32 warnings pré-existentes de complexidade, nenhuma no delta)
- testes: 1132 passed / 14 failed — as 14 falhas são **pré-existentes na main** (conjunto idêntico verificado em worktree limpo)
