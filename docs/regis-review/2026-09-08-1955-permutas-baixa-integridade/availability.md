---
qa: Availability
qa_slug: availability
run_id: 2026-09-08-1955-permutas-baixa-integridade
agent: qa-availability
generated_at: 2026-09-08T19:55:00-03:00
scope: backend
score: 7.5
findings_count: 4
cards_count: 4
---

# Availability — Regis-Review

> Escopo restrito ao DELTA do commit `8b18686` (advisory lock, terminal `parcial`, pré-checagem 422,
> badge B1'). Runtime Express/Render — sem `infra/`, sem AWS, sem Lambda: tactics de nuvem marcadas
> "Não medível". `--quick`: não roda coverage nem audit; baseline vem do run anterior
> `2026-09-08-1414-permutas`.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dois analistas Columbia (abas/máquinas distintas) OU um duplo-clique | POST `/permutas/adiantamentos/:docCod/reconciliar` duplicado durante fluxo diário de baixa | `ReconciliacaoPermutaService.reconciliar` (grava `fin010` no Conexos, irreversível) | Produção `fin010` LIGADA desde 2026-06-24 — 137 execuções, R$ 38.466.226,25 baixados, 12 erros (`docs/impacto/h1-permutas-achados.md`); pool Postgres com `max = 5`; sem infra AWS | Vencedor executa handshake de 5 chamadas; perdedor recebe `409 RECONCILIACAO_EM_ANDAMENTO` (retryable, `userMessage` em PT); ZERO duplo borderô/duplo POST no ERP; `parcial` só quando o ERP aceitou menos que o alocado (WARN observável, badge FE) | 0 baixas duplicadas por par adto↔invoice concorrente (verificado por teste `ReconciliacaoPermutaService.test.ts:787`); 0 borderôs órfãos após falha total; 100% dos `parcial` visíveis no painel; MTTR do resíduo depende de intervenção humana (não instrumentado) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura de `finally` no unlock do lock | Presente: try→finally aninhado libera lock ANTES de release do client | 100% | ✅ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:145-158` |
| `pg.Pool.max` (clients concorrentes por instância) | 5 | ≥ concorrência prevista de reconciliações + reads simultâneos | ⚠️ | `PostgreeDatabaseClient.ts:26` |
| `pg.Pool.connectionTimeoutMillis` | 5000 ms | > tempo máximo de espera aceitável no painel | ⚠️ | `PostgreeDatabaseClient.ts:28` |
| Timeout do axios do Conexos | 40.000 ms | bounded (≤ 60s) | ✅ | `src/backend/services/conexos.ts:122` |
| Timeout axios em `BcbClient` | 10.000 ms | bounded | ✅ | `src/backend/domain/client/BcbClient.ts:57` |
| Rate-limit da rota `/reconciliar` | 10 req/min/IP (`heavyRouteLimiter`) | consistente com pool_max | ⚠️ | `src/backend/http/rateLimit.ts:28-36` |
| Testes de concorrência no delta | 3 (mesmo adto → 409; adtos distintos → paralelo; caller barrado não toca ERP) | ≥1 | ✅ | `ReconciliacaoPermutaService.test.ts:787, 827, 857` |
| Reaper/staleness cobrindo `parcial` | 0 | ≥1 (proativo, com watermark de idade) | ❌ | `grep permuta_alocacao_execucao src/backend/jobs/` → só probes; `reaper-sispag-reconciling.ts:13` cobre só SISPAG |
| Reaper/staleness cobrindo `reconciling` órfão em Permutas | 0 (fail-closed manual — comentário `ReconciliacaoPermutaService.ts:290-311`) | ≥1 alerta com idade | ❌ | mesmo grep; `detect-staleness.ts` não cita `permuta` |
| Idempotência pós-lock (par adto↔invoice) | `idempotency_key` com `atualizado_em` da alocação, `beginExecution ON CONFLICT` | preservada | ✅ | `ReconciliacaoPermutaService.ts:266-311`, `PermutaExecucaoRepository.ts:280-290` |
| Anti-órfão de borderô (I-Write-7) | `removerBorderoOrfao` best-effort, guarda-costas via `listBaixas` do ERP | presente | ✅ | `ReconciliacaoPermutaService.ts:383-435` |
| `LogService.warn` em rota barrada (observabilidade da contenção) | Emitido antes do throw | presente | ✅ | `ReconciliacaoPermutaService.ts:154-162` |
| Instrumentação de duração das transições `beginExecution → markSettled/markParcial` | Ausente (nem `p50`/`p95`, nem histograma) | ≥ p95 histograma por transição | ❌ | grep vazio por `duration`/`histogram` no serviço |

> ⚠️ **Não medível neste run (`--quick`, sem infra):**
> - MTTR real do resíduo `parcial` até re-alocação: requer query de produção sobre `permuta_alocacao_execucao` com `WHERE status='parcial'` e diferença até a próxima execução com `idempotency_key` renomeada. Recomendação: painel operacional com `age(now() - atualizado_em)` para `status='parcial'`.
> - Distribuição de tempo em que o lock é retido (`pg_try_advisory_lock` até `pg_advisory_unlock`): sem instrumentação. Recomendação: `logService.info` com `Date.now()` deltas no início/fim de `reconciliarSerializado`.
> - Latência do handshake fin010 (5 chamadas por par): sem breakdown por passo. Recomendação: instrumentar `ConexosBaixaClient` com `duration_ms` no log de saída.
> - Tenant blast radius / CloudWatch / DLQ: **não existe `infra/`** neste repo — deploy por Render hook. Não avaliável aqui.

## 3. Tactics — Cobertura no nf-projects

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | N/A — sem fan-out interno; front chama backend Express diretamente. | N/A | — |
| Heartbeat | Ausente — não há heartbeat entre nós; runtime mono-processo. | ❌ | — |
| Monitor | Parcial no delta: `BorderoGestaoService` deriva `parcial-aguardando-finalizacao` na leitura → o painel exibe o resíduo. Sem monitor ATIVO (job periódico) sobre `permuta_alocacao_execucao WHERE status='parcial'`. | ⚠️ | `BorderoGestaoService.ts:497-593`; ausência: `grep permuta_alocacao_execucao src/backend/jobs/` → só probes. |
| Timestamp | Presente: `atualizado_em = now()` em `beginExecution`, `setBorCod`, `markSettled`, `markParcial`, `markError`. | ✅ | `PermutaExecucaoRepository.ts:280-338` |
| Sanity Checking | Presente e forte no delta: `assertCobertura` recusa 422 antes do 1º POST; `saldoNegDoAdto`/`ancorarVariacaoNoAdto` gates da âncora I-Write-6; `TOLERANCIA_FECHAMENTO_NEG` no fechamento; check `pago=1` corroborador. | ✅ | `ReconciliacaoPermutaService.ts:679-742` |
| Condition Monitoring | Ausente para `parcial` como CONDIÇÃO agregada (contagem, idade, resíduo total pendente). Presente por linha, na leitura sob demanda. | ❌ | `detect-staleness.ts` não cita permuta; nenhum probe em produção. |
| Voting | N/A — não há réplicas do estado a votar. | N/A | — |
| Exception Detection | Presente: `catch` do handshake grava `markError` + log WARN + status `error`; `respondHandlerError` mapeia 409/422 sem achatar em 500. | ✅ | `ReconciliacaoPermutaService.ts:356-378`, `routes/permutas.ts:512-518` |
| Self-Test | Ausente — não há health-check dedicado no serviço. | ❌ | — |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — deploy mono-instância Render. | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | Presente: `HandlerError` com `statusCode`/`code`/`userMessage`/`retryable`; `ReconciliacaoEmAndamentoError`, `AlocacaoSemCoberturaError`. | ✅ | `errors/ReconciliacaoEmAndamentoError.ts:27-44`, `errors/AlocacaoSemCoberturaError.ts:25-45` |
| Rollback | Parcial: **NÃO há rollback dos POSTs do ERP** (I-Write-2 é explícito — a baixa é irreversível). O que existe é anti-órfão de borderô vazio (`removerBorderoOrfao`) e IN-DOUBT fail-closed que barra re-POST. | ⚠️ | `ReconciliacaoPermutaService.ts:383-435`, `:280-311` |
| Software Upgrade | N/A — não aplica ao delta. | N/A | — |
| Retry | Presente no lado do cliente HTTP para GETs idempotentes (`ConexosBaseClient`, `queryRetryExecutor` no DB); **deliberadamente ausente** no POST do handshake da baixa (retry pós-timeout duplicaria baixa — `ConexosBaixaClient.ts:60-65`). O 409 novo diz "retryable=true" ao caller, delegando o retry para o operador/UI. | ✅ | `PostgreeDatabaseClient.ts:36-42`, `ConexosBaixaClient.ts:60-65`, `ReconciliacaoEmAndamentoError.ts:31` |
| Ignore Faulty Behavior | N/A | N/A | — |
| Degradation | Presente **como núcleo do delta**: `parcial` é degradação terminal explícita — o ERP aceitou menos, a linha diz a verdade, o front pinta badge próprio. Sem ele, `settled` mentiria sobre resíduo (I-Recon-6/7). | ✅ | `ReconciliacaoPermutaService.ts:579-611`, `PermutaExecucaoRepository.markParcial:287-338`, `frontend/app/permutas/components/ui.tsx:135-143` |
| Reconfiguration | N/A — sem múltiplos nós. | N/A | — |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A — sem shadow deploy. | N/A | — |
| State Resynchronization | Parcial: `borderoAindaValido` re-lê o ERP (`listBaixas`) para decidir se `settled`/`parcial` ainda vale; `renameKey` preserva histórico ao liberar re-lançamento. | ✅ | `ReconciliacaoPermutaService.ts:270-291` |
| Escalating Restart | N/A — mono-processo, sem hierarquia de restart. | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | N/A — sem infra multi-tenant/AWS neste repo. | N/A | — |
| Transactions | Presente e reforçada pelo delta: advisory lock **serializa** por `adiantamentoDocCod` (I-Recon-5), unlock em `finally` aninhado ao release do client. `beginExecution` usa `ON CONFLICT DO UPDATE` que preserva terminais. `withTransaction` disponível para escritas atômicas locais. | ✅ | `ReconciliacaoPermutaService.ts:120-153`, `PostgreeDatabaseClient.ts:137-158`, `PermutaExecucaoRepository.beginExecution` |
| Predictive Model | Ausente — nenhum modelo/heurística preditiva sobre falha do ERP ou saturação de pool. | ❌ | — |
| Exception Prevention | Presente **como núcleo do delta**: `assertCobertura` recusa 422 antes do 1º POST irreversível quando `Σ (usd − pago_brl/taxa) < alocado`. Poupa a analista de um `parcial` que o serviço sabe ser inevitável. | ✅ | `ReconciliacaoPermutaService.ts:679-742`, `errors/AlocacaoSemCoberturaError.ts` |
| Increase Competence Set | Parcial: `userMessage` PT explica exatamente o remédio ("Aguarde alguns segundos e recarregue a tela — não clique de novo"). Sem runbook automatizado para `parcial` (fica a cargo do olho do analista no badge). | ⚠️ | `ReconciliacaoEmAndamentoError.ts:38-42`, `AlocacaoSemCoberturaError.ts` |

## 4. Findings

### F-availability-1: Pool Postgres `max=5` versus reconciliações concorrentes retendo cliente dedicado

- **Severidade**: P1
- **Tactic violada**: Transactions (dimensionamento da capacidade que sustenta a serialização) / Reconfiguration (ausência de mecanismo para absorver picos)
- **Localização**: `src/backend/domain/client/database/PostgreeDatabaseClient.ts:26`, `:137-158`; `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:120-153`
- **Evidência (objetiva)**:
  ```
  private readonly poolMaxConnections = 5;
  private readonly poolConnectionTimeoutMillis = 5000;
  ...
  const client = await this.connectionPool.connect();  // dedicated for entire onAcquired
  try { ...
      if (!acquired) return onBusy();
      try { return await onAcquired(); }
      finally { await client.query('SELECT pg_advisory_unlock($1)', [lockKey]); }
  } finally { client.release(); }
  ```
  `reconciliarSerializado` executa o handshake com axios timeout de 40 s por chamada (`services/conexos.ts:122`) e faz múltiplas escritas via pool (`beginExecution`, `setBorCod`, `markSettled`/`markParcial`) — cada uma acquire adicional. `heavyRouteLimiter` permite 10 req/min por IP (`http/rateLimit.ts:28-36`), então **dois operadores em IPs distintos podem manter ≥ 5 reconciliações simultâneas** para adtos distintos (o lock por adto NÃO impede isso — teste `ReconciliacaoPermutaService.test.ts:857` valida justamente esse paralelismo).
- **Impacto técnico**: 5 reconciliações simultâneas para adtos distintos consomem os 5 slots do pool para os clientes-de-lock; qualquer outra query (`/painel` reads, badge queries, `ConexosSessionRegistry`) espera até `poolConnectionTimeoutMillis=5s` e então rejeita. O próprio serviço acaba tentando `beginExecution` sobre um pool esgotado — o `queryRetryExecutor` (3 retries com 200 ms + jitter) mitiga picos curtos, mas não uma fila persistente.
- **Impacto de negócio**: durante o fechamento diário (as duas analistas + duplo-clique acidental), o painel pode ficar visualmente travado (5s) ou mostrar 500 esporádicos enquanto a baixa vigente termina. Não perde dinheiro (o lock protege), mas degrada percepção da ferramenta que está em produção com R$ 38 mi já baixados.
- **Métrica de baseline**: `poolMaxConnections = 5`; `heavyRouteLimiter.limit = 10/min/IP`; timeout de axios do ERP = 40 s; N máximo previsto de analistas simultâneos ≥ 2. **Sem instrumentação de tempo médio de retenção do lock — não temos p95 empírico.**

### F-availability-2: `parcial` é terminal humano-dependente sem reaper/staleness proativo

- **Severidade**: P1
- **Tactic violada**: Monitor / Condition Monitoring (Detect Faults)
- **Localização**: ausência em `src/backend/jobs/` — comprovada por `grep permuta_alocacao_execucao src/backend/jobs/ → só probes`; `src/backend/jobs/reaper-sispag-reconciling.ts:13` (único reaper existente, cobre só SISPAG); `src/backend/jobs/detect-staleness.ts` (não cita `permuta`)
- **Evidência (objetiva)**:
  ```
  $ grep -rn "permuta_alocacao_execucao" src/backend/jobs/
  src/backend/jobs/probe-impacto-narrativa.ts:54:  FROM permuta_alocacao_execucao
  src/backend/jobs/probe-com308-cobertura.ts:134:  FROM permuta_alocacao_execucao
  ```
  Zero jobs agendados. O único reaper é `reaper-sispag-reconciling.ts` (SISPAG, cron `.github/workflows/reaper-sispag.yml`), como o próprio comentário admite ("único job que o painel não consegue vigiar" — `jobs/reconciliar-nde-sefaz.ts:21`). `parcial` sinaliza via `BUSINESS_WARN` no log e badge FE `parcial-aguardando-finalizacao` (`BorderoGestaoService.ts:593`, `frontend/app/permutas/components/ui.tsx:135`), mas depende do analista OLHAR o painel para agir. I-Recon-7 perna (c) — reaper proativo — **não existe** (é gap conhecido do ADR-0043, mas o impacto de disponibilidade operacional cai neste QA).
- **Impacto técnico**: se o resíduo não é re-alocado, `parcial` permanece indefinidamente e o dinheiro do adto continua parcialmente preso. Não há alerta de idade nem contagem agregada.
- **Impacto de negócio**: MTBF do resíduo → indefinido; MTTR → depende do analista notar o badge. Em produção (`fin010` LIGADO desde 2026-06-24, 137 execuções), qualquer `parcial` que passe despercebido significa saldo de adto travado — dinheiro que a Columbia planejava permutar mas não permutou.
- **Métrica de baseline**: **0 reapers**, **0 alertas** proativos sobre `WHERE status='parcial'`; nenhum dashboard operacional agrega essa contagem. Comparação: SISPAG tem reaper a cada 15 min (`.github/workflows/reaper-sispag.yml`).

### F-availability-3: Sem instrumentação de duração do lock e do handshake — regime de starvation de pool é invisível

- **Severidade**: P2
- **Tactic violada**: Timestamp / Condition Monitoring (Detect Faults)
- **Localização**: `src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts:120-437`; `src/backend/domain/client/ConexosBaixaClient.ts` (sem histograma de latência)
- **Evidência (objetiva)**:
  ```
  $ grep -n "duration\|elapsed\|histogram\|Date.now" src/backend/domain/service/permutas/ReconciliacaoPermutaService.ts
  (vazio)
  ```
  Logs registram INÍCIO e FIM lógico (WARN em concorrente, INFO em SETTLED/PARCIAL), mas sem `duration_ms`. Não conseguimos responder empiricamente "quanto tempo o pool-client fica retido em uma reconciliação típica?", que é a métrica que qualificaria F-availability-1 de P1 para P0 ou P2.
- **Impacto técnico**: quando F-availability-1 se materializar em produção, a evidência será circunstancial (5xx aparecendo no `/painel` sem contra-medida clara). Sem `duration_ms` das transições, não há como plotar p95 nem provar melhoria após bump de `poolMaxConnections`.
- **Impacto de negócio**: incidentes de disponibilidade só ficarão claros depois que o operador reclamar — postura reativa em cima de uma ferramenta que já movimenta R$ 38 mi.
- **Métrica de baseline**: **0 métricas de duração** em `ReconciliacaoPermutaService`; **0 histogramas** de latência do handshake ERP.

### F-availability-4: `heavyRouteLimiter=10/min` desalinhado com `poolMax=5` — mismatch de capacidade

- **Severidade**: P2
- **Tactic violada**: Reconfiguration (falta de coerência entre limitadores de admissão e a capacidade real)
- **Localização**: `src/backend/http/rateLimit.ts:28-36`; `src/backend/domain/client/database/PostgreeDatabaseClient.ts:26`
- **Evidência (objetiva)**:
  ```
  export const heavyRouteLimiter: RateLimitRequestHandler = rateLimit({
      windowMs: 60_000, limit: 10, ...
  });
  ...
  private readonly poolMaxConnections = 5;
  ```
  Um único IP pode disparar 10 reconciliações/min; o pool comporta 5 concorrentes. Além disso, o limiter é **por IP** — dois operadores em IPs distintos multiplicam esse teto sem tampa efetiva.
- **Impacto técnico**: o limiter, que existe justamente para proteger a "session pool" do ERP, é generoso demais para a proteção que interessa neste caminho (o pool DB local).
- **Impacto de negócio**: aumenta a probabilidade prática do cenário do F-availability-1.
- **Métrica de baseline**: `heavy_limit/pool_max = 10/5 = 2` (o limiter permite 2× o pool em uma janela de 1 min de um único IP; multiplicar por N IPs).

## 5. Cards Kanban

### [availability-1] Elevar `poolMaxConnections` e instrumentar retenção do lock

- **Problema**
  > O advisory lock por adiantamento (delta deste tweak) retém um cliente dedicado do pool durante todo o handshake com o Conexos (`ReconciliacaoPermutaService.ts:120-153`, `PostgreeDatabaseClient.ts:137-158`). Com `poolMaxConnections=5` e um axios de 40 s por passo do handshake (`services/conexos.ts:122`), cinco reconciliações simultâneas para adtos distintos (paralelismo legítimo, provado em `ReconciliacaoPermutaService.test.ts:857`) esgotam o pool. Outras queries do backend passam a esperar até 5 s e falhar.

- **Melhoria Proposta**
  > (1) Elevar `poolMaxConnections` para ≥ `2 × N_analistas_simultâneas_previstas + 2` (proposta inicial: 10) — Bass **Reconfiguration** de capacidade estática. (2) Instrumentar `logService.info` com `duration_ms` no início/fim de `reconciliarSerializado` e em cada passo do handshake em `ConexosBaixaClient` — Bass **Timestamp / Condition Monitoring**. (3) Após 2 semanas de produção com métrica, calibrar o `poolMaxConnections` pelo p95 observado.

- **Resultado Esperado**
  > Nenhuma requisição de leitura do painel espera > 100 ms por conexão durante fechamento diário. `duration_ms` do handshake disponível em log estruturado para calibração futura.

- **Tactic alvo**: Reconfiguration / Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S (bump de constante + logs) + M (instrumentação e leitura de p95 em 2 semanas)
- **Findings relacionados**: F-availability-1, F-availability-3
- **Métricas de sucesso**:
  - `poolMaxConnections`: 5 → ≥ 10
  - `duration_ms` do handshake: não medido → p50/p95 em log estruturado
  - Erros `poolConnectionTimeout` no `LogService`: baseline atual (não medido) → 0 sob 5 reconciliações concorrentes simuladas
- **Risco de não fazer**: primeiro incidente de "painel travado" durante fechamento (2 analistas × múltiplos POST) sem métrica para diagnosticar — postura reativa numa ferramenta com R$ 38 mi em produção.
- **Dependências**: nenhuma — pura configuração + log.

### [availability-2] Reaper/staleness proativo sobre `permuta_alocacao_execucao WHERE status='parcial'`

- **Problema**
  > `parcial` é terminal e depende de humano re-alocar o resíduo. O único sinal ativo é o badge FE (`frontend/app/permutas/components/ui.tsx:135`) — se a analista não olha o painel, o dinheiro do adto fica parcialmente travado sem que ninguém saiba. Único reaper existente cobre SISPAG (`jobs/reaper-sispag-reconciling.ts:13`); `detect-staleness.ts` não cita permuta. I-Recon-7 (c) já é gap conhecido; aqui ele é impacto de disponibilidade operacional.

- **Melhoria Proposta**
  > Criar `jobs/reaper-permuta-parcial.ts` no molde do `reaper-sispag-reconciling.ts`: cron a cada 15 min via GitHub Actions, `SELECT ... FROM permuta_alocacao_execucao WHERE status='parcial' AND age(now() - atualizado_em) > interval '1 hour'`, emitir `BUSINESS_WARN` com `adiantamentoDocCod`, `borCod`, `valorResidualUsd`, `atualizado_em`. Estender `detect-staleness.ts` para incluir a categoria. Bass **Monitor / Condition Monitoring**.

- **Resultado Esperado**
  > 0 execuções `parcial` com idade > 24 h invisíveis: cada uma dispara pelo menos um `BUSINESS_WARN` por hora após 1h. Painel operacional agrega contagem `AGE(parcial)` por faixa (< 1h, 1–24h, > 24h).

- **Tactic alvo**: Monitor / Condition Monitoring
- **Severidade**: P1
- **Esforço estimado**: S (o `reaper-sispag-reconciling.ts` é template pronto)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Reapers cobrindo `permuta_alocacao_execucao`: 0 → 1
  - WARNs proativos com `age > 1h`: 0 → cobertura por hora
  - Idade mediana das linhas `parcial` que sobreviveram > 24h: não medido → alerta explícito
- **Risco de não fazer**: em 6 meses, saldo de adto travado em `parcial` sem que ninguém saiba — a mesma fricção que a Frente III tem com anexos GED, mas em cima de dinheiro.
- **Dependências**: `.github/workflows/reaper-permuta.yml` (novo).

### [availability-3] Sanity-check de idempotência do 409 sob restart de processo Express

- **Problema**
  > O advisory lock é **session-level** e ligado à `PoolClient` que o adquire. Se o processo Node cair no meio de `reconciliarSerializado` (SIGTERM do Render, OOM), a conexão Postgres fecha e o lock é liberado pelo backend — **mas** a linha `permuta_alocacao_execucao` pode ficar em `reconciling` sem `bor_cod` ou com `bor_cod` sem confirmação. O caminho IN-DOUBT (`ReconciliacaoPermutaService.ts:290-311`) barra re-POST, o que preserva o dinheiro; a disponibilidade da funcionalidade, no entanto, exige intervenção manual (comentário `NÃO re-POSTado`). Sem alerta imediato, o operador só descobre quando tenta reconciliar de novo.

- **Melhoria Proposta**
  > Estender o reaper de `availability-2` para também emitir WARN sobre `status='reconciling' AND age > 15 min AND bor_cod IS NOT NULL` (mesma heurística de `reaper-sispag-reconciling.ts:63`). Bass **Monitor** + **State Resynchronization** (fornecer ao operador o `borCod` a conciliar no ERP).

- **Resultado Esperado**
  > Toda execução IN-DOUBT dispara um WARN dentro de 15 min. Runbook do operador tem `borCod` no log; MTTR de decisão humana < 30 min.

- **Tactic alvo**: Monitor + State Resynchronization
- **Severidade**: P2
- **Esforço estimado**: S (add-on do card availability-2)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Alerta médio para IN-DOUBT: hoje só descoberto na próxima tentativa → < 15 min
  - Falso-positivos (execuções que resolveram sozinhas): monitorar após 4 semanas
- **Risco de não fazer**: probabilidade baixa (restart no meio do handshake é raro), mas quando acontecer a analista fica sem sinal ativo — só descobre no próximo clique.
- **Dependências**: availability-2.

### [availability-4] Reduzir `heavyRouteLimiter.limit` para o caminho de escrita ou introduzir queue-length limit

- **Problema**
  > `heavyRouteLimiter=10/min/IP` (`src/backend/http/rateLimit.ts:28-36`) é generoso para a rota `/permutas/adiantamentos/:docCod/reconciliar` cujo custo interno é ≥ 1 pool-client × handshake de ~5 chamadas ao Conexos. Um IP pode gerar 10 requisições/min contra um pool de 5 clientes; dois IPs, 20. O limitador atual foi calibrado contra "flood do ERP", não contra "starvation do pool DB local".

- **Melhoria Proposta**
  > Criar `writeRouteLimiter` (nome sugerido) com `limit ≈ poolMaxConnections − 2` (folga para reads) aplicado seletivamente às rotas de escrita `fin010` (`/reconciliar`, `/reconciliar-lote`, `/gerar-numerario`). Alternativamente, adotar um semáforo em memória (`p-limit(N)`) em torno de `reconciliar` para bloquear a admissão antes do lock. Bass **Reconfiguration** (admission control).

- **Resultado Esperado**
  > A admissão por instância nunca excede `poolMaxConnections − reserva_reads`. Requisições em excesso recebem 429 com `Retry-After`, sem estourar o pool.

- **Tactic alvo**: Reconfiguration
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - `heavy_limit / poolMax` no caminho de escrita: 10/5 = 2 → ≤ (poolMax−2)/poolMax ≈ 0.6
  - 429 emitidos sob teste de carga com 10 clientes: hoje 0 (todos entram, pool estoura) → esperado ≥ 5
- **Risco de não fazer**: multiplica o cenário de F-availability-1 quando aparecer um segundo operador em janela concorrente.
- **Dependências**: idealmente após availability-1 (elevar `poolMaxConnections` primeiro, depois calibrar limiter).

## 6. Notas do agente

- Verifiquei que `withAdvisoryLock` (`PostgreeDatabaseClient.ts:137-158`) libera o lock em `finally` aninhado ao `client.release()` — **exception path coberto**. Se o `pg_advisory_unlock` falha por queda de conexão, o Postgres libera o lock automaticamente ao fim da sessão. Não é P0.
- Não repeti verificações do SpecVerifier/PatternGuardian (já consumidas no `_shared-metrics.md`). Nada no delta abaixa a integridade do ledger — findings deste QA são de **capacidade** e **observabilidade**, não de correção.
- Cross-QA: F-availability-2 (staleness `parcial`) provavelmente reaparece em `qa-fault-tolerance` como Escalating Restart / Non-Stop Forwarding; consolidator, colapsar se conveniente.
- Métricas não medíveis explicitamente listadas (§2): MTTR real, retenção do lock, latência do handshake, tenant blast (sem infra/).
