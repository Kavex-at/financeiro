# Tasks: `supabase-auth`

**Spec source:** `ontology/_inbox/supabase-auth-interview.md` · **ADR:** [0030](../decisions/0030-supabase-auth-identity-provider.md)
**Plano aprovado:** `~/.claude-tech/plans/upgrade-the-authentication-and-streamed-lark.md`
**Ontology diff:** **sim** — `entities/usuario.md`, `state-machines/usuario.md`, `actions/usuario/` (7),
`business-rules/{ator-da-trilha-de-auditoria,autorizacao-resolvida-do-banco,revogacao-de-acesso}.md`,
`integrations/supabase-auth.md`, `decisions/0030-*.md`, `_index.json`, `_coverage.json`,
`relationships.md`, `glossary.md`
**Worktree:** `/home/inteli/kavex-worktrees/supabase-auth` · **Branch:** `feat/supabase-auth` · **Base:** `origin/main` (6e03775, v0.20.1)
**Estimated scope:** **XL** — 18 tasks, ~45 arquivos, cutover de identidade em 4 fases, 21 call sites de auditoria, todas as sessões vivas em risco.

> **Fonte de verdade: a ontologia.** Onde o plano aprovado diverge dela, a ontologia vence.
> As divergências encontradas estão em **§ Contradições** no fim deste arquivo.

---

## Decisões de implementação tomadas pelo TaskScoper

As duas decisões que a ontologia delegou explicitamente. Ambas mudam o desenho, não só a execução.

### D1 — Helper único `auditActor(req)`, **não** 21 edições soltas

**Decisão: um helper exportado, aplicado em 19 dos 21 sites. Os outros 2 não são auditoria.**

Os 21 sites não são homogêneos. Separá-los é a decisão, não a centralização:

| Grupo | Sites | O que é | Tratamento |
|---|---|---|---|
| **Ator de auditoria** | 19 — `permutas.ts` (13), `recebimentos.ts` (4), `sispag.ts:65`, `usuarios.ts:29` | valor **persistido** em `executado_por` / `criado_por` / `created_by` | `auditActor(req)` — com fallback |
| **Leitura de identidade** | 2 — `me.ts:24`, `conexosIdentity.ts:14` | alimenta `testarVinculo` e o `platformUsername` do ALS | `req.user?.username` **direto**, sem fallback |

Por que os 2 ficam de fora do helper: eles **precisam** do `undefined`. `conexosIdentity` usa a ausência
para cair no robô (`run({}, next)`); `me.ts` usa para responder `'ausente'`. Injetar `'unknown'` ali
gravaria a string `'unknown'` no ALS e faria `getVinculoConexos('unknown')` — um `SELECT` garantidamente
vazio disfarçado de vínculo ausente. **O fallback é correto para uma coluna de auditoria e errado para
uma chave de junção.**

Por que helper e não 19 edições: hoje já existem **três doutrinas** no repositório — `ator` local em
`usuarios.ts:29`, `ator` local em `sispag.ts:65`, e 17 expressões inline (das quais 2 invertidas). O
helper as unifica e torna a invariante **greppável e testável uma vez**. Sem ele, I-Usuario-1 volta a ser
uma convenção, e o próximo `feature-new` copia a linha errada — que foi exatamente como os 2 invertidos
apareceram.

**Assinatura:** `export const auditActor = (req: Request, fallback = 'unknown'): string`
em `src/backend/http/auth.ts` (onde já vivem `AuthUser` e `requireRole`, e de onde todo route já importa
— sem ciclo de import: `appUserContext.ts` importa de `auth.ts`, nunca o contrário).

**Nome em inglês, não `atorDaRequest`.** CLAUDE.md § Conventions/Language: *"Identifiers: English only
(classes, vars, functions, enums). **No exceptions.**"* Os helpers `ator` atuais são violações
pré-existentes que esta task remove. Função solta (não classe) segue a convenção **já estabelecida** na
camada `http/`, que exporta `extractBearerToken`, `requireRole`, `buildAuthMiddleware`, `asyncHandler` —
a regra "exportar classes" governa `domain/`, e o desvio fica confinado ao boundary Express.

**O parâmetro `fallback` preserva valores byte-idênticos:** `recebimentos.ts:644` e `:842` usam
`'manual'`, os outros 17 usam `'unknown'`. Passar o fallback mantém os dois valores como estão hoje em
vez de unificar — unificar mudaria um valor persistido para resolver um problema estético.

### D2 — `convidado` **precisa** de coluna nova na `0047`. É segurança, não UI.

**Decisão: `convite_pendente BOOLEAN NOT NULL DEFAULT false` entra na `0047`.**

O discriminador que a state-machine sugere (`authUserId IS NULL` **e** convite pendente) **não funciona** —
e a razão está na própria ontologia:

1. **`convidarUsuario` preenche `auth_user_id` na criação.** Postcondição literal de
   `actions/usuario/convidar-usuario.md`: *"linha app_user com auth_user_id preenchido, ativo = false"*.
   Logo um **convidado** é `auth_user_id NOT NULL` + `ativo = false` — **byte-idêntico** a um usuário
   **desativado** depois da migração. O `authUserId IS NULL` discrimina `pendenteMigracao`, que a ADR-0030 §8
   declara **ortogonal** ao ciclo de vida. Usá-lo para `convidado` funde dois eixos que a ADR separou de propósito.

2. **Sem a coluna, U2 é inimplementável — e a tentativa vira um buraco.** O convidado é `ativo = false`,
   portanto o fail-closed (I-Usuario-4) o barra com **403 para sempre**. Alguém tem que virá-lo para
   `ativo = true` quando ele definir a senha. Esse alguém precisa distinguir *"aceitou o convite"* de
   *"teve o acesso revogado"* — senão **aceitar um convite reativa silenciosamente um usuário desligado**
   que ainda tem o e-mail corporativo. É a mesma porta dos fundos que `redefinir-senha.md` fecha
   explicitamente ("reset de senha não pode ser porta dos fundos para reativação"), reaberta pelo convite.

3. **Custo: uma linha de DDL, zero migração de dados.** `DEFAULT false` já classifica corretamente
   todas as linhas de produção (nenhuma foi convidada).

**Derivação do estado** (`UsuarioStatus`, constante tipada — princípio P3):
`ativo === true → 'ativo'` · `ativo === false && convite_pendente → 'convidado'` · senão `'inativo'`.
`ativo` é lido **primeiro**: ele continua sendo a única fonte de autorização, e a coluna nova só refina
o ramo `false`. Não há dois interruptores.

**Como U2 é refletido** (task T11): `appUserContext`, ao encontrar `ativo = false && convite_pendente = true`,
**não** ativa por conta própria — pergunta ao GoTrue se o titular confirmou (`getUserById`). Só então
grava `ativo = true, convite_pendente = false`. Apresentar um JWT válido **não** é prova de aceite (o
próprio link de convite abre sessão no GoTrue antes da senha existir); confirmação no provedor é.
Alternativa recusada: endpoint público `/auth/confirm` chamado pelo callback do front — mais peças
móveis e contornável por quem navegar direto para a app.

### D3 — O `role` do frontend passa a vir de `GET /me`, **não** do JWT. E a migração do login para RHF **sai de escopo**.

**Achado não previsto pelo plano nem pela ontologia — e ele é silencioso.**

`lib/auth/token.ts:58` (`decodeJwtRole`) lê o claim `role` do token **sem verificar**, e alimenta
`useRole()` / `useIsAdmin()` (`AuthProvider.tsx:215-223`). Consumidores: `app/usuarios/page.tsx:20,37`
e `components/home/AdminHomeCard.tsx:15`.

No dia do cutover o token passa a ser do GoTrue, cujo `role` é **sempre `'authenticated'`**
(`autorizacao-resolvida-do-banco.md`). Logo `useIsAdmin()` retorna **`false` para todo mundo** — a tela
de usuários e o card de admin **somem para os próprios admins**, sem erro, sem log e sem teste vermelho.
O backend continua autorizando corretamente; é só a UI que desaparece. É o espelho exato, no frontend,
do problema que a ADR-0030 §3(4) resolve no backend — e por isso a mesma solução se aplica: **o role vem
do banco**, via `GET /me`. Tasks 10 e 16.

**Consequência de escopo: a troca do login para `react-hook-form` + `zod` sai desta feature.**

O plano a pede; a **ontologia não a menciona** — é melhoria de forma, não requisito de domínio. Três
razões para adiar, e a terceira é a decisiva:

1. `docs/design-system/forms.md` (a spec que a migração teria de cumprir) manda usar `FormField`,
   `TextInput` e `PasswordInput`. **Nenhum dos três existe** em `components/ui/` — a task viraria
   "criar as moléculas de formulário do Design System", que é uma feature própria.
2. Seria a **primeira** utilização de `react-hook-form` no repositório (instalado, zero uso). Estrear um
   padrão de formulário dentro do cutover de identidade mistura duas revisões diferentes.
3. **A página de login é a única porta de entrada durante um cutover cujo modo de falha declarado é
   lockout geral.** Reescrevê-la no mesmo PR que troca o provedor de identidade remove justamente a peça
   que precisa continuar funcionando enquanto tudo em volta muda.

O que a Task 17 **faz** no login: adiciona o link "Esqueci minha senha", troca a chamada de `signIn`, e
**preserva os 4 `data-testid`**. O que ela **não** faz: reescrever o formulário. A migração RHF+Zod e as
moléculas `FormField`/`PasswordInput` viram **follow-up P2** em
`_inbox/supabase-auth-regis-followups.md`.

---

## Convenções que valem para **todas** as tasks

Critérios de aceite implícitos em cada uma — não repetidos abaixo:

- SQL 100% parametrizado (`$nome` via `SqlBuilder`) — zero interpolação (Rule #5)
- `@injectable()` / `@singleton()` em toda classe de DI; **nunca** `new` — sempre `container.resolve()` (Rule #7)
- `EnvironmentProvider` em vez de `process.env` cru em services (Rule #8)
- Zod nos boundaries (env, body, params, resposta de API externa)
- Sem `!` non-null assertion; modificadores de acesso explícitos; métodos como arrow functions (Rule #9)
- Identificadores em **inglês**; erros, logs e commits em inglês; mensagens user-facing em PT-BR
- Biome: 4 espaços, aspas simples, trailing comma, ponto-e-vírgula, 100 colunas
- `npm run typecheck` + `npm run lint` + `npm test` verdes no pacote tocado

---

## FASE A — Schema e repositório

### Task 1: Migrations `0047` (link de identidade + convite) e `0048` (default de `role`)

**Files to change:**
- `src/backend/migrations/0047_app_user_auth_link.sql` _(novo)_
- `src/backend/migrations/0048_app_user_role_default.sql` _(novo)_

**Acceptance criteria:**
- [ ] `0047` adiciona, no estilo idempotente das existentes (`IF NOT EXISTS`, comentário-cabeçalho explicando o porquê):
      `auth_user_id UUID` + índice **único** `app_user_auth_user_id_key`, e `convite_pendente BOOLEAN NOT NULL DEFAULT false`
- [ ] O índice de `auth_user_id` é **UNIQUE** e tolera múltiplos `NULL` (todas as linhas de produção hoje são `NULL`) — verificado por teste ou por aplicação repetida
- [ ] `0048` executa `ALTER TABLE app_user ALTER COLUMN role SET DEFAULT 'operador'` — least privilege (ADR-0030 §9)
- [ ] `password_hash` **permanece** na tabela — é a fonte do import bcrypt até a Fase 4 (ADR-0030 §6)
- [ ] Nenhuma das duas faz `UPDATE` de dados: `0048` muda só o default, linhas existentes ficam intactas
- [ ] Rodar `npm run migrate` **duas vezes** seguidas é no-op na segunda (idempotência do `MigrationRunner` + `IF NOT EXISTS`)

**Dependencies:** nenhuma

---

### Task 2: `UserRepository` — métodos de identidade e convite (testes primeiro)

**Files to change:**
- `src/backend/domain/repository/auth/UserRepository.test.ts`
- `src/backend/domain/repository/auth/UserRepository.ts`

**Acceptance criteria:**
- [ ] Testes escritos **antes** e vermelhos: `findByAuthUserId`, `linkAuthUser`, `listPendingMigration`, `markConviteAceito`, `setConvitePendente`
- [ ] `findByAuthUserId(authUserId)` → `AppUserContext | null` com `{ id, username, role, ativo, convitePendente }` — **um único** `SELECT ... WHERE auth_user_id = $authUserId`, **sem** `AND ativo` (o filtro mataria a distinção 403-inativo × 403-inexistente que I-Usuario-9 exige)
- [ ] `linkAuthUser(id, authUserId)` faz **UPDATE** do ponteiro e nada mais — não toca `username`, `role` nem `ativo` (regra de `migrar-para-supabase.md`)
- [ ] `listPendingMigration()` → linhas com `auth_user_id IS NULL`; é o **gate** da Fase 3, não relatório
- [ ] `markConviteAceito(id)` faz `ativo = true, convite_pendente = false` num **único** UPDATE
- [ ] `AppUserPublic` ganha `convitePendente: boolean` e continua **omitindo** `password_hash` e `conexos_password_enc`
- [ ] `getVinculoConexos` fica **literalmente intocado** (assinatura, SQL e filtro `AND ativo = true`)
- [ ] Todo SQL novo usa `$nome`; nenhum template literal com variável

**Dependencies:** Task 1

---

## FASE B — O núcleo: identidade separada de autorização

### Task 3: Regressão nomeada — o token legado sobrevive a `SUPABASE_URL` (teste primeiro)

> **A task mais importante da feature em risco por unidade de esforço.** Errar aqui derruba
> **todas as sessões vivas** no instante em que a env var for setada no Render.

**Files to change:**
- `src/backend/http/auth.test.ts`
- `src/backend/http/authEnv.test.ts`

**Acceptance criteria:**
- [ ] Teste novo **vermelho contra o código atual**: um HS256 assinado **sem `.setIssuer()`** — replicando exatamente `AuthService.signToken` (`AuthService.ts:71-77`) — é **aceito** por `buildAuthMiddleware` com `supabaseUrl` **setado**
- [ ] O teste tem nome explícito de regressão (ex.: `'accepts a legacy HS256 token with NO iss claim after SUPABASE_URL is configured'`) e um comentário apontando ADR-0030 §6
- [ ] **Corrigido o falso-positivo existente:** `auth.test.ts:291` (*"accepts an HS256 token via the shared secret even when SUPABASE_URL is set"*) chama `.setIssuer(ISSUER)` na linha 295 — assina um `iss` que **nenhum token real de produção tem**, e por isso passa hoje sem provar nada. Ou o teste passa a **não** setar issuer, ou ganha um irmão que não seta, com comentário dizendo por quê
- [ ] Teste complementar: o caminho **ES256/JWKS continua exigindo** `issuer` — um ES256 com `iss` errado é rejeitado com 401
- [ ] `audience: 'authenticated'` continua exigido nos **dois** caminhos (teste por caminho)
- [ ] `authEnv.test.ts` cobre os campos novos e mantém verdes os 7 casos do guard `DEV_AUTH_BYPASS × environment`

**Dependencies:** nenhuma

---

### Task 4: Separar as opções de verificação por caminho + estender `authEnv`

**Files to change:**
- `src/backend/http/auth.ts`
- `src/backend/http/authEnv.ts`

**Acceptance criteria:**
- [ ] `baseOptions` (`auth.ts:133-136`) **deixa de existir como objeto compartilhado**. Dois objetos distintos: `hsOptions = { audience }` (sem `issuer`) e `jwksOptions = { audience, issuer }`
- [ ] A doc-comment de `buildAuthMiddleware` (`auth.ts:104-106`) que hoje afirma *"Both verifiers enforce … issuer"* é corrigida — ela documenta o bug
- [ ] Todos os testes da Task 3 passam a verde **sem tocar neles**
- [ ] `authEnv.ts` adiciona ao schema Zod: `SUPABASE_SERVICE_ROLE_KEY` (opcional), `SUPABASE_ANON_KEY` (opcional), `AUTH_LEGACY_LOGIN_ENABLED` (enum `'true'|'false'`, **default `true`** no rollout)
- [ ] O fail-fast de `DEV_AUTH_BYPASS` fora de local/dev (`authEnv.ts:93-101`, deny-by-default) fica **preservado byte a byte**
- [ ] `AuthUser` (`auth.ts:17-27`) ganha `username?: string` e `appUserId?: number`; a docstring obsoleta (`auth.ts:13-15`, *"Minimal shape of an authenticated Supabase user"* com `role` = role do Postgres) é reescrita para dizer que `role` e `username` vêm de `app_user`, não do token
- [ ] `npm test` do backend inteiro verde — nenhuma sessão-teste existente quebrada

**Dependencies:** Task 3

---

### Task 5: `appUserContext` — testes falhando (fail-closed, cache, bypass)

**Files to change:**
- `src/backend/http/appUserContext.test.ts` _(novo)_

**Acceptance criteria:**
- [ ] JWT válido **sem linha** em `app_user` → **403** (nunca 401), corpo com mensagem user-facing PT-BR
- [ ] JWT válido, linha com `ativo = false` → **403** (nunca 401)
- [ ] Teste explícito de que **nenhum** dos dois casos responde 401 — com comentário: 401 faz o front tentar refresh, 403 não (`autorizacao-resolvida-do-banco.md`)
- [ ] JWT com `role: 'authenticated'` + `app_user.role = 'admin'` → `req.user.role === 'admin'` (**sobrescrita**, não merge)
- [ ] `req.user.username` é o `app_user.username`; `req.user.sub` continua sendo o UUID do token
- [ ] Cache: dois requests seguidos do mesmo `auth_user_id` fazem **um** `SELECT`; após `APP_USER_CONTEXT_TTL_MS`, novo `SELECT` (relógio fake)
- [ ] `invalidate(authUserId)` zera a entrada **sincronicamente** — request imediatamente seguinte relê do banco
- [ ] O 403 de "sem linha" também é cacheado (evita `SELECT` por request de um token órfão em loop)
- [ ] `DEV_AUTH_BYPASS=true` → `req.user` **definido**, com `username === 'dev-bypass@local'`, `role === 'admin'`, e **nenhum** acesso ao banco
- [ ] Teste de que `APP_USER_CONTEXT_TTL_MS` é **constante exportada tipada** e não é lida de `process.env` em lugar nenhum (`revogacao-de-acesso.md`: *"um número de segurança que se muda por deploy é um número que se muda sem revisão"*)

**Dependencies:** Task 2, Task 4

---

### Task 6: `appUserContext` — implementação e wiring

**Files to change:**
- `src/backend/http/appUserContext.ts` _(novo)_
- `src/backend/index.ts`

**Acceptance criteria:**
- [ ] Todos os critérios da Task 5 verdes
- [ ] `export const APP_USER_CONTEXT_TTL_MS = 30_000;` — constante tipada, nunca env var
- [ ] Middleware montado em `index.ts` **entre** `buildAuthMiddleware()` (linha 84) e `conexosIdentityMiddleware` (linha 89) — a ordem é o contrato: identidade → autorização → identidade-no-ERP
- [ ] Sob `DEV_AUTH_BYPASS`, injeta o usuário sintético e retorna **antes** de tocar o container/DB
- [ ] `/health` (linha 72) e `/auth/*` (linha 77) continuam **públicos** — montados antes do auth, não regridem
- [ ] O cache é `Map` process-local com invalidação síncrona; um comentário no topo cita a **restrição datada de instância única do Render** (`render.yaml plan: starter`) e aponta para `business-rules/revogacao-de-acesso.md`
- [ ] `PatternGuardian` verde neste arquivo

**Dependencies:** Task 5

---

## FASE C — O ator da trilha de auditoria (I-Usuario-1)

### Task 7: `auditActor` + os 21 call sites

> Depende **duro** da Fase B. Trocar antes de `appUserContext` popular `username` gravaria
> `'unknown'` em `executado_por` de toda a Frente I.

**Files to change:**
- `src/backend/http/auth.ts` (helper `auditActor`)
- `src/backend/http/auth.test.ts`
- `src/backend/routes/permutas.ts` (13 sites: 194, 228, 293, 363, 470, 501, 535, 565, 624, 651, 678, 705, 734)
- `src/backend/routes/recebimentos.ts` (4 sites: 185, 487, 644, 842)
- `src/backend/routes/sispag.ts` (65)
- `src/backend/routes/usuarios.ts` (29)
- `src/backend/routes/me.ts` (24)
- `src/backend/http/conexosIdentity.ts` (14)
- `src/backend/routes/permutas.test.ts` (harness `buildApp`, linha ~51)
- `src/backend/routes/recebimentos.test.ts` e demais harnesses que falsificam `req.user`

**Acceptance criteria:**
- [ ] `auditActor(req, fallback = 'unknown')` retorna `req.user?.username ?? fallback` — **nunca** lê `sub`
- [ ] Os **19** sites de auditoria usam o helper; os helpers locais `ator` de `usuarios.ts:29` e `sispag.ts:65` são **removidos** (não reescritos)
- [ ] `recebimentos.ts:644` e `:842` passam `'manual'` como fallback — valor persistido **idêntico** ao de hoje
- [ ] `me.ts:24` e `conexosIdentity.ts:14` leem `req.user?.username` **direto**, preservando o `undefined` (robô / `'ausente'`) — **não** usam o helper
- [ ] **Teste-guarda anti-regressão:** um teste que varre `src/backend/routes/` e `src/backend/http/conexosIdentity.ts` e falha se `req.user?.sub` aparecer em qualquer expressão que alimente auditoria — a invariante deixa de depender de code review
- [ ] Teste: `conexosIdentityMiddleware` põe o **username** (não o UUID) no ALS — protege o caminho da baixa `fin010`
- [ ] Teste: sem `req.user`, `conexosIdentityMiddleware` continua chamando `run({}, next)` (fallback robô preservado)
- [ ] **Idempotency-key do ledger preservada:** `recebimentos.ts:185-190` monta `receb:${ator}:${key}`. Com `sub === username === e-mail` hoje, o namespace fica **idêntico** — chaves gravadas antes do deploy continuam casando. Teste explícito, porque um namespace que muda em silêncio reabre execução dupla em rota money-moving
- [ ] Harness `buildApp` de `permutas.test.ts` passa a setar `username: 'a@b.com'` em `req.user`; nenhum teste existente grava `'unknown'`
- [ ] Comentário de `ConexosRequestContext.ts:6` (*"o `sub` do JWT"*) corrigido para `username`
- [ ] `npm test` do backend verde inteiro

**Dependencies:** Task 6

---

## FASE D — Gestão de usuários (GoTrue Admin API)

### Task 8: `SupabaseAdminClient` + cobertura de `service_role` no redact

**Files to change:**
- `src/backend/domain/client/SupabaseAdminClient.ts` _(novo)_
- `src/backend/domain/client/SupabaseAdminClient.test.ts` _(novo)_
- `src/backend/http/redact.ts`
- `src/backend/http/redact.test.ts`
- `src/backend/package.json` (`@supabase/supabase-js`)

**Acceptance criteria:**
- [ ] `@singleton() @injectable()`, service-role key **via `EnvironmentProvider`** (`supabaseServiceRoleKey` já existe em `EnvironmentVars.ts:15` e hoje é código morto) — nunca `process.env` cru
- [ ] Métodos: `inviteByEmail`, `createUser`, `getUserById`, `updateUserById`, `setBanned`, `deleteUser`
- [ ] Resposta da Admin API validada com **Zod** no boundary (é input externo)
- [ ] `deleteUser` documentado no código como **exclusivo de compensação transacional** (I-Usuario-3) e **não exposto em rota** — teste-guarda de que nenhum router o alcança
- [ ] Falha de rede/5xx propaga erro tipado que o service consegue distinguir de "usuário não existe"
- [ ] `redact.ts`: `DEFAULT_SENSITIVE_KEYS` (linhas 10-18) passa a cobrir **`service_role`** e `serviceRoleKey` — **hoje não cobre** (ADR-0011 §2 estendida pela ADR-0030 §4)
- [ ] Teste: um corpo com `service_role` é mascarado por `redactBody`
- [ ] Nenhuma referência a `SUPABASE_SERVICE_ROLE_KEY` em `src/frontend/` — teste-guarda ou grep no CI

**Dependencies:** Task 4

---

### Task 9: `UserAdminService` — convite, fallback com senha, ativar/desativar, reset (testes primeiro)

**Files to change:**
- `src/backend/domain/service/auth/UserAdminService.test.ts`
- `src/backend/domain/service/auth/UserAdminService.ts`

**Acceptance criteria — `convidarUsuario` (U1):**
- [ ] Cria no GoTrue (`inviteByEmail`) **e** a linha local (`ativo = false`, `convite_pendente = true`, `role` default `'operador'`, `created_by` = ator, `auth_user_id` preenchido)
- [ ] **Compensação:** se o passo local falhar, `deleteUser` no GoTrue é chamado. Teste com o repositório lançando — assert de que `deleteUser` foi chamado com o id certo
- [ ] Se a **compensação também falhar**, o erro carrega o e-mail e o `auth_user_id` órfão na mensagem (é a única pista de que o e-mail ficou queimado)
- [ ] E-mail já existente em `app_user` **ou** no GoTrue → **409**, nunca duplicata

**Acceptance criteria — `cadastrarUsuarioComSenha` (U3):**
- [ ] `createUser` com senha + `email_confirm` já verdadeiro; linha local nasce `ativo = true`, `convite_pendente = false`, `role` default `'operador'`
- [ ] **Não depende de SMTP** — teste com o mock de `inviteByEmail` lançando prova que este caminho segue funcionando
- [ ] Mesma compensação transacional de U1; 409 em e-mail repetido
- [ ] **`password_hash` local não é escrito** neste caminho — a custódia é do GoTrue

**Acceptance criteria — `desativarUsuario` (U4) / `ativarUsuario` (U5):**
- [ ] **Ordem enforçada:** (1) `ativo = false` local + `appUserContext.invalidate()` **síncrono**; (2) `setBanned` no GoTrue
- [ ] Falha no passo (1) → **aborta**, nada é chamado no GoTrue
- [ ] Falha no passo (2) → **sucesso parcial auditado**: a operação retorna `{ ativo: false, banGoTrue: 'falhou' }` (ou equivalente) com HTTP 200 e log de warning — **não** erro duro
- [ ] **I-Usuario-6:** alvo == ator → **403** com mensagem explícita, **antes** de qualquer escrita. Desativar **outro** admin é permitido — teste dos dois casos
- [ ] Idempotente nas duas direções (desativar duas vezes = desativado)
- [ ] `ativarUsuario` faz `ativo = true` + unban + limpa `convite_pendente`; **não toca** `conexos_username` / `conexos_password_enc` — teste explícito de que o vínculo sobrevive a desativar→reativar (I-Usuario-5)

**Acceptance criteria — `redefinirSenhaDeTerceiro` / `solicitarRedefinicaoSenha`:**
- [ ] Ambos disparam link de recuperação pelo GoTrue; **`updatePassword` local nunca é chamado** — teste-guarda
- [ ] `solicitarRedefinicaoSenha`: resposta HTTP **idêntica** existindo ou não o usuário (anti-enumeração) — teste comparando corpo e status dos dois casos
- [ ] Usuário **inativo não recebe link**, e a resposta continua idêntica (reset não é porta dos fundos para reativação)
- [ ] `BCRYPT_ROUNDS` e o import de `bcryptjs` só permanecem se ainda usados pelo caminho legado; caso contrário, removidos

**Dependencies:** Task 8, Task 2

---

### Task 10: `routes/usuarios.ts` — superfície HTTP das ações

**Files to change:**
- `src/backend/routes/usuarios.ts`
- `src/backend/routes/me.ts`
- `src/backend/routes/usuarios.test.ts` _(novo, se ausente)_

**Acceptance criteria:**
- [ ] `POST /usuarios/convite` (padrão) e `POST /usuarios` (fallback com senha) — ambos atrás de `requireRole('admin')`, que já cobre o router inteiro (linha 27)
- [ ] `PATCH /:id/ativo` chama a nova `setAtivo` do service e **propaga o sucesso parcial** para a UI
- [ ] `POST /:id/reset-senha` deixa de aceitar `password` no corpo — o schema Zod `resetPasswordSchema` some ou é substituído; enviar senha → **400**
- [ ] `POST /auth/forgot-password` (**público**, montado antes do middleware de auth, junto de `/auth`) com rate-limit — resposta constante (anti-enumeração)
- [ ] 409 do e-mail duplicado usa a mensagem PT-BR existente (`respondError`, linha 40-42)
- [ ] 403 de autodesativação com mensagem PT-BR distinta do 403 genérico de role
- [ ] `GET /usuarios` devolve o `status` derivado (`convidado`/`ativo`/`inativo`), não só `ativo` — a UI precisa distinguir "nunca entrou" de "acesso revogado"
- [ ] `ator(req)` local removido; usa `auditActor(req)` (Task 7)
- [ ] **`GET /me` (novo, em `routes/me.ts`)** devolve `{ username, role }` **resolvidos do banco** por `appUserContext` — é a fonte do `role` no frontend (§D3). Teste: um token cujo claim `role` é `'authenticated'` produz `role: 'admin'` na resposta quando `app_user.role = 'admin'`
- [ ] `GET /me/conexos-status` continua respondendo `ok`/`falha`/`ausente` com a mesma semântica — é o sinal de QA da cadeia Conexos

**Dependencies:** Task 9, Task 7

---

### Task 11: Aceite do convite (U2) — reflexo local verificado no GoTrue

**Files to change:**
- `src/backend/http/appUserContext.ts`
- `src/backend/http/appUserContext.test.ts`
- `src/backend/domain/service/auth/UserAdminService.ts`

**Acceptance criteria:**
- [ ] Linha com `ativo = false && convite_pendente = true` **não** é ativada só por apresentar JWT válido — `getUserById` no GoTrue é consultado e só um usuário **confirmado** é ativado
- [ ] Confirmado → `markConviteAceito(id)` (`ativo = true, convite_pendente = false`), cache invalidado, request **segue**
- [ ] Não confirmado → **403** (não 401)
- [ ] Usuário `ativo = false && convite_pendente = false` (revogado) **nunca** chega a consultar o GoTrue — teste explícito de que `getUserById` **não** é chamado. É a guarda contra reativar um desligado por um caminho de convite
- [ ] O 403 do não-confirmado é cacheado no mesmo TTL — no máximo ~2 chamadas Admin API por minuto por convidado pendente
- [ ] Zero chamadas ao GoTrue no caminho quente (`ativo = true`) — teste de que um usuário normal não gera tráfego à Admin API

**Dependencies:** Task 6, Task 8

---

### Task 12: Login legado atrás de flag + `seed-admin` sem credencial em código

**Files to change:**
- `src/backend/routes/auth.ts`
- `src/backend/routes/auth.test.ts` _(novo, se ausente)_
- `src/backend/jobs/seed-admin.ts`

**Acceptance criteria:**
- [ ] `POST /auth/login` responde **404 ou 410** quando `AUTH_LEGACY_LOGIN_ENABLED=false`; funciona normalmente com `true` (default no rollout) — é o botão de rollback da Fase 3
- [ ] A flag é lida do `authEnv` validado (Task 4), nunca de `process.env` direto no route
- [ ] `seed-admin.ts:23` — o default `'columbia2026'` é **removido**; sem `ADMIN_PASSWORD` no ambiente o job **falha** com mensagem clara e `exit 1`
- [ ] `seed-admin` cria o usuário **no GoTrue** e grava `auth_user_id` na linha local, mantendo a idempotência do `upsertAdmin`
- [ ] O doc-comment (linhas 12-13) que anuncia os defaults é corrigido — ele documenta a credencial em código

**Dependencies:** Task 9, Task 4

---

## FASE E — Migração dos usuários existentes

### Task 13: Job `migrate-users-to-supabase` (dry-run por padrão)

**Files to change:**
- `src/backend/jobs/migrate-users-to-supabase.ts` _(novo)_
- `src/backend/jobs/migrate-users-to-supabase.test.ts` _(novo)_
- `src/backend/package.json` (script `job:migrate-users`)

**Acceptance criteria:**
- [ ] **Dry-run é o default.** Escreve só com `--execute` explícito
- [ ] Seleciona por `listPendingMigration()` (`auth_user_id IS NULL`) — a idempotência **é** o filtro, não uma verificação extra. Rodar duas vezes com `--execute` migra zero na segunda
- [ ] Cria o usuário no GoTrue **reaproveitando o hash bcrypt** de `password_hash`; se a Admin API instalada não aceitar hash, o fallback documentado é INSERT direto em `auth.users`
- [ ] O job **só grava `auth_user_id`**. Testes-guarda: não altera `username`, não altera `role`, não altera `ativo`, não cria linha nova (UPDATE apenas)
- [ ] Relatório final: total pendente, migrados, falhos, e a lista de `username` que falharam
- [ ] `listPendingMigration()` exposto como **gate**: log explícito de que a Fase 3 (`AUTH_LEGACY_LOGIN_ENABLED=false`) só pode acontecer com a lista vazia, senão o usuário fica sem nenhum caminho de login (ADR-0030 §6 / I13)
- [ ] Nenhum hash ou senha aparece em log — validado contra `redactBody`

**⚠️ QaCoach — roteiro obrigatório no tenant de dev (Yuri executa):**
validar numa **conta de teste** antes de rodar em todo mundo. O modo de falha provável é o import do hash
ser **aceito mas não conferir**, e ninguém descobrir até o primeiro login (`migrar-para-supabase.md`).

**Dependencies:** Task 8, Task 2

---

## FASE F — Frontend

> **Todas as tasks desta fase tocam `src/frontend/` ⇒ gate do `DesignSystemReviewer` obrigatório
> antes do verde.**

### Task 14: Dependências + factories `@supabase/ssr`

**Files to change:**
- `src/frontend/package.json` (`@supabase/supabase-js`, `@supabase/ssr` — **ambos ausentes**, confirmado também no `package-lock.json`)
- `src/frontend/lib/supabase/client.ts` _(novo)_
- `src/frontend/lib/supabase/server.ts` _(novo)_
- `src/frontend/lib/supabase/middleware.ts` _(novo)_
- `src/frontend/jest.setup.ts`

**Acceptance criteria:**
- [ ] Os três factories padrão do `@supabase/ssr` (browser / server component / middleware)
- [ ] Leem **apenas** `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` — **nenhuma** referência a service-role no bundle do cliente (teste-guarda ou grep no CI)
- [ ] Ausência das env vars falha com mensagem clara em vez de `undefined` silencioso
- [ ] Os arquivos novos vão para **`lib/supabase/`**, não `lib/auth/` — `jest.config.js:41-43` impõe um piso de cobertura `'./lib/auth/': { lines: 24 }` que arquivos novos sem teste **derrubam**. Se algum arquivo novo entrar em `lib/auth/`, ou vem com teste ou o piso é revisto conscientemente
- [ ] `jest.setup.ts` ganha polyfill de `fetch`/`Request`/`Response`/`Headers` — hoje não existe (só `ResizeObserver` e os de ponteiro do Radix), e sem ele os testes de `middleware.ts` e dos helpers server não rodam
- [ ] `npm run build` do frontend verde

**Dependencies:** nenhuma (paralelizável com a Fase D)

---

### Task 15: `middleware.ts` — refresh de sessão e proteção server-side

**Files to change:**
- `src/frontend/middleware.ts` _(novo — não existe hoje; toda proteção é client-side pós-hidratação)_
- `src/frontend/__tests__/middleware.test.ts` _(novo)_
- `src/frontend/components/auth/RouteGate.tsx` (`PUBLIC_ROUTES`, linha 11)
- `src/frontend/components/AppShell.tsx` (linha 16)
- `src/frontend/__tests__/auth/RouteGate.test.tsx`

**Acceptance criteria:**
- [ ] Refresh do token a cada navegação (caminho recomendado do `@supabase/ssr`)
- [ ] `PUBLIC_ROUTES` (`RouteGate.tsx:11`, hoje `['/login', '/docs']`) ganha `/auth` — **sem isso as páginas novas de recuperação nascem gateadas e o usuário sem sessão entra em loop de redirect** para exatamente a tela que precisa alcançar
- [ ] O matcher do `middleware.ts` e o `PUBLIC_ROUTES` são **derivados da mesma fonte** (constante exportada) — duas listas de rotas públicas divergem em silêncio
- [ ] `AppShell.tsx:16` hoje esconde o header comparando `pathname === '/login'`; passa a cobrir `/auth/*` também, senão as telas de recuperação aparecem com a navegação da app autenticada
- [ ] Sessão ausente em rota protegida → redirect para `/login` **server-side**, antes da hidratação
- [ ] Assets estáticos e `_next/*` excluídos do matcher
- [ ] `RouteGate` e `AuthGuard` **permanecem** — defesa em profundidade, não substituição. `RouteGate.test.tsx` estendido com os casos `/auth/*`

**Dependencies:** Task 14

---

### Task 16: `token.ts` + `AuthProvider` — sessão do GoTrue e o `role` do banco

> Contém a correção do achado §D3. Sem ela o cutover esconde a UI de admin **dos admins**.

**Files to change:**
- `src/frontend/lib/auth/token.ts`
- `src/frontend/lib/auth/AuthProvider.tsx`
- `src/frontend/lib/http.ts`
- `src/frontend/lib/api.ts` (comentário obsoleto, linhas 35-36)
- `src/frontend/components/auth/SessionExpiredModal.tsx` · `components/auth/UserMenu.tsx`
- `src/frontend/__tests__/auth/token.test.ts` · `decode-jwt-exp.test.ts` · `SessionExpiredModal.test.tsx` · `__tests__/http/apiFetch.test.ts`

**Acceptance criteria:**
- [ ] `getAccessToken()` passa a ler `supabase.auth.getSession()` (**vira async** — hoje é síncrona, `token.ts:16`); o token **sai do `localStorage`** (`TOKEN_STORAGE_KEY`, `USERNAME_STORAGE_KEY`)
- [ ] `withAuthHeaders()` **mantém a assinatura async** (`token.ts:27`) — os **52** call sites em `lib/api.ts` (23), `lib/recebimentos.ts` (8), `lib/sispag.ts` (8) e `lib/usuarios.ts` (8) **não mudam**. Critério verificável: `git diff --stat` desses 4 arquivos não mostra alteração em linha de chamada
- [ ] **`useRole()` / `useIsAdmin()` deixam de usar `decodeJwtRole`** e passam a consumir o `role` de `GET /me` (Task 10). `decodeJwtRole` é **removido** junto com seu teste — ler role de claim não verificado é o bug, não o mecanismo
- [ ] **Teste de regressão nomeado (§D3):** com um token cujo claim `role` é `'authenticated'` e `GET /me` devolvendo `role: 'admin'`, `useIsAdmin()` é **`true`**. É o teste que impede a UI de admin de sumir em silêncio no cutover
- [ ] `signIn` usa `signInWithPassword` (hoje faz `fetch` cru para `${API}/auth/login`, `AuthProvider.tsx:118-145`)
- [ ] `signOut` chama `supabase.auth.signOut()` — revogação real. **Vira async**: `UserMenu.tsx:21-24` e `SessionExpiredModal.tsx:40-45` passam a aguardar antes do `router.replace`, e `SessionExpiredModal.test.tsx:61-73` é ajustado (as asserções de ordem hoje rodam síncronas após um único click)
- [ ] O `setTimeout` proativo de expiração (`AuthProvider.tsx:109-116`) é **removido** e substituído por `onAuthStateChange` — com auto-refresh ligado ele dispara o modal em cima de uma sessão perfeitamente válida
- [ ] `SessionExpiredModal` **preservado** — deixa de ser o fluxo normal e vira fallback de refresh realmente falho; o teste é reescrito para esse papel, não deletado
- [ ] **401 ≠ 403 (`lib/http.ts:28-35`):** hoje **só** 401 é interceptado (→ `emitSessionExpired()` + `SessionExpiredError`) e **403 não tem tratamento nenhum**, caindo no erro genérico. Depois do cutover o 403 do `appUserContext` passa a ser comum (sem linha em `app_user`, `ativo=false`, role insuficiente) — precisa de erro próprio, mensagem PT-BR de "acesso não autorizado", e **jamais** disparar refresh nem o modal de sessão expirada
- [ ] Teste novo em `apiFetch.test.ts`: **403 não emite `sessionExpired`** e não lança `SessionExpiredError` (hoje não há caso 403 no arquivo)
- [ ] Comentário de `lib/api.ts:35-36` ("attaches the Supabase bearer token") — hoje falso, passa a ser verdade

**Dependencies:** Task 14, Task 10

---

### Task 17: Telas — recuperação de senha e estado `convidado`

**Files to change:**
- `src/frontend/app/auth/forgot-password/page.tsx` _(novo)_
- `src/frontend/app/auth/reset-password/page.tsx` _(novo)_
- `src/frontend/app/login/page.tsx` (**mudança mínima** — ver §D3)
- `src/frontend/app/usuarios/page.tsx` (badge do estado `convidado`)

**Acceptance criteria:**
- [ ] **Login: mudança mínima.** Adiciona o link "Esqueci minha senha" → `/auth/forgot-password` e adapta a chamada de `signIn`. **Não** migra para `react-hook-form` (§D3). Os 4 `data-testid` — `login-username` (:100), `login-password` (:123), `login-error` (:140), `login-submit` (:152) — ficam **intactos**
- [ ] As duas páginas novas imitam o esqueleto de `app/login/page.tsx` (container gradiente, card `max-w-md`, bloco de marca, campo com ícone, botão com troca por `Spinner`) e o idioma de campo de `app/usuarios/ResetSenhaDialog.tsx:67-78` (`Label htmlFor` + `Input` + `minLength={8}` + `autoComplete="new-password"`)
- [ ] `reset-password` envolve o corpo em `<Suspense>` por causa de `useSearchParams()` — mesmo padrão de `login/page.tsx:175-186`; ler `?code=`/`?token_hash=` sem isso quebra o build do Next
- [ ] `forgot-password` usa `resetPasswordForEmail()` e exibe **sempre a mesma mensagem**, exista o e-mail ou não — espelha o anti-enumeração do backend (Task 9). Um "e-mail não cadastrado" aqui entrega a lista de funcionários da Columbia
- [ ] `reset-password` usa `updateUser({ password })`; token de recuperação inválido/expirado tem estado de erro próprio (uso único)
- [ ] Erro inline segue o padrão verbatim de `login/page.tsx:137-145` (`role="alert"`, `border-danger/30 bg-danger-subtle text-danger-foreground`); falha de submit usa `toast.error` (sonner), como `ResetSenhaDialog.tsx:42`
- [ ] Nenhuma cor/espaçamento literal — só tokens semânticos de `app/globals.css` (`--danger`, `--warning`, `--primary`, …)
- [ ] **Sem `AppShell`** nas páginas de auth (`docs/design-system/layout.md:168`)
- [ ] Tela de usuários distingue **`convidado`** de **`inativo`** — retorno concreto da coluna da D2
- [ ] `data-testid` em todo elemento interativo novo, seguindo a convenção da tela de login
- [ ] **`DesignSystemReviewer` verde**

**Dependencies:** Task 16, Task 10, Task 15

---

## FASE G — Documentação e operação

### Task 18: Docs-as-code + envs (aplicar **no mesmo PR** do código)

> Deliberadamente adiados pela ontologia: escritos antes, ficariam **falsos** entre o merge e o deploy.
> Trechos exatos em `_inbox/supabase-auth-regis-followups.md` § "aplicar no PR". Linhas conferidas em 2026-08-06.

**Files to change:**
- `DEPLOY.md` (linhas 3, 4-5, 15, 44, 57, 89, 96)
- `README.md` (linhas 29, 61)
- `CLAUDE.md` (tabela **Estado Atual vs. Alvo**, linha 28 — `Auth / DB`)
- `render.yaml`
- `src/frontend/.env.example` (linhas 4-5) e `src/frontend/.env` (local, gitignored)
- `src/frontend/lib/arquitetura/tecnica.ts` (linhas 120-121)
- `ontology/_inbox/migration-debt.md` (item **O6**)
- `ontology/_inbox/supabase-auth-regis-followups.md` (novos follow-ups P2)
- `CHANGELOG.md`

**Acceptance criteria:**
- [ ] `DEPLOY.md:3` acrescenta Supabase **Auth (GoTrue)** ao lado do Postgres
- [ ] `DEPLOY.md:4-5` reescrito: identidade no GoTrue (ES256/JWKS), autorização resolvida de `app_user` a cada request, HS256 legado atrás de `AUTH_LEGACY_LOGIN_ENABLED` durante o rollout
- [ ] `DEPLOY.md:15` **invertido** ("Não é preciso configurar Supabase Auth" passa a ser falso) → substituído pelos **9 passos humanos** da ADR-0030 §10
- [ ] `DEPLOY.md:44` marca `AUTH_JWT_SECRET` como **legado do rollout** e adiciona `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`sync: false`), `AUTH_LEGACY_LOGIN_ENABLED` e **`CONEXOS_CRED_ENC_KEY`**
- [ ] `DEPLOY.md:57` e `:89` rebaixam a geração do `AUTH_JWT_SECRET` a passo **de rollout**, removível na Fase 4
- [ ] `DEPLOY.md:96` ajustado: `seed-admin` semeia via Supabase e **falha** sem `ADMIN_PASSWORD` (default removido)
- [ ] `README.md:29` — "auth Supabase" **deixa de ser falso**: precisar para "auth Supabase (GoTrue) + autorização por `app_user`"
- [ ] `README.md:61` — o bypass de dev passa a injetar o usuário sintético `dev-bypass@local`, corrigindo o 401 em toda mutação em dev
- [ ] `CLAUDE.md:28` — coluna **Atual** vira "Supabase Auth (GoTrue, ES256/JWKS) + autorização resolvida de `app_user`", com a nota de que a costura para SSO corporativo já está pronta
- [ ] `render.yaml` ganha `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (`sync: false`), `AUTH_LEGACY_LOGIN_ENABLED` **e `CONEXOS_CRED_ENC_KEY`** (`sync: false`) — esta última é gap **pré-existente** que mantém I-Usuario-5 inerte em produção
- [ ] `src/frontend/.env.example:4-5` — o comentário atual diz literalmente *"The token is stored in localStorage. No Supabase/OAuth"*: reescrito, e adicionadas `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_PROVIDER`
- [ ] `lib/arquitetura/tecnica.ts:120-121` referencia `lib/auth/token.ts` e `components/auth/RouteGate.tsx` **por string** no diagrama de arquitetura — atualizado com `lib/supabase/*` e `middleware.ts`, senão a documentação técnica da própria app fica apontando para um desenho que mudou
- [ ] `migration-debt.md` **O6** ("RBAC por perfil ainda ausente") atualizado: o `role` passa a ser confiável e revogável; o que **resta** é `filiais` (follow-up P1)
- [ ] **Follow-ups novos registrados** em `supabase-auth-regis-followups.md`: (P2) migrar formulários para `react-hook-form` + `zod` e criar as moléculas `FormField` / `PasswordInput` que `docs/design-system/forms.md` especifica e que **não existem** em `components/ui/`; (P3) unificar a constante duplicada de base-URL da API (`lib/api.ts:20` e `AuthProvider.tsx:14`)
- [ ] `CHANGELOG.md` atualizado no bump

**Dependencies:** todas as anteriores (executar por último, junto do código)

---

## Passos humanos bloqueantes (fora do código — Yuri)

Nenhuma task acima os cobre; sem eles a feature **não sobe em produção**. ADR-0030 §10:

1. **Auth → Providers: desligar signup público** — sem isso qualquer pessoa obtém JWT válido do projeto
2. **Auth → SMTP customizado** — bloqueia `convidarUsuario` e o reset; **não** bloqueia o fallback com senha
3. **Auth → URL Configuration** (Site URL + Redirect URLs: domínio Vercel e `localhost:3000`)
4. **Auth → Email templates** em PT-BR (convite e recuperação)
5. **Auth → JWT Keys:** chaves assimétricas (ECC P-256), mantendo o segredo legado no rollout
6. **Auth → Sessions:** TTL do access token e rotação de refresh com reuse detection
7. **Render:** as 4 env vars da Task 18
8. **Vercel:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_PROVIDER`
9. Confirmar que o schema `auth` **não** está exposto via PostgREST

---

## QaCoach — roteiro no tenant de dev (Yuri executa antes do PR)

Tasks que **exigem** roteiro: **T13** (import de hash) e o bloco abaixo, que fecha o cutover.

Com backend em `npm run dev` e **`DEV_AUTH_BYPASS=false`**:

1. Login de um usuário migrado **com a senha antiga** — prova que o import bcrypt conferiu
2. **`GET /me/conexos-status` respondendo `ok`/`ausente` exatamente como antes da migração** — este é *o* sinal. Se `platformUsername` deixar de casar com `app_user.username`, `getVinculoConexos` devolve `null` e o sistema **degrada para o robô sem erro, sem log e sem alarme**; as baixas continuam saindo, atribuídas à máquina
3. Uma mutação como `admin` (200) e a mesma como `operador` (403)
4. Desativar o usuário pela UI e confirmar **403 em ≤30 s**, sem esperar o token expirar — inclusive numa rota de **leitura** (I-Usuario-4)
5. Ciclo completo de reset de senha por e-mail
6. Sessão sobrevive a **mais de uma hora** sem o `SessionExpiredModal` aparecer
7. Executar uma baixa e conferir que `executado_por` gravou o **e-mail**, não um UUID
8. Convidar um usuário, aceitar o convite, e confirmar que ele vira `ativo`; desativar outro usuário e confirmar que **nenhum** fluxo de convite/reset o reativa
9. **Logar como `admin` e confirmar que a tela `/usuarios` e o card de admin da home continuam visíveis** — é o sintoma de §D3, e ele não produz erro nenhum: a UI simplesmente some
10. Abrir `/auth/forgot-password` **deslogado**, direto pela URL — confirma que a rota é pública e não entra em loop de redirect

---

## Definition of Done

Todas as tasks completas **E**:

- [ ] `npm run typecheck` (backend + frontend) ✅
- [ ] `npm run lint` (backend + frontend) ✅
- [ ] `npm test` (backend + frontend) ✅
- [ ] **PatternGuardian** ✅
- [ ] **Ontology diff presente** (`entity_changed = true`) ✅
- [ ] **`DesignSystemReviewer`** ✅ (Fase F toca `src/frontend/`)
- [ ] **QaCoach**: roteiro executado no tenant de dev, com o item 2 (`/me/conexos-status`) confirmado ✅
- [ ] **Regis-Review** rodado após o verde; só **P0** volta ao loop, P1/P2/P3 → `_inbox/supabase-auth-regis-followups.md` ✅
- [ ] Rebase de `origin/main` aplicado, gates ainda verdes ✅
- [ ] **Bump de versão** (FE+BE lockstep) — delta tem `feat` em `src/` ⇒ **minor** ⇒ **v0.21.0** (atual `0.20.1`) via `scripts/bump-version.ps1 -Execute` + `CHANGELOG.md`, commit `chore(release): v0.21.0` ✅

> **`AwsInfraArchitect` não é acionado** — não existe `infra/` nem Terraform neste repositório; o deploy é
> Render + Vercel (CLAUDE.md § Estado Atual vs. Alvo). **`ObservabilityAdvisor` não é acionado** — não há
> Lambda handler nem job EventBridge novo; `migrate-users-to-supabase` é job one-shot de CLI, não agendado.

---

## Contradições entre o plano e a ontologia (a ontologia venceu)

1. **Contagem dos call sites.** O plano cita **2** (`conexosIdentity.ts` e `me.ts:26`); a ontologia diz **21**.
   Verificado por grep em 2026-08-06: **21 exatos**, e `me.ts` está na linha **24**, não 26. Vale a ontologia.
   Nuance que só o código revela: **19 são auditoria e 2 são leitura de identidade** — tratamento diferente (§D1).

2. **`convidado` e os dois caminhos de criação não existem no plano.** Ele descreve apenas
   `POST /usuarios` criando no Supabase. A ontologia (U1/U3, ADR-0030 §7) exige **convite + fallback**,
   com atomicidade e compensação. Tasks 9-11 seguem a ontologia.

3. **Discriminador de `convidado` proposto na state-machine é inconsistente com a ação.**
   `state-machines/usuario.md` (§"Nota de implementação") sugere `authUserId IS NULL AND convite pendente`;
   `actions/usuario/convidar-usuario.md` exige `auth_user_id` **preenchido** na criação. Os dois não podem
   valer juntos. Resolvido em §D2 com coluna persistida — e a decisão é de **segurança**, não de UI.

4. **`SupabaseAdminClient.getUserById` não está na superfície declarada.**
   `integrations/supabase-auth.md` lista `inviteByEmail`, `createUser`, `updateUserById`, `setBanned`,
   `deleteUser`. A Task 11 **acrescenta `getUserById`** — sem ele não há como verificar o aceite do convite
   no provedor, e o reflexo de U2 viraria "JWT válido ⇒ ativa", que reabre a reativação indevida.
   **Extensão aditiva; merece uma linha na integração quando o OntologyCurator revisitar.**

5. **ADR e versões.** O plano fala em ADR `0028` e bump para `v0.20.0`; a ADR real é **0030** e a base já
   está em **v0.20.1** ⇒ bump para **v0.21.0**. Vale o estado do repositório.

6. **Migração do login para `react-hook-form` + `zod`: adiada, contra o plano.** A ontologia não a pede;
   as moléculas que a spec do Design System exige (`FormField`, `PasswordInput`) **não existem**; e a tela
   de login é a peça que menos pode quebrar num cutover cujo risco declarado é lockout geral. §D3 e
   follow-up P2. **Divergência do plano assumida explicitamente, não omitida.**

7. **`withAuthHeaders` tem 52 call sites, não "~40"** (`lib/api.ts` 23, `recebimentos.ts` 8, `sispag.ts` 8,
   `usuarios.ts` 8). O número não muda a conclusão do plano — nenhum deles precisa ser editado, porque a
   função já é `async` — mas o critério de aceite da Task 16 passa a ser verificável em cima do número certo.

## Achados novos, de nenhum dos dois documentos

8. **`useIsAdmin()` vira `false` para todo mundo no cutover.** `decodeJwtRole` lê o claim `role` do token;
   o token do GoTrue traz sempre `'authenticated'`. A tela de usuários e o card de admin **desaparecem
   para os admins**, sem erro e sem teste vermelho. É o mesmo problema que a ADR-0030 §3(4) resolve no
   backend, não percebido no frontend. §D3, Tasks 10 e 16.

9. **O teste que se anuncia como guarda de regressão do modo dual não guarda nada.**
   `auth.test.ts:291` (*"accepts an HS256 token … even when SUPABASE_URL is set"*) chama `.setIssuer(ISSUER)`
   na linha 295 — assina um `iss` que **nenhum token real de produção tem**, porque `AuthService.signToken`
   nunca chama `.setIssuer()`. O teste passa hoje e continuaria passando **depois** de a armadilha do issuer
   derrubar todas as sessões. Critério de aceite da Task 3.

10. **`403` não tem tratamento nenhum no cliente** (`lib/http.ts:28-35` intercepta só 401). Depois do
    cutover o 403 do `appUserContext` passa a ser um caminho comum, e hoje ele cairia no erro genérico —
    ou, pior, seria lido como sessão expirada. Task 16.

11. **`PUBLIC_ROUTES` (`RouteGate.tsx:11`) e `AppShell.tsx:16` são o par que faz a recuperação de senha
    funcionar ou entrar em loop.** As páginas `/auth/*` nascem gateadas por default. Task 15.

12. **`jest.config.js:41-43` impõe piso de cobertura em `./lib/auth/`** (24% linhas): arquivo novo sem
    teste nesse diretório derruba o CI. Task 14 mantém os arquivos novos em `lib/supabase/`.
