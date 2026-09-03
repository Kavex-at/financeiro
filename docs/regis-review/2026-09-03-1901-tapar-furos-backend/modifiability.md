---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-03-1901-tapar-furos-backend
agent: qa-modifiability
generated_at: 2026-09-03T19:20:00-03:00
scope: backend
score: 8.5
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta)

O delta `tapar-furos-backend` mexe em três seams distintos (client do banco, boot HTTP, scripts npm). O que este QA avalia é: o desenho recém-introduzido facilita ou dificulta a próxima mudança em cada um desses seams (mudar a janela de drenagem, mudar o pool para reagir a outro erro, mudar o script de lint)?

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev do time Kavex | Encurtar/estender a janela de drenagem SIGTERM (Render mudou de 30s→45s) | `http/gracefulShutdown.ts` + wiring em `index.ts` | Runtime Express/Render, deploy noturno | Ajuste feito em ponto único, sem tocar client de banco nem rotas, coberto por teste unitário existente | ≤1 arquivo tocado; 0 testes novos exigidos; sem redeploy de infra |
| Dev do time Kavex | Adicionar um novo tipo de recurso a fechar no shutdown (SES/SQS quando existirem) | `http/gracefulShutdown.ts` (contrato `GracefulShutdownDeps`) | Runtime Express | Novo campo em `GracefulShutdownDeps` + linha no `index.ts` | ≤2 arquivos tocados; contrato explícito impede vazar `container.resolve()` para o módulo |
| Ops/analista | Mudar o comportamento do handler `error` do pool (ex.: notificar antes de fechar) | `PostgreeDatabaseClient.ts` | Runtime Express + jobs (compartilha o mesmo client via DI) | Alteração em um bloco de ~10 linhas, com teste que já captura o listener | ≤1 arquivo tocado; complexidade permanece <15 |

## 2. Métricas observadas

Todas as métricas abaixo são do delta (5 arquivos). Baseline do repo em `_shared-metrics.md`.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC `http/gracefulShutdown.ts` (novo) | 119 | ≤150 (p50 de arquivo `http/`) | ✅ | `wc -l src/backend/http/gracefulShutdown.ts` |
| LOC `http/gracefulShutdown.test.ts` (novo) | 175 | — (teste segue o fonte) | ✅ | idem |
| LOC `domain/client/database/PostgreeDatabaseClient.ts` (com delta) | 248 | ≤400 (p95 de arquivo backend) | ✅ | `wc -l` |
| LOC `src/backend/index.ts` (com delta) | 198 | ≤200 (limite prático para boot) | ⚠️ | `wc -l` |
| Imports em `src/backend/index.ts` | 30 | ≤15 para arquivo comum; boot fica no limite | ⚠️ | `grep -c '^import ' src/backend/index.ts` |
| Warnings Biome `noExcessiveCognitiveComplexity` nos 3 arquivos do delta | 0 | 0 | ✅ | `cd src/backend && npm run lint 2>&1 \| grep noExcessive` (nenhum dos 3 aparece; 20 warnings totais no repo, todos pré-existentes) |
| Branches (`if`/`else`/`catch`) em `http/gracefulShutdown.ts` | 6 | ≤10 | ✅ | `grep -c '^\s*if \|else\|catch ' src/backend/http/gracefulShutdown.ts` |
| Parâmetros do contrato `GracefulShutdownDeps` | 3 obrigatórios + 2 opcionais | ≤5 total | ✅ | `src/backend/http/gracefulShutdown.ts:27-36` |
| Exports públicos em `http/gracefulShutdown.ts` | 4 (`SHUTDOWN_SIGNALS`, `DEFAULT_DRAIN_TIMEOUT_MS`, `createShutdownHandler`, `registerGracefulShutdown`) + 1 interface | ≤5 | ✅ | `grep -c '^export ' src/backend/http/gracefulShutdown.ts` |
| Fan-in de `gracefulShutdown.ts` | 1 (só `index.ts`) | 1–2 (módulo de boot) | ✅ | `grep -rn 'gracefulShutdown' src/backend` |
| Duplicação do idiom `pool.end().catch(...)` no `PostgreeDatabaseClient` | 2 sítios (handler `error` L86–88 + `close()` L114–117) | 0 ou 1 (com helper) | ⚠️ | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:82-117` |
| Magic numbers em regra de negócio no delta | 1 (`DEFAULT_DRAIN_TIMEOUT_MS = 10_000`) | 0 (via env) — mas está exportado e injetável | ⚠️ | `src/backend/http/gracefulShutdown.ts:26` |
| Cobertura de `gracefulShutdown.ts` | 93,61% stmts / 58,82% branches / 100% lines | ≥85% stmts / ≥55% branches | ✅ | Jest coverage em `_shared-metrics.md` |
| Violação de camada (DDD) introduzida pelo delta | 0 | 0 | ✅ | PatternGuardian: 6 arquivos, 0 violações |
| Layer-skipping novo (rotas → repo/client direto) | 0 | 0 | ✅ | idem |
| Convenção `http/` respeitada (`export const` arrow, sem classe) | Sim (`createShutdownHandler`, `registerGracefulShutdown`) | Sim (ver `errorMiddleware.ts`, `cors.ts`) | ✅ | leitura direta dos 3 arquivos |

**Apêndice — top-N de módulos afetados pelo delta**

Como o escopo é `--quick` e restrito ao delta, os top-10 do repo inteiro não fazem sentido aqui. O que interessa é a vizinhança dos arquivos tocados:

| Rank | Arquivo (delta) | LOC | Complexidade Biome | Fan-in |
|---|---|---|---|---|
| 1 | `domain/client/database/PostgreeDatabaseClient.ts` | 248 | 0 warn | alto (todo repository o usa via DI) — não medido por caminho |
| 2 | `src/backend/index.ts` | 198 | 0 warn | 0 (entrypoint) |
| 3 | `http/gracefulShutdown.test.ts` | 175 | — | 0 |
| 4 | `http/gracefulShutdown.ts` | 119 | 0 warn | 1 (`index.ts`) |

Nenhum dos 3 arquivos de produção do delta aparece na lista de warnings do Biome (que soma 20 hits, todos em módulos pré-existentes de `domain/service/permutas`, `domain/client/Conexos*` e `services/conexos.ts`).

## 3. Tactics — Cobertura no delta

Bass & Clements — Modifiability tactics. Avaliação estritamente sobre o delta.

### Reduce Size of Module

| Tactic | Implementação atual | Status | Evidência |
|---|---|---|---|
| Split Module | O shutdown foi extraído em módulo próprio (`http/gracefulShutdown.ts`, 119 LOC) em vez de crescer inline dentro do `index.ts`. A justificativa (importar o módulo em teste sem subir servidor) está na docstring. | ✅ presente | `src/backend/http/gracefulShutdown.ts:1-17` (docstring). O `index.ts` cresceu só 16 linhas para consumir o módulo. |

### Increase Cohesion

| Tactic | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Semantic Coherence | `gracefulShutdown.ts` faz uma coisa (drenar → fechar pool → sair). `PostgreeDatabaseClient.close()` público adiciona a responsabilidade certa (encerrar o pool) no dono do pool. Ambos coerentes. | ✅ presente | `src/backend/domain/client/database/PostgreeDatabaseClient.ts:100-119` |

### Reduce Coupling

| Tactic | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | O `close()` público esconde o `pool.end()` + zerar referência + tolerar `end` de pool quebrado. O chamador (`index.ts`) não vê `pg` nem sabe do `.catch(() => {})`. | ✅ presente | `PostgreeDatabaseClient.ts:106-117` |
| Use an Intermediary | `GracefulShutdownDeps` é o intermediário entre o `SIGTERM` do runtime, o servidor Express e o container tsyringe. O módulo `gracefulShutdown` não importa nem `process`, nem `container`, nem `PostgreeDatabaseClient` — recebe tudo via `deps` (`server`, `closePool`, `onExit`). O `registerGracefulShutdown` aceita `target: SignalTarget = process`, tornando até o `process` injetável. | ✅ presente | `gracefulShutdown.ts:27-36`, `gracefulShutdown.ts:110-118` |
| Restrict Dependencies | `gracefulShutdown.ts` importa 0 símbolos do próprio repo (só types de Node). Fan-in = 1 (`index.ts`). Sem ciclos. | ✅ presente | `grep '^import ' src/backend/http/gracefulShutdown.ts` — só imports de tipo Node |
| Refactor | O handler `error` do pool foi reescrito com guarda de reentrada (`let ended`) + guarda de identidade (`if (this.connectionPool === pool)`). Cognitivo permanece baixo (2 branches), justificado por comentário de 8 linhas. | ✅ presente | `PostgreeDatabaseClient.ts:82-93` |
| Abstract Common Services | Idiom `pool.end().catch(...)` aparece 2× (handler `error` L86–88 e `close()` L114–117). Semanticamente próximo, com pequenas diferenças (o handler tem guarda de reentrada e de identidade que o `close()` não precisa). Não abstraído — decisão defensável, mas é o candidato de refactor mais claro do delta. | ⚠️ parcial | `PostgreeDatabaseClient.ts:82-117` |

### Defer Binding

| Tactic | Implementação atual | Status | Evidência |
|---|---|---|---|
| Configuration files / env | `DEFAULT_DRAIN_TIMEOUT_MS = 10_000` é constante exportada. `drainTimeoutMs` é opcional em `GracefulShutdownDeps`, então o chamador pode injetar do env — mas hoje `index.ts` não injeta. Se o Render mudar de 30s para 45s, é edição de código, não `env`. | ⚠️ parcial | `gracefulShutdown.ts:26`, `src/backend/index.ts:184-190` |
| Polymorphism / DI runtime | `tsyringe` @injectable/@singleton mantidos no `PostgreeDatabaseClient`. O `closePool` chega ao módulo `gracefulShutdown` como função (`() => container.resolve(PostgreeDatabaseClient).close()`), o que é a alternativa correta em Node quando o consumidor não é `@injectable`. | ✅ presente | `src/backend/index.ts:185-190` |
| Plugin patterns / runtime registration | `registerGracefulShutdown` aceita `target: SignalTarget = process`, permitindo trocar o alvo de sinal em teste ou compor múltiplos targets — plugin-shape mínima e bem colocada. | ✅ presente | `gracefulShutdown.ts:110-118` |

## 4. Findings

### F-modifiability-1: `pool.end().catch(...)` duplicado entre o handler `error` e `close()`

- **Severidade**: P3
- **Tactic violada**: Abstract Common Services
- **Localização**: `src/backend/domain/client/database/PostgreeDatabaseClient.ts:82-93` e `:106-117`
- **Evidência (objetiva)**:
  ```typescript
  // Handler error (L82-93):
  pool.on('error', (_err) => {
      if (!ended) {
          ended = true;
          void pool.end().catch(() => {});
      }
      if (this.connectionPool === pool) this.connectionPool = undefined;
  });
  // close() (L106-117):
  this.connectionPool = undefined;
  try {
      await pool.end();
  } catch {
      // Fechar um pool já quebrado rejeita.
  }
  ```
- **Impacto técnico**: Duas cópias do idiom "encerrar pool sem propagar rejeição". Se amanhã a política mudar (ex.: logar o erro do `end` em vez de comer), a mudança precisa acontecer em dois pontos. Baixo risco porque os dois sítios estão no mesmo arquivo e o `close()` é chamado por um único caller (o shutdown).
- **Impacto de negócio**: Nenhum imediato. Débito técnico defensável.
- **Métrica de baseline**: 2 sítios com try/catch silencioso sobre `pool.end()`; um helper privado deixaria 0.

### F-modifiability-2: `DEFAULT_DRAIN_TIMEOUT_MS` não amarrado a env

- **Severidade**: P3 (rebaixado do P2 inicial porque o valor está justificado no comentário e o caminho de injeção via `deps.drainTimeoutMs` já existe)
- **Tactic violada**: Defer Binding (configuration files)
- **Localização**: `src/backend/http/gracefulShutdown.ts:26`, `src/backend/index.ts:185-190`
- **Evidência (objetiva)**:
  ```typescript
  // gracefulShutdown.ts:22-26
  export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

  // index.ts:185-190 — não injeta drainTimeoutMs
  registerGracefulShutdown({
      server,
      closePool: () => container.resolve(PostgreeDatabaseClient).close(),
      onExit: (code) => process.exit(code),
  });
  ```
- **Impacto técnico**: Se o Render alterar a janela SIGTERM→SIGKILL (hoje ~30s), ou se um cliente com deploy em outra plataforma tiver janela diferente, mudar o teto exige edição de código + release. O contrato já permite injeção — falta o wiring.
- **Impacto de negócio**: Nulo no cenário atual (Render == 30s, 10s cabe folgado). Positivo se o SaaSo (ADR-0001) provisionar outro runtime.
- **Métrica de baseline**: 1 magic number em módulo de boot; 0 se ler `process.env.SHUTDOWN_DRAIN_MS`.

### F-modifiability-3: `src/backend/index.ts` a 198 LOC / 30 imports — próximo do teto de boot

- **Severidade**: P3 (o delta piora em +16 linhas e +2 imports; ainda dentro do alvo p95=400 para arquivos backend)
- **Tactic violada**: Split Module
- **Localização**: `src/backend/index.ts` (arquivo inteiro)
- **Evidência (objetiva)**: `wc -l src/backend/index.ts` = 198; `grep -c '^import ' src/backend/index.ts` = 30. O arquivo mistura: config Express (trust proxy, cors, json), instrumentação (logger REQ/RES, requestId), 9 montagens de rota, wiring de auth/gates, boot (migrations, config-doctor, listen, shutdown, catch de top-level).
- **Impacto técnico**: O próximo dev que precisar adicionar uma rota ou trocar o logger tem que ler 198 linhas de wiring misturado. O delta em si não é o problema — é sintoma de crescimento acumulado. Cross-cutting com Testability: nada em `index.ts` é testável hoje (o `start()` faz `container.register` + `container.resolve` + `app.listen`, tudo em um método privado).
- **Impacto de negócio**: Baixo. Aumenta a chance de erro humano em cada tweak de boot, mas os gates (typecheck, lint, PatternGuardian) pegam a maioria.
- **Métrica de baseline**: 198 LOC (alvo prático de boot: ≤200); 30 imports (alvo genérico: ≤15, boot pode ir a 20). Split candidato: extrair `buildApp(): Express` e `startServer(app): Promise<void>` para dois módulos testáveis, deixando `index.ts` só com `void startServer(buildApp())`.

### F-modifiability-4: (sem finding — placement correto do `http/gracefulShutdown.ts`)

- **Severidade**: N/A (não é finding — é uma decisão de escopo que o revisor pediu para verificar explicitamente)
- **Localização**: `src/backend/http/gracefulShutdown.ts`
- **Análise**: O módulo depende de `server.close` (contrato do `app.listen` do Express/Node HTTP) e é consumido só pelo `index.ts` no wiring de servidor. `domain/libs/` é reservado para building blocks agnósticos de runtime (`EnvironmentProvider`, `Executors`, `Handlers`, `SqlBuilder`); um handler de sinal do processo HTTP não é isso. `http/` já hospeda companions de boot (`cors.ts`, `errorMiddleware.ts`, `rateLimit.ts`, `authEnv.ts`, `redact.ts`), todos com o padrão `export const` de arrow function — que `gracefulShutdown.ts` respeita. **Verdict:** placement correto, sem card.

## 5. Cards Kanban

### [modifiability-1] Extrair `endPoolQuietly(pool)` privado no `PostgreeDatabaseClient`

- **Problema**
  > O idiom "chamar `pool.end()` e engolir rejeição" aparece em 2 sítios do `PostgreeDatabaseClient` (handler `error` L82–93 e `close()` L106–117). Semanticamente próximos, com um pequeno delta (o handler tem guarda de reentrada e de identidade que o `close()` não precisa). Se a política de logging do erro do `end` mudar, é preciso lembrar dos dois pontos.

- **Melhoria Proposta**
  > Extrair um método privado `endPoolQuietly = async (pool: Pool): Promise<void>` que faz o `try { await pool.end() } catch {}`. Manter as guardas de reentrada e de identidade no handler `error` — elas são responsabilidade do sítio, não do helper. Tactic: **Abstract Common Services** (Bass).

- **Resultado Esperado**
  > 1 sítio de `try/catch` sobre `pool.end()` em vez de 2. Mudança futura na política de log passa por 1 método.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — mudança contida em `PostgreeDatabaseClient.ts` + 1 teste)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Sítios com `try/catch` silencioso sobre `pool.end()`: 2 → 1
  - LOC do arquivo: 248 → ≤248 (extração deve ficar neutra)
- **Risco de não fazer**: Se em 6 meses a política de log do `end` mudar (por exemplo, o Painel de Operação passar a querer registrar quando o pool morreu por conta própria), a mudança em dois pontos é candidata a esquecimento — o handler `error` é mais raro de exercitar, então é o que fica desatualizado.
- **Dependências**: —

### [modifiability-2] Amarrar `drainTimeoutMs` do shutdown ao `process.env`

- **Problema**
  > `DEFAULT_DRAIN_TIMEOUT_MS = 10_000` é constante exportada; `index.ts` não injeta um valor de env, então o teto é hardcoded. O contrato (`GracefulShutdownDeps.drainTimeoutMs?: number`) já permite injeção — falta a leitura no boot. Se o Render mudar sua janela SIGTERM→SIGKILL (hoje ~30s) ou se o SaaSo colocar a app em outro runtime, é edição de código + release.

- **Melhoria Proposta**
  > No `index.ts`, ler `process.env.SHUTDOWN_DRAIN_MS` (via `EnvironmentProvider` ou parse local com fallback para `DEFAULT_DRAIN_TIMEOUT_MS`) e passar em `registerGracefulShutdown({ ..., drainTimeoutMs })`. Tactic: **Defer Binding** (configuration files).

- **Resultado Esperado**
  > Janela de drenagem configurável por env sem redeploy de código. Overlap com **Deployability**: cada mudança de janela deixa de exigir um `chore(release)`.

- **Tactic alvo**: Defer Binding (configuration files)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — 3 linhas em `index.ts` + doc no README/CHANGELOG)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Magic numbers de política de boot: 1 → 0
  - Mudança de janela de drenagem: `edit + release` → `env change + restart`
- **Risco de não fazer**: Nulo enquanto o runtime for só o Render com janela de 30s. Vira dívida real quando o SaaSo provisionar outro runtime, e aí o custo é retroativo (mudar isso sob incidente).
- **Dependências**: —

### [modifiability-3] Extrair `buildApp()` e `startServer()` do `src/backend/index.ts`

- **Problema**
  > O `index.ts` chega a 198 LOC e 30 imports com o delta atual. Mistura config Express, instrumentação, montagem de 9 routers, wiring de auth/gates, boot (migrations, config-doctor, listen, shutdown, catch top-level). O delta contribuiu +16 linhas — não é a causa, mas empurrou o arquivo ao teto prático de um boot. Cross-cutting com **Testability**: nada em `index.ts` é testável hoje (o `start()` faz `container.register` + `container.resolve` + `app.listen` no mesmo método).

- **Melhoria Proposta**
  > Split em três: `src/backend/app.ts` (função `buildApp(): Express` — só wiring de middlewares e routers, sem `listen`), `src/backend/server.ts` (função `startServer(app: Express): Promise<void>` — migrations, config-doctor, `listen`, `registerGracefulShutdown`) e o `index.ts` reduzido a `void startServer(buildApp()).catch(...)`. Tactic: **Split Module** + **Increase Semantic Coherence** (Bass).

- **Resultado Esperado**
  > `index.ts` ≤10 LOC. `app.ts` testável isoladamente (supertest sem subir porta). `server.ts` testável com `server` e `deps` mockados — reaproveita o padrão que o `gracefulShutdown` já demonstrou. Facilita a próxima migração para Lambda: `app.ts` vira o handler wrapper, `server.ts` fica de fora.

- **Tactic alvo**: Split Module
- **Severidade**: P3
- **Esforço estimado**: M (2–5d — mexe em superfície de boot, precisa validação em dev antes do PR)
- **Findings relacionados**: F-modifiability-3
- **Métricas de sucesso**:
  - LOC `index.ts`: 198 → ≤10
  - Imports em `index.ts`: 30 → ≤3
  - Testes de boot possíveis: 0 → ≥3 (build app sem porta, start com deps mockados, top-level catch)
- **Risco de não fazer**: Cada nova rota/gate/middleware empurra o `index.ts` para além do p95 de arquivo backend. O próximo tweak vai carregar a mesma cognitiva de ler 198 linhas mescladas para trocar 3. Não é P0/P1 hoje — é o candidato natural de Split Module para o próximo `/feature-tweak` que tocar o boot.
- **Dependências**: —

## 6. Notas do agente

- **Escopo**: `--quick`, delta de 5 arquivos. Não foi rodado varredura de LOC do repo (`_shared-metrics.md` já traz), nem `madge` (não instalado). Todos os números do delta são medidos com `wc -l`, `grep`, output do Biome e coverage do Jest deste run.
- **Verdicts pedidos pelo revisor**:
  1. `gracefulShutdown.ts` **é** um exemplar canônico de *Reduce Coupling / Use an Intermediary + Encapsulate + Split Module* — 3 tactics do Bass aplicadas de uma vez, com contrato explícito de 3+2 parâmetros (não excessivo), fan-in 1, 0 imports do próprio repo. Placement em `http/` é o correto (justificativa em F-modifiability-4).
  2. A guarda de reentrada no handler `error` do pool é justificada (evento `error` do `pg.Pool` dispara uma vez por cliente ocioso derrubado) e legível (comentário de 8 linhas contextualiza). Complexidade cognitiva não gerou warning do Biome. Duplicação com `close()` existe mas é P3 — semânticas próximas mas não idênticas.
  3. O `index.ts` ficou **neutro-a-levemente-pior** pelo delta (+16 LOC, +2 imports). O sintoma "boot grande demais" é pré-existente; card **modifiability-3** é o Split Module natural, não urgente.
- **Cross-QA links** (para o consolidator):
  - `[modifiability-1]` (Abstract Common Services) — overlap com **Testability** (menos duplicação de erro-silencioso = menos superfície de bug latente).
  - `[modifiability-2]` (Defer Binding) — overlap com **Deployability** (magic number no boot = cada mudança de janela = redeploy) e com **Availability** (o valor certo do teto de drenagem depende do runtime).
  - `[modifiability-3]` (Split Module do `index.ts`) — overlap com **Testability** (nada em `index.ts` é testável hoje) e com **Deployability**/portabilidade Lambda (ADR-alvo).
