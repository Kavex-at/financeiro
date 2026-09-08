---
qa: Testability
qa_slug: testability
run_id: 2026-09-03-1913-moldura-navegacao
agent: qa-testability
generated_at: 2026-09-03T19:13:00-03:00
scope: frontend
score: 7
findings_count: 6
cards_count: 5
---

# Testability — Regis-Review

> Escopo restrito ao delta `feat/moldura-navegacao` (commit `05606a6`). Backend e infra estão fora deste run — o delta não os toca. Não existe `infra/` neste repositório (ver CLAUDE.md §Estado Atual vs. Alvo). Cobertura já foi coletada e vive em `_shared-metrics.md`; este QA não re-rodou `--coverage`.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Desenvolvedor(a) da Kavex tocando um componente da moldura (Sidebar, BottomNav, AppShell, app-nav) numa `/feature-tweak` futura | Muda a regra de visibilidade (`hidden`), o cálculo de rota ativa, o item do `MoreHorizontal` do BottomNav ou a lista de itens em `buildAppNavGroups` | Moldura de navegação renderizada em TODA rota autenticada (`/permutas`, `/sispag`, `/recebimentos`, `/operacao`, `/usuarios` e sub-rotas) | Desenvolvimento local com `npm test`, `npm run typecheck`, `npm run lint` e CI em cima do PR | O suite deve isolar a regressão no menor teste possível, sem depender de rodar app inteiro nem de a11y manual; um único `aria-current`, `skip link` como primeiro focável e `role="main"` presente devem estar cobertos por asserção | 100% das invariantes documentadas em `ontology/ui-flows/navegacao-global.md` viradas em asserção; cobertura por arquivo da moldura ≥ 80% lines; CI trava se cobertura global regredir >2pp; tempo de feedback do bloco de moldura ≤ 5s em `npm test` local |

Bass é lido aqui na chave financeira do QA: **testar é caro; testabilidade é o multiplicador desse custo**. A moldura passou a viver em toda rota — o custo de uma regressão silenciosa nela cresce por rota, não por componente. A pergunta que este QA responde é: quanto do custo desse multiplicador o delta baixou, e quanto o CI ainda deixa em cima da mesa.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura por arquivo do delta — **lines** | AppShell 97.87 · app-nav 100 · sidebar 94.64 · nav-item 90.62 · bottom-nav 80.95 | ≥ 80% em todos | ✅ | `_shared-metrics.md` §Cobertura |
| Cobertura por arquivo do delta — **branches** | AppShell 81.25 · app-nav 50 · sidebar 83.33 · nav-item 80.24 · bottom-nav 59.61 | ≥ 70% em todos | ⚠️ 2 abaixo (`app-nav`, `bottom-nav`) | `_shared-metrics.md` §Cobertura |
| Cobertura global do frontend — **lines** | 38.19% (antes: ~20.7%) | ≥ 30% no ciclo, subir 5pp/release | ✅ +17.5pp | `_shared-metrics.md` §Cobertura |
| Cobertura global do frontend — **branches** | 28.73% (antes: 9.59%) | ≥ 20% no ciclo | ✅ +19.1pp | idem |
| Cobertura global do frontend — **functions** | 33.33% (antes: 14.85%) | ≥ 25% | ✅ +18.5pp | idem |
| Distância entre floor CI e cobertura real (`coverageThreshold.global`) | lines **18.2pp** · branches **19.7pp** · functions **19.3pp** de folga | ≤ 2pp (floor trava regressão de verdade) | ❌ | `src/frontend/jest.config.js:36-40` vs `_shared-metrics.md` |
| Casos novos no delta | 39 (`sidebar 14 + bottom-nav 7 + app-nav 10 + AppShell 8`) | ≥ 1 caso por invariante em `navegacao-global.md` | ✅ (11 invariantes explícitas mapeadas ≥ 1:1) | `git show 05606a6 --stat` |
| Arquivos-fonte da moldura vs arquivos de teste | 5 fontes : 4 testes (0.8) | ≥ 0.5 | ✅ | `find src/frontend/components -name '*.test.tsx'` |
| Ratio teste/fonte no frontend inteiro | 30 testes / 104 fontes (0.29) | ≥ 0.5 no médio prazo; ≥ 0.2 mínimo | ⚠️ acima do piso mínimo, abaixo do alvo | `find src/frontend` (_shared-metrics.md §Frontend) |
| Presença de `describe('integration:` ou E2E automatizado | 0 | ≥ 1 smoke test que abra `/`, autentique e clique num item da sidebar | ❌ | `find` em `src/frontend` (ver notas §6) |
| Testes de a11y automatizados (`jest-axe`, `axe.run`, Playwright a11y snapshot) | 0 | ≥ 1 rodada `axe` na moldura por CI | ❌ | `grep -rn "jest-axe\|toHaveNoViolations" src/frontend` — vazio; `axe-core` só aparece em `package-lock.json` como dep transitiva |
| Uso de `fast-check` no frontend | 0 | ≥ 1 propriedade em `resolveActiveItemId` (função pura sobre árvore) | ⚠️ oportunidade | `grep -rln "fast-check" src/frontend` — vazio; não é devDependency direta |
| Extração de lógica pura para teste sem render | `resolveActiveItemId` (3 casos), `buildAppNavGroups` (6 casos) | Toda regra de visibilidade / cálculo de rota ativa testável fora do render | ✅ | `sidebar.tsx:*` + `app-nav.tsx:33`; testes em `sidebar.test.tsx` e `app-nav.test.tsx` |
| Determinismo (time / random / rede) na moldura | 0 usos de `Date.now`, `Math.random`, `fetch` em produção; `localStorage` e `usePathname` são mockados; `fetchPermissoes` é mockado em 3 arquivos | 0 | ✅ | `grep -rn "Math.random\|Date.now" src/frontend/components/{ui,nav}` — vazio |
| Módulos externos mockados pelo delta sem contract test | `next/navigation` · `@/lib/auth/AuthProvider` · `@/lib/operacao` (3 arquivos) | ≥ 1 asserção estática (`satisfies`) ou contract test que garanta que o mock não deriva do real | ❌ | ver F-testability-3 |

## 3. Tactics — Cobertura no nf-projects

Escopo restrito ao delta e ao contexto do frontend — tactics de banco/SQS irrelevantes aqui viram N/A.

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Specialized Interfaces** | `resolveActiveItemId` e `buildAppNavGroups` extraídas como funções puras exportadas exatamente para virar teste sem render. É a tactic de maior valor aplicada neste delta. | ✅ | `sidebar.tsx` (`export function resolveActiveItemId`), `app-nav.tsx:33`; `sidebar.test.tsx` §`resolveActiveItemId`; `app-nav.test.tsx` §`buildAppNavGroups` |
| **Recordable Test Cases** | Nenhuma resposta de `fetchPermissoes` gravada como fixture; o mock retorna literal (`{ operacao: true }`) por teste. Sem drift check contra a resposta real. | ❌ | `grep -rn "__fixtures__" src/frontend` — vazio; 3 mocks literais |
| **Sandbox** | Frontend roda em `jsdom` (`jest.config.js:3`). O `localStorage` do teste do colapso da sidebar é o do jsdom — sandbox nativo. Não há sandbox para chamada de rede (não é preciso: 100% mockado no delta). | ✅ | `jest.config.js:3`; `sidebar.test.tsx` §"não quebra quando o localStorage está indisponível" (usa `jest.spyOn(Storage.prototype, ...)`) |
| **Executable Assertions** | Invariantes narradas em `ontology/ui-flows/navegacao-global.md` viraram asserção 1:1 (um único `aria-current`, `hidden` sem `aria-disabled`, skip link como primeiro focável, um `<h1>` por página, `/login` sem moldura, `/docs` sem sidebar sem sessão, badge `≥100 → "99+"`). | ✅ | `sidebar.test.tsx:70-77` (`querySelectorAll('[aria-current="page"]')).toHaveLength(1)`), `AppShell.test.tsx:78-83` (um só `<h1>`), `AppShell.test.tsx:107-112` (`/login`), `sidebar.test.tsx:107-112` (badges) |
| **Abstract Data Sources** | `fetchPermissoes` isolado atrás de `usePermissaoOperacao`; teste em `app-nav.test.tsx` prova o "falha fechada" mockando rejeição. Já é a abstração certa. | ✅ | `app-nav.tsx:118` (`usePermissaoOperacao`); `app-nav.test.tsx` §"falha fechada" |
| **Limit Structural Complexity** | Testes por camada — `sidebar` isolado do `AppShell`, `app-nav` isolado do `Sidebar`, `AppShell` mockando os subcomponentes que já têm teste próprio (`UserMenu`, `ConexosStatusBanner`, `RouteGate`). Nenhum teste passa dos 200 LOC (top: `sidebar.test.tsx` 193 LOC). Escopo por camada é o que permite feedback rápido. | ✅ | `_shared-metrics.md` §LOC dos testes do delta |
| **Limit Non-Determinism** | 0 uso de `Date.now`/`Math.random` na moldura; `usePathname` mockado; `localStorage` mockado ou usado no jsdom limpo por `beforeEach`. Um único `new Promise(() => {})` em `AppShell.test.tsx:26` que **suprime** o resolve do `fetchPermissoes` — decisão declarada, mas oculta o caminho `permitido=true` desse teste (compensado pelo teste dedicado em `app-nav.test.tsx`). | ⚠️ | `AppShell.test.tsx:24-27`; ver F-testability-6 |
| **Coverage as CI gate** | `coverageThreshold` existe (`jest.config.js:36-40`) mas está **18pp abaixo** da cobertura real após o delta. Um floor 18pp abaixo do real deixa passar uma regressão que corte a cobertura pela metade sem falhar o build. É o achado mais valioso deste QA. | ❌ | `jest.config.js:36-40` vs `_shared-metrics.md` §Cobertura; ver F-testability-1 |
| **A11y Executable Assertions** (extensão local — moldura é a11y-critical) | Toda a11y da moldura (`role="navigation"`, `role="main"`, `role="banner"`, `aria-current`, `aria-expanded`, `aria-controls`, `sr-only`, skip link) é verificada por `getByRole` + `toHaveAttribute` — asserção artesanal. Não há `jest-axe`. Numa moldura que agora renderiza em TODA rota, faltar `axe` é deixar o teste crescer proporcional ao número de landmarks. | ❌ | `grep -rn "jest-axe" src/frontend` — vazio; ver F-testability-2 |
| **End-to-end smoke** | 0 E2E automatizado. `docs/e2e/` é markdown de rodadas manuais contra Conexos HML (fase-b, fin014 etc.), não Playwright/Cypress. Uma quebra que só apareça quando `AppNavigation` monta em produção (contexto do provider real, hidratação, `next/link`) passa pelos unit tests em silêncio. | ❌ | `ls docs/e2e/` (markdown); `find src/frontend -name '*.spec.ts'` — vazio; ver F-testability-4 |
| **Contract test / mock drift defense** | 3 arquivos mockam `@/lib/operacao` com `{ operacao: true }` literal; nenhum usa `satisfies Permissoes` nem `jest.requireActual` para reaproveitar tipos. Se o backend renomear `Permissoes.operacao` para `Permissoes.painelOperacao`, o mock aceita e os testes continuam verdes. | ⚠️ | ver F-testability-3 |
| **Property-based testing** | `fast-check` **não** é dep do frontend (é dep do backend do template financeiro). `resolveActiveItemId` (pura, opera sobre árvore de rotas) é o candidato natural. | ⚠️ oportunidade | `grep "fast-check" src/frontend/package.json` — vazio |

## 4. Findings (achados)

### F-testability-1: `coverageThreshold` global desatualizado — 18pp abaixo do real após o delta

- **Severidade**: P1
- **Tactic violada**: Coverage as CI gate (variante local de *Executable Assertions* aplicada a métricas de cobertura)
- **Localização**: `src/frontend/jest.config.js:36-40`
- **Evidência (objetiva)**:
  ```js
  coverageThreshold: {
      global: {
          lines: 20,
          branches: 9,
          functions: 14,
      },
      './lib/auth/': { lines: 24 },
  },
  ```
  Contra `_shared-metrics.md` §Cobertura pós-delta:
  ```
  lines 38.19%   branches 28.73%   functions 33.33%
  ```
- **Impacto técnico**: uma regressão que apague 45% dos testes da moldura (voltando a cobertura para 21% lines) **passa no CI**. O gate está calibrado para o baseline v0.8.0 (lote copiar-barcode) e não subiu junto com o delta desta feature — o próprio comentário do arquivo diz "SUBIR conforme testes de componente forem adicionados", que é agora. Este é exatamente o cenário Bass previa em *Limit Complexity*: o floor que não acompanha o teto vira decorativo.
- **Impacto de negócio**: perdemos a defesa mais barata contra regressão de testabilidade — 4 linhas de config. Numa moldura que renderiza em toda rota, cada 1pp de cobertura perdida silenciosamente é uma superfície inteira de a11y/navegação exposta a regressão sem alarme.
- **Métrica de baseline**: floor CI 20/9/14 vs real 38.19/28.73/33.33 → folga de 18.2 / 19.7 / 19.3 pontos percentuais. Alvo Bass razoável: floor 2pp abaixo do real, para não travar melhorias marginais e travar toda regressão relevante.

### F-testability-2: Sem `jest-axe` nem varredura automatizada de a11y numa moldura a11y-critical

- **Severidade**: P2
- **Tactic violada**: Executable Assertions (variante a11y) + Limit Structural Complexity (a asserção manual cresce O(landmarks))
- **Localização**: `src/frontend/package.json` (dev deps), todo o suite da moldura
- **Evidência (objetiva)**:
  ```
  grep -rn "jest-axe\|toHaveNoViolations" src/frontend  →  0 matches
  grep "\"jest-axe\"\|\"@axe-core\"" src/frontend/package.json  →  0 matches
  (axe-core aparece em package-lock apenas como dependência transitiva)
  ```
  As invariantes de a11y do delta são verificadas por asserção artesanal:
  ```tsx
  // sidebar.test.tsx — asserção manual da invariante "um único aria-current"
  expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  // AppShell.test.tsx — asserção manual do skip link
  const focaveis = container.querySelectorAll('a[href], button')
  expect(focaveis[0]).toBe(skip)
  ```
- **Impacto técnico**: cada regra nova de a11y (contraste, `aria-describedby` em tooltip, foco preso em popover do "Mais") vai virar 3-5 linhas de teste artesanal por lugar; um `jest-axe` capturaria dezenas de regras de uma vez, incluindo as que ninguém pensou em asseverar (nomeação implícita, ordem de tabulação, contraste).
- **Impacto de negócio**: a moldura é a superfície mais visível para acessibilidade — leitor de tela do analista, teclado, foco. Este delta acertou nas 11 invariantes documentadas em `ontology/ui-flows/navegacao-global.md`; a próxima extensão (paleta ⌘K, popover do sub-item colapsado do backlog) vai reabrir esse trabalho manualmente. Bass em *Limit Complexity*: a asserção que não escala vira dívida em cada feature nova.
- **Métrica de baseline**: 0 regras de a11y verificadas automaticamente na moldura. Alvo: ≥ 30 regras (o conjunto WCAG 2.1 AA que `axe.run` cobre por default) em ≥ 1 render por landmark (Sidebar autenticada, BottomNav, AppShell `/login`, AppShell `/docs` sem sessão) = 4 renders × 30 regras = 120 asserções por rodada, 0 linhas de código de asserção manual por regra nova.

### F-testability-3: 3 mocks literais de `@/lib/operacao` sem `satisfies` — mock drift silencioso

- **Severidade**: P2
- **Tactic violada**: Abstract Data Sources (a abstração existe, o teste não a usa) + Recordable Test Cases (não há gravação da resposta real que force o mock a refletir a API)
- **Localização**:
  - `src/frontend/__tests__/AppShell.test.tsx:24-27`
  - `src/frontend/components/nav/app-nav.test.tsx:12-14`
  - Adicionalmente, `src/frontend/app/operacao/page.test.tsx` já usa `jest.requireActual('@/lib/operacao')` — precedente do próprio repo do que fazer.
- **Evidência (objetiva)**:
  ```tsx
  // AppShell.test.tsx
  jest.mock('@/lib/operacao', () => ({
    fetchPermissoes: () => new Promise(() => {}),
  }))

  // app-nav.test.tsx
  const fetchPermissoesMock = jest.fn()
  jest.mock('@/lib/operacao', () => ({
    fetchPermissoes: () => fetchPermissoesMock(),
  }))
  fetchPermissoesMock.mockResolvedValue({ operacao: true })
  ```
  Contra a assinatura real:
  ```ts
  export interface Permissoes { operacao: boolean }
  export async function fetchPermissoes(): Promise<Permissoes>
  ```
  Se `Permissoes.operacao` virar `Permissoes.painelOperacao` (ou o campo virar `operacao: { ativo: boolean, motivo?: string }`), os três mocks continuam válidos como código, os testes continuam verdes, e a Sidebar em produção esconde o item — sem alarme.
- **Impacto técnico**: mock drift é insidioso — o teste da moldura cobre "esconde quando `operacao:false`" mas não cobre "esconde quando a API muda de forma". Uma mudança de contrato do backend hoje só é pega em runtime.
- **Impacto de negócio**: o item de Operação sumido é sintoma que a analista da Columbia reporta como "sumiu o painel"; a raiz é uma mudança de campo. Custo de investigação: mínimo 30min por incidente. Frequência: baixa, mas o custo por vez é maior que a defesa.
- **Métrica de baseline**: 3 arquivos de teste mockando literalmente / 3 = **100% dos mocks de `@/lib/operacao` sem checagem estática de shape**. Alvo: 0/3 — todo mock com `satisfies Permissoes` importado do módulo real (`import type { Permissoes } from '@/lib/operacao'`).

### F-testability-4: 0 E2E automatizado num app que agora tem moldura em toda rota autenticada

- **Severidade**: P2 (**herdado, não introduzido pelo delta** — a ausência é pré-existente; o delta apenas amplia o custo dela)
- **Tactic violada**: End-to-end smoke (integração real navegador↔backend)
- **Localização**: `src/frontend/` — nenhum `*.spec.ts`, `playwright.config.*`, `cypress.config.*`
- **Evidência (objetiva)**:
  ```
  find src/frontend -name "*.spec.ts" -o -name "*.e2e.ts" → 0
  ls docs/e2e/  →  fase-b-resultado-hml.md, HANDOFF-proxima-sessao.md, ... (markdown de rodadas manuais)
  ```
- **Impacto técnico**: um bug que só aparece com o `AuthProvider` real hidratado (context não fornecido, race com `usePathname` no App Router, `Link` do Next não pré-renderizando) não é pego. O delta acertou em mockar `RouteGate` no `AppShell.test.tsx`, mas isso vale para a testabilidade do componente — a integração real fica sem cobertura.
- **Impacto de negócio**: a moldura passou a ser a superfície comum de todo fluxo do analista; uma regressão nela impacta 4 frentes (Permutas / SISPAG / Recebimentos / Usuários). Bass tomaria isso como um caso claro de *Limit Non-Determinism* falhando fora do unit test — o não-determinismo dos providers reais nunca é exercitado.
- **Métrica de baseline**: 0 smoke tests. Alvo mínimo defensável: **1** smoke que (a) abra `/login`, (b) autentique, (c) clique num item da sidebar, (d) valide `role="main"` e um único `<h1>` por página. É o mínimo que este delta especificamente pede porque ele adicionou o `<h1>` e o `role="main"` que antes não existiam.

### F-testability-5: Cobertura de branches em `bottom-nav` (59.61%) e `app-nav` (50%) abaixo do piso da própria moldura

- **Severidade**: P3
- **Tactic violada**: Executable Assertions (não todos os caminhos condicionais viraram teste)
- **Localização**: `src/frontend/components/ui/bottom-nav.tsx`, `src/frontend/components/nav/app-nav.tsx`
- **Evidência (objetiva)**:
  ```
  bottom-nav.tsx  80.95% lines | 59.61% branches | 50% functions
  app-nav.tsx     100%   lines | 50%    branches | 100% functions
  ```
  O 50% de branches no `app-nav.tsx` decorre de `buildAppNavGroups` ter tooltip opcional / `hidden` opcional; nem toda combinação virou caso. No `bottom-nav.tsx`, o path do "Mais" fechado vs aberto e o `onNavigate?.()` opcional são os grandes ausentes.
- **Impacto técnico**: um branch novo (ex.: item com `disabled` chegando ao `BottomNav`, o que hoje é proibido por regra) pode ser silenciosamente exercido em produção.
- **Impacto de negócio**: risco baixo por enquanto — a regra "permissão esconde, nunca desabilita" está travada em `app-nav.test.tsx`.
- **Métrica de baseline**: branches `bottom-nav` 59.61% → alvo 75%; branches `app-nav` 50% → alvo 75%.

### F-testability-6: `AppShell.test.tsx` mocka `fetchPermissoes` como promessa que nunca resolve — oculta 1 branch

- **Severidade**: P3
- **Tactic violada**: Limit Non-Determinism (o teste evita `act` warning, mas ao custo de esconder um caminho de estado)
- **Localização**: `src/frontend/__tests__/AppShell.test.tsx:24-27`
- **Evidência (objetiva)**:
  ```tsx
  // Promessa que nunca resolve: o item de Operação tem teste próprio em `components/nav`, e aqui
  // uma resolução assíncrona só produziria atualização de estado fora do `act`.
  jest.mock('@/lib/operacao', () => ({
    fetchPermissoes: () => new Promise(() => {}),
  }))
  ```
- **Impacto técnico**: no `AppShell.test.tsx` o caminho `permitido = true` (que exibe "Operação" na sidebar) nunca é executado. É uma decisão declarada e razoável — o teste dedicado em `app-nav.test.tsx` cobre esse caminho — mas cria um vetor onde uma regressão na propagação do resultado do hook até o render final do `AppShell` (por exemplo, um `React.memo` mal colocado que quebra a re-renderização quando `operacaoEnabled` muda) passaria em ambos os testes: no `app-nav.test.tsx` porque não passa pelo `AppShell`, no `AppShell.test.tsx` porque nunca chega ao path.
- **Impacto de negócio**: mínimo hoje; a moldura não tem esse memo. Vira P2 no dia que houver essa otimização.
- **Métrica de baseline**: 1 caminho de estado do hook (`operacaoEnabled: true`) não exercitado em `AppShell.test.tsx`. Alvo: exercitá-lo com `mockResolvedValue({ operacao: true })` + `await waitFor(...)`, aceitando o custo de 1 `act` a mais.

## 5. Cards Kanban

### [testability-1] Reassentar `coverageThreshold` do frontend para 2pp abaixo do real pós-delta

- **Problema**
  > O `coverageThreshold` global do `src/frontend/jest.config.js` está calibrado para o baseline v0.8.0 (20/9/14), mas o delta desta feature levou a cobertura real para 38.19/28.73/33.33 — folga de ~18-19pp em cada eixo. Uma regressão que apague metade dos testes novos passa no CI sem alarme. O próprio comentário do arquivo prevê "SUBIR conforme testes de componente forem adicionados" — é agora.

- **Melhoria Proposta**
  > Editar `src/frontend/jest.config.js:36-40` para `lines: 36 / branches: 26 / functions: 31` (2pp abaixo do medido; slack para melhorias marginais, gate real contra regressão relevante). Atualizar o comentário histórico do arquivo com a data e o ciclo. Tactic Bass: *Executable Assertions* aplicada ao próprio pipeline de CI.

- **Resultado Esperado**
  > Uma regressão que baixe a cobertura frontend de 38% para 34% (dois arquivos inteiros da moldura ficando sem teste) faz o CI vermelho. Distância floor↔real: 18.2pp → 2pp em lines; 19.7pp → 2pp em branches; 19.3pp → 2pp em functions.

- **Tactic alvo**: Executable Assertions (Bass QA Testability)
- **Severidade**: P1
- **Esforço estimado**: S (≤1d — é edição de 3 números + validação de que o CI passa)
- **Findings relacionados**: F-testability-1
- **Métricas de sucesso**:
  - Distância `coverageThreshold.global.lines` vs real: 18.2pp → 2pp
  - Distância `coverageThreshold.global.branches` vs real: 19.7pp → 2pp
  - Distância `coverageThreshold.global.functions` vs real: 19.3pp → 2pp
- **Risco de não fazer**: 6 meses adiante, com mais features (paleta ⌘K, backlog `SettingsSidebar`), o floor 20/9/14 vai estar 25-30pp abaixo do real; regressão de cobertura por refactor grande passa despercebida.
- **Dependências**: nenhuma. Card independente e isolado do delta.

### [testability-2] Adicionar `jest-axe` e uma suíte de a11y para a moldura

- **Problema**
  > A moldura passou a viver em TODA rota autenticada — é a superfície mais crítica para a11y do produto (skip link, landmarks, `aria-current`, `aria-expanded`, `aria-controls`, foco visível). As 11 invariantes documentadas em `ontology/ui-flows/navegacao-global.md` viraram asserção manual (`getByRole` + `toHaveAttribute`). Não há `jest-axe`; `axe-core` só aparece em `package-lock.json` como dep transitiva. Cada regra nova de a11y ao longo do backlog (popover do sub-item colapsado, paleta ⌘K, dark mode) vai gerar 3-5 linhas de asserção manual por lugar.

- **Melhoria Proposta**
  > Adicionar `jest-axe` como devDependency do frontend. Criar um `AppShell.a11y.test.tsx` que renderize `<AppShell>` em 4 cenários (autenticado desktop, autenticado mobile, `/login`, `/docs` sem sessão) e chame `expect(await axe(container)).toHaveNoViolations()` em cada. Documentar no `ontology/ui-flows/navegacao-global.md` §Testes que a checagem `axe` é a defesa automática, e as asserções manuais existentes ficam como *invariantes-narrativas* (o `aria-current` único, o `<h1>` único, o skip link primeiro focável) — que são mais fortes que o `axe` para essas duas regras. Tactic Bass: *Executable Assertions* aplicada à a11y (asserções que crescem O(1), não O(landmarks)).

- **Resultado Esperado**
  > A moldura passa a ter 0 violações WCAG 2.1 AA verificadas em cada `npm test`. Uma extensão futura que quebre contraste, adicione um botão sem `aria-label` ou remova a nomeação de uma landmark quebra o build local antes de virar PR.

- **Tactic alvo**: Executable Assertions (extensão a11y)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — instalar `jest-axe`, criar `AppShell.a11y.test.tsx` com 4 cenários)
- **Findings relacionados**: F-testability-2
- **Métricas de sucesso**:
  - Regras de a11y verificadas automaticamente na moldura: 0 → ≥ 30 (default do `axe.run`)
  - Cenários renderizados sob a varredura: 0 → 4 (desktop autenticado, mobile autenticado, `/login`, `/docs` público)
  - LOC de asserção manual de a11y por regra nova no backlog: 3-5 → 0
- **Risco de não fazer**: cada card do backlog da moldura (paleta ⌘K, popover do sub-item colapsado, dark mode) vai reabrir a discussão de que asserção manual escrever e onde. Uma quebra silenciosa (ex.: perder a nomeação de landmark ao refatorar) vira ticket do usuário, não teste vermelho.
- **Dependências**: nenhuma.

### [testability-3] `satisfies` nos mocks de `@/lib/operacao` para detectar drift de contrato

- **Problema**
  > Três arquivos de teste mockam `@/lib/operacao` com `{ operacao: true }` literal, sem checagem de shape. Se `Permissoes` mudar de `{ operacao: boolean }` para `{ operacao: { ativo: boolean } }` (ou o campo for renomeado), os mocks continuam compilando, os testes continuam verdes, e a Sidebar em produção esconde o item de Operação — sem alarme. O próprio repo já tem precedente do padrão certo em `app/operacao/page.test.tsx` (que usa `jest.requireActual` para reaproveitar o tipo real).

- **Melhoria Proposta**
  > Nos três arquivos que mockam `@/lib/operacao` (`__tests__/AppShell.test.tsx:26`, `components/nav/app-nav.test.tsx:12`, mais o `app/operacao/page.test.tsx` já existente como referência), tipar os mocks com `import type { Permissoes } from '@/lib/operacao'` e usar `satisfies Permissoes` no objeto de retorno. Estabelecer regra no `docs/design-system/*` ou `CLAUDE.md` do frontend: "mocks de módulos internos usam `satisfies <TipoReal>`". Tactic Bass: *Abstract Data Sources* (usar a abstração que já existe, em vez de mocar a implementação por baixo).

- **Resultado Esperado**
  > Mudança de contrato de `Permissoes` no backend/lib quebra o build dos testes que mockam o módulo, no lugar de virar item sumido em produção. Custo médio de investigação de "sumiu o item da Sidebar" cai de ~30min para 0.

- **Tactic alvo**: Abstract Data Sources / Recordable Test Cases
- **Severidade**: P2
- **Esforço estimado**: S (≤1d — 3 arquivos, 5-10 linhas cada)
- **Findings relacionados**: F-testability-3
- **Métricas de sucesso**:
  - Mocks de `@/lib/operacao` sem `satisfies`: 3/3 → 0/3
  - Regra registrada no repositório: 0 → 1 (`docs/design-system/mock-drift.md` ou §CLAUDE.md do frontend)
- **Risco de não fazer**: no primeiro refactor do backend que ajustar `Permissoes` (ex.: adicionar `operacaoRestrita` para o allow-list separado por frente), o front vai esconder o item silenciosamente e o suite não pega.
- **Dependências**: nenhuma.

### [testability-4] Smoke E2E mínimo (Playwright) da moldura em rota autenticada

- **Problema**
  > O frontend não tem E2E automatizado — `docs/e2e/` é markdown de rodadas manuais contra Conexos HML. A moldura agora vive em TODA rota autenticada; uma regressão que só aparece com providers reais hidratados (`AuthProvider`, `next/link` real, `usePathname` real do App Router) passa por todos os unit tests. É uma dívida pré-existente; o delta apenas amplia o custo dela.

- **Melhoria Proposta**
  > Adicionar Playwright como devDependency do frontend. Escrever UM smoke test: (a) abre `/login`, (b) faz login com credencial de dev, (c) clica em cada item visível da sidebar, (d) para cada rota, valida que existe um `role="main"`, um único `<h1>` e um único `aria-current="page"`. Rodar em CI, opcionalmente com `test.setTimeout(30_000)` como gate opcional. Tactic Bass: *End-to-end smoke* — o menor teste que exercita a integração real.

- **Resultado Esperado**
  > Cada PR que toca a moldura tem um segundo teste (o real) além dos unit tests. Regressões de hidratação, de `Link` do Next, de context provider e de router passam a ter alarme.

- **Tactic alvo**: End-to-end smoke (Bass — "test the integration, not only the units")
- **Severidade**: P2
- **Esforço estimado**: M (2-5d — setup Playwright, credencial de dev, wiring no CI, primeiro smoke)
- **Findings relacionados**: F-testability-4
- **Métricas de sucesso**:
  - Testes E2E automatizados: 0 → ≥ 1
  - Rotas autenticadas exercitadas em CI: 0 → 5 (`/permutas`, `/permutas/borderos`, `/sispag`, `/recebimentos`, `/operacao` ou `/usuarios` conforme permissão)
  - Invariantes da moldura verificadas end-to-end: 0 → 3 (`role="main"`, `<h1>` único, `aria-current` único)
- **Risco de não fazer**: qualquer refactor de `layout.tsx`, `AuthProvider` ou `RouteGate` risca produção sem alarme. A moldura em toda rota multiplica o raio de explosão.
- **Dependências**: credencial de dev estável (existir um tenant/usuário de teste no Supabase para o CI).

### [testability-5] Property-based test para `resolveActiveItemId` sobre árvores geradas

- **Problema**
  > `resolveActiveItemId` foi extraída como função pura (`sidebar.tsx`), operação recursiva sobre árvore de rotas. Tem 3 casos de teste — cobre o caminho feliz. A tactic *Limit Non-Determinism* aplicada a lógica pura sobre árvores é property-based testing: gerar árvores e afirmar propriedades (idempotência, um único ativo, prefixo mais longo vence). `fast-check` já é dep do backend financeiro mas não do frontend.

- **Melhoria Proposta**
  > Adicionar `fast-check` como devDependency do frontend. Escrever ≥ 3 propriedades para `resolveActiveItemId`:
  > 1. Para toda árvore e todo `pathname`, o resultado é `undefined` ou o `id` de um item que casa por `href` exato ou por prefixo `href + '/'`.
  > 2. Se um item filho casa, o pai não é escolhido.
  > 3. Itens `hidden: true` nunca são o resultado.
  > Tactic Bass: *Limit Non-Determinism* — a propriedade cobre árvores que ninguém pensou em enumerar.

- **Resultado Esperado**
  > `resolveActiveItemId` deixa de depender de asserção por exemplo — a propriedade sozinha varre 100+ árvores geradas por PR. Uma futura reescrita (ex.: memoizar, migrar para árvore imutável) mantém a propriedade sem reescrever teste.

- **Tactic alvo**: Limit Non-Determinism (property-based)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d — `fast-check` já está no ecossistema do repo)
- **Findings relacionados**: F-testability-5 (branches em `bottom-nav` e `app-nav` — propriedades naturalmente cobrem branches por saturação)
- **Métricas de sucesso**:
  - Propriedades em `resolveActiveItemId`: 0 → ≥ 3
  - Árvores exercitadas por rodada: 3 (fixas) → 100+ (geradas)
  - Uso de `fast-check` no frontend: 0 → ≥ 1 arquivo
- **Risco de não fazer**: baixo. Este card é oportunidade, não obrigação.
- **Dependências**: nenhuma.

## 6. Notas do agente

- Decisão de escopo: só o delta `05606a6`. As dívidas mais antigas do frontend (ex.: `permutas/page.tsx` com 2127 LOC sem teste de componente — mencionada no comentário do próprio `jest.config.js`) não entram neste QA porque não foram tocadas por esta feature. Vão ser puxadas pelo próximo `/feature-tweak` sobre `permutas/page.tsx`, quando a Inviolable Rule #4 (Lambda-ready) e o gate Regis obrigarem.
- Não re-rodei `npm test -- --coverage` — o `_shared-metrics.md` já traz os números por arquivo do delta e os globais antes/depois.
- Cross-QA relevantes para o `qa-consolidator`:
  - **Modifiability** — o card [testability-3] (mock drift via `satisfies`) é dual do argumento de Modifiability para tipar as fronteiras de dependência; se Modifiability também levantar isso, os cards devem ser fundidos ou linkados.
  - **Deployability** — o card [testability-1] (subir `coverageThreshold`) é gate de deploy; overlap direto com o que Deployability chama "quality gate no pipeline".
  - **Integrability** — o card [testability-4] (E2E smoke) é a única defesa integrativa real que o repo terá; se Integrability estiver no scope de outro run, será o mesmo argumento visto do outro lado.
  - **Fault Tolerance** — o teste "falha fechada" em `app-nav.test.tsx` (rejeição de `fetchPermissoes` mantém item escondido) já é exemplo de asserção de tolerância a falha do lado UI; Fault Tolerance pode citá-lo como precedente para outros pontos do produto.
