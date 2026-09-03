# tapar-furos-backend — tasks

> `/feature-tweak --no-ground-truth plataforma/ciclo-de-vida-do-processo "fix: pool vazado no
> handler de erro, ausência de shutdown gracioso e script de lint que passa verde sem deps"`
>
> **Branch:** `fix/tapar-furos-backend` · **Worktree:** `~/kavex-worktrees/tapar-furos-backend`
>
> **Dispensa do gate Ground-Truth (`--no-ground-truth`):** nenhum dos três achados toca lógica
> monetária alimentada pelo Conexos — não há fórmula, sinal, classificação nem filtro/paginação/
> fieldList de fetch financeiro no delta. São infra de processo (pool, sinais do SO) e tooling
> (scripts npm). Não há ground truth do ERP contra o que comparar. Registrar a dispensa no PR.
>
> **Decision fork (OfficeHours, modo tweak):** os três são **bug de implementação**, não mudança de
> regra. Nenhuma entidade, ação, invariante ou state-machine da ontologia muda — logo **sem
> OntologyCurator**. O estado `reconciling` continua sendo um estado legítimo do ledger de execução;
> a Task 2 remove a *causa mais frequente* de ele ficar órfão, não o estado nem o reaper que o caça.

## Contexto verificado no código (antes de corrigir)

| Achado | Onde | Evidência colhida |
|--------|------|-------------------|
| BE-05 | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:69-71` | `this.connectionPool = undefined` sem `pool.end()`; `grep '\.end('` no arquivo = 0 ocorrências |
| BE-06 | `src/backend/index.ts:173-176` | `app.listen` com retorno descartado; nenhum `process.on('SIGTERM'\|'SIGINT')` no arquivo |
| BE-09 | `src/backend/package.json:23-24` | `npm run lint:npx` sem `node_modules` → **exit 0, silencioso**; `biome check .` sem `node_modules` → **exit 127, `biome: not found`** (medido em sandbox isolado) |

---

### Task 1: Close the leaked pool before dropping its reference

O handler de `error` do pool zera `this.connectionPool` sem encerrar o pool antigo. A próxima
`init()` cria um pool novo e o anterior segue segurando até `poolMaxConnections = 5` conexões no
Supabase. O agravante é o loop: os padrões que o próprio cliente classifica como transitórios
incluem `'too many clients'` e `'MaxClientsInSessionMode'` — o handler que existe para recuperar do
esgotamento de conexões é o que o acelera.

O evento `error` do `pg.Pool` pode disparar mais de uma vez para o mesmo pool (um por cliente ocioso
derrubado). Sem guarda, o segundo disparo zeraria uma referência que já aponta para um pool **novo**,
criado pela `init()` que rodou no meio — matando um pool saudável. Por isso o handler captura o pool
numa `const` local e só zera `this.connectionPool` se ela ainda for a referência corrente.

Expor também um `close()` público: sem ele a Task 2 não tem como devolver as conexões no shutdown, e
o `IClient` só declara `init()`.

**Files to change:**
- `src/backend/domain/client/database/PostgreeDatabaseClient.ts` — no handler de `error`, capturar
  `const pool = this.connectionPool` antes do listener; dentro, `void pool.end().catch(() => {})`
  (o `end()` de um pool já quebrado rejeita, e um throw aqui derrubaria o processo por unhandled
  rejection) e zerar `this.connectionPool` **apenas** se `this.connectionPool === pool`. Adicionar
  `public close = async (): Promise<void>` idempotente: sem pool → no-op; com pool → zera a
  referência **antes** do `await pool.end()` (para que uma chamada concorrente não espere o mesmo
  pool duas vezes) e engole erro de `end()`.
- `src/backend/domain/client/database/PostgreeDatabaseClient.test.ts` — o mock de `pg` hoje tem
  `on: jest.fn()`, que descarta o listener. Passar a capturar os handlers registrados e expor um
  `end` mockado, para poder disparar o evento no teste.

**Acceptance criteria:**
- Disparar o evento `error` do pool chama `pool.end()` exatamente 1 vez e deixa `connectionPool`
  indefinido (a próxima query cria um pool novo).
- Disparar o evento `error` duas vezes no MESMO pool chama `end()` só uma vez (idempotência).
- Se uma `init()` criou um pool novo antes do segundo `error` do pool antigo, o pool **novo**
  sobrevive — a referência corrente não é zerada e nenhuma query subsequente falha com
  `'Database connection pool not initialized'`.
- `pool.end()` que rejeita não produz unhandled rejection nem propaga erro ao chamador.
- `close()` é idempotente: duas chamadas seguidas → um único `end()`; chamada sem `init()` prévia →
  não lança e não chama `end()`.
- Os 12 testes já existentes de `PostgreeDatabaseClient` seguem passando sem alteração de asserção.

**Dependencies:** none

---

### Task 2: Drain in-flight requests on SIGTERM/SIGINT instead of cutting them

Todo deploy do Render manda SIGTERM. Sem handler, o Node morre na hora e derruba o que estiver em
voo. Isso não é abstrato aqui: uma requisição interrompida entre o `createRun` e o `finishRun` deixa
a execução parada em `reconciling` — exatamente o órfão que o `.github/workflows/reaper-sispag.yml`
varre de 15 em 15 minutos. O detector do sintoma existe; falta remover a causa mais frequente.

O handler mora em módulo próprio, e não inline no `index.ts`, porque `index.ts` dispara `start()` no
import — importá-lo num teste subiria o servidor. O módulo recebe suas dependências por parâmetro
(server, closePool, exit, timer) e por isso é testável sem processo, sem porta e sem banco.

Segue a convenção do diretório `http/`: `export const` com arrow function (ver `errorMiddleware`,
`buildAuthMiddleware`, `buildCorsOptions`), não classe.

**Files to change:**
- `src/backend/http/gracefulShutdown.ts` (novo) — `export const registerGracefulShutdown = (deps)`
  com `server` (o retorno de `app.listen`), `closePool`, `onExit`, `drainTimeoutMs` (default 10s,
  abaixo dos ~30s que o Render espera antes do SIGKILL) e `log`. Sequência: log do sinal →
  `server.close()` (para de aceitar conexões novas, aguarda as em voo) → `closePool()` → `onExit(0)`.
  Guarda de reentrada (`shuttingDown`) para o segundo sinal ser ignorado. Timer de force-exit
  armado em paralelo: se o drain estourar o timeout, loga e sai assim mesmo (`onExit(0)` — o
  processo está descendo por ordem do orquestrador, não por falha). `unref()` no timer para ele
  não segurar o event loop, e `clearTimeout` no caminho feliz.
- `src/backend/http/gracefulShutdown.test.ts` (novo) — cobre a máquina de estados com fakes.
- `src/backend/index.ts` — capturar `const server = app.listen(...)` e, no callback, chamar
  `registerGracefulShutdown` com `closePool: () => container.resolve(PostgreeDatabaseClient).close()`
  e `onExit: (code) => process.exit(code)`. Registrar SIGTERM e SIGINT.

**Acceptance criteria:**
- SIGTERM chama `server.close()` antes de `closePool()`, e `onExit(0)` só depois de ambos
  resolverem — a ordem é verificável no teste.
- SIGINT tem comportamento idêntico ao SIGTERM.
- Segundo sinal durante um shutdown em andamento é ignorado: `server.close()` e `closePool()` seguem
  com 1 chamada cada.
- `server.close()` que nunca chama o callback (requisição pendurada) → após `drainTimeoutMs` o
  processo sai mesmo assim com código 0, e `closePool()` não fica represado indefinidamente.
- `closePool()` que rejeita não impede o `onExit(0)` — falhar ao fechar o pool não pode virar
  processo zumbi que o orquestrador precise matar com SIGKILL.
- O timer de force-exit não segura o event loop (`unref`) e é cancelado no caminho feliz — o teste
  verifica `clearTimeout`/`unref` via fakes.
- `src/backend/index.ts` deixa de descartar o retorno de `app.listen`.

**Dependencies:** Task 1 (usa o `close()` público criado lá)

---

### Task 3: Make the lint gate fail loudly when dependencies are missing

Medido: com `node_modules` ausente, `npm run typecheck` sai **127** (falha alto e claro) mas
`npm run lint` sai **0**, sem uma linha de output. O script é `npx biome check .`, e o `npx` sem o
pacote presente não reclama. Em CI não morde — o `npm ci` vem antes. Morde em **todo worktree novo**,
que é o fluxo obrigatório do pipe (Inviolable Rule #10): o gate reporta verde sem ter examinado uma
linha de código.

`build` tem o mesmo vício em `npx tsc-esm-fix dist`. Ali o `tsc &&` falha primeiro quando não há
deps nenhuma, mas com deps parciais o `npx` pode baixar uma versão qualquer do registry ou pular o
passo — e um `dist` sem o fix de ESM é um deploy quebrado. Mesma classe, mesma correção.

O frontend **não** tem o problema (`eslint .`, `next build`, `tsc --noEmit` já resolvem por
`node_modules/.bin`) — verificado; nada a mudar lá.

**Files to change:**
- `src/backend/package.json` — `lint`: `npx biome check .` → `biome check .`; `lint:fix`:
  `npx biome check --write .` → `biome check --write .`; `build`: `tsc && npx tsc-esm-fix dist` →
  `tsc && tsc-esm-fix dist`. (`biome` e `tsc-esm-fix` já estão em `devDependencies` e presentes em
  `node_modules/.bin`.)

**Acceptance criteria:**
- Validação empírica registrada, em ambiente sem `node_modules`: `biome check .` → exit **≠ 0** com
  mensagem explícita (`biome: not found`), contra o exit **0 silencioso** do `npx biome check .`.
- Com `node_modules` presente, `npm run lint` no backend continua exit 0 e imprime o
  `Checked N files` — o gate segue funcionando no caminho normal.
- Nenhum `npx` remanescente em `src/backend/package.json` (`grep -c 'npx ' = 0`).
- `src/frontend/package.json` inspecionado e confirmado sem o problema (documentado, sem mudança).

**Dependencies:** none

---

# Rodada 2 — fechar o P1 e os P2 do Regis-Review

> Pedido explícito do Yuri após o gate passar ("close the p1 and p2"). Isto **suspende
> deliberadamente** a política padrão do pipe ("P1/P2/P3 não são implementados; viram
> follow-ups"), por autorização direta. Fonte dos cards:
> `docs/regis-review/2026-09-03-1901-tapar-furos-backend/KANBAN.md`.
> Os 12 cards **P3 permanecem** como follow-up em
> `ontology/_inbox/tapar-furos-backend-regis-followups.md`.

### Task 4: Give IClient a lifecycle so every resource-holding client is closed

`IClient` declara só `init()`. O `close()` da Task 1 é convenção informal, e o `index.ts`
referencia a **classe concreta**. Cada client novo que segure recurso vira uma edição pontual do
`index.ts` — que estatisticamente é esquecida, como já foi para o `conexosSessionStore` (é
exatamente o P1 da Task 5).

`close?()` é **opcional** no contrato: a maioria dos ~17 clients não segura recurso, e torná-lo
obrigatório forçaria implementação vazia em todos eles.

**Files to change:**
- `src/backend/domain/core/client/IClient.ts` — acrescentar `close?(): Promise<void>`.
- `src/backend/http/lifecycle.ts` (novo) — `closeAll(clients)` que fecha todos em paralelo e
  **nunca rejeita** (um client que falha não pode impedir os outros nem travar o shutdown).
- `src/backend/http/lifecycle.test.ts` (novo).

**Acceptance criteria:**
- `IClient` declara `close?(): Promise<void>`; `PostgreeDatabaseClient` continua satisfazendo o
  contrato sem mudança de assinatura.
- `closeAll` fecha todos os clients mesmo quando um rejeita, e resolve com a lista de erros.
- `closeAll` ignora client sem `close` definido (não lança `TypeError`).
- `closeAll` com lista vazia resolve sem erro.

**Dependencies:** Task 1

---

### Task 5: Close the session store's second Postgres pool (P1 — same defect as BE-05)

`src/backend/services/conexosSessionStore.ts` cria um **segundo** `Pool` (`max: 2`) no load do
módulo com `pool.on('error', () => undefined)` — a assinatura exata do BE-05, num sítio que o
shutdown não conhece. É o único P1 do Regis-Review.

**Files to change:**
- `src/backend/services/conexosSessionStore.ts` — o handler de `error` passa a encerrar o pool
  (mesma guarda de reentrada da Task 1); exportar `closeConexosSessionStorePool()` idempotente.
- `src/backend/services/conexosSessionStore.test.ts` — cobertura do novo caminho.

**Acceptance criteria:**
- O handler de `error` do pool do session store chama `pool.end()` uma única vez, mesmo com o
  evento disparando repetidamente.
- `closeConexosSessionStorePool()` é idempotente e resolve sem lançar quando não há pool.
- Um `end()` que rejeita não vira unhandled rejection nem propaga.
- Pools Postgres cobertos pelo shutdown: **1 de 2 → 2 de 2**.

**Dependencies:** Task 4

---

### Task 6: Report readiness=false on /health during the drain

`/health` é o `healthCheckPath` do Render e continua devolvendo 200 depois do SIGTERM, porque a
flag `shuttingDown` vive num closure isolado. Sem sinal de readiness o LB pode mandar requisição
nova por keep-alive já aberta dentro da janela do drain — e ela pode cair na fatia
`createRun → finishRun`, que é o que a Task 2 veio evitar. `/health/pipelines` **não** muda.

**Files to change:**
- `src/backend/http/readinessState.ts` (novo) — `markDraining()` / `isDraining()` / `resetForTests()`.
- `src/backend/http/readinessState.test.ts` (novo).
- `src/backend/http/gracefulShutdown.ts` — `markDraining()` no início, **antes** do `server.close`.
- `src/backend/index.ts` — `/health` devolve **503** quando `isDraining()`.

**Acceptance criteria:**
- `/health` responde 200 em operação normal e **503** durante todo o drain.
- `markDraining()` é idempotente; `isDraining()` começa `false`.
- O handler marca o drain antes de chamar `server.close` (ordem assertada em teste).
- `/health/pipelines` permanece inalterado.

**Dependencies:** Task 2

---

### Task 7: Release idle keep-alive sockets so the happy path is not the timeout path

`server.close(cb)` só chama o callback quando **todas** as conexões TCP fecharam, keep-alive
ociosas inclusive. Como o LB do Render mantém keep-alive, o drain tende a estourar o teto
**sempre** — tornando o caminho feliz indistinguível do force-exit.

**Files to change:**
- `src/backend/http/gracefulShutdown.ts` — `server.closeIdleConnections()` (Node ≥18.2) antes do
  `server.close(cb)`, com guarda para o método ausente.

**Acceptance criteria:**
- `closeIdleConnections()` é chamado exatamente 1× por shutdown, **antes** do `server.close`.
- Um `server` sem `closeIdleConnections` não quebra o shutdown (guarda de tipo).
- Ordem completa assertada: `markDraining` → `closeIdleConnections` → `server.close` → `closeAll` → `exit`.

**Dependencies:** Task 6

---

### Task 8: Raise the drain ceiling to use the Render envelope

10s consome só 1/3 do envelope de ~30s entre SIGTERM e SIGKILL. Requisição de escrita financeira
entre 10s e ~28s é força-cortada pelo próprio handler, virando o mesmo órfão `reconciling`.

> **Divergência deliberada do card `fault-tolerance-1`.** O card manda somar `timeout: 20_000` a
> quatro clients Conexos e derivar `drainTimeoutMs = maior_axios_timeout + 5_000`. Medido: os
> clients **não** criam instância axios — há **uma** em `src/backend/services/conexos.ts:121`, já
> com `timeout: 40000`. Seguir o card daria drain de 45s, acima do envelope do Render. E baixar
> 40s→20s é mudança de comportamento de negócio (chamadas longas ao ERP passariam a abortar), que
> não cabe num card de infra sem medir a latência real do Conexos. Portanto: **sobe o drain para
> 25s e NÃO mexe no timeout do axios**; a tensão vira follow-up.

**Files to change:**
- `src/backend/http/gracefulShutdown.ts` — `DEFAULT_DRAIN_TIMEOUT_MS` 10_000 → 25_000.
- `ontology/_inbox/tapar-furos-backend-regis-followups.md` — registrar a divergência.

**Acceptance criteria:**
- `DEFAULT_DRAIN_TIMEOUT_MS === 25_000`, com o raciocínio do envelope no comentário.
- `drainTimeoutMs` continua injetável por parâmetro.
- A divergência está escrita nos follow-ups, com a medição que a motiva.

**Dependencies:** Task 2

---

### Task 9: Make a force-exit visible to the operations panel

A saída forçada só imprime em `console.log`. Uma rota que **sempre** estoura o drain truncaria
requisições a cada restart com zero visibilidade em `/operacao`. A ADR-0042 gastou um workflow
inteiro para não deixar falha invisível. O código de saída **continua 0** — não é falha, é
orçamento estourado; o sinal vai pelo canal certo. Callback em vez de resolver o `LogService`
dentro do módulo, para manter a injeção pura.

**Files to change:**
- `src/backend/http/gracefulShutdown.ts` — `onForceExit?: (reason: string) => void | Promise<void>`.
- `src/backend/index.ts` — amarrar em `LogService.warn` com `type: 'OPERATIONAL_WARN'`.

**Acceptance criteria:**
- Force-exit invoca `onForceExit` 1× com a razão; drain normal **não** o invoca.
- `onForceExit` que rejeita não impede `onExit(0)`.
- Código de saída permanece **0** em ambos os caminhos.

**Dependencies:** Task 2

---

### Task 10: Redact the shutdown error log

O `pg`, ao rejeitar `end()` sobre um pool quebrado, pode trazer usuário do Postgres ou host interno
do Supabase. O drain de logs do Render sai do perímetro do processo. O projeto já tem o redator.

**Files to change:**
- `src/backend/http/gracefulShutdown.ts` — envolver com `redactErrorMessage` de `./redact.js`.

**Acceptance criteria:**
- Erro com `password authentication failed for user "financeiro"` sai como `for user "[REDACTED]"`.
- Caminhos de log de erro em `http/` sem redator: **1 → 0**.

**Dependencies:** Task 2

---

### Task 11: Cover the three real uncovered branches of gracefulShutdown

Branches em 58,82% (10/17). Três importam: o callback de `server.close` com `err`; a guarda
`if (exited) return` (hoje nunca atingida — remover o `clearTimeout` deixaria os 8 testes verdes
com `onExit` chamado 2×); e o default `target = process`.

**Files to change:**
- `src/backend/http/gracefulShutdown.test.ts` — 3 casos novos.

**Acceptance criteria:**
- Caso 1: `cb(new Error('EADDRINUSE'))` loga `server.close reportou` e o drain roda mesmo assim.
- Caso 2: timer disparando **depois** do drain concluído → `onExit` chamado exatamente 1×.
- Caso 3: o default `target = process` é exercitado, com `removeListener` no teardown.
- Branches de `http/gracefulShutdown.ts` ≥ **82%**.

**Dependencies:** Tasks 6-10

---

### Task 12: Extract the boot sequence into a testable module

`start()` tem 5 passos ordenados e **zero** cobertura, porque `index.ts` dispara `start()` no
import. A ordem já causou incidente em 2026-08-10. É invariante documentada sem teste.

**Files to change:**
- `src/backend/http/bootstrap.ts` (novo) — `startServer(deps)` com deps injetadas.
- `src/backend/http/bootstrap.test.ts` (novo).
- `src/backend/index.ts` — monta as deps e chama `startServer`.

**Acceptance criteria:**
- ≥ 4 testes cobrindo: ordem correta; falha de migração **aborta antes** do `listen`; `diagnose`
  roda **depois** das migrations; shutdown registrado **depois** do `listen`.
- `index.ts` deixa de conter a sequência de boot.
- Falha no boot continua saindo com código 1.

**Dependencies:** Tasks 4-10

---

### Task 13: Document the Supabase session budget

Com 6 crons + web service a `poolMaxConnections = 5`, o teto teórico é ~35 sessões; um bump futuro
pode estourar o plano sem alarme.

> O card também pede probe de `pg_stat_database` com alerta a 70%. Fica **fora** desta rodada:
> exige decidir onde mora e um teto real que só o dashboard do Supabase informa — número que eu não
> tenho e não vou inventar. Documento o budget e registro o probe como follow-up.

**Files to change:**
- `DEPLOY.md` — tabela de budget de sessões.
- `ontology/_inbox/tapar-furos-backend-regis-followups.md` — o probe como follow-up.

**Acceptance criteria:**
- `DEPLOY.md` tem tabela de budget com a conta explícita e o teto real marcado como pendente.
- O follow-up nomeia o dado que falta (Pool size do Supavisor no dashboard).

**Dependencies:** none

---

### Task 14: Write the rollback runbook

`autoDeploy: true` — cada push em `main` sobe. A assimetria que mais importa é a de schema:
reverter **código** sem reverter **schema** é seguro; o contrário não é.

**Files to change:**
- `docs/runbooks/rollback.md` (novo).
- `DEPLOY.md` — referência cruzada.

**Acceptance criteria:**
- O runbook cobre: localizar o deploy anterior; o botão de rollback; a regra sobre migrations
  irreversíveis; validação por `/health` e `/health/pipelines`; quando escalar.
- `DEPLOY.md` aponta para ele.

**Dependencies:** none

---

### Task 15: Reconcile render.yaml with the boot that actually runs

`render.yaml` declara `preDeployCommand` que **nunca roda** (pre-deploy é de plano pago). A
mitigação real é o `BootMigrator`. Duas fontes discordantes: o próximo dev que "limpar" o boot pode
remover o `BootMigrator` acreditando que o Render cobre. Escolhida a **opção (b)** do card; a (a) —
upgrade de plano — é decisão comercial do Yuri.

**Files to change:**
- `render.yaml` — remover o `preDeployCommand` órfão e apontar para o `BootMigrator`.

**Acceptance criteria:**
- Fontes divergentes sobre quando as migrations rodam: **2 → 1**.
- `render.yaml` aponta explicitamente para o `BootMigrator`.
- Nenhuma mudança de comportamento (o comando já não executava).

**Dependencies:** none

---

# Rodada 3 — remediar um defeito introduzido pela Task 5

### Task 16: Rebuild the session store pool instead of leaving it dead

Apontado pelo coordenador ao revisar o delta. O diagnóstico que escrevi na Task 5 estava errado num
ponto que **muda a correção**: eu tratei o caso como "a mesma assinatura do BE-05". Não é.

| | `PostgreeDatabaseClient` (BE-05) | `conexosSessionStore` |
|---|---|---|
| Criação do pool | **recriado a cada `init()`** | criado **uma vez**, capturado na closure de `db.query` |
| Efeito do erro sem `end()` | pool órfão por evento → vazamento **cumulativo** | pool único; **sem acúmulo** |
| `end()` sozinho basta? | **sim** — a `init()` seguinte reconstrói | **não** — nada reconstrói |

Consequência: encerrar o pool na Task 5 deixou `db.query` fechando sobre um pool morto. Toda query
subsequente falhava, o store degradava para "miss" e **ficava assim até o processo terminar** — eu
troquei 2 conexões penduradas por deploy por um session store permanentemente cego. Pior que o
`() => undefined` original, porque o `pg` sozinho apenas remove o cliente ocioso com erro e segue
servindo.

**Files to change:**
- `src/backend/services/conexosSessionStore.ts` — o pool passa a viver num `PoolHolder`; o handler
  de `error` encerra o quebrado (guarda de reentrada mantida) e **esvazia o slot**, e a próxima
  chamada reconstrói. `closeConexosSessionStorePool` marca `storeClosed`, esvazia os holders e
  **trava a reconstrução** — reabrir conexões durante o drain anularia o shutdown gracioso. O erro
  engolido ganha `console.warn` redigido com `redactErrorMessage`: barulho mínimo, rastro existente,
  e a propriedade original preservada (o processo **não** cai num erro de socket ocioso; nenhum
  `throw` acrescentado).
- `src/backend/services/conexosSessionStorePool.test.ts` — 3 testes novos.

> **Fora de escopo por decisão do coordenador:** migrar este módulo para DDD. É legado pré-DDD e lê
> `process.env` direto, exceção documentada na própria docstring. Misturar aqui poluiria o delta.

**Acceptance criteria:**
- Depois de um evento de `error`, a chamada seguinte funciona **num pool novo** — teste que falha
  contra a implementação da Task 5.
- Guarda de reentrada mantida: `end()` uma única vez por pool, mesmo com o evento repetindo.
- Depois de `closeConexosSessionStorePool()`, uma query **não** reabre pool; o store degrada para
  "miss" (contrato dele em qualquer erro).
- O `console.warn` sai redigido: erro com `password authentication failed for user "financeiro"`
  aparece como `for user "[REDACTED]"`.
- Nenhum `throw` novo no handler de `error`.

**Dependencies:** Task 5
