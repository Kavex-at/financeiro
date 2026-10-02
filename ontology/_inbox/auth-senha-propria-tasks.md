# Tasks: auth-senha-propria

> Slug: `auth-senha-propria` · Branch: `feat/auth-senha-propria` · Base: `main` (@ `e4730da`, v0.49.0)
> Worktree: `.claude/worktrees/auth-senha-propria` · Migration: **0073** · ADR: **0059** (0072/0058 estão
> reservadas pelo PR #101, `feat/perfil-usuario`; reconferir as quatro no rebase)
> Modo: **TWEAK mínimo**. Continua as ADRs 0051, 0053 e 0057.

**Spec source:** ontology/_inbox/auth-senha-propria-interview.md (todos os defaults aprovados pelo dono do ciclo, inclusive o de Q1 e as resoluções dos conflitos 1–7)
**Ontology diff:** no. `entity_changed = false`: `app_user` e a trilha de acesso são infraestrutura de autenticação. Só a ADR-0059
**Estimated scope:** M (cerca de 16 arquivos, nenhum novo módulo de infraestrutura: 1 migration aditiva, 1 service novo, 1 classe de política, extensões pontuais em client, mirror, repositório, limitador, redação e na rota `/me`; o único ponto incerto é o resultado do probe da Task 1, que escolhe entre dois caminhos já desenhados)

## Decisões que valem para todas as tasks

Do contrato aprovado (não redesenhar):

- `GET /me/senha/politica` → 200 `{ minimo: 8, maximo: 72, regras: [] }`. `regras` sai **vazio**: tamanho vem de `minimo`/`maximo` e "diferente da atual" o front já desenha sozinho (PR #101, `montarChecklist`). Nenhuma regra extra nova neste tweak.
- `POST /me/senha` `{ senhaAtual, novaSenha }`, Zod `.strict()`, ambos `string` não vazia. Respostas:
  - **204** sucesso, sem corpo.
  - **400** `{ codigo: 'POLITICA', regras: string[], error }`, **antes** de qualquer bcrypt ou chamada ao GoTrue. Ids possíveis: `tamanho` (< 8 caracteres ou > 72 **bytes** UTF-8, `Buffer.byteLength`) e `diferente_da_atual` (`novaSenha === senhaAtual`).
  - **400** do `validate` (corpo malformado/campo extra) no formato de hoje `{ error, details }`, sem `codigo`.
  - **422** `{ codigo: 'SENHA_ATUAL_INVALIDA', error }`. **Nunca 401** nesta rota por senha errada.
  - **429** `{ codigo: 'MUITAS_TENTATIVAS', error }`: limitador por usuário **ou** GoTrue 429 na sonda (`rateLimited`), como o D5 do login.
  - **503** `{ codigo: 'AUTH_INDISPONIVEL', error: 'Serviço de autenticação indisponível; nada foi alterado.' }`: GoTrue 5xx/timeout na sonda ou no passo de escrita. Nunca desloga.
  - `error` sempre em português; o front lê só `codigo`.
- Guard: `somenteAutenticado()` (usuário existente e ativo). Sem permissão de módulo. Identidade = `req.user.sub` (username do banco, I2); o JWT sozinho não basta, a senha atual é verificada.
- **Verificação da senha atual pelo modo (`AUTH_PROVIDER`):** `local` = `bcrypt.compare` contra `app_user.password_hash`; `supabase` = password grant com o **e-mail** do `app_user` (sem `auth_user_id` ou sem e-mail → verifica por bcrypt local, D3) e, em seguida, `logout(scope='local')` da sessão-sonda (best-effort: falha vira `LogService.warn`, não muda a resposta). A sessão-sonda é encerrada **antes** da transação de escrita.
- **Escrita (R6/R7 da ADR-0057):** `bcrypt.hash(novaSenha, 12)`; `UserRepository.updatePassword` passa a **sempre** abrir `withTransaction` + `lerCredencial(tx, id, lock=true)`, com ou sem espelho (conflito 3). Dentro da mesma transação: `UPDATE password_hash` → evento de auditoria → passo do espelho (se houver) → COMMIT. Falha do GoTrue = ROLLBACK + 503. Sucesso no GoTrue e falha no COMMIT = `CredentialMirror.aposFalha` (já existe).
- **Auditoria:** `app_user_access_event` com `tipo='senha'`, `ator` = o próprio username, `alvo_user_id` = o próprio id, `antes`/`depois` **NULL**, na transação da escrita. Mais **uma** linha `LogService.info` em português (`'senha alterada pelo próprio usuário'`) com `usuario`, `modo` e `revogacao` (`'gotrue-put-user' | 'scope-others' | 'pulada-hs256' | 'sem-vinculo'`), **sem** senha, hash ou token.
- **Revogação das outras sessões, decidida pelo `alg` do Bearer** (re-extraído de `req.headers.authorization` com `decodeProtectedHeader`, conflito 2), não por `AUTH_PROVIDER`:
  - `HS256` (token do app) → nada a revogar no GoTrue; os outros tokens HS256 vivem até o `exp` (documentado na ADR-0059). Loga `revogacao: 'pulada-hs256'`.
  - Token do GoTrue (ES256) → depende do resultado da Task 1 (ver abaixo).
- **Ramo decidido pela Task 1 (Q1):**
  - **Se o `PUT /admin/users/:id { password }` revogar TODAS as sessões** (esperado pela leitura do fonte): para caller com token do GoTrue, o passo do espelho dentro da transação vira `PUT /user { password }` com o **access token do chamador** (o GoTrue faz `LogoutAllExceptMe`); **não** há `logout scope=others` depois. Caller HS256 com `auth_user_id` mantém o `adminUpdateUser`.
  - **Se NÃO revogar:** o passo dentro da transação continua `adminUpdateUser { password }` (como no reset do admin) e, **depois do COMMIT**, `logout(callerToken, 'others')` best-effort (falha = `LogService.warn` com `AUTH_INDISPONIVEL`, resposta continua 204: a senha já trocou).
  - Nos dois ramos o contrato com o front não muda (204).
- **Limitador por usuário (conflito 6):** chave `senha:${req.user.sub}`, **5 falhas / 15 min**, `skipSuccessfulRequests` + `requestWasSuccessful: res.statusCode !== 422` (só 422 conta), `handler` próprio respondendo 429 `{ codigo: 'MUITAS_TENTATIVAS', error: MENSAGEM_MUITAS_TENTATIVAS }`, `store` injetável para teste. Montado **depois** do `validate`, então corpo malformado nem chega a ele. O `globalLimiter` continua valendo.
- **`SupabaseAuthClient.logout(accessToken, scope = 'local')`** (conflito 1): parâmetro novo com default `'local'`; os chamadores atuais (`SupabaseSessionService.logout`) não mudam.
- **Redação (conflito 4):** `senhaatual` e `novasenha` entram na lista exata de `http/redact.ts`.
- **Máximo de 72 em bytes no servidor (conflito 5):** senha não-ASCII entre 72 caracteres e 72 bytes passa no checklist do front e volta 400 `POLITICA` com `tamanho`. Aceito.
- Mensagens ao operador (HTTP, log) em português; classes e identificadores em inglês (`OwnPasswordService`, `PasswordPolicy`, `CurrentPasswordInvalidError`, `PasswordPolicyError`).

Decisões tomadas neste scoping (conferir no review):

- **S1 — Sem reverse para a 0073.** A migration só amplia a lista da CHECK; o backend antigo ignora o tipo novo e continua inserindo os três tipos de antes. `rollbacks.test.ts` **não muda** (também evita conflito com o PR #101, que mexe nesse arquivo). Voltar a CHECK estreita exigiria apagar linhas da trilha append-only, o que não se faz.
- **S2 — Auditoria do reset do admin: follow-up, não "de graça".** O caminho compartilhado (`updatePassword` sempre transacional) recebe o evento como **parâmetro opcional**. O reset do admin passaria a gravar a trilha só se `resetPassword(id, password)` recebesse o `ator`, o que mexe na assinatura, na rota `/usuarios/:id/reset-senha` e nos testes dela. Não cai de graça: fica como follow-up P2, junto com o máximo de 72 bytes no create/reset do admin. O que **cai de graça** e entra: o reset do admin passa a rodar em transação com lock mesmo sem espelho (conflito 3).
- **S3 — `GET /me/senha/politica` com `regras: []`** (ver acima). Se `diferente_da_atual` ou `tamanho` aparecessem em `regras`, o front desenharia dois itens iguais no checklist.
- **S4 — Probe como fumaça de QA.** O `jobs/probe-gotrue-local.ts` ganha os cenários da Task 1 e continua recusando rodar fora de `localhost`/`127.0.0.1`. Não é job agendado: não aciona ObservabilityAdvisor.

## Plano de Validação Ground-Truth

**Veredito: `SEM_GROUND_TRUTH`.** Não há valor monetário nem leitura/escrita no Conexos, na Nexxera ou no GED. As invariantes que se aplicam (R6: local e GoTrue nunca divergem; I2: identidade = username; trilha append-only; zero segredo em log) são cobertas pelos testes da Task 2 e pelo roteiro de QA local.

## Task list

### Task 1: Probe Q1 — o update admin de senha revoga todas as sessões do GoTrue?

**Files to change:**
- `src/backend/jobs/probe-gotrue-local.ts` (acrescenta os cenários abaixo; mantém a recusa fora de `localhost`/`127.0.0.1`)
- `ontology/_inbox/auth-senha-propria-interview.md` (acrescenta a seção "Resultado do probe Q1", com versão do GoTrue, saída de cada cenário e o ramo escolhido)

**Acceptance criteria:**
- [ ] Roda contra o GoTrue local de `npx supabase@2.118.0 start` numa pasta temporária fora do repositório (mesmo procedimento do T-1, `config.toml` com `enable_signup = false`, `enable_anonymous_sign_ins = false`, `[auth.email] secure_password_change = false`). A CLI do sistema (2.12.1) **não** é atualizada; nenhuma pasta `supabase/` é commitada. A versão do GoTrue (`GET /auth/v1/health`) é registrada e deve ser a v2.197.x do T-1 (se não for, fixar a imagem e registrar)
- [ ] Cenário A (update admin): cria um usuário descartável, abre **duas** sessões (A e B) por password grant, roda `PUT /admin/users/:id { password }` e imprime, um veredito por linha: refresh de A (ok/400), refresh de B (ok/400), login com a senha antiga (falha), login com a nova (entra)
- [ ] Cenário B (`PUT /user`): mesmo arranjo, mas `PUT /user { password }` com o **access token da sessão A**; imprime refresh de A, refresh de B, senha antiga, senha nova. Esperado pela leitura do fonte: A ok, B 400
- [ ] Cenário C (`logout scope=others`): duas sessões, `POST /logout?scope=others` com o token de A; imprime refresh de A (ok) e de B (400). Garante que o ramo "admin não revoga" também funciona
- [ ] Cenário D: `PUT /user { password }` com `secure_password_change = false` **não** pede `nonce`/reautenticação; registrar a resposta exata (status + corpo) caso peça
- [ ] A seção "Resultado do probe Q1" termina com **uma** linha de decisão: `RAMO = put-user` (admin revoga tudo) ou `RAMO = admin+others` (admin não revoga), que as Tasks 2 e 4 seguem
- [ ] Usuários do probe apagados no fim (`DELETE /admin/users/:id`), mesmo se um cenário falhar
- [ ] `npm run typecheck` e `npm run lint` passam (o probe é TypeScript do repositório)

**Dependencies:** none

---

### Task 2: Testes que falham para a troca da própria senha

**Files to change:**
- `src/backend/routes/me.test.ts` (rotas `GET /me/senha/politica` e `POST /me/senha`)
- `src/backend/domain/service/auth/OwnPasswordService.test.ts` (novo)
- `src/backend/domain/service/auth/PasswordPolicy.test.ts` (novo)
- `src/backend/domain/repository/auth/UserRepository.test.ts` (`updatePassword` sempre transacional, evento na tx)
- `src/backend/domain/client/SupabaseAuthClient.test.ts` (`logout` com `scope`; `updateOwnPassword` só no `RAMO = put-user`)
- `src/backend/domain/service/auth/CredentialMirror.test.ts` (`senha` com token do chamador)
- `src/backend/http/rateLimit.test.ts` (limitador de senha)
- `src/backend/http/redact.test.ts` (`senhaAtual`/`novaSenha`)
- `src/backend/migrations/0073_app_user_access_event_tipo_senha.test.ts` (novo, guardas estáticas no padrão da `0071_*.test.ts`)

**Acceptance criteria:**
- [ ] Todos os testes novos **falham** pela razão certa (rota/método/classe inexistente ou asserção), não por erro de import de mock; `npm test` mostra só eles vermelhos
- [ ] Cobrem os casos canônicos 1–8 da entrevista, um `it` por caso, e o 9 no nível de unidade (o passo do GoTrue chamado é o do `RAMO` da Task 1; sessão atual não é revogada; no `RAMO = admin+others`, `logout(token, 'others')` só depois do COMMIT)
- [ ] Caso 2: `novaSenha === senhaAtual` → 400 `{ codigo: 'POLITICA', regras: ['diferente_da_atual'] }` e **zero** chamadas a `bcrypt.compare`, `signInWithPassword` e `adminUpdateUser`
- [ ] Caso 3: 7 caracteres → `regras` contém `tamanho`; `'ç'.repeat(40)` (40 caracteres, 80 bytes) → `tamanho`; `'a'.repeat(72)` → aceita; `'a'.repeat(73)` → `tamanho`
- [ ] Caso 4: senha atual errada → 422 `SENHA_ATUAL_INVALIDA`, `password_hash` inalterado, nenhum evento; com `store` isolado, 5 respostas 422 seguidas → a 6ª requisição (com a senha certa) responde 429 `{ codigo: 'MUITAS_TENTATIVAS' }` sem chegar ao service; um 204 e um 400 `POLITICA` **não** contam
- [ ] Caso 5: `SupabaseAuthUnavailableError` na sonda **e**, separadamente, no passo de escrita → 503 `AUTH_INDISPONIVEL`, ROLLBACK (`password_hash` igual ao de antes, sem evento); `rateLimited` na sonda → 429 `MUITAS_TENTATIVAS`, não 503
- [ ] Caso 6: usuário sem `auth_user_id` → 204, só local, nenhuma chamada ao GoTrue, evento gravado
- [ ] Caso 7: campo extra ou faltando → 400 sem `codigo`, limitador intocado
- [ ] Caso 8: `redact({ senhaAtual: 'x', novaSenha: 'y' })` devolve as duas `[REDACTED]`; a linha `LogService` de sucesso não contém senha, hash nem token (asserção sobre o `data` serializado)
- [ ] Revogação pelo `alg`: Bearer HS256 → nenhuma chamada de revogação e log `revogacao: 'pulada-hs256'`; Bearer ES256 → caminho do `RAMO`
- [ ] Modo `supabase`: a sonda usa o **e-mail** do `app_user`, e `logout(tokenDaSonda, 'local')` é chamado antes da transação; falha nesse logout não muda a resposta
- [ ] Nenhum caminho da rota responde 401 por senha errada (asserção explícita)
- [ ] `UserRepository.updatePassword` sem `antesDoCommit` abre transação e trava a linha (`FOR UPDATE`); com `evento`, o `INSERT` da trilha roda na mesma `tx`, antes do passo do espelho
- [ ] `SupabaseAuthClient.logout(token)` sem `scope` continua chamando `/logout?scope=local` (regressão do logout atual)
- [ ] Guarda estática da 0073: a lista nova é exatamente `('papel','excecao','ativo','senha')`, com `DROP CONSTRAINT IF EXISTS app_user_access_event_tipo_check` antes do `ADD`, sem `DROP TABLE`/`DELETE`/`UPDATE`
- [ ] `GET /me/senha/politica` → 200 `{ minimo: 8, maximo: 72, regras: [] }`, com `somenteAutenticado()`

**Dependencies:** Task 1 (os testes do passo do GoTrue seguem o `RAMO` registrado)

---

### Task 3: Migration 0073 e escrita de senha sempre transacional com evento de auditoria

**Files to change:**
- `src/backend/migrations/0073_app_user_access_event_tipo_senha.sql` (novo)
- `src/backend/domain/repository/auth/AccessRepository.ts` (`ACCESS_EVENT_TYPE.SENHA = 'senha'`)
- `src/backend/domain/repository/auth/UserRepository.ts` (`updatePassword`)

**Acceptance criteria:**
- [ ] 0073 idempotente, no padrão da 0069: `ALTER TABLE app_user_access_event DROP CONSTRAINT IF EXISTS app_user_access_event_tipo_check;` + `ADD CONSTRAINT app_user_access_event_tipo_check CHECK (tipo IN ('papel','excecao','ativo','senha'))`. Cabeçalho em português citando ADR-0059 e dizendo que é aditiva, segura para o backend antigo e **sem reverse** (S1)
- [ ] Aplicada num Postgres limpo depois da 0066: `INSERT ... tipo='senha'` passa, `tipo='outro'` falha; reaplicar a 0073 não dá erro (via `test:sql` se o harness de migrations cobrir, senão pelo passo 1 do roteiro de QA)
- [ ] `updatePassword(id, hash, { antesDoCommit?, evento? })`: sempre `withTransaction` + `lerCredencial(tx, id, true)`; ordem dentro da tx: `UPDATE password_hash` → `accessRepository.recordEvent(tx, evento)` (se houver) → `antesDoCommit` (se houver). Retorna `false` para id inexistente sem gravar nada
- [ ] `UserAdminService.resetPassword` continua funcionando sem passar `evento` (S2), agora transacional também sem espelho; `UserAdminService.test.ts` e `routes/usuarios.test.ts` verdes sem mudança de comportamento observável
- [ ] SQL parametrizado, sem interpolação; `typecheck`, `lint` e os testes da Task 2 desta camada verdes

**Dependencies:** Task 2

---

### Task 4: GoTrue: `logout` com escopo, passo de senha pelo token do chamador

**Files to change:**
- `src/backend/domain/client/SupabaseAuthClient.ts`
- `src/backend/domain/service/auth/CredentialMirror.ts`
- `src/backend/domain/interface/auth/SupabaseAuth.ts` (tipo do escopo, se o client exportar tipos por aqui)

**Acceptance criteria:**
- [ ] `logout(accessToken, scope: 'local' | 'others' = 'local')`; caminho `/logout?scope=${scope}` com o escopo vindo de constante tipada, nunca string do request
- [ ] Só no `RAMO = put-user`: `updateOwnPassword(accessToken, password)` → `PUT /auth/v1/user { password }` com `Authorization: Bearer <token do chamador>` e `apikey` publicável; mesmo mapeamento de erros dos outros métodos (5xx/timeout/429 → `SupabaseAuthUnavailableError`, com `rateLimited` no 429); resposta validada com Zod. No `RAMO = admin+others`, este método **não** é criado
- [ ] `OperacaoCredencial` `{ tipo: 'senha'; senha: string; tokenDoChamador?: string }`: com `tokenDoChamador` e `RAMO = put-user` o passo chama `updateOwnPassword`; sem ele (reset do admin, caller HS256) chama `adminUpdateUser` como hoje. Sem `auth_user_id` → nenhum passo (D3, inalterado)
- [ ] `estado.supabaseAlterado` marcado nos dois caminhos, para o `aposFalha` continuar valendo
- [ ] `SupabaseSessionService.logout` inalterado (default `'local'`); `@singleton() @injectable()` preservados; nada novo no `bootstrapAppContainer`
- [ ] Testes de client e mirror da Task 2 verdes; `typecheck`, `lint` verdes

**Dependencies:** Task 2

---

### Task 5: `OwnPasswordService` e `PasswordPolicy` (domínio)

**Files to change:**
- `src/backend/domain/service/auth/PasswordPolicy.ts` (novo)
- `src/backend/domain/service/auth/OwnPasswordService.ts` (novo)
- `src/backend/domain/errors/` (novo arquivo ou extensão do existente de auth: `PasswordPolicyError` com `regras`, `CurrentPasswordInvalidError`)
- `src/backend/domain/service/auth/UserAdminService.ts` (só se o `BCRYPT_ROUNDS` precisar ser exportado/compartilhado; nenhuma mudança de comportamento)

**Acceptance criteria:**
- [ ] `PasswordPolicy` (classe exportada, `@injectable()`, métodos arrow com modificador explícito): `MINIMO = 8`, `MAXIMO_BYTES = 72`; `descrever()` → `{ minimo: 8, maximo: 72, regras: [] }`; `violacoes(nova, atual)` → `('tamanho' | 'diferente_da_atual')[]`, tamanho mínimo em caracteres e máximo em `Buffer.byteLength(nova, 'utf8')`
- [ ] `OwnPasswordService.alterar({ username, senhaAtual, novaSenha, tokenDoChamador?, algDoToken })`, nesta ordem: política (lança `PasswordPolicyError` sem tocar bcrypt/GoTrue) → carrega o `app_user` → verifica a senha atual pelo modo (`EnvironmentProvider`, nunca `process.env`) → encerra a sessão-sonda (`scope='local'`, best-effort) → `bcrypt.hash(nova, 12)` → `CredentialMirror.preparar({ tipo: 'senha', senha, tokenDoChamador })` → `updatePassword(id, hash, { antesDoCommit, evento })` envolto no mesmo `comEspelho`/`aposFalha` do admin → (só `RAMO = admin+others` e Bearer do GoTrue) `logout(token, 'others')` best-effort depois do COMMIT → `LogService.info` PT sem segredo
- [ ] Senha atual errada (bcrypt falso ou `SupabaseAuthRejectedError`) → `CurrentPasswordInvalidError`; nada gravado
- [ ] Evento: `{ actor: username, targetId: id, type: ACCESS_EVENT_TYPE.SENHA, before: null, after: null }`
- [ ] `tokenDoChamador` só é repassado ao mirror quando `algDoToken !== 'HS256'`; HS256 cai no `adminUpdateUser` (se houver vínculo) e loga `revogacao: 'pulada-hs256'`
- [ ] Não chama `AccessService.invalidar` (senha não muda permissões; o `ativo` continua relido a cada request)
- [ ] Testes de `PasswordPolicy` e `OwnPasswordService` da Task 2 verdes; `typecheck`, `lint` verdes

**Dependencies:** Task 3, Task 4

---

### Task 6: Rotas `/me/senha`, limitador por usuário e redação

**Files to change:**
- `src/backend/routes/me.ts`
- `src/backend/http/rateLimit.ts` (`buildOwnPasswordLimiter`, constantes `OWN_PASSWORD_FAILURES = 5`, `OWN_PASSWORD_WINDOW_MS = 15 * 60_000`)
- `src/backend/http/redact.ts` (`senhaatual`, `novasenha`)
- `src/backend/http/schemas.ts` ou `routes/me.ts` (schema Zod `.strict()` do corpo, onde ficam os outros schemas de rota)

**Acceptance criteria:**
- [ ] `GET /me/senha/politica` e `POST /me/senha` com `somenteAutenticado()`; ordem no POST: `validate(schema)` → limitador por usuário → handler
- [ ] Handler extrai o `alg` com `decodeProtectedHeader` do Bearer de `req.headers.authorization` (sem reverificar o token: o `auth` já verificou) e passa token + alg ao service
- [ ] Mapeamento: `PasswordPolicyError` → 400 `{ codigo: 'POLITICA', regras, error }`; `CurrentPasswordInvalidError` → 422; `SupabaseAuthUnavailableError` com `rateLimited` → 429 `MUITAS_TENTATIVAS`; sem `rateLimited` → 503 `AUTH_INDISPONIVEL`; sucesso → 204 sem corpo. Mensagens `error` em português
- [ ] Limitador: chave `senha:${req.user.sub}`, só 422 conta, `handler` próprio com corpo `{ codigo: 'MUITAS_TENTATIVAS', error: MENSAGEM_MUITAS_TENTATIVAS }`, `store` injetável (mesmo padrão de `buildLoginLimiters`)
- [ ] `redact` cobre `senhaAtual`/`novaSenha` (casamento case-insensitive já existente)
- [ ] Todos os testes da Task 2 verdes; `npm run typecheck`, `npm run lint`, `npm test` verdes no backend

**Dependencies:** Task 5

---

### Task 7: ADR-0059 e nota de deploy

**Files to change:**
- `ontology/decisions/0059-auth-troca-da-propria-senha.md` (novo)
- `DEPLOY.md` (seção de auth: "Secure password change" do Supabase deve ficar OFF; nada novo a configurar)
- `ontology/CHANGELOG.md` (uma linha apontando a ADR-0059, sem mudança de entidade)

**Acceptance criteria:**
- [ ] ADR-0059 registra: contrato (`/me/senha/politica`, `/me/senha`, códigos e status), política (8 caracteres a 72 bytes, sem regra extra), verificação por modo, R6/R7 inalteradas, revogação pelo `alg` e o `RAMO` medido na Task 1 (com a versão do GoTrue), o limite por usuário (5/15 min, só 422), a 0073 sem reverse (S1), e o que fica de fora (senha temporária, esqueci-a-senha/SMTP, máximo e auditoria no reset do admin como follow-ups)
- [ ] ADR-0059 documenta o modo `local`: os outros tokens HS256 do usuário continuam válidos até o `exp`
- [ ] ADR cita e continua 0051, 0053 e 0057; numeração conferida contra a `main` no rebase (0058 é do PR #101)
- [ ] `DEPLOY.md` diz como conferir que "Secure password change" está OFF (ver "Deploy" abaixo)

**Dependencies:** Task 1 (o ramo), Task 6

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (em `src/backend/`)
- [ ] `npm run lint` ✅ (em `src/backend/`)
- [ ] `npm test` ✅ (em `src/backend/`)
- [ ] PatternGuardian gate ✅ (conferir achados contra a `main`: ele revisa o arquivo inteiro)
- [ ] entity_changed = false: sem ontology diff; ADR-0059 presente ✅
- [ ] Frontend não tocado (contrato servido ao PR #101): DesignSystemReviewer não se aplica ✅
- [ ] Nenhum handler/job novo agendado (só o probe local estendido): ObservabilityAdvisor não se aplica ✅
- [ ] Sem `infra/`: AwsInfraArchitect não se aplica ✅
- [ ] Roteiro de QA local abaixo executado e registrado na entrevista ✅
- [ ] Regis-Review gate rodado, P0 remediados, P1–P3 em `ontology/_inbox/auth-senha-propria-regis-followups.md` (incluir os follow-ups S2) ✅
- [ ] Rebase da `main` sem conflito pendente; 0073/0059 ainda livres na `main` ✅
- [ ] Delta tem `feat` em `src/`: versão do app bumpada (minor, FE+BE lockstep) à mão nos dois `package.json` (sem pwsh nesta máquina; conferir a versão real da `main` antes) + `CHANGELOG.md` atualizado, commit `chore(release): vX.Y.Z` ✅

## Deploy

**Nada a configurar.** Nenhuma env nova; `AUTH_PROVIDER`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY` já existem. A 0073 é aditiva: os crons podem aplicá-la antes do deploy do backend novo sem afetar o antigo. Rollback de código: a CHECK ampliada fica (sem reverse, S1).

**"Secure password change" do Supabase precisa continuar OFF.** Com ele ON, o `PUT /user { password }` passa a exigir `nonce` de reautenticação (e-mail), e o projeto não tem SMTP: a troca quebraria no `RAMO = put-user`. Como conferir, sem escrever nada:
- Dashboard: Authentication → Sign In / Providers → Email → **Secure password change** desmarcado; ou
- Management API (só leitura, com token pessoal): `GET https://api.supabase.com/v1/projects/kngrpoqzaxtuzkcugsyl/config/auth` → `security_update_password_require_reauthentication` deve ser `false`.

O front continua com `SENHA_PROPRIA_HABILITADA = false` até o tweak que liga a flag; este backend pode ir para produção antes, sem efeito visível.

## Roteiro de QA local (contra `npx supabase@2.118.0`)

Pré-requisitos: pasta temporária fora do repo com `npx supabase@2.118.0 init && npx supabase@2.118.0 start` (CLI do sistema **não** é atualizada), `secure_password_change = false`, `enable_signup = false`; Postgres local do backend com as migrations aplicadas; backend em `npm run dev` com `SUPABASE_URL=http://127.0.0.1:54321` e as chaves locais; dois usuários de teste: `qa1` com `auth_user_id` (vinculado pelo `sync-supabase-auth`) e `qa2` sem vínculo. Rodar com `databaseConnectionString` apontando **só** para o banco local.

1. **Migration:** `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'app_user_access_event_tipo_check';` mostra os quatro tipos. Reaplicar o arquivo não dá erro.
2. **Política:** `GET /me/senha/politica` → `{ minimo: 8, maximo: 72, regras: [] }`. `POST /me/senha` com nova de 7 caracteres → 400 `regras: ['tamanho']`; com `'ç'×40` → 400 `['tamanho']`; com nova = atual → 400 `['diferente_da_atual']`.
3. **Senha atual errada:** 5× `POST` com `senhaAtual` errada → 5× 422 `SENHA_ATUAL_INVALIDA` (nunca 401, sem modal no front); a 6ª, com a senha certa, → 429 `MUITAS_TENTATIVAS`. Esperar a janela (ou reiniciar o backend, store em memória) antes do passo 4.
4. **Sucesso, `AUTH_PROVIDER=supabase`:** abrir duas sessões de `qa1` (A e B) por `POST /auth/login`. Trocar pela A → 204. `POST /auth/login` com a senha antiga → 401; com a nova → 200. `POST /auth/refresh` com o refresh de A → 200 (sessão atual sobrevive); com o de B → 401 (outra sessão revogada).
5. **Sucesso, `AUTH_PROVIDER=local`:** reiniciar com `local`, logar `qa1` e `qa2`, trocar a senha dos dois → 204; login com a antiga falha, com a nova entra. Para `qa1` (vinculado), conferir no GoTrue local (password grant direto em `/auth/v1/token`) que a senha nova também vale lá (R6). Registrar que um segundo token HS256 continua válido até o `exp`.
6. **GoTrue fora:** `docker stop` do contêiner do GoTrue (`supabase_auth_*`). Em `supabase`: `POST /me/senha` → 503 `AUTH_INDISPONIVEL` (a sonda falha). Em `local` com `qa1` (vinculado): → 503 no passo de escrita. Nos dois, `password_hash` inalterado (comparar `SELECT password_hash` antes/depois) e nenhuma linha nova na trilha. A sessão do front não cai. Religar o contêiner.
7. **Auditoria:** `SELECT ator, alvo_user_id, tipo, antes, depois FROM app_user_access_event WHERE tipo = 'senha' ORDER BY id DESC;` → uma linha por troca bem-sucedida dos passos 4–5, `ator` = próprio username, `antes`/`depois` NULL; nenhuma linha das tentativas 400/422/429/503.
8. **Logs sem senha:** no stdout do backend durante os passos 2–6, `grep -i` pelas senhas usadas no teste não acha nada; o corpo do request aparece com `senhaAtual`/`novaSenha` `[REDACTED]`; a linha de sucesso é em português e traz `usuario`, `modo` e `revogacao`.
9. **Limpeza:** `npx supabase@2.118.0 stop` e apagar a pasta temporária.

## Riscos e ambiguidades

- **Q1 decide o passo do GoTrue.** Se o probe mostrar comportamento diferente nas duas sessões do esperado nos dois cenários (admin não revoga e `PUT /user` revoga a atual), nenhum ramo atende "a sessão atual continua"; aí a Task 1 para e vai ao InfoGapBroker em vez de escolher.
- **Versão do GoTrue de produção.** O probe mede a v2.197 local; o comportamento de sessões no update de senha pode diferir na versão do projeto. O passo 4 do roteiro repetido em produção (com usuário descartável e OK do dono) é a única prova lá; fica como verificação pós-deploy, não como gate.
- **Divergência de id com o front (PR #101).** O checklist do front usa o id `diferente`; o servidor devolve `diferente_da_atual` (contrato da entrevista). Com 400 `POLITICA` só por esse motivo, o front mostra "não atende à política" sem marcar o item. Na prática o front já bloqueia nova = atual antes do envio, mas vale um ajuste de uma linha no PR #101 (ou aceitar). Não muda o backend.
- **Store do limitador em memória.** Reiniciar o processo zera as contagens; com uma instância no Render é aceitável (mesmo trade-off do login).
- **A sonda gasta o balde de IP do GoTrue** (conflito 7): coberto pelo limite por usuário somado ao `globalLimiter`; sem ação.
- **Reset do admin sem trilha e sem máximo** continua (S2): senha > 72 bytes pelo admin ainda vira erro do GoTrue no espelho. Follow-ups.
- **Numeração.** 0072/ADR-0058 são do PR #101. Se este PR entrar antes, a 0072 é aplicada depois da 0073 em produção: o runner aplica por nome o que falta, e as duas são aditivas e independentes, então a ordem não importa.
