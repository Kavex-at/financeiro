# OfficeHours — Auth: Supabase Auth no mesmo projeto do banco (passo 3 de 3)

> Modo: `new`. Conduzida em 2026-09-29. Slug: `auth-supabase`.
> Decisões do dono do ciclo recebidas via orquestrador (não houve conversa direta nesta rodada).
> `entity_changed = false` (justificativa no fim). Continua a ADR-0051 (passo 1, v0.43.0) e a
> ADR-0053 (passo 2, v0.44.0, migration 0066 aplicada em produção em 2026-09-29).

## Intent

Trocar o JWT HS256 que o próprio backend assina (`AUTH_JWT_SECRET`, 12 h, sem refresh, sem logout
no servidor) por sessões do **Supabase Auth do mesmo projeto do banco**, com as **mesmas senhas**
(hashes bcrypt importados como estão), sem SMTP e sem cadastro público. O token passa a só provar
identidade, como já decidido no passo 2: permissões continuam no banco, lidas a cada requisição. A
identidade de auditoria (`executado_por`, `criado_por`, `triggeredBy`, vínculo Conexos) continua
sendo o `username`, e nenhuma linha histórica muda.

## Estado atual verificado (código e produção)

| Ponto | Onde | Observação |
|---|---|---|
| Emissão do token | `domain/service/auth/AuthService.ts` | bcryptjs compara com `app_user.password_hash`; assina HS256 com `sub = username` canônico, claim `role`, `aud = 'authenticated'`, **sem `iss`**, 12 h |
| Login | `routes/auth.ts` `POST /auth/login` | corpo `{ username, password }`; identificador = e-mail **ou** username (ADR-0051 D3); resposta `{ token, username, role, email? }`; só o `globalLimiter` (100/min por IP) |
| Verificação | `http/auth.ts` `buildAuthMiddleware` | escolhe o verificador pelo `alg` do header: `HS*` → `AUTH_JWT_SECRET ?? SUPABASE_JWT_SECRET`; assimétrico → JWKS de `${SUPABASE_URL}/auth/v1`. Sobra do template, nunca usada: `render.yaml` não define `SUPABASE_URL` nem `SUPABASE_JWT_SECRET` |
| **Defeito latente** | `http/auth.ts:137-141` | `baseOptions` aplica `issuer = ${SUPABASE_URL}/auth/v1` **aos dois caminhos**. No instante em que `SUPABASE_URL` for configurada, todo token HS256 atual (que não tem `iss`) passa a dar 401. A janela de convivência (Q5) exige separar as opções por caminho |
| Chave de assinatura do projeto | `GET https://kngrpoqzaxtuzkcugsyl.supabase.co/auth/v1/.well-known/jwks.json` (público, consultado em 2026-09-29) | **uma chave ES256** (P-256, `kid 2849b6ec-e07f-4c50-ad82-ca596c896c6d`). O projeto já usa chaves assimétricas: basta JWKS, sem segredo HS256 do Supabase |
| Resolução de acesso | `http/acesso.ts` `resolverAcesso` → `AccessService.resolver(sub)` → `AccessRepository.findAccessBySub` | casa `sub` com `lower(username)`; devolve `userId`, **`username`**, `ativo`, papel, permissões; cache 30 s por `sub`; 401 inexistente/inativo; 503 fail-closed |
| Ordem no `buildApp` | `http/buildApp.ts:114-132` | `/auth` público → `buildAuthMiddleware` → `resolverAcesso` → `conexosIdentityMiddleware` → routers. Tudo o que lê `req.user` roda **depois** do `resolverAcesso` |
| Gestão de usuários | `domain/service/auth/UserAdminService.ts`, `routes/usuarios.ts` | criar (bcrypt 12 local), redefinir senha pelo admin, editar e-mail, ativar/desativar (guarda R9), papel/exceções, vínculo Conexos. `username = email` para quem nasce pela UI |
| Seed | `jobs/seed-admin.ts` | `ADMIN_EMAIL`/`ADMIN_PASSWORD`; upsert em `app_user` com bcrypt 12 |
| Front | `lib/auth/token.ts`, `AuthProvider.tsx`, `app/login/page.tsx`, `SessionExpiredModal` | token em `localStorage` (`auth_token`) + `username`; `decodeJwtExp` alimenta o timer proativo de sessão expirada; `useRole()` lê o claim `role` só para o fallback D4 do `PermissoesProvider`; banner de transição (`/auth/transicao`) |
| Dependências | `package.json` (front e back) | nenhum `@supabase/*` |
| Produção (2026-09-29, read-only) | banco do app (Supabase sa-east-1) | 15 usuários, 12 ativos, **todo ativo tem e-mail** (10 `@columbiabr.com`, 1 `@kavex.at`, 1 `@mpsolutions.com.br`); todos os hashes `$2a$12$`; `auth.users = 0`, `auth.identities = 0`; última migration 0066 |
| Consumidor externo | `kavex-report-ciclo` | `POST /auth/login` com `FINANCEIRO_API_USUARIO`/`SENHA` (hoje `admin`), depois `GET /metricas/ciclo` |

### Consumidores de `req.user.*` (grep completo em `src/backend`, fora testes)

| Sítio | Lê | Hoje recebe | Com token Supabase **sem** tratamento | Com a proposta (R3) |
|---|---|---|---|---|
| `http/acesso.ts:125` (`resolverAcesso`) | `sub` | username | UUID → não casa `username` → **401 para todos** | resolve por `auth_user_id`, depois reescreve `req.user` |
| `http/conexosIdentity.ts:14` | `sub` | username | UUID → sem vínculo → **baixas saem pelo robô em silêncio** | username |
| `routes/me.ts:26` (`/me/conexos-status`) | `sub` | username | UUID → `ausente` | username |
| `routes/usuarios.ts:133,164,191,222,249` (ator; guarda "não desativa a si mesmo") | `sub` | username | UUID → trilha com UUID; guarda de si mesmo quebra | username |
| `routes/permutas.ts:237,271,338,410,606,637,683,722,822,853,884,915,948` e `autorDoToken` (`:479`) | `sub ?? email` | username | UUID em `executado_por`/`criado_por` | username |
| `routes/sispag.ts:105` (`ator`) | `sub ?? email` | username | UUID | username |
| `routes/operacao.ts:128` | `sub ?? email` | username | UUID | username |
| `routes/recebimentos.ts:265,579` | `sub ?? email` | username | UUID | username |
| **`routes/recebimentos.ts:735,935`** (`triggeredBy`) e **`:975`** (`ator` de arquivar) | **`email ?? sub`** | username (o token não tem `email`) | **e-mail** (o token Supabase tem `email`) | username (R3 zera `email` **e** os três sítios são invertidos para `sub ?? email`, como a ADR-0051 D2 já exigia) |
| `routes/recebimentos.ts:145-710` (`filiaisPermitidas`, `assertUserCanActOnFilial`, `resolverFilCodsAlvo`) | `filiais` | ausente (libera tudo) | ausente (o Supabase não emite `filiais` no topo) | ausente; comportamento idêntico. `user_metadata` (editável pelo próprio usuário no GoTrue) nunca é lido (I6) |
| `http/acesso.ts:186` (log de negado) | `sub` | username | UUID | username |

Conclusão: a única forma de não tocar ~30 sítios de auditoria é o `resolverAcesso` devolver ao
resto da cadeia um `req.user` **igual ao de hoje** (`sub = username`), derivado do banco e não do
token.

## Axis 1 — Entity

Nenhuma entidade do domínio financeiro. Infraestrutura de acesso, na prateleira do `app_user`:

- **`app_user.auth_user_id uuid NULL UNIQUE`** (migration nova, número provisório `0067`): o `id`
  do `auth.users` correspondente. Preenchido pela importação e por toda criação posterior.
  Imutável depois de preenchido (nenhuma tela o edita).
- **`app_user.username`** permanece, e passa a ser **definitivamente** a identidade de auditoria
  (não só "até o passo 3", como dizia a ADR-0051 D2). Continua não editável.
- **`app_user.email`** continua sendo a fonte da verdade do e-mail; o `auth.users.email` é projeção
  dele, mantida pelo backend.
- **`app_user.password_hash`**: deixa de ser lido pelo login quando o modo `supabase` estiver ligado,
  mas **continua sendo escrito** (mesmo hash enviado ao Supabase) até o tweak de limpeza (Q6),
  porque é o que torna o rollback trivial. Sai depois, junto com `app_user.role`.
- **`auth.users` / `auth.identities`**: pertencem ao GoTrue. O backend não faz SQL nesse schema,
  nem leitura (I7); só fala com eles pela API admin.

## Axis 2 — Action

| Ação | Pré-condição | Pós-condição | Idempotente? |
|---|---|---|---|
| `autenticar` (`POST /auth/login`, modo `supabase`) | identificador (e-mail ou username) casa **um** `app_user` ativo com `auth_user_id` | backend chama o GoTrue `token?grant_type=password` com o **e-mail** desse usuário e devolve `{ token, refreshToken, expiresAt, username, email }`; inexistente, inativo, ambíguo, sem vínculo ou senha errada: o mesmo 401 genérico | sim (cria uma sessão nova a cada chamada) |
| `autenticar` (modo `local`, rollback) | igual a hoje | igual a hoje (HS256 próprio) | sim |
| `renovarSessao` (`POST /auth/refresh`, pública) | `refreshToken` | GoTrue `grant_type=refresh_token`; devolve o mesmo formato. Não checa `ativo` (a próxima requisição checa, R7 do passo 2) | não (rotação: o refresh antigo é consumido) |
| `encerrarSessao` (`POST /auth/logout`, autenticada) | token Supabase válido | GoTrue `/logout?scope=local` com o token do próprio usuário: o refresh token da sessão é revogado. O access token vale até o `exp` (≤ 1 h), mas o front o descarta | sim |
| `resolverIdentidade` (dentro do `resolverAcesso`) | token verificado; o middleware diz **qual** emissor o validou (`app` ou `supabase`) | `app` → busca por `username` (como hoje); `supabase` → busca por `auth_user_id = sub`. Em ambos, `req.user` vira `{ sub: username, authUserId?, filiais? }`, **sem `email`** | sim |
| `criarUsuario` | `usuarios:gerenciar`; regras do passo 1/2 | bcrypt 12 local → `app_user` (transação aberta) → admin `createUser { email, password_hash, email_confirm: true }` → grava `auth_user_id` → commit. Falha no GoTrue: rollback, 503 em português | não (409 no segundo, como hoje) |
| `redefinirSenha` (admin) | `usuarios:gerenciar` | bcrypt local → `app_user.password_hash` e admin `updateUserById { password_hash }` (ou `password`, ver T-1) | sim |
| `alterarEmail` | regras D3 do passo 1 | `app_user.email` e admin `updateUserById { email, email_confirm: true }` (sem e-mail de confirmação, sem SMTP) | sim |
| `desativar` | R9 do passo 2 | `ativo = false` (401 em ≤ 30 s, como hoje) **e** admin `updateUserById { ban_duration }` (Q9): login e refresh param no GoTrue também | sim |
| `reativar` | — | `ativo = true` e `ban_duration: 'none'`; se não tem `auth_user_id` (não importado, Q4), cria o usuário no GoTrue na hora e exige e-mail | sim |
| `importarUsuarios` (job `jobs/sync-supabase-auth.ts`, sob demanda, `--dry-run` por default) | `SUPABASE_URL` + chave secreta; migration 0067 aplicada | para todo `app_user` com e-mail e sem `auth_user_id`: cria no GoTrue com o `password_hash` atual, e-mail confirmado, banido se inativo; grava `auth_user_id`. Se o e-mail já existe no GoTrue (execução anterior interrompida), **vincula** em vez de criar. Para quem já tem vínculo: reconcilia `email` e ban com o `app_user` (fonte da verdade). Relatório em português do que fez | sim; é também a ferramenta de reparo de divergência |
| `seedAdmin` (existente) | `ADMIN_EMAIL`/`ADMIN_PASSWORD` + env do Supabase | como hoje, e faz upsert do usuário no GoTrue com o mesmo hash | sim |

Nenhuma ação escreve no Conexos, Nexxera ou GED.

## Axis 3 — Invariant

- **I1 — Permissão nunca vem do token** (I1 da ADR-0053). Nem `role`, nem `app_metadata`, nem
  `user_metadata`.
- **I2 — Identidade de auditoria = `app_user.username`, para sempre.** Nenhum `executado_por`,
  `criado_por`, `triggeredBy`, `ator` ou chave de vínculo Conexos passa a gravar UUID ou e-mail.
  Garantido em um lugar só (o `resolverAcesso` reescreve `req.user`), e reforçado invertendo os três
  sítios `email ?? sub` de `recebimentos.ts`.
- **I3 — Uma pessoa, uma linha.** `auth_user_id` é único; token Supabase cujo `sub` não casa nenhum
  `app_user` → 401 + `LogService.error` (divergência a reparar com o job), nunca "cria na hora".
- **I4 — Usuário inativo não passa** em ≤ 30 s (R7 do passo 2), independentemente do Supabase. O
  ban no GoTrue é defesa em profundidade, não a garantia.
- **I5 — Sem cadastro público, sem autoatendimento.** Cadastro aberto desligado no projeto;
  nenhuma rota de "esqueci a senha"; toda senha é definida por um admin.
- **I6 — A chave secreta (service role) só existe no backend** (Render e ambiente dos jobs). O
  front não recebe chave nenhuma do Supabase (Q2).
- **I7 — O backend não escreve nem lê o schema `auth` por SQL.** Só pela API admin/pública do
  GoTrue: os internos (`instance_id`, formato de `identities`, colunas novas) mudam entre versões.
- **I8 — Verificação estrita por emissor.** Token Supabase: ES256 via JWKS, `iss =
  https://<ref>.supabase.co/auth/v1`, `aud = authenticated`, `role = authenticated`, e
  `is_anonymous` diferente de `true`. Token próprio: HS256, `aud = authenticated`, sem `iss`, e só
  enquanto `AUTH_JWT_SECRET` existir. `SUPABASE_JWT_SECRET` deixa de ser aceito.
- **I9 — Deploy sem logout forçado e com rollback por configuração** durante a janela (Q5, Q6).
- **I10 — Human-in-the-loop inalterado.** Só muda como a pessoa prova quem é.

**Raio de impacto se errar:** I2 errado mistura UUIDs/e-mails na trilha de três frentes financeiras
e derruba a sessão Conexos por usuário (baixas voltam ao robô sem aviso, o mesmo modo de falha da
memória "usuário sem vínculo cai no robô em silêncio"). Q1 errado expõe o schema `public` inteiro
(inclusive `password_hash` e o SID do Conexos) pela Data API a qualquer usuário com sessão. Import
errado tranca 12 pessoas fora do sistema (mitigado por rollback de configuração).

## Axis 4 — Integration

- **Supabase Auth (GoTrue), projeto `kngrpoqzaxtuzkcugsyl`:** endpoints públicos `token` (password e
  refresh) e `logout`, com a chave publicável no header `apikey`, chamados **do backend**; API admin
  (`/admin/users`) com a chave secreta. Um client novo `SupabaseAuthClient` em
  `domain/client/` (`@singleton() @injectable()`), HTTP simples com Zod nas respostas (Q8).
- **Configuração do projeto (painel, manual, roteiro no `DEPLOY.md`):** cadastro aberto desligado;
  login anônimo desligado; provedor e-mail ligado (é o que aceita senha); validade do access token
  no default (3600 s); rotação de refresh token ligada (default); limites de taxa de auth revistos
  (Q7); Data API conforme Q1.
- **Env backend (Render):** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (ou a anon legada),
  `SUPABASE_SECRET_KEY` (ou service_role legada), `AUTH_PROVIDER` (`local` | `supabase`, default
  `local`). `AUTH_JWT_SECRET` sai depois da janela. `SUPABASE_JWT_SECRET` some do `authEnv`.
  `AUTH_TRANSICAO_EMAIL_BANNER` sai. Atualizar `render.yaml`, `.env.example`, `configManifest`
  (ConfigDoctor) e `DEPLOY.md`.
- **Env dos jobs:** o `seed-admin` e o `sync-supabase-auth` precisam de `SUPABASE_URL` e da chave
  secreta. **Nada disso entra no `bootstrapAppContainer`** (gotcha dos ~58 jobs): o client é
  resolvido sob demanda e valida o próprio env.
- **Env front (Vercel):** nenhuma variável nova.
- **CORS:** inalterado (o browser só fala com o nosso backend).
- **`kavex-report-ciclo`:** continua funcionando sem mudança, porque `POST /auth/login` mantém o
  corpo `{ username, password }`, aceita username e devolve `token`. O token dura 1 h, suficiente
  para a execução semanal.
- **Postgres:** migration aditiva `0067` (`auth_user_id`). Coberta pela cópia de `.sql` no build.
- **Tenant:** um só. Sem SSM.

## Arquitetura proposta

1. **Login por proxy no backend.** O front continua postando em `/auth/login`; o backend resolve o
   identificador no `app_user` (e-mail ou username, ativo, único), chama o GoTrue com o e-mail e
   devolve a sessão. Motivos: o report e a tela de login não mudam de contrato; o front fica sem
   chave e sem dependência do Supabase; `ativo` e ambiguidade são checados antes do GoTrue; um só
   ponto de log e de rate limit. Custo: `/auth/refresh` e `/auth/logout` escritos à mão, e o GoTrue
   vê todo login vindo do IP do Render (Q7).
2. **Verificação.** `buildAuthMiddleware` passa a ter dois verificadores com opções próprias
   (corrige o defeito do `issuer` compartilhado) e marca o emissor em `req.user`. JWKS do projeto
   (ES256), com cache do `jose`.
3. **Mapeamento de identidade.** `AccessService.resolver` recebe `{ tipo: 'username' | 'authUserId',
   valor }`; cache com chave prefixada pelo tipo; `invalidar(userId)` continua valendo para ambos.
   O `resolverAcesso` reescreve `req.user = { sub: acesso.username, authUserId, filiais }`.
4. **Gestão de usuários.** `app_user` é a fonte da verdade; o GoTrue é projeção da credencial. Cada
   escrita: transação no nosso banco com a linha travada → chamada admin → commit. Falha no GoTrue:
   rollback e 503 "Serviço de autenticação indisponível; nada foi alterado." Sucesso no GoTrue e
   falha no commit: `LogService.error` com ids, e o job de sync repara (idempotente). Senha: o
   backend gera o bcrypt uma vez e grava o mesmo hash nos dois lados.
5. **Front.** Guarda `refreshToken` e `expiresAt` no `localStorage` (cookie httpOnly não serve:
   Vercel e Render são sites diferentes, e cookie de terceiro é bloqueado por Safari/ITP). Renova
   ~5 min antes do `exp` e uma vez em 401; o `SessionExpiredModal` só aparece se a renovação falhar.
   "Sair" chama `/auth/logout`. Tolera backend antigo (resposta sem `refreshToken` = comportamento
   de hoje). Remove `useRole()`, o fallback D4 e o banner de transição.
6. **Corte (cutover).**
   1. Painel: desligar cadastro aberto e login anônimo; resolver Q1.
   2. Deploy backend: migration 0067; verificação dupla; `resolverAcesso` por emissor; gestão de
      usuários já sincroniza com o GoTrue; `/auth/refresh` e `/auth/logout`; `AUTH_PROVIDER=local`.
      Nada muda para ninguém.
   3. Deploy front (tolerante aos dois modos).
   4. `sync-supabase-auth --dry-run`, conferir, rodar de verdade. Conferir: 12 ativos com
      `auth_user_id`.
   5. `AUTH_PROVIDER=supabase` no Render (só configuração). Logins novos recebem token Supabase;
      tokens antigos valem até 12 h.
   6. Após ≥ 12 h: apagar `AUTH_JWT_SECRET` → caminho HS256 desligado.
   7. Tweak de limpeza posterior: remove `AuthService` bcrypt, `AUTH_PROVIDER=local`,
      `password_hash`, `app_user.role`, claim `role`, `SUPABASE_JWT_SECRET` do código.
7. **Rollback.** Até o passo 6.6: `AUTH_PROVIDER=local` e restart. O login volta ao bcrypt local
   (mesmo hash, porque as escritas gravaram nos dois lados), tokens antigos ainda verificam, e os
   Supabase já emitidos também (até 1 h). Depois do 6.6 e antes do 6.7: o mesmo, recriando
   `AUTH_JWT_SECRET` com valor novo (força um login). Depois do 6.7: rollback é reverter o PR de
   limpeza. A migration 0067 é aditiva e não precisa de reverse.
8. **Testes.** Unitários com `SupabaseAuthClient` falso injetado e o `keyResolver` que o middleware
   já aceita (chave ES256 local). Nada no CI depende do Supabase real. Validação real: `supabase
   start` (CLI) opcional em local; em produção, o `--dry-run` do job mais o roteiro do QaCoach
   (login, refresh, logout, desativar, reset de senha, report) no passo 6.4–6.5, com o rollback
   por configuração à mão.

## Decisões já tomadas (dono do ciclo)

- Supabase Auth do **mesmo** projeto do banco.
- Mesmas senhas: hashes bcrypt importados como estão; e-mails pré-confirmados.
- **Sem SMTP:** sem "esqueci a senha"; redefinição só pelo admin, via API admin do Supabase, com a
  chave de service role **só no backend**.
- Permissões continuam no banco, nunca no token (Opção B do passo 2).
- Cadastro público do Supabase desligado.
- A conta compartilhada `admin` será aposentada; o `kavex-report-ciclo` loga via
  `POST /auth/login` com `FINANCEIRO_API_USUARIO`/`SENHA` (hoje `admin`) e precisa continuar
  funcionando.

## Extracted rules

- R1: `app_user.auth_user_id` (uuid, único, nulo até importar) liga cada usuário ao `auth.users`.
  Nenhuma tela o edita.
- R2: O middleware aceita dois emissores com opções separadas (I8) e registra qual validou o token.
  O caminho HS256 existe enquanto `AUTH_JWT_SECRET` estiver configurado.
- R3: O `resolverAcesso` resolve o `app_user` pelo emissor (`username` ou `auth_user_id`) e
  reescreve `req.user` para `{ sub: username, authUserId?, filiais? }`, sem `email`. Os três sítios
  `email ?? sub` de `routes/recebimentos.ts` (`:735`, `:935`, `:975`) viram `sub ?? email` no mesmo
  PR.
- R4: `POST /auth/login` mantém corpo e campo `token` da resposta; no modo `supabase` resolve o
  identificador no nosso banco, recusa inativo/ambíguo/sem vínculo com o 401 genérico e só então
  chama o GoTrue com o e-mail.
- R5: `POST /auth/refresh` (pública) e `POST /auth/logout` (autenticada) passam pelo backend.
- R6: Toda escrita de credencial (criar, senha, e-mail, ativo) mantém `app_user` e GoTrue
  coerentes: transação local aberta → chamada admin → commit; falha externa = rollback e 503 em
  português; falha pós-sucesso externo = log de erro e reparo pelo job.
- R7: Senha nova é hasheada uma vez (bcrypt 12) e gravada nos dois lados até o tweak de limpeza.
- R8: Desativar bane no GoTrue; reativar desbane (ou cria, se não importado). A garantia de corte
  continua sendo o `ativo` lido a cada requisição (≤ 30 s).
- R9: O job `sync-supabase-auth` é idempotente, `--dry-run` por default, vincula em vez de duplicar
  e trata `app_user` como fonte da verdade de e-mail e ativo.
- R10: Nenhuma chave do Supabase no front; nenhum SQL no schema `auth`.
- R11: Mensagens ao operador em português (ADR-0042).
- R12: `DEV_AUTH_BYPASS` continua sendo o usuário fictício com tudo, sem Supabase.

## entity_changed: false

**Justificativa:** `auth_user_id` e a troca do emissor do token são infraestrutura de acesso, como
`email` (passo 1) e papéis (passo 2). Nenhum arquivo de `ontology/entities/`, ação de domínio,
máquina de estado ou regra de negócio financeira muda, e a identidade de auditoria gravada nos
ledgers fica idêntica (I2). **Precisa de ADR** (número provisório **0054**; reconferir contra a
`main` no rebase) que **emenda a ADR-0051 D2** ("`sub = username` até o passo 3" vira "`req.user.sub
= username` para sempre; o `sub` do token é o UUID do Supabase e é traduzido no `resolverAcesso`") e
**continua a ADR-0053** (a chave de lookup muda só na primeira metade, como previsto).

### Ontology diff needed: no (ADR sim)
### Reason: new property (infra de acesso, fora da ontologia de domínio) + amend da ADR-0051

## Handoff

→ **TaskScoper**, depois de Q1 respondida. Q2–Q9 têm default e não bloqueiam o scoping.

**Verificação técnica para o AutoLoopRunner (não é pergunta ao dono):**
- **T-1:** confirmar na versão do GoTrue do projeto que a API admin aceita `password_hash` no
  `createUser` **e** no `updateUserById`. Se o update não aceitar, o reset envia `password` em claro
  ao GoTrue (TLS, backend→Supabase) e continua gravando o bcrypt local; o rollback segue valendo.
  Se nem o create aceitar, a importação cai para `INSERT` em `auth.users`/`auth.identities` feito
  **pelo job** (não pela migration), como exceção documentada à I7.

## Open questions

### P0 (bloqueante)

- **Q1 — A Data API (PostgREST) do projeto expõe o schema `public`, e com que RLS/grants?** Hoje
  `auth.users = 0`: ninguém consegue um JWT com `role = authenticated` para este projeto. A
  importação cria os 12 primeiros. Um usuário com sessão, mais a chave publicável (que por desenho
  não é segredo e pode já ter circulado desde o template), chama
  `https://kngrpoqzaxtuzkcugsyl.supabase.co/rest/v1/app_user` como `authenticated`. Os defaults do
  Supabase dão `GRANT ALL` em tabelas do `public` para `anon`/`authenticated`, e as migrations deste
  repositório não ativam RLS no `public` (só o schema `metricas` foi deliberadamente tirado do
  PostgREST, ADR-0045). Se estiver aberto, isso expõe `password_hash`, os SIDs do Conexos
  (`conexos_sessions`) e todos os ledgers. O código não usa a Data API em lugar nenhum (nenhum
  `@supabase/*`, nenhum `/rest/v1`). Preciso de: (i) o estado atual (Settings → Data API → exposed
  schemas; e RLS nas tabelas do `public`); (ii) a confirmação do default: **desligar a Data API, ou
  tirar `public` dos schemas expostos, antes do passo 6.4 (importação)**, como pré-requisito escrito
  no `DEPLOY.md` e checado pelo job de sync antes de criar o primeiro usuário, se houver forma
  segura de checar. Não é código; é configuração do painel que só o dono do projeto confirma.

### P1 (desejável; há default proposto)

- **Q2 — Login direto no front (supabase-js) ou proxy no backend?** Default: **proxy** (arquitetura
  §1). O supabase-js no front daria refresh automático de graça, mas põe chave e dependência no
  front, e os logins de quem está inativo ou ambíguo passariam a ser julgados pelo GoTrue, não por
  nós. O report também teria de mudar.
- **Q3 — Login por username continua?** O GoTrue só aceita e-mail, mas o proxy resolve o
  identificador no nosso banco antes. Default: **continua aceitando e-mail ou username** (custa zero
  e mantém o report funcionando sem trocar credencial); o **banner de transição sai** nesta feature
  (todo ativo tem e-mail), com `GET /auth/transicao` e `AUTH_TRANSICAO_EMAIL_BANNER`.
- **Q4 — Usuários inativos na importação.** Default: inativo **com** e-mail é importado **banido**
  (o vínculo fica completo e reativar é só desbanir); inativo **sem** e-mail não é importado, e
  reativar exige e-mail e cria o usuário no GoTrue na hora. Confirmar também se a conta `admin`
  está ativa e qual e-mail ela tem: se ativa, é importada como as outras, e aposentá-la continua
  quebrando o report até a credencial ser trocada (já registrado no `DEPLOY.md`).
- **Q5 — Janela de convivência ou logout forçado no deploy?** Default: **convivência** de ≥ 12 h
  (tokens antigos continuam valendo até expirar), encerrada apagando `AUTH_JWT_SECRET`. Alternativa
  mais simples: todo mundo loga de novo no deploy (12 pessoas, um login cada), mas perde o rollback
  sem logout.
- **Q6 — Manter `password_hash` escrito até a limpeza?** Default: **sim** (R7), para o rollback por
  configuração funcionar com as senhas trocadas depois do corte. A coluna, o bcrypt no login, o
  `AUTH_PROVIDER=local`, o `app_user.role` e o claim `role` saem num `/feature-tweak` de limpeza,
  depois de uma semana estável.
- **Q7 — Rate limit.** Pelo proxy, o GoTrue vê todo login e refresh vindo do IP do Render: um ataque
  de força bruta em `/auth/login` pode esgotar o balde de login do projeto e trancar todo mundo.
  Default: limitador **próprio** em `/auth/login` (por IP e por identificador, ex.: 5/min por IP e
  10 falhas/15 min por identificador) e em `/auth/refresh`, mais rever no painel os limites de
  sign-in e de refresh do Auth para comportar 12 usuários renovando de hora em hora.
- **Q8 — Client do GoTrue no backend.** Default: **HTTP simples** (`SupabaseAuthClient`, fetch/axios
  + Zod nas respostas), no padrão dos outros clients, sem `@supabase/supabase-js`. Alternativa: usar
  o SDK só no backend (`auth.admin.*`), aceitando a dependência.
- **Q9 — Desativar também revoga sessões no Supabase?** Default: **banir** (`ban_duration` longo),
  que impede login e refresh no GoTrue; sem revogação explícita de sessões (a API admin não revoga
  sem o token do próprio usuário, e o `ativo` por requisição já corta em ≤ 30 s).

## Verificação do Q1 no banco de produção (2026-09-29, read-only)

- As **44 tabelas** de `public` têm **RLS ligada** e existem **0 políticas** em `public`: sem política, RLS nega toda linha a `anon`/`authenticated`.
- `anon` e `authenticated` **não têm** `SELECT`/`INSERT`/`UPDATE`/`DELETE` em nenhuma tabela de `public` (incluindo `app_user`). Têm só `TRUNCATE`, `REFERENCES` e `TRIGGER`, herdados do default privilege do role `postgres` (`anon=Dxtm/postgres`). O PostgREST não emite `TRUNCATE`, então isso não é alcançável pela Data API, mas não deveria existir.
- Funções em `public`: `rls_auto_enable` (event trigger) e `permuta_execucao_bloqueia_reabertura` (trigger). Ambas são funções de gatilho, não chamáveis por `/rpc`. Nenhuma view em `public`.
- **Conclusão:** mesmo com a Data API ligada e `public` exposto, um usuário `authenticated` recém-importado **não lê nada** das nossas tabelas. O risco do Q1 não se materializa pelo banco.
- **Proposta de higiene (a confirmar):** a migration 0067 revoga `TRUNCATE, REFERENCES, TRIGGER` de `anon`/`authenticated` em todas as tabelas de `public` e ajusta o `ALTER DEFAULT PRIVILEGES` do `postgres` para não concedê-los a tabelas novas; e, como defesa em profundidade, o dono do ciclo desliga a Data API (ou tira `public` dos schemas expostos) no dashboard.

## Respostas (2026-09-29, dono do ciclo)

- **Q1 — resolvida** pela verificação acima: a Data API não lê nada das nossas tabelas. **Aprovado:** a migration 0067 revoga `TRUNCATE, REFERENCES, TRIGGER` de `anon`/`authenticated` nas tabelas de `public` e ajusta o `ALTER DEFAULT PRIVILEGES` do `postgres`. Desligar a Data API no dashboard fica como recomendação ao dono do ciclo (fora do código).
- **Q2, Q3, Q5, Q6, Q7, Q8, Q9 — defaults aceitos como escritos** (proxy no backend; login por usuário continua via resolução para e-mail, banner do passo 1 sai; janela ≥ 12 h fechada ao apagar `AUTH_JWT_SECRET`; `password_hash` segue gravado até o tweak de limpeza; limiter próprio por IP e por identificador em `/auth/login` e `/auth/refresh`; `SupabaseAuthClient` HTTP com Zod, sem `supabase-js`; desativar = ban no Supabase, com o `ativo` por requisição como garantia).
- **Q4 — alterada: inativos NÃO são importados.** Os 3 inativos de produção (`francinei@kavex.com`, `rogerio@kavex.com`, `simone@kavex.com`, todos sem e-mail e sem eventos de acesso) são ex-integrantes da Columbia. O sync só importa usuários **ativos**; um inativo reativado no futuro é criado no Supabase na reativação (caminho que já existe no default). **Apagar** essas linhas de `app_user` fica **fora desta feature**: é operação de dado pontual e irreversível em produção, feita à parte pelo dono do ciclo (ou com OK explícito) depois do cutover. `user_permission` e `app_user_access_event` têm FK sem cascade para `app_user`; hoje não há linhas desses 3 nelas, e a autoria histórica (`executado_por`, `created_by`) é texto e sobrevive à remoção.

## Resultado do T-1 (2026-09-30, AutoLoopRunner)

**Onde rodou.** `jobs/probe-gotrue-local.ts` contra um `supabase start` descartável numa pasta fora
do repositório (`/home/inteli/.claude-tech/jobs/54ebcb56/tmp/fin-supabase-t1`), com a CLI fixada via
`npx supabase@2.118.0` (a instalação do sistema, 2.12.1, não foi tocada). `config.toml`:
`[auth] enable_signup = false`, `enable_anonymous_sign_ins = false`, `jwt_expiry = 3600`,
`enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`. A sonda recusa
qualquer `SUPABASE_URL` que não seja `http://127.0.0.1:*`/`http://localhost:*` (conferido: com a
URL do projeto ela sai com 1 antes de qualquer chamada). Nenhum contato com o projeto além do
`GET /auth/v1/health` e do JWKS públicos.

**Versões.**
- GoTrue local: **v2.197.0** (`GET /auth/v1/health`, imagem `public.ecr.aws/supabase/gotrue:v2.197.0`).
- GoTrue do projeto `kngrpoqzaxtuzkcugsyl`: **não observável sem chave**. O `GET /auth/v1/health`
  público responde `401 UNAUTHORIZED_MISSING_API_KEY` (o gateway novo, `sb-gateway-version: 2`,
  exige `apikey` até no health). Não usamos a chave publicável de produção (regra do ciclo). O JWKS
  público do projeto continua com **uma chave ES256** (`kid 2849b6ec-…`), igual ao local.
  Consequência: o resultado abaixo vale para a v2.197.0; o corte ganha uma verificação que prova o
  mesmo no projeto antes de virar a chave (ver "Impacto no corte").

**Vereditos (um por linha, saída da sonda).**

| # | Verificação | Resultado |
|---|---|---|
| 1 | `POST /admin/users { email, password_hash: '$2a$12$…', email_confirm: true }` | **OK**: 200, `email_confirmed_at` preenchido |
| 2 | login com a senha original (`/token?grant_type=password`) | **OK**: 200 (o hash `$2a$12$` foi aceito como está) |
| 3 | `PUT /admin/users/:id { password_hash }` | **NÃO FUNCIONA, ignorado em silêncio**: responde 200, mas a senha nova dá 400 e a antiga continua entrando |
| 3b | `PUT /admin/users/:id { password }` (fallback) | **OK**: 200, nova entra, antiga 400 |
| 4 | `PUT { email, email_confirm: true }` | **OK**: 200, login com o e-mail novo entra, com o antigo não; Mailpit 0 → 0 mensagens |
| 5 | `ban_duration: '876000h'` / `'none'` | **OK**: login banido 400 `user_banned`; refresh banido 400 `user_banned`; `'none'` libera (`banned_until` some) |
| 6 | `POST /logout?scope=local` com o access token | **OK**: 204; refresh daquela sessão → 400 `refresh_token_not_found`; outra sessão do mesmo usuário continua renovando |
| 7 | reuso de refresh já rotacionado | **Diferente do previsto no D12**: o **pai** do token ativo é aceito mesmo após a janela de 10 s e devolve o token ativo (tolerância a "cliente perdeu a resposta"); o **avô** é recusado (400 `refresh_token_already_used`), mas a sessão **não** cai: o token ativo continua renovando |
| 8 | assinatura do access token | **OK**: `alg=ES256`, verifica contra `/.well-known/jwks.json` com `iss=http://127.0.0.1:54321/auth/v1`, `aud=authenticated`, `role=authenticated`, `is_anonymous=false`, `exp-iat=3600`. A CLI 2.118 já assina ES256 por padrão: **não** foi preciso `signing_keys_path` |
| 9 | cabeçalhos da API admin | chave `sb_secret_…`: só `apikey` = 200, só `Authorization: Bearer` = 401, os dois = 200; chave legada (JWT `service_role`): só `apikey` = 401, só `Bearer` = 200, os dois = 200. A publicável na admin: 403 (`sb_`) / 401 (legada) |

Outros formatos registrados (alimentam os schemas Zod do `SupabaseAuthClient`): erro de credencial
= **400** `{ code, error_code: 'invalid_credentials', msg }` (senha errada e e-mail inexistente
idênticos); e-mail repetido no create = **422** `error_code: 'email_exists'`; sessão =
`{ access_token, token_type, expires_in, expires_at, refresh_token, user }`; lista admin =
`{ users, aud }`. O `iss` é comparado byte a byte: com `SUPABASE_URL=http://localhost:54321` o
token emitido para `127.0.0.1` foi recusado (`unexpected "iss" claim value`). Em produção a
variável tem de ser exatamente `https://kngrpoqzaxtuzkcugsyl.supabase.co`, sem barra final (o
`authEnv` remove a barra final).

**Decisões que o resultado impõe (fallback documentado).**
- **Create aceita `password_hash`** → a importação usa a API admin. **Não há exceção à I7**: nenhum
  `INSERT` em `auth.users`/`auth.identities`.
- **Update ignora `password_hash`** → redefinir senha (admin) e o `seed-admin` enviam `password` em
  claro ao GoTrue (TLS backend → Supabase) e continuam gravando o bcrypt local (R7 mantida: a mesma
  senha nos dois lados; o hash do GoTrue é o dele). Task 9 ajustada.
- **Vincular um usuário já existente no GoTrue sem ter a senha em claro** (sync retomando execução
  interrompida; reativar sem vínculo quando o e-mail já existe no GoTrue) **não** consegue
  reescrever a senha do GoTrue. Nesses casos o vínculo é gravado e a linha do relatório/log diz
  "senha do GoTrue mantida; se não entrar, redefina a senha". No caso real (execução interrompida)
  o hash no GoTrue é o mesmo que o job acabou de enviar. Criar usuário pela tela e o `seed-admin`,
  que têm a senha em claro, atualizam a senha ao vincular.
- **Cabeçalhos**: endpoints públicos com `apikey: <publicável>`; admin com `apikey: <secreta>` e,
  só quando a chave é legada (JWT, começa com `eyJ`), também `Authorization: Bearer <secreta>`.
  Assim os dois formatos funcionam sem mandar `sb_secret_…` num `Authorization`.
- **D12**: o risco é menor do que o previsto. Uma aba uma geração atrás é atendida pelo GoTrue; duas
  gerações atrás recebe 400 e, com a releitura do `localStorage` antes de renovar, adota o token da
  outra aba. A coordenação entre abas continua (reduz chamadas e evita o 400).

**Impacto no corte.** O runbook ganha, no passo 4 (depois do sync real e antes de virar a chave),
um teste de login do dono direto no GoTrue do projeto com a própria senha
(`POST /auth/v1/token?grant_type=password` com a chave publicável): prova, na versão do projeto,
que o `password_hash` importado foi aceito. Se falhar, não se vira a chave (nada mudou para
ninguém: o login ainda é local).

**Não precisa do projeto real.** O resultado local basta para o código; a única incerteza (versão
do projeto) é coberta pela verificação do passo 4, sem usuário descartável em produção.
