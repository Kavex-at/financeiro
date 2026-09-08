---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-03-1901-tapar-furos-backend
agent: qa-fault-tolerance
generated_at: 2026-09-03T19:35:00-03:00
scope: backend
score: 8
findings_count: 4
cards_count: 3
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Orquestrador Render (deploy, restart, autoscale) | `SIGTERM` no processo Node enquanto uma requisição de escrita financeira (`POST /sispag/remessa/gerar`, `POST /sispag/conciliacao/processar`, `POST /permutas/{id}/executar`) está entre o `beginExecution` (write-ahead do ledger em `reconciling`) e o `settle`/`fail` correspondente | Processo Express do backend em `src/backend/index.ts`; ledgers `remessa_execucao` / `conciliacao_execucao` / `numerario_execucao` / `permuta_execucao` | Produção Render (Web Service Node 22), Supabase session-pool, ERP Conexos com `LOGIN_ERROR_MAX_SESSIONS ≈ 3` | Parar de aceitar conexões novas, drenar as em voo até o `settle`/`fail`, fechar o pool Postgres, sair antes do `SIGKILL` do orquestrador; se drenar exceder o teto, sair mesmo assim e deixar o reaper (a cada 15 min) mais o `StalenessDetector` (a cada hora) alertarem sobre a linha que ficou em `reconciling` | **Zero** execuções financeiras duplicadas (garantido pelo `ON CONFLICT (idempotency_key) DO UPDATE ... CASE WHEN status = 'settled' THEN preserve`); **zero** órfãos silenciosos — todo `reconciling` > 15 min emitido como `BUSINESS_WARN` estruturado e como alerta em `/operacao`; janela de interrupção residual (SIGKILL, crash, rede) coberta *a posteriori* pelo reaper, com MTTR ≤ 15 min para descoberta e ≤ 1 h para alerta |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Handler `SIGTERM`/`SIGINT` registrado no processo web | presente (5 arquivos do delta) | presente | ✅ | `src/backend/http/gracefulShutdown.ts:113-119`, `src/backend/index.ts:184-189` |
| Cobertura de teste do handler (linhas / stmts / branches) | 100% linhas · 93,61% stmts · 58,82% branches · 90% funcs | ≥ 88% stmts / ≥ 60% branches (threshold global do `jest.config.cjs`) | ⚠️ branches abaixo do global | `_shared-metrics.md` §"Gates executados" |
| Teto de drenagem (`DEFAULT_DRAIN_TIMEOUT_MS`) | 10 000 ms | ~25 000 ms (deixa 5 s de folga antes do SIGKILL do Render, ~30 s) | ⚠️ conservador | `gracefulShutdown.ts:26` |
| Ordem drain → closePool → exit validada por teste | sim (`order.push('server.close') / closePool / exit(0)`) | sim | ✅ | `gracefulShutdown.test.ts:41-58` |
| Idempotência da drenagem (segundo `SIGTERM` ignorado) | sim | sim | ✅ | `gracefulShutdown.ts:56-60`; `gracefulShutdown.test.ts:74-91` |
| Force-exit não bloqueia event loop (`unref` no timer) | sim | sim | ✅ | `gracefulShutdown.ts:82-84`; `gracefulShutdown.test.ts:151-165` |
| Force-exit sobrevive a `closePool()` que rejeita (sem zumbi) | sim | sim | ✅ | `gracefulShutdown.ts:91-95`; `gracefulShutdown.test.ts:103-116` |
| Sinal de force-exit auditável (LogService/alerta persistido) | ausente — só `console.log('[shutdown] drenagem excedeu…')` | evento estruturado que alimenta `/operacao` | ⚠️ | `gracefulShutdown.ts:73-75` |
| Handler alcança jobs cron do GitHub Actions | não alcança — jobs vivem em processo separado | não é o alvo do delta (jobs não fazem write financeiro; `StalenessDetector` já cobre `running` abandonado) | ✅ (fora de escopo consciente) | `.github/workflows/*.yml`; `StalenessDetector.ts:121-140` |
| Reaper pós-shutdown captura `reconciling` residual | presente, a cada 15 min | presente | ✅ | `.github/workflows/reaper-sispag.yml`; `jobs/reaper-sispag-reconciling.ts:57-58` |
| Idempotency-key honrado nas escritas SISPAG (segundo clique não duplica) | presente nas 3 rotas de escrita financeira | presente | ✅ | `routes/sispag.ts:338,422,479`; `routes/permutas.ts:195-202`; `routes/recebimentos.ts:714-731` |
| Pool devolve conexões ao Supabase no shutdown (`close()` idempotente) | presente | presente | ✅ | `PostgreeDatabaseClient.ts:98-116` |
| Frequência real de órfãos `reconciling` antes/depois do delta | ⚠️ **Não medível localmente** | queda mensurável na taxa | — | requer produção — `SELECT count(*) FROM remessa_execucao WHERE status='reconciling' AND atualizado_em < now()-interval '15 minutes'` cortado pela data de deploy do commit `e575221` |
| Handler `unhandledRejection` / `uncaughtException` no processo web | ausente | presente (o delta cobre desligamento **por sinal**, não crash não-tratado) | ⚠️ residual fora do delta | `grep -rn "unhandledRejection\|uncaughtException" src/backend` → 0 resultados fora de testes |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Substitution | N/A neste delta — a tactic tem foco em substituir componente defeituoso; aqui a substituição relevante já era feita pelo `pool.on('error')` corrigido em BE-05 (companion QA Availability). | N/A | — |
| Replacement | N/A — não há redundância ativa/ativa no runtime Express de instância única do Render. | N/A | `DEPLOY.md:22-35` (Web Service Render, single-instance por default) |
| Predictive Model | Ausente para pressão de descarga (não há métrica que preveja que uma requisição vai demorar mais do que os 10s de drain). Não é o alvo do delta. | ❌ | grep por métrica preditiva → 0 |
| Increase Competence Set | O `RemessaService.criarLote` grava marca d'água ANTES do POST ao ERP para reconhecer o lote nativo se o processo morrer entre a resposta do ERP e o `setNativeFlpCod` — competência ampliada de "só sei se recebi a resposta" para "sei que ele existe mesmo perdendo a resposta". Fora do delta, mas é o teto de degradação. | ✅ presente (fora do delta) | `service/sispag/RemessaService.ts:404-420` |
| Sanity Checking | Handler valida presença de `unref()` no timer, comparação `this.connectionPool === pool` no `error` do pool, comparação `if (shuttingDown) return` para evitar reentrância. | ✅ presente | `gracefulShutdown.ts:56,82-84`; `PostgreeDatabaseClient.ts:82-89` |
| Comparison | `pool === this.connectionPool` antes de zerar a referência — sanity comparation contra o segundo disparo do evento `error` reciclar o pool novo. Comportamento coberto pelo teste. | ✅ presente | `PostgreeDatabaseClient.ts:88`; teste em `PostgreeDatabaseClient.test.ts` |
| Timestamp | `remessa_execucao.atualizado_em` + `now() - $minutos::interval` é o predicado do reaper; toda transição de ledger carimba `atualizado_em = now()`. | ✅ presente | `RemessaExecucaoRepository.ts:121-131`; `ConciliacaoExecucaoRepository.ts:54-66` |
| Timeout | Handler tem teto duro de drenagem (10 s) para não virar processo zumbi que o orquestrador precise matar com SIGKILL. Clientes externos (`BcbClient` 10 s) já usam timeout. **Gap:** clientes Conexos não têm `timeout:` explícito no `axios.create` (fora do delta; cross-ref Availability). | ✅ presente no delta / ⚠️ residual fora do delta | `gracefulShutdown.ts:26,77-84`; `BcbClient.ts:57` |
| Condition Monitoring | `StalenessDetector` detecta run `RUNNING` abandonada por janela do pipeline; `SispagPainelService` expõe `listReconcilingParadas`. | ✅ presente (fora do delta) | `StalenessDetector.ts:121-140`; `SispagPainelService.ts:376-377` |
| Self-Test | Force-exit timer roda como self-test do próprio drenamento — se drenar não devolve o controle, o handler se auto-encerra. | ✅ presente | `gracefulShutdown.ts:77-84`; `gracefulShutdown.test.ts:93-112` |
| Voting | N/A — não há réplicas para votar. | N/A | — |
| Redundancy | `reaper-sispag` + `StalenessDetector` + `alerta-workflow-falhou` formam três canais redundantes de detecção do mesmo sintoma (órfão `reconciling`), cada um cobrindo uma falha do anterior. | ✅ presente (fora do delta) | `.github/workflows/reaper-sispag.yml`; `.github/workflows/detect-staleness.yml` |
| Recovery — Rollback | Explicitamente não usado no domínio: cancelar rascunho no Conexos é decisão humana ("automatizar isso trocaria um problema visível por um invisível" — `reaper-sispag-reconciling.ts:17-19`). Decisão consciente. | ✅ política declarada | `jobs/reaper-sispag-reconciling.ts:11-22` |
| Recovery — Reintroduction (Shadow, State Resync, Escalating Restart) | Reintrodução via `retomarDe`/`flpCodRetomado` — uma nova tentativa da mesma remessa reaproveita o lote nativo criado antes da interrupção. State resync no reaper. | ✅ presente (fora do delta) | `RemessaService.ts:400-415` |
| Recovery — Rollback (state) | `beginExecution` PRESERVA `settled` no `ON CONFLICT DO UPDATE`; retomada nunca regride status. | ✅ presente (fora do delta) | `RemessaExecucaoRepository.ts:83-105` |
| Repair State | Reaper não repara, só WARN — decisão de política (`process.exit(0)` no reaper após achar órfãos). Reparo é humano. | ✅ (política) | `jobs/reaper-sispag-reconciling.ts:105-115` |
| Idempotent Replay | Toda escrita SISPAG/Permuta/Recebimento vai por `idempotency_key` — replay não duplica. | ✅ presente (fora do delta) | `RemessaExecucaoRepository.ts:78-105`; `ConciliacaoExecucaoRepository.ts:73-115` |
| Compensating Transaction | Não implementado — o Conexos não expõe undo limpo de escritas de fin015/fin010, e a política é forward-recovery (analista + reaper). | ✅ (política; documentada in-line) | `jobs/reaper-sispag-reconciling.ts:15-19` |
| Reconcile | `listReconcilingParadas` é a reconciliação Postgres × ERP para o subset de execuções abertas. Reconciliação completa (todo `fin010` do dia × ledger) inexiste — não é o alvo do delta. | ⚠️ parcial (fora do delta) | `RemessaExecucaoRepository.ts:121-131` |
| Quarantine | Ledger em `error` isola a execução — não bloqueia, mas fica visível em `listByStatus('error', ...)`. | ✅ presente (fora do delta) | `RemessaExecucaoRepository.ts:57-66` |

## 4. Findings (achados)

### F-fault-tolerance-1: teto de drenagem de 10 s é conservador para o envelope de 30 s do Render

- **Severidade**: P2
- **Tactic violada**: Timeout (dimensionamento sub-ótimo)
- **Localização**: `src/backend/http/gracefulShutdown.ts:22-26`
- **Evidência (objetiva)**:
  ```typescript
  /**
   * Teto da drenagem. 10s cabe folgado nos ~30s que o Render espera entre o
   * SIGTERM e o SIGKILL — se estourar, saímos por conta própria em vez de ser
   * mortos no meio.
   */
  export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;
  ```
  Escritas financeiras encadeiam N chamadas ao Conexos sem `timeout:` explícito no `axios.create` (ver `ConexosSispagWriteClient.ts:122` e outros), e nas trilhas reais o `criar lote → importar → gerar` pode ultrapassar 10 s quando o ERP está sob carga (o Conexos limita ~3 sessões simultâneas e faz fila).
- **Impacto técnico**: uma escrita financeira em voo que dure entre 10 s e ~28 s (janela plausível para o `POST /sispag/remessa/gerar` em horário de contenção) é força-cortada pelo próprio handler, reproduzindo exatamente o órfão `reconciling` que o delta existe para eliminar — só que com log de "drenagem excedeu" em vez de morte silenciosa. Ganho de robustez residual real fica em cerca de 1/3 do envelope disponível (10 s de 30 s), não em ~28 s.
- **Impacto de negócio**: durante um deploy no meio do expediente, uma requisição que estava perto de fechar o `settle` no Conexos vira lote órfão no `fin015` — o mesmo problema que existia antes, com frequência reduzida mas não eliminada. Precisa da varredura do reaper para virar alerta.
- **Métrica de baseline**: teto de 10 s vs. envelope Render de ~30 s = 33% do orçamento usado. Ainda, cobertura de branches do handler em 58,82% — abaixo do threshold global do `jest.config.cjs` (60%).

### F-fault-tolerance-2: force-exit por timeout é invisível ao painel — alerta preso em `console.log`

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring (o sinal existe mas não escala)
- **Localização**: `src/backend/http/gracefulShutdown.ts:66-75`
- **Evidência (objetiva)**:
  ```typescript
  forceExitTimer = setTimeout(() => {
      exitOnce(`drenagem excedeu ${drainTimeoutMs}ms — saindo com requisições ainda em voo`);
  }, drainTimeoutMs);
  ```
  E na `exitOnce`:
  ```typescript
  log(`[shutdown] ${reason}`);
  deps.onExit(0);
  ```
  O `log` default é `console.log` — não passa por `LogService`, não vira alerta, não conta métrica, e o exit **0** faz o observador externo tratar a saída como normal.
- **Impacto técnico**: uma rota patológica que **sempre** ultrapassa o drain (por regressão de performance, deadlock em um cliente Conexos, retry sem `shouldRetry`) faria toda restart truncar requisições em voo, e o único vestígio ficaria em log de stdout do Render — não no painel `/operacao`, não no `job_execucao`, não em `alerta`. O ADR-0042 dedicou um workflow inteiro (`detect-staleness`) a NÃO deixar falhas invisíveis; a saída forçada do shutdown volta a criar exatamente essa categoria.
- **Impacto de negócio**: um deploy que degrada a rota `POST /sispag/remessa/gerar` a >10 s consistentes gera órfãos toda vez que o Render restart acontecer (autoscale, deploy, health-check). O time só descobriria pela subida de linhas em `reconciling` — canal existente, mas indireto e com atraso de 15 min–1 h.
- **Métrica de baseline**: 0 canais estruturados para o evento "force-exit por drain timeout" hoje. Alvo: 1 (LogService.warn com `OPERATIONAL_WARN`, colhido por `StalenessDetector`/`alerta`).

### F-fault-tolerance-3: janelas residuais de órfão não enumeradas no runbook

- **Severidade**: P3
- **Tactic violada**: Recovery — Reintroduction (documentação da política)
- **Localização**: `src/backend/http/gracefulShutdown.ts:1-15` (docstring) + ausência de runbook em `docs/runbooks/`
- **Evidência (objetiva)**: o comentário do arquivo diz "remove a causa mais frequente", mas não enumera as janelas que sobram:
  1. `SIGKILL` sem `SIGTERM` prévio (OOM killer, orquestrador que pula o `SIGTERM` por falha de health).
  2. Crash não-tratado — não há `process.on('unhandledRejection')` nem `uncaughtException` no delta ou fora dele (`grep` confirma 0 handlers).
  3. Requisição que dura > 10 s (F-fault-tolerance-1).
  4. Queda de rede no meio do `axios` para o Conexos (a request sai, o processo continua vivo, a resposta nunca chega — sem timeout no axios, o `beginExecution` fica em `reconciling` até o timeout do socket).
  5. Runner do GitHub Actions morto no meio de um job (não é este delta — coberto pelo `StalenessDetector` via `RUNNING` abandonado).
- **Impacto técnico**: sem enumeração, o próximo revisor pode assumir cobertura completa e desligar defesas *a jusante* (o reaper, a redundância de canais).
- **Impacto de negócio**: risco de complacência. As defesas residuais existem e funcionam; o problema é doutrinário.
- **Métrica de baseline**: 0 runbooks em `docs/runbooks/` (o diretório não existe); 1 linha de comentário no arquivo do handler descreve a mecânica ("remove a causa mais frequente"), sem enumerar o complemento.

### F-fault-tolerance-4: sem `process.on('unhandledRejection'/'uncaughtException')` no processo web

- **Severidade**: P3
- **Tactic violada**: Sanity Checking (última rede de segurança do runtime)
- **Localização**: `src/backend/index.ts` (fora do delta, mas contexto do delta)
- **Evidência (objetiva)**:
  ```bash
  grep -rn "unhandledRejection\|uncaughtException" src/backend --include="*.ts" | grep -v test
  # (sem resultados)
  ```
- **Impacto técnico**: um `throw` fora de `try/catch` em código async não interceptado por `errorMiddleware` derruba o processo por comportamento default do Node — sem passar pelo handler de `SIGTERM`, sem drenar, sem fechar o pool. A causa que o delta remove (`SIGTERM` sem handler) reaparece por outro caminho.
- **Impacto de negócio**: cauda longa da mesma classe de bug — órfão `reconciling` em crash não-tratado. O reaper cobre; a probabilidade é baixa (o `errorMiddleware` capta a maior parte); mas é a extensão natural do BE-06.
- **Métrica de baseline**: 0 handlers no delta. Alvo: 2 (`unhandledRejection`, `uncaughtException`) invocando o mesmo `createShutdownHandler` — o handler já é reutilizável (deps injetadas).

## 5. Cards Kanban

### [fault-tolerance-1] Elevar o teto de drenagem para ~25 s e amarrar aos timeouts dos clientes

- **Problema**
  > O teto de drenagem de 10 s consome só 1/3 do envelope de 30 s que o Render dá entre `SIGTERM` e `SIGKILL`. Uma requisição de `POST /sispag/remessa/gerar` que dure entre 10 s e ~28 s (envelope plausível quando o Conexos está fazendo fila nos ~3 slots de sessão) é força-cortada pelo próprio handler, virando o mesmo órfão `reconciling` que o BE-06 existe para eliminar — apenas com log de "drenagem excedeu" em vez de morte silenciosa.

- **Melhoria Proposta**
  > Subir `DEFAULT_DRAIN_TIMEOUT_MS` para 25 000 ms (deixa 5 s de folga para o `pool.end()` e a saída limpa antes do `SIGKILL`). Em paralelo, adicionar `timeout: 20_000` ao `axios.create` de `ConexosSispagWriteClient`, `ConexosBaixaClient`, `ConexosFin014Client` e `ConexosSispagClient` — sem isso, um socket pendurado em Conexos pode ultrapassar até o novo teto e ainda reproduzir o órfão. Manter os dois números coerentes (`drainTimeoutMs = maior_axios_timeout + 5_000`).

- **Resultado Esperado**
  > Percentual do envelope Render aproveitado: **33% → 83%**. Janela de requisições financeiras que o drain força-corta cai para o subconjunto que exceder 25 s (raro em operação normal, e nesse ponto o Conexos já teria estourado o próprio timeout do axios).

- **Tactic alvo**: Timeout
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - `DEFAULT_DRAIN_TIMEOUT_MS`: 10 000 → 25 000
  - Clientes Conexos com `timeout:` explícito: 0/4 → 4/4 (cross-ref Availability)
  - Envelope Render usado: 33% → 83%
- **Risco de não fazer**: em janelas de deploy no meio do expediente, requisições de escrita financeira próximas ao `settle` continuam sendo cortadas — o BE-06 cobre a maioria dos casos, mas deixa o long-tail para o reaper resolver. Custo: 1 lote órfão no `fin015` por deploy sob carga (frequência estimada, requer produção para confirmar).
- **Dependências**: nenhuma; o handler já aceita `drainTimeoutMs` por parâmetro.

### [fault-tolerance-2] Emitir alerta estruturado quando a drenagem estourar o teto

- **Problema**
  > A saída forçada do handler ("drenagem excedeu 10000ms") só imprime em `console.log` e sai com código 0. Uma rota que **sempre** ultrapassa o drain (regressão de performance, deadlock em cliente Conexos) faria toda restart truncar requisições em voo com zero visibilidade no painel `/operacao`, no `job_execucao` ou na tabela `alerta`. O ADR-0042 gastou um workflow inteiro para não deixar falhas invisíveis; esta é uma reintrodução da mesma categoria dentro do delta que devia melhorá-la.

- **Melhoria Proposta**
  > Antes do `deps.onExit(0)` no caminho de force-exit, resolver o `LogService` do container (o handler já roda com `reflect-metadata` importado no boot) e emitir `logService.warn({ type: LOG_TYPE.OPERATIONAL_WARN, message: 'shutdown force-exit — drenagem excedeu teto', data: { drainTimeoutMs, reason } })`. Alternativa mais leve (mantém a injeção pura): expor um callback `onForceExit?: (reason: string) => Promise<void>` na `GracefulShutdownDeps` e amarrar no `index.ts`. Deixar o código de saída em 0 (justificativa do delta segue válida — não é falha, é orçamento estourado); o sinal vai pelo canal certo.

- **Resultado Esperado**
  > Todo force-exit por drain aparece no painel de operação como `OPERATIONAL_WARN`, participa da dedupe por janela do `AlertaService` e produz uma linha rastreável em `log`. Detecção de regressão de performance de escrita financeira passa de "ninguém percebe" para "aparece no primeiro deploy pós-regressão".

- **Tactic alvo**: Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Canais estruturados para "force-exit por drain": 0 → 1
  - Latência entre force-exit e alerta visível em `/operacao`: indeterminada (só log stdout) → ≤ próximo `refresh` do painel
- **Risco de não fazer**: regressão de performance de escrita financeira só é detectada por subida indireta de linhas em `reconciling`, com atraso de 15 min a 1 h. Custo em um deploy patológico: N órfãos por instância x deploys.
- **Dependências**: nenhuma; `LogService` é `@singleton()` e já é resolvível no boot.

### [fault-tolerance-3] Instalar `unhandledRejection` / `uncaughtException` como último handler

- **Problema**
  > O delta remove a causa "SIGTERM sem handler", mas um `throw` async não interceptado por `errorMiddleware` derruba o processo por comportamento default do Node — pulando o drenar, o pool.end() e a saída limpa. A causa reaparece por outro caminho, com a mesma consequência de órfão `reconciling`. `grep -rn "unhandledRejection\|uncaughtException" src/backend` devolve zero handlers.

- **Melhoria Proposta**
  > No `index.ts`, logo depois do `registerGracefulShutdown`, registrar `process.on('unhandledRejection', ...)` e `process.on('uncaughtException', ...)` que invoquem o mesmo handler retornado pelo `createShutdownHandler` (que já é idempotente e aceita "qualquer sinal" como string). O `createShutdownHandler` já é 100% testável por injeção — não precisa refatorar, só o call-site. Divergência com o caminho `SIGTERM`: aqui o `exitCode` deve ser 1 (o processo está descendo por defeito, não por ordem do orquestrador).

- **Resultado Esperado**
  > Crash não-tratado deixa de virar corte cru. O rescue vira: drenar tenta acabar as requisições em voo, `pool.end()` roda, e o processo sai com 1 — o Render marca o deploy como falho (se aconteceu no boot) ou reinicia (se aconteceu em runtime). Sem regredir o exit-0 do caminho `SIGTERM` (o `onExit` continua vindo do call-site, que decide o código).

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-fault-tolerance-3, F-fault-tolerance-4
- **Métricas de sucesso**:
  - Handlers de crash não-tratado: 0 → 2
  - Cobertura da tactic "Sanity Checking (runtime)": parcial → completa
- **Risco de não fazer**: cauda longa da mesma classe de bug do BE-06 permanece. Probabilidade baixa (o `errorMiddleware` capta a maior parte), impacto por evento igual (órfão `reconciling`). O reaper cobre; este card fecha o círculo.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Confirmado empiricamente: os **jobs** de `src/backend/jobs/` que rodam via GH Actions **não** passam pelo `gracefulShutdown` — e não precisam. Nenhum job de cron faz write financeiro no Conexos (`ingest-*`, `formar-lotes`, `reaper-sispag`, `detect-staleness`, `reconciliar-nde-sefaz` são leitura no ERP ou write só no Postgres próprio). O corte de um runner por `timeout-minutes`/`SIGKILL` deixa a linha `job_execucao` em `RUNNING`, e o `StalenessDetector` cobre isso via `alertaDaUltimaRun` (`StalenessDetector.ts:121-140`). Portanto: **não é lacuna do delta** e **não é finding**; escopo consciente.
- Sobre o `exit(0)` no force-exit: a escolha é defensível (o processo está descendo por ordem do orquestrador, não por falha; um `exit(1)` marcaria o deploy como quebrado no Render). O problema real não é o código de saída — é a ausência de sinal estruturado para o painel `/operacao`. Card `fault-tolerance-2` mantém o exit 0 e resolve pelo canal certo.
- **Não medível localmente**: o valor produção de `SELECT count(*) FROM remessa_execucao WHERE status='reconciling' AND atualizado_em < now()-interval '15 minutes'` antes vs. depois do commit `e575221`. Sem isso, o efeito real do delta em redução de órfão não é quantificável — só o modelo teórico do envelope Render.
- Cross-QA: **Availability** deve receber F-fault-tolerance-1 (timeouts dos clientes Conexos são pré-condição); **Testability** deve notar que a cobertura de branches do handler está em 58,82% (abaixo do global 60%) — a rama descoberta é o `if (typeof timerHandle.unref === 'function')` em ambientes sem `unref` (Node ≥ 16 sempre tem, então é morta na prática); **Security/auditability** deve notar que a persistência da trilha de shutdown (F-fault-tolerance-2) casa com o requisito de auditoria de mudança de estado do processo.
