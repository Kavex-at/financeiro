# Deploy — Columbia Financeiro

Stack de deploy: **Supabase** (Postgres) + **Render** (backend Express) + **Vercel** (frontend Next.js).
O auth é um **login simples usuário/senha** — o backend valida a senha (bcrypt) contra a tabela
`app_user` e assina um JWT HS256 próprio (`AUTH_JWT_SECRET`). Sem Supabase Auth / OAuth.

---

## 1. Supabase (banco de dados)

1. Crie (ou use) um projeto Supabase.
2. Em **Project Settings → Database → Connection string**, copie a string do **Session pooler**
   (porta `5432`, modo *session*). Esse é o valor de `databaseConnectionString`.
   - Exemplo: `postgresql://postgres.<ref>:<senha>@aws-0-<region>.pooler.supabase.com:5432/postgres`
3. Não é preciso configurar Supabase Auth — só o Postgres é usado.

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
| Pre-Deploy Command | `npm run migrate && npm run seed:admin` |

> O Pre-Deploy roda as migrations (cria `app_user` etc.) e semeia o admin ANTES de servir tráfego.

### Variáveis de ambiente (Render → Environment)

| Var | Valor / observação |
|-----|--------------------|
| `databaseConnectionString` | string do Session pooler do Supabase (passo 1) |
| `CONEXOS_BASE_URL` | `https://columbiatrading.conexos.cloud/api` |
| `CONEXOS_USERNAME` | usuário Conexos |
| `CONEXOS_PASSWORD` | senha Conexos |
| `CONEXOS_FIL_COD` | filial padrão (ex.: `2`) |
| `AUTH_JWT_SECRET` | **gerar forte** — ver abaixo. Assina/valida os tokens de login |
| `ADMIN_USERNAME` | `admin` (ou outro) |
| `ADMIN_PASSWORD` | **senha forte** — credencial inicial do admin |
| `ALLOWED_ORIGINS` | `https://<app>.vercel.app` (domínio do frontend na Vercel) |
| `DEV_AUTH_BYPASS` | `false` |
| `environment` | `production` |
| `client_name` | `local` (faz o `EnvironmentProvider` ler do ENV, não do SSM/AWS) |
| `SISPAG_ENABLED` | `true|false` — liga/desliga a Frente II (SISPAG). **Fail-safe:** sem a var, fica **bloqueada em produção** e habilitada fora de prod. |
| `RECEBIMENTOS_ENABLED` | **KILL-SWITCH** da Frente IV (Recebimentos / "Gestão de Adiantamentos"), liberada em produção desde a v0.20.0 (ADR-0028). Ao contrário do SISPAG **não é fail-safe**: sem a var a frente fica **habilitada**. Só `false` desliga (rotas `/recebimentos/*` → 403), e vale sem redeploy. |
| `APROVACOES_ENABLED` | **Gate da Frente V** (Workflow de Aprovação), ADR-0038. **Fail-safe** como o SISPAG e ao contrário da Frente IV: sem a var fica **bloqueada em produção** e habilitada fora. Ligar a estreia exige `true` explícito; `false` é o kill-switch. Vale sem redeploy (`sync:false`). Ver `docs/runbooks/frente-v-primeira-ingestao.md`. |
| `CONEXOS_EXTRATO_SYNC_START_DATE` | *(opcional)* `YYYY-MM-DD` — **piso** da janela de ingestão do extrato; default `2026-08-03`. Nenhum caminho de sincronização (cron horário, `DIAS=`, `POST /recebimentos/ingestao`) lê lançamento anterior a esta data. |
| `RECEBIMENTO_INGEST_DIAS` | *(opcional)* janela default da ingestão, em dias; default `90`. A janela efetiva é a **interseção** com o piso acima. |
| `RECEBIMENTO_INGEST_FIL_CODS` | *(opcional)* CSV de filiais a ingerir (ex.: `1,2`). Vazio/ausente = todas as filiais que o ERP devolver. |

Gerar o `AUTH_JWT_SECRET`:

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

---

## 4. Checklist de operador (passos manuais)

1. **Gerar `AUTH_JWT_SECRET`** (`openssl rand -base64 48`) e colar no Render.
2. **Definir `ADMIN_PASSWORD`** forte no Render (a credencial inicial do admin).
3. **Setar `databaseConnectionString`** (Session pooler do Supabase) no Render.
4. **Setar credenciais Conexos** (`CONEXOS_*`) no Render.
5. Após o primeiro deploy do frontend, **copiar o domínio Vercel** e colocá-lo em
   `ALLOWED_ORIGINS` no Render; e **copiar a URL do Render** para `NEXT_PUBLIC_API_URL` na Vercel.
6. Confirmar que o Pre-Deploy do Render rodou `migrate` + `seed:admin` (logs do deploy).
7. Acessar `https://<app>.vercel.app/login` e entrar com `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

> Para trocar a senha do admin depois, ajuste `ADMIN_PASSWORD` e re-rode `npm run seed:admin`
> (UPSERT idempotente por `username`). Novos usuários: insira em `app_user` com hash bcrypt.
