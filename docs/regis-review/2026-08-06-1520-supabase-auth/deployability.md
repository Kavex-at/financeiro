---
qa: Deployability
qa_slug: deployability
run_id: 2026-08-06-1520-supabase-auth
agent: qa-deployability
generated_at: 2026-08-06T15:20:00-03:00
scope: backend + frontend (Render + Vercel + Supabase; sem infra/Terraform — ver _shared-metrics §"Leia antes de medir")
score: 4
findings_count: 9
cards_count: 8
---

# Deployability — Regis-Review

> Ler ANTES: `docs/regis-review/2026-08-06-1520-supabase-auth/_shared-metrics.md`. Não repito baseline
> (LOC, gates, 17 falhas pré-existentes de Frente IV). O que importa neste QA é como o **cutover de
> provedor de identidade** vai (ou não vai) chegar em produção sem lockout, e como o rollback
> declarado se comporta quando testado contra o código.

## 1. Cenário Geral (Bass General Scenario aplicado ao cutover Supabase Auth)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Operador (Yuri) executando o cutover de identidade nas 4 fases da ADR-0030 §6 | `git push origin main` que dispara o deploy Render + Vercel, ou o *toggle* de `AUTH_LEGACY_LOGIN_ENABLED` no dashboard Render | Backend Render (`financeiro-backend`), Frontend Vercel, Supabase (GoTrue + Postgres) | Cutover em produção, com todos os usuários já em uso do sistema | 100% dos usuários com login válido antes da mudança continuam com login válido depois; qualquer descoberta de falha durante a janela **DEVE** ser rollável para o estado anterior **em ≤ 5 min sem tocar em código** | MTTR de rollback ≤ 5 min; 0 usuários sem caminho de login; migrations 100% idempotentes; rollback sem redeploy para Fases 2 e 3 |

**Sub-cenário crítico (declarado pela ADR-0030 §6 como modo de falha):** *"Ligar o Supabase derrubaria
todas as sessões vivas de uma vez"* (armadilha do `issuer`), *"desligar o login legado enquanto existir
`app_user` com `auth_user_id IS NULL` deixa esse usuário sem nenhum caminho de login"* (gate da Fase 3),
*"o hash bcrypt é aceito mas não confere e ninguém descobre até o primeiro login"* (import silencioso).
O QA pergunta: cada um desses tem contramedida **enforçada**, ou é confiança?

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passos automatizados entre commit e produção (backend) | 6 (checkout, setup-node, npm ci, npm audit, typecheck, lint, **test**, build → merge → autoDeploy Render → preDeploy migrate/seed) | ≥ 5 | ✅ | `.github/workflows/ci.yml`, `render.yaml` |
| Deploy gate: `terraform plan` equivalente | N/A (Render blueprint declarativo commitado + branch protection) | presente | ✅ (por analogia) | `render.yaml`, comentário sobre branch protection linhas 12-16 |
| Health-check no deploy Render | `/health` retorna `{status:'ok', version}` sem tocar em Supabase/Postgres | health-check DEEP (ping DB + JWKS reachable) | ⚠️ | `src/backend/index.ts:73` |
| Rollback de Fase 3 (`AUTH_LEGACY_LOGIN_ENABLED=false → true`) | 1 env var no Render, sem redeploy — **verificado no código** (`routes/auth.ts:53`, `http/authEnv.ts:45-48`) | 1 env var | ✅ | `src/backend/routes/auth.ts:36-77` |
| Rollback de Fase 2 (`NEXT_PUBLIC_AUTH_PROVIDER=legacy`) — como documentado | **0 arquivos de código lêem essa variável** (`grep -rn NEXT_PUBLIC_AUTH_PROVIDER src/frontend --include="*.ts*"` = 0) | 1 env var | ❌ | `src/frontend/lib/auth/AuthProvider.tsx:169` (`signIn` chama `supabase.auth.signInWithPassword` **incondicionalmente**), `src/frontend/app/login/page.tsx:49` |
| Gate operacional da Fase 3 (`listPendingMigration()` vazio) | Advisory log via `console.warn` no CLI do job `job:migrate-users` — nenhum enforcement no boot da API | Gate enforçado (boot falha OU `POST /auth/login` degrada para "aceita legado mesmo com flag off") | ❌ | `src/backend/jobs/migrate-users-to-supabase.ts:118-132`; `listPendingMigration` só é chamado pelo próprio job (grep) |
| Idempotência de migrations | Tracker `schema_migrations` por nome de arquivo; `0044` usa `IF NOT EXISTS` + `DROP NOT NULL` (idempotente); `0045` `ALTER … SET DEFAULT` (idempotente) | 100% idempotente | ✅ | `src/backend/migrations/runMigrations.ts:26-53`; `0044_app_user_auth_link.sql:33-36`; `0045_app_user_role_default.sql:12` |
| Backward-compat de migrations `0044`/`0045` com código anterior (rollback de binário) | Adições ADITIVAS (colunas nulas, drop NOT NULL, index único, default relaxado). Rollback de binário **compatível na maioria dos casos**; uma janela: linhas criadas pelo caminho `convidarUsuario` novo (`password_hash = NULL`) quebram o `AuthService.login` antigo | Backward-compat total | ⚠️ | migrations `0044`/`0045` + `convidarUsuario` (chamada nova) |
| Divergência entre `.env.example` (backend) e `authEnv.ts` | `.env.example` afirma `AUTH_JWT_SECRET` obrigatório e `SUPABASE_URL` "legacy/opcional"; `authEnv.ts:131-136` aceita QUALQUER um dos três (`SUPABASE_URL`, `AUTH_JWT_SECRET`, `SUPABASE_JWT_SECRET`) | Zero divergência | ❌ | `src/backend/.env.example` linhas "Legacy Supabase auth" vs `src/backend/http/authEnv.ts:30-57` |
| Divergência entre DEPLOY.md §3 (Vercel env vars) e o que o FE realmente lê | Tabela §3 lista **3 vars**; código lê **6** (as 3 + `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, e o "rollback" da Fase 2). Falta na tabela ≡ crash na 1ª navegação (`MissingSupabaseEnvError` em `readSupabasePublicEnv`) | Zero divergência | ❌ | `DEPLOY.md:110-116` vs `src/frontend/lib/supabase/env.ts:41-53` |
| Divergência de Node entre CI (`24`) e crons de ingestão (`22`) | CI usa `node-version: '24'`; `.tool-versions` `nodejs 24.0.1`; **ingest-permutas/sispag/extratos.yml usam `node-version: 22`** | 1 versão | ⚠️ | `.github/workflows/{ci,ingest-permutas,ingest-sispag,ingest-extratos}.yml` |
| CI test-gate confiável | `npm test -- --coverage` na job Backend; **17 testes falham em `origin/main` e no branch da feature** (verificado no shared-metrics). Ou CI está vermelha em `main` e branch protection está bypassada nos releases, ou o sinal do gate é ilusório | 0 falhas OU exclusão explícita | ❌ | `.github/workflows/ci.yml:27`; baseline `_shared-metrics.md` linhas 74-88 |
| Tempo de build backend (`tsc && tsc-esm-fix dist`) | 9.83s (medido localmente, node 24) | ≤ 60s | ✅ | `time (cd src/backend && npm run build)` |
| Tamanho do artefato deployado backend | `dist/` = 9.0 MB; `node_modules` = 286 MB | não hard-limit (Render, sem 250 MB Lambda) | ✅ | `du -sh src/backend/dist src/backend/node_modules` |
| Smoke test pós-deploy (login sintético / verificação de JWKS reachable) | Ausente. `/health` não bate no Supabase; nenhum workflow pós-deploy | 1 login sintético + 1 fetch JWKS na CI ou pós-deploy | ❌ | `.github/workflows/`, `src/backend/index.ts:73`, `render.yaml` |
| Drift detection (config Render vs `render.yaml`) | Ausente. Sete vars com `sync: false` — dashboard é fonte da verdade. Sem check periódico | drift check semanal | ⚠️ | `render.yaml:38-93` |
| Verificação automatizada dos 9 pré-requisitos manuais no Supabase (ADR-0030 §10) | 0 automatizados; todos por confiança operacional | ≥ 3 (signup off, SMTP configurado, JWKS reachable) | ❌ | `DEPLOY.md:26-43` (checklist), `ADR-0030 §10` |
| `CONEXOS_CRED_ENC_KEY` — status de configuração | Declarada em `render.yaml:74` com `sync: false`; **preencher é manual e sem esta chave `SecretCipher` fica desabilitado silenciosamente** (Carry-over conhecido — não é novo desta feature) | Presente OU ausente-com-erro-loud; nunca presente-mas-vazia | ⚠️ | `render.yaml:70-75`; `_shared-metrics.md` linha 155 |

> ⚠️ **Não medível localmente**: MTTR real de rollback em produção (nunca foi exercitado); tempo entre
> `git push` e `POST /auth/login` disponível em produção. Requer um exercício de rollback em ambiente
> staging que **hoje não existe** (o Render Blueprint declara `financeiro-backend` sem serviço `staging`).
> Recomendação: provisionar um projeto Supabase de staging + serviço Render staging antes do primeiro
> cutover Fase 2 → 3.

## 3. Tactics — Cobertura no financeiro (Bass & Clements)

### Manage Deployment Pipeline

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Scale Rollouts | Render Blueprint com `autoDeploy: true` (rolling deploy nativo, instância única `plan: starter`); Vercel faz preview + promotion. **Cutover em 4 fases modelado como escala controlada** (ADR-0030 §6) | ⚠️ parcial | `render.yaml:17`, `ontology/decisions/0030-supabase-auth-identity-provider.md:131-143` |
| Rollback | (a) Fase 3 (backend): 1 env var no Render `AUTH_LEGACY_LOGIN_ENABLED=true` — **enforçado no código**; (b) Fase 2 (frontend): documentado como 1 env var mas o código **não implementa** o switch — verdadeiro rollback exige promover deployment Vercel anterior; (c) Fase 1 (migrations): rollback ≠ downgrade — depende de reverter binário com migrations aditivas backward-compat | ⚠️ parcial | `src/backend/routes/auth.ts:36-77` ✅; `src/frontend/lib/auth/AuthProvider.tsx:63-201` ❌ (nenhum branch em `NEXT_PUBLIC_AUTH_PROVIDER`) |
| Script Deployment Commands | `render.yaml` declarativo + `preDeployCommand: npm run migrate && npm run seed:admin` + `.github/workflows/ci.yml` + 3 crons (`ingest-*.yml`) | ✅ presente | `render.yaml:18-21`, `.github/workflows/*.yml` |

### Manage Deployed System

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Logical Grouping | Kill-switches por frente (`SISPAG_ENABLED`, `RECEBIMENTOS_ENABLED`) + kill-switch de auth legado (`AUTH_LEGACY_LOGIN_ENABLED`). Nenhum outro flag de feature | ⚠️ parcial | `src/backend/http/{sispagGate,recebimentosGate}.ts`, `authEnv.ts:45-48` |
| Physical Grouping | Instância única no Render (`plan: starter`) por desenho — declarado em `ontology/business-rules/revogacao-de-acesso.md` como restrição do cache TTL de 30 s. Vercel é edge-distributed nativamente | N/A (single-tenant, single-instance) | `render.yaml:8` |
| Package Dependencies | `package-lock.json` commitado em BE e FE; CI usa `npm ci` (não `npm install`); `.tool-versions` fixa Node em `24.0.1` | ✅ presente | `src/backend/package-lock.json`, `.github/workflows/ci.yml:23`, `.tool-versions` |
| Surge Protection | Fora de escopo desta tactic (aplicada a servidores em execução) — o `globalLimiter` no `index.ts:39` cobre runtime, não deploy | N/A no deploy | `src/backend/index.ts:39` |

### Supporting concerns (fora do quadrante Bass mas essenciais para cutover)

| Tactic auxiliar | Implementação atual | Status | Evidência |
|---|---|---|---|
| Idempotent deploys | `schema_migrations` (por nome de arquivo), `0044` com `IF NOT EXISTS`/`DROP NOT NULL` idempotentes, `seed-admin` faz UPSERT+reuse do usuário GoTrue, `job:migrate-users` filtra `auth_user_id IS NULL` (idempotente por construção — re-run migra zero) | ✅ presente | `runMigrations.ts:26-53`, `0044_app_user_auth_link.sql`, `jobs/seed-admin.ts`, `jobs/migrate-users-to-supabase.ts:35-45` |
| Drift detection | Nenhuma — 7 vars `sync: false` no Render (dashboard é fonte da verdade sem check); nenhum diff periódico | ❌ ausente | `render.yaml:39-93` |
| Reproducible builds | Lockfiles commitados; Node pinado (`24.0.1`). **Divergência**: crons de ingestão rodam em `node-version: 22`, CI/app em `24` | ⚠️ parcial | `.tool-versions`, `.github/workflows/ingest-{permutas,sispag,extratos}.yml` linhas `node-version: 22` |
| Per-tenant blast radius | N/A — single-tenant (Columbia). Documentado como estado-alvo no `CLAUDE.md` | N/A | `CLAUDE.md` §"Tenants" |
| Deployment observability | `/health` reporta `version` (bom para verificar promoção); zero deep-health (não bate Supabase, não verifica JWKS reachable) | ⚠️ parcial | `src/backend/index.ts:70-73` |
| Verifiable preconditions (guarda humana ⇒ automatizada) | Todos os 9 pré-requisitos ADR-0030 §10 são disciplinares. O gate da Fase 3 (`listPendingMigration()` vazio) também é disciplinar (advisory log em CLI) | ❌ ausente | `DEPLOY.md:26-43`, `jobs/migrate-users-to-supabase.ts:118-132` |

## 4. Findings

### F-deployability-1: Rollback declarado da Fase 2 (`NEXT_PUBLIC_AUTH_PROVIDER=legacy`) não existe no código do frontend

- **Severidade**: P0 (crítico — na janela em que o cutover falhar, a operação vai tentar o rollback documentado e ele será um no-op silencioso)
- **Tactic violada**: Rollback
- **Localização**: `src/frontend/lib/auth/AuthProvider.tsx:63-201`; `src/frontend/app/login/page.tsx:44-55`; `src/frontend/.env.example:18`; `DEPLOY.md:140` (linha do rollback); `ontology/decisions/0030-supabase-auth-identity-provider.md:134,143`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "NEXT_PUBLIC_AUTH_PROVIDER" src/frontend --include="*.ts" --include="*.tsx"
  (0 hits)

  $ grep -rn "authProvider" src/frontend/lib/auth src/frontend/app --include="*.ts*"
  (0 hits fora de imports do componente <AuthProvider>)
  ```
  `AuthProvider.tsx:169-172` chama `getSupabaseBrowserClient().auth.signInWithPassword({email, password})` **incondicionalmente**. Não há branch em `process.env.NEXT_PUBLIC_AUTH_PROVIDER`.
  DEPLOY.md linha 140: *"Fase 2 | aceita ambos os tokens ... | `NEXT_PUBLIC_AUTH_PROVIDER=supabase` | voltar a flag para `legacy`"*.
  ADR-0030 §6 linha 143: *"O rollback da Fase 2 é uma variável de ambiente na Vercel, sem redeploy do backend."*
- **Impacto técnico**: Se a Fase 2 quebrar em produção (ex.: bug no cliente `@supabase/ssr` que mata o refresh de token para um subset de usuários), o operador vai tentar o rollback documentado (mudar `NEXT_PUBLIC_AUTH_PROVIDER=legacy` no dashboard Vercel), esperar que ele funcione "sem redeploy", e não vai funcionar. O rollback real é: **promover manualmente um deployment Vercel anterior** (que ainda posta em `/auth/login`). Isso não está documentado.
- **Impacto de negócio**: Durante o cutover (o momento de maior risco declarado), a discrepância entre docs e código consome minutos ou horas para ser diagnosticada. O modo de falha explícito da feature é **lockout geral** (`ontology/entities/usuario.md` cita "cutover cujo modo de falha declarado é lockout geral"). Uma equipe operando com adrenalina alta seguindo um runbook que mente sobre onde está o botão de rollback é um multiplicador do incidente.
- **Métrica de baseline**: 0 arquivos de código no frontend lêem `NEXT_PUBLIC_AUTH_PROVIDER`; `.env.example` a menciona mas nenhum consumidor existe.

### F-deployability-2: Gate operacional da Fase 3 é um `console.warn`, não um enforcement

- **Severidade**: P1 (alto — é a única guarda contra o lockout de usuários não migrados; toda essa guarda hoje é disciplina humana)
- **Tactic violada**: Rollback (pré-condição de mudança de fase); Verifiable preconditions
- **Localização**: `src/backend/jobs/migrate-users-to-supabase.ts:118-132`; `src/backend/http/authEnv.ts:42-48`; `src/backend/routes/auth.ts:36-60`
- **Evidência (objetiva)**:
  ```typescript
  // jobs/migrate-users-to-supabase.ts:118-132  (o "gate" é um log)
  if (restantes > 0) {
      console.warn(
          `[migrate-users] GATE: ${restantes} user(s) still have auth_user_id IS NULL. ` +
              'AUTH_LEGACY_LOGIN_ENABLED=false (rollout Phase 3) MUST NOT be applied until ' +
              'this count reaches zero — those users would be left with no login path at all.',
      );
  }
  ```
  ```
  $ grep -rn "listPendingMigration" src/backend --include="*.ts" | grep -v test
  domain/repository/auth/UserRepository.ts:209:    public listPendingMigration = async ...
  jobs/migrate-users-to-supabase.ts:60:    const pendentes = await repository.listPendingMigration();
  routes/auth.ts:47:  (comentário)  http/authEnv.ts:44,88  (comentários)
  ```
  Único caller de código de produção é o próprio job CLI. O boot do backend (`authEnv.ts:loadAuthEnv()`) valida `AUTH_LEGACY_LOGIN_ENABLED` como enum sintático e aceita `false` sem consultar `app_user`.
- **Impacto técnico**: Operador que setar `AUTH_LEGACY_LOGIN_ENABLED=false` no dashboard Render antes de rodar `job:migrate-users -- --execute` **derruba imediatamente** o login de todos os `app_user` com `auth_user_id IS NULL` — na produção atual (100% das linhas), isso é *todo mundo*. `POST /auth/login` responde 410 Gone (`routes/auth.ts:56`) e o Supabase Auth não conhece o usuário. Zero caminhos de login.
- **Impacto de negócio**: Modo de falha nomeado no `ontology/_inbox/supabase-auth-tasks.md` como *"lockout geral"*. A ADR-0030 §6 declara que o gate **exige** `listPendingMigration()` vazio, mas essa exigência não é executada em lugar nenhum além do log do CLI do job — nada impede uma edição do dashboard sem passar pelo CLI.
- **Métrica de baseline**: 1 gate ideal a implementar; 0 implementados. Instrumentação atual: 1 `console.warn`, 0 checks no boot, 0 mecanismos que consultem `listPendingMigration()` a partir do request handler de login.

### F-deployability-3: `DEPLOY.md` §3 (tabela Vercel) omite as 3 variáveis Supabase que o frontend exige

- **Severidade**: P1 (alto — deploy conforme o operador segue o documento resulta em build/runtime crash na 1ª navegação)
- **Tactic violada**: Script Deployment Commands
- **Localização**: `DEPLOY.md:110-116` (tabela §3) vs `src/frontend/lib/supabase/env.ts:41-53` vs `src/frontend/middleware.ts:1-24`
- **Evidência (objetiva)**:
  ```
  # DEPLOY.md §3 tabela — 3 vars:
  NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DEV_AUTH_BYPASS, NEXT_PUBLIC_ENV

  # src/frontend/lib/supabase/env.ts:41-49 — obrigatórias:
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  ...
  throw new MissingSupabaseEnvError(missing);
  ```
  DEPLOY.md §1 checklist item 8 (linhas 41-42) *menciona* as 3 vars Supabase, mas §3 (a tabela operacional que um deploy operator naturalmente consulta) não as lista. Divergência **dentro do próprio DEPLOY.md**.
- **Impacto técnico**: Deploy do frontend seguindo apenas a tabela §3 sobe uma build que crasha na primeira request de `updateSession` (middleware) — `MissingSupabaseEnvError`. Login é impossível.
- **Impacto de negócio**: A tabela §3 é o artefato mais provável de ser lido primeiro (é a única na seção "Vercel"). Errar aqui significa perder o deploy de Fase 2 e ter que refazer com env vars completas — no meio da janela de cutover.
- **Métrica de baseline**: 3 vars listadas na tabela; 6 vars efetivamente lidas pelo código (as 3 + `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, e a inexistente `NEXT_PUBLIC_AUTH_PROVIDER` da F-1). Divergência: 100% das 3 obrigatórias omitidas.

### F-deployability-4: `.env.example` (backend) descreve arquitetura pré-ADR-0030 — dev novo não sabe que Supabase virou primário

- **Severidade**: P2 (médio — quebra onboarding, não produção; um dev novo produz uma config incoerente)
- **Tactic violada**: Reproducible builds / Script Deployment Commands (drift entre docs e código)
- **Localização**: `src/backend/.env.example` (seção "Legacy Supabase auth (optional, NOT used by the simple login)") vs `src/backend/http/authEnv.ts:11-146`
- **Evidência (objetiva)**:
  ```
  # src/backend/.env.example (linhas na seção "Legacy Supabase auth"):
  # AUTH_JWT_SECRET (or SUPABASE_URL/SUPABASE_JWT_SECRET) is required unless DEV_AUTH_BYPASS=true.
  # --- Legacy Supabase auth (optional, NOT used by the simple login) ---
  # SUPABASE_URL — Supabase project URL (ES256/JWKS). Leave blank.
  SUPABASE_URL=
  # SUPABASE_JWT_SECRET — legacy HS256 fallback, used only if AUTH_JWT_SECRET is unset.
  SUPABASE_JWT_SECRET=

  # authEnv.ts:131-135 — a realidade:
  if (!parsed.DEV_AUTH_BYPASS && !parsed.SUPABASE_URL && !jwtSecret) {
      throw new Error(
          'AUTH_JWT_SECRET (app login HS256) or SUPABASE_URL (JWKS/ES256) or ' +
              'SUPABASE_JWT_SECRET (legacy HS256) is required unless DEV_AUTH_BYPASS=true.',
      );
  }
  ```
  `.env.example` chama Supabase de "Legacy" e "optional, NOT used"; o cutover fez EXATAMENTE o oposto (Supabase é primário; HS256 é legado). Também não menciona `SUPABASE_SERVICE_ROLE_KEY` (obrigatória para Admin API) nem `AUTH_LEGACY_LOGIN_ENABLED`.
- **Impacto técnico**: Dev novo copia `.env.example`, seta `AUTH_JWT_SECRET`, deixa `SUPABASE_URL=` vazia, e o backend funciona **em modo legacy-only** — o que exercita justamente o *outro* caminho da feature. A primeira integração com o frontend novo (que espera cookies GoTrue) quebra sem sinal claro.
- **Impacto de negócio**: Regressão de tempo de setup por dev. Multiplica por quantos devs entrarem no time até a Fase 4.
- **Métrica de baseline**: 4 vars ausentes do `.env.example` que `authEnv.ts` documenta como aceitas: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `AUTH_LEGACY_LOGIN_ENABLED`, `environment` (menção mas sem enfatizar o par com bypass).

### F-deployability-5: CI test-gate está pintando sinal verde falso — 17 testes falham em ambos os lados

- **Severidade**: P1 (alto — o gate declarado como "pre-deploy safety net" no `render.yaml` linhas 12-16 é ilusório se está sendo bypassado ou ignorado)
- **Tactic violada**: Scale Rollouts (o gate que autoriza o rollout está degradado)
- **Localização**: `.github/workflows/ci.yml:27`; `_shared-metrics.md:74-88` (baseline verificado pelo orquestrador)
- **Evidência (objetiva)**:
  ```
  # _shared-metrics.md verificou:
  origin/main:        17 failed, 1.072 passed
  feat/supabase-auth: 17 failed, 1.195 passed
  # (mesmas suítes: routes/recebimentos.e2e{,.falhas,.gates,.retomada}.test.ts)

  # .github/workflows/ci.yml:27
  - run: npm test -- --coverage
  # (sem `continue-on-error`, sem `if:`, sem excludePattern novo)

  # jest.config.cjs:7
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
  # (as 4 suítes vermelhas são .e2e.test.ts, NÃO .integration.test.ts — não são ignoradas)

  # render.yaml:12-16 (comentário no blueprint):
  # "the gate is GitHub branch protection (CI Backend/Frontend checks
  #  required to merge), so only tested code reaches main and gets deployed."
  ```
- **Impacto técnico**: Ou (a) o job "Backend" da CI está vermelho em `main` desde antes desta feature (e branch protection tolera / é bypassada em merges de release), ou (b) o `npm test -- --coverage` retorna exit 0 em ambiente CI mesmo com falhas (improvável — Jest sai 1 em `--coverage` com falhas). Nos dois cenários, a linha *"only tested code reaches main"* do `render.yaml` é falsa. O gate de rollout que autoriza produção não é confiável.
- **Impacto de negócio**: O `render.yaml` declara branch protection como a única defesa entre `git push` e prod. Se ela é ilusória, todo push para `main` (incluindo os que introduzem regressão em auth) chega em prod. Especialmente sério porque o cutover é a próxima release.
- **Métrica de baseline**: 17/1.212 (1.4%) da suíte backend vermelha. Origem: fixtures dependentes de data (`docEspNumero: "06082026"`) — Testability separatista. Aqui o problema é o *sinal* que a Deployability toma como pré-requisito de deploy.

### F-deployability-6: Health-check `/health` não verifica dependências — deploy "verde" pode significar Supabase/DB fora

- **Severidade**: P2 (médio — não é lockout imediato, mas atrasa a detecção de erros de config)
- **Tactic violada**: Deployment observability
- **Localização**: `src/backend/index.ts:70-73`; `render.yaml:22`
- **Evidência (objetiva)**:
  ```typescript
  // index.ts:70-73  — health-check é um constante 200:
  const APP_VERSION = process.env.npm_package_version ?? 'unknown';
  app.get('/health', (_req, res) => res.json({ status: 'ok', version: APP_VERSION }));
  ```
  `healthCheckPath: /health` no `render.yaml`. Render usa isso para decidir se troca o tráfego para a nova build. Um deploy com `SUPABASE_URL` typo, `databaseConnectionString` errada ou JWKS unreachable ainda mostra "healthy" — o primeiro erro só aparece na primeira request autenticada.
- **Impacto técnico**: Render promove a nova build; a primeira request de usuário quebra. Não há rollback automático (Render não faz canary com métrica de erro de aplicação — só health-check). MTTR sobe.
- **Impacto de negócio**: Janela de "sucesso aparente + falha real" durante o cutover. É o modo de falha mais silencioso — todos os semáforos verdes, ninguém logando.
- **Métrica de baseline**: `/health` toca 0 dependências externas. Dependências que deveriam ser tocadas para deep-health: 3 (Postgres via `SELECT 1`, JWKS `/auth/v1/.well-known/jwks.json` reachable, Supabase `SERVICE_ROLE_KEY` válida via `admin.listUsers({perPage:1})`).

### F-deployability-7: 9 pré-requisitos manuais no Supabase (ADR-0030 §10) sem nenhuma verificação automatizada

- **Severidade**: P2 (médio — mesma classe de disciplina humana que a F-2, mas nenhum item individualmente é lockout imediato)
- **Tactic violada**: Verifiable preconditions
- **Localização**: `ontology/decisions/0030-supabase-auth-identity-provider.md:192-207`; `DEPLOY.md:26-43`
- **Evidência (objetiva)**: DEPLOY.md §1 lista os 9 passos como "**Nenhum deles é opcional para produção**". Nenhum é verificado por código — nem no boot, nem no CI, nem por smoke test. Especial atenção ao item 1 (*"Auth → Providers: DESLIGAR o signup público"*): se esquecido, qualquer pessoa na internet obtém JWT válido do projeto, e o fail-closed 403 (`app_user` ausente ⇒ 403) passa a ser a **única** defesa. O próprio DEPLOY.md linha 32 chama isso de *"segunda camada, não a primeira"*.
- **Impacto técnico**: Signup ligado + 403 fail-closed = enumeração de contas via `POST /me` (403 vs. 200 diferencia usuário existente de inexistente). Redirect URLs errados = OAuth flow (invite) quebrado. SMTP não configurado = `convidarUsuario` sempre falha (fallback existe, mas o operador não sabe). Chaves simétricas em vez de ECC P-256 = rotação de chave requer redeploy do backend.
- **Impacto de negócio**: Cutover parece bem-sucedido até um vetor de ataque específico ser exercido (signup público). O modo de descoberta é *externo* (auditoria de segurança ou incidente), não interno.
- **Métrica de baseline**: 9 pré-requisitos manuais; 0 verificados automaticamente.

### F-deployability-8: Divergência de Node entre CI (`24`) e crons de ingestão (`22`)

- **Severidade**: P3 (baixo — build reproducibility; hoje sem sintoma)
- **Tactic violada**: Reproducible builds
- **Localização**: `.tool-versions` (`nodejs 24.0.1`); `.github/workflows/ci.yml:20` (`node-version: '24'`); `.github/workflows/ingest-{permutas,sispag,extratos}.yml` (`node-version: 22`)
- **Evidência (objetiva)**:
  ```
  $ cat .tool-versions
  nodejs 24.0.1
  $ grep node-version .github/workflows/*.yml
  ci.yml:            node-version: '24'
  ingest-extratos.yml:  node-version: 22
  ingest-permutas.yml:  node-version: 22
  ingest-sispag.yml:    node-version: 22
  ```
- **Impacto técnico**: Testes (Node 24) podem estar validando código que se comporta diferentemente nos crons (Node 22). Ex.: mudanças em `Intl`, `Blob`, `crypto` entre 22 e 24. Hoje sem regressão observada, mas o gate `npm test` roda numa versão diferente da execução real dos jobs.
- **Impacto de negócio**: Baixo — enquanto crons rodam, é só divergência semântica; se um dia rodar diferente, ninguém vai desconfiar da versão do runtime.
- **Métrica de baseline**: 1 versão canônica (`.tool-versions`); 2 versões efetivamente usadas na CI (`24` para app, `22` para crons).

### F-deployability-9: `CONEXOS_CRED_ENC_KEY` presente-mas-vazia — Carry-over conhecido

- **Severidade**: P2 (médio — Carry-over documentado; recontextualizado por esta feature)
- **Tactic violada**: Script Deployment Commands (env var declarada sem contramedida de vazio)
- **Localização**: `render.yaml:70-75`; `_shared-metrics.md:155` (Carry-over #2); `DEPLOY.md:75-76`
- **Evidência (objetiva)**: `render.yaml:74` declara `CONEXOS_CRED_ENC_KEY` como `sync: false`; preencher é ato manual no dashboard Render. Se o operador esquecer, o `SecretCipher` fica **silenciosamente** desabilitado e todas as baixas `fin010` saem no usuário-robô, com I-Usuario-5 marcada como cumprida mas inerte. Config presente mas vazia é **pior** que config ausente: passa a impressão de que está configurada. Sem check de arranque que falhe se a chave estiver vazia.
- **Impacto técnico**: Modo de falha silencioso na trilha de auditoria da baixa; sem erro, sem log, sem alarme. A ADR-0030 §11 registra isso como consequência aceita, mas não fecha o gap.
- **Impacto de negócio**: A auditoria da Columbia perde granularidade — todas as baixas parecem ter sido feitas pelo robô, não pelo analista que as executou. Registrado como aceito no estado atual; a feature de auth **acentua** o problema porque introduz o vínculo por usuário sem endurecer a checagem da chave.
- **Métrica de baseline**: 1 env var essencial com falha silenciosa em caso de vazio; 0 checks no boot.

## 5. Cards Kanban

### [deployability-1] Implementar o rollback documentado da Fase 2 no frontend (ler `NEXT_PUBLIC_AUTH_PROVIDER`)

- **Problema**
  > O ADR-0030 §6 e o `DEPLOY.md` linha 140 declaram que o rollback da Fase 2 é *"uma variável de ambiente na Vercel, sem redeploy do backend"* (mudar `NEXT_PUBLIC_AUTH_PROVIDER` de `supabase` para `legacy`). O código do frontend NÃO lê essa variável em lugar nenhum: `AuthProvider.tsx:169` chama `supabase.auth.signInWithPassword` incondicionalmente. Em uma janela de incidente, o operador vai tentar o rollback documentado e ele será um no-op.

- **Melhoria Proposta**
  > (a) Implementar de fato o switch: `AuthProvider.signIn` deve inspecionar `process.env.NEXT_PUBLIC_AUTH_PROVIDER` — `supabase` (default) chama GoTrue; `legacy` posta em `POST /auth/login` (que o backend já aceita via dual-mode, F-2 desta seção); `middleware.ts` e `RouteGate` seguem o mesmo interruptor. Testes de integração para ambos os ramos. **OU** (b) admitir a verdade e reescrever a ADR-0030 §6 e o DEPLOY.md: *"rollback da Fase 2 é promover deployment Vercel anterior (não é env var)."* Documentar o passo a passo no dashboard Vercel + validar que existe um deployment "pré-feat/supabase-auth" congelado como rollback target.

- **Resultado Esperado**
  > O rollback declarado da Fase 2 funciona no primeiro toggle, sem redeploy. Métrica: 1 grep por `NEXT_PUBLIC_AUTH_PROVIDER` em `src/frontend` retorna ≥ 1 hit em código de produção (não `.env.example`). Alternativa (b): 0 grep, mas a documentação passa a listar "Vercel → Deployments → Promote" como o passo real, e um deployment de rollback é marcado explicitamente como *pinned*.

- **Tactic alvo**: Rollback
- **Severidade**: P0
- **Esforço estimado**: S (rota (b) — 2h) ou M (rota (a) — 2 dias com testes)
- **Findings relacionados**: F-deployability-1
- **Métricas de sucesso**:
  - Grep por `NEXT_PUBLIC_AUTH_PROVIDER` no código do FE: 0 → ≥ 1 (rota a) OU documentação atualizada (rota b)
  - Exercício de rollback em staging: falhas silenciosas 100% → 0
- **Risco de não fazer**: Cutover para Fase 2 em produção com um botão de emergência que não funciona. Se o cutover falhar, o time gasta minutos ou horas descobrindo por que "a env var não voltou a legacy" — enquanto ninguém consegue logar.
- **Dependências**: nenhuma

### [deployability-2] Enforçar o gate da Fase 3 (`AUTH_LEGACY_LOGIN_ENABLED=false` bloqueado enquanto houver pendentes)

- **Problema**
  > Desligar `AUTH_LEGACY_LOGIN_ENABLED` enquanto existir `app_user` com `auth_user_id IS NULL` deixa esse usuário sem NENHUM caminho de login (rota `/auth/login` responde 410; o Supabase não conhece o usuário). A única defesa hoje é um `console.warn` no CLI do job `migrate-users` — o operador pode simplesmente editar o dashboard Render sem rodar o job.

- **Melhoria Proposta**
  > Adicionar check no boot do backend: se `AUTH_LEGACY_LOGIN_ENABLED=false` e `SELECT COUNT(*) FROM app_user WHERE auth_user_id IS NULL AND ativo = true` > 0, o `bootstrapAppContainer` DEVE FALHAR (`process.exit(1)` com mensagem clara) — a health-check do Render impede a promoção. Alternativa mais permissiva: `POST /auth/login` degrada para "aceita legado mesmo com flag off, mas emite alarme" enquanto houver pendentes ativos. A ADR-0030 já pede *"transformar `listPendingMigration()` num gate, não num relatório"* (linha 141) — este card é a implementação dessa asserção.

- **Resultado Esperado**
  > É impossível colocar o sistema em estado de lockout via toggle de dashboard: o boot recusa a config incoerente. Métrica: cenário "flag=false com pendentes" → hoje: promove e derruba login; alvo: boot falha com mensagem `PHASE3_GATE_OPEN=false: N users still pending migration`.

- **Tactic alvo**: Rollback (pré-condição) / Verifiable preconditions
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1 dia — 1 query, 1 check no `bootstrapAppContainer`, 1 teste)
- **Findings relacionados**: F-deployability-2
- **Métricas de sucesso**:
  - Cenário "flag=false com pendentes" → falha no boot (100% dos casos)
  - Instrumentação: 1 `console.warn` (hoje) → 1 fail-fast no `bootstrapAppContainer`
- **Risco de não fazer**: Modo de falha explicitamente nomeado na ontologia (*"lockout geral"*) fica desprotegido; depende de disciplina em uma janela de alta pressão.
- **Dependências**: depende de `initDatabaseAndMigrate` já ter rodado (garantido pelo `bootstrapAppContainer` — ok)

### [deployability-3] Completar o `DEPLOY.md` §3 (Vercel) com as 3 vars Supabase reais

- **Problema**
  > A tabela §3 do `DEPLOY.md` lista apenas `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DEV_AUTH_BYPASS`, `NEXT_PUBLIC_ENV`. Faltam `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (obrigatórias — `MissingSupabaseEnvError`) e `NEXT_PUBLIC_AUTH_PROVIDER` (rollback da Fase 2 — ver deployability-1). Um deploy de FE seguindo a tabela §3 crasha na primeira request de middleware.

- **Melhoria Proposta**
  > Reescrever a tabela §3 do `DEPLOY.md` incluindo as 3 vars faltantes e marcando-as como **obrigatórias**. Sincronizar com o checklist §1 (que já as menciona) e com `.env.example` do frontend. Adicionar um teste de contrato (talvez em `readSupabasePublicEnv`) que lista as vars num único ponto e alimenta a doc via `#include` no build.

- **Resultado Esperado**
  > Zero divergência entre tabela `DEPLOY.md §3`, `.env.example` do frontend e `src/frontend/lib/supabase/env.ts`. Um dev que copia a tabela §3 obtém uma build FE que sobe.

- **Tactic alvo**: Script Deployment Commands
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-deployability-3
- **Métricas de sucesso**:
  - Vars listadas em `DEPLOY.md §3`: 3 → 6
  - Divergência tabela vs código: 100% → 0%
- **Risco de não fazer**: Deploy de Fase 2 num sábado à noite, seguindo a tabela, gasta 15 min descobrindo `MissingSupabaseEnvError` no log da Vercel.
- **Dependências**: se deployability-1 escolher rota (b), remove `NEXT_PUBLIC_AUTH_PROVIDER` da tabela (a var some do sistema).

### [deployability-4] Alinhar `.env.example` (backend) com a arquitetura pós-ADR-0030

- **Problema**
  > O `.env.example` do backend descreve a arquitetura pré-cutover (`AUTH_JWT_SECRET` como caminho principal; Supabase como *"Legacy … NOT used"*). Não menciona `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `AUTH_LEGACY_LOGIN_ENABLED`. Um dev novo termina rodando o backend em modo apenas-HS256, sem falar com o GoTrue — cenário que a Fase 4 vai remover.

- **Melhoria Proposta**
  > Reescrever a seção auth do `.env.example` do backend. Nova ordem lógica: (1) `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (obrigatórios em prod); (2) `AUTH_LEGACY_LOGIN_ENABLED` (com nota "some na Fase 4"); (3) `AUTH_JWT_SECRET` claramente marcado como *"legacy do rollout, será removido na Fase 4"*. Documentar o pre-req do GoTrue em uma frase curta com link para o `DEPLOY.md`.

- **Resultado Esperado**
  > Onboarding não produz configs incoerentes. Métrica: comparar as vars documentadas em `.env.example` com as que `authEnv.ts` aceita — divergência de 4 vars → 0.

- **Tactic alvo**: Reproducible builds / Script Deployment Commands
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1h)
- **Findings relacionados**: F-deployability-4
- **Métricas de sucesso**:
  - Vars auth documentadas em `.env.example` alinhadas com `authEnv.ts`: 4 divergências → 0
- **Risco de não fazer**: Regressão de tempo de setup por dev; cada novo dev descobre a ADR-0030 por trial and error.
- **Dependências**: nenhuma

### [deployability-5] Auditar o gate de CI vs. as 17 falhas de teste em `main`

- **Problema**
  > O baseline do `_shared-metrics.md` confirma que 17 testes de Frente IV falham em `origin/main` e no branch da feature (`recebimentos.e2e{,.falhas,.gates,.retomada}.test.ts`). O `render.yaml:12-16` afirma que branch protection (CI required checks) é o gate entre push e produção. Se `npm test -- --coverage` está saindo 1 e o merge ainda acontece, o gate é ilusório; se está saindo 0, alguém alterou a suíte para tolerar as falhas sem excludePattern. Nos dois cenários, o sinal que autoriza deploy não é confiável.

- **Melhoria Proposta**
  > Investigar (1) exit code real do `npm test -- --coverage` na CI atual em `main` (rodar `gh run list --workflow=ci.yml --branch=main --limit=5` e ler os últimos runs); (2) settings de branch protection: `required checks` inclui `Backend`? há `Allow administrators to bypass`? Se as falhas são de fixture-por-data (Testability já cobre), estabilizar as suítes por congelamento de relógio (`jest.useFakeTimers({now: '2026-08-06T00:00:00Z'})`) — desbloqueia o gate de deploy. **Este card não corrige o teste** (isso é Testability); ele restabelece a confiança no *sinal* que autoriza rollout.

- **Resultado Esperado**
  > CI da branch `main` verde com 100% dos testes passando (ou com exclusão explícita e documentada). O `render.yaml:12-16` deixa de ser aspiracional.

- **Tactic alvo**: Scale Rollouts (o gate de qualidade que autoriza rollout)
- **Severidade**: P1
- **Esforço estimado**: S para investigar (≤ 1 dia); M para consertar as fixtures data-dependentes (2-5 dias)
- **Findings relacionados**: F-deployability-5
- **Métricas de sucesso**:
  - Testes vermelhos em `main`: 17 → 0
  - Runs de CI `main` verdes na última semana: (a investigar) → 100%
- **Risco de não fazer**: Qualquer regressão futura fica indistinguível do baseline vermelho — CI perde valor como sinal.
- **Dependências**: cross-QA — Testability já vai levantar as falhas em si; este card é sobre o **efeito de deploy** do sinal ruidoso.

### [deployability-6] Deep health-check + smoke test pós-deploy

- **Problema**
  > `/health` responde `{status:'ok'}` sem tocar em Postgres, JWKS ou GoTrue. Render usa isso para trocar o tráfego. Um deploy com `SUPABASE_URL` errada, `databaseConnectionString` inválida ou signup público ligado passa como "healthy" — o primeiro erro só aparece na 1ª request autenticada. Não há job pós-deploy que faça um login sintético.

- **Melhoria Proposta**
  > Adicionar `GET /health/deep` (não usado pelo Render — ele continua no `/health` raso, para não abrir 5xx em transientes) que retorna 200 se e somente se: (1) `SELECT 1` no Postgres; (2) fetch de `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` retorna 200; (3) `supabaseAdmin.listUsers({perPage:1})` retorna 200 (valida `SERVICE_ROLE_KEY`). Adicionar workflow `.github/workflows/post-deploy-smoke.yml` disparado por `deployment_status` = success, que faz `curl -f https://<backend>.onrender.com/health/deep` + um `signInWithPassword` sintético com uma conta de teste dedicada (credencial em GitHub Secrets). Falha aciona alerta manual + rollback via `git revert`.

- **Resultado Esperado**
  > Sinal de deploy passa de "processo Node subiu" para "cadeia de identidade + banco + provedor estão coerentes". Métrica: janela entre deploy verde e primeira falha de auth reportada por usuário → hoje: minutos-horas; alvo: segundos após o smoke test.

- **Tactic alvo**: Deployment observability
- **Severidade**: P2
- **Esforço estimado**: M (2-3 dias — endpoint, workflow, conta de teste)
- **Findings relacionados**: F-deployability-6, F-deployability-7
- **Métricas de sucesso**:
  - Dependências verificadas no deploy: 0 → 3
  - Presença de smoke test pós-deploy: ausente → presente
- **Risco de não fazer**: Cutover de Fase 2 passa com semáforo verde e usuários não conseguem logar; MTTR sobe pelo tempo de diagnóstico.
- **Dependências**: exige uma conta de teste dedicada no GoTrue de produção (item extra para o ADR-0030 §10).

### [deployability-7] Automatizar verificação dos pré-requisitos Supabase (ADR-0030 §10)

- **Problema**
  > 9 pré-requisitos manuais no painel Supabase, cada um marcado como *"não opcional para produção"*. Nenhum é verificado por código. O item 1 (signup público off) é o mais crítico: se esquecido, qualquer pessoa obtém JWT válido e o fail-closed 403 vira única defesa.

- **Melhoria Proposta**
  > Estender `/health/deep` (deployability-6) OU um comando one-shot (`npm run verify:supabase`) que verifique automaticamente pelo menos: (a) signup público desligado (`POST ${SUPABASE_URL}/auth/v1/signup` sem `service_role` retorna 422/403 em vez de 200); (b) redirect URLs contêm o domínio Vercel de produção (via Admin API `admin/config`); (c) `SUPABASE_URL` corresponde ao `iss` de um token de teste. Os itens não-verificáveis via API (templates PT-BR, SMTP custom) ganham um checkbox no PR template de release + assinatura do operador na descrição do release.

- **Resultado Esperado**
  > Pré-requisitos verificáveis por API deixam de ser disciplina humana. Métrica: 3 dos 9 itens (§10.1, §10.3, §10.9) passam a ter check automatizado.

- **Tactic alvo**: Verifiable preconditions
- **Severidade**: P2
- **Esforço estimado**: M (2-4 dias)
- **Findings relacionados**: F-deployability-7
- **Métricas de sucesso**:
  - Pré-requisitos automatizados: 0/9 → ≥ 3/9
- **Risco de não fazer**: Descoberta de item 1 (signup on) é externa (auditoria/incidente).
- **Dependências**: parcialmente sobreposto com deployability-6 (mesmo endpoint).

### [deployability-8] Fechar o gap de `CONEXOS_CRED_ENC_KEY` presente-mas-vazia (Carry-over)

- **Problema**
  > `render.yaml:74` declara `CONEXOS_CRED_ENC_KEY` como `sync: false`, mas se o operador esquecer de preenchê-la no dashboard, o backend sobe, o `SecretCipher` fica silenciosamente desabilitado e toda baixa `fin010` sai como robô — sem erro, sem log, sem alarme. Config presente-mas-vazia dá impressão de configurada. **Carry-over pré-existente** — não é regressão desta feature, mas a ADR-0030 aponta explicitamente o gap em §10.7 e §11 sem fechá-lo, e a introdução de `SupabaseAdminClient` + vínculo por usuário torna a inércia da invariante I-Usuario-5 mais visível.

- **Melhoria Proposta**
  > No `bootstrapAppContainer` (ou no `SecretCipher.init`), se `environment=production` e `CONEXOS_CRED_ENC_KEY` estiver ausente ou não decodificar como 32 bytes base64, o boot deve FALHAR com mensagem clara — em vez de degradar para robô-only silenciosamente. Alternativa mais suave: emitir um `console.warn` **muito ruidoso** a cada request de baixa `fin010` que caia no robô, para forçar a descoberta.

- **Resultado Esperado**
  > `CONEXOS_CRED_ENC_KEY` inválida em prod deixa de subir. Métrica: chance de I-Usuario-5 inerte em prod → hoje: alta (silenciosa); alvo: 0 (boot falha).

- **Tactic alvo**: Script Deployment Commands (env var essencial sem contramedida de vazio)
- **Severidade**: P2 (Carry-over)
- **Esforço estimado**: S (≤ 1 dia)
- **Findings relacionados**: F-deployability-9
- **Métricas de sucesso**:
  - Boot em produção com chave ausente/vazia: sobe silenciosamente → falha loud
- **Risco de não fazer**: Trilha de auditoria da baixa continua atribuindo tudo ao robô em produção; auditoria interna da Columbia perde granularidade.
- **Dependências**: Carry-over (docs/regis-review anteriores). O consolidator deve preservar o histórico do achado.

## 6. Notas do agente

- **Cross-QA (para o consolidator):**
  - F-deployability-5 (CI vermelha) e as 17 falhas de teste de Frente IV são **primariamente** achado de **Testability** (fixtures dependentes de data). Reportei aqui apenas o efeito de deploy: o gate `render.yaml:12-16` conta com o CI como sinal e o sinal é ruidoso. Coordinar dedupe com Testability.
  - F-deployability-6 (deep health) e F-deployability-7 (pré-requisitos Supabase) tangenciam **Availability** (MTTR/MTTA) e **Security** (signup público off) — os cards `deployability-6` e `deployability-7` provavelmente serão consolidados/priorizados com o cardset dessas seções.
  - F-deployability-1 (rollback frontend fictício) tangencia **Modifiability** — a ADR-0030 declara um mecanismo que o código não instancia; sinaliza drift entre ontologia/documentação e implementação.
- **Métricas que tentei e não consegui medir localmente:** MTTR de rollback (nunca exercitado — sem staging Render/Vercel/Supabase); tempo entre `git push origin main` e traffic-switch no Render (dado próprio do Render, não observável no repo).
- **Escopo:** não gerei card para *"migrar para Lambda/IaC"* — é dívida de template aceita (per shared-metrics §"Leia antes de medir"). Considerei o stack real (Render + Vercel + Supabase + GH Actions) como o sistema sob revisão.
- **Nota sobre F-deployability-1:** verificado por três buscas independentes (`grep NEXT_PUBLIC_AUTH_PROVIDER`, `grep authProvider`, leitura completa de `AuthProvider.tsx` e `login/page.tsx`). É P0 porque o rollback foi declarado como "sem redeploy" e é justo esse tipo de mecanismo que uma janela de incidente **exercita primeiro**.
