---
qa: Integrability
qa_slug: integrability
run_id: 2026-09-03-1913-moldura-navegacao
agent: qa-integrability
generated_at: 2026-09-03T19:13:00-03:00
scope: frontend
score: 7
findings_count: 4
cards_count: 4
---

# Integrability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao nf-projects)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time de produto | Acréscimo de uma **4ª frente** (nova rota, novo gating de visibilidade) à moldura de navegação | `components/nav/app-nav.tsx` (modelo de itens), consumido por `Sidebar` (desktop) e `BottomNav` (mobile) | Runtime (Next.js App Router) e build-time (Vercel — `NEXT_PUBLIC_*` assadas no bundle) | Acrescentar 1 item ao array e, se houver novo mecanismo de permissão, 1 campo em `AppNavPermissions` + 1 hook em `useAppNavGroups`; o restante da moldura não é tocado | **≤ 1 arquivo tocado** para a 4ª frente reutilizando um gate existente; **≤ 3 arquivos** se introduzir um novo gate; **0** arquivos de UI (Sidebar/BottomNav/AppShell) tocados |

Cenário complementar (upgrade): o backend altera o shape de `GET /me/permissoes` (ex.: quebra `operacao: boolean` em `{ operacao: { enabled, motivo } }`). **Hoje** a assinatura `(await res.json()) as Permissoes` em `lib/operacao.ts:102` não valida em runtime — a mudança falha em silêncio (item some) e o defeito aparece na sidebar, não na chamada.

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| Arquivos do delta que centralizam o **modelo de navegação** | 1 (`components/nav/app-nav.tsx`) | 1 | ✅ | `src/frontend/components/nav/app-nav.tsx:29-116` (`buildAppNavGroups`) |
| Custo marginal — **4ª frente reutilizando gate existente** | 1 arquivo, ~15 LOC (1 objeto no array `Frentes`) | ≤ 1 arquivo | ✅ | forma de `SidebarGroup[]` em `app-nav.tsx:47-92` |
| Custo marginal — **4ª frente com novo mecanismo de gate** | 3 arquivos: `app-nav.tsx` (+1 campo em `AppNavPermissions` + 1 hook + 1 bind) e provavelmente `lib/*` (fonte) e `AuthProvider`/`features.ts` | ≤ 3 arquivos | ✅ | `AppNavPermissions` em `app-nav.tsx:29-33`; padrão em `usePermissaoOperacao` `app-nav.tsx:121-140` |
| Mecanismos heterogêneos de gating **coexistindo** no mesmo modelo | 3 (env `NEXT_PUBLIC_*` build-time, HTTP runtime, claim JWT) | ≤ 3 desde que documentados | ⚠️ | `app-nav.tsx:6-8` + `lib/features.ts:11-17`, `lib/operacao.ts:101-104`, `lib/auth/AuthProvider.tsx:237-239` |
| Encapsulamento da regra: separação **dados → projeção pura** | Presente (`buildAppNavGroups` é função pura sem hooks) | Presente | ✅ | `app-nav.tsx:39-116` |
| Fontes de verdade para uma **rota de frente** (ex.: `/permutas`) | 5: (a) folder `app/permutas/`, (b) `app-nav.tsx:52`, (c) `app/page.tsx:36`, (d) `app/permutas/clientes-filtro/page.tsx:180`, (e) `app/permutas/BorderosPanel.tsx:301` | ≤ 2 (folder + módulo de rotas) | ⚠️ | `grep -rn "'/permutas'" src/frontend` — 5 ocorrências fora de teste |
| Fontes de verdade para uma **subrota** (`/permutas/borderos`) | 3: folder + `app-nav.tsx:58` + `app/permutas/page.tsx:665` + `ReconciliarDialog.tsx:119` = 4 no total | ≤ 2 | ⚠️ | idem |
| Validação de contrato **client ↔ backend** (`/me/permissoes`) | 0 (cast direto `as Permissoes`) | Zod ou equivalente em fetcher da moldura | ⚠️ | `src/frontend/lib/operacao.ts:102` |
| Duplicação do adaptador `fetchPermissoes` no frontend | 2 (`app-nav.tsx:121-140` e `components/home/OperacaoHomeCard.tsx:29`) | 1 hook compartilhado | ⚠️ | `grep -rn fetchPermissoes src/frontend` |
| Contrato "único `aria-current` por vez" testado por caso real | Sim (`sidebar.test.tsx` cobre pai-com-filho-ativo) | Sim | ✅ | `resolveActiveItemId` em `sidebar.tsx:41-63` + `sidebar.test.tsx` |
| Acoplamento rota↔item ativo | Prefix match (`pathname === href \|\| pathname.startsWith(\`${href}/\`)`) — coeso e testado | Testado | ✅ | `sidebar.tsx:33-34` |
| Aderência à spec do design system (`docs/design-system/sidebar.md` + `layout.md`) — desvios | 6, todos deliberados e registrados em `ontology/ui-flows/navegacao-global.md` | 100% registrados | ✅ | `ontology/ui-flows/navegacao-global.md` §Desvios |
| API pública do `AppShell` (subcomponentes exportados) | 6 (`Header`, `Logo`, `EnvBadge`, `HeaderActions`, `Sidebar`, `Main`) — bate com a lista da spec | igual à spec | ✅ | `AppShell.tsx:275-281` vs `docs/design-system/layout.md` §Subcomponentes |
| Infra (Terraform / tenants) | ⚠️ **Não medível** — não existe `infra/` no repositório (deploy via Render hook; ver CLAUDE.md §Estado Atual vs. Alvo). Fora do delta. | — | ⚠️ | `_shared-metrics.md` §Infra |
| Backend do delta | Não tocado. Este QA se restringe à moldura de UI. | — | — | `_shared-metrics.md` §Delta |

## 3. Tactics — Cobertura no nf-projects

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| Encapsulate | Modelo de navegação centralizado em `buildAppNavGroups` (função pura) + `useAppNavGroups` (adaptador). A moldura (`AppShell`, `Sidebar`, `BottomNav`) consome apenas `SidebarGroup[]`. | ✅ presente | `components/nav/app-nav.tsx:39-116`; `AppShell.tsx:213-221` (só instancia `Sidebar` e `BottomNav` com `groups`) |
| Use an Intermediary | `SidebarGroup[]` é o intermediário entre 3 fontes heterogêneas de permissão (env build-time, HTTP, JWT) e dois desenhos (`Sidebar`, `BottomNav`). Os desenhos não conhecem as fontes. | ✅ presente | `bottom-nav.tsx:79-89` reutiliza `resolveActiveItemId` da sidebar |
| Restrict Communication Paths | `AppNavPermissions` é a única superfície pela qual permissões entram no builder. A moldura de UI nunca chama `fetchPermissoes`/`isSispagEnabled`/`useIsAdmin` diretamente. | ✅ presente | `app-nav.tsx:29-33` |
| Adhere to Standards | Aderência à spec do design system em `docs/design-system/sidebar.md` (API `<Sidebar>`, forma compound, badges, `ds:sidebar:collapsed:v1`) e `layout.md` (`AppShell.Header/.Logo/.EnvBadge/.HeaderActions/.Sidebar/.Main`). Divergências deliberadas listadas em `ontology/ui-flows/navegacao-global.md`. | ✅ presente | `sidebar.tsx:20-32` (justificativa da extensão `groups`) |
| Abstract Common Services | `resolveActiveItemId` compartilhado entre `Sidebar` e `BottomNav`; `formatNavBadgeCount` compartilhado entre `NavItem` e `BottomNav`. Persistência do colapso é uma função (`readStoredCollapsed`/`writeStoredCollapsed`) tolerante a falha. | ✅ presente | `bottom-nav.tsx:6-7`, `sidebar.tsx:41-63`, `sidebar.tsx:93-108` |
| Discover Service | N/A — moldura estática (não descobre módulos em runtime). O modelo é literal. | N/A | Contexto de navegação — não faz sentido. |
| Tailor Interface | `Sidebar` expõe forma direta (`items` OU `groups`) e forma compound (`Sidebar.Root`/`.Header`/`.Nav`/`.Item`/`.Footer`/`.CollapseToggle`). Compatível com a spec e com o consumo atual. | ✅ presente | `sidebar.tsx:283-336` (pré-config); `sidebar.tsx:359-366` (compound) |
| Configure Behavior | `SidebarItem.hidden` decide visibilidade sem tocar a árvore. Colapso pode ser controlado (`collapsed`) ou uncontrolled com persistência (`persistKey`). `AppShell.Main` aceita `padding` e `maxWidth`. | ✅ presente | `nav-item.tsx:29-32`; `sidebar.tsx:120-127`; `AppShell.tsx:180-198` |
| Manage Resources | Consulta de permissão faz cleanup (`vivo = false` no `useEffect`) — não vaza `setState` após desmontar. `localStorage` acessado dentro de `try/catch` (funciona em modo privado). | ✅ presente | `app-nav.tsx:121-140`; `sidebar.tsx:93-108` |
| Orchestrate | `AppShell` orquestra `AppShellSidebar` + `BottomNav` + `RouteGate` + `ConexosStatusBanner`; a decisão de montar `AppNavigation` depende só de `useIsAuthenticated`. Sem cascata escondida. | ✅ presente | `AppShell.tsx:236-273` |
| Manage Resource Coupling | Uma única chamada `GET /me/permissoes` por montagem do `useAppNavGroups`; mas há **duplicação**: `OperacaoHomeCard.tsx:29` faz a mesma chamada. Duas montagens simultâneas na home = 2 requests para o mesmo endpoint. | ⚠️ parcial | `app-nav.tsx:130` e `components/home/OperacaoHomeCard.tsx:29` |
| Contract testing | Testes cobrem a **projeção** (`buildAppNavGroups` com combinações de permissões, `resolveActiveItemId` com pai/filho, sub-navegação `Mais` do `BottomNav`) mas **não** o shape real de `/me/permissoes`. | ⚠️ parcial | `nav/app-nav.test.tsx`, `sidebar.test.tsx`, `bottom-nav.test.tsx` |
| Versioning strategy (external API) | Nenhum versionamento explícito de `/me/permissoes` ou `/operacao`; a moldura consome estes contratos sem prefixo `/v1/` nem cabeçalho `Accept-Version`. Herdado do padrão do repo. | ⚠️ parcial (contexto do repo, não do delta) | `lib/operacao.ts:20-104` |
| Backward-compatibility shims | `AppShell.tsx` mantém `AppShellSkipLink`/`.SkipLink`, `.EnvBadge`, `.HeaderActions` e a forma compound completa que a spec descreve — quem já consumia subcomponentes soltos continua funcionando. `Sidebar` aceita `items` (spec) **ou** `groups` (extensão) — não quebra call sites existentes. | ✅ presente | `sidebar.tsx:317-322`; `AppShell.tsx:275-281` |
| Observability of integration failures | Falha na consulta de permissão cai em `catch → setPermitido(false)`. **Silenciosa** — nenhum log, nenhum sinal ao dev-tools. Fail-closed é a decisão certa; a ausência de telemetria por dependência é o débito. | ⚠️ parcial | `app-nav.tsx:133-135` |

## 4. Findings (achados)

### F-integrability-1: contrato `/me/permissoes` consumido sem validação de shape

- **Severidade**: P2 (débito técnico defensável — a moldura falha fechada, mas o sintoma é oculto)
- **Tactic violada**: Contract testing / Validate Input at boundary
- **Localização**: `src/frontend/lib/operacao.ts:101-104`; consumidores `src/frontend/components/nav/app-nav.tsx:130-136` e `src/frontend/components/home/OperacaoHomeCard.tsx:29`
- **Evidência (objetiva)**:
  ```ts
  export async function fetchPermissoes(): Promise<Permissoes> {
    const res = await apiFetch(`${API}/me/permissoes`, { headers: await withAuthHeaders() })
    if (!res.ok) throw new Error(`Falha ao consultar permissões (HTTP ${res.status}).`)
    return (await res.json()) as Permissoes
  }
  ```
  A tipagem é apenas `as Permissoes` (cast) — o TS nunca chega ao runtime, e a resposta não é parseada nem validada.
- **Impacto técnico**: se o backend renomear `operacao` (ex.: para `operacao_enabled` ou `{ operacao: { enabled: true, motivo } }`), o front recebe `undefined` no boolean → `setPermitido(undefined ? true : false)` → item some da sidebar sem sinal nenhum. O mesmo ocorre com `OperacaoHomeCard`. O gate real (server-side, 403 em `/operacao/**`) segue firme; o defeito é ergonômico (item ausente onde deveria aparecer).
- **Impacto de negócio**: usuários do allow-list `OPERACAO_USUARIOS` perdem acesso ao Painel de Operação de forma silenciosa até que alguém abra ticket. Diagnóstico exige ler código do frontend — no delta atual (que introduziu a moldura como única rota de acesso ao Painel para quem não sabe a URL) o custo do sintoma cresceu.
- **Métrica de baseline**: 0 fetchers da moldura usam validação de schema; 1 endpoint (`/me/permissoes`) é o único acoplamento de runtime da moldura ao backend.

### F-integrability-2: modelo de navegação e componentes de rota mantêm strings de rota duplicadas

- **Severidade**: P2 (débito técnico — rename cascateia por N arquivos)
- **Tactic violada**: Encapsulate / Restrict Communication Paths (a rota é um contrato compartilhado sem ponto único de definição)
- **Localização**: 5 fontes para `/permutas` fora de teste — folder `app/permutas/`, `components/nav/app-nav.tsx:52`, `app/page.tsx:36`, `app/permutas/clientes-filtro/page.tsx:180`, `app/permutas/BorderosPanel.tsx:301`. 4 fontes para `/permutas/borderos` — folder, `app-nav.tsx:58`, `app/permutas/page.tsx:665`, `app/permutas/components/ReconciliarDialog.tsx:119`. Mesmo padrão para `/sispag`, `/recebimentos`, `/operacao`, `/usuarios`.
- **Evidência (objetiva)**:
  ```
  $ grep -rn "'/permutas'" src/frontend --include='*.tsx' --include='*.ts' | grep -v .test.
  src/frontend/components/nav/app-nav.tsx:52:          href: '/permutas',
  src/frontend/app/page.tsx:36:              <Link href="/permutas">Abrir Gestão de Permutas</Link>
  src/frontend/app/permutas/clientes-filtro/page.tsx:180:            <Link href="/permutas">
  src/frontend/app/permutas/BorderosPanel.tsx:301:                <Link href="/permutas">
  ```
- **Impacto técnico**: renomear uma frente (ex.: `/recebimentos` → `/adiantamentos`, movimento **já** semi-executado — a UI mostra "Adiantamentos" enquanto a rota segue `/recebimentos` — `app-nav.tsx:79-80`) exige tocar o folder de rota, o modelo de nav, os cards da home, os links de retorno das subpáginas e o resolvedor de rota ativa continuar funcionando por prefixo (`sidebar.tsx:33-34`). Nada disso quebra em tempo de compilação — apenas em runtime, ao clicar.
- **Impacto de negócio**: cada mudança de URL vira uma cascata frágil. Já hoje "Adiantamentos" na sidebar aponta para `/recebimentos` — a divergência semântica está viva no código.
- **Métrica de baseline**: 5 fontes de verdade para `/permutas`; 4 para `/permutas/borderos`; padrão análogo em todas as demais frentes.

### F-integrability-3: adaptador `usePermissaoOperacao` está inlined em dois consumidores

- **Severidade**: P3 (melhoria opcional — hoje o custo é 1 request extra por sessão e risco de divergência de política)
- **Tactic violada**: Abstract Common Services / Manage Resource Coupling
- **Localização**: `src/frontend/components/nav/app-nav.tsx:121-140` (função `usePermissaoOperacao` privada) e `src/frontend/components/home/OperacaoHomeCard.tsx:23-40` (mesmo padrão inlined em componente)
- **Evidência (objetiva)**:
  ```ts
  // app-nav.tsx:121-140 (privada ao módulo)
  function usePermissaoOperacao(): boolean {
    const [permitido, setPermitido] = React.useState(false)
    React.useEffect(() => {
      let vivo = true
      void fetchPermissoes()
        .then((p) => { if (vivo) setPermitido(p.operacao) })
        .catch(() => { if (vivo) setPermitido(false) })
      return () => { vivo = false }
    }, [])
    return permitido
  }
  ```
  Padrão idêntico repetido em `OperacaoHomeCard.tsx:29`. Ambas as duas montagens (sidebar e card da home) coexistem na rota `/` → **2 requests simultâneos** para o mesmo endpoint por hidratação.
- **Impacto técnico**: uma mudança na política de fail-closed (por exemplo, cache local, retry, invalidação em `signOut`) precisa ser aplicada em dois lugares. Se um deles esquecer o cleanup ou mudar a semântica, os dois pontos da UI divergem sobre "posso mostrar Operação?".
- **Impacto de negócio**: pequeno hoje. Cresce se aparecerem novos consumidores do mesmo gate (esperado para a Frente IV / futura tela de configuração de allow-list).
- **Métrica de baseline**: 2 consumidores duplicando o mesmo padrão; 1 endpoint chamado 2× por hidratação da home.

### F-integrability-4: falhas de integração da moldura são engolidas sem sinal

- **Severidade**: P3 (melhoria opcional — o fail-closed é a decisão certa; falta é observabilidade)
- **Tactic violada**: Observability of integration failures
- **Localização**: `src/frontend/components/nav/app-nav.tsx:133-135`
- **Evidência (objetiva)**:
  ```ts
  .catch(() => {
    if (vivo) setPermitido(false)
  })
  ```
  Sem `console.warn`, sem incremento de métrica, sem sinal ao service worker de erro. Quando `GET /me/permissoes` cai (rede, 500, token expirado), a moldura simplesmente esconde "Operação" — o desenvolvedor só descobre abrindo devtools e inspecionando a chamada.
- **Impacto técnico**: um outage silencioso do endpoint (que a moldura passou a depender por causa deste delta) só aparece em ticket, não em telemetria.
- **Impacto de negócio**: MTTR maior para incidentes onde o backend está degradado — a UI parece funcionar; só falta o item.
- **Métrica de baseline**: 0 sinais emitidos em falha de `/me/permissoes` na moldura.

## 5. Cards Kanban

### [integrability-1] Validar o shape de `/me/permissoes` no boundary do fetcher

- **Problema**
  > `fetchPermissoes` retorna `(await res.json()) as Permissoes` (`lib/operacao.ts:102`). Uma mudança de contrato no backend faz o item "Operação" sumir da sidebar e do card da home em silêncio — o gate server-side segue firme, mas a ergonomia quebra sem sintoma diagnosticável.

- **Melhoria Proposta**
  > Adicionar validação Zod no fetcher (`lib/operacao.ts`) — schema `PermissoesSchema = z.object({ operacao: z.boolean() })`. Em falha de parse, tratar como fail-closed (retornar `{ operacao: false }`) **e** emitir `console.warn` estruturado. A moldura permanece silenciosa; o dev vê o desvio de contrato imediatamente.

- **Resultado Esperado**
  > Fetcher da moldura passa a validar o payload; mudança silenciosa de contrato vira erro visível em dev tools. Métrica: fetchers de contrato **da moldura** com validação de shape: 0 → 1 (o único que existe).

- **Tactic alvo**: Contract testing / Validate Input at boundary
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-1
- **Métricas de sucesso**:
  - Fetchers da moldura com validação de shape: 0/1 → 1/1
  - Detecção de mudança silenciosa de contrato: 0 → 1 (warn no console + fallback fechado)
- **Risco de não fazer**: um refactor de `GET /me/permissoes` no backend (razoável dado que o endpoint tende a evoluir com mais permissões — Frente IV, futuras allow-lists) esconde silenciosamente o Painel de Operação para todo o allow-list e ninguém percebe até abrir chamado. Custo do sintoma cresceu com este delta porque a sidebar agora é a única rota "descobrível" para chegar em `/operacao`.
- **Dependências**: nenhuma

### [integrability-2] Extrair constantes de rota das frentes num módulo único

- **Problema**
  > A string `'/permutas'` aparece em 5 arquivos fora de teste; `'/permutas/borderos'` em 4. Renomear uma frente cascateia por folder de rota + modelo de nav + cards da home + links de retorno das subpáginas — nenhum quebra em compile-time. Sintoma atual: "Adiantamentos" na sidebar (`app-nav.tsx:79-80`) aponta para `/recebimentos`, divergência semântica viva.

- **Melhoria Proposta**
  > Criar `src/frontend/lib/routes.ts` exportando constantes tipadas: `export const ROUTES = { permutas: '/permutas', permutasBorderos: '/permutas/borderos', sispag: '/sispag', recebimentos: '/recebimentos', operacao: '/operacao', usuarios: '/usuarios' } as const`. Migrar consumidores em ordem: `app-nav.tsx` primeiro (fonte de navegação), depois `app/page.tsx`, `home/*Card.tsx`, `permutas/**` links de retorno. Regra de lint local (ou grep no CI) para novas ocorrências de literais `'/permutas'` etc.

- **Resultado Esperado**
  > Uma rota tem duas fontes: (a) o folder `app/<rota>/`, (b) `lib/routes.ts`. Renomear é: mover folder + editar `routes.ts`. Métrica: literais de rota por frente cai de 4-5 → 1.

- **Tactic alvo**: Encapsulate / Restrict Communication Paths
- **Severidade**: P2
- **Esforço estimado**: S (≤1d) para introduzir; M (2-5d) para migrar os call sites já existentes (fora do delta) sem quebrar navegação
- **Findings relacionados**: F-integrability-2
- **Métricas de sucesso**:
  - Fontes de verdade para `/permutas` fora de teste: 5 → 2 (folder + `routes.ts`)
  - Fontes para `/permutas/borderos`: 4 → 2
- **Risco de não fazer**: a divergência entre nome da UI ("Adiantamentos") e rota (`/recebimentos`) permanece ambígua; qualquer rename futuro (`/recebimentos` → `/adiantamentos` é o próximo passo natural do renomeio de UI) exige revisão manual de N arquivos e passa por code review sem que ninguém garanta a completude.
- **Dependências**: alinhar com PatternGuardian se cabe regra automatizada

### [integrability-3] Extrair `usePermissaoOperacao` para hook compartilhado

- **Problema**
  > O padrão `useEffect + fetchPermissoes + isMounted guard + fail-closed` está inlined em `components/nav/app-nav.tsx:121-140` (privado) e em `components/home/OperacaoHomeCard.tsx:23-40`. Coexistem na rota `/` — 2 requests simultâneos ao mesmo endpoint por hidratação. Uma mudança de política (cache, retry, invalidação em `signOut`) exige editar dois lugares e esperar que nenhum divirja.

- **Melhoria Proposta**
  > Extrair `usePermissaoOperacao()` para `src/frontend/lib/permissoes.ts` (ou `lib/auth/`), com deduplicação por request via SWR/React Query **ou** memoização a nível de módulo por sessão. Migrar `app-nav.tsx` e `OperacaoHomeCard.tsx` para o hook único. Fail-closed permanece; ganha-se ponto único para futura política de cache/retry.

- **Resultado Esperado**
  > Consumidores da política de allow-list de Operação passam pelo mesmo hook. Métricas: implementações duplicadas 2 → 1; requests a `/me/permissoes` na home 2 → 1 (com cache).

- **Tactic alvo**: Abstract Common Services / Manage Resource Coupling
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-3
- **Métricas de sucesso**:
  - Implementações do padrão fetch-permissoes: 2 → 1
  - Requests a `/me/permissoes` por hidratação da home: 2 → 1
- **Risco de não fazer**: cresce à medida que a Frente IV e uma futura tela de allow-list adicionarem novos consumidores do mesmo gate; a chance de divergência cresce linearmente.
- **Dependências**: coordenar com o card [integrability-1] — o hook já sai com validação Zod

### [integrability-4] Observabilidade mínima em falhas da moldura

- **Problema**
  > `app-nav.tsx:133-135` engole erro em `.catch(() => setPermitido(false))`. É a política certa (fail-closed), mas sem sinal nenhum: outage de `/me/permissoes` some do radar do dev até virar ticket.

- **Melhoria Proposta**
  > No `catch` da moldura (e no hook extraído pelo card 3), emitir `console.warn('[nav] fetchPermissoes falhou; item Operação escondido', err)` estruturado. Quando existir um bus de telemetria de frontend (fora do escopo desta feature), plugar ali. Não introduzir toast — o fail-closed é deliberadamente silencioso para o usuário.

- **Resultado Esperado**
  > Falha no único endpoint que a moldura consome deixa rastro em devtools. Métrica: sinais emitidos em falha de `/me/permissoes` 0 → 1 (console.warn).

- **Tactic alvo**: Observability of integration failures
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-integrability-4
- **Métricas de sucesso**:
  - Falhas silenciosas de `/me/permissoes` na moldura: sim → não (warn em devtools)
  - Tempo até diagnóstico de degradação do endpoint em ambiente local: ticket → devtools
- **Risco de não fazer**: MTTR de degradação silenciosa fica limitado pela abertura de ticket; a moldura vira uma superfície diagnóstica surda.
- **Dependências**: nenhuma; combina bem com [integrability-3]

## 6. Notas do agente

- Escopo declarado **frontend only** — nenhum client de backend novo (Nexxera, GED, SharePoint, escrita Conexos) tocado neste delta; as métricas de integrabilidade backend do prompt genérico foram substituídas por métricas de integração interna (UI ↔ 3 fontes de permissão + rotas + design system).
- Nenhum finding foi elevado a P0/P1 — o padrão `AppNavPermissions` + `buildAppNavGroups` (função pura) já resolve o cerne da integrabilidade da moldura (custo de adicionar a 4ª frente = 1 arquivo tocado se reusar gate; ≤3 se introduzir gate novo). Os 4 achados são débitos localizados que aumentam MTTR ou fricção futura, não risco de incidente.
- **Cross-QA para o consolidator**:
  - `[integrability-1]` (Zod no boundary de `/me/permissoes`) sobrepõe-se a **Security** (validação de input) e a **Fault Tolerance** (fail-closed com sinal explícito).
  - `[integrability-2]` (constantes de rota) sobrepõe-se a **Modifiability** — é encapsulamento clássico.
  - `[integrability-3]` (hook compartilhado) sobrepõe-se a **Modifiability** e **Performance** (dedupe de request).
- **Não medível localmente**: métricas de infra/Terraform/tenants — não há `infra/` neste repositório (CLAUDE.md §Estado Atual vs. Alvo). Marcado como N/A onde cabe.
