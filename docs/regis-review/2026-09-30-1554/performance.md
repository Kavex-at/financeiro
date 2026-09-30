---
qa: Performance
qa_slug: performance
run_id: 2026-09-30-1554
agent: qa-performance
generated_at: 2026-09-30T16:30:00-03:00
scope: backend
score: 7.5
findings_count: 3
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo uma tela (5–10 chamadas paralelas) | Toda requisição passa por `resolverAcesso` (token → `app_user` → permissões) | `http/acesso.ts`, `AccessService`, `AccessRepository`, pool pg (max 5) | Express único em Render (`starter`), cache de 30 s expirado | Uma só consulta de acesso por usuário por janela; pool livre para as rotas de negócio | Consultas de acesso por page-load após TTL: 1; overhead do middleware em cache hit: 0 consultas |
| Admin gravando credencial | Escrita de credencial chama o GoTrue (timeout 10 s) dentro da transação | `CredentialMirror`, `SupabaseAuthClient`, pool pg | Operação rara, mas com o GoTrue lento | Conexão presa só o necessário; demais rotas seguem servindo | Conexões presas por escritas admin: no máximo 2 de 5; hold máximo 5 s |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Overhead por requisição (cache hit) | lookup em `Map` em memória, 0 consultas | 0 consultas | ✅ | `AccessService.ts` (`resolver`) |
| Consultas de acesso por miss | 1 (subselects agregados, JOIN por PK) | 1 | ✅ | `AccessRepository.ts` (`ACCESS_STATE_SELECT`) |
| Single-flight em miss concorrente | ausente: N requisições paralelas = N consultas | 1 consulta | ⚠️ | `AccessService.ts` (`resolver` sem mapa de promises) |
| Índices nas chaves de busca de acesso | `uq_app_user_username_lower` (0064) e `uq_app_user_auth_user_id` parcial (0070) | presentes | ✅ | `migrations/0064:44`, `0070:22` |
| Timeout em chamada GoTrue | 10 000 ms via `AbortSignal.timeout` (todas passam por `enviar`) | 100% | ✅ | `SupabaseAuthClient.ts:72,311` |
| Escrita admin com GoTrue dentro de transação | conexão presa até 10 s; pool max 5; `connectionTimeoutMillis` 5 s | hold < `connectionTimeout` | ⚠️ | `PostgreeDatabaseClient.ts:37-39`, `CredentialMirror.ts` |
| JWKS remoto | `createRemoteJWKSet` (cache e cooldown padrão do `jose`), criado uma vez por verificador | 1 instância | ✅ | `http/auth.ts:134` |
| `adminFindUserByEmail` | lista todas as páginas (200 por página, máx. 50) e filtra em memória; hoje ≈ 1 página | busca direcionada | ⚠️ | `SupabaseAuthClient.ts:212-237` |
| Rate limiters de sessão | em memória, 20/min por IP em login, 30/min por IP em refresh; custo O(1) | O(1) | ✅ | `http/rateLimit.ts` |
| Timers manuais novos | 0 (timeout via `AbortSignal`, retry via `RetryExecutor`) | 0 | ✅ | leitura do delta |
| Bundle / cold start Lambda | não medível (Express em Render, sem Lambda) | n/a | ⚠️ | não medível: sem `infra/` |
| Latência p95 do login (GoTrue via proxy) | não medível localmente | definir após medir | ⚠️ | não medível: requer log de produção. Recomendo logar a duração em `/auth/login` |
| Bundle frontend (auth) | sem SDK Supabase no cliente (só `fetch`); nenhuma dependência nova | sem aumento | ✅ | `_shared-metrics.md` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: sem polling novo; renovação de sessão por evento (401) com lock entre abas | N/A | `session-refresh.ts` |
| Limit Event Response | Rate limiters por IP e por identificador (só falhas 401) | ✅ presente | `rateLimit.ts` |
| Prioritize Events | Nenhuma distinção entre rota de negócio e de auth | ❌ ausente (irrelevante na escala atual) | n/a |
| Reduce Overhead | Cache de acesso de 30 s + invalidação por escrita; token verificado localmente (JWKS em cache), sem chamada ao GoTrue por requisição | ✅ presente | `AccessService.ts` |
| Bound Execution Times | `AbortSignal.timeout(10 s)`; escrita admin nunca repetida; leitura admin com 2 retries | ✅ presente | `SupabaseAuthClient.ts:311` |
| Increase Resource Efficiency | Índice único parcial, `lower()` indexado, JOIN por PK | ✅ presente | `0070`, `0064` |
| Increase Resources | Pool fixo em 5; web em 1 instância | ⚠️ parcial | `PostgreeDatabaseClient.ts:37` |
| Increase Concurrency | Sem single-flight; leituras concorrentes se duplicam | ⚠️ parcial | `AccessService.ts` |
| Maintain Multiple Copies of Computations | N/A: instância única | N/A | ADR-0056 |
| Maintain Multiple Copies of Data | Cache em memória com TTL 30 s; `null` não cacheado | ✅ presente | `AccessService.ts` |
| Bound Queue Sizes | Cache limitado pelo nº de usuários (dezenas); stores dos limiters em memória | ✅ presente | `AccessService.ts` |
| Schedule Resources | Escrita GoTrue dentro da transação segura a conexão durante I/O externo | ⚠️ parcial | `CredentialMirror.ts` |
| Cold start budget | N/A (não há Lambda) | N/A | CLAUDE.md, estado atual |
| Cache strategy | TTL 30 s + `invalidar(userId)` cobrindo os dois tipos de chave | ✅ presente | `AccessService.ts` (`invalidar`) |
| Index discipline | Índices da feature cobrem as chaves de busca | ✅ presente | `0070` |
| Bundle leanness | `jose` como dependência nova no backend; nenhuma no frontend | ✅ presente | `git diff src/backend/package.json` |

## 4. Findings

### F-performance-1: Cache miss de acesso sem single-flight (thundering herd)

- **Severidade**: P2
- **Tactic violada**: Increase Concurrency
- **Localização**: `src/backend/domain/service/auth/AccessService.ts` (`resolver`)
- **Evidência (objetiva)**:
  ```
  const hit = this.cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  const access = await this.accessRepository.findAccessBy...   // sem promise compartilhada
  ```
- **Impacto técnico**: uma tela que dispara 5–10 chamadas paralelas após 30 s de inatividade gera 5–10 consultas idênticas, disputando o pool de 5 conexões. Repete-se a cada expiração do TTL, por usuário ativo.
- **Impacto de negócio**: latência extra pontual na primeira abertura de tela; sem risco de indisponibilidade na escala atual (dezenas de usuários).
- **Métrica de baseline**: 5–10 consultas por page-load em miss (estimado pelo número de chamadas paralelas por tela) contra 1 ideal; pool max 5. Não medido em produção.

### F-performance-2: Chamada ao GoTrue (até 10 s) dentro da transação segura a conexão do pool

- **Severidade**: P2
- **Tactic violada**: Schedule Resources / Bound Execution Times
- **Localização**: `CredentialMirror.ts`, `SupabaseAuthSyncService.ts:174-201`, `PostgreeDatabaseClient.ts:37-39`
- **Evidência (objetiva)**:
  ```
  poolMaxConnections = 5; connectionTimeoutMillis = 5000
  SupabaseAuthClient.REQUEST_TIMEOUT_MS = 10_000  (escrita sem retry)
  ```
- **Impacto técnico**: com o GoTrue degradado, cada escrita de credencial prende 1 de 5 conexões por até 10 s (o dobro do `connectionTimeout`). Cinco escritas simultâneas esgotam o pool e as demais rotas, inclusive o `resolverAcesso`, respondem 503 fail-closed. É decisão consciente do ADR-0056 (atomicidade); a frequência é baixa (operação de admin).
- **Impacto de negócio**: improvável, exige 5 escritas admin simultâneas durante uma degradação do GoTrue. Se ocorrer, o backend fica indisponível por até 10 s.
- **Métrica de baseline**: hold máximo 10 000 ms por escrita contra 5 000 ms de `connectionTimeout`; 1/5 do pool por escrita.

### F-performance-3: `adminFindUserByEmail` lista todos os usuários do GoTrue por chamada

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `SupabaseAuthClient.ts:212-237`; usado em `SupabaseAuthSyncService.ts:209`, dentro da transação
- **Evidência (objetiva)**:
  ```
  adminFindUserByEmail -> adminListUsers() (até 50 págs x 200) -> .find(email)
  ```
- **Impacto técnico**: custo O(usuários) por vínculo de conta pré-existente. Hoje ≈ 1 página (menos de 200 usuários); cresce linearmente e roda com a transação aberta.
- **Impacto de negócio**: desprezível hoje; aparece só no cutover e em recriações.
- **Métrica de baseline**: 1 chamada HTTP por vínculo (estimado, menos de 200 usuários); teto teórico de 50 chamadas.

## 5. Cards Kanban

### [performance-1] Compartilhar a consulta de acesso em miss concorrente (single-flight)

- **Problema**
  > `AccessService.resolver` não deduplica leituras concorrentes na mesma chave. Ao expirar o TTL, as chamadas paralelas de uma tela viram N consultas idênticas sobre um pool de 5 conexões.

- **Melhoria Proposta**
  > Guardar em `Map<string, Promise<ResolvedAccess | null>>` a promise em voo por chave e removê-la no `finally`. Não cachear rejeição, para manter o fail-closed. Tactic: Increase Concurrency / Reduce Overhead. Tocar `AccessService.ts` e o teste.

- **Resultado Esperado**
  > Consultas de acesso por page-load em miss: 5–10 → 1. Teste unitário: 10 `resolver` paralelos = 1 chamada ao repositório.

- **Tactic alvo**: Increase Concurrency
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Chamadas ao repositório por 10 `resolver` concorrentes: 10 → 1
- **Risco de não fazer**: pico de consultas idênticas a cada 30 s por usuário ativo, crescente com o número de usuários e de instâncias.
- **Dependências**: nenhuma

### [performance-2] Reduzir o tempo de conexão presa pela escrita de credencial

- **Problema**
  > A escrita no GoTrue (até 10 s, sem retry) roda dentro da transação, com pool de 5 e `connectionTimeout` de 5 s. Com o GoTrue lento, poucas escritas admin esgotam o pool.

- **Melhoria Proposta**
  > Escolher e registrar no ADR-0056: (a) reduzir `REQUEST_TIMEOUT_MS` das escritas admin para 5 s; (b) limitar a 1–2 as escritas de credencial simultâneas (semáforo no `CredentialMirror`), reservando conexões às demais rotas. Manter o rollback como está. Tactic: Bound Execution Times / Schedule Resources.

- **Resultado Esperado**
  > Conexões presas por escritas admin em pior caso: 5 de 5 → no máximo 2 de 5. Hold máximo: 10 s → 5 s (se a opção a for adotada). Teste com GoTrue simulado lento: as demais rotas respondem enquanto 2 escritas estão pendentes.

- **Tactic alvo**: Schedule Resources
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Máximo de conexões presas por escritas admin: 5 → 2
  - Hold máximo: 10 000 ms → 5 000 ms
- **Risco de não fazer**: degradação do GoTrue combinada com atividade de admin derruba momentaneamente o backend inteiro (503).
- **Dependências**: nenhuma

### [performance-3] Busca direcionada por e-mail no GoTrue

- **Problema**
  > `adminFindUserByEmail` pagina todos os usuários e filtra em memória, sob transação aberta. O custo cresce com a base de usuários.

- **Melhoria Proposta**
  > No job `sync-supabase-auth`, que já lista todos os usuários, montar um `Map` por e-mail uma vez e usá-lo em `criarEVincular`. Para a rota avulsa, mover a leitura para antes de abrir a transação. Tactic: Reduce Overhead.

- **Resultado Esperado**
  > Listagens GoTrue durante transação aberta: 1 ou mais → 0. Listagens no job de sync: N → 1.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Listagens GoTrue durante transação aberta: ≥1 → 0
- **Risco de não fazer**: baixo; degradação gradual se a base passar de algumas centenas de usuários.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo: `git diff 76b5182..HEAD`, foco em `resolverAcesso`/`AccessService`, `SupabaseAuthClient`, `CredentialMirror`, migration 0070 e rate limiters. Nada pré-existente virou finding.
- Não medíveis: cold start, bundle Lambda e latência de login (Express em Render, sem produção acessível); frontend não reconstruído (--quick).
- Cross-QA: F-performance-2 se sobrepõe a Availability/Fault Tolerance (pool esgotado gera 503 fail-closed). O rate limiter em memória e o cache de 30 s pressupõem 1 instância; com `numInstances` maior, os limites passam a valer por instância (Security).
- `resolverAcesso` não cacheia `null`: token válido de usuário inexistente gera 1 consulta indexada por requisição. Escolha deliberada, sem finding.
