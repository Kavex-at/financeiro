---
qa: Availability
qa_slug: availability
run_id: 2026-08-06-1520-supabase-auth
agent: qa-availability
generated_at: 2026-08-06T15:20:00-03:00
scope: backend + frontend
score: 5
findings_count: 7
cards_count: 6
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

A feature `supabase-auth` **adiciona uma nova dependência externa síncrona no caminho de TODA
request autenticada**: o Supabase GoTrue (JWKS) e o Postgres (SELECT em `app_user`). Antes, a
verificação de token era 100% local (HS256 com segredo em memória) e o Postgres estava fora do
caminho crítico de autorização. O cenário canônico do QA muda.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Supabase GoTrue (JWKS `/.well-known/jwks.json`) | Endpoint lento (>5 s) ou fora do ar por janela > `cacheMaxAge` da `jose` | `buildAuthMiddleware` (JWKS path, `http/auth.ts:176`) e, transitivamente, TODA request autenticada com token ES256 | Produção normal, rollout Fase 2 (tokens já são do GoTrue) | Falha o `jwtVerify`; middleware retorna 401. Sem retry, sem fallback, sem `jose.jwksCache` externo pré-carregado. | **Blast radius = 100% do tráfego autenticado ES256** enquanto o cache expira. Sem métrica local para "tempo até re-cache" nem taxa de 401 causados por indisponibilidade do JWKS. |
| Postgres (Supabase pooler) | Timeout de conexão do pool (`connectionTimeoutMillis=5000`) ou erro transiente durante janela > TTL do cache (30 s) | `buildAppUserContextMiddleware` (`http/appUserContext.ts:135-201`) | Produção normal | `findByAuthUserId` lança; middleware NÃO trata; propaga para `errorMiddleware` → **HTTP 500** genérico. Cache absorve indisponibilidade curta (≤ 30 s) SOMENTE para `sub`s já vistos. | Blast radius = 100% de requests com `sub` fora do cache (login novo, primeira request após restart, `sub` cujo TTL expirou). Sem métrica local de "cache hit ratio". |
| Supabase GoTrue Admin API (`getUserById`) | Endpoint lento/fora | `appUserContext.ts:122` (branch `convite_pendente`) | Rollout Fase 1/2 (usuários com convite pendente ainda existem) | Fail-closed intencional: 403 "convite pendente" para o titular — usuário legítimo fica travado até GoTrue responder. | Blast radius = subconjunto dos usuários em `convite_pendente = true` durante a indisponibilidade. Fora do rollout = 0 impacto. |
| GoTrue (dependência do frontend) | `middleware.ts` chama `supabase.auth.getUser()` a cada navegação sem timeout/fallback | Next.js edge middleware (frontend) | Produção normal | Sem timeout customizado; navegação fica pendurada até o `fetch` do runtime SSR estourar (padrão do Node/Edge) ou até o Render Vercel matar a request. | Blast radius = 100% das navegações SSR não-estáticas do frontend enquanto o GoTrue não responde. |
| Analista/Operação | `app_user.username` deixa de casar com o `sub`/e-mail do token (ex.: e-mail corporativo trocado no IdP e não em `app_user`) | `conexosIdentityMiddleware` (`http/conexosIdentity.ts:29`) | Produção normal | `getVinculoConexos(username)` retorna `null`; sistema **degrada para usuário-robô silenciosamente** (baixa `fin010` sai como robô). Comportamento documentado como intencional. | Blast radius = correção de escrita perdida (ator na trilha vira robô) — disponibilidade preservada, **qualidade do dado perdida**. **Sem log de erro, sem alarme, sem contador.** |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Novas superfícies externas no caminho de request envolvidas em `RetryExecutor`/`FallbackExecutor` | 0 / 3 (JWKS, `SupabaseAdminClient.getUserById`, `UserRepository.findByAuthUserId`) | ≥ 2 / 3 (excluindo o DB, que já usa `queryRetryExecutor` no client) | ❌ | `grep -c RetryExecutor src/backend/http/auth.ts src/backend/http/appUserContext.ts src/backend/domain/client/SupabaseAdminClient.ts` = 0, 0, 0 |
| Timeout HTTP explícito nas superfícies novas | 1 / 3 (só o JWKS via default 5000 ms da `jose`; `SupabaseAdminClient.createClient` sem `fetch` custom; frontend `createServerClient` sem timeout) | 3 / 3 explícitos | ⚠️ | `node_modules/jose/dist/types/jwks/remote.d.ts:57-59` (`timeoutDuration: 5000` default); `src/backend/domain/client/SupabaseAdminClient.ts:141-144`; `src/frontend/lib/supabase/middleware.ts:31` |
| JWKS `cacheMaxAge` configurado | Default 600 000 ms (10 min) — **não sobrescrito** | ≥ 600 000 ms + `jwksCache` persistido (Passive Redundancy) OU 3 600 000 ms explícito | ⚠️ | `src/backend/http/auth.ts:176` (`createRemoteJWKSet(new URL(...))` sem `options`); default em `node_modules/jose/dist/types/jwks/remote.d.ts:67-69` |
| JWKS `cooldownDuration` configurado | Default 30 000 ms — **não sobrescrito** | Explicitar (30 s razoável, mas indocumentado no código) | ⚠️ | `src/backend/http/auth.ts:176`; default em `remote.d.ts:63-64` |
| TTL do cache de autorização (`AppUserContextCache`) | 30 000 ms (constante tipada, `AppUserContextCache.ts:16`) | Preservado como está; ver F-availability-3 sobre absorção de indisponibilidade | ✅ | `src/backend/domain/service/auth/AppUserContextCache.ts:16` |
| Profundidade do `/health` | 1 sinal (retorna `{status:'ok', version}`); 0 dependências verificadas | ≥ 2 dependências críticas (`authEnv` carregado + Postgres reachable) | ❌ | `src/backend/index.ts:73` |
| Instâncias do backend (janela onde o cache local é válido tactic de disponibilidade) | 1 (Render `plan: starter`) | Preservar a premissa OU planejar invalidação distribuída antes de escalar | ✅ hoje / ⚠️ com escala | `render.yaml`; ver `business-rules/revogacao-de-acesso.md` §"Restrição datada 2026-08-06" |
| Detecção de degradação silenciosa Conexos (username↔`app_user.username` mismatch) | 0 counter, 0 log-de-warning, 0 alarme | ≥ 1 log estruturado (`[degradação] platformUsername ausente para sub=<x>`) + contador exportável | ❌ | `src/backend/http/conexosIdentity.ts:19-31` — degradação documentada como intencional; falta o instrumento |
| Timeout no `supabase.auth.getUser()` do frontend | 0 (default do runtime SSR; nem `AbortController`) | ≤ 3 s com fallback para servir a página como não autenticado (redireciona `/login`) | ⚠️ | `src/frontend/lib/supabase/middleware.ts:48-50` |
| `pool.max` do Postgres | 5 | Preservado (justificado em comentário `PostgreeDatabaseClient.ts:23-26`) | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:26` |
| Cobertura de `RetryExecutor` para erros transientes de DB | ativa (`isTransientConnectionError` mata 4 padrões conhecidos, 3 retries com jitter) | Preservado | ✅ | `PostgreeDatabaseClient.ts:36-42, 204` |

### Métricas não medíveis localmente

> ⚠️ **Não medível localmente**: **MTTR real e SLO de disponibilidade da autenticação** pós-cutover. Requer telemetria em produção (Render logs + Supabase status page). Recomendação: instrumentar dashboard com (a) taxa de 401 por causa `invalid-token` vs `expired` vs `verify-failed`, (b) p95 do `verify` no `buildAuthMiddleware`, (c) taxa de 500 originadas do `appUserContext`, (d) idade do JWKS em cache (`jose.jwks()` expõe o set atual). Sem esses três números não há como defender que a nova dependência não empiorou o SLO — só afirmar que "não vimos incidentes".

> ⚠️ **Não medível localmente**: **latência do JWKS endpoint p50/p99** em produção. O default de `timeoutDuration=5000 ms` da `jose` é aceitável **se** o p99 real for < 1 s; se for maior, o timeout mascarará indisponibilidade real. Requer sonda externa (Render cron ou Datadog synthetic).

> ⚠️ **Não medível localmente**: **taxa de cache-hit do `AppUserContextCache`**. Sem essa taxa não há como quantificar a defesa que ele fornece durante indisponibilidade curta de Postgres. Recomendação: expor `hits`/`misses`/`entries` num endpoint interno ou log periódico.

> ⚠️ **Não medível localmente / fora de escopo deste QA**: **presença de `infra/` / Terraform / alarmes CloudWatch**. Este repositório **não tem** `infra/` — deploy é Render + Vercel. Tactics de IaC/monitor cloud-nativo ficam marcadas *Não medível* na seção 3, não como ausência de esforço da feature.

## 3. Tactics — Cobertura no financeiro

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | `/health` público retorna `{status:'ok', version}` sem tocar downstream. É um echo raso: não detecta que o backend está de pé mas com auth quebrada (JWKS/DB inalcançável). | ⚠️ parcial | `src/backend/index.ts:69-73` |
| Heartbeat | Ausente — não há job periódico validando JWKS/DB/SupabaseAdmin. Render usa o `/health` acima para restart automático. | ❌ ausente | — |
| Monitor (System Monitor) | Ausente no repositório. Logs estruturados (`[REQ]/[RES]`) existem em `index.ts:47-66` mas não há métrica exportada nem dashboard. | ❌ ausente | `src/backend/index.ts:47-66` |
| Timestamp | `X-Request-Id` propagado (`middleware/requestId.ts` via `requestIdMiddleware`) e `expiresAt` no cache — permite correlacionar, não detecta desvio de tempo. | ✅ presente | `src/backend/index.ts:44`; `AppUserContextCache.ts:19` |
| Sanity Checking | `authEnv` valida configuração no boot (`RawAuthEnvSchema` + fail-fast quando `DEV_AUTH_BYPASS` fora de local); `SupabaseAdminClient.getClient` falha alto sem service-role key. Zod nos boundaries do `SupabaseAdminClient.goTrueUserSchema`. | ✅ presente | `src/backend/http/authEnv.ts:30-146`; `SupabaseAdminClient.ts:132-145,55-63` |
| Condition Monitoring | Ausente para a degradação silenciosa Conexos: `conexosIdentity.ts:19-31` **documenta** que a cadeia cai no robô sem erro, mas não há contador. Ver F-availability-4. | ❌ ausente | `src/backend/http/conexosIdentity.ts:19-31` |
| Voting | N/A — não há redundância ativa de decisão de autorização. Faz sentido aqui? Não: a autorização é *authoritative* no DB. | N/A | — |
| Exception Detection | `errorMiddleware` centraliza throws async (Express 5 propaga rejects automaticamente); `SupabaseAdminError` / `SupabaseUserNotFoundError` / `SupabaseEmailAlreadyExistsError` distinguem causa raiz. | ✅ presente | `src/backend/http/errorMiddleware.ts`; `SupabaseAdminClient.ts:25-49,151-167` |
| Self-Test | Ausente — o boot valida env mas não roda uma verificação viva do JWKS ou de `SELECT 1` no Postgres antes de abrir o listen. | ❌ ausente | — |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — Render `plan: starter` é single-instance. Ver "Restrição datada" em `AppUserContextCache.ts:26-42`. | N/A | `render.yaml`; `AppUserContextCache.ts:26-42` |
| Passive Redundancy | Cache de 30 s de contexto de autorização **funciona como Passive Redundancy** para indisponibilidade curta do DB (sub já visto). Duplo esquema de verificação (HS256 legado + ES256 JWKS) também é uma forma de Passive Redundancy: rotação de chave no provedor não derruba tokens legados. | ✅ presente | `AppUserContextCache.ts:53-69`; `http/auth.ts:191-208` |
| Spare | N/A — sem cold-spare de instância no plano atual do Render. | N/A | `render.yaml` |
| Exception Handling | `errorMiddleware` central + `asyncHandler` para rotas assíncronas legadas + Express 5 async-safe para middlewares novos. `unwrap()` do `SupabaseAdminClient` traduz erros do GoTrue em tipos discretos. | ✅ presente | `src/backend/http/errorMiddleware.ts`; `src/backend/http/asyncHandler.ts`; `SupabaseAdminClient.ts:151-167` |
| Rollback | ADR-0030 §6 declara o botão de rollback do login legado (`AUTH_LEGACY_LOGIN_ENABLED`). É um rollback **de rollout**, não de request. Cutover reversível é tactic legítima. | ✅ presente | `src/backend/http/authEnv.ts:44-48,142` |
| Software Upgrade | N/A neste QA — cabe em Deployability. | N/A | — |
| Retry | `RetryExecutor` presente e usado no `PostgreeDatabaseClient` (queries com 3 retries + jitter, `shouldRetry` filtrando transientes); usado nos clients do Conexos. **Não usado nas 3 superfícies novas desta feature** (JWKS, Admin API, `findByAuthUserId` no middleware — este último protegido pelo cache mas não pelo executor). | ⚠️ parcial | `PostgreeDatabaseClient.ts:36-42,196`; ausência: `http/auth.ts:176`, `SupabaseAdminClient.ts`, `http/appUserContext.ts:169` |
| Ignore Faulty Behavior | Cache TTL de 30 s absorve indisponibilidade curta do DB para `sub`s já vistos. Frontend também usa `RouteGate`/`AuthGuard` como defesa em profundidade. | ✅ presente | `AppUserContextCache.ts`; `src/frontend/lib/supabase/middleware.ts:21-25` (comentário sobre defesa em profundidade) |
| Degradation | `conexosIdentityMiddleware` degrada para usuário-robô quando o vínculo Conexos falta (`conexosIdentity.ts:19-31`) — disponibilidade **preservada**, correção **perdida**. Presente como tactic; falta a Detection que a acompanha (ver F-availability-4). | ✅ presente (mas sem detecção) | `src/backend/http/conexosIdentity.ts:29-31` |
| Reconfiguration | Env vars (`AUTH_LEGACY_LOGIN_ENABLED`, `DEV_AUTH_BYPASS`) permitem reconfigurar comportamento sem redeploy de código. Ainda assim, aplicar mudança exige restart do processo Node no Render. | ⚠️ parcial | `src/backend/http/authEnv.ts:44-48,49-52` |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A — não há execução espelhada do fluxo antigo (HS256 do `AuthService`) contra o novo (Supabase) para comparação. Fase 2 do cutover tocaria isso, mas não é tactic *de request*. | N/A | ADR-0030 §6 |
| State Resynchronization | `bootstrapAppContainer()` (`appUserContext.ts:150`) garante container inicializado em cada request; `pool.on('error', () => connectionPool = undefined)` do `PostgreeDatabaseClient` força reconexão lazy após erro fatal do pool. | ✅ presente | `PostgreeDatabaseClient.ts:69-71`; `src/backend/http/appUserContext.ts:150` |
| Escalating Restart | N/A local — Render restart automático em crash é responsabilidade do PaaS. Não medível neste repo. | N/A | — |
| Non-Stop Forwarding | N/A — não há data plane separado do control plane. | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | Ausente. `/health` bare (não verifica downstream) impede o load balancer de tirar uma instância "up mas quebrada" (JWKS/DB inalcançável) do pool. Ver F-availability-2. | ❌ ausente | `src/backend/index.ts:73` |
| Transactions | `withTransaction` no `PostgreeDatabaseClient` disponibiliza escopo transacional atômico (BEGIN/COMMIT/ROLLBACK). `UserAdminService` usa compensação transacional explícita (deleteUser no GoTrue quando o INSERT local falha). | ✅ presente | `PostgreeDatabaseClient.ts:9-18`; `SupabaseAdminClient.ts:105-117,281-284`; `UserAdminService.ts:341` |
| Predictive Model | N/A — não há modelo de predição de falha (nem seria proporcional ao stack). | N/A | — |
| Exception Prevention | Zod nos boundaries (`authEnv`, `goTrueUserSchema`); fail-fast no boot quando config incoerente; `DEV_AUTH_BYPASS` deny-by-default fora de local. **Prevenção real de exceção** por design. | ✅ presente | `src/backend/http/authEnv.ts:30-146`; `SupabaseAdminClient.ts:55-63` |
| Increase Competence Set | N/A — código não aumenta escopo de operação para lidar com falha ampliada. | N/A | — |

## 4. Findings

### F-availability-1: JWKS remoto sem `RetryExecutor`, sem cache persistido e com defaults implícitos da `jose`

- **Severidade**: P1
- **Tactic violada**: Retry (ausente); Passive Redundancy (parcial — falta o `jwksCache` como semente persistida); Monitor (métrica inexistente)
- **Localização**: `src/backend/http/auth.ts:172-177`
- **Evidência (objetiva)**:
  ```ts
  // src/backend/http/auth.ts:172-177
  const jwks: JWTVerifyGetKey | undefined =
      keyResolver ??
      (authEnv.supabaseUrl && issuer
          ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
          : undefined);
  ```
  ```ts
  // node_modules/jose/dist/types/jwks/remote.d.ts:57-69 (defaults efetivos)
  timeoutDuration?: number;   // default 5000 ms
  cooldownDuration?: number;  // default 30 000 ms
  cacheMaxAge?: number;       // default 600 000 ms (10 min)
  ```
  `grep -c RetryExecutor src/backend/http/auth.ts` = **0**.
- **Impacto técnico**: quando o cache de 10 min expira e o próximo fetch coincide com uma janela de indisponibilidade do endpoint `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, o `jwtVerify` lança e o middleware retorna 401 para **todo** token ES256. Não há retry, não há cache persistido em disco/Redis, e o `cooldownDuration` de 30 s impede nova tentativa por 30 s. **Blast radius = 100% do tráfego autenticado ES256** por, no mínimo, o tempo até a próxima chamada com um `kid` desconhecido (governado por `cooldownDuration`) mais a duração da indisponibilidade.
- **Impacto de negócio**: parada completa de operações financeiras (Permutas, SISPAG, Recebimentos) para toda a Columbia enquanto o JWKS não responde. O caminho HS256 legado sobrevive (Passive Redundancy real) enquanto houver tokens HS256 vivos — mas o rollout Fase 2 já emite ES256, então essa proteção morre no tempo.
- **Métrica de baseline**: 0 retries, 5 s timeout, 30 s cooldown, 10 min cacheMaxAge, 1 endpoint dependente, 0 cache persistido, 0 métrica exportada.

### F-availability-2: `/health` não verifica dependências novas — Removal from Service quebrada

- **Severidade**: P2
- **Tactic violada**: Ping/Echo (parcial), Removal from Service (ausente), Self-Test (ausente)
- **Localização**: `src/backend/index.ts:69-73`
- **Evidência (objetiva)**:
  ```ts
  const APP_VERSION = process.env.npm_package_version ?? 'unknown';
  app.get('/health', (_req, res) => res.json({ status: 'ok', version: APP_VERSION }));
  ```
  Não há checagem de `authEnv` carregado, nem `SELECT 1` no Postgres, nem HEAD no JWKS.
- **Impacto técnico**: Render/Vercel usam o `/health` como sinal para restart/reintrodução. Uma instância "up mas quebrada" (Postgres pool esgotado, JWKS 404 após rotação de chave, `SUPABASE_URL` errada em SSM) fica indefinidamente respondendo 401/500 a request real e 200 ao health check. Nada tira essa instância do balanceador.
- **Impacto de negócio**: MTTR alongado durante um incidente causado pelas dependências novas. Operador descobre pela reclamação do usuário, não pelo dashboard.
- **Métrica de baseline**: 1 sinal / ≥ 3 esperados (`authEnv`, DB, JWKS); 0 desses são verificados hoje.

### F-availability-3: `appUserContext` retorna 500 quando DB indisponível para `sub` fora do cache

- **Severidade**: P1
- **Tactic violada**: Retry (o middleware chama `findByAuthUserId` diretamente, sem `RetryExecutor` local — depende só do retry interno do `queryRetryExecutor` do `PostgreeDatabaseClient`); Degradation (ausente — não há resposta graciosa quando cache está frio E DB está fora)
- **Localização**: `src/backend/http/appUserContext.ts:150-201`
- **Evidência (objetiva)**:
  ```ts
  // linhas 150-172
  await bootstrapAppContainer();
  const cache = container.resolve(AppUserContextCache);
  const cached = cache.get(sub);
  if (cached) { ... }
  const repository = container.resolve(UserRepository);
  const context = await repository.findByAuthUserId(sub); // pode lançar
  cache.set(sub, context);
  ```
  Se `findByAuthUserId` lança (DB fora, `queryRetryExecutor` esgotado), o throw sobe para `errorMiddleware.ts:35` → **HTTP 500** genérico. Cache TTL de 30 s salva apenas `sub`s já vistos — um usuário novo (ou após restart do processo, ou após 30 s) sofre o erro completo.
- **Impacto técnico**: durante uma janela de indisponibilidade curta do Postgres, o cache absorve os `sub`s quentes; qualquer login novo ou request cujo TTL expirou volta como 500 (não 401, não retry no cliente). O comportamento é assimétrico: usuários ativos há minutos passam; quem acabou de logar é rejeitado.
- **Impacto de negócio**: percepção de "sistema instável" concentrada em usuários fazendo login no exato momento do soluço — o pior perfil de reclamação para uma operação financeira que abre o dia com todos entrando ao mesmo tempo.
- **Métrica de baseline**: 0 retries no middleware; `queryRetryExecutor` do DB tem 3 retries × ~200 ms + jitter (~1,2 s totais). Cache TTL 30 s = janela absorvida para `sub`s quentes.

### F-availability-4: Degradação silenciosa Conexos (username↔`app_user.username`) sem Condition Monitoring

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring (ausente); Monitor
- **Localização**: `src/backend/http/conexosIdentity.ts:19-31`
- **Evidência (objetiva)**:
  ```ts
  // http/conexosIdentity.ts:19-31 (comentário do próprio código)
  // ## ⚠️ Esta cadeia degrada sem lançar erro
  // Se `platformUsername` deixar de casar com `app_user.username`, `getVinculoConexos` devolve
  // `null` e o sistema **degrada para o usuário-robô**: as baixas `fin010` continuam saindo —
  // atribuídas à máquina. Sem exceção, sem log de erro, sem alarme.
  export const conexosIdentityMiddleware: RequestHandler = (req, _res, next) => {
      const platformUsername = req.user?.username;
      conexosRequestContext.run(platformUsername ? { platformUsername } : {}, () => next());
  };
  ```
- **Impacto técnico**: disponibilidade da funcionalidade é preservada, mas o **ator da trilha de auditoria** (I-Usuario-1) fica errado. É uma classe rara de falha em availability: o sistema "funciona" e é justamente por isso que o defeito não gera alarme. Nenhum contador é exportado, nenhum log é emitido, nenhuma condição de saúde reflete a degradação.
- **Impacto de negócio**: perda de rastreabilidade de escrita financeira. Como o próprio ADR-0030 aponta, essa cadeia degradada é o principal risco de qualidade do cutover — e a única maneira de detectá-la hoje é auditoria manual das baixas `fin010`.
- **Métrica de baseline**: 0 counter de "fallback para robô por request autenticada", 0 log de warning, 0 alerta. Detecção instrumental = 0.

### F-availability-5: `SupabaseAdminClient.createClient` sem timeout / retry no caminho de request

- **Severidade**: P2
- **Tactic violada**: Retry, Exception Prevention (parcial), Timeout (nome informal — na taxonomia Bass entra em Ignore Faulty Behavior + Exception Detection)
- **Localização**: `src/backend/domain/client/SupabaseAdminClient.ts:132-145`; consumido em `src/backend/http/appUserContext.ts:122`
- **Evidência (objetiva)**:
  ```ts
  // SupabaseAdminClient.ts:141-144
  this.client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
  });
  ```
  Não há `global.fetch` custom com `AbortController`; `@supabase/supabase-js` chama o `fetch` do runtime sem timeout específico. Nenhuma chamada da Admin API é envolvida em `RetryExecutor`.
- **Impacto técnico**: no caminho `convite_pendente` (`appUserContext.ts:122`, chamada `getUserById(sub)` a cada request enquanto o titular não confirma o e-mail), um Supabase Admin lento prende o event loop pelo tempo do fetch default do Node (sem timeout explícito). O fail-closed é intencional (403 pendente), mas o **tempo** até o 403 depende do runtime, não do código.
- **Impacto de negócio**: durante rollout Fase 1/2 (a janela em que existem usuários com `convite_pendente = true`), uma degradação de latência do GoTrue afeta especificamente os usuários que ainda estão migrando — os menos tolerantes. Fora do rollout: 0 impacto.
- **Métrica de baseline**: 0 timeout explícito, 0 retry envelope, 1 chamada por request no branch `convite_pendente`.

### F-availability-6: Frontend `middleware.ts` chama `supabase.auth.getUser()` a cada navegação sem timeout/fallback

- **Severidade**: P2
- **Tactic violada**: Ignore Faulty Behavior (ausente), Degradation (ausente)
- **Localização**: `src/frontend/lib/supabase/middleware.ts:27-60`; ativado por `src/frontend/middleware.ts` em todas as rotas não-estáticas
- **Evidência (objetiva)**:
  ```ts
  // lib/supabase/middleware.ts:48-50
  const {
      data: { user },
  } = await supabase.auth.getUser()
  ```
  Sem `AbortController`, sem try/catch — se o `getUser()` lança (rede caiu), o middleware do Next propaga o erro e a navegação estoura.
- **Impacto técnico**: um soluço no GoTrue trava a navegação SSR inteira — todas as rotas não-estáticas do frontend. Não há caminho gracioso "trata como anônimo, deixa `RouteGate` decidir".
- **Impacto de negócio**: janela de navegação inutilizável para todo usuário do frontend enquanto o GoTrue tossir. `RouteGate`/`AuthGuard` client-side continuariam funcionando se a request SSR chegasse a renderizar — mas ela não chega, porque o middleware falha antes.
- **Métrica de baseline**: 0 timeout, 0 fallback, 1 chamada por navegação SSR.

### F-availability-7: Cache local + single-instance é premissa de disponibilidade que envelhece silenciosamente

- **Severidade**: P3
- **Tactic violada**: Reconfiguration (parcial — a mudança para multi-instância não dispara nenhum alerta de arquitetura)
- **Localização**: `src/backend/domain/service/auth/AppUserContextCache.ts:26-42`
- **Evidência (objetiva)**: o comentário da classe declara literalmente a premissa datada (`2026-08-06`) e o modo de falha:
  ```ts
  // AppUserContextCache.ts:28-36 (comentário)
  // A invalidação é **local ao processo**, e isso só é **suficiente** porque o backend roda
  // em **Render `plan: starter` — instância única** (`render.yaml`).
  // No dia em que houver mais de uma instância, a invalidação deixa de cruzar processos e a
  // latência real de revogação vira o **TTL cheio — sem erro, sem log, sem alarme**.
  ```
- **Impacto técnico**: no dia em que alguém sobe o plano do Render, a latência de revogação silenciosamente passa dos ≤ 30 s (documentados) para o TTL cheio no pior caso, sem qualquer sinal técnico da mudança. É uma dívida documentada mas sem *tripwire*.
- **Impacto de negócio**: revogação de acesso (I-Usuario-8) deixa de valer o SLO declarado. Fora do escopo desta feature resolver — a premissa é aceita — mas registrar como finding torna a dívida rastreável.
- **Métrica de baseline**: 1 instância (`render.yaml`), TTL 30 000 ms; sem instrumento que dispare quando `plan` ≠ `starter`.

## 5. Cards Kanban

### [availability-1] Blindar o fetch do JWKS com cache persistido + retry + observabilidade

- **Problema**
  > O `createRemoteJWKSet(new URL(...))` em `http/auth.ts:176` usa todos os defaults da `jose` (`timeoutDuration=5s`, `cooldownDuration=30s`, `cacheMaxAge=10min`) e não é envolvido em `RetryExecutor`. Quando o cache expira coincidindo com indisponibilidade do endpoint JWKS, TODO tráfego ES256 volta 401. Blast radius = 100% do tráfego autenticado do sistema — não uma request, a aplicação inteira.

- **Melhoria Proposta**
  > (1) Passar `options` explícitas a `createRemoteJWKSet`: `cacheMaxAge: 3_600_000` (1 h) e `cooldownDuration: 10_000` (10 s para permitir re-tentativas mais rápidas em falha). (2) Envolver o `jwtVerify(token, jwks, jwksOptions)` no path assimétrico em `RetryExecutor` com `retries: 2`, `delayMs: 300`, `jitterMs: 300`, `shouldRetry` restrito a `errors.JWKSNoMatchingKey` e erros de rede — nunca a `errors.JWSInvalid` (que é rejeição legítima). (3) Persistir o `jwksCache` (Bass: Passive Redundancy) via `jose.jwksCache` símbolo — semear a partir de um valor no filesystem/Redis para sobreviver a restart. (4) Instrumentar `jose.jwks()` num log periódico para expor "idade do cache".

- **Resultado Esperado**
  > Uma janela de indisponibilidade do JWKS ≤ 10 s é absorvida sem 401 para o usuário. O sistema tolera até `cacheMaxAge = 1 h` de indisponibilidade contínua para tokens cujo `kid` já foi visto. Métricas observáveis: `retries no JWKS: 0 → média mensurável`, `cacheMaxAge: 10min → 60min`, `cache persistido: não → sim`.

- **Tactic alvo**: Retry + Passive Redundancy + Monitor
- **Severidade**: P1
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - `cacheMaxAge` do JWKS: 600 000 ms → 3 600 000 ms
  - Retries envelope no path ES256: 0 → 2
  - Cache persistido do JWKS: ausente → presente (`jose.jwksCache`)
  - Log estruturado "JWKS idade": ausente → 1 linha por hora
- **Risco de não fazer**: um único deploy do Supabase que rotacione as chaves de sinal e falhe o hosting do JWKS por 90 s vira uma outage de 100% da autenticação, com o operador descobrindo pelo suporte.
- **Dependências**: nenhuma

### [availability-2] Aprofundar `/health` para incluir `authEnv` + Postgres + JWKS

- **Problema**
  > `/health` em `src/backend/index.ts:73` retorna `{status:'ok'}` sem verificar nenhuma dependência. Uma instância cujo `authEnv` boot passou mas cujo Postgres está inalcançável (pool esgotado) ou cujo JWKS foi mal configurado (`SUPABASE_URL` errada em SSM) continua respondendo 200 no health check enquanto responde 500/401 nas rotas reais. O balanceador do Render não tem como tirar essa instância do pool.

- **Melhoria Proposta**
  > Criar `/health/ready` (readiness) além do `/health` (liveness). O readiness executa: (a) `SELECT 1` no `PostgreeDatabaseClient` com timeout de 2 s, (b) `HEAD ${SUPABASE_URL}/auth/v1/.well-known/jwks.json` com timeout de 2 s se `authEnv.supabaseUrl` estiver setado, (c) verifica que `loadAuthEnv()` já foi executado. Envolver cada check em `RetryExecutor(retries: 1, delayMs: 100)` para não flappar. Retornar 503 quando qualquer sinal crítico falhar. Manter `/health` bare para liveness (só sinaliza que o processo está de pé).

- **Resultado Esperado**
  > O Render (ou operador humano) consegue detectar "up mas quebrado" e agir (restart / rollback / alarme). MTTR de "operador descobre pelo suporte" → "operador descobre pelo dashboard" mensurável em produção.

- **Tactic alvo**: Ping/Echo + Removal from Service + Self-Test
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Sinais checados no readiness: 0 → 3 (authEnv, DB, JWKS)
  - Detecção de "up mas quebrado": ausente → presente
- **Risco de não fazer**: um incidente de dependência que dure horas passa despercebido do dashboard porque `/health` está verde.
- **Dependências**: nenhuma

### [availability-3] Absorver soluços curtos do Postgres no `appUserContext` (Retry + Degradation controlada)

- **Problema**
  > `appUserContext` (`http/appUserContext.ts:169`) chama `repository.findByAuthUserId(sub)` sem envelope de retry local; um throw do repositório sobe para o `errorMiddleware` como 500 opaco. O cache absorve indisponibilidade curta apenas para `sub`s já vistos. Um usuário logando durante um soluço do Postgres recebe 500 no exato momento em que o resto do time (com cache quente) continua trabalhando — assimetria péssima de percepção.

- **Melhoria Proposta**
  > (1) Envolver o `findByAuthUserId` no middleware num `RetryExecutor` local (`retries: 2, delayMs: 200, jitterMs: 200`) — o retry do `queryRetryExecutor` do client já cobre transientes de pool, mas um envelope explícito no middleware isola a decisão de UX. (2) Em caso de falha final, responder **503 Service Unavailable** com `Retry-After: 5` em vez de 500 genérico — comunica retentativa ao cliente. (3) Instrumentar contador de cache-hit ratio (log periódico ou endpoint interno `/health/cache`).

- **Resultado Esperado**
  > Soluços de ≤ 400 ms do Postgres passam invisíveis para o usuário novo (não apenas para o com cache quente). Usuário afetado por indisponibilidade real recebe 503+`Retry-After` (retryable) em vez de 500 (fatal para o SPA).

- **Tactic alvo**: Retry + Exception Handling + Degradation
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Retries no middleware `appUserContext`: 0 → 2
  - Código HTTP de indisponibilidade: 500 → 503 + `Retry-After`
  - Cache-hit ratio: não medido → 1 log por 60 s
- **Risco de não fazer**: janela em que "logo o time inteiro cai" no login concentra 500 nos usuários mais visíveis do dia (analistas fazendo o abrir do dia financeiro).
- **Dependências**: nenhuma

### [availability-4] Condition Monitoring para a degradação silenciosa Conexos (username↔`app_user.username`)

- **Problema**
  > A cadeia `conexosIdentityMiddleware` (`http/conexosIdentity.ts:19-31`) degrada intencionalmente para o usuário-robô quando `platformUsername` é ausente **ou** quando ele existe mas `getVinculoConexos` retorna `null`. O comentário do próprio arquivo declara que essa degradação "não lança erro, não emite log de erro, não dispara alarme". Do ponto de vista de availability, é uma tactic de Degradation SEM a tactic de Detection que a acompanha.

- **Melhoria Proposta**
  > (1) Emitir log estruturado `[degradation] conexos-identity fallback-to-robot sub=<x> username=<y|absent> reason=<vinculo-null|username-absent>` no `ConexosSessionResolver` (não no middleware — o middleware não tem visibilidade do resultado do `getVinculoConexos`). (2) Expor contador acumulado (in-process, resetável) e loggá-lo por hora. (3) Adicionar teste que garanta que TODO fallback para robô produz exatamente um log estruturado.

- **Resultado Esperado**
  > A degradação continua acontecendo (é intencional), mas passa a ser **detectável** — cabe no dashboard e é grepável em produção. Baixas `fin010` atribuídas ao robô ganham rastro técnico correlacionável com o `sub` do usuário logado.

- **Tactic alvo**: Condition Monitoring + Monitor
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Instrumentação de fallback-para-robô: 0 → 1 log estruturado por ocorrência
  - Contador `conexos_identity_fallback_total`: ausente → exportado
- **Risco de não fazer**: o principal risco de qualidade do cutover (ADR-0030) continua invisível — auditoria manual das baixas `fin010` é o único mecanismo de detecção.
- **Dependências**: cruza com o QA de Security (autoria da trilha) — sinalizar ao consolidator.

### [availability-5] Timeout explícito + fallback gracioso no `middleware.ts` do frontend

- **Problema**
  > `updateSession` (`src/frontend/lib/supabase/middleware.ts:48-50`) chama `supabase.auth.getUser()` a cada navegação SSR sem timeout e sem try/catch. Um soluço no GoTrue faz o middleware do Next lançar, e a navegação inteira quebra — todas as rotas não-estáticas do frontend. O `RouteGate`/`AuthGuard` client-side (defesa em profundidade documentada) nunca chega a ser exercitado porque o SSR não completa.

- **Melhoria Proposta**
  > Envolver `getUser()` num `Promise.race` com `AbortController` + timeout de 3 s. Em caso de timeout OU throw, tratar como "usuário não confirmado neste request" — não redirecionar para `/login` em rota autenticada (para não prender ninguém fora), mas **deixar a page renderizar** e delegar ao `AuthGuard` client-side (que tem cookies do browser e pode revalidar). Log estruturado `[middleware] supabase-getuser-timeout`.

- **Resultado Esperado**
  > Frontend continua navegável durante indisponibilidade curta do GoTrue; a defesa em profundidade cliente-side (`RouteGate`/`AuthGuard`) que a própria doc do middleware promete finalmente tem chance de atuar.

- **Tactic alvo**: Ignore Faulty Behavior + Degradation
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-6
- **Métricas de sucesso**:
  - Timeout em `getUser()`: nenhum → 3 s
  - Comportamento em falha: 500 do Next → renderização degradada + log
- **Risco de não fazer**: soluços curtos do GoTrue viram outage de navegação para o usuário final, mesmo com o backend saudável.
- **Dependências**: nenhuma

### [availability-6] Timeout + envelope de retry no `SupabaseAdminClient` para o caminho de request

- **Problema**
  > `SupabaseAdminClient.createClient` (`SupabaseAdminClient.ts:141-144`) não configura `fetch` custom com `AbortController` nem timeout, e nenhuma das chamadas Admin API é envolvida em `RetryExecutor`. A superfície mais crítica é `getUserById(sub)` em `appUserContext.ts:122` (branch `convite_pendente`), executada por request enquanto o titular não confirma o e-mail — janela do rollout Fase 1/2.

- **Melhoria Proposta**
  > (1) Injetar um `fetch` custom em `createClient({ global: { fetch: fetchWithTimeout(5000) } })` usando `AbortController`. (2) Envolver especificamente `getUserById` num `RetryExecutor(retries: 2, delayMs: 200, jitterMs: 200, shouldRetry: notFatal)` — jamais retentar `SupabaseUserNotFoundError` (semanticamente correto) nem `SupabaseEmailAlreadyExistsError` (rejeição legítima). (3) `invite`/`createUser`/`setBanned`/`deleteUser` NÃO ganham retry (não são idempotentes) — só timeout.

- **Resultado Esperado**
  > Latência do caminho `convite_pendente` limitada a 5 s por tentativa, retentativa 2× ao total. Chamadas administrativas (fora do path de request) tornam-se auditáveis pelo timeout consistente.

- **Tactic alvo**: Retry (path de request) + Ignore Faulty Behavior (via timeout)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Timeout no `SupabaseAdminClient`: nenhum → 5 s por chamada
  - Retries em `getUserById` (idempotente): 0 → 2
  - Retries em `invite/create/setBanned/delete` (não-idempotentes): 0 → 0 (preservar)
- **Risco de não fazer**: usuários em `convite_pendente` acumulam requests pendentes durante um soluço do GoTrue, exaurindo o pool de conexões HTTP outbound do Render.
- **Dependências**: nenhuma

### Nota: F-availability-7 não gera card

F-availability-7 é uma **dívida documentada e aceita** (o próprio código anota como `⚠️ Restrição
datada (2026-08-06)` em `AppUserContextCache.ts:26-42`). Está fora do escopo desta feature resolver
— existe um follow-up de arquitetura (`business-rules/revogacao-de-acesso.md`) já registrado. O
finding entra aqui só para não sumir do radar em revisões futuras: quando o plano do Render mudar,
esta linha tem que reaparecer.

## 6. Notas do agente

- **Escopo**: mediu apenas as superfícies novas da feature `supabase-auth`. Achados pré-existentes
  listados em `_shared-metrics.md` (`filialAuthz` fail-OPEN, `CONEXOS_CRED_ENC_KEY` manual, SMTP não
  configurado, 17 testes de Frente IV pré-existentes falhando) NÃO foram re-reportados. F-availability-4
  (degradação silenciosa Conexos) é distinto do achado pré-existente sobre `CONEXOS_CRED_ENC_KEY`: o
  gatilho é outro (mismatch `username`↔`app_user.username`, não SecretCipher desabilitado).
- **Métricas de produção não coletadas** (declaradas na §2): MTTR real, p99 do JWKS, taxa de cache-hit
  do `AppUserContextCache`, presença de alarmes CloudWatch. Não há `infra/` neste repo — nenhuma tactic
  foi rebaixada por conta disso; foram marcadas N/A com justificativa.
- **Cross-QA para o consolidator**: (a) F-availability-4 (fallback silencioso para robô) cruza com
  **Security** (integridade da trilha de auditoria — I-Usuario-1) e com **Testability** (fácil de
  cobrir com teste-guarda). (b) [availability-2] (`/health` profundo) cruza com **Deployability**
  (readiness real do Render). (c) [availability-1] (JWKS resiliente) cruza com **Performance** (o
  timeout de 5 s da `jose` está no caminho de request — impacto de p99).
- **Score 5/10**: as tactics presentes (Passive Redundancy dupla via HS256/ES256 + cache TTL, Retry
  no DB, Exception Handling central, Transactions, Exception Prevention no boot) equilibram as
  ausentes (Removal from Service, Self-Test, Condition Monitoring, Retry no path novo). A nota
  não pode subir enquanto o JWKS — a superfície de maior blast radius adicionada — não tiver retry
  nem cache persistido.
