---
adr_number: 0056
title: Supabase Auth do mesmo projeto do banco, por proxy no backend; `req.user.sub = username` para sempre
date: 2026-09-30
status: accepted
type: change
related_entities: []
related_actions: []
related_integrations: [supabase-auth, kavex-report-ciclo]
amends: [0051]
continues: [0053]
evidence:
  - src/backend/http/auth.ts
  - src/backend/http/authEnv.ts
  - src/backend/http/acesso.ts
  - src/backend/domain/client/SupabaseAuthClient.ts
  - src/backend/domain/service/auth/SupabaseSessionService.ts
  - src/backend/domain/service/auth/CredentialMirror.ts
  - src/backend/domain/service/auth/SupabaseAuthSyncService.ts
  - src/backend/domain/service/auth/AdminSeeder.ts
  - src/backend/routes/auth.ts
  - src/backend/http/rateLimit.ts
  - src/backend/jobs/sync-supabase-auth.ts
  - src/backend/jobs/probe-gotrue-local.ts
  - src/backend/migrations/0070_app_user_auth_user_id.sql
  - src/frontend/lib/auth/session-refresh.ts
  - src/frontend/lib/http.ts
  - DEPLOY.md (seção 6)
  - ontology/_inbox/auth-supabase-interview.md
  - ontology/_inbox/auth-supabase-tasks.md
---

# ADR-0056 — Supabase Auth do mesmo projeto, por proxy no backend; `username` como identidade para sempre

> Número provisório no scoping: **0054**. A `main` já tinha 0054 e 0055 (SISPAG) quando esta ADR
> foi escrita; ficou **0056**. A migration provisória 0067 virou **0070** pelo mesmo motivo.

## Contexto

Passo 3 de 3 do plano de auth (ADR-0051 → ADR-0053 → esta). Até aqui o backend assinava o próprio
JWT HS256 (`AUTH_JWT_SECRET`, 12 h, sem refresh, sem logout no servidor). O dono do ciclo decidiu:
Supabase Auth do **mesmo projeto** do banco, **mesmas senhas** (hashes bcrypt importados como
estão), sem SMTP, sem cadastro público, chave secreta só no backend, permissões continuam no banco.

## Decisão

1. **Proxy no backend (Q2).** O front continua em `POST /auth/login` (corpo `{ username, password }`,
   campo `token` — o `kavex-report-ciclo` não muda). O identificador é resolvido no `app_user`;
   nenhum, ambíguo, inativo, sem vínculo ou sem e-mail → o mesmo 401, **sem chamar o GoTrue**. Só
   então o GoTrue recebe o e-mail. `POST /auth/refresh` e `POST /auth/logout` passam pelo backend.
   Motivos: contrato do report e da tela preservado, front sem chave nem dependência, `ativo` e
   ambiguidade julgados por nós, um ponto de log e de rate limit.
2. **Verificação estrita por emissor (I8), com opções separadas.** Supabase: ES256 via JWKS,
   `iss = ${SUPABASE_URL}/auth/v1`, `aud = authenticated`, `role = authenticated`,
   `is_anonymous !== true`. App: HS256, `aud = authenticated`, sem `iss`, só enquanto
   `AUTH_JWT_SECRET` existir. `SUPABASE_JWT_SECRET` deixa de ser lido. **Corrige o defeito latente**
   da v0.44: o `issuer` era aplicado aos dois caminhos, e definir `SUPABASE_URL` recusaria todo
   token HS256. Consequência operacional (D14): `SUPABASE_URL` nunca com backend ≤ v0.44 no ar.
3. **Emenda a ADR-0051 D2.** "`sub = username` até o passo 3" vira **"`req.user.sub = username`
   para sempre"**: o `sub` do token Supabase é o UUID do `auth.users`, e o `resolverAcesso` o traduz
   pelo vínculo `app_user.auth_user_id` e **reescreve** `req.user = { sub: username, authUserId?,
   filiais? }`, sem `email` nem `role`. Toda trilha (`executado_por`, `criado_por`, `triggeredBy`,
   `ator`, vínculo Conexos) continua gravando o `username`; nenhuma linha histórica muda. Os sítios
   que caíam no e-mail do token (`recebimentos.ts`, antes `email ?? sub`) passaram a usar só o
   `sub`. Token Supabase sem `app_user` vinculado → 401 + `AUTH_DIVERGENCIA`, nunca "cria na hora".
4. **Continua a ADR-0053.** A chave de lookup muda só na metade `token → app_user`
   (`auth_user_id` para o emissor `supabase`); permissões continuam no banco, lidas a cada
   requisição (I1). O cache do `AccessService` usa chave prefixada pelo tipo (D13).
5. **`AUTH_PROVIDER=local|supabase`** (default `local`) decide quem emite no login; trocar e
   reiniciar é o rollback. Janela de convivência ≥ 12 h, fechada ao apagar `AUTH_JWT_SECRET`. Em
   `local`, `/auth/refresh` responde 401 (D1) para que um rollback corte as sessões Supabase.
6. **`app_user` é a fonte da verdade; o GoTrue é projeção da credencial (R6).** Criar, senha,
   e-mail, desativar e reativar: transação local com a linha travada → chamada admin → commit.
   Falha no GoTrue = rollback + 503 "nada foi alterado". Sucesso no GoTrue e falha no commit =
   `AUTH_DIVERGENCIA`; o job `sync-supabase-auth` repara. **Exceção decidida pelo dono (2026-09-30):
   desativar nunca é bloqueado por pane do GoTrue** — o `ativo = false` é comitado, fica um
   `AUTH_DIVERGENCIA`, e o sync bane depois. O ban (`876000h`) é defesa em profundidade; a garantia
   continua sendo o `ativo` lido a cada requisição (≤ 30 s).
7. **Senha nos dois lados (R7)** até o tweak de limpeza, para o rollback por configuração seguir
   funcionando com senhas trocadas depois do corte.
8. **Higiene de grants (verificação do Q1).** Em produção as 44 tabelas de `public` têm RLS ligada,
   0 políticas, e `anon`/`authenticated` não têm SELECT/INSERT/UPDATE/DELETE: a Data API não lê nada
   nosso. Tinham TRUNCATE/REFERENCES/TRIGGER herdados do default privilege do `postgres`; a 0070
   os revoga de todas as tabelas e do default das futuras, condicionada à existência dos roles (D8).
9. **Só usuários ativos são importados (Q4 alterada).** Os 3 inativos de produção ficam de fora;
   reativar um deles cria o login na hora (exige e-mail). Apagá-los é operação à parte.
10. **Rate limiter próprio (D4):** `/auth/login` 20/min por IP e 10 falhas/15 min por identificador;
    `/auth/refresh` 30/min por IP — o GoTrue vê todo login vindo do IP do Render.
11. **Front sem chave (I6):** guarda `refreshToken`/`expiresAt`, renova ~5 min antes do `exp` e uma
    vez em 401, coordena abas (Web Locks + releitura do storage + evento `storage`). Sem refresh
    token (backend antigo ou modo local), comportamento de antes. Saem `useRole`, `decodeJwtRole`,
    o fallback por `role` do `PermissoesProvider` (agora fail-closed) e o banner de transição.

## Resultado do T-1 (spike, GoTrue v2.197.0 local)

- `POST /admin/users` **aceita** `password_hash` bcrypt `$2a$12$` como está: a importação usa a API
  admin. **Não há exceção à I7** (nenhum SQL em `auth.*`).
- `PUT /admin/users/:id` **ignora `password_hash` em silêncio** (200 sem efeito). Troca de senha e
  seed mandam `password` em claro (TLS backend → Supabase); o bcrypt local continua gravado.
  Vincular um usuário que já existia no GoTrue sem a senha em claro (sync retomando execução
  interrompida, reativar) mantém a senha do GoTrue e registra isso.
- Chave `sb_secret_…` vai só no `apikey`; a legada (`service_role`) também no `Authorization`.
- Reuso de refresh: o pai do token ativo é tolerado; o avô é recusado sem derrubar a sessão.
- A versão do GoTrue do projeto não é visível sem chave; o passo 4 do corte prova o aceite do hash
  com o login do próprio dono antes de virar a chave.

## Decisões do scoping (D1–D15)

D1 refresh em `local` = 401 · D2 logout sempre 204, sem `resolverAcesso` · D3 espelha quando a API
admin está configurada · D4 limites do rate limiter · D5 mapa de respostas do login · D6 nomes das
envs · D7 matriz de boot · D8 grants condicionados aos roles · D9 sem reverse da migration · D10
formato do login · D11 T-1 como probe local · D12 renovação coordenada entre abas · D13 cache
prefixado · D14 ordem das envs no corte · D15 `ban_duration` `876000h`/`none`. Detalhe em
`ontology/_inbox/auth-supabase-tasks.md`.

## O que o tweak de limpeza vai remover (fora desta decisão)

O caminho `AUTH_PROVIDER=local` (bcrypt no login, verificador HS256, `AUTH_JWT_SECRET`), a coluna
`app_user.password_hash` e a escrita do hash local, `app_user.role` e o campo `role` do login, a
chave `operacao` de `/me/permissoes`, a tolerância do front a login sem `refreshToken`.

## Consequências

- Nenhum arquivo de `ontology/entities/` muda (`entity_changed = false`): infraestrutura de acesso.
- Corte manual em 8 passos, com rollback por configuração até o passo 8 (`DEPLOY.md` §6).
- Divergências entre `app_user` e GoTrue são buscáveis por `AUTH_DIVERGENCIA`.
