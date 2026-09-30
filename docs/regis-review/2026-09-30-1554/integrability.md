---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-30-1554
agent: qa-integrability
generated_at: 2026-09-30T16:30:00-03:00
scope: all
score: 8
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time Kavex | Supabase muda o GoTrue (formato de resposta, novo campo de erro) ou a chave migra de JWT legado para `sb_secret_` | `SupabaseAuthClient` e seus 4 consumidores em `domain/service/auth/` | Produção Render, `AUTH_PROVIDER=supabase` | Só o client muda; resposta fora do contrato vira `bad_response` sem sucesso parcial | 1 arquivo de produção tocado; 0 serviços alterados; time-to-first-call de um novo endpoint GoTrue ≤ 30 LOC |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Métodos públicos genéricos (`get/post/request`) em `SupabaseAuthClient` | 0 de 9 (`signInWithPassword`, `refresh`, `logout`, `adminCreateUser`, `adminUpdateUser`, `adminGetUser`, `adminListUsers`, `adminFindUserByEmail`, `isAdminConfigured`); `enviar`/`buscar` são `private` | 0 | ✅ | `SupabaseAuthClient.ts:96-233,274,303` |
| `fetch` para o GoTrue fora do client (backend, service/repo) | 0 (único `fetch` em `SupabaseAuthClient.ts:307`) | 0 | ✅ | `grep fetch src/backend/domain` |
| Serviços que dependem do client | 4 (`AdminSeeder`, `CredentialMirror`, `SupabaseSessionService`, `SupabaseAuthSyncService`), cada um com 1 client Supabase | ≤ 2 clients/serviço | ✅ | `grep @inject(SupabaseAuthClient)` |
| Validação Zod da resposta externa | 100% das chamadas com corpo consumido (`schema.safeParse` em `enviar`; erro via `supabaseErrorResponseSchema`) | ≥ 80% | ✅ | `SupabaseAuthClient.ts:292-301,332` |
| Env validado uma vez no boundary | `loadAuthEnv` (Zod) em `http/authEnv.ts:81`; client lê via `EnvironmentProvider` (`:239`) | 100% | ✅ | `authEnv.ts`, `SupabaseAuthClient.ts:239` |
| Versão da API pinada | `/auth/v1` fixo em `lerConfig` (`:243`) | explícita | ✅ | `SupabaseAuthClient.ts:243` |
| Timeout por chamada | 10 s via `AbortSignal.timeout` | explícito | ✅ | `SupabaseAuthClient.ts:72,311` |
| Retry | leitura admin sim (`RetryExecutor`); escrita nunca (create não idempotente); 429 `retryable=false` | idempotência respeitada | ✅ | `SupabaseAuthClient.ts:81-85,285` |
| Observabilidade por dependência | falha logada com operação, status, duração, sem corpo/chave (`logarFalha`) | por operação | ✅ | `SupabaseAuthClient.test.ts:214` |
| Testes do client | 1 arquivo, ~25 casos; corpos JSON inline, nenhum fixture gravado do GoTrue real | fixture real | ⚠️ | `SupabaseAuthClient.test.ts` |
| Contract test contra GoTrue (sandbox/pinado) | 0 | 1 smoke | ⚠️ | ausente |
| Base HTTP compartilhada com `ConexosBaseClient` | não reutiliza (pré-existente: clients Conexos e `BcbClient` cada um com o seu transporte) | — | ⚠️ | `domain/client/` |
| Frontend: pontos de `fetch` de auth | 2 (`lib/http.ts:46,51` wrapper; `lib/auth/session-refresh.ts:91` refresh) | 1 wrapper | ⚠️ | `grep fetch src/frontend/lib` |
| Convenção SSM / Terraform | não medível (sem `infra/`) | — | ⚠️ | — |

⚠️ **Não medível localmente**: taxa de erro por dependência em produção (Render logs), latência real do GoTrue e cota de rate-limit. Recomendação: agregar os logs de `logarFalha` por `operacao`/`reason`.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Client com métodos de domínio; HTTP e headers privados | ✅ presente | `SupabaseAuthClient.ts:96-233` |
| Use an Intermediary | Serviços (`SupabaseSessionService`, `CredentialMirror`) mediam client e rotas; erros tipados (`SupabaseAuthRejectedError`, `SupabaseAuthUnavailableError`, `SupabaseEmailConflictError`) traduzem falha do GoTrue para o domínio | ✅ presente | `domain/service/auth/` |
| Restrict Communication Paths | Único ponto que fala com o GoTrue; frontend não chama o Supabase (bundle sem URL/chave) e passa pelo proxy `/auth/*` | ✅ presente | `_shared-metrics.md`, `routes/auth.ts` |
| Adhere to Standards | JWKS/ES256, `grant_type` do GoTrue, JSON | ✅ presente | `authEnv.ts:10-11` |
| Abstract Common Services | Reusa `RetryExecutor`; sem base HTTP comum entre clients (pré-existente) | ⚠️ parcial | `SupabaseAuthClient.ts:20,81` |
| Discover Service | URL e chaves por env via `EnvironmentProvider`; sem SSM (não há `infra/`) | ⚠️ parcial | `SupabaseAuthClient.ts:239-246` |
| Tailor Interface | Zod converte resposta do GoTrue no tipo do domínio (`toSession`, `banned_until`→`banned`) | ✅ presente | `SupabaseAuthClient.ts:390-406` |
| Configure Behavior | `AUTH_PROVIDER` local/supabase; chave legada vs `sb_secret_` por prefixo; cutover/rollback por env | ✅ presente | `authEnv.ts`, `SupabaseAuthClient.ts:262-271` |
| Manage Resources | Timeout 10 s, `ADMIN_PAGE_SIZE`, rate limit no login | ✅ presente | `SupabaseAuthClient.ts:72-77`, `http/rateLimit.ts` |
| Orchestrate | `SupabaseAuthSyncService`/job e `CredentialMirror` orquestram em série, sem eventos (batch manual) | ⚠️ parcial | `jobs/sync-supabase-auth.ts` |
| Manage Resource Coupling | Espelhamento de credenciais desacoplado por `AUTH_PROVIDER`; rollback sem redeploy | ✅ presente | ADR-0056 |
| Contract testing | Apenas testes com mocks inline | ⚠️ parcial | `SupabaseAuthClient.test.ts:85-340` |
| Versioning strategy | `/auth/v1` pinado; sem procedimento de upgrade | ⚠️ parcial | `SupabaseAuthClient.ts:243` |
| Backward-compat shims | Dois formatos de chave (legado JWT e `sb_secret_`) suportados: custo ~5 LOC | ✅ presente | `SupabaseAuthClient.ts:268-271` |
| Observability of integration failures | `logarFalha` com `reason` (`timeout`, `unreachable`, `rate_limited`, `bad_response`) | ✅ presente | `SupabaseAuthClient.ts:299,313-319` |

## 4. Findings

### F-integrability-1: Testes do client usam corpos inline, sem fixture gravada do GoTrue

- **Severidade**: P2
- **Tactic violada**: Contract testing
- **Localização**: `src/backend/domain/client/SupabaseAuthClient.test.ts:85-340`
- **Evidência (objetiva)**:
  ```
  ~25 casos; schemas Zod (supabaseSessionResponseSchema, supabaseAdminUserResponseSchema) validados só contra JSON escrito à mão; 0 fixtures de resposta real
  ```
- **Impacto técnico**: se o GoTrue renomear/adicionar campo obrigatório, o teste segue verde e a falha só aparece em produção como `bad_response` (login bloqueado no modo supabase).
- **Impacto de negócio**: login dos analistas Columbia indisponível até rollback via `AUTH_PROVIDER=local`.
- **Métrica de baseline**: 0 fixtures reais; 0 smoke contract tests.

### F-integrability-2: Sem base HTTP comum entre clients (pré-existente, agravado em +1)

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `SupabaseAuthClient.ts:307` (novo) vs `domain/client/ConexosBaseClient.ts`, `BcbClient.ts`
- **Evidência (objetiva)**:
  ```
  timeout / log de falha / mapeamento de status reimplementados em SupabaseAuthClient (transporte próprio, ~130 LOC)
  ```
- **Impacto técnico**: o próximo client (Nexxera, GED, SharePoint) repetiria o transporte; políticas de timeout/log divergem.
- **Impacto de negócio**: custo de cada nova integração maior que o necessário.
- **Métrica de baseline**: 3 famílias de transporte (Conexos, axios do Bcb, fetch do Supabase).

### F-integrability-3: Frontend com dois pontos de `fetch` para auth

- **Severidade**: P3
- **Tactic violada**: Restrict Communication Paths
- **Localização**: `src/frontend/lib/http.ts:46,51`, `src/frontend/lib/auth/session-refresh.ts:91`
- **Evidência (objetiva)**:
  ```
  fetch(input, init) ...; fetch(`${API}/auth/refresh`, ...)
  ```
- **Impacto técnico**: refresh fora do wrapper é deliberado (evita laço de 401), mas duplica a resolução de `API`.
- **Impacto de negócio**: baixo; mudança de URL base toca 2 sítios.
- **Métrica de baseline**: 2 sítios de `fetch` de auth.

## 5. Cards Kanban

### [integrability-1] Gravar fixtures reais do GoTrue e adicionar smoke de contrato

- **Problema**
  > Os testes do `SupabaseAuthClient` validam os schemas Zod só contra JSON escrito à mão; uma mudança do GoTrue passaria despercebida até o login falhar em produção.

- **Melhoria Proposta**
  > Contract testing: capturar (sem segredos) respostas de `/token`, `/admin/users` e erros 4xx/422 num projeto de teste, guardar em `__fixtures__/` e rodar os schemas contra elas; adicionar um smoke opcional em `jobs/` (probe).

- **Resultado Esperado**
  > Mudança de contrato detectada em CI/probe: fixtures reais 0 → ≥ 4; smoke 0 → 1.

- **Tactic alvo**: Contract testing
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - fixtures reais: 0 → ≥ 4
  - smoke de contrato: 0 → 1
- **Risco de não fazer**: quebra silenciosa no primeiro upgrade do GoTrue, descoberta pelo usuário no login.
- **Dependências**: projeto Supabase de teste

### [integrability-2] Extrair transporte HTTP comum para os próximos clients

- **Problema**
  > O transporte (timeout, log de falha, mapeamento de status, `RetryExecutor`) do `SupabaseAuthClient` é próprio; Nexxera/GED/SharePoint repetiriam.

- **Melhoria Proposta**
  > Abstract Common Services: extrair `HttpTransport` (timeout + log + erro tipado) a partir do `SupabaseAuthClient` quando o primeiro client novo (Nexxera/GED) entrar via `/feature-new`; não refatorar Conexos preventivamente.

- **Resultado Esperado**
  > Novo client sem reimplementar transporte: ~130 LOC → ~30 LOC por client.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: M
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - LOC de transporte por client novo: ~130 → ≤ 30
- **Risco de não fazer**: divergência de política de timeout/log entre integrações.
- **Dependências**: primeiro `/feature-new` de Nexxera ou GED

### [integrability-3] Centralizar a base de URL do frontend de auth

- **Problema**
  > `lib/http.ts` e `session-refresh.ts` resolvem a URL da API separadamente.

- **Melhoria Proposta**
  > Restrict Communication Paths: exportar uma única `apiBaseUrl()` em `lib/` usada pelos dois sítios; manter o refresh fora do wrapper.

- **Resultado Esperado**
  > Sítios que resolvem a base: 2 → 1.

- **Tactic alvo**: Restrict Communication Paths
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - sítios com resolução de `API`: 2 → 1
- **Risco de não fazer**: baixo; drift de configuração entre os dois caminhos.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: delta da feature auth-supabase; nenhum P0/P1. Módulos pré-existentes (Conexos) só como referência.
- Encapsulate coincide com Modifiability; validação Zod/`bad_response` com Security e Fault Tolerance (fail-closed, sem sucesso parcial).
- Não medível: SSM/Terraform (sem `infra/`), taxa de erro por dependência em produção.
