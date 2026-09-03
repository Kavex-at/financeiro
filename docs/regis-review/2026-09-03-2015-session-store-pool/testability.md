---
qa: Testability
qa_slug: testability
run_id: 2026-09-03-2015-session-store-pool
agent: qa-testability
generated_at: 2026-09-03T20:15:00-03:00
scope: backend
score: 7.5
findings_count: 5
cards_count: 4
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor corrigindo o P1 `integrability-2` | Refactor do handler de `error` do 2º pool Postgres (encerra-e-esquece; reconstrução preguiçosa; trava de shutdown) | `src/backend/services/conexosSessionStore.ts` + `conexosSessionStorePool.test.ts` | Suíte Jest local, mock de `pg.Pool` | Testes devem discriminar entre "pool encerrado e reconstruído" e "`db.query` fechada sobre pool morto" — a classe de defeito que passou verde por 20min na rodada anterior | 0 regressões dessa classe passam pelo gate; branches do fail-open cobertas; mock rejeita queries pós-`end()`; estado global resetado 3/3 entre testes |

Contexto específico deste run: a rodada anterior (`2623fa9`) encerrava o pool sem reconstruí-lo, e os 8 testes que existiam passaram — não porque o código estivesse correto, mas porque **o mock de `pg` mentia**: `pool.query` continuava resolvendo depois de `pool.end()`. O gate falhou como sensor. Este review avalia se o novo delta (3 testes adicionados + reformulação do módulo) reconstrói o sensor.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura `conexosSessionStore.ts` — stmts / branches / funcs / lines | 90.47 / 75.80 / 93.75 / 91.11 | 90 / 85 / 95 / 90 | ⚠️ branches abaixo | `_shared-metrics.md` linha 61 |
| Testes de ciclo de vida do 2º pool (arquivo sob review) | 11 `it()` em 159 LOC | ≥ 1 por classe de defeito conhecida (`open` / `error+end` / `error+rebuild` / `shutdown` / `shutdown+acquire` / `warn redigido` / idempotência / erro no `end()`) | ✅ 8/8 classes cobertas | `conexosSessionStorePool.test.ts` |
| Testes de contrato do store (`acquire`/`persist`/`invalidate`) | 9 `it()` em 130 LOC (arquivo irmão) | 100% dos ramos won/lost/disabled do `persist` | ✅ | `conexosSessionStore.test.ts` |
| Coverage threshold específico para `services/conexosSessionStore.ts` | **ausente** | ≥ 90 / 75 / 93 / 90 (piso = valor atual) | ❌ | `src/backend/jest.config.cjs:34-44` (só global e `./domain/service/`) |
| Estado global module-scope resetado entre testes | 2 de 3 (`openPools` ✅ via drain; `storeClosed` ✅ via `buildSessionStoreFromEnv`; `poolHolders` ❌ nunca é `.clear()`-ado) | 3 de 3 | ⚠️ | `conexosSessionStore.ts:234-237,247-255` |
| Fidelidade do mock de `pg` — `pool.query` após `end()` | continua resolvendo (mente) | deveria rejeitar com "pool ended" | ❌ | `conexosSessionStorePool.test.ts:14` (`query: jest.fn(async () => …)`) |
| Testes que dependem de contagem de pools como proxy semântico | 3 (`ends only once`, `rebuilds…`, `does not reopen…`) via `createdPools.length` | contrato observável no fake é aceitável, mas exige lembrança do próximo autor de teste | ⚠️ | `conexosSessionStorePool.test.ts:76-89, 106-115` |
| Asserção negativa de redação no log de erro | 1 (`.not.toContain('"financeiro"')`) | ≥ 1 | ✅ | `conexosSessionStorePool.test.ts:102` |
| Uso de `console.warn` verificado por teste | 1 spy, 3 asserções (contém marcador, contém `[REDACTED]`, não contém segredo) | ≥ 1 | ✅ | `conexosSessionStorePool.test.ts:91-104` |
| Não-determinismo: leitura de tempo/random no arquivo | 0 em código, 1 (`new Date().toISOString()` em `persist`) — não é o arquivo sob review de ciclo de vida | 0 no caminho de pool lifecycle | ✅ | `conexosSessionStore.ts:142-144, 177` |

> ⚠️ **Não medível localmente**: taxa de flake histórica do arquivo (Jest não roda estatística de N execuções por padrão). Requer `jest --runInBand --testPathPattern conexosSessionStorePool -i 50` para amostragem, fora do orçamento do `--quick`.
> ⚠️ **Não medível localmente**: contaminação real entre suítes Jest (depende de `resetModules` e da ordem em que `--maxWorkers` distribui os 128 arquivos). Só se manifestaria como falso-positivo em CI.

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `SessionStoreDb` (linha 62-67) é a superfície mínima que o store consome; a suíte irmã injeta um fake direto sem tocar `pg`. Excelente seam. | ✅ presente | `conexosSessionStore.ts:62-67`, `conexosSessionStore.test.ts:1-17` |
| Recordable Test Cases | Sem fixtures gravadas do wire de `pg` (linhas SQL cruas convivem no impl). Não é crítico porque a superfície é uma função `query(sql, params)`, mas assinaturas de erro (ex.: `Connection terminated unexpectedly`) são hardcoded no teste. | ⚠️ parcial | `conexosSessionStorePool.test.ts:19` |
| Sandbox | O mock de `pg` **não impõe as invariantes do real**: `pool.query` continua resolvendo após `pool.end()`. Foi exatamente o gap que deixou a rodada anterior passar verde com `db.query` fechada sobre um pool morto. O novo teste `rebuilds…` discrimina por contagem (não pela recusa do pool morto). | ❌ ausente | `conexosSessionStorePool.test.ts:11-26`; contraste com `services/conexosSessionStore.ts:290-316` |
| Executable Assertions | `console.warn` verificado (marcador + redação positiva + segredo negativo). `poolEnd` verificado por contagem. Contrato de fail-open na construção (`catch` em `buildSessionStoreFromEnv`, linhas 329-335) **não tem asserção** — se `new Pool()` throw, o store deve degradar para desabilitado sem cair; não há teste. | ⚠️ parcial | `conexosSessionStore.ts:329-335` (branch descoberta) |
| Abstract Data Sources | `env: NodeJS.ProcessEnv = process.env` é o único ponto de leitura; injeção explícita nos testes (`envWithDb`). Bom. | ✅ presente | `conexosSessionStore.ts:257-259`, teste linha 30 |
| Limit Structural Complexity | 3 pedaços de estado module-scope (`openPools`, `poolHolders`, `storeClosed`) + singleton criado no import + closure `holder` capturada em `db.query`. Está dentro do razoável para um module que **precisa** ser singleton, mas cresce sem freio: `poolHolders` nunca é limpo. | ⚠️ parcial | `conexosSessionStore.ts:229-255,339` |
| Limit Non-Determinism | Sem `Date.now()`/`random` no caminho de pool lifecycle. O `new Date().toISOString()` em `persist` fica em outra frente e o teste irmão o exercita. Handler de `error` é síncrono; o `void pool.end().catch(…)` na linha 311 introduz um microtask assíncrono que o teste `rebuilds…` implicitamente atravessa via `await store.acquire()`. | ✅ presente | `conexosSessionStore.ts:301-313`; teste `await Promise.resolve()` linha 65 |

## 4. Findings (achados)

### F-testability-1: mock de `pg.Pool` não simula "pool encerrado"

- **Severidade**: P1 (alto — foi este mesmo gap que deixou o defeito anterior passar verde por 20min)
- **Tactic violada**: Sandbox
- **Localização**: `src/backend/services/conexosSessionStorePool.test.ts:11-26`
- **Evidência (objetiva)**:
  ```typescript
  const pool = {
      query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
      on: (event, handler) => { if (event === 'error') errorHandlers.push(handler); },
      end: () => poolEnd(),
      emitError: (err) => { for (const h of [...errorHandlers]) h(err); },
  };
  ```
  Não há transição de estado: depois que `end()` é chamado, `query` continua resolvendo `{ rows: [], rowCount: 0 }`. Um `pg.Pool` real rejeita `query` após `end()` com `Error('Cannot use a pool after calling end on the pool')`.
- **Impacto técnico**: qualquer regressão futura que reintroduza a classe de defeito "`db.query` sobre pool morto" só será pega se alguém lembrar de contar `createdPools`. O sensor pega o defeito específico refatorado (por contagem), mas não a classe. O novo teste `rebuilds the pool on the next call after an error killed it` é honesto e discrimina (via `createdPools.length === 2` + `createdPools[0].query` não chamado), porém depende de o autor futuro repetir esse padrão de contagem.
- **Impacto de negócio**: session store cego significa cada processo (Render prod + jobs GitHub Actions) volta a brigar pelos 3 slots do `MAX_SESSIONS` da conta Conexos. Kill-oldest em cascata → login-loop → 503 no Conexos → 401 na UI da analista. Foi o problema que originou o P1 `integrability-2` em primeiro lugar.
- **Métrica de baseline**: 1 classe de defeito conhecida (pool-morto-sob-db.query) passou verde por 20min no commit `2623fa9`. Mock atual continua permitindo essa classe passar caso o teste `rebuilds…` seja removido ou modificado por descuido.

### F-testability-2: fail-open da construção do Pool não é testado

- **Severidade**: P1 (alto — é o contrato "o store NUNCA pode derrubar a integração com o Conexos", explícito na docstring linha 23)
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/services/conexosSessionStore.ts:270-335`
- **Evidência (objetiva)**:
  ```typescript
  try {
      storeClosed = false;
      const holder: PoolHolder = {};
      // …
      openPool();
      // …
  } catch (cause) {
      console.warn(`[ConexosSessionStore] construção do Pool falhou — store desabilitado: ${detail}`);
      return new ConexosSessionStore({ db: null });
  }
  ```
  O `catch` (linhas 329-335) não é atingido por nenhum teste — nenhum caso força `new Pool()` a lançar. O impl garante fail-open, o teste não garante que ele continue garantindo.
- **Impacto técnico**: uma regressão que remova o `try/catch` (ou mova `new Pool` para fora dele) fará o backend cair no boot se o `pg` rejeitar a `connectionString`. O gate atual passaria.
- **Impacto de negócio**: cada deploy que altere a `connectionString` no Render vira potencial `503` no boot em vez de degradação graciosa para "login por processo". A Frente I / II fica indisponível sem aviso.
- **Métrica de baseline**: 24.20% de branches descobertas em `conexosSessionStore.ts`; a construção-que-falha é uma das branches contadas nesse déficit (junto com `if (rows.length === 0)` do INSERT, `!rowCount` do CAS e o `DEBUG_VERBOSE` boxLog). Alvo: subir branches de 75.80% para ≥ 85% cobrindo prioritariamente esta.

### F-testability-3: `poolHolders` cresce monotonicamente entre testes

- **Severidade**: P2 (médio — não é bug hoje, é armadilha)
- **Tactic violada**: Limit Structural Complexity
- **Localização**: `src/backend/services/conexosSessionStore.ts:234-235,247-255`
- **Evidência (objetiva)**:
  ```typescript
  const openPools = new Set<Pool>();
  const poolHolders = new Set<PoolHolder>();
  // …
  export const closeConexosSessionStorePool = async (): Promise<void> => {
      storeClosed = true;
      const pools = [...openPools];
      openPools.clear();
      for (const holder of poolHolders) holder.pool = undefined;   // esvazia cada holder, mas
      // poolHolders nunca é .clear()-ado
      await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
  };
  ```
  Cada `buildSessionStoreFromEnv(envWithDb)` executa `poolHolders.add(holder)` (linha 273). Ao longo dos 11 testes do arquivo, `poolHolders.size` cresce para 12+ (11 dos testes + o singleton do import). O `beforeEach` (`closeConexosSessionStorePool`) marca todos como vazios, mas nunca os remove.
- **Impacto técnico**: hoje inócuo (nada itera `poolHolders` com semântica além de esvaziá-los). Vira flake source se alguém adicionar "para cada holder, verifique…" ou uma métrica de "pools ativos". Zombie holders permaneceriam.
- **Impacto de negócio**: nenhum imediato; é dívida de asserção. Custo se materializa quando a próxima feature (ex.: readiness probe) usar `poolHolders` como fonte.
- **Métrica de baseline**: `poolHolders.size` cresce N a cada teste (medido: sobe de 1 no import para ≥ 12 ao fim da suíte). Alvo: `poolHolders.size === 1` no fim de cada teste (só o singleton), ou 0 se `closeConexosSessionStorePool()` for redesenhado como reset total.

### F-testability-4: coverage threshold específico para o arquivo é ausente

- **Severidade**: P2 (médio — o gate global é fraco demais para prender regressão neste arquivo)
- **Tactic violada**: Executable Assertions
- **Localização**: `src/backend/jest.config.cjs:34-44`
- **Evidência (objetiva)**:
  ```javascript
  coverageThreshold: {
      global: { lines: 72, branches: 54, functions: 78 },
      './domain/service/': { lines: 88, branches: 60 },
  },
  ```
  Piso de branches de 54% é ~22pp abaixo do valor atual do arquivo (75.80%). Uma regressão que derrube esse arquivo para 60% de branches passa pelo gate. `services/` (legado) não tem entrada dedicada.
- **Impacto técnico**: nenhum sinal automático quando os testes deste arquivo forem removidos ou desabilitados. Depende de revisor humano notar.
- **Impacto de negócio**: dívida do sensor. Consequência é que o próximo Regis-Review vira novamente o sensor.
- **Métrica de baseline**: threshold atual para `services/conexosSessionStore.ts` = piso global (72/54/78/72). Alvo: entrada específica com piso = valor de hoje (90/75/93/90), ratchet.

### F-testability-5: singleton criado no import + fake `pg` global — contaminação teórica entre suítes

- **Severidade**: P3 (baixo — teórico dentro deste arquivo, real se outras suítes carregarem o mesmo módulo com outro mock)
- **Tactic violada**: Limit Non-Determinism
- **Localização**: `src/backend/services/conexosSessionStore.ts:339` (`export const conexosSessionStore = buildSessionStoreFromEnv()`); `conexosSessionStorePool.test.ts:10-26` (mock global de `pg`)
- **Evidência (objetiva)**: o singleton executa `buildSessionStoreFromEnv()` no import. Se o Jest importar este módulo antes do `jest.mock('pg', …)` ter efeito (não é o caso hoje, `jest.mock` é hoisted, mas depende disso), o singleton usaria o `pg` real. Nenhum teste falha se o `Pool` do singleton for real e o dos testes for mock. `createdPools` do mock só recebe pools criados via **o mesmo import do mock**.
- **Impacto técnico**: fragilidade dependente de ordem de import e comportamento de hoist do `jest.mock`. Ainda: se um segundo arquivo de teste (`conexosSessionStore.test.ts`) NÃO mocka `pg` e o Jest compartilha módulos entre suítes num mesmo worker, o singleton entre suítes pode ter usado impls diferentes de `pg`.
- **Impacto de negócio**: nulo hoje; risco de flake em CI se `--maxWorkers` mudar.
- **Métrica de baseline**: 1 singleton criado no import; 0 testes que asseguram sua limpeza fora do `beforeEach` deste arquivo. Alvo: mover o singleton para uma factory lazy (`getConexosSessionStore()`) ou trocar por injeção via container (fora deste delta, é BE-11).

## 5. Cards Kanban

### [testability-1] Fazer o mock de `pg` rejeitar `query` após `end()`

- **Problema**
  > O mock de `pg.Pool` em `conexosSessionStorePool.test.ts` (linhas 11-26) resolve `query` mesmo depois de `end()` — a mesma fidelidade insuficiente que permitiu o defeito da rodada anterior passar verde. O novo teste `rebuilds the pool on the next call after an error killed it` discrimina por contagem (`createdPools.length === 2`), não pela recusa do pool morto; se alguém remover essa contagem no futuro, a classe de defeito volta a ser invisível.

- **Melhoria Proposta**
  > Endurecer o mock: acrescentar estado `ended: boolean` na factory de `pg.Pool` do mock; `query` deve rejeitar com `Error('Cannot use a pool after calling end on the pool')` (a mensagem literal do `pg`) quando `ended === true`. Manter o teste `rebuilds…` (é a comprovação direta), e reescrever `ends the pool on error instead of just swallowing it` para incluir uma asserção de que `pool.query` (do pool antigo) rejeita — assim a classe "db.query sobre pool morto" fica coberta por construção, não por convenção do autor. Tactic: **Sandbox**.

- **Resultado Esperado**
  > Regressões que reintroduzam pool morto sob `db.query` falham no CI mesmo sem contagem explícita. A fidelidade do mock (`query` rejeita pós-`end`) passa de ausente para presente.

- **Tactic alvo**: Sandbox
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — ~15 linhas no mock, 1 asserção nova em 1 teste existente
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Classes de defeito "pool morto sob db.query" cobertas por construção do mock: 0 → 1
  - Testes que dependem de contagem de pools como único sensor: 3 → 1 (sobra só o `rebuilds…`, que é a asserção positiva)
- **Risco de não fazer**: a próxima refactor do handler de `error` (previsível quando o `pg` v9 mudar a semântica de `on('error')`) pode reintroduzir a mesma classe de defeito. O sensor atual só pega se alguém lembrar de manter a contagem.
- **Dependências**: nenhuma

### [testability-2] Cobrir o fail-open da construção do Pool

- **Problema**
  > A docstring linha 23 promete "o store NUNCA pode derrubar a integração com o Conexos" e o `catch` em `buildSessionStoreFromEnv` (linhas 329-335) é o gate desse contrato — mas nenhum teste força `new Pool()` a lançar. Uma regressão que mova `new Pool()` para fora do `try` faz o backend cair no boot; o gate atual passa.

- **Melhoria Proposta**
  > Acrescentar um teste no `conexosSessionStorePool.test.ts` (grupo novo `describe('degradação graciosa quando pg lança na construção')`) que troca a implementação do mock de `pg.Pool` para lançar (`jest.mocked(Pool).mockImplementationOnce(() => { throw new Error('bad connection string') })`) e afirma: (a) `buildSessionStoreFromEnv(envWithDb).enabled === false`; (b) `console.warn` foi chamado com o marcador `construção do Pool falhou`; (c) `createdPools.length === 0`. Tactic: **Executable Assertions**.

- **Resultado Esperado**
  > O contrato fail-open passa a ter asserção. Cobertura de branches em `conexosSessionStore.ts`: 75.80% → ≥ 82% (esta branch + a `throw new Error('ConexosSessionStore: pool encerrado')` da linha 324 já é atingida pelo teste de shutdown).

- **Tactic alvo**: Executable Assertions
- **Severidade**: P1
- **Esforço estimado**: S (≤1d) — 1 teste, ~20 linhas
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Branch `catch` de `buildSessionStoreFromEnv`: descoberta → coberta
  - Cobertura de branches de `conexosSessionStore.ts`: 75.80% → ≥ 82%
- **Risco de não fazer**: uma refactor futura que mova `new Pool()` fora do try ou remova o `return new ConexosSessionStore({ db: null })` do catch faz o backend cair no boot silenciosamente; passa pelo gate.
- **Dependências**: nenhuma

### [testability-3] Fixar coverage threshold específico para `conexosSessionStore.ts`

- **Problema**
  > `src/backend/jest.config.cjs:34-44` tem threshold global (72/54/78) e `./domain/service/` (88/60), mas `services/` (legado, onde vive `conexosSessionStore.ts`) fica só no piso global. O arquivo hoje está em 90.47/75.80/93.75/91.11 — uma regressão que derrube branches para 60% passa pelo gate. Este arquivo é o coração da compartilha de sessão Conexos, então o piso genérico é fraco demais.

- **Melhoria Proposta**
  > Adicionar em `coverageThreshold` uma entrada por arquivo:
  > ```javascript
  > './services/conexosSessionStore.ts': { lines: 90, branches: 75, functions: 93, statements: 90 },
  > ```
  > (piso = valor atual, ratchet). Tactic: **Executable Assertions**.

- **Resultado Esperado**
  > Regressão de cobertura neste arquivo específico falha o `npm test -- --coverage`. Threshold `services/conexosSessionStore.ts`: ausente → definido.

- **Tactic alvo**: Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — 3 linhas no `jest.config.cjs`
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Threshold específico para `services/conexosSessionStore.ts`: 0 → 1 entrada
  - Margem de regressão silenciosa: 22pp (75→54) → 0
- **Risco de não fazer**: dívida do sensor; próximo Regis-Review re-vira o sensor. Custa 15min agora ou 2h no próximo review.
- **Dependências**: nenhuma. Se [testability-2] for feito primeiro, ajustar branches para 85%.

### [testability-4] Fazer `closeConexosSessionStorePool()` também limpar `poolHolders`

- **Problema**
  > `poolHolders` (linha 235) é um `Set` module-scope que cresce monotonicamente: cada `buildSessionStoreFromEnv` adiciona um holder e nada o remove. `closeConexosSessionStorePool()` esvazia o `.pool` de cada, mas mantém a entrada. Sobem para ≥ 12 ao fim da suíte deste arquivo. Não é bug hoje — vira armadilha quando alguém adicionar iteração semântica sobre `poolHolders` (ex.: readiness probe que conta holders ativos).

- **Melhoria Proposta**
  > Duas opções ordenadas por preferência: **(a)** acrescentar `poolHolders.clear()` no fim de `closeConexosSessionStorePool()` — semântica: "shutdown esquece todos os holders, quem chamar `buildSessionStoreFromEnv` de novo recomeça"; **(b)** manter holders mas expor `resetConexosSessionStorePoolForTests()` (nome explícito, só chamado no `beforeEach`). Preferir (a): elimina o estado zombie sem criar API de teste. Tactic: **Limit Structural Complexity**.

- **Resultado Esperado**
  > Estado global resetado 3/3 entre testes (era 2/3). `poolHolders.size` no fim de cada teste: cresce monotonicamente → constante ≤ 1.

- **Tactic alvo**: Limit Structural Complexity
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) — 1 linha no impl + 1 asserção no teste
- **Findings relacionados**: F-testability-3, F-testability-5
- **Métricas de sucesso**:
  - `poolHolders.size` ao final da suíte: 12+ → ≤ 1
  - Estado global module-scope resetado entre testes: 2/3 → 3/3
- **Risco de não fazer**: quando a próxima feature (ex.: `/health` endpoint que reporta pools ativos) iterar `poolHolders`, holders zombies aparecem no relatório e o novo teste fica flaky dependendo da ordem de execução com este arquivo.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo**: revisão restrita a `conexosSessionStore.ts` + `conexosSessionStorePool.test.ts`. Migração DDD deste módulo legado (`services/`) fica fora — é o item BE-11 de outra revisão, conforme `_shared-metrics.md` linhas 47-50.
- **Julgamento sobre o teste-chave**: `rebuilds the pool on the next call after an error killed it` **discrimina** honestamente (conta `createdPools` e verifica em qual pool `query` foi chamado — asserções em observáveis do fake, não em promessa mockada). Mas a **classe** de defeito continua não coberta por construção do mock — daí o card [testability-1].
- **Julgamento sobre os outros 2 testes novos**: `logs a redacted warning` é honesto (asserção negativa `.not.toContain('"financeiro"')` é o discriminante). `does not reopen a pool after the shutdown` é honesto (assert `.resolves.toBeNull()` cruzado com `createdPools.length` constante).
- **Cross-QA links para o consolidator**:
  - [testability-1] (Sandbox) **overlap com Integrability**: o mock de `pg` é um contrato-teste com dependência externa; a fidelidade do mock é uma preocupação de integrabilidade tanto quanto de testabilidade.
  - [testability-2] (fail-open da construção) **overlap com Fault Tolerance**: é o contrato de degradação graciosa do store; se fault-tolerance também levanta este item, é intencional.
  - [testability-3] (coverage threshold) **overlap com Deployability**: gate de cobertura pré-merge é parte do pipeline de deploy.
  - [testability-4] (limpar `poolHolders`) **overlap com Modifiability**: estado global implícito degrada modificabilidade do módulo tanto quanto testabilidade.
