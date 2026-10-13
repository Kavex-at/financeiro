---
qa: Performance
qa_slug: performance
run_id: 2026-10-13-1518
agent: qa-performance
generated_at: 2026-10-13T15:40:00-03:00
scope: backend
score: 7.5
findings_count: 3
cards_count: 3
---

# Performance — Regis-Review

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analistas SISPAG abrindo a tela em rajada (início do expediente) + cron `48 11-22 * * 1-5` | N aberturas com a última passada > 30 min; botão "Sincronizar lotes" clicado em paralelo | `SincronizacaoPassadaService` (passada L11 ~25 s no Conexos, advisory lock em conexão dedicada do pool max 5), rotas `/sispag/lotes/sincronizar[-se-defasado]` | Operação normal, Conexos com p99 de 2-10 s por chamada | Uma única passada por vez; demais requisições respondem `fresca`/`em_andamento` sem tocar o Conexos; pool não se esgota | <= 1 passada concorrente; 0 chamadas Conexos extras por abertura dentro do TTL; conexões de pool presas <= 1 de 5; passada com teto de duração |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Duração da passada L11 | ~25 s (fan-out 4) | <= 30 s p95 | ✅ | `_shared-metrics.md` (run 37860107255) |
| Passadas concorrentes | 1 (advisory lock `pg_try_advisory_lock`, não bloqueante) | 1 | ✅ | `PostgreeDatabaseClient.ts:210-231` |
| Conexões de pool presas durante a passada | 1 de 5 (20%) | <= 20% | ⚠️ | `withAdvisoryLock`, `PostgreeDatabaseClient.ts:218` |
| Teto de duração da passada (Bound Execution Times) | ausente (só o `RUN_PRESA_MS` de 10 min, que não libera a trava) | presente | ❌ | `SincronizacaoPassadaService.ts:20,244` |
| Rotas de disparo com rate limit | 1 de 2 (`/sincronizar` tem `heavyRouteLimiter`; `/sincronizar-se-defasado` não) | 2 de 2 | ⚠️ | `routes/sispag.ts` |
| Chamadas Conexos por abertura dentro do TTL (30 min) | 0 (1 query em `job_execucao`, LIMIT 5) | 0 | ✅ | `SincronizacaoPassadaService.ts:97-100` |
| Consulta de TTL limitada | `listRecentRuns(..., 5)` | LIMIT | ✅ | idem |
| Timers manuais no delta | 0 (reconferência do front é efeito com intervalo, 48 s teto) | 0 | ✅ | `useCarteiraAoAbrir.ts` |
| Passadas por dia (antes -> depois) | cron 2-3x/dia; agora cron + aberturas, teto teórico 1 por 30 min por TTL | <= 24/dia em 12 h úteis | ✅ | cálculo: 12 h / 0,5 h |
| Bundle Lambda / cold start | ⚠️ Não medível: runtime Express/Render, sem `infra/` | — | ⚠️ | CLAUDE.md |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | TTL 30 min + cooldown 5 min de falha, configuráveis por env | ✅ presente | `SincronizacaoPassadaService.ts:93-125` |
| Limit Event Response | Abertura dentro do TTL devolve `fresca`; lock ocupado vira `em_andamento` | ✅ presente | `:137-157` |
| Prioritize Events | Carteira antes dos lotes (sequencial) no front | ⚠️ parcial | `useCarteiraAoAbrir.ts` |
| Reduce Overhead | Uma passada serve cron, abertura e botão; remove sync por lote | ✅ presente | `routes/sispag.ts` |
| Bound Execution Times | Sem timeout/AbortSignal na passada; trava segura enquanto o Conexos pendurar | ❌ ausente | `:76-86` |
| Increase Resource Efficiency | Fan-out 4 no `sincronizarTodos` | ✅ presente | ADR-0066 |
| Increase Resources | N/A: Render fixo, sem reserved concurrency | N/A | CLAUDE.md |
| Increase Concurrency | Fan-out 4 intra-passada; inter-passada serializada de propósito | ✅ presente | idem |
| Maintain Multiple Copies of Computations | N/A: passada única por desenho | N/A | — |
| Maintain Multiple Copies of Data | `job_execucao` é o cache do relógio (stale-while-revalidate) | ✅ presente | `:97` |
| Bound Queue Sizes | Sem fila; trava não bloqueante, sem acúmulo de espera | ✅ presente | `PostgreeDatabaseClient.ts:220` |
| Schedule Resources | Sequenciamento carteira -> lotes evita estourar o cap de sessões do robô | ✅ presente | `useCarteiraAoAbrir.ts` |
| Cache strategy | TTL no servidor; front dispara 1x por abertura | ✅ presente | — |
| Index discipline | ⚠️ Não medível: consulta por `pipeline` em `job_execucao` com ORDER BY recente; índice não verificado neste delta | ⚠️ parcial | `JobExecucaoRepository` |

## 4. Findings

### F-performance-1: Passada sem teto de duração segura a trava e uma conexão do pool

- **Severidade**: P2
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoPassadaService.ts:76-86,244`; `PostgreeDatabaseClient.ts:218-230`
- **Evidência (objetiva)**:
  ```
  const resumo = await this.sincronizacao.sincronizarTodos();   // sem timeout
  withAdvisoryLock: client mantido até onAcquired resolver
  ```
- **Impacto técnico**: se o Conexos pendurar (sem resposta), a passada fica com a trava e 1 de 5 conexões do pool do processo indefinidamente; `RUN_PRESA_MS` só afeta a leitura do TTL, não libera a trava. Novas aberturas ficam `em_andamento` até o processo reiniciar.
- **Impacto de negócio**: lotes SISPAG param de refletir a baixa do Conexos sem alarme claro.
- **Métrica de baseline**: duração normal ~25 s; teto atual = infinito (0 deadline).

### F-performance-2: `/lotes/sincronizar-se-defasado` sem rate limit; janela check-then-lock

- **Severidade**: P3
- **Tactic violada**: Limit Event Response
- **Localização**: `src/backend/routes/sispag.ts` (rota `sincronizar-se-defasado`)
- **Evidência (objetiva)**: `/sincronizar` leva `heavyRouteLimiter`; `/sincronizar-se-defasado` não. A checagem do TTL (`listRecentRuns`) é anterior ao `pg_try_advisory_lock`: uma abertura que leu "defasada" logo antes de outra passada terminar pode rodar uma segunda passada completa de ~25 s.
- **Impacto técnico**: no pior caso 1 passada redundante por rajada; chamadas diretas à rota geram 1 query barata cada.
- **Impacto de negócio**: carga extra desnecessária (~25 s de leituras) sobre o Conexos, que já tem cap de sessões.
- **Métrica de baseline**: 0 rate limit na rota; janela de corrida na ordem de milissegundos a segundos.

### F-performance-3: Requisição HTTP presa ~25 s por abertura e conexão dedicada em pool de 5

- **Severidade**: P3
- **Tactic violada**: Reduce Overhead
- **Localização**: `routes/sispag.ts`; `useCarteiraAoAbrir.ts` (reconferência até ~48 s)
- **Evidência (objetiva)**: a rota aguarda a passada inteira (`await service.sincronizarSeDefasada`); a conexão do lock reduz o pool utilizável do processo para 4 durante ~25 s a cada 30 min.
- **Impacto técnico**: sob outras cargas no mesmo processo Render, 20% do pool fica indisponível por ~25 s; timeouts de proxy (Render ~100 s) têm folga hoje.
- **Impacto de negócio**: latência marginal nas telas durante a passada; sem incidente observado.
- **Métrica de baseline**: 1/5 conexões presas por ~25 s por passada.

## 5. Cards Kanban

### [performance-1] Impor teto de duração à passada L11

- **Problema**
  > `sincronizarTodos()` não tem deadline; um Conexos pendurado mantém advisory lock e 1 conexão do pool presos, e toda abertura passa a responder `em_andamento`.

- **Melhoria Proposta**
  > Bound Execution Times: envolver `rodar` em timeout (ex. 120 s, configurável via `EnvironmentProvider`) com AbortSignal/`Promise.race`, finalizando a run como `error` e liberando a trava no `finally`. Tocar `SincronizacaoPassadaService.rodar` e teste com fake timers.

- **Resultado Esperado**
  > Passada pendurada encerra em <= 120 s e libera trava/conexão; teto de duração: infinito -> 120 s.

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Tempo máximo de retenção da trava: ilimitado -> <= 120 s
  - Conexões de pool presas após timeout: 1 -> 0
- **Risco de não fazer**: um incidente do Conexos congela a sincronização de lotes até reiniciar o processo.
- **Dependências**: nenhuma

### [performance-2] Aplicar rate limit e reavaliar TTL dentro da trava

- **Problema**
  > A rota de abertura não tem limiter e o TTL é lido antes da trava, permitindo passada redundante em rajada.

- **Melhoria Proposta**
  > Limit Event Response: adicionar limiter leve (ex. 10/min por usuário) a `/sincronizar-se-defasado` e, em `sincronizarSeDefasada`, rechecar o TTL dentro do callback `onAcquired` antes de `rodar`.

- **Resultado Esperado**
  > Passadas redundantes por rajada de aberturas: <= 1 -> 0; rota com limiter 0 -> 1.

- **Tactic alvo**: Limit Event Response
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Passadas duplicadas em 10 aberturas simultâneas após TTL vencido: 1 possível -> 0
- **Risco de não fazer**: carga redundante ocasional sobre o Conexos.
- **Dependências**: nenhuma

### [performance-3] Tornar a abertura assíncrona (202 + polling do estado)

- **Problema**
  > A abertura mantém uma requisição HTTP de ~25 s e o front reconfere por até 48 s.

- **Melhoria Proposta**
  > Reduce Overhead: a rota de abertura inicia a passada em background e devolve `em_andamento` imediatamente; o front consulta um GET barato do estado. Só vale se o pool/timeout do proxy virarem restrição; ao migrar para Lambda, mover a passada para SQS/job.

- **Resultado Esperado**
  > Latência da rota de abertura de ~25 s -> < 300 ms p95.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - p95 da rota `sincronizar-se-defasado`: ~25 s -> < 0,3 s
- **Risco de não fazer**: na migração para Lambda a requisição síncrona de 25 s esbarra no timeout do API Gateway (29 s).
- **Dependências**: performance-1

## 6. Notas do agente

- Escopo: só o delta; modo --quick, sem build do frontend nem medição de bundle (runtime Express, sem `infra/`).
- Cross-QA: timeout da passada (performance-1) sobrepõe Availability e Fault Tolerance; índice de `job_execucao` sobrepõe Modifiability (schema).
- Sem N+1 novo: a passada delega ao `SincronizacaoLoteService` existente (fan-out 4, fora do delta de revisão).
