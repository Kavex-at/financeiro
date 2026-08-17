---
qa: Availability
qa_slug: availability
run_id: 2026-08-17-1402
agent: qa-availability
generated_at: 2026-08-17T14:02:00-03:00
scope: backend
score: 6
findings_count: 5
cards_count: 5
---

# Availability — Regis-Review

Escopo: **DELTA** da feature `nde-painel-lista` (`fix/nde-painel-lista` vs `main`).
Foco: a aba NDe do `GET /recebimentos/painel` deixou de responder `ndes: []` hardcoded
e passou a (1) ler LEFT-JOIN local, (2) HIDRATAR ao vivo até 20 linhas via
`GET com297/{docCod}` no ERP Conexos e (3) reconciliar de volta no banco — **dentro do
request HTTP do painel**. Isso muda a topologia de disponibilidade: o painel, antes
independente do ERP para essa aba, agora tem o ERP no caminho crítico dessa leitura.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista abrindo o painel de Recebimentos (ou refresh do frontend) | Conexos LENTO (não caído): `GET com297/{docCod}` responde em 5–40 s ou pina até o timeout do axios (40 s) | `RecebimentosPainelService.montarPainel` → `hidratarNdes` → `ConexosNdeFiscalClient.lerDocParaPolling` → `ConexosBaseClient.runWithRetry` (RetryExecutor 2 retries, 500 ms delay + 200 ms jitter) → axios (`timeout: 40000`) | Produção: worker Render single-instance; ERP Conexos sob incidente / manutenção / degradação SEFAZ; `heavyRouteLimiter` NÃO aplicado ao GET /painel | O painel devolve a aba NDe com o que o banco sabe (best-effort por linha), sem derrubar a carteira ativa; o ERP saudável continua reconciliando `nde_autorizado` + `numero_nde` em background do request | (a) `HTTP 200` mesmo com ERP caído; (b) latência p95 do GET /painel adicionada pela hidratação ≤ 3 s no cenário saudável e ≤ 10 s no lento; (c) sem incidente `LOGIN_ERROR_MAX_SESSIONS` sob abertura concorrente do painel; (d) 0 requests do painel bloqueados > 120 s |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Hidratações ao vivo por request | ≤ 20 (`PAINEL_NDE_HIDRATACAO_CAP = 20`) | teto explícito ≤ 25 | ✅ | `src/backend/domain/interface/recebimentos/constants.ts:280` |
| Concorrência por lote | 5 (`PAINEL_NDE_HIDRATACAO_LOTE = 5`) | ≤ 5 (alinhado ao `FANOUT_LIMIT_RECEBIMENTOS = 4` do SISPAG) | ⚠️ | `constants.ts:283` — `5` diverge do `4` já provado seguro pelo incidente `LOGIN_ERROR_MAX_SESSIONS` |
| Timeout por chamada ERP (com297) | axios `timeout: 40000` (40 s) | ≤ 8 s por chamada individual (`ERP_WRITE_TIMEOUT_MS = 8000` já é a doutrina interna) | ❌ | `src/backend/services/conexos.ts:121` vs `constants.ts:110` |
| Retentativas por chamada | 3 attempts (retries=2 + delay 500 ms + jitter 200 ms) | 3 attempts com `timeoutMs` explícito por tentativa | ⚠️ | `src/backend/domain/client/ConexosBaseClient.ts:154-163` |
| Latência-teto adicionada ao GET /painel (ERP hang total) | ~4 lotes × (3 × 40 s + 2 × 0.6 s) ≈ **484 s** (≈ 8 min) | ≤ 15 s hard-cap independente do estado do ERP | ❌ | derivado: `runWithRetry` × axios timeout, `hidratarNdes` for-loop serial em `RecebimentosPainelService.ts:258-265` |
| Latência-teto no cenário LENTO (10 s/call, sucesso 1ª tentativa) | ~4 × 10 s = **40 s** | ≤ 10 s | ⚠️ | mesmo cálculo, cenário citado no prompt |
| Timeout do request no Express | não configurado (Node default = 0, sem limite) | 30 s por request | ❌ | `src/backend/index.ts:151` — só `app.listen(PORT)` |
| Rate-limit no GET /painel | globalLimiter 100 req/min (não `heavyRouteLimiter`) | `heavyRouteLimiter` (10 req/min) enquanto for read-write path | ❌ | `src/backend/routes/recebimentos.ts:113-149` sem middleware; `http/rateLimit.ts:28` |
| Circuit-breaker cross-request | ausente | breaker com meia-abertura por 30 s após N falhas consecutivas | ❌ | `RecebimentosPainelService.ts:247-271` — cada request refaz todos os 20 GETs |
| Cache/coalescing de hidratação entre requests | ausente | TTL curto (30 s) na aba NDe, análogo ao `CACHE_TTL_MS` do `ProcessoProviderConexos` | ❌ | `ProcessoProviderConexos.ts:106` tem cache; `hidratarNdes` não |
| Degradação por linha (best-effort) | presente: `.catch(() => undefined)` por hidratação | mesma | ✅ | `RecebimentosPainelService.ts:282, 297, 301` |
| Idempotência das escritas de reconciliação | `idempotency_key` UNIQUE no ledger + UPDATE por chave | manter | ✅ | `NdeRepository.ts:51 (ON CONFLICT)`, `RecebimentosPainelService.ts:297,299-301` |
| Observabilidade das falhas por linha | 0 logs (o `.catch(() => undefined)` silencia; interceptor axios do `services/conexos.ts` grava `[CONEXOS ✗]` no console mas nada agrega taxa/latência) | métrica de `nde_hidratacao_fail_ratio` por request | ❌ | `services/conexos.ts:146-153`, `RecebimentosPainelService.ts:282,297,301` |
| Isolamento por filial (blast radius de uma filial ruim) | ausente: um docCod hang num filCod X estende a latência do painel de TODOS os filCods do request | fail-fast por filial ou budget global de hidratação | ⚠️ | `hidratarNdes` não segmenta por filCod |
| Gate de testes (backend jest) | 1127 passed / 14 failed — falhas idênticas à `main` (env `COM297_GCD_NOTA_DEBITO` ausente) | 0 regressão | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: p50/p95 real do `GET com297/{docCod}` em produção (por filial). Requer CloudWatch/Render logs metrics ou instrumentação server-side. Recomendação: emitir métrica `nde_hidratacao_ms` (histogram) e `nde_hidratacao_fail_ratio` (counter) por request e dashboardar no Grafana/Datadog quando existir observabilidade central.
>
> ⚠️ **Não medível localmente**: MTTR real para o analista quando ERP hangar. Requer dashboard do painel com o timestamp da última hidratação bem-sucedida por linha e alerta quando o ratio de falhas > 30% na janela de 5 min.

## 3. Tactics — Cobertura no nf-projects

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum probe ativo antes de hidratar; a chamada real é a única sonda. | ❌ ausente | — |
| Heartbeat | N/A no caminho síncrono do painel. | N/A | leitura request/response, não canal persistente |
| Monitor | Só `console.log`/`console.error` do interceptor axios; nada agrega taxa/latência. | ⚠️ parcial | `src/backend/services/conexos.ts:126-153` |
| Timestamp | `atualizado_em` do LEFT-JOIN devolve o retrato local; nenhum timestamp da HIDRATAÇÃO acompanha a linha. | ⚠️ parcial | `NdeRepository.ts:92` (existe no dado, não na hidratação) |
| Sanity Checking | Zod (`DOC_STATUS_SCHEMA.parse`) valida a resposta do ERP no boundary. | ✅ presente | `ConexosNdeFiscalClient.ts:235` |
| Condition Monitoring | Sem métrica de retry-rate, latência, ratio de `.catch(() => undefined)` disparados. | ❌ ausente | — |
| Voting | N/A. | N/A | fonte única (ERP) |
| Exception Detection | ConexosError tipado com endpoint na falha do runWithRetry; Zod detecta shape errado. | ✅ presente | `ConexosNdeFiscalClient.ts:251-253`, `ConexosBaseClient.ts:294-300` |
| Self-Test | N/A. | N/A | — |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | ERP Conexos é fonte única. | N/A | — |
| Passive Redundancy | O banco local guarda `nda_autorizado`/`numero_nde` como shadow do ERP — o painel volta do shadow quando o ERP falha. | ✅ presente | `RecebimentosPainelService.ts:283,293`, `NdeRepository.ts:88-101` |
| Spare | N/A. | N/A | — |
| Exception Handling | `.catch(() => undefined)` por linha na leitura e em cada escrita de reconciliação. | ✅ presente | `RecebimentosPainelService.ts:282,297,301` |
| Rollback | N/A (read-heavy path; as escritas são idempotentes por `idempotency_key`). | N/A | — |
| Software Upgrade | N/A. | N/A | — |
| Retry | `runWithRetry` (retries=2 + jitter). Sem `timeoutMs` por tentativa: retry × axios 40 s = ~121 s por linha no hang. | ⚠️ parcial | `ConexosBaseClient.ts:154-163`; `services/conexos.ts:121` |
| Ignore Faulty Behavior | Linha que não hidratou "vira" o dado local — não polui a resposta com erro. | ✅ presente | `RecebimentosPainelService.ts:283,293` |
| Degradation | Cap 20 + filtro "só não autorizadas" + lote 5 + best-effort → aba NDe degrada para snapshot local. | ✅ presente | `constants.ts:280,283`; `RecebimentosPainelService.ts:250-252` |
| Reconfiguration | Sem chaveamento (ex.: desligar hidratação por flag/breaker) quando ERP está mal. | ❌ ausente | — |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | Ver Passive Redundancy — o banco local é o shadow read. | ✅ presente | `NdeRepository.ts:88-101` |
| State Resynchronization | O request de painel RESINCRONIZA o ledger e o número quando o SEFAZ autoriza. | ⚠️ parcial | `RecebimentosPainelService.ts:295-302` — silencioso: `.catch(() => undefined)` sem log. |
| Escalating Restart | N/A. | N/A | — |
| Non-Stop Forwarding | N/A. | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | Sem circuit-breaker, sem feature-flag para desligar a hidratação quando o ERP está mal — cada request paga o preço. | ❌ ausente | `RecebimentosPainelService.ts:247-271` |
| Transactions | N/A no caminho read; as escritas de reconciliação são UPDATEs pontuais idempotentes. | N/A | — |
| Predictive Model | Sem sinal preditivo (ex.: 3 falhas consecutivas ⇒ skip hidratação por 30 s). | ❌ ausente | — |
| Exception Prevention | "Só as não autorizadas" evita reler linhas terminais; cap evita rajada; lote evita `LOGIN_ERROR_MAX_SESSIONS`. | ⚠️ parcial | `RecebimentosPainelService.ts:250-252` (LOTE 5 vs FANOUT_LIMIT 4 do SISPAG — divergência abaixo) |
| Increase Competence Set | N/A. | N/A | — |

## 4. Findings

### F-availability-1: `runWithRetry` sem timeout por tentativa transforma um hang do ERP em ~8 min de latência no GET /painel

- **Severidade**: P1
- **Tactic violada**: Retry (parcial) + Removal from Service (ausente) + Exception Prevention (parcial)
- **Localização**: `src/backend/services/conexos.ts:121`; `src/backend/domain/client/ConexosBaseClient.ts:154-163`; `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:258-265`
- **Evidência (objetiva)**:
  ```
  services/conexos.ts:121   this.client = axios.create({ ..., timeout: 40000 });
  ConexosBaseClient.ts:154  new RetryExecutor({ retries: 2, delayMs: 500, jitterMs: 200, ... })
  RecebimentosPainelService.ts:258   for (let i = 0; i < candidatas.length; i += PAINEL_NDE_HIDRATACAO_LOTE) {
                                        const lote = candidatas.slice(i, i + PAINEL_NDE_HIDRATACAO_LOTE);
                                        const hidratadas = await Promise.all(lote.map((nde) => this.hidratarUma(nde)));
  ```
  Uma tentativa hangada consome os 40 s do axios. Com 2 retries: 3 × 40 s + 2 × 0,7 s ≈ **121 s por linha**. `Promise.all` de um lote toma o `max` das 5 → um docCod ruim já custa 121 s à lote inteira. Como os lotes correm em série (`for` await), 4 lotes × 121 s ≈ **484 s** (~8 min) na pior janela — hoje é possível prender o request do painel muito além do que qualquer analista tolera na tela. E a doutrina interna do próprio módulo (`ERP_WRITE_TIMEOUT_MS = 8000`, `constants.ts:110`) diz que 8 s é o teto por chamada externa: o painel está fora dessa doutrina.
- **Impacto técnico**: um único docCod cujo GET pina segura o Express handler; N analistas apertando F5 num pico de degradação Conexos criam N conexões abertas até o timeout terminarem. Não é "quebrar" — é acumular sockets, pool de DB e memória por 1–8 minutos, num serviço single-instance. E `heavyRouteLimiter` não protege esse GET (só está nas rotas write).
- **Impacto de negócio**: durante um incidente ERP (ou manutenção Conexos), a aba principal do time de recebimentos fica visualmente travada; o analista NÃO sabe se pode confiar no que aparece; a percepção é de "sistema Kavex fora do ar" quando o problema é o ERP à jusante. O caminho antigo (`ndes: []` hardcoded) devolvia em ~200 ms — a regressão de disponibilidade é diretamente atribuível à feature.
- **Métrica de baseline**: hoje sem incidente, painel simples respondia em <500 ms; com hidratação e ERP a 10 s/call, painel = **~40 s**; com hangs, **até ~484 s**. Meta: **≤ 15 s hard-cap** independente do estado do ERP.

### F-availability-2: divergência do FANOUT — lote 5 no painel vs 4 no SISPAG (o já provado seguro por incidente `LOGIN_ERROR_MAX_SESSIONS`)

- **Severidade**: P2
- **Tactic violada**: Exception Prevention
- **Localização**: `src/backend/domain/interface/recebimentos/constants.ts:283` (`PAINEL_NDE_HIDRATACAO_LOTE = 5`) vs `constants.ts:121` (`FANOUT_LIMIT_RECEBIMENTOS = 4` — "Alinhado ao `FANOUT_LIMIT=4` do SISPAG (mitigação do incidente `LOGIN_ERROR_MAX_SESSIONS`)")
- **Evidência (objetiva)**:
  ```
  constants.ts:121   export const FANOUT_LIMIT_RECEBIMENTOS = 4;
  constants.ts:283   export const PAINEL_NDE_HIDRATACAO_LOTE = 5;
  ```
  O comentário do próprio arquivo cita que 4 é o teto derivado de um incidente real (`LOGIN_ERROR_MAX_SESSIONS` do Conexos, que limita sessões simultâneas). O painel hidrata com 5 concorrentes — 1 acima do teto empiricamente seguro, num contexto onde a `services/conexos.ts` compartilha `loginPromise` mutex globalmente com toda a aplicação (SISPAG, ingest, jobs).
- **Impacto técnico**: sob uma abertura concorrente do painel + um job de ingest rodando, o número de sessões simultâneas no Conexos pode passar do teto e disparar `LOGIN_ERROR_MAX_SESSIONS` — o mesmo incidente que motivou o `FANOUT_LIMIT=4`.
- **Impacto de negócio**: rejeição de login do robô nos jobs enquanto o painel abre; falhas correlacionadas em outras frentes (SISPAG/Permutas) durante a janela de leitura da aba NDe.
- **Métrica de baseline**: `PAINEL_NDE_HIDRATACAO_LOTE = 5` (medido) vs `FANOUT_LIMIT_RECEBIMENTOS = 4` (doutrina interna).

### F-availability-3: sem circuit-breaker cross-request — cada painel refeito paga o preço integral quando o ERP está mal

- **Severidade**: P2
- **Tactic violada**: Removal from Service + Predictive Model + Ignore Faulty Behavior (cross-request)
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:247-271`
- **Evidência (objetiva)**:
  ```
  RecebimentosPainelService.ts:247-271  // hidratarNdes: nada persiste entre requests. Cada request abre a
                                          // hidratação do zero: 20 GETs × retry × 40 s.
  ```
  A única forma de "pular" o ERP é uma linha por vez, DENTRO do request. Nada agrega sinal entre requests: se 20/20 falharam há 500 ms, o próximo request paga a mesma penalidade. Contrasta com a doutrina JÁ EXISTENTE do módulo: `ProcessoProviderConexos.ts:106` CACHEIA `imp021` para reusar entre requests do painel (comment: "a previsão não pode custar uma varredura nova do imp021 por request do painel"). A hidratação NDe não segue essa doutrina.
- **Impacto técnico**: thundering herd sobre um ERP já degradado; amplificação linear no número de aberturas simultâneas do painel (N analistas × 20 GETs = N×20 pressão adicional durante uma degradação).
- **Impacto de negócio**: prolonga a duração observada de uma incidência do ERP; consome sessão do robô Conexos que outros fluxos (SISPAG, ingest, permutas) precisam; degradação em cascata cross-frente.
- **Métrica de baseline**: 0 breakers, 0 caches de hidratação (medido: `grep -n "cache\|Cache\|breaker\|Breaker" RecebimentosPainelService.ts` = 0 matches).

### F-availability-4: as escritas de reconciliação DENTRO do GET /painel são silenciosas (`.catch(() => undefined)` sem log)

- **Severidade**: P2
- **Tactic violada**: State Resynchronization (parcial) + Monitor + Condition Monitoring
- **Localização**: `src/backend/domain/service/recebimentos/RecebimentosPainelService.ts:295-302`
- **Evidência (objetiva)**:
  ```
  RecebimentosPainelService.ts:297  await this.execucaoRepo.setNdeAutorizado(nde.idempotencyKey, true).catch(() => undefined);
  RecebimentosPainelService.ts:299  await this.ndeRepo.updateNumeroNde(nde.idempotencyKey, numeroNde).catch(() => undefined);
  ```
  Se o Postgres estiver momentaneamente flaky, a reconciliação é PERDIDA sem sinal. No próximo load (com ERP saudável) o ciclo se refaz — mas até lá, o KPI `ndePendentes` conta a NDe como pendente que na verdade já autorizou; o analista pode agir sobre um estado errado. O comentário do próprio código admite: "Best-effort — falhar aqui só adia a reconciliação para o próximo load" — o que é verdade para a persistência, mas mentira para a observabilidade (nada avisa que a "próxima vez" também pode falhar, indefinidamente).
- **Impacto técnico**: silencia falhas do PostgreeDatabaseClient num caminho de escrita real (mesmo que idempotente). Não há sinal para o operador de que a state-resync está degradada.
- **Impacto de negócio**: KPI `ndePendentes` inflado em janela de flakiness do DB; analista pode reintervir num caso já resolvido.
- **Métrica de baseline**: 0 chamadas a `LogService`/`console.error` nas 2 escritas silenciadas (medido: `grep -n "console\|Log\|log" RecebimentosPainelService.ts:295-302` = 0).

### F-availability-5: GET /painel não tem timeout de request no Express nem está protegido pelo `heavyRouteLimiter`

- **Severidade**: P2
- **Tactic violada**: Removal from Service + Exception Prevention
- **Localização**: `src/backend/routes/recebimentos.ts:113-150`; `src/backend/index.ts:151`; `src/backend/http/rateLimit.ts:28`
- **Evidência (objetiva)**:
  ```
  routes/recebimentos.ts:113  router.get('/painel', asyncHandler(async (req, res) => { ... }));
                              // sem heavyRouteLimiter, sem res.setTimeout
  index.ts:151                app.listen(PORT, () => { ... });   // sem server.requestTimeout / server.timeout
  http/rateLimit.ts:19-24     globalLimiter = 100 req/min por IP  ← este SIM cobre /painel
  http/rateLimit.ts:28        heavyRouteLimiter = 10 req/min por IP  ← este NÃO cobre /painel
  ```
  Node HTTP default é `server.requestTimeout = 0` (sem limite). Somado ao F-availability-1, um request pode ficar aberto pelo tempo total do fan-out (~484 s no pior caso). O `heavyRouteLimiter` (10 req/min) existe justamente para "heavy report/analysis routes whose fan-out to the Conexos ERP can exhaust its session pool" (comentário do `rateLimit.ts:5-7`) — e o `/painel` agora É exatamente isso, mas está no limiter global (100/min).
- **Impacto técnico**: teto de 100 req/min por IP num endpoint que fan-outa 20 GETs ao ERP = potencialmente 2000 GETs/min ao Conexos por analista.
- **Impacto de negócio**: risco de tarifação/rate-limit no lado Conexos, risco de esgotar sessões do robô, contradiz uma decisão de arquitetura já tomada.
- **Métrica de baseline**: 100 req/min (atual) vs 10 req/min recomendado pela doutrina do próprio módulo.

## 5. Cards Kanban

### [availability-1] Enfileirar timeout por chamada no `lerDocParaPolling` e budget global na hidratação do painel

- **Problema**
  > O `hidratarUma` chama `ConexosBaseClient.runWithRetry` (2 retries), que por baixo usa axios com `timeout: 40000`. Sem `timeoutMs` por tentativa e sem budget global, um único docCod hangado custa até ~121 s por linha; um lote hangado, ~121 s; 4 lotes serial, ~484 s de latência no GET /painel — enquanto a doutrina interna do módulo já cita `ERP_WRITE_TIMEOUT_MS = 8000` como teto de chamada externa.

- **Melhoria Proposta**
  > Introduzir `NDE_HIDRATACAO_TIMEOUT_MS = 6000` em `constants.ts` (menor que o `ERP_WRITE_TIMEOUT_MS = 8000` porque é leitura de polling, não escrita crítica). Envolver `fiscalClient.lerDocParaPolling` num `Promise.race([call, timeoutRejection])` DENTRO do `.catch(() => undefined)` do `hidratarUma`. Adicionalmente, impor um **budget global** de hidratação por request (`NDE_HIDRATACAO_BUDGET_MS = 12000`): se ao terminar a batch atual o budget estourou, pular as próximas batches (as linhas restantes devolvem sem hidratação, exatamente como no cenário de ERP-off). Manter a idempotência: linhas não hidratadas voltam ao pool na próxima abertura. Tactic: **Retry (com timeout enforceable) + Removal from Service (pular batches quando o budget estourou)**.

- **Resultado Esperado**
  > Latência-teto do GET /painel adicionada pela hidratação em cenário ERP-hang cai de **~484 s → ≤ 15 s**. Em cenário ERP a 10 s/call, cai de **~40 s → ≤ 12 s (budget)**. O painel deixa de ser vulnerável a um único docCod ruim.

- **Tactic alvo**: Retry + Removal from Service
- **Severidade**: P1
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Latência p99 do GET /painel sob ERP-hang: ~484 s → ≤ 15 s
  - Latência p95 do GET /painel sob ERP 10 s/call: ~40 s → ≤ 12 s
- **Risco de não fazer**: durante o próximo incidente Conexos (histórico já teve `LOGIN_ERROR_MAX_SESSIONS`), a aba principal do time trava; time percebe como "sistema Kavex fora" e escala pressão sobre a Kavex.
- **Dependências**: nenhuma

### [availability-2] Alinhar `PAINEL_NDE_HIDRATACAO_LOTE` ao `FANOUT_LIMIT_RECEBIMENTOS = 4` já validado por incidente

- **Problema**
  > `PAINEL_NDE_HIDRATACAO_LOTE = 5` (`constants.ts:283`) diverge, no mesmo arquivo, do `FANOUT_LIMIT_RECEBIMENTOS = 4` (`constants.ts:121`), que existe justamente para conter o incidente `LOGIN_ERROR_MAX_SESSIONS` do Conexos. Cinco concorrentes na hidratação, somadas a jobs/SISPAG que já usam sessões do robô, podem estourar o teto de sessões do ERP.

- **Melhoria Proposta**
  > Reduzir para `PAINEL_NDE_HIDRATACAO_LOTE = 4` e adicionar um comentário citando o motivo (mesma exceção documentada em `FANOUT_LIMIT_RECEBIMENTOS`). Idealmente, unificar num único símbolo (`CONEXOS_CONCURRENCY_LIMIT`) para não haver dois "tetos" a manter. Tactic: **Exception Prevention**.

- **Resultado Esperado**
  > Zero divergência do teto de concorrência Conexos entre módulos. Nenhum novo incidente `LOGIN_ERROR_MAX_SESSIONS` correlacionado à abertura de painel.

- **Tactic alvo**: Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — 1 constante + testes)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Concorrência hidratação: 5 → 4
  - Incidentes `LOGIN_ERROR_MAX_SESSIONS` correlacionados a painel: baseline atual (não medido) → 0
- **Risco de não fazer**: revive um incidente já documentado; regride uma decisão de arquitetura já validada em produção.
- **Dependências**: nenhuma

### [availability-3] Adicionar cache curto (TTL 30–60 s) e/ou circuit-breaker no fan-out da aba NDe

- **Problema**
  > A hidratação NÃO cacheia entre requests. Duas aberturas do painel em 30 s = 40 GETs ao com297. O próprio módulo já tem doutrina de cache: `ProcessoProviderConexos.ts:106` cacheia `imp021` com TTL exatamente para "não custar uma varredura nova do imp021 por request do painel". E se o ERP está degradado, cada refresh do painel amplifica a carga sobre ele (thundering herd).

- **Melhoria Proposta**
  > (a) Cache in-process (`Map<docCod, {resultado, expiraEm}>`) na `hidratarNdes` com `NDE_HIDRATACAO_CACHE_TTL_MS = 30000` — 30 s cobre o F5 impulsivo do analista sem esconder a autorização SEFAZ (que leva minutos). Uma vez que a linha vira `ndeAutorizado: true`, ela sai da fila de candidatas naturalmente. (b) Circuit-breaker simples: contador de falhas consecutivas de `lerDocParaPolling`; ao passar de 5 falhas em 60 s, abrir por 30 s (as candidatas voltam intocadas). Tactic: **Removal from Service + Predictive Model**.

- **Resultado Esperado**
  > Sob N analistas simultâneos com ERP saudável: pressão no ERP passa de N×20 GETs para ~20 GETs (cache hit ratio > 90 %). Sob ERP degradado: primeiros ~5 GETs percebem, próximo minuto o painel pula hidratação, tirando N×20/min de pressão de um ERP já ruim.

- **Tactic alvo**: Removal from Service + Predictive Model
- **Severidade**: P2
- **Esforço estimado**: M (2–3d — cache + breaker + testes de propriedade)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Cache hit ratio da hidratação: 0 % → ≥ 70 %
  - GETs com297/req do painel durante incidente ERP: 20 → ≤ 5 (breaker aberto)
- **Risco de não fazer**: cada incidente Conexos vira cascata para outras frentes que compartilham sessão do robô.
- **Dependências**: depende de `availability-1` para o timeout por-chamada dar sinal ao breaker.

### [availability-4] Logar falhas da state-resync (`setNdeAutorizado`, `updateNumeroNde`) e emitir métrica

- **Problema**
  > As duas escritas de reconciliação em `RecebimentosPainelService.ts:297,299-301` engolem qualquer erro do Postgres com `.catch(() => undefined)`. Não há sinal para o operador se a reconciliação está degradada — o comentário do código admite "só adia para o próximo load", mas nada mede se o "próximo load" também falha, indefinidamente. O KPI `ndePendentes` pode ficar inflado sem alerta.

- **Melhoria Proposta**
  > Substituir o `.catch(() => undefined)` por um `.catch((err) => logService.warn({ type: 'NDE_RESYNC_FAIL', idempotencyKey, cause: err }))` (respeitando a doutrina de nunca-double-log dos handlers do módulo). Adicionalmente, contar o número de `NDE_RESYNC_FAIL` por request e devolver como debug field no payload (nada visível ao analista; útil no diagnóstico). Tactic: **Monitor + Condition Monitoring**.

- **Resultado Esperado**
  > 100 % das falhas de reconciliação passam a ter rastro. Alerta operacional (quando houver observabilidade central) sobre janelas com >X% de resync-fail.

- **Tactic alvo**: Monitor + Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - Cobertura de log em `hidratarUma`: 0/2 → 2/2 escritas com log
  - MTTR de "KPI ndePendentes inflado" desconhecido → observável
- **Risco de não fazer**: incidente silencioso de DB corrompe o KPI e o analista age em cima de dado errado.
- **Dependências**: nenhuma

### [availability-5] Aplicar `heavyRouteLimiter` e `res.setTimeout` no GET /recebimentos/painel

- **Problema**
  > O comentário do `http/rateLimit.ts:5-7` define o `heavyRouteLimiter` para "heavy report/analysis routes whose fan-out to the Conexos ERP can exhaust its session pool". O `/painel` acabou de virar exatamente esse perfil (fan-out de até 20 GETs por request), mas está no limiter global (100 req/min por IP). Além disso, o `app.listen` não define `server.requestTimeout` — Node default é sem limite, então nada corta um request que ficou 8 minutos abrindo sockets.

- **Melhoria Proposta**
  > (a) Adicionar `heavyRouteLimiter` ao `router.get('/painel', ...)`. (b) Adicionar `server.requestTimeout = 30000` (ou `res.setTimeout(30000)` por rota) para casar com o budget de `availability-1`. (c) Considerar `keepAliveTimeout` alinhado ao Render (65 s). Tactic: **Removal from Service + Exception Prevention**.

- **Resultado Esperado**
  > Um analista de má-fé (ou um script) não consegue causar 2000 GETs/min ao Conexos por IP. Requests presos por bug/hang são cortados em 30 s, liberando o socket e o pool de DB.

- **Tactic alvo**: Removal from Service + Exception Prevention
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Rate-limit por IP no /painel: 100/min → 10/min
  - `server.requestTimeout`: `0` (sem limite) → `30000`
- **Risco de não fazer**: um analista sem má-fé apertando F5 no painel durante uma degradação do ERP amplifica a pressão sobre o próprio ERP degradado.
- **Dependências**: complementa `availability-1` (o timeout HTTP é a última linha de defesa; o budget interno deve cortar antes).

## 6. Notas do agente

- **Escopo**: DELTA da feature. Não avaliei disponibilidade full-repo. As frentes SISPAG/Permutas/Popula GED estão fora deste recorte, exceto onde a doutrina delas informa o julgamento (ex.: `FANOUT_LIMIT_RECEBIMENTOS = 4` do incidente `LOGIN_ERROR_MAX_SESSIONS`).
- **Métricas não coletadas**: p50/p95 real do `GET com297/{docCod}` em produção, ratio de falhas real por filial, MTTR real analista-visível — dependem de CloudWatch/Render logs ou de instrumentação server-side que ainda não existe (ver F-availability-4 → passo para viabilizar).
- **Cross-QA (alertar consolidator)**:
  - Com **Performance**: o cap 20 + lote 5 + hidratação serial-por-lote impõe latência ao painel; performance-* deve avaliar se paralelizar `enriquecerComModalidade` com `hidratarNdes` faz sentido (hoje são serializados sem necessidade em `RecebimentosPainelService.ts:146-147`).
  - Com **Fault-tolerance**: o padrão "escrita silenciosa dentro de GET" (F-availability-4) é um risco de silenciamento de fault que fault-tolerance-* deve considerar globalmente.
  - Com **Testability**: os testes já cobrem "ERP fora do ar não derruba o painel" (`RecebimentosPainelService.test.ts:217-230`), mas NÃO cobrem "ERP LENTO" (ninguém testa o timeout-teto). Testability-* pode propor um teste de timeout com jest fake-timers.
- **Score 6/10**: doutrina de degradation está sólida (best-effort por linha, cap, lote, shadow read do banco) — o "sem cair" está garantido. Mas o "sem TRAVAR" (timeout, budget, circuit-breaker, cache) está frouxo, e o desalinhamento do lote 5 vs 4 é uma regressão de decisão já tomada. Corrigir F-availability-1 sozinho já move a nota para 7-8.
