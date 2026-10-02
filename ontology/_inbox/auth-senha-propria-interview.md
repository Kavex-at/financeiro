# OfficeHours — Auth: troca da própria senha (`/me/senha`)

> Modo: `tweak`. Conduzida em 2026-10-02. Slug: `auth-senha-propria`.
> Decisões do dono do ciclo recebidas via orquestrador (sem conversa direta). Contrato fechado com a
> sessão do front (PR #101, `feat/perfil-usuario`, não mergeado; reserva migration 0072 e ADR-0058).
> Este tweak usa **migration 0073** e **ADR-0059**. Continua as ADRs 0051, 0053 e 0057.

## Estado atual verificado (código, `main` v0.49.0)

| Ponto | Onde | Observação |
|---|---|---|
| Único caminho de troca de senha | `routes/usuarios.ts` `POST /usuarios/:id/reset-senha` → `UserAdminService.resetPassword` | admin com `usuarios:gerenciar`; sem esqueci-a-senha (sem SMTP) |
| Mínimo de senha | `UserAdminService.ts:83,166` | `z.string().min(8)` no create e no reset: **8 caracteres** (UTF-16), **sem máximo** |
| Escrita R6 | `resetPassword` → `CredentialMirror.preparar({tipo:'senha'})` → `UserRepository.updatePassword(id, hash, antesDoCommit)` | com espelho: `withTransaction` → `lerCredencial(tx, id, lock=true)` → `UPDATE password_hash` → `adminUpdateUser { password }` em claro → COMMIT. **Sem espelho** (sem `auth_user_id` ou sem chave admin): `UPDATE` solto, **sem transação nem lock** |
| bcrypt | `UserAdminService.ts:36` | `bcryptjs`, custo 12 |
| Trilha de acesso | migration 0066; `AccessRepository.recordEvent(tx, event)` | `tipo TEXT NOT NULL CHECK (tipo IN ('papel','excecao','ativo'))` inline (nome automático `app_user_access_event_tipo_check`); só INSERT, sempre na transação da escrita. O reset do admin **não** grava evento hoje |
| Rotas `/me` | `routes/me.ts`, montado em `buildApp.ts:180` após `auth` → `resolverAcesso` | guard `somenteAutenticado()`; `req.user.sub` = username do banco |
| `req.user` após `resolverAcesso` | `http/acesso.ts:196` | reescrito para `{ sub, authUserId?, filiais? }`: **o `emissor` do token é descartado** |
| GoTrue | `domain/client/SupabaseAuthClient.ts` | `signInWithPassword` existe (400 `invalid_credentials` → `SupabaseAuthRejectedError`; 429 e 5xx/timeout → `SupabaseAuthUnavailableError`, com `rateLimited`); `logout(accessToken)` com **`scope=local` fixo** (linha 134) |
| Limitadores | `http/rateLimit.ts` | `sessionLimiter` com `keyGenerator`, `skipSuccessfulRequests` + `requestWasSuccessful` (conta só o status de falha), `store` injetável; corpo do 429 = `{ error: MENSAGEM_MUITAS_TENTATIVAS }` |
| Redação de log | `http/redact.ts` | casamento **exato** de chave, case-insensitive: `password`, `senha`, `token`… `senhaAtual` e `novaSenha` **não** casam |
| Formato de erro | `http/validate.ts`, rotas | `{ error: string }` (Zod: `{ error, details }`) |
| Front (PR #101) | `lib/perfil/senha.ts`, `lib/api/perfil.ts` | aceita 200 **ou** 204 como sucesso; lê `codigo` em 400/422; 429 por status; 5xx = "não foi possível verificar"; tamanho medido em `n.length` (caracteres) |

## Delta (comportamento desejado)

O usuário autenticado e ativo troca a própria senha em `/perfil`, provando a senha atual. Sem
permissão de módulo. Contrato aprovado (não redesenhar):

- `GET /me/senha/politica` → 200 `{ minimo: 8, maximo: 72, regras: [{ id, rotulo, padrao? }] }`.
- `POST /me/senha` `{ senhaAtual, novaSenha }` (Zod `.strict()`):
  204 sucesso · 400 `{ codigo: 'POLITICA', regras }` (antes de verificar a atual; inclui
  `diferente_da_atual`) · 422 `{ codigo: 'SENHA_ATUAL_INVALIDA' }` (**nunca 401**) · 429
  `{ codigo: 'MUITAS_TENTATIVAS' }` · 503 `{ codigo: 'AUTH_INDISPONIVEL' }` (nunca desloga).
- Verificação real da senha atual nos dois modos: `local` = bcrypt vs `app_user.password_hash`;
  `supabase` = password grant com o e-mail do usuário + logout `scope=local` da sessão-sonda.
- Escrita R6 (ADR-0057), reaproveitando `CredentialMirror` `{tipo:'senha'}`; sem `auth_user_id` → só
  local (D3).
- Após o COMMIT, modo `supabase`: revogar as **outras** sessões (logout `scope=others` com o token do
  chamador); modo `local`: HS256 sem estado, os outros tokens vivem até o `exp` (documentar).
- Auditoria: `app_user_access_event` `tipo='senha'`, `ator` = próprio username, `alvo_user_id` = si,
  `antes`/`depois` NULL, **na mesma transação** da escrita; + uma linha PT no `LogService` sem segredo.
- Fora de escopo: `senha_temporaria`/troca forçada após reset, esqueci-a-senha/SMTP, "require
  reauthentication" do Supabase (fica OFF).

## Regra ou implementação?

**Nova capacidade** sobre infraestrutura de acesso (fora da ontologia de domínio), sem mudar regra
de negócio. Reaproveita R6/R7/D3 da ADR-0057 tal como estão; a ADR-0059 registra o contrato, a
política de senha e o uso de `scope=others`.

## Invariantes tocadas

- **R6 (ADR-0057):** local e GoTrue nunca divergem — falha do GoTrue = ROLLBACK + 503. Mantida.
- **R7:** bcrypt local sempre gravado (rollback para `local` segue funcionando). Mantida.
- **I2 (ADR-0057):** identidade = username do banco; o JWT sozinho não autoriza trocar a senha.
- **Trilha append-only (0066):** ganha o tipo `senha`; migration 0073 aditiva (DROP/ADD da CHECK com a
  lista ampliada, padrão da 0069), segura para o backend antigo (crons aplicam antes do deploy).
- **Sem segredo em log:** redação passa a cobrir `senhaAtual`/`novaSenha`.
- **401 = sessão expirada no front:** nenhum caminho desta rota responde 401 por senha errada.

## Casos canônicos de teste

1. Senha atual certa, nova válida → 204; `password_hash` novo (bcrypt 12); GoTrue `PUT /admin/users/:id { password }`; 1 evento `tipo='senha'` NULL/NULL; login com a nova entra, com a antiga não.
2. `novaSenha === senhaAtual` → 400 `POLITICA` com `diferente_da_atual`; **nenhuma** chamada ao GoTrue nem bcrypt.compare.
3. Nova com 7 caracteres, ou com mais de 72 **bytes** UTF-8 (ex.: 40 × `ç` = 80 bytes) → 400 `POLITICA` com `tamanho`.
4. Senha atual errada → 422 `SENHA_ATUAL_INVALIDA`; nada gravado; 5ª falha em 15 min → a 6ª tentativa dá 429 mesmo com a senha certa.
5. GoTrue fora (5xx/timeout) na sonda **ou** no update → 503 `AUTH_INDISPONIVEL`; `password_hash` inalterado (ROLLBACK); sem evento.
6. Usuário sem `auth_user_id` (modo `local`) → 204, só local, sem chamada admin.
7. Corpo com campo extra ou faltando → 400 do `validate` (sem `codigo`), sem tocar o limitador por usuário.
8. Log de request com o corpo → `senhaAtual`/`novaSenha` aparecem `[REDACTED]`.
9. Duas sessões Supabase do mesmo usuário; troca pela sessão A → refresh de A continua funcionando, refresh de B → 400. *(Depende de Q1.)*

## entity_changed: false

Nenhuma entidade, propriedade ou ação do domínio financeiro muda. `app_user`/trilha de acesso são
infraestrutura de autenticação, tratadas por ADR (mesma decisão dos passos 1–3). A única mudança de
esquema é ampliar a CHECK de `app_user_access_event.tipo`.

### Ontology diff needed: no (ADR-0059 sim)
### Reason: new property (capacidade de autoatendimento sobre infra de acesso)

## Conflitos entre o contrato e o código

1. **`logout` tem `scope=local` fixo** (`SupabaseAuthClient.ts:134`): precisa de parâmetro `scope: 'local' | 'others'` (default `local`, sem quebrar o logout atual).
2. **O `emissor` some no `resolverAcesso`**: a rota não sabe se o token do chamador é do GoTrue. `scope=others` com um token HS256 falha. Default: decidir pelo **`alg` do Bearer** (re-extraído do header) e não por `AUTH_PROVIDER`; HS256 → pula a revogação e loga.
3. **Escrita sem espelho não tem transação nem lock** (`UserRepository.updatePassword`): o evento de auditoria precisa da mesma transação; o caminho local passa a usar `withTransaction` + `lerCredencial(lock)` sempre (também melhora o reset do admin).
4. **Redação não cobre `senhaAtual`/`novaSenha`** (casamento exato de chave): acrescentar `senhaatual` e `novasenha` à lista.
5. **Máximo 72 é em bytes, o front mede caracteres** (`n.length`) e o admin não tem máximo. O servidor valida bytes (`Buffer.byteLength`); o `padrao` de `tamanho` só aproxima por caracteres. Senha não-ASCII entre 72 caracteres e 72 bytes passa no checklist e volta 400 `POLITICA` — aceitável. Máximo no create/reset do admin fica como follow-up (hoje uma senha > 72 bytes vira erro do GoTrue no espelho).
6. **Corpo de erro:** o resto do backend usa `{ error }`. Responder **`{ codigo, error }`** (mensagem PT) em 400/422/429/503; o front lê `codigo` e ignora `error`. O 429 do limitador por usuário precisa de `handler` próprio (o atual responde só `{ error }`); o 429 do GoTrue na sonda (`rateLimited`) também vira 429 `MUITAS_TENTATIVAS`, como no login (D5), e não 503.
7. **A sonda gasta o balde do GoTrue por IP** (todo tráfego sai do IP do Render, como o login). Coberto pelo limite por usuário (5/15 min) somado ao `globalLimiter`; sem ação além de registrar.

## Open questions

### P0 (bloqueante; há default)

- **Q1 — O `PUT /admin/users/:id { password }` revoga TODAS as sessões do usuário?** O T-1
  (2026-09-30, GoTrue v2.197) provou que a senha troca (3b), mas não olhou as sessões. No código do
  GoTrue, o update de senha pela API admin chama `UpdatePassword(tx, nil)`, que com `sessionID` nulo
  faz `Logout` de todas as sessões (lembrança de leitura do fonte, **não verificada nesta versão**).
  Se for assim, a sessão atual perde o refresh e o usuário cai no modal de re-login em até 1 h,
  contrariando "a sessão atual continua válida", e o `scope=others` posterior vira redundante (ou
  falha, com a sessão já apagada).
  **Default:** a primeira tarefa repete a sonda local (`jobs/probe-gotrue-local.ts`, v2.197) com
  duas sessões e mede o refresh das duas após o update admin. Se o admin revogar tudo, trocar o
  passo do GoTrue dentro da transação por `PUT /user { password }` com o **access token do
  chamador** (o GoTrue faz `LogoutAllExceptMe`: mantém a atual, revoga as outras, e dispensa o
  `scope=others`), com "require reauthentication" OFF; se o chamador tiver token HS256, manter o
  update admin. O contrato com o front não muda (204).

### P1

- Nenhuma.

## Resultado do probe Q1

Rodado em 2026-10-02 com `jobs/probe-gotrue-local.ts --q1` contra `npx supabase@2.118.0 start`
(pasta temporária fora do repositório; `enable_signup = false`, `enable_anonymous_sign_ins = false`,
`[auth.email] secure_password_change = false`, `jwt_expiry = 3600`). CLI do sistema não atualizada;
nenhuma pasta `supabase/` no repositório. **GoTrue `v2.197.0`** (`GET /auth/v1/health`), a mesma do T-1.
Cada cenário usa um usuário descartável próprio, apagado no `finally` (`DELETE /admin/users/<id>` → 200
nos três).

```
[Q1] GoTrue local: v2.197.0 (http://127.0.0.1:54321)
[Q1] A PUT /admin/users/:id { password } → 200
[Q1] A refresh da sessão A → status=400 error_code=refresh_token_not_found msg=Invalid Refresh Token: Refresh Token Not Found
[Q1] A refresh da sessão B → status=400 error_code=refresh_token_not_found msg=Invalid Refresh Token: Refresh Token Not Found
[Q1] A login com a senha antiga → 400
[Q1] A login com a senha nova → 200
[Q1] D PUT /user { password } (token de A) → status=200 chaves: app_metadata,aud,confirmed_at,created_at,email,email_confirmed_at,id,identities,is_anonymous,last_sign_in_at,phone,role,updated_at,user_metadata
[Q1] B refresh da sessão A → 200 ok
[Q1] B refresh da sessão B → status=400 error_code=refresh_token_not_found msg=Invalid Refresh Token: Refresh Token Not Found
[Q1] B login com a senha antiga → 400
[Q1] B login com a senha nova → 200
[Q1] C POST /logout?scope=others (token de A) → 204
[Q1] C refresh da sessão A → 200 ok
[Q1] C refresh da sessão B → status=400 error_code=refresh_token_not_found msg=Invalid Refresh Token: Refresh Token Not Found
```

- **Cenário A (update admin):** a senha troca, e **as duas sessões perdem o refresh**. A leitura do fonte
  estava certa: `PUT /admin/users/:id { password }` revoga TODAS as sessões do usuário.
- **Cenário B (`PUT /user` com o token de A):** a senha troca; A continua renovando, B perde o refresh
  (`LogoutAllExceptMe`). É exatamente "a sessão atual continua, as outras caem".
- **Cenário C (`logout?scope=others`):** 204; A continua, B cai. Funciona, mas não é necessário no ramo
  escolhido.
- **Cenário D:** com `secure_password_change = false`, o `PUT /user { password }` respondeu **200** com o
  usuário (sem `nonce`, sem pedido de reautenticação).

Consequências para o desenho: no modo `supabase` com token do GoTrue, o passo de escrita é `PUT /user`
com o token do chamador (sem `scope=others` depois). Caller HS256 com vínculo continua no
`adminUpdateUser`, que derruba todas as sessões do GoTrue desse usuário; como um caller HS256 não está
usando sessão do GoTrue, nada visível muda para ele. O reset do admin (`/usuarios/:id/reset-senha`)
também derruba todas as sessões GoTrue do alvo, o que é o comportamento desejável para um reset.

RAMO = put-user
