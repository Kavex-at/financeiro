---
qa: Availability
qa_slug: availability
run_id: 2026-09-03-2015-session-store-pool
agent: qa-availability
generated_at: 2026-09-03T20:15:00-03:00
scope: backend
score: 7.5
findings_count: 3
cards_count: 2
---

# Availability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Pooler Postgres (Supabase/pgBouncer) do backend Express no Render | Cliente ocioso derrubado por RST/idle-kill dispara `pool.on('error')` no `conexosSessionStore` | `services/conexosSessionStore.ts` (2º Pool `pg`, `max: 2`, exclusivo do fluxo de login Conexos) | Produção Render, 1 instância, `MAX_SESSIONS ≈ 3` no Conexos, deploy diário via hook | Encerrar o pool quebrado, esvaziar o slot do holder, reconstruir preguiçosamente na próxima chamada, degradar `acquire/persist/invalidate` para "miss" durante qualquer falha e nunca lançar; no SIGTERM, travar a reconstrução e devolver as 2 conexões antes do exit | 0 processos derrubados por unhandled rejection do `pool.on('error')`; 0 sessões Conexos vazadas pós-deploy; login por processo (baseline pré-store) preservado durante indisponibilidade do pooler; falha do pooler visível ao operador em ≤ 1 min |

> Cenário secundário — shutdown: SIGTERM do Render → `closeProcessResources` chama `closeConexosSessionStorePool` → 2 conexões devolvidas ao pooler dentro do envelope de 25s (`DEFAULT_DRAIN_TIMEOUT_MS`), 0 sessões penduradas até o `idleTimeoutMillis` do pooler.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Guarda de reentrada no `pool.on('error')` | ✅ presente (flag `ended` local) | Sim | ✅ | `conexosSessionStore.ts:300-313` |
| Reconstrução do pool na próxima chamada após erro | ✅ presente (`holder.pool ?? (storeClosed ? undefined : openPool())`) | Sim | ✅ | `conexosSessionStore.ts:323` + teste "rebuilds the pool on the next call" (`conexosSessionStorePool.test.ts:69-83`) |
| Trava de shutdown impede reconstrução durante drain | ✅ presente (`storeClosed`) | Sim | ✅ | `conexosSessionStore.ts:237,323` + teste "does not reopen a pool after the shutdown" (`conexosSessionStorePool.test.ts:99-108`) |
| `closeConexosSessionStorePool` registrado no shutdown | ✅ presente | Sim | ✅ | `http/processResources.ts:22` |
| Idempotência do close | ✅ verificada | Sim | ✅ | teste "is idempotent" (`conexosSessionStorePool.test.ts:127-131`) |
| Redação de credencial no warn | ✅ presente (`redactErrorMessage`) | Sim | ✅ | `conexosSessionStore.ts:307` + teste "logs a redacted warning" (`conexosSessionStorePool.test.ts:85-97`) |
| Canal do warn de rebuild | `console.warn` (stdout) | `LogService` estruturado (mesma barra do `onForceExit`) | ⚠️ | `conexosSessionStore.ts:306-308` vs. `index.ts:169-176` (`OPERATIONAL_WARN`) |
| Backoff entre rebuilds sucessivos | 0 (rebuild imediato na próxima chamada) | ≥ 1 janela exponencial ou circuit-breaker | ⚠️ | `conexosSessionStore.ts:323` |
| Teto de reconstruções por janela | não há | ≥ 1 (com desabilitação temporária ao estourar) | ⚠️ | idem |
| `connectionTimeoutMillis` do pool | 5 000 ms | ≤ 5 000 ms (compatível com login sob pressão) | ✅ | `conexosSessionStore.ts:295` |
| `idleTimeoutMillis` do pool | 10 000 ms | 10 000 ms (recicla clientes ociosos antes do kill do pooler) | ✅ | `conexosSessionStore.ts:294` |
| Cobertura do arquivo | 90,47 % stmts · 75,80 % branches · 93,75 % funcs | ≥ 88 % / ≥ 60 % (thresholds do repo) | ✅ | `_shared-metrics.md` |

> ⚠️ **Não medível localmente**: taxa real de eventos `pool.on('error')` por hora em produção, tempo médio entre rebuilds sucessivos e taxa de session-share (hit vs. miss) durante o incidente. Requer instrumentação em `LogService` (`type: 'OPERATIONAL_WARN'`, mesmo canal do `publicarForceExit`) para que o painel `/operacao` conte os eventos; hoje eles vivem só no drain de stdout do Render.
>
> ⚠️ **Não medível localmente**: se a sequência real do `pg` num pooler morto é "abre pool → primeira query falha → dispara `error` → destrói → rebuild" (rebuild-por-query) ou "abre pool → n clientes ociosos derrubados em rajada → 1 `error` no consolidado". A diferença muda o custo do loop de rebuild (linear no nº de chamadas ao store vs. quase-nulo). Requer teste de integração contra um pooler que faz RST.

## 3. Tactics — Cobertura no financeiro

### Detect Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Ping/Echo | Nenhum health-probe contra o pooler antes de usar o pool | N/A | Fluxo é reativo (erro do próprio `pg`), não ativo — probe extra dobraria custo sem benefício claro para um pool de `max: 2` só de login |
| Heartbeat | — | ❌ ausente | Não há ping periódico ao pooler; a falha só é detectada quando o `pg` emite `error` |
| Monitor | `console.warn` no rebuild e no fallback de construção do Pool | ⚠️ parcial | `conexosSessionStore.ts:306,332` — visível no stdout, invisível no `/operacao` (ver F-availability-1) |
| Timestamp | N/A | N/A | Não há ordenação de mensagens no fluxo |
| Sanity Checking | Validação de linha em `toRecord` (verifica `sid` string e `expires_at` parseável) | ✅ presente | `conexosSessionStore.ts:71-85` |
| Condition Monitoring | Sem contador de rebuilds nem métrica de saúde exposta | ❌ ausente | Ver F-availability-2 |
| Voting | N/A | N/A | Pool único |
| Exception Detection | `pool.on('error', …)` com guarda de reentrada; `try/catch` em `acquire/persist/invalidate` | ✅ presente | `conexosSessionStore.ts:124-127,191-194,209-211,301-313` |
| Self-Test | N/A | N/A | Sem endpoint de auto-teste do store |

### Recover from Faults — Preparation & Repair

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Active Redundancy | N/A | N/A | Um único pool por chave lógica |
| Passive Redundancy | N/A | N/A | idem |
| Spare | Reconstrução preguiçosa provê um "spare" sob demanda, não hot-standby | ⚠️ parcial | `conexosSessionStore.ts:323` |
| Exception Handling | `try/catch` degrada `acquire→null`, `persist→'lost'`, `invalidate→void`; `pool.end().catch(() => undefined)` evita unhandled rejection | ✅ presente | `conexosSessionStore.ts:124-127,191-194,209-211,311` |
| Rollback | N/A | N/A | Store é side-effect leitura/escrita atômica; sem transação multi-passo |
| Software Upgrade | N/A | N/A | — |
| Retry | Rebuild-na-próxima-chamada equivale a retry implícito, **sem backoff e sem teto** | ⚠️ parcial | `conexosSessionStore.ts:323` — ver F-availability-3 |
| Ignore Faulty Behavior | Store degrada silenciosamente para "miss"/"disabled"; nunca derruba a integração Conexos | ✅ presente | Docstring `conexosSessionStore.ts:20-23` + `acquire` retornando `null` no catch |
| Degradation | Caminho `db: null` mantém login-por-processo (baseline pré-store) intacto | ✅ presente | `conexosSessionStore.ts:99-101,117,141,203,334` |
| Reconfiguration | `openPools.delete(pool)` + `holder.pool = undefined` reconfigura a origem de dados no próximo request | ✅ presente | `conexosSessionStore.ts:304,312` |

### Recover from Faults — Reintroduction

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Shadow | N/A | N/A | Sem replicação/shadow |
| State Resynchronization | Após rebuild, o próximo `acquire()` re-lê a linha compartilhada e re-adota o `sid` vigente — o estado é reconstituído do próprio banco | ✅ presente | `conexosSessionStore.ts:116-128` |
| Escalating Restart | N/A | N/A | Sem hierarquia de restart neste módulo |
| Non-Stop Forwarding | N/A | N/A | — |

### Prevent Faults

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Removal from Service | Shutdown marca `storeClosed`, esvazia holders, encerra pools; teste confirma que `acquire()` devolve `null` após close | ✅ presente | `conexosSessionStore.ts:247-255` + teste `conexosSessionStorePool.test.ts:99-108,120-124` |
| Transactions | UPDATE com CAS por `version` e INSERT `ON CONFLICT DO NOTHING` — semântica do domínio, não fault prevention | N/A | `conexosSessionStore.ts:140-195` — é concorrência otimista, cabe em Integrability |
| Predictive Model | Sem modelo de saúde/degradação preditiva | ❌ ausente | — |
| Exception Prevention | Guarda `ended` impede segundo `end()`; `void pool.end().catch(() => undefined)` blinda unhandled rejection; `storeClosed` impede reabertura durante drain | ✅ presente | `conexosSessionStore.ts:300,311,323` |
| Increase Competence Set | N/A | N/A | — |

## 4. Findings (achados)

### F-availability-1: warn de rebuild fica só em `console.warn`, invisível no painel `/operacao`

- **Severidade**: P1
- **Tactic violada**: Monitor (Detect Faults)
- **Localização**: `src/backend/services/conexosSessionStore.ts:306-308,331-333`
- **Evidência (objetiva)**:
  ```typescript
  // conexosSessionStore.ts:306
  console.warn(
      `[ConexosSessionStore] pool derrubado por erro de socket — reconstruído na próxima chamada: ${redactErrorMessage(detail)}`,
  );
  ```
  Comparar com o `onForceExit` do mesmo delta (`index.ts:169-176`), que roteia para `LogService.warn` com `type: 'OPERATIONAL_WARN'` — o canal estruturado que a ADR-0042 padronizou justamente para eliminar "falha invisível":
  ```typescript
  const publicarForceExit = async (reason: string): Promise<void> => {
      await container.resolve(LogService).warn({
          type: 'OPERATIONAL_WARN',
          message: 'shutdown force-exit — drenagem excedeu o teto',
          data: { reason },
      });
  };
  ```
- **Impacto técnico**: um pooler que flapar (ex.: `Connection terminated unexpectedly` a cada 30 s) dispara rebuild contínuo. No `console.warn` isso vira ruído idêntico ao request logger e afunda no drain do Render; no painel `/operacao` o operador veria a contagem por janela. Assimétrico com o shutdown do mesmo commit, que fez a jornada até o `LogService` exatamente por este motivo.
- **Impacto de negócio**: a instabilidade se manifesta como logins Conexos lentos (5 s por `connectionTimeoutMillis`) e mais colisões de `MAX_SESSIONS ≈ 3` por perda do sharing. Sem sinal no `/operacao`, o time descobre pelo cliente — mesma categoria de falha invisível que o `reaper-sispag` foi criado para varrer.
- **Métrica de baseline**: 0 eventos de rebuild publicados no canal `OPERATIONAL_WARN` hoje (100 % ficam em `console.warn`). Contagem esperada de eventos em produção: **não medível localmente** — hoje não há como responder "quantas vezes o pool rebuildou nas últimas 24 h?" sem grepar drain do Render.

### F-availability-2: sem `Condition Monitoring` do rebuild — não há contador, taxa ou métrica de saúde

- **Severidade**: P2
- **Tactic violada**: Condition Monitoring (Detect Faults)
- **Localização**: `src/backend/services/conexosSessionStore.ts:290-316`
- **Evidência (objetiva)**: o holder tem `pool?: Pool`, mas o módulo não expõe nenhum contador (nº total de rebuilds, timestamp do último rebuild, latência do `openPool` seguinte). Comparar com o próprio `pool.on('error')`: dispara e some. Sem contador, F-availability-1 continuaria cega mesmo após migrar para `LogService`, porque log ≠ métrica agregada.
- **Impacto técnico**: impossível alertar em "rebuild rate > N/min" ou "último rebuild < 60 s atrás" — que é o sinal de flapping do pooler. O operador só vê eventos individuais.
- **Impacto de negócio**: nenhum SLO derivável do session store; nenhuma resposta local à pergunta "estamos sob pressão do pooler agora?".
- **Métrica de baseline**: 0 métricas expostas (0 counters, 0 gauges). Alvo mínimo: 1 counter (`rebuilds_total`) + 1 timestamp do último rebuild.

### F-availability-3: `Retry` sem backoff nem teto — rebuild imediato a cada chamada enquanto o pooler estiver morto

- **Severidade**: P2
- **Tactic violada**: Retry (Recover — Preparation & Repair)
- **Localização**: `src/backend/services/conexosSessionStore.ts:319-326`
- **Evidência (objetiva)**:
  ```typescript
  const db: SessionStoreDb = {
      query: (sql, params) => {
          const pool = holder.pool ?? (storeClosed ? undefined : openPool());
          if (!pool) throw new Error('ConexosSessionStore: pool encerrado');
          return pool.query(sql, params as unknown[] | undefined);
      },
  };
  ```
  Se o pooler está indisponível, cada chamada reentra em `openPool()` → cria `new Pool(...)` → `pool.query` falha em ≤ 5 s → `pool.on('error')` reconstrói → próxima chamada refaz. Não há espera entre tentativas nem desligamento temporário do store após N rebuilds consecutivos.
- **Impacto técnico**: cada login paga o pedágio de `connectionTimeoutMillis` (5 s) durante toda a janela de indisponibilidade do pooler. Menor que um outage, mas transforma degradação silenciosa em degradação lenta. Combinado com F-availability-1, o operador não vê o custo.
- **Impacto de negócio**: em incidente do pooler, cada tentativa de login do robô/analista custa +5 s. Para o loop do `services/conexos.ts`, isso vira janelas de espera acumuladas visíveis na UI.
- **Métrica de baseline**: intervalo entre reconstruções = 0 ms (rebuild na próxima chamada). Alvo mínimo: backoff exponencial 500 ms → 30 s, teto de 3 rebuilds/min antes de forçar `db → null` (degradação plena) por 60 s. Custo real do loop em produção: **não medível localmente** (requer teste de integração contra pooler que faça RST — ver nota da §2).

## 5. Cards Kanban

### [availability-1] Rotear o warn de rebuild do session store para o `LogService` (`OPERATIONAL_WARN`)

- **Problema**
  > O `pool.on('error')` do `conexosSessionStore` reconstrói o pool e emite `console.warn` (`conexosSessionStore.ts:306`). O `onForceExit` do mesmo delta (`index.ts:169`) já publica no `LogService` com `type: 'OPERATIONAL_WARN'`, exatamente por causa da ADR-0042 ("falha invisível" não é aceita). Um pooler flapando gera rebuild contínuo que hoje só existe no drain do Render — o painel `/operacao` fica cego, apesar do canal estar pronto e o `redactErrorMessage` já ter neutralizado o risco de vazar credencial.

- **Melhoria Proposta**
  > Injetar um `notify: (reason, detail) => Promise<void>` opcional no `buildSessionStoreFromEnv` (mesma forma do `onForceExit`) e, do lado do composition root (`index.ts` / `http/processResources.ts`), passar uma implementação que resolva o `LogService` no container e chame `warn({ type: 'OPERATIONAL_WARN', message: 'session-store pool rebuild', data: { reason: 'pg.error', detail } })`. Manter o `console.warn` como fallback quando o `notify` não estiver injetado (jobs cron que não bootam o container). Tactic Bass alvo: **Monitor**.

- **Resultado Esperado**
  > Eventos de rebuild aparecem no painel `/operacao` na mesma trilha do force-exit do shutdown. Publicações no canal `OPERATIONAL_WARN`: **0 hoje → 1 por rebuild em produção**.

- **Tactic alvo**: Monitor (Detect Faults)
- **Severidade**: P1
- **Esforço estimado**: S (≤ 1 d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - Eventos `OPERATIONAL_WARN` com `type` do rebuild em 30 d: 0 → ≥ 1 (assumindo pelo menos uma restart-de-cliente-ocioso, que é rotineiro no Supabase)
  - Tempo do operador para descobrir instabilidade do pooler: desconhecido (drain do Render) → ≤ 1 min (painel `/operacao`)
- **Risco de não fazer**: em 6 meses, um deploy que introduza vazamento de conexão gradual (pooler começa a matar clientes com mais frequência) só será notado pelo cliente relatando latência de login — repetindo o padrão que motivou a ADR-0042.
- **Dependências**: nenhuma. O `LogService` já é `@singleton()`, o canal `OPERATIONAL_WARN` já é consumido pelo `/operacao`, e o `redactErrorMessage` já está aplicado no `console.warn` atual.

### [availability-2] Backoff e teto de rebuild no `conexosSessionStore`, mais counter para alerta

- **Problema**
  > Enquanto o pooler estiver indisponível, cada chamada ao `db.query` reentra em `openPool()` e paga ~5 s de `connectionTimeoutMillis` antes de disparar `pool.on('error')` novamente (`conexosSessionStore.ts:319-326`). Não há espera entre tentativas nem desligamento temporário do store após N rebuilds em janela. Combinado com F-availability-1, a degradação é silenciosa e lenta: o login por processo continua funcionando (baseline), mas com +5 s de pedágio por tentativa, sem sinal externo.

- **Melhoria Proposta**
  > Introduzir no `PoolHolder` um contador `rebuildsInWindow` com relógio simples (janela de 60 s), um `nextRebuildAt` para gating temporal (backoff exponencial 500 ms → 30 s) e uma bandeira `temporarilyDisabled` acionada ao estourar teto (ex.: 3 rebuilds/min). Enquanto `temporarilyDisabled` valer, o `db.query` lança o mesmo erro atual (`ConexosSessionStore: pool encerrado`) — `acquire`/`persist`/`invalidate` já degradam para `null`/`'lost'`/`void`, então o comportamento visível é login-por-processo (baseline pré-store). Tactic Bass alvo: **Retry** com **Ignore Faulty Behavior** disciplinado por janela. Complementarmente, expor o contador via `getRebuildStats()` para o card `availability-1` publicar rate agregado.

- **Resultado Esperado**
  > Custo de um outage do pooler cai de "5 s por chamada, indefinidamente" para "5 s × 3 tentativas em 60 s, depois degrada plenamente por 60 s". Contador `rebuilds_total` observável.

- **Tactic alvo**: Retry (Recover — Preparation & Repair) + Condition Monitoring (Detect Faults)
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1 d)
- **Findings relacionados**: F-availability-2, F-availability-3
- **Métricas de sucesso**:
  - Intervalo entre rebuilds sucessivos: 0 ms → ≥ 500 ms (backoff inicial)
  - Rebuilds por minuto sob pooler morto: ilimitado → ≤ 3, depois 0 até nova janela
  - Métrica exposta (`rebuilds_total`): não existe → counter monotônico legível pelo `/operacao`
- **Risco de não fazer**: durante uma janela de instabilidade do Supabase pgBouncer (evento já ocorrido em outros projetos que compartilham o mesmo tenant), o backend degrada em silêncio com latência de login inflada, e o pedágio composto (5 s × N chamadas) só aparece no time-to-answer da UI.
- **Dependências**: idealmente após `availability-1` (o counter só rende se houver canal de publicação); mas pode ir em paralelo se o `getRebuildStats()` for exposto puro-síncrono.

## 6. Notas do agente

- **Decisão de escopo**: restringi todas as métricas e findings ao delta do arquivo único (`conexosSessionStore.ts`) + seus wire-ups verificáveis (`http/processResources.ts`, `http/gracefulShutdown.ts`, `index.ts:169-201`). O gap "pool sem `PostgreeDatabaseClient` DDD/tsyringe" foi explicitamente marcado fora de escopo pelo `_shared-metrics.md` (BE-11 em outra revisão) — não gerei finding.
- **Contra-argumento considerado e descartado para P0**: nenhum caminho do delta introduz risco de perda de dado, dupla execução ou blast cross-tenant. `acquire→null`, `persist→'lost'`, `invalidate→void`, `db.query` pós-shutdown lançando é capturado pelos catchs acima. O comportamento degradado é login-por-processo (baseline pré-BE-06). Por isso o score fica em 7,5, não abaixo.
- **Conexão cross-QA (para o consolidator)**: F-availability-1 é o mesmo eixo do card de Fault-tolerance sobre observabilidade do force-exit (ADR-0042). Se o consolidator já produziu esse card em rodada anterior, os dois convergem no mesmo hook do `LogService`. A migração DDD do módulo (`services/` → `domain/service/`) fica no escopo de Modifiability, não aqui.
- **Métrica que tentei coletar e não pude**: comportamento real do `pg.Pool` contra um pgBouncer que faça RST — a diferença entre "1 evento `error` por cliente ocioso" e "1 evento consolidado" muda a severidade de F-availability-3 (P2 estável vs. P1 se o loop for por-query). Requer teste de integração com pooler real.
