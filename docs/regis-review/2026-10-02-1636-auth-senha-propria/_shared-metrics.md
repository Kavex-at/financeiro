# Shared metrics — Regis-Review `--quick`, feature `auth-senha-propria` (2026-10-02 16:36 UTC)

Escopo (gate pós-implementação de `/feature-tweak`): o delta da feature `auth-senha-propria` (troca da
própria senha, `GET /me/senha/politica` + `POST /me/senha`, ADR-0059), branch `feat/auth-senha-propria`
sobre `origin/main` `e4730da` (v0.49.0). Só achados que **este delta** introduz ou agrava contam como
P0 da feature; dívida pré-existente vai como P1–P3.

## Arquivos do delta (`git diff --stat origin/main...HEAD`: 33 arquivos, +2483 / −91)

- `src/backend/routes/me.ts` (reescrito: `buildMeRouter`, rotas `/me/senha`)
- `src/backend/domain/service/auth/OwnPasswordService.ts` (novo), `PasswordPolicy.ts` (novo)
- `src/backend/domain/interface/auth/PasswordPolicy.ts` (novo), `SupabaseAuth.ts` (`LOGOUT_SCOPE`)
- `src/backend/domain/errors/PasswordPolicyError.ts`, `CurrentPasswordInvalidError.ts` (novos)
- `src/backend/domain/service/auth/CredentialMirror.ts` (senha com `tokenDoChamador` → `PUT /user`)
- `src/backend/domain/client/SupabaseAuthClient.ts` (`logout(token, scope)`, `updateOwnPassword`)
- `src/backend/domain/repository/auth/UserRepository.ts` (`updatePassword` sempre transacional + evento)
- `src/backend/domain/repository/auth/AccessRepository.ts` (`ACCESS_EVENT_TYPE.SENHA`)
- `src/backend/domain/service/auth/UserAdminService.ts` (só o call site)
- `src/backend/http/rateLimit.ts` (`buildOwnPasswordLimiter`, 5 falhas 422 / 15 min por usuário), `http/redact.ts`
- `src/backend/migrations/0073_app_user_access_event_tipo_senha.sql` (amplia CHECK; sem reverse)
- `src/backend/jobs/probe-gotrue-local.ts` (sonda local, recusa URL não-local)
- Testes: `OwnPasswordService.test.ts`, `PasswordPolicy.test.ts`, `me.test.ts`, `rateLimit.test.ts`,
  `redact.test.ts`, `UserRepository.test.ts`, `CredentialMirror.test.ts`, `SupabaseAuthClient.test.ts`,
  `0073_*.test.ts`, `0073_*.integration.test.ts`, `routePermissions.test.ts`
- Docs: `ontology/decisions/0059-auth-troca-da-propria-senha.md`, `DEPLOY.md`, `ontology/CHANGELOG.md`,
  `ontology/_inbox/auth-senha-propria-{interview,tasks}.md`

## Baseline (medido nesta sessão)

| Métrica | Valor |
|---|---|
| Backend LOC (não-teste, sem node_modules/dist) | 70 285 |
| Backend arquivos de teste | 208 |
| Frontend arquivos de teste | 66 |
| `npm run typecheck` (backend) | 0 erros |
| `npm run lint` (backend, Biome) | 0 erros, 76 warnings (todos pré-existentes, `noExcessiveCognitiveComplexity` etc.) |
| `npm test` (backend) | 189 suítes, 3498 testes, 0 falhas |
| `npm run test:sql` (Postgres 17 descartável) | 5 suítes, 53 testes, 0 falhas (inclui a 0073) |
| `npm run build` | ok; 73 `.sql` copiados para `dist/migrations`, inclui a 0073 |
| Frontend `typecheck` / `test` (não tocado) | ok / 66 suítes, 682 testes |
| Terraform / tenants | ⚠️ Não medível: não existe `infra/` neste repo (deploy Render) |
| Coverage | ⚠️ Não medido (`--quick`) |
| `npm audit` | ⚠️ Não medido (`--quick`); nenhuma dependência nova no delta |

## Evidência de execução real (roteiro de QA local, GoTrue v2.197 + Postgres 17)

Registrada em `ontology/_inbox/auth-senha-propria-interview.md`, seção "Resultado do roteiro de QA
local": 204/400/422/429/503 conferidos nos dois `AUTH_PROVIDER`; sessão atual sobrevive e a outra cai
(modo supabase); GoTrue parado → 503 com `password_hash` e trilha inalterados; logs com
`senhaAtual`/`novaSenha` `[REDACTED]` e zero ocorrências das senhas de teste.
