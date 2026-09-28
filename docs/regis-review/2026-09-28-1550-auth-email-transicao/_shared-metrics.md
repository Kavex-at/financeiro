# Shared metrics — `auth-email-transicao` (delta vs `origin/main`)

- **Worktree:** `/home/inteli/Área de trabalho/projects/kavex/financeiro/.claude/worktrees/auth-email-transicao`
  (leia os arquivos DAQUI; o checkout principal está em `main` e não tem estes arquivos)
- **Branch:** `feat/auth-email-transicao`, base `origin/main` @ `851d75a`. Modo `--quick`.
- **Feature:** passo 1 de 3 do plano de auth (ADR-0051, `ontology/decisions/0051-*.md`). Todo usuário
  ganha um e-mail de login (`app_user.email`, cadastrado por admin, sem backfill). Login aceita e-mail
  OU usuário sem distinção de caixa; o token NÃO muda (`sub` = `username` canônico, sem claim `email`).
  Banner de transição no login por chave manual (`AUTH_TRANSICAO_EMAIL_BANNER`) via `GET
  /auth/transicao` público que devolve só `{ ativo }`. Guarda de desativação (nem a si mesmo, nem o
  último admin ativo) em transação com `FOR UPDATE`. `seed-admin` exige `ADMIN_EMAIL`/`ADMIN_PASSWORD`
  sem default. Nenhuma chamada a Conexos/Nexxera/GED.
- **Layout:** `src/backend/` e `src/frontend/` (não `backend/src/`). **Não existe `infra/`**: métricas
  de Terraform/tenant são **não medíveis** (deploy via Render hook + Vercel).
- **Escopo desta revisão:** os diretórios tocados pela feature (lista abaixo). Achados fora do delta
  devem ser marcados como PRÉ-EXISTENTES e não viram P0 desta feature.

## Escopo do delta (`git diff --stat origin/main...HEAD`)

```
 DEPLOY.md / render.yaml / src/backend/.env.example           ADMIN_USERNAME -> ADMIN_EMAIL, banner var
 ontology/decisions/0051-auth-email-real-sub-continua-username.md (novo)
 src/backend/migrations/0064_app_user_email.sql               45 (novo, aditiva, guarda DO $$ + 2 índices lower())
 src/backend/domain/repository/auth/UserRepository.ts         302 (findByLoginIdentifier, setEmail, create c/ NOT EXISTS, deactivateGuarded, upsertAdmin)
 src/backend/domain/service/auth/AuthService.ts               55  (login por identificador; >1 linha = 401 + log)
 src/backend/domain/service/auth/UserAdminService.ts          107 (createUserSchema c/ alias, setEmailSchema, setEmail, setAtivo guardado)
 src/backend/routes/auth.ts                                   27  (normalização + GET /auth/transicao)
 src/backend/routes/usuarios.ts                               64  (PATCH /:id/email, guarda em /:id/ativo, mapeamento 409)
 src/backend/jobs/seed-admin.ts + SeedAdminConfig.ts          21 + 50
 src/backend/domain/libs/environment/*                        authTransicaoEmailBanner
 src/backend/domain/interface/operacao/configManifest.ts      +10
 src/frontend/app/login/page.tsx + TransicaoEmailBanner.tsx   15 + 48
 src/frontend/app/usuarios/page.tsx, EditarEmailDialog.tsx, NovoUsuarioDialog.tsx
 src/frontend/lib/usuarios.ts + lib/auth/transicao.ts
 + testes: UserRepository (362), AuthService (118, novo), UserAdminService (151), routes/auth (143, novo),
   routes/usuarios (299, novo), SeedAdminConfig (65), 0064 (54), buildApp (+10), EnvironmentProvider (+31),
   frontend: login-page (101), transicao (87), usuarios-api (66), usuarios-page (224)
 35 files changed, 2688 insertions(+), 156 deletions(-)
```

## Gates medidos nesta branch (2026-09-28)

| Gate | Resultado |
|---|---|
| backend `npm run typecheck` | ✅ exit 0 |
| backend `npm run lint` (Biome) | ✅ exit 0; 74 warnings pré-existentes, 0 nos arquivos do delta |
| backend `npm test` | ✅ 158 suites / 2371 testes |
| backend `npm run build` | ✅ `[build] 65 migração(ões) copiada(s)` (main: 64); `dist/migrations/0064_app_user_email.sql` presente |
| frontend `npm run typecheck` | ✅ exit 0 |
| frontend `npm run lint` (ESLint) | ✅ exit 0; 21 warnings pré-existentes (1 em `usuarios/page.tsx:65`, anterior ao delta) |
| frontend `npm test` | ✅ 55 suites / 465 testes |
| Migrations ao vivo (Postgres 16 descartável, nunca prod) | ✅ 65 aplicadas do zero; 0064 idempotente; guarda aborta com duplicata de caixa |
| Repositório ao vivo (mesmo Postgres descartável) | ✅ 20/20: colisões cruzadas 409, índices `lower()` 23505, no-op do mesmo e-mail, corrida de dois admins (1 passa, 1 recusa, resta 1 ativo) |

## Baseline de contagem (repo inteiro, para contexto)

- Backend: 158 suites de teste; frontend: 55 suites.
- `app_user` em produção (contagem read-only do scoping, 2026-09-28): 15 usuários, 14 ativos, todos
  `admin`; 0 colisões de caixa em `username`; único não-e-mail = `admin`.

## Não medível nesta execução

- Terraform/tenants/IAM: não existe `infra/`.
- `npm audit` profundo: omitido (`--quick`).
- Cobertura: omitida (`--quick`).
