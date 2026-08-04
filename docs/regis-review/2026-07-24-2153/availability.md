---
qa: Availability
qa_slug: availability
run_id: 2026-07-24-2153
agent: qa-availability
generated_at: 2026-07-24T21:53:00Z
scope: backend
score: 6
findings_count: 5
cards_count: 5
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

Frente IV é um pipeline write-through: a `POST /recebimentos/pipeline/run` invoca o
`RecebimentoPipelineService`, que percorre 5 estágios (ingestão → matching → rateio → regras →
execução) e, no estágio final, dispara três operações não-idempotentes contra sistemas externos
(`criarBordero` + `gravarBaixa` no Conexos, `emitir` NDe). A escolha arquitetural correta — e que
essa base já materializa — é um **write-ahead ledger** (`recebimento_execucao`, migração 0035)
como *rendez-vous* de idempotência.

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Conexos ERP / Nexxera / rede | Timeout ou 5xx em `criarBordero` / `gravarBaixa` / `emitir` NDe durante a execução do recebimento | `RecebimentoPipelineService.executarRecebimento` + `RecebimentoExecucaoRepository` | Produção multi-tenant, execução real (`dryRun=false`), gate `recebimentosEnabled=true` | Sistema deve (a) detectar a falha, (b) marcar a linha do ledger como `error` com o erro cru, (c) impedir dupla-quitação/dupla-NDe na retentativa via `idempotency_key`, (d) permitir retomada segura pelo mesmo `correlationId` | 0 baixas duplicadas, 0 NDes duplicadas, 100% das execuções com estado terminal (`settled` ou `error`) — nunca presas em `reconciling` |

O que a base **prova** que suporta esse cenário: a coluna `UNIQUE (idempotency_key)` (0035:27),
o `ON CONFLICT DO UPDATE` que PRESERVA `settled` no `beginExecution` (RecebimentoExecucaoRepository.ts:49-56),
o short-circuit `alreadySettled` no coordinator (RecebimentoPipelineService.ts:209-217), e o teste
dedicado do branch de idempotência (RecebimentoPipelineService.test.ts:83-95).
O que a base **ainda não prova**: que uma falha entre `beginExecution` e `markSettled` seja
capturada e roteada para `markError` — a costura existe no repositório, mas o coordinator não a usa.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Chamadas externas write no `executarRecebimento` envelopadas em `try/catch` | 0 de 3 (`criarBordero`, `gravarBaixa`, `ndeEmitter.emitir`) | 3 de 3 | ❌ | `RecebimentoPipelineService.ts:219-242` — nenhum `try` no arquivo |
| Invocações de `markError` a partir do coordinator | 0 | ≥1 (no catch do `executarRecebimento`) | ❌ | `grep -n "markError" RecebimentoPipelineService.ts` → 0 hits |
| Chamadas externas envelopadas em `RetryExecutor` (ou equivalente) | 0 de 3 | ≥1 (write ERP é retryable com backoff — cf. `ReconciliacaoPermutaService`) | ❌ | `grep -rn "RetryExecutor\|FallbackExecutor" scaffold` → 0 hits |
| Estados terminais no ledger (`recebimento_execucao.status`) | 4 (`pending`, `reconciling`, `settled`, `error`) — schema pronto | 4 alcançáveis pelo caminho de código | ⚠️ | `0035_recebimento_execucao.sql:15-16`; `error` só é alcançável por reset manual |
| Chaves UNIQUE que previnem duplicação em retry | 3 (`transacao_bancaria.natural_key`, `recebimento_execucao.idempotency_key`, `nota_debito_eletronica.idempotency_key`) | 3 nas 3 tabelas onde há write externo | ✅ | `0032:24`, `0035:27`, `0038:22` |
| Guards de máquina de estado (transições ilegais bloqueadas) | 2 (`assertTransitionRecebimento`, `assertTransitionTransacao`), 100% dos códigos usam constantes tipadas | 2, sem strings cruas | ✅ | `recebimentoTransitions.ts:40-50`, `constants.ts:12-31` |
| Timeouts explícitos nos ports externos (`NexxeraGatewayInterface`, `ErpReceivablesGatewayInterface`, `NdeEmitterInterface`) | 0 (contrato não expõe `timeoutMs`/`signal`) | ≥1 (mínimo: parâmetro opcional no port) | ⚠️ | `ports.ts:132-171` — nenhum campo de timeout |
| Estágios com emissão `outcome: 'error'` no MetricsPort | 0 (só `started`/`ok` são emitidos) | 5 estágios com `error` no catch | ❌ | `RecebimentoPipelineService.ts:97-263` — não há emit `error` |
| Correlation-id realmente vinculado ao contexto de log | 0 (stub é pass-through explícito, real ainda não existe) | 1 (real Módulo 6 vincula `logService.setMetadata`) | ⚠️ Não medível até Módulo 6 aterrissar | `MetricsPortStub.ts:28-30` — pass-through documentado; contrato em `ports.ts:174-182` |
| Suite de testes | 63 suites / 675 testes passando (~22s) | verde | ✅ | `_shared-metrics.md` (verificado pelo orchestrator) |
| typecheck / lint | 0 erros / 28 warnings (todos pre-existentes, `services/conexos.ts`) | 0 / 0 | ✅ / ⚠️ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: MTTR real quando o ledger fica preso em `reconciling`. Requer
> instrumentação em produção. Recomendação: dashboard CloudWatch com contagem de
> `recebimento_execucao WHERE status='reconciling' AND atualizado_em < now() - interval '15 min'`
> — essa métrica deve ser 0 em regime estável; quando > 0, a operação sabe que há execução órfã.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Rota `GET /recebimentos/painel` é read-only e liga o gate — serve como echo defensivo do módulo | ⚠️ parcial | `routes/recebimentos.ts:27-33` |
| Heartbeat | Não há batimento periódico entre `bootstrapAppContainer` e Postgres/ERP | ❌ ausente | N/A no scaffold — cobre-se ao aterrissar Módulo 1 (job Nexxera) |
| Monitor | `MetricsPort` emite eventos por estágio via `LogService`; sem alarme, sem dashboard | ⚠️ parcial | `stubs/MetricsPortStub.ts:18-26` |
| Timestamp | Ledger grava `criado_em`/`atualizado_em`; `Recebimento.criadoEm`; `TransacaoBancaria.importadoEm` | ✅ presente | `0035:25-26`, `Recebimento.ts:47`, `0032:23` |
| Sanity Checking | `assertTransitionRecebimento` / `assertTransitionTransacao` guardam as transições da máquina | ✅ presente | `recebimentoTransitions.ts:40-85` |
| Condition Monitoring | Constraint `CHECK (status IN ...)` na coluna e invariante `isRateioBalanceado` | ✅ presente | `0033:14`, `0035:16`, `recebimentoTransitions.ts:96-97` |
| Voting | N/A — não há redundância ativa de motor de matching/rateio no scaffold | N/A | Só um adapter por port; voting só faz sentido se houver múltiplos oráculos |
| Exception Detection | `IllegalTransitionError` cobre estados, MAS não há detecção nas chamadas ao ERP/NDe (sem `try/catch`) | ⚠️ parcial | `recebimentoTransitions.ts:14-25`; ausente em `executarRecebimento` |
| Self-Test | Testes de container (`resolves from the container`) e do short-circuit de idempotência | ⚠️ parcial | `RecebimentoPipelineService.test.ts:53-95` |
| Active Redundancy | N/A — write único no ERP, sem quórum | N/A | Sem sentido para uma escrita ERP única |
| Passive Redundancy | N/A no scaffold | N/A | Fora do escopo Fase 0 |
| Spare | N/A no scaffold | N/A | Fora do escopo Fase 0 |
| Exception Handling | AUSENTE no coordinator: as 3 chamadas externas (`criarBordero`/`gravarBaixa`/`emitir`) sobem crua sem `markError` | ❌ ausente | `RecebimentoPipelineService.ts:219-242` |
| Rollback | Estorno é transição prevista (`EXECUTADO → ESTORNADO`) mas não há ação orquestrada; ledger não trata `error → reconciling` para retry seguro | ⚠️ parcial | `recebimentoTransitions.ts:31`; `RecebimentoExecucaoRepository.ts:39-69` |
| Software Upgrade | N/A neste escopo | N/A | Vertical de deploy |
| Retry | `RetryExecutor` existe no repo mas NÃO é usado por nenhum stub, nem pelo coordinator | ❌ ausente | `grep RetryExecutor scaffold` → 0; `libs/executor/RetryExecutor.ts` disponível |
| Ignore Faulty Behavior | Todos os stubs retornam determinístico "vazio" — comportamento seguro para skeleton | ✅ presente | `IngestaoTransacoesStub.ts:14-21`, `MatchingEngineStub.ts:16-21` |
| Degradation | Fluxo `classificacao=nenhuma` → deveria rotear para fila manual (comentado no stub), mas a rota não existe ainda | ⚠️ parcial | `MatchingEngineStub.ts:11-12` — comentário sinaliza rota, seam não modelada no port |
| Reconfiguration | `recebimentosGate` desliga a frente inteira em prod via `env.recebimentosEnabled` | ✅ presente | `http/recebimentosGate.ts:14-22` |
| Shadow | `dryRun` propaga do input até o ledger e o stub do ERP — permite espelhar o caminho sem escrever | ✅ presente | `RunPipelineInput.dryRun`, `RecebimentoExecucaoRepository.ts:42`, `ErpReceivablesGatewayStub.ts:17-23` |
| State Resynchronization | Ledger + `versao` do agregado dão o mecanismo; falta o job de reconciliação que compara `reconciling` órfão vs. estado ERP | ⚠️ parcial | `0033:19` `versao`, `0035` inteiro — job da reconciliação é Fase 5 |
| Escalating Restart | N/A no scaffold | N/A | Camada Lambda (alvo) — fora da base Frente IV |
| Non-Stop Forwarding | N/A | N/A | Não é gateway de rede |
| Removal from Service | Gate `recebimentosEnabled=false` remove a rota inteira (retorna 403) — inclusive isolando por tenant via env | ✅ presente | `http/recebimentosGate.ts:17-20` |
| Transactions | SQL 100% parametrizado; upsert `ON CONFLICT` preserva `settled` — semântica transacional local do ledger é sólida | ✅ presente | `RecebimentoExecucaoRepository.ts:44-57` |
| Predictive Model | N/A no scaffold | N/A | Fora do escopo Fase 0 |
| Exception Prevention | Zod nos boundaries (`recebimentoSchema`, `runPipelineSchema` na rota), constantes tipadas, `IllegalTransitionError` | ✅ presente | `Recebimento.ts:51-81`, `routes/recebimentos.ts:35-42` |
| Increase Competence Set | Contratos `*Interface` (ports) + tokens `Symbol` isolam módulos, reduzindo cascata quando um módulo falha ou é substituído | ✅ presente | `ports.ts:132-285` |

## 4. Findings (achados)

### F-availability-1: Coordinator não trata falhas do write ERP/NDe — ledger fica preso em `reconciling`

- **Severidade**: P0
- **Tactic violada**: Exception Handling (Recover from Faults — Preparation & Repair)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:183-264`
- **Evidência (objetiva)**:
  ```
  $ grep -n "try\|catch\|markError" src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts
  # (nenhuma linha)
  ```
  A sequência `beginExecution → criarBordero → gravarBaixa → emitir → markSettled` (linhas 202-242) não
  está envelopada em `try/catch`. O irmão `ReconciliacaoPermutaService.ts:220-256` (mesmo repo,
  fluxo análogo) SIM tem o padrão `try { … markSettled } catch (err) { await
  execucaoRepository.markError(key, …) }`.
- **Impacto técnico**: qualquer 5xx/timeout de Conexos ou Nexxera após `beginExecution` deixa a
  linha `recebimento_execucao` presa em `status='reconciling'` para sempre. A retentativa
  seguinte encontra `status='reconciling'` (não `settled`), o coordinator NÃO curto-circuita, e
  chama `criarBordero`+`gravarBaixa` novamente — potencial de baixa duplicada se o POST original
  chegou a executar do outro lado.
- **Impacto de negócio**: dupla-quitação de recebível no ERP + dupla-emissão de NDe = valor
  contábil duplicado, retrabalho de estorno manual, quebra da premissa "0 baixas duplicadas" do
  cenário. Uma NDe emitida em duplicidade tem impacto fiscal, não apenas operacional.
- **Métrica de baseline**: 0/3 chamadas externas com `try/catch`; 0 invocações de `markError` a
  partir do coordinator (grep verificado).

### F-availability-2: Ports externos não expõem timeout — sem controle de tempo máximo por chamada

- **Severidade**: P1
- **Tactic violada**: Monitor / Exception Prevention
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:132-171`
- **Evidência (objetiva)**:
  ```
  $ grep -n "timeout" src/backend/domain/interface/recebimentos/ports.ts
  # (nenhuma linha)
  ```
  `NexxeraGatewayInterface.fetch`, `ErpReceivablesGatewayInterface.criarBordero`/`gravarBaixa` e
  `NdeEmitterInterface.emitir` não têm parâmetro de timeout nem `AbortSignal`. Os stubs são
  in-process (sem risco imediato), mas o contrato — que é o que os 6 teammates vão implementar
  atrás — não força um teto.
- **Impacto técnico**: quando o Módulo 5 aterrissar o cliente real do Conexos, é seguro assumir
  que ninguém vai adicionar timeout depois; contratos são pegajosos. Uma chamada travada pode
  pinar um worker (Express hoje, Lambda alvo até 15 min) e, junto com F-availability-1,
  prolonga o tempo em `reconciling`.
- **Impacto de negócio**: workers ocupados = throughput do pipeline cai proporcional aos hangs;
  no cenário Lambda alvo cada hang custa 15 min × custo/GB-s + concurrency limit.
- **Métrica de baseline**: 0 ports com `timeoutMs` / `signal` no contrato (3 ports externos).

### F-availability-3: `RetryExecutor` disponível no repo mas não incorporado ao coordinator/ports

- **Severidade**: P1
- **Tactic violada**: Retry
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts` (uso ausente); `src/backend/domain/libs/executor/RetryExecutor.ts` (disponível)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "RetryExecutor\|FallbackExecutor\|PollExecutor" \
      src/backend/domain/service/recebimentos \
      src/backend/domain/repository/recebimentos \
      src/backend/domain/interface/recebimentos
  # (nenhuma linha)
  ```
  O primitivo existe em `libs/executor/RetryExecutor.ts` (CLAUDE.md o lista como *executor
  canônico*) e não aparece em nenhum arquivo do scaffold.
- **Impacto técnico**: como o coordinator é a spine, a decisão de onde colocar retry vira débito
  que cada Módulo herdará individualmente — 6 implementações divergentes vs. uma política central.
- **Impacto de negócio**: primeira falha transitória do Conexos (comum em manutenções noturnas
  do ERP) vira interrupção do pipeline em vez de invisível ao operador. Mede-se em número de
  incidentes P2 evitados por mês.
- **Métrica de baseline**: 0 usos de `RetryExecutor` em 2 256 LOC do scaffold.

### F-availability-4: MetricsPort nunca emite `outcome: 'error'` — observability perde o sinal de falha

- **Severidade**: P2
- **Tactic violada**: Monitor / Exception Detection
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:97-263`
- **Evidência (objetiva)**: o tipo `MetricsEvent.outcome` permite `'started' | 'ok' | 'error'`
  (`ports.ts:120`), mas o coordinator só emite `started` e `ok`. Consequência direta de
  F-availability-1: sem `try/catch`, não há caminho para emitir `error`.
- **Impacto técnico**: quando o Módulo 6 aterrissar um emissor real de métricas, o alarme "taxa
  de erro por estágio > X" não terá dado para disparar — o sinal simplesmente não é produzido.
- **Impacto de negócio**: sem alerta, incidente é descoberto pelo cliente (Columbia analista)
  em vez do operador — MTTR sobe do teórico "minutos" para "horas".
- **Métrica de baseline**: 0 emissões `outcome: 'error'` nos 5 estágios do coordinator.

### F-availability-5: `alreadySettled` cobre `settled`, mas nada trata retry sobre `error` ou `reconciling` órfão

- **Severidade**: P2
- **Tactic violada**: State Resynchronization
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentoPipelineService.ts:209-217` + `RecebimentoExecucaoRepository.ts:39-69`
- **Evidência (objetiva)**: `beginExecution` retorna `alreadySettled = status === 'settled'`. Não
  há política definida para o que fazer se a chamada anterior deixou o registro em `error`
  (F-availability-1) ou em `reconciling` sem `atualizado_em` recente. O coordinator trata
  qualquer `!alreadySettled` como "prossiga como novo" — o que reissue o POST irreversível.
- **Impacto técnico**: retry após um `markError` (quando existir, F-availability-1) reexecuta a
  quitação sem checar se o `bor_cod` gravado no `markError` já reflete um POST que atingiu o ERP.
- **Impacto de negócio**: mesmo risco de dupla-quitação de F-availability-1, mas em cenário de
  retry consciente — piora percebida porque o operador achou que estava recuperando.
- **Métrica de baseline**: 1 branch de idempotência coberta (`settled`); 0 branches para
  `error`/`reconciling` órfão dos 4 estados do ledger.

## 5. Cards Kanban

### [availability-1] Envelopar `executarRecebimento` em try/catch + `markError` (espelhar `ReconciliacaoPermutaService`)

- **Problema**
  > O coordinator chama `beginExecution → criarBordero → gravarBaixa → emitir → markSettled` sem
  > `try/catch`. Qualquer falha externa deixa `recebimento_execucao` preso em `reconciling`, e a
  > retentativa reexecuta o POST irreversível — risco de dupla-baixa e dupla-NDe. A costura já
  > existe (`markError` no repositório) e o irmão `ReconciliacaoPermutaService.ts:220-256`
  > já usa exatamente esse padrão.

- **Melhoria Proposta**
  > Aplicar Exception Handling: envolver o bloco 219-242 de `RecebimentoPipelineService.ts` em
  > `try { … } catch (err) { await this.execucaoRepository.markError(idempotencyKey, {
  > erroMensagem: String(err), erpResponse: null }); this.metrics.emit({ stage:
  > 'executarRecebimento', correlationId, outcome: 'error', attributes: { … } }); throw err; }`.
  > Preservar `borCod` no `markError` quando `criarBordero` já respondeu antes da falha do
  > `gravarBaixa`. Espelhar 1:1 o padrão de `permutas/ReconciliacaoPermutaService.ts:234-256`.

- **Resultado Esperado**
  > Nenhuma execução fica presa em `reconciling`; toda falha vira `error` no ledger com o payload
  > cru; a retentativa manual encontra estado terminal e decide de forma informada.

- **Tactic alvo**: Exception Handling
- **Severidade**: P0
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Chamadas externas envelopadas: 0/3 → 3/3
  - Invocações de `markError` a partir do coordinator: 0 → 1
  - Testes: adicionar 2 casos (`markError` chamado em falha; retentativa vê `error`)
- **Risco de não fazer**: primeira falha do Conexos em produção resulta em baixa e NDe
  duplicadas quando o operador reexecutar o pipeline; retrabalho manual + risco fiscal (NDe).
- **Dependências**: nenhuma (a `markError` já está pronta no repositório).

### [availability-2] Adicionar `timeoutMs` opcional aos ports externos (`Nexxera`, `ErpReceivables`, `NdeEmitter`)

- **Problema**
  > Nenhum dos ports externos expõe timeout ou `AbortSignal`. Quando os 6 teammates aterrissarem
  > as implementações reais, é altamente provável que reproduzam o contrato sem timeout — e uma
  > única chamada travada pode pinar um worker por 15 min (Lambda alvo) ou indefinidamente
  > (Express atual).

- **Melhoria Proposta**
  > Adicionar `timeoutMs?: number` (com default definido no adapter) aos parâmetros de
  > `NexxeraGatewayInterface.fetch`, `ErpReceivablesGatewayInterface.criarBordero`/`gravarBaixa`
  > e `NdeEmitterInterface.emitir` em `ports.ts:132-171`. Documentar no docstring que o adapter
  > real deve honrar o teto. Alternativamente (mais forte): tipo utilitário
  > `type WithTimeout<T> = T & { timeoutMs?: number }`.

- **Resultado Esperado**
  > Contratos que os módulos 1 e 5 aterrissarem já obrigam o desenvolvedor a decidir o teto;
  > nenhum port externo sem timeout.

- **Tactic alvo**: Monitor / Exception Prevention
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Ports externos com `timeoutMs` no contrato: 0/3 → 3/3
  - Warnings de teste sobre timeout ausente: novo teste que reprova adapter sem timeout
- **Risco de não fazer**: em 6 meses, com 3 adapters reais aterrissados, adicionar timeout vira
  refactor cross-módulos com risco de regressão.
- **Dependências**: nenhuma; recontratar antes do Módulo 1 aterrissar.

### [availability-3] Instanciar política central de retry via `RetryExecutor` no `executarRecebimento`

- **Problema**
  > `RetryExecutor` está disponível em `libs/executor/` e é o padrão canônico do repo, mas o
  > scaffold não o incorpora. Sem uma política central, cada um dos 6 módulos vai improvisar
  > (ou não) retry — resultando em 6 comportamentos diferentes na chamada ao Conexos.

- **Melhoria Proposta**
  > Aplicar Retry: injetar `RetryExecutor` (ou factory) no `RecebimentoPipelineService` e
  > envolver `criarBordero`/`gravarBaixa`/`emitir` em `retry.execute(() => …, { attempts: 3,
  > delayMs: 1000, isRetryable: (e) => e.retryable !== false })`. Coordenar com
  > [availability-1]: `markError` só depois de esgotadas as tentativas. Só retryable transitório
  > (5xx/timeout); 4xx do ERP (regra fiscal) não retryable.

- **Resultado Esperado**
  > Falhas transitórias (janela de manutenção Conexos, blip Nexxera) absorvidas sem alarme;
  > política de retry uniforme para todos os writes da frente.

- **Tactic alvo**: Retry
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Usos de `RetryExecutor` no scaffold: 0 → 3 (uma por chamada externa)
  - Testes: caso que confirma 3 tentativas antes do `markError`
- **Risco de não fazer**: pico de manutenção do ERP (~1h/mês) vira 100% de falhas P2 evitáveis.
- **Dependências**: [availability-1] (o catch existir para o retry desistir dentro dele).

### [availability-4] Emitir `outcome: 'error'` no MetricsPort em todos os estágios (5 estágios × 1 catch)

- **Problema**
  > O tipo `MetricsEvent.outcome` prevê `'error'`, mas o coordinator só emite `started`/`ok`.
  > Sem esse sinal, o dashboard do Módulo 6 não terá dado para alarme "taxa de erro por estágio".

- **Melhoria Proposta**
  > Aplicar Monitor: em cada um dos 5 estágios (`importarTransacoes`, `atribuirBaixa`,
  > `ratearRecebimento`, `aplicarRegras`, `executarRecebimento`), envelopar a chamada da port em
  > `try { … emit ok } catch (err) { emit error com attributes.stage/errorCode; throw }`.
  > Padrão único para os 6 teammates copiarem.

- **Resultado Esperado**
  > Todo estágio emite os 3 outcomes possíveis; dashboard/alarme (Módulo 6) tem sinal para
  > "taxa de erro > 5% em 5 min" → alerta.

- **Tactic alvo**: Monitor / Exception Detection
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Emissões `outcome: 'error'` no coordinator: 0 → 5 (1 por estágio)
  - Cobertura de teste: caso por estágio garantindo o emit em falha
- **Risco de não fazer**: instrumentação do Módulo 6 aterrissa sem dado de erro → operador só
  descobre incidente via reclamação do analista Columbia.
- **Dependências**: [availability-1] fornece o try/catch do estágio 5; os demais precisam de try/catch novos.

### [availability-5] Definir política de retomada quando ledger está em `error` ou `reconciling` órfão

- **Problema**
  > `alreadySettled` cobre apenas `status === 'settled'`. Se a linha estiver em `error` (após
  > [availability-1]) ou em `reconciling` sem `atualizado_em` recente, o coordinator prossegue
  > como se fosse execução nova e reissue o POST — potencialmente duplicando.

- **Melhoria Proposta**
  > Aplicar State Resynchronization: estender `BeginRecebimentoExecucaoResult` com
  > `previousStatus` e `staleSince?: Date`; no coordinator, se `previousStatus === 'error'`
  > exigir flag explícita `retryFromError: true` no `RunPipelineInput`; se `previousStatus ===
  > 'reconciling'` e `staleSince > 15min`, delegar a job de reconciliação (não reexecutar
  > inline). Documentar em `ontology/business-rules/idempotencia-quitacao-nde.md` (já
  > referenciado na migração 0035).

- **Resultado Esperado**
  > Retentativa consciente exige input explícito; execução nunca reexecuta POST irreversível
  > cegamente sobre estado incerto.

- **Tactic alvo**: State Resynchronization
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-availability-5, F-availability-1
- **Métricas de sucesso**:
  - Branches de idempotência cobertos: 1 (`settled`) → 4 (`settled`/`error`/`reconciling`-orfão/`pending`)
  - Testes: caso `error → retry sem flag` deve lançar; `reconciling stale > 15min` deve rotear a job
- **Risco de não fazer**: mesmo cenário de dupla-quitação de F-availability-1, mas em fluxo de
  recuperação — pior porque o operador confia que está recuperando com segurança.
- **Dependências**: [availability-1] (o `error` precisa ser alcançável primeiro).

## 6. Notas do agente

- Escopo respeitado: só arquivos do inventário `_shared-metrics.md`. Findings sobre "lógica de
  negócio faltando" foram deliberadamente evitados; todos os findings apontam para **seams
  arquiteturais** ausentes que os 6 teammates herdariam.
- Métrica de MTTR real declarada como não-medível localmente (§2); baseline proposto para
  ser instrumentado quando o Módulo 6 aterrissar.
- Cross-QA: F-availability-1 tem forte overlap com **Fault-Tolerance** (recovery paths) e com
  **Security** (dupla-emissão de NDe = evento fiscal). F-availability-2 e F-availability-3 tocam
  **Performance** (workers hung). Sinalizar ao consolidator para não duplicar cards.
- Comparativo com Frente I (`ReconciliacaoPermutaService.ts:220-256`) foi decisivo: o padrão que
  falta no scaffold Frente IV já existe e está testado no repo — não é invenção, é omissão.
