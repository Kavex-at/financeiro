# Handoff — `supabase-auth` (contexto para quem pegar a feature)

> **Escrito em 2026-08-11.** Documento de passagem de bastão: o que existe, onde está, o que já foi
> decidido e **por que** — para que ninguém reabra uma discussão fechada nem desfaça uma proteção
> achando que é sobra.
>
> **ADR:** [0030](../decisions/0030-supabase-auth-identity-provider.md) · **Follow-ups:**
> [`supabase-auth-regis-followups.md`](supabase-auth-regis-followups.md) ·
> **Regis-Review:** `docs/regis-review/2026-08-06-1520-supabase-auth/`

---

## 0. Onde a feature está, fisicamente

| | |
|---|---|
| Worktree | `/home/inteli/kavex-worktrees/supabase-auth` (**não** o checkout principal) |
| Branch | `feat/supabase-auth` |
| Merge-base | `6e03775` (`chore(release): v0.20.1`) |
| Commits na branch | **zero** |
| Estado do trabalho | **119 arquivos, ~15.1k linhas, tudo em _staging_ — não commitado** |
| Distância da `main` | **7 commits atrás** |
| Versão do app | `0.20.1` (FE e BE) — **não bumpada**; a `main` já está em `v0.20.2` |

**Consequência prática nº 1:** `git diff main` **mente**. Como a branch está atrás, esse diff mostra o
trabalho recente da `main` (recebimentos: modalidade na carteira, arquivamento, extrato por conta) como
se fosse remoção feita por esta feature. O diff verdadeiro é
`git diff $(git merge-base HEAD main)` — 119 arquivos, não 187.

**Consequência prática nº 2:** um `git checkout`/`git stash` descuidado nesse worktree **apaga a feature
inteira**. Não há commit para voltar. A primeira ação de quem pegar isto deve ser commitar.

A mensagem de commit já está redigida e revisada em
`~/.claude*/…/scratchpad/commit-msg.txt` (o `git commit` foi **negado pela camada de permissão** duas
vezes — não é um erro de conteúdo). Se ela não estiver mais acessível, reescreva; o conteúdo está
resumido nas seções 2 e 4 deste documento.

---

## 1. A regra que explica todo o resto

> **O JWT prova _identidade_. A _autorização_ é resolvida do banco a cada request.** (ADR-0030 §2)

Tudo que parece redundante nesta feature deriva daí. O `role` do JWT do GoTrue é **sempre**
`'authenticated'` — se alguém tentar autorizar pelo token, `requireRole('admin')` quebra para todo
mundo. Por isso:

- existe um middleware `appUserContext` que faz um `SELECT` por request (com cache de 30s);
- o frontend descobre se é admin por `GET /me`, **não** decodificando o token;
- **não** foi usado Custom Access Token Hook: ele moveria a decisão de autorização para um artefato de
  painel, invisível ao code review e ao teste (ADR-0030 §3).

---

## 2. Mapa: os arquivos que importam de verdade

### Backend — o caminho de um request autenticado

```
buildAuthMiddleware (http/auth.ts)          → verifica o JWT, classifica o esquema
  └→ buildAppUserContextMiddleware (http/appUserContext.ts) → resolve role/username/appUserId do banco
       ├→ AppUserContextCache (domain/service/auth/)   TTL 30s, invalidação síncrona
       └→ UserRepository (domain/repository/auth/)     findByAuthUserId | findContextByUsername
```

| Arquivo | O que faz | Cuidado |
|---|---|---|
| `http/auth.ts` | Verificação JWT dupla (HS256 legado + ES256/JWKS Supabase) e classificação `authScheme` | §3.1 e §3.2 |
| `http/appUserContext.ts` | Resolve o contexto do banco; **403, nunca 401** | §3.3 |
| `http/auditActor.ts` | `auditActor(req)` — usado em **21 call sites** | §3.4 |
| `domain/client/SupabaseAdminClient.ts` | Fronteira com o GoTrue Admin API, validada com Zod; **service-role, só backend** | §7 |
| `domain/service/auth/UserAdminService.ts` | Convite, senha-pelo-admin, ativar/desativar, revogação | §3.5 |
| `jobs/migrate-users-to-supabase.ts` | Importa os hashes bcrypt existentes; **dry-run por padrão** | §5 |
| `migrations/0044`, `0045` | `auth_user_id`, `convite_pendente`; `role` default `operador` | `0044` exige `pgcrypto` — corrigido na `main` (`bbfd3ea`), **vem no rebase** |

### Frontend

| Arquivo | O que faz |
|---|---|
| `middleware.ts` + `lib/supabase/middleware.ts` | Refresh de sessão **server-side** e proteção de rota (antes era 100% client-side, pós-hidratação) |
| `lib/auth/AuthProvider.tsx` | Bootstrap de sessão, `signIn`, `signOut` — com ramo legado |
| `lib/auth/provider.ts` | **Único leitor** de `NEXT_PUBLIC_AUTH_PROVIDER` |
| `lib/auth/legacySession.ts` | `localStorage` do modo de rollback |
| `lib/auth/token.ts` | `getAccessToken` / `withAuthHeaders` — contrato estável nos dois modos, 52 call sites |
| `app/auth/*` | Convite, recuperação e redefinição de senha |

---

## 3. Armadilhas — decisões que **parecem** paranoia e não são

Cada uma tem teste nomeado. Se um teste destes ficar vermelho, **não relaxe a asserção**: leia aqui
primeiro.

### 3.1 As opções de verificação do JWT são separadas por caminho — de propósito

`baseOptions` incluía `issuer` e era espalhado nos **dois** verificadores. Como o token HS256 legado
**nunca teve claim `iss`**, bastaria setar `SUPABASE_URL` para o backend passar a exigir `iss` do token
legado — **derrubando todas as sessões vivas de uma vez**, sem deploy de frontend nenhum. HS256 **não**
exige `issuer`; `audience: 'authenticated'` continua exigido nos dois. (ADR-0030 §6)

### 3.2 `authScheme` é classificado pelo `iss`, **não** pelo `alg`

Tentador rotear por algoritmo — HS256 = legado, ES256 = Supabase. **Errado:** um projeto Supabase ainda
em chaves simétricas emite HS256 com `sub` UUID. Rotear por `alg` trancaria **todos** os usuários desse
projeto para fora. O discriminador é `payload.iss === issuer`.

### 3.3 O erro de autorização é **403**, jamais 401

401 dispara o fluxo de refresh do cliente e o modal de sessão expirada. Uma linha `app_user` ausente,
`ativo = false` ou convite não aceito **não** é problema de sessão — devolver 401 aí produz loop de
refresh e um modal mentiroso. O frontend trata os dois códigos de forma distinta.

### 3.4 As colunas de auditoria gravam `username`, **nunca** `sub`

`auditActor(req)` existe porque o padrão anterior era `req.user.username ?? req.user.sub`. Quando `sub`
vira UUID, ele continua ganhando o `??` — e a trilha **silenciosamente** passaria a gravar UUIDs, sem
erro e sem teste vermelho. Há um teste-guarda (`http/auditActor.guard.test.ts`) que varre os call sites.
Regra ontológica: `business-rules/ator-da-trilha-de-auditoria.md` (I-Usuario-1).

### 3.5 A revogação invalida **duas** chaves de cache

Durante as Fases 2–3 a mesma pessoa pode portar token legado **ou** Supabase. Desativar um usuário
invalidando só uma das identidades deixa a outra viva por até 30s — com privilégio. `UserAdminService`
invalida `authUserId` **e** `legacyKeyFor(username)`, e a ordem é **local primeiro, provedor depois**
(se o `ban` no GoTrue falhar, o acesso local já caiu).

> O `AppUserContextCache` é **process-local**. Isso só é suficiente porque o Render roda em
> `plan: starter` (instância única). **Escalar horizontalmente quebra a revogação em silêncio** —
> está registrado em `business-rules/revogacao-de-acesso.md` e em ADR-0030 §11.

### 3.6 `findByAuthUserId` recusa um `sub` que não seja UUID

Backstop estrutural. `auth_user_id` é coluna `UUID`; um `sub` em formato de e-mail levanta 22P02 no
Postgres → **500 em todo request autenticado**. Com o guard, uma classificação errada custa um 403
diagnosticável, nunca um 500. É a segunda camada, independente da §3.2 — não remova uma por causa da
outra.

---

## 4. O P0 do Regis-Review — resolvido, e o que ele revelou

**Card `cutover-rollback-broken`** (`docs/regis-review/2026-08-06-1520-supabase-auth/KANBAN.md`,
marcado **RESOLVIDO em 2026-08-10 pela ROTA A**).

A revisão descreveu como "o rollback da Fase 2 é um no-op": `NEXT_PUBLIC_AUTH_PROVIDER` tinha **zero
leitores** no frontend. Virar a flag no painel da Vercel não produzia erro — produzia **nada**. E a
descoberta só aconteceria durante um incidente de login, que é o único momento em que ela seria acionada.

**O achado era pior do que a descrição.** `buildAppUserContextMiddleware` é montado incondicionalmente
no `index.ts` e resolvia tudo por `findByAuthUserId(sub)`. O `sub` do token legado é um e-mail
(`AuthService.signToken` faz `.setSubject(username)`) → 22P02 → **500 em todo request autenticado**.
Ou seja: subir só o backend, sem tocar em frontend nenhum, **trancava todo mundo para fora**. Não era
um rollback quebrado; era o caminho de ida quebrado.

Correção em quatro pontos, já aplicada: `authScheme` (§3.2) · roteamento do lookup por esquema ·
guard de UUID (§3.6) · a flag do frontend com um leitor real que troca `signIn`/`signOut`/bootstrap
**e tira o middleware do Next do caminho** (uma sessão legada é invisível ao servidor por construção —
deixar a checagem ligada redirecionaria todo mundo para `/login` em loop).

---

## 5. Rollout — as quatro fases e o gate que trava

| Fase | Backend | Frontend | Rollback |
|---|---|---|---|
| 1 | Migration `0044` + `appUserContext` + import dos hashes bcrypt | inalterado | reverter deploy |
| 2 | Aceita **ambos** os tokens | `NEXT_PUBLIC_AUTH_PROVIDER=supabase` | **variável de ambiente na Vercel, sem redeploy do backend** |
| 3 | `AUTH_LEGACY_LOGIN_ENABLED=false` | — | religar a flag |
| 4 | remover HS256, `password_hash`, `AuthService` | — | — |

**`listPendingMigration()` é o gate da Fase 3, não um relatório.** Desligar o login legado enquanto
existir `app_user` com `auth_user_id IS NULL` deixa essa pessoa **sem nenhum caminho de login**: o legado
desligado e ela inexistente no GoTrue. A transição **exige a lista vazia**.

O login atual continua funcionando durante as Fases 1 e 2 — ninguém é deslogado pelo deploy. As pessoas
migram ao trocar a senha ou receber o convite; os hashes bcrypt existentes são reaproveitados pelo job,
então quem já tem senha **não precisa redefini-la**.

---

## 6. O bloqueio real: `username` não é e-mail

**Este é o item que decide o cronograma.** `migrations/0007_app_user.sql` declara
`username TEXT UNIQUE NOT NULL` — string livre, sem formato de e-mail. O GoTrue **valida formato de
e-mail**, e o job alimenta o campo direto (`migrate-users-to-supabase.ts:88`). Um `username` como
`financeiro01` **nunca ganha `auth_user_id`** → `listPendingMigration()` **nunca esvazia** → **a Fase 3
fica permanentemente travada**.

Trava do lado certo: o pior caso é o cutover não avançar, não alguém ficar trancado do lado de fora.

**A única medição que decide o caminho** (leitura pura, roda hoje — precisa ser rodada contra o banco do
financeiro; o projeto Supabase alcançável via MCP nesta máquina é o `Kavex-portal`, que **não** tem
`app_user`):

```sql
SELECT count(*) FILTER (WHERE username NOT LIKE '%@%') AS sem_email,
       count(*)                                        AS total
FROM app_user;
```

| `sem_email` | Caminho |
|---|---|
| **0** | Sem migração de dados. `CHECK` de formato + Zod na fronteira, e a ADR passa a **afirmar** o que hoje presume. ~30 min. |
| **pequeno (≲20)** | **Recomendado:** normalizar `username → e-mail` **na Fase 1**, com o backfill de auditoria na **mesma transação**. Depois o `CHECK`. Um identificador para sempre. |
| **grande / e-mails desconhecidos** | Coluna `email TEXT UNIQUE`; `username` segue imutável como ator da trilha e chave de junção do vínculo Conexos. |

**Por que na Fase 1 e não depois** (o argumento que importa mais que a escolha A-vs-B):

1. **Antes** de `migrate-users-to-supabase --execute`: criar usuário no GoTrue com e-mail errado
   **queima aquele e-mail** para um cadastro futuro — corrigir vira deletar e recriar usuários no provedor.
2. **Antes** do frontend virar: enquanto o login legado é a única porta, o rename custa **uma mensagem de
   comunicado**. Depois do flip, custa mudar a identidade de login **duas vezes na mesma semana** — na
   única janela cujo modo de falha declarado é lockout.
3. O backfill de auditoria só encarece: escala com o histórico, e o histórico só cresce.

**Raio de um `UPDATE` manual de `username`** (já mapeado, para quem for tentado a fazer no psql):
o vínculo Conexos sobrevive (`getVinculoConexos` filtra pela mesma linha); mas **sessões legadas vivas
tomam 403**; a trilha **racha em dois formatos** (visível no dropdown de `BorderosPanel.tsx:166`);
a chave de idempotência muda (`receb:${ator}:${key}`), com risco de **dupla execução** em rota que move
dinheiro; e `seed-admin` cria um **admin duplicado** se `ADMIN_USERNAME` não for atualizado junto.
Por isso a recomendação é um job — `jobs/normalize-usernames-to-email.ts`, dry-run por padrão, mapping
explícito (não se deriva e-mail de `financeiro01`), transação única, com colisão / e-mail inválido /
"nada pendente no ledger de recebimentos" como **pré-condições que abortam**. Migration cuida do schema
(o `CHECK`); job cuida do dado, que é específico do ambiente.

Qualquer caminho de rename exige **ADR emendando I-Usuario-2** (`username` imutável) com exceção datada.

---

## 7. Regras que não se negociam neste código

- **`SUPABASE_SERVICE_ROLE_KEY` é backend-only.** Ignora RLS e cria usuários. Nunca `NEXT_PUBLIC_*`,
  nunca em `src/frontend/`. Há um teste-guarda que varre o pacote inteiro atrás dela.
- **`conexos_password_enc` e `password_hash` nunca saem em resposta de API.** (ADR-0011 §2, estendida
  pela 0030 §4.)
- SQL sempre parametrizado (`$nome` via `SqlBuilder`); `@injectable()`/`@singleton()` em classes de DI;
  Zod nas fronteiras; métodos como arrow functions com modificador de acesso explícito.
- Identificadores em inglês; docs e ontologia em PT-BR; **commits em inglês**.

---

## 8. Estado dos gates (medido em 2026-08-10, antes do rebase)

| Gate | Resultado |
|---|---|
| BE `typecheck` | ✅ |
| BE `lint` | ✅ 0 erros (38 warnings **pré-existentes**) |
| BE `test` | 1207/1224 — **17 falhas em 4 suítes `recebimentos.e2e.*`** |
| BE testes de auth | 189/189 ✅ |
| FE `typecheck` / `lint` / `test` / `build` | ✅ · ✅ · 182/182 · ✅ |

**As 17 falhas são pré-existentes, não regressão.** Foram reproduzidas idênticas no worktree limpo da
`main`. Aquelas suítes montam o próprio app Express, stubam `req.user` e **nunca montam**
`buildAuthMiddleware`/`appUserContext` — esta feature não as alcança. Confirme rodando na `main` antes
de investir tempo nelas.

> Os números são de **antes** dos 7 commits de `main`. Re-rodar tudo depois do rebase é obrigatório.

---

## 9. O que falta até o PR

1. **Commitar** (o trabalho está sem rede de segurança — ver §0).
2. **Rebase** em `main` (7 commits). Atenção a `src/backend/routes/recebimentos.ts` e ao frontend de
   recebimentos, onde a `main` mexeu bastante; `bbfd3ea` toca a migration `0044` **desta feature**.
3. **Bump de versão** FE+BE em lockstep via `scripts/bump-version.ps1 -Execute` + `CHANGELOG.md` →
   commit `chore(release): vX.Y.Z`. O delta tem `feat`, então o bump **não** é no-op.
4. **Re-rodar todos os gates** pós-rebase.
5. **Docs-as-code**: `DEPLOY.md`, `README.md` e `CLAUDE.md` já estão modificados no staging — conferir
   se o texto ainda bate depois do rebase (a seção "Docs-as-code" dos follow-ups lista o que era
   esperado).
6. **9 passos humanos no console do Supabase** (ADR-0030 §10) — signup público **desligado** é o nº 1;
   sem ele qualquer pessoa obtém um JWT válido do projeto, e o 403 fail-closed vira primeira camada em
   vez de segunda. Mais SMTP, URLs de redirect, templates PT-BR, chaves ECC P-256, TTL/rotação de sessão.
7. **Variáveis de ambiente**: Render (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` com `sync: false`,
   `AUTH_LEGACY_LOGIN_ENABLED`, **e `CONEXOS_CRED_ENC_KEY`, hoje ausente do `render.yaml`**) e Vercel
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_PROVIDER`).
8. **Job de migração**: dry-run → conferência → `--execute`.
9. **Roteiro de QA** no tenant de dev (QaCoach) — inclui **exercitar o rollback**, não só o caminho feliz.

---

## 10. Follow-ups abertos (não são desta feature, mas são conhecidos)

Todos em [`supabase-auth-regis-followups.md`](supabase-auth-regis-followups.md).

| Prio | Item |
|---|---|
| **P1** | **`filialAuthz` fail-OPEN** — carry-over desde 2026-06-22, **6º Regis-Review consecutivo**. A claim `filiais` nunca foi provisionada, então `userCanActOnFilial` retorna `true` sempre: qualquer admin dispara borderô, baixa `fin010` e NDe em **qualquer filial**. Esta feature não fecha (misturaria duas migrações de segurança num cutover só) mas **barateia**: com a autorização já vindo do banco, popular `filiais` vira um `JOIN` na query que já resolve `role`/`ativo`. |
| **P1** | `username` não é e-mail — §6 acima. |
| **P1** | I-Usuario-7: mudanças de estado de `Usuario` não são atribuídas. |
| **P1** | Duas invariantes de `Usuario` declaradas e não enforçadas — inclusive **I-Usuario-5, inerte** por falta de `CONEXOS_CRED_ENC_KEY` em produção. Invariante inerte **parece** cumprida. |
| **P2** | Sem guarda "não pode restar zero admin ativo"; `AuthProvider` a 58% de cobertura; formulários fora de `react-hook-form`+`zod`. |
| **P3** | Constante de base-URL da API duplicada; complexidade cognitiva de `buildAppUserContextMiddleware` (27 × máx. 15). |
