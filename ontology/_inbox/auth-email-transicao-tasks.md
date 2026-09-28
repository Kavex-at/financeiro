# Tasks: auth-email-transicao

> Slug: `auth-email-transicao` · Branch: `feat/auth-email-transicao` · Base: `main` (@ `851d75a`)
> Worktree: `.claude/worktrees/auth-email-transicao` · Migration: **0064** · ADR: **0051** (reconferir no rebase)
> Passo 1 de 3 do plano de auth (e-mails reais → permissões → Supabase Auth).

**Spec source:** ontology/_inbox/auth-email-transicao-interview.md (a seção **"Respostas (2026-09-28)"** prevalece sobre o resto)
**Ontology diff:** no. `entity_changed = false`: `app_user` é infraestrutura de acesso, fora da ontologia de domínio
**Estimated scope:** L (cerca de 22 arquivos, backend + frontend + migration + docs de deploy; toca autenticação)

## Decisões que valem para todas as tasks (Respostas 2026-09-28)

- **Sem backfill.** `email` nasce `NULL` para todos. Quem cadastra o e-mail da Columbia é o admin, pela UI.
- **O token não ganha claim `email`.** `sub` continua sendo o `username` canônico do banco (I1). Os três sítios
  `req.user.email ?? req.user.sub` de `routes/recebimentos.ts` (linhas ~729, ~927 e ~967) **não são tocados**.
- **Banner por chave manual:** `AUTH_TRANSICAO_EMAIL_BANNER` (default desligado) exposta por um GET público
  que devolve exatamente `{ ativo: boolean }`. Não consulta o banco.
- **Colisão cruzada:** um e-mail não pode coincidir, sem distinção de caixa, com o `email` **nem** com o
  `username` de outro usuário (409). No login, duas linhas casando resultam em 401 e log de erro; o sistema nunca escolhe uma.
- **R11:** desativar recusa (409) quando o alvo é o próprio chamador ou o último admin ativo.
- **R12:** `seed-admin` exige `ADMIN_EMAIL` e `ADMIN_PASSWORD`, sem default no código. O usuário semeado tem `username = email = ADMIN_EMAIL`.
- Mensagens ao operador (HTTP e log) em português (ADR-0042); nomes de classe de erro em inglês.
- **Contrato do `POST /auth/login` não muda de forma:** o corpo continua `{ username, password }` (o campo passa
  a aceitar e-mail). Front (Vercel) e back (Render) sobem em momentos diferentes, e mudar o nome do campo
  quebraria o login na janela entre os dois deploys.

## Plano de Validação Ground-Truth

**Veredito: `SEM_GROUND_TRUTH`.** A feature não calcula valor monetário e não lê nem escreve no Conexos,
na Nexxera ou no GED. O gate que se aplica é o de **invariância de identidade (I1)**, coberto pelo critério da Task 3
que verifica o conteúdo exato do token.

## Task list

### Task 1: Migration 0064: `app_user.email` + trilha de edição + guarda de caixa

**Files to change:**
- `src/backend/migrations/0064_app_user_email.sql` (novo)
- `src/backend/migrations/0064_app_user_email.test.ts` (novo; asserções sobre o fonte, no mesmo padrão de `rollbacks.test.ts`, porque o runner usa `import.meta` e não roda sob Jest)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `0064_app_user_email.test.ts` escrito e falhando antes de existir o `.sql`
- [ ] Adiciona `email TEXT NULL`, `email_updated_by TEXT NULL` e `email_updated_at TIMESTAMPTZ NULL`, todos com `IF NOT EXISTS` (idempotente)
- [ ] Índice único **parcial** em `lower(email)` com `WHERE email IS NOT NULL` (`CREATE UNIQUE INDEX IF NOT EXISTS`)
- [ ] **Sem backfill:** o teste verifica que o arquivo não contém `UPDATE app_user` (R2 substituída)
- [ ] Guarda que falha alto: bloco `DO $$ ... RAISE EXCEPTION` com mensagem em português quando existem dois `username` iguais sem distinção de caixa (`GROUP BY lower(username) HAVING count(*) > 1`). O teste verifica a presença do `RAISE EXCEPTION` antes de qualquer `CREATE INDEX`
- [ ] Índice único em `lower(username)` (`CREATE UNIQUE INDEX IF NOT EXISTS`) torna a garantia da guarda permanente e serve ao `WHERE lower(username) = ...` do login
- [ ] Nenhum script de reverse é necessário (migration só aditiva, sem `UPDATE`). `rollbacks.test.ts` continua verde sem alteração
- [ ] `npm run build` copia o arquivo para `dist/migrations/` (a cópia é por glob em `MigrationFiles.list`, sem registro manual). Conferir no log `[build] N migração(ões) copiada(s)`, que deve contar uma a mais que na `main`

**Dependencies:** none

---

### Task 2: `UserRepository`: busca por identificador, e-mail com colisão cruzada, desativação guardada

**Files to change:**
- `src/backend/domain/repository/auth/UserRepository.ts`
- `src/backend/domain/repository/auth/UserRepository.test.ts`

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): casos novos em `UserRepository.test.ts` para todos os itens abaixo, com o db mockado como já é feito no arquivo
- [ ] `findByLoginIdentifier(identifier)`: SQL `WHERE lower(username) = $identifier OR lower(email) = $identifier`, parametrizado, devolvendo **todas** as linhas que casam (o repositório não decide a ambiguidade; quem decide é o `AuthService`). O mapeamento inclui `email?`
- [ ] `findByUsername` e `getVinculoConexos` continuam casando por `username` exato. O vínculo Conexos e o allow-list continuam chaveados pelo `sub` (I1)
- [ ] `AppUser` e `AppUserPublic` ganham `email?: string` (nunca `string | undefined`). `listAll` seleciona e mapeia `email`, `email_updated_by` e `email_updated_at` (opcionais). O hash continua fora de toda projeção pública
- [ ] `setEmail(id, email, updatedBy)`: um único `UPDATE ... WHERE id = $id AND NOT EXISTS (SELECT 1 FROM app_user o WHERE o.id <> $id AND (lower(o.email) = $email OR lower(o.username) = $email))`, que grava `email_updated_by` e `email_updated_at = now()`. Id inexistente resulta em NOT_FOUND; colisão resulta em `EmailAlreadyInUseError` (as duas causas são distinguidas por um SELECT de existência, sem inferência pelo `rowCount`). Violação do índice único (`23505`) também vira `EmailAlreadyInUseError`
- [ ] Mesmo e-mail que o usuário já tem é no-op idempotente: não reescreve `email_updated_*` e não conta como colisão com ele mesmo
- [ ] `create` passa a gravar `email` junto com `username` (mesmo valor) e recusa com `EmailAlreadyInUseError` quando o valor coincide com o `email` ou o `username` de **outro** usuário. Caso de teste: B tem `username = 'bsilva'` e `email = 'maria@columbiabr.com'`; criar `maria@columbiabr.com` deve dar 409, senão o login por esse identificador passaria a casar duas linhas (I3)
- [ ] `deactivateGuarded(id, actorUsername)`: roda em `withTransaction`, trava as linhas de admins ativos com `SELECT ... FOR UPDATE`, recusa com `SelfDeactivationError` quando o `username` do alvo é o do ator e com `LastActiveAdminError` quando o alvo é admin ativo e não resta outro admin ativo. Só então faz o `UPDATE ativo = false`. Há teste que prova que a checagem e o update acontecem na mesma transação, para que dois admins que se desativam ao mesmo tempo não zerem os admins
- [ ] Reativar (`ativo = true`) não passa pela guarda (`setAtivo` atual)
- [ ] `upsertAdmin(email, passwordHash)`: `username = email = $email`, `ON CONFLICT (username) DO UPDATE` atualiza hash, role, `email` e `ativo = true`
- [ ] Classes de erro novas em inglês (`EmailAlreadyInUseError`, `SelfDeactivationError`, `LastActiveAdminError`), exportadas como classes. Todo SQL usa `$nome`, sem interpolação (Rule #5)

**Dependencies:** Task 1

---

### Task 3: Login por e-mail ou usuário, sem distinção de caixa (`AuthService` + `routes/auth.ts`)

**Files to change:**
- `src/backend/domain/service/auth/AuthService.ts`
- `src/backend/domain/service/auth/AuthService.test.ts` (novo; hoje não existe)
- `src/backend/routes/auth.ts`
- `src/backend/routes/auth.test.ts` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `AuthService.test.ts` e `routes/auth.test.ts` escritos e falhando antes da mudança
- [ ] `routes/auth.ts`: o schema do corpo continua `{ username, password }`, e `username` passa a ser `trim().toLowerCase()`. Teste: `' Fulano@Kavex.COM '` chega ao service como `'fulano@kavex.com'`
- [ ] `AuthService.login` usa `findByLoginIdentifier`. Com **uma** linha, ativa e senha correta, emite o token. Com zero linhas, usuário inativo ou senha errada, devolve `null` e a rota responde o mesmo 401 `'Credenciais inválidas'` (I2). Um caso de teste para cada situação
- [ ] **Mais de uma linha** casando: devolve `null` (401), **não** chama `bcrypt.compare` e chama `LogService.error` com mensagem em português e os `id`s encontrados. O log não inclui a senha. Teste com duas linhas
- [ ] **I1 (gate de identidade):** logar pelo e-mail de um usuário cujo `username` é `'admin'` produz um token com `sub === 'admin'`. O payload decodificado tem exatamente as chaves `sub`, `role`, `aud`, `iat` e `exp`, **sem `email`** (Q1). Teste com `jose.decodeJwt`
- [ ] A resposta continua trazendo `username` canônico (é o que o `AuthProvider` guarda e o que o `(você)` da tela compara) e **pode** trazer `email?`. Teste: login por e-mail responde `username: 'admin'`
- [ ] Sem `process.env` no service: o segredo continua vindo do `EnvironmentProvider`

**Dependencies:** Task 2

---

### Task 4: Chave do banner: `AUTH_TRANSICAO_EMAIL_BANNER` + `GET /auth/transicao` público

**Files to change:**
- `src/backend/domain/libs/environment/model/EnvironmentVars.ts`
- `src/backend/domain/libs/environment/EnvironmentProvider.ts` (os dois caminhos: env local/Render e SSM/Lambda)
- `src/backend/domain/libs/environment/EnvironmentProvider.test.ts`
- `src/backend/domain/interface/operacao/configManifest.ts` (entrada `OPCIONAL`, frente `NUCLEO`, `default: 'false'`)
- `src/backend/routes/auth.ts` (rota nova no router já público)
- `src/backend/routes/auth.test.ts`
- `src/backend/http/buildApp.test.ts` (a rota nova é alcançável sem token)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): casos em `EnvironmentProvider.test.ts`, `routes/auth.test.ts` e `buildApp.test.ts` escritos antes
- [ ] `authTransicaoEmailBanner: boolean` vale `true` **só** quando a env é exatamente `'true'`. Ausente, vazia ou qualquer outro valor resulta em `false`. Teste com `'true'`, `'false'`, `''`, ausente e `'TRUE '`
- [ ] `GET /auth/transicao` responde 200 com corpo **exatamente** `{ ativo: boolean }` (teste com `toEqual`, sem outras chaves: sem contagem, sem nomes, sem e-mails; I5)
- [ ] A rota **não** toca o banco: não chama `bootstrapAppContainer` e não resolve `UserRepository`. Teste que falha se o repositório for resolvido no caminho
- [ ] A rota fica montada antes do middleware de auth (vive no `authRouter`). Em `buildApp.test.ts`, a requisição sem `Authorization` recebe 200, não 401
- [ ] Resposta com `Cache-Control: no-store`, para que desligar a chave tenha efeito no próximo carregamento da tela de login
- [ ] O manifesto do ConfigDoctor inclui a var com `consequenciaSeAusente` de mais de 20 caracteres, e os testes de sanidade de `ConfigDoctor.test.ts` continuam verdes

**Dependencies:** none

---

### Task 5: Gestão de usuários: editar e-mail, criar com e-mail, guarda de desativação (`UserAdminService` + `routes/usuarios.ts`)

**Files to change:**
- `src/backend/domain/service/auth/UserAdminService.ts`
- `src/backend/domain/service/auth/UserAdminService.test.ts`
- `src/backend/routes/usuarios.ts`
- `src/backend/routes/usuarios.test.ts` (novo; hoje não existe. Seguir o padrão de `routes/operacao.test.ts`, com `bootstrapAppContainer` mockado e servidor efêmero)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `routes/usuarios.test.ts` e os casos novos de `UserAdminService.test.ts` escritos antes
- [ ] `GET /usuarios` devolve `email` quando preenchido e omite a chave quando é `NULL` (o front trata a ausência como pendente)
- [ ] `PATCH /usuarios/:id/email` com body `{ email }` (Zod: `trim().toLowerCase().email()`) responde 200 `{ id, email }`, 400 `'E-mail inválido.'`, 404 `'Usuário não encontrado.'` e 409 `'Este e-mail já identifica outro usuário.'` (colisão com o `email` **ou** o `username` de outro usuário). Um caso de teste por status, incluindo colisão só de caixa (`Maria@X.com` contra `maria@x.com`)
- [ ] A edição grava `email_updated_by = req.user.sub` e emite uma linha de `LogService.info` em português com o id e o ator. O log não inclui senha
- [ ] Operador (não admin) recebe 403 em `PATCH /usuarios/:id/email`: o guard `requireRole('admin')` do router cobre a rota nova (R7)
- [ ] `POST /usuarios`: `createUserSchema` passa a aceitar `email` e grava `username = email = valor normalizado` (R6). **Compatibilidade de deploy:** `username` continua aceito como alias. Se os dois vierem com valores diferentes, a resposta é 400. Teste dos três casos. A colisão cruzada dá 409 com a mesma mensagem do PATCH
- [ ] `PATCH /usuarios/:id/ativo` com `ativo: false` passa por `deactivateGuarded(id, req.user.sub)`: desativar a si mesmo dá 409 `'Você não pode desativar o próprio acesso.'`; desativar o último admin ativo dá 409 `'Não é possível desativar o último administrador ativo.'`. Sem `req.user.sub`, a rota recusa (nunca desativa às cegas). Reativar não passa pela guarda. Um teste por caso
- [ ] `respondError` mapeia os erros novos para os status acima. Erro desconhecido continua indo ao middleware central
- [ ] Nenhuma rota edita `username` (I1). Teste: um `PATCH /usuarios/:id/email` com `username` no body ignora o campo

**Dependencies:** Task 2

---

### Task 6: `seed-admin` exige `ADMIN_EMAIL` e `ADMIN_PASSWORD`, sem default

**Files to change:**
- `src/backend/jobs/seed-admin.ts`
- `src/backend/jobs/SeedAdminConfig.ts` (novo; classe exportada com o parse Zod do env, testável sem rodar o job)
- `src/backend/jobs/SeedAdminConfig.test.ts` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `SeedAdminConfig.test.ts` escrito antes
- [ ] `ADMIN_EMAIL` é obrigatório, validado como e-mail e normalizado para `trim().toLowerCase()`. `ADMIN_PASSWORD` é obrigatório com no mínimo 8 caracteres. Faltando qualquer um, o job termina com código 1 e mensagem em português que nomeia a var faltante (e nunca imprime o valor da senha)
- [ ] O fonte não contém nenhum default de credencial: um teste sobre o fonte verifica a ausência de `'columbia2026'`, de `?? 'admin'` e de `ADMIN_USERNAME` (I6)
- [ ] O upsert grava `username = email = ADMIN_EMAIL`, `role = 'admin'` e `ativo = true` (R12). A linha `admin` legada não é tocada nem apagada; ela é aposentada pela UI (Q7)
- [ ] O `console.log` de sucesso é em português e não imprime a senha

**Dependencies:** Task 2

---

### Task 7: Docs e config de deploy

**Files to change:**
- `src/backend/.env.example`
- `render.yaml`
- `DEPLOY.md`

**Acceptance criteria:**
- [ ] `ADMIN_USERNAME` sai dos três arquivos e `ADMIN_EMAIL` entra (obrigatório para o `seed:admin`). `ADMIN_PASSWORD` fica documentado como obrigatório, sem sugestão de valor
- [ ] `AUTH_TRANSICAO_EMAIL_BANNER` entra nos três arquivos (`sync: false` no `render.yaml`) com a semântica "só `true` liga; ausente = desligado; vale sem redeploy do front"
- [ ] O checklist do operador no `DEPLOY.md` (seção 4, passos 2, 6 e 7) usa `ADMIN_EMAIL` e diz que o login aceita e-mail ou usuário. A nota final ("Novos usuários: insira em `app_user` com hash bcrypt") passa a apontar para a tela `/usuarios`
- [ ] Um `grep -rn ADMIN_USERNAME` no repo (fora de `node_modules` e `ontology/_inbox`) devolve vazio

**Dependencies:** Task 4, Task 6

---

### Task 8: Front, camada de API: `email` em `AppUser`, `definirEmail`, `fetchTransicaoEmail`

**Files to change:**
- `src/frontend/lib/usuarios.ts`
- `src/frontend/lib/auth/transicao.ts` (novo)
- `src/frontend/__tests__/usuarios-api.test.ts` (novo)
- `src/frontend/__tests__/auth/transicao.test.ts` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): os dois testes escritos antes, com `fetch` mockado
- [ ] `AppUser.email?: string`. `criarUsuario` envia `email` (e não mais `username`). `definirEmail(id, email)` faz `PATCH /usuarios/:id/email` e, fora de 2xx, lança `UsuariosApiError` com a mensagem do backend e o `status` (409 preservado)
- [ ] `fetchTransicaoEmail()` faz um `fetch` **sem** header de auth (a rota é pública; não usar `withAuthHeaders` nem um caminho que dispare o modal de sessão expirada em 401) e devolve `boolean`
- [ ] **Fail closed:** erro de rede, status diferente de 200, JSON inválido ou `ativo` que não seja `boolean` resultam em `false`. Um teste por caso, incluindo o 404 de um backend antigo durante a janela de deploy

**Dependencies:** Task 4, Task 5

---

### Task 9: Front, tela de login: rótulo "E-mail ou usuário" + banner de transição

**Files to change:**
- `src/frontend/app/login/page.tsx`
- `src/frontend/app/login/TransicaoEmailBanner.tsx` (novo)
- `src/frontend/__tests__/auth/login-page.test.tsx` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `login-page.test.tsx` escrito antes
- [ ] O rótulo do campo é "E-mail ou usuário", com placeholder coerente. O `autoComplete="username"` e o `data-testid="login-username"` são mantidos. O ícone pode trocar para `Mail`/`AtSign`, desde que siga o DS
- [ ] Com `fetchTransicaoEmail()` resolvendo `true`, o banner aparece com o texto aprovado, **literal**: título "Estamos migrando o acesso para o seu e-mail da Columbia." e corpo "Durante a transição, você continua entrando com seu usuário atual. Quando seu e-mail da Columbia for cadastrado, ele também passa a valer, com a mesma senha."
- [ ] Com `false`, rejeição ou pendência, o banner **não** aparece e não se reserva espaço para ele (nada de pisca-some ou de layout que salta). O formulário fica utilizável antes de a chamada terminar
- [ ] O banner usa tokens semânticos de info (`bg-info-subtle` e família, ver `docs/design-system/tokens.md` e `feedback.md`), sem cor crua. Tem `role="status"` (não `alert`) e ícone `aria-hidden`. Funciona em light e dark
- [ ] O fluxo de `signIn` não muda: o corpo continua `{ username, password }` e o `AuthProvider` continua guardando o `username` canônico da resposta

**Dependencies:** Task 8

---

### Task 10: Front, `/usuarios`: coluna E-mail, "Editar e-mail", novo usuário com e-mail da Columbia, erro de desativação

**Files to change:**
- `src/frontend/app/usuarios/page.tsx`
- `src/frontend/app/usuarios/EditarEmailDialog.tsx` (novo; mesmo molde de `ResetSenhaDialog.tsx`)
- `src/frontend/app/usuarios/NovoUsuarioDialog.tsx`
- `src/frontend/__tests__/usuarios-page.test.tsx` (novo)

**Acceptance criteria:**
- [ ] TDD (vermelho primeiro): `usuarios-page.test.tsx` escrito antes, com a lib mockada
- [ ] A tabela separa **Usuário** (o `username`, que é a coluna chamada "Email" hoje) de **E-mail**. Sem e-mail, a célula mostra o estado pendente destacado (badge com token de warning e texto "Pendente", sem depender só da cor). Com e-mail, mostra o valor
- [ ] A ação "Editar e-mail" em cada linha abre o `EditarEmailDialog`, com o `username` exibido como contexto somente leitura e o campo preenchido com o e-mail atual. Salvar chama `definirEmail`. Em sucesso: toast de sucesso, fecha e recarrega a lista. Em 409 ou 400, a mensagem do backend aparece **inline no diálogo** (padrão de `docs/design-system/forms.md`) e o diálogo continua aberto
- [ ] `NovoUsuarioDialog`: o rótulo deixa de ser "Email @kavex" e passa a "E-mail da Columbia", com placeholder `nome@columbiabr.com`. O campo continua `type="email"` e obrigatório. A tela não restringe domínio (a regra de domínio não foi decidida). O 409 do backend aparece no diálogo
- [ ] Desativar: o 409 de si mesmo ou do último admin aparece com a mensagem do backend e o switch **volta** ao estado anterior (a reversão otimista já existe; o teste deve cobri-la). O switch do próprio usuário continua desabilitado (`souEu`)
- [ ] `(você)` continua sendo calculado por `u.username === eu`, e o teste cobre o caso de login feito por e-mail
- [ ] Nada na tela edita `username`
- [ ] DesignSystemReviewer verde para `page.tsx`, `EditarEmailDialog.tsx`, `NovoUsuarioDialog.tsx`, `login/page.tsx` e `TransicaoEmailBanner.tsx`

**Dependencies:** Task 8

---

### Task 11: ADR 0051: plano de auth em 3 passos e "sub = username até o passo 3"

**Files to change:**
- `ontology/decisions/0051-auth-email-real-sub-continua-username.md` (novo; via OntologyCurator, sem diff de entidade)
- `ontology/CHANGELOG.md` (entrada da ADR, se for o costume do repo para ADR sem diff de entidade)

**Acceptance criteria:**
- [ ] A ADR registra: os 3 passos; `sub = username` congelado até o passo 3 (Q1 e Q2); nenhum backfill (R2 substituída); o banner por chave manual (Q6); R11 e R12; e o fato de que os três sítios `email ?? sub` de `routes/recebimentos.ts` dependem do token **não** ter `email` (quem adicionar o claim no passo 3 precisa invertê-los)
- [ ] O número da ADR é reconferido contra a `main` no rebase (sessões paralelas colidem)
- [ ] Nenhum arquivo em `ontology/entities/` muda

**Dependencies:** none

---

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (backend **e** frontend)
- [ ] `npm run lint` ✅ (backend **e** frontend; no frontend, o gate é o `lint`, não o `prettier --check`)
- [ ] `npm test` ✅ (backend **e** frontend)
- [ ] PatternGuardian gate ✅ (tsyringe, Zod nas bordas, SQL parametrizado, sem `process.env` cru em service, métodos arrow, modificadores explícitos). Conferir P0 contra a `main`: o agente revisa o arquivo inteiro
- [ ] SpecVerifier: todos os critérios acima aprovados
- [ ] [entity_changed=false] sem diff de ontologia de entidade; só a ADR da Task 11 ✅
- [ ] [frontend touched] DesignSystemReviewer gate ✅
- [ ] [new handler/job] não se aplica: nenhum handler Lambda ou job novo (o `seed-admin` já existe e só muda). ObservabilityAdvisor não é acionado
- [ ] [infra/] não se aplica: não existe `infra/`. AwsInfraArchitect não é acionado
- [ ] Regis-Review rodado (os `qa-*` com `model=sonnet`); **P0 remediados**; P1/P2/P3 vão para `auth-email-transicao-regis-followups.md`
- [ ] Rebase de `origin/main` limpo e gates ainda verdes; número da migration (0064) e da ADR (0051) reconferidos
- [ ] [delta com feat em `src/`] versão do app bumpada (minor, FE+BE em lockstep) **à mão** nos dois `package.json` (não há `pwsh` nesta máquina), conferindo antes a versão real da `main`, + `CHANGELOG.md` atualizado ✅
- [ ] Nota no PR: **ordem de deploy** backend antes do frontend (o front novo lida com o backend antigo por fail closed e pelo alias `username`, mas o `PATCH /usuarios/:id/email` só existe no backend novo)

## Roteiro de QA manual (ambiente de dev, antes do PR)

Pré-condição: banco de dev migrado (0064 aplicada); dois admins de teste A e B e um operador O; A logado no navegador.

1. **Login pelo usuário legado.** Com `admin` (sem e-mail), logar com `admin` e com `ADMIN` + senha: os dois entram. Em DevTools, decodificar o token: `sub = "admin"` e nenhuma chave `email`.
2. **Login por e-mail, qualquer caixa.** Em `/usuarios`, cadastrar para A o e-mail `a.teste@columbiabr.com`. Sair e logar com `A.Teste@ColumbiaBR.com`: entra, e `(você)` aparece na linha de A. O `sub` continua sendo o `username` de A.
3. **Falhas não revelam conta.** E-mail inexistente, senha errada e usuário desativado: as três dão a mesma mensagem "Credenciais inválidas".
4. **Banner ligado.** `AUTH_TRANSICAO_EMAIL_BANNER=true` no backend, reiniciar e recarregar `/login`: o banner aparece com o texto aprovado, em light e em dark. `curl <api>/auth/transicao` sem token devolve `{"ativo":true}` e nada mais.
5. **Banner desligado ou falhando.** Remover a var e reiniciar: o banner some e o endpoint devolve `{"ativo":false}`. Com o backend parado, `/login` renderiza sem banner e sem erro visível.
6. **Coluna E-mail.** `/usuarios` mostra Usuário e E-mail separados; quem não tem e-mail aparece como "Pendente" destacado.
7. **Editar e-mail: colisões (409).** No usuário B, tentar (a) o e-mail já cadastrado em A, (b) o mesmo com caixa diferente, (c) o `username` de outro usuário (ex.: `admin` não é e-mail, então usar o `username` de um usuário `@kavex.com`). As três dão 409 com "Este e-mail já identifica outro usuário." dentro do diálogo, que fica aberto. Um e-mail inválido dá 400 inline.
8. **Editar e-mail: sucesso e no-op.** Salvar um e-mail novo em B: toast de sucesso, a lista atualiza e o banco tem `email_updated_by = <username de A>`. Salvar o mesmo valor de novo: 200 e `email_updated_at` não muda.
9. **Novo usuário.** O diálogo mostra "E-mail da Columbia". Criar `c.teste@columbiabr.com`: a linha nasce com Usuário e E-mail iguais. Criar de novo com o mesmo valor, ou com o e-mail já em A: 409 no diálogo.
10. **Desativar a si mesmo.** O switch de A está desabilitado. Via `curl` com o token de A, `PATCH /usuarios/<id de A>/ativo {ativo:false}` devolve 409 "Você não pode desativar o próprio acesso."
11. **Último admin.** Logar como B e guardar o token (vale 12h). Logado como A, desativar B e os demais admins, deixando A como único admin ativo. Com o token guardado de B, `PATCH /usuarios/<id de A>/ativo {ativo:false}` devolve 409 "Não é possível desativar o último administrador ativo." Para ver a mensagem na UI, forçar o mesmo 409 (ex.: interceptar a resposta em DevTools): o toast mostra a mensagem e o switch volta ao estado anterior. Reativar B continua funcionando.
12. **Operador.** Logado como O, `PATCH /usuarios/<id>/email` devolve 403.
13. **Seed.** `npm run seed:admin` sem `ADMIN_EMAIL` sai com código 1 e mensagem que nomeia a var. Com `ADMIN_EMAIL` e `ADMIN_PASSWORD`, cria ou atualiza o usuário com `username = email` e ele loga.
14. **Regressão de identidade.** Logado por e-mail, executar uma ação de escrita qualquer de dev (ex.: arquivar/desarquivar transação em Recebimentos): o ator gravado é o `username`, não o e-mail.

## Riscos e ambiguidades

1. **Deploy skew entre Vercel e Render.** O corpo do login não muda de forma, `POST /usuarios` aceita `username` como alias e o banner falha fechado; mesmo assim, a edição de e-mail só funciona depois que o backend sobe. Por isso o backend deve ir primeiro.
2. **Corrida no "último admin".** Só é segura com checagem e update na mesma transação com `FOR UPDATE` (Task 2). Um `SELECT count` seguido de `UPDATE` fora de transação deixaria passar dois admins se desativando ao mesmo tempo.
3. **Colisão cruzada não é garantida por índice.** Email × username de outro usuário é checado por `NOT EXISTS` no mesmo statement. Duas escritas concorrentes ainda poderiam colidir, mas o login falha fechado (401 + log) nesse caso, então o dano é negação de acesso, não autenticação errada. É aceitável com cerca de 15 usuários e deve ser registrado como follow-up se o Regis apontar.
4. **Índice único em `lower(username)`** é uma adição deste scoping (não pedida explicitamente). A contagem de produção mostrou 0 colisões, e o índice transforma a guarda da migration em garantia permanente. Se o Yuri preferir não criá-lo, o critério cai e a guarda `RAISE EXCEPTION` basta.
5. **Domínio `@columbiabr.com` não é validado.** A decisão foi "todos migram para o e-mail da Columbia", mas nenhuma regra manda recusar outros domínios. A tela só sugere. Se for para restringir, é uma pergunta nova.
6. **Timing do login.** Hoje o `bcrypt.compare` só roda quando o usuário existe, o que permite enumeração por tempo de resposta. O comportamento é anterior a esta feature e fica fora de escopo; é candidato a P2 no Regis.
7. **Roteiro item 11** depende de o middleware aceitar o token de um admin já desativado (o JWT é stateless e o middleware não relê `ativo`). Isso é uma lacuna anterior a esta feature: desativar não derruba sessões abertas por até 12h. Fica fora de escopo e é candidato natural ao passo 2 (permissões lidas do banco por request). Se ficar difícil montar o cenário em dev, o teste de rota da Task 5 é a cobertura principal.
