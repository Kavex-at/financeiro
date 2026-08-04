---
qa: Availability
qa_slug: availability
run_id: 2026-07-29-0243-recebimentos-sn
agent: qa-availability
generated_at: 2026-07-28T00:00:00Z
scope: backend
score: 7
findings_count: 6
cards_count: 5
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta SN)

Escopo: a nova feature `gerarSolicitacaoNumerario` (SN) — modal "Alocar" que lista processos
candidatos e "Processa" um deles, gerando o payload `GerDocProcessoSelectionDTOCab` do com299 em
**DRY-RUN-ONLY**. Não há caminho de escrita ao ERP alcançável nesta iteração: o seam `enviarAoErp`
lança `NotImplementedError` de propósito
(`src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:117-121`).

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista financeiro no painel Recebimentos | Clica "Alocar" em uma transação bancária → "Processar" em um dos processos candidatos | `GET /recebimentos/transacoes/:txnId/processos` + `POST /recebimentos/transacoes/:txnId/solicitacao-numerario` (Express + `SolicitacaoNumerarioService` + `ProcessoProviderStub`) | Produção (flag `RECEBIMENTOS_ENABLED` OFF → 403 via `recebimentosGate`) ou dev/HML (flag ON) | Rota devolve 200 com `{dryRun:true, docConfig, payload}` **sem tocar o Conexos**; qualquer tentativa de wire-real ao ERP falha fechado com `NotImplementedError` (retryable:false) | 0 escritas no ERP (garantido pelo seam); 100% das falhas de backend visíveis no cliente (não mascaradas por fallback); MTTR ≤ 5 min para reativar/desativar via `RECEBIMENTOS_ENABLED` |

Cenário complementar (dependência futura): quando o `enviarAoErp` for cabeado (Módulo 5), o mesmo
canal precisará honrar `timeoutMs`/retry/idempotency que os ports já declaram
(`ExternalCallOptions`, `ERP_WRITE_TIMEOUT_MS`, `RECEBIMENTO_RETRY_ATTEMPTS`) mas que esta feature
ainda não exercita.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Caminhos de escrita ao ERP alcançáveis a partir da feature SN | 0 (só `enviarAoErp` que lança `NotImplementedError`; nunca é invocado) | 0 (dry-run only) | ✅ | `SolicitacaoNumerarioService.ts:117-121` + `grep -n "enviarAoErp" src/backend` (só definição + teste) |
| Rotas SN protegidas por gate/RBAC/rate-limit | 2/2 (`GET .../processos` — authz por-filial; `POST .../solicitacao-numerario` — `heavyRouteLimiter` + `requireRole('admin')` + authz por-filial) | 100% | ✅ | `src/backend/routes/recebimentos.ts:154-178, 199-237` |
| Cobertura de validação Zod nos boundaries (query + body) | 2/2 rotas SN | 100% | ✅ | `routes/recebimentos.ts:143-146, 181-190` |
| `NotImplementedError.statusCode` (501) preservado pela camada HTTP | ❌ 0% — `errorMiddleware` sempre devolve HTTP 500 genérico, ignora `statusCode` do `HandlerError` | 100% (mapear `HandlerError.statusCode` na resposta) | ❌ | `src/backend/http/errorMiddleware.ts:12-38` + `src/backend/http/errorMiddleware.test.ts:31` |
| Fallback do FE que MASCARA falha do backend (dry-run "sintético" indistinguível do assinado pelo BE) | 2 caminhos (`fetchProcessosParaTransacao` e `processarSolicitacaoNumerario` — `catch → return fixture / buildDryRunFallback`) | 0 (ou marcar `fonte:'fixture'` no shape retornado, como já é feito para `RecebimentosPainel`) | ❌ | `src/frontend/lib/recebimentos.ts:435-453, 461-492` |
| Uso de `RetryExecutor`/`FallbackExecutor` no delta SN | 0 (não há chamada externa no dry-run) | N/A no dry-run; obrigatório assim que `enviarAoErp` for cabeado | N/A (dry-run) | `grep -rn "RetryExecutor\|FallbackExecutor\|PollExecutor" src/backend/domain/service/recebimentos` → 0 hits |
| Idempotência da rota SN (`Idempotency-Key`) | Ausente. A `/pipeline/run` faz `receb:${sub}:${key}`; a `POST .../solicitacao-numerario` não emite nem consulta ledger | Presente antes de cabear `enviarAoErp` (evita SN duplicada no ERP) | ⚠️ parcial (aceitável hoje porque é dry-run; dívida crítica antes do go-live) | `routes/recebimentos.ts:199-237` (nenhum `idempotencyKey`/ledger) |
| Ontologia P3: `gcdCod` typed constant vs. raw string | ✅ typed (`SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdCod = 0` PLACEHOLDER) — sanity check documentado | typed + valor real | ⚠️ parcial (placeholder é intencional até HML/HAR) | `interface/recebimentos/constants.ts:130-140` |
| Testes de disponibilidade do delta SN (dry-run + `NotImplementedError` + authz + Zod) | 3+3+2+1 (SolicitacaoNumerarioService.test 6 cases, ProcessoProviderStub.test 4 cases, routes/recebimentos.test 8 cases sobre SN) | ≥ smoke por rota | ✅ | `wc -l src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.test.ts` + `src/backend/routes/recebimentos.test.ts:234-287` |

> ⚠️ **Não medível localmente**: MTTR real do envio pós-go-live (quando `enviarAoErp` existir).
> Requer CloudWatch Logs Insights / instrumentação de métrica em produção. Recomendação: quando o
> Módulo 5 wire-real for cabeado, emitir `MetricsEvent` de duração por estágio via `MetricsPortStub`
> real (`ports.ts:210-218`) para medir `envio → confirmado` na SN.
>
> ⚠️ **Não medível localmente**: taxa de fallback silencioso do FE em produção
> (`fetchProcessosParaTransacao`/`processarSolicitacaoNumerario` caindo no fixture). Requer
> telemetria FE (Vercel Analytics ou Sentry breadcrumb no `catch`) — hoje o `catch` é vazio, o sinal
> some.

## 3. Tactics — Cobertura no delta SN

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Ausente na feature SN — não há healthcheck da rota | ❌ ausente | — |
| Heartbeat | Ausente | ❌ ausente | — |
| Monitor | `LogService.info` emitido em cada `gerar` com `{dryRun, priCod, filCod, ator}`; central `errorMiddleware` faz `console.error` do erro + resposta Conexos (quando houver) | ⚠️ parcial | `SolicitacaoNumerarioService.ts:97-107`; `errorMiddleware.ts:23-30` |
| Timestamp | `docDtaEmissao/dtaVencimento` = ISO string de `dataReferencia` (default `now`); `LogService` também timestampa | ✅ presente | `SolicitacaoNumerarioService.ts:63, 80-81` |
| Sanity Checking | Zod nos dois boundaries (query e body) + `assertUserCanActOnFilial` como sanity multi-filial; `gcdCod` como typed constant (P3) | ✅ presente | `routes/recebimentos.ts:143-146, 181-190, 210-218`; `constants.ts:130-134` |
| Condition Monitoring | Ausente (nenhum threshold monitorado, ex.: nº de SNs simuladas por minuto) | ❌ ausente | — |
| Voting | N/A — sem replicação/consenso na feature | N/A | — |
| Exception Detection | Rotas usam `asyncHandler` → central `errorMiddleware`; `NotImplementedError` implementa `HandlerError` com `code/statusCode/retryable/userMessage` | ✅ presente (definição) / ❌ ausente (a camada HTTP não translada) | `asyncHandler.ts:8-13`; `NotImplementedError.ts:11-25`; `errorMiddleware.ts:35-37` |
| Self-Test | Ausente | ❌ ausente | — |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A — Render single-instance; feature não depende de replicação | N/A | — |
| Passive Redundancy | N/A | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | Central `errorMiddleware` captura tudo; `FilialForbiddenError → 403` é tratado dentro da rota; `NotImplementedError` DEFINE `statusCode:501/userMessage` mas o middleware o achata para 500 | ⚠️ parcial | `errorMiddleware.ts:35-37`; `routes/recebimentos.ts:69-80, 210-218`; `NotImplementedError.ts:15-17` |
| Rollback | N/A na feature — dry-run é read/compute; nenhum estado é mutado no BE (sem `Idempotency-Key` porque não há efeito colateral) | N/A (dry-run) | — |
| Software Upgrade | Deploy via Render hook (fora do escopo do delta) | N/A no delta | — |
| Retry | Ausente na feature SN — não há chamada externa. `RetryExecutor` existe em `libs/executor/` mas não é wire-in porque `enviarAoErp` nunca corre | N/A (dry-run) — pré-requisito do wire-real | `libs/executor/RetryExecutor.ts` (não usado no delta); grep 0 hits em `service/recebimentos/` |
| Ignore Faulty Behavior | ⚠️ **Misapplied no FE**: `fetchProcessosParaTransacao` e `processarSolicitacaoNumerario` engolem qualquer erro do BE (`catch {}`) e devolvem fixture / payload sintético local — ao invés de degradar visivelmente, apagam o sinal | ❌ ausente/mal-implementado | `src/frontend/lib/recebimentos.ts:442-453, 466-491` |
| Degradation | Empty-state no modal quando não há candidatos; `RecebimentosPainel` marca `fonte:'fixture'` (padrão bom que a modal NÃO reaproveita) | ⚠️ parcial | `AlocarProcessosDialog.tsx:167-172`; `lib/recebimentos.ts:98-106, 512` |
| Reconfiguration | ✅ **Forte**: `PROCESSO_PROVIDER_TOKEN` no `recebimentosContainer.ts:55` — Módulo 2/2b troca o token para a fonte real sem tocar rota/service. `NotImplementedError` no `enviarAoErp` é reconfigurable para wire-real substituindo o seam | ✅ presente | `recebimentosContainer.ts:42-56`; `SolicitacaoNumerarioService.ts:117-121` |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A na feature — dry-run é intrinsecamente shadow (não há write real que compare) | N/A (dry-run é o próprio shadow) | `SolicitacaoNumerarioService.ts` docstring L37-42 |
| State Resynchronization | N/A — sem estado persistido pela feature (a request é stateless) | N/A | — |
| Escalating Restart | N/A no runtime Express single-process | N/A | — |
| Non-Stop Forwarding | N/A | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | ✅ **Múltiplas camadas**: (1) `recebimentosGate` retorna 403 quando `RECEBIMENTOS_ENABLED=false` (padrão em prod); (2) `enviarAoErp` desativado por design (throws `NotImplementedError`); (3) `heavyRouteLimiter` (10 req/min/IP) na rota SN | ✅ presente | `http/recebimentosGate.ts:14-22`; `SolicitacaoNumerarioService.ts:117-121`; `routes/recebimentos.ts:201-202`; `http/rateLimit.ts:28-35` |
| Transactions | N/A na feature (dry-run — nada é persistido). **Dívida crítica** quando `enviarAoErp` for cabeado: precisará escrever no `RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN` (ledger write-ahead) antes do POST, e usar `setBorCod`/`setRequestPayload` já declarados no port | ⚠️ parcial (adequado ao dry-run; débito assumido antes do go-live) | `ports.ts:259-275` (ledger declarado, não consumido pela rota SN) |
| Predictive Model | Ausente | ❌ ausente | — |
| Exception Prevention | Zod nos boundaries; `requireRole('admin')`; `assertUserCanActOnFilial`; `Idempotency-Key` namespaced por `sub` em `/pipeline/run` (padrão que a rota SN deve herdar quando for wire-real) | ✅ presente (SN input); ⚠️ parcial (falta idempotency namespacing na SN) | `routes/recebimentos.ts:181-190, 200-218`; `filialAuthz.ts:52-60` |
| Increase Competence Set | Typed enums/constants para `docTip`, `docVldTipo`, `gcdCod` placeholder + `SOLICITACAO_NUMERARIO_GCD_DES_NOME` no FE — nada de string crua | ✅ presente | `constants.ts:130-140`; `lib/recebimentos.ts:365` |

## 4. Findings (achados)

### F-availability-1: `errorMiddleware` achata `HandlerError.statusCode` — `NotImplementedError` (501) vira 500 opaco

- **Severidade**: P2 (débito técnico defensável enquanto `enviarAoErp` não é invocado — nenhum caminho de execução hoje chega ao throw)
- **Tactic violada**: Exception Handling (Bass — Recover from Faults)
- **Localização**: `src/backend/http/errorMiddleware.ts:12-38` (achata) + `src/backend/domain/errors/NotImplementedError.ts:11-25` (define `statusCode:501/code:'NOT_IMPLEMENTED'/userMessage/retryable:false`)
- **Evidência (objetiva)**:
  ```ts
  // errorMiddleware.ts:35-37
  if (res.headersSent) { return; }
  res.status(500).json({ error: 'Internal server error' });
  ```
  ```ts
  // NotImplementedError.ts:12-17
  public readonly code = 'NOT_IMPLEMENTED';
  public readonly statusCode = 501;
  public readonly retryable = false;
  ```
  Teste em `errorMiddleware.test.ts:31-35` confirma o comportamento: qualquer `Error` retorna `{ error: 'Internal server error' }` HTTP 500 — o middleware não olha `statusCode`.
- **Impacto técnico**: quando `enviarAoErp` for chamado por engano (ou em teste manual), a resposta será 500 + `Internal server error`. O cliente/observador perde a distinção entre "endpoint não implementado (501, esperado)" e "explodiu (500, incidente)". Rate-limit e alarms downstream que discriminam por status também são cegados.
- **Impacto de negócio**: quando o wire-real for adicionado (Módulo 5), sinais de disponibilidade ficam ruidosos — um endpoint deliberadamente desativado dispara alertas de 500 como se fosse falha real, gerando fadiga de alerta.
- **Métrica de baseline**: 0% dos `HandlerError.statusCode` traduzidos (medido em `errorMiddleware.ts:35-37`). Alvo: 100%.

### F-availability-2: FE mascara falhas do backend com fallback silencioso e indistinguível

- **Severidade**: P1 (degrada a observabilidade de disponibilidade percebida — o operador vê "sucesso" sob um 5xx real)
- **Tactic violada**: Ignore Faulty Behavior (mal-implementada) + Monitor (sinal apagado)
- **Localização**: `src/frontend/lib/recebimentos.ts:435-453` (`fetchProcessosParaTransacao` — `catch { return fixtureProcessos... }`) e `461-492` (`processarSolicitacaoNumerario` — `catch { return buildDryRunFallback(...) }`); `src/frontend/app/recebimentos/components/AlocarProcessosDialog.tsx:118-125` (o toast fala "simulação gerada" mesmo quando veio do fallback local)
- **Evidência (objetiva)**:
  ```ts
  // lib/recebimentos.ts:461-492 (excerto)
  try {
    const res = await apiFetch(...);
    if (!res.ok) throw new Error(`API ${res.status}`);
    ...
    return buildDryRunFallback(processo, valorTransacao);
  } catch {
    return buildDryRunFallback(processo, valorTransacao);
  }
  ```
  O `catch` é vazio (nem log, nem `console.warn`, nem breadcrumb). O shape retornado é **idêntico** ao do backend (`{dryRun:true, docConfig, payload}`), sem um marcador `fonte:'fixture'` como já existe no `RecebimentosPainel` (`lib/recebimentos.ts:98-106, 288, 512`). O toast em `AlocarProcessosDialog.tsx:118-120` diz "Solicitação de Numerário (encomenda) — simulação gerada (dry-run)" independentemente da origem.
- **Impacto técnico**: qualquer 5xx / 403 / erro de rede vira "sucesso" no UI, com um payload fabricado no cliente (`gcdCod:0`, códigos de rateio zerados). O operador não sabe que o backend não respondeu. Erros de configuração (ex.: `RECEBIMENTOS_ENABLED=false` retornando 403) ficam invisíveis.
- **Impacto de negócio**: quando o wire-real existir, o mesmo padrão fará com que uma falha real de envio ao ERP apareça como "simulação ok" — o analista pode assumir que a SN foi disparada. Ainda no dry-run, essa opacidade compromete a auditabilidade da demo (o payload previsto ao stakeholder pode não ser o mesmo que o BE geraria com o `gcdCod` real quando ele existir).
- **Métrica de baseline**: 2/2 caminhos silenciosos, 0/2 sinalizando `fonte:'fixture'` para a UI. Alvo: 0/2 silenciosos (todo `catch` loga + toast informa fallback) OU 2/2 marcados como `fonte:'fixture'` no shape retornado.

### F-availability-3: Rota SN não emite/consulta `Idempotency-Key` — landmine para o wire-real

- **Severidade**: P2 (hoje é aceitável porque a rota é dry-run e sem efeito colateral; vira P0 no momento em que `enviarAoErp` for cabeado)
- **Tactic violada**: Transactions + Exception Prevention (Bass — Prevent Faults)
- **Localização**: `src/backend/routes/recebimentos.ts:199-237` (rota SN não usa `Idempotency-Key` nem `RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN`) vs. `src/backend/routes/recebimentos.ts:53-138` (rota `/pipeline/run` já faz `receb:${ator}:${headerKey ?? correlationId}`)
- **Evidência (objetiva)**:
  ```ts
  // routes/recebimentos.ts:83-86 (pipeline/run — bom padrão)
  const headerKey = req.header('Idempotency-Key');
  const idempotencyKey = `receb:${ator}:${headerKey ?? parsed.data.correlationId}`;
  // vs. routes/recebimentos.ts:200-237 (SN — nenhuma idempotency)
  ```
  O ledger já está declarado (`ports.ts:259-275`: `beginExecution`, `setBorCod`, `markSettled/markError`) e o `PermutaExecucaoRepository`-parity está no docstring do próprio port; a rota SN simplesmente não o usa.
- **Impacto técnico**: no momento do wire-real (Módulo 5), duplo-clique / F5 / retry do cliente cria N SNs no ERP para a mesma transação. Sem `expectedVersao` / ledger `alreadySettled`, não há dedupe.
- **Impacto de negócio**: SN duplicada = numerário duplicado no ERP = reconciliação manual + estorno + risco de compliance. É exatamente o cenário que o padrão de idempotency em `/pipeline/run` foi criado para evitar.
- **Métrica de baseline**: 0/1 rota SN com `Idempotency-Key` namespaced. Alvo: 1/1 (obrigatório antes de wire-real).

### F-availability-4: Falta timeout/retry envelope no seam `enviarAoErp` — pré-requisito para o wire-real

- **Severidade**: P2 (dormant — não pode ser exercitado até `enviarAoErp` sair do `NotImplementedError`)
- **Tactic violada**: Retry + Timeout (Bass — Recover from Faults / Prevent Faults)
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:117-121`
- **Evidência (objetiva)**: o service não injeta `RetryExecutor` nem `ExternalCallOptions` (declarado em `ports.ts:44-49` com `NEXXERA_FETCH_TIMEOUT_MS/ERP_WRITE_TIMEOUT_MS/NDE_EMIT_TIMEOUT_MS` já constantes em `constants.ts:99-105`). O SN é o único caminho de wire-real que ainda não tem esse envelope declarado no port.
- **Impacto técnico**: uma vez cabeado, um Conexos travado piniará o worker Express até o timeout global do Node/Render (não configurado); com `heavyRouteLimiter` a 10 req/min a starvation seria limitada, mas ainda pode se propagar a outros clientes do pool.
- **Impacto de negócio**: durante um incidente Conexos, o operador não tem feedback rápido (rota fica pendurada); o teto de latência aceito para SN precisa ser negociado com o negócio (proposta inicial: `ERP_WRITE_TIMEOUT_MS = 8000ms`).
- **Métrica de baseline**: 0 chamadas externas na feature hoje (dry-run). Alvo: 100% wrap em `RetryExecutor` + `ExternalCallOptions.timeoutMs` quando `enviarAoErp` for cabeado.

### F-availability-5: Ausência de Condition Monitoring — nenhum contador emitido no dry-run

- **Severidade**: P3 (nice-to-have; a feature é dry-run e o volume esperado é baixo)
- **Tactic violada**: Condition Monitoring + Monitor (Bass — Detect Faults)
- **Localização**: `src/backend/domain/service/recebimentos/SolicitacaoNumerarioService.ts:97-107` (só `logService.info`) — não usa `MetricsPortInterface.emit` (`ports.ts:210-218`)
- **Evidência (objetiva)**: `MetricsPortStub` já existe e está registrado (`recebimentosContainer.ts:53`), mas o `SolicitacaoNumerarioService` não é injetado com ele. Ontology / `_shared-metrics.md` §"Feature nature" declara a feature como dry-run — sem contador, não há baseline para o dia do wire-real.
- **Impacto técnico**: no dia do wire-real, não há série temporal histórica de "quantas SNs foram simuladas por dia" para comparar com "quantas foram efetivadas". A instrumentação nasce zerada.
- **Impacto de negócio**: perde-se a chance de aprender o padrão de uso durante a fase dry-run (quantas simulações por analista, por filial, por processo).
- **Métrica de baseline**: 0 métricas emitidas pela feature SN. Alvo: ≥ 1 (`stage:'sn_dryrun_gerado'`, `outcome:'ok'`, `attributes:{filCod, priCod}`).

### F-availability-6: Sem healthcheck/readiness da rota SN

- **Severidade**: P3 (o `/recebimentos/painel` já expõe superfície viva; SN não precisa de healthcheck próprio hoje)
- **Tactic violada**: Ping/Echo (Bass — Detect Faults)
- **Localização**: `src/backend/routes/recebimentos.ts` (nenhuma rota de health)
- **Evidência (objetiva)**: `grep -n "health\|ready\|ping" src/backend/routes/recebimentos.ts` → 0 hits.
- **Impacto técnico**: para o operador validar rapidamente "a rota SN está viva", tem que disparar um POST com admin + filial autorizada (nada trivial).
- **Impacto de negócio**: baixo — no runtime Express single-process, se o painel abre, a rota também está viva.
- **Métrica de baseline**: 0 endpoint de health dedicado. Alvo: aceitável no delta (P3).

## 5. Cards Kanban

### [availability-1] Traduzir `HandlerError.statusCode`/`code`/`userMessage` no `errorMiddleware`

- **Problema**
  > O `errorMiddleware` central sempre responde `HTTP 500 {error:'Internal server error'}` — mesmo para erros que implementam `HandlerError` com `statusCode` explícito (ex.: `NotImplementedError` = 501, `FilialForbiddenError` já é tratado inline). Quando o wire-real do `enviarAoErp` for cabeado, um endpoint deliberadamente desativado vai gerar ruído de 500 nos alarms.

- **Melhoria Proposta**
  > No `errorMiddleware.ts`, detectar `HandlerError` (via duck-typing em `code/statusCode/userMessage`) e usar `err.statusCode` + `{error: err.userMessage, code: err.code}`. Manter fallback 500 para erros genéricos. Cobrir com teste que injeta `NotImplementedError` e valida HTTP 501 + `code:'NOT_IMPLEMENTED'`. Tactic: **Exception Handling**.

- **Resultado Esperado**
  > Rotas continuam devolvendo 500 para exceções não-classificadas; endpoints deliberadamente desativados devolvem 501 sem falso-positivo em métricas de disponibilidade.

- **Tactic alvo**: Exception Handling
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - `HandlerError.statusCode` traduzidos: 0% → 100%
  - Teste `errorMiddleware.test.ts` cobrindo `NotImplementedError → 501`: 0 → 1
- **Risco de não fazer**: quando o wire-real cair, alarmes de 5xx vão soar para toda tentativa de envio-antes-do-tempo, mascarando incidentes reais.
- **Dependências**: nenhuma (auto-contido no `http/`)

### [availability-2] FE: marcar fallback do `fetchProcessosParaTransacao`/`processarSolicitacaoNumerario` como `fonte:'fixture'` + logar

- **Problema**
  > As duas funções do `lib/recebimentos.ts` engolem qualquer erro do backend (`catch {}`) e devolvem fixture / payload sintético construído localmente, com shape indistinguível do assinado pelo BE. O operador vê "simulação gerada" no toast mesmo quando o backend respondeu 5xx/403. O padrão já usado no `RecebimentosPainel` (`fonte:'banco'|'fixture'`) não foi replicado na modal "Alocar".

- **Melhoria Proposta**
  > (1) Adicionar `fonte: 'backend' | 'fallback-local'` ao retorno de `processarSolicitacaoNumerario` (e um `origem` similar para `fetchProcessosParaTransacao`). (2) Nos `catch`, `console.warn` com o status. (3) No `AlocarProcessosDialog.tsx`, quando `fonte==='fallback-local'`, mostrar um `Badge variant="warning"` + toast informativo ("Backend indisponível — payload local"). Tactic: **Degradation** (bem-implementada) + **Monitor** (restaurar sinal).

- **Resultado Esperado**
  > 100% das falhas de backend visíveis na UI. Operador nunca é enganado por payload sintético apresentado como se fosse "assinado" pelo backend.

- **Tactic alvo**: Degradation + Monitor
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — dois arquivos FE + testes existentes)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Caminhos silenciosos: 2 → 0
  - Shape retornado marcando origem do fallback: 0/2 → 2/2
  - Teste do FE cobrindo o caminho de fallback: adicionar 1 case por função
- **Risco de não fazer**: no dia do wire-real, o mesmo padrão fará com que uma falha real de POST ao ERP apareça como "SN dry-run gerada" — o analista assume falso sucesso. Auditoria da demo fica comprometida (payload apresentado ao cliente pode divergir do que o BE geraria).
- **Dependências**: nenhuma

### [availability-3] Adicionar idempotency namespacing na rota `POST .../solicitacao-numerario` (pré-requisito do wire-real)

- **Problema**
  > A rota `/pipeline/run` já monta `Idempotency-Key` como `receb:${sub}:${headerKey ?? correlationId}` (evita denial-of-execution cross-ator). A rota `POST .../solicitacao-numerario` não faz nada disso. Enquanto for dry-run, é irrelevante; no primeiro dia do wire-real de `enviarAoErp`, um duplo-clique cria SNs duplicadas no ERP.

- **Melhoria Proposta**
  > Herdar o padrão de `/pipeline/run:83-86`: aceitar `Idempotency-Key` header, montar chave namespaced por `sub`, e — antes de invocar `enviarAoErp` — chamar `RECEBIMENTO_EXECUCAO_REPOSITORY_TOKEN.beginExecution` + `setRequestPayload`, `markSettled/markError` nos terminais. Tactic: **Transactions** (Bass — Prevent Faults). Não precisa cabear tudo agora, mas o esqueleto (`beginExecution` retornando `alreadySettled=true` → short-circuit 200) deve entrar no delta ou no card imediatamente seguinte.

- **Resultado Esperado**
  > No dia do wire-real, retries/duplo-clique NUNCA geram SN duplicada no ERP. Baseline: 0 SNs duplicadas por retry.

- **Tactic alvo**: Transactions + Exception Prevention
- **Severidade**: P2 (hoje) / P0 (no wire-real)
- **Esforço estimado**: M (2–5d — precisa cabear o ledger)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Rota SN com `Idempotency-Key` namespaced: 0/1 → 1/1
  - Teste cobrindo idempotency `POST → POST` retornando o mesmo resultado: 0 → 1
- **Risco de não fazer**: SN duplicada no ERP = numerário duplicado. Reconciliação manual + estorno + risco de compliance financeiro.
- **Dependências**: obrigatoriamente **antes** de fechar o card do Módulo 5 wire-real (`enviarAoErp`).

### [availability-4] Wrap do `enviarAoErp` com `RetryExecutor` + `ExternalCallOptions.timeoutMs`

- **Problema**
  > O seam `enviarAoErp` hoje lança `NotImplementedError`. Quando for cabeado, precisa herdar o mesmo envelope que os outros ports Frente IV já declaram (`ExternalCallOptions`, timeouts em `constants.ts:99-105`, `RECEBIMENTO_RETRY_ATTEMPTS=3`, `RECEBIMENTO_RETRY_DELAY_MS=1000`).

- **Melhoria Proposta**
  > Ao implementar `enviarAoErp`: injetar `RetryExecutor` + `ConexosClient`, aceitar `opts?: ExternalCallOptions` com default `ERP_WRITE_TIMEOUT_MS = 8000`, e passar `AbortSignal` para o `axios.request`. O template já existe nos outros gateways (`ErpReceivablesGatewayInterface` em `ports.ts:193-201`). Tactic: **Retry** + timeout (Bass — Recover from Faults).

- **Resultado Esperado**
  > Zero requests do worker Express pinados sob incidente Conexos. Teto de latência SN = `ERP_WRITE_TIMEOUT_MS × RECEBIMENTO_RETRY_ATTEMPTS` = 24s (negociável).

- **Tactic alvo**: Retry + Timeout (via `ExternalCallOptions`)
- **Severidade**: P2 (dormant — só ativa junto do wire-real)
- **Esforço estimado**: S (≤1d — padrão já cabeado nos irmãos)
- **Findings relacionados**: F-availability-4
- **Métricas de sucesso**:
  - `enviarAoErp` wrap em `RetryExecutor`: 0 → 1
  - `enviarAoErp` honrando `timeoutMs`: 0 → 1
- **Risco de não fazer**: um Conexos travado durante a janela de execução das SNs pina workers e degrada as OUTRAS rotas do Express (via pool esgotado / rate-limit). Já é o incidente que `LOGIN_ERROR_MAX_SESSIONS` motivou no SISPAG.
- **Dependências**: bloqueado por HML/HAR (`gcdCod` real + shape) — mesma pré-condição do wire-real.

### [availability-5] Instrumentar `MetricsPortInterface.emit` no `SolicitacaoNumerarioService.gerar`

- **Problema**
  > O service só emite `logService.info`. `MetricsPortStub` já está registrado (`recebimentosContainer.ts:53`) mas não é injetado. Sem contador na fase dry-run, não há baseline histórica de uso para o dia do wire-real.

- **Melhoria Proposta**
  > Injetar `MetricsPortInterface` no `SolicitacaoNumerarioService`; emitir `{stage:'sn_dryrun_gerado', correlationId, outcome:'ok', attributes:{filCod, priCod}}` no fim do `gerar`; emitir `outcome:'error'` no `catch` externo (na rota). Tactic: **Condition Monitoring** (Bass — Detect Faults). Sem PII (contraparte, nome de pessoa, valor) — só counters/enums, como o docstring do port exige.

- **Resultado Esperado**
  > Baseline de uso dry-run coletada por ≥ 30 dias antes do wire-real. No dia do wire, dashboard já tem eixo de comparação.

- **Tactic alvo**: Condition Monitoring + Monitor
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-5
- **Métricas de sucesso**:
  - Métricas emitidas por chamada SN: 0 → ≥ 1
  - Cobertura de `outcome:'ok'|'error'`: 0/2 → 2/2
- **Risco de não fazer**: entrada no wire-real cega — sem baseline de "quantas SNs por dia é o normal". Falsos alarmes / picos passam despercebidos.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo do delta é intencionalmente estreito (dry-run + stub in-memory), então várias tactics ficam N/A ou dormant. Onde o efeito é dormant mas ativa junto do wire-real, marquei P2 com nota de escalada para P0 quando `enviarAoErp` for cabeado (F-availability-3, F-availability-4).
- Não emiti P0 nesta seção: nenhum caminho de escrita ao ERP é alcançável (`NotImplementedError` é uma forte tactic **Removal from Service**). O único achado com evidência para um P1 é F-availability-2 (silêncio do FE), que corrói o sinal de disponibilidade percebida mesmo no dry-run.
- Cross-QA para o consolidator: **F-availability-2** conversa com `qa-testability` (fallback silencioso complica teste E2E) e com `qa-security` (falha 403 do gate silenciosa no FE). **F-availability-3** conversa com `qa-fault-tolerance` (idempotency) e `qa-integrability` (ledger).
- Não foi possível medir MTTR real nem taxa de fallback em produção sem instrumentação de telemetria (Sentry/Vercel Analytics no FE, CloudWatch no BE — não há hoje). Ambos declarados como "não medíveis localmente" na §2.
