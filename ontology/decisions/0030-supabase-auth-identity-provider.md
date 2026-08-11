---
adr_number: 0030
title: Supabase Auth (GoTrue) como provedor de identidade; autorização resolvida do banco
date: 2026-08-06
status: accepted
type: change
amends: ADR-0011
related_entities: [Usuario, Permuta, Recebimento, LotePagamento, SolicitacaoNumerario]
---

# ADR-0030 — Supabase Auth (GoTrue) como provedor de identidade; autorização resolvida do banco

- **Status:** aceito
- **Data:** 2026-08-06
- **Amenda:** **ADR-0011** (API hardening — RBAC server-side), cujo §1 assume `role` vindo do JWT
- **Feature:** `supabase-auth` · **Entrevista:** `ontology/_inbox/supabase-auth-interview.md`
- **Frentes afetadas:** todas as quatro (a identidade é transversal)

## 1. Contexto

O `CLAUDE.md` descreve o auth como *"Supabase (JWT + Postgres)"*, mas **não é o que roda**. Não existe
`@supabase/supabase-js` em nenhum dos dois `package.json`. O que existe hoje:

- `POST /auth/login` compara a senha com bcrypt contra `app_user` e assina um **JWT HS256 próprio**
  (`jose`, `AUTH_JWT_SECRET`, `sub` = username/email, TTL **12 h**);
- o token vive em **`localStorage`**, sem refresh, sem rotação, **sem revogação** e sem logout — um
  token vazado vale 12 h inteiras;
- não há reset de senha self-service, nem `middleware.ts` no Next (toda proteção de rota é client-side);
- o Supabase sobrevive apenas como (a) o Postgres hospedado e (b) um caminho JWKS/ES256 **morto** em
  `http/auth.ts:140-144` — código pronto, nunca exercitado.

A consequência **de domínio** — não apenas técnica — é que **`Usuario` passa a existir como entidade de
primeira classe da ontologia**. Ele já era domínio de verdade (é quem assina a baixa no `fin010` e quem
a trilha de auditoria atribui), mas as 17 entidades anteriores não modelavam identidade em lugar nenhum.

## 2. Decisão central

> **O JWT prova *identidade*. A *autorização* é resolvida do banco a cada request.**

```
Browser ──(@supabase/ssr, cookies)──▶ Supabase GoTrue     [credenciais, sessão, refresh, reset]
   │                                       │ assina ES256
   ▼                                       ▼
Express ── buildAuthMiddleware ────▶ verifica via JWKS     (prova IDENTIDADE: sub = uuid)
              │
              ▼
        appUserContext ──▶ SELECT ... FROM app_user WHERE auth_user_id = $sub AND ativo
              │            (resolve AUTORIZAÇÃO: role, username, appUserId)
              ▼
        requireRole('admin') / assertUserCanActOnFilial / conexosIdentityMiddleware
```

**O `Usuario` da ontologia é a linha `app_user`**, não o registro em `auth.users` — que é o
*custodiante da credencial*, modelado em `integrations/supabase-auth.md`. Não é formalismo: é o que
torna o **403 fail-closed** uma consequência lógica em vez de uma regra arbitrária.

## 3. Por que **não** usar um Custom Access Token Hook para injetar `role`/`filiais` no JWT

1. **Fecha o achado que o Regis-Review levanta há 5 runs** — *"a claim `filiais` nunca foi
   provisionada"* — **sem depender de um hook configurado fora do repositório**.
2. **`ativo = false` revoga o acesso na hora**, em vez de esperar o token expirar.
3. **Fail-closed por construção:** o **mesmo projeto Supabase** hospeda o Postgres e emite os tokens. Se
   o signup público estiver ligado, qualquer pessoa obtém um JWT válido com `aud: 'authenticated'`. Sem
   linha correspondente em `app_user`, a request morre em **403**.
4. **O `role` do JWT Supabase é sempre `'authenticated'`** (é o role do Postgres), o que **quebraria**
   `requireRole('admin')` (`http/auth.ts:205-222`). A resolução por banco sobrescreve `req.user.role`
   com `app_user.role` e elimina a ambiguidade.

**Custo aceito:** um `SELECT` por request, mitigado por cache TTL curto em processo — cujo preço em
latência de revogação está **declarado** em `business-rules/revogacao-de-acesso.md`, junto da restrição
de instância única do Render.

O argumento estrutural por trás dos quatro: uma claim customizada moveria a decisão de autorização para
um **artefato configurado fora deste repositório**, invisível ao code review, ao teste e ao Regis-Review.

## 4. Amenda à ADR-0011

### §1 (RBAC server-side) — **superado em um ponto**

O texto da ADR-0011 diz literalmente: *"Fonte do role: o `role` já vem no JWT."* **Deixa de valer.**

O que **não** muda: o middleware `requireRole(...allowed)`, a lista de rotas gateadas, as respostas
(401 sem `req.user`, 403 com role fora da lista) e a consequência declarada de que **toda nova rota de
mutação deve usar `requireRole('admin')` explicitamente**. Muda **apenas a origem** de `req.user.role`,
que passa a ser `app_user.role`, resolvido do banco e revogável.

A observação da ADR-0011 de que *"tokens Supabase (`role='authenticated'`) ficam corretamente barrados
nas mutações"* descrevia um caminho de bootstrap. Ela é agora **exatamente o problema** que a
justificativa (4) acima resolve.

### §2 (redação de log) — **estendido**

`redactBody` continua válido e passa a cobrir **`service_role`**. É aqui que mora a regra "segredos não
atravessam a fronteira do backend": `SUPABASE_SERVICE_ROLE_KEY` **só no backend**, nunca
`NEXT_PUBLIC_*` (ela ignora RLS e pode criar usuários); `conexos_password_enc` e `password_hash` nunca
saem em resposta de API (`AppUserPublic` já os omite — a interface existe para isso).

**Deliberadamente não viramos isso numa business-rule nova:** já está coberto pela ADR-0011 §2, e
duplicar a regra em dois lugares garante que uma das cópias envelheça.

## 5. Invariante da identidade de auditoria (I-Usuario-1)

> **O ator da trilha é `app_user.username` (o e-mail). Nunca o `sub` do provedor de identidade.**

É o que mantém a trilha **contínua através de qualquer troca de IdP** — inclusive o SSO corporativo
futuro, que emitirá outro `sub`.

**Superfície verificada em 2026-08-06: 21 call sites**, não 2 como o plano supunha —
`routes/permutas.ts` (13), `routes/recebimentos.ts` (4), `routes/sispag.ts:65`, `routes/usuarios.ts:29`,
`routes/me.ts:24`, `http/conexosIdentity.ts:14`. Alimentam `executadoPor` / `criadoPor` /
`processadoPor` / `triggeredBy`, **persistidos** em `executado_por`, `criado_por` e `created_by`.

**O `??` não protege:** o padrão `req.user?.sub ?? req.user?.email ?? 'unknown'` parece defensivo, mas
com `sub` virando UUID ele continua **presente** e **vence** o fallback. A mudança seria 100%
silenciosa — nenhum erro, nenhum log, nenhum teste vermelho.

**Impacto visível confirmado:** `BorderoGestaoService.ts:340` grava `criadoPor`;
`frontend/app/permutas/BorderosPanel.tsx:460` o renderiza **cru** na tabela, e a linha **166** monta o
dropdown "filtrar por usuário" a partir desses valores — a mesma pessoa viraria **duas entradas** e o
filtro histórico deixaria de encontrar o trabalho dela.

**Decisão: trocar os 21 para `username`.** Os valores gravados ficam **idênticos aos já existentes** (o
`sub` do token legado já é o e-mail): **sem migração de dados e sem histórico misto**. É barato agora e
irrecuperável depois. Ver `business-rules/ator-da-trilha-de-auditoria.md`.

## 6. Estratégia de rollout — **mora nesta ADR, não na ontologia**

Volátil por desenho: tudo nesta seção morre na Fase 4. É por isso que a condição `pendenteMigracao`
**não** virou estado do ciclo de vida do `Usuario` (ver §8).

| Fase | Backend | Frontend | Rollback |
|---|---|---|---|
| 1 | Migration `0044` + `appUserContext` + import dos hashes bcrypt | inalterado | reverter deploy |
| 2 | Aceita **ambos** os tokens (HS256 legado + ES256 Supabase) | `NEXT_PUBLIC_AUTH_PROVIDER=supabase` | voltar a flag para `legacy` |
| 3 | `AUTH_LEGACY_LOGIN_ENABLED=false` | — | religar a flag |
| 4 | remover HS256, `password_hash`, `AuthService` | — | — |

**Gate operacional da Fase 3 (I13):** desligar o login legado **enquanto existir** `app_user` com
`auth_user_id IS NULL` deixa esse usuário **sem nenhum caminho de login** — o legado está desligado e
ele não existe no GoTrue. A transição de fase **exige `listPendingMigration()` retornando vazio**. Isto
transforma o método num **gate**, não num relatório.

O rollback da Fase 2 é **uma variável de ambiente na Vercel**, sem redeploy do backend.

### A armadilha do `issuer` (regressão nomeada)

`baseOptions` (`http/auth.ts:133-136`) inclui `issuer` e é espalhado nos **dois** verificadores. Assim
que `SUPABASE_URL` for setado, o `issuer` passa a ser exigido também do token legado — que **nunca teve
claim `iss`**. **Ligar o Supabase derrubaria todas as sessões vivas de uma vez.** Separar as opções por
caminho; `audience: 'authenticated'` permanece exigido nos dois. Teste de regressão explícito.

## 7. Cadastro: convite com fallback

Decisão: **os dois caminhos**.

- **`convidarUsuario`** é o padrão (usuário nasce `convidado`, define a própria senha) — **depende de
  SMTP**;
- **`cadastrarUsuarioComSenha`** é o fallback quando o convite não chega (admin define a senha; usuário
  nasce `ativo`) — **não depende de SMTP**.

O fallback é o que impede a ausência de SMTP de bloquear duramente a operação, sem abrir mão do convite
como caminho preferencial. Ambos exigem **atomicidade entre sistemas**: as duas pontas nascem juntas ou
nenhuma nasce — senão o e-mail fica **queimado** no GoTrue para um cadastro futuro.

## 8. Modelagem: o que deliberadamente **não** foi criado

| Não criado | Por quê | Onde foi parar |
|---|---|---|
| Entidade **`Sessao`** | Depois desta feature a sessão é 100% do GoTrue: zero linhas nossas, zero invariantes enforçáveis, nenhuma ação de domínio. Seria entidade vazia. | `business-rules/revogacao-de-acesso.md` |
| Entidade **`Permissao`** | `role` é atributo **enumerado** de dois valores, sem ciclo de vida. A dimensão que seria entidade (`Usuario N—M Filial`) está fora de escopo. | `_watchlist.md` |
| Estado **`pendente-migracao`** no ciclo de vida | **Afirmaria algo falso sobre a produção atual:** todo `app_user` de hoje é `ativo = true` **E** `auth_user_id IS NULL` **ao mesmo tempo**. E criaria a combinação `inativo + pendente`, inalcançável no diagrama mas alcançável de verdade. | Condição **derivada** (`authUserId IS NULL`), ortogonal, **vigência 2026-08-06 → Fase 4**, documentada em `entities/usuario.md`; o gate de cutover fica no §6 desta ADR |
| Business-rule para "segredos não cruzam a fronteira" | Já coberto pela ADR-0011 §2 | §4 desta ADR (estensão) |

## 9. Outras decisões travadas

- **Autodesativação proibida (I-Usuario-6).** Um admin não pode desativar a si mesmo (403 explícito);
  desativar **outro** admin é permitido. É a guarda mínima contra a perda de acesso à gestão de
  usuários. A guarda completa ("não pode restar zero admin ativo", que exige `COUNT` transacional) fica
  na watchlist — nota: esta ADR **encarece o escape hatch** ao remover o default hardcoded
  `'columbia2026'` do `seed-admin`.
- **TTL de contexto = 30 s, constante tipada, não env var** — um número de segurança que se muda por
  deploy é um número que se muda **sem revisão**. Ver `business-rules/revogacao-de-acesso.md`, incluindo
  a restrição datada de instância única do Render (`plan: starter`).
- **Falha no ban do GoTrue durante a desativação ⇒ sucesso PARCIAL auditado**, não erro duro: o
  `ativo = false` local já revoga e é o que o fail-closed enforça; retornar erro levaria o admin a crer
  que não desativou ninguém quando na prática desativou.
- **Default de `role` alinhado para `'operador'` (least privilege).** O boundary já defaultava a
  `'operador'`; o banco (`migrations/0007_app_user.sql`) defaulta a `'admin'`. O drift era inócuo
  enquanto o `role` vinha do JWT — **deixa de ser** agora que a autorização vem do banco: qualquer linha
  criada fora do route nasceria `admin`. Migration `0045`.

## 10. Passos humanos bloqueantes (fora do código)

1. **Auth → Providers: desligar signup público.** Sem isso, qualquer pessoa obtém um JWT válido do
   projeto. O 403 fail-closed é a **segunda** camada, não a primeira.
2. **Auth → SMTP customizado.** O sender embutido é limitado a poucos e-mails/hora e não serve para
   produção. Bloqueia `convidarUsuario` e o reset de senha — **não** o fallback com senha.
3. **Auth → URL Configuration:** Site URL e Redirect URLs (domínio Vercel + `localhost:3000`).
4. **Auth → Email templates** em PT-BR (convite e recuperação).
5. **Auth → JWT Keys:** migrar para chaves assimétricas (ECC P-256), mantendo o segredo legado no rollout.
6. **Auth → Sessions:** TTL do access token e rotação de refresh com reuse detection.
7. **Render:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (`sync: false`), `AUTH_LEGACY_LOGIN_ENABLED`
   — **e `CONEXOS_CRED_ENC_KEY`, hoje ausente do `render.yaml`** (gap pré-existente: sem ela o vínculo
   Conexos por usuário não funciona em produção e **tudo já cai no robô hoje**, o que mantém I-Usuario-5
   inerte).
8. **Vercel:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_PROVIDER`.
9. Confirmar que o schema `auth` **não** está exposto via PostgREST.

## 11. Consequências

- Toda coluna de auditoria nova nasce recebendo **`req.user.username`** — nunca `sub`.
- Toda rota de mutação nova continua declarando `requireRole('admin')` explicitamente (ADR-0011 segue
  valendo); a diferença é que o `role` agora é **confiável e revogável**, o que torna barato introduzir
  um terceiro papel sem tocar no provedor de identidade.
- **Escalar o Render horizontalmente exige revisitar `business-rules/revogacao-de-acesso.md`** — a
  invalidação de cache é process-local e degrada em silêncio.
- **A ontologia passa a asseverar uma invariante que o ambiente não exerce** (I-Usuario-5, por causa de
  `CONEXOS_CRED_ENC_KEY`). Registrado explicitamente na entidade e nos follow-ups, porque uma invariante
  inerte **parece** cumprida.
- **O `filialAuthz` fail-OPEN não é fechado por esta feature**, mas fica barato de fechar: com a
  autorização já vindo do banco, popular `filiais` vira um `JOIN` na query que já resolve `role`/`ativo`.
  Ver `_inbox/supabase-auth-regis-followups.md`.
- `password_hash` só sai na Fase 4; até lá é a fonte do import bcrypt e está marcada `deprecated` na
  ontologia para não ser legitimada.

## 12. Alternativas consideradas e recusadas

- **Custom Access Token Hook** — §3. Recusada: move a decisão de autorização para fora do repositório.
- **Modelar `Sessao` e `Permissao` como entidades** — §8. Recusadas: seriam entidades vazias.
- **Manter `sub` como ator da trilha** — recusada: parte a trilha de auditoria de três frentes de forma
  **irreversível**. Depois do cutover não há como saber qual UUID era qual pessoa se o usuário for
  renomeado ou recriado no provedor.
- **Reescrever o verificador de token** — recusada: `createRemoteJWKSet` + o verificador alg-aware
  (`http/auth.ts:140-175`) e o harness de teste com `keyResolver` injetado (`http/auth.test.ts`) já
  implementam exatamente o que a migração precisa.
