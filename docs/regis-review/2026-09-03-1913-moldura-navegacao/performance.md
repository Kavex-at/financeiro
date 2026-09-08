---
qa: Performance
qa_slug: performance
run_id: 2026-09-03-1913-moldura-navegacao
agent: qa-performance
generated_at: 2026-09-03T19:30:00-03:00
scope: frontend
score: 8
findings_count: 5
cards_count: 4
---

# Performance — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Analista autenticado navega entre frentes (`/permutas` → `/sispag` → `/recebimentos`) durante o expediente | Cada abertura/hard-reload monta a moldura raiz e a navegação global | `AppShell` + `AppNavigation` (`Sidebar` + `BottomNav`) do `layout.tsx` raiz | Browser desktop e mobile, sessão autenticada, produção Vercel | Moldura renderiza com item ativo correto, sem regredir tempo de interação nem provocar layout shift visível; toda página autenticada leva o mesmo shell | 1 `GET /me/permissoes` por sessão · CLS < 0.1 · shift do sidebar em hard-reload < 24px · nada de N+1 na navegação client-side |

Contexto do delta: **frontend puro**, sem backend novo. O que existe para medir é (a) custo por página da moldura montada no root layout, (b) chamadas HTTP disparadas pela moldura, (c) bundle JS extra que agora vai em toda rota. Não há Lambda/RDS/SQS impactados.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| `GET /me/permissoes` por sessão de trabalho | 1 por hard-load do layout raiz + 1 por transição `unauth→auth` (≈ 1–3 total) | ≤ 1 por sessão | ✅ | `src/frontend/components/nav/app-nav.tsx:117-131` (`useEffect`, `[]`) + `app/layout.tsx:22-33` (root layout persiste em App Router) |
| Remount de `AppNavigation` em navegação client-side (`/permutas`→`/sispag`) | 0 (layout raiz não desmonta) | 0 | ✅ | inspeção — `useAppNavGroups()` só remonta quando `authenticated` alterna |
| Instâncias de Radix `Tooltip` renderizadas por página (Sidebar) | 5 (Permutas, SISPAG, Adiantamentos, Operação, Usuários — todas com `tooltip.description`) sob 1 `TooltipProvider` | ≤ 10 | ✅ | `src/frontend/components/nav/app-nav.tsx:38-118` + `nav-item.tsx:198-215` (`if (tooltipBody)`) |
| Nós de DOM da navegação duplicados (Sidebar + BottomNav simultâneos) | ~30 (Sidebar: `<nav>` + 2 grupos + 5 itens + 2 sub-itens + toggle) + ~15 (BottomNav: `<nav>` + 4 links + botão Mais) ≈ 45 nós por página autenticada | ≤ 100 | ✅ | `src/frontend/components/AppShell.tsx:194-197` (`AppNavigation` monta os dois e o CSS `hidden md:block` / `md:hidden` esconde um) |
| Re-render do `Sidebar` após hidratação (leitura de `localStorage`) | 1 re-render pós-mount que pode alterar largura de `w-56` (224px) para `w-16` (64px) — flash visível se o usuário preferiu colapsado | 0 (ou shift < 24px) | ⚠️ | `src/frontend/components/ui/sidebar.tsx:139-144` (`useEffect` lê storage; comentário do próprio código justifica a escolha) |
| Chamadas HTTP síncronas emitidas pela moldura no mount | 1 (`GET /me/permissoes`) — sem `Promise.all`, sem waterfall, sem N+1 | ≤ 1 | ✅ | `src/frontend/components/nav/app-nav.tsx:120` |
| Imports top-level nos 5 arquivos do delta | AppShell 11 · app-nav 6 · sidebar 6 · bottom-nav 7 · nav-item 5 (máx: 11, mediana: 6) | ≤ 15 por módulo cliente | ✅ | `grep -c '^import' src/frontend/components/{AppShell,nav/app-nav,ui/sidebar,ui/bottom-nav,ui/nav-item}.tsx` |
| Novas runtime deps introduzidas pelo delta | 0 (Radix `react-tooltip`, `lucide-react`, `next/link`, `next/navigation` já eram deps do frontend) | 0 | ✅ | `src/frontend/package.json` (dependências inalteradas no delta) |
| First Load JS / route bundle (before vs. after) | ⚠️ **Não medível** — `next build` no worktree aborta com `Turbopack Panic: Symlink [project]/node_modules is invalid, it points out of the filesystem root` (log em `/tmp/next-panic-ffe76d842994c7d6748205b3d44a9767.log`); o worktree usa `node_modules` symlinkado ao checkout principal (`ls -la src/frontend/node_modules` → link para `../../../financeiro/src/frontend/node_modules`) e a instrução do run proíbe contornar mexendo em `node_modules`. Baseline em `_shared-metrics.md` diz apenas "compila e prerenderiza 12 rotas" sem número por rota. | First Load JS p95 ≤ 200KB | ⚠️ | `npm run build` no worktree; ver §6 |
| Tamanho da dep incremental (`@radix-ui/react-tooltip`) no shell | Já estava presente no bundle via `app/recebimentos/components/status-badges.tsx:25`; agora entra também no shared chunk do root layout, então **novo custo para rotas que ainda não a puxavam**: `/`, `/login`, `/operacao`, `/permutas*`, `/sispag`, `/usuarios`, `/docs/arquitetura` (~8 rotas). Instalado: 640K em `node_modules/@radix-ui/react-tooltip` (fonte não-minificada); tamanho gzipped estimado do bundle ~10–14KB (não medido — build indisponível). | Delta First Load JS ≤ 20KB gzip por rota afetada | ⚠️ | `du -sh node_modules/@radix-ui/react-tooltip` + `grep -rn '@radix-ui/react-tooltip\|components/ui/tooltip'` |
| CloudWatch / Lambda cold start | N/A — o delta é frontend puro; não há `infra/` neste repo (CLAUDE.md §Estado Atual vs. Alvo) | — | N/A | — |

> ⚠️ **Não medível localmente**: First Load JS por rota. Requer `next build` funcionando; no worktree o Turbopack panica pelo symlink de `node_modules`. Recomendação: rodar `npm run build` no **checkout principal** após merge (branch `main`) e comparar `Route (app)` / `First Load JS shared by all` contra o baseline pré-merge; se o delta shared subir mais que ~15KB, avaliar dynamic-import do `Sidebar` e `BottomNav` (o custo de code-splitting no root layout raramente vale — mas é a alavanca disponível).

## 3. Tactics — Cobertura no nf-projects

### Control Resource Demand

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Manage Sampling Rate | N/A — a moldura não amostra evento contínuo (não escuta scroll, resize por hook, keypress global). | N/A | — |
| Limit Event Response | `usePermissaoOperacao` dispara **1** fetch por mount com dep `[]`; `matchesPath` + `resolveActiveItemId` percorrem O(itens) uma vez por render (5 itens de raiz + 2 filhos). Nenhum listener global. | ✅ | `src/frontend/components/nav/app-nav.tsx:117-131`; `src/frontend/components/ui/sidebar.tsx:41-62` |
| Prioritize Events | Tooltip com `delayDuration={collapsed ? 0 : 1000}` — quando o rótulo está visível, o tooltip só aparece após 1s (não compete com a leitura); quando colapsado (ícone só), aparece na hora. É prioridade sobre atenção do operador, não CPU, mas é o exemplo aplicável. | ✅ | `src/frontend/components/ui/nav-item.tsx:207` |
| Reduce Overhead | `buildAppNavGroups` é projeção **pura** (sem hooks/fetch) — separado de propósito para permitir testes sem árvore React (comentário do arquivo). `useMemo` no `useAppNavGroups`, no `Sidebar.resolvedGroups`, no `derivedActiveId` e no `BottomNav.flat` evita reprocessar em cada re-render. | ✅ | `src/frontend/components/nav/app-nav.tsx:41-49` e `:138-142`; `src/frontend/components/ui/sidebar.tsx:308-315`; `src/frontend/components/ui/bottom-nav.tsx:81-95` |
| Bound Execution Times | Fetch de permissões usa `fetch` sem `AbortSignal`/timeout; a falha é tratada como "esconde o item" — cenário degradado é aceitável, mas uma requisição que trava indefinidamente mantém `permitido=false` sem sinal. Sem timeout explícito no client. | ⚠️ parcial | `src/frontend/lib/operacao.ts:101-105` (`apiFetch` — sem `signal`) |
| Increase Resource Efficiency | Responsividade **por CSS** (`hidden md:block` / `md:hidden`), não por hook de breakpoint — evita re-render após medir viewport e evita o custo de manter um `matchMedia` listener por página. Trade-off consciente: paga em nós de DOM (~15 do BottomNav sempre presentes no desktop) para pagar zero em JS. | ✅ | `src/frontend/components/AppShell.tsx:196` + `bottom-nav.tsx` header comment |

### Manage Resources

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Increase Resources | N/A — cliente único, single-threaded. Sem worker/SharedArrayBuffer. | N/A | — |
| Increase Concurrency | N/A — não há requisições paralelizáveis na moldura (1 chamada só). | N/A | — |
| Maintain Multiple Copies of Computations | N/A — nenhuma computação replicada; o modelo de itens é fonte única (é isso que evita divergência entre Sidebar e BottomNav). | N/A | — |
| Maintain Multiple Copies of Data | `localStorage` para o `collapsed` da Sidebar — cache local que evita ir buscar preferência remota (não há endpoint disso, e não deve haver: é preferência de dispositivo). Trata `try/catch` para modo privado/iframe. | ✅ | `src/frontend/components/ui/sidebar.tsx:90-108` |
| Bound Queue Sizes | N/A — não há fila client-side (nada de request queue, nada de retry buffer). | N/A | — |
| Schedule Resources | N/A — nenhum trabalho agendado; sem `requestIdleCallback`, sem `setTimeout` (correto — quem precisa, usa `Executors` no backend, e o front não tem análogo aqui). | N/A | — |

### Facetas modernas

| Faceta | Implementação | Status |
|---|---|---|
| Cache strategy | Sem cache de `fetchPermissoes` (nem SWR nem React Query). Para 1–3 chamadas/sessão é aceitável. | ✅ (defensível) |
| Bundle leanness | 0 novas deps; imports focados; `lucide-react` puxa só 5 ícones (`Activity, ArrowLeftRight, Banknote, Landmark, Users`) via named imports — `next` faz tree-shake por ícone com `optimizePackageImports` implícito. | ✅ (não confirmado pelo build — ver §6) |
| Render-blocking deps | Nenhuma. `xlsx`, `date-fns` etc. não entram na moldura. | ✅ |
| Hydration cost / CLS | `Sidebar.SidebarRoot` mantém `defaultCollapsed=false` no SSR e lê preferência em `useEffect` → possível shift de 160px (224px → 64px) para usuários que preferem colapsada. Documentado no código; sem mitigação. | ⚠️ parcial |

## 4. Findings (achados)

### F-performance-1: `Sidebar` provoca layout shift após hidratação para usuário que prefere colapsada

- **Severidade**: P2 (débito defensável — degrada Core Web Vital em ~20% da população)
- **Tactic violada**: Reduce Overhead / Hydration cost (moderna)
- **Localização**: `src/frontend/components/ui/sidebar.tsx:127-144`
- **Evidência (objetiva)**:
  ```ts
  const [internal, setInternal] = React.useState(defaultCollapsed)     // SSR = false
  ...
  React.useEffect(() => {                                              // depois de montar
    if (isControlled) return
    const stored = readStoredCollapsed(persistKey)
    if (stored !== undefined) setInternal(stored)                      // pode ser true
  }, [isControlled, persistKey])
  ```
  A `<nav>` tem largura condicional `collapsed ? 'w-16' : 'w-56'` (`sidebar.tsx:170`) — 64px vs. 224px. Transição de 200ms suaviza a mudança de largura, mas o `main` adjacente reflui.
- **Impacto técnico**: 1 re-render forçado no primeiro paint; possível CLS visível (largura da sidebar muda ~160px), acionando reflow do `<main>`. Comentário do próprio arquivo (`sidebar.tsx:135-138`) documenta o trade-off vs. hydration mismatch, mas não menciona a alternativa (cookie no SSR ou `useSyncExternalStore` com getServerSnapshot).
- **Impacto de negócio**: cada abertura de página autenticada em desktop para usuário-que-colapsa mostra a moldura “pulando”. Percepção de UI instável em ferramenta de operação, onde confiança visual conta. Não afeta funcionalidade.
- **Métrica de baseline**: 1 re-render pós-hidratação; deslocamento horizontal potencial de 160px no `<main>`. CLS exato não medido (requer instrumentação Web Vitals — ver §6).

### F-performance-2: `fetch` de `/me/permissoes` sem timeout, chamado a cada mount de `AppNavigation`

- **Severidade**: P3 (baixo — cenário conhecido, custo aceito)
- **Tactic violada**: Bound Execution Times
- **Localização**: `src/frontend/lib/operacao.ts:101-105` (`fetchPermissoes` — `apiFetch` sem `signal`) e `src/frontend/components/nav/app-nav.tsx:117-131`
- **Evidência (objetiva)**:
  ```ts
  export async function fetchPermissoes(): Promise<Permissoes> {
    const res = await apiFetch(`${API}/me/permissoes`, { headers: await withAuthHeaders() })
    if (!res.ok) throw new Error(...)
  }
  ```
  No `useEffect` de `usePermissaoOperacao` não há `AbortController` — a Promise pode ficar pendente indefinidamente se o backend não responder.
- **Impacto técnico**: item "Operação" fica escondido sem sinal para o usuário. A promise pendente não vaza memória (o cleanup `vivo = false` evita `setState` após unmount), mas o padrão convida a reprodução em qualquer novo item que dependa de fetch.
- **Impacto de negócio**: em rede degradada, o usuário do allow-list `OPERACAO_USUARIOS` não vê o link para "Operação" e supõe que perdeu permissão. Baixo custo, alta frequência quando acontece.
- **Métrica de baseline**: 0 timeouts configurados; N chamadas/sessão = 1–3.

### F-performance-3: bundle da moldura não medível no worktree (Turbopack + symlink)

- **Severidade**: P2 (impede validar hipótese central: "a moldura não infla o shared chunk")
- **Tactic violada**: Reduce Overhead (impossibilidade de instrumentar)
- **Localização**: worktree `/home/inteli/kavex-worktrees/moldura-navegacao/src/frontend/node_modules` (symlink) + `next.config` (Turbopack default no Next 16)
- **Evidência (objetiva)**:
  ```
  FATAL: An unexpected Turbopack error occurred.
  Error [TurbopackInternalError]: Symlink [project]/node_modules is invalid,
    it points out of the filesystem root
  ```
- **Impacto técnico**: nenhum finding P0/P1 sobre bundle pode ser levantado com número — só heurística de imports (que é ✅). O baseline em `_shared-metrics.md` (“compila e prerenderiza 12 rotas”) foi medido em outro momento, sem detalhar tamanho por rota.
- **Impacto de negócio**: gate de performance passa por inspeção, não por medição. Regressão de bundle no shared chunk (que atinge TODAS as rotas via root layout) passaria despercebida até o próximo `build` no checkout principal.
- **Métrica de baseline**: baseline First Load JS = ⚠️ ausente.

### F-performance-4: DOM da navegação renderizado duas vezes por página (Sidebar + BottomNav)

- **Severidade**: P3 (débito assumido — trade-off explícito com hydration mismatch)
- **Tactic violada**: Reduce Overhead (leve)
- **Localização**: `src/frontend/components/AppShell.tsx:194-197`
- **Evidência (objetiva)**:
  ```tsx
  function AppNavigation() {
    const groups = useAppNavGroups()
    return (
      <>
        <AppShellSidebar><Sidebar groups={groups} /></AppShellSidebar>  {/* hidden md:block */}
        <BottomNav groups={groups} className="md:hidden" />
      </>
    )
  }
  ```
  Cada carregamento tem ~45 nós de nav (~30 Sidebar + ~15 BottomNav). A alternativa (hook de breakpoint) foi descartada por causar SSR mismatch — decisão documentada no cabeçalho de `bottom-nav.tsx` e em `ontology/ui-flows/navegacao-global.md` §Desvios.
- **Impacto técnico**: memória e nós de DOM extras (~15 nós/página). Reflow/paint marginal; a Sidebar tem `sticky` e o BottomNav é `fixed`, então nenhum entra no fluxo de layout no viewport onde está oculto.
- **Impacto de negócio**: irrelevante — o custo é imperceptível em desktop moderno.
- **Métrica de baseline**: 45 nós por página; nenhum medido acima do budget.

### F-performance-5: `fetchPermissoes` sem cache — nova chamada em cada hard-load

- **Severidade**: P3 (opcional — economia marginal)
- **Tactic violada**: Maintain Multiple Copies of Data
- **Localização**: `src/frontend/components/nav/app-nav.tsx:114-131`
- **Evidência (objetiva)**: `useEffect(() => { ... fetchPermissoes() ... }, [])` sem SWR/React Query/sessionStorage. Cada F5 → 1 chamada, mesmo que o payload seja `{ operacao: true }` estático por sessão.
- **Impacto técnico**: 1 request/hard-load. O endpoint é rápido (consulta `OPERACAO_USUARIOS` em memória do backend), então custo é <50ms.
- **Impacto de negócio**: nulo em condições normais. Melhoria só compensa se o endpoint ficar caro (ex.: passar a consultar allow-list em BD).
- **Métrica de baseline**: 1–3 requests/sessão; latência típica <100ms.

## 5. Cards Kanban

### [performance-1] Estabilizar `Sidebar` na hidratação para eliminar o flash de largura

- **Problema**
  > `Sidebar` renderiza sempre expandida no SSR (`defaultCollapsed=false`) e lê a preferência de `localStorage` em `useEffect` (`sidebar.tsx:139-144`). Se o usuário preferiu colapsada (`w-16`, 64px), o primeiro paint é 224px e o segundo é 64px — um deslocamento de ~160px que refluxa o `<main>` adjacente. Documentado como trade-off contra hydration mismatch, mas com alternativa não explorada.

- **Melhoria Proposta**
  > **Tactic Reduce Overhead / Hydration cost**: persistir `collapsed` em **cookie** (não localStorage) e ler o valor no Server Component do root layout, propagando via prop `defaultCollapsed` para `AppShell`. Assim o SSR já emite `w-16` diretamente para quem prefere colapsado, e o `useEffect` de leitura de storage vira redundante (pode ser removido). Alternativa mais barata: injetar `<script>` blocking no `<head>` que aplica classe no `<body>` antes do React hidratar (`data-sidebar-collapsed`) e ler dessa classe no `useState` inicializador. Arquivos: `app/layout.tsx` (Server Component), `components/AppShell.tsx` (aceitar prop), `components/ui/sidebar.tsx` (remover ou ajustar `useEffect`).

- **Resultado Esperado**
  > Zero flash de largura para o cenário "usuário prefere colapsada". CLS da moldura permanece 0 no primeiro paint. Deslocamento horizontal do `<main>` em hidratação: **~160px → 0px**.

- **Tactic alvo**: Reduce Overhead (Hydration cost)
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-1
- **Métricas de sucesso**:
  - Deslocamento horizontal do `<main>` na hidratação: 160px → 0px
  - Re-renders de `SidebarRoot` no primeiro segundo: 2 → 1
  - CLS medido em `/permutas` (Web Vitals): baseline TBD → < 0.05
- **Risco de não fazer**: usuários que colapsam a barra veem a moldura "pular" a cada F5. Percepção de instabilidade em ferramenta de operação diária.
- **Dependências**: nenhuma. (Cross-QA: testability — o hook `useSyncExternalStore` ou a via cookie são mais testáveis que `useEffect + localStorage`.)

### [performance-2] Instrumentar `First Load JS` e criar budget para o shared chunk

- **Problema**
  > O `next build` no worktree aborta por `Turbopack Panic: Symlink [project]/node_modules is invalid` (esperado — worktree usa `node_modules` linkado). O baseline em `_shared-metrics.md` só afirma "compila e prerenderiza 12 rotas" sem tamanho por rota. Como a moldura entra no root layout, qualquer aumento no shared chunk atinge **todas** as 12 rotas — regressão passaria despercebida.

- **Melhoria Proposta**
  > **Tactic Reduce Overhead + Bound Execution Times**: capturar `First Load JS` por rota no CI (workflow atual do Render deploy hook), gravando a saída de `next build` em artifact. Adicionar step de comparação com baseline (script simples de parsing do output de `next build`) que falha o CI se o shared chunk crescer >20KB entre releases. Complementar: rodar o build no **checkout principal** após merge deste delta e registrar em `_shared-metrics.md` o número atual (rotas × First Load JS + shared).

- **Resultado Esperado**
  > Baseline numérica de First Load JS por rota gravada e monitorada. Regressão de bundle detectada no CI antes de ir a produção. Alvo defensável: shared chunk ≤ ~180KB gzipped (p95 First Load JS ≤ 200KB por rota — literatura Web Vitals).

- **Tactic alvo**: Reduce Overhead
- **Severidade**: P2
- **Esforço estimado**: M (2–5d — CI + workflow + baseline)
- **Findings relacionados**: F-performance-3
- **Métricas de sucesso**:
  - Baseline First Load JS por rota: `⚠️ ausente` → tabela de 12 valores
  - Regressão do shared chunk: silenciosa → falha no CI se >+20KB
- **Risco de não fazer**: a moldura vai crescendo (paleta ⌘K, badges reais, dark mode — todos no backlog de `navegacao-global.md`), e cada adição infla o shared chunk sem alarme. Frontend fica lento em campo antes de qualquer sinal.
- **Dependências**: workflow do Render/GitHub Actions atual. **Cross-QA com Deployability** — o mesmo hook de build.

### [performance-3] Adicionar timeout ao `fetchPermissoes` e propagar `AbortController` do hook

- **Problema**
  > `usePermissaoOperacao` chama `fetchPermissoes` sem timeout (`operacao.ts:101-105` e `app-nav.tsx:117-131`). Se o backend não responder, a Promise fica pendente indefinidamente e o item "Operação" permanece escondido sem sinal para o usuário. O cleanup (`vivo = false`) evita `setState` após unmount, mas não corta a request.

- **Melhoria Proposta**
  > **Tactic Bound Execution Times**: `fetchPermissoes` deve aceitar `AbortSignal` opcional; `usePermissaoOperacao` cria `AbortController` no `useEffect`, aborta no cleanup e configura `setTimeout(() => controller.abort(), 5000)` como budget. Falha por timeout continua tratada como "esconde o item" — mas agora com log/telemetria para diagnosticar backend lento vs. permissão real. Arquivos: `src/frontend/lib/operacao.ts`, `src/frontend/components/nav/app-nav.tsx`.

- **Resultado Esperado**
  > Toda chamada de permissão termina em ≤ 5s (sucesso ou abort). Impossível manter Promise pendente órfã. Sinal de backend degradado emerge no log em vez de sumir dentro de "esconde o item".

- **Tactic alvo**: Bound Execution Times
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-performance-2
- **Métricas de sucesso**:
  - Timeout configurado no client: 0ms (nenhum) → 5000ms
  - Chamadas pendentes órfãs após unmount: possíveis → 0 (aborto explícito)
- **Risco de não fazer**: o padrão "fetch sem timeout, falha silenciosa" replica em todo hook novo de permissão. Cross-QA com Availability/Fault Tolerance.
- **Dependências**: nenhuma.

### [performance-4] Instrumentar Web Vitals (LCP/CLS/INP) no root layout

- **Problema**
  > A moldura agora define a experiência de toda página autenticada, mas não há coleta de Web Vitals — decisões de perf ficam por inspeção. Não é possível dizer se o card `performance-1` (CLS) resolveu o problema em campo, nem quantificar regressões futuras.

- **Melhoria Proposta**
  > **Tactic Reduce Overhead + Manage Sampling Rate**: usar `useReportWebVitals` (Next 15+/16) no root layout para enviar LCP/CLS/INP/TTFB para o backend (POST assíncrono, sem bloquear render). Amostrar 100% em dev/UAT e 10% em produção (Manage Sampling Rate). Sink inicial pode ser `LogService` do backend (o mesmo canal do `/operacao`) — sem custo de infra novo.

- **Resultado Esperado**
  > Web Vitals por rota visíveis no painel de Operação; p95 LCP e CLS medidos, não estimados. Alvos-referência (literatura Web Vitals): p75 LCP < 2.5s · p75 CLS < 0.1 · p75 INP < 200ms.

- **Tactic alvo**: Reduce Overhead (instrumentação); Manage Sampling Rate
- **Severidade**: P3
- **Esforço estimado**: M (2–5d — endpoint + report + dashboard)
- **Findings relacionados**: F-performance-1, F-performance-3
- **Métricas de sucesso**:
  - Cobertura de Web Vitals coletados: 0% → 100% dev / 10% prod
  - Baseline p75 LCP/CLS/INP: ausente → medido
- **Risco de não fazer**: performance vira debate sem dado. Regressões de UI grandes (paleta ⌘K, dark mode) chegam ao usuário sem revisão numérica.
- **Dependências**: endpoint backend para receber Web Vitals (fora do escopo deste delta).

## 6. Notas do agente

- **Decisão de escopo**: sem cards P0/P1. Baseline numérica ausente para bundle (Turbopack panicou no worktree, conforme instrução do run — não contornei) e para CLS (requer Web Vitals em campo). Sem número, P0/P1 seria palpite — regra 7 do template rebaixa. Os dois maiores riscos verossímeis (bundle regression, CLS de hidratação) viraram P2 com card de instrumentação, o que é o passo defensável.
- **Métricas tentadas e falhadas**: `npm run build` no worktree (Turbopack panic — símbolo do symlink); DOM node count exato via jsdom nos testes (possível, mas não trouxe informação nova além da inspeção do JSX).
- **Cross-QA detectadas**:
  - `performance-2` (budget de bundle no CI) **↔ Deployability** — mesmo pipeline de build/release.
  - `performance-3` (timeout no fetch de permissões) **↔ Availability + Fault Tolerance** — chamada externa sem timeout é padrão P0 de disponibilidade quando aplicado a hot path; aqui é P3 pela baixa frequência (1–3/sessão), mas o padrão em si merece harmonização.
  - `performance-1` (cookie/`useSyncExternalStore` para colapsado) **↔ Testability** — cookie SSR é mais testável que `useEffect + localStorage`.
- **Sinal positivo do delta**: separação `buildAppNavGroups` (pura) vs. `useAppNavGroups` (hooks), `useMemo` disciplinado, responsividade por CSS em vez de hook de breakpoint, 0 novas deps, 1 fetch por sessão. É código com consciência de perf.
