---
qa: Availability
qa_slug: availability
run_id: 2026-09-03-1913-moldura-navegacao
agent: qa-availability
generated_at: 2026-09-03T19:35:00-03:00
scope: frontend
score: 8
findings_count: 5
cards_count: 3
---

# Availability — Regis-Review

> Escopo restrito ao delta `moldura-navegacao` (commit 05606a6, frontend puro). Backend, infra
> AWS, DLQs, executors e alarmes CloudWatch são **fora de escopo** — o delta não os toca e este
> repositório não tem `infra/` (deploy Render, ver `CLAUDE.md` §Estado Atual vs. Alvo). Onde a
> taxonomia clássica de Bass depende de infra distribuída (Ping/Echo, Heartbeat, Voting,
> Redundância ativa/passiva), marquei `N/A` com justificativa — é uma revisão de disponibilidade
> **percebida na moldura**, não da plataforma como um todo.

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Usuário autenticado abre `/permutas` no Chrome (desktop) e no Safari mobile; sessão pode estar prestes a expirar; `localStorage` pode estar bloqueado (modo privado) | Boot da app com token válido; `GET /me/permissoes` lento/off; token expira em background; storage bloqueado | `AppShell`, `Sidebar`, `BottomNav`, `AppNavigation` (`useAppNavGroups` → `fetchPermissoes`) | Runtime normal do navegador; SPA Next.js sobre HTML prerenderizado estático | A moldura carrega, o main content é acessível pelo skip link, a sessão expirada dispara o modal e limpa o token, o item de Operação **falha fechada** se a permissão não resolve, o colapso da sidebar cai no default se storage não escreve | 0% de tela branca; 100% dos caminhos de I/O externo da moldura tratam exceção; MTTR percebido de sessão morta ≤ 1 clique (modal → `/login`) |

Cenário concreto: analista autenticado abre `/permutas` no início do dia. O `AuthProvider` ainda
está lendo o token do `localStorage` (o `useEffect` que hidrata roda pós-mount) → `authenticated`
começa `false` → a moldura renderiza **sem nav**. Tick seguinte: `authenticated=true` → `AppNavigation`
monta → `fetchPermissoes()` dispara. Se o endpoint demora, o item de Operação fica escondido (falha
fechada, correto); se devolve 401, `apiFetch` emite `emitSessionExpired`, o modal aparece, o token é
descartado e o próximo click leva a `/login`. Nada disso é P0 — mas há um **flash sem sidebar** no
boot e nenhum `ErrorBoundary` para conter um throw no meio do render da moldura.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Cobertura de linhas — `components/AppShell.tsx` | 97.87% | ≥90% (moldura crítica) | ✅ | `_shared-metrics.md` §Cobertura |
| Cobertura de linhas — `components/ui/sidebar.tsx` | 94.64% | ≥90% | ✅ | idem |
| Cobertura de linhas — `components/nav/app-nav.tsx` | 100% | ≥90% | ✅ | idem |
| Cobertura de linhas — `components/ui/bottom-nav.tsx` | 80.95% | ≥90% | ⚠️ | idem |
| Exception handling em I/O externo do delta | 2/2 (100%) — `fetchPermissoes` (`app-nav.tsx:134`) e `localStorage` (`sidebar.tsx:91-108`) | 100% | ✅ | `grep -n "catch" src/frontend/components/nav/app-nav.tsx src/frontend/components/ui/sidebar.tsx` |
| Testes explícitos de degradation da moldura | 2 — "localStorage bloqueado" (`sidebar.test.tsx:162`) e "permissão rejeitada mantém Operação escondida" (`app-nav.test.tsx:114`) | ≥2 | ✅ | ambos os arquivos de teste |
| ErrorBoundary envolvendo `AppShell` / `AppNavigation` | 0 (nenhum `ErrorBoundary`, `error.tsx` ou `global-error.tsx` no repo) | ≥1 (fallback minimalista) | ❌ | `grep -rn "ErrorBoundary\|error\.tsx" src/frontend/app src/frontend/components` → vazio |
| Timeout / `AbortController` em `fetchPermissoes` | 0 (fetch cru; sem `AbortSignal`, sem timeout, sem retry) | timeout explícito | ❌ | `src/frontend/lib/operacao.ts:101-105`, `src/frontend/components/nav/app-nav.tsx:128-140` |
| Retry / backoff no `fetchPermissoes` | 0 tentativas | 1 retry com backoff | ⚠️ | idem |
| Uso do `loading` de `useIsAuthenticated()` no `AppShell` | 0 — só ramifica em `authenticated` (`AppShell.tsx:252`, `:280`) | tratar `loading` para evitar flash sem nav | ⚠️ | `grep -n "loading" src/frontend/components/AppShell.tsx` → vazio |
| Rotas prerenderizadas estáticas (moldura sobrevive a backend caído) | 10 (todas as rotas do app) | 100% | ✅ | `_shared-metrics.md` §Rotas |
| State Resynchronization em 401 | presente — `apiFetch` (`lib/http.ts:30-33`) emite `emitSessionExpired`; `AuthProvider.notifySessionExpired` (`AuthProvider.tsx:84-108`) descarta token e abre modal; `SessionExpiredModal` chama `signOut()` | mecanismo consciente | ✅ | grep + leitura direta |
| Warnings novos de lint que sinalizam risco de re-render | 1 (`sidebar.tsx:142` — `react-hooks/set-state-in-effect` no hidratador de colapso) | 0 (ou justificativa) | ⚠️ | `_shared-metrics.md` §Gates |

> ⚠️ **Não medível localmente**: latência p95/p99 de `GET /me/permissoes` em produção. Sem telemetria
> RUM (Real User Monitoring) o custo real do "item de Operação escondido por N ms" é palpite.
> Recomendação: instrumentar contador simples de duração `fetchPermissoes` no `AppNavigation` e
> reportar via `console.timeEnd`/beacon quando houver observabilidade frontend (hoje inexistente).

> ⚠️ **Não medível localmente**: MTTR real de recuperação de 401 (do momento do primeiro request
> rejeitado até `/login` reaparecer). Requer sessão de produção instrumentada. Recomendação:
> instrumentar `emitSessionExpired` → `SessionExpiredModal` open → `signOut` como três marcos e
> mandar a duração para o backend quando o painel de Operação passar a ter métricas de UX.

> ⚠️ **Não medível localmente**: CloudWatch / alarmes de infra — `infra/` não existe (deploy Render).
> Ver `CLAUDE.md` §Estado Atual vs. Alvo. Não confundir com o item **Operação** da própria moldura
> (que é UI, não infra).

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Ping/Echo** | Nenhum ping do front para o próprio API. Existe `ConexosStatusBanner` (`components/auth/ConexosStatusBanner.tsx`) que exibe saúde do vínculo Conexos consultada via backend, mas não pinga o próprio backend | ⚠️ parcial | `AppShell.tsx:277` — banner montado, mas cobre só vínculo Conexos |
| **Heartbeat** | N/A — SPA cliente, não há canal persistente para heartbeat na moldura | N/A | — |
| **Monitor** | `ConexosStatusBanner` monitora status do ERP; nada monitora saúde do próprio API a partir do frontend | ⚠️ parcial | `AppShell.tsx:277` |
| **Timestamp** | N/A — moldura sem ordenação distribuída de eventos | N/A | — |
| **Sanity Checking** | `resolveActiveItemId` valida `pathname != null` e casa por maior especificidade (`sidebar.tsx:47-67`); `RouteGate` usa `usePathname() ?? ''` — falha fechada (`RouteGate.tsx:21`); `login/page.tsx` usa `searchParams?.get(...) \|\| '/'`; teste "não confunde prefixo de segmento" (`sidebar.test.tsx:190`) fixa a regra | ✅ presente | citados |
| **Condition Monitoring** | N/A na moldura | N/A | — |
| **Voting** | N/A — não há redundância replicada nesta camada | N/A | — |
| **Exception Detection** | `apiFetch` detecta 401 e emite `emitSessionExpired` (`lib/http.ts:30-33`); `AuthProvider` bridge-a com `registerSessionExpiredHandler` (`AuthProvider.tsx:117-120`); outros HTTP errors bubblam como `Error` genérico | ✅ presente | `lib/http.ts:28-35`, `AuthProvider.tsx:84-108` |
| **Self-Test** | N/A na moldura | N/A | — |
| **Active Redundancy** | N/A — front cliente | N/A | — |
| **Passive Redundancy** | N/A — front cliente | N/A | — |
| **Spare** | N/A — front cliente | N/A | — |
| **Exception Handling** | `fetchPermissoes().catch(() => setPermitido(false))` em `app-nav.tsx:134-137` (falha fechada da permissão); `try/catch` em `readStoredCollapsed`/`writeStoredCollapsed` em `sidebar.tsx:91-108` (localStorage bloqueado); ambos com teste explícito | ✅ presente | citados |
| **Rollback** | N/A — moldura stateless; a única "rollback" é o `signOut()` disparado por 401 | N/A | — |
| **Software Upgrade** | N/A — moldura versionada com o app; sem hot-reload em prod | N/A | — |
| **Retry** | Ausente. `fetchPermissoes` roda uma vez no mount do `AppNavigation` e nunca retenta. Sem backoff, sem circuit breaker | ❌ ausente | `app-nav.tsx:128-140` |
| **Ignore Faulty Behavior** | `writeStoredCollapsed` engole a exceção e segue com estado só de sessão (`sidebar.tsx:102-108`); mesma coisa no read | ✅ presente | `sidebar.tsx:91-108` |
| **Degradation** | Permissão ausente esconde o item (`app-nav.tsx` `hidden`); `localStorage` bloqueado cai no default de sessão. **Faltando**: `BottomNav` retorna `null` silenciosamente quando `flat.length===0` — usuário mobile sem items perde toda a nav sem mensagem | ⚠️ parcial | `bottom-nav.tsx:99`, `app-nav.tsx:38-118`, `sidebar.tsx:91-108` |
| **Reconfiguration** | N/A na moldura | N/A | — |
| **Shadow** | N/A — não há substituição de componente sob falha | N/A | — |
| **State Resynchronization** | `emitSessionExpired` → `notifySessionExpired` descarta token do `localStorage` (`AuthProvider.tsx:100-106`) e abre `SessionExpiredModal`; `signOut()` sincroniza `token=null`, `username=null`, `conexosStatus=null` para o estado inicial | ✅ presente | `AuthProvider.tsx:84-108`, `SessionExpiredModal.tsx` |
| **Escalating Restart** | N/A — o browser é o "restart" (F5); moldura não força reload | N/A | — |
| **Non-Stop Forwarding** | N/A — front cliente | N/A | — |
| **Removal from Service** | N/A na moldura | N/A | — |
| **Transactions** | N/A — moldura não escreve nada de negócio | N/A | — |
| **Predictive Model** | Ausente. Não há timer proativo para detectar `fetchPermissoes` que passa de X ms. (Nota: `AuthProvider` **tem** proactive path para `exp` do JWT em `AuthProvider.tsx:124-131`, o que conta como Predictive para expiração de sessão) | ⚠️ parcial (só para sessão) | `AuthProvider.tsx:124-131` |
| **Exception Prevention** | `usePathname() ?? ''` (`RouteGate.tsx:21`); `useSearchParams()?.get(...) \|\| '/'` (`login/page.tsx:23-25`); `if (!ctx) throw` em `useSidebarContext` (`sidebar.tsx:84-88`); hidratação de `collapsed` movida para `useEffect` para evitar hydration mismatch (`sidebar.tsx:139-143`, com comentário explicando) | ✅ presente | citados |
| **Increase Competence Set** | Testes cobrem casos degenerados: localStorage bloqueado, permissão rejeitada, prefixo de rota similar, item hidden, sub-rota, badge=0/≥100. 233 testes verdes, 30 suítes (`_shared-metrics.md`) | ✅ presente | `_shared-metrics.md` §Gates |

## 4. Findings (achados)

### F-availability-1: `fetchPermissoes` roda sem timeout, sem `AbortController` e sem retry

- **Severidade**: P2 (débito técnico defensável — não há incidente relatado; sem telemetria de latência para escalar)
- **Tactic violada**: Retry, Predictive Model (só para esta chamada)
- **Localização**: `src/frontend/lib/operacao.ts:101-105`, `src/frontend/components/nav/app-nav.tsx:128-140`
- **Evidência (objetiva)**:
  ```ts
  // app-nav.tsx:128
  React.useEffect(() => {
    let vivo = true
    void fetchPermissoes()
      .then((p) => { if (vivo) setPermitido(p.operacao) })
      .catch(() => { if (vivo) setPermitido(false) })
    return () => { vivo = false }
  }, [])

  // operacao.ts:101
  export async function fetchPermissoes(): Promise<Permissoes> {
    const res = await apiFetch(`${API}/me/permissoes`, { headers: await withAuthHeaders() })
    if (!res.ok) throw new Error(`Falha ao consultar permissões (HTTP ${res.status}).`)
    return (await res.json()) as Permissoes
  }
  ```
  Nenhum `AbortSignal`, nenhum `signal: AbortSignal.timeout(...)`, nenhuma retentativa. O `vivo`
  flag só protege `setPermitido` contra unmount — a rede continua rodando até o browser cortar.
- **Impacto técnico**: um `/me/permissoes` lento (10s+) ou intermitente deixa o item Operação
  escondido pela sessão inteira. Um usuário que tem permissão só recupera a nav ao fazer F5. Sem
  timeout, um request pendurado consome uma conexão HTTP/1.1 até o navegador estourar (~5min).
- **Impacto de negócio**: usuário do painel de Operação não encontra o item de menu quando a rede
  vacila; abre chamado dizendo "sumiu"; suporte gasta tempo diagnosticando o que é intermitência
  de backend.
- **Métrica de baseline**: 0 retries, 0 ms timeout explícito, 0 `AbortController`. Latência real do
  endpoint **não medível localmente** (sem RUM).

### F-availability-2: nenhum `ErrorBoundary` envolve a moldura

- **Severidade**: P2 (não há erro conhecido que dispare; é rede de segurança contra regressão)
- **Tactic violada**: Exception Handling (nível de árvore React)
- **Localização**: `src/frontend/app/layout.tsx`, `src/frontend/components/AppShell.tsx`
- **Evidência (objetiva)**:
  ```
  $ grep -rn "ErrorBoundary\|error\.tsx\|global-error" src/frontend/app src/frontend/components
  (vazio)
  ```
  Nem `app/error.tsx` (rota-level, Next.js), nem `app/global-error.tsx`, nem um `<ErrorBoundary>`
  componente. Um throw em qualquer descendente do `AppShell` (ex.: `Sidebar` recebendo `groups`
  com ciclo, `NavItem` com prop malformada, `ConexosStatusBanner` com resposta inesperada)
  propaga até o topo e a rota inteira quebra.
- **Impacto técnico**: qualquer regressão em componente da moldura (ou dado inesperado do
  backend em `fetchConexosStatus`) tira o app do ar em vez de degradar a região com falha. O
  Next.js dev mostra overlay; em prod, tela branca.
- **Impacto de negócio**: falha localizada em um componente periférico (ex.: badge com valor
  inesperado) potencialmente derruba toda a sessão do usuário até F5.
- **Métrica de baseline**: 0 boundaries em toda a árvore do frontend (`grep` acima). Delta
  adiciona 5 arquivos novos de UI (900+ LOC) sem cobertura de boundary.

### F-availability-3: `AppShell` ignora o `loading` do `useIsAuthenticated`, causando flash sem navegação

- **Severidade**: P3 (cosmético; visível por um tick no boot)
- **Tactic violada**: Sanity Checking (parcial)
- **Localização**: `src/frontend/components/AppShell.tsx:252`, `:280`
- **Evidência (objetiva)**:
  ```tsx
  // AppShell.tsx:252
  const { authenticated } = useIsAuthenticated()   // ignora `loading`
  ...
  // AppShell.tsx:280
  {authenticated ? <AppNavigation /> : null}
  ```
  Em `AuthProvider.tsx:73-82`, o token é lido do `localStorage` num `useEffect` (portanto, post-mount),
  o que significa que o primeiro render tem `token=null` e `authenticated=false`. Só no segundo
  render `authenticated` vira `true` e a nav monta. O usuário vê a moldura sem sidebar por um tick.
- **Impacto técnico**: layout thrash — o `main` ocupa a largura inteira e depois é empurrado para
  a direita quando a sidebar aparece. Sem CLS instrumentado, não sei o peso real, mas o thrash é
  observável em `useEffect` de teste.
- **Impacto de negócio**: percepção de app "lento" ou "trocando de tela sozinho". Nada que gere
  chamado, mas fica atrás do polido esperado do design system.
- **Métrica de baseline**: 0 tratamento de `loading` no `AppShell` (`grep -n "loading" AppShell.tsx`
  vazio). `useIsAuthenticated` já expõe `loading` mas o consumidor não usa.

### F-availability-4: `BottomNav` retorna `null` silenciosamente quando não há items

- **Severidade**: P3 (baixo — o caminho só existe se todos os `hidden` baterem, o que exige um
  usuário sem SISPAG, sem admin e sem Operação; ainda assim, Frentes/Permutas e Adiantamentos são
  sempre visíveis por `app-nav.tsx:47-87` → `flat.length===0` na prática só acontece se
  `groups`/`items` chegar vazio por regressão)
- **Tactic violada**: Degradation
- **Localização**: `src/frontend/components/ui/bottom-nav.tsx:99`
- **Evidência (objetiva)**:
  ```tsx
  if (flat.length === 0) return null
  ```
  Sem mensagem, sem fallback, sem hint. Se por regressão o modelo chegar vazio, o usuário mobile
  fica **sem qualquer navegação** — a única saída é o botão voltar do navegador (exatamente o
  problema que a feature veio resolver).
- **Impacto técnico**: uma regressão em `buildAppNavGroups` (ex.: filtro que zera tudo) some com a
  BottomNav sem sinal. O `AppNavigation` monta a `<Sidebar>` no desktop (rótulos de grupo sem
  items ficam ocultos por `sidebar.tsx:365-368`), o que produz o mesmo silêncio.
- **Impacto de negócio**: em um cenário de multi-tenant futuro onde um cliente tem só uma frente
  ativa, uma regressão de gating vira "sumiu a nav" sem trilha de diagnóstico.
- **Métrica de baseline**: 0 mensagens de fallback quando `flat.length===0` (código citado).

### F-availability-5: `sidebar.tsx:142` — warning `react-hooks/set-state-in-effect` (novo)

- **Severidade**: P3 (o linter sinaliza; comentário explica que o setState em effect é intencional
  para evitar hydration mismatch; risco real de loop é baixo por o effect depender só de
  `[isControlled, persistKey]` estáveis)
- **Tactic violada**: Sanity Checking (linter identifica padrão de risco)
- **Localização**: `src/frontend/components/ui/sidebar.tsx:139-143`
- **Evidência (objetiva)**:
  ```tsx
  React.useEffect(() => {
    if (isControlled) return
    const stored = readStoredCollapsed(persistKey)
    if (stored !== undefined) setInternal(stored)   // ← warning aqui (linha 142)
  }, [isControlled, persistKey])
  ```
  `_shared-metrics.md` confirma: "18 warnings, 0 errors (13 arquivos; 12 pré-existentes +
  `sidebar.tsx:142`, todos da regra `react-hooks/set-state-in-effect`)".
- **Impacto técnico**: se `persistKey` mudar por render (ex.: alguém passar `` `ds:...:${id}` ``
  computado inline), o effect dispara em loop com setState. Baixo, mas real.
- **Impacto de negócio**: pouco — o gatilho seria uma mudança futura, não o código atual.
- **Métrica de baseline**: 1 warning novo introduzido pelo delta (fonte: `_shared-metrics.md`).

## 5. Cards Kanban

### [availability-1] Envolver a moldura em `ErrorBoundary` com fallback minimalista

- **Problema**
  > Nenhum `ErrorBoundary` (nem `app/error.tsx`, nem `global-error.tsx`) protege `AppShell` ou seus
  > descendentes. Um throw em qualquer componente da moldura — Sidebar, NavItem, ConexosStatusBanner,
  > UserMenu — propaga até a raiz e o app fica em tela branca em produção. O delta acrescentou
  > ~900 LOC de UI de moldura sem essa rede de segurança.

- **Melhoria Proposta**
  > Adicionar `src/frontend/app/error.tsx` (route-level ErrorBoundary do Next.js) com fallback
  > mínimo: um título "Algo deu errado nesta tela" + botão "Recarregar" + link para `/`. Se
  > possível, um `ErrorBoundary` **também** em torno de `<AppNavigation>` dentro do `AppShell` para
  > isolar falhas da nav do restante do main. Tactic Bass: **Exception Handling** (nível React
  > tree).

- **Resultado Esperado**
  > Uma exceção em componente da moldura degrada a região com falha em vez de derrubar a página.
  > Métrica: 0 → ≥1 `ErrorBoundary` em `app/`; regressão futura em `NavItem` passa a mostrar
  > fallback em vez de tela branca.

- **Tactic alvo**: Exception Handling
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-2
- **Métricas de sucesso**:
  - `ErrorBoundary` na moldura: 0 → 1
  - Rotas com fallback de erro: 0/10 → 10/10
- **Risco de não fazer**: qualquer regressão em componente periférico (por exemplo, um badge
  recebendo `NaN`, um `useAppNavGroups` que joga por dado inesperado) tira o app do ar até o
  usuário dar F5. Em 6 meses, com mais consumidores da moldura, a probabilidade só cresce.
- **Dependências**: nenhuma.

### [availability-2] Dar timeout, abort e um retry ao `fetchPermissoes`

- **Problema**
  > `fetchPermissoes()` roda uma vez no mount do `AppNavigation`, sem `AbortController`, sem
  > timeout e sem retry (`app-nav.tsx:128-140`, `operacao.ts:101-105`). Um endpoint intermitente
  > (ou lento) deixa o item Operação escondido pela sessão inteira; um request pendurado consome
  > conexão HTTP até o browser cortar. A política de "falha fechada" está correta — o problema é
  > não dar chance de reabrir.

- **Melhoria Proposta**
  > 1. Passar `signal: AbortSignal.timeout(3000)` ao `fetch` dentro de `apiFetch` (ou usar
  >    `AbortController` + `setTimeout(3s)`; browsers antigos exigem o fallback).
  > 2. Envolver `fetchPermissoes` com 1 retry com backoff curto (500 ms) em erros de rede ou 5xx —
  >    não em 401 (esse já dispara `emitSessionExpired`, não faz sentido retentar).
  > 3. Encadear `AbortController` do `useEffect` no cleanup do `usePermissaoOperacao` para cortar
  >    a rede em unmount (não só o `vivo` flag).
  > Tactic Bass: **Retry** + **Predictive Model** (timeout como orçamento).

- **Resultado Esperado**
  > Uma queda transitória de rede não penaliza o usuário pela sessão inteira. Métrica: 0 retries →
  > 1 retry com backoff; timeout implícito (~5min) → 3s explícito.

- **Tactic alvo**: Retry, Predictive Model
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-1
- **Métricas de sucesso**:
  - `AbortSignal`/timeout em `fetchPermissoes`: ausente → 3s
  - Retries em erro transitório: 0 → 1
  - Duração máxima de request pendurado no navegador: ~5min → 3s
- **Risco de não fazer**: usuários de Operação que caem em rede vacilante aparecem escondidos do
  próprio painel de Operação; suporte diagnostica errado ("sumiu a permissão"), o time gasta hora
  reproduzindo o que é rede.
- **Dependências**: nenhuma. Se este card for adotado antes do [availability-1], vale documentar
  que timeout gera `AbortError` — o boundary do outro card precisa saber que essa exceção é
  esperada e não deve fazer log de alarme.

### [availability-3] Consumir `loading` do `useIsAuthenticated` no `AppShell` para evitar flash sem nav

- **Problema**
  > `AppShell` só olha `authenticated` (`AppShell.tsx:252`, `:280`). No primeiro render após
  > montar, `AuthProvider` ainda não leu o token do `localStorage` (isso acontece em `useEffect`
  > pós-mount), então `authenticated=false` → a moldura renderiza **sem sidebar**. No render
  > seguinte a nav aparece e empurra o main — layout thrash visível.

- **Melhoria Proposta**
  > Destructurar `loading` também e, em `loading=true`, renderizar a moldura com um placeholder de
  > sidebar (mesma largura, `aria-busy="true"`, skeleton opcional) em vez de nada. Alternativa
  > mais simples: `{authenticated || loading ? <AppNavigation /> : null}` — assume "vai autenticar"
  > enquanto resolve, e o `AppNavigation` que já falha fechada em cada consulta. Tactic Bass:
  > **Sanity Checking** (checar o estado antes de decidir o layout).

- **Resultado Esperado**
  > O boot da app não pisca "sem nav → com nav". A largura do `main` é estável desde o primeiro
  > frame. Métrica: 0 tratamento de `loading` → ramo explícito; Cumulative Layout Shift no boot
  > percebido ≈ 0.

- **Tactic alvo**: Sanity Checking
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-availability-3
- **Métricas de sucesso**:
  - Uso do `loading` no `AppShell`: 0 → 1
  - Reservar largura da sidebar no primeiro render (visual): não → sim
- **Risco de não fazer**: sensação de "app trocando de tela sozinho" no login e em F5; nada
  disparaqueixa formal, mas é dívida de polish que o design system explicitamente evita em outros
  lugares (ver `docs/design-system/layout.md`).
- **Dependências**: nenhuma.

## 6. Notas do agente

- Escopo: mantive foco na **disponibilidade percebida na moldura**. Bass tactics de infra
  (Ping/Echo, Redundância, Voting, Escalating Restart) foram declaradas `N/A` com justificativa —
  o delta é frontend e o repo não tem `infra/`. Não inflar tabela com "❌ ausente" para tactics
  irrelevantes: seria ruído para quem lê o Kanban.
- F-availability-4 (BottomNav vazio) e F-availability-5 (warning do linter) ficaram como P3 sem
  card dedicado — ambos são mitigações que cabem no próximo `/feature-tweak` que tocar esses
  arquivos. Se o consolidator preferir empacotar, os dois cabem num card "hardening da moldura".
- Métricas de latência (`fetchPermissoes`, MTTR de 401) declaradas explicitamente não-medíveis;
  não coloquei número inventado. Sem RUM instrumentado, qualquer número seria palpite.
- Cross-QA: F-availability-2 (ErrorBoundary) e F-availability-3 (flash sem nav) provavelmente
  aparecem também em **testability** (falta de teste para erro renderizado) e **modifiability**
  (ausência de contrato de fallback dificulta refactor da nav). Sinal ao consolidator.
