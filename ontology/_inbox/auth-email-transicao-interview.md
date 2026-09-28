# OfficeHours — Auth: transição para e-mail real (passo 1 de 3)

> Modo: `new`. Conduzida em 2026-09-28. Slug: `auth-email-transicao`.
> Decisões do dono do ciclo recebidas via orquestrador (não houve conversa direta nesta rodada).
> `entity_changed = false` (justificativa no fim).

## Intent

A autenticação vai migrar para o Supabase Auth (passo 3), e o Supabase Auth exige e-mail real em
todo usuário. Hoje `app_user` não tem coluna `email`: o identificador é `username`, que para ~11
usuários já é um e-mail (@kavex.com / @kavex.at / mpsolutions.com.br) e para um deles (`admin`,
criado pelo seed) não é. Este passo dá a todo usuário um e-mail real, cadastrado por um admin, sem
mexer na identidade de auditoria.

### Plano maior (contexto, decidido com o dono do ciclo)

1. **E-mails reais** (esta feature).
2. **Permissões por página/feature** (`permutas:ver|executar`, `sispag:ver|executar`,
   `recebimentos:ver|executar`, `operacao:ver`, `metricas:ver`, `usuarios:gerenciar`), lidas do
   banco por request (opção B, nunca no token). Feature separada.
3. **Supabase Auth** no mesmo projeto do banco, importando os hashes bcrypt como estão, sem SMTP.

Fora deste passo: remover o login por `username` e o banner. Isso vira um `/feature-tweak` pequeno
quando todo usuário ativo tiver e-mail.

## Estado atual verificado no código

| Ponto | Onde | Observação |
|---|---|---|
| Tabela | `migrations/0007` + `0028` (`ativo`, `created_by`) + `0029` (vínculo Conexos) | `username TEXT UNIQUE NOT NULL`, sensível a caixa; sem `email` |
| Criação | `domain/service/auth/UserAdminService.ts:25` | `username` = `trim().toLowerCase().email()`: todo usuário criado pela UI já é e-mail minúsculo |
| Login | `routes/auth.ts:10-13` → `AuthService.login` → `UserRepository.findByUsername` (`WHERE username = $username`) | só `trim`; `Fulano@Kavex.com` não loga (bug de caixa atual) |
| Token | `AuthService.signToken` | `sub = user.username` (valor canônico do banco, não o digitado), claim extra só `role`. **Não emite `email`.** |
| Seed | `jobs/seed-admin.ts:22-23` | defaults `admin` / `columbia2026` no código; upsert por `username`. Não roda mais no pre-deploy (removido na v0.34.1, ver `render.yaml:25`) |
| Consumidores do `sub` | `http/conexosIdentity.ts` (sessão Conexos por usuário), `http/operacaoAcesso.ts` (allow-list `OPERACAO_USUARIOS`), `routes/me.ts`, ~25 sítios de `executado_por` / `criado_por` / `triggeredBy` em `routes/permutas.ts`, `sispag.ts`, `recebimentos.ts`, `operacao.ts`, `usuarios.ts` (`created_by`) | todos leem `req.user.sub` primeiro |
| **Consumidores que leem `email` ANTES de `sub`** | `routes/recebimentos.ts:729`, `:927` (`triggeredBy`), `:967` (`ator` do arquivar/desarquivar transação) | hoje equivalem a `sub` porque o token não tem `email`. **Se o token passar a emitir `email`, esses três mudam de identidade em silêncio.** Ver Q1. |
| Front | `lib/auth/AuthProvider.tsx` guarda `auth_username` em `localStorage` a partir da resposta do login; `app/login/page.tsx` campo "Usuário"; `app/usuarios/page.tsx` + `NovoUsuarioDialog`, `ResetSenhaDialog`, `VinculoConexosDialog` | |

## Axis 1 — Entity

### `AppUser` (tabela `app_user`) ganha `email`

Não é entidade do domínio financeiro (não existe em `ontology/entities/`, e não deve existir: é
infraestrutura de acesso, como o config doctor do `painel-operacao`). Mudança de schema:

- **`email TEXT NULL`**, único sem distinção de caixa: índice único parcial em `lower(email)`
  `WHERE email IS NOT NULL`. `NULL` é o estado "falta e-mail" que alimenta o banner e o destaque na
  tela de usuários.
- **Persistir sempre minúsculo e aparado** (a unicidade em `lower()` protege o banco; normalizar na
  escrita evita exibir `Fulano@Kavex.com` e `fulano@kavex.com` como coisas diferentes).
- **Backfill na migration:** `email = lower(trim(username))` onde `username` já é e-mail válido.
  O `admin` fica `NULL` e é preenchido por um admin pela UI.
- **`username` fica** como está: continua sendo o identificador canônico e imutável de auditoria
  neste passo. Nenhuma tela o edita.
- Pré-condição da migration: não pode haver dois `username` iguais sem distinção de caixa (senão o
  backfill viola o índice único). Com ~12 usuários é improvável, mas a migration deve **falhar alto**
  em vez de pular linhas (ver Q5).

### O que é imutável / histórico

- `username`: imutável (é o `sub`, o `executado_por` gravado nos ledgers e a chave do vínculo
  Conexos e do allow-list).
- `email`: mutável por admin (decisão do dono do ciclo: admins preenchem). Se precisa de histórico de quem
  alterou, ver Q3.

## Axis 2 — Action

| Ação | Pré-condição | Pós-condição | Idempotente? |
|---|---|---|---|
| `autenticar` (POST `/auth/login`) | corpo com identificador + senha | se o identificador bate, sem distinção de caixa, com `email` **ou** `username` de um usuário ativo e a senha confere: token com `sub = username` canônico do banco. Senão 401 genérico (não revela se a conta existe) | sim (sem efeito colateral) |
| `definirEmail` (admin, PATCH em `/usuarios/:id`) | chamador é admin; e-mail válido; não colide com e-mail nem `username` de outro usuário (ver Q4) | `email` gravado minúsculo; 409 na colisão; 404 se o id não existe | sim (mesmo valor = no-op) |
| `criarUsuario` (admin) | e-mail obrigatório | `username` e `email` gravados com o mesmo valor minúsculo (o `username` de usuário novo continua sendo o e-mail, como hoje) | não (409 no segundo) |
| `consultarTransicao` (GET público) | nenhuma | `{ pendente: boolean }`: `true` enquanto existir usuário **ativo** com `email IS NULL` | sim |
| `seedAdmin` (job manual) | `ADMIN_EMAIL` e `ADMIN_PASSWORD` presentes no env; sem default de senha no código | upsert do admin com e-mail; falha com mensagem clara se faltar env | sim (re-seed atualiza) |

Nenhuma ação escreve no Conexos, Nexxera ou GED.

## Axis 3 — Invariant

- **I1 — A identidade de auditoria não muda neste passo.** `sub` continua `= username` canônico do
  banco. Nenhum `executado_por`, `criado_por`, `triggeredBy`, `created_by`, vínculo Conexos ou
  entrada do `OPERACAO_USUARIOS` passa a registrar um valor diferente do que registra hoje. É a
  proposta do orquestrador e é a única que não exige migrar dados de auditoria nem reconfigurar o
  allow-list; recomendo aceitar. Implicação concreta: ver Q1 (claim `email` no token).
- **I2 — Login não revela existência de conta.** Continua 401 genérico para usuário inexistente,
  inativo ou senha errada, também quando o identificador casa por e-mail.
- **I3 — Um identificador digitado resolve para no máximo um usuário.** `email` e `username` formam
  um espaço único sem distinção de caixa; a escrita recusa colisões cruzadas (Q4). Sem isso, o login
  por "e-mail ou usuário" pode casar duas linhas e autenticar a errada.
- **I4 — E-mail sempre minúsculo e único sem distinção de caixa** (índice em `lower(email)`).
- **I5 — O endpoint público só expõe um booleano.** Sem contagem, sem nomes, sem e-mails.
- **I6 — Nenhuma senha default no código.** `seed-admin` falha sem `ADMIN_PASSWORD`.
- **I7 — Usuário inativo não conta para o banner** e continua sem logar.

**Raio de impacto se errar:** I1 é o mais caro. Mudar o `sub` sem migrar histórico quebra a
atribuição de baixas de permuta, remessas SISPAG e execuções de recebimento (a mesma pessoa aparece
com duas identidades), derruba a sessão Conexos por usuário (as baixas voltam a sair pelo robô em
silêncio, cf. memória "usuário sem vínculo cai no robô em silêncio") e tira pessoas do Painel de
Operação. I3 errado é falha de autenticação.

## Axis 4 — Integration

- **Conexos:** nenhuma mudança de contrato. O vínculo continua chaveado por `username`
  (`UserRepository.getVinculoConexos`). Só é afetado se I1 for violado.
- **Nexxera / GED / SharePoint:** não tocados.
- **Supabase:** só como Postgres (migration nova, `0064_app_user_email.sql`). Supabase Auth fica para
  o passo 3.
- **Env / config:** `seed-admin` passa a ler `ADMIN_EMAIL` (obrigatório) e perde o default de senha.
  Atualizar `.env.example`, `DEPLOY.md` (linhas 99-100, 144-154) e `render.yaml` (linhas 80-82). Sem
  SSM (não existe infra Terraform).
- **Tenant:** um só (Columbia). Sem variação.
- **Build:** a migration é `.sql` em `migrations/`; o `npm run build` já copia esses arquivos
  (gotcha do `BootMigrator`, incidente 2026-09-23). Conferir que o nome novo entra na cópia.

## Decisões já tomadas (dono do ciclo)

- Admins preenchem os e-mails; sem autocadastro no login.
- Coluna `email` única sem distinção de caixa; backfill automático onde `username` já é e-mail;
  `username` fica por ora.
- Login aceita e-mail **ou** `username` legado, sem distinção de caixa (corrige o bug atual). Rótulo
  do campo: "E-mail ou usuário".
- Banner de transição no login enquanto algum usuário **ativo** estiver sem e-mail, guiado por
  endpoint público booleano (some sozinho).
- `/usuarios`: coluna E-mail com destaque para os que faltam, ação "editar e-mail", e-mail obrigatório
  para usuário novo.
- O `admin` recebe e-mail real definido por um admin; `seed-admin` exige e-mail e perde a senha
  hardcoded.
- Remover login por `username` e o banner depois: tweak posterior, fora deste escopo.

## Extracted rules

- R1: `app_user.email` é opcional no banco neste passo (`NULL` = pendente), único em `lower(email)`,
  gravado minúsculo e aparado.
- R2: Backfill: `email = lower(trim(username))` quando `username` é e-mail válido; os demais ficam
  `NULL`.
- R3: Login casa o identificador, sem distinção de caixa, com `email` ou com `username`; usuário
  inativo e senha errada dão o mesmo 401.
- R4: `sub` do token = `username` canônico do banco (inalterado). Resposta do login continua
  devolvendo `username` para o front.
- R5: Nenhum `email` pode ser igual (sem distinção de caixa) ao `email` ou ao `username` de outro
  usuário (proposta; ver Q4).
- R6: Usuário novo exige e-mail; `username` do usuário novo = o mesmo e-mail.
- R7: Só admin define ou edita e-mail (mesmo guard `requireRole('admin')` de `routes/usuarios.ts`).
- R8: `GET` público de transição devolve só `{ pendente: boolean }`, considerando apenas usuários
  ativos.
- R9: `seed-admin` exige `ADMIN_EMAIL` e `ADMIN_PASSWORD`; sem defaults de credencial no código.
- R10: Mensagens de erro ao operador em português (ADR-0042).

## entity_changed: false

**Justificativa:** `app_user` é infraestrutura de acesso, não entidade do domínio financeiro; não há
arquivo em `ontology/entities/` para ela e nenhuma entidade, ação de domínio, máquina de estado ou
regra de negócio financeira muda. A identidade de auditoria (`executado_por`), que é o ponto de
contato com o domínio, fica explicitamente **inalterada** (I1). Mesma lógica do config doctor no
`painel-operacao`.

**Recomendação (não bloqueia):** registrar um ADR curto com o plano de 3 passos e a decisão "sub =
username até o passo 3", porque os passos 2 e 3 vão depender dela. Pode ser feito pelo
OntologyCurator em paralelo, sem diff de entidade.

### Ontology diff needed: no
### Reason: new property (infra de acesso, fora da ontologia de domínio)

## Handoff

→ **TaskScoper** (entity_changed=false), Q1–Q7 respondidas em 2026-09-28 (ver "Respostas" abaixo).

## Open questions

### P0 (bloqueante)

- **Q1 — O token passa a carregar `email`?** A proposta era manter `sub = username` e adicionar
  `email` como claim extra. O código mostra que isso **não é neutro**: `routes/recebimentos.ts:729`,
  `:927` (`triggeredBy`) e `:967` (`ator` de arquivar/desarquivar transação) leem
  `req.user.email ?? req.user.sub`. Hoje dão o `username` porque o token não tem `email`; com o claim,
  passariam a gravar o e-mail, e um e-mail editado depois (Q2/Q3) divergiria do `username` na trilha.
  Opções: **(a)** não emitir `email` no token neste passo (nenhum consumidor precisa; o passo 2 lê
  permissões do banco); **(b)** emitir, e inverter esses três sítios para `sub ?? email` no mesmo PR.
  Recomendo **(a)**: zero risco para I1 e nada no escopo depende do claim. Se a UI quiser mostrar o
  e-mail logado, a resposta do login pode trazê-lo sem colocá-lo no token.

### P1 (desejável; há default proposto)

- **Q2 — O e-mail pode diferir do `username` quando o `username` já é e-mail?** (ex.: corrigir um
  typo, ou pessoa que trocou de domínio). Default proposto: **sim**. `username` é identidade de
  auditoria congelada; `email` é o identificador de login e de contato, e é ele que vai para o
  Supabase Auth no passo 3. O login pelo `username` antigo continua funcionando até o tweak de
  remoção. Consequência a aceitar: no passo 3 alguém vai ter de decidir como o `sub` do Supabase
  (UUID) se relaciona com o `username` histórico; isso não se resolve aqui.
- **Q3 — Auditoria da edição de e-mail.** Hoje nada na gestão de usuários tem trilha além de
  `created_by` (ativar/desativar e redefinir senha também não têm). Default proposto: colunas
  `email_updated_by` / `email_updated_at` em `app_user` (mesmo padrão do `created_by`) mais uma linha
  de `LogService` em português. Alternativa mais ampla (tabela de eventos para toda a gestão de
  usuários) fica fora deste escopo. Confirmar se as duas colunas bastam.
- **Q4 — Colisão cruzada e-mail × `username`.** Ex.: usuário A tem `username = maria@kavex.com`;
  admin tenta pôr `email = maria@kavex.com` no usuário B. O índice em `lower(email)` não pega isso.
  Default proposto: recusar com 409 ("este e-mail já identifica outro usuário") quando o e-mail
  coincidir, sem distinção de caixa, com `email` **ou** `username` de outro usuário; e no login, se
  mesmo assim duas linhas casarem, recusar (401) e logar erro em vez de escolher uma. Confirmar.
- **Q5 — Colisão de caixa entre `username` existentes.** Se já existirem dois `username` iguais sem
  distinção de caixa, o backfill e o login sem distinção de caixa ficam ambíguos. Default proposto: a
  migration aborta com mensagem clara, e o caso é resolvido à mão antes do deploy. Pedir uma contagem
  em produção (`SELECT lower(username), count(*) FROM app_user GROUP BY 1 HAVING count(*) > 1`)
  antes de implementar, para saber se o caso existe.
- **Q6 — Texto do banner.** Default proposto: "Estamos migrando o acesso para e-mail. Se você ainda
  entra com nome de usuário, peça a um administrador para cadastrar seu e-mail." Vazamento do
  endpoint público: só revela que existe algum usuário ativo sem e-mail; aceitável, desde que I5 se
  mantenha (sem contagem, sem nomes). Confirmar o texto.
- **Q7 — Quem é o dono do e-mail do `admin`?** O `admin` é uma conta compartilhada. No passo 3 ela
  vira uma conta do Supabase Auth ligada a uma caixa de e-mail. Usar a caixa de uma pessoa torna a
  conta pessoal na prática; uma caixa de equipe (ex.: `tech@kavex.at`) mantém o caráter
  compartilhado. Ou o `admin` deveria ser desativado quando cada pessoa tiver o próprio acesso de
  admin? Não bloqueia o código (o admin define o e-mail pela UI); decide só o valor.

## Respostas (2026-09-28)

Contagem read-only no banco do financeiro (Supabase `sa-east-1`, via `.env` local): 15 usuários, 14
ativos, todos `role = admin`; **0** colisões de caixa em `username`, 0 `username` com maiúscula; único
`username` não-e-mail = `admin` (ativo); hashes todos `$2a$12$`; `auth.users` vazio. Domínios:
kavex.com 7, kavex.at 3, columbiabr.com 3, mpsolutions.com.br 1.

- **Q1 — não.** O token **não** carrega `email` neste passo. `sub` = `username` segue sendo a única
  identidade; os três sítios `email ?? sub` de `routes/recebimentos.ts` ficam intocados. Se a UI
  precisar exibir o e-mail, ele vem na resposta do login / na listagem, nunca no token.
- **Q2 — sim.** `email` pode diferir do `username`. `username` = identidade de auditoria congelada;
  `email` = identificador de login (e o que vai ao Supabase Auth no passo 3).
- **Q3 — default aceito.** Colunas `email_updated_by` / `email_updated_at` em `app_user` + linha de
  `LogService` em português.
- **Q4 — recusar.** 409 quando o e-mail coincide (sem caixa) com `email` ou `username` de outro
  usuário; no login, duas linhas casando → 401 + log de erro, nunca escolher uma.
- **Q5 — resolvida pela contagem** (0 colisões). A migration ainda falha alto se encontrar uma.
- **Q6 — banner por chave manual, não automático.** Todos os usuários (inclusive Kavex/MP) vão migrar
  para o **e-mail da Columbia** (`@columbiabr.com`); a regra "algum ativo sem e-mail" sumiria assim que
  o `admin` fosse aposentado, então não mede a transição. O banner é ligado/desligado por variável de
  ambiente do backend, exposta pelo endpoint público `{ ativo: boolean }` (sem contagem, sem nomes).
  Texto aprovado:
  > **Estamos migrando o acesso para o seu e-mail da Columbia.**
  > Durante a transição, você continua entrando com seu usuário atual. Quando seu e-mail da Columbia
  > for cadastrado, ele também passa a valer, com a mesma senha.
- **Q7 — aposentar o `admin`.** Cada pessoa tem o próprio acesso de admin; o `admin` compartilhado é
  desativado (operação pela UI, não pela migration). Salvaguarda nova: **nenhum admin desativa a si
  mesmo nem o último admin ativo**.

### Ajustes às regras extraídas

- **R2 (substituída): sem backfill.** Como todos vão para o e-mail da Columbia, copiar `username`
  para `email` preencheria valores que serão trocados e esconderia o progresso na tela de usuários.
  `email` nasce `NULL` para todos; o admin cadastra o e-mail da Columbia de cada um. A coluna E-mail
  em `/usuarios` destaca os pendentes, que é o placar da transição.
- **R8 (substituída):** endpoint público devolve `{ ativo: boolean }` vindo de variável de ambiente
  (`AUTH_TRANSICAO_EMAIL_BANNER`, default desligado), não de consulta ao banco.
- **R11 (nova):** `desativar` recusa (409) quando o alvo é o próprio chamador ou o último admin ativo.
- **R12 (nova):** o `seed-admin` passa a exigir `ADMIN_EMAIL`; o usuário semeado tem
  `username = email = ADMIN_EMAIL`.
