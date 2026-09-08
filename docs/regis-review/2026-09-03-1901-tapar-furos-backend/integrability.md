---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-03-1901-tapar-furos-backend
agent: qa-integrability
generated_at: 2026-09-03T19:20:00-03:00
scope: backend
score: 7.5
findings_count: 3
cards_count: 3
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Orquestrador do Render | envia `SIGTERM` no deploy | integração com Postgres (Supabase) via `PostgreeDatabaseClient` + o pool paralelo do `conexosSessionStore` + sessão do Conexos legado | produção Express, backend com integrações ativas | drenar HTTP em voo, encerrar **todos** os recursos de integração de forma simétrica ao `init()`, sair com 0 antes do SIGKILL (~30s) | 0 sessão Supabase pendurada até o `idleTimeoutMillis`; 0 execução `sispag` órfã em `reconciling`; ciclo de vida do client discoverable via contrato (`IClient`) |

O delta atende **parcialmente** o cenário: fecha o pool primário e drena o HTTP, mas deixa
duas superfícies de integração fora da coordenação (pool interno do `conexosSessionStore`
e sessão do Conexos legado) e não promove `close()` ao contrato `IClient`.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Clients Postgres que participam do shutdown | 1 de 2 | 2 de 2 | ⚠️ | `src/backend/index.ts:158-163` + `src/backend/services/conexosSessionStore.ts:242-256` |
| Contrato `IClient` cobre ciclo de vida completo (`init`+`close`) | Não — só `init()` | `init()` + `close()` (opcional) | ❌ | `src/backend/domain/core/client/IClient.ts:1-3` |
| Clients que declaram `implements IClient` | 1 (`PostgreeDatabaseClient`) | ≥ os que seguram recurso (Postgres, sessão Conexos, axios/BCB pool) | ⚠️ | `grep -rn "implements IClient" src/backend` → 1 hit |
| Client com `close()` implementado | 1 (`PostgreeDatabaseClient.close`) | idem | ⚠️ | `PostgreeDatabaseClient.ts:99-115` |
| Handler SIGTERM/SIGINT registrado | Sim | Sim | ✅ | `src/backend/http/gracefulShutdown.ts:53-113` + `src/backend/index.ts:159-163` |
| Cobertura do `gracefulShutdown.ts` (linhas) | 100% linhas / 93,6% stmts / 58,8% branches | ≥ 80% linhas | ✅ | `_shared-metrics.md` §Gates |
| Testes do delta (client + shutdown) | 15 novos (7 no client + 8 no shutdown) | ≥ 1 por caminho de falha | ✅ | `PostgreeDatabaseClient.test.ts` + `gracefulShutdown.test.ts` |
| Acoplamento do shutdown ao client concreto | Direto — `container.resolve(PostgreeDatabaseClient).close()` | Iterar `IClient[]` registrados | ⚠️ | `src/backend/index.ts:161` |
| Pools Postgres distintos no processo | 2 (`PostgreeDatabaseClient` max=5 + `conexosSessionStore` max=2) | 1 (ou 2 documentados e ambos coordenados) | ⚠️ | `PostgreeDatabaseClient.ts:25` + `conexosSessionStore.ts:243-247` |
| Handler `error` do pool secundário chama `end()` | Não — apenas `() => undefined` | Encerrar quando quebrado (mesma correção do BE-05) | ⚠️ | `conexosSessionStore.ts:249` |
| Sessão Conexos deslogada no shutdown | Não (decisão implícita, não documentada) | Documentar decisão ou implementar | ⚠️ | `services/conexos.ts` sem hook de shutdown |
| Sinais tratados | `SIGTERM`, `SIGINT` | idem (Render manda SIGTERM; operador manda SIGINT) | ✅ | `gracefulShutdown.ts:22` |
| Teto de drenagem | 10s (force-exit) | ≤ 30s (janela SIGTERM → SIGKILL do Render) | ✅ | `gracefulShutdown.ts:29` |
| Reprodução empírica do BE-09 (lint sem deps) | Antes: exit 0 silencioso; depois: exit 127 alto | Falha visível sem `node_modules` | ✅ | `_shared-metrics.md` §"Validação empírica do BE-09" |

> ⚠️ **Não medível localmente**: número real de sessões deixadas penduradas no pooler Supabase por deploy no Render. Requer métrica `pg_stat_activity` observada em janela de deploy. Recomendação: coletar antes/depois em prod.

## 3. Tactics — Cobertura no delta

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | `PostgreeDatabaseClient.close()` esconde `pool.end()` do orquestrador; `gracefulShutdown` recebe `closePool` como capability, não conhece `pg` | ✅ presente | `PostgreeDatabaseClient.ts:99-115`, `gracefulShutdown.ts:24-32` |
| Use an Intermediary | `registerGracefulShutdown` é o intermediário entre `process` (sinal) e cada recurso (server + pool); dependências injetadas por interface estrutural | ✅ presente | `gracefulShutdown.ts:107-118` |
| Restrict Communication Paths | O shutdown NÃO importa `pg` nem `PostgreeDatabaseClient`; só o `index.ts` conhece o container | ✅ presente | `gracefulShutdown.ts` (nenhum import de `pg` / client concreto) |
| Adhere to Standards | `IClient` só declara `init()`; `close()` é convenção informal do delta; segundo pool em `conexosSessionStore` fica fora do padrão | ❌ ausente | `IClient.ts:1-3`, `conexosSessionStore.ts:242-256` — ver F-integrability-1 |
| Abstract Common Services | Existem dois caminhos Postgres com políticas de pool distintas (`max=5` com retry vs `max=2` sem retry) e uma única defesa comum (`on('error')`) — mas cada um implementa a sua | ⚠️ parcial | `PostgreeDatabaseClient.ts:60-90` vs `conexosSessionStore.ts:242-256` — ver F-integrability-2 |
| Discover Service | Postgres descoberto por `EnvironmentProvider.databaseConnectionString` (padrão); Conexos por env legado — ambos consistentes com o restante do repo | ✅ presente | `EnvironmentProvider.ts`, `conexosSessionStore.ts:232` |
| Tailor Interface | `TransactionClient` expõe um subset seguro do `PoolClient` para blocos `withTransaction` — tailoring correto ao caso de uso | ✅ presente | `PostgreeDatabaseClient.ts:14-19,143-171` |
| Configure Behavior | `drainTimeoutMs`, `onExit` e `log` do shutdown são configuráveis via parâmetro; `poolMaxConnections` é constante interna | ✅ presente | `gracefulShutdown.ts:25-32` |
| Manage Resources | **Core do delta.** `close()` encerra o pool; guard de reentrada no handler de `error`; timeout force-exit no shutdown; try/catch em `pool.end()` que já rejeitou. Falha em cobrir o pool do `conexosSessionStore` e a sessão do Conexos legado | ⚠️ parcial | `PostgreeDatabaseClient.ts:80-96,99-115`, `gracefulShutdown.ts:78-92` — ver F-integrability-2 e F-integrability-3 |
| Orchestrate | Ordem explícita `server.close → closePool → exit(0)` com timeout paralelo — orquestração correta | ✅ presente | `gracefulShutdown.ts:98-113` |
| Manage Resource Coupling | Shutdown se acopla ao `PostgreeDatabaseClient` **concreto** por `container.resolve` no `index.ts` em vez de iterar `IClient[]`; adicionar um segundo recurso exige editar o `index.ts` | ⚠️ parcial | `index.ts:161` — ver F-integrability-1 |
| Contract Testing (facet moderna) | `PostgreeDatabaseClient.test.ts` valida o **novo contrato de ciclo de vida**: 7 testes cobrem `close` idempotente, ordem de reset, listener anti-cascata; `gracefulShutdown.test.ts` valida a sequência e o timeout | ✅ presente | `PostgreeDatabaseClient.test.ts` (+7), `gracefulShutdown.test.ts` (8) |
| Versioning Strategy | N/A — o delta não muda API pública nem contrato externo (Conexos/Nexxera/GED). `close()` é interno | N/A | — |
| Backward-Compatibility Shims | N/A no delta — `close()` é aditivo, ninguém depende da ausência dele | N/A | — |
| Observability of Integration Failures | Shutdown loga cada transição em pt-BR (`[shutdown] ...`); `close()` engole falha do `pool.end()` sem log (comentário: "não há a quem reportar") — defensável durante shutdown | ⚠️ parcial | `gracefulShutdown.ts:57-113`, `PostgreeDatabaseClient.ts:110-114` |

## 4. Findings

### F-integrability-1: contrato `IClient` não cobre `close()` — ciclo de vida assimétrico e acoplado ao concreto

- **Severidade**: P2 (débito de contrato — não causa incidente imediato, mas cria acoplamento que cresce a cada novo client)
- **Tactic violada**: Adhere to Standards; Manage Resource Coupling
- **Localização**: `src/backend/domain/core/client/IClient.ts:1-3` · `src/backend/index.ts:159-163` · `src/backend/domain/client/database/PostgreeDatabaseClient.ts:99-115`
- **Evidência (objetiva)**:
  ```ts
  // IClient.ts (íntegro)
  export default interface IClient {
      init(): Promise<void>;
  }

  // index.ts:161 — acoplamento ao concreto no ponto onde o padrão pediria uma coleção
  closePool: () => container.resolve(PostgreeDatabaseClient).close(),
  ```
  `grep -rn "implements IClient" src/backend` → **1 arquivo** (`PostgreeDatabaseClient`).
  `BcbClient`, `ConexosBaseClient` e 15 outros clients no `domain/client/` **não** implementam o contrato — não há garantia estrutural de que um novo client (Nexxera, GED) terá `init()` nem, agora, um `close()` correspondente.
- **Impacto técnico**: (a) o shutdown gracioso não itera "todos os `IClient`" — precisa referenciar cada classe concreta; adicionar um segundo recurso (ex.: `NexxeraClient` com FTP/HTTP pool) exige editar `index.ts` e replicar o padrão à mão; (b) reviewers e o `PatternGuardian` não têm ancora estrutural para exigir `close()` em novos clients que segurem recurso.
- **Impacto de negócio**: cada nova integração (as três previstas — Nexxera, GED, SharePoint) vira uma micro-decisão manual sobre "isso precisa fechar no SIGTERM?". Estatisticamente, uma vai ser esquecida — foi exatamente o que aconteceu com o `conexosSessionStore` (F-integrability-2). Custo marginal por integração cai se o contrato dita a superfície.
- **Métrica de baseline**: 1 de 2 pools Postgres coordenados no shutdown; 1 de 17 clients declara `implements IClient`; 0 clients (fora do Postgres) expõem `close()`.

### F-integrability-2: segundo pool Postgres em `conexosSessionStore` bypassa o shutdown gracioso — mesma classe de falha do BE-05, em escala menor

- **Severidade**: P1 (alta — reproduz o modo de falha que o próprio delta corrigiu; baseline numérico abaixo)
- **Tactic violada**: Manage Resources; Abstract Common Services
- **Localização**: `src/backend/services/conexosSessionStore.ts:242-256,265` · `src/backend/http/gracefulShutdown.ts` (nada referencia o segundo pool)
- **Evidência (objetiva)**:
  ```ts
  // conexosSessionStore.ts:242-256
  const pool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
  });
  // Um Pool sem listener de 'error' derruba o processo num erro de socket
  // ocioso. Mantém o store resiliente (mesma defesa do PostgreeDatabaseClient).
  pool.on('error', () => undefined);   // ← NÃO chama pool.end() (contrasta com PostgreeDatabaseClient.ts:78-90)
  ...
  // conexosSessionStore.ts:265
  export const conexosSessionStore = buildSessionStoreFromEnv();  // ← módulo-nível, sem hook de shutdown
  ```
  O `index.ts:161` fecha só o pool do `PostgreeDatabaseClient`; o pool `max: 2` do session store fica pendurado no Supabase até o `idleTimeoutMillis` (10s) ou o SIGKILL. Além disso, o handler de `error` desse pool é `() => undefined` — a exata forma que o BE-05 mostrou ser insuficiente (o pool quebrado permanece referenciado e volta a ser usado).
- **Impacto técnico**: cada deploy no Render deixa até **2 sessões** do pool secundário no pooler Supabase até 10s após o SIGTERM; se o pool quebrar durante execução, o handler de `error` só evita o crash — não recupera nem reinicia como o `PostgreeDatabaseClient` faz. Duas políticas divergentes para o mesmo recurso (Postgres) em dois pontos do código.
- **Impacto de negócio**: com o `poolMaxConnections=5` do primário + `max=2` do secundário, cada deploy no pico pode manter até 7 conexões no pooler acima do necessário por até 10s. Em rollout rápido (2–3 deploys/dia observados no changelog recente v0.29→v0.34), isso não fura o `MaxClientsInSessionMode` sozinho, mas soma ao pico e é exatamente o vetor que o BE-05 documenta como acelerador do `'too many clients'`.
- **Métrica de baseline**: **2 conexões** deixadas pendentes por deploy (max do pool secundário); **0 chamadas** a `pool.end()` no `conexosSessionStore` em todo o `src/backend/`; **1 dos 2 pools** participa do shutdown.

### F-integrability-3: `ConexosBaseClient` / `services/conexos.ts` não tem hook de shutdown — decisão implícita, não documentada

- **Severidade**: P3 (baixa — provavelmente correto **de propósito**, mas invisível para o próximo leitor)
- **Tactic violada**: Adhere to Standards (documentação do ciclo de vida); Manage Resources
- **Localização**: `src/backend/services/conexos.ts` (sem `close()`/`logout()` chamado no shutdown) · `src/backend/domain/client/ConexosBaseClient.ts:167` (`ensureSid` sem contraparte)
- **Evidência (objetiva)**:
  ```
  grep -n "logout\|close\|dispose\|shutdown" src/backend/services/conexos.ts → 0 métodos públicos de encerramento
  grep -n "logout\|close\|dispose" src/backend/domain/client/ConexosBaseClient.ts → nenhum
  ```
  O design é intencional: o `conexosSessionStore` **compartilha** o `sid` entre processos (Render prod + dev + scripts); um `logout` no SIGTERM invalidaria a sessão dos outros processos e é justamente o que a Fatia B tentou eliminar. Mas essa decisão vive só no docstring do `conexosSessionStore.ts` — não no ponto onde alguém *não* deslogou.
- **Impacto técnico**: a próxima pessoa que ler o `gracefulShutdown.ts` vai perguntar "por que só o Postgres fecha?" e não encontra a resposta no ponto onde ela é relevante (o `registerGracefulShutdown` em `index.ts`). Risco: alguém adicionar um "logout defensivo" no shutdown e quebrar a sessão compartilhada.
- **Impacto de negócio**: 0 hoje. Custo de manutenção: 1 revisor confuso por trimestre.
- **Métrica de baseline**: 0 comentários em `index.ts:159-163` explicando por que o Conexos não entra no shutdown.

## 5. Cards Kanban

### [integrability-1] Promover `close()` opcional ao contrato `IClient` e registrar clients em coleção

- **Problema**
  > O contrato `IClient` (`src/backend/domain/core/client/IClient.ts`) declara só `init()`. O `close()` do `PostgreeDatabaseClient` é convenção do delta, e o shutdown em `src/backend/index.ts:161` referencia a classe concreta (`container.resolve(PostgreeDatabaseClient).close()`). Cada novo client que segure recurso (Nexxera, GED, o segundo pool Postgres) vira uma edição pontual do `index.ts` — que estatisticamente vai ser esquecida, como já foi para o `conexosSessionStore`.

- **Melhoria Proposta**
  > Estender `IClient` com `close?(): Promise<void>` (opcional para não quebrar clients sem recurso). Introduzir um `LifecycleRegistry` (nome sugerido) ou uma lista `clientsWithLifecycle: IClient[]` resolvida via container; `registerGracefulShutdown` passa a receber `closeAll: () => Promise.all(clients.map(c => c.close?.()))` em vez do `closePool` singular. Fazer `PostgreeDatabaseClient` e o novo wrapper do pool do session store (ver card integrability-2) implementarem o contrato. Tactic: **Adhere to Standards** + **Manage Resource Coupling**.

- **Resultado Esperado**
  > `index.ts` deixa de importar `PostgreeDatabaseClient` no wire de shutdown. Adicionar `NexxeraClient` que implemente `IClient.close()` participa automaticamente do shutdown. Métrica: contrato `IClient` cobre ciclo de vida completo (**Não → Sim**); clients com `implements IClient` **1 → ≥ 2** (Postgres + wrapper do session store); acoplamento do shutdown ao client concreto **direto → via coleção**.

- **Tactic alvo**: Adhere to Standards; Manage Resource Coupling
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — 1 interface + 1 registry + 2 clients + testes
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Clients com ciclo de vida no contrato: 1 → ≥ 2
  - Referências ao `PostgreeDatabaseClient` no `index.ts`: 2 → 0 (só via container e sem `.close()` direto)
- **Risco de não fazer**: cada uma das 3 integrações previstas (Nexxera, GED, SharePoint) vai negociar seu próprio padrão de shutdown; uma delas vai esquecer e virar o próximo BE-05.
- **Dependências**: nenhuma — pode ser feito antes ou depois de integrability-2, mas integrability-2 fica trivial com este pronto.

### [integrability-2] Encerrar o pool secundário do `conexosSessionStore` no shutdown gracioso

- **Problema**
  > `src/backend/services/conexosSessionStore.ts:242-256` cria um segundo `Pool` Postgres (`max: 2`) no load do módulo, com handler de `error` `() => undefined` — literalmente a forma que o BE-05 demonstrou ser insuficiente. Esse pool não é conhecido pelo `PostgreeDatabaseClient` nem pelo `gracefulShutdown`, então cada SIGTERM deixa até 2 sessões pen­duradas no pooler Supabase até o `idleTimeoutMillis` (10s), somando-se ao pico do primário.

- **Melhoria Proposta**
  > Envolver o pool do session store num client `@singleton @injectable` (ex.: `ConexosSessionPoolClient` ou expor `close()` no próprio `conexosSessionStore` singleton) que implemente `IClient` (uma vez pronto o card integrability-1). O `gracefulShutdown` fecha os dois em paralelo. Aplicar a mesma correção do BE-05 no handler de `error`: chamar `pool.end()` com guarda de reentrada, não só `() => undefined`. Tactic: **Manage Resources** + **Abstract Common Services**.

- **Resultado Esperado**
  > Pools Postgres coordenados no shutdown: **1 de 2 → 2 de 2**. Handler de `error` do pool secundário chama `end()`: **Não → Sim**. Sessões deixadas pen­duradas por deploy: **até 2 → 0**.

- **Tactic alvo**: Manage Resources; Abstract Common Services
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — mover a criação do pool para um client DI, expor `close()`, plugar no shutdown, replicar os testes do `PostgreeDatabaseClient.test.ts` para o novo client
- **Findings relacionados**: F-integrability-2 (correlacionado a F-integrability-1)
- **Métricas de sucesso**:
  - Pools Postgres cobertos por `close()` no SIGTERM: 1 → 2
  - Handler `error` do pool do session store chama `end()`: Não → Sim
  - Sessões residuais por deploy (`pg_stat_activity` do Supabase, janela do SIGTERM): coletar baseline e validar → 0
- **Risco de não fazer**: o mesmo laço de retro-alimentação do BE-05 (esgotamento de conexões → erro tratado como transitório → mais conexões) permanece armado no pool secundário. Menos provável de gatilhar (max=2 vs max=5), mas o modo de falha está aberto.
- **Dependências**: idealmente após integrability-1 (para plugar no `LifecycleRegistry`), mas pode ser feito antes com wire manual no `index.ts`.

### [integrability-3] Documentar (ou implementar) por que a sessão do Conexos NÃO é encerrada no SIGTERM

- **Problema**
  > O `registerGracefulShutdown` em `src/backend/index.ts:159-163` só fecha o Postgres — nem `ConexosBaseClient` nem o `services/conexos.ts` (que segura `sid`, `sidExpiresAt`) recebem sinal. A decisão é intencional (o `conexosSessionStore` compartilha o `sid` entre processos; um logout defensivo invalidaria a sessão dos outros), mas essa razão só vive no docstring do session store, longe do ponto onde alguém *não* deslogou.

- **Melhoria Proposta**
  > Adicionar comentário no `index.ts` (ao lado do `registerGracefulShutdown`) explicando explicitamente que a sessão Conexos é compartilhada por design e **não deve** ser encerrada no SIGTERM — apontando para `services/conexosSessionStore.ts`. Alternativa (não recomendada agora): implementar um `logout` cliente que só rode quando `sessionStore.enabled === false` (dev local sem banco). Tactic: **Adhere to Standards** (documentar o contrato de shutdown de cada integração).

- **Resultado Esperado**
  > Um leitor do `index.ts` entende, no ponto onde a pergunta nasce, por que só o Postgres fecha. Zero risco de alguém adicionar um "logout defensivo" que quebre a sessão compartilhada.

- **Tactic alvo**: Adhere to Standards
- **Severidade**: P3
- **Esforço estimado**: S (≤1d) — 6 linhas de comentário + link
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Comentários em `index.ts` explicando a exclusão do Conexos do shutdown: 0 → 1
- **Risco de não fazer**: baixo. Estatisticamente, 1 revisor confuso por trimestre; risco secundário de alguém "consertar" a omissão e quebrar a sessão compartilhada.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo mantido no delta (5 arquivos + o toque no `package.json`). O contexto do repo (17 clients em `domain/client/`) entrou só para dimensionar F-integrability-1.
- **Cross-QA para o consolidator**:
  - **F-integrability-2** (segundo pool não fechado) sobrepõe com **Availability**, **Fault Tolerance** e **Deployability** — é o mesmo modo de falha do BE-05 que o delta corrige, em escala menor; se `qa-availability` ou `qa-fault-tolerance` levantar isso, tratar como o mesmo card (integrability-2).
  - **F-integrability-1** (contrato `IClient`) sobrepõe com **Modifiability** — o mesmo acoplamento do shutdown ao client concreto é modificabilidade.
  - **F-integrability-3** é puramente documental — provavelmente será rebatido pelo consolidator com o P3 da Modifiability se houver.
- Métrica não coletada: sessões residuais reais no pooler Supabase por deploy — requer observação em produção (`pg_stat_activity` recortado por janela SIGTERM); registrada como recomendação no card integrability-2.
