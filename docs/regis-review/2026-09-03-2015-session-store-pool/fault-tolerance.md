---
qa: Fault Tolerance
qa_slug: fault-tolerance
run_id: 2026-09-03-2015
agent: qa-fault-tolerance
generated_at: 2026-09-03T20:15:00-03:00
scope: backend
score: 8.4
findings_count: 4
cards_count: 4
---

# Fault Tolerance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Pooler Postgres (Supabase, modo transação) e sockets ociosos da rede Render | Um cliente `pg` no pool do 2º Postgres emite `error` (socket derrubado, restart do pooler, `Connection terminated unexpectedly`) | `services/conexosSessionStore.ts` — `PoolHolder` + `openPool()` (linhas 229-336), consumido pelo singleton `conexosSessionStore` que serve `ConexosService.login()` e `ConexosSessionRegistry` | Produção normal (Render), múltiplos processos concorrendo pelos ~3 slots `MAX_SESSIONS` do Conexos | Processo não cai; pool morto é `end()`-ado uma vez e esquecido; próxima query reconstrói pool novo; `console.warn` redigido; se a reconstrução falhar ou o processo estiver drenando, `acquire()`/`persist()` degradam para "miss" (login por processo) sem lançar | 0 crashes por `unhandled error`; 0 pools acumulados por deploy (era 2 por deploy no bug anterior); janela de "cegueira" do store limitada a **1 query**, não permanente; nunca reabre conexão depois de `closeConexosSessionStorePool()` |

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Testes cobrindo reconstrução preguiçosa | 1 (`rebuilds the pool on the next call after an error killed it`) | ≥1 | ✅ | `services/conexosSessionStorePool.test.ts:76-89` |
| Testes cobrindo trava pós-shutdown | 1 (`does not reopen a pool after the shutdown already closed the store`) | ≥1 | ✅ | `services/conexosSessionStorePool.test.ts:106-115` |
| Testes cobrindo guarda de reentrada no `error` | 1 (`ends the pool only once when the error event fires repeatedly`) | ≥1 | ✅ | `services/conexosSessionStorePool.test.ts:50-58` |
| Testes cobrindo `end()` que rejeita | 2 (no handler + no `close`) | ≥1 | ✅ | `services/conexosSessionStorePool.test.ts:60-67, 152-157` |
| Testes cobrindo redação do warn | 1 (`logs a redacted warning`) | ≥1 | ✅ | `services/conexosSessionStorePool.test.ts:91-104` |
| Cobertura de `conexosSessionStore.ts` | 90,47% stmts / 75,80% branches / 93,75% funcs / 91,11% lines | ≥85 / ≥70 / ≥85 / ≥85 | ✅ | `_shared-metrics.md` (linha 61) |
| Ramos não cobertos | 24,20% (branches) — principalmente o `catch` de `buildSessionStoreFromEnv` (linhas 329-335) e ramificações do `toRecord` | ≤30% | ✅ | inspeção do arquivo vs. suíte |
| Janela de corrida na reconstrução (dois `db.query` concorrentes recriando dois pools) | **0** — `openPool()` é síncrono (`new Pool()` é síncrono, atribuição a `holder.pool` idem); Node single-thread serializa | 0 | ✅ | análise de `conexosSessionStore.ts:319-327` |
| Idempotência do handler `error` (múltiplos disparos por cliente) | Sim — flag `ended` na closure de `openPool()` | 1 execução | ✅ | `conexosSessionStore.ts:300-313` + teste linha 50-58 |
| Idempotência de `closeConexosSessionStorePool()` (2 chamadas seguidas) | Sim — `openPools.clear()` na primeira | idempotente | ✅ | `conexosSessionStore.ts:249-254` + teste linha 126-133 |
| Contador/observabilidade de degradação do store fleet-wide (quantas vezes o pool caiu, quantos processos degradaram para "miss") | **Ausente** — só `console.warn` redigido no stdout | ≥1 contador exposto | ⚠️ | grep por métrica/counter no arquivo: nenhum |
| Contador de reconstruções bem-sucedidas vs falhas | Ausente | ≥1 | ⚠️ | idem |
| Circuit breaker em falha persistente de reconstrução (N erros consecutivos → pausa) | Ausente — cada `db.query` re-tenta `openPool()`; se `new Pool()` falhar (raro; síncrono), `db.query` lança e o `try` do `acquire()` degrada | 1 CB | ⚠️ | `conexosSessionStore.ts:319-327` |
| Benchmark "wholesale end+rebuild vs. pg self-heal por-cliente" (churn real de conexões por hora) | ⚠️ **Não medível localmente** | comparação numérica | ⚠️ | requer produção Render + métrica de `pg_stat_activity` no pooler |
| Erros de socket ocioso observados em prod (último mês) | ⚠️ **Não medível localmente** — sem `error_message` histórico do 2º pool | linha de base | ⚠️ | requer drains Render + agregação |

> ⚠️ **Não medível localmente**: taxa real de eventos `error` no 2º pool em prod (semana anterior). Requer logs do Render agrupados por padrão `pool derrubado por erro de socket`. Recomendação: emitir a linha via `LogService` (não `console.warn`) e agregá-la em `job_execucao.error_message` ou em contador Prometheus exposto por `/metrics`.

> ⚠️ **Não medível localmente**: comparação de churn de conexões entre "encerrar+reconstruir" (delta atual) e "pg cura o cliente sozinho" (baseline `() => undefined` original). Requer instrumentação de `pool.totalCount`/`pool.idleCount` em prod por 1-2 semanas.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Avoid Faults — Substitution | Store desabilitado (db null) e degradação "miss" (`acquire()` retorna null em qualquer erro) atuam como fallback silencioso para login-por-processo — o comportamento original | ✅ presente | `conexosSessionStore.ts:117, 124-127, 141` |
| Avoid Faults — Replacement | N/A — não há componente redundante substituível; o "replacement" é a substituição por "miss", já contada acima | N/A | — |
| Avoid Faults — Predictive Model | Ausente — nenhuma heurística prevê degradação (contagem de erros, taxa, backoff) | ❌ ausente | grep no arquivo |
| Avoid Faults — Increase Competence Set | Handler `error` amplia o conjunto de faltas que o processo tolera (socket ocioso do 2º pool era um `unhandled error` em potencial no `() => undefined`; agora é log + rebuild) | ✅ presente | `conexosSessionStore.ts:298-313` |
| Detect Faults — Sanity Checking | `toRecord()` valida `sid` string + `expiresAt` finito antes de devolver registro; `redactErrorMessage` normaliza a mensagem do warn | ✅ presente | `conexosSessionStore.ts:71-85, 307` |
| Detect Faults — Comparison | Concorrência otimista (`WHERE version = $9`, `ON CONFLICT DO NOTHING`) compara o estado esperado com o efetivo — detecta "outro processo venceu" | ✅ presente | `conexosSessionStore.ts:169-189` |
| Detect Faults — Timestamp | `expiresAt` + `STORE_SID_MIN_TTL_MS` no consumidor (`services/conexos.ts:198`) detectam sid expirado antes de adotar | ✅ presente | `conexosSessionStore.ts:39, 73-74` |
| Detect Faults — Timeout | `connectionTimeoutMillis: 5000` no `Pool`; `idleTimeoutMillis: 10000` limita cliente ocioso | ✅ presente | `conexosSessionStore.ts:294-295` |
| Detect Faults — Condition Monitoring | `pool.on('error', ...)` observa a saúde do pool e reage; **mas** não há monitoração externa (métrica/contador) de "quantos rebuilds ocorreram" ou "quantos processos estão em miss" | ⚠️ parcial | `conexosSessionStore.ts:301-313` (só reação, sem contador) |
| Detect Faults — Self-Test | Ausente — nenhum ping periódico ao 2º pool valida que ele está vivo antes que o próximo `login()` precise dele | ❌ ausente | grep no arquivo |
| Detect Faults — Voting | N/A — fonte única de verdade é a linha em `conexos_sessions`; voting não se aplica | N/A | — |
| Contain Faults — Redundancy | `max: 2` mantém 2 clientes por pool (não é redundância clássica, mas dá margem para uma query em voo ver outro cliente responsivo mesmo se um falhar antes do `error` disparar) | ⚠️ parcial | `conexosSessionStore.ts:293` |
| Contain Faults — Recovery/Forward | O caminho de degradação "miss" é forward recovery: o consumidor faz seu próprio `POST /login` (compensação natural) | ✅ presente | `conexosSessionStore.ts:126, 141, 193` |
| Contain Faults — Recovery/Backward | N/A — não há transação DB de múltiplos writes a desfazer neste arquivo (persistências são CAS única em `conexos_sessions`) | N/A | — |
| Contain Faults — Reintroduction (Shadow) | N/A — só um pool ativo por vez, sem operação shadow | N/A | — |
| Contain Faults — Reintroduction (State Resync) | Rebuild do pool na próxima chamada é state resync — o novo pool nasce sem estado, e o CAS otimista sincroniza com o vencedor da corrida | ✅ presente | `conexosSessionStore.ts:319-326` + `persist()`/`acquire()` |
| Contain Faults — Reintroduction (Escalating Restart) | Restart de pool (menor escalada); não escala para restart de processo. Aceitável porque o escopo do defeito é o pool, não o runtime | ✅ presente (nível pool) | `conexosSessionStore.ts:302-313` |
| Recover State — Rollback | N/A — writes CAS únicos; não há dual-write transacional a rolar-back | N/A | — |
| Recover State — Repair State | `openPool()` reabre o slot; `holder.pool = undefined` no `error` "repara" o holder | ✅ presente | `conexosSessionStore.ts:311-315` |
| Recover State — Idempotent Replay | `invalidate()` é condicional (`WHERE key AND sid = $2`), `persist()` usa CAS (`ON CONFLICT DO NOTHING` ou `WHERE version =`) — replay não duplica | ✅ presente | `conexosSessionStore.ts:148-190, 205` |
| Recover State — Compensating Transaction | O `lost` de `persist()` devolve o vencedor via `acquire()` para o chamador adotar — compensação natural sem precisar de UNDO externo | ✅ presente | `conexosSessionStore.ts:162-165, 186-189` |
| Recover State — Reconcile | `acquire()` após `lost` reconcilia o estado local com o vencedor da corrida (o chamador em `conexos.ts:180-192` adota o sid armazenado) | ✅ presente | `conexosSessionStore.ts:164, 188` |
| Recover State — Quarantine | Ausente — pool que falhou repetidamente não é quarentenado; toda `db.query` re-tenta imediatamente. Para um pool que oscila (open/error/open/error), isso pode virar loop apertado (não observado, mas não impedido) | ❌ ausente | `conexosSessionStore.ts:323` |

## 4. Findings (achados)

### F-fault-tolerance-1: `buildSessionStoreFromEnv` reseta `storeClosed = false`, derrotando a trava pós-shutdown se re-chamado

- **Severidade**: P3 (baixo — melhoria opcional; sem caminho de produção conhecido que a exponha, mas o invariante "shutdown é terminal" fica implícito)
- **Tactic violada**: Contain Faults — Reintroduction (Escalating Restart) — o contrato "depois de `close`, nada reabre" é escrito na docstring da linha 236 mas quebrado se algum código construir outro store
- **Localização**: `src/backend/services/conexosSessionStore.ts:257-336` (linha 271: `storeClosed = false`)
- **Evidência (objetiva)**:
  ```typescript
  // linhas 269-273
  try {
      storeClosed = false;               // ← reset incondicional
      const holder: PoolHolder = {};
      poolHolders.add(holder);
  ```
  Sequência que expõe o bug: `closeConexosSessionStorePool()` roda no SIGTERM (marca `storeClosed=true`); se qualquer código chamar `buildSessionStoreFromEnv()` **depois** disso (o próprio módulo faz isso no import — linha 339 —, o que hoje não acontece pós-shutdown porque o import é único, mas em tests é exatamente esse o padrão e nada no arquivo impede que um consumidor futuro replique), o `storeClosed` volta a `false`, o novo `openPool()` é chamado, e o processo passa a abrir conexões durante o drain.
- **Impacto técnico**: se um `container.reset()` ou um caminho de reload (não existe hoje; poderia surgir com um `/reload-config`) rechamar a factory pós-shutdown, o drain é anulado — conexões novas para o pooler enquanto o SIGTERM tenta descer o processo. Sem impacto se ninguém rechama; latente.
- **Impacto de negócio**: nulo hoje. Latente: potencial "conexão zumbi" no pooler Supabase durante um deploy, exatamente o defeito que o `close` deveria eliminar. Custo: ficar 1-2 conexões acima do teto do plano por 10 s.
- **Métrica de baseline**: 0 caminhos de produção conhecidos exercitam o cenário (grep por `buildSessionStoreFromEnv` fora do próprio arquivo: 1 hit, no teste — linha 28 de `conexosSessionStorePool.test.ts`). Risco = 0 hoje; invariante quebrado = 1.

### F-fault-tolerance-2: Wholesale `pool.end()` no `error` é mais agressivo que a auto-cura do `pg`, sem baseline que justifique o churn

- **Severidade**: P3 (baixo — trade-off defensável, mas sem número que sustente)
- **Tactic violada**: Detect Faults — Condition Monitoring (a reação está calibrada por instinto, não por medição)
- **Localização**: `src/backend/services/conexosSessionStore.ts:290-315`
- **Evidência (objetiva)**:
  ```typescript
  // linhas 301-313
  pool.on('error', (cause: unknown) => {
      if (ended) return;
      ended = true;
      openPools.delete(pool);
      // ...
      void pool.end().catch(() => undefined);   // ← encerra o pool INTEIRO
      if (holder.pool === pool) holder.pool = undefined;
  });
  ```
  O `error` do `pg` dispara "quando um cliente ocioso emite `error`". O comportamento nativo do `pg` é: remover **esse cliente** e continuar servindo com os outros (`max: 2`, então ainda tem 1). O delta aqui vai além: encerra o pool inteiro (drain gracioso — queries em voo terminam) e reconstrói na próxima chamada. Para um `max: 2` em transação com um pooler que dá restart, isso é defensível ("uma quebra é sinal de que todos os sockets podem estar rançosos"). Para um `max: 2` com um único socket ocioso que ficou zumbi por 10 min do `idleTimeoutMillis`, é churn: derruba o cliente saudável junto.
- **Impacto técnico**: reconexão desnecessária em N eventos por dia, onde N depende da taxa real de erros de socket ocioso — que **não é medida**. Se N=1/dia, churn negligível. Se N=100/dia (pooler flaky), churn perceptível: cada `login()` que passa pelo store adiciona latência da reconexão TCP+TLS+auth (~200-500 ms), enquanto `pg` sozinho reciclaria um cliente em milissegundos.
- **Impacto de negócio**: nulo em regime normal. Em regime degradado (pooler oscilando), latência extra no login do robô — que aparece como `p95` do primeiro request após churn, não como falha. Não afeta o cascade de `LOGIN_ERROR_MAX_SESSIONS` (que é sobre slots Conexos, não conexões `pg`).
- **Métrica de baseline**: taxa de `error` do pool em prod = **não medida** (só `console.warn` no stdout Render). Sem esse número, "wholesale rebuild" vs "pg self-heal" é decisão por instinto. Recomendação: emitir contador antes de decidir manter/reverter.

### F-fault-tolerance-3: Ausência de contador de degradação do store (fleet-wide) — cascata de `LOGIN_ERROR_MAX_SESSIONS` fica invisível até acontecer

- **Severidade**: P2 (médio — débito defensável; não introduzido por este delta, mas o delta é a hora de plantar o probe)
- **Tactic violada**: Detect Faults — Condition Monitoring; observabilidade da degradação sistêmica
- **Localização**: `src/backend/services/conexosSessionStore.ts:124-127, 191-194, 209-211` (todos os catch de degradação para "miss") + `conexosSessionStore.ts:214-219` (o `warn`)
- **Evidência (objetiva)**: todos os caminhos de erro degradam via `this.warn()` — que faz `console.warn`. Nenhum contador Prometheus, nenhuma linha em `job_execucao.error_message`, nenhum `alerta.detalhe`. Um cenário em que o pooler Postgres cai (evento único, afeta todos os N processos Render simultaneamente) faria N `acquire()` → null → cada processo faz seu `POST /login` → Conexos rejeita a partir do 4º com `LOGIN_ERROR_MAX_SESSIONS` (`services/conexos.ts:247-266` kill-oldest kicka o 1º, e a cascata anda para trás). O único sinal seria vários `console.warn '[ConexosSessionStore] acquire failed'` no stdout Render, sem agregação.
- **Impacto técnico**: incidente silencioso até o SISPAG começar a falhar por `LOGIN_ERROR_MAX_SESSIONS` (que **é** medido em `job_execucao.error_message` — ver `StalenessDetector.test.ts:129`). O ponto: descobrimos pela consequência (sessões brigando), não pela causa (store cego).
- **Impacto de negócio**: MTTD alto no cenário "pooler DB caiu por 5 min → nenhum lote SISPAG processado por 15 min → analista descobre pelo painel de operação". O contador transformaria isso em alerta imediato.
- **Métrica de baseline**: 0 contadores expostos por este arquivo; 0 dashboards que mostrem "% de acquire com sucesso hoje"; grep por `LogService`, `metric`, `counter` no arquivo = 0 hits (só `console.warn`). Débito herdado — não regressão desta rodada, mas oportunidade barata dado que já se está tocando o arquivo.

### F-fault-tolerance-4: Sem quarantine/backoff — pool que falha na reconstrução é re-tentado a cada `db.query` em loop apertado

- **Severidade**: P3 (baixo — patológico só num modo de falha específico, `new Pool()` síncrono raramente falha)
- **Tactic violada**: Recover State — Quarantine
- **Localização**: `src/backend/services/conexosSessionStore.ts:319-327`
- **Evidência (objetiva)**:
  ```typescript
  // linhas 320-325
  query: (sql, params) => {
      const pool = holder.pool ?? (storeClosed ? undefined : openPool());
      if (!pool) throw new Error('ConexosSessionStore: pool encerrado');
      return pool.query(sql, params as unknown[] | undefined);
  },
  ```
  Cenário patológico: cada `openPool()` cria um Pool (síncrono, quase nunca falha) — mas se o handler `error` disparar assim que o pool tentar conectar (`connectionString` mal-formada, DNS caído), o ciclo vira: query1 → openPool → conecta → error → end → holder.pool=undefined → query2 → openPool → conecta → error → ... Sem backoff, sem contador de tentativas, sem circuit breaker. Cada `db.query` volta a pagar TCP handshake.
- **Impacto técnico**: em modo "DB inacessível", o processo fica gastando FDs e handshakes TCP até o pooler externo (Supabase) começar a rate-limitar. Todos os `acquire()`/`persist()` degradam para null/lost, então o consumidor faz login-por-processo — cascata `MAX_SESSIONS` (ver F-3), agora amplificada pela ausência de pausa.
- **Impacto de negócio**: no cenário "DB Supabase caiu 2 min", contribui para pressão no pooler no momento em que ele está tentando levantar. Marginal.
- **Métrica de baseline**: 0 mecanismos de backoff no arquivo (grep por `RetryExecutor`, `setTimeout`, `backoff`, `attempts` = 0 no arquivo). Aceitável para um pool que raramente falha; questionável se combinado com F-3 (a cascata invisível). P3 isolado; suma junto com F-3 fica P2.

## 5. Cards Kanban

### [fault-tolerance-1] Blindar a trava pós-shutdown contra re-invocação da factory

- **Problema**
  > `buildSessionStoreFromEnv` reseta `storeClosed = false` incondicionalmente na entrada (linha 271). Nenhum caminho de produção hoje chama a factory depois de `closeConexosSessionStorePool()`, mas o invariante "shutdown é terminal" só está garantido pela ausência de chamadas — não pelo código. Um `/reload-config` futuro ou um `container.reset()` num teste E2E reintroduziria pools durante o drain.

- **Melhoria Proposta**
  > Guardar `storeClosed` como estado terminal do processo (ou, alternativamente, mover o `storeClosed=false` para um `resetForTests()` explícito, exportado apenas para o suíte). Tactic Bass: Contain Faults — Reintroduction (Escalating Restart). Arquivo único: `src/backend/services/conexosSessionStore.ts`.

- **Resultado Esperado**
  > Chamar `buildSessionStoreFromEnv()` depois de `closeConexosSessionStorePool()` devolve um store desabilitado (não abre pool novo). Reset explícito continua disponível para tests via helper nomeado. Métrica: "caminhos que podem reabrir pool pós-shutdown" = 1 → 0.

- **Tactic alvo**: Contain Faults — Reintroduction (Escalating Restart)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-1
- **Métricas de sucesso**:
  - Teste `does not reopen a pool after the shutdown …` estendido para cobrir 2ª chamada de `buildSessionStoreFromEnv` pós-shutdown: 1 novo teste verde
  - Caminhos capazes de reabrir pool pós-shutdown: 1 → 0
- **Risco de não fazer**: baixo hoje; invariante frágil que quebra silenciosamente quando alguém adicionar hot-reload
- **Dependências**: nenhuma

### [fault-tolerance-2] Instrumentar contador de eventos do 2º pool para decidir wholesale-rebuild com base em dado

- **Problema**
  > O delta troca "engolir erro" por "encerrar+reconstruir pool inteiro" no `error` do `pg`. O `pg` sozinho apenas remove o cliente ocioso com erro e segue servindo — mais barato. O wholesale rebuild é defensável ("restart do pooler afeta todos os sockets"), mas ninguém sabe se essa é a taxa real de erro em prod. Estamos otimizando para um cenário que pode ou não existir.

- **Melhoria Proposta**
  > Trocar o `console.warn` do handler de `error` por `LogService.warn` com campos estruturados (`event: 'pool_error_rebuild'`, `redactedDetail`), agregável nos drains Render. Depois de 1-2 semanas de coleta, decidir: (a) manter wholesale rebuild se restart do pooler for evento frequente; (b) reverter para `() => undefined` se o `pg` já cobre a maioria. Tactic Bass: Detect Faults — Condition Monitoring.

- **Resultado Esperado**
  > Contador `conexos_session_store_pool_rebuilds_total` (ou linha de log agregável) disponível. Decisão sobre manter/reverter apoiada em número, não em instinto. Métrica: número de eventos `error` por dia = desconhecido → medido; churn de conexões TCP para o pooler = desconhecido → estimável.

- **Tactic alvo**: Detect Faults — Condition Monitoring
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) para instrumentar; +1-2 sem para coletar e decidir
- **Findings relacionados**: F-fault-tolerance-2
- **Métricas de sucesso**:
  - Eventos de rebuild do pool observáveis (contador ou log estruturado): 0 → 1 fonte
  - Latência p95 do primeiro login pós-rebuild: baseline desconhecida → medida
- **Risco de não fazer**: continuar a decidir por instinto quanto agressivo deve ser o handler; nenhum incidente iminente
- **Dependências**: `LogService` disponível para módulos legacy em `services/` (o arquivo lê `process.env` direto, mas nada impede importar `LogService`)

### [fault-tolerance-3] Expor sinal fleet-wide de degradação do store para detectar cascata de MAX_SESSIONS

- **Problema**
  > Toda degradação do store para "miss" (`acquire`/`persist`/`invalidate` catch) grava só `console.warn`. Se o pooler Postgres cair por 5 min afetando N processos simultaneamente, todos degradam, todos fazem seu próprio `POST /login`, e o Conexos entra em `LOGIN_ERROR_MAX_SESSIONS` — cascata kill-oldest. Descobrimos pela consequência (SISPAG parando), não pela causa (store cego). MTTD alto.

- **Melhoria Proposta**
  > Emitir contador `conexos_session_store_degraded_total{op=acquire|persist|invalidate}` ou linha em `alerta.detalhe` quando `acquire()` volta null por erro (não por miss legítima — distinguir os dois casos). Alerta em `>N% em 5 min`. Tactic Bass: Detect Faults — Condition Monitoring. Arquivo: `src/backend/services/conexosSessionStore.ts` (linhas 124-127, 191-194, 209-211).

- **Resultado Esperado**
  > Cascata do store detectada em <2 min via alerta, antes do sintoma no SISPAG. Métrica: MTTD "store degradou fleet-wide" = ~15 min (via `job_execucao.error_message`) → <2 min (via contador direto).

- **Tactic alvo**: Detect Faults — Condition Monitoring
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-3, F-fault-tolerance-4
- **Métricas de sucesso**:
  - Fontes que expõem "% de acquire com sucesso na última hora": 0 → 1
  - MTTD para "pooler DB caiu e todos os processos degradaram": ~15 min → <2 min
- **Risco de não fazer**: em 6 meses, primeiro incidente de pooler-down produz cascata `MAX_SESSIONS` diagnosticada pelos sintomas em SISPAG/Permutas/Recebimentos, com post-mortem que descobre o `console.warn` no stdout Render
- **Dependências**: infra de métricas (Prometheus/`/metrics`) ou reuso de `alerta.detalhe` — depende do que já está de pé neste repo

### [fault-tolerance-4] Quarantine leve — backoff exponencial quando reconstruções sucessivas falharem

- **Problema**
  > `db.query` chama `openPool()` toda vez que `holder.pool` está vazio, sem backoff. No cenário patológico "conexão nunca sobe" (DNS quebrado, credencial girada), cada `acquire()` volta a pagar handshake + auth + `error` + `end`, apertando o pooler exatamente quando ele está frágil. Combinado com F-3 (cascata invisível), amplifica a pressão sobre Conexos e Postgres.

- **Melhoria Proposta**
  > Guardar `lastFailureAt` + contador. Se >K falhas de reconstrução em janela T (ex.: 5 falhas em 30 s), `db.query` retorna "pool indisponível" imediatamente por um cooldown de M segundos (ex.: 30 s), sem tentar `openPool()`. Depois de M, tenta 1 vez; sucesso reseta o contador; falha estende cooldown. Tactic Bass: Recover State — Quarantine. Manter a garantia "nunca lança para o consumidor" (o cooldown degrada silenciosamente para "miss", igual ao já feito).

- **Resultado Esperado**
  > Modo "DB inacessível" para de martelar o pooler. Métrica: tentativas de conexão por segundo em DB-down = ~50/s (uma por `db.query`) → ≤1 por cooldown de 30 s.

- **Tactic alvo**: Recover State — Quarantine
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-fault-tolerance-4, F-fault-tolerance-3
- **Métricas de sucesso**:
  - Tentativas de `openPool` por segundo em modo DB-down: N (~ QPS de login) → ≤1/cooldown
  - Novos testes cobrindo cooldown: 0 → 2 (entra em cooldown; sai depois de M)
- **Risco de não fazer**: negligível em regime normal; contribui para pressão no pooler durante incidentes
- **Dependências**: card `fault-tolerance-3` (o contador de degradação alimenta o mesmo timer)

## 6. Notas do agente

- **Escopo cumprido**: restrito ao par `conexosSessionStore.ts` + `conexosSessionStorePool.test.ts`. Migração para DDD marcada como fora de escopo por decisão do coordenador (BE-11 de outra revisão) — não citada como violação.
- **Julgamentos diretos aos 4 pontos do prompt**:
  1. **Reconstrução preguiçosa correta?** Sim. Não há janela de corrida real: `openPool()` é 100% síncrono (`new Pool()` + atribuição a `holder.pool`), Node single-thread serializa dois `db.query` "concorrentes". O primeiro cria e assina, o segundo já lê o slot cheio. Testado (linhas 76-89).
  2. **Trava `storeClosed` suficiente?** Suficiente para o caminho de produção (singleton no import — chamado 1×). Fraca contra re-invocação da factory pós-shutdown porque `storeClosed=false` é resetado incondicionalmente. Latente hoje (F-1).
  3. **É teatro?** Parcialmente. O `pg` **se cura sozinho** de erro em cliente ocioso (remove o cliente, segue servindo). O wholesale `end()+rebuild` é defensável se o cenário dominante for restart do pooler Supabase (todos os sockets ficam rançosos); é churn se o dominante for socket-ocioso isolado. Ninguém sabe qual é o dominante em prod porque não medimos (F-2). A honestidade que o prompt pediu: se o único ganho for "warn visível", isso poderia ter sido feito **sem** o `end()+rebuild` — bastava `console.warn` no listener `() => undefined` original. O `end()+rebuild` é decisão defensável, mas não instrumentada.
  4. **Cascata de MAX_SESSIONS após reconstrução malsucedida?** Sim, existe — mas **não é introduzida por este delta**. É a mesma cascata que existe sempre que o store degrada (modo `disabled` sem DB, modo miss por catch). Este delta melhora vs. o commit anterior (`2623fa9`, que deixava o store permanentemente cego); iguala ao `() => undefined` original. F-3+F-4 propõem sinal + quarantine para o caso sistêmico.
- **Cross-QA (para o consolidator)**:
  - Availability — mesmo arquivo tem `connectionTimeoutMillis`/`idleTimeoutMillis` (timeouts) e o handler `error` (bulkhead do 2º pool contra o 1º); overlap com card `availability-*` se existir.
  - Integrability — este delta corrige `integrability-2` da rodada `2026-09-03-1901`; o teste explicita isso no `describe` (linha 32).
  - Security — `redactErrorMessage` no `console.warn` (linha 307) coordena com `security-*` (não gravar credencial em stdout/painel).
  - Testability — os 3 testes novos (rebuild, warn redigido, no-reopen pós-shutdown) elevam a cobertura de branches do arquivo; F-1 pede +1 teste, cards `fault-tolerance-1/4` pedem outros +3.
