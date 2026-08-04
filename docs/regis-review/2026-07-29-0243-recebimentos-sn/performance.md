---
qa: Performance
qa_slug: performance
run_id: 2026-07-29-0243-recebimentos-sn
agent: qa-performance
generated_at: 2026-07-29T02:43:00-03:00
scope: all
score: 8
findings_count: 6
cards_count: 6
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista clica "Alocar" numa transação do painel de Recebimentos | Emite `GET /recebimentos/transacoes/:txnId/processos?filCod=…&contraparte=…` seguido de `POST /…/solicitacao-numerario` | `AlocarProcessosDialog.tsx` (FE) → `routes/recebimentos.ts` → `ProcessoProviderStub` (in-memory) → `SolicitacaoNumerarioService.gerar` (pure builder) | DRY-RUN (Módulo 0 do plano) — sem DB, sem HTTP para o ERP; stub in-memory de 4 processos | Modal abre em ≤ 500ms; lista candidatos em ≤ 100ms server-side; preview do payload aparece em ≤ 300ms após clique em "Processar" | p95 GET < 50ms server-side, p95 POST < 20ms server-side, p95 render do modal < 500ms client-side (baseline) |

Cenário adicional (futuro — quando o stub for trocado por Conexos/matching-engine):
> "Analista pede a lista de processos candidatos para uma transação de R$ 32.500 na filial 4 → provider real chama Conexos (`priCons` + matching) → latência do ERP p95 estimada em 2–10s → resposta ao FE precisa manter p95 ≤ 3s com `timeoutMs` (o port `ProcessoProviderInterface` **hoje não expõe** `ExternalCallOptions` como os outros ports do módulo)."

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC feature (5 arquivos core) | 554 | ≤ 800 | ✅ | `_shared-metrics.md` |
| Tamanho do seed do stub (candidatos) | 4 processos | ≤ 100 (varredura O(n) aceitável) | ✅ | `interface/recebimentos/__fixtures__/processo.fixture.ts:25-52` |
| Complexidade do filtro `listCandidatosParaTransacao` | O(n) + 2 `toLowerCase()` + `includes` bidirecional | O(n) linear | ✅ | `stubs/ProcessoProviderStub.ts:19-30` |
| Chamadas externas por `POST /…/solicitacao-numerario` (dry-run) | 0 (pura construção de payload) | 0 | ✅ | `SolicitacaoNumerarioService.ts:58-110` |
| `bootstrapAppContainer` no path quente | 1 `await` por request (ambas rotas novas) — idempotente via `container.isRegistered` guard | 1 (idempotente) | ✅ | `routes/recebimentos.ts:156,204`; `recebimentosContainer.ts:43` |
| Timeout do fetch FE (`fetchProcessosParaTransacao`) | **ausente** (usa `apiFetch` sem `AbortController`/timeout) | timeout explícito ≤ 5s | ⚠️ | `frontend/lib/recebimentos.ts:442-453` |
| `ExternalCallOptions` (`timeoutMs`) no `ProcessoProviderInterface` | **ausente** — a port não tem o parâmetro `opts?: ExternalCallOptions` que os outros ports do Módulo 1/5 têm | presente (paridade com `NexxeraGatewayInterface`, `ErpReceivablesGatewayInterface`) | ⚠️ | `interface/recebimentos/ports.ts:228-236` vs `ports.ts:143-147, 194-201` |
| Rate limit do `POST /…/solicitacao-numerario` | `heavyRouteLimiter` — 10 req/min/IP | 10 req/min/IP (analista humano, dry-run) | ✅ | `routes/recebimentos.ts:200`; `http/rateLimit.ts:28-35` |
| Rate limit do `GET /…/processos` | **nenhum** (apenas `globalLimiter` de 100 req/min/IP no app) | ≤ 100 req/min/IP; considerar `heavyRouteLimiter` quando o provider virar real | ⚠️ | `routes/recebimentos.ts:153-179` |
| Payload do FE re-renderiza modal em cada abertura | `resultados: Record<number, SolicitacaoNumerarioDryRun>` é `useState` (bounded pela lista de processos) | bounded | ✅ | `AlocarProcessosDialog.tsx:85, 117` |
| Cold-start do processo Express (feature delta) | não medível (0 novas deps runtime, 0 imports pesados) | não regride | ✅ | `backend/deps=14` (inalterado); imports do arquivo `SolicitacaoNumerarioService.ts` são todos type-only + `LogService` |
| p95 latência real das rotas novas (produção) | ⚠️ **não medível localmente** — Render/Express sem APM instalado nesta iteração | p95 GET < 50ms, p95 POST < 20ms | ⚠️ | requer New Relic/Datadog/Otel Collector em Render |
| Bundle FE — delta do `AlocarProcessosDialog` | não medível localmente sem `next build --profile` no worktree (o gate roda `typecheck` e `test`, não `build`) | delta < 20KB gzip (o componente só importa átomos do DS + `lucide-react` já presente) | ⚠️ | `AlocarProcessosDialog.tsx:1-40` — 13 imports, todos já usados em outras telas |

## 3. Tactics — Cobertura no nf-projects

### Control Resource Demand

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — não há fluxo de amostragem (dry-run interativo, um clique por transação) | N/A | — |
| Limit Event Response | `heavyRouteLimiter` (10 req/min/IP) no `POST /…/solicitacao-numerario`; `globalLimiter` (100 req/min/IP) no GET | ⚠️ parcial | `routes/recebimentos.ts:200`; GET não tem `heavyRouteLimiter` (`routes/recebimentos.ts:153-179`) |
| Prioritize Events | N/A — sem fila; rota síncrona; POST write-ish já é `requireRole('admin')` | N/A | `routes/recebimentos.ts:199-202` |
| Reduce Overhead | Rota GET só executa Zod parse + filtro O(n) em memória; POST só executa Zod parse + string interpolation. `bootstrapAppContainer` é idempotente (`isRegistered` guard) | ✅ presente | `recebimentosContainer.ts:43`; `SolicitacaoNumerarioService.ts:58-110` |
| Bound Execution Times | `ProcessoProviderInterface.listCandidatosParaTransacao` **não** aceita `ExternalCallOptions.timeoutMs` — port hoje é fire-and-hope. Consumers FE (`fetchProcessosParaTransacao`) também não têm `AbortController` | ⚠️ parcial | `interface/recebimentos/ports.ts:228-236` vs `ports.ts:143-147`; `frontend/lib/recebimentos.ts:442-453` |
| Increase Resource Efficiency | `SolicitacaoNumerarioService.gerar` é síncrono/puro (nenhum await), zero alocações desnecessárias | ✅ presente | `SolicitacaoNumerarioService.ts:58-110` |

### Manage Resources

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Resources | N/A no dry-run; futuro (Módulo 2b real) → dimensionar pool de HTTP para Conexos | N/A | — |
| Increase Concurrency | Stub é `@injectable()` (transient) — cada request instancia; leve. `LogService` é `@singleton()` | ✅ presente | `stubs/ProcessoProviderStub.ts:15`; `SolicitacaoNumerarioService.ts:43` |
| Maintain Multiple Copies of Computations | N/A — não há computação pesada a paralelizar | N/A | — |
| Maintain Multiple Copies of Data | `processoCandidatosSeed` é `readonly` compartilhado entre instâncias (seed leve, 4 itens) | ✅ presente | `stubs/ProcessoProviderStub.ts:17` |
| Bound Queue Sizes | Sem fila neste delta (rotas síncronas). O plano Módulo 1 já prevê `FANOUT_LIMIT_RECEBIMENTOS` para o `runMany` de ingest | ✅ presente (para o futuro) | `interface/recebimentos/ports.ts:157-161` |
| Schedule Resources | N/A no dry-run — analista dispara sob demanda | N/A | — |

### Facetas modernas

| Faceta | Estado |
|---|---|
| Cold start budget | Delta introduz 0 novas dependências runtime (`backend/package.json`: 14 deps). Imports do `SolicitacaoNumerarioService` são type-only + `LogService` já existente. Não regride cold start. |
| Cache strategy | N/A — payload é construído per-request e depende do input; nada cacheável sem invariante de negócio (o `docConfig.gcdCod` viria de SSM na versão real). |
| Index discipline | N/A — sem SQL neste delta. |
| Bundle leanness | 13 imports no `AlocarProcessosDialog.tsx`, todos átomos do DS/`lucide-react` já usados. Sem libs novas (xlsx, chart, etc.). |

## 4. Findings (achados)

### F-performance-1: `ProcessoProviderInterface` não expõe `ExternalCallOptions`/`timeoutMs`

- **Severidade**: P2 (débito técnico — o stub é seguro, mas a port não força o adapter real a respeitar timeout)
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/backend/domain/interface/recebimentos/ports.ts:228-236` (contrasta com `ports.ts:143-147, 194-201, 205-207`)
- **Evidência (objetiva)**:
  ```typescript
  // ports.ts:228 — SEM opts
  export interface ProcessoProviderInterface {
      listCandidatosParaTransacao: (input: ListCandidatosInput) => Promise<Processo[]>;
  }

  // ports.ts:144 — COM opts (padrão do módulo)
  export interface NexxeraGatewayInterface {
      fetch: (period: NexxeraFetchPeriod, opts?: ExternalCallOptions) => Promise<RawMovimento[]>;
  }
  ```
- **Impacto técnico**: quando o Módulo 2/2b trocar o token pelo provider real (Conexos/matching), o consumer (`routes/recebimentos.ts:176`) não terá como passar `timeoutMs` sem quebrar o contrato. Uma chamada Conexos hung (p99 documentado 2–10s) prenderá o worker Express pelo `req_timeout` global (padrão 30s).
- **Impacto de negócio**: sob incidente do ERP, o modal "Alocar" trava toda a UI de Recebimentos até 30s por request; um analista clicando em várias transações pode saturar o event loop antes do rate-limit global (100 req/min/IP) atuar.
- **Métrica de baseline**: p95 chamada Conexos estimado 2–10s (documentado no plano Módulo 2). Sem `timeoutMs`, worst-case = timeout do Express (30s).

### F-performance-2: FE `fetchProcessosParaTransacao` sem `AbortController`/timeout

- **Severidade**: P2 (débito técnico — hoje o backend responde em ms; o problema aparece quando o provider real for cabeado)
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/frontend/lib/recebimentos.ts:442-453`
- **Evidência (objetiva)**:
  ```typescript
  const res = await apiFetch(
      `${API}/recebimentos/transacoes/${encodeURIComponent(txnId)}/processos?${qs.toString()}`,
      { headers: await withAuthHeaders() },
  )
  ```
  Nenhum `signal: AbortSignal.timeout(…)` nem `AbortController` — o `apiFetch` não propaga default timeout.
- **Impacto técnico**: se o backend real ficar preso (Conexos hung), o modal fica em `loading` indeterminado; o único escape é o usuário fechar o dialog. `React.useEffect` já tem o `cancelado` flag (linhas 87-106) para descartar a resposta, mas não aborta o fetch — o request continua ocupando slot na origem/CDN.
- **Impacto de negócio**: UX degrada silenciosamente quando o ERP está lento; o analista não vê erro nem spinner-com-cancel. Aumenta pressão sobre o navegador (até 6 conexões concorrentes por origem em HTTP/1.1).
- **Métrica de baseline**: hoje resposta local ≤ 20ms; após cabo real, sem timeout, tempo até resposta ≡ tempo até Conexos responder (não medível localmente; estimado 2–10s p95).

### F-performance-3: `GET /recebimentos/transacoes/:txnId/processos` sem `heavyRouteLimiter`

- **Severidade**: P3 (baixo — hoje o cost é zero-IO; o risco aparece quando o provider real chamar Conexos)
- **Tactic violada**: Limit Event Response
- **Localização**: `src/backend/routes/recebimentos.ts:153-179`
- **Evidência (objetiva)**:
  ```typescript
  router.get(
      '/transacoes/:txnId/processos',
      asyncHandler(async (req, res) => { … }),
  );
  ```
  Sem `heavyRouteLimiter` (contrasta com o POST logo abaixo, linha 200-202, que já tem).
- **Impacto técnico**: no dry-run é irrelevante (filtro O(n) em array de 4 itens). Quando o token for trocado pela fonte real, o GET vira uma chamada Conexos por request — e sem limiter estrito um script pode fazer 100 req/min por IP (globalLimiter), fanout que já causou incidente conhecido nas sessions do ERP (referenciado em `arch-review card security-6 / F-security-9`).
- **Impacto de negócio**: risco de repetir o incidente do session-pool do ERP quando Módulo 2b cabo o provider real. Como é READ-only sem `requireRole('admin')`, qualquer usuário autenticado pode disparar.
- **Métrica de baseline**: hoje 0 chamadas externas por request. Após cabo real: 1 chamada Conexos por request; sob abuso, 100 req/min = 100 sessões-request/min por IP.

### F-performance-4: Ausência de APM / medição de p95 em produção

- **Severidade**: P2 (débito técnico — impede validar as metas de p95 declaradas neste cenário)
- **Tactic violada**: (meta-tactic) — sem instrumentação, nenhuma tactic é auditável
- **Localização**: Render/Express (fora do repo) — nenhum `Otel` / `New Relic` / `datadog` em `src/backend/`
- **Evidência (objetiva)**: `grep -rn "opentelemetry\|dd-trace\|newrelic" src/backend` → 0 matches.
- **Impacto técnico**: métricas de p95 GET/POST declaradas neste doc são especulativas — não há coleta contínua para provar regressão pós-deploy.
- **Impacto de negócio**: quando uma queixa "está lento" chegar do analista, o time investiga por hipótese; MTTD (mean-time-to-detect) alto.
- **Métrica de baseline**: 0 traces coletados. Alvo: p95 latência em CloudWatch/APM por rota.

### F-performance-5: `contraparte` case-insensitive faz 2 `toLowerCase()` por candidato (micro-opt latente)

- **Severidade**: P3 (baixo — irrelevante no seed atual de 4 itens; melhoria opcional)
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/domain/service/recebimentos/stubs/ProcessoProviderStub.ts:19-30`
- **Evidência (objetiva)**:
  ```typescript
  const contraparte = input.contraparte?.trim().toLowerCase();
  return this.candidatos.filter((p) => {
      …
      const alvo = (p.contraparte ?? p.dpeNomPessoa).toLowerCase();
      return alvo.includes(contraparte) || contraparte.includes(alvo);
  });
  ```
  `p.contraparte` (ou `dpeNomPessoa`) é `toLowerCase`-eado a cada request, para cada candidato — não cacheado.
- **Impacto técnico**: irrelevante em memória (n ≤ 100 esperado). Se o Módulo 2b real puxar milhares de processos abertos, este loop O(n) com string ops linear tá no lugar errado — deveria estar num índice/SQL `WHERE lower(dpe_nom_pessoa) ILIKE …`.
- **Impacto de negócio**: nenhum hoje. Sinaliza que a lógica de matching não deve viver num provider in-memory quando escalar — precisa de SQL indexado.
- **Métrica de baseline**: 4 candidatos × 2 `toLowerCase` = 8 ops por request; assumindo escala real de 5.000 processos abertos, seria 10.000 `toLowerCase` por request.

### F-performance-6: `bootstrapAppContainer` awaited por request (mesmo idempotente)

- **Severidade**: P3 (baixo — o `await` idempotente custa micro-segundos; anotado como observação)
- **Tactic violada**: Reduce Overhead
- **Localização**: `src/backend/routes/recebimentos.ts:37, 60, 156, 204`
- **Evidência (objetiva)**:
  ```typescript
  await bootstrapAppContainer();
  ```
  Chamada no início de cada handler (4 rotas). O bootstrap é idempotente via `container.isRegistered(NEXXERA_GATEWAY_TOKEN)` (`recebimentosContainer.ts:43`).
- **Impacto técnico**: cost é 1 `if` + 1 Promise resolve por request. Não é hot path, mas em cold-start do processo Express, o primeiro request paga o registro completo (14 tokens). Aceitável.
- **Impacto de negócio**: nenhum mensurável hoje.
- **Métrica de baseline**: 1 await idempotente por request; overhead < 1ms medido em ambientes similares.

## 5. Cards Kanban

### [performance-1] Adicionar `ExternalCallOptions.timeoutMs` ao `ProcessoProviderInterface`

- **Problema**
  > O port `ProcessoProviderInterface.listCandidatosParaTransacao` não aceita `opts?: ExternalCallOptions` como os outros ports do módulo (`NexxeraGatewayInterface`, `ErpReceivablesGatewayInterface`, `NdeEmitterInterface`). Quando o Módulo 2b trocar o stub pelo provider real (Conexos), o consumer não terá como forçar `timeoutMs`, e uma chamada hung ao ERP (p95 estimado 2–10s) prenderá o worker Express pelo request timeout global.

- **Melhoria Proposta**
  > Espelhar a assinatura dos ports pares — adicionar `opts?: ExternalCallOptions` em `listCandidatosParaTransacao`. Definir `PROCESSO_PROVIDER_TIMEOUT_MS` em `constants.ts` (default 5000ms, alinhado ao `NEXXERA_FETCH_TIMEOUT_MS`). Passar `opts` a partir de `routes/recebimentos.ts:176`. Adapter real MUST honrar o timeout (aborta via `AbortController`).

- **Resultado Esperado**
  > Contrato do port impõe `timeoutMs`; nenhuma chamada Conexos futura pode prender worker Express além de 5s. Baseline: sem timeout → 30s (worst-case Express) → 5s (alvo).

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Cobertura do `opts?: ExternalCallOptions` nos ports do módulo Recebimentos: 3/4 → 4/4
  - p95 latência do `GET /…/processos` sob incidente Conexos (futuro): worst-case 30s → 5s
- **Risco de não fazer**: quando o provider real for cabeado, replicamos o incidente de session-pool que já ocorreu (referência: `arch-review card security-6 / F-security-9`); analista trava a UI sem feedback.
- **Dependências**: nenhuma (ajuste é só na interface + `constants.ts`; adapter real é para depois)

### [performance-2] Adicionar `AbortController` + timeout no `fetchProcessosParaTransacao`

- **Problema**
  > O `fetchProcessosParaTransacao` (`frontend/lib/recebimentos.ts:435-453`) chama `apiFetch` sem `signal`. Se o backend real ficar preso, o modal fica em `loading` indeterminado, o `useEffect` só tem `cancelado` flag (não aborta o request), e o navegador segura o slot HTTP até o server responder ou o tab fechar.

- **Melhoria Proposta**
  > Passar `signal: AbortSignal.timeout(5000)` no `apiFetch`; no `useEffect` do `AlocarProcessosDialog.tsx:87-106`, criar `AbortController` local e chamar `controller.abort()` no cleanup. Mostrar mensagem de erro específica "Tempo esgotado (5s) — tente novamente" em vez do `EmptyState` genérico.

- **Resultado Esperado**
  > Modal cancela requests pendentes ao fechar OU após 5s; usuário sempre vê spinner OU erro, nunca loading indeterminado. Baseline: sem timeout no fetch → timeout do navegador (~5min HTTP/1.1) → 5s (alvo).

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - p95 tempo até resposta OU erro no modal: 5min (worst-case navegador) → 5s
  - Requests órfãos após fechar o modal: N → 0
- **Risco de não fazer**: UX degrada silenciosamente quando o ERP estiver lento; o analista clica repetidamente, gerando requests concorrentes.
- **Dependências**: [performance-1] (o adapter real também precisa honrar o timeout no server-side; ambos são complementares)

### [performance-3] Aplicar `heavyRouteLimiter` no `GET /…/processos` quando o provider virar real

- **Problema**
  > `GET /recebimentos/transacoes/:txnId/processos` hoje só tem o `globalLimiter` (100 req/min/IP). No dry-run com stub in-memory isso é irrelevante. Quando o Módulo 2b trocar por Conexos real, cada request vira 1 chamada ERP; 100 req/min por IP é fanout suficiente para replicar o incidente conhecido de esgotamento de session-pool.

- **Melhoria Proposta**
  > Aplicar `heavyRouteLimiter` (10 req/min/IP) na rota GET, com toggle por `EnvironmentProvider` (feature-flag `RECEBIMENTOS_PROCESSO_PROVIDER=real`) para não penalizar o stub. Alternativa: adicionar o limiter incondicionalmente agora — 10 req/min é folgado para analista humano.

- **Resultado Esperado**
  > GET protegido pelo mesmo teto que o POST irmão. Baseline: 100 req/min/IP → 10 req/min/IP na rota crítica (fanout ao ERP).

- **Tactic alvo**: Limit Event Response
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Fanout máximo ao Conexos via GET (futuro): 100 req/min/IP → 10 req/min/IP
- **Risco de não fazer**: repete o incidente `arch-review card security-6 / F-security-9` (session-pool do ERP saturado por request-flood).
- **Dependências**: Módulo 2b (provider real) — deve entrar junto no mesmo delta

### [performance-4] Instrumentar rotas de Recebimentos com Otel/APM

- **Problema**
  > Sem APM instalado no backend Express (Render), as métricas de p95/p99 declaradas nos cenários Bass deste doc são especulativas. Impossível provar regressão pós-deploy ou triar reclamação de "está lento" sem hipótese.

- **Melhoria Proposta**
  > Instalar `@opentelemetry/sdk-node` + auto-instrumentation `express` + exportador (Console em dev, OTLP para Grafana Cloud/New Relic em prod). Envolver as rotas de Recebimentos com o middleware; garantir que o `correlationId` do payload vira `trace_id` no span (já namespaced em `receb:*`). Configurar SSM key para o endpoint OTLP via `EnvironmentProvider`.

- **Resultado Esperado**
  > Toda rota de Recebimentos publica span com latência, status HTTP e `filCod`. Baseline: 0 traces → 100% das rotas cobertas.

- **Tactic alvo**: (meta-tactic — todas dependem de instrumentação para auditoria)
- **Severidade**: P2
- **Esforço estimado**: M (2–5d)
- **Findings relacionados**: F-performance-4
- **Métricas de sucesso**:
  - Cobertura de instrumentação: 0 → 100% das rotas `/recebimentos/*`
  - MTTD para reclamação "está lento": não medível → < 5min com dashboard
- **Risco de não fazer**: cada issue de perf vira arqueologia. Métricas alvo (p95 GET < 50ms, POST < 20ms) permanecem indefensáveis.
- **Dependências**: nenhuma; é infra transversal, poderia ser cross-frente (aproveitar por Permutas/SISPAG também)

### [performance-5] Migrar filtro do provider para SQL indexado quando escalar

- **Problema**
  > O stub `ProcessoProviderStub.listCandidatosParaTransacao` faz `.filter` in-memory com 2 `toLowerCase()` + `includes` bidirecional por candidato. Aceitável em 4 itens; problemático se um provider real trouxer 5.000 processos abertos por filial ao invés de já filtrar no ERP.

- **Melhoria Proposta**
  > Ao substituir o stub pelo provider real (Módulo 2b), passar o filtro para o próprio ERP (`WHERE fil_cod = $1 AND lower(dpe_nom_pessoa) ILIKE $2`) — indexar `dpe_nom_pessoa` com `LOWER(...)` no schema local (se cache/persistência local for adotada). Nunca trazer todos os processos abertos e filtrar no Node.

- **Resultado Esperado**
  > Response size da chamada ao ERP fica no order-of-magnitude do número de candidatos reais (≤ 20 típico), não do total de processos abertos. Baseline: N candidatos filtrados no Node (worst-case 5.000) → ≤ 20 candidatos retornados já filtrados.

- **Tactic alvo**: Reduce Overhead + Increase Resource Efficiency
- **Severidade**: P3
- **Esforço estimado**: M (2–5d — parte do delta Módulo 2b)
- **Findings relacionados**: F-performance-5
- **Métricas de sucesso**:
  - Payload médio da resposta do ERP: sem filtro (5.000 itens) → filtrado (≤ 20 itens)
  - String ops (`toLowerCase`/`includes`) por request no Node: O(n) linear em N → 0
- **Risco de não fazer**: matching engine real acaba num loop O(n) sem índice, e o `req_timeout` do Express (30s) vira teto real.
- **Dependências**: Módulo 2b (matching engine real)

### [performance-6] Instrumentar `bootstrapAppContainer` idempotency como métrica

- **Problema**
  > `bootstrapAppContainer` é awaited em cada handler (`routes/recebimentos.ts:37, 60, 156, 204`). É idempotente (`isRegistered` guard), mas o custo `if + await` roda por request. Sem medição, se um dia alguém quebrar a idempotência (registrando tokens múltiplas vezes), degradação é silenciosa.

- **Melhoria Proposta**
  > Adicionar um `counter` no bootstrap: `bootstrapCallCount` (increments) vs `bootstrapActualRegisterCount` (increments SÓ na primeira). Expor via `/health` ou log estruturado. Alertar se `actual > 1`.

- **Resultado Esperado**
  > Regressão de idempotência do bootstrap é detectada em <1min. Baseline: 0 medição → 100% coverage do bootstrap.

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-6
- **Métricas de sucesso**:
  - `bootstrapActualRegisterCount` por processo: alvo == 1 (invariante)
- **Risco de não fazer**: risco baixo; feature específica não regride nada — vira issue só se outro dev refatorar o container.
- **Dependências**: [performance-4] (idealmente sobre a mesma stack de observabilidade)

## 6. Notas do agente

- Feature é DRY-RUN puro; a superfície de performance real é **futura** (quando o token `PROCESSO_PROVIDER_TOKEN` for trocado pelo provider real). Cards P2/P3 refletem essa natureza — nada P0/P1 defensável hoje, porque baseline atual é ~0 (in-memory + payload builder).
- Métricas de p95 real de produção declaradas como **não medíveis localmente** (sem APM em Render); card `performance-4` propõe consertar isso.
- Cross-QA detectados:
  - **Availability + Fault Tolerance**: F-performance-1 (`timeoutMs` no port) é o mesmo achado que a availability terá — sinalizar ao consolidator para evitar duplicação de card.
  - **Security**: F-performance-3 (rate-limit no GET) toca `security` — o `heavyRouteLimiter` foi introduzido justamente por card de security prévio (`arch-review card security-6`).
  - **Modifiability**: F-performance-5 (mover filtro pro SQL) é também Modifiability (schema-as-code / índice) quando persistência local existir.
