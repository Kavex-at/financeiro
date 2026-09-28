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
(`migrations/0007_app_user.sql`) e os papéis/permissões (`migrations/0066_auth_permissoes_modulo.sql`,
ver seção 5). O usuário admin é criado por `npm run seed:admin`, já com o papel `Administrador`.

### Budget de sessões do pooler

Cada processo que fala com o Postgres abre seu próprio pool. O teto do Supavisor é **por projeto**,
não por processo — então o que importa é a soma, e ela cresce a cada cron novo, silenciosamente.

Registrado aqui porque o primeiro sintoma de saturação é 5xx mascarado por retry, que foi
exatamente o que escondeu o vazamento de pool corrigido na v0.34.1 (o handler de `error` tratava
`too many clients` como transitório e, ao descartar o pool sem encerrá-lo, abria mais conexões).

| Processo | Pools | `max` por pool | Sessões no pico |
|---|---:|---:|---:|
| Web service (Render) — `PostgreeDatabaseClient` | 1 | 5 | 5 |
| Web service (Render) — `conexosSessionStore` | 1 | 2 | 2 |
| 6 crons do GitHub Actions (`ingest-permutas`, `ingest-sispag`, `ingest-extratos`, `detect-staleness`, `reaper-sispag`, `reconciliar-nde`) | 2 cada | 5 + 2 | 42 |
| **Total teórico se todos coincidirem** | | | **49** |

Os crons são espaçados de propósito (`:00`, `:20`, `:40` — ver o comentário no
`.github/workflows/reaper-sispag.yml`), então o pico real é bem menor que 49. O número acima é o
**pior caso**, que é o que interessa para dimensionar.

> ⚠️ **Teto real: a preencher.** O `max_client_conn` do Session pooler aparece em
> **Project Settings → Database → Connection pooling → Pool size** no dashboard do Supabase.
> Não está aqui porque ninguém o leu ainda — e chutar o número seria pior que deixar em branco.
> Ao preencher: se o teto for menor que ~49, reduza `poolMaxConnections`
> (`domain/client/database/PostgreeDatabaseClient.ts`) ou espace mais os crons.

Ao mexer em `poolMaxConnections` ou acrescentar um cron, **atualize esta tabela**. É o único lugar
onde a conta existe.

---

## 2. Render (backend — `src/backend`)

Crie um **Web Service** apontando para o repositório.

| Campo | Valor |
|-------|-------|
| Root Directory | `src/backend` |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` |
| Pre-Deploy Command | *(não usar — ver abaixo)* |

> **As migrations rodam no BOOT, não em pre-deploy.** O `preDeployCommand` é feature de plano pago
> e o serviço foi criado pelo dashboard, então ele **nunca executou** — apesar de estar declarado no
> `render.yaml` até a v0.34.1. Quem migra é o `BootMigrator`, chamado por `src/backend/index.ts`
> antes do `app.listen`: o servidor é inalcançável enquanto houver migração pendente, e falhar ao
> migrar mata o processo com código 1 (o Render marca o deploy como falho e mantém a versão
> anterior no ar). Ver a docstring de `http/bootstrap.ts`.
>
> Manter as duas fontes concordando importa: enquanto o blueprint dizia uma coisa e o código fazia
> outra, o próximo dev que "limpasse" o boot poderia remover o `BootMigrator` acreditando que o
> Render cobria.
>
> **O `npm run build` precisa levar os `.sql` para `dist/migrations/`** (passo
> `migrations/copy-to-dist.ts`). O `tsc` só emite `.js`, e o runner compilado procura as migrações
> ao lado de si mesmo. Até a v0.40.0 esse passo não existia: o `BootMigrator` achava zero arquivos,
> logava `[boot-migrate] esquema em dia` e **nunca migrou nada em produção**. Quem aplicava as
> migrações eram os crons do GitHub Actions (`npm run migrate`, via tsx, lendo a árvore-fonte),
> minutos depois do deploy. Em 2026-09-23 isso deixou as abas de lotes do SISPAG vazias por
> ~25 min (a `0061` só entrou no cron seguinte). Hoje diretório sem migração **falha o build e o
> boot**, em vez de passar por "esquema em dia".
>
> Como conferir um deploy com migração nova: o log de boot do Render deve trazer
> `[boot-migrate] aplicada(s) N: <nome>.sql`. Se trouxer `esquema em dia` num deploy que trouxe
> migração, algo está errado. Em emergência, `npm run migrate` num checkout local contra o banco de
> produção aplica o que faltar (é idempotente).

**Deploy quebrou em produção?** → [`docs/runbooks/rollback.md`](docs/runbooks/rollback.md).

### Variáveis de ambiente (Render → Environment)

| Var | Valor / observação |
|-----|--------------------|
| `databaseConnectionString` | string do Session pooler do Supabase (passo 1) |
| `CONEXOS_BASE_URL` | `https://columbiatrading.conexos.cloud/api` |
| `CONEXOS_USERNAME` | usuário Conexos |
| `CONEXOS_PASSWORD` | senha Conexos |
| `CONEXOS_FIL_COD` | filial padrão (ex.: `2`) |
| `AUTH_JWT_SECRET` | **gerar forte** — ver abaixo. Assina/valida os tokens de login |
| `ADMIN_EMAIL` | **obrigatória** para o `npm run seed:admin`: e-mail do admin semeado (vira `username` = `email`). Sem default no código. |
| `ADMIN_PASSWORD` | **obrigatória** para o `npm run seed:admin`: senha forte, mínimo 8 caracteres. Sem default no código. |
| `AUTH_TRANSICAO_EMAIL_BANNER` | *(opcional)* banner "Estamos migrando o acesso para o seu e-mail da Columbia" na tela de login. Só `true` liga; ausente = desligado. Vale sem redeploy do front (após reiniciar o backend). |
| `ALLOWED_ORIGINS` | `https://<app>.vercel.app` (domínio do frontend na Vercel) |
| `DEV_AUTH_BYPASS` | `false` |
| `environment` | `production` |
| `client_name` | `local` (faz o `EnvironmentProvider` ler do ENV, não do SSM/AWS) |
| `SISPAG_ENABLED` | `true|false` — liga/desliga a Frente II (SISPAG). **Fail-safe:** sem a var, fica **bloqueada em produção** e habilitada fora de prod. |
| `RECEBIMENTOS_ENABLED` | **KILL-SWITCH** da Frente IV (Recebimentos / "Gestão de Adiantamentos"), liberada em produção desde a v0.20.0 (ADR-0028). Ao contrário do SISPAG **não é fail-safe**: sem a var a frente fica **habilitada**. Só `false` desliga (rotas `/recebimentos/*` → 403), e vale sem redeploy. |
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
2. **Definir `ADMIN_EMAIL` e `ADMIN_PASSWORD`** (forte) no Render: a credencial inicial do admin.
   As duas são obrigatórias; sem elas o `seed:admin` falha com código 1.
3. **Setar `databaseConnectionString`** (Session pooler do Supabase) no Render.
4. **Setar credenciais Conexos** (`CONEXOS_*`) no Render.
5. Após o primeiro deploy do frontend, **copiar o domínio Vercel** e colocá-lo em
   `ALLOWED_ORIGINS` no Render; e **copiar a URL do Render** para `NEXT_PUBLIC_API_URL` na Vercel.
6. Confirmar nos logs do Render que o build copiou as migrações (`[build] N migração(ões)
   copiada(s)`) e que o boot migrou (`[boot-migrate] ...`); rodar `npm run seed:admin` uma vez
   com `ADMIN_EMAIL` e `ADMIN_PASSWORD` definidas (não há pre-deploy — ver seção 2).
7. Acessar `https://<app>.vercel.app/login` e entrar com `ADMIN_EMAIL` / `ADMIN_PASSWORD`. O
   campo de login aceita **e-mail ou usuário**, sem distinção de maiúsculas.

> Para trocar a senha do admin depois, ajuste `ADMIN_PASSWORD` e re-rode `npm run seed:admin`
> (UPSERT idempotente por `username`). Novos usuários, o e-mail e o acesso de cada um: tela
> `/usuarios` (quem tem a permissão `usuarios:gerenciar`), que grava o hash bcrypt, o e-mail de
> login, o papel e as exceções de permissão.

---

## 5. Permissões por módulo (v0.44, ADR-0053)

A autorização deixou de ser o `role` do token (`requireRole('admin')`, que não recortava nada: todo
usuário era `admin`) e passou a ser **permissão lida do banco a cada requisição**. O token só
identifica (`sub` = `username`); o backend consulta papel, pacote e exceções do usuário, com cache
de 30 s em memória.

**Catálogo (fixo no código):** `permutas:ver`, `permutas:executar`, `sispag:ver`,
`sispag:executar`, `recebimentos:ver`, `recebimentos:executar`, `operacao:ver`, `metricas:ver`,
`usuarios:gerenciar`. `executar` implica `ver` no mesmo módulo.

**O que a migration 0066 faz** (aplicada pelo `BootMigrator` no boot, e também pelo
`npm run migrate` dos crons do GitHub Actions — o que chegar primeiro):

- cria `app_role`, `app_role_permission`, `user_permission` (exceções: conceder/revogar),
  `app_user.role_id` e a trilha `app_user_access_event` (append-only);
- semeia o papel **`Administrador` com as nove permissões** e o atribui a **todo usuário
  existente**. No dia do deploy ninguém ganha nem perde acesso;
- **aborta** (antes de qualquer DDL, com a lista dos usuários) se algum `app_user.role` for
  diferente de `'admin'`. Produção tinha 15 usuários, todos `admin`, em 2026-09-28. Se abortar:
  corrigir as linhas à mão (`role = 'admin'`) e subir de novo.

**Usuário novo:** o papel é escolhido na criação (tela `/usuarios`), sem default. Ajustes finos por
pessoa: "Editar acesso" na linha do usuário (conceder ou revogar permissões além do papel). Papéis
novos (pacotes) entram por migration de dados; a tela só atribui papel e edita exceções.

**Efeitos visíveis:**

- usuário **desativado** perde o acesso na próxima requisição (401 "Sessão encerrada"), em vez de
  seguir com o token por até 12 h;
- sem a permissão, a API responde **403** `{ "error": "Você não tem permissão para esta ação.",
  "permissao": "<código>" }`; o Painel de Operação responde **404** (como antes);
- banco fora do ar: rotas autenticadas respondem **503** (fail-closed), `/health` segue no ar;
- ninguém consegue tirar a própria `usuarios:gerenciar`, nem deixar a plataforma sem nenhum
  usuário ativo com ela (409).

**Ordem de deploy:** indiferente por desenho, mas o seguro é **backend primeiro**. O front novo
entende o `/me/permissoes` antigo (cai no comportamento de hoje: tudo para `role = 'admin'`); o
backend novo continua emitindo o claim `role` e aceitando o `POST /usuarios` do front antigo com
`role: 'admin'` (o default antigo, "Operador", recebe 400 "Atualize a página para escolher o papel
do usuário."). A instância antiga do Render, durante o switch, segue com `requireRole` — ninguém
perde acesso.

> **Janela de minutos a conhecer:** se um cron do GitHub Actions rodar `npm run migrate` depois do
> merge e antes do Render publicar o backend novo, a 0066 fica aplicada com o backend antigo no ar.
> Nesse intervalo só uma coisa quebra: **criar usuário** pela tela antiga (o INSERT antigo não passa
> `role_id`, que agora é obrigatório). Login e todas as telas seguem funcionando.

**Rollback:** voltar o backend para a v0.43.1 **e depois** aplicar à mão o reverse
`src/backend/migrations/rollbacks/0066_auth_permissoes_modulo.rollback.sql` (ver
`migrations/rollbacks/README.md`). Sem o reverse, o backend antigo não cria usuários. A trilha de
acesso gravada no intervalo **se perde** (exporte `app_user_access_event` antes, se importar).

**Pós-deploy:**

- `OPERACAO_USUARIOS` foi **aposentada** (estava vazia em produção em 2026-09-28): quem vê o Painel
  de Operação agora é quem tem `operacao:ver`. A var pode ser apagada do Render; o backend não a lê.
- Antes de **desativar a conta compartilhada `admin`**, trocar `FINANCEIRO_API_USUARIO` do
  `kavex-report-ciclo` para outra conta com `metricas:ver`: desativar `admin` quebra o report até lá.
- A trilha de mudanças de acesso fica em `app_user_access_event` (leitura por SQL: `SELECT ator,
  alvo_user_id, tipo, antes, depois, em FROM app_user_access_event ORDER BY id`).
