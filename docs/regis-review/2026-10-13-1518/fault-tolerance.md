---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-10-13-1518
agent: qa-fault-tolerance
generated_at: 2026-10-13T15:30:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review

Escopo (--quick): somente o delta `origin/main...HEAD` da branch `fix/sispag-sync-ao-abrir` (SincronizacaoPassadaService, SincronizarLotesSispagJob, rotas ADR-0066, hook do frontend). Fluxo read-only no ERP (I11a): não há escrita financeira nova; o risco é de consistência da trilha `job_execucao` e de contenção.

## 1. Cenário Geral

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo a tela, cron e botão "Sincronizar lotes" | Três gatilhos simultâneos; processo derrubado no meio da passada; Conexos fora ou credencial vencida | `SincronizacaoPassadaService` + advisory lock + `job_execucao` | Operação normal, Render + runner GitHub no mesmo Postgres | Uma passada por vez; run morta não bloqueia; falha vira run `error` com cooldown; contenção vira `em_andamento` (não erro) | 0 passadas concorrentes; run `running` presa libera em ≤ 10 min; falha total do Conexos -> exit 1 do cron |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Passadas concorrentes possíveis (lock exclusivo, chave 726354820) | 0 (pg_try_advisory_lock em conexão dedicada) | 0 | ✅ | `SincronizacaoPassadaService.ts:13,85`; `PostgreeDatabaseClient.ts:210-231` |
| Escritas no ERP no delta | 0 (delega a `SincronizacaoLoteService`, I11a) | 0 | ✅ | `SincronizacaoPassadaService.ts:69` |
| Idempotência da passada (re-execução) | Idempotente: lock otimista por lote já existente | Idempotente | ✅ | ADR-0066; `SincronizacaoLoteService` (fora do delta) |
| Falha total de leitura vira erro (não `success` vazio) | Sim, `todasFalharam` -> status `error` + exit 1 | Sim | ✅ | `SincronizacaoPassadaService.ts:222-232`; `SincronizarLotesSispagJob.ts:36` |
| Recuperação de run `running` morta | 10 min (leitura); run nunca é fechada no banco | Fechamento explícito | ⚠️ | `SincronizacaoPassadaService.ts:20,124-129` |
| Reprocessamento re-checa TTL dentro do lock | Não | Sim | ⚠️ | `SincronizacaoPassadaService.ts:113-141` vs `153-174` |
| Duração da passada vs. pedido HTTP síncrono | ~25 s medida (cron) | < timeout do proxy | ⚠️ Não medível localmente: timeout do Render/cliente na rota síncrona. Instrumentar com log de duração da passada. | `_shared-metrics.md` |
| Testes de contenção/falha/cooldown/run presa | cobertos em `SincronizacaoPassadaService.test.ts` (256 linhas); suíte 4058/4058 | Cobrir cada cenário | ✅ | `_shared-metrics.md` |

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Sanity Checking | Falha de todas as leituras reclassificada como `error`; Zod/redação de mensagem | ✅ presente | `SincronizacaoPassadaService.ts:222-232` |
| Timestamp | `job_execucao.started_at/finished_at` é o relógio do TTL e do cooldown | ✅ presente | `:109-134` |
| Timeout | Run `running` > 10 min tratada como morta; timeout do cliente Conexos fora do delta | ⚠️ parcial | `:20` |
| Condition Monitoring | `job_execucao` + logs `FLOW_START/COMPLETE/ERROR`; exit 1 no cron em `error` | ✅ presente | `SincronizarLotesSispagJob.ts:36` |
| Redundancy | N/A: fluxo read-only, sem réplica ativa; a exclusão mútua (lock) é o mecanismo relevante | N/A | — |
| Recovery (forward) | Falha -> run `error`, cooldown 5 min na abertura, botão força nova tentativa | ✅ presente | `:130-140,145-149` |
| Reintroduction (State Resync) | A própria passada ressincroniza status dos lotes com a baixa no Conexos | ✅ presente | `:202` |
| Idempotent Replay | Passada repetível; contenção devolve `em_andamento` | ✅ presente | `:167-173` |
| Quarantine | Itens ilegíveis/pulados contados e viram run `partial` | ✅ presente | `:223-229` |
| Repair State (run presa) | Ausente: run `running` morta permanece `running` para sempre | ⚠️ parcial | F-fault-tolerance-1 |
| Compensating Transaction / Rollback | N/A: sem escrita externa; justificado | N/A | I11a |

## 4. Findings

### F-fault-tolerance-1: Run `running` de processo morto nunca é fechada

- **Severidade**: P2
- **Tactic violada**: Repair State
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoPassadaService.ts:20,124-129,192-195`
- **Evidência (objetiva)**:
  ```
  const RUN_PRESA_MS = 10 * MIN_MS;  // só ignora a run na leitura
  ... createRun(...) ... // se o processo cair, finishRun nunca roda
  ```
- **Impacto técnico**: o TTL se recupera sozinho, mas a linha fica `running` para sempre em `job_execucao` (painel de operação mostra passada eternamente em andamento; `RUNS_CONSULTADAS = 5` pode ser ocupado por runs mortas).
- **Impacto de negócio**: ruído no painel de operação; diagnóstico errado durante incidente.
- **Métrica de baseline**: 0 mecanismos de fechamento de run presa; janela de tolerância 10 min.

### F-fault-tolerance-2: Falha de log pós-`finishRun(success)` sobrescreve a run como `error`

- **Severidade**: P3
- **Tactic violada**: Sanity Checking
- **Localização**: `SincronizacaoPassadaService.ts:201-215,242-267`
- **Evidência (objetiva)**:
  ```
  try { const resumo = ...; return await this.fechar(runId, resumo); } catch { finishRun(ERROR) ... }
  ```
  `fechar` chama `finishRun` e depois `logService.info`; se o log lançar, o `catch` regrava a run já concluída como `error`.
- **Impacto técnico**: passada bem-sucedida marcada `error` -> cooldown de 5 min indevido e exit 1 do cron.
- **Impacto de negócio**: alerta falso; atraso de até 5 min na atualização.
- **Métrica de baseline**: 1 caminho de dupla finalização.

### F-fault-tolerance-3: TTL não é rechecado depois de obter o lock

- **Severidade**: P3
- **Tactic violada**: Comparison
- **Localização**: `SincronizacaoPassadaService.ts:109-141` (checagem fora do lock) e `153-159`
- **Evidência (objetiva)**: `sincronizarSeDefasada` lê `listRecentRuns` antes de `executarPassada`; um segundo usuário que leu antes do fim da passada de outro obtém o lock logo depois e roda passada redundante.
- **Impacto técnico**: passada duplicada (~25 s de leitura Conexos), inofensiva por ser idempotente/read-only.
- **Impacto de negócio**: carga extra no Conexos em horário de pico de aberturas.
- **Métrica de baseline**: janela de corrida = duração de 1 passada (~25 s).

### F-fault-tolerance-4: Cron sai 0 quando a trava está ocupada, sem limite para trava "pendurada"

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring
- **Localização**: `src/backend/jobs/SincronizarLotesSispagJob.ts:38-47`
- **Evidência (objetiva)**:
  ```
  if (error instanceof IngestLockBusyError) { ... return 0; }
  ```
- **Impacto técnico**: se uma passada ficar pendurada segurando a conexão do lock (chamada sem timeout, sessão do pooler), todas as execuções do cron e das telas passam a "pular" com sucesso e ninguém é avisado; a run `running` presa libera a leitura do TTL mas não a trava.
- **Impacto de negócio**: status dos lotes SISPAG defasado silenciosamente (cenário análogo ao incidente de 23/09, cron verde sem trabalho).
- **Métrica de baseline**: 0 alertas para N pulos consecutivos; cron roda ~2–3x/dia (07–09/10).

## 5. Cards Kanban

### [fault-tolerance-1] Fechar runs `running` mortas da sincronização SISPAG

- **Problema**
  > Uma run `running` de processo derrubado só é ignorada na leitura (10 min) e nunca fechada; polui `job_execucao` e o painel de operação. Em paralelo, falha de log após `finishRun` pode regravar uma run de sucesso como `error`.

- **Melhoria Proposta**
  > Ao iniciar a passada (já sob o lock), marcar como `error` ("interrompida") as runs `running` do pipeline mais velhas que `RUN_PRESA_MS` (Repair State). Em `fechar`, isolar o `logService` em try/catch próprio para não reentrar no `catch` de erro.

- **Resultado Esperado**
  > Nenhuma run `running` com idade > 10 min; passada bem-sucedida nunca regravada como `error`.

- **Tactic alvo**: Repair State
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1, F-fault-tolerance-2
- **Métricas de sucesso**:
  - Runs `running` > 10 min: indefinido -> 0
  - Caminhos de dupla finalização: 1 -> 0
- **Risco de não fazer**: painel de operação acumula runs fantasmas e dificulta diagnóstico de incidentes.
- **Dependências**: nenhuma

### [fault-tolerance-2] Alertar quando o cron pula N passadas seguidas por trava ocupada

- **Problema**
  > O cron devolve exit 0 quando a trava está ocupada; uma trava pendurada faz o cron "passar verde" indefinidamente sem sincronizar.

- **Melhoria Proposta**
  > Registrar o pulo como run `skipped` (ou checar a idade da última passada finalizada) e sair com exit ≠ 0 se a última passada com sucesso for mais velha que, por exemplo, 3x o TTL (Condition Monitoring). Confirmar timeout do cliente Conexos dentro da passada.

- **Resultado Esperado**
  > Defasagem > 90 min sem passada bem-sucedida gera alerta no workflow.

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-4
- **Métricas de sucesso**:
  - Alertas por trava pendurada: 0 -> 1 na primeira ocorrência
- **Risco de não fazer**: repetição silenciosa do incidente de 23/09 (cron verde sem trabalho).
- **Dependências**: nenhuma

### [fault-tolerance-3] Rechecar o TTL após adquirir o lock

- **Problema**
  > A decisão "defasada?" é tomada antes do lock; duas aberturas quase simultâneas rodam duas passadas em sequência.

- **Melhoria Proposta**
  > Dentro de `rodar` (quando disparado por abertura), reler `listRecentRuns` e retornar `fresca` se já houver sucesso dentro do TTL (double-checked locking).

- **Resultado Esperado**
  > Passadas redundantes na janela de corrida: até 1 por rajada -> 0.

- **Tactic alvo**: Comparison
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3
- **Métricas de sucesso**:
  - Passadas dentro do TTL: possível -> 0
- **Risco de não fazer**: carga extra marginal no Conexos.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo --quick: apenas o delta; `SincronizacaoLoteService` (lock otimista por lote) e clientes Conexos tratados como fora de escopo. Sem P0: não há escrita financeira nova, passada idempotente e read-only.
- O lock é de sessão em conexão dedicada do pool (liberado se a conexão cair); em pooler transacional (pgbouncer) esse padrão pré-existente exigiria revalidação.
- Cross-QA: timeouts/rota síncrona de ~25 s (Availability/Performance); testes de contenção/falha cobertos (Testability); trilha `job_execucao` como auditoria (Security).
