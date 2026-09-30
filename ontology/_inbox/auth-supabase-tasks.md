# Tasks: auth-supabase

> Slug: `auth-supabase` · Branch: `feat/auth-supabase` · Base: `main` (@ `76b5182`, v0.44.x)
> Worktree: `.claude/worktrees/auth-supabase` · Migration: **0067** · ADR: **0054** (reconferir as duas no rebase)
> Passo 3 de 3 do plano de auth (e-mails reais → permissões no banco → **Supabase Auth**).

**Spec source:** ontology/_inbox/auth-supabase-interview.md (as seções **"Verificação do Q1 no banco de produção"** e **"Respostas (2026-09-29, dono do ciclo)"** prevalecem sobre o resto)
**Ontology diff:** no. `entity_changed = false`: `auth_user_id` e a troca do emissor do token são infraestrutura de acesso. Só a ADR 0054 (emenda a ADR-0051 D2, continua a ADR-0053)
**Estimated scope:** XL (cerca de 45 arquivos: migration com limpeza de grants, client HTTP novo, verificador duplo, mapeamento de identidade, login/refresh/logout por proxy, rate limiter, espelhamento de toda escrita de credencial, seed, job novo, front de sessão com refresh; e um corte em produção com rollback por configuração)

## Decisões que valem para todas as tasks

Vindas da entrevista (aprovadas):

- **Login por proxy no backend.** `POST /auth/login` mantém o corpo `{ username, password }` e o campo `token` da resposta (o `kavex-report-ciclo` não muda). O identificador (e-mail **ou** username) é resolvido no `app_user`; o GoTrue só recebe o **e-mail**.
- **Rotas novas:** `POST /auth/refresh` (pública) e `POST /auth/logout`. `GET /auth/transicao`, o `TransicaoEmailBanner` e `AUTH_TRANSICAO_EMAIL_BANNER` saem.
- **Verificação estrita por emissor (I8), com opções separadas:** Supabase = ES256 via JWKS de `${SUPABASE_URL}/auth/v1`, `iss = ${SUPABASE_URL}/auth/v1`, `aud = authenticated`, `role = authenticated`, `is_anonymous !== true`. App = HS256 com `AUTH_JWT_SECRET`, `aud = authenticated`, **sem** exigência de `iss`, e só enquanto `AUTH_JWT_SECRET` existir. `SUPABASE_JWT_SECRET` deixa de ser lido. Corrige o defeito latente de `http/auth.ts:137-141` (o `issuer` aplicado aos dois caminhos).
- **Identidade de auditoria = `app_user.username`, para sempre (I2).** O `resolverAcesso` resolve o `app_user` por `username` (emissor `app`) ou por `auth_user_id` (emissor `supabase`) e reescreve `req.user = { sub: username, authUserId?, filiais? }`, **sem `email`**. Os três sítios `email ?? sub` de `routes/recebimentos.ts` (`:735`, `:935`, `:975`) viram `sub ?? email`.
- **`app_user.auth_user_id uuid NULL UNIQUE`** (migration 0067, aditiva e anulável: segura para o backend antigo, que os crons podem encontrar rodando depois de aplicarem a migration). Nenhuma tela edita a coluna.
- **Higiene de grants na 0067:** `REVOKE TRUNCATE, REFERENCES, TRIGGER` de `anon`/`authenticated` em todas as tabelas de `public`, e `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ... ON TABLES FROM anon, authenticated`.
- **`app_user` é a fonte da verdade; o GoTrue é projeção da credencial (R6).** Toda escrita de credencial: transação local com a linha travada → chamada admin → commit. Falha no GoTrue = rollback + **503** `'Serviço de autenticação indisponível; nada foi alterado.'`. Sucesso no GoTrue e falha no commit = `LogService.error` com os ids; o job de sync repara.
- **Senha hasheada uma vez (bcrypt 12) e gravada nos dois lados** até o tweak de limpeza (R7). É o que torna o rollback por configuração trivial.
- **Desativar = `ativo = false` + ban no GoTrue; reativar = desbanir, ou criar no GoTrue se não houver vínculo** (exige e-mail). A garantia continua sendo o `ativo` lido a cada requisição (≤ 30 s). **Exceção à R6 decidida pelo dono do ciclo (2026-09-30): desativar NUNCA fica bloqueado por pane do GoTrue** — o `ativo = false` é comitado mesmo se o ban falhar, com `LogService.error` `AUTH_DIVERGENCIA` ("desativado sem ban; o sync aplica"), e o sync aplica o ban depois. As demais escritas de credencial seguem a R6 (rollback + 503).
- **Importação só de usuários ATIVOS** (Q4 alterada). Os 3 inativos de produção não são importados; apagá-los está **fora de escopo**.
- **Job `jobs/sync-supabase-auth.ts`:** `--dry-run` por default, idempotente, **vincula em vez de duplicar**, reconcilia e-mail e ban de quem já tem vínculo. **Nada entra no `bootstrapAppContainer`** (gotcha dos ~58 jobs): o `SupabaseAuthClient` é resolvido sob demanda e valida o próprio env.
- **`SupabaseAuthClient`:** HTTP simples + Zod nas respostas, sem `@supabase/supabase-js`, `@singleton() @injectable()`, em `domain/client/`.
- **`AUTH_PROVIDER=local|supabase`** (default `local`): a troca de modo e o rollback são só configuração.
- **Rate limiter próprio** por IP e por identificador em `/auth/login`, e por IP em `/auth/refresh` (o GoTrue vê todo login vindo do IP do Render).
- **Front sem chave do Supabase (I6):** guarda `refreshToken` e `expiresAt`, renova ~5 min antes do `exp` e uma vez em 401; o `SessionExpiredModal` só aparece se a renovação falhar. Login por username continua (o proxy resolve para e-mail). `useRole()`, `decodeJwtRole` e o fallback D4 do `PermissoesProvider` saem.
- **O backend não lê nem escreve o schema `auth` por SQL (I7).** A única exceção possível é o fallback do T-1 (import por `INSERT` feito pelo job), e só se o T-1 provar que a API admin não aceita `password_hash` no create.
- `DEV_AUTH_BYPASS` continua sendo o usuário fictício com tudo, sem Supabase (R12).
- Mensagens ao operador (HTTP, log, relatório do job) em português; classes de erro e identificadores em inglês.

Decisões tomadas neste scoping (conferir no review; ver "Riscos e ambiguidades"):

- **D1 — `/auth/refresh` em modo `local` responde 401** `{ error: 'Sessão expirada. Entre novamente.' }` sem chamar o GoTrue. Rollback por configuração precisa cortar as sessões Supabase na renovação, senão elas se renovariam para sempre depois do rollback. O access token Supabase já emitido continua valendo até o `exp` (≤ 1 h), como a entrevista prevê.
- **D2 — `/auth/logout` fica no router `/auth`, com o verificador de token aplicado só nessa rota e SEM `resolverAcesso`**: usuário desativado também consegue encerrar a sessão. Resposta sempre **204** (idempotente). Token do emissor `app` (HS256) = no-op 204 (não há o que revogar). Token `supabase` = GoTrue `POST /logout?scope=local` com o próprio token; falha do GoTrue vira `LogService.warn` e o 204 sai assim mesmo (o front descarta o token de qualquer forma).
- **D3 — O espelhamento no GoTrue liga quando a API admin está configurada** (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`), independentemente de `AUTH_PROVIDER`. Sem essa configuração (dev local sem Supabase), as escritas são só locais. Com ela, para usuário **sem** `auth_user_id`: redefinir senha, trocar e-mail e desativar são só locais (o sync importa depois, com o hash e o e-mail atuais); criar e reativar criam no GoTrue e vinculam.
- **D4 — Limites do rate limiter:** `/auth/login` **20/min por IP** e **10 falhas / 15 min por identificador** (só falhas contam); `/auth/refresh` **30/min por IP**. O exemplo da entrevista (5/min por IP) trancaria o escritório da Columbia, que sai por um IP só (NAT), numa manhã em que meia dúzia de pessoas loga no mesmo minuto. 429 com `{ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }`.
- **D5 — Respostas do login em modo `supabase`:** identificador inexistente, inativo, ambíguo, sem vínculo, sem e-mail, senha errada ou usuário banido no GoTrue = o **mesmo 401** `'Credenciais inválidas'`. GoTrue fora do ar / 5xx / timeout = **503** `'Serviço de autenticação indisponível. Tente novamente em instantes.'`. GoTrue 429 = o mesmo 429 do D4. Usuário **ativo no nosso banco e banido no GoTrue** = 401 + `LogService.error` "divergência: rode o sync".
- **D6 — Nomes de env:** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `AUTH_PROVIDER`. Os valores podem ser as chaves novas (`sb_publishable_…`/`sb_secret_…`) ou as legadas (anon/service_role JWT). A leitura hoje sem consumidor de `SUPABASE_SERVICE_ROLE_KEY` (`EnvironmentProvider.ts:209,296`) é substituída pela de `SUPABASE_SECRET_KEY`.
- **D7 — Matriz de boot (fail-fast, mensagem em português):** `AUTH_PROVIDER=local` exige `AUTH_JWT_SECRET` (é quem assina). `AUTH_PROVIDER=supabase` exige `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`; `AUTH_JWT_SECRET` é opcional (a presença dele só mantém o caminho HS256 aberto). Valor fora de `local|supabase` derruba o boot. Com `DEV_AUTH_BYPASS` (só local/dev) nada disso é exigido.
- **D8 — O bloco de grants da 0067 é condicionado à existência dos roles** (`DO $$ ... IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') ...`). No Postgres descartável do QA e do `test:sql` não existem `anon`/`authenticated`, e a migration não pode falhar lá. O `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` também é condicionado ao role `postgres` existir.
- **D9 — Sem script de reverse para a 0067.** A coluna é aditiva e anulável (o backend antigo a ignora) e os grants revogados não devem voltar. `rollbacks.test.ts` não muda.
- **D10 — Formato do login:** modo `supabase` devolve `{ token, refreshToken, expiresAt, username, role, email }` (`expiresAt` em segundos desde a época, do GoTrue); modo `local` devolve o formato de hoje (sem `refreshToken`). `role` (de `app_user.role`) fica até o tweak de limpeza por compatibilidade; nenhum guard o lê. `/auth/refresh` devolve o mesmo formato do login `supabase`.
- **D11 — O T-1 vira um probe local** (`jobs/probe-gotrue-local.ts`) que **recusa rodar** se `SUPABASE_URL` não for `localhost`/`127.0.0.1`. O mesmo probe serve de fumaça para o QA.
- **D12 — Renovação coordenada entre abas no front:** single-flight dentro da aba e entre abas (`navigator.locks` quando existir; senão, reler o `localStorage` antes de renovar e adotar o token de outra aba se o `expiresAt` já avançou), mais o evento `storage` para sincronizar abas. Sem isso, uma aba que acorda com o refresh token já rotacionado por outra dispara a detecção de reuso do GoTrue e derruba a sessão das duas.
- **D13 — Cache do `AccessService` com chave prefixada pelo tipo** (`username:<lower>` / `auth:<uuid>`); `invalidar(userId)` limpa as entradas dos dois tipos daquele usuário.
- **D14 — Sequência de env no corte:** `SUPABASE_URL` só entra no Render **depois** que o backend novo está no ar. O código antigo tem o defeito do `issuer` compartilhado: com `SUPABASE_URL` definida, ele recusa todo token HS256 atual (todo mundo deslogado). Pelo mesmo motivo, **todo rollback de código para ≤ v0.44 exige remover `SUPABASE_URL` antes**.
- **D15 — Ban no GoTrue = `ban_duration: '876000h'`** (~100 anos); desbanir = `ban_duration: 'none'`.

## Plano de Validação Ground-Truth

**Veredito: `SEM_GROUND_TRUTH`.** A feature não calcula valor monetário e não lê nem escreve no Conexos, na Nexxera ou no GED. Os gates que se aplicam são: **invariância de identidade** (I2: toda escrita grava `username`, coberta pelos testes da Task 6 com token Supabase e pelo passo 7 do roteiro de QA), **invariância de acesso no corte** (os 12 ativos entram com a mesma senha, Task 11 + passos 12–13 do QA) e **rollback por configuração** (passo 16 do QA).

## Task list

### Task 1: Spike T-1: a API admin do GoTrue aceita `password_hash` no create e no update?

**Files to change:**
- `src/backend/jobs/probe-gotrue-local.ts` (novo; probe no padrão dos `probe-*.ts`, fora do `bootstrapAppContainer`, sem banco)
- `ontology/_inbox/auth-supabase-interview.md` (acrescenta a seção "Resultado do T-1", com versões e saídas)

**Acceptance criteria:**
- [ ] **Não toca produção.** O probe roda contra o GoTrue do `supabase start` (CLI) numa pasta temporária fora do repositório (`/tmp/fin-supabase-t1`, `supabase init` + `supabase start`); nenhuma pasta `supabase/` é commitada. O probe aborta com mensagem em português se `SUPABASE_URL` não for `http://127.0.0.1:*` ou `http://localhost:*`
- [ ] A versão do GoTrue local é registrada (`GET /auth/v1/health`). A do projeto é obtida **sem credencial e sem escrita**: pelo mesmo `GET /auth/v1/health` público do projeto (só leitura) **ou**, se o dono preferir zero contato, pelo changelog/fonte do `supabase/auth`. A CLI instalada na máquina (2.12.1) **não é atualizada**: o spike e o QA usam uma versão recente fixada via `npx supabase@<versão>` na pasta temporária (decisão do orquestrador, sem mexer no sistema do dono); se o GoTrue local ainda for mais antigo que o do projeto, fixar a imagem do GoTrue na versão do projeto antes de concluir
- [ ] Com cadastro público **desligado** no `config.toml` local (`enable_signup = false`, `enable_anonymous_sign_ins = false`), o probe verifica e imprime, um veredito por linha:
  1. `POST /admin/users { email, password_hash: '$2a$12$…', email_confirm: true }` cria o usuário (hash gerado por `bcryptjs` com custo 12, formato idêntico ao de produção)
  2. `POST /token?grant_type=password` com a senha original **entra** (prova que o hash `$2a$` foi aceito como está)
  3. `PUT /admin/users/:id { password_hash }` troca a senha; a nova entra e a antiga falha
  4. `PUT /admin/users/:id { email, email_confirm: true }` troca o e-mail **sem** e-mail de confirmação (Mailpit/Inbucket local vazio) e o login com o e-mail novo entra
  5. `ban_duration: '876000h'` impede login e refresh; `'none'` libera
  6. `POST /logout?scope=local` com o access token revoga o refresh token daquela sessão
  7. refresh com token já rotacionado, fora da janela de reuso, derruba a sessão (documenta o risco do D12)
  8. o access token emitido é **ES256** e verifica contra `/.well-known/jwks.json` com `iss`/`aud`/`role`/`is_anonymous` esperados. Se a CLI local assinar HS256, configurar `signing_keys_path` com chave ES256 (`supabase gen signing-key`) e registrar o passo
  9. cabeçalhos: qual combinação (`apikey` e/ou `Authorization: Bearer`) a API admin aceita com a chave secreta local. Se a CLI local só tiver chaves legadas, registrar que o formato `sb_secret_…` fica para a verificação do passo 12 do corte
- [ ] **Fallback documentado** na seção "Resultado do T-1", decidido pelo resultado:
  - update não aceita `password_hash` → a redefinição de senha envia `password` em claro ao GoTrue (TLS backend → Supabase) e continua gravando o bcrypt local (Task 9 ajusta o critério)
  - create não aceita `password_hash` → o job (Task 11) importa por `INSERT` em `auth.users`/`auth.identities`, **só no job**, como exceção documentada à I7 na ADR 0054; o probe registra o formato mínimo de linha aceito pela versão do projeto
- [ ] **Sinalizar se precisar do projeto real:** só se a versão do GoTrue do projeto não puder ser reproduzida localmente. Nesse caso a Task para e pede ao dono um teste com um usuário descartável (`t1-probe@kavex.at`), criado e apagado pela API admin, com OK explícito
- [ ] `npm run typecheck` e `npm run lint` verdes com o probe

**Dependencies:** none

---

### Task 2: Migration 0067: `app_user.auth_user_id` + limpeza de grants do `public`

**Files to change:**
- `src/backend/migrations/0067_app_user_auth_user_id.sql` (novo)
- `src/backend/migrations/0067_app_user_auth_user_id.test.ts` (novo; asserções sobre o fonte, padrão de `0064_app_user_email.test.ts`)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `0067_app_user_auth_user_id.test.ts` escrito e falhando antes de existir o `.sql`
- [ ] `ALTER TABLE app_user ADD COLUMN IF NOT EXISTS auth_user_id UUID NULL` e `CREATE UNIQUE INDEX IF NOT EXISTS ... ON app_user (auth_user_id) WHERE auth_user_id IS NOT NULL`. Sem `NOT NULL`, sem `DEFAULT`, sem backfill (o teste recusa `UPDATE app_user`): segura para o backend antigo, que os crons podem encontrar no ar depois de aplicarem a migration
- [ ] Bloco de grants dentro de `DO $$ ... $$` condicionado a `pg_roles` (D8): para cada tabela de `public` (via `pg_tables`/`format('%I')`, sem interpolar valor externo), `REVOKE TRUNCATE, REFERENCES, TRIGGER ON ... FROM anon, authenticated`; e `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated`. O teste verifica as duas instruções e a condição de existência dos roles
- [ ] A migration **não** concede nada a ninguém (o teste recusa `GRANT`) e **não** toca o schema `auth` (o teste recusa `auth.`)
- [ ] Idempotente: rodar duas vezes não falha
- [ ] Sem reverse (D9): `rollbacks.test.ts` sem mudança
- [ ] `npm run build` copia o `.sql`: o log `[build] N migração(ões) copiada(s)` conta uma a mais que na `main` (gotcha do `BootMigrator`)
- [ ] Verificado à mão (roteiro de QA, passo 1): aplica num Postgres 16 puro (sem os roles) e no Postgres do `supabase start` (com os roles); depois, `anon`/`authenticated` não têm `TRUNCATE/REFERENCES/TRIGGER` em nenhuma tabela de `public` e uma tabela nova criada por `postgres` também não

**Dependencies:** none

---

### Task 3: Configuração: `AUTH_PROVIDER`, chaves do Supabase, `authEnv` e saída do banner de transição

**Files to change:**
- `src/backend/http/authEnv.ts`
- `src/backend/http/authEnv.test.ts`
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts` (entram `authProvider`, `supabasePublishableKey`, `supabaseSecretKey`; saem `supabaseServiceRoleKey` e `authTransicaoEmailBanner`)
- `src/backend/domain/libs/environment/EnvironmentProvider.ts` (os dois caminhos: env local/Render e SSM/Lambda)
- `src/backend/domain/libs/environment/EnvironmentProvider.test.ts`
- `src/backend/domain/interface/operacao/configManifest.ts` (entradas novas; `AUTH_JWT_SECRET` passa a "obrigatória em modo local"; sai `AUTH_TRANSICAO_EMAIL_BANNER`)
- `src/backend/domain/service/operacao/ConfigDoctor.test.ts` (se referenciar as vars)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): casos novos em `authEnv.test.ts` e `EnvironmentProvider.test.ts` escritos antes
- [ ] `AuthEnv` passa a expor `{ provider: 'local' | 'supabase', appJwtSecret?, supabaseUrl?, devBypass }`, validado por Zod. `SUPABASE_JWT_SECRET` **não é mais lido** (teste: com só `SUPABASE_JWT_SECRET` definida e sem bypass, o boot falha)
- [ ] Matriz do D7, um teste por linha: `local` sem `AUTH_JWT_SECRET` → erro; `supabase` sem `SUPABASE_URL`, sem `SUPABASE_PUBLISHABLE_KEY` ou sem `SUPABASE_SECRET_KEY` → erro; `supabase` sem `AUTH_JWT_SECRET` → ok; `AUTH_PROVIDER=xyz` → erro; ausente → `local`; bypass em ambiente não local continua derrubando o boot (trava do passo 2 intacta)
- [ ] As mensagens de erro de boot são em português e nomeiam a variável que falta, **sem** imprimir valores
- [ ] `grep -rn "AUTH_TRANSICAO_EMAIL_BANNER\|authTransicaoEmailBanner\|SUPABASE_SERVICE_ROLE_KEY\|supabaseServiceRoleKey" src/backend` vazio
- [ ] `configManifest`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (secreta, nunca exibida) e `AUTH_PROVIDER` com descrição em português; o ConfigDoctor acusa `AUTH_PROVIDER=supabase` sem as chaves. Nada disso entra no `bootstrapAppContainer`
- [ ] Nenhum `process.env` cru fora do `authEnv` (boundary) e do `EnvironmentProvider`

**Dependencies:** none

---

### Task 4: `SupabaseAuthClient`: HTTP + Zod para o GoTrue (público e admin)

**Files to change:**
- `src/backend/domain/client/SupabaseAuthClient.ts` (novo, `@singleton() @injectable()`)
- `src/backend/domain/client/SupabaseAuthClient.test.ts` (novo; `fetch`/axios mockado, sem rede)
- `src/backend/domain/interface/auth/SupabaseAuth.ts` (novo: schemas Zod das respostas, tipos `SupabaseSession`, `SupabaseAdminUser`)
- `src/backend/domain/errors/SupabaseAuthUnavailableError.ts`, `SupabaseAuthRejectedError.ts`, `SupabaseEmailConflictError.ts` (novos)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `SupabaseAuthClient.test.ts` escrito antes
- [ ] Métodos (arrow, modificadores explícitos): `signInWithPassword(email, password)`, `refresh(refreshToken)`, `logout(accessToken)`, `adminCreateUser({ email, passwordHash, banned })`, `adminUpdateUser(id, { email?, passwordHash?, banned? })`, `adminGetUser(id)`, `adminFindUserByEmail(email)` (paginado sobre `GET /admin/users`; com ~15 usuários, uma página)
- [ ] Cabeçalhos conforme o resultado do T-1: `apikey` com a chave publicável nos endpoints públicos; chave secreta nos admin. A chave secreta nunca aparece em log nem em mensagem de erro (teste: o erro serializado não contém a chave)
- [ ] Toda resposta passa por Zod. Resposta 2xx fora do formato = `SupabaseAuthUnavailableError` com mensagem em português (não "sucesso parcial")
- [ ] Mapeamento de erros: 400/401/403 de credencial (inclusive `user_banned`, `invalid_grant`) → `SupabaseAuthRejectedError` com o `code` do GoTrue; 422 de e-mail já usado → `SupabaseEmailConflictError`; 429 → erro com `retryable=false` e marca de limite; 5xx, rede e timeout → `SupabaseAuthUnavailableError`
- [ ] Timeout por chamada (constante nomeada, ex.: 10 s) via `AbortSignal`, sem laço de `setTimeout`. **Nenhum retry em escrita admin** (create não é idempotente); leitura admin pode usar o `RetryExecutor`
- [ ] Env lido pelo `EnvironmentProvider` na primeira chamada, não no construtor e não no `bootstrapAppContainer`. Sem configuração → erro em português "Supabase Auth não configurado" (quem chama decide o que fazer, D3). `isAdminConfigured()` exposto para o D3
- [ ] Nenhum `@supabase/*` no `package.json` (teste sobre o fonte ou checagem no review); nenhum SQL no schema `auth` (I7)
- [ ] `appContainer.ts` sem diff em relação à `main` (teste sobre o fonte: não referencia `SupabaseAuthClient`)

**Dependencies:** Task 1 (cabeçalhos e campos aceitos), Task 3

---

### Task 5: Middleware de auth: dois verificadores com opções próprias e marca do emissor

**Files to change:**
- `src/backend/http/auth.ts`
- `src/backend/http/auth.test.ts`
- `src/backend/http/buildApp.ts` (passa o `AuthEnv` novo; expõe o verificador para a rota de logout, D2)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): casos novos em `auth.test.ts`, com chave ES256 local injetada pelo `keyResolver` existente (nada de rede)
- [ ] Opções **separadas por caminho**: o `issuer` só vale no caminho Supabase. Teste de regressão do defeito latente: com `SUPABASE_URL` **e** `AUTH_JWT_SECRET` configurados, um token HS256 próprio (sem `iss`) **passa**
- [ ] Caminho Supabase: `algorithms: ['ES256']`, `issuer = ${SUPABASE_URL}/auth/v1`, `audience = 'authenticated'`, e checagens extras de payload `role === 'authenticated'` e `is_anonymous !== true`. Um teste de recusa (401) para cada: `iss` errado, `aud` errado, `role = 'anon'`, `is_anonymous = true`, assinatura de outra chave, expirado, `alg: none`
- [ ] Caminho app: `algorithms: ['HS256']`, `audience = 'authenticated'`, chave = `AUTH_JWT_SECRET`. Sem `AUTH_JWT_SECRET` configurado, **todo** token HS256 é 401 (teste: o mesmo token que passava com o segredo agora é recusado). `SUPABASE_JWT_SECRET` definida não reabre o caminho
- [ ] `req.user` ganha `emissor: 'app' | 'supabase'`. O `sub` é o do token (username no `app`, UUID no `supabase`); `email` e `role` do token **não** são mais copiados para `req.user` (quem precisa deles é só o log)
- [ ] O verificador é exportado como função reutilizável (`verifyAccessToken`) para a rota de logout (D2), com o mesmo comportamento do middleware
- [ ] Mensagens de 401 inalteradas para o front (`'Token expired'` / `'Invalid token'`); log de recusa em português sem o token

**Dependencies:** Task 3

---

### Task 6: Mapeamento de identidade: `resolverAcesso` por emissor e `req.user.sub = username`

**Files to change:**
- `src/backend/domain/repository/auth/AccessRepository.ts` (`findAccessByAuthUserId`)
- `src/backend/domain/repository/auth/AccessRepository.test.ts`
- `src/backend/domain/service/auth/AccessService.ts` (`resolver({ tipo: 'username' | 'authUserId', valor })`, cache prefixado, D13)
- `src/backend/domain/service/auth/AccessService.test.ts`
- `src/backend/http/acesso.ts`
- `src/backend/http/acesso.test.ts`
- `src/backend/routes/recebimentos.ts` (`:735`, `:935`, `:975` viram `sub ?? email`)
- `src/backend/routes/recebimentos.test.ts` (ou `recebimentos.identidade.test.ts` novo)
- `src/backend/http/identidade.supabase.test.ts` (novo: cadeia completa auth → acesso → identidade Conexos com token Supabase)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): todos os testes abaixo escritos antes
- [ ] `findAccessByAuthUserId(uuid)`: uma ida ao banco, SQL parametrizado (`WHERE auth_user_id = $1`), mesmo formato de `findAccessBySub`. UUID malformado é recusado por Zod antes do SQL (401, sem consulta)
- [ ] `AccessService.resolver` recebe `{ tipo, valor }`; cache de 30 s com chave `username:<lower>` / `auth:<uuid>`; `invalidar(userId)` derruba as duas entradas daquele usuário (teste: resolve pelos dois tipos, invalida, as duas vão ao banco)
- [ ] `resolverAcesso`: emissor `app` → busca por `username` (como hoje); emissor `supabase` → busca por `auth_user_id`. Depois de resolver, **reescreve** `req.user = { sub: acesso.username, authUserId?, filiais? }`, sem `email`, sem `role`, sem o UUID no `sub`
- [ ] Token Supabase cujo `sub` não casa nenhum `app_user` → 401 com a mensagem de sessão encerrada + `LogService.error` em português "divergência de vínculo: rode o sync-supabase-auth" com o UUID (I3). Nunca cria usuário
- [ ] Inativo por qualquer dos dois caminhos → 401 (I4); falha de banco → 503 fail-closed (inalterado)
- [ ] `DEV_AUTH_BYPASS` inalterado (usuário fictício, sem banco, sem Supabase)
- [ ] **Gate de identidade I2** em `identidade.supabase.test.ts`, com token ES256 de `sub = <uuid>` e `email = 'x@columbiabr.com'` e o `app_user` `username = 'fulano'`: o `conexosIdentityMiddleware` recebe `sub = 'fulano'`; `GET /me/conexos-status` consulta o vínculo por `'fulano'`; o ator do `/usuarios` e o `executado_por`/`criado_por` de uma rota de Permutas mockada gravam `'fulano'`; o `triggeredBy` de `recebimentos` (`:735`, `:935`) e o `ator` do arquivar (`:975`) gravam `'fulano'`, nunca o e-mail nem o UUID
- [ ] `grep -n "email ?? req.user\|user?.email ??" src/backend/routes` vazio
- [ ] `routePermissions.test.ts` continua verde (nenhum guard muda)

**Dependencies:** Task 2, Task 5

---

### Task 7: Sessão por proxy: `POST /auth/login` (dois modos), `/auth/refresh`, `/auth/logout`; sai `/auth/transicao`

**Files to change:**
- `src/backend/domain/service/auth/SupabaseSessionService.ts` (novo, `@injectable()`: login, refresh, logout em modo `supabase`)
- `src/backend/domain/service/auth/SupabaseSessionService.test.ts` (novo; `SupabaseAuthClient` falso injetado)
- `src/backend/domain/service/auth/AuthService.ts` (modo `local`, sem mudança de comportamento; `LoginResult` ganha os campos opcionais do D10)
- `src/backend/domain/service/auth/AuthService.test.ts`
- `src/backend/domain/repository/auth/UserRepository.ts` (`findByLoginIdentifier` devolve também `email` e `auth_user_id`)
- `src/backend/domain/repository/auth/UserRepository.test.ts`
- `src/backend/routes/auth.ts` (vira fábrica `buildAuthRouter({ verificador })` se o D2 exigir)
- `src/backend/routes/auth.test.ts`
- `src/backend/http/buildApp.ts`
- `src/backend/http/buildApp.test.ts`
- `src/backend/http/routePermissions.test.ts` (lista de públicas: entram `/auth/refresh` e `/auth/logout`, sai `/auth/transicao`)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `SupabaseSessionService.test.ts` e os casos novos de `auth.test.ts` escritos antes
- [ ] O modo vem de `AUTH_PROVIDER` via `EnvironmentProvider`; a rota escolhe `AuthService` (local) ou `SupabaseSessionService` (supabase). Modo `local` = comportamento e payload de token de hoje (teste de regressão com `jose.decodeJwt`: `sub`, `role`, `aud`, `iat`, `exp`)
- [ ] Modo `supabase`, login: identificador (e-mail ou username, normalizado como hoje) → `findByLoginIdentifier` → recusa com o 401 genérico, **sem chamar o GoTrue**, quando: nenhum, mais de um (com o `LogService.error` de hoje), inativo, sem `auth_user_id`, sem e-mail. Senão, `signInWithPassword(email, password)`. Teste que prova, com o client falso, que o GoTrue **não** é chamado nesses casos
- [ ] Sucesso devolve `{ token, refreshToken, expiresAt, username, role, email }` (D10). **Checagem cruzada:** o `sub` da sessão devolvida pelo GoTrue tem de ser igual ao `auth_user_id` do usuário resolvido; senão 401 + `LogService.error` (divergência)
- [ ] Mapeamento de erro do D5, um teste por linha (senha errada, banido com `ativo = true` + log de divergência, 5xx → 503, timeout → 503, 429 → 429). O corpo do 401 é idêntico em todos os casos de credencial
- [ ] `kavex-report-ciclo`: teste com corpo `{ username: 'admin', password }` e username (não e-mail) passa e devolve `token` (contrato preservado)
- [ ] `POST /auth/refresh` (pública): corpo `{ refreshToken: string }` validado por Zod (400 `'Requisição inválida'`); modo `local` → 401 do D1 sem chamar o GoTrue; modo `supabase` → `refresh`; recusa do GoTrue → 401 `'Sessão expirada. Entre novamente.'`; indisponível → 503. **Não** checa `ativo` (a próxima requisição checa). Resposta no formato do login, com `username` e `email` resolvidos pelo `auth_user_id` da sessão nova; se não houver `app_user` → 401 + log de divergência
- [ ] `POST /auth/logout` (D2): sem Bearer → 204; token `app` válido → 204 sem chamar o GoTrue; token `supabase` válido → `logout(accessToken)` e 204; falha do GoTrue → `LogService.warn` + 204; token inválido → 204 sem chamada (nada a revogar). Não passa pelo `resolverAcesso`
- [ ] `GET /auth/transicao` removida; `buildApp.test.ts` atualizado (a rota passa a cair no auth: 401)
- [ ] Log de login/refresh/logout em português com `username` (nunca senha, nunca token, nunca refresh token). Teste sobre o que é logado
- [ ] Nenhum SQL no schema `auth`; nenhum `@supabase/*`

**Dependencies:** Task 4, Task 5, Task 6

---

### Task 8: Rate limiter próprio em `/auth/login` e `/auth/refresh`

**Files to change:**
- `src/backend/http/rateLimit.ts` (fábricas `buildLoginLimiters(options)` / `buildRefreshLimiter(options)` com `skip` e `store` injetáveis)
- `src/backend/http/rateLimit.test.ts` (novo)
- `src/backend/routes/auth.ts`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `rateLimit.test.ts` escrito antes. O `skipInTest` global continua valendo para o resto da suíte, mas as fábricas aceitam `skip: () => false` para que o teste exercite o limite de verdade
- [ ] `/auth/login`: 20/min por IP; 10 **falhas** / 15 min por identificador normalizado (`trim().toLowerCase()`; contagem com `skipSuccessfulRequests`), valores do D4 como constantes nomeadas. O limitador por identificador roda **depois** do parse do corpo; corpo inválido não consome o balde do identificador
- [ ] `/auth/refresh`: 30/min por IP
- [ ] 429 com `{ error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }` e cabeçalhos `RateLimit-*` (draft-7). Teste: a 21ª requisição do mesmo IP no mesmo minuto recebe 429; a 11ª falha do mesmo identificador, vinda de IPs diferentes (`X-Forwarded-For`, com `trust proxy = 1` como em produção), recebe 429; um login certo depois de 9 falhas não conta como falha
- [ ] O limitador por identificador vale nos dois modos (`local` também), e age **antes** de chamar o GoTrue (o balde do projeto fica protegido)
- [ ] `globalLimiter` inalterado

**Dependencies:** Task 7

---

### Task 9: Gestão de usuários espelhada no GoTrue (criar, senha, e-mail, ativo, reativar)

**Files to change:**
- `src/backend/domain/repository/auth/UserRepository.ts` (`auth_user_id` no `AppUser`; `setAuthUserId(tx, id, uuid)`; as escritas existentes aceitam um passo "antes do commit")
- `src/backend/domain/repository/auth/UserRepository.test.ts`
- `src/backend/domain/service/auth/UserAdminService.ts`
- `src/backend/domain/service/auth/UserAdminService.test.ts`
- `src/backend/domain/service/auth/CredentialMirror.ts` (novo, `@injectable()`: uma classe só decide "espelhar ou não" (D3) e traduz para o `SupabaseAuthClient`)
- `src/backend/domain/service/auth/CredentialMirror.test.ts` (novo)
- `src/backend/routes/usuarios.ts` (mapeamento de erros novos)
- `src/backend/routes/usuarios.test.ts`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes, com `SupabaseAuthClient` falso
- [ ] Padrão R6 em **todas** as escritas de credencial, provado por teste com a ordem das chamadas registrada: `BEGIN` → escrita local com a linha travada → chamada admin → `COMMIT`. GoTrue indisponível → `ROLLBACK` e 503 `'Serviço de autenticação indisponível; nada foi alterado.'`; o banco fica como estava (teste lê de volta)
- [ ] Falha no `COMMIT` depois de sucesso no GoTrue → `LogService.error` em português com `userId`, `authUserId` e a operação, mais o texto "o sync-supabase-auth repara" (teste com o `commit` lançando)
- [ ] **Criar:** bcrypt 12 local → `app_user` → `adminCreateUser({ email, passwordHash, banned: false })` → `setAuthUserId` → commit. E-mail já existente no GoTrue: se aquele usuário do GoTrue não está vinculado a nenhum `app_user`, **vincula** e atualiza o `password_hash`; se está vinculado a outro, 409 `'Já existe um acesso com este e-mail.'`. Sem configuração admin (D3) = só local
- [ ] **Redefinir senha (admin):** mesmo hash nos dois lados (R7); se o T-1 disser que o update não aceita `password_hash`, envia `password` ao GoTrue e grava o bcrypt local (critério ajustado pela Task 1). Sem vínculo = só local (D3)
- [ ] **Trocar e-mail:** `app_user.email` + `adminUpdateUser({ email })` com e-mail confirmado. Conflito no GoTrue → 409 com a mensagem de e-mail já usado; nada muda. Sem vínculo = só local
- [ ] **Desativar:** guarda R9 (inalterada) + `ativo = false` + ban (D15); `AccessService.invalidar` depois do commit (inalterado). Sem vínculo = só local. **Exceção à R6 (dono do ciclo, 2026-09-30):** se o ban falhar (GoTrue fora, 5xx, timeout), o `ativo = false` é comitado **mesmo assim**, a resposta é **200** (o corte vale pelo `ativo` em ≤ 30 s) e fica um `LogService.error` `AUTH_DIVERGENCIA` com o id; teste prova: ban falhando → linha com `ativo = false` lida de volta + log + 200
- [ ] O sync (Task 11) aplica o ban em todo usuário vinculado com `ativo = false` e sem ban no GoTrue (reconciliação já prevista); teste do sync cobre esse caso
- [ ] **Reativar:** com vínculo → desbanir; sem vínculo e com e-mail → `adminCreateUser` com o `password_hash` atual + vincula; sem vínculo e sem e-mail → 400 `'Cadastre um e-mail antes de reativar este usuário.'`, nada muda
- [ ] Nenhuma tela ou rota lê ou escreve `auth_user_id` pelo corpo da requisição (teste: `PATCH` com `auth_user_id` no corpo é ignorado/400)
- [ ] `GET /usuarios` não expõe `auth_user_id` nem `password_hash` (teste com `toEqual` nas chaves)
- [ ] Classes de erro novas em inglês; SQL parametrizado

**Dependencies:** Task 2, Task 4, Task 1 (fallback de senha)

---

### Task 10: `seed-admin` também faz upsert no Supabase

**Files to change:**
- `src/backend/jobs/seed-admin.ts`
- `src/backend/jobs/SeedAdminConfig.ts`
- `src/backend/jobs/SeedAdminConfig.test.ts`
- `src/backend/domain/service/auth/AdminSeeder.ts` (novo, `@injectable()`: a lógica testável que o script chama)
- `src/backend/domain/service/auth/AdminSeeder.test.ts` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `AdminSeeder.test.ts` escrito antes
- [ ] Com a API admin configurada: depois do upsert local, procura o usuário no GoTrue pelo vínculo ou pelo e-mail; cria (com o mesmo hash e e-mail confirmado) ou atualiza hash + desbane; grava `auth_user_id`. Rodar duas vezes não duplica (teste)
- [ ] Sem a API admin configurada e `AUTH_PROVIDER=local` (dev local): só local, com aviso em português "Supabase não configurado: admin criado só no banco". Com `AUTH_PROVIDER=supabase` e sem as chaves → sai com 1 e mensagem que nomeia a variável
- [ ] Falha do GoTrue → sai com 1; a linha local fica (o seed é reexecutável) e a mensagem diz para rodar de novo
- [ ] `bootstrapAppContainer` continua sendo só o do banco; o client é resolvido sob demanda

**Dependencies:** Task 4, Task 9

---

### Task 11: Job `sync-supabase-auth`: importação dos ativos e reparo de divergência

**Files to change:**
- `src/backend/jobs/sync-supabase-auth.ts` (novo; script fino)
- `src/backend/domain/service/auth/SupabaseAuthSyncService.ts` (novo, `@injectable()`: planeja e aplica)
- `src/backend/domain/service/auth/SupabaseAuthSyncService.test.ts` (novo)
- `src/backend/domain/repository/auth/UserRepository.ts` (`listForAuthSync()`)
- `src/backend/package.json` (script `job:sync-supabase-auth`)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `SupabaseAuthSyncService.test.ts` escrito antes, com client falso
- [ ] **Dry-run por default.** Só escreve com `--execute`. O dry-run imprime o plano e termina com "nada foi alterado (dry-run)"; o teste prova que nenhum método de escrita do client nem `setAuthUserId` é chamado
- [ ] Pré-checagens com mensagem em português e saída 1: coluna `auth_user_id` ausente ("aplique a migration 0067"); API admin não configurada; `SUPABASE_URL` apontando para um projeto diferente do esperado não é checado (não há como), então o relatório **imprime** a URL alvo no topo
- [ ] Plano por usuário, uma linha no relatório (username, e-mail, ação):
  - **ativo, com e-mail, sem vínculo** → procura no GoTrue por e-mail: existe e não está vinculado a outro `app_user` → **vincula** (e atualiza `password_hash`); não existe → **cria** com o `password_hash` atual e e-mail confirmado
  - **ativo, sem e-mail** → "ignorado: sem e-mail" (produção não tem nenhum; aparece se surgir)
  - **inativo sem vínculo** → "ignorado: inativo" (Q4 alterada; os 3 de produção caem aqui)
  - **com vínculo** → reconcilia: e-mail do GoTrue ≠ `app_user.email` → atualiza; `ativo = false` e não banido → bane; `ativo = true` e banido → desbane; vínculo apontando para usuário inexistente no GoTrue → "divergência: vínculo órfão" (reportado, não corrigido sozinho)
  - e-mail do GoTrue vinculado a **outro** `app_user` → "conflito" (reportado, não corrigido)
- [ ] **Idempotente:** segunda execução com `--execute` sobre o resultado da primeira = zero ações (teste). **Execução interrompida** (usuário criado no GoTrue, `auth_user_id` não gravado) é retomada vinculando, nunca duplicando (teste)
- [ ] Senha nunca aparece no relatório; hash também não
- [ ] Resumo final: criados, vinculados, reconciliados, ignorados, conflitos, falhas. Saída 1 se houver falha ou conflito; 0 caso contrário
- [ ] Cada usuário é aplicado em sua própria transação (uma falha não desfaz os anteriores) e falha de um usuário não interrompe os outros
- [ ] Nada no `bootstrapAppContainer` (teste sobre o fonte de `appContainer.ts`); `npm run build` emite `dist/jobs/sync-supabase-auth.js` e ele roda com `node` (é assim que se roda no Render Shell)
- [ ] Se o T-1 cair no fallback de `INSERT` direto: essa exceção à I7 fica **só** aqui, isolada numa classe própria, com comentário apontando a ADR 0054 e teste do SQL parametrizado

**Dependencies:** Task 2, Task 4, Task 9, Task 1

---

### Task 12: ObservabilityAdvisor: revisão do job `sync-supabase-auth` e dos eventos de sessão

**Files to change:**
- `src/backend/jobs/sync-supabase-auth.ts` (ajustes que a revisão pedir)
- `src/backend/domain/service/auth/SupabaseSessionService.ts` (idem)
- `src/backend/domain/client/SupabaseAuthClient.ts` (idem)

**Acceptance criteria:**
- [ ] ObservabilityAdvisor chamado com: o job novo `sync-supabase-auth` (manual, sem scheduler), os eventos de login/refresh/logout, as divergências (I3, banido-ativo, commit pós-GoTrue) e o 503 de GoTrue indisponível
- [ ] Toda divergência sai como `LogService.error` com um `type` estável e buscável (ex.: `AUTH_DIVERGENCIA`), em português, com ids e sem PII além de username/e-mail
- [ ] Falhas do GoTrue têm duração da chamada e status no log (sem corpo da resposta, que pode conter token)
- [ ] O painel de Operação/ConfigDoctor mostra `AUTH_PROVIDER` atual (sem segredo), para o operador saber em que modo está
- [ ] Recomendações que não couberem viram follow-up em `ontology/_inbox/auth-supabase-regis-followups.md`

**Dependencies:** Task 7, Task 11

---

### Task 13: Front, sessão: refresh token, renovação proativa, uma renovação em 401, coordenação entre abas

**Files to change:**
- `src/frontend/lib/auth/token.ts` (chaves `auth_refresh_token` e `auth_expires_at`; sai `decodeJwtRole`)
- `src/frontend/lib/auth/session-refresh.ts` (novo: `refreshSession()` single-flight com coordenação entre abas, D12)
- `src/frontend/lib/http.ts` (`apiFetch`: em 401, uma renovação e **um** novo envio com o `Authorization` trocado)
- `src/frontend/lib/auth/AuthProvider.tsx` (agenda a renovação ~5 min antes do `exp`; guarda e limpa os campos novos; sai `useRole`)
- `src/frontend/__tests__/auth/session-refresh.test.ts` (novo)
- `src/frontend/__tests__/auth/api-fetch-refresh.test.ts` (novo)
- `src/frontend/__tests__/auth/decode-jwt-exp.test.ts` (sai o caso de `decodeJwtRole`)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): testes escritos antes, com `fetch` mockado e relógio falso (sem esperar tempo real)
- [ ] Login guarda `token`, `refreshToken`, `expiresAt` e `username`. **Resposta sem `refreshToken`** (backend antigo ou modo `local`) → comportamento de hoje: sem renovação, modal no `exp` (teste com o corpo antigo exato)
- [ ] Renovação proativa ~5 min antes do `expiresAt` (constante nomeada); sucesso troca os três valores sem nenhum efeito visível. Falha da renovação proativa **não** abre o modal por si só; o modal abre quando o token de fato expira ou quando o 401 não se resolve
- [ ] `apiFetch` em 401: chama `refreshSession()` **uma vez** e reenvia a requisição **uma vez** com o novo `Authorization` (o cabeçalho antigo, montado pelo chamador, é substituído). Segundo 401 ou renovação falhando → `emitSessionExpired()` + `SessionExpiredError` (comportamento de hoje). Teste: 3 requisições simultâneas com 401 disparam **uma** renovação só
- [ ] Coordenação entre abas (D12): renovação sob `navigator.locks` quando disponível; antes de renovar, relê o `localStorage` e adota o token se outra aba já renovou (`expiresAt` avançou); evento `storage` atualiza o estado da aba (e o logout numa aba desloga as outras). Teste com duas instâncias simuladas compartilhando o storage: só uma chamada a `/auth/refresh`
- [ ] `/auth/refresh` chamado com `fetch` puro (nunca `apiFetch`, para não entrar em laço)
- [ ] `devBypass` inalterado: nenhuma renovação, nenhum storage novo
- [ ] Nenhuma chave nem URL do Supabase no front (`grep -rni "supabase" src/frontend --include=*.ts --include=*.tsx` só acha comentários, se algum)

**Dependencies:** Task 7

---

### Task 14: Front, tela de login, "Sair" e modal: sai o banner de transição e o fallback D4

**Files to change:**
- `src/frontend/app/login/page.tsx`
- `src/frontend/app/login/TransicaoEmailBanner.tsx` (**removido**)
- `src/frontend/lib/auth/transicao.ts` (**removido**)
- `src/frontend/__tests__/auth/transicao.test.ts` (**removido**)
- `src/frontend/__tests__/auth/login-page.test.tsx`
- `src/frontend/components/auth/UserMenu.tsx` e `src/frontend/lib/auth/AuthProvider.tsx` (`signOut` chama `POST /auth/logout`)
- `src/frontend/components/auth/SessionExpiredModal.tsx` (só abre quando a renovação falhou)
- `src/frontend/lib/auth/PermissoesProvider.tsx` (sai o fallback D4 e o uso de `useRole`)
- `src/frontend/__tests__/auth/permissoes-provider.test.tsx`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): casos novos escritos antes
- [ ] A tela de login continua aceitando "e-mail ou usuário" (rótulo e placeholder de hoje); o banner de transição e a chamada a `/auth/transicao` somem (`grep -rn "transicao\|Transicao" src/frontend` vazio fora de comentários de histórico)
- [ ] Mensagens da tela: 401 → "E-mail/usuário ou senha inválidos." (texto atual); 429 → a mensagem do backend; 503 → a mensagem do backend. Teste por status
- [ ] "Sair": chama `POST /auth/logout` com o token atual (melhor esforço, não bloqueia), limpa `token`, `refreshToken`, `expiresAt`, `username` e navega para `/login`. Falha de rede no logout não impede sair (teste)
- [ ] `SessionExpiredModal` não aparece enquanto a renovação resolver o 401 (teste com `apiFetch` renovando com sucesso); aparece quando a renovação falha
- [ ] `useRole`, `decodeJwtRole` e o ramo `legado` do `PermissoesProvider` não existem mais (`grep -rn "useRole\|decodeJwtRole\|legado" src/frontend/lib` vazio). Resposta de `/me/permissoes` sem o array → conjunto vazio (fail-closed), não mais "tudo para admin"
- [ ] Tokens semânticos do DS, light e dark, textos em português

**Dependencies:** Task 13

---

### Task 15: Docs de deploy e env: runbook de corte, rollback, `render.yaml`, `.env.example`

**Files to change:**
- `DEPLOY.md` (seção nova "6. Supabase Auth (v0.45, ADR-0054)", com o corte e o rollback desta tasks.md)
- `render.yaml`
- `src/backend/.env.example`

**Acceptance criteria:**
- [ ] `DEPLOY.md` traz, na íntegra, o **Runbook de corte** e o **Runbook de rollback** abaixo (seções "Runbook de corte" e "Runbook de rollback"), com a advertência do D14 em destaque
- [ ] `render.yaml`: entram `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (`sync: false`) e `AUTH_PROVIDER` (`value: local`); sai `AUTH_TRANSICAO_EMAIL_BANNER`; `AUTH_JWT_SECRET` ganha comentário "apagar no passo 8 do corte"
- [ ] `.env.example`: mesmas vars, com comentário em português dizendo que `SUPABASE_SECRET_KEY` dá poder de admin sobre todos os logins e nunca vai para o front nem para o Vercel; sai `SUPABASE_JWT_SECRET` e o banner; `DEV_AUTH_BYPASS` inalterado
- [ ] Seção de env dos jobs: GitHub Actions **sem mudança** (nenhum cron precisa do Supabase Auth); `seed-admin` e `sync-supabase-auth` são manuais e precisam de `databaseConnectionString`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`. Vercel: **nenhuma** variável nova
- [ ] `grep -rn "AUTH_TRANSICAO_EMAIL_BANNER\|SUPABASE_JWT_SECRET" --exclude-dir=node_modules . ` só acha `ontology/_inbox`, `ontology/decisions` e `docs/regis-review`
- [ ] Registra que o `kavex-report-ciclo` não muda (mesmo `POST /auth/login`, token de 1 h basta) e que aposentar a conta `admin` continua exigindo trocar `FINANCEIRO_API_USUARIO` antes

**Dependencies:** Task 3, Task 7, Task 11

---

### Task 16: ADR 0054: Supabase Auth no mesmo projeto, `username` como identidade para sempre

**Files to change:**
- `ontology/decisions/0054-auth-supabase-mesmo-projeto.md` (novo; via OntologyCurator, sem diff de entidade)
- `ontology/decisions/0051-auth-email-real-sub-continua-username.md` (nota "D2 emendada pela ADR-0054" no topo)
- `ontology/decisions/0053-auth-permissoes-por-modulo-no-banco.md` (nota "continuada pela ADR-0054")
- `ontology/CHANGELOG.md` (entrada, se for o costume para ADR sem diff de entidade)

**Acceptance criteria:**
- [ ] **Emenda a ADR-0051 D2:** "`sub = username` até o passo 3" vira "`req.user.sub = username` para sempre; o `sub` do token Supabase é o UUID e é traduzido no `resolverAcesso`"
- [ ] **Continua a ADR-0053:** a chave de lookup muda só na metade `token → app_user` (`auth_user_id`); permissões continuam no banco (I1)
- [ ] Registra: proxy no backend (Q2) e por quê; verificação por emissor (I8) e o defeito latente corrigido; `AUTH_PROVIDER` e a janela de ≥ 12 h; R6/R7 (hash nos dois lados); ban como defesa em profundidade; a verificação do Q1 (RLS ligada em 44 tabelas, 0 políticas, sem SELECT para `anon`/`authenticated`) e a limpeza de grants da 0067; Q4 alterada (só ativos; apagar os 3 inativos é operação à parte); o resultado do T-1 e, se houver, a exceção à I7; D1–D15 deste scoping; o que o tweak de limpeza vai remover
- [ ] Número 0054 reconferido contra a `main` no rebase; nenhum arquivo em `ontology/entities/` muda

**Dependencies:** Task 1

---

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (backend **e** frontend)
- [ ] `npm run lint` ✅ (backend **e** frontend; no frontend o gate é o `lint`, não o `prettier --check`)
- [ ] `npm test` ✅ (backend **e** frontend), incluindo `routePermissions.test.ts` e o gate de identidade da Task 6
- [ ] PatternGuardian gate ✅ (`@singleton() @injectable()` no `SupabaseAuthClient`, Zod nas bordas e nas respostas do GoTrue, SQL parametrizado, sem `process.env` cru em service, métodos arrow, modificadores explícitos, classes exportadas). Conferir P0 contra a `main`: o agente revisa o arquivo inteiro
- [ ] SpecVerifier: todos os critérios acima aprovados
- [ ] `bootstrapAppContainer` sem diff (gotcha dos ~58 jobs) ✅
- [ ] Nenhum `@supabase/*` em `package.json` (front e back); nenhum SQL no schema `auth` fora da exceção eventual do T-1 ✅
- [ ] [entity_changed=false] sem diff de entidade; só a ADR 0054 e as notas nas ADRs 0051/0053 ✅
- [ ] [frontend touched] DesignSystemReviewer gate ✅ (tela de login, `SessionExpiredModal`, `UserMenu`)
- [ ] [new job] ObservabilityAdvisor review ✅ (Task 12: `sync-supabase-auth`)
- [ ] [infra/] não se aplica: não existe `infra/`. AwsInfraArchitect não é acionado
- [ ] Roteiro de QA manual abaixo executado localmente e anotado no PR (passos que falharem = gate vermelho)
- [ ] Regis-Review rodado (os `qa-*` com `model=sonnet`); **P0 remediados**; P1/P2/P3 vão para `auth-supabase-regis-followups.md`
- [ ] Rebase de `origin/main` limpo e gates ainda verdes; número da migration (0067) e da ADR (0054) reconferidos
- [ ] [delta com feat em `src/`] versão do app bumpada (minor → v0.45.0, FE+BE em lockstep) **à mão** nos dois `package.json` (não há `pwsh` nesta máquina), conferindo antes a versão real da `main`, + `CHANGELOG.md` atualizado ✅
- [ ] Runbooks de corte e rollback no `DEPLOY.md` e resumidos no PR. **O merge não liga nada:** o corte é uma sequência manual do dono do ciclo

## Runbook de corte (produção)

Projeto: `kngrpoqzaxtuzkcugsyl` (sa-east-1). Quem executa: dono do ciclo. Cada passo tem uma verificação; verificação falhando = parar e seguir o rollback da fase.

**Passo 0 — Painel do Supabase (antes do merge, não muda nada para ninguém)**
1. Authentication → Sign In / Providers: **"Allow new users to sign up" = OFF**; **"Allow anonymous sign-ins" = OFF**; provedor **Email = ON** (é o que aceita senha). "Confirm email" pode ficar como está (a importação cria e-mails já confirmados).
2. Authentication → Sessions / JWT: validade do access token **3600 s** (default); **rotação de refresh token ON**, intervalo de reuso no default (10 s).
3. Authentication → Rate Limits: limites de sign-in e de refresh de token por IP **acima** dos nossos (todo tráfego vem do IP do Render): no mínimo 150 sign-ins / 5 min e 300 refreshes / 5 min. Anotar os valores antigos.
4. Settings → API Keys: copiar a **publishable key** (`sb_publishable_…`); criar uma **secret key** dedicada `financeiro-backend-render` (`sb_secret_…`). Ela vai só para o Render e para quem roda os jobs manuais; nunca para o Vercel, nunca em chat.
5. (Recomendado, defesa em profundidade) Settings → Data API: desligar a Data API, ou tirar `public` de "Exposed schemas". O código não usa `/rest/v1` em lugar nenhum. A verificação do Q1 mostrou que ela já não lê nada das nossas tabelas.
6. Conferir: `SUPABASE_URL`, `SUPABASE_JWT_SECRET` **não** estão definidas no Render hoje (D14). Se `SUPABASE_URL` estiver, **não mexer antes do passo 2**.

**Passo 1 — Merge e deploy, sem nenhuma env nova (modo `local`)**
- Merge do PR. O Render sobe o backend novo (o `BootMigrator` aplica a 0067 se um cron não a tiver aplicado antes; os dois caminhos são seguros para o código antigo). O Vercel sobe o front novo (tolera o backend antigo: resposta sem `refreshToken`).
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

## Runbook de rollback

| Fase em que o problema aparece | O que fazer | Efeito para o usuário |
|---|---|---|
| Passo 1 (código novo, sem env) | Render → "Rollback" para o deploy anterior. A 0067 é aditiva e anulável; o código antigo a ignora. `SUPABASE_URL` não está definida, então o defeito do `issuer` não dispara | Nenhum (tokens HS256 continuam válidos) |
| Passos 2–4 (env do Supabase, modo `local`) | Problema de config: corrigir a env. Problema de código: **remover `SUPABASE_URL` primeiro** (D14) e então fazer rollback do deploy. Usuários criados no GoTrue pelo sync ficam lá, inofensivos (cadastro desligado, sem acesso a dados); o `auth_user_id` preenchido é ignorado pelo código antigo | Nenhum |
| Passos 5–7 (modo `supabase`, `AUTH_JWT_SECRET` ainda existe) | `AUTH_PROVIDER=local`, deploy. Login volta ao bcrypt local com as mesmas senhas (R7: toda troca de senha depois do corte gravou os dois lados). Tokens Supabase já emitidos verificam até o `exp` (≤ 1 h); `/auth/refresh` responde 401 (D1), então cada pessoa faz **um** login novo quando o token vence | Um login por pessoa em até 1 h |
| Depois do passo 8 (sem `AUTH_JWT_SECRET`) | Gerar um valor novo (`openssl rand -base64 48`), definir `AUTH_JWT_SECRET` **e** `AUTH_PROVIDER=local`, deploy | Um login por pessoa em até 1 h |
| Rollback de código depois do passo 5 | Primeiro `AUTH_PROVIDER=local` (linha acima) e esperar 1 h; depois **remover `SUPABASE_URL`** e fazer rollback do deploy. O código antigo só entende HS256 | Um login por pessoa |
| Divergência pontual (um usuário não entra) | Não é rollback: rodar `sync-supabase-auth` em dry-run, ler a linha do usuário, rodar com `--execute` | Só aquele usuário |

Nunca: apagar usuários no painel do Supabase para "recomeçar" com o modo `supabase` ligado (quebra o vínculo de quem está logado; o sync recria e vincula, mas as sessões caem). Nunca: `SUPABASE_URL` definida com o backend ≤ v0.44 no ar.

## Mudanças de env

| Onde | Variável | Quando | Observação |
|---|---|---|---|
| Render | `SUPABASE_URL` | passo 2 | `https://kngrpoqzaxtuzkcugsyl.supabase.co`. **Nunca** com o código antigo no ar (D14) |
| Render | `SUPABASE_PUBLISHABLE_KEY` | passo 2 | chave publicável; usada nos endpoints públicos do GoTrue, do backend |
| Render | `SUPABASE_SECRET_KEY` | passo 2 | secreta, `sync: false`; poder de admin sobre os logins |
| Render | `AUTH_PROVIDER` | passo 2 (`local`), passo 5 (`supabase`) | rollback = voltar para `local` |
| Render | `AUTH_TRANSICAO_EMAIL_BANNER` | remover no passo 2 | não é mais lida |
| Render | `AUTH_JWT_SECRET` | remover no passo 8 | recriar só em rollback |
| Render | `SUPABASE_JWT_SECRET` | remover se existir | não é mais lida |
| Jobs manuais (`seed-admin`, `sync-supabase-auth`) | `databaseConnectionString`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | quando rodar | preferir o Render Shell; nunca misturar `.env` de dev com banco de produção |
| GitHub Actions (crons) | nenhuma | — | nenhum cron fala com o Supabase Auth; a 0067 aplicada por um cron é segura para o backend antigo |
| Vercel | nenhuma | — | o front não recebe chave do Supabase (I6) |

## Roteiro de QA manual (local: Postgres + Supabase descartáveis)

**Nunca contra o banco nem contra o projeto de produção.** Conexos não é necessário. Pré-requisito: Docker; a Supabase CLI roda via `npx supabase@<versão fixada na Task 1>` (a instalada, 2.12.1, não é tocada); a Task 1 define também o `signing_keys_path` ES256, se preciso.

**Preparação**

```bash
# 1) Supabase local descartável, fora do repositório
mkdir -p /tmp/fin-qa-supabase && cd /tmp/fin-qa-supabase && supabase init
#    config.toml: [auth] enable_signup = false ; enable_anonymous_sign_ins = false
#                 jwt_expiry = 3600 ; enable_refresh_token_rotation = true
#                 signing_keys_path apontando para a chave ES256 (se a Task 1 exigir)
supabase start          # anote API URL, publishable/anon key, secret/service_role key, DB URL (54322)

# 2) O banco do app É o Postgres do stack local (tem os roles anon/authenticated → testa a 0067 de verdade)
cd <worktree>/src/backend
export databaseConnectionString=postgresql://postgres:postgres@127.0.0.1:54322/postgres
npm run migrate                                   # aplica até a 0067

# 3) Um Postgres puro, só para provar que a 0067 roda sem os roles (D8)
docker run --rm -d --name fin-qa-pg -p 5433:5432 \
  -e POSTGRES_USER=financeiro -e POSTGRES_PASSWORD=devlocal -e POSTGRES_DB=financeiro postgres:16
npm run migrate:local && docker stop fin-qa-pg

# 4) Backend em modo local, SEM Supabase configurado (para criar usuários "antigos", sem vínculo)
export AUTH_JWT_SECRET=qa-segredo-local AUTH_PROVIDER=local
ADMIN_EMAIL=adm@qa.local ADMIN_PASSWORD='Qa-senha-123' npm run seed:admin
npm run dev            # porta P
cd ../frontend && npm run dev
```

Como `adm@qa.local`, pela tela `/usuarios`: criar `ana@qa.local` (username = e-mail), e pelo `psql` criar um usuário legado `beto` (username `beto`, e-mail `beto@qa.local`, mesmo formato de hash) e um inativo `caio` sem e-mail. Logar como `ana` e **guardar o token A** (HS256, DevTools → storage).

Depois, reiniciar o backend com `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` do stack local, ainda `AUTH_PROVIDER=local`.

1. **Migration e grants.** No Postgres puro a 0067 aplicou sem erro. No do stack: `\d app_user` mostra `auth_user_id uuid` com índice único parcial; `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated');` vazio; `CREATE TABLE public.qa_nova(x int);` como `postgres` e repetir a consulta: continua vazio. `npm run migrate` de novo não falha.
2. **Regressão do `issuer` (D14).** Com `SUPABASE_URL` definida e `AUTH_PROVIDER=local`, o token A continua passando (`curl -H "Authorization: Bearer $A" localhost:P/me/permissoes` → 200).
3. **Sync dry-run.** `npm run job:sync-supabase-auth`: relatório com a URL local no topo; `adm`, `ana`, `beto` = "criar"; `caio` = "ignorado: inativo"; "nada foi alterado (dry-run)". No Studio local (ou `psql` no 54322, só para QA), `auth.users` vazio.
4. **Sync real e idempotência.** `npm run job:sync-supabase-auth -- --execute`: saída 0, 3 criados. `SELECT username, auth_user_id FROM app_user` mostra os três vinculados, `caio` sem. Rodar `--execute` de novo: **0 ações**. Simular execução interrompida: `UPDATE app_user SET auth_user_id = NULL WHERE username='beto'`; rodar: `beto` = "vincular" (não "criar"); `auth.users` continua com 3.
5. **Virar para `supabase`.** Reiniciar com `AUTH_PROVIDER=supabase` (mantendo `AUTH_JWT_SECRET`). O token A **continua** passando (janela de convivência).
6. **Login por e-mail e por username.** Na tela: `ana@qa.local` entra; `beto` (username) entra. Em DevTools: `auth_token` é ES256 (`alg` no header), `auth_refresh_token` e `auth_expires_at` presentes. `curl -X POST localhost:P/auth/login -d '{"username":"beto","password":"..."}'` devolve `token`, `refreshToken`, `expiresAt`, `username: "beto"`. Senha errada, usuário inexistente e `caio` → o **mesmo** 401.
7. **Identidade de auditoria = username.** Logado como `beto` (token Supabase): `GET /me/conexos-status` consulta o vínculo de `beto` (definir um vínculo pela tela `/usuarios`, se o `SecretCipher` estiver configurado, e ver `vinculado`). Como `adm` (token Supabase), mudar o papel/exceção de `ana`: `SELECT ator FROM app_user_access_event ORDER BY id DESC LIMIT 1` = `adm@qa.local` (username), nunca UUID. No log de 403 de um usuário sem permissão, aparece o username. Se houver transação fixture em Adiantamentos, arquivar e conferir `ator` = username.
8. **Renovação antes do `exp`.** No `config.toml` local, baixar `jwt_expiry` para 420 s e reiniciar o stack (os tokens antigos caem; logar de novo). Deixar a tela aberta: por volta dos 2 min (≈ 5 min antes do `exp`), a aba de rede mostra **um** `POST /auth/refresh` 200 e o `auth_token` muda, sem modal. Com duas abas abertas: **uma** chamada de refresh no total; a outra aba adota o token novo.
9. **Renovação em 401.** Em DevTools, trocar `auth_expires_at` para longe no futuro (desliga a proativa) e esperar o token vencer; clicar em qualquer ação: a requisição volta 401, o front faz **um** refresh, reenvia e a ação funciona, sem modal. Depois, corromper `auth_refresh_token` e repetir: modal de sessão expirada.
10. **Logout revoga.** Copiar o `auth_refresh_token`, clicar em "Sair". `curl -X POST localhost:P/auth/refresh -d '{"refreshToken":"<copiado>"}'` → 401. Outra aba aberta também foi para `/login`.
11. **Desativar: ban + 401 em ≤ 30 s.** Logar `ana` num segundo navegador e guardar o token B. Como `adm`, desativar `ana`. `curl` com B → 401 imediato (invalidação no processo; ≤ 30 s no pior caso). Refresh de `ana` → 401 (banida no GoTrue: conferir `banned_until` no Studio). Login de `ana` → 401 genérico.
12. **Reativar.** Reativar `ana`: login entra de novo. Reativar `caio` (sem e-mail) → 400 "Cadastre um e-mail antes de reativar este usuário."; cadastrar `caio@qa.local`, reativar: `caio` ganha `auth_user_id` na hora e entra.
13. **Reset de senha pelo admin.** Redefinir a senha de `beto`: a nova entra, a antiga → 401. `app_user.password_hash` mudou (mesmo hash que o GoTrue recebeu, R7). Mailpit/Inbucket local (54324) vazio.
14. **Troca de e-mail.** Trocar o e-mail de `ana` para `ana2@qa.local`: login com `ana2@qa.local` entra; com `ana@qa.local` → 401; login por username (`ana@qa.local` é o username dela!) **continua** entrando, porque o identificador casa o `username`. Mailpit vazio. Tentar trocar para o e-mail de `beto` → 409.
15. **GoTrue fora do ar.** `docker stop supabase_auth_fin-qa-supabase` (nome do container do GoTrue): login → 503 com a mensagem em português; criar usuário → 503 "nada foi alterado" e a lista não ganhou linha; `curl` com um token Supabase ainda válido → 200 (JWKS em cache; o `ativo` vem do banco). `docker start` e seguir.
16. **Rate limiter.** `for i in $(seq 1 21); do curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:P/auth/login -H 'X-Forwarded-For: 10.0.0.1' -d '{"username":"x","password":"y"}'; done` → a 21ª é 429 com a mensagem em português. Com `X-Forwarded-For` variando (`10.0.1.$i`) e o mesmo identificador `beto` com senha errada: a 11ª é 429; um IP novo com identificador diferente passa. Refresh: 31 chamadas no mesmo minuto → 429.
17. **Rollback por configuração (`AUTH_PROVIDER=local`).** Guardar um token Supabase C válido e o refresh dele. Reiniciar com `AUTH_PROVIDER=local`: `beto` entra com a senha **redefinida no passo 13** (hash nos dois lados); o token C continua passando até o `exp`; `POST /auth/refresh` com o refresh de C → 401 (D1); na tela, quando C vence, o modal aparece e o login local funciona.
18. **Fechar a janela.** Voltar a `AUTH_PROVIDER=supabase`, **sem** `AUTH_JWT_SECRET`: o boot sobe; token A (HS256) → 401; login novo funciona. `AUTH_PROVIDER=local` sem `AUTH_JWT_SECRET` → boot falha com mensagem em português nomeando a variável.
19. **Report.** `curl -X POST localhost:P/auth/login -d '{"username":"adm@qa.local","password":"Qa-senha-123"}'` e `GET /metricas/ciclo` com o `token` → 200 (contrato do `kavex-report-ciclo`).
20. **Front sem Supabase.** `grep -rni supabase src/frontend/.next/static` (depois do `npm run build` do front) não acha URL nem chave.

Ao fim: `supabase stop --no-backup` na pasta temporária e `rm -rf /tmp/fin-qa-supabase`.

## Fora de escopo: tweak de limpeza (depois de uma semana estável)

Um `/feature-tweak` separado, que **não** entra nesta feature, remove:
- o caminho `AUTH_PROVIDER=local`: login bcrypt do `AuthService`, a variável `AUTH_PROVIDER`, o verificador HS256 e `AUTH_JWT_SECRET` do código, do `authEnv`, do `configManifest`, do `render.yaml` e do `.env.example`;
- a coluna `app_user.password_hash` (migration) e a escrita do hash local (R7); avaliar se `bcryptjs` ainda é necessário (se o GoTrue passar a receber `password` em vez de `password_hash`);
- a coluna `app_user.role`, o campo `role` na resposta do login e o alias D2 do passo 2 (`role: 'admin'` sem `papelId` em `POST /usuarios`);
- a chave `operacao` de `/me/permissoes` (D4 do passo 2);
- a tolerância do front a resposta de login sem `refreshToken`;
- `SUPABASE_JWT_SECRET` em qualquer comentário ou doc remanescente.

Também fora: apagar os 3 inativos de `app_user` (operação de dado à parte, com OK explícito); "esqueci a senha", SMTP, SSO corporativo, `filialAuthz` lendo o banco.

## Riscos e ambiguidades

1. **Desativar durante uma pane do Supabase — RESOLVIDO (dono do ciclo, 2026-09-30):** desativar comita o `ativo = false` mesmo se o ban falhar, loga `AUTH_DIVERGENCIA`, e o sync aplica o ban depois. O corte vale pelo `ativo` em ≤ 30 s. Task 9 já escrita assim.
2. **D14 é a armadilha do corte.** O backend ≤ v0.44 com `SUPABASE_URL` definida recusa todo token atual. O runbook ordena as envs para nunca cair nisso, mas um rollback de código feito às pressas, sem remover a variável, desloga todo mundo. Está em destaque no `DEPLOY.md`.
3. **T-1 pode mudar o desenho do import.** Se a API admin não aceitar `password_hash` no create, o job passa a escrever em `auth.users`/`auth.identities` (exceção à I7), e isso depende de internos do GoTrue que mudam entre versões. A Task 1 fixa a versão do GoTrue local na do projeto para que o resultado valha.
4. **CLI local antiga.** A CLI instalada (2.12.1) pode trazer um GoTrue anterior ao do projeto e assinar HS256 por padrão. A Task 1 usa uma versão recente via `npx` (sem atualizar a instalação do sistema) e configura ES256; sem isso, o QA local não reproduz o verificador de produção.
5. **Chaves novas (`sb_secret_…`) só em produção.** Se o stack local só tiver chaves legadas, o formato de cabeçalho da chave nova é verificado pela primeira vez no passo 2 do corte (em modo `local`, sem impacto: só a sincronização de escritas depende dela, e o dry-run do passo 3 a exercita antes de qualquer escrita).
6. **Refresh token no `localStorage`.** Um XSS no front leva uma sessão renovável (hoje leva um token de 12 h). Cookie httpOnly não serve (Vercel e Render são sites diferentes; ITP). Mitigado por: logout revoga, desativar bane, `ativo` por requisição.
7. **Reuso de refresh entre abas (D12).** Se a coordenação falhar, o GoTrue revoga a família inteira e as abas caem para o modal. Não perde dado, mas irrita; a Task 13 tem teste com duas instâncias e o passo 8 do QA confere à mão.
8. **Login revela existência só quando o GoTrue está fora.** Usuário inexistente → 401 sem chamar o GoTrue; existente com GoTrue fora → 503. Aceito: exige pane simultânea e não revela senha.
9. **Limites do D4 diferem do exemplo da entrevista** (20/min por IP em vez de 5/min), por causa do NAT do escritório. Se o dono preferir mais estrito, é constante.
10. **Transação local aberta durante a chamada HTTP ao GoTrue.** Trava a linha do usuário por até o timeout (10 s). Com ~15 usuários e escritas raras, desprezível; registrar como P3 se o Regis apontar.
11. **O sync depende de rodar no Render Shell com `dist/`.** Se o plano do Render não oferecer Shell, rodar localmente com as envs de produção exportadas à mão num terminal limpo (sem `.env` de dev), lembrando da memória "sessão do robô contaminável por dev local": o job não toca Conexos, mas o terminal não deve ter outras envs do app.
12. **Tamanho.** XL: a AutoLoopRunner deve fechar o backend (Tasks 1–12) verde antes do frontend (13–14). Tasks 2, 3 e 16 são paralelizáveis com a 1; 10 e 11 dependem da 9.
