# Shared metrics — sispag-excecao-destino (ADR-0060)

Escopo: arquivos tocados pela feature. Backend: `src/backend/domain/service/sispag`, `domain/repository/sispag`,
`domain/libs/sispag`, `domain/errors/Excecao*`, `routes/sispag.ts`, `jobs/aposentar-excecoes-substituidas.ts`,
`jobs/probe-destino-manual-uso.ts`, `migrations/0075_sispag_excecao_destino.sql`.
Frontend: `src/frontend/app/sispag/**`, `src/frontend/lib/sispag.ts`, `lib/permissoes.ts`. Sem `infra/` (não existe).

| Métrica | Valor |
|---|---|
| backend typecheck (`tsc --noEmit`) | limpo |
| backend lint (Biome) | 0 erros; warnings pré-existentes de complexidade |
| backend jest | 201 suites, 3726+ testes verdes |
| backend `test:sql` (Postgres 17 local) | 9 suites, 86 testes verdes (inclui 0075, repositório e serviço de exceção) |
| frontend typecheck / eslint | limpo / 0 erros |
| frontend jest | 76 suites, 782 testes verdes |
| PatternGuardian | PASS (sem P0/P1) |
| ObservabilityAdvisor | sem P0; P1 aplicados (redação de erro, trilha da divergência, logs de negação) |

Não medível: cobertura (`--coverage` não rodado), `npm audit` profundo, terraform (não existe).
Arquivos tocados: `git diff --name-only origin/main -- src`.
