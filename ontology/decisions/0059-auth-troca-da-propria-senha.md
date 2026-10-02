---
adr_number: 0059
title: Troca da própria senha (`/me/senha`) — verificação por modo, escrita R6 e revogação pelo `alg` do token
date: 2026-10-02
status: accepted
type: change
related_entities: []
related_actions: []
related_integrations: [supabase-auth]
continues: [0051, 0053, 0057]
evidence:
  - src/backend/routes/me.ts
  - src/backend/domain/service/auth/OwnPasswordService.ts
  - src/backend/domain/service/auth/PasswordPolicy.ts
  - src/backend/domain/service/auth/CredentialMirror.ts
  - src/backend/domain/client/SupabaseAuthClient.ts
  - src/backend/domain/repository/auth/UserRepository.ts
  - src/backend/http/rateLimit.ts
  - src/backend/http/redact.ts
  - src/backend/jobs/probe-gotrue-local.ts
  - src/backend/migrations/0073_app_user_access_event_tipo_senha.sql
---

# ADR-0059 — Troca da própria senha

## Contexto

Até a v0.49 a única forma de trocar senha era o reset do admin (`POST /usuarios/:id/reset-senha`,
permissão `usuarios:gerenciar`). Não há SMTP, então não existe "esqueci a senha". O front do perfil
(PR #101) precisa de uma rota de autoatendimento: o usuário autenticado e ativo troca a própria senha
provando a atual. Continua a ADR-0051 (identidade = username), a ADR-0053 (trilha de acesso) e a
ADR-0057 (Supabase Auth por proxy; R6/R7/D3).

Feature `auth-senha-propria`, `entity_changed = false`: `app_user` e a trilha são infraestrutura de
autenticação, fora da ontologia de domínio.

## Decisão

### Contrato (servido ao front do PR #101)

- `GET /me/senha/politica` → `200 { minimo: 8, maximo: 72, regras: [] }`. `regras` sai vazio: tamanho
  vem de `minimo`/`maximo` e "diferente da atual" o front desenha sozinho.
- `POST /me/senha` `{ senhaAtual, novaSenha }`, Zod `.strict()`, ambos string não vazia. Guard
  `somenteAutenticado()`, sem permissão de módulo. Identidade = `req.user.sub` (username do banco, I2).

| Status | Corpo | Quando |
|---|---|---|
| 204 | — | trocou |
| 400 | `{ codigo: 'POLITICA', regras, error }` | política violada, antes de qualquer bcrypt ou GoTrue |
| 400 | `{ error, details }` (sem `codigo`) | corpo malformado ou campo extra |
| 422 | `{ codigo: 'SENHA_ATUAL_INVALIDA', error }` | senha atual não confere — **nunca 401** (401 é "sessão expirada" no front) |
| 429 | `{ codigo: 'MUITAS_TENTATIVAS', error }` | limitador por usuário, ou GoTrue 429 na sonda (como o D5 do login) |
| 503 | `{ codigo: 'AUTH_INDISPONIVEL', error: 'Serviço de autenticação indisponível; nada foi alterado.' }` | GoTrue fora/5xx/timeout na sonda ou na escrita; nunca desloga |

`error` sempre em português; o front lê só `codigo`.

### Política

8 **caracteres** a 72 **bytes** UTF-8 (`Buffer.byteLength`; o bcrypt ignora o que passa de 72 bytes e
o GoTrue recusa), e a nova diferente da atual (`diferente_da_atual`). Nenhuma regra de composição. O
front mede caracteres: uma senha não-ASCII entre 72 caracteres e 72 bytes passa no checklist e volta
400 `POLITICA` com `tamanho` — aceito.

### Verificação da senha atual, por `AUTH_PROVIDER`

- `local`: `bcrypt.compare` contra `app_user.password_hash`.
- `supabase`: password grant com o **e-mail** do `app_user` (a "sonda"), seguido de `logout
  scope=local` da sessão-sonda, best-effort (falha vira aviso, não muda a resposta), antes da
  transação. Sem `auth_user_id` ou sem e-mail: bcrypt local (D3). Recusa do GoTrue = senha atual
  inválida; indisponibilidade sobe como 503 (429 se `rateLimited`).

### Escrita (R6/R7 inalteradas)

`bcrypt.hash(nova, 12)`; `UserRepository.updatePassword` agora abre **sempre** transação com a linha
travada (`FOR UPDATE`), com ou sem espelho — o reset do admin também ganha isso. Na mesma transação:
`UPDATE password_hash` → evento `app_user_access_event` (`tipo='senha'`, `ator` = o próprio username,
`alvo_user_id` = si, `antes`/`depois` NULL) → passo do espelho → COMMIT. Falha do GoTrue = ROLLBACK +
503. GoTrue mudou e o COMMIT falhou = `AUTH_DIVERGENCIA` (`CredentialMirror.aposFalha`). Uma linha
`LogService.info` em português, `'senha alterada pelo próprio usuário'`, com `usuario`, `modo` e
`revogacao`, sem senha, hash ou token. Não invalida o cache de acesso.

### Revogação das outras sessões, decidida pelo `alg` do Bearer (não por `AUTH_PROVIDER`)

O `resolverAcesso` descarta o emissor do token; a rota relê o `alg` do cabeçalho do Bearer
(`decodeProtectedHeader`, sem reverificar — o `auth` já verificou).

**Probe Q1 (GoTrue v2.197.0 local, `jobs/probe-gotrue-local.ts --q1`, 2026-10-02):**
`PUT /admin/users/:id { password }` revoga **todas** as sessões do usuário; `PUT /user { password }`
com o token da sessão A mantém A e revoga as outras; `POST /logout?scope=others` faz o mesmo; com
"Secure password change" OFF, `PUT /user` não pede `nonce`. **RAMO = put-user.**

- Token do GoTrue (ES256) com vínculo → o passo do espelho é `PUT /user` com o token do chamador. A
  sessão atual continua; as outras perdem o refresh. Sem `logout scope=others` depois.
  `revogacao: 'gotrue-put-user'`.
- Token HS256 (do app) com vínculo → `adminUpdateUser`, como o reset do admin (revoga as sessões do
  GoTrue desse usuário, que um chamador HS256 não está usando). `revogacao: 'pulada-hs256'`.
- Sem vínculo ou sem API admin → só local. `revogacao: 'sem-vinculo'`.
- Recusa do GoTrue no `PUT /user` (ex.: o token do chamador pertence a uma sessão já revogada por uma
  troca anterior, mas ainda dentro do `exp`) → ROLLBACK e 503 `AUTH_INDISPONIVEL`, nunca 500.

**Modo `local` (HS256 sem estado):** não existe sessão para revogar. Os outros tokens HS256 do usuário
continuam válidos até o `exp` (medido no roteiro de QA: um segundo token emitido antes da troca segue
respondendo 200). É o mesmo trade-off do logout em modo `local`.

### Limite por usuário

Chave `senha:${req.user.sub}`, **5 falhas em 15 min**, só o 422 conta (204, 400, 429 e 503 não), montado
depois da validação do corpo. `handler` próprio com o corpo `MUITAS_TENTATIVAS`. Store em memória (uma
instância no Render; reiniciar zera, mesmo trade-off do login). O `globalLimiter` continua valendo.
Cobre também o consumo do balde de sign-in do GoTrue pela sonda (o mesmo IP do Render que o login usa).

### Redação de log

`senhaAtual` e `novaSenha` entram na lista exata de `http/redact.ts` (o casamento é por chave inteira:
`senha` não as cobria).

### Migration 0073, sem reverse

`DROP CONSTRAINT IF EXISTS app_user_access_event_tipo_check` + `ADD CONSTRAINT … CHECK (tipo IN
('papel','excecao','ativo','senha'))`, no padrão da 0069. Aditiva, idempotente, segura para o backend
antigo. **Sem reverse:** estreitar a CHECK falharia com uma linha `senha` presente, e apagar linhas da
trilha append-only não se faz. A 0072 e a ADR-0058 são do PR #101; as duas migrations são independentes,
então a ordem de aplicação não importa.

## Fora de escopo (follow-ups)

- Senha temporária / troca forçada após o reset do admin.
- Esqueci-a-senha (depende de SMTP).
- "Require reauthentication" do Supabase: fica **OFF** (ligado, o `PUT /user` exige `nonce` por e-mail).
- Máximo de 72 bytes no create e no reset do admin (hoje uma senha > 72 bytes pelo admin vira erro do
  GoTrue no espelho).
- Evento de auditoria no reset do admin (exige o `ator` na assinatura de `resetPassword`).

## Consequências

- O reset do admin passa a rodar em transação com lock também sem espelho (sem mudança observável).
- O comportamento de sessões foi medido na v2.197 local; a versão do projeto de produção pode diferir.
  A prova lá é o passo 4 do roteiro repetido com usuário descartável, como verificação pós-deploy.
