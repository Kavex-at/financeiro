# Shared Metrics — 2026-08-03-1847-alocar-sn-select

## Scope (feature-scoped Regis-Review)
Touched dirs: src/backend/domain, src/backend/routes, src/frontend/app/recebimentos
Feature: select existing SN before Processar (ADR-0027)

## Changed files (git diff --stat vs branch base)
 .../client/ConexosGerDocProcessoClient.test.ts     | 113 ++++++
 .../domain/client/ConexosGerDocProcessoClient.ts   | 106 +++++
 .../RecebimentoNumerarioService.test.ts            |  30 ++
 .../recebimentos/RecebimentoNumerarioService.ts    |  41 +-
 src/backend/routes/recebimentos.test.ts            | 108 +++++
 src/backend/routes/recebimentos.ts                 |  53 +++
 .../components/AlocarProcessosDialog.test.tsx      | 180 +++++++--
 .../components/AlocarProcessosDialog.tsx           | 435 +++++++++++++++------
 src/frontend/lib/recebimentos.ts                   |  51 +++
 9 files changed, 958 insertions(+), 159 deletions(-)

## Backend LOC (touched areas, non-test)
 13402 total

## Backend test count (recebimentos)
41

## Frontend recebimentos LOC (non-test)
 2117 total
