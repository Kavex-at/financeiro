# Shared Baseline Metrics — run `2026-08-06-1520-supabase-auth`

> Coletado pelo orquestrador do `/regis-review` ANTES do fan-out. **Leia este arquivo primeiro**
> e colete apenas as métricas específicas do seu QA por cima — não repita o que já está aqui.

## Contexto do run

| Campo | Valor |
|---|---|
| `run_id` | `2026-08-06-1520-supabase-auth` |
| Escopo | `backend` + `frontend` (**não há `infra/` neste repo** — ver abaixo) |
| Feature sob revisão | `supabase-auth` (`/feature-new`) |
| Worktree | `/home/inteli/kavex-worktrees/supabase-auth` |
| Branch | `feat/supabase-auth` |
| Base | `origin/main` @ `6e03775` (v0.20.1) |
| Modo | completo (sem `--quick`) |
| Estado | **nada commitado** — 61 modificados + 31 untracked na working tree |

### ⚠️ Leia antes de medir

1. **`infra/` NÃO EXISTE.** O deploy é Render (backend, deploy hook via GitHub Actions) + Vercel
   (frontend). Não há Terraform, SSM, Lambda ou conta AWS. O CLAUDE.md descreve isso como estado-**alvo**.
   Toda tactic que dependa de IaC deve ser marcada **"Não medível: não há `infra/` neste repositório"**,
   não inferida e não pontuada como ausência de esforço.
2. **O backend é Express, não Lambda.** Isso é dívida de template conhecida e **aceita**
   (`ontology/_inbox/migration-debt.md`), não um achado novo. Não gere card para "migrar para Lambda".
3. **A feature sob revisão não está commitada.** Meça a working tree, não o `HEAD`.

## Tamanho do código

### Backend por camada (arquivos `.ts`, excluindo `*.test.ts` e `node_modules`)

| Camada | Arquivos | Linhas |
|---|---:|---:|
| `domain/service` | 49 | 11.660 |
| `domain/client` | 21 | 6.174 |
| `domain/repository` | 19 | 4.528 |
| `routes` | 7 | 2.432 |
| `jobs` | 19 | 2.422 |
| `domain/libs` | 13 | 1.110 |
| `http` | 15 | 1.050 |
| `migrations` (`.sql`) | 46 | — |

### Frontend

| Métrica | Valor |
|---|---:|
| LOC (`.ts`/`.tsx`, sem testes, sem `node_modules`) | 16.945 |

### Testes

| Métrica | Valor |
|---|---:|
| Arquivos de teste backend | 119 |
| Arquivos de teste frontend | 26 |

## Dependências

| Pacote | `dependencies` | `devDependencies` |
|---|---:|---:|
| backend | 17 | 14 |
| frontend | 25 | 17 |

Versão do app (FE/BE em lockstep): **0.20.1** — o bump para `0.21.0` acontece **depois** deste review.

Adicionadas por esta feature: `@supabase/supabase-js`, `@supabase/ssr` (frontend), `@supabase/supabase-js` (backend).

## Gates — medidos pelo orquestrador nesta working tree

| Gate | Backend | Frontend |
|---|---|---|
| `npm run typecheck` | ✅ exit 0 | ✅ exit 0 |
| `npm run lint` | ✅ exit 0 — 38 warnings, **todos** `noExcessiveCognitiveComplexity` | ✅ 0 erros, 14 warnings |
| `npm test` | ⚠️ **17 falhas / 1.195 passes / 1.212 total** | ✅ 172 / 172 |
| `npm run build` | — | ✅ |

### ⚠️ As 17 falhas do backend são PRÉ-EXISTENTES — verificado, não presumido

O orquestrador criou um worktree descartável em `origin/main` (`6e03775`), rodou a suíte e **diffou os
nomes dos testes que falham**:

```
origin/main:        17 failed, 1.072 passed, 1.089 total
feat/supabase-auth: 17 failed, 1.195 passed, 1.212 total
diff dos nomes:     VAZIO (conjuntos idênticos)
```

As 4 suítes são `routes/recebimentos.e2e{,.falhas,.gates,.retomada}.test.ts` — **Frente IV**, com fixtures
dependentes de data (`docEspNumero: "06082026"`). **Não são regressão desta feature e não devem gerar
card de segurança/qualidade contra ela.** São, porém, um achado legítimo de **Testability** (suíte
não-determinística no tempo) — quem quiser levantar isso, levante nesse eixo, com este baseline.

Delta líquido de testes: **backend +123 passes, frontend +31 passes.**

## Superfície da feature

| Métrica | Valor |
|---|---:|
| Arquivos de código tocados (`src/backend` + `src/frontend`) | 71 |
| Diff total vs `origin/main` (rastreados) | 61 arquivos, +3.171 / −523 |
| Untracked | 31 |

### Arquivos novos de código (backend)

```
domain/client/SupabaseAdminClient.ts          + .test.ts
domain/interface/auth/
domain/service/auth/AppUserContextCache.ts
http/appUserContext.ts                        + .test.ts
http/auditActor.guard.test.ts                 (teste-guarda: falha se `req.user?.sub` reaparecer)
http/middlewareWiring.test.ts
jobs/migrate-users-to-supabase.ts             + .test.ts
migrations/0044_app_user_auth_link.sql
migrations/0045_app_user_role_default.sql
routes/auth.test.ts, routes/usuarios.test.ts
```

`auditActor` está definido em **`http/auth.ts:264`** (não é arquivo próprio).

### Arquivos novos de código (frontend)

```
middleware.ts                                 + __tests__/middleware.test.ts
lib/supabase/                                 (client, server, middleware factories)
app/auth/                                     (forgot-password, reset-password)
__tests__/auth/forgot-password.test.tsx
__tests__/auth/useIsAdmin.test.tsx
```

## Ontologia desta feature (fonte de verdade — leia antes de julgar decisões de design)

| Artefato | Caminho |
|---|---|
| ADR | `ontology/decisions/0030-supabase-auth-identity-provider.md` (amenda a **ADR-0011**) |
| Entidade | `ontology/entities/usuario.md` |
| State machine | `ontology/state-machines/usuario.md` |
| Business rules | `ontology/business-rules/{ator-da-trilha-de-auditoria,autorizacao-resolvida-do-banco,revogacao-de-acesso}.md` |
| Ações | `ontology/actions/usuario/` (7 arquivos) |
| Integração | `ontology/integrations/supabase-auth.md` |
| Follow-ups já abertos | `ontology/_inbox/supabase-auth-regis-followups.md` |
| Tasks + critérios | `ontology/_inbox/supabase-auth-tasks.md` (18 tasks, 169 critérios) |

**Decisão central da feature:** o JWT prova *identidade*; a *autorização* é resolvida do banco
(`app_user` por `auth_user_id`) a cada request, com cache TTL de 30 s. A claim `role` do GoTrue
(sempre `'authenticated'`) é **descartada**.

## Achados JÁ CONHECIDOS — não os reporte como novos

Registre-os como **carry-over** (com o histórico) ou ignore. Reportar como novidade infla o relatório
e desvaloriza os achados de verdade.

| # | Achado | Estado |
|---|---|---|
| 1 | **`filialAuthz` fail-OPEN** — `http/filialAuthz.ts:48` retorna `true` sem allow-list e a claim `filiais` nunca foi provisionada ⇒ qualquer `admin` opera em qualquer filial | **Carry-over aberto desde 2026-06-22 — 6º Regis-Review consecutivo.** Explicitamente fora de escopo desta feature; follow-up já aberto |
| 2 | `CONEXOS_CRED_ENC_KEY` — agora **presente** no `render.yaml`, mas **preencher é manual**. Até lá, `SecretCipher` fica desabilitado, `I-Usuario-5` fica inerte e toda baixa `fin010` sai como robô | Pré-existente; documentado no `DEPLOY.md` por esta feature |
| 3 | Backend Express em vez de Lambda; ausência de `infra/`/Terraform | Dívida de template **aceita** (`migration-debt.md`) |
| 4 | 38 warnings `noExcessiveCognitiveComplexity` no backend (baseline era 35) | Pré-existente, mesma classe |
| 5 | SMTP customizado do Supabase **não configurado** | Pré-requisito humano declarado na ADR-0030 §10 e no `DEPLOY.md`; o caminho de fallback (admin define senha) existe justamente para isso |

## Comandos úteis

```bash
cd /home/inteli/kavex-worktrees/supabase-auth
cd src/backend  && npm run typecheck && npm run lint && npm test
cd src/frontend && npm run typecheck && npm run lint && npm test && npm run build
git diff origin/main --stat
git status --short
```
