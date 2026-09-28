# Shared metrics — auth-permissoes-modulo (`--quick`, escopo = diretórios tocados pela feature)

Branch `feat/auth-permissoes-modulo`, base `4c6b34f` (v0.43.1). Delta: `git diff 4c6b34f..HEAD`
— 118 arquivos, +9079 / −1144 (inclui testes, ADR e inbox).

Escopo: `src/backend/http`, `src/backend/domain/{interface,repository,service}/auth`,
`src/backend/routes`, `src/backend/migrations` (0066 + rollback), `src/backend/jobs/seed-admin`,
`src/frontend/lib`, `src/frontend/components/{auth,nav,home}`, `src/frontend/app/{usuarios,permutas,sispag,recebimentos,metricas}`.

## Gates medidos nesta branch

| Métrica | Valor |
|---|---|
| Backend jest (com `--coverage`, thresholds ok) | 166 suites / 2928 testes verdes (main: 160 / 2442) |
| Frontend jest (com `--coverage`, thresholds ok) | 63 suites / 614 testes verdes (main: 57 / 485) |
| Backend typecheck / Biome | ok / 0 erros, 74 warnings (igual à main) |
| Frontend typecheck / ESLint / `next build` | ok / 0 erros, 19 warnings (igual à main) / ok |
| Backend build | 67 migrações copiadas para `dist/migrations` (main: 66) |
| Teste de cobertura de rotas | 85 rotas autenticadas, cada uma com exatamente 1 guard (introspecção) + teste comportamental por linha (346 casos) |

## Validação ao vivo (Postgres 16 descartável, nunca produção)

- Migrations do zero (67) + reaplicação da 0066: idempotente.
- Guarda da 0066: aborta antes de qualquer DDL com `role` ≠ `admin` (mensagem em português).
- Reverse da 0066 aplicado e verificado (tabelas e coluna removidas; INSERT do backend v0.43.1 volta a funcionar); reaplicação posterior ok.
- `AccessRepository`/`UserRepository` reais: 27/27 checagens; corrida "último gestor" 10/10 (exceções concorrentes e desativação concorrente: sempre 1 sucesso + 1 `LastUserManagerError`).

## Não medível

- Infra/Terraform: não existe `infra/` neste repo (deploy Render/Vercel).
- `npm audit` profundo: pulado (`--quick`).
- Latência real da consulta de acesso por requisição: sem ambiente de carga; custo estimado = 1 SELECT por usuário a cada 30 s (cache frio).
