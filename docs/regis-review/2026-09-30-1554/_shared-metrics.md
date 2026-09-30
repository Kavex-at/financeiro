# Shared metrics — Regis-Review 2026-09-30-1554 (--quick, feature auth-supabase)

Worktree: `.claude/worktrees/auth-supabase`, branch `feat/auth-supabase` (base `76b5182`, v0.44.0).
Layout: `src/backend/`, `src/frontend/`. **Não existe `infra/`** (deploy Render + Vercel): métricas de
Terraform/tenant são **não medíveis**.

## Escopo desta revisão (diretórios tocados pela feature)

- `src/backend/http/` (auth.ts, authEnv.ts, acesso.ts, buildApp.ts, rateLimit.ts)
- `src/backend/routes/auth.ts`, `src/backend/routes/usuarios.ts`
- `src/backend/domain/client/SupabaseAuthClient.ts`
- `src/backend/domain/service/auth/` (SupabaseSessionService, CredentialMirror, SupabaseAuthSyncService, AdminSeeder, AccessService, UserAdminService, AuthService)
- `src/backend/domain/repository/auth/`
- `src/backend/jobs/sync-supabase-auth.ts`, `src/backend/jobs/seed-admin.ts`
- `src/backend/migrations/0070_app_user_auth_user_id.sql`
- `src/frontend/lib/auth/`, `src/frontend/lib/http.ts`
- Especificação: `ontology/_inbox/auth-supabase-tasks.md`; decisão: `ontology/decisions/0056-auth-supabase-mesmo-projeto.md`; runbook: `DEPLOY.md` §6

## Baseline

| Métrica | Valor |
|---|---|
| Backend LOC (sem testes) | 64.312 |
| Backend arquivos de teste | 189 |
| Frontend LOC (sem testes) | 24.535 |
| Frontend arquivos de teste | 65 |
| Terraform módulos / tenants | não medível (sem `infra/`) |
| Backend typecheck | ✅ 0 erros |
| Backend lint (Biome) | ✅ 0 erros, 75 warnings (pré-existentes em jobs/probes) |
| Backend testes | ✅ 174 suítes, 3111 testes |
| Frontend typecheck | ✅ 0 erros |
| Frontend lint (ESLint) | ✅ 0 erros, 19 warnings (pré-existentes) |
| Frontend testes | ✅ 65 suítes, 625 testes |
| Build backend | ✅ 68 migrations copiadas para dist (inclui 0070) |
| Build frontend | ✅; bundle sem URL/chave do Supabase |
| Coverage / npm audit | não medido (--quick) |
