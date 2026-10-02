---
qa: Performance
qa_slug: performance
run_id: 2026-10-02-1636-auth-senha-propria
agent: qa-performance
generated_at: 2026-10-02T16:50:00Z
scope: backend
score: 7
findings_count: 3
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado (ou script com token válido) | Rajada de `POST /me/senha` com GoTrue lento (timeout 10 s) | `OwnPasswordService.alterar` + `UserRepository.updatePassword` (transação com `FOR UPDATE` aberta durante o `PUT /user`) + pool pg (max 5) | Express único na Render, pool compartilhado com o restante da API | A troca degrada sozinha; as demais rotas continuam obtendo conexão | Conexões retidas pela feature ≤ 2 de 5; p95 das outras rotas inalterado; `POST /me/senha` p95 ≤ 1,5 s com GoTrue saudável |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Pool pg max | 5 conexões; `connectionTimeoutMillis` 5 s | dimensionado para o pior caso de rotas que seguram conexão | ⚠️ | `domain/client/database/PostgreeDatabaseClient.ts:37-39` |
| Tempo máx. de uma transação da feature (GoTrue na tx) | até 10 s (`REQUEST_TIMEOUT_MS`), escrita sem retry | ≤ 3 s | ⚠️ | `SupabaseAuthClient.ts:74`; `UserRepository.ts:509-524` |
| Hashes bcrypt por request (modo `local`) | 2 (compare + hash), custo 12 | 2 aceitável se fora do caminho crítico | ⚠️ | `OwnPasswordService.ts:97-111` |
| Lib de bcrypt | `bcryptjs` ^2.4.3 (JS puro, ~3x mais lento que nativo) | nativo ou custo medido | ⚠️ | `package.json:41` |
| Chamadas HTTP externas por troca (modo `supabase`) | 3 sequenciais (password grant, logout da sonda, `PUT /user`) | ≤ 3 | ✅ | `OwnPasswordService.ts:125-165` |
| Timeout explícito em chamada externa nova | 10 s via `AbortSignal.timeout` | 100% | ✅ | `SupabaseAuthClient.ts:339` |
| Queries novas sem LIMIT / N+1 | 0 (todas por PK / username) | 0 | ✅ | `UserRepository.ts:593-615` |
| Rate limit da rota | 5 falhas 422 / 15 min; 503 e 204 não contam | cobre também requests que seguram recurso | ⚠️ | `http/rateLimit.ts:88-106` |
| Dependências novas no delta | 0 | 0 | ✅ | `_shared-metrics.md` |
| Cold start / bundle Lambda | Não medível: runtime Express na Render, sem `infra/` | n/a | ⚠️ | CLAUDE.md, Estado Atual |
| Latência real p95 de `/me/senha` | Não medível localmente; requer produção/APM. Instrumentar duração no log de sucesso. | n/a | ⚠️ | n/a |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A: rota sob demanda, sem polling | N/A | n/a |
| Limit Event Response | Limiter por usuário (5 falhas / 15 min); não limita requests que dão 503 | ⚠️ parcial | `rateLimit.ts:91-106` |
| Prioritize Events | Ausente; troca de senha disputa o pool com rotas operacionais (SISPAG, permutas) | ❌ ausente | `PostgreeDatabaseClient.ts:37` |
| Reduce Overhead | Política validada antes de bcrypt/GoTrue; sem N+1; mas 2 hashes JS puro | ⚠️ parcial | `OwnPasswordService.ts:95-97` |
| Bound Execution Times | Timeout 10 s no GoTrue; a tx fica aberta por todo esse tempo | ⚠️ parcial | `SupabaseAuthClient.ts:339` |
| Increase Resource Efficiency | `bcryptjs` JS puro, custo 12 | ⚠️ parcial | `package.json:41` |
| Increase Resources | Pool fixo em 5 | ⚠️ parcial | `PostgreeDatabaseClient.ts:37` |
| Increase Concurrency | Chamadas GoTrue sequenciais por necessidade (dependência de dados) | N/A: ordem é requisito de correção | `OwnPasswordService.ts` |
| Maintain Multiple Copies of Computations | N/A | N/A | n/a |
| Maintain Multiple Copies of Data | Cache de acesso preservado (senha não muda permissão) | ✅ | `OwnPasswordService.ts:38-39` |
| Bound Queue Sizes | `connectionTimeoutMillis` 5 s limita a espera por conexão; sem limite de concorrência na rota | ⚠️ parcial | `PostgeDatabaseClient.ts:39` |
| Schedule Resources | Ausente (sem semáforo para a rota) | ❌ ausente | n/a |
| Cache strategy | N/A para escrita | N/A | n/a |
| Index discipline | `WHERE id = $id` (PK) e `username` (unique) | ✅ | `UserRepository.ts:600-603` |
| Bundle leanness | Sem dependências novas | ✅ | `_shared-metrics.md` |

## 4. Findings

### F-performance-1: Conexão do pool e lock de linha retidos durante o `PUT /user` do GoTrue (até 10 s)

- **Severidade**: P1
- **Tactic violada**: Bound Execution Times / Schedule Resources
- **Localização**: `src/backend/domain/repository/auth/UserRepository.ts:509-524`; `OwnPasswordService.ts:131-165`; `SupabaseAuthClient.ts:74`
- **Evidência (objetiva)**:
  ```
  withTransaction(tx => { lerCredencial(FOR UPDATE); UPDATE; recordEvent; await antesDoCommit(tx, ...) /* PUT /user, até 10 s */ })
  poolMaxConnections = 5; REQUEST_TIMEOUT_MS = 10_000
  ```
- **Impacto técnico**: Com o GoTrue lento, cada `POST /me/senha` segura 1 de 5 conexões por até 10 s. O limiter só conta respostas 422, então 503/timeouts não são limitados. 5 requests concorrentes (de um usuário autenticado qualquer) esgotam o pool e o resto da API passa a falhar com timeout de conexão em 5 s. O desenho (R6, lock durante a chamada) é deliberado no ADR-0059 para evitar divergência. O delta não cria o risco sozinho, mas o amplia: é a primeira rota de usuário comum que mantém tx aberta durante I/O externo. Não é P0 porque exige token válido e GoTrue degradado.
- **Impacto de negócio**: Um incidente do GoTrue ou um usuário malicioso/script derruba SISPAG, permutas e dashboards do analista por segundos a minutos.
- **Métrica de baseline**: pool 5; retenção máxima por request 10 s; 5 requests concorrentes bastam para saturar (100% do pool).

### F-performance-2: Rate limit não cobre requests que seguram recurso (503, timeout) nem concorrência por usuário

- **Severidade**: P2
- **Tactic violada**: Limit Event Response
- **Localização**: `src/backend/http/rateLimit.ts:99`
- **Evidência (objetiva)**:
  ```
  requestWasSuccessful: (_req, res) => res.statusCode !== 422   // 503/500 contam como "sucesso" e saem da conta
  ```
- **Impacto técnico**: A janela só penaliza senha atual errada. Um loop de requests com 503 não é contido; cada um custa bcrypt + 3 chamadas externas. Também não há limite de requests em voo por usuário.
- **Impacto de negócio**: Amplifica F-performance-1 e queima cota de rate do GoTrue (o 429 do GoTrue vira 503 para todos).
- **Métrica de baseline**: 0 limites sobre requests com resposta 503; limite global de 100 req/min/IP é o único freio.

### F-performance-3: Dois bcrypt de custo 12 em `bcryptjs` (JS puro) por troca

- **Severidade**: P3
- **Tactic violada**: Increase Resource Efficiency
- **Localização**: `OwnPasswordService.ts:97-111`; `package.json:41`
- **Evidência (objetiva)**:
  ```
  bcrypt.compare(senhaAtual, hash) (modo local/sem vínculo) + bcrypt.hash(novaSenha, 12)
  ```
- **Impacto técnico**: Estimativa (não medida aqui): cerca de 250 a 400 ms de CPU por hash em `bcryptjs`, ~0,6 s por troca em modo local, disputando CPU com o resto do Express (o `bcryptjs` assíncrono cede o loop em blocos, mas consome o mesmo processo). Aceitável para operação rara; custo 12 é o padrão do projeto, sem regressão. Medir antes de agir.
- **Impacto de negócio**: Baixo, ação rara por usuário.
- **Métrica de baseline**: ~2 hashes por request, ~0,5 a 0,8 s CPU (estimativa; Não medido).

## 5. Cards Kanban

### [performance-1] Tirar a chamada ao GoTrue de dentro da transação com lock ou limitar a concorrência da rota

- **Problema**
  > `updatePassword` mantém conexão e `FOR UPDATE` durante o `PUT /user` (até 10 s). Com o pool em 5, poucas requisições lentas travam toda a API.

- **Melhoria Proposta**
  > Opção A (menor mudança): semáforo/bulkhead de no máximo 2 trocas simultâneas no processo (Schedule Resources) e timeout dedicado de 3 s para o `PUT /user` (Bound Execution Times). Opção B: manter a ordem R6 mas com `lock_timeout` curto e `SET LOCAL idle_in_transaction_session_timeout`. Tocar `OwnPasswordService.ts`, `SupabaseAuthClient.ts` (timeout por operação) e um util de concorrência. Reavaliar contra o ADR-0059.

- **Resultado Esperado**
  > Conexões retidas por `/me/senha` no pior caso: 5 de 5 → ≤ 2 de 5; tempo máximo de tx da feature: 10 s → 3 s.

- **Tactic alvo**: Schedule Resources / Bound Execution Times
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Conexões retidas simultâneas por `/me/senha`: 5 → ≤ 2
  - Duração máxima da tx: 10 s → 3 s
  - Teste de carga (10 requests concorrentes, GoTrue com 8 s de atraso): rotas não relacionadas com p95 < 1 s
- **Risco de não fazer**: Qualquer lentidão do GoTrue derruba as demais frentes por tempo igual ao timeout.
- **Dependências**: Revisão do ADR-0059 (decisão R6).

### [performance-2] Contar 503/timeout no limiter de troca de senha e limitar requests em voo por usuário

- **Problema**
  > O limiter ignora tudo que não for 422, então tentativas que acabam em 503 não contam e custam bcrypt mais 3 chamadas externas.

- **Melhoria Proposta**
  > Limiter secundário por usuário (ex.: 10 requests / 5 min, qualquer status exceto 204) ou trocar `requestWasSuccessful` para só poupar 204; mais um limite de 1 request em voo por `sub`. Arquivo: `http/rateLimit.ts`, `routes/me.ts`.

- **Resultado Esperado**
  > Requests sem sucesso por usuário em 5 min: ilimitado (teto global 100/min/IP) → ≤ 10.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Chamadas ao GoTrue por usuário em 5 min: sem teto → ≤ 30
  - Teste unitário: 11ª requisição 503 em 5 min → 429
- **Risco de não fazer**: Rota amplifica indisponibilidade do GoTrue e consome sua cota.
- **Dependências**: nenhuma

### [performance-3] Medir o custo real do bcrypt e registrar duração da troca

- **Problema**
  > O custo (2 hashes JS puro, custo 12) é estimado, não medido. Sem latência no log, não há como confirmar o orçamento.

- **Melhoria Proposta**
  > Adicionar `duracaoMs` ao log de sucesso de `OwnPasswordService` e medir um `bcrypt.hash` na máquina da Render. Só trocar para `bcrypt` nativo se > 400 ms por hash.

- **Resultado Esperado**
  > Custo por troca: estimativa (~0,6 s) → valor medido, com alvo p95 ≤ 1,5 s em `/me/senha`.

- **Tactic alvo**: Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Campo `duracaoMs` presente no log: 0% → 100%
  - Hash medido: não medido → ≤ 400 ms
- **Risco de não fazer**: Decisões de custo seguem no escuro; impacto baixo.
- **Dependências**: nenhuma

## 6. Notas do agente

- `--quick`, escopo só do delta; sem infra/Lambda/frontend. Cold start e bundle: não medíveis (Express na Render).
- Cross-QA: F-performance-1 e 2 sobrepõem Availability e Fault Tolerance (bulkhead, timeout, pool compartilhado) e Security (rate limit de abuso). 
- Latência e custo do bcrypt são estimativas; nenhum P0 introduzido pelo delta.
