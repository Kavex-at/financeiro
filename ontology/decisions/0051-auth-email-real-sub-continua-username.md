---
adr_number: 0051
title: Acesso por e-mail real em três passos, e o `sub` do token continua sendo o `username` até o passo 3
date: 2026-09-28
status: accepted
type: new
related_entities: []
related_actions: []
related_integrations: []
evidence:
  - src/backend/migrations/0064_app_user_email.sql
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/domain/service/auth/AuthService.test.ts
  - src/backend/routes/auth.ts
  - src/backend/routes/usuarios.ts
  - src/backend/jobs/SeedAdminConfig.ts
  - ontology/_inbox/auth-email-transicao-interview.md
  - ontology/_inbox/auth-email-transicao-tasks.md
supersedes_decisions: []
amends_decisions: []
---

# ADR 0051: e-mail real para todo usuário, sem mexer na identidade de auditoria

**Cliente:** Columbia Trading · **Entrega:** Kavex · **Branch:** `feat/auth-email-transicao`.
`entity_changed = false`: `app_user` é infraestrutura de acesso, não entidade do domínio financeiro.
Nenhum arquivo em `ontology/entities/` muda.

> Número reservado por esta branch. Reconferir contra a `main` no rebase: sessões paralelas já
> colidiram na numeração de ADR e de migration antes (ver ADR-0048).

## Contexto

A autenticação vai migrar para o Supabase Auth, e o Supabase Auth exige e-mail real em todo usuário.
Hoje `app_user` não tem coluna `email`: o identificador é `username`, que é e-mail para quase todos e
não é para o `admin` criado pelo seed. Contagem read-only em produção (2026-09-28): 15 usuários, 14
ativos, todos admin; nenhum `username` repetido sem distinção de caixa; `admin` é o único que não é
e-mail. A decisão do dono do ciclo é que todos, inclusive Kavex e MP, migrem para o e-mail da
Columbia (`@columbiabr.com`).

O `username` não é um rótulo: é o `sub` do token e, por ele, o `executado_por`/`criado_por`/
`triggeredBy` gravado nos ledgers de Permutas, SISPAG e Recebimentos, a chave do vínculo Conexos por
usuário e a entrada do allow-list `OPERACAO_USUARIOS`. Mudar o `sub` sem migrar esse histórico faria
a mesma pessoa aparecer com duas identidades, derrubaria a sessão Conexos dela (as baixas voltariam a
sair pelo robô em silêncio) e a tiraria do Painel de Operação.

## Decisão

### D1. O plano tem três passos, e este é o primeiro

1. **E-mails reais** (esta ADR): todo usuário ganha um e-mail de login, cadastrado por um admin.
2. **Permissões por página/feature**, lidas do banco a cada requisição, nunca do token. Feature
   separada.
3. **Supabase Auth** no mesmo projeto do banco, importando os hashes bcrypt como estão.

Remover o login por `username` e o banner de transição fica para um `/feature-tweak` posterior,
quando todo usuário ativo tiver e-mail.

### D2. `sub = username`, congelado até o passo 3 (Q1, Q2)

O token **não** ganha claim `email`. O `sub` continua sendo o `username` canônico do banco, não o
identificador digitado: logar pelo e-mail de quem tem `username = 'admin'` produz `sub = 'admin'`. O
e-mail pode diferir do `username` (corrigir um typo, trocar de domínio). O `username` é a identidade
de auditoria e nenhuma tela o edita; o `email` é o identificador de login e o que vai ao Supabase
Auth no passo 3. Se a UI precisar exibir o e-mail, ele vem na resposta do login ou na listagem,
nunca no token.

**Dependência que o passo 3 precisa saber.** Três sítios de `routes/recebimentos.ts` (o
`triggeredBy` das execuções e o `ator` de arquivar/desarquivar transação) leem
`req.user.email ?? req.user.sub`. Hoje isso dá o `username` **porque o token não tem `email`**. Quem
adicionar o claim `email` no passo 3 precisa inverter esses três para `sub ?? email` no mesmo PR, ou
eles passam a gravar o e-mail na trilha em silêncio.

### D3. Login por e-mail ou usuário, sem distinção de caixa

O `POST /auth/login` casa o identificador, sem distinção de caixa, com o `email` **ou** o `username`.
O corpo continua `{ username, password }`, porque front e back sobem em momentos diferentes e renomear
o campo quebraria o login na janela entre os deploys. Inexistente, inativo e senha errada dão o mesmo
401. Se duas linhas casarem, o login recusa (401) e loga erro com os ids; o sistema nunca escolhe uma.

A escrita impede que isso aconteça: um e-mail não pode coincidir, sem distinção de caixa, com o
`email` nem com o `username` de outro usuário (409). A unicidade do próprio e-mail é garantida por
índice (`lower(email)`, parcial); a colisão cruzada é checada no mesmo statement do `INSERT`/`UPDATE`.

### D4. Sem backfill (R2 substituída)

`email` nasce `NULL` para todos. Copiar `username` para `email` preencheria valores que seriam
trocados pelo e-mail da Columbia e esconderia o progresso: a coluna vazia na tela de usuários é o
placar da transição. A migration só é aditiva, então não tem script de reverse. Ela aborta com
mensagem em português se encontrar dois `username` iguais sem distinção de caixa, e cria um índice
único em `lower(username)` que torna essa garantia permanente.

### D5. Banner por chave manual (Q6)

O aviso na tela de login é ligado pela variável `AUTH_TRANSICAO_EMAIL_BANNER` do backend (só o valor
exato `true` liga) e exposto pelo `GET /auth/transicao` público, que devolve só `{ ativo: boolean }`,
sem consultar o banco. A regra automática proposta antes ("algum ativo sem e-mail") foi descartada:
ela mediria a presença do `admin` compartilhado, não a transição. O front falha fechado: sem resposta
válida, o banner não aparece.

### D6. Salvaguardas de desativação e de seed (R11, R12)

- **R11:** ninguém desativa o próprio acesso, e o último admin ativo não pode ser desativado (409).
  A checagem e o update rodam na mesma transação, com os admins ativos travados (`FOR UPDATE`),
  para que dois admins que se desativam ao mesmo tempo não zerem os admins. Reativar não passa pela
  guarda.
- **R12:** o `seed-admin` exige `ADMIN_EMAIL` e `ADMIN_PASSWORD`, sem default no código, e semeia
  `username = email = ADMIN_EMAIL`. A var `ADMIN_USERNAME` sai de uso. O `admin` compartilhado de
  hoje não é apagado pela migration: é aposentado pela tela, quando cada pessoa tiver o próprio
  acesso de admin (Q7).

## Consequências

- Nenhum `executado_por`, `criado_por`, `triggeredBy`, `created_by`, vínculo Conexos ou entrada do
  `OPERACAO_USUARIOS` passa a registrar valor diferente do que registra hoje.
- O passo 3 herda uma decisão em aberto: como o `sub` do Supabase (UUID) se relaciona com o
  `username` histórico. Não se resolve aqui.
- Desativar um usuário continua não derrubando o token que ele já tem (JWT stateless, 12h). Lacuna
  anterior a esta ADR; candidata natural ao passo 2, que lê permissões do banco por requisição.
- Ordem de deploy: backend antes do frontend. O front novo tolera o backend antigo (o banner falha
  fechado e `POST /usuarios` ainda aceita `username` como alias), mas a edição de e-mail só existe no
  backend novo.
