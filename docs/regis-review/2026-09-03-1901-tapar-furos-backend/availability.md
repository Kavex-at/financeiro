---
qa: Availability
qa_slug: availability
run_id: 2026-09-03-1901-tapar-furos-backend
agent: qa-availability
generated_at: 2026-09-03T19:01:00-03:00
scope: backend
score: 8
findings_count: 3
cards_count: 3
---

# Availability — Regis-Review

> Gate pós-implementação do tweak `fix/tapar-furos-backend`. Escopo restrito ao delta de 5 arquivos
> (`PostgreeDatabaseClient.ts` handler de `error` + `close()`, novo `http/gracefulShutdown.ts`,
> ligação em `index.ts`). O delta corrige um **P0 de fault masking** (pool leak) e um **P1 de
> reintroduction** (SIGTERM sem drain deixando runs órfãs em `reconciling`). Achados abaixo se
> concentram no que o delta cobre e no que ficou de fora dele.

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Orquestrador do Render (deploy) | Envio de `SIGTERM` durante requisição SISPAG em voo entre `createRun` e `finishRun` | Processo Node (Express) + pool Supabase | Produção, single-instance Render Starter, janela de ~30s até `SIGKILL` (declarado em `http/gracefulShutdown.ts:22-25` — não medido em produção neste run) | Handler `SIGTERM/SIGINT` para de aceitar conexões novas, drena as em voo, encerra o pool e sai com `0`; se drenagem estourar 10s, força saída (também `0`) para não virar zumbi | 0 execuções órfãs em `reconciling` originadas por deploy; 0 sessões Supabase penduradas após o `exit`; drain ≤ 10s ou force-exit em 10s — **`reaper-sispag.yml` (a cada 15 min) continua sendo a rede final** |

Cenário complementar coberto pelo delta (BE-05):

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Postgres/Supavisor | Erro transitório no pool (`too many clients`, `MaxClientsInSessionMode`, `ECONNRESET`) | `PostgreeDatabaseClient.connectionPool` | Produção (pool `max=5`) | Handler `pool.on('error')` chama `pool.end()` **antes** de zerar a referência; próxima `query` reinicializa via `init()` | 0 sessões Supabase seguradas por pool descartado; `too many clients` deixa de auto-alimentar (o gatilho do handler estava entre os erros retriáveis) |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura `http/gracefulShutdown.ts` (stmts / branches / funcs / lines) | 93,61% / 58,82% / 90% / 100% | ≥85 stmts / ≥60 branches | ✅ (branches 1,18pp abaixo, tolerável) | `_shared-metrics.md` §Gates |
| Testes da nova unidade | 8 casos, 0 falhas | ≥6 (idempotência, timeout, erro no pool, ordem, signals, registro) | ✅ | `src/backend/http/gracefulShutdown.test.ts` |
| Idempotência do handler de shutdown | Presente (`shuttingDown` guard, `src/backend/http/gracefulShutdown.ts:52,57-61`) — coberta por teste | Presente | ✅ | `gracefulShutdown.test.ts:74-90` ("ignores a second signal") |
| Force-exit timer configurado | 10.000 ms, `unref()` aplicado (`gracefulShutdown.ts:26,79-85`) | Menor que a janela SIGTERM→SIGKILL do Render | ✅ (defensável pela margem — ver ⚠️ abaixo) | `gracefulShutdown.ts:22-26` |
| Tratamento de rejeição do `closePool` | `try/catch` que loga e ainda sai com `0` (`gracefulShutdown.ts:88-99`) | Nunca virar zumbi | ✅ | `gracefulShutdown.test.ts:104-115` |
| Pool `end()` no handler `error` | Presente com dedupe por `ended`/comparação `this.connectionPool === pool` (`PostgreeDatabaseClient.ts:78-97`) | Toda referência descartada devolve conexões | ✅ | `PostgreeDatabaseClient.ts:74-97` |
| `close()` público idempotente | Zera antes do `await`, catch silencioso (`PostgreeDatabaseClient.ts:104-118`) | Chamadas concorrentes não geram duplo `end()` | ✅ | `PostgreeDatabaseClient.ts:110-117` |
| Coordenação com load balancer (readiness) | Ausente — `/health` (`src/backend/index.ts:79`) e `/health/pipelines` (`routes/health.ts:31-59`) **não** viram 503 durante drain | 503 assim que `SIGTERM` chega, para o LB tirar do pool antes do `server.close` | ❌ | Grep `shuttingDown` só aparece em `gracefulShutdown.ts:52,57-61` |
| Fechamento ativo de keep-alive | Ausente — `server.close` aguarda conexões keep-alive fecharem sozinhas; sem `server.closeIdleConnections()` / `closeAllConnections()` (Node ≥18.2) | Usado no drain para não depender de timeout do cliente | ❌ | Grep `closeIdleConnections\|closeAllConnections` em `src/backend`: 0 ocorrências |
| Gates verdes com `node_modules` ausente | Antes: exit 0 silencioso; depois: exit 127 (BE-09) | Falha barulhenta | ✅ | `_shared-metrics.md` §"Validação empírica do BE-09" |
| Duração real do drain em produção | ⚠️ **Não medível localmente**: exige coleta em produção. Recomendação: métrica `[shutdown] ${signal} recebido` → `[shutdown] requisições em voo concluídas` no Logtail do Render, agregada por deploy | — | ⚠️ | logs do próprio `gracefulShutdown.ts:61,74-76,97` |
| Janela `SIGTERM → SIGKILL` do Render | ⚠️ **Não medível localmente** — o número "≈30s" no comentário do código não foi confirmado neste run. Recomendação: consultar `render.com/docs` de graceful shutdown antes da próxima revisão | ≥15s (o dobro do force-exit) | ⚠️ | `src/backend/http/gracefulShutdown.ts:22-25` |
| Contagem histórica de runs órfãs em `reconciling` originadas por deploy | ⚠️ **Não medível localmente**: exige query em `job_run` cruzada com timestamps de deploy do Render. Recomendação: instrumentar `sinal_recebido` em `job_run` (ou uma tabela `shutdown_event`) para atribuição direta | — | ⚠️ | tabela `job_run` (`src/backend/domain/interface/operacao/JobRun.ts`) |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | `/health` (versão) + `/health/pipelines` (503 se pipeline parado ou run abandonada) | ✅ presente | `src/backend/index.ts:79`, `src/backend/routes/health.ts:24-59` |
| Heartbeat | N/A — single-instance no Render Starter; não há peers para trocar heartbeat | N/A | — |
| Monitor | Logs prefixados `[shutdown]` (`gracefulShutdown.ts:61,74-76,90-93,97`) + `console.log` do request logger (`index.ts:52-71`); sem métrica agregada de duração/contagem | ⚠️ parcial | `gracefulShutdown.ts:61-97` |
| Timestamp | N/A no delta — ordem de eventos garantida pelo próprio fluxo `close → drain → exit`, testada explicitamente | N/A | `gracefulShutdown.test.ts:41-57` |
| Sanity Checking | Guard `shuttingDown` (idempotência do handler) e guard `ended`/`this.connectionPool === pool` no `pool.on('error')` (evita zerar pool novo criado por `init()` no meio) | ✅ presente | `gracefulShutdown.ts:52,57-61`; `PostgreeDatabaseClient.ts:74-91` |
| Condition Monitoring | N/A — sem monitor interno de saturação de conexões ou drift no delta | N/A | — |
| Voting | N/A — sem redundância ativa | N/A | — |
| Exception Detection | `catch` explícito em `drain` que loga `[shutdown] falha ao encerrar o pool: ...`; `pool.on('error')` no cliente | ✅ presente | `gracefulShutdown.ts:88-95`; `PostgreeDatabaseClient.ts:74-91` |
| Self-Test | N/A no delta | N/A | — |
| Active Redundancy | N/A — Render Starter, single-instance por definição de plano | N/A | `render.yaml:6-7` (`plan: starter`) |
| Passive Redundancy | N/A — mesma razão | N/A | — |
| Spare | N/A | N/A | — |
| Exception Handling | `try/catch` no `closePool` (drain segue mesmo com pool quebrado); `void pool.end().catch(() => {})` no handler `error` (evita unhandled rejection); catch silencioso no `close()` público | ✅ presente | `gracefulShutdown.ts:88-95`; `PostgreeDatabaseClient.ts:85-89,113-117` |
| Rollback | N/A no delta — o Render mantém a revisão anterior se o boot falhar (`index.ts:172-177` faz `process.exit(1)`), mas isto já existia | N/A | — |
| Software Upgrade | O graceful shutdown é o **habilitador** de upgrade sem cortar requisições em voo — objetivo primário do delta (BE-06) | ✅ presente | `gracefulShutdown.ts:1-15` (docstring) |
| Retry | `RetryExecutor` no `init` (5×2s) e nas queries (3×200ms com jitter, filtro `transientErrorPatterns`) — pré-existente, delta mantém intacto | ✅ presente (pré-delta) | `PostgreeDatabaseClient.ts:38-46,52-60` |
| Ignore Faulty Behavior | N/A no delta | N/A | — |
| Degradation | Pré-existente: `/health/pipelines` devolve 503 em degradação; `SISPAG_LIVE_WRITE_ENABLED`/`RECEBIMENTOS_ENABLED` são kill-switches — delta não muda | N/A (fora do delta) | `routes/health.ts:45-53`; `render.yaml:29-45` |
| Reconfiguration | N/A no delta | N/A | — |
| Shadow | N/A | N/A | — |
| State Resynchronization | `reaper-sispag.yml` já era a rede final que varria `reconciling`. O delta **reduz** a frequência com que essa rede tem trabalho, mas não implementa resync novo | ⚠️ parcial (pré-delta) | `.github/workflows/reaper-sispag.yml` (citado em `gracefulShutdown.ts:5-9`) |
| Escalating Restart | Force-exit em 10s (`onExit(0)`) evita que o orquestrador tenha de escalar para `SIGKILL` — é a forma inversa da tactic (desescala em vez de escalar) | ✅ presente | `gracefulShutdown.ts:79-85` |
| Non-Stop Forwarding | N/A — single-instance | N/A | — |
| Removal from Service | O drain É a Removal from Service: para de aceitar conexão nova via `server.close`, libera pool, sai. Falta o passo **anterior** de sinalizar readiness=false para o LB (ver F-availability-1) | ⚠️ parcial | `gracefulShutdown.ts:53-101` |
| Transactions | `withTransaction` com BEGIN/COMMIT/ROLLBACK em cliente dedicado (pré-existente); delta não toca | ✅ presente (pré-delta) | `PostgreeDatabaseClient.ts:137-165` |
| Predictive Model | N/A | N/A | — |
| Exception Prevention | O delta É prevenção: `pool.end()` antes de nullar a referência **previne** o loop `error → GC-only → too many clients → error` que se auto-alimentava (o gatilho do handler estava entre os erros retriáveis) | ✅ presente | `PostgreeDatabaseClient.ts:74-91` (comentário explícito) |
| Increase Competence Set | N/A | N/A | — |

## 4. Findings (achados)

### F-availability-1: `/health` continua respondendo 200 durante o drain — LB não tem sinal de readiness

- **Severidade**: P2
- **Tactic violada**: Removal from Service (incompleta — a parte de coordenar o LB antes de fechar o socket)
- **Localização**: `src/backend/http/gracefulShutdown.ts:52-101`; `src/backend/index.ts:79`; `src/backend/routes/health.ts:31-59`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "shuttingDown\|isDraining\|readiness" src/backend --include="*.ts"
  src/backend/http/gracefulShutdown.ts:52:    let shuttingDown = false;
  src/backend/http/gracefulShutdown.ts:57:        if (shuttingDown) {
  src/backend/http/gracefulShutdown.ts:61:        shuttingDown = true;
  # /health e /health/pipelines não consultam este estado
  ```
  A flag `shuttingDown` está escopada dentro do closure de `createShutdownHandler` — nenhum
  endpoint HTTP tem como lê-la. `/health` retorna `{status:'ok'}` incondicionalmente
  (`index.ts:79`); `/health/pipelines` só considera `parados`/`abandonadas`, não o próprio
  processo em drain (`routes/health.ts:41-53`).
- **Impacto técnico**: entre o SIGTERM chegar e o `server.close` fechar o socket, o LB pode
  continuar mandando novas requisições por conexões keep-alive já abertas — cada uma delas
  entra no funil dos 10s de drain e potencialmente é abortada pela saída forçada.
- **Impacto de negócio**: requisições que iniciam durante o drain ainda podem cair na janela
  crítica `createRun → finishRun` de SISPAG e criar exatamente a execução órfã em
  `reconciling` que o delta busca eliminar. Mitigado pelo `reaper-sispag` a cada 15 min, mas
  é justamente o custo que o BE-06 se propôs a apagar.
- **Métrica de baseline**: 0 endpoints expõem o estado de drain (medido acima). Impacto
  quantitativo em produção **não medível localmente** — exige log-trace de deploys reais
  cruzando `SIGTERM recebido` com requisições HTTP nos 10s seguintes. Ausência de baseline
  numérico é o que rebaixa este finding de P1 para P2.

### F-availability-2: `server.close` não força fechamento de conexões keep-alive ociosas

- **Severidade**: P2
- **Tactic violada**: Removal from Service (drain pode ficar preso em keep-alive silencioso)
- **Localização**: `src/backend/http/gracefulShutdown.ts:98-101`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "closeIdleConnections\|closeAllConnections" src/backend --include="*.ts"
  # 0 ocorrências
  ```
  Node ≥18.2 expõe `server.closeIdleConnections()` (fecha imediatamente as keep-alive
  ociosas) e `server.closeAllConnections()` (força o corte). O handler atual chama apenas
  `server.close(callback)`, que aguarda cada keep-alive fechar por conta própria — o
  callback só dispara quando **todas** as conexões, ociosas ou não, terminaram.
- **Impacto técnico**: uma conexão keep-alive do LB sem requisição em voo mas ainda aberta
  segura o callback de `server.close` até o próprio Node ou o LB deixar a conexão expirar,
  fazendo o drain sempre estourar os 10s e cair no force-exit — mesmo quando não havia
  nenhuma requisição real para drenar. O `unref()` do timer garante que não vira zumbi, mas
  o caminho feliz vira caminho degenerado.
- **Impacto de negócio**: perda do próprio objetivo do BE-06 no caso comum — em vez de sair
  em ~100ms após a última resposta, o processo sempre espera 10s. Se acontecer, transforma
  cada deploy num teste do force-exit.
- **Métrica de baseline**: 0 chamadas a `closeIdleConnections`/`closeAllConnections` (grep
  acima). Frequência real com que o drain estoura contra o caminho feliz **não medível
  localmente** — precisa dos logs `[shutdown]` de deploys reais em produção. Sem esse
  número, P2.

### F-availability-3: duração real do drain e janela `SIGTERM → SIGKILL` não instrumentadas

- **Severidade**: P3
- **Tactic violada**: Monitor (a tactic está parcial: os logs existem, mas não viram série
  temporal nem alerta)
- **Localização**: `src/backend/http/gracefulShutdown.ts:61,74-76,90-93,97`
- **Evidência (objetiva)**:
  ```
  # o handler já emite:
  '[shutdown] SIGTERM recebido — parando de aceitar novas conexões'
  '[shutdown] pool de conexões encerrado'
  '[shutdown] requisições em voo concluídas'
  '[shutdown] drenagem excedeu 10000ms — saindo com requisições ainda em voo'
  ```
  Todos vão para `console.log` — nenhum vira contador/histograma. Sem agregação, o time só
  descobre que a drenagem está estourando quando um analista abrir um chamado.
- **Impacto técnico**: o valor de `DEFAULT_DRAIN_TIMEOUT_MS = 10_000` foi escolhido contra
  uma janela SIGTERM→SIGKILL declarada como "~30s" no comentário do código, mas não medida
  neste run nem instrumentada em produção. Se o Render mudar a janela (ou se a plataforma
  entregar SIGKILL mais cedo em plano Starter), ninguém percebe até deployar.
- **Impacto de negócio**: risco de calibração cega — o número certo do timeout só é
  conhecido em teoria.
- **Métrica de baseline**: 4 pontos de log presentes; 0 métricas exportadas (grep). Como
  não há incidente medido, P3.

## 5. Cards Kanban

### [availability-1] Sinalizar readiness=false no `/health` durante o shutdown

- **Problema**
  > `/health` (rota do LB do Render, `healthCheckPath: /health` em `render.yaml:22`) continua
  > devolvendo 200 depois que o SIGTERM chega, porque a flag `shuttingDown` vive num closure
  > isolado no `gracefulShutdown.ts` (`src/backend/http/gracefulShutdown.ts:52-61`). Sem sinal
  > de readiness, o LB pode roteirizar novas requisições por conexões keep-alive já abertas
  > dentro da janela de drain, e uma delas pode cair exatamente na fatia crítica
  > `createRun → finishRun` do SISPAG — que é o que o delta veio evitar.

- **Melhoria Proposta**
  > Expor a flag de shutdown como módulo (ex.: `http/readinessState.ts` com `isDraining()` e
  > `markDraining()`), chamar `markDraining()` no início do handler
  > (`gracefulShutdown.ts:60-61`) **antes** do `server.close`, e fazer `/health` (`index.ts:79`)
  > retornar 503 quando `isDraining()`. Manter `/health/pipelines` como está (a sonda existente
  > para pipelines não deve carregar responsabilidade do estado do processo).

- **Resultado Esperado**
  > `/health` devolve 503 durante todo o drain; o LB do Render tira a instância do pool antes
  > de qualquer requisição nova entrar. Contagem de execuções órfãs em `reconciling`
  > atribuíveis a deploy vai para 0 (hoje só sabemos que o reaper limpa, não quantos vieram
  > de deploy).

- **Tactic alvo**: Removal from Service
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Endpoints que expõem estado de drain: 0 → 1 (`/health`)
  - Requisições HTTP recebidas entre `[shutdown] SIGTERM recebido` e `[shutdown] server.close`
    em produção: baseline a instrumentar → 0
- **Risco de não fazer**: a fatia da janela em que o LB ainda roteia mantém o vetor do BE-06
  vivo em versão diluída — o reaper continua sendo necessário como rede final para o caso
  "deploy no meio de uma request".
- **Dependências**: nenhuma (não requer mudança de infra; o `healthCheckPath` já aponta para
  `/health`).

### [availability-2] Fechar conexões keep-alive ociosas no início do drain

- **Problema**
  > `server.close(callback)` só chama o callback quando **todas** as conexões TCP fecharam,
  > inclusive keep-alive ociosas. Como o LB do Render costuma manter keep-alive, o
  > `server.close` de `src/backend/http/gracefulShutdown.ts:98-101` tende a estourar os 10s
  > e sempre cair no force-exit — tornando o caminho feliz do drain indistinguível do timeout.

- **Melhoria Proposta**
  > Chamar `server.closeIdleConnections()` (Node ≥18.2) **antes** do `server.close(callback)`
  > para liberar keep-alive sem requisição em voo. Opcional: agendar
  > `server.closeAllConnections()` alguns segundos antes do force-exit (ex.: 8s) como
  > escalation controlada, em vez de deixar o `exitOnce` cortar. O `package.json` já é ESM
  > TypeScript; a API está disponível sem dependência nova.

- **Resultado Esperado**
  > No caso comum (sem requisição em voo), o drain termina em ~100ms em vez de sempre 10s.
  > `[shutdown] drenagem excedeu 10000ms` deixa de ser o log dominante de shutdown.

- **Tactic alvo**: Removal from Service
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - Uso de `closeIdleConnections`: 0 → 1 chamada no drain
  - % de shutdowns que terminam por force-exit em vez de drain completo: baseline a
    instrumentar → <10%
- **Risco de não fazer**: cada deploy vira, na prática, um teste do force-exit — que existe
  como rede de segurança, não como caminho principal. Perde-se a evidência de que o drain
  está funcionando quando o dia em que ele **precisar** funcionar chegar.
- **Dependências**: idealmente entra depois de [availability-1], para o LB ter parado de
  mandar tráfego antes das keep-alive serem cortadas.

### [availability-3] Instrumentar duração do drain e frequência de force-exit

- **Problema**
  > Os 4 logs `[shutdown] ...` (`gracefulShutdown.ts:61,74-76,90-93,97`) contam a história
  > por deploy, mas não viram métrica agregada. O valor de `DEFAULT_DRAIN_TIMEOUT_MS = 10_000`
  > foi escolhido contra uma janela SIGTERM→SIGKILL declarada como "~30s" em comentário
  > (`gracefulShutdown.ts:22-25`), não verificada aqui. Sem série temporal, não há como
  > saber se o timeout está calibrado ou se a plataforma mudou.

- **Melhoria Proposta**
  > (a) Registrar `duracao_drain_ms` numa tabela `shutdown_event` ao final de cada
  > shutdown (mesmo padrão do `job_run`), incluindo `signal`, `motivo_saida` (`drenado` |
  > `timeout` | `erro_pool`), `pid`, `versao`. (b) Adicionar linha ao painel de operação
  > mostrando os últimos N shutdowns. (c) Documentar a janela real do Render (consultar
  > docs oficiais ou medir com um deploy artificial que loga `Date.now()` em
  > `process.on('SIGKILL' /* não existe */)` — via medição experimental controlada com um
  > `while(true)` de teste).

- **Resultado Esperado**
  > Painel mostra distribuição do `duracao_drain_ms` e taxa de force-exit; se a taxa passar
  > de X% ou a média encostar no teto, disparar revisão. `DEFAULT_DRAIN_TIMEOUT_MS` deixa de
  > ser palpite defensável e vira decisão calibrada.

- **Tactic alvo**: Monitor
- **Severidade**: P3
- **Esforço estimado**: M (2–5d — a tabela e o painel são novos)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Métricas de shutdown exportadas: 0 → ≥3 (`duracao_drain_ms`, `motivo_saida`,
    contagem/deploy)
  - Janela SIGTERM→SIGKILL do Render: valor documentado (com fonte) → substituindo o
    comentário atual em `gracefulShutdown.ts:22-25`
- **Risco de não fazer**: calibração cega. Se o Render reduzir a janela ou se o drain
  começar a estourar por regressão, o time só descobre por chamado.
- **Dependências**: [availability-1] e [availability-2] fecham o loop — instrumentar antes
  de melhorar dá baseline; instrumentar depois valida.

## 6. Notas do agente

- Escopo mantido no delta: os cards atacam o que o próprio delta **quase** cobriu (LB
  readiness, keep-alive, instrumentação do drain). Tactics como Active/Passive Redundancy,
  Spare, Non-Stop Forwarding, Voting foram marcadas N/A por incompatibilidade com plano
  Render Starter single-instance — não são omissões do delta.
- Métricas não medíveis explicitadas na tabela §2: duração real de drain, janela
  SIGTERM→SIGKILL do Render, contagem histórica de órfãs de `reconciling` atribuíveis a
  deploy. Nenhum P0/P1 foi levantado porque não há baseline numérico local que sustente
  essa severidade — a regra §7 do template rebaixaria de qualquer forma. O que estava em P0
  antes do delta (BE-05, pool leak) foi corrigido e verificado por teste.
- Cross-QA: F-availability-1 e F-availability-2 tocam Deployability (comportamento em
  deploy) — vale checar se o `qa-deployability` propõe algo compatível para consolidar num
  único card. F-availability-3 se conecta com `qa-testability` (falta de instrumentação =
  falta de observabilidade de comportamento em produção).
