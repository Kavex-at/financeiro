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
