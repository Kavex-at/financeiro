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
| `AUTH_JWT_SECRET` | **gerar forte** — ver abaixo. Assina/valida os tokens de login próprios (modo `local`). Apagar no passo 8 do corte do Supabase Auth (seção 6) |
| `AUTH_PROVIDER` | `local` (default) ou `supabase` — ver seção 6 |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` | só a partir do passo 2 da seção 6 (**nunca** com o backend anterior a esta feature (≤ v0.46) no ar) |
| `ADMIN_EMAIL` | **obrigatória** para o `npm run seed:admin`: e-mail do admin semeado (vira `username` = `email`). Sem default no código. |
| `ADMIN_PASSWORD` | **obrigatória** para o `npm run seed:admin`: senha forte, mínimo 8 caracteres. Sem default no código. |
| `ALLOWED_ORIGINS` | `https://<app>.vercel.app` (domínio do frontend na Vercel) |
| `DEV_AUTH_BYPASS` | `false` |
| `environment` | `production` |
| `client_name` | `local` (faz o `EnvironmentProvider` ler do ENV, não do SSM/AWS) |
| `SISPAG_ENABLED` | `true|false` — liga/desliga a Frente II (SISPAG). **Fail-safe:** sem a var, fica **bloqueada em produção** e habilitada fora de prod. |
| `RECEBIMENTOS_ENABLED` | **KILL-SWITCH** da Frente IV (Recebimentos / "Gestão de Adiantamentos"), liberada em produção desde a v0.20.0 (ADR-0028). Ao contrário do SISPAG **não é fail-safe**: sem a var a frente fica **habilitada**. Só `false` desliga (rotas `/recebimentos/*` → 403), e vale sem redeploy. |
| `SISPAG_TED_ENABLED` / `SISPAG_PIX_ENABLED` | Gates de go-live de TED/PIX no SISPAG (ADR-0054). Default **`false`**; só `true` exato liga, sem redeploy (`sync: false`). **Não são oferecidas sem `SISPAG_FAVORECIDO_AUTORIZADO_ENABLED`** (ADR-0065 I14k). Desligar no meio de uma retomada de remessa falha fechado em vez de trocar o destino. |
| `SISPAG_FAVORECIDO_AUTORIZADO_ENABLED` | Guarda do favorecido autorizado (ADR-0065). Default **`false`**. Só liga com `SISPAG_FAVORECIDO_FINGERPRINT_KEY` válido: ligada sem ele, resolve `false` e o boot avisa no log. Runbook na seção "Favorecido autorizado". |
| `SISPAG_FAVORECIDO_FINGERPRINT_KEY` / `SISPAG_FAVORECIDO_FINGERPRINT_KEY_ID` | **Segredo** do HMAC do destino (≥ 32 bytes; `openssl rand -hex 32`) e a versão dele (default `v1`). Nunca em log. Trocar o segredo sem trocar o `KEY_ID` faria todo destino aprovado parecer "alterado"; trocar os dois deixa as autorizações antigas sem comparação (recálculo assistido, fora de escopo). Defina também nos secrets dos crons que resolvem destino. |
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

---

### Favorecido autorizado do SISPAG (`sispag:autorizar_favorecido`, ADR-0065, migration 0080)

O destino de TED/PIX é **sempre** o do cadastro do Conexos (`cmn025`). Uma segunda pessoa aprova o
par (favorecido, modalidade) amarrado à impressão digital (HMAC) do destino que o cadastro resolvia
na aprovação; toda verificação compara a impressão de novo. Substitui a exceção de destino
(ADR-0061) e a conferência por lote (ADR-0063), que a 0080 apaga.

**Antes do merge — a guarda da 0080.** A migração ABORTA inteira (e o `BootMigrator` para de
migrar) se `excecao_destino`, `excecao_destino_audit`, `lote_pagamento_item_destino_audit`,
`pendencia_cadastro`, `pendencia_cadastro_origem` tiverem qualquer linha, ou se algum
`lote_pagamento_item.destino_manual` estiver preenchido. Em 2026-10-08 todas estavam em 0 em
produção. Reconfira com o `.env` local (sa-east-1, não o MCP do Supabase) se o merge atrasar.

**Rollout (nesta ordem):**

1. Deploy com `SISPAG_FAVORECIDO_AUTORIZADO_ENABLED` **ausente/false**. Nada muda para boleto. Com a
   guarda desligada, TED/PIX **não são oferecidos nem aceitos** (I14k) — inclusive o TED antigo
   pela conta do banco do lote. Lotes FINALIZADOS com item TED/PIX ficam barrados na remessa
   (`FAVORECIDO_NAO_AUTORIZADO_NA_REMESSA`) até a guarda ser ligada e o favorecido autorizado.
2. Gerar o segredo (`openssl rand -hex 32`) e definir `SISPAG_FAVORECIDO_FINGERPRINT_KEY` e
   `SISPAG_FAVORECIDO_FINGERPRINT_KEY_ID=v1` no Render **e** nos secrets dos crons que resolvem
   destino. Nunca trocar o segredo sem trocar o `KEY_ID`.
3. Conceder `sispag:autorizar_favorecido` (tela `/usuarios`) a **duas** pessoas no mínimo:
   aprovador ≠ quem pediu, verificado no backend. A 0080 converteu as concessões de
   `sispag:excecao` e deu a permissão ao Administrador.
4. Com a Columbia, revisar o relatório **Favorecidos autorizados → Candidatos**, pedir as
   autorizações (`sispag:executar`) e aprová-las (segunda pessoa).
5. Ligar `SISPAG_FAVORECIDO_AUTORIZADO_ENABLED=true` e então `SISPAG_TED_ENABLED` /
   `SISPAG_PIX_ENABLED`. Ligada sem segredo válido, a guarda resolve `false` e o boot avisa no log.

**Efeitos:** no `finalizarLote` o item TED/PIX sem autorização válida **sai do lote** (motivo na
trilha) e o lote finaliza com os demais; na remessa, a guarda barra o lote inteiro antes de qualquer
escrita no Conexos (só sem lote nativo; numa retomada vale o destino congelado). Destino que mudou
no cadastro abre reaprovação e alerta `sispag-destino-alterado`.

**Rollback:** voltar o backend para a versão anterior e aplicar
`migrations/rollbacks/0080_sispag_favorecido_autorizado.rollback.sql` (só estrutura: as autorizações
se perdem; exporte antes).

## 6. Supabase Auth (ADR-0057)

O login passa a ser do **Supabase Auth do mesmo projeto do banco**, por **proxy no backend**: o
front continua falando só com `POST /auth/login` (mesmo corpo `{ username, password }`, mesmo
campo `token`), e ganha `POST /auth/refresh` e `POST /auth/logout`. O token só prova identidade;
permissões continuam no banco. A identidade de auditoria continua sendo o `username`, para sempre.
Mesmas senhas (os hashes bcrypt são importados como estão), sem SMTP, sem cadastro público.

**O merge não liga nada.** `AUTH_PROVIDER` ausente = `local` (o login de hoje). O corte é a
sequência manual abaixo, do dono do ciclo.

> ⚠️ **ARMADILHA DO CORTE (D14): `SUPABASE_URL` nunca pode estar definida com um backend anterior a esta feature (≤ v0.46) no
> ar.** O código antigo aplica o `issuer` do Supabase também aos tokens HS256 próprios (que não têm
> `iss`): com a variável definida, **todo mundo é deslogado**. Por isso `SUPABASE_URL` só entra no
> Render **depois** que o backend novo está no ar, e **todo rollback de código para anterior a esta feature (≤ v0.46) exige
> remover `SUPABASE_URL` antes**.

**Variáveis** (Render; nada muda no Vercel, e nenhum cron do GitHub Actions precisa delas):

| Var | Quando | Observação |
|-----|--------|------------|
| `SUPABASE_URL` | passo 2 | `https://kngrpoqzaxtuzkcugsyl.supabase.co`, sem barra final. **Nunca** com o código antigo no ar (D14) |
| `SUPABASE_PUBLISHABLE_KEY` | passo 2 | chave publicável (`sb_publishable_…`); o backend a usa nas chamadas públicas do Supabase Auth |
| `SUPABASE_SECRET_KEY` | passo 2 | chave secreta dedicada (`sb_secret_…`, `sync: false`): **poder de admin sobre todos os logins**. Nunca no front, nunca no Vercel, nunca em chat |
| `AUTH_PROVIDER` | passo 2 (`local`), passo 5 (`supabase`) | quem emite o token no login. Rollback = voltar para `local` |
| `AUTH_TRANSICAO_EMAIL_BANNER` | remover no passo 2 | não é mais lida |
| `AUTH_JWT_SECRET` | remover no passo 8 | recriar só em rollback. Em modo `supabase` o boot não a exige |
| `SUPABASE_JWT_SECRET` | remover se existir | não é mais lida |

**Jobs manuais** (`seed-admin`, `sync-supabase-auth`): precisam de `databaseConnectionString`,
`SUPABASE_URL` e `SUPABASE_SECRET_KEY`. Preferir o Render Shell (o env já está lá); nunca misturar
um `.env` de dev com o banco de produção.

- `node dist/jobs/sync-supabase-auth.js` → **dry-run** (default): imprime a URL alvo no topo, uma
  linha por usuário (`criar`, `vincular`, `reconciliar`, `ignorado: inativo`, `ignorado: sem e-mail`,
  `conflito`, `divergência: vínculo órfão`) e o resumo planejado. Nada é alterado.
- `node dist/jobs/sync-supabase-auth.js --execute` → aplica. Idempotente: rodar de novo dá 0 ações.
  Saída 1 se houver falha ou conflito. É também a ferramenta de reparo de divergência (procure
  `AUTH_DIVERGENCIA` no log).
- Só usuários **ativos** são importados. Os 3 inativos de produção ficam de fora; reativar um deles
  pela tela cria o login no Supabase na hora (exige e-mail). Apagá-los é operação à parte.

**`kavex-report-ciclo`:** não muda. Continua fazendo `POST /auth/login` com
`FINANCEIRO_API_USUARIO`/`SENHA` (login por **username** continua valendo: o backend resolve o
e-mail); o token do Supabase dura 1 h, suficiente para a execução semanal. Aposentar a conta
`admin` continua exigindo trocar `FINANCEIRO_API_USUARIO` antes.

### Runbook de corte

Projeto: `kngrpoqzaxtuzkcugsyl` (sa-east-1). Quem executa: dono do ciclo. Cada passo tem uma verificação; verificação falhando = parar e seguir o rollback da fase.

**Passo 0 — Painel do Supabase (antes do merge, não muda nada para ninguém)**
1. Authentication → Sign In / Providers: **"Allow new users to sign up" = OFF**; **"Allow anonymous sign-ins" = OFF**; provedor **Email = ON** (é o que aceita senha). "Confirm email" pode ficar como está (a importação cria e-mails já confirmados).
2. Authentication → Sessions / JWT: validade do access token **3600 s** (default); **rotação de refresh token ON**, intervalo de reuso no default (10 s).
3. Authentication → Rate Limits: limites de sign-in e de refresh de token por IP **acima** dos nossos (todo tráfego vem do IP do Render): no mínimo 150 sign-ins / 5 min e 300 refreshes / 5 min. Anotar os valores antigos.
4. Settings → API Keys: copiar a **publishable key** (`sb_publishable_…`); criar uma **secret key** dedicada `financeiro-backend-render` (`sb_secret_…`). Ela vai só para o Render e para quem roda os jobs manuais; nunca para o Vercel, nunca em chat.
5. (Recomendado, defesa em profundidade) Settings → Data API: desligar a Data API, ou tirar `public` de "Exposed schemas". O código não usa `/rest/v1` em lugar nenhum. A verificação do Q1 mostrou que ela já não lê nada das nossas tabelas.
6. Conferir: `SUPABASE_URL`, `SUPABASE_JWT_SECRET` **não** estão definidas no Render hoje (D14). Se `SUPABASE_URL` estiver, **não mexer antes do passo 2**.

**Passo 1 — Merge e deploy, sem nenhuma env nova (modo `local`)**
- Merge do PR. O Render sobe o backend novo (o `BootMigrator` aplica a 0071 se um cron não a tiver aplicado antes; os dois caminhos são seguros para o código antigo). O Vercel sobe o front novo (tolera o backend antigo: resposta sem `refreshToken`).
- `AUTH_PROVIDER` ausente = `local`. **Não** adicionar `SUPABASE_URL` ainda.
- Verificar: `/health` 200; login por e-mail e por username entram (token HS256 como hoje); `SELECT count(*) FROM app_user WHERE auth_user_id IS NOT NULL` = 0; `kavex-report-ciclo` roda (ou `curl` equivalente); `anon`/`authenticated` sem `TRUNCATE` em `public` (`SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated')` vazio).

**Passo 2 — Env do Supabase no Render, ainda em modo `local`**
- Adicionar `SUPABASE_URL=https://kngrpoqzaxtuzkcugsyl.supabase.co`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `AUTH_PROVIDER=local` (explícito). Remover `AUTH_TRANSICAO_EMAIL_BANNER`. Salvar e fazer deploy.
- Agora o backend novo verifica os dois emissores e espelha as escritas de credencial no GoTrue (D3), mas todo login ainda é local.
- Verificar: tokens HS256 emitidos antes do passo 2 **continuam** valendo (regressão do defeito do `issuer`); ConfigDoctor sem alerta de auth; o painel de Operação mostra `AUTH_PROVIDER = local`.

**Passo 3 — Sync em dry-run**
- No Render Shell do serviço (env já presente): `cd src/backend && node dist/jobs/sync-supabase-auth.js`.
- Conferir o relatório: URL alvo = o projeto certo; **12 "criar"** (os ativos), **3 "ignorado: inativo"**, 0 "sem e-mail", 0 conflitos, 0 falhas. Qualquer outra coisa: parar e investigar.

**Passo 4 — Sync de verdade**
- `node dist/jobs/sync-supabase-auth.js --execute`. Saída 0.
- Verificar: `SELECT count(*) FROM app_user WHERE ativo AND auth_user_id IS NOT NULL` = **12**; inativos com vínculo = 0; rodar o dry-run de novo → **0 ações** (idempotente). No painel, Authentication → Users lista 12 usuários, e-mails confirmados, nenhum banido.
- **Prova do T-1 na versão do projeto** (a versão do GoTrue do projeto não é visível sem chave): o
  dono entra direto no Supabase Auth com a PRÓPRIA senha, sem mudar nada para ninguém:
  `curl -s -o /dev/null -w '%{http_code}\n' -X POST 'https://kngrpoqzaxtuzkcugsyl.supabase.co/auth/v1/token?grant_type=password' -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H 'content-type: application/json' -d '{"email":"<seu e-mail>","password":"<sua senha>"}'`
  → **200** prova que o `password_hash` importado foi aceito. Qualquer outra coisa: **não** fazer o
  passo 5 (o login continua local; investigar antes).

**Passo 5 — Virar a chave: `AUTH_PROVIDER=supabase`**
- Render: `AUTH_PROVIDER=supabase`, deploy. Anotar a **hora exata** (H).
- Logins novos recebem token Supabase (ES256, 1 h) + refresh token. Tokens HS256 antigos continuam valendo até expirar (≤ 12 h).
- Verificar com um usuário real (o dono): login por e-mail; login por username; recarregar a página depois de 1 h sem modal (renovação); "Sair" e tentar reusar o refresh token (401); uma ação de escrita qualquer grava o `username` como ator (conferir a última linha da trilha correspondente); `GET /me/conexos-status` = `vinculado` para quem tem vínculo. `kavex-report-ciclo` roda.

**Passo 6 — Observar**
- Durante as próximas horas: log sem `AUTH_DIVERGENCIA`, sem 503 de auth, sem 429 inesperado.

**Passo 7 — Esperar ≥ 12 h a partir de H**
- É a vida máxima de um token HS256 emitido antes do passo 5.

**Passo 8 — Fechar a janela: apagar `AUTH_JWT_SECRET`**
- Render: remover `AUTH_JWT_SECRET`, deploy. O boot em modo `supabase` não exige a variável (D7).
- Verificar: login e navegação normais; um token HS256 guardado de antes → 401.

**Depois (fora desta feature):** uma semana estável → `/feature-tweak` de limpeza (ver "Fora de escopo"). Apagar os 3 inativos de `app_user` é operação à parte, com OK explícito.

### Runbook de rollback

| Fase em que o problema aparece | O que fazer | Efeito para o usuário |
|---|---|---|
| Passo 1 (código novo, sem env) | Render → "Rollback" para o deploy anterior. A 0071 é aditiva e anulável; o código antigo a ignora. `SUPABASE_URL` não está definida, então o defeito do `issuer` não dispara | Nenhum (tokens HS256 continuam válidos) |
| Passos 2–4 (env do Supabase, modo `local`) | Problema de config: corrigir a env. Problema de código: **remover `SUPABASE_URL` primeiro** (D14) e então fazer rollback do deploy. Usuários criados no GoTrue pelo sync ficam lá, inofensivos (cadastro desligado, sem acesso a dados); o `auth_user_id` preenchido é ignorado pelo código antigo | Nenhum |
| Passos 5–7 (modo `supabase`, `AUTH_JWT_SECRET` ainda existe) | `AUTH_PROVIDER=local`, deploy. Login volta ao bcrypt local com as mesmas senhas (R7: toda troca de senha depois do corte gravou os dois lados). Tokens Supabase já emitidos verificam até o `exp` (≤ 1 h); `/auth/refresh` responde 401 (D1), então cada pessoa faz **um** login novo quando o token vence | Um login por pessoa em até 1 h |
| Depois do passo 8 (sem `AUTH_JWT_SECRET`) | Gerar um valor novo (`openssl rand -base64 48`), definir `AUTH_JWT_SECRET` **e** `AUTH_PROVIDER=local`, deploy | Um login por pessoa em até 1 h |
| Rollback de código depois do passo 5 | Primeiro `AUTH_PROVIDER=local` (linha acima) e esperar 1 h; depois **remover `SUPABASE_URL`** e fazer rollback do deploy. O código antigo só entende HS256 | Um login por pessoa |
| Divergência pontual (um usuário não entra) | Não é rollback: rodar `sync-supabase-auth` em dry-run, ler a linha do usuário, rodar com `--execute` | Só aquele usuário |

Nunca: apagar usuários no painel do Supabase para "recomeçar" com o modo `supabase` ligado (quebra o vínculo de quem está logado; o sync recria e vincula, mas as sessões caem). Nunca: `SUPABASE_URL` definida com o backend anterior a esta feature (≤ v0.46) no ar.

### Troca da própria senha (`/me/senha`, ADR-0059)

**Nada a configurar.** Nenhuma env nova: `AUTH_PROVIDER`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e
`SUPABASE_SECRET_KEY` já existem. A migration `0073` só amplia a CHECK de
`app_user_access_event.tipo` (aditiva, idempotente): um cron pode aplicá-la antes do deploy sem
afetar o backend antigo. Rollback de código: a CHECK ampliada fica (não há reverse) e o código antigo
a ignora. O front continua com `SENHA_PROPRIA_HABILITADA = false` até o tweak que liga a flag; este
backend pode ir antes, sem efeito visível.

**"Secure password change" do Supabase precisa continuar OFF.** No modo `supabase`, a troca usa
`PUT /auth/v1/user` com o token do próprio usuário (mantém a sessão atual e revoga as outras). Com a
opção ligada, esse endpoint passa a exigir um `nonce` de reautenticação enviado por e-mail, e o
projeto não tem SMTP: toda troca responderia 503. Como conferir, **sem escrever nada**:

- Dashboard: Authentication → Sign In / Providers → Email → **Secure password change** desmarcado; ou
- Management API (só leitura, com token pessoal):
  `GET https://api.supabase.com/v1/projects/kngrpoqzaxtuzkcugsyl/config/auth` →
  `security_update_password_require_reauthentication` deve ser `false`.

Verificação pós-deploy (opcional, com OK do dono e usuário descartável): o passo 4 do roteiro de QA
(duas sessões, troca pela A → refresh de A 200, de B 401). O comportamento de sessões foi medido no
GoTrue v2.197 local; a versão do projeto pode diferir.
