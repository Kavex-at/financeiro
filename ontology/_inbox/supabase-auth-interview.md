# Interview Transcript — supabase-auth — 2026-08-05

**Mode:** new
**Entity affected:** `Usuario` (**nova** — a ontologia tem 17 entidades e nenhuma modela identidade)
**Base:** `origin/main` @ 6e03775 (v0.20.1) · **Worktree:** `/home/inteli/kavex-worktrees/supabase-auth` · **Branch:** `feat/supabase-auth`
**Plano aprovado:** `/home/inteli/.claude-tech/plans/upgrade-the-authentication-and-streamed-lark.md`

> **Escopo NÃO foi reaberto.** As sete decisões da tabela "Decisões de escopo já tomadas" do plano
> (migração completa para GoTrue, reset por e-mail em escopo, SSO/MFA fora, cutover por import de hash
> bcrypt, `app_user_filial` fora, SMTP como pré-requisito humano, autorização resolvida do banco) entram
> nesta entrevista como **premissas**. O trabalho aqui é extrair as **regras de negócio** que o plano
> ainda não fixa.

---

## Summary

Esta feature promove o **Supabase Auth (GoTrue) a provedor de identidade** da plataforma Financeiro,
substituindo o JWT HS256 próprio assinado pelo `AuthService`. A consequência de domínio — e não apenas
técnica — é que **`Usuario` passa a existir como entidade de primeira classe da ontologia**: hoje ele é
domínio de verdade (é quem assina a baixa no `fin010`, quem a trilha de auditoria atribui em
`executado_por`/`criado_por`, e quem a UI de borderôs oferece como filtro), mas nunca foi modelado. A
decisão arquitetural central é a **separação entre identidade e autorização**: o JWT do GoTrue prova
*quem é* (um UUID assinado por ES256/JWKS); a linha em `app_user`, resolvida do banco a cada request,
decide *o que pode* (`role`, `ativo`) e *como se chama* (`username`). O `Usuario` da nossa ontologia é a
linha `app_user` — não o registro em `auth.users`, que é apenas o custodiante da credencial.

O eixo de risco que domina toda a modelagem é a **estabilidade do identificador do ator**: `sub` deixa
de ser o e-mail e passa a ser um UUID, e esse valor hoje alimenta ~20 pontos que gravam a trilha de
auditoria e a identidade Conexos. A regra extraída (I4) fecha isso.

---

## Eixo 1 — Entity

### Q1. Quantas entidades novas esta feature introduz: `Usuario`, `Sessao` e `Permissao` — ou menos?

**Uma: `Usuario`.** Justificativa de curadoria, para o `OntologyCurator` não criar entidades vazias:

- **`Sessao` não é entidade nossa.** Depois desta feature, a sessão (access token de vida curta,
  refresh rotativo, revogação) é **inteiramente propriedade do GoTrue** — não persistimos nada, não
  temos invariante que possamos enforcar sobre ela, e nenhuma ação de domínio a manipula. Modelá-la
  criaria uma entidade com zero linhas no nosso banco. O que é de domínio na sessão é **um comportamento
  do `Usuario`**: "desativar revoga o acesso em tempo limitado" (I10) — isso vira uma *business rule*,
  não uma entidade.
- **`Permissao` não é entidade.** `role` é um **atributo enumerado** de `Usuario`
  (`'admin' | 'operador'`, `UserAdminService.ts:11`) com exatamente dois valores e nenhum ciclo de vida
  próprio. A dimensão que *seria* uma entidade/relação — o escopo por filial (`Usuario N—M Filial`) —
  está **explicitamente fora de escopo** (follow-up). Criar `Permissao` agora seria modelar o vazio.

**Conclusão:** 1 entidade nova (`Usuario`), 1 integração nova (`supabase-auth`), N business rules.

### Q2. O `Usuario` é a linha em `app_user` ou o registro em `auth.users`?

**É a linha em `app_user`.** `auth.users` é um **detalhe do integrante externo** (custódia de credencial
e emissão de token), modelado dentro de `integrations/supabase-auth.md`, não como entidade. Isto não é
formalismo: é o que torna I2 ("JWT válido sem linha em `app_user` → 403") uma consequência lógica em vez
de uma regra arbitrária. **Existir no GoTrue não é existir na plataforma.**

### Q3. Propriedades — quais são imutáveis, quais são históricas?

Fonte: `migrations/0007_app_user.sql`, `0028_app_user_gestao.sql`, `0029_app_user_conexos_vinculo.sql`,
`0044_app_user_auth_link.sql` (nova), `repository/auth/UserRepository.ts:5-29`.

| Propriedade | Coluna | Mutabilidade | Nota de domínio |
|---|---|---|---|
| `id` | `app_user.id` (SERIAL) | **imutável** | Surrogate interno. Nunca sai para o ERP nem para a trilha. |
| `username` | `app_user.username` (TEXT UNIQUE) | **IMUTÁVEL — invariante I5** | O e-mail, minúsculo (`UserAdminService.ts:25`). É simultaneamente: (a) chave 1:1 com `auth.users.email`, (b) **o identificador do ator na trilha de auditoria**, (c) a chave do vínculo Conexos (`getVinculoConexos(username)`). Mudá-lo quebra as três coisas de uma vez. |
| `authUserId` | `app_user.auth_user_id` (UUID, **nova**) | **imutável uma vez setado**; `NULL` = pendente de migração | Ponteiro para `auth.users.id`. É o `sub` do JWT. **Nunca** é exibido nem persistido como ator (I4). |
| `role` | `app_user.role` | mutável | `'admin' \| 'operador'`. **Autoritativo sobre a claim do JWT** (I1). |
| `ativo` | `app_user.ativo` | mutável | O interruptor do ciclo de vida. Default `true`. |
| `createdBy` | `app_user.created_by` | **imutável (histórico)** | `username` do admin que cadastrou. |
| `createdAt` | `app_user.created_at` | **imutável (histórico)** | — |
| `conexosUsername` | `app_user.conexos_username` | mutável (vincular/desvincular) | Login no ERP (ex.: `MARILYN_MUTAFCI`). `NULL` = opera via robô. |
| `conexosPasswordEnc` | `app_user.conexos_password_enc` | mutável | Segredo **reversível** (AES-256-GCM), nunca hash, **nunca sai do backend** (I8). |
| ~~`passwordHash`~~ | `app_user.password_hash` | **transitória — `deprecated`** | Deixa de ser propriedade de domínio no cutover: a custódia da credencial migra para o GoTrue. Sobrevive só como **fonte do import bcrypt** (Fase 1) e é dropada no follow-up (Fase 4). Modelar como `deprecated: true, drop_after: cutover` para que a ontologia não a legitime. |

### Q4. Ciclo de vida — há um estado `convidado`?

**Não na v1.** O ciclo é:

```
                    ┌──────────────────────┐
                    │  pendente-migracao   │  auth_user_id IS NULL
                    │  (transitório, Fase 1│  → só loga pelo caminho LEGADO (HS256)
                    │   do rollout)        │
                    └──────────┬───────────┘
                               │ migrarUsuarioParaSupabase (job one-shot)
                               ▼
   cadastrarUsuario ──────►  ATIVO  ◄──── ativarUsuario ──── INATIVO
                               │                                ▲
                               └───────── desativarUsuario ─────┘

   (não existe transição para EXCLUIDO — hard delete é proibido, I6)
```

**Por que não há `convidado`:** SMTP é pré-requisito humano bloqueante e **não está configurado**. Um
fluxo de convite por e-mail nasceria quebrado em produção. O plano é explícito no route
(`POST /usuarios` *"passa a criar o usuário no Supabase e a linha de perfil"* — `createUser`, com senha,
não `inviteByEmail`), e o schema atual já exige `password: min 8`. Mantemos **admin define a senha
inicial**, que funciona sem SMTP. Ver lacuna **L1** (não-bloqueante) sobre a tensão com o item 4 dos
passos humanos ("templates de convite e recuperação").

**`pendente-migracao` é estado de verdade, não detalhe de implementação:** tem consequência
comportamental observável (o usuário só consegue autenticar pelo caminho legado enquanto
`AUTH_LEGACY_LOGIN_ENABLED=true`, e fica **sem login nenhum** se a flag for desligada antes de sua
migração). É a regra que impede o cutover prematuro (I13).

---

## Eixo 2 — Action

Cada ação nomeada com regra explícita (princípio **P3**).

### A1. `autenticar` (login)
- **Pré:** credencial válida no GoTrue; **e** existe `app_user` com `auth_user_id = sub` **e** `ativo = true`.
- **Pós:** o portador tem um access token de vida curta + refresh rotativo custodiados pelo GoTrue.
- **Regra:** autenticar no GoTrue **não** é autenticar na plataforma. As duas condições são conjuntivas;
  a segunda é avaliada **a cada request** (não só no login) — é isso que faz a revogação valer.
- **Idempotente:** sim (múltiplos logins ⇒ múltiplas sessões válidas; não há sessão única).

### A2. `resolverContextoUsuario` (`appUserContext` — a ação silenciosa mais importante)
- **Pré:** JWT verificado (`buildAuthMiddleware` já populou `req.user.sub`).
- **Pós:** `req.user` carrega `appUserId`, `username`, `role` **vindos do banco**; ou a request morreu em 403.
- **Regra:** `SELECT ... FROM app_user WHERE auth_user_id = $sub`. Sem linha → **403**. `ativo = false` →
  **403**. Nunca 401 nesses casos: a identidade é legítima, o que falta é autorização — e a distinção
  importa para diagnóstico (401 manda o front tentar refresh; 403 não).
- **Idempotente:** sim, é leitura pura. Cacheada por `auth_user_id` com TTL curto (ver I10).

### A3. `cadastrarUsuario`
- **Pré:** ator com `role = 'admin'`; `username` é e-mail válido e **não existe** em `app_user` nem em
  `auth.users`.
- **Pós:** existem **as duas** pontas — usuário no GoTrue **e** linha `app_user` com `auth_user_id`
  preenchido, `ativo = true`, `created_by` = `username` do ator.
- **Regra (atomicidade entre sistemas):** as duas pontas nascem juntas ou nenhuma nasce. O passo 2
  (linha local) falhando **obriga** a compensação do passo 1 (remover do GoTrue) — caso contrário fica
  um órfão no GoTrue que consegue um JWT válido e é barrado por I2, mas cujo e-mail fica **queimado**
  para um cadastro futuro. É a única situação em que `deleteUser` no GoTrue é permitido (ver I6).
- **Idempotente:** não. Re-executar com o mesmo e-mail deve dar **409**, nunca criar duplicata.

### A4. `desativarUsuario` / `ativarUsuario`
- **Pré:** ator `admin`; usuário existe.
- **Pós (`desativar`):** `ativo = false` **e** banimento no GoTrue **e** cache de contexto invalidado.
  O usuário não executa mais nada — nem leitura.
- **Regra (defesa em profundidade, ordem importa):** o flag local é a **primeira** barreira (efeito
  imediato via I3/I10) e o banimento no GoTrue é a **segunda** (impede renovar o refresh token). Se o
  banimento no GoTrue falhar, a desativação local **permanece válida** e a operação retorna sucesso
  parcial auditado — degradar para "não desativou nada" seria pior. O inverso não vale: falhar o flag
  local aborta tudo.
- **Pós (`ativar`):** `ativo = true`, unban no GoTrue. **O vínculo Conexos é preservado** durante a
  desativação (as colunas não são limpas), porque `getVinculoConexos` já filtra `ativo = true`
  (`UserRepository.ts:163`) — o vínculo fica **inerte, não perdido**. Reativar não exige redigitar a
  senha do ERP.
- **Idempotente:** sim (desativar duas vezes = desativado).

### A5. `solicitarRedefinicaoSenha` (self-service) e `redefinirSenha`
- **Pré (`solicitar`):** um e-mail é informado. **Não** exige autenticação.
- **Pós:** se — e somente se — houver `app_user` **ativo** com aquele `username`, o GoTrue dispara o link.
- **Regra (anti-enumeração):** a resposta HTTP é **idêntica** existindo ou não o usuário. Um endpoint
  público que diferencia "e-mail não cadastrado" de "enviamos o link" entrega a lista de funcionários da
  Columbia a qualquer um. Um usuário **inativo não recebe link** — reset não pode ser porta dos fundos
  para reativação.
- **Pós (`redefinir`):** a senha muda **no GoTrue**. `app_user.password_hash` **não** é escrito — a
  custódia da credencial saiu do nosso banco (ver Q3).
- **Idempotente:** `solicitar` é seguro repetir (rate-limit do GoTrue governa); `redefinir` consome o
  token de recuperação (uso único).

### A6. `redefinirSenhaDeTerceiro` (admin) — muda de natureza
- Hoje (`POST /usuarios/:id/reset-senha`) o admin **grava um hash** e passa a senha para a pessoa por
  fora. Passa a **disparar um link de recuperação**.
- **Regra:** depois desta feature **nenhum humano além do titular conhece a senha de outro**. Isso não é
  cosmético: é o que permite atribuir uma baixa no `fin010` a uma pessoa e sustentar a atribuição.
- **Dependência dura:** essa ação **deixa de funcionar sem SMTP**. É o segundo motivo (além do reset
  self-service) pelo qual SMTP é bloqueante para produção.

### A7. `vincularConexos` / `desvincularConexos`
- **Pré:** ator `admin`; `SecretCipher` habilitado (senão **503**, já implementado); ambos
  `conexosUsername` + `conexosPassword` juntos, ou nenhum.
- **Pós:** senha do ERP cifrada (AES-256-GCM) em repouso; a partir daí as chamadas ao Conexos do usuário
  logado saem **no nome dele**.
- **Regra:** vincular **não** valida a credencial contra o ERP no momento da gravação — a verificação é
  `GET /me/conexos-status` (`ok` / `falha` / `ausente`). Vínculo com credencial inválida degrada **para o
  robô, silenciosamente**; por isso o status é exibido logo após o login.

### A8. `migrarUsuarioParaSupabase` (job one-shot, Fase 1)
- **Pré:** `app_user` com `auth_user_id IS NULL` e `password_hash` presente.
- **Pós:** usuário existe no GoTrue com **o mesmo hash bcrypt**; `auth_user_id` gravado.
- **Regra:** **idempotente por construção** (`auth_user_id IS NULL` é o próprio filtro) e **dry-run por
  padrão**. A senha atual do usuário continua valendo — é isso que evita o lockout geral. O reset por
  e-mail é a rede de segurança se o import do hash falhar silenciosamente.
- **Regra:** o job **nunca** desativa, nunca muda `role`, nunca toca `username`. Só preenche o ponteiro.

### A9. Ação que deliberadamente **não** existe: `excluirUsuario`
Ver I6.

---

## Eixo 3 — Invariant

### I1 — A autorização vem do banco; o token só prova identidade
`role` e `ativo` são lidos de `app_user` a cada request. A claim `role` do JWT do GoTrue é sempre
`'authenticated'` (é o role do Postgres) e **é descartada**. Sem isto, `requireRole('admin')`
(`http/auth.ts:205-222`) barraria todo mundo no dia do cutover — e uma eventual "correção" via claim
customizada colocaria a decisão de autorização num artefato configurado fora deste repositório.
**Blast radius:** total — 30+ rotas de mutação em permutas/SISPAG/recebimentos/usuários.
**Amenda a ADR-0011**, cujo texto diz literalmente *"Fonte do role: o `role` já vem no JWT"*.

### I2 — Identidade no GoTrue não é acesso à plataforma (fail-closed)
JWT válido **sem** linha correspondente em `app_user` → **403**, sempre. O mesmo projeto Supabase
hospeda o Postgres e emite os tokens: se o signup público estiver ligado, qualquer pessoa na internet
obtém um token com `aud: 'authenticated'`. Desligar o signup é a primeira camada (passo humano); este
403 é a segunda, e é a única que vive no código.

### I3 — Usuário inativo não opera — em lugar nenhum
`ativo = false` ⇒ 403 em **toda** rota autenticada, incluindo leitura. Isto **endurece** o comportamento
atual, que já é parcialmente verdadeiro no caminho mais crítico: `UserRepository.getVinculoConexos`
filtra `AND ativo = true` (linha 163), ou seja, um inativo já não consegue operar o ERP em nome próprio.
A regra fecha a inconsistência de um inativo com token vivo ainda **lendo** a carteira financeira.

### I4 — O ator da trilha de auditoria é o `username`, nunca o UUID ⚠️ **a invariante de maior raio**
Toda coluna que registra **quem fez** — `executado_por` (`0015_permuta_alocacao_execucao`,
`0033_recebimento`, `0035_recebimento_execucao`, `0032_solicitacao_numerario`,
`0041_solicitacao_numerario_execucao`), `criado_por` (`permuta_alocacao`, `lote_pagamento`,
`cliente_filtro`) e `created_by` (`app_user`) — é `TEXT` e recebe hoje
`req.user?.sub ?? req.user?.email ?? 'unknown'`, isto é, **o e-mail**. Quando `sub` virar UUID, esse
`??` **não** protege nada: `sub` estará presente, só que como UUID.

Consequências verificadas no código, todas silenciosas (nenhum erro, nenhum log):
- `BorderoGestaoService.ts:340` — `criadoPor` do borderô, exibido em
  `frontend/app/permutas/BorderosPanel.tsx:460`, viraria um UUID cru na tela do analista;
- `BorderosPanel.tsx:166` monta o **dropdown "filtrar por usuário"** a partir desses valores — a mesma
  pessoa passaria a aparecer como duas entradas (o e-mail antigo e o UUID novo), e o filtro histórico
  deixaria de encontrar o trabalho dela;
- toda consulta de auditoria passaria a exigir um JOIN que hoje ninguém faz, com linhas pré e
  pós-cutover em formatos diferentes e **sem coluna que diga qual é qual**.

**Regra:** `req.user.username` (resolvido do banco por A2) é a **única** fonte do ator. Vale para os
~20 call sites de `req.user?.sub` em `routes/permutas.ts`, `routes/recebimentos.ts` (`ator`,
`triggeredBy`), `routes/sispag.ts:65`, `routes/usuarios.ts:29`, além dos dois que o plano já nomeia
(`http/conexosIdentity.ts:14`, `routes/me.ts:24`). O UUID `auth_user_id` é chave interna de junção e
**nunca** é persistido como ator nem exibido.

> **Nota de escopo para o TaskScoper:** o plano lista apenas `conexosIdentity.ts` e `me.ts`. A aplicação
> consistente de I4 amplia a superfície para ~20 sites. Mecanicamente é a mesma troca, mas precisa
> aparecer nas tasks — senão o cutover corrompe a trilha de auditoria de três frentes de forma
> irreversível (não há como saber, depois, qual UUID era qual pessoa se o usuário for renomeado ou
> recriado).

### I5 — `username` é imutável
Não existe operação de troca de e-mail, e não deve existir nesta feature. `username` é chave de junção
com `auth.users.email`, chave do vínculo Conexos e **valor histórico congelado** na trilha de auditoria
(I4). Trocá-lo renomearia retroativamente o autor de baixas já executadas no ERP — ou, pior, deixaria a
trilha apontando para uma pessoa que não existe mais. Se a necessidade surgir (mudança de domínio
corporativo), é uma feature própria, com migração explícita da trilha.

### I6 — Nunca hard-delete de `Usuario`
A saída de um usuário é `ativo = false`, jamais `DELETE`. A própria migration `0028` já registra o
motivo: *"desativa o acesso sem apagar a linha (soft-disable) … a trilha de auditoria (`executado_por`)
permanece íntegra"*. Como `executado_por` é `TEXT` (sem FK), apagar a linha não quebraria nada
*sintaticamente* — ela simplesmente deixaria de ser resolvível, e é exatamente por isso que a regra
precisa ser explícita na ontologia em vez de confiada ao banco.
**Corolário:** `SupabaseAdminClient.deleteUser` existe **apenas** como compensação transacional de A3
(rollback de criação, quando ainda não houve nenhuma ação atribuída) e **não** deve ser exposto em
nenhuma rota.

### I7 — Vínculo Conexos só de usuário ativo
Já implementado (`UserRepository.ts:163`). Elevado a invariante da ontologia por ser o ponto exato onde
"acesso revogado" vira "não movimenta dinheiro no ERP".

### I8 — Segredos não atravessam a fronteira do backend
`SUPABASE_SERVICE_ROLE_KEY` só no backend, **nunca** `NEXT_PUBLIC_*` (ela ignora RLS e pode criar
usuários); `conexos_password_enc` nunca sai em resposta de API (`AppUserPublic` já a omite — a interface
existe justamente para isso); `password_hash` idem. O `redactBody` (`http/redact.ts`) deve cobrir
`service_role`.

### I9 — Toda mudança de estado de `Usuario` é atribuída (gap atual)
Hoje só `cadastrarUsuario` registra o autor (`created_by`). `PATCH /:id/ativo`,
`POST /:id/reset-senha`, vincular e desvincular **não registram quem fez** — `routes/usuarios.ts:29`
computa `ator(req)` e o usa exclusivamente no `create`. Numa plataforma cujo princípio declarado é
*"toda ação de sistema e de usuário é auditada"* (`glossary.md` — Trilha de auditoria), a desativação de
um usuário e a redefinição da senha de terceiro são as ações **menos** auditadas do sistema. A ontologia
deve asseverar a regra; se a implementação completa não couber nesta feature, vira follow-up **nomeado**
(não silencioso).

### I10 — Revogação tem latência máxima declarada, não "imediata"
Com cache TTL em processo, `desativarUsuario` produz efeito em **≤ TTL** (~30 s), não instantaneamente.
Duas condições para que o número valha:
1. o cache é invalidado **sincronicamente** por `setAtivo` no processo que atende a request;
2. **a invalidação é local ao processo.** Hoje isso basta porque o backend roda em Render `plan: starter`
   (instância única, `render.yaml:10`). **No dia em que houver mais de uma instância, a invalidação
   deixa de cruzar processos e a latência real vira o TTL cheio, sem nenhum sinal.** Registrar como
   restrição explícita na ontologia — é o tipo de premissa que envelhece em silêncio.

Latência de ≤30 s é aceitável para "acesso revogado" **porque** a segunda barreira (banimento no GoTrue)
impede a renovação da sessão; o que a janela permite é terminar requests em voo, não iniciar uma sessão.

### I11 — `DEV_AUTH_BYPASS` nunca em ambiente deployado
Fail-fast já existe (`http/authEnv.ts:93-101`) e é deny-by-default — preservar. Ao ganhar um usuário
sintético (correção de passagem prevista no plano), esse usuário precisa de um `username` **inconfundível
e impossível de colidir com um real** (ex.: `dev-bypass@local`), justamente porque ele **vai vazar para
`executado_por`** por I4. Um bypass que grava um e-mail plausível é pior do que um que grava lixo óbvio.

### I12 — Deve existir sempre ao menos um `admin` ativo *(regra proposta — ver lacuna L2)*
Nada hoje impede um admin de se autodesativar ou de rebaixar o último admin, e o resultado é a perda de
acesso à gestão de usuários. O escape hatch atual (`seed-admin` com `upsertAdmin`) é uma ação de ops
manual — e o plano remove o default hardcoded `'columbia2026'`, o que é correto e **torna o escape hatch
mais caro**.

### I13 — O cutover não pode preceder a migração de todos os usuários
`AUTH_LEGACY_LOGIN_ENABLED=false` (Fase 3) enquanto existir `app_user` com `auth_user_id IS NULL`
**deixa esse usuário sem nenhum caminho de login** — o legado está desligado e ele não existe no GoTrue.
A transição de fase exige `listPendingMigration()` retornando vazio. Isto transforma o método que o
plano já prevê no repositório em um **gate operacional**, não num relatório.

---

## Eixo 4 — Integration

### Sistemas envolvidos

| Sistema | Papel nesta feature | Muda contrato? |
|---|---|---|
| **Supabase GoTrue** | **Novo integrante** — custódia de credencial, emissão/rotação de token, e-mail de recuperação | **Sim — integração nova.** Requer `ontology/integrations/supabase-auth.md` |
| **Supabase Postgres** | Já é o nosso banco (`app_user`) | Não. Nota: **é o mesmo projeto** que emite os tokens — é o que torna I2 necessário |
| **Conexos** | Consumidor a jusante da identidade (a baixa `fin010` sai no nome do humano) | **Não** — e preservar isso é o objetivo de I4 |
| **Nexxera / GED / SharePoint** | Não tocados | Não |

### A fronteira e a cadeia que não pode quebrar

```
GoTrue ──JWT ES256 (sub=uuid, aud=authenticated, iss)──► buildAuthMiddleware   [IDENTIDADE]
                                                              │
                                    app_user WHERE auth_user_id = sub AND ativo  [AUTORIZAÇÃO]
                                                              │  → username, role, appUserId
                                                              ▼
                        conexosIdentityMiddleware → ALS { platformUsername: username }
                                                              ▼
                        ConexosSessionResolver → getVinculoConexos(username) → sessão do ERP
                                                              ▼
                                        baixa fin010 assinada com o login do humano
```

**Modo de falha desta cadeia:** ela **não lança erro**. Se `platformUsername` deixar de casar com
`app_user.username`, `getVinculoConexos` retorna `null` e o sistema **degrada para o usuário-robô** — as
baixas continuam saindo, atribuídas à máquina. É a razão pela qual `GET /me/conexos-status` responder
`ok`/`ausente` como antes é o sinal de QA que importa, e por que a decisão de chavear o ALS por
`username` (e não por `sub`) é a de menor raio: `ConexosSessionResolver` e `getVinculoConexos` ficam
**literalmente intocados**.

### Contrato de token — o que exigir por caminho

O verificador alg-aware já existe (`http/auth.ts:140-175`). A regra: **`issuer` é exigido no caminho
JWKS/ES256 e NÃO no caminho HS256 legado.** Hoje `baseOptions` (linhas 133-136) carrega `issuer` e é
espalhado nos dois — no instante em que `SUPABASE_URL` for definido, o issuer passa a ser exigido também
do token legado, que **nunca teve claim `iss`** (`AuthService.ts` não chama `.setIssuer()`). Ligar o
Supabase derrubaria todas as sessões vivas **de uma vez**. Merece teste de regressão nomeado, não só um
cuidado no código.

`audience: 'authenticated'` continua exigido nos dois caminhos: as chaves anon/service usam outras
audiences e não podem passar por rota de usuário.

### Parâmetros novos (env — não SSM; não há Terraform hoje)

Backend (Render): `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`sync: false`),
`AUTH_LEGACY_LOGIN_ENABLED`.
Frontend (Vercel): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_AUTH_PROVIDER`.
**Achado pré-existente, não causado por esta feature:** `CONEXOS_CRED_ENC_KEY` **está ausente do
`render.yaml`** — sem ela, `SecretCipher` fica desabilitado, o vínculo Conexos por usuário não funciona
em produção e **tudo já cai no robô hoje**. Ou seja: I7 e boa parte da cadeia acima estão inertes em
produção neste momento. Provisionar junto.

### Variação por tenant

Nenhuma. Tenant único (Columbia), sem `infra/`. A costura multi-tenant do estado-alvo não é exercitada.

---

## Extracted rules (consolidado para o OntologyCurator)

| # | Regra | Destino sugerido |
|---|---|---|
| I1 | Autorização resolvida do banco a cada request; claim `role` do JWT descartada | `business-rules/autorizacao-resolvida-do-banco.md` + **amenda ADR-0011** |
| I2 | JWT válido sem linha em `app_user` → 403 (fail-closed) | idem I1 |
| I3 | Usuário inativo não opera — nem leitura | `entities/usuario.md` (ciclo de vida) |
| I4 | **Ator da auditoria é `username`, nunca o UUID** | `business-rules/ator-da-trilha-de-auditoria.md` |
| I5 | `username` é imutável | `entities/usuario.md` |
| I6 | Sem hard-delete; `deleteUser` só como compensação de A3 | `entities/usuario.md` |
| I7 | Vínculo Conexos só de usuário ativo | `entities/usuario.md` + `integrations/conexos.md` |
| I8 | Segredos não cruzam a fronteira do backend | `business-rules/` (ou amenda de ADR-0011 §2) |
| I9 | Toda mudança de estado de `Usuario` é atribuída *(gap parcial)* | `entities/usuario.md` + follow-up |
| I10 | Revogação com latência **declarada** (≤ TTL); invalidação process-local | `business-rules/revogacao-de-acesso.md` |
| I11 | `DEV_AUTH_BYPASS` nunca deployado; usuário sintético inconfundível | `entities/usuario.md` |
| I12 | Sempre ≥ 1 `admin` ativo *(proposta — L2)* | `entities/usuario.md` (se aprovada) |
| I13 | Cutover exige zero usuários pendentes de migração | ADR-0030 (estratégia de rollout) |
| A1–A9 | Nove ações nomeadas com pré/pós/idempotência (§ Eixo 2) | `actions/usuario/*.md` |

---

## entity_changed: **true**

## Ontology diff needed: **yes**

**Especificamente:**
- `ontology/entities/usuario.md` — **novo**. 10 propriedades + `passwordHash` marcada `deprecated`;
  ciclo de vida `pendente-migracao → ativo ⇄ inativo` (sem `excluido`).
- `ontology/state-machines/usuario.md` — **novo** (a 4ª do repo). Justificada: as transições têm regra
  explícita e consequência de segurança, e `pendente-migracao` é um estado com vigência datada.
- `ontology/actions/usuario/` — **novo diretório**: `cadastrar`, `ativar-desativar`,
  `redefinir-senha`, `vincular-conexos`, `migrar-para-supabase`, `resolver-contexto-usuario`.
- `ontology/business-rules/` — **novos**: `autorizacao-resolvida-do-banco.md`,
  `ator-da-trilha-de-auditoria.md`, `revogacao-de-acesso.md`.
- `ontology/integrations/supabase-auth.md` — **novo** (3ª integração).
- `ontology/relationships.md` — nova seção transversal: `Usuario 1—1 auth.users` (externo, via
  `auth_user_id`), `Usuario 0..1—1 CredencialConexos` (embutida), `Usuario 1—N` toda entidade com
  `executado_por`/`criado_por` **por valor (`username`), sem FK** — a relação é semântica, não
  referencial, e é precisamente por isso que I5 e I6 existem.
- `ontology/decisions/0030-supabase-auth-identity-provider.md` — **a última ADR é a `0029`**
  (`0029-processar-permuta-volta-para-baixa-fin010.md`). O plano diz `0028` e está **desatualizado**.
  A ADR **amenda a ADR-0011** (RBAC server-side), cujo texto assume `role` vindo do JWT.
- `ontology/_index.json` + `_coverage.json` — `entities_total` 16 → 17; `integrations` 2 → 3.
  (Nota: `_coverage.json` diz `entities_total: 16` enquanto `entities/` tem 17 arquivos — **drift
  pré-existente**, vale reconciliar de passagem.)
- `ontology/_inbox/migration-debt.md` — atualizar **O6** ("RBAC por perfil ainda ausente").
- `ontology/glossary.md` — `Usuario`, `Ator`, `Usuário-robô`, `Identidade × Autorização`.
- `ontology/_inbox/supabase-auth-regis-followups.md` — `app_user_filial` / `filialAuthz` fail-closed
  (`http/filialAuthz.ts:48` retorna `true` sem allow-list — **fail-OPEN**; a claim `filiais` nunca foi
  provisionada; Regis levanta desde 2026-06-22). Fora de escopo, mas esta feature o torna barato: com a
  autorização já vindo do banco, popular `filiais` vira um `JOIN`, sem depender de claim nenhuma.

## Reason: **new entity** (+ rule change em ADR-0011)

---

## Open questions

### P0 — bloqueantes
**Nenhuma.** Todas as decisões necessárias foram derivadas do plano aprovado ou do código verificado.

### P1 — não-bloqueantes (hipótese registrada; confirmar com Yuri antes do PR)

**L1 — `cadastrarUsuario`: admin define a senha, ou convite por e-mail?**
Tensão interna ao plano: o texto do route diz *"criar o usuário no Supabase"* (⇒ `createUser`, com
senha) mas o passo humano nº 4 pede template de **convite** em PT-BR, e `SupabaseAdminClient` lista
`inviteByEmail`.
*Hipótese adotada:* **admin define a senha inicial** (mantém o comportamento e o schema atuais, e é o
único que funciona **sem SMTP**, que é justamente o pré-requisito não atendido). `inviteByEmail` fica
implementado no client mas **não exposto** em rota; vira toggle trivial quando o SMTP existir. Se a
resposta for "convite", o estado `convidado` entra no ciclo de vida e o cadastro passa a depender de
SMTP — mudança de modelagem, não de código apenas.

**L2 — Existe regra de "último admin"? (I12)**
Um admin pode se autodesativar ou rebaixar o último admin, e ninguém mais gere usuários. Não há guarda
hoje.
*Hipótese adotada:* implementar a guarda **mínima e barata** — impedir que o ator desative **a si
mesmo** (403 com mensagem explícita). A guarda completa ("não pode restar zero admin ativo") exige
`COUNT` transacional e pode ficar como follow-up. Se Yuri considerar `seed-admin` escape hatch
suficiente, nenhuma guarda entra — mas note que o plano remove o default hardcoded `'columbia2026'`, o
que encarece esse hatch.

**L3 — Qual o TTL do cache de contexto e ele é configurável? (I10)**
*Hipótese adotada:* 30 s, **constante tipada com o número declarado na ontologia** (não env var — um
número de segurança que se muda por deploy é um número que se muda sem revisão). Documentar a restrição
de instância única do Render (`plan: starter`) como premissa datada, com a consequência explícita para
quando houver escala horizontal.

**L4 — `desativarUsuario` com falha no banimento do GoTrue: sucesso parcial ou erro?**
*Hipótese adotada (A4):* **sucesso parcial auditado** — o flag local já revoga o acesso via I3/I10, e
retornar erro levaria o admin a acreditar que não desativou ninguém, quando na prática desativou. A
resposta deve sinalizar a degradação para a UI.

**L5 — `role` default: `'admin'` (migration `0007`) × `'operador'` (`createUserSchema:27`).**
Drift pré-existente: o banco defaulta a `admin`, o boundary a `operador`. Com autorização vindo do banco
(I1), o default do banco passa a valer para qualquer linha criada fora do route (seed, INSERT manual,
job de migração).
*Hipótese adotada:* manter `'operador'` no boundary e **não** alterar o default do banco nesta feature
(mudá-lo é migration com efeito retroativo em nada, mas é ruído no cutover); registrar como follow-up
para alinhar em `0045`. **Verificar** que `migrarUsuarioParaSupabase` (A8) não cria linha nova — ele só
faz UPDATE do ponteiro, então não toca no default. Confirmado no desenho de A8.
