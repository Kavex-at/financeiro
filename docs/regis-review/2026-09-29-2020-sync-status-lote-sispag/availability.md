---
qa: Availability
qa_slug: availability
run_id: 2026-09-29-2020
agent: qa-availability
generated_at: 2026-09-29T20:30:00Z
scope: backend
score: 7
findings_count: 5
cards_count: 4
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ERP / credencial dos crons GitHub Actions | Credencial vencida, sessão recusada ou fin064/fin052 lento ou fora durante a passada horária de sincronização | `SincronizarLotesSispagJob`, `SincronizacaoLoteService`, `ConexosSispagClient`, `ConexosTitulosClient`, workflow `sincronizar-lotes-sispag.yml` | Operação normal, dias úteis 08–19 BRT, um cron por hora | Retentar leitura, isolar o lote que falhou, gravar só o que foi lido (I11b/I11c), fechar a run como `error`/`partial` e alertar; nenhuma escrita no ERP | Falha total detectada na mesma run (exit 1 + alerta ADR-0042); demais lotes sincronizados na passada; status do lote defasado no máximo 1 cadência (1h) |

## 2. Métricas observadas

Escopo restrito ao delta da feature e diretórios tocados (`--quick`; nada dinâmico rodado além do baseline de `_shared-metrics.md`).

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos (não-teste) usando Executor, backend inteiro | 11 | — | ⚠️ | `grep -rln "RetryExecutor\|FallbackExecutor\|PollExecutor" src/backend` |
| Arquivos de domínio com HTTP cru (axios/fetch), não-teste | 6 | — | ⚠️ | `grep -rln "axios\|fetch(" src/backend/domain` |
| Leituras Conexos novas no delta cobertas por `runWithRetry` | 100% (ConexosSispagClient: 14 sítios; ConexosTitulosClient: leitura de baixas) | ≥80% | ✅ | `ConexosSispagClient.ts:357-691`, `ConexosTitulosClient.ts:226` |
| Retry do cliente base | 2 retries, 500 ms + jitter 200 ms, sem retry em recusa determinística (4xx) | backoff com jitter | ✅ | `ConexosBaseClient.ts:154-160` |
| Clients externos com timeout explícito | Conexos (legado) 40 s (`services/conexos.ts:121`); `BcbClient` 10 s. Clients novos do delta herdam o do base | 100% | ✅ | `grep -rn timeout src/backend` |
| Idempotência da sincronização | Passada sem mudança não mexe em `versao`; mudança sob optimistic lock (`versao` + `status`) e transação | lock em quem muta estado | ✅ | `SincronizacaoLoteService.ts:223-262`, `LotePagamentoRepository.ts:762-784,964` |
| Escrita no ERP pelo novo fluxo | 0 (read-only, I11a) | 0 | ✅ | docstring `SincronizacaoLoteService.ts:70-88`; workflow |
| Guard de transição de estado | `DecisaoStatusLote` + `exigirSincronizavel` + `status = ANY($de)` no UPDATE | guard presente | ✅ | `DecisaoStatusLote.ts`, `LotePagamentoRepository.ts:784` |
| Concorrência do cron | `concurrency` com `cancel-in-progress: false` | 1 por job | ✅ | workflow linhas 28-30 |
| Timeout do job | 15 min (`timeout-minutes`) | explícito | ✅ | workflow linha 34 |
| Detecção de parada silenciosa (staleness) | Limite 64 h para cadência de 1 h | ≤ ~3 cadências úteis | ⚠️ | `stalenessLimits.ts:99-108` |
| Alarmes CloudWatch / DLQ / Lambda | Não medível — não existe `infra/` nem SQS | — | N/A | CLAUDE.md, `_shared-metrics.md` |
| Referências a `shared_account_id` em backend | Não medível — sem infra multi-tenant hoje | 0 | N/A | CLAUDE.md |
| Gates (typecheck/lint/testes) | PASS; 3233 backend / 656 frontend | verde | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: MTTR real, taxa de falha do fin064/fin052 por hora, % de runs `partial`. Requer consulta à tabela `job_execucao` (pipeline `sispag-sincronizacao`) em produção. Recomendação: dashboard no Painel de Operação com duração da run, razão `falhasLeitura/lotes` e tempo `baixa no ERP → status BAIXADO` no lote.

> ⚠️ **Não medível localmente**: DLQ, alarmes e Lambda concurrency. Não há `infra/`; o equivalente hoje é o alerta `job-falhou` (ADR-0042) e o detector de staleness.

## 3. Tactics — Cobertura

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum health-check ativo do Conexos antes da passada | ❌ ausente | — |
| Heartbeat | Run em `job_execucao` por passada + `detect-staleness` como heartbeat passivo (limite 64 h) | ⚠️ parcial | `SincronizarLotesSispagJob.ts:26`, `stalenessLimits.ts:99` |
| Monitor | Painel de Operação, alerta `job-falhou`, métricas da run (lotes, falhas, pulados, eventos não lidos) | ✅ presente | `SincronizarLotesSispagJob.ts:52-70`, workflow linhas 63-73 |
| Timestamp | `sincronizado_em` por item, `versao`, `janelaInicio` do alerta | ✅ presente | `SincronizacaoLoteService.ts:216-224` |
| Sanity Checking | Leitura ilegível não decide nada (I11c); `legivel` do fin064; tudo ilegível => `FALHA_LEITURA` | ✅ presente | `SincronizacaoLoteService.ts:211-218`, `ConexosSispagClient.ts:97` |
| Condition Monitoring | Contadores `itensIlegiveis`, `eventosNaoLidos`, baixas ilegíveis | ✅ presente | `SincronizacaoLoteService.ts:377-392` |
| Voting | Fonte única de verdade por decisão (fin064); precedência entre eventos não é votação de réplicas | N/A | Sem réplicas redundantes a votar |
| Exception Detection | `allSettled` via `BoundedConcurrency`; exit 1 quando todas as leituras falham; sem catch silencioso no delta | ✅ presente | `SincronizacaoLoteService.ts:317-334`, `SincronizarLotesSispagJob.ts:36-49` |
| Self-Test | `validate-sync-status-lote-sispag-v1.ts` (probe manual read-only), integração 0069 | ⚠️ parcial | `jobs/validate-sync-status-lote-sispag-v1.ts` |
| Active Redundancy | Instância única do cron | N/A | Job batch horário; sessões Conexos limitadas por usuário tornam redundância contraproducente |
| Passive Redundancy | Ausente; a próxima passada horária cobre a anterior | ❌ ausente | — |
| Spare | Nenhuma credencial/sessão reserva do Conexos | ❌ ausente | Gotcha 23/09: senha dos crons desatualizada |
| Exception Handling | Falha de leitura contida e contada; alerta best-effort não derruba gravação; falha de DB em um lote aborta a passada (F-1) | ⚠️ parcial | `SincronizacaoLoteService.ts:127-129,431-446` |
| Rollback | Transação por lote + rollback da migração 0069 | ✅ presente | `LotePagamentoRepository.ts:964`, `0069_*.rollback.sql` |
| Software Upgrade | Migrações aplicadas no workflow (`npm run migrate`), idempotente | ⚠️ parcial | workflow linha 55 |
| Retry | `RetryExecutor` 2 retries, backoff + jitter, gate de recusa determinística | ✅ presente | `ConexosBaseClient.ts:154-160` |
| Ignore Faulty Behavior | Leitura ilegível ignorada e logada; lote pulado em conflito de versão | ✅ presente | `SincronizacaoLoteService.ts:244-259` |
| Degradation | Leitura parcial atualiza o que leu; falha total => `error` visível, sem gravar | ✅ presente | `SincronizarLotesSispagJob.ts:52-70` |
| Reconfiguration | Sem mudança de rota/credencial em runtime | ❌ ausente | — |
| Shadow | `dryRunOverride` na conciliação e probe read-only de validação | ⚠️ parcial | `ConciliacaoRetornoService.ts:333` |
| State Resynchronization | O job é a ressincronização do estado local com o ERP; idempotente e autocorretivo a cada hora | ✅ presente | `SincronizacaoLoteService.ts:118-131` |
| Escalating Restart | Sem escalonamento além do retry e do próximo cron | ❌ ausente | — |
| Non-Stop Forwarding | Sem plano de controle/dados separados | N/A | Não se aplica a batch sobre ERP |
| Removal from Service | Sem kill-switch de leitura; kill-switches de escrita não se aplicam por design (I11g) | N/A | Fluxo read-only no ERP |
| Transactions | Itens + transição atômicos sob optimistic lock (I6) | ✅ presente | `LotePagamentoRepository.ts:762-784,964` |
| Predictive Model | Ausente | ❌ ausente | — |
| Exception Prevention | Zod com `legivel`; optimistic lock; `concurrency` do workflow | ✅ presente | `ConexosSispagClient.ts:53-120`, workflow linhas 28-30 |
| Increase Competence Set | Decisão pura e testável (`DecisaoStatusLote`) cobre rejeição, `BD`, baixa manual, estorno | ✅ presente | `DecisaoStatusLote.test.ts` (376 linhas) |

## 4. Findings

### F-availability-1: Falha de banco em um lote aborta a passada inteira de sincronização (in-delta)

- **Severidade**: P2
- **Tactic violada**: Exception Handling (isolamento de falha por unidade)
- **Localização**: `src/backend/domain/service/sispag/SincronizacaoLoteService.ts:127-129`; `src/backend/jobs/SincronizarLotesSispagJob.ts:36-49`
- **Evidência (objetiva)**:
  ```
  for (const lote of lotes) {
      resultados.push(await this.processarLote(lote, porLote.get(lote.id), agora));
  }
  ```
  `processarLote` não tem `try/catch`: erro de `aplicarSincronizacao`/`tocarSincronizacao` sobe, o job fecha `error` e os lotes restantes ficam sem sincronizar até a próxima hora. Falhas de leitura do Conexos já são isoladas (`allSettled`); o caminho de banco não é.
- **Impacto técnico**: um lote com dado que provoque erro de DB repete a falha a cada hora e bloqueia os lotes seguintes na lista.
- **Impacto de negócio**: status de lotes SISPAG defasado para lotes saudáveis por causa de um lote doente.
- **Métrica de baseline**: 1 exceção => até N-1 lotes não processados na passada (N real não medível localmente). Sem número de produção, mantido P2.

### F-availability-2: Limite de staleness de 64 h para um cron de cadência 1 h (in-delta)

- **Severidade**: P1
- **Tactic violada**: Heartbeat / Monitor
- **Localização**: `src/backend/domain/interface/operacao/stalenessLimits.ts:99-108`
- **Evidência (objetiva)**:
  ```
  cadencia: '35 11-22 * * 1-5 (de hora em hora, dias úteis)'
  limiteMs: 64 * HORA_MS,
  ```
  O comentário do código admite: "uma parada numa terça só aparece na quinta". O `schedule` do GitHub Actions é best-effort e só dispara da branch padrão (comentário do workflow, linhas 21-22).
- **Impacto técnico**: cron desabilitado, fora de `main` ou perdido é detectado 64 h depois. Só a falha TOTAL de leitura é coberta (exit 1).
- **Impacto de negócio**: até 2 dias úteis com status de lote defasado sem alerta, num fluxo em que a baixa manual no ERP já ocorreu.
- **Métrica de baseline**: 64 h de limite vs 1 h de cadência = 64x.

### F-availability-3: Sem orçamento de tempo na passada; morte por `timeout-minutes` deixa a run aberta (in-delta)

- **Severidade**: P2
- **Tactic violada**: Exception Prevention
- **Localização**: `.github/workflows/sincronizar-lotes-sispag.yml:34`; `SincronizacaoLoteService.ts:123-129,180-194`
- **Evidência (objetiva)**: o workflow mata em 15 min sem passar por `finishRun`; lotes processados em série, cada item lido via fin064 (+ PSQ_018) com timeout de 40 s × até 3 tentativas (`services/conexos.ts:121`, `ConexosBaseClient.ts:154`).
- **Impacto técnico**: com Conexos lento, o pior caso por chamada é ~120 s; a passada cresce com o número de itens e pode estourar 15 min sem registrar desfecho.
- **Impacto de negócio**: run em `running` polui o Painel; a passada seguinte recomeça do zero.
- **Métrica de baseline**: teto de 15 min vs ~120 s de pior caso por chamada (cerca de 7 chamadas em série no pior caso já estouram; a fan-out limitada por `CONEXOS_FANOUT_LIMIT` reduz isso). Volume real não medível localmente.

### F-availability-4: Sessão simultânea do Conexos disputada com `reconciliar-nde` no mesmo minuto :35 (in-delta)

- **Severidade**: P2
- **Tactic violada**: Spare / Reconfiguration
- **Localização**: `.github/workflows/sincronizar-lotes-sispag.yml:15-17`
- **Evidência (objetiva)**: "O :35 coincide com o `reconciliar-nde`; se houver disputa de sessão, desloque um dos dois." (`LOGIN_ERROR_MAX_SESSIONS`); todos os crons usam o mesmo usuário/secret CONEXOS_*.
- **Impacto técnico**: falha de login por limite de sessões vira leitura ilegível => run `error` ou `partial`; problema conhecido e deixado como TODO.
- **Impacto de negócio**: alerta falso de credencial em horário de pico, ou sincronização perdida na hora.
- **Métrica de baseline**: 12 execuções por dia útil (11–22 UTC) no mesmo minuto que outro cron; taxa real de `MAX_SESSIONS` não medível localmente.

### F-availability-5: Timeout Conexos 40 s × 3 tentativas sem circuit breaker, com fan-out por item (pré-existente, agravado pelo delta)

- **Severidade**: P2
- **Tactic violada**: Exception Prevention (Circuit Breaker) / Removal from Service
- **Localização**: `src/backend/services/conexos.ts:121`; `ConexosBaseClient.ts:154-160`; uso novo em `SincronizacaoLoteService.ts:317-334`
- **Evidência (objetiva)**: `timeout: 40000`; `retries: 2`. Sem detecção de indisponibilidade sustentada: cada item repete o ciclo completo de retry contra um Conexos fora do ar.
- **Impacto técnico**: Conexos degradado multiplica o tempo da passada (F-availability-3) e a carga sobre um ERP já lento.
- **Impacto de negócio**: risco de contribuir para a degradação do ERP da Columbia em horário de operação.
- **Métrica de baseline**: pior caso ~120 s por chamada; sem limite de falhas consecutivas por passada.

## 5. Cards Kanban

### [availability-1] Isolar falha por lote na passada de sincronização

- **Problema**
  > `sincronizarTodos` chama `processarLote` sem `try/catch` (`SincronizacaoLoteService.ts:127-129`); um erro de banco em um lote aborta os demais e se repete a cada hora.
- **Melhoria Proposta**
  > Envolver `processarLote` em `try/catch` no loop, registrar via `LogService` (pt-BR), devolver resultado de falha com contagem própria em `ResumoSincronizacao` e fechar a run como `partial`. Manter exit 1 só quando todas as unidades falham. Tactic: Exception Handling. Tocar `SincronizacaoLoteService.ts`, `SincronizarLotesSispagJob.ts` e testes.
- **Resultado Esperado**
  > Um lote com falha não impede os demais: lotes não processados por exceção de um vizinho: N-1 → 0.
- **Tactic alvo**: Exception Handling
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Lotes sincronizados numa passada com 1 lote defeituoso: 0 (abortada) → N-1
  - Teste com exceção de repositório no meio da lista: ausente → presente
- **Risco de não fazer**: um lote "envenenado" congela a sincronização dos demais até intervenção manual.
- **Dependências**: nenhuma

### [availability-2] Tornar o staleness da sincronização sensível à janela útil

- **Problema**
  > Limite de 64 h para cadência de 1 h (`stalenessLimits.ts:99-108`) faz uma parada de cron aparecer só 2 dias depois; o GitHub pode atrasar ou desativar schedules.
- **Melhoria Proposta**
  > Limite consciente de calendário: ~3 h dentro da janela 11–22 UTC em dia útil, descontando fins de semana. Alternativa: exibir "última sincronização bem-sucedida" no card do lote. Tactic: Heartbeat / Monitor.
- **Resultado Esperado**
  > Detecção de cron parado: 64 h → ≤ 3 h úteis.
- **Tactic alvo**: Heartbeat
- **Severidade**: P1
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Tempo até alerta de cron parado em dia útil: 64 h → ≤ 3 h
  - Falsos alertas em fins de semana: 0 mantido
- **Risco de não fazer**: status de lotes defasado por até 2 dias úteis sem ninguém saber.
- **Dependências**: regra `staleness-por-pipeline`

### [availability-3] Adicionar orçamento de tempo e limite de falhas consecutivas na passada

- **Problema**
  > Sem orçamento interno, uma passada lenta é morta pelo `timeout-minutes: 15` sem `finishRun`, e um Conexos fora do ar recebe o ciclo completo de retry por item.
- **Melhoria Proposta**
  > Prazo interno (ex.: 12 min) checado entre lotes; ao estourar, parar, fechar `partial` com contagem de lotes não processados e priorizar por `sincronizado_em` mais antigo. Acrescentar circuit breaker leve (N falhas consecutivas do Conexos encerram a passada como `error`). Tactic: Exception Prevention.
- **Resultado Esperado**
  > Runs órfãs em `running`: possíveis → 0; chamadas ao Conexos após N falhas consecutivas: ilimitadas → 0.
- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-3, F-availability-5
- **Métricas de sucesso**:
  - Runs terminadas por timeout do workflow: não medível → 0
  - Chamadas ao Conexos após falhas consecutivas: ilimitadas → limitadas a N
- **Risco de não fazer**: com a carteira crescendo, a passada é cortada e o Painel mostra runs fantasma.
- **Dependências**: availability-1

### [availability-4] Desacoplar o minuto do cron das demais rotinas que usam a sessão Conexos

- **Problema**
  > O :35 coincide com `reconciliar-nde` e ambos compartilham o mesmo usuário Conexos com limite de sessões; o próprio workflow deixa o deslocamento como TODO.
- **Melhoria Proposta**
  > Mover o cron para um minuto sem colisão (ex.: :50) e manter um mapa único de horários dos crons; avaliar reutilizar a sessão persistida em vez de novo login. Tactic: Reconfiguration.
- **Resultado Esperado**
  > Crons Conexos no mesmo minuto: 2 → 1; falsos `job-falhou` por `MAX_SESSIONS`: 0.
- **Tactic alvo**: Reconfiguration
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Crons Conexos por minuto de disparo: 2 → 1
- **Risco de não fazer**: alerta de credencial falso ou sincronização perdida em hora de pico, minando a confiança no alerta.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta e diretórios tocados; `--quick`, sem rodar testes. Sem `infra/`: DLQ, alarmes CloudWatch e blast radius por conta AWS não medíveis (N/A).
- Nenhum P0: o novo fluxo não escreve no ERP, o optimistic lock e a transação impedem dupla gravação, e falha total de credencial fecha a run como erro (lição de 23/09 aplicada).
- Conexões cross-QA: F-availability-4/5 tocam Performance e Integrability; F-availability-2 toca Deployability (schedule só na branch padrão).
