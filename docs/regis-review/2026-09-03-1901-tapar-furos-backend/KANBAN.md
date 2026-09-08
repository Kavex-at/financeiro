---
type: regis-review-kanban
run_id: 2026-09-03-1901-tapar-furos-backend
total: 24
counts: { p0: 0, p1: 1, p2: 11, p3: 12 }
---

# Kanban — financeiro — 2026-09-03-1901-tapar-furos-backend

> Importável para o Kanban do time. Cada card abaixo já tem Problema / Melhoria Proposta / Resultado Esperado.
> Ordem: **P0 (nenhum) → P1 (S → XL) → P2 (S → XL) → P3 (S → XL)**.
> IDs preservados 1:1 das seções QA. Nenhum card foi renomeado ou editado.

---

## P0 — Crítico

_Nenhum card P0 neste run._ Os três furos que motivaram o tweak (BE-05, BE-06, BE-09) foram
corrigidos e verificados por teste. O gate do pipeline passa.

---

## P1 — Alto

### [integrability-2] Encerrar o pool secundário do `conexosSessionStore` no shutdown gracioso

**QA**: Integrability
**Tactic alvo**: Manage Resources; Abstract Common Services
**Esforço**: S
**Findings**: F-integrability-2

**Problema**
> `src/backend/services/conexosSessionStore.ts:242-256` cria um segundo `Pool` Postgres (`max: 2`) no load do módulo, com handler de `error` `() => undefined` — literalmente a forma que o BE-05 demonstrou ser insuficiente. Esse pool não é conhecido pelo `PostgreeDatabaseClient` nem pelo `gracefulShutdown`, então cada SIGTERM deixa até 2 sessões penduradas no pooler Supabase até o `idleTimeoutMillis` (10s), somando-se ao pico do primário.

**Melhoria Proposta**
> Envolver o pool do session store num client `@singleton @injectable` (ex.: `ConexosSessionPoolClient` ou expor `close()` no próprio `conexosSessionStore` singleton) que implemente `IClient` (uma vez pronto o card integrability-1). O `gracefulShutdown` fecha os dois em paralelo. Aplicar a mesma correção do BE-05 no handler de `error`: chamar `pool.end()` com guarda de reentrada, não só `() => undefined`. Tactic: **Manage Resources** + **Abstract Common Services**.

**Resultado Esperado**
> Pools Postgres coordenados no shutdown: **1 de 2 → 2 de 2**. Handler de `error` do pool secundário chama `end()`: **Não → Sim**. Sessões deixadas penduradas por deploy: **até 2 → 0**.

**Métricas de sucesso**
- Pools Postgres cobertos por `close()` no SIGTERM: 1 → 2
- Handler `error` do pool do session store chama `end()`: Não → Sim
- Sessões residuais por deploy (`pg_stat_activity` do Supabase, janela do SIGTERM): coletar baseline e validar → 0

**Risco de não fazer**
> O mesmo laço de retro-alimentação do BE-05 (esgotamento de conexões → erro tratado como transitório → mais conexões) permanece armado no pool secundário. Menos provável de gatilhar (max=2 vs max=5), mas o modo de falha está aberto.

**Dependências**: idealmente após integrability-1 (para plugar no `LifecycleRegistry`), mas pode ser feito antes com wire manual no `index.ts`.

---

## P2 — Médio

### [availability-1] Sinalizar readiness=false no `/health` durante o shutdown

**QA**: Availability
**Tactic alvo**: Removal from Service
**Esforço**: S
**Findings**: F-availability-1 (também cobre F-deployability-1)

**Problema**
> `/health` (rota do LB do Render, `healthCheckPath: /health` em `render.yaml:22`) continua devolvendo 200 depois que o SIGTERM chega, porque a flag `shuttingDown` vive num closure isolado no `gracefulShutdown.ts` (`src/backend/http/gracefulShutdown.ts:52-61`). Sem sinal de readiness, o LB pode roteirizar novas requisições por conexões keep-alive já abertas dentro da janela de drain, e uma delas pode cair exatamente na fatia crítica `createRun → finishRun` do SISPAG — que é o que o delta veio evitar.

**Melhoria Proposta**
> Expor a flag de shutdown como módulo (ex.: `http/readinessState.ts` com `isDraining()` e `markDraining()`), chamar `markDraining()` no início do handler (`gracefulShutdown.ts:60-61`) **antes** do `server.close`, e fazer `/health` (`index.ts:79`) retornar 503 quando `isDraining()`. Manter `/health/pipelines` como está (a sonda existente para pipelines não deve carregar responsabilidade do estado do processo).

**Resultado Esperado**
> `/health` devolve 503 durante todo o drain; o LB do Render tira a instância do pool antes de qualquer requisição nova entrar. Contagem de execuções órfãs em `reconciling` atribuíveis a deploy vai para 0 (hoje só sabemos que o reaper limpa, não quantos vieram de deploy).

**Métricas de sucesso**
- Endpoints que expõem estado de drain: 0 → 1 (`/health`)
- Requisições HTTP recebidas entre `[shutdown] SIGTERM recebido` e `[shutdown] server.close` em produção: baseline a instrumentar → 0

**Risco de não fazer**
> A fatia da janela em que o LB ainda roteia mantém o vetor do BE-06 vivo em versão diluída — o reaper continua sendo necessário como rede final para o caso "deploy no meio de uma request".

**Dependências**: nenhuma (não requer mudança de infra; o `healthCheckPath` já aponta para `/health`).

---

### [availability-2] Fechar conexões keep-alive ociosas no início do drain

**QA**: Availability
**Tactic alvo**: Removal from Service
**Esforço**: S
**Findings**: F-availability-2

**Problema**
> `server.close(callback)` só chama o callback quando **todas** as conexões TCP fecharam, inclusive keep-alive ociosas. Como o LB do Render costuma manter keep-alive, o `server.close` de `src/backend/http/gracefulShutdown.ts:98-101` tende a estourar os 10s e sempre cair no force-exit — tornando o caminho feliz do drain indistinguível do timeout.

**Melhoria Proposta**
> Chamar `server.closeIdleConnections()` (Node ≥18.2) **antes** do `server.close(callback)` para liberar keep-alive sem requisição em voo. Opcional: agendar `server.closeAllConnections()` alguns segundos antes do force-exit (ex.: 8s) como escalation controlada, em vez de deixar o `exitOnce` cortar. O `package.json` já é ESM TypeScript; a API está disponível sem dependência nova.

**Resultado Esperado**
> No caso comum (sem requisição em voo), o drain termina em ~100ms em vez de sempre 10s. `[shutdown] drenagem excedeu 10000ms` deixa de ser o log dominante de shutdown.

**Métricas de sucesso**
- Uso de `closeIdleConnections`: 0 → 1 chamada no drain
- % de shutdowns que terminam por force-exit em vez de drain completo: baseline a instrumentar → <10%

**Risco de não fazer**
> Cada deploy vira, na prática, um teste do force-exit — que existe como rede de segurança, não como caminho principal. Perde-se a evidência de que o drain está funcionando quando o dia em que ele **precisar** funcionar chegar.

**Dependências**: idealmente entra depois de [availability-1], para o LB ter parado de mandar tráfego antes das keep-alive serem cortadas.

---

### [deployability-2] Escrever runbook de rollback em `docs/runbooks/rollback.md`

**QA**: Deployability
**Tactic alvo**: Rollback
**Esforço**: S
**Findings**: F-deployability-2

**Problema**
> `render.yaml` declara `autoDeploy: true` — cada push em `main` sobe. Quando um deploy passa CI mas quebra em produção (cenário típico — Conexos/Supabase só aparecem em prod), o operador precisa reverter pelo dashboard do Render sem passo-a-passo escrito. Sob pressão, é onde se erra.

**Melhoria Proposta**
> Criar `docs/runbooks/rollback.md` documentando: (1) como localizar o deploy anterior no dashboard, (2) o botão exato de "Rollback to this deploy", (3) o que fazer com migrations irreversíveis (a Frente IV vem escrevendo em tabelas novas — reverter código sem reverter schema é seguro; o contrário não é), (4) como validar o rollback via `/health` e `/health/pipelines`, (5) quando escalar. Referência cruzada em `DEPLOY.md`.

**Resultado Esperado**
> Operador consegue reverter deploy quebrado em ≤ 5 min sem consultar terceiros. MTTR de incidente pós-deploy cai.

**Métricas de sucesso**
- runbooks de rollback: 0 → 1
- referências cruzadas em `DEPLOY.md`: 0 → 1

**Risco de não fazer**
> No próximo deploy que quebrar em prod (só é questão de tempo), o operador improvisa. Improvisação em migração de schema é como se descobre corrupção de dados.

**Dependências**: nenhuma.

---

### [deployability-3] Resolver a divergência `render.yaml` × dashboard (pre-deploy órfão)

**QA**: Deployability
**Tactic alvo**: Script Deployment Commands
**Esforço**: S (opção b) / M (opção a)
**Findings**: F-deployability-3

**Problema**
> `render.yaml:24` declara `preDeployCommand: npm run migrate && npm run seed:admin`, mas conforme docstring em `src/backend/index.ts:120-133`, o pre-deploy nunca roda (serviço criado pelo dashboard; pre-deploy é feature de plano pago). A mitigação é o `BootMigrator` no `start()`. Duas fontes discordantes = próximo dev que "limpar" o boot pode remover o `BootMigrator` acreditando que o Render cobre.

**Melhoria Proposta**
> Duas opções: (a) upgrade do plano do Render para habilitar `preDeployCommand` e remover `BootMigrator` do `start()`, virando arquitetura declarativa; (b) remover a linha do `render.yaml` e adicionar comentário explícito de que migrations rodam no boot via `BootMigrator`, apontando para a docstring. A opção (b) é sem custo e alinha as duas fontes; a (a) é a solução "certa" quando o volume justificar.

**Resultado Esperado**
> Uma única fonte da verdade sobre "quando as migrations rodam". Blueprint e código concordam.

**Métricas de sucesso**
- fontes divergentes sobre migração: 2 → 1
- comentário em `render.yaml` apontando para `BootMigrator`: ausente → presente (se opção b)

**Risco de não fazer**
> Dívida documental. Fica em P2 porque não é regressão ativa — a mitigação (BootMigrator) já está no lugar e coberta por `_shared-metrics.md` (typecheck/lint/test verdes). É o tipo de dívida que morde 6 meses depois quando alguém "otimiza".

**Dependências**: nenhuma.

---

### [integrability-1] Promover `close()` opcional ao contrato `IClient` e registrar clients em coleção

**QA**: Integrability
**Tactic alvo**: Adhere to Standards; Manage Resource Coupling
**Esforço**: S
**Findings**: F-integrability-1

**Problema**
> O contrato `IClient` (`src/backend/domain/core/client/IClient.ts`) declara só `init()`. O `close()` do `PostgreeDatabaseClient` é convenção do delta, e o shutdown em `src/backend/index.ts:161` referencia a classe concreta (`container.resolve(PostgreeDatabaseClient).close()`). Cada novo client que segure recurso (Nexxera, GED, o segundo pool Postgres) vira uma edição pontual do `index.ts` — que estatisticamente vai ser esquecida, como já foi para o `conexosSessionStore`.

**Melhoria Proposta**
> Estender `IClient` com `close?(): Promise<void>` (opcional para não quebrar clients sem recurso). Introduzir um `LifecycleRegistry` (nome sugerido) ou uma lista `clientsWithLifecycle: IClient[]` resolvida via container; `registerGracefulShutdown` passa a receber `closeAll: () => Promise.all(clients.map(c => c.close?.()))` em vez do `closePool` singular. Fazer `PostgreeDatabaseClient` e o novo wrapper do pool do session store (ver card integrability-2) implementarem o contrato. Tactic: **Adhere to Standards** + **Manage Resource Coupling**.

**Resultado Esperado**
> `index.ts` deixa de importar `PostgreeDatabaseClient` no wire de shutdown. Adicionar `NexxeraClient` que implemente `IClient.close()` participa automaticamente do shutdown. Métrica: contrato `IClient` cobre ciclo de vida completo (**Não → Sim**); clients com `implements IClient` **1 → ≥ 2** (Postgres + wrapper do session store); acoplamento do shutdown ao client concreto **direto → via coleção**.

**Métricas de sucesso**
- Clients com ciclo de vida no contrato: 1 → ≥ 2
- Referências ao `PostgreeDatabaseClient` no `index.ts`: 2 → 0 (só via container e sem `.close()` direto)

**Risco de não fazer**
> Cada uma das 3 integrações previstas (Nexxera, GED, SharePoint) vai negociar seu próprio padrão de shutdown; uma delas vai esquecer e virar o próximo BE-05.

**Dependências**: nenhuma — pode ser feito antes ou depois de integrability-2, mas integrability-2 fica trivial com este pronto.

---

### [performance-1] Documentar e monitorar o teto de sessões Supabase por processo

**QA**: Performance
**Tactic alvo**: Manage Resources — Increase Concurrency
**Esforço**: S
**Findings**: F-performance-2

**Problema**
> Depois do fix do BE-05 o pool para de vazar, mas o teto do Supabase (`max_client_conn` do Session pooler) permanece invisível para quem lê `DEPLOY.md`. Com 6 crons + Web Service a `poolMaxConnections=5` já reserva até 35 sessões teóricas; um bump futuro pode estourar o plano sem alarme.

**Melhoria Proposta**
> Registrar em `DEPLOY.md §1` o Pool size configurado no Supavisor (print do dashboard) e a conta `Σ (processos × poolMaxConnections)` como budget. Complementar com um probe em `/health` (ou seção nova em `/operacao`) que faça `SELECT sum(numbackends) FROM pg_stat_database` e alerte acima de 70% do teto. Tactic: **Manage Resources — Increase Concurrency** (documentar headroom antes de precisar).

**Resultado Esperado**
> `DEPLOY.md` documenta budget = X sessões, teto = Y sessões, uso atual = Z; painel de operação exibe `sessoes_ativas / sessoes_teto`. Métrica: **budget documentado = 0 → 1** e **alerta acima de 70% do teto: ausente → presente**.

**Métricas de sucesso**
- Budget de sessões documentado em `DEPLOY.md`: **0 → 1 tabela**
- Alerta `sessoes_ativas > 0.7 × teto`: **ausente → presente**
- `poolMaxConnections` justificado com cálculo (não só `≥3 (P0-6)`): **1 comentário → 1 comentário + tabela**

**Risco de não fazer**
> Primeiro sintoma de saturação continua a ser 5xx mascarado por 3 retries — o mesmo padrão que escondia o BE-05. Fica olhando para o painel Supabase manualmente em incidente.

**Dependências**: nenhuma (leitura direta do `pg_stat_database`).

---

### [fault-tolerance-1] Elevar o teto de drenagem para ~25 s e amarrar aos timeouts dos clientes

**QA**: Fault Tolerance
**Tactic alvo**: Timeout
**Esforço**: S
**Findings**: F-fault-tolerance-1

**Problema**
> O teto de drenagem de 10 s consome só 1/3 do envelope de 30 s que o Render dá entre `SIGTERM` e `SIGKILL`. Uma requisição de `POST /sispag/remessa/gerar` que dure entre 10 s e ~28 s (envelope plausível quando o Conexos está fazendo fila nos ~3 slots de sessão) é força-cortada pelo próprio handler, virando o mesmo órfão `reconciling` que o BE-06 existe para eliminar — apenas com log de "drenagem excedeu" em vez de morte silenciosa.

**Melhoria Proposta**
> Subir `DEFAULT_DRAIN_TIMEOUT_MS` para 25 000 ms (deixa 5 s de folga para o `pool.end()` e a saída limpa antes do `SIGKILL`). Em paralelo, adicionar `timeout: 20_000` ao `axios.create` de `ConexosSispagWriteClient`, `ConexosBaixaClient`, `ConexosFin014Client` e `ConexosSispagClient` — sem isso, um socket pendurado em Conexos pode ultrapassar até o novo teto e ainda reproduzir o órfão. Manter os dois números coerentes (`drainTimeoutMs = maior_axios_timeout + 5_000`).

**Resultado Esperado**
> Percentual do envelope Render aproveitado: **33% → 83%**. Janela de requisições financeiras que o drain força-corta cai para o subconjunto que exceder 25 s (raro em operação normal, e nesse ponto o Conexos já teria estourado o próprio timeout do axios).

**Métricas de sucesso**
- `DEFAULT_DRAIN_TIMEOUT_MS`: 10 000 → 25 000
- Clientes Conexos com `timeout:` explícito: 0/4 → 4/4 (cross-ref Availability)
- Envelope Render usado: 33% → 83%

**Risco de não fazer**
> Em janelas de deploy no meio do expediente, requisições de escrita financeira próximas ao `settle` continuam sendo cortadas — o BE-06 cobre a maioria dos casos, mas deixa o long-tail para o reaper resolver. Custo: 1 lote órfão no `fin015` por deploy sob carga (frequência estimada, requer produção para confirmar).

**Dependências**: nenhuma; o handler já aceita `drainTimeoutMs` por parâmetro.

---

### [fault-tolerance-2] Emitir alerta estruturado quando a drenagem estourar o teto

**QA**: Fault Tolerance
**Tactic alvo**: Condition Monitoring
**Esforço**: S
**Findings**: F-fault-tolerance-2

**Problema**
> A saída forçada do handler ("drenagem excedeu 10000ms") só imprime em `console.log` e sai com código 0. Uma rota que **sempre** ultrapassa o drain (regressão de performance, deadlock em cliente Conexos) faria toda restart truncar requisições em voo com zero visibilidade no painel `/operacao`, no `job_execucao` ou na tabela `alerta`. O ADR-0042 gastou um workflow inteiro para não deixar falhas invisíveis; esta é uma reintrodução da mesma categoria dentro do delta que devia melhorá-la.

**Melhoria Proposta**
> Antes do `deps.onExit(0)` no caminho de force-exit, resolver o `LogService` do container (o handler já roda com `reflect-metadata` importado no boot) e emitir `logService.warn({ type: LOG_TYPE.OPERATIONAL_WARN, message: 'shutdown force-exit — drenagem excedeu teto', data: { drainTimeoutMs, reason } })`. Alternativa mais leve (mantém a injeção pura): expor um callback `onForceExit?: (reason: string) => Promise<void>` na `GracefulShutdownDeps` e amarrar no `index.ts`. Deixar o código de saída em 0 (justificativa do delta segue válida — não é falha, é orçamento estourado); o sinal vai pelo canal certo.

**Resultado Esperado**
> Todo force-exit por drain aparece no painel de operação como `OPERATIONAL_WARN`, participa da dedupe por janela do `AlertaService` e produz uma linha rastreável em `log`. Detecção de regressão de performance de escrita financeira passa de "ninguém percebe" para "aparece no primeiro deploy pós-regressão".

**Métricas de sucesso**
- Canais estruturados para "force-exit por drain": 0 → 1
- Latência entre force-exit e alerta visível em `/operacao`: indeterminada (só log stdout) → ≤ próximo `refresh` do painel

**Risco de não fazer**
> Regressão de performance de escrita financeira só é detectada por subida indireta de linhas em `reconciling`, com atraso de 15 min a 1 h. Custo em um deploy patológico: N órfãos por instância x deploys.

**Dependências**: nenhuma; `LogService` é `@singleton()` e já é resolvível no boot.

---

### [security-1] Aplicar `redactErrorMessage` no log de falha do shutdown

**QA**: Security
**Tactic alvo**: Limit Access
**Esforço**: S (≤1h — 1 linha de código + 1 teste)
**Findings**: F-security-1

**Problema**
> O novo `gracefulShutdown.ts:94` loga `falha ao encerrar o pool: ${error.message}` direto no `console.log`. O `pg`, ao rejeitar `pool.end()` sobre um pool já quebrado, pode trazer nome de usuário do Postgres, host interno do Supabase ou até connection string embrulhada. O drain de logs do Render sai do perímetro do processo (pode ir para agregador SaaS terceiro), então o que aparece no stdout é o que efetivamente escapa.

**Melhoria Proposta**
> Importar `redactErrorMessage` de `../http/redact.js` (mesmo padrão já usado em `JobExecucaoRepository.ts:92` e `StalenessDetector.ts:165`) e envolver `asMessage(error)`: `log(\`[shutdown] falha ao encerrar o pool: ${redactErrorMessage(asMessage(error))}\`)`. Adicionar um teste em `gracefulShutdown.test.ts` que injeta um erro cuja `.message` contém `password authentication failed for user "financeiro"` e assertar que o log final contém `[REDACTED]`. Tactic Bass: Limit Access (redação antes da saída).

**Resultado Esperado**
> Nenhuma credencial, host interno ou connection string escapa via drain de logs do Render no caminho de shutdown com pool quebrado. Métrica: 0 de 1 → 1 de 1 caminhos de log de erro no `http/` aplicam `redactErrorMessage`.

**Métricas de sucesso**
- Caminhos de log de erro em `http/` sem redator: 1 → 0
- Teste `gracefulShutdown.test.ts` cobrindo o cenário `password authentication failed`: ausente → presente

**Risco de não fazer**
> Em 6 meses o padrão inconsistente ("uns redigem, outros não") normaliza, e o próximo `console.log` de erro em novo módulo `http/` também esquece. Ao mesmo tempo aparece em post-mortem um trecho de log com nome de usuário do banco vazado para um agregador SaaS.

**Dependências**: nenhuma.

---

### [testability-1] Cobrir os 3 branches "reais" descobertos em `gracefulShutdown.ts`

**QA**: Testability
**Tactic alvo**: Executable Assertions, Specialize Access Routes/Interfaces
**Esforço**: S (≤ 1d)
**Findings**: F-testability-1, F-testability-2, F-testability-5

**Problema**
> A cobertura de branches ficou em 58,82% (10/17) no módulo novo. Duas ramificações importam: (a) o callback de `server.close` sendo chamado com `err` — hoje 0 dos 8 testes exercita esse caminho; (b) o `exitOnce` sendo chamado duas vezes por uma race entre a drenagem e o `setTimeout` — a guarda `if (exited) return` nunca é hit. Um teste de smoke que exercite o wire real com `process.on('SIGTERM')` fecha a 3ª (default `target = process`).

**Melhoria Proposta**
> Adicionar 3 casos em `http/gracefulShutdown.test.ts`:
> 1. `handles server.close reporting an error while still draining` — passar `cb(new Error('EADDRINUSE'))` no fake e assertar que o log contém `"server.close reportou"` e que `drain` roda mesmo assim;
> 2. `exit is idempotent when timer fires after drain completes` — controlar o fake de `server.close` para chamar `cb` **após** `advanceTimersByTimeAsync(drainTimeoutMs)` e assertar `onExit` chamado exatamente 1×;
> 3. Smoke E2E via `child_process.fork` de um `fixtures/graceful-shutdown-child.ts` que registra o handler com `target = process` real, envio de `SIGTERM` pelo pai, e assert de exit code 0 dentro de 500ms. Tactic Bass alvo: **Executable Assertions** (para 1 e 2) + **Specialize Access Routes** (para 3).

**Resultado Esperado**
> Branches em `http/gracefulShutdown.ts` sobem de **58,82% (10/17)** para **≥ 82% (14/17)**. Os 3 branches com impacto real cobertos; os 3 restantes (`log` default, `unref` ausente, `forceExitTimer` falsy) permanecem justificáveis como dead code ou fora do runtime.

**Métricas de sucesso**
- Branches `gracefulShutdown.ts`: 58,82% → ≥ 82%
- Testes no arquivo: 8 → 11
- Branches "reais" descobertos (excluindo dead code): 3 → 0

**Risco de não fazer**
> O handler pode ser refatorado com regressões silenciosas — chamar `onExit` 2× em produção, ou perder o log de `server.close` erro que existiria para diagnosticar um SIGKILL. Pequeno em blast radius, mas exatamente o tipo de bug que só aparece durante um incidente.

**Dependências**: nenhuma.

---

### [testability-2] Extrair `start()` do `index.ts` para módulo testável

**QA**: Testability
**Tactic alvo**: Limit Structural Complexity, Executable Assertions
**Esforço**: M (2-3d)
**Findings**: F-testability-3 (também endereça F-modifiability-3)

**Problema**
> O delta corretamente extraiu `registerGracefulShutdown` para módulo próprio justificando na docstring que `index.ts` dispara `start()` no `import`. Mas o `start()` em si permanece monolítico e não testado: 5 passos ordenados (register MIGRATION_RUNNER_TOKEN → BootMigrator → diagnosticarConfiguracao → app.listen → registerGracefulShutdown) cuja ordem já causou incidente em 2026-08-10 (`index.ts:159`, "código da ADR-0032 chegou a produção antes da 0044"). Zero cobertura em `src/backend/index.ts`.

**Melhoria Proposta**
> Extrair `start()` para `src/backend/http/bootstrap.ts` com assinatura `startServer(deps: BootstrapDeps): Promise<{ close: () => Promise<void> }>` — `deps` traz `container`, `port`, `listen: (app, port, cb) => Server`, `runMigrations`, `diagnose`. `index.ts` fica com apenas o topo (`import`s + `void startServer({...}).catch(...)`). Escrever `bootstrap.test.ts` que valida a **ordem** dos passos com um `order: string[]` (mesmo padrão do `gracefulShutdown.test.ts` linhas 44-55). Tactic Bass alvo: **Limit Structural Complexity** + **Executable Assertions** para a ordem.

**Resultado Esperado**
> `src/backend/index.ts` reduz de ~180 linhas com boot embutido para ~30 linhas de wiring puro. `src/backend/http/bootstrap.ts` nasce com ≥ 4 testes (ordem correta, falha em migração aborta antes do listen, `diagnosticarConfiguracao` roda depois das migrations, shutdown é registrado após listen). Cobertura de `index.ts` continua irrelevante (só imports), mas a **sequência de boot** deixa de ser invariante-documentada-sem-teste.

**Métricas de sucesso**
- Testes cobrindo a ordem do boot: 0 → ≥ 4
- Passos do boot fora de teste: 5 → 0
- LOC de `src/backend/index.ts`: ~180 → ≤ 40 (só wiring)

**Risco de não fazer**
> Repetição do padrão do incidente 2026-08-10 — a próxima reordenação inadvertida dos passos de boot (mover `diagnose` para antes de `migrate`, mover `listen` para antes de `migrate`, etc.) só é pega em produção.

**Dependências**: nenhuma. Alinha com card `modifiability-3` que também deve atacar `index.ts`.

---

## P3 — Baixo

### [availability-3] Instrumentar duração do drain e frequência de force-exit

**QA**: Availability
**Tactic alvo**: Monitor
**Esforço**: M (2–5d — a tabela e o painel são novos)
**Findings**: F-availability-3

**Problema**
> Os 4 logs `[shutdown] ...` (`gracefulShutdown.ts:61,74-76,90-93,97`) contam a história por deploy, mas não viram métrica agregada. O valor de `DEFAULT_DRAIN_TIMEOUT_MS = 10_000` foi escolhido contra uma janela SIGTERM→SIGKILL declarada como "~30s" em comentário (`gracefulShutdown.ts:22-25`), não verificada aqui. Sem série temporal, não há como saber se o timeout está calibrado ou se a plataforma mudou.

**Melhoria Proposta**
> (a) Registrar `duracao_drain_ms` numa tabela `shutdown_event` ao final de cada shutdown (mesmo padrão do `job_run`), incluindo `signal`, `motivo_saida` (`drenado` | `timeout` | `erro_pool`), `pid`, `versao`. (b) Adicionar linha ao painel de operação mostrando os últimos N shutdowns. (c) Documentar a janela real do Render (consultar docs oficiais ou medir com um deploy artificial que loga `Date.now()` em teste controlado).

**Resultado Esperado**
> Painel mostra distribuição do `duracao_drain_ms` e taxa de force-exit; se a taxa passar de X% ou a média encostar no teto, disparar revisão. `DEFAULT_DRAIN_TIMEOUT_MS` deixa de ser palpite defensável e vira decisão calibrada.

**Métricas de sucesso**
- Métricas de shutdown exportadas: 0 → ≥3 (`duracao_drain_ms`, `motivo_saida`, contagem/deploy)
- Janela SIGTERM→SIGKILL do Render: valor documentado (com fonte) → substituindo o comentário atual em `gracefulShutdown.ts:22-25`

**Risco de não fazer**
> Calibração cega. Se o Render reduzir a janela ou se o drain começar a estourar por regressão, o time só descobre por chamado.

**Dependências**: [availability-1] e [availability-2] fecham o loop — instrumentar antes de melhorar dá baseline; instrumentar depois valida.

---

### [deployability-1] Marcar `/health` como `503` durante a janela de drain

**QA**: Deployability
**Tactic alvo**: Health Check + Manage Service Interactions
**Esforço**: S (≤1d)
**Findings**: F-deployability-1

**Problema**
> Após o SIGTERM, `server.close` pára de aceitar conexões novas, mas `/health` (rota mais alta no `index.ts`) continua respondendo 200 até o event loop terminar. Na topologia atual do Render (single-instance, plano starter), isso é inofensivo porque o orquestrador só faz cutover quando o novo container está verde; a rota respondendo 200 no antigo é ignorada. Vira problema **no dia** em que houver segunda réplica ou LB externo probando `/health` — o probe não saberia que este pod está morrendo.

**Melhoria Proposta**
> Expor uma flag `isShuttingDown()` do módulo `gracefulShutdown.ts` e consultá-la no handler de `/health` (`index.ts:82`); devolver `503 {status:'draining'}` quando ligada. Custo: 1 export, 1 `if` no handler, 2 testes (um pré-drain, um pós-drain). Mantém a rota barata (sem I/O) e alinhada à tactic Health Check da Bass.

**Resultado Esperado**
> Probe de LB consegue tirar o pod do pool em drain ANTES do `SIGKILL`, sem tráfego novo bater em um servidor que já não aceita conexões. Métrica: 0 → 100% dos deploys onde `/health` sinaliza `503` durante os 10s de drain.

**Métricas de sucesso**
- status HTTP de `/health` durante drain: `200` → `503`
- cobertura do novo caminho: 0 → ≥ 1 teste unitário

**Risco de não fazer**
> Nulo na topologia atual; latente para o dia do upgrade de plano. Se ninguém lembrar, o primeiro deploy multi-réplica manda tráfego para o pod moribundo.

**Dependências**: nenhuma. (Nota do consolidator: causa raiz coberta pelo `[availability-1]` acima — se `availability-1` for feito primeiro, este card fica satisfeito automaticamente.)

---

### [integrability-3] Documentar (ou implementar) por que a sessão do Conexos NÃO é encerrada no SIGTERM

**QA**: Integrability
**Tactic alvo**: Adhere to Standards
**Esforço**: S (≤1d — 6 linhas de comentário + link)
**Findings**: F-integrability-3

**Problema**
> O `registerGracefulShutdown` em `src/backend/index.ts:159-163` só fecha o Postgres — nem `ConexosBaseClient` nem o `services/conexos.ts` (que segura `sid`, `sidExpiresAt`) recebem sinal. A decisão é intencional (o `conexosSessionStore` compartilha o `sid` entre processos; um logout defensivo invalidaria a sessão dos outros), mas essa razão só vive no docstring do session store, longe do ponto onde alguém *não* deslogou.

**Melhoria Proposta**
> Adicionar comentário no `index.ts` (ao lado do `registerGracefulShutdown`) explicando explicitamente que a sessão Conexos é compartilhada por design e **não deve** ser encerrada no SIGTERM — apontando para `services/conexosSessionStore.ts`. Alternativa (não recomendada agora): implementar um `logout` cliente que só rode quando `sessionStore.enabled === false` (dev local sem banco). Tactic: **Adhere to Standards** (documentar o contrato de shutdown de cada integração).

**Resultado Esperado**
> Um leitor do `index.ts` entende, no ponto onde a pergunta nasce, por que só o Postgres fecha. Zero risco de alguém adicionar um "logout defensivo" que quebre a sessão compartilhada.

**Métricas de sucesso**
- Comentários em `index.ts` explicando a exclusão do Conexos do shutdown: 0 → 1

**Risco de não fazer**
> Baixo. Estatisticamente, 1 revisor confuso por trimestre; risco secundário de alguém "consertar" a omissão e quebrar a sessão compartilhada.

**Dependências**: nenhuma.

---

### [modifiability-1] Extrair `endPoolQuietly(pool)` privado no `PostgreeDatabaseClient`

**QA**: Modifiability
**Tactic alvo**: Abstract Common Services
**Esforço**: S (≤1d)
**Findings**: F-modifiability-1

**Problema**
> O idiom "chamar `pool.end()` e engolir rejeição" aparece em 2 sítios do `PostgreeDatabaseClient` (handler `error` L82–93 e `close()` L106–117). Semanticamente próximos, com um pequeno delta (o handler tem guarda de reentrada e de identidade que o `close()` não precisa). Se a política de logging do erro do `end` mudar, é preciso lembrar dos dois pontos.

**Melhoria Proposta**
> Extrair um método privado `endPoolQuietly = async (pool: Pool): Promise<void>` que faz o `try { await pool.end() } catch {}`. Manter as guardas de reentrada e de identidade no handler `error` — elas são responsabilidade do sítio, não do helper. Tactic: **Abstract Common Services** (Bass).

**Resultado Esperado**
> 1 sítio de `try/catch` sobre `pool.end()` em vez de 2. Mudança futura na política de log passa por 1 método.

**Métricas de sucesso**
- Sítios com `try/catch` silencioso sobre `pool.end()`: 2 → 1
- LOC do arquivo: 248 → ≤248 (extração deve ficar neutra)

**Risco de não fazer**
> Se em 6 meses a política de log do `end` mudar (por exemplo, o Painel de Operação passar a querer registrar quando o pool morreu por conta própria), a mudança em dois pontos é candidata a esquecimento — o handler `error` é mais raro de exercitar, então é o que fica desatualizado.

**Dependências**: nenhuma.

---

### [modifiability-2] Amarrar `drainTimeoutMs` do shutdown ao `process.env`

**QA**: Modifiability
**Tactic alvo**: Defer Binding (configuration files)
**Esforço**: S (≤1d — 3 linhas em `index.ts` + doc no README/CHANGELOG)
**Findings**: F-modifiability-2

**Problema**
> `DEFAULT_DRAIN_TIMEOUT_MS = 10_000` é constante exportada; `index.ts` não injeta um valor de env, então o teto é hardcoded. O contrato (`GracefulShutdownDeps.drainTimeoutMs?: number`) já permite injeção — falta a leitura no boot. Se o Render mudar sua janela SIGTERM→SIGKILL (hoje ~30s) ou se o SaaSo colocar a app em outro runtime, é edição de código + release.

**Melhoria Proposta**
> No `index.ts`, ler `process.env.SHUTDOWN_DRAIN_MS` (via `EnvironmentProvider` ou parse local com fallback para `DEFAULT_DRAIN_TIMEOUT_MS`) e passar em `registerGracefulShutdown({ ..., drainTimeoutMs })`. Tactic: **Defer Binding** (configuration files).

**Resultado Esperado**
> Janela de drenagem configurável por env sem redeploy de código. Overlap com **Deployability**: cada mudança de janela deixa de exigir um `chore(release)`.

**Métricas de sucesso**
- Magic numbers de política de boot: 1 → 0
- Mudança de janela de drenagem: `edit + release` → `env change + restart`

**Risco de não fazer**
> Nulo enquanto o runtime for só o Render com janela de 30s. Vira dívida real quando o SaaSo provisionar outro runtime, e aí o custo é retroativo (mudar isso sob incidente).

**Dependências**: nenhuma. (Nota do consolidator: se `[fault-tolerance-1]` for aceito e mudar o valor default para 25 000, este card ainda vale — o ponto é a injeção via env, não o número.)

---

### [modifiability-3] Extrair `buildApp()` e `startServer()` do `src/backend/index.ts`

**QA**: Modifiability
**Tactic alvo**: Split Module
**Esforço**: M (2–5d — mexe em superfície de boot, precisa validação em dev antes do PR)
**Findings**: F-modifiability-3 (mesma causa raiz de F-testability-3)

**Problema**
> O `index.ts` chega a 198 LOC e 30 imports com o delta atual. Mistura config Express, instrumentação, montagem de 9 routers, wiring de auth/gates, boot (migrations, config-doctor, listen, shutdown, catch top-level). O delta contribuiu +16 linhas — não é a causa, mas empurrou o arquivo ao teto prático de um boot. Cross-cutting com **Testability**: nada em `index.ts` é testável hoje (o `start()` faz `container.register` + `container.resolve` + `app.listen` no mesmo método).

**Melhoria Proposta**
> Split em três: `src/backend/app.ts` (função `buildApp(): Express` — só wiring de middlewares e routers, sem `listen`), `src/backend/server.ts` (função `startServer(app: Express): Promise<void>` — migrations, config-doctor, `listen`, `registerGracefulShutdown`) e o `index.ts` reduzido a `void startServer(buildApp()).catch(...)`. Tactic: **Split Module** + **Increase Semantic Coherence** (Bass).

**Resultado Esperado**
> `index.ts` ≤10 LOC. `app.ts` testável isoladamente (supertest sem subir porta). `server.ts` testável com `server` e `deps` mockados — reaproveita o padrão que o `gracefulShutdown` já demonstrou. Facilita a próxima migração para Lambda: `app.ts` vira o handler wrapper, `server.ts` fica de fora.

**Métricas de sucesso**
- LOC `index.ts`: 198 → ≤10
- Imports em `index.ts`: 30 → ≤3
- Testes de boot possíveis: 0 → ≥3 (build app sem porta, start com deps mockados, top-level catch)

**Risco de não fazer**
> Cada nova rota/gate/middleware empurra o `index.ts` para além do p95 de arquivo backend. O próximo tweak vai carregar a mesma cognitiva de ler 198 linhas mescladas para trocar 3. Não é P0/P1 hoje — é o candidato natural de Split Module para o próximo `/feature-tweak` que tocar o boot.

**Dependências**: sobrepõe com `[testability-2]`. Executar um ou o outro — não os dois.

---

### [performance-2] Instrumentar histograma p50/p95/p99 de latência HTTP e de query Postgres

**QA**: Performance
**Tactic alvo**: Monitor / Bound Execution Times
**Esforço**: M (2–5d)
**Findings**: F-performance-3

**Problema**
> O único registro de duração é `console.log([RES] … (Xms))` por request; não existe agregação, alerta ou baseline. Isso deixa qualquer regressão de latência (ou ganho, como o deste delta) sem prova empírica — a validação vira leitura manual de log.

**Melhoria Proposta**
> No `index.ts` (middleware de logger) e no `PostgreeDatabaseClient.query`, cronometrar e agregar em contadores in-memory por rota/tabela; expor em `/operacao/metrics` (ou similar) como JSON com `count / p50 / p95 / p99`. Não precisa de Prometheus: um `TDigest` ou `hdr-histogram-js` em uma singleton `MetricsRegistry` já resolve o baseline. Tactic: **Monitor** (pré-requisito para toda tactic de perf).

**Resultado Esperado**
> Painel de operação passa a exibir p95 de request por rota e p95 de query por callsite. Métrica: **p50/p95/p99 exportados: 0 → ≥ 3 métricas por rota**; qualquer card futuro passa a poder mostrar `p95 antes → p95 depois` sem depender de CloudWatch externo.

**Métricas de sucesso**
- Métricas de latência agregadas expostas: **0 → 3** (p50, p95, p99) por rota
- Histograma de query Postgres por callsite: **ausente → presente**
- Log de request com `(Xms)`: **mantido** (não substituir, complementar)

**Risco de não fazer**
> Continua-se comprovando ganhos/regressões por argumento e teste unitário, não por número de produção — os próprios `--quick` runs deste review reconhecem "p50/p95 não medível localmente".

**Dependências**: nenhum bloqueio; combina bem com `[availability-3]` de painel de operação.

---

### [performance-3] Reavaliar `pool` capturado antes das retentativas do `queryRetryExecutor`

**QA**: Performance
**Tactic alvo**: Control Resource Demand — Reduce Overhead
**Esforço**: S (≤1d)
**Findings**: F-performance-4

**Problema**
> `PostgreeDatabaseClient.query` congela `const pool = this.connectionPool` antes de entregar ao `RetryExecutor`. Se durante a retentativa o `error` handler encerrar esse pool e criar um novo (fluxo corrigido pelo BE-05), as tentativas 2 e 3 rodam contra o pool encerrado e falham com `Cannot use a pool after calling end` — que não é transitório e sai como 5xx, mesmo com pool novo já pronto para atender.

**Melhoria Proposta**
> Ler `this.connectionPool` dentro do callback do `RetryExecutor.execute`, com `await this.init()` no começo de cada tentativa. Custo: 1 `if (this.connectionPool)` extra por retry — sem cold-init novo (a `init()` é idempotente e retorna cedo se `connectionPool` já existe). Tactic: **Reduce Overhead** / **Increase Resource Efficiency** (aproveitar o pool novo em vez de fritar as retentativas).

**Resultado Esperado**
> A 1ª call afetada por um evento `error` do pool passa a aproveitar o pool novo no meio das retentativas, em vez de falhar com `Cannot use a pool after calling end`. Métrica: **5xx por request afetado por evento `error` do pool: ~1 → 0**.

**Métricas de sucesso**
- 5xx por evento `error` do pool na call em curso: **1 → 0** (medível com o histograma do card `[performance-2]`)
- Teste dedicado (`retries pegam pool novo criado pelo error handler no meio da call`): **ausente → presente**

**Risco de não fazer**
> Cenário raro (janela entre `error` e `init()` seguinte); ignorar por 6 meses = ~1 request 5xx marginal por incidente de pool. Não urgente.

**Dependências**: nenhuma; combina com `[performance-2]` para observar antes/depois.

---

### [fault-tolerance-3] Instalar `unhandledRejection` / `uncaughtException` como último handler

**QA**: Fault Tolerance
**Tactic alvo**: Sanity Checking
**Esforço**: S
**Findings**: F-fault-tolerance-3, F-fault-tolerance-4

**Problema**
> O delta remove a causa "SIGTERM sem handler", mas um `throw` async não interceptado por `errorMiddleware` derruba o processo por comportamento default do Node — pulando o drenar, o pool.end() e a saída limpa. A causa reaparece por outro caminho, com a mesma consequência de órfão `reconciling`. `grep -rn "unhandledRejection\|uncaughtException" src/backend` devolve zero handlers.

**Melhoria Proposta**
> No `index.ts`, logo depois do `registerGracefulShutdown`, registrar `process.on('unhandledRejection', ...)` e `process.on('uncaughtException', ...)` que invoquem o mesmo handler retornado pelo `createShutdownHandler` (que já é idempotente e aceita "qualquer sinal" como string). O `createShutdownHandler` já é 100% testável por injeção — não precisa refatorar, só o call-site. Divergência com o caminho `SIGTERM`: aqui o `exitCode` deve ser 1 (o processo está descendo por defeito, não por ordem do orquestrador).

**Resultado Esperado**
> Crash não-tratado deixa de virar corte cru. O rescue vira: drenar tenta acabar as requisições em voo, `pool.end()` roda, e o processo sai com 1 — o Render marca o deploy como falho (se aconteceu no boot) ou reinicia (se aconteceu em runtime). Sem regredir o exit-0 do caminho `SIGTERM` (o `onExit` continua vindo do call-site, que decide o código).

**Métricas de sucesso**
- Handlers de crash não-tratado: 0 → 2
- Cobertura da tactic "Sanity Checking (runtime)": parcial → completa

**Risco de não fazer**
> Cauda longa da mesma classe de bug do BE-06 permanece. Probabilidade baixa (o `errorMiddleware` capta a maior parte), impacto por evento igual (órfão `reconciling`). O reaper cobre; este card fecha o círculo.

**Dependências**: nenhuma.

---

### [security-2] Padronizar jobs one-off para não depender de `npx`

**QA**: Security
**Tactic alvo**: Limit Exposure
**Esforço**: M (2–3h — 40 arquivos, achado mecânico, low-risk)
**Findings**: F-security-2

**Problema**
> ~40 jobs em `src/backend/jobs/` (probes e validators one-off) trazem docstrings do tipo `Run: PROBE_PRD=1 npx tsx jobs/probe-*.ts`. Quando o operador roda no diretório certo, o `npx` resolve o `tsx` do `node_modules` local (seguro). Fora dele, `npx` baixa e executa código do registry — mesma classe de risco que BE-09 já eliminou dos scripts oficiais.

**Melhoria Proposta**
> Reescrever as docstrings `Run:` para `node --loader tsx jobs/<script>.ts` **ou** promover os jobs recorrentes para `scripts` do `package.json` (padrão `job:<nome>` já usado em `job:reaper-sispag`, `job:capture-fixtures`, etc.). Documentar em `CLAUDE.md` §Commands que `npx` está banido dos jobs. Tactic Bass: Limit Exposure (reduzir superfície de execução não-lockfile).

**Resultado Esperado**
> Nenhum caminho de execução manual de job dependa de resolução dinâmica pelo registry npm. Métrica: ~40 → 0 docstrings de `Run:` com `npx tsx`.

**Métricas de sucesso**
- Docstrings `Run:` com `npx tsx` em `src/backend/jobs/`: ~40 → 0
- Scripts `job:*` em `src/backend/package.json` para jobs promovidos: cobrir 100% dos que rodam mais de uma vez

**Risco de não fazer**
> Baixo — mas mantém a assimetria "scripts oficiais são seguros, docs ensinam o inseguro", que corrói a lição do BE-09.

**Dependências**: nenhuma.

---

### [testability-3] Sanity-test dos gates locais (proteger contra futuras regressões tipo BE-09)

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤ 2h)
**Findings**: (nenhum — este card é preventivo, ancorado na §2.2 da seção Testability como evidência de que a classe de bug existe)

**Problema**
> BE-09 foi um gate que mentia — `npx biome check .` saía 0 sem `node_modules`. O delta corrigiu removendo `npx`, mas nada impede que alguém reintroduza o padrão (o script `dev` do backend usa `tsx watch` sem `npx`, mas um desenvolvedor pode adicionar `"lint:extra": "npx biome …"` sem gate). Reprodução controlada dos 4 gates do backend + 4 do frontend confirma que hoje todos falham com 127 sem `node_modules`, mas essa verificação é ad-hoc.

**Melhoria Proposta**
> Adicionar um teste em `src/backend/package.json.test.ts` que carrega o próprio `package.json`, itera pelos scripts críticos (`lint`, `test`, `typecheck`, `build`) e falha se algum começar com `npx `. Mesma coisa para `src/frontend/package.json.test.ts`. Tactic Bass alvo: **Executable Assertions** sobre um contrato do próprio harness. Alternativa mais leve: um step no CI (`ci.yml`) que roda `grep -E "\"(lint|test|typecheck|build)\":\s*\"npx " package.json` e falha se casar.

**Resultado Esperado**
> O ataque "adicionar `npx` num script crítico e passar despercebido" deixa de existir. Gates locais que retornam 0 sem examinar código: **1 → 0** (baseline medido na seção Testability §2.2). Custo do teste: 5 linhas por lado.

**Métricas de sucesso**
- Scripts críticos com prefixo `npx` no repo: 0 → **e o valor fica travado em 0**
- Testes que verificam o contrato dos scripts: 0 → 2

**Risco de não fazer**
> BE-09 volta a acontecer no primeiro dev que puxar um package novo com `npx cliente-x --gerar` num script `build:extra` sem perceber o silent-0.

**Dependências**: nenhuma. Cross-QA: cuida diretamente do gate de deploy (deployability).

---

### [testability-4] Instaurar ratchet mensal no threshold de cobertura do frontend

**QA**: Testability
**Tactic alvo**: Executable Assertions
**Esforço**: S (≤ 1d)
**Findings**: F-testability-4

**Problema**
> O `jest.config.cjs` do frontend fixou o piso em 20% lines / 9% branches / 14% functions após corrigir a medição "Potemkin" (comentário do próprio arquivo). O piso é honesto, mas está fixo desde 2026-06-26 — não há mecanismo que force sobe-piso conforme testes vão sendo escritos. Feature nova pode mergear com 0% de cobertura no arquivo dela sem impactar o gate.

**Melhoria Proposta**
> Adicionar um script `scripts/ratchet-coverage.mjs` que:
> 1. Lê o `coverage-summary.json` gerado pelo `jest --coverage`;
> 2. Compara com os thresholds atuais do `jest.config.cjs`;
> 3. Se coverage-atual > threshold + 2 (folga), levanta o threshold para `floor(coverage-atual - 1)` e commita. Roda **weekly** via workflow dedicado (`.github/workflows/coverage-ratchet.yml`), abrindo PR automaticamente. Tactic Bass alvo: **Executable Assertions** (o piso passa a ser executável e evolutivo).

**Resultado Esperado**
> Threshold de linhas do frontend deixa de ser estático em 20%. Meta 6 meses: **20% → 40%** (crescimento orgânico conforme features novas trazem testes). Meta 12 meses: **≥ 60%**. Regressão continua travada, mas melhoria também passa a ser mensurável.

**Métricas de sucesso**
- Piso de cobertura de linhas do FE: 20% → ≥ 40% em 6 meses
- Data do último bump do threshold: **agora estática (2026-06-26)** → **≤ 30d atrás sempre**

**Risco de não fazer**
> Cobertura FE ficar em 20% permanentemente enquanto as telas mais críticas (SISPAG, painel de operação) crescem sem defensor. A dívida vira permanente sem que ninguém a veja no dashboard.

**Dependências**: nenhuma.
