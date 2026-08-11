---
qa: Integrability
qa_slug: integrability
run_id: 2026-08-06-1520-supabase-auth
agent: qa-integrability
generated_at: 2026-08-06T15:20:00-03:00
scope: backend + frontend
score: 7
findings_count: 6
cards_count: 5
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Squad da Kavex durante o cutover Supabase | Adicionar a **6ª integração externa** (Supabase GoTrue) que passa a atender **toda request autenticada** — sem quebrar a cadeia identidade → autorização → ERP Conexos que assina as baixas `fin010` | `SupabaseAdminClient` (novo), `buildAuthMiddleware` (alg-aware), `buildAppUserContextMiddleware` (novo), `conexosIdentityMiddleware` (1 linha alterada) + camada `lib/supabase/*` no frontend | Rollout com login legado ativo em paralelo, `SUPABASE_URL` prestes a ser ligado | O novo client custa 1 arquivo (`SupabaseAdminClient.ts`) + 1 site de leitura no `EnvironmentProvider`; a integração no caminho quente troca 1 símbolo (`sub → username`) em `conexosIdentity.ts`; `ConexosSessionResolver` e `UserRepository.getVinculoConexos` ficam **literalmente intocados** | LOC de infraestrutura reutilizada (DI, env, Zod-no-boundary, redact): `SupabaseAdminClient` = **285 LOC**, dos quais só ~35 seriam de código novo se um 7º client fosse adicionado hoje; arquivos que quebram se `@supabase/*` mudar API = **7** (5 frontend, 1 backend, 1 jest.setup) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos em `domain/client/` | 21 arquivos / 6.174 LOC | — (baseline) | ℹ️ | `_shared-metrics.md` |
| Clients com decoradores `@singleton() @injectable()` | 15/15 clients de negócio (excluindo `legacyConexosAdapter`, `ConexosSessionRegistry`, `ConexosSessionResolver`) | 100% | ✅ | `grep -E "^\s*public " domain/client/*.ts` + inspeção linha a linha |
| `SupabaseAdminClient` segue o padrão (`@singleton() @injectable()` + `EnvironmentProvider` + Zod no boundary) | Sim | Sim | ✅ | `domain/client/SupabaseAdminClient.ts:118-126,55-73` |
| Sites que instanciam `new SupabaseAdminClient(...)` fora de teste | 0 | 0 | ✅ | `grep -rn "new SupabaseAdminClient"` (só o próprio arquivo e o teste) |
| Services/repositories/routes importando `axios` ou `fetch` diretamente | 0 arquivos | 0 | ✅ | `grep -rnE "^import.*axios\|from 'axios'"` em `domain/service`, `domain/repository`, `routes`, `http` |
| Services que dependem de >2 clients (via `@inject`) | 1 (`EleicaoPermutasService` — 5 clients) | ≤ 2 | ⚠️ | `grep -rEn "@inject\(.*Client" domain/service` — pré-existente, não desta feature |
| Public methods de `SupabaseAdminClient` que são domain-specific vs. genéricos (`updateUserById`, passthrough) | 7 domain + 1 genérico (`updateUserById` — Record<string, unknown>) | 100% domain | ⚠️ | `SupabaseAdminClient.ts:174-284` |
| Files acoplados diretamente à API das libs `@supabase/*` (browser+admin) | 7 (5 frontend + 1 backend + 1 jest.setup) | ≤ 5 | ⚠️ | `grep -rln "@supabase/ssr\|@supabase/supabase-js"` |
| Frontend: sites de `fetch/axios` fora do wrapper | 0 (todos passam por `lib/http.ts` → `apiFetch`) | 0 | ✅ | `grep -rn "fetch(\|axios" src/frontend` (só `lib/http.ts:53`) |
| Contrato de token separado por caminho (JWKS/ES256 vs HS256 legacy) | Sim: `hsOptions` (audience-only) vs `jwksOptions` (audience+issuer) | Separação nomeada + regressão | ✅ | `http/auth.ts:161-169` + regressão nomeada `middlewareWiring.test.ts:12-30` |
| Zod no boundary externo (arquivos `domain/client/` + `http/` sem `.test.ts`) | 13 arquivos com `z.object/string/number` | 100% dos clients HTTP | ✅ | `grep -rn "z\.\(object\|string\|number\)" domain/client http` |
| Redact de segredos cobre a chave nova (`service_role`, `servicerolekey`, etc.) | 5 grafias adicionadas | Cobrir camelCase + snake_case | ✅ | `http/redact.ts:26-30` |
| Config lida via `EnvironmentProvider` (não `process.env` cru) no client novo | Sim (`SupabaseAdminClient.ts:132-140`) + teste-guarda | 100% | ✅ | `SupabaseAdminClient.test.ts:68-81` |
| `process.env` cru em `domain/service/*` | 0 sites de leitura de config (2 comentários) | 0 | ✅ | `grep -rn "process\.env" domain/service` |
| Client tests com fixtures de resposta real (não só mock passthrough) | `SupabaseAdminClient.test.ts` parse com Zod usando fixture `RAW_USER` snake_case→camelCase | Fixture-based | ✅ | `SupabaseAdminClient.test.ts:24-31,83-95` |
| Versão externa pinada em URL/header | JWKS: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (v1 na URL) | Explícito onde o provider oferece | ✅ | `http/auth.ts:159,176` |
| Diff no caminho quente da cadeia identidade→ERP | `conexosIdentity.ts` **+21 −5** (troca `sub`→`username`); `ConexosSessionResolver` **0 linhas**; `UserRepository.getVinculoConexos` **0 linhas** | Raio mínimo | ✅ | `git diff origin/main --stat` |
| Sinal público de degradação silenciosa da cadeia (robô sem alarme) | 1 endpoint (`GET /me/conexos-status`) — sem métrica, sem log estruturado, sem alerta | Endpoint + observabilidade (contador `robot_fallback_total`) | ⚠️ | `routes/me.ts:41-54` |
| Duplicação de bootstrap HTTP (auth-refresh, retry, lock) entre clients | Conexos concentrado em `ConexosBaseClient` (retry compartilhado); Supabase usa lib pronta (`@supabase/supabase-js` traz retry/refresh); BCB tem retry próprio | Base HTTP abstrata: N/A no stack atual (Bass: Adhere to Standards) | ℹ️ | `ConexosBaseClient.ts:149-164`, `BcbClient.ts` |
| Contract test para o "por-caminho" do JWT (impede alguém religar `iss` em `hsOptions`) | Sim (nomeado) | Sim | ✅ | `middlewareWiring.test.ts:12-30` + `auth.ts:161-163` comment |

> ⚠️ **Não medível localmente**: contadores de fallback-para-robô, latência da Admin API, taxa de erro por integração externa. Requer instrumentação (Sentry/OpenTelemetry) que o repositório não tem hoje. Recomendação: incrementar um contador `conexos_fallback_robot_total{reason=<missing_username|vinculo_null|robot_forced>}` em `ConexosSessionResolver.resolve` e emitir warning estruturado quando `platformUsername` presente mas `getVinculoConexos` devolver `null`.
> ⚠️ **Não medível**: número de arquivos que quebram numa mudança major de `@supabase/supabase-js` v3. Pode-se estimar por acoplamento à API (7 files), mas o comportamento real depende do delta da lib.
> ⚠️ **Não aplicável**: métricas de IaC (SSM, Terraform tenant paths). Não há `infra/` neste repositório (ver `_shared-metrics.md` §1).

## 3. Tactics — Cobertura no nf-projects

### Limit Dependencies

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `SupabaseAdminClient` expõe métodos de domínio (`inviteByEmail`, `createUser`, `setBanned`, `sendRecoveryLink`) e traduz erros do provedor em 3 classes tipadas (`SupabaseUserNotFoundError`, `SupabaseAdminError`, `SupabaseEmailAlreadyExistsError`). O único método com forma genérica (`updateUserById(id, attributes: Record<string, unknown>)`) é usado **internamente** por `setBanned` — não é chamado por service. `deleteUser` está encapsulado atrás de doc-comment `COMPENSAÇÃO TRANSACIONAL APENAS` + teste-guarda que varre `routes/` (`SupabaseAdminClient.test.ts:181-198`). | ✅ presente | `SupabaseAdminClient.ts:25-49,118-284`, `UserAdminService.ts:129,152,224,252,341` |
| Use an Intermediary | `EnvironmentProvider` intermedia `process.env` e (no alvo) SSM — o client novo consome variáveis via `env.supabaseUrl` / `env.supabaseServiceRoleKey`, não `process.env` cru. Guard test executável. | ✅ presente | `SupabaseAdminClient.ts:132-140`, `SupabaseAdminClient.test.ts:68-81`, `EnvironmentProvider.ts:141-142,196-197` |
| Restrict Communication Paths | Todo backend service que precisa da Admin API entra por `SupabaseAdminClient` (via `@inject`). 0 arquivos em `domain/service`, `domain/repository`, `routes`, `http` importam `axios`/`fetch` cru. O middleware `appUserContext` chama `container.resolve(SupabaseAdminClient)` em vez de `new` — mesma disciplina que o resto do stack. | ✅ presente | `grep -rnE "^import.*axios" domain/service domain/repository routes http` = 0; `appUserContext.ts:122` |
| Adhere to Standards | JWT verificado com `jose` (padrão de facto); ES256 lido via `createRemoteJWKSet` (RFC 7517); Admin API usa `@supabase/supabase-js@^2.112.2` (client oficial). No frontend, `@supabase/ssr@^0.12.4` implementa o padrão SSR-cookies. | ✅ presente | `http/auth.ts:1-10,159,176`, `SupabaseAdminClient.ts:1`, `frontend/lib/supabase/*.ts` |
| Abstract Common Services | **Parcial.** A infraestrutura reutilizável é: `EnvironmentProvider` (config), `redactBody` (log), Zod (boundary), decoradores tsyringe. **Não há** classe-base HTTP nem mixin de auth-refresh — cada provider traz o seu (Conexos tem `ConexosBaseClient` com retry compartilhado, BCB tem retry próprio, Supabase delega retry/refresh à lib). Para o 7º client isso é um leve custo repetido de ~35 LOC (`getClient()` lazy + `unwrap()` de erro tipado). | ⚠️ parcial | `ConexosBaseClient.ts:149-164` vs `SupabaseAdminClient.ts:132-167` vs `BcbClient.ts` (retry local) |

### Adapt

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Discover Service | JWKS é descoberto por convenção do provider (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`). Não há service registry (não aplicável ao stack Render/Vercel — sem SSM/tenant path). | ✅ presente (no que aplica) | `http/auth.ts:159,176` |
| Tailor Interface | `SupabaseAdminClient.unwrap()` traduz `{data,error}` da Admin API em 3 exceções tipadas — a distinção que o service depende para decidir entre compensar e abortar. Nomes camelCase locais vs snake_case do provider normalizados por `toGoTrueUser`. | ✅ presente | `SupabaseAdminClient.ts:65-91,151-167` |
| Configure Behavior | Feature flags/config lidas via Zod no boundary de env: `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_LEGACY_LOGIN_ENABLED`, `DEV_AUTH_BYPASS`. Fail-fast quando incoerente (bypass em ambiente deployed → boot crash). Path do JWT alg-aware é selecionado por config, não por `if env==='prod'`. | ✅ presente | `http/authEnv.ts:30-146`, `http/auth.ts:191-208` |
| Manage Resources | Client Supabase memoizado lazy (`this.client?`); cliente browser memoizado por módulo com comentário sobre listeners duplicados (`frontend/lib/supabase/client.ts:7-22`). Retry compartilhado no eixo Conexos (`RetryExecutor`). | ✅ presente | `SupabaseAdminClient.ts:121-145`, `frontend/lib/supabase/client.ts:7-22` |

### Coordinate

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Orchestrate | `UserAdminService` orquestra as duas pontas (GoTrue + `app_user`) com compensação transacional explícita (`createLocalRowOrCompensate` — mensagem de erro carrega `auth_user_id` órfão para permitir recuperação manual). `setAtivo` documenta ordem "local primeiro, ban depois" e degrada para "sucesso parcial auditado" quando o ban falha (`banGoTrue: 'ok' \| 'falhou' \| 'nao-aplicavel'`). | ✅ presente | `UserAdminService.ts:174-235,319-357` |
| Manage Resource Coupling | A cadeia identidade→ERP foi mantida **intacta no núcleo** (o AsyncLocalStorage segue chaveado por `username`), e apenas o middleware ganhou uma tradução `sub`→`username` de 1 linha. Consequência mensurável: **`ConexosSessionResolver` = 0 linhas alteradas; `UserRepository.getVinculoConexos` = 0 linhas alteradas**. É o menor raio possível para uma troca de provedor de identidade. | ✅ presente | `git diff origin/main --stat -- domain/client/ConexosSessionResolver.ts` = vazio; `conexosIdentity.ts` diff = +21 −5 |

### Facets modernos

| Facet | Implementação atual | Status | Evidência |
|---|---|---|---|
| Contract testing | Fixture-based na parse da Admin API (`RAW_USER` snake_case → camelCase via Zod) + teste nomeado para o contrato de token separado por caminho (`iss` em ES256, ausente em HS256) que impede a regressão que "derrubaria todas as sessões vivas". Guard tests executáveis para I-Usuario-3 (`deleteUser` fora de routes) e para o segredo backend-only (`SUPABASE_SERVICE_ROLE_KEY` ausente do bundle frontend). | ✅ presente | `SupabaseAdminClient.test.ts:83-95,181-256`, `middlewareWiring.test.ts:12-30`, comentário `auth.ts:161-163` |
| Versioning strategy | JWKS URL pinada em `/auth/v1/`; libs pinadas em `^2.112.2` (supabase-js) e `^0.12.4` (@supabase/ssr) — semver caret aceita minors, o que é aceitável para lib de client, mas cria o risco descrito no card `integrability-4`. Não há CHANGELOG.md check automático das libs. | ⚠️ parcial | `backend/package.json:29`, `frontend/package.json:25-26`, `http/auth.ts:159` |
| Backward-compatibility shims | Login legado (HS256) coexiste com JWKS (ES256) via `verify` alg-aware; `AUTH_LEGACY_LOGIN_ENABLED` é o "botão de rollback" da Fase 3 do cutover — flag documentada, default `true`, gate para desligar é `listPendingMigration()` vazio. `password_hash` mantido opcional na tabela até Fase 4. | ✅ presente | `authEnv.ts:42-48`, `UserRepository.ts:8-13`, `http/auth.ts:191-208` |
| Observability of integration failures | **Fraco.** Falhas do Supabase Admin viram `console.warn` em texto livre (`UserAdminService.ts:227-232`, `appUserContext.ts:126-129`, `SupabaseAdminClient.ts:157-164`). A degradação silenciosa da cadeia Conexos (fallback para robô) tem apenas 1 endpoint de diagnóstico (`GET /me/conexos-status`) — não há contador por-dependência nem log estruturado que permita alertar. É o modo de falha mais crítico da feature e o menos observável. | ❌ ausente (para o modo de falha crítico) | `routes/me.ts:41-54`, `appUserContext.ts:124-131`, `UserAdminService.ts:227-232` |

## 4. Findings

### F-integrability-1: SupabaseAdminClient segue o padrão do stack — evidência positiva

- **Severidade**: — (observação positiva, não gera card corretivo)
- **Tactic reforçada**: Encapsulate + Use an Intermediary
- **Localização**: `src/backend/domain/client/SupabaseAdminClient.ts:118-284`
- **Evidência (objetiva)**:
  ```
  @singleton() @injectable()
  export default class SupabaseAdminClient {
      constructor(@inject(EnvironmentProvider) private environmentProvider: EnvironmentProvider) {}
      private getClient = async (): Promise<SupabaseClient> => { ... };
      public inviteByEmail = async (email: string): Promise<GoTrueUser> => { ... };
      public createUser = async (input: { email; password }): Promise<GoTrueUser> => { ... };
      public setBanned = async (id: string, banned: boolean): Promise<GoTrueUser> => ...;
      public sendRecoveryLink = async (email: string): Promise<void> => { ... };
  ```
  Comparado com `ConexosBaseClient` (`domain/client/ConexosBaseClient.ts:146-164`): mesmo par `@singleton() @injectable()`, mesmo `@inject(EnvironmentProvider)` (indireto via `LegacyConexosShape` no caso Conexos), mesma lazy-init com cache em instance var, mesmo tsyringe `container.resolve` em quem consome (`appUserContext.ts:122`, `UserAdminService.ts:106`, `jobs/seed-admin.ts:42`, `jobs/migrate-users-to-supabase.ts:58`).
  - Zero sites `new SupabaseAdminClient(...)` fora do próprio arquivo e do teste (`grep -rn "new SupabaseAdminClient"`).
  - Zod no boundary (`SupabaseAdminClient.ts:55-73`) — mesma disciplina de `permutas/conexosPermutasSchemas.ts`, `http/schemas.ts`.
  - Teste-guarda verifica que `process.env` cru **não aparece no código** do client (`SupabaseAdminClient.test.ts:68-81`).
- **Impacto técnico**: O 7º client (ex.: SharePoint, Nexxera write) tem custo previsível — copiar o esqueleto do `SupabaseAdminClient` (get lazy + `unwrap` para erros tipados + normalização camelCase via Zod) e injetar via `@inject(EnvironmentProvider)`.
- **Impacto de negócio**: Cada nova integração externa que a Kavex precisar plugar (SISPAG/Nexxera, Popula GED, SharePoint) parte com fricção baixa e previsível.
- **Métrica de baseline**: LOC de "infra reutilizada" do `SupabaseAdminClient` que caberiam num boilerplate compartilhado = ~35 LOC (`getClient` + `unwrap` + `hasMarker` + `toXxxUser`); o resto (~250 LOC) é domínio-específico da Admin API.

### F-integrability-2: A cadeia identidade → autorização → ERP ficou contida em 1 símbolo

- **Severidade**: — (observação positiva, evidencia contenção de raio)
- **Tactic reforçada**: Manage Resource Coupling
- **Localização**: `src/backend/http/conexosIdentity.ts:31` (diff `+21 −5`); `src/backend/domain/client/ConexosSessionResolver.ts` (0 linhas alteradas); `src/backend/domain/repository/auth/UserRepository.ts:getVinculoConexos` (não presente no diff)
- **Evidência (objetiva)**:
  ```
  # git diff origin/main --stat mostra:
  src/backend/http/conexosIdentity.ts | 26 +++++++++++++++++++++-----
  # E NÃO mostra:
  src/backend/domain/client/ConexosSessionResolver.ts  (0 alterações)
  src/backend/domain/client/ConexosSessionRegistry.ts  (0 alterações)

  # A troca é literalmente 1 símbolo:
  -    const platformUsername = req.user?.sub;
  +    const platformUsername = req.user?.username;
  ```
  `git status --short` confirma: dos 61 arquivos modificados + 31 untracked, **nenhum** toca `ConexosSessionResolver.ts` ou `ConexosSessionRegistry.ts`.
- **Impacto técnico**: A afirmação central da feature — "chavear o ALS por `username` mantém o resolver intocado" — é verdadeira e mensurável.
- **Impacto de negócio**: Uma troca de provedor de identidade não custa "reescrever o resolver de sessão do ERP". Repetir a jogada com SSO Azure AD amanhã é 0 linhas no resolver.
- **Métrica de baseline**: Arquivos alterados no núcleo Conexos-side da cadeia = 1 (`conexosIdentity.ts`) de 21 clients em `domain/client/`.

### F-integrability-3: Degradação silenciosa para robô é observável apenas por endpoint sob demanda

- **Severidade**: **P1** — degrada QA mensurável (integridade da trilha de auditoria de baixas `fin010`)
- **Tactic violada**: Observability of integration failures (facet moderno) + Manage Resource Coupling (o design conhece o modo de falha mas não o instrumenta)
- **Localização**: `src/backend/routes/me.ts:41-54`, `src/backend/http/conexosIdentity.ts:18-25` (o próprio código documenta o modo de falha), `src/backend/domain/client/ConexosSessionResolver.ts` (nenhum contador)
- **Evidência (objetiva)**:
  ```
  // conexosIdentity.ts:18-25 documenta:
  // Se `platformUsername` deixar de casar com `app_user.username`,
  // `getVinculoConexos` devolve `null` e o sistema **degrada para o usuário-robô**:
  // as baixas `fin010` continuam saindo — atribuídas à máquina.
  // Sem exceção, sem log de erro, sem alarme.

  // O único sinal é polling humano:
  router.get('/conexos-status', asyncHandler(async (req, res) => {
      const username = req.user?.username;
      const status = username ? await resolver.testarVinculo(username) : 'ausente';
      res.json({ status });
  }));
  ```
  Nenhum contador estruturado (`conexos_fallback_robot_total{reason}`), nenhum `logger.warn({ event: 'conexos_fallback' })` estruturado. `console.warn` em texto livre existe para o Supabase (`UserAdminService.ts:227-232`, `appUserContext.ts:126-129`), mas **não** para o caminho `ConexosSessionResolver.resolve → robot`.
- **Impacto técnico**: Um bug de dados que introduza divergência `req.user.username ≠ app_user.username` (ex.: normalização de e-mail, alias, case) faz **toda a operação de baixa** cair no robô sem gerar sintoma até um humano notar que "a Marilyn sumiu da coluna executado_por". A ADR-0030 e a integração explicitam isso como o modo de falha crítico da feature.
- **Impacto de negócio**: Quebra silenciosa de I-Usuario-1 ("a baixa fin010 sai no nome do humano") — a integridade da trilha de auditoria é o resultado que a feature inteira serve. Detectar isso 2 semanas depois exige re-atribuir baixas manualmente ou aceitar a perda.
- **Métrica de baseline**: Sinais estruturados de degradação da cadeia = 0. Endpoints de diagnóstico sob demanda = 1 (`/me/conexos-status`).

### F-integrability-4: Acoplamento à API das libs `@supabase/*` espalhado em 7 arquivos

- **Severidade**: **P2** — débito técnico defensável (o wrapper existe, mas as libs são chamadas por consumidores)
- **Tactic violada**: Encapsulate (parcial — a criação do client é wrapper, mas os métodos da lib são chamados direto)
- **Localização**:
  - `src/frontend/lib/auth/AuthProvider.tsx:107,169,189` — `signInWithPassword`, `signOut`, `onAuthStateChange`
  - `src/frontend/app/auth/forgot-password/page.tsx:38` — `resetPasswordForEmail`
  - `src/frontend/app/auth/reset-password/page.tsx:37,77` — `updateUser`
  - `src/frontend/lib/auth/token.ts:28` — `getSession`
  - `src/frontend/lib/supabase/middleware.ts:31,50` — `createServerClient`, `getUser`
  - `src/frontend/lib/supabase/server.ts` — `createServerClient`
  - `src/backend/domain/client/SupabaseAdminClient.ts:141,178,193,217,236,252,272,283` — 8 chamadas à API `client.auth.admin.*` / `client.auth.*`
- **Evidência (objetiva)**:
  ```
  # grep -rln "@supabase/ssr|@supabase/supabase-js" src (sem testes) = 7 arquivos
  # Todos os consumidores frontend passam por getSupabaseBrowserClient() — o wrapper
  # centraliza a CRIAÇÃO, mas os métodos da lib (auth.signInWithPassword,
  # auth.resetPasswordForEmail, auth.updateUser, auth.getSession, auth.signOut,
  # auth.onAuthStateChange) são chamados diretamente pelos consumidores.
  ```
  Comparação: as chamadas à Admin API estão 100% encapsuladas em `SupabaseAdminClient.ts` — nenhum service chama `client.auth.admin.*` direto. Só o eixo **browser** vaza métodos da lib.
- **Impacto técnico**: Uma major bump em `@supabase/ssr` ou `@supabase/supabase-js` (ex.: renomeação de `resetPasswordForEmail` ou mudança na assinatura de `onAuthStateChange`) faz 5 arquivos frontend + 1 backend precisarem de patch coordenado. O caret nas versões (`^2.112.2`, `^0.12.4`) aceita minors — v3 obrigaria intervenção.
- **Impacto de negócio**: Custo de upgrade previsível mas não zero: uma tarde para revisar e testar 6 sites em paralelo. Aceitável para o horizonte de 6-12 meses, virará dor se dois upgrades acumularem.
- **Métrica de baseline**: Arquivos que quebram numa mudança de API da lib = 7. Nível de wrapping = "cria mas não opera" (frontend); "cria e opera" (backend, exemplar).

### F-integrability-5: `updateUserById` expõe forma genérica `Record<string, unknown>` na superfície pública

- **Severidade**: **P3** — melhoria opcional
- **Tactic violada**: Encapsulate (forma fraca)
- **Localização**: `src/backend/domain/client/SupabaseAdminClient.ts:245-255`
- **Evidência (objetiva)**:
  ```typescript
  public updateUserById = async (
      id: string,
      attributes: Record<string, unknown>,
  ): Promise<GoTrueUser> => {
      const client = await this.getClient();
      const data = this.unwrap(
          `updateUserById(${id})`,
          await client.auth.admin.updateUserById(id, attributes),
      );
      return toGoTrueUser(data.user);
  };
  ```
  Hoje o único chamador interno é `setBanned` (linha 262), que passa `{ ban_duration: '876000h' | 'none' }`. Nenhum service chama `updateUserById` diretamente — mas o método é `public`, então nada impede um novo service de passar qualquer bag.
- **Impacto técnico**: Um novo caso de uso pode passar `{ email, phone, user_metadata }` sem que a superfície tipada obrigue a nomear a intenção — reproduz o padrão que o próprio CLAUDE.md alerta contra ("clients should expose domain-specific methods, never generic get/post/request").
- **Impacto de negócio**: Baixo hoje (sem consumidor externo), mas o custo de fechar cresce com o tempo à medida que casos de uso aparecem.
- **Métrica de baseline**: Public methods com forma genérica na superfície do `SupabaseAdminClient` = 1 de 8 (`updateUserById`).

### F-integrability-6: Contrato "iss por caminho" vive em três lugares mas nenhum é o `README` da integração

- **Severidade**: **P3** — melhoria opcional
- **Tactic violada**: Adhere to Standards / Documentation (o contrato existe, mas é fácil quebrá-lo sem esbarrar na explicação)
- **Localização**: `src/backend/http/auth.ts:122-131` (doc-comment), `src/backend/http/auth.ts:161-163` (comentário inline em `hsOptions`), `src/backend/http/middlewareWiring.test.ts:12-30` (regressão nomeada), `ontology/integrations/supabase-auth.md:64-84`
- **Evidência (objetiva)**: A regra "`iss` é exigido só no caminho JWKS/ES256, `aud: 'authenticated'` nos dois" está escrita em 4 lugares:
  ```
  http/auth.ts:122-131        — doc-comment do `buildAuthMiddleware`
  http/auth.ts:161-163        — comment inline em `hsOptions`
  middlewareWiring.test.ts    — regressão nomeada (executável)
  ontology/integrations/supabase-auth.md:64-84 — tabela "Contrato de token"
  ```
  Ela **não está** no local mais óbvio para alguém que edita `hsOptions` sem contexto — o próprio nome da variável não sugere "atenção, o `issuer` ausente aqui é a razão pela qual o cutover não derruba as sessões legadas".
- **Impacto técnico**: Um refactor "vou juntar `hsOptions` e `jwksOptions` porque são iguais" derruba todas as sessões vivas. O teste-guarda captura, mas o desenvolvedor gasta uma iteração até descobrir por quê. Um dos comentários inline (`auth.ts:161-163`) explica exatamente isso — o achado é que **três dos quatro lugares** contam a mesma história, e nenhum é canônico.
- **Impacto de negócio**: Baixo se o teste for executado; alto se alguém "corrigir" o teste primeiro.
- **Métrica de baseline**: Fontes de verdade concorrentes para o contrato = 4. Fonte canônica única = 0.

## 5. Cards Kanban

### [integrability-1] Instrumentar degradação silenciosa da cadeia Conexos com contador + log estruturado

- **Problema**
  > A cadeia identidade→autorização→ERP tem um modo de falha **conhecido, documentado e não observável**: se `req.user.username` deixar de casar com `app_user.username`, as baixas `fin010` continuam saindo — atribuídas ao usuário-robô, sem exceção, sem log de erro, sem alarme (`http/conexosIdentity.ts:18-25`). O único sinal é o endpoint `/me/conexos-status` respondendo `ausente` (`routes/me.ts:41-54`) — polling humano. Isso quebra silenciosamente I-Usuario-1 ("a baixa `fin010` sai no nome do humano"), que é a razão de existir de toda a feature.

- **Melhoria Proposta**
  > Em `ConexosSessionResolver.resolve`, quando `platformUsername` estiver **presente** mas `getVinculoConexos` devolver `null` (ou a autenticação Conexos falhar), emitir um `console.warn` **estruturado** (JSON com `event: 'conexos_fallback_robot'`, `platformUsername`, `reason: 'vinculo_null' | 'auth_failed'`) e incrementar um contador in-memory acessível via um endpoint `/health/integrations` (ou `/metrics` se decidirem plugar Prometheus). Tactic: **Observability of integration failures**. Arquivos: `domain/client/ConexosSessionResolver.ts`, novo `routes/health.ts` (ou anexar em `routes/me.ts`). Manter fail-closed em relação à cadeia (não bloquear a baixa — a queda no robô é o comportamento aceito).

- **Resultado Esperado**
  > Um divergência entre `req.user.username` e `app_user.username` (ou um vínculo Conexos falho) gera **sinal executável**: warning estruturado no drain do Render + contador consultável. QA descobre em minutos, não em semanas.
  > - Sinais estruturados de degradação da cadeia: 0 → ≥1 (`event: 'conexos_fallback_robot'`)
  > - Contadores públicos de fallback: 0 → 1 (`conexos_fallback_robot_total{reason}`)

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Warning estruturado (JSON) no fallback para robô — verificável em teste unitário mockando `getVinculoConexos → null`.
  - Endpoint `/health/integrations` (ou similar) devolve `conexos_fallback_robot_total` monotônico.
- **Risco de não fazer**: I-Usuario-1 pode ser violada em produção por dias sem detecção; retrabalho manual de re-atribuição de baixas a humanos é o mitigador tardio.
- **Dependências**: Nenhuma técnica. Cross-QA: pode ser combinado com **fault-tolerance** e **testability** (mesma origem de dor).

### [integrability-2] Encerrar a forma genérica de `updateUserById` na superfície pública

- **Problema**
  > `SupabaseAdminClient.updateUserById(id, attributes: Record<string, unknown>)` (`domain/client/SupabaseAdminClient.ts:245-255`) é `public` mas hoje só existe para servir `setBanned`. Manter a forma genérica pública convida um caso de uso futuro a passar `{ email, user_metadata, ... }` — o padrão que o CLAUDE.md alerta contra ("clients should expose domain-specific methods, never generic").

- **Melhoria Proposta**
  > Tornar `updateUserById` `private` e criar um método por caso de uso conforme surgir (ex.: futuro `updateUserEmail(id, email)`). Tactic: **Encapsulate**. Arquivo único: `domain/client/SupabaseAdminClient.ts`. Custo trivial (mudar `public` → `private` + reexpor por método quando precisar).

- **Resultado Esperado**
  > A superfície pública da Admin API é 100% domain-specific.
  > - Public methods com forma genérica: 1 → 0
  > - Métodos "por caso de uso": 7 → 7 (o consumidor `setBanned` continua igual)

- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-5
- **Métricas de sucesso**:
  - `grep -E "^\s*public " domain/client/SupabaseAdminClient.ts` não devolve nenhum método com forma `Record<string, unknown>`.
- **Risco de não fazer**: Débito acumula. Em 12 meses a superfície tem 3-4 chamadas passando bags genéricas e a próxima refatoração de encapsulamento fica cara.

### [integrability-3] Consolidar o contrato "iss por caminho" num único ponto canônico

- **Problema**
  > A regra "`issuer` é exigido só no verificador JWKS/ES256; `audience: 'authenticated'` em ambos" está documentada em quatro lugares (`http/auth.ts:122-131`, `http/auth.ts:161-163`, `middlewareWiring.test.ts`, `ontology/integrations/supabase-auth.md`) mas nenhum é a fonte canônica. Um refactor "vou juntar `hsOptions` e `jwksOptions`" derruba todas as sessões legadas — o teste captura, mas o entendimento vem depois da falha.

- **Melhoria Proposta**
  > Extrair `hsOptions` e `jwksOptions` para uma função nomeada (`buildVerifyOptionsPerPath`) num arquivo próprio (`http/tokenContract.ts`) com **JSDoc canônico** (a tabela do `integrations/supabase-auth.md`). Manter o teste de regressão nomeado. Tactic: **Adhere to Standards** + **Versioning strategy**. Arquivos: novo `http/tokenContract.ts`, `http/auth.ts` (importa).

- **Resultado Esperado**
  > Um único local descreve o contrato. Alguém que edita hoje encontra a explicação no arquivo que ela está editando.
  > - Fontes concorrentes do contrato: 4 → 1 canônico + 1 teste de regressão

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-6
- **Métricas de sucesso**:
  - `grep -rn "audience: AUTHENTICATED_AUDIENCE" src/backend/http` retorna 1 arquivo (o novo `tokenContract.ts`).
  - Teste de regressão nomeado continua verde após extração.
- **Risco de não fazer**: Um refactor "de limpeza" pode derrubar sessões vivas do login legado durante o rollout Fase 3.

### [integrability-4] Estabelecer política de upgrade das libs `@supabase/*` e caps de versão

- **Problema**
  > 7 arquivos acoplam direto à API de `@supabase/ssr` ou `@supabase/supabase-js` (5 frontend + 1 backend + 1 jest.setup). As versões estão em caret (`^2.112.2` supabase-js, `^0.12.4` ssr) — minors passam por `npm i` sem revisão. Uma major (v3) obriga patch coordenado em 6 sites de código produtivo. Sem CHANGELOG check e sem contract test que exercite `signInWithPassword`, `getSession`, `onAuthStateChange` contra a lib real, uma quebra silenciosa é possível.

- **Melhoria Proposta**
  > (a) Documentar no `frontend/CONFIGURAR_SUPABASE.md` (ou criar `docs/integrations/supabase-upgrade-checklist.md`) a lista dos 7 sites e o roteiro de smoke-test (login, refresh, forgot-password, reset, signOut). (b) Trocar caret por tilde nos `supabase/*` (`~2.112.2`, `~0.12.4`) e agendar upgrade trimestral com o roteiro acima. (c) Adicionar um teste de integração leve (jest-mock com fixtures da forma retornada pelas versões atuais) que quebre se a forma retornada mudar. Tactic: **Versioning strategy** + **Contract testing**.

- **Resultado Esperado**
  > Upgrade de major da lib é rotina previsível de meio-dia, não descoberta em produção.
  > - Sites cobertos por smoke-test documentado: 0 → 7
  > - Versões pinadas por tilde (`~`) em vez de caret (`^`) para `@supabase/*`: 0 → 3

- **Tactic alvo**: Versioning strategy
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - `docs/integrations/supabase-upgrade-checklist.md` presente e citado no `SupabaseAdminClient.ts`.
  - `package.json` (frontend + backend) usa `~` nas 3 entradas `@supabase/*`.
- **Risco de não fazer**: Uma dependência transitiva puxa uma minor incompatível durante um `npm i` de rotina e uma tela de login quebra sem que ninguém pré-produção tenha exercitado o caminho.

### [integrability-5] Extrair helper reutilizável para clients de Admin API baseados em `{data, error}`

- **Problema**
  > O padrão `try { return unwrap(op, await client.xxx(...)) } catch → error tipado` é usado 8 vezes em `SupabaseAdminClient` (`inviteByEmail`, `createUser`, `createUserWithPasswordHash`, `getUserById`, `updateUserById`, `sendRecoveryLink`, `deleteUser`). Uma 7ª integração via `@supabase/*` ou um provider similar (`{data, error}` shape) reintroduziria as ~35 LOC de `unwrap`/`hasMarker`/`toGoTrueUser`. É pouco, mas é o único gap real na tactic "Abstract Common Services".

- **Melhoria Proposta**
  > Criar `domain/libs/http/DataErrorUnwrapper.ts` com `unwrap<T>(op: string, result: {data, error}, markers: {notFound, alreadyExists}): T`. `SupabaseAdminClient` passa a compor. Se o próximo client for Supabase-shape, herda gratuitamente. Tactic: **Abstract Common Services**. Arquivo novo: `domain/libs/http/DataErrorUnwrapper.ts`. `SupabaseAdminClient.ts` encolhe ~40 LOC.

- **Resultado Esperado**
  > LOC-infra por novo Supabase-shape client cai de ~35 para ~15 (apenas a especialização de erro).
  > - LOC de código infra reutilizável para clients Supabase-shape: 0 → ~50 no lib compartilhado
  > - LOC de infra em `SupabaseAdminClient.ts`: ~35 → ~15

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1 (positiva; este card é o passo natural após ela)
- **Métricas de sucesso**:
  - `domain/libs/http/DataErrorUnwrapper.ts` existe, testado, exportado.
  - `SupabaseAdminClient.ts` LOC total: 285 → ≤250.
- **Risco de não fazer**: Nenhum imediato — puro custo linear se aparecerem mais 2-3 clients no futuro.

## 6. Notas do agente

- **Decisão de escopo**: pontuei 7/10 — o `SupabaseAdminClient` é modelo do padrão (a evidência de F-integrability-1 é forte), a contenção de raio da cadeia é real (F-integrability-2 mostra 0 linhas em `ConexosSessionResolver` e `getVinculoConexos`), e a observabilidade do modo de falha crítico está fraca (F-integrability-3 é o único P1). O que impede pontuar 8 é F-integrability-3: a feature conhece perfeitamente o modo de falha (as duas doc-comments citam ele por nome) e escolheu não instrumentar — é escolha de escopo defensável, mas é o achado que sobra.
- **Métricas que tentei coletar e não medi localmente**: (a) taxa real de fallback para robô — precisa produção; (b) latência de `getUserById` — não instrumentada; (c) número de arquivos que quebrariam num major bump — estimei pelo acoplamento (7 files), o comportamento real depende do delta.
- **Cross-QA para o consolidator**:
  - F-integrability-3 (observabilidade do fallback silencioso) **cruza fault-tolerance** (é um modo de falha degradado sem sinal) e **security** (integridade da trilha de auditoria de baixas `fin010`). Se `qa-fault-tolerance` ou `qa-security` levantarem a mesma origem, sugerir card único consolidado.
  - F-integrability-6 (contrato "iss por caminho" espalhado) cruza **modifiability** — o teste de regressão nomeado já mitiga em parte.
  - F-integrability-4 (upgrade das libs Supabase) cruza **deployability** — o roteiro de smoke-test pertence ao pipeline de release, não só ao check da lib.
- **Não relatei** como novos: `filialAuthz` fail-open, `CONEXOS_CRED_ENC_KEY` ausente do `render.yaml`, Express-vs-Lambda, warnings `noExcessiveCognitiveComplexity`, SMTP não configurado — todos em `_shared-metrics.md` §"Achados JÁ CONHECIDOS".
