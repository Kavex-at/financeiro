# Runbook — Cutover de identidade (login legado HS256 → Supabase Auth / GoTrue)

> **ADR-0030.** Este runbook executa a migração da custódia da credencial para o Supabase Auth. O modo
> de falha desta mudança é **lockout**: ninguém entra no sistema. Diferente da escrita `fin010` (que
> falha alto e é estornável na UI do ERP), aqui a falha é **silenciosa até o próximo login** — e o
> próximo login pode ser o de todo mundo, na segunda-feira de manhã.
>
> **A ordem dos passos É o conteúdo.** Cada inversão descrita abaixo tem um custo nomeado.
> Não pule o §3 nem o §5.

## A regra que explica todo o resto

> **O JWT prova IDENTIDADE. A AUTORIZAÇÃO é resolvida do banco a cada request.**

O `role` do JWT do GoTrue é **sempre** `'authenticated'`. Quem tentar autorizar pelo token quebra
`requireRole('admin')` para todo mundo. Por isso existe o middleware `appUserContext`
(`SELECT role, ativo, username FROM app_user`, cache de 30 s), e por isso o frontend descobre que é
admin por `GET /me`, nunca decodificando o token.

## Flags e variáveis

| Flag | Onde | Default seguro | Efeito |
|------|------|----------------|--------|
| `SUPABASE_URL` | Render | ausente | Habilita verificação ES256 por JWKS **e** o `issuer`. Ausente ⇒ só HS256 legado |
| `SUPABASE_SERVICE_ROLE_KEY` | Render | ausente | Admin API do GoTrue (convite, cadastro, ban, reset). **IGNORA RLS** — backend-only, **nunca** `NEXT_PUBLIC_*` |
| `AUTH_LEGACY_LOGIN_ENABLED` | Render | `true` | **Botão de rollback das Fases 2–3.** `false` desliga `POST /auth/login` |
| `AUTH_JWT_SECRET` | Render | (existente) | Assina/valida o HS256 legado. Sai só na Fase 4 |
| `CONEXOS_CRED_ENC_KEY` | Render | **ausente hoje — gap** | Sem ela o `SecretCipher` fica desabilitado e **toda baixa `fin010` sai no usuário-robô**, sem erro e sem log |
| `NEXT_PUBLIC_AUTH_PROVIDER` | Vercel | `supabase` (default do código) | `legacy` volta ao login antigo. **Inlined em BUILD TIME — ver §8** |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel | ausente | Sem ela o app lança `MissingSupabaseEnvError` no primeiro login |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel | ausente | idem. Publicável por desenho — o que protege é o RLS, não o segredo |

⚠️ **`CONEXOS_CRED_ENC_KEY` é um gap PRÉ-EXISTENTE, não causado por esta feature.** Enquanto faltar,
a invariante I-Usuario-5 está **inerte**: parece cumprida e não é. Esta janela de deploy é a hora certa
de fechá-la.

---

## §0 — Pré-voo (lado do desenvolvimento, antes de qualquer deploy)

| # | Passo | Por quê |
|---|-------|---------|
| 0.1 | **Commitar** a branch `feat/supabase-auth` | O trabalho esteve 119 arquivos / ~15k linhas em staging, sem commit. Um `git checkout` distraído apagava a feature inteira |
| 0.2 | `git fetch origin && git rebase origin/main` | A `main` **local** também está atrás. Rebasear na local deixa 2 commits de fora |
| 0.3 | **Renumerar** `0044_app_user_auth_link` → `0047`, `0045_app_user_role_default` → `0048` | Ver bloco abaixo |
| 0.4 | Corrigir `DEPLOY.md` §2/§3/§4 | Ver §0.4 abaixo |
| 0.5 | Re-rodar TODOS os gates (BE + FE) pós-rebase | Os números pré-rebase não valem |
| 0.6 | Bump de versão FE+BE em lockstep + `CHANGELOG.md` | O delta tem `feat` ⇒ não é no-op |

### §0.3 — A colisão de numeração que o git NÃO acusa

A `origin/main` trouxe `0044_transacao_bancaria_conta_corporativa.sql`,
`0045_modalidade_processada_arquivamento.sql` e `0046_transacao_bancaria_transferencia_interna.sql`.
Esta feature trazia `0044_app_user_auth_link.sql` e `0045_app_user_role_default.sql`.

**Nomes de arquivo diferentes ⇒ o rebase não reporta conflito nenhum.** O `MigrationRunner` registra
em `schema_migrations` por **nome de arquivo** e ordena lexicograficamente, então as quatro aplicam e
nada corrompe — mas o número duplicado fica no ledger para sempre, e o próximo a numerar uma migration
lê `0045` duas vezes. Renumerar para `0047`/`0048` é higiene barata agora e cara depois.

> ⚠️ **Não confunda:** o commit `bbfd3ea` (`fix(db): migration 0044 depende de pgcrypto`) toca a
> `0044` **da `main`** (`transacao_bancaria_conta_corporativa`), **não** a desta feature. Não tente
> mesclar o `pgcrypto` dele na migration de auth.

### §0.4 — `DEPLOY.md` está desatualizado em três pontos

1. **`preDeployCommand` nunca rodou em produção.** O serviço do Render foi configurado pelo dashboard,
   não pelo Blueprint, e pre-deploy é recurso de plano pago. A `main` resolveu movendo as migrações
   para o **boot** (`migrations/BootMigrator.ts`, chamado em `index.ts` antes do `listen()`).
   **O `seed:admin` NÃO foi movido junto** — ele é manual.
2. `DEPLOY.md` §3 (tabela da Vercel) lista só `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DEV_AUTH_BYPASS` e
   `NEXT_PUBLIC_ENV`. Faltam as três `NEXT_PUBLIC_SUPABASE_*` / `NEXT_PUBLIC_AUTH_PROVIDER`.
3. `ADMIN_USERNAME` está documentado como `admin` — **isso quebra o `seed:admin`**. Ver §6.

---

## §1 — Console do Supabase (ANTES de existir qualquer variável de ambiente)

Nove passos manuais (ADR-0030 §10). **O nº 1 é o que importa:**

1. **Auth → Providers: DESLIGAR o signup público.** O **mesmo** projeto Supabase hospeda o nosso
   Postgres e emite os tokens. Com signup ligado, qualquer pessoa na internet obtém um JWT válido com
   `aud: 'authenticated'`. O 403 fail-closed do `appUserContext` é a **segunda** camada — não deixe
   que seja a primeira.
2. Auth → SMTP customizado (o sender embutido limita a poucos e-mails/hora e trava convite e recuperação).
3. Auth → URL Configuration: Site URL + Redirect URLs (domínio Vercel + `localhost:3000`).
4. Auth → Email templates em PT-BR (convite e recuperação).
5. Auth → JWT Keys: migrar para chaves assimétricas (ECC P-256), **mantendo o segredo legado** durante o rollout.
6. Auth → Sessions: TTL do access token e rotação de refresh com *reuse detection*.
7. Confirmar que o schema `auth` **não** está exposto via PostgREST.
8. (Render — §4) · 9. (Vercel — §3)

---

## §2 — Ordem que não se negocia

```
Console Supabase (§1)
   └→ Vercel: NEXT_PUBLIC_AUTH_PROVIDER=legacy  (§3)   ← ANTES do merge
        └→ merge / deploy backend Fase 1 (§4)
             └→ medir username (§5)  ── se houver não-e-mail ─→ normalizar AGORA
                  └→ seed:admin manual (§6)
                       └→ migrate-users: dry-run → 1 conta → --execute (§7)
                            └→ GATE OPEN
                                 └→ Fase 2: flip + REBUILD do frontend (§8)
                                      └→ Fase 3: AUTH_LEGACY_LOGIN_ENABLED=false (§9)
```

---

## §3 — Vercel ANTES do merge (a armadilha do default)

`getAuthProvider()` **defaulta para `'supabase'`**. Esse default está certo *depois* do cutover e
errado *no instante do merge*: a Vercel faz auto-deploy da `main`, e uma build sem a variável entra
direto no modo Supabase — com **zero usuários migrados**.

Na Vercel, em **todos** os environments, **antes de mergear o PR**:

```
NEXT_PUBLIC_AUTH_PROVIDER     = legacy
NEXT_PUBLIC_SUPABASE_URL      = https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = <anon key>
```

Sem a primeira linha, o merge **executa o cutover sozinho**, colapsando as Fases 1 e 2 numa só.

---

## §4 — Fase 1: o backend sobe e ninguém percebe

No Render (todas `sync: false`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`AUTH_LEGACY_LOGIN_ENABLED=true`, **`CONEXOS_CRED_ENC_KEY`**.

Mergear. No log do deploy, procurar:

```
[boot-migrate] aplicada(s) 2: 0047_app_user_auth_link.sql, 0048_app_user_role_default.sql
```

Migração que falha **mata o boot com exit 1**; o Render mantém a versão anterior no ar. Esse é o
desfecho certo — melhor a release não subir do que subir servindo contra um esquema desconhecido.

**Por que ninguém é deslogado aqui:** todo usuário atual já tem linha em `app_user` com `ativo = true`
(é o que o login de hoje confere). O token dele é HS256 **sem claim `iss`**, então `schemeFor` o
classifica como `'legacy'` e o `appUserContext` resolve por `findContextByUsername`. Mesma sessão,
mesma senha, caminho de autorização novo.

**Verificação:** entrar com uma conta comum e uma conta admin; confirmar que a UI de admin continua
visível (ela agora vem de `GET /me`, não do token).

---

## §5 — A medição que decide o cronograma

```sql
SELECT count(*) FILTER (WHERE username NOT LIKE '%@%') AS sem_email,
       count(*)                                        AS total
FROM app_user;
```

`migrations/0007_app_user.sql` declara `username TEXT UNIQUE NOT NULL` — string livre. O GoTrue
**valida formato de e-mail** e o job alimenta esse campo direto. Um `username` como `financeiro01`
**nunca ganha `auth_user_id`** ⇒ `listPendingMigration()` **nunca esvazia** ⇒ a **Fase 3 trava para
sempre**. Trava do lado certo: o cutover não avança, ninguém fica trancado do lado de fora.

| `sem_email` | Caminho |
|---|---|
| **0** | Sem migração de dados. `CHECK` de formato + Zod na fronteira. ~30 min |
| **pequeno (≲20)** | **Normalizar `username` → e-mail AGORA, na Fase 1**, com o backfill de auditoria na **mesma transação**. Depois o `CHECK` |
| **grande / e-mails desconhecidos** | Coluna `email TEXT UNIQUE`; `username` segue imutável como ator da trilha e chave do vínculo Conexos |

### Por que AGORA e não depois

1. **Antes** de `migrate-users --execute`: criar conta no GoTrue com e-mail errado **queima aquele
   e-mail**; corrigir vira deletar e recriar usuários no provedor.
2. **Antes** do flip do frontend: enquanto o login legado é a única porta, o rename custa **um
   comunicado**. Depois do flip, custa mudar a identidade de login **duas vezes na mesma semana** — na
   única janela cujo modo de falha declarado é lockout.
3. O backfill de auditoria só encarece: escala com o histórico, e o histórico só cresce.

### ⚠️ NÃO faça `UPDATE username` no psql

Raio de alcance já mapeado: o vínculo Conexos sobrevive, mas **sessões legadas vivas tomam 403**; a
trilha **racha em dois formatos** (visível no dropdown de `BorderosPanel.tsx`); a chave de
idempotência muda (`receb:${ator}:${key}`) com risco de **dupla execução em rota que move dinheiro**;
e o `seed-admin` cria um **admin duplicado** se `ADMIN_USERNAME` não for atualizado junto.

O caminho é um job — `jobs/normalize-usernames-to-email.ts`: dry-run por padrão, mapping **explícito**
(não se deriva e-mail de `financeiro01`), transação única, com colisão / e-mail inválido / "nada
pendente no ledger de recebimentos" como **pré-condições que abortam**. Migration cuida do schema (o
`CHECK`); job cuida do dado, que é específico do ambiente.

Qualquer rename exige **ADR emendando I-Usuario-2** (`username` imutável) com exceção datada.

---

## §6 — `seed:admin`: manual, e `ADMIN_USERNAME` precisa ser um e-mail

O `seed-admin` agora cria a conta **no GoTrue** com `email: ADMIN_USERNAME` e grava o `auth_user_id`
na linha local. Duas consequências:

- **`ADMIN_USERNAME=admin` faz o job falhar** — o GoTrue recusa o formato. Use um e-mail real.
- Ele passou a **depender** de `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Rodá-lo antes do §1/§4 falha.

Rodar pelo **shell do Render** (não há pre-deploy):

```bash
npm run seed:admin
```

Idempotente. Se imprimir `ADMIN_ALREADY_IN_GOTRUE`, **pare e resolva à mão** — ele se recusa a adivinhar
qual conta do provedor apontar, e essa recusa está certa.

---

## §7 — Importar os hashes bcrypt

```bash
npm run job:migrate-users                 # DRY-RUN (default) — só relata
```

O usuário é criado no GoTrue **reaproveitando o hash bcrypt existente** — é isto que evita o lockout
geral: ninguém precisa trocar de senha. Idempotência é **por construção**: o filtro é
`auth_user_id IS NULL`.

> ⚠️ **O modo de falha mais provável é silencioso: o hash é ACEITO mas não confere**, e ninguém
> descobre até o primeiro login. **Migre UMA conta de teste, faça login com ela de verdade**, e só
> então rode em todo mundo. Sem isso, o primeiro login é o de todos, ao mesmo tempo.

```bash
npm run job:migrate-users -- --execute
```

Esperar a linha:

```
[migrate-users] GATE OPEN: no user pending migration
```

Falhas saem com `username` (nunca hash, nunca senha). `SupabaseEmailAlreadyExistsError` ⇒ vincular
`auth_user_id` à mão.

---

## §8 — Fase 2: o flip é um **REBUILD**, não uma troca de variável

Setar `NEXT_PUBLIC_AUTH_PROVIDER=supabase` **e disparar um redeploy na Vercel**.

> **A ADR e o `DEPLOY.md` chamam isso de "uma variável de ambiente na Vercel, sem redeploy do
> backend". A parte do backend é verdade; a do frontend engana.** O Next **inlina** `NEXT_PUBLIC_*`
> em **build time** — mudar o valor no painel não faz nada até uma nova build. É a mesma família do
> P0 `cutover-rollback-broken` (flag sem leitor), agora com raio menor: a flag tem leitor, mas ele só
> escuta durante o build.

O backend aceita os **dois** tokens durante toda a Fase 2, então as sessões vivas sobrevivem ao flip.

### Ensaie o rollback ANTES de precisar dele

O caminho rápido **não** é reverter a variável (isso é mais uma build). É o **instant rollback da
Vercel para o deployment anterior** — a build que já tem `legacy` inlinado. Saiba qual é esse
deployment, e confirme que ele funciona, enquanto ninguém está trancado do lado de fora.

---

## §9 — Fase 3: só depois do `GATE OPEN`

`AUTH_LEGACY_LOGIN_ENABLED=false` no Render.

> ⚠️ **Se restar UM `app_user` com `auth_user_id IS NULL`, essa pessoa fica sem NENHUM caminho de
> login**: o legado desligado e ela inexistente no provedor. `listPendingMigration()` é **gate**, não
> relatório.

Rollback: religar a flag (`true`) — vale sem redeploy do frontend.

## §10 — Fase 4 (PR separado, semanas depois)

Remover HS256, `password_hash`, `AuthService`, `AUTH_JWT_SECRET`, `AUTH_LEGACY_LOGIN_ENABLED`,
`lib/auth/legacySession.ts` e `lib/auth/provider.ts`. Só depois de a Fase 3 estar estável.

---

## Matriz de rollback

| Sintoma | Fase | Ação | Tempo |
|---|---|---|---|
| Backend em 500/403 generalizado | 1 | Reverter o deploy no Render (mantém as migrations — são aditivas e idempotentes) | ~2 min |
| Login quebrado pelo Supabase | 2 | **Instant rollback da Vercel** para o deployment anterior (`legacy` inlinado) | ~30 s |
| Login quebrado, sem deployment anterior utilizável | 2 | `NEXT_PUBLIC_AUTH_PROVIDER=legacy` + **redeploy** | ~3 min |
| Usuário não migrado sem acesso | 3 | `AUTH_LEGACY_LOGIN_ENABLED=true` no Render | ~1 min (restart) |
| Hash importado não confere | 2–3 | Reset de senha por e-mail (exige o SMTP do §1.2) | por usuário |

## Sinais de problema

- **403 com `Seu acesso não está habilitado nesta plataforma`** ⇒ não há linha em `app_user` para o
  `sub` apresentado. Em Fase 2, quase sempre é `auth_user_id` não vinculado.
- **403 em massa logo após setar `SUPABASE_URL`** ⇒ suspeite de classificação de esquema. O
  discriminador é `payload.iss`, **não** o `alg` (um projeto Supabase ainda em chaves simétricas emite
  HS256 com `sub` UUID). Ver `http/auth.ts:231`.
- **500 em toda request autenticada** ⇒ um `sub` não-UUID chegou em `findByAuthUserId` (Postgres 22P02).
  O guard de UUID no repositório deveria transformar isso em 403 — se virou 500, o guard foi removido.
- **Loop de refresh + modal de sessão expirada** ⇒ alguém trocou um 403 por 401 no `appUserContext`.
  Falta de autorização **nunca** é 401.
- **Trilha de auditoria gravando UUID** ⇒ algum call site voltou a usar `req.user.sub`. Rodar
  `http/auditActor.guard.test.ts`.
- **Toda baixa `fin010` no usuário-robô** ⇒ `CONEXOS_CRED_ENC_KEY` ausente. Não gera erro nem log.

## Armadilhas que parecem sobra de código — não remova

| Onde | O que parece | O que é |
|---|---|---|
| `http/auth.ts:189` — `hsOptions` sem `issuer` | duplicação boba | HS256 legado **nunca teve** claim `iss`. Compartilhar as opções faz o mero ato de setar `SUPABASE_URL` **derrubar todas as sessões vivas** |
| `http/auth.ts:231` — `schemeFor` por `iss` | podia ser `alg` | Projeto Supabase em chaves simétricas emite HS256 com `sub` UUID. Rotear por `alg` tranca **todos** os usuários dele |
| `findByAuthUserId` recusa `sub` não-UUID | redundante com o acima | Segunda camada, independente. Classificação errada custa 403 diagnosticável, nunca 500 |
| `UserAdminService` invalida **duas** chaves de cache | exagero | Nas Fases 2–3 a mesma pessoa pode portar token legado **ou** Supabase. Invalidar uma deixa a outra viva 30 s **com privilégio** |
| 403 (nunca 401) no `appUserContext` | inconsistente | 401 dispara refresh e modal de sessão expirada. Linha ausente/`ativo=false` não é problema de sessão |

## O que este runbook NÃO cobre

- **`filialAuthz` continua fail-OPEN.** A claim `filiais` nunca foi provisionada, então
  `userCanActOnFilial` retorna `true` sempre: qualquer admin dispara borderô, baixa `fin010` e NDe em
  **qualquer filial**. Carry-over desde 2026-06-22, 6º Regis-Review consecutivo. Esta feature não fecha
  (misturaria duas migrações de segurança num cutover só) mas **barateia**: com a autorização já vindo
  do banco, popular `filiais` vira um `JOIN` na query que já resolve `role`/`ativo`.
- **`AppUserContextCache` é process-local.** Só é suficiente porque o Render roda em `plan: starter`
  (instância única). **Escalar horizontalmente quebra a revogação em silêncio.**
