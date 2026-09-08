---
qa: Testability
qa_slug: testability
run_id: 2026-09-03-1901-tapar-furos-backend
agent: qa-testability
generated_at: 2026-09-03T19:35:00-03:00
scope: backend
score: 8
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

O delta é um tweak defensivo de 5 arquivos que ataca três frentes de testabilidade:
(a) um caminho de código antes inalcançável pelos testes (`Pool.on('error', …)`);
(b) a extração de um shutdown que não podia ser exercitado sem subir um servidor real;
(c) um gate de lint que reportava sucesso sem examinar código. O cenário abaixo é o do
desenvolvedor abrindo um worktree novo (fluxo obrigatório pela Inviolable Rule #10).

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor abrindo um worktree novo (`git worktree add …`) | Executa `npm run lint`/`test`/`typecheck`/`build` sem `node_modules` populado | Scripts do `src/backend/package.json` | Local dev, pré-symlink de `node_modules` | Todos os quatro gates falham com exit 127 e mensagem explícita `X: not found` — nenhum sinal verde silencioso | 4/4 gates com exit ≠ 0 quando ferramenta ausente (baseline pré-delta: 1/4 — só o `lint` era falso-verde) |
| Orquestrador do Render mandando SIGTERM no deploy | Sinal chega enquanto o handler tem `createRun` sem `finishRun` correspondente | `src/backend/http/gracefulShutdown.ts` (novo) + `PostgreeDatabaseClient.close` | Produção sob deploy contínuo | Handler drena requisições em voo, fecha pool, sai com 0 antes do SIGKILL do Render (~30s) | Máquina de estados coberta por 8 testes com fake-timers; caminho crítico determinístico sem porta/processo/banco |
| Um erro fatal no `Pool` do pg (`too many clients`, `MaxClientsInSessionMode`) | O evento `error` do pool é emitido durante uma janela de retry | `PostgreeDatabaseClient.ts` handler de `'error'` | Produção sob esgotamento de conexões do Supabase | Pool quebrado é encerrado (`end()`) antes de zerar a referência; próxima `init()` abre pool limpo sem vazar as 5 sessões antigas | Cobertura do handler passou de 0 (mock antigo descartava `on`) para 4 testes que emitem o evento real de dentro do teste |

## 2. Métricas observadas

Métricas do delta — todas coletadas do run `--coverage` já executado em `_shared-metrics.md`
e do lcov (`src/backend/coverage/lcov.info`). Nenhuma métrica global recoletada por
imposição do flag `--quick`.

### 2.1 Cobertura por camada tocada pelo delta

| Artefato | Stmts | Branches | Funcs | Lines | Alvo defensável | Status | Fonte |
|---|---:|---:|---:|---:|---|---|---|
| `http/gracefulShutdown.ts` (NOVO) | 93,61% | **58,82%** | 90,00% | 100,00% | 90/70/90/90 (arquivo novo, sem legado) | ⚠️ branches | `src/backend/coverage/lcov.info:SF:http/gracefulShutdown.ts` |
| `domain/client/database/PostgreeDatabaseClient.ts` | — | — | — | — | — | ✅ delta cobre o handler de `error` antes inalcançável | `PostgreeDatabaseClient.test.ts` — 4 testes novos no `describe('pool error handling (BE-05)')` + 3 no `describe('close (shutdown gracioso)')` |
| `src/backend/index.ts` | 0% | 0% | 0% | 0% | ⚠️ **estruturalmente não testável** — `void start()` no topo dispara servidor no `import` | ❌ inalterado pelo delta | inspeção de `index.ts:169` |
| Global backend | 90,39% | 71,54% | 89,63% | 91,43% | thresholds do `jest.config.cjs` (72/54/78) | ✅ folga confortável | `_shared-metrics.md` §"Gates" |
| `domain/service/` (agregado) | 91,17% | 64,28% | — | — | threshold do `jest.config.cjs` (88/60) | ✅ | idem |

### 2.2 Integridade dos gates (contra o padrão "gate que mente")

Reproduzido em diretório isolado com o `package.json` **real** copiado, sem `node_modules`:

| Gate | Comando após delta | Exit sem `node_modules` | Baseline pré-delta | Status |
|---|---|---:|---:|---|
| BE test | `jest` (direto) | **127** | 127 | ✅ hard-fail |
| BE typecheck | `tsc --noEmit` (direto) | **127** | 127 | ✅ hard-fail |
| BE build | `tsc && tsc-esm-fix dist` (direto) | **127** | 127 | ✅ hard-fail |
| BE lint | `biome check .` (direto) | **127** | **0** ← BE-09 | ✅ **hard-fail (era o único mentindo)** |
| FE lint | `eslint .` (direto) | **127** | 127 | ✅ hard-fail |
| FE typecheck | `tsc --noEmit` (direto) | **127** | 127 | ✅ hard-fail |
| FE test | `jest --passWithNoTests` (direto) | **127** | 127 | ✅ hard-fail |
| FE build | `next build` (direto) | **127** | 127 | ✅ hard-fail |

O delta fechou a única brecha: **7/8 gates já falhavam corretamente antes; o 8º (`lint`
backend) subiu de "silêncio → 0" para "`biome: not found` → 127"**. Nenhum outro script
usava `npx` no repo. O padrão "chame a ferramenta pelo nome" agora vale para todos os
scripts que compõem os green criteria do AutoLoopRunner.

### 2.3 Branches descobertas em `gracefulShutdown.ts` (58,82% = 10/17)

Extraído de `src/backend/coverage/lcov.info` (`BRDA:linha,bloco,ramo,hits`):

| Linha | Ramo não hit | O que fica sem defesa | Peso |
|---|---|---|---|
| 100 | `if (err) log(…)` no callback de `server.close` | O caminho onde `server.close` sinaliza erro é **inteiramente silencioso nos testes** — nenhum caso reproduz erro na drenagem do listener HTTP | **P2** |
| 68 | `if (exited) return;` em `exitOnce` | A guarda de idempotência não é exercitada — não há teste onde a drenagem termina **E** o `setTimeout` dispara. Se alguém quebrar `clearTimeout(forceExitTimer)`, `onExit` pode ser chamado 2× sem que o teste perceba | **P2** |
| 112 | Default `target: SignalTarget = process` | Nenhum teste chama `registerGracefulShutdown` sem `target` → o wire real com `process.on('SIGTERM')` só é validado em produção. Um typo no default (`= procces` etc.) passa | **P3** |
| 51 | Default `log ?? console.log` | Todos os 8 testes injetam `log`. O caminho default é dead code do ponto de vista de teste | **P3** |
| 43 | `asMessage` fallback `String(error)` para não-`Error` | `closePool` que rejeite com string/`{}` não é testado | **P3** |
| 85 | `typeof timerHandle.unref !== 'function'` | Runtimes sem `.unref()` (Deno-ish) — edge irrelevante em Node | N/A |
| 70 | `if (forceExitTimer)` falsy | Dead code: `forceExitTimer` é sempre atribuído antes de `exitOnce` rodar | N/A |

Cinco branches "reais"; duas são estrutural­mente inalcançáveis ou fora do runtime alvo.
Os P2 são os que importam: **as duas úni­cas ramificações onde o handler pode se
comportar mal e o teste continuaria verde**.

### 2.4 Não medível localmente

> ⚠️ **Não medível localmente:** vazamento residual de sessões no Supabase após um deploy
> real (métrica-alvo do BE-05/BE-06). Requer inspeção do painel do Supavisor
> (`pg_stat_activity` do pooler). Recomendação: adicionar `job:probe-pool-usage` que
> loga contagem de `state='idle'` de 5-em-5min pós-deploy, para transformar o número
> em série temporal observável.

> ⚠️ **Não medível localmente:** cobertura do wiring com o processo real
> (`process.on('SIGTERM')` de fato encaminha ao handler). Requer teste E2E com filho
> `child_process.fork` + envio de sinal. Ver card `testability-1`.

## 3. Tactics — Cobertura no delta

Escopo restrito às tactics de testabilidade de Bass & Clements aplicadas aos 5 arquivos
do delta. Tactics irrelevantes ao delta são `N/A` com uma linha de justificativa.

### Control and Observe System State

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Specialize Access Routes / Interfaces | `GracefulShutdownDeps` recebe `server`/`closePool`/`onExit`/`log`/`drainTimeoutMs` por parâmetro — a máquina de estados é exercitável sem porta, processo ou banco | ✅ presente | `http/gracefulShutdown.ts:27-36` + `http/gracefulShutdown.test.ts:11-25` (`createServerFake`) |
| Specialize Access Routes / Interfaces | Mock de `pg.Pool` no `PostgreeDatabaseClient.test.ts` **passou a capturar** os listeners de `error` e expor `emitError()` — o handler antes só era executável por acidente do `pg` real | ✅ presente (novo) | `PostgreeDatabaseClient.test.ts:19-36` |
| Specialize Access Routes / Interfaces | Scripts npm passaram a chamar a ferramenta pelo nome (`biome`, `tsc`, `jest`) — o exit code é resposta real, não silêncio de `npx` sem cache | ✅ presente (novo) | `package.json:26-27` + reprodução §2.2 |
| Record / Playback (Recordable Test Cases) | Tests não gravam sessões reais; usam fakes construídos à mão | N/A | Nenhum client externo tocado pelo delta |
| Sandbox | `jest.useFakeTimers()` isola o teste do relógio real; `deps.onExit` isolado do `process.exit` real | ✅ presente | `http/gracefulShutdown.test.ts:29-31` + docstring da interface em `gracefulShutdown.ts:32` |
| Executable Assertions | Testes assertam **ordem** de operações (`order.push('server.close'); order.push('closePool'); order.push('exit(0)')`) — invariante temporal virou spec | ✅ presente | `http/gracefulShutdown.test.ts:44-55` |
| Executable Assertions | Testes assertam **idempotência** do `close()` do pool e do handler de sinal (2ª chamada é no-op) | ✅ presente | `PostgreeDatabaseClient.test.ts:229-234`; `gracefulShutdown.test.ts:73-88` |
| Abstract Data Sources | `environmentProvider` já era abstrato via tsyringe; delta não regride | ✅ inalterado | `PostgreeDatabaseClient.ts:49-52` |

### Limit Complexity

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Limit Structural Complexity | Handler extraído para módulo próprio **justamente** porque `index.ts` dispara `start()` no `import` — extração citada em docstring como decisão de testabilidade | ✅ presente (novo) | `http/gracefulShutdown.ts:11-14` (docstring) |
| Limit Structural Complexity | `PostgreeDatabaseClient.close()` isolado do handler de `error` e do `init()` — um caminho, uma responsabilidade | ✅ presente (novo) | `PostgreeDatabaseClient.ts:100-116` |
| Limit Structural Complexity | `index.ts` **continua** com `void start()` no top-level e sem cobertura de teste — o delta só extraiu o shutdown, não o `start` | ⚠️ parcial | `index.ts:174-179` |
| Limit Non-Determinism | Uso limpo de `jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync` — nenhum `setTimeout` real, nenhuma flakiness de tempo | ✅ presente | `gracefulShutdown.test.ts:29-31, 51, 61, …` |
| Limit Non-Determinism | Handler não lê `Date.now()` nem `Math.random()` — só usa `setTimeout` com valor injetável (`drainTimeoutMs`) | ✅ presente | `grep -n 'Date\|Math.random' src/backend/http/*.ts` (nenhum resultado) |
| Limit Non-Determinism | `PostgreeDatabaseClient.test.ts` não usa `beforeAll`; estado do mock reinicializado em `beforeEach` (sem vazamento entre casos) | ✅ presente | `PostgreeDatabaseClient.test.ts:44-54` |

## 4. Findings (achados)

### F-testability-1: `server.close` reportando erro é caminho sem teste

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/http/gracefulShutdown.ts:99-102`
- **Evidência (objetiva)**:
  ```
  BRDA:100,7,0,0    ← branch "err truthy" hit 0 vezes
  BRDA:100,7,1,5    ← branch "err falsy" hit 5
  ```
  ```typescript
  deps.server.close((err?: Error) => {
      if (err) log(`[shutdown] server.close reportou: ${err.message}`);
      void drain();
  });
  ```
- **Impacto técnico**: uma alteração que troque `if (err) log(...)` por `if (err) return`
  (por exemplo, "vou tratar erro cortando drenagem cedo") passa em todos os 8 testes.
- **Impacto de negócio**: o log dedicado a diagnosticar "server.close não conseguiu
  fechar" existe justamente para saber o motivo quando um deploy sobreviver ao SIGTERM
  e for morto por SIGKILL — a evidência da causa raiz é código não coberto.
- **Métrica de baseline**: 1 branch coberto de 2 (linha 100) — 0 de 5 casos exercita o
  callback com `err`.

### F-testability-2: guarda de idempotência de `exitOnce` sem prova de teste

- **Severidade**: P2
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/http/gracefulShutdown.ts:67-75`
- **Evidência (objetiva)**:
  ```
  BRDA:68,4,0,0     ← branch "exited=true, return early" hit 0
  BRDA:68,4,1,6     ← branch "exited=false, proceed" hit 6
  ```
  ```typescript
  const exitOnce = (reason: string): void => {
      if (exited) return;         // ← nunca é hit "return early"
      exited = true;
      if (forceExitTimer) clearTimeout(forceExitTimer);
      log(`[shutdown] ${reason}`);
      deps.onExit(0);
  };
  ```
  O teste `clears the force-exit timer on the happy path` verifica que `onExit` roda
  1× após avançar `DEFAULT_DRAIN_TIMEOUT_MS * 2` — mas como `clearTimeout` foi chamado,
  o callback do timer nem sequer executa. O teste **não** força a race real (drain
  completa **e** o timer dispara antes de o `clearTimeout` propagar).
- **Impacto técnico**: se alguém remover a linha `clearTimeout(forceExitTimer)` (linha
  70) ou trocar o `if (exited) return` por um `log(...)`-then-`exit`, os 8 testes
  seguem verdes e o processo passa a chamar `onExit(0)` **duas vezes** por shutdown
  em produção.
- **Impacto de negócio**: `onExit` mapeia para `process.exit` — chamá-lo duas vezes
  pode gerar warnings ou race com handlers `beforeExit`. Consequência menor, mas o
  padrão de "guarda sem teste" é o mesmo em várias camadas do repo e vale calibrar
  aqui.
- **Métrica de baseline**: 1 branch coberto de 2 (linha 68) — 0 de 8 testes reproduz
  a race entre timer e drenagem.

### F-testability-3: `index.ts` continua sem teste porque dispara `start()` no import

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/index.ts:174-179`
- **Evidência (objetiva)**:
  ```typescript
  void start().catch((error: unknown) => {
      console.error('[boot] FALHOU ao subir:', …);
      process.exit(1);
  });
  ```
  O delta extraiu **corretamente** `gracefulShutdown.ts` para módulo próprio
  precisamente porque `index.ts` executa `start()` no top-level — a docstring do
  novo módulo explicita isso (linhas 11-14). Mas o `start()` em si permanece
  monolítico: registra token do container, roda `BootMigrator`, chama
  `diagnosticarConfiguracao`, abre listen, e registra o shutdown, tudo em sequência
  não interceptável.
- **Impacto técnico**: qualquer regressão na ordem de boot (por exemplo, mover
  `diagnosticarConfiguracao` para antes de `BootMigrator.run()` — o comentário do
  próprio código explica por que a ordem importa) não tem defensor de teste. A
  ordem sobrevive por convenção documentada, não por CI.
- **Impacto de negócio**: já houve um incidente por ordem de boot errada
  (a docstring cita "2026-08-10, código da ADR-0032 chegou a produção antes da
  0044") — o padrão de "sequência de boot documentada sem teste" é o mesmo que
  produziu aquele evento.
- **Métrica de baseline**: `src/backend/index.ts` — 0% linhas/branches/funções
  cobertas; delta não moveu esse número.

### F-testability-4: threshold de cobertura do frontend é honesto mas não tem plano de ratchet

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (a asserção de piso existe mas está calibrada
  em 20/9/14)
- **Localização**: `src/frontend/jest.config.cjs:31-40`
- **Evidência (objetiva)**:
  ```javascript
  coverageThreshold: {
      global: { lines: 20, branches: 9, functions: 14 },
      './lib/auth/': { lines: 24 },
  },
  ```
  O comentário do próprio arquivo documenta que o número anterior (~82%) era "Potemkin"
  porque `collectCoverageFrom` não incluía todas as fontes. O baseline atual é honesto
  (~20% lines / 9% branches / 14% functions), mas está **fixo** — não há mecanismo de
  ratchet nem calendário para subir.
- **Impacto técnico**: nada trava se a cobertura permanecer em 20% por 12 meses. Feature
  de FE que suba código sem teste **não** faz o gate cair — só regressão abaixo do piso
  atual.
- **Impacto de negócio**: o piso serve para prevenir regressão. Sem ratchet, ele não
  serve para **melhorar** — ambos são funções distintas do threshold.
- **Métrica de baseline**: 20% lines / 9% branches / 14% functions (piso), sem calendário
  de bump.

### F-testability-5: fallback do `asMessage` para não-`Error` está descoberto

- **Severidade**: P3
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/http/gracefulShutdown.ts:42-43`
- **Evidência (objetiva)**:
  ```
  BRDA:43,0,0,1   ← branch "instanceof Error" hit 1
  BRDA:43,0,1,0   ← branch "String(error) fallback" hit 0
  ```
  O teste `still exits 0 when closePool rejects` rejeita com `new Error(...)` —
  ninguém rejeita com string ou objeto simples, e o helper `asMessage` existe
  precisamente para lidar com isso.
- **Impacto técnico**: mínimo — pg costuma rejeitar com `Error`. Mas o helper existe
  como defesa; se ele quebrar, ninguém notará no teste.
- **Impacto de negócio**: baixo — o pior caso é o log de shutdown vir `[object Object]`
  em vez da mensagem, o que dificultaria um post-mortem raro.
- **Métrica de baseline**: 1 branch coberto de 2 (linha 43).

## 5. Cards Kanban

### [testability-1] Cobrir os 3 branches "reais" descobertos em `gracefulShutdown.ts`

- **Problema**
  > A cobertura de branches ficou em 58,82% (10/17) no módulo novo. Duas ramificações
  > importam: (a) o callback de `server.close` sendo chamado com `err` — hoje 0 dos 8
  > testes exercita esse caminho; (b) o `exitOnce` sendo chamado duas vezes por uma
  > race entre a drenagem e o `setTimeout` — a guarda `if (exited) return` nunca é
  > hit. Um teste de smoke que exercite o wire real com `process.on('SIGTERM')` fecha
  > a 3ª (default `target = process`).

- **Melhoria Proposta**
  > Adicionar 3 casos em `http/gracefulShutdown.test.ts`:
  > 1. `handles server.close reporting an error while still draining` — passar `cb(new Error('EADDRINUSE'))` no fake e assertar que o log contém `"server.close reportou"` e que `drain` roda mesmo assim;
  > 2. `exit is idempotent when timer fires after drain completes` — controlar o fake de `server.close` para chamar `cb` **após** `advanceTimersByTimeAsync(drainTimeoutMs)` e assertar `onExit` chamado exatamente 1×;
  > 3. Smoke E2E via `child_process.fork` de um `fixtures/graceful-shutdown-child.ts` que registra o handler com `target = process` real, envio de `SIGTERM` pelo pai, e assert de exit code 0 dentro de 500ms. Tactic Bass alvo: **Executable Assertions** (para 1 e 2) + **Specialize Access Routes** (para 3).

- **Resultado Esperado**
  > Branches em `http/gracefulShutdown.ts` sobem de **58,82% (10/17)** para **≥ 82% (14/17)**. Os 3 branches com impacto real cobertos; os 3 restantes (`log` default, `unref` ausente, `forceExitTimer` falsy) permanecem justificáveis como dead code ou fora do runtime.

- **Tactic alvo**: Executable Assertions, Specialize Access Routes/Interfaces
- **Severidade**: P2
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-1, F-testability-2, F-testability-5
- **Métricas de sucesso**:
  - Branches `gracefulShutdown.ts`: 58,82% → ≥ 82%
  - Testes no arquivo: 8 → 11
  - Branches "reais" descobertos (excluindo dead code): 3 → 0
- **Risco de não fazer**: o handler pode ser refatorado com regressões silenciosas —
  chamar `onExit` 2× em produção, ou perder o log de `server.close` erro que existiria
  para diagnosticar um SIGKILL. Pequeno em blast radius, mas exatamente o tipo de bug
  que só aparece durante um incidente.
- **Dependências**: nenhuma

### [testability-2] Extrair `start()` do `index.ts` para módulo testável

- **Problema**
  > O delta corretamente extraiu `registerGracefulShutdown` para módulo próprio
  > justificando na docstring que `index.ts` dispara `start()` no `import`. Mas o
  > `start()` em si permanece monolítico e não testado: 5 passos ordenados (register
  > MIGRATION_RUNNER_TOKEN → BootMigrator → diagnosticarConfiguracao → app.listen →
  > registerGracefulShutdown) cuja ordem já causou incidente em 2026-08-10
  > (`index.ts:159`, "código da ADR-0032 chegou a produção antes da 0044"). Zero
  > cobertura em `src/backend/index.ts`.

- **Melhoria Proposta**
  > Extrair `start()` para `src/backend/http/bootstrap.ts` com assinatura
  > `startServer(deps: BootstrapDeps): Promise<{ close: () => Promise<void> }>` —
  > `deps` traz `container`, `port`, `listen: (app, port, cb) => Server`,
  > `runMigrations`, `diagnose`. `index.ts` fica com apenas o topo (`import`s +
  > `void startServer({...}).catch(...)`). Escrever `bootstrap.test.ts` que valida a
  > **ordem** dos passos com um `order: string[]` (mesmo padrão do
  > `gracefulShutdown.test.ts` linhas 44-55). Tactic Bass alvo: **Limit Structural
  > Complexity** + **Executable Assertions** para a ordem.

- **Resultado Esperado**
  > `src/backend/index.ts` reduz de ~180 linhas com boot embutido para ~30 linhas de
  > wiring puro. `src/backend/http/bootstrap.ts` nasce com ≥ 4 testes (ordem correta,
  > falha em migração aborta antes do listen, `diagnosticarConfiguracao` roda depois
  > das migrations, shutdown é registrado após listen). Cobertura de `index.ts`
  > continua irrelevante (só imports), mas a **sequência de boot** deixa de ser
  > invariante-documentada-sem-teste.

- **Tactic alvo**: Limit Structural Complexity, Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: M (2-3d)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Testes cobrindo a ordem do boot: 0 → ≥ 4
  - Passos do boot fora de teste: 5 → 0
  - LOC de `src/backend/index.ts`: ~180 → ≤ 40 (só wiring)
- **Risco de não fazer**: repetição do padrão do incidente 2026-08-10 — a próxima
  reordenação inadvertida dos passos de boot (mover `diagnose` para antes de
  `migrate`, mover `listen` para antes de `migrate`, etc.) só é pega em produção.
- **Dependências**: nenhuma. Alinha com card `modifiability-*` que também deve
  atacar `index.ts`.

### [testability-3] Sanity-test dos gates locais (proteger contra futuras regressões tipo BE-09)

- **Problema**
  > BE-09 foi um gate que mentia — `npx biome check .` saía 0 sem `node_modules`.
  > O delta corrigiu removendo `npx`, mas nada impede que alguém reintroduza o
  > padrão (o script `dev` do backend usa `tsx watch` sem `npx`, mas um
  > desenvolvedor pode adicionar `"lint:extra": "npx biome …"` sem gate). Reprodução
  > controlada dos 4 gates do backend + 4 do frontend em §2.2 confirma que hoje
  > todos falham com 127 sem `node_modules`, mas essa verificação é ad-hoc.

- **Melhoria Proposta**
  > Adicionar um teste em `src/backend/package.json.test.ts` que carrega o próprio
  > `package.json`, itera pelos scripts críticos (`lint`, `test`, `typecheck`,
  > `build`) e falha se algum começar com `npx `. Mesma coisa para
  > `src/frontend/package.json.test.ts`. Tactic Bass alvo: **Executable Assertions**
  > sobre um contrato do próprio harness. Alternativa mais leve: um step no CI
  > (`ci.yml`) que roda `grep -E "\"(lint|test|typecheck|build)\":\s*\"npx " package.json`
  > e falha se casar.

- **Resultado Esperado**
  > O ataque "adicionar `npx` num script crítico e passar despercebido" deixa de
  > existir. Gates locais que retornam 0 sem examinar código: **1 → 0** (baseline
  > medido §2.2). Custo do teste: 5 linhas por lado.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤ 2h)
- **Findings relacionados**: (nenhum — este card é preventivo, ancorado na §2.2
  como evidência de que a classe de bug existe)
- **Métricas de sucesso**:
  - Scripts críticos com prefixo `npx` no repo: 0 → **e o valor fica travado em 0**
  - Testes que verificam o contrato dos scripts: 0 → 2
- **Risco de não fazer**: BE-09 volta a acontecer no primeiro dev que puxar um
  package novo com `npx cliente-x --gerar` num script `build:extra` sem perceber
  o silent-0.
- **Dependências**: nenhuma. Cross-QA: cuida diretamente do gate de deploy
  (`deployability`).

### [testability-4] Instaurar ratchet mensal no threshold de cobertura do frontend

- **Problema**
  > O `jest.config.cjs` do frontend fixou o piso em 20% lines / 9% branches /
  > 14% functions após corrigir a medição "Potemkin" (comentário do próprio
  > arquivo). O piso é honesto, mas está fixo desde 2026-06-26 — não há mecanismo
  > que force sobe-piso conforme testes vão sendo escritos. Feature nova pode
  > mergear com 0% de cobertura no arquivo dela sem impactar o gate.

- **Melhoria Proposta**
  > Adicionar um script `scripts/ratchet-coverage.mjs` que:
  > 1. Lê o `coverage-summary.json` gerado pelo `jest --coverage`;
  > 2. Compara com os thresholds atuais do `jest.config.cjs`;
  > 3. Se coverage-atual > threshold + 2 (folga), levanta o threshold para
  >    `floor(coverage-atual - 1)` e commita. Roda **weekly** via workflow
  >    dedicado (`.github/workflows/coverage-ratchet.yml`), abrindo PR
  >    automaticamente. Tactic Bass alvo: **Executable Assertions** (o piso
  >    passa a ser executável e evolutivo).

- **Resultado Esperado**
  > Threshold de linhas do frontend deixa de ser estático em 20%. Meta 6 meses:
  > **20% → 40%** (crescimento orgânico conforme features novas trazem testes).
  > Meta 12 meses: **≥ 60%**. Regressão continua travada, mas melhoria também
  > passa a ser mensurável.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P3
- **Esforço estimado**: S (≤ 1d)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Piso de cobertura de linhas do FE: 20% → ≥ 40% em 6 meses
  - Data do último bump do threshold: **agora estática (2026-06-26)** → **≤ 30d atrás sempre**
- **Risco de não fazer**: cobertura FE ficar em 20% permanentemente enquanto as
  telas mais críticas (SISPAG, painel de operação) crescem sem defensor. A dívida
  vira permanente sem que ninguém a veja no dashboard.
- **Dependências**: nenhuma

## 6. Notas do agente

- Escopo restrito ao delta por ordem do run — não recoletei métricas globais (suíte
  ~47s, `--quick`). Baseline usado é o de `_shared-metrics.md`.
- Reproduzi §2.2 (integridade dos gates) copiando o `package.json` real para um dir
  isolado sem `node_modules` — confirmei que o único gate falso-verde era o `lint`
  backend, e o delta o corrigiu. Os outros 7 gates (4 backend + 4 frontend) já
  falhavam com 127 antes do delta.
- Analisei o `lcov.info` linha-a-linha (BRDA) para separar os 7 branches descobertos
  em `gracefulShutdown.ts` entre "real" (3) e "dead code / edge irrelevante" (4).
  Sem isso o número 58,82% engana em ambos os sentidos.
- **Cross-QA**: (i) F-testability-3 e card `testability-2` sobrepõem com
  **Modifiability** — a extração de `bootstrap.ts` reduz o boot monolítico do
  `index.ts`; alertar o consolidator. (ii) Card `testability-3` (gates que mentem)
  sobrepõe com **Deployability** — gate silencioso = deploy quebrado sem sinal.
  (iii) Cobertura da máquina de estados de shutdown (F-testability-2) sobrepõe com
  **Fault Tolerance** — o ciclo drain→closePool→exit é o mesmo que o
  `reaper-sispag` limpa quando falha. (iv) Fake-timers usado limpo no delta
  (`useFakeTimers`/`advanceTimersByTimeAsync`) é exemplo canônico da tactic
  **Limit Non-Determinism** — vale citar em `modifiability` como padrão a replicar.
