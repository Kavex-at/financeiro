# Deploy — Columbia Financeiro

Stack de deploy: **Supabase** (Postgres + **Auth/GoTrue**) + **Render** (backend Express) +
**Vercel** (frontend Next.js).

**Identidade e autorização são camadas separadas** (ADR-0030):

- **Identidade** — o **Supabase Auth (GoTrue)** custodia a credencial e emite o JWT (ES256,
  verificado por JWKS). O `sub` do token é um UUID interno; ele **nunca** é exibido nem gravado
  na trilha de auditoria.
- **Autorização** — resolvida do **banco a cada request**: `SELECT role, ativo, username FROM
  app_user WHERE auth_user_id = $sub`. Sem linha, ou com `ativo = false`, a request morre em
  **403** (fail-closed). É isto que faz `desativarUsuario` valer em ≤ 30 s, sem esperar o token
  expirar.
- **Login legado (HS256, `AUTH_JWT_SECRET`)** continua aceito **durante o rollout**, atrás de
  `AUTH_LEGACY_LOGIN_ENABLED`. É o botão de rollback das fases 2–3, e some na Fase 4.

---

## 1. Supabase (banco de dados)

1. Crie (ou use) um projeto Supabase.
2. Em **Project Settings → Database → Connection string**, copie a string do **Session pooler**
   (porta `5432`, modo *session*). Esse é o valor de `databaseConnectionString`.
   - Exemplo: `postgresql://postgres.<ref>:<senha>@aws-0-<region>.pooler.supabase.com:5432/postgres`
3. **Configurar o Supabase Auth (GoTrue)** — 9 passos humanos, todos no painel do projeto
   (ADR-0030 §10). Nenhum deles é opcional para produção:

   1. **Auth → Providers: DESLIGAR o signup público.** Sem isso, qualquer pessoa na internet
      obtém um JWT válido deste projeto. O 403 fail-closed do backend é a **segunda** camada,
      não a primeira.
   2. **Auth → SMTP customizado.** O sender embutido é limitado a poucos e-mails/hora. Bloqueia
      o convite e a recuperação de senha — **não** bloqueia o cadastro com senha (o fallback).
   3. **Auth → URL Configuration:** Site URL e Redirect URLs (domínio Vercel + `localhost:3000`).
   4. **Auth → Email templates** em PT-BR (convite e recuperação).
   5. **Auth → JWT Keys:** migrar para chaves assimétricas (ECC P-256), mantendo o segredo
      legado enquanto o rollout durar.
   6. **Auth → Sessions:** TTL do access token e rotação de refresh com *reuse detection*.
   7. **Render:** as variáveis novas da seção 2 (`SUPABASE_*`, `AUTH_LEGACY_LOGIN_ENABLED` e
      **`CONEXOS_CRED_ENC_KEY`**).
   8. **Vercel:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
      `NEXT_PUBLIC_AUTH_PROVIDER`.
   9. Confirmar que o schema `auth` **não** está exposto via PostgREST.

As tabelas são criadas pelas migrations (`npm run migrate`), incluindo `app_user`
(`migrations/0007_app_user.sql`). O usuário admin é criado por `npm run seed:admin`.

---

## 2. Render (backend — `src/backend`)

Crie um **Web Service** apontando para o repositório.

| Campo | Valor |
|-------|-------|
| Root Directory | `src/backend` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |

> **As migrations rodam no BOOT**, dentro do próprio processo que vai servir tráfego, antes do
> `listen()` (`migrations/BootMigrator.ts`). Não há passo de pre-deploy: o serviço do Render foi
> configurado pelo dashboard, não pelo Blueprint, e `preDeployCommand` é recurso de plano pago —
> **ele nunca rodou**. Migração que falha mata o boot com exit 1 e o Render mantém a versão
> anterior no ar.
>
> ⚠️ **O `seed:admin` NÃO foi movido para o boot — ele é MANUAL**, pelo shell do Render
> (`npm run seed:admin`). Ver a seção 4.

### Variáveis de ambiente (Render → Environment)

| Var | Valor / observação |
|-----|--------------------|
| `databaseConnectionString` | string do Session pooler do Supabase (passo 1) |
| `CONEXOS_BASE_URL` | `https://columbiatrading.conexos.cloud/api` |
| `CONEXOS_USERNAME` | usuário Conexos |
| `CONEXOS_PASSWORD` | senha Conexos |
| `CONEXOS_FIL_COD` | filial padrão (ex.: `2`) |
| `SUPABASE_URL` | `https://<ref>.supabase.co` — habilita a verificação ES256 por JWKS e o issuer |
| `SUPABASE_SERVICE_ROLE_KEY` | chave da Admin API do GoTrue (convite, cadastro, ban, reset). **IGNORA RLS** — só no backend, **nunca** `NEXT_PUBLIC_*`. `sync: false` |
| `AUTH_LEGACY_LOGIN_ENABLED` | `true` durante o rollout (default). `false` desliga `POST /auth/login` — **só depois** de `npm run job:migrate-users -- --execute` reportar zero pendentes |
| `CONEXOS_CRED_ENC_KEY` | chave-mestra (base64, 32 bytes) do vínculo Conexos por usuário. **Gap pré-existente:** sem ela `SecretCipher` fica desabilitado e **tudo cai no usuário-robô** em produção |
| `AUTH_JWT_SECRET` | **LEGADO DO ROLLOUT** — assina/valida os tokens HS256 do login antigo. Removível na Fase 4, junto com `AUTH_LEGACY_LOGIN_ENABLED` e `password_hash` |
| `ADMIN_USERNAME` | **um e-mail real** (ex.: `financeiro@columbiatrading.com.br`). ⚠️ **NÃO use `admin`:** o `seed:admin` cria a conta no GoTrue com `email: ADMIN_USERNAME`, e o GoTrue **valida formato de e-mail** — qualquer valor sem `@` faz o job falhar. Ver seção 6 do runbook de cutover |
| `ADMIN_PASSWORD` | **senha forte** — credencial inicial do admin |
| `ALLOWED_ORIGINS` | `https://<app>.vercel.app` (domínio do frontend na Vercel) |
| `DEV_AUTH_BYPASS` | `false` |
| `environment` | `production` |
| `client_name` | `local` (faz o `EnvironmentProvider` ler do ENV, não do SSM/AWS) |
| `SISPAG_ENABLED` | `true|false` — liga/desliga a Frente II (SISPAG). **Fail-safe:** sem a var, fica **bloqueada em produção** e habilitada fora de prod. |
| `RECEBIMENTOS_ENABLED` | **KILL-SWITCH** da Frente IV (Recebimentos / "Gestão de Adiantamentos"), liberada em produção desde a v0.20.0 (ADR-0028). Ao contrário do SISPAG **não é fail-safe**: sem a var a frente fica **habilitada**. Só `false` desliga (rotas `/recebimentos/*` → 403), e vale sem redeploy. |
| `CONEXOS_EXTRATO_SYNC_START_DATE` | *(opcional)* `YYYY-MM-DD` — **piso** da janela de ingestão do extrato; default `2026-08-03`. Nenhum caminho de sincronização (cron horário, `DIAS=`, `POST /recebimentos/ingestao`) lê lançamento anterior a esta data. |
| `RECEBIMENTO_INGEST_DIAS` | *(opcional)* janela default da ingestão, em dias; default `90`. A janela efetiva é a **interseção** com o piso acima. |
| `RECEBIMENTO_INGEST_FIL_CODS` | *(opcional)* CSV de filiais a ingerir (ex.: `1,2`). Vazio/ausente = todas as filiais que o ERP devolver. |

Gerar o `AUTH_JWT_SECRET` (**passo de ROLLOUT** — deixa de ser necessário na Fase 4, quando o
HS256 sai):

```bash
openssl rand -base64 48
```

> **Importante (CORS):** `ALLOWED_ORIGINS` PRECISA conter o domínio exato do frontend na Vercel,
> senão o browser bloqueia as chamadas. Para múltiplos domínios, separe por vírgula.

---

## 3. Vercel (frontend — `src/frontend`)

Importe o repositório como um projeto Vercel.

| Campo | Valor |
|-------|-------|
| Root Directory | `src/frontend` |
| Framework Preset | Next.js (auto-detectado) |

### Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Var | Valor |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://<backend>.onrender.com` (URL do serviço Render) |
| `NEXT_PUBLIC_DEV_AUTH_BYPASS` | `false` |
| `NEXT_PUBLIC_ENV` | `production` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co`. Sem ela o app lança `MissingSupabaseEnvError` no primeiro login |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave `anon` do projeto. **Publicável por desenho** — o que protege é o RLS, não o segredo. **Nunca** a `service_role` aqui |
| `NEXT_PUBLIC_AUTH_PROVIDER` | `legacy` **antes do merge**, `supabase` no flip da Fase 2. O default do código é `supabase` — ver o aviso abaixo |

> ⚠️ **`NEXT_PUBLIC_AUTH_PROVIDER` é inlinada em BUILD TIME.** O Next substitui `process.env.NEXT_PUBLIC_*`
> durante o build, então **mudar o valor no painel da Vercel não faz nada até um novo deploy**. O
> rollback rápido da Fase 2 é o **instant rollback da Vercel** para o deployment anterior (aquele que
> já tem `legacy` inlinado), não a troca da variável.
>
> ⚠️ **O default de `getAuthProvider()` é `supabase`.** Se o PR for mergeado sem esta variável setada
> como `legacy`, a Vercel faz auto-deploy e **o cutover acontece sozinho**, com zero usuários migrados.
> Setar ANTES de mergear.

---

## 4. Checklist de operador (passos manuais)

1. **Gerar `AUTH_JWT_SECRET`** (`openssl rand -base64 48`) e colar no Render — **passo de
   rollout**, removível na Fase 4.
2. **Definir `ADMIN_PASSWORD`** forte no Render. **Obrigatório:** o `seed:admin` não tem mais
   default hardcoded e **falha com exit 1** sem ele (uma senha em código-fonte é uma senha
   pública — ADR-0030 §9).
3. **Setar `databaseConnectionString`** (Session pooler do Supabase) no Render.
4. **Setar credenciais Conexos** (`CONEXOS_*`) no Render.
5. Após o primeiro deploy do frontend, **copiar o domínio Vercel** e colocá-lo em
   `ALLOWED_ORIGINS` no Render; e **copiar a URL do Render** para `NEXT_PUBLIC_API_URL` na Vercel.
6. Confirmar nos **logs do deploy** que as migrations aplicaram no boot — procurar
   `[boot-migrate] aplicada(s) …` ou `[boot-migrate] esquema em dia`. **Não** existe passo de
   pre-deploy (ver seção 2).
7. **Rodar `npm run seed:admin` à mão**, pelo shell do Render. Ele cria a conta **no GoTrue** e
   grava o `auth_user_id` na linha local. Exige `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` já
   setadas, e um `ADMIN_USERNAME` em **formato de e-mail**. Idempotente; se imprimir
   `ADMIN_ALREADY_IN_GOTRUE`, **pare e resolva à mão**.
8. Acessar `https://<app>.vercel.app/login` e entrar com `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

> **Cutover de identidade:** o procedimento completo, faseado, com matriz de rollback e sinais de
> problema, está em [`docs/runbooks/supabase-auth-cutover.md`](docs/runbooks/supabase-auth-cutover.md).
> **A ordem dos passos é o conteúdo** — não improvise a partir só desta seção.

### Rollout da identidade (ADR-0030 §6)

| Fase | Backend | Frontend | Rollback |
|---|---|---|---|
| 1 | migrations `0047`/`0048` + `appUserContext` + import dos hashes bcrypt | inalterado | reverter deploy |
| 2 | aceita **ambos** os tokens (HS256 legado + ES256 Supabase) | `NEXT_PUBLIC_AUTH_PROVIDER=supabase` | voltar a flag para `legacy` |
| 3 | `AUTH_LEGACY_LOGIN_ENABLED=false` | — | religar a flag |
| 4 | remover HS256, `password_hash`, `AuthService` | — | — |

```bash
npm run job:migrate-users                 # DRY-RUN (default) — só relata
npm run job:migrate-users -- --execute    # migra de verdade
```

> ⚠️ **GATE da Fase 3.** Desligar `AUTH_LEGACY_LOGIN_ENABLED` enquanto existir `app_user` com
> `auth_user_id IS NULL` deixa esse usuário **sem nenhum caminho de login**: o legado está
> desligado e ele não existe no provedor. O job imprime `GATE OPEN` quando a lista zera — só
> então a fase pode virar.
>
> ⚠️ O import do hash bcrypt tem um modo de falha **silencioso**: o hash é aceito mas não
> confere, e ninguém descobre até o primeiro login. **Validar numa conta de teste antes de
> rodar em todo mundo.**

> Para trocar a senha do admin depois, ajuste `ADMIN_PASSWORD` e re-rode `npm run seed:admin`
> (UPSERT idempotente por `username`). Novos usuários: pela tela `/usuarios` — convite por
> e-mail (padrão) ou cadastro com senha (fallback sem SMTP).
