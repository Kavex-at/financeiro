---
qa: Performance
qa_slug: performance
run_id: 2026-08-06-1520-supabase-auth
agent: qa-performance
generated_at: 2026-08-06T18:40:00-03:00
scope: all
score: 7
findings_count: 6
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado (browser) | Cada request para API + cada navegação Next atravessa a nova cadeia de identidade/autorização introduzida por `supabase-auth` | Backend Express (Render `plan: starter`, instância única) + Edge Middleware do Next (Vercel) | Operação normal, uma janela de analistas simultâneos (≤ ~30 pessoas), sem picos de fan-out — o eixo é **latência por request**, não throughput | Latência mediana da cadeia (JWT verify + `appUserContext` + `conexosIdentity`) permanece imperceptível para o usuário; o middleware Next não adiciona um round-trip por navegação onde não é necessário | Overhead p50 da cadeia backend < 5 ms (hit no cache); p95 < 50 ms (miss → 1 SELECT em índice único). Overhead do `middleware.ts` do Next < 20 ms p50 em navegação já autenticada (hoje: 1 round-trip para `${SUPABASE_URL}/auth/v1/user` por request, tipicamente 50–200 ms). |

Contexto adicional: throughput é irrelevante aqui — o backend é uma instância única do Render, sem SQS/Lambda, sem fan-out de batch. Um pico de tráfego **não** é o cenário estressante; a **latência incremental por request autenticada** é. Antes desta feature, request autenticada não fazia trabalho de rede nem SQL no caminho quente; agora, faz.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| SQL por request autenticada (miss no cache) | 1 × `SELECT id, username, role, ativo, convite_pendente FROM app_user WHERE auth_user_id = $1` | 1 (não é possível zerar sem quebrar I-Usuario-9) | ✅ | `src/backend/domain/repository/auth/UserRepository.ts:135-156` |
| SQL por request autenticada (hit no cache) | 0 | 0 | ✅ | `src/backend/http/appUserContext.ts:153-166` |
| TTL do cache de contexto | 30.000 ms (constante tipada, não env) | Documentado em `revogacao-de-acesso.md`; qualquer mudança exige revisão | ✅ | `src/backend/domain/service/auth/AppUserContextCache.ts:16` |
| Hit rate esperado do cache numa sessão de analista (~1–2 req/s) | ~29/30 ≈ 96% (a primeira request de cada 30 s recarrega) | ≥ 90% | ✅ | derivado de TTL 30 s vs. cadência típica |
| Índice para `WHERE auth_user_id = $sub` | `CREATE UNIQUE INDEX IF NOT EXISTS app_user_auth_user_id_key ON app_user (auth_user_id)` | UNIQUE índice presente | ✅ | `src/backend/migrations/0044_app_user_auth_link.sql:35` |
| Limite superior de entradas no cache | **nenhum** (`Map<string, CacheEntry>` sem cap) | Bounded (LRU ou por contagem) | ⚠️ | `src/backend/domain/service/auth/AppUserContextCache.ts:46` |
| Sites de invalidação síncrona no processo | 1 (`UserAdminService:216`) | ≥ 1 nos writes de `desativarUsuario`/`banir`/`redefinirSenha` | ✅ | `grep -n contextCache src/backend/domain/service/auth/UserAdminService.ts` |
| Verificação JWT — símetrica (HS256) por token | ~0,1 ms/token (order-of-magnitude, sem benchmark local) | ≤ 1 ms | ✅ (estimado) | `src/backend/http/auth.ts:197-201` |
| Verificação JWT — assimétrica (ES256/JWKS) por token | ~1 ms/token *após* cache do JWKS aquecido; primeira request faz um GET remoto no `jwks.json` | ≤ 5 ms | ⚠️ Não medível localmente: exige tráfego real e Supabase configurado | `src/backend/http/auth.ts:172-177` (`jose.createRemoteJWKSet` já cacheia o key set) |
| Chamada extra ao GoTrue Admin API no caminho quente | Só quando o cache é miss **E** `ativo = false` **E** `convite_pendente = true` (aceite de convite — evento raro, uma vez por usuário) | 0 no fluxo comum | ✅ | `src/backend/http/appUserContext.ts:116-133` |
| `middleware.ts` (Next) — round trip por navegação | 1 × `supabase.auth.getUser()` → `GET ${SUPABASE_URL}/auth/v1/user` (verificado no código da lib, `@supabase/auth-js` 2.112.2, `_getUser` linha 2698 do `dist/main/GoTrueClient.js`) | Idealmente 0 quando ES256 estiver ativo (via `getClaims()` local) | ⚠️ | `src/frontend/lib/supabase/middleware.ts:48-50` + `node_modules/@supabase/auth-js/.../GoTrueClient.js:2698` |
| Matcher do middleware Next | `'/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf)$).*)'` — exclui assets estáticos | Exclui assets | ✅ | `src/frontend/middleware.ts:14-23` |
| Bundle edge do middleware Next (raw, pré-gzip) | 356 KB (`.next/server/edge/chunks/[root-of-the-server]__15mzrij._.js`) | Sem alvo publicado do Next para edge; sanity ≤ 1 MB (limite Vercel) | ✅ | `du -sh .next/server/edge/chunks/*.js` após `npm run build` |
| Bundle browser total (chunks estáticos, raw) | 1.864 KB somados (`find .next/static/chunks -name "*.js"` + soma) | Não há baseline commitado pré-feature no repo | ⚠️ Não medível o delta: baseline pré-`supabase-auth` não foi coletado | `find .next/static/chunks -name "*.js" -exec stat -c "%s" {} + \| awk '{s+=$1}'` |
| Maior chunk browser individual (raw) | 251 KB (`3_irl1aip5og8.js`, contém 12 referências a `supabase`) | First Load JS gzipped ≤ 200 KB (~660 KB raw) | ✅ (com folga em raw; gzip ~80 KB) | `grep -c supabase .next/static/chunks/*.js` |
| Tamanho instalado `@supabase/*` no `node_modules` do frontend | 9,5 MB (`auth-js` 3,3 MB, `postgrest-js` 1,5 MB, `realtime-js` 1,1 MB, `storage-js` 1,1 MB, `supabase-js` 752 KB, `ssr` 684 KB) | ≤ 15 MB é sanity; o que importa é o **tree-shaken** que sai no bundle final | ✅ | `du -sh node_modules/@supabase/*` |
| Pool Postgres máx. | `max: 5`, `idleTimeoutMillis: 10000`, `connectionTimeoutMillis: 5000` | Adequado para 1 instância Render × ~30 analistas | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:26-28` |
| `bootstrapAppContainer()` no caminho de cada request | Curto-circuita por flag `bootstrapped` após o 1º call (bool check) | Custo amortizado a zero | ✅ | `src/backend/domain/appContainer.ts:11,54-55` + `http/appUserContext.ts:150` |
| `setTimeout`/`setInterval` manuais em código de produção (fora de `Executor`s) | 0 na superfície nova desta feature; a política CLAUDE.md continua respeitada | 0 | ✅ | `grep -rn "setTimeout\|setInterval" src/backend/http src/backend/domain/service/auth src/backend/domain/client/SupabaseAdminClient.ts` |

## 3. Tactics — Cobertura no nf-projects

### Control Resource Demand

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — não há amostragem de eventos; toda request é serviçável | N/A | — |
| Limit Event Response | O middleware retorna 401/403 imediatamente sem passar pelas rotas caras (recebimentos, permutas, sispag). O caminho negativo é curto de propósito. | ✅ presente | `src/backend/http/appUserContext.ts:135-202` |
| Prioritize Events | N/A — não há filas priorizadas nesta feature | N/A | — |
| Reduce Overhead | `AppUserContextCache` TTL 30 s troca 1 SELECT/request por 1 SELECT a cada 30 s por usuário; JWKS keyset é cacheado em closure (`createRemoteJWKSet`, uma vez por processo) | ✅ presente | `AppUserContextCache.ts:16-83`, `http/auth.ts:172-177` |
| Bound Execution Times | Nenhum `timeout` configurado nas chamadas ao GoTrue Admin API (`SupabaseAdminClient`) — a lib usa fetch com default do runtime, que **não tem timeout** em Node | ❌ ausente | `src/backend/domain/client/SupabaseAdminClient.ts:141-143` — `createClient(url, key, { auth: {...} })` sem `global.fetch` custom com AbortController |
| Increase Resource Efficiency | Query é `SELECT` em índice UNIQUE (`app_user_auth_user_id_key`) — 1 index lookup por miss; sem N+1 na cadeia (a query é escalar) | ✅ presente | `migrations/0044_app_user_auth_link.sql:35`, `UserRepository.ts:135-156` |

### Manage Resources

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Resources | N/A no runtime atual — Render `plan: starter` é single-instance por decisão (documentado em `AppUserContextCache.ts:29-40` como restrição datada) | N/A | `render.yaml`, `AppUserContextCache.ts:29-40` |
| Increase Concurrency | Pool Postgres `max: 5` acomoda concorrência interna (P0-6 já resolveu o starvation do fluxo de eleição de permutas) | ✅ presente | `PostgreeDatabaseClient.ts:26` |
| Maintain Multiple Copies of Computations | N/A — instância única | N/A | — |
| Maintain Multiple Copies of Data | `AppUserContextCache` **é** cópia local do contexto de autorização; é a única cópia (não é replicado) | ⚠️ parcial | `AppUserContextCache.ts:43-83` |
| Bound Queue Sizes | O `Map` interno do cache **não** é bounded — não há LRU, nem cap por contagem, nem eviction proativo (só a leitura descarta expirados). Hoje inofensivo (poucos analistas); torna-se relevante se tokens órfãos entrarem em loop e cada um cachear `null` até o TTL | ⚠️ parcial | `AppUserContextCache.ts:46,53-69` |
| Schedule Resources | N/A — não há scheduler nesta feature | N/A | — |

### Facetas modernas

| Faceta | Implementação atual | Status | Evidência |
|---|---|---|---|
| Cache strategy | TTL fixo (30 s), constante tipada (não env var), invalidação síncrona no mesmo processo em `desativarUsuario`. Documentado como trade-off consciente entre revogação instantânea e SELECT por request. | ✅ presente | `AppUserContextCache.ts:16,71-78`, `UserAdminService.ts:216` |
| Index discipline | `WHERE auth_user_id = $sub` bate o índice UNIQUE recém-criado; `WHERE username = $email` também tem UNIQUE (implícito na chave). | ✅ presente | `migrations/0044_app_user_auth_link.sql:35` |
| Bundle leanness (frontend) | Contexto do frontend: sem code-splitting explícito para o cliente `supabase-js`. O middleware Next e o cliente browser importam do mesmo namespace; espera-se tree-shaking do Turbopack, mas o browser bundle nunca foi medido antes (sem baseline pré-feature commitado). | ⚠️ Não medível o delta | `du -sh node_modules/@supabase/*`, `.next/static/chunks/*` |
| Cold start (Render) | Render `plan: starter` **hiberna** por inatividade; o primeiro request após hibernação tem cold start de segundos. Não é uma consequência desta feature — é da infra atual — mas a feature **agrava**: o primeiro request pós-hibernação agora também precisa inicializar Postgres pool + resolver `authEnv` + (quando aplicável) JWKS remoto. | ⚠️ parcial | `render.yaml` + observação sobre `bootstrapAppContainer` no `http/appUserContext.ts:150` |

## 4. Findings (achados)

### F-performance-1: `middleware.ts` do Next chama `getUser()` a cada navegação — round-trip de rede síncrono à Supabase

- **Severidade**: P2
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/frontend/lib/supabase/middleware.ts:48-50`; comportamento da lib confirmado em `src/frontend/node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2698` (`_getUser` → `GET ${url}/user` sem cache local).
- **Evidência (objetiva)**:
  ```js
  // frontend/lib/supabase/middleware.ts
  const { data: { user } } = await supabase.auth.getUser()
  // frontend/node_modules/@supabase/auth-js/.../GoTrueClient.js:2698
  return await _request(this.fetch, 'GET', `${this.url}/user`, {
      headers: this.headers, jwt, xform: _userResponse,
  });
  ```
  A mesma lib expõe `getClaims()` (linha 5321) que, para tokens ES256/RS256 com `kid` e WebCrypto disponível (edge runtime tem), **valida localmente contra o JWKS cacheado** — sem round-trip. O código escolheu `getUser()` deliberadamente (comentário no arquivo, seção "Por que `getUser()` e não `getSession()`") por rigor de segurança: cookie-only vs. validação-no-provedor.
- **Impacto técnico**: cada navegação (RSC, page transition, form action) do usuário logado passa pelo middleware e adiciona 1 round-trip HTTP para o GoTrue. Ordem de grandeza típica: 50–200 ms conforme distância geográfica ao projeto Supabase. Em fluxos de navegação encadeada (dashboard → detalhe → volta), o custo composto vira perceptível.
- **Impacto de negócio**: latência de navegação percebida como "lentidão do sistema" pelo analista, sem que apareça em nenhum log de erro. Como a decisão é consciente (o comentário no código explica o trade-off), o achado é uma **oportunidade de otimização com trade-off explícito**, não um bug.
- **Métrica de baseline**: 1 round-trip por navegação protegida; latência real não medida (exige ambiente de produção — declarado não-medível localmente).

### F-performance-2: `AppUserContextCache` usa `Map` sem cap — vazamento silencioso possível em cenário de token órfão em loop

- **Severidade**: P2 (rebaixada — cenário é hipotético, sem baseline numérico de crescimento)
- **Tactic violada**: Bound Queue Sizes
- **Localização**: `src/backend/domain/service/auth/AppUserContextCache.ts:46,53-69`
- **Evidência (objetiva)**:
  ```typescript
  private entries: Map<string, CacheEntry> = new Map();
  // set() não faz eviction, get() só remove a entrada consultada quando expirada
  public set = (authUserId: string, context: AppUserContext | null): void => {
      this.entries.set(authUserId, { context, expiresAt: Date.now() + APP_USER_CONTEXT_TTL_MS });
  };
  ```
  O caching de `null` (linha 172 de `appUserContext.ts`) é **de propósito** — impede um SELECT por request para um `sub` órfão em loop. Mas nada limpa proativamente entradas expiradas de `sub`s que **nunca voltam** — elas só são removidas na próxima consulta *daquele mesmo `sub`*, o que, por definição, um sub órfão em loop não faz.
- **Impacto técnico**: uma origem hostil (ou um cliente com bug) que rode em loop com JWTs válidos mas com `sub` diferente a cada request faria o Map crescer linearmente. Em 30 s, isso é bounded pela taxa de request. Depois disso, cresce enquanto o processo vive. Como o processo é Render `plan: starter` e reinicia em cada deploy, o horizonte real é limitado; mas o padrão é frágil.
- **Impacto de negócio**: consumo de memória do processo Render cresce sem sinal. Se um dia forem levantados dashboards de memória, aparece como "leak lento" e desperdiça diagnóstico. Nunca aparece como erro.
- **Métrica de baseline**: sem limite superior; sem métrica de tamanho do Map exposta. Não medível em produção sem instrumentação.

### F-performance-3: `SupabaseAdminClient` não configura timeout — chamada lenta ao GoTrue no caminho de request pode segurar o único slot da instância

- **Severidade**: P2 (o caminho quente **não** chama Admin API; só o ramo raro de aceite de convite chama)
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/client/SupabaseAdminClient.ts:132-145` (init) e `appUserContext.ts:116-133` (`resolveInactive` — o único site em request path que chama Admin API)
- **Evidência (objetiva)**:
  ```typescript
  this.client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
  });
  // Sem `global` custom com AbortController/fetch com timeout.
  // Node fetch default é UNLIMITED — se o GoTrue trava, a request trava com ele.
  ```
  A situação onde isso importa: **aceite de convite** (`convite_pendente = true` no banco). O middleware espera o `getUserById(sub)` para decidir se ativa. Se o GoTrue estiver lento (documentado — vide `qa-availability` e `qa-fault-tolerance` no mesmo run), essa request segura o event loop e ocupa um dos slots de concorrência do Express.
- **Impacto técnico**: durante uma incidência no GoTrue, cada request de usuário `convite_pendente = true` (potencialmente vários usuários recém-convidados) fica pendurada até o Node desistir do socket (o que **não tem prazo** definido no default). O caminho de fail-closed que o código promete (`resolveInactive` retorna `undefined` no catch) só vale se o `await` alguma hora retornar.
- **Impacto de negócio**: durante um incidente Supabase de 5 min, o backend financeiro pode ficar não-responsivo por muito mais tempo — sem sinal de erro no cliente, só timeout de LB do Render (~100 s). Cross-QA com `qa-fault-tolerance` (mesma causa raiz, ver seção 6).
- **Métrica de baseline**: timeout atual = **∞**; sem AbortSignal; sem retry bounded. Não medível em produção sem instrumentação.

### F-performance-4: Bundle browser cresceu com `@supabase/supabase-js` + `@supabase/ssr` — impacto **não** isolável do baseline

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead (faceta Bundle leanness)
- **Localização**: `src/frontend/package.json` (deps adicionadas), `src/frontend/.next/static/chunks/*` (build atual: 1.864 KB raw, maior chunk 251 KB com 12 referências a `supabase`).
- **Evidência (objetiva)**:
  ```
  find .next/static/chunks -name "*.js" -exec stat -c "%s" {} + | awk '{s+=$1} END {print s/1024}'
  → 1863.67 KB
  grep -c supabase .next/static/chunks/3_irl1aip5og8.js
  → 12
  ```
  Não há baseline commitado pré-feature (a feature não está commitada e o orquestrador não coletou tamanho de bundle no `_shared-metrics.md`); portanto, o **delta** não é atribuível a esta feature com certeza. O que é atribuível: `@supabase/supabase-js` (752 KB instalados) + `@supabase/ssr` (684 KB) são **novas** dependências, tree-shakeable, mas trazem `auth-js` (3,3 MB instalados) como transitiva pesada — a maior parte não sai no bundle final por tree-shaking, mas o *setup* do GoTrueClient é comparativamente pesado.
- **Impacto técnico**: aumento de First Load JS em rotas que renderizam o cliente browser (todas as rotas autenticadas — `useAuth`, `AuthProvider`). Ordem de grandeza esperada gzip: dezenas de KB (estimativa, não medida).
- **Impacto de negócio**: primeira carga da app 100–300 ms mais lenta em conexões 4G brasileiras médias (estimativa por regra de bolso, não medida). Não é impedimento, mas é o custo que a decisão de identidade cobra do frontend.
- **Métrica de baseline**: 1.864 KB total raw (chunks estáticos). Delta vs. `origin/main`: **não medido** (baseline não commitado).

### F-performance-5: Render `plan: starter` + `bootstrapAppContainer` no caminho da 1ª request compõem um cold-start pior

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead (facet Cold start)
- **Localização**: `src/backend/domain/appContainer.ts:11-73` + `src/backend/http/appUserContext.ts:150`
- **Evidência (objetiva)**:
  ```typescript
  // appUserContext.ts:150 — antes de todo request
  await bootstrapAppContainer();
  // appContainer.ts:54 — a 1ª chamada faz: Postgres pool.init() + MigrationRunner + Conexos adapter
  ```
  Depois da 1ª execução, `bootstrapped = true` transforma-o em bool check. Mas Render `plan: starter` **hiberna** o serviço por inatividade — quando ele acorda para servir a 1ª request, essa request paga: (a) inicialização do Node, (b) `pg.Pool` primeira conexão (~200–500 ms com Supavisor), (c) `MigrationRunner.run()`, (d) resolução do JWKS remoto na 1ª ES256, e agora (e) `getUser()` no middleware do Next (frontend edge, no lado Vercel). Feature não causou (a)–(d); adicionou (e).
- **Impacto técnico**: primeira request após hibernação pode passar de segundos. Não é um regressão específica desta feature — mas é **agravada** por ela.
- **Impacto de negócio**: analista que entra pela manhã e vê "sistema demorando" — sintoma clássico do plano Render `starter`. Este achado é registrado para não ser lido como novo se voltar a aparecer.
- **Métrica de baseline**: não medível localmente (hibernação é comportamento do Render).

### F-performance-6: A convenção `middleware.ts` do Next 16 foi renomeada para `proxy.ts` — não é perf hoje, mas será dívida no próximo upgrade

- **Severidade**: P3
- **Tactic violada**: N/A (é sinal de deprecação, entra aqui porque foi observado no build)
- **Localização**: `src/frontend/middleware.ts`
- **Evidência (objetiva)**:
  ```
  ⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
    Learn more: https://nextjs.org/docs/messages/middleware-to-proxy
  ```
  Warning direto do `next build` (Next 16.2.7). Não afeta performance hoje; afeta se o time subir para uma versão em que a convenção for removida — daí o middleware simplesmente não roda mais, e o custo é de segurança/roteamento, não de perf.
- **Impacto técnico**: dívida de compatibilidade. Não é perf ainda.
- **Impacto de negócio**: nenhum hoje.
- **Métrica de baseline**: N/A.

## 5. Cards Kanban

### [performance-1] Trocar `getUser()` por `getClaims()` no `middleware.ts` do Next quando o Supabase estiver em ES256

- **Problema**
  > O middleware do Next chama `supabase.auth.getUser()` em cada navegação autenticada (`src/frontend/lib/supabase/middleware.ts:48-50`), e essa função **sempre** faz um `GET ${SUPABASE_URL}/auth/v1/user` (verificado em `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:2698`). Uma navegação = um round-trip HTTP ao provedor. A mesma lib expõe `getClaims()` (linha 5321), que para tokens ES256/RS256 com `kid` e WebCrypto disponível (edge runtime tem) **valida localmente** contra o JWKS cacheado.

- **Melhoria Proposta**
  > Substituir `supabase.auth.getUser()` por `supabase.auth.getClaims()` no `updateSession` do middleware, com fallback para `getUser()` quando `getClaims()` devolve `null` (algo/HS256 legado, ou sem `kid`). Preserva a intenção do comentário atual ("valida o token contra o provedor") no fallback, e no caminho comum troca 1 round-trip por 1 verificação criptográfica local. Reajustar o teste `__tests__/middleware.test.ts` para cobrir os dois ramos. Tactic: Reduce Overhead.

- **Resultado Esperado**
  > Latência p50 do `middleware.ts` cai de "1 round-trip HTTP à Supabase" (tipicamente 50–200 ms) para "1 verify de assinatura local" (< 5 ms) enquanto o Supabase estiver em ES256 (default nos projetos novos). Comportamento no HS256 legado ou tokens sem `kid` permanece intocado.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Round-trips HTTP à Supabase por navegação Next protegida: 1 → 0 (ES256) / 1 (HS256 fallback)
  - Latência p50 do middleware.ts: ~100 ms → < 20 ms (estimativa; medir com Vercel Speed Insights depois de deploy)
- **Risco de não fazer**: em rollout ES256 (rotação futura de chave), analistas percebem cada clique como "lento" sem que apareça em log; time perde ciclos investigando a rede como se fosse instabilidade.
- **Dependências**: nenhuma; a chave da API `getClaims` já existe no `@supabase/auth-js` 2.112.2 que a feature instalou. Coordenar com `security-*` no mesmo run se houver preocupação sobre validar-só-localmente (é o mesmo esquema que o backend já faz com JWKS).

### [performance-2] Bound do `AppUserContextCache` — cap por contagem + eviction proativa

- **Problema**
  > `AppUserContextCache` guarda entradas num `Map` sem limite (`src/backend/domain/service/auth/AppUserContextCache.ts:46`). A limpeza acontece apenas quando `get()` encontra uma entrada expirada — entradas de `sub`s que **nunca voltam** ficam vivas até o processo reiniciar. O caching de `null` (linha 172 de `appUserContext.ts`) é de propósito (evita SELECT por request para `sub` órfão em loop), mas amplifica esse cenário.

- **Melhoria Proposta**
  > Impor um cap explícito (por exemplo, 10.000 entradas — folga generosa para o time real) e uma política de eviction simples (LRU via ordem de inserção do `Map` — o próprio `Map` do JS mantém insertion order, então basta `entries.keys().next().value` quando `entries.size >= MAX`). Alternativa mais barata: um sweep proativo dispara quando `entries.size` cruza o cap. Tactic: Bound Queue Sizes.

- **Resultado Esperado**
  > Tamanho do `Map` interno bounded a ≤ 10.000 entradas por processo. Uso de memória do cache: hoje ilimitado → limite superior conhecido (~10.000 × ~200 bytes = ~2 MB). Zero mudança no hit rate para o cenário real (poucas dezenas de analistas).

- **Tactic alvo**: Bound Queue Sizes
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Cap superior do cache: ∞ → 10.000 entradas
  - Memória do cache (estimada): sem limite → ≤ 2 MB
  - Hit rate esperado para o time real (~30 analistas × 1 req/s): não muda (~96%)
- **Risco de não fazer**: um cliente com bug em produção que faça sign-out/sign-in em loop, ou uma tentativa maliciosa de exhaustion, aumenta o RSS do processo em silêncio. No Render `plan: starter` (~512 MB RAM), isso pode contribuir para OOM se se somar a outros vazamentos.
- **Dependências**: nenhuma; classe é pequena (84 linhas), testes já existem.

### [performance-3] Instrumentar timeout + retry bounded no `SupabaseAdminClient`

- **Problema**
  > `SupabaseAdminClient` (`src/backend/domain/client/SupabaseAdminClient.ts:141-143`) chama `createClient(url, key)` sem fetch customizado, portanto sem timeout. O único caminho onde a Admin API entra em request path é `resolveInactive` (`http/appUserContext.ts:116-133`) — aceite de convite. Durante uma incidência do GoTrue, essa request fica pendurada indefinidamente, ocupando um dos slots do Express single-instance.

- **Melhoria Proposta**
  > Passar um `global.fetch` customizado no `createClient` que embrulhe cada chamada num `AbortController` com timeout (~5 s é folgado para uma API de auth), e envolver os call sites em `RetryExecutor` com no máximo 1 retry (a maioria das chamadas Admin API não é idempotente — invite manda e-mail; `getUserById` é seguro para retry). Tactic: Bound Execution Times.

- **Resultado Esperado**
  > Chamada mais longa ao GoTrue no request path: hoje ilimitada → ≤ 5 s (com 1 retry, ≤ 10 s). Numa incidência do provedor, o worst-case por request cai de "timeout do LB do Render (~100 s)" para "5 s → fail-closed via `catch` já existente".

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Timeout por chamada Admin API: ∞ → 5.000 ms
  - Worst-case latência por request de aceite de convite durante incidência do GoTrue: ~100 s → ~5 s
- **Risco de não fazer**: incidente Supabase de 5 min degrada o backend financeiro por dezenas de minutos após, com sintoma inespecífico ("está lento").
- **Dependências**: alinhar com o QA `fault-tolerance` (mesmo modo de falha; a proposta deve ser única, não duplicada).

### [performance-4] Estabelecer baseline de bundle browser antes do próximo delta de deps

- **Problema**
  > Esta feature adicionou `@supabase/supabase-js` + `@supabase/ssr` ao frontend, mas o repositório **não tem baseline commitado** de bundle browser pré-feature (`_shared-metrics.md` mede LOC e deps, não bundle). Sem baseline, cada próxima feature vai continuar sendo "não medível o delta". O build atual: 1.864 KB total em `.next/static/chunks/` (raw), maior chunk 251 KB.

- **Melhoria Proposta**
  > Ingerir os números de `npm run build` (First Load JS por rota + bundle total) num arquivo versionado em `docs/perf/frontend-bundle-baseline.md`, atualizado a cada release. Isso dá ao próximo run do Regis-Review um número para diffar. Não é infra nova — é um `du -sh` + commit. Tactic: Reduce Overhead (por instrumentação).

- **Resultado Esperado**
  > A partir do próximo run, cada feature que toque deps do frontend produz "bundle antes / depois" mensurável. Substitui "não medível o delta" por número.

- **Tactic alvo**: Reduce Overhead (via observabilidade prévia)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Baseline commitado: ausente → presente e datado
  - Delta de bundle atribuível ao `supabase-auth`: hoje "não medível" → registrado retroativamente na próxima release
- **Risco de não fazer**: cada Regis-Review continua reportando "delta não medível" em perf, e o time perde a chance de perceber crescimentos de 100–200 KB até que sejam grandes demais para reverter facilmente.
- **Dependências**: nenhuma.

## 6. Notas do agente

- **Cross-QA — Reduce Overhead vs. Security (getUser vs getClaims):** o card `performance-1` toca um ponto que o `qa-security` provavelmente valorizou como "validação-no-provedor". A proposta é substituir só quando ES256 + `kid` estão presentes; para HS256 legado, mantém `getUser()`. O `qa-consolidator` deve verificar se há conflito, não presumir.
- **Cross-QA — Bound Execution Times (F-performance-3):** exatamente a mesma causa raiz de findings esperados em `qa-availability` e `qa-fault-tolerance`. Um único card resolve os três eixos — o consolidador deve mesclar, não somar.
- **Cross-QA — Bound Queue Sizes (F-performance-2):** também de interesse do `qa-modifiability` (padrão reutilizável para futuros caches) e do `qa-availability` (proteção contra crescimento em incidente).
- **Métricas propositalmente não medidas localmente:** latência real de `getUser()` (requer prod), delta de bundle (baseline ausente), tempo de cold start Render (comportamento do provedor). Todas declaradas na tabela da seção 2. Nenhum P0/P1 emitido — não havia baseline numérico que sustentasse, e a instrução foi explícita em rebaixar para P2 nesse caso.
- **Achados de `_shared-metrics.md` que NÃO retornam aqui:** as 17 falhas de teste da Frente IV (não são perf), o `filialAuthz` fail-OPEN (é `qa-security`), o Express-em-vez-de-Lambda (dívida aceita), e o `CONEXOS_CRED_ENC_KEY` (fora do eixo de perf). Registrar seria inflar o relatório.
