---
name: Usuario
type: entity
ontology_version: "0.16"
implementation_status: partial
status: draft
owners: [yuri]
related_files:
  - src/backend/migrations/0007_app_user.sql
  - src/backend/migrations/0028_app_user_gestao.sql
  - src/backend/migrations/0029_app_user_conexos_vinculo.sql
  - src/backend/migrations/0044_app_user_auth_link.sql
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/domain/service/auth/UserAdminService.ts
  - src/backend/domain/client/SupabaseAdminClient.ts
  - src/backend/http/auth.ts
  - src/backend/http/appUserContext.ts
  - src/backend/http/conexosIdentity.ts
  - src/backend/routes/usuarios.ts
properties:
  - id
  - username
  - authUserId
  - role
  - ativo
  - createdBy
  - createdAt
  - conexosUsername
  - conexosPasswordEnc
  - passwordHash
relationships:
  - "Usuario 1—1 auth.users (EXTERNO, GoTrue) — via authUserId; o custodiante da credencial, não a entidade"
  - "Usuario 0..1—1 CredencialConexos (embutida) — conexosUsername/conexosPasswordEnc; NULL = opera via robô"
  - "Usuario 1—N * (toda entidade com executado_por / criado_por / created_by) — POR VALOR (username), SEM FK"
last_review: 2026-08-06
universality_evidence:
  - "ontology/_inbox/supabase-auth-interview.md — Eixo 1 Q1/Q2: Usuario é a linha app_user; Sessao e Permissao rejeitadas com justificativa"
  - "Código em produção: app_user é quem assina a baixa fin010 no ERP (conexosIdentity → ConexosSessionResolver → getVinculoConexos)"
  - "21 call sites em 3 frentes gravam o ator em colunas de auditoria (executado_por / criado_por / created_by)"
  - "Conceito universal de financeiro: toda automação assistida com human-in-the-loop precisa nomear o humano que autorizou o movimento de dinheiro — é requisito de auditoria, não de produto"
---

# Usuario (entidade transversal — identidade e autoria)

> **`Usuario` é a linha `app_user`.** Não é o registro em `auth.users`. O registro no GoTrue é o
> **custodiante da credencial** (modelado em `integrations/supabase-auth.md`), não a entidade de
> domínio. Esta escolha não é formalismo: é o que torna o **403 fail-closed** uma *consequência
> lógica* em vez de uma regra arbitrária — **existir no GoTrue não é existir na plataforma**.
> Ver ADR-0030.

## Definição de domínio

O `Usuario` é o **ator** da plataforma: quem monta o borderô, quem dispara a baixa `fin010` no ERP em
nome próprio, quem aprova o recebimento e quem a trilha de auditoria atribui. É a **primeira entidade
transversal** da ontologia — não pertence a uma frente, atravessa as quatro.

A separação central que esta entidade materializa:

| Camada | Quem responde | Onde vive |
|--------|---------------|-----------|
| **Identidade** (*quem é*) | Supabase GoTrue — JWT ES256 verificado por JWKS, `sub` = UUID | externo |
| **Autorização** (*o que pode*) | `app_user` — `role`, `ativo`, resolvidos do banco **a cada request** | nosso |
| **Nome** (*como se chama na trilha*) | `app_user.username` (o e-mail) | nosso |

## Propriedades

| Propriedade | Coluna | Mutabilidade | Nota de domínio |
|---|---|---|---|
| `id` | `app_user.id` (SERIAL) | **imutável** | Surrogate interno. Nunca sai para o ERP nem para a trilha de auditoria. |
| `username` | `app_user.username` (TEXT UNIQUE) | **IMUTÁVEL — I-Usuario-2** | O e-mail, minúsculo. É simultaneamente: (a) chave 1:1 com `auth.users.email`, (b) **o identificador do ator na trilha de auditoria** (I-Usuario-1), (c) a chave do vínculo Conexos (`getVinculoConexos(username)`). Mudá-lo quebra as três coisas de uma vez. |
| `authUserId` | `app_user.auth_user_id` (UUID) | **imutável uma vez setado**; `NULL` = pendente de migração | Ponteiro para `auth.users.id`. É o `sub` do JWT. **Nunca** é exibido nem persistido como ator (I-Usuario-1). Chave interna de junção. |
| `role` | `app_user.role` | mutável | `'admin' \| 'operador'`. **Default `'operador'` — least privilege.** **Autoritativo sobre a claim `role` do JWT**, que é sempre `'authenticated'` e é descartada (ver `business-rules/autorizacao-resolvida-do-banco.md`). |
| `ativo` | `app_user.ativo` | mutável | O interruptor do ciclo de vida. `false` ⇒ 403 em toda rota autenticada (I-Usuario-4). |
| `createdBy` | `app_user.created_by` | **imutável (histórico)** | `username` do admin que cadastrou/convidou. |
| `createdAt` | `app_user.created_at` | **imutável (histórico)** | — |
| `conexosUsername` | `app_user.conexos_username` | mutável (vincular/desvincular) | Login no ERP (ex.: `MARILYN_MUTAFCI`). `NULL` ⇒ opera via **usuário-robô**. |
| `conexosPasswordEnc` | `app_user.conexos_password_enc` | mutável | Segredo **reversível** (AES-256-GCM), nunca hash, **nunca sai do backend**. |
| ~~`passwordHash`~~ | `app_user.password_hash` | **transitória — `deprecated`** | `deprecated: true`, `drop_after: cutover-fase-4`. Deixa de ser propriedade de domínio no cutover: a custódia da credencial migra para o GoTrue. Sobrevive só como **fonte do import bcrypt** (Fase 1). Listada aqui para que a ontologia **não a legitime**. |

### Nota sobre o default de `role` (alinhamento pendente)

O boundary (`UserAdminService`) já defaulta a `'operador'`; o **banco** (`migrations/0007_app_user.sql`)
ainda defaulta a `'admin'`. O drift era inócuo enquanto a autorização vinha do JWT — **deixa de ser**
agora que ela vem do banco (I-Usuario-9): qualquer linha criada **fora do route** (seed, INSERT manual,
job) nasceria `admin`. A ontologia fixa **`'operador'` (least privilege)** como o default correto; o
alinhamento do banco é a migration `0045` (task para o TaskScoper). O job de migração (`A8`) **não**
cria linhas — só faz UPDATE do ponteiro —, então não é afetado.

## Ciclo de vida

`convidado → ativo ⇄ inativo`. Ver `state-machines/usuario.md`.

**Não existe transição para `excluido`** — hard delete é proibido (I-Usuario-3).

### Condição ortogonal: `pendenteMigracao` (transitória, datada)

`pendenteMigracao` **não é um estado do ciclo de vida** — é uma **condição derivada** de
`authUserId IS NULL`, **ortogonal** a `ativo`/`inativo`.

Modelá-la como estado afirmaria algo falso sobre a produção de hoje: **todo `app_user` atual é
`ativo = true` E `auth_user_id IS NULL` ao mesmo tempo** (eles logam pelo caminho legado HS256 agora).
E criaria a combinação `inativo + pendente`, inalcançável no diagrama mas alcançável de verdade.

- **Vigência: 2026-08-06 → Fase 4 do cutover.** Some quando `password_hash` e o HS256 forem removidos.
- **Consequência comportamental:** enquanto `AUTH_LEGACY_LOGIN_ENABLED=true`, o usuário pendente só
  autentica pelo caminho legado; se a flag for desligada **antes** de sua migração, ele fica **sem
  nenhum caminho de login**. O gate operacional que impede isso (`listPendingMigration()` vazio) vive
  na **ADR-0030 §6** — é regra de rollout, volátil por desenho, e não pertence à ontologia durável.

## Invariantes

### I-Usuario-1 — A identidade de auditoria é o e-mail, nunca o `sub` do provedor
O ator persistido é **sempre `app_user.username`**; **nunca** o `sub` do provedor de identidade.
É o que mantém a trilha **contínua através de qualquer troca de IdP** — inclusive o SSO corporativo
futuro, que emitirá outro `sub`. **21 call sites.** Ver `business-rules/ator-da-trilha-de-auditoria.md`.

### I-Usuario-2 — `username` é imutável
Não existe operação de troca de e-mail. `username` é chave de junção com `auth.users.email`, chave do
vínculo Conexos e **valor histórico congelado** na trilha. Trocá-lo renomearia retroativamente o autor
de baixas já executadas no ERP — ou deixaria a trilha apontando para alguém que não existe mais. Se a
necessidade surgir (mudança de domínio corporativo), é feature própria, com migração explícita da trilha.

### I-Usuario-3 — Nunca hard-delete
A saída de um usuário é `ativo = false`, jamais `DELETE`. A migration `0028` já registra o motivo:
*"desativa o acesso sem apagar a linha (soft-disable) … a trilha de auditoria (`executado_por`)
permanece íntegra"*. Como as colunas de auditoria são `TEXT` **sem FK**, apagar a linha não quebraria
nada *sintaticamente* — ela apenas deixaria de ser **resolvível**. É exatamente por isso que a regra
precisa ser explícita na ontologia em vez de confiada ao banco.
**Corolário:** `SupabaseAdminClient.deleteUser` existe **apenas** como compensação transacional do
cadastro (rollback, quando ainda não houve nenhuma ação atribuída) e **não** é exposto em rota.

### I-Usuario-4 — Usuário inativo não opera — em lugar nenhum
`ativo = false` ⇒ **403** em toda rota autenticada, **incluindo leitura**. Isto **endurece** o
comportamento atual, que já é parcialmente verdadeiro no caminho mais crítico (`getVinculoConexos`
filtra `AND ativo = true`): fecha a inconsistência de um inativo com token vivo ainda **lendo** a
carteira financeira.

### I-Usuario-5 — Vínculo Conexos só de usuário ativo
Já implementado (`UserRepository.ts:163`). Elevado a invariante por ser o ponto exato onde "acesso
revogado" vira "não movimenta dinheiro no ERP". O vínculo é **preservado** (colunas não são limpas)
durante a desativação — fica **inerte, não perdido**; reativar não exige redigitar a senha do ERP.

> ⚠️ **I-Usuario-5 está INERTE em produção neste momento (2026-08-06).**
> `CONEXOS_CRED_ENC_KEY` **está ausente do `render.yaml`** ⇒ `SecretCipher` desabilitado ⇒ o vínculo
> Conexos por usuário **não funciona em produção** e **tudo já cai no usuário-robô hoje**. A ontologia
> assevera uma invariante que o ambiente atual **não exerce**. Isto é registrado explicitamente, e não
> deixado implícito, porque uma invariante inerte parece cumprida. Gap **pré-existente**, não causado
> por esta feature; provisionar junto (ver `_inbox/supabase-auth-regis-followups.md`).

### I-Usuario-6 — Um admin não pode desativar a si mesmo
Autodesativação ⇒ **403** com mensagem explícita. Desativar **outro** admin **é permitido**. É a guarda
mínima e barata contra a perda de acesso à gestão de usuários; a guarda completa ("não pode restar zero
admin ativo", que exige `COUNT` transacional) fica em `_watchlist.md`.

### I-Usuario-7 — Toda mudança de estado de `Usuario` é atribuída
Quem desativou, quem redefiniu a senha de terceiro, quem vinculou/desvinculou o Conexos: registrado.
**Gap declarado (2026-08-06):** hoje só o cadastro grava o autor (`created_by`); `PATCH /:id/ativo`,
`POST /:id/reset-senha`, vincular e desvincular **não registram quem fez**. Numa plataforma cujo
princípio declarado é *"toda ação de sistema e de usuário é auditada"*, a desativação de um usuário e a
redefinição da senha de terceiro são hoje as ações **menos** auditadas do sistema. A ontologia assevera
a regra; o fechamento é follow-up **nomeado**, não silencioso.

## Regras de negócio relacionadas

| Regra | Invariante | O que fixa |
|---|---|---|
| `business-rules/autorizacao-resolvida-do-banco.md` | I-Usuario-9 | O token prova identidade; `role`/`ativo` vêm do banco a cada request; 403 fail-closed |
| `business-rules/ator-da-trilha-de-auditoria.md` | I-Usuario-1 | O ator é o `username`, nunca o UUID — 21 call sites |
| `business-rules/revogacao-de-acesso.md` | I-Usuario-8 | Revogação com latência **declarada** (≤30 s), não "imediata" |

## Ações

`actions/usuario/` — `convidarUsuario`, `cadastrarUsuarioComSenha`, `resolverContextoUsuario`,
`ativarUsuario` / `desativarUsuario`, `solicitarRedefinicaoSenha` / `redefinirSenhaDeTerceiro`,
`vincularConexos`, `migrarUsuarioParaSupabase`.

## Entidades deliberadamente NÃO criadas

- **`Sessao`** — depois desta feature a sessão (access token curto, refresh rotativo, revogação) é
  **inteiramente propriedade do GoTrue**: zero linhas no nosso banco, zero invariantes que possamos
  enforcar, nenhuma ação de domínio que a manipule. O que é de domínio virou
  `business-rules/revogacao-de-acesso.md`.
- **`Permissao`** — `role` é atributo **enumerado** de dois valores, sem ciclo de vida próprio. A
  dimensão que *seria* entidade/relação (`Usuario N—M Filial`) está **fora de escopo**. Criá-la agora
  seria modelar o vazio. Em `_watchlist.md`.
