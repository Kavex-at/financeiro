---
qa: Testability
qa_slug: testability
run_id: 2026-09-08-1834
agent: qa-testability
generated_at: 2026-09-08T18:34:00-03:00
scope: frontend
score: 7.0
findings_count: 4
cards_count: 3
---

# Testability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao delta `permutas-fixture-fonte`)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Dev do fix (`27023a9`) | Refatora `fetchGestaoPermutas` em três caminhos (`banco` cheio · `banco` vazio · `fixture` sob flag) e adiciona `error` a `usePermutasData` | `lib/api.ts` · `lib/features.ts` · `app/permutas/components/banners.tsx` · `app/permutas/components/usePermutasData.ts` · `app/permutas/page.tsx` | Frontend em desenvolvimento (Jest + jsdom, sem CI de cobertura na Vercel) | Cada seam nova executável em teste unitário; a suíte cresce sem custo; a composição na tela é verificável isoladamente | Cobertura por arquivo do delta ≥ 80% linhas em código de lógica pura; ganho líquido de casos > 0; ausência de leakage entre suítes via `process.env` |

> **Escopo do QA aqui:** review de DELTA, frontend puro. O delta muda 3 seams de lógica pura
> (`lib/api.ts`, `lib/features.ts`, `banners.tsx`) e 2 de composição (`usePermutasData.ts`, `page.tsx`).
> As tactics de backend/infra (integration tests com Postgres, DI seams via tsyringe, coverage por
> layer `domain/service`, gates em `.github/workflows`) **não se aplicam** a este delta — declaradas
> N/A na tabela de tactics.

## 2. Métricas observadas

Coletadas com `cd src/frontend && npx jest --coverage --coverageReporters=text`.

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| **Cobertura por arquivo do delta** — tabela em Métrica #1 | ver abaixo | ≥ 80% linhas em código de lógica pura tocado pelo delta | ⚠️ | `npx jest --coverage --coverageReporters=text` (scratchpad `cov.txt`) |
| Suítes / testes (pré-delta) | 26 / 194 | — | ✅ (baseline) | `_shared-metrics.md` gates |
| Suítes / testes (pós-delta) | **29 / 214** (Δ +3 / +20) | crescimento > 0 sem regressão | ✅ | idem |
| Threshold global (`jest.config.js`) | lines 20 · branches 9 · functions 14 | > 50% em arquivos de lógica pura | ⚠️ | `src/frontend/jest.config.js:34-40` |
| `lib/features.ts` (novo) | 100 / 100 / 100 / 100 | ≥ 80 | ✅ | tabela `text` |
| `banners.tsx` (novo) | 100 / 100 / 100 / 100 | ≥ 80 | ✅ | tabela `text` |
| `lib/api.ts` (48 linhas alteradas) | 50.22 lines / 32.73 branches / 50 funcs | ≥ 80 lines para as funções tocadas | ⚠️ (baseline pré-delta; nada regride) | tabela `text` |
| `usePermutasData.ts` (39 linhas alteradas, novo estado `error`) | **0 / 0 / 0 / 0** | ≥ 60 lines em hook com estado | ❌ | tabela `text` |
| `app/permutas/page.tsx` (28 linhas alteradas, composição dos 3 estados) | **0 / 0 / 0 / 0** (1059 LOC) | > 0 em cenário de composição | ❌ | tabela `text` |
| Testes que fazem chamada de rede real | 0 (mock global `global.fetch`) | 0 | ✅ | `__tests__/permutas-fonte-dado.test.ts:41` |
| Testes com uso de time/random no delta | 0 (nenhum) | 0 | ✅ | grep no delta |
| Isolamento entre suítes com `process.env` | `jest.resetModules()` + snapshot em `envOriginal` + restauração em `afterAll` | sem leakage | ✅ (padrão presente nos dois arquivos que mexem em env) | `__tests__/features-demo-mode.test.ts:12-20` · `__tests__/permutas-fonte-dado.test.ts:41-52` |
| Módulos Terraform tocados | não medível | — | N/A | `infra/` não existe neste repo |

### Métrica observável #1 — Cobertura por arquivo do delta (fonte: `jest --coverage`)

| Arquivo | Δ LOC | Stmts | Branch | Funcs | Lines | Interpretação |
|---|---:|---:|---:|---:|---:|---|
| `src/frontend/lib/features.ts` | +36 (novo) | 100 | 100 | 100 | 100 | seam puro, totalmente coberto pelos 6 casos novos |
| `src/frontend/app/permutas/components/banners.tsx` | +80 (novo) | 100 | 100 | 100 | 100 | componente puro, coberto pelos 7 casos novos |
| `src/frontend/lib/api.ts` | +48 / −13 | 48.95 | 32.73 | 50 | 50.22 | os 3 caminhos do delta (`banco` cheio · `banco` vazio · falha · 401 · demo) são exercitados; o resto do arquivo (invoices, execuções, borderôs) segue como estava |
| `src/frontend/app/permutas/components/usePermutasData.ts` | +39 / −6 | **0** | **0** | **0** | **0** | o hook nasceu o **dono do novo estado `error`** e não é exercitado por nenhum teste — só suas dependências são |
| `src/frontend/app/permutas/page.tsx` | +28 / −1 | **0** | **0** | **0** | **0** | 1059 LOC; a nova composição (`DemoDataBanner` + `LoadErrorBanner` + `EmptyState` com `AlertTriangle`) só existe aqui e não é montada por nenhum teste |

## 3. Tactics — Cobertura no delta

Bass & Clements — Testability tactics. Marcadas apenas com o que o **delta** tocou ou o que
condiciona a testabilidade do que foi mudado.

| Tactic (Bass) | Implementação no delta | Status | Evidência |
|---|---|---|---|
| Specialized Interfaces | `isDemoMode()` e `assertDemoEnv()` isolam a decisão de fonte num par de funções puras chamáveis diretamente do teste | ✅ | `src/frontend/lib/features.ts:12,36` |
| Executable Assertions | `assertDemoEnv()` no import de `lib/api.ts` é uma asserção executável de contrato (build deployado + demo = crash) e tem teste explícito | ✅ | `src/frontend/lib/api.ts:22` · `__tests__/features-demo-mode.test.ts:41` |
| Recordable Test Cases | `gestaoPermutasFixture` (227 linhas de dados sondados) continua sendo o replay canônico; o delta agora o mantém **atrás** de flag e o marca com `fonte: 'fixture'` | ✅ | `lib/permutas-fixture.ts` + discriminador |
| Sandbox | Env-var (`NEXT_PUBLIC_DEMO_MODE`) é o sandbox de fonte de dado; nos testes o sandbox é feito à mão via `process.env = { ...envOriginal }` + `jest.resetModules()` — funciona, mas é padrão replicado em duas suítes sem helper compartilhado | ⚠️ parcial | `__tests__/features-demo-mode.test.ts:12-20` · `__tests__/permutas-fonte-dado.test.ts:41-52` |
| Abstract Data Sources | O delta **aprimora** este eixo: o discriminador `fonte: 'banco' \| 'fixture'` já existia no tipo e ninguém o lia; agora a UI o consome e os testes o afirmam ponta-a-ponta | ✅ (melhoria) | `lib/types.ts:236` · `banners.test.tsx:14-18` |
| Limit Non-Determinism | Delta não introduz time/random; mocks de `fetch` globais e determinísticos | ✅ | `permutas-fonte-dado.test.ts:41` |
| Limit Structural Complexity | `usePermutasData` (~82 LOC) e `banners.tsx` (~80 LOC) são unidades pequenas e testáveis. `page.tsx` (1059 LOC) é o oposto — a composição só existe lá e o tamanho é o motivo pelo qual não há teste de composição | ⚠️ parcial | `wc -l app/permutas/page.tsx` |
| Built-in Monitors | N/A no delta (não há job/lambda observável neste PR) | N/A | — |
| DI seams via tsyringe (backend) | N/A — delta é 100% frontend | N/A | — |
| Coverage threshold como gate | Presente, mas floor global `20/9/14` está **muito abaixo** do que os arquivos do delta atingem individualmente (features/banners a 100). O gate não regride, mas também não defende o patamar novo | ⚠️ parcial | `jest.config.js:34-40` |
| Integration tests com Postgres | N/A — delta é frontend | N/A | — |

## 4. Findings (achados)

### F-testability-1: `usePermutasData` (dono do novo estado `error`) fica em 0% de cobertura

- **Severidade**: P1
- **Tactic violada**: Limit Structural Complexity + Specialized Interfaces (o hook é a seam natural para testar a lógica que o `page.tsx` não consegue exercitar)
- **Localização**: `src/frontend/app/permutas/components/usePermutasData.ts:1-82`
- **Evidência (objetiva)**:
  ```
  app/permutas/components
    banners.tsx           | 100 | 100 | 100 | 100 |
    usePermutasData.ts    |   0 |   0 |   0 |   0 | 3-82
  ```
  O hook **é o dono do novo `error` state** (`usePermutasData.ts:26`) e das duas ramificações que o alimentam: `load` (refresh — preserva `data`, seta `error`) e o `useEffect` de carga inicial (limpa `data`, seta `error`). Nenhum caminho é executado sob teste. Os testes do delta atacam **dependências** do hook (`fetchGestaoPermutas` em `permutas-fonte-dado.test.ts`, `SessionExpiredError` propagando), mas nunca o hook em si — quem verifica que `SessionExpiredError` **não** entra em `error`, que a mensagem do `Error` cru vai para `error` e que `loading` termina em `false` mesmo na falha? Ninguém.
- **Impacto técnico**: uma mudança futura em `usePermutasData` — trocar a ordem de `setError`/`setLoading`, esquecer o `isSessionExpiredError` guard, mudar o comportamento de "preserva `data` anterior" no refresh — passa o CI (0% → 0% não regride) e só é notada em produção. É a exata classe de bug que o commit `27023a9` acabou de corrigir.
- **Impacto de negócio**: reincidência do defeito 1.1 (`ontology/_inbox/backlog-melhorias-2026-09-02.md`, P0 confiança) fica a uma refatoração de distância. O painel volta a "mentir de forma plausível".
- **Métrica de baseline**: cobertura do hook 0% linhas / 0% branches / 0% funcs (delta = 0 casos que instanciam o hook); 5 branches novas introduzidas pelo delta (`isSessionExpiredError` guard em duas posições, `mensagemDeFalha` com/sem `Error.message`, `active` flag), todas em zona de 0%.

### F-testability-2: composição dos 3 estados em `page.tsx` (0% de 1059 LOC) sem teste de componente

- **Severidade**: P2
- **Tactic violada**: Limit Structural Complexity (a página é monolítica; nem o Regis-Review 2026-06-26 conseguiu fatiá-la e assentou floors abaixo)
- **Localização**: `src/frontend/app/permutas/page.tsx:724-744`
- **Evidência (objetiva)**:
  ```
  app/permutas/page.tsx        |   0 |   0 |   0 |   0 | 3-1059
  ```
  A montagem que **este PR desenhou** — `DemoDataBanner` sempre no topo, `LoadErrorBanner` só se `data` existir (falha de refresh preserva a carteira), `EmptyState` com `AlertTriangle` se `!data` (falha de carga inicial) — só existe em `page.tsx:724-744`. Os banners têm 100% de cobertura em isolamento, mas o **contrato de composição** (qual banner aparece em qual combinação `data × loading × error × fonte`) não tem nenhum teste. É o local exato onde o bug do commit `27023a9` viveu.
- **Impacto técnico**: refatorar o topo da página (extrair para subcomponente, mover para layout, condicionar por outra flag) não tem rede — a única defesa é o typecheck.
- **Impacto de negócio**: a invariante "o que está na tela é o que está no banco" (`ontology/ui-flows/fonte-do-dado-permutas.md`) depende dessa composição. Sem teste, a invariante fica documentada, não executável.
- **Métrica de baseline**: `page.tsx` = 1059 LOC, 0% em todos os eixos; combinações críticas de estado (`data=null·error≠null` vs `data≠null·error≠null` vs `data.fonte='fixture'`) = 0/3 testadas.

### F-testability-3: threshold global (`20/9/14`) muito abaixo do patamar dos arquivos do delta

- **Severidade**: P3
- **Tactic violada**: Coverage threshold como Executable Assertions
- **Localização**: `src/frontend/jest.config.js:34-40`
- **Evidência (objetiva)**:
  ```js
  coverageThreshold: {
      global: { lines: 20, branches: 9, functions: 14 },
      './lib/auth/': { lines: 24 },
  },
  ```
  Números atuais dos arquivos do delta: `features.ts` 100 / `banners.tsx` 100 / `lib/api.ts` 50.22. Um hipotético PR que **remova** um teste de `features.ts` derrubando-o de 100 → 25 não estoura o gate. O comentário em `jest.config.js:17-33` explica a razão histórica (floor "just below o real"), mas o floor não foi rebateado quando o delta subiu `lib/features.ts` e `banners.tsx` a 100.
- **Impacto técnico**: o gate é um cinto contra colapso, não um piso de qualidade — arquivo bem testado hoje pode regredir e nunca ser notado.
- **Impacto de negócio**: baixo — é dívida de gate, não bug ao vivo.
- **Métrica de baseline**: gap entre floor e patamar real dos arquivos do delta = 100 − 20 = **80 pontos** em `features.ts` e `banners.tsx`; 50.22 − 20 = ~30 pontos em `lib/api.ts`.

### F-testability-4: sandbox de env-var replicado in-line em cada suíte

- **Severidade**: P3
- **Tactic violada**: Sandbox (falta de helper compartilhado)
- **Localização**: `src/frontend/__tests__/features-demo-mode.test.ts:12-20` e `src/frontend/__tests__/permutas-fonte-dado.test.ts:41-52`
- **Evidência (objetiva)**:
  ```
  const envOriginal = process.env
  beforeEach(() => {
    jest.resetModules()
    process.env = { ...envOriginal, NEXT_PUBLIC_ENV: 'local' }
    delete process.env.NEXT_PUBLIC_DEMO_MODE
  })
  afterAll(() => { process.env = envOriginal })
  ```
  O padrão está **correto** (o snapshot em `envOriginal` + `jest.resetModules()` + restauração em `afterAll` de fato isola: se uma suíte esquecer o `resetModules` o `assertDemoEnv()` do próximo import lê o `process.env` já mutado). Mas o mesmo bloco de ~10 linhas é repetido em duas suítes e será re-repetido no próximo teste que precisar mexer em `NEXT_PUBLIC_*`. Sem um helper, um dev novo pode omitir uma das três coisas (snapshot, `resetModules`, restauração) e o leakage volta.
- **Impacto técnico**: risco crescente de flake conforme a suíte crescer com testes de flag.
- **Impacto de negócio**: nenhum hoje; débito preventivo.
- **Métrica de baseline**: 2 suítes replicam o padrão; 0 helpers em `src/frontend/__tests__/` para env-flags.

## 5. Cards Kanban

### [testability-1] Adicionar testes de hook para `usePermutasData` — a nova seam do `error` fica auditável

- **Problema**
  > `usePermutasData` (`src/frontend/app/permutas/components/usePermutasData.ts:1-82`) ficou em **0% de cobertura** mesmo depois de virar o dono do novo estado `error` — o hook é onde o guard `isSessionExpiredError` decide se a falha vira banner ou modal, e o commit `27023a9` só corrige o defeito 1.1 se essa lógica não regredir. Os testes atuais atacam as dependências (o `fetchGestaoPermutas` em `permutas-fonte-dado.test.ts` e o `SessionExpiredError` em `lib/http`) — o hook em si nunca é montado.
- **Melhoria Proposta**
  > Adicionar `src/frontend/app/permutas/components/usePermutasData.test.tsx` com `@testing-library/react-hooks` ou `renderHook` do `@testing-library/react`, cobrindo: (a) carga inicial de sucesso; (b) carga inicial com `Error` cru → `error` populado, `loading` false; (c) carga inicial com `SessionExpiredError` → `error` fica `null` (o modal é o dono); (d) `load()` de refresh com falha preserva `data` anterior e seta `error`; (e) unmount durante `fetch` pendente não gera `setState`. Tactic Bass alvo: **Specialized Interfaces** — o hook já é a seam, só falta exercitá-la.
- **Resultado Esperado**
  > Cobertura `usePermutasData.ts` **0% → ≥ 80% linhas** e cada uma das 5 combinações críticas com pelo menos 1 caso; regressão do bug do commit `27023a9` passa a estourar no CI.
- **Tactic alvo**: Specialized Interfaces + Limit Structural Complexity
- **Severidade**: P1
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Cobertura `usePermutasData.ts` (lines): 0 → ≥ 80
  - Testes exercitando o hook: 0 → ≥ 5 casos
  - Branches do delta (guards de `SessionExpiredError` + `mensagemDeFalha` + `active` flag) cobertas: 0/5 → 5/5
- **Risco de não fazer**: reincidência do defeito 1.1 (fixture servido como carteira) a uma refatoração de distância; o CI verde não defende a invariante "o que está na tela é o que está no banco".
- **Dependências**: nenhuma.

### [testability-2] Teste de composição para `app/permutas/page.tsx` — a matriz `data × error × fonte`

- **Problema**
  > A composição que este PR desenhou — `DemoDataBanner` sempre no topo, `LoadErrorBanner` só se `data` existir, `EmptyState` com `AlertTriangle` se `!data` (`app/permutas/page.tsx:724-744`) — vive num arquivo de 1059 LOC com 0% de cobertura. Os banners têm 100% em isolamento; a matriz de estados que decide qual aparece em qual cenário não tem teste.
- **Melhoria Proposta**
  > Extrair a montagem dos 3 estados para um subcomponente `PermutasHeader` (ou similar) — não a página inteira, só o bloco `l.724-744` que compõe banners + empty-state — e adicionar `PermutasHeader.test.tsx` com uma matriz explícita: (a) `data.fonte='banco' + error=null` → nenhum banner; (b) `data.fonte='fixture'` → `DemoDataBanner` visível; (c) `data≠null + error='API 500'` → `LoadErrorBanner` visível com dados preservados; (d) `data=null + error='API 500'` → `EmptyState` com `AlertTriangle`. Tactic Bass alvo: **Limit Structural Complexity** (fatia a página grande) + **Executable Assertions** (a invariante `ontology/ui-flows/fonte-do-dado-permutas.md` vira teste).
- **Resultado Esperado**
  > Subcomponente `PermutasHeader` com cobertura ≥ 90% linhas; 4 combinações críticas de estado (`data × error × fonte`) 0/4 → 4/4 testadas; `page.tsx` reduz em ~20 LOC de composição.
- **Tactic alvo**: Limit Structural Complexity + Executable Assertions
- **Severidade**: P2
- **Esforço estimado**: M
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Combinações `data × error × fonte` cobertas: 0/4 → 4/4
  - LOC de `page.tsx`: 1059 → ~1039 (a composição sai)
  - Cobertura do subcomponente extraído: — → ≥ 90 lines
- **Risco de não fazer**: a invariante "o que está na tela é o que está no banco" fica só na ontologia; a próxima refatoração do topo da página pode reintroduzir o defeito 1.1.
- **Dependências**: nenhuma; independente de [testability-1].

### [testability-3] Helper `withMockedEnv` para sandboxear `NEXT_PUBLIC_*` uma vez só

- **Problema**
  > O padrão `envOriginal` + `jest.resetModules()` + restauração está replicado em `__tests__/features-demo-mode.test.ts` e `__tests__/permutas-fonte-dado.test.ts`. O padrão é correto, mas cada nova suíte que mexer em `NEXT_PUBLIC_*` reimplementa as três coisas — omissão de qualquer uma delas volta o leakage entre suítes.
- **Melhoria Proposta**
  > Extrair um helper `withMockedEnv(overrides: Record<string, string \| undefined>)` em `src/frontend/__tests__/helpers/env.ts` que faz snapshot no `beforeEach`, aplica overrides, chama `jest.resetModules()` e restaura no `afterEach`/`afterAll`. Migrar as duas suítes existentes. Tactic Bass alvo: **Sandbox** encapsulada.
- **Resultado Esperado**
  > 1 helper compartilhado; 2 suítes usam o helper em vez do padrão in-line; teste novo de env-flag passa a pedir 1 linha (`withMockedEnv({ NEXT_PUBLIC_DEMO_MODE: 'true' })`) em vez de 10.
- **Tactic alvo**: Sandbox
- **Severidade**: P3
- **Esforço estimado**: S
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Duplicação do bloco env-sandbox: 2 cópias → 0
  - Suítes que dependem do helper: 0 → 2
- **Risco de não fazer**: baixo hoje; débito preventivo — cresce linearmente com o número de flags `NEXT_PUBLIC_*` (já existem `SISPAG_ENABLED`, `DEMO_MODE`, `API_URL`, `ENV`).
- **Dependências**: nenhuma.

> **Sem card para F-testability-3** (threshold global desatualizado). Justificativa: rebater o floor
> `global` toda vez que um arquivo sobe a 100 é anti-padrão (transforma todo PR de teste em PR de
> config). A abordagem correta é threshold **por diretório** (`./lib/features.ts` ou `./app/permutas/`),
> e essa mudança é escopo do próximo Regis-Review de cobertura, não deste delta. O ganho real virá
> do [testability-1] e [testability-2], que sobem o denominador real.

## 6. Notas do agente

- Escopo declarado desde o início: delta 100% frontend, tactics de DI/tsyringe/Postgres marcadas N/A em vez de virar finding fantasma. Terraform declarado não medível conforme `_shared-metrics.md`.
- Cobertura coletada com `jest --coverage --coverageReporters=text`; o `collectCoverageFrom` do `jest.config.js` já expande para todo `app/`, `lib/`, `components/`, então o 0% de `usePermutasData.ts` e `page.tsx` é medido de verdade, não Potemkin.
- Cross-QA: F-testability-1 e F-testability-2 conversam com **Modifiability** (Limit Structural Complexity — a página gigante é o mesmo problema visto por dois ângulos) e com **Availability / Fault Tolerance** (o guard de `SessionExpiredError` que só o hook faz é uma decisão de recuperação de falha sem teste). F-testability-3 conversa com **Deployability** (gate de cobertura antes de deploy).
- Score 7.0: o delta em si é **bem testado nas seams puras** (features/banners a 100%, `fetchGestaoPermutas` com os 3 caminhos + 401 cobertos), o que já é acima da média do repo — mas o hook e a composição, exatamente onde vivia o defeito 1.1, ficam sem defesa nova. Boa entrega com dois vazios visíveis, não uma entrega verde com vazio invisível.
