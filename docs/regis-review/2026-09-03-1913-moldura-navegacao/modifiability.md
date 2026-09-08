---
qa: Modifiability
qa_slug: modifiability
run_id: 2026-09-03-1913-moldura-navegacao
agent: qa-modifiability
generated_at: 2026-09-03T19:13:00-03:00
scope: frontend
score: 9
findings_count: 4
cards_count: 3
---

# Modifiability — Regis-Review

## 1. Cenário Geral (Bass General Scenario aplicado ao financeiro)

| Source | Stimulus | Artifact | Environment | Response | Response Measure |
|---|---|---|---|---|---|
| Time da Kavex (produto) | "Acrescente a 5ª frente de negócio à navegação e ligue badges com contagem real vinda de um endpoint novo." | `src/frontend/components/nav/app-nav.tsx` (modelo de itens) + `src/frontend/components/ui/sidebar.tsx` (organism) | Design em produção; sessão autenticada; sem downtime | Editar UM arquivo (o modelo de nav) e opcionalmente um segundo (o hook de fetch das contagens). Sidebar, BottomNav, resolução de rota ativa, gating de visibilidade e persistência de colapso continuam funcionando sem toque. | Adicionar frente: ≤ 15 LOC em 1 arquivo, 0 arquivos de UI tocados. Ligar badges: ≤ 60 LOC em 1–2 arquivos, 0 mudança de contrato em `SidebarItem`/`Sidebar`. |

Sub-cenário paralelo (duplicação legada): o analista sai de `/permutas/borderos` para o painel de Permutas. Antes deste delta, existiam dois caminhos disponíveis para a mesma ação (sidebar + botão "Voltar ao painel" em `BorderosPanel.tsx:302` e `clientes-filtro/page.tsx:181`); depois deste delta, esses botões passam a ser redundantes. Medida: quantos pontos de código precisam mudar quando o rótulo/ícone de retorno mudar (alvo 1, real 3).

## 2. Métricas observadas

| Métrica | Valor atual | Alvo | Status | Fonte |
|---|---|---|---|---|
| LOC do maior arquivo do delta | 393 (`sidebar.tsx`) | ≤ 600 (limite dour de "Split Module" de Bass) | ✅ | `_shared-metrics.md` §"LOC do delta" |
| p95 LOC do delta (5 arquivos fonte) | ~390 | ≤ 400 | ✅ | `wc -l` em `AppShell/app-nav/sidebar/nav-item/bottom-nav` |
| Warnings de `noExcessiveCognitiveComplexity` nos 5 arquivos do delta | 0 | 0 | ✅ | `cd src/frontend && npm run lint` filtrado por rule + path |
| Warnings totais do lint no delta | 1 | ≤ 2 | ✅ | `sidebar.tsx:142` — regra `react-hooks/set-state-in-effect`, não é complexidade |
| Import fan-out máximo no delta | 11 (`AppShell.tsx`) | ≤ 15 | ✅ | `grep -c '^import ' <arquivos>` |
| Fan-in dos módulos novos (fora testes) | `sidebar` 2 · `nav-item` 1 · `bottom-nav` 1 · `app-nav` 1 | Baixo é ótimo neste estágio (moldura recém-nascida) | ✅ | `grep -rln "from '@/components/(ui/sidebar\|ui/nav-item\|ui/bottom-nav\|nav/app-nav)'" src/frontend` |
| Ciclos de import entre os 5 arquivos | 0 | 0 | ✅ | Cadeia observada: `AppShell → {sidebar, bottom-nav, app-nav}`; `sidebar → nav-item`; `bottom-nav → sidebar, nav-item`; `app-nav → sidebar` (só type reexportado). DAG. |
| Cobertura de testes nos arquivos do delta (lines) | `AppShell 97,87% · app-nav 100% · sidebar 94,64% · nav-item 90,62% · bottom-nav 80,95%` | ≥ 80% em cada | ✅ | `_shared-metrics.md` §Cobertura |
| Custo real: acrescentar 5ª frente à navegação | 1 arquivo, ~10 LOC | ≤ 1 arquivo, ≤ 20 LOC | ✅ | Inspeção: `app-nav.tsx:47-87` — basta empurrar objeto novo no array `frentes[].items`. Sidebar e BottomNav já consomem `SidebarGroup[]` sem branch por identidade do item. |
| Custo real: ligar badges com contagem real de endpoint | 1–2 arquivos, ~40–60 LOC | ≤ 2 arquivos, ≤ 80 LOC, sem mudar contrato `SidebarItem` | ✅ | `nav-item.tsx:24-41` — prop `badge: { count, variant }` já existe; `NavItemBadge` já esconde `count<=0` e formata `>=100` como `99+`. A modificação é isolada em `app-nav.tsx` (fetch + mesclagem por `id`) — nenhum re-layout, nenhum contrato novo. |
| Binding time das decisões da moldura | build (env `NEXT_PUBLIC_SISPAG_ENABLED`, `NEXT_PUBLIC_ENV`) · JWT/session (`useIsAdmin`) · runtime/HTTP (`fetchPermissoes`) · runtime/localStorage (colapso) · runtime/URL (item ativo) | Cada decisão no menor tempo em que é útil | ✅ | 5 binding times distintos, todos justificados nos comentários in-source e em `ontology/ui-flows/navegacao-global.md` |
| Duplicação com legado — pontos que ainda mandam voltar a `/permutas` fora da sidebar | 2 (`BorderosPanel.tsx:301`, `clientes-filtro/page.tsx:180`) | 0 (a sidebar já expõe o pai e o realce de trilha) | ⚠️ | `grep -rn "Voltar ao painel" src/frontend` |
| Chave de persistência versionada | `ds:sidebar:collapsed:v1` — sufixo `:v1` explícito | Presença de versão | ✅ | `sidebar.tsx:30` (`SIDEBAR_COLLAPSED_STORAGE_KEY`) |
| Ontology drift — `entity_changed` do delta | `false` (declarado em `moldura-navegacao-tasks.md:6` e `navegacao-global.md:3`) | Coerência entre tasks e ontologia | ✅ | Delta é `ui-flow`, não entidade; `_index.json` e `_coverage.json` não deveriam mover — e não movem. |

> ⚠️ **Não medível localmente**: complexidade ciclomática por função com ferramenta canônica. O Biome deste repo não expõe métrica CC — só o warning binário de `noExcessiveCognitiveComplexity`. Aproximação por control-flow keywords: `AppShell 4 · app-nav 2 · sidebar 20 · nav-item 14 · bottom-nav 9`. Nenhum próximo do limiar informal (30+) e todos alinhados ao volume esperado de branches por componente.

### Apêndice — Top-N do delta (usado pelo consolidator no mapa cross-cutting)

**Top-5 maiores arquivos do delta (fonte, sem teste)**

| # | Arquivo | LOC | Papel |
|---|---|---|---|
| 1 | `src/frontend/components/ui/sidebar.tsx` | 393 | organism + `resolveActiveItemId` puro |
| 2 | `src/frontend/components/AppShell.tsx` | 297 | compound da moldura (7 subcomponentes) |
| 3 | `src/frontend/components/ui/nav-item.tsx` | 241 | molecule (link/button/span polimórfico + badge + tooltip) |
| 4 | `src/frontend/components/ui/bottom-nav.tsx` | 180 | variante mobile (achata grupos + item "Mais") |
| 5 | `src/frontend/components/nav/app-nav.tsx` | 155 | modelo de itens (`buildAppNavGroups` puro + `useAppNavGroups`) |

**Top-N fan-in dos módulos novos (dentro do delta; consumidores fora de teste)**

| # | Módulo | Consumidores | Notas |
|---|---|---|---|
| 1 | `components/ui/sidebar` | 2 (`AppShell`, `bottom-nav`) | `bottom-nav` só importa `SidebarGroup` (tipo) e `resolveActiveItemId` (função pura) — não há acoplamento de render. |
| 2 | `components/nav/app-nav` | 1 (`AppShell`) | Ponto único de mudança para o modelo de nav. |
| 3 | `components/ui/nav-item` | 2 (`sidebar`, `bottom-nav`) | Molecule reusada — cada mudança de visual do item ativo/inativo repercute nas duas variantes de layout de uma vez. |
| 4 | `components/ui/bottom-nav` | 1 (`AppShell`) | — |

## 3. Tactics — Cobertura no financeiro

| Tactic (Bass) | Implementação atual | Status | Evidência |
|---|---|---|---|
| **Split Module** | `AppShell`, `nav-item`, `sidebar`, `bottom-nav`, `app-nav` são cinco arquivos separados por responsabilidade (moldura, molecule, organism, variante mobile, modelo). Nenhum passa de 400 LOC. | ✅ presente | `_shared-metrics.md` §"LOC do delta" |
| **Increase Semantic Coherence** | Cada arquivo do delta tem um propósito único e legível pelo nome. Em `app-nav.tsx` a coesão vai além: a função pura `buildAppNavGroups({ sispagEnabled, isAdmin, operacaoEnabled })` é separada do hook `useAppNavGroups()` — a projeção é testável sem montar hook, DOM ou provider. | ✅ presente | `app-nav.tsx:38-118` (puro) vs. `app-nav.tsx:146-155` (hook) |
| **Encapsulate** | O `NavItem` encapsula três formas de linha (link, button, span inerte) sob uma única prop `SidebarItem`; o consumidor não sabe se o item é navegação ou ação. `AppShell` encapsula sob `.Sidebar`/`.Main`/`.Header` a moldura inteira e não vaza classes de layout. Persistência de colapso é encapsulada em `readStoredCollapsed`/`writeStoredCollapsed` com tolerância a `localStorage` bloqueado. | ✅ presente | `nav-item.tsx:178-193`; `AppShell.tsx:291-297`; `sidebar.tsx:91-108` |
| **Use an Intermediary** | `resolveActiveItemId(groups, pathname)` é o intermediário entre "rota atual" e "item ativo", exposto e reusado por `Sidebar` e `BottomNav` — não há duas cópias da regra de especificidade. `SidebarGroup` é o intermediário entre modelo de nav e organism (permite trocar `items` por `groups` sem mexer no consumidor). | ✅ presente | `sidebar.tsx:46-67`; consumido em `bottom-nav.tsx:97` |
| **Restrict Dependencies** | O grafo de imports do delta é um DAG estrito: `AppShell → {sidebar, bottom-nav, app-nav}`; `sidebar → nav-item`; `bottom-nav → sidebar (type + fn pura), nav-item`; `app-nav → sidebar (type)`. `nav-item` não importa nada do resto do delta — é a folha da árvore. Nenhum ciclo. Nenhum arquivo do delta importa de `src/backend/`. | ✅ presente | `grep '^import' <arquivos>` |
| **Refactor** | O `AppShell` anterior tinha 47 linhas e concentrava marca, header, `<main>` e chrome — mais um bug crônico: dois `<h1>` por página (marca + `PageHeader`). Foi refatorado em 7 subcomponentes nomeados e o `<h1>` da marca virou `<a>`. Refatoração melhora simultaneamente accessibility, navegação global e API de composição. | ✅ presente | `AppShell.tsx` antes (`git show HEAD~1:...`) × depois |
| **Abstract Common Services** | Duas variantes de layout (desktop `Sidebar` e mobile `BottomNav`) consomem o MESMO `SidebarGroup[]` produzido por `useAppNavGroups`. Regra do item ativo, regra do `hidden`, regra do badge — todas moram no primitivo (`nav-item`) e são compartilhadas. Um segundo modelo de itens era o caminho mais rápido para os dois desenhos divergirem no primeiro item novo. | ✅ presente | `AppShell.tsx:225-236` (uma fonte, dois desenhos) |
| **Defer Binding — configuration files / env** | `isSispagEnabled()` lê `NEXT_PUBLIC_SISPAG_ENABLED` (assada em build, com fallback para `local`); `AppShellEnvBadge` lê `NEXT_PUBLIC_ENV` para decidir se aparece. Decisão diferida ao build, não ao código. | ✅ presente | `lib/features.ts`; `AppShell.tsx:111-123` |
| **Defer Binding — polymorphism** | `NavItem` escolhe `<a>`/`<button>`/`<span>` em runtime pela presença de `href`/`onClick`. Consumidor não branch-a; o primitivo branch-a. | ✅ presente | `nav-item.tsx:178-193` |
| **Defer Binding — runtime registration (JWT + HTTP)** | Visibilidade de `Usuários` é diferida ao claim `admin` do JWT (`useIsAdmin`, runtime-cliente após login); visibilidade de `Operação` é diferida a `fetchPermissoes()` (runtime-cliente, HTTP, com falha fechada). Nenhuma decisão de permissão é assada no build. | ✅ presente | `app-nav.tsx:120-143`; `lib/auth/AuthProvider.tsx:237-...` |
| **Defer Binding — user preference (localStorage)** | Colapso da sidebar é diferido a preferência do usuário, persistida em `localStorage` sob chave versionada `ds:sidebar:collapsed:v1`. Versão explícita permite migração futura sem quebrar cache existente. Fallback controlado quando `localStorage` está bloqueado. | ✅ presente | `sidebar.tsx:30, 91-108, 139-154` |
| **Defer Binding — plugin patterns** | `SidebarProps` aceita `items` **ou** `groups`, e o consumidor de `Sidebar` recebe `activeItemId` explícito ou deriva de `usePathname()`. A moldura aceita ser dirigida de fora ou se dirigir sozinha — plug-in do fluxo de dados. Compound API (`Sidebar.Root/Header/Nav/Item/Footer/CollapseToggle`) permite o consumidor montar uma sidebar customizada sem entrar no arquivo. | ✅ presente | `sidebar.tsx:316-393` |

## 4. Findings (achados)

### F-modifiability-1: Botões legados "Voltar ao painel" nas subpáginas de Permutas duplicam a trilha da sidebar

- **Severidade**: P2
- **Tactic violada**: Abstract Common Services (dois caminhos independentes para a mesma navegação de volta)
- **Localização**: `src/frontend/app/permutas/BorderosPanel.tsx:295-304`, `src/frontend/app/permutas/clientes-filtro/page.tsx:178-186`
- **Evidência (objetiva)**:
  ```
  BorderosPanel.tsx:300-303
    <Button variant="outline" size="sm" asChild>
      <Link href="/permutas">
        <ArrowLeft aria-hidden /> Voltar ao painel
      </Link>
    </Button>

  clientes-filtro/page.tsx:180-183
    <Button variant="outline" size="sm" asChild>
      <Link href="/permutas">
        <ArrowLeft aria-hidden /> Voltar ao painel
      </Link>
    </Button>
  ```
  A sidebar já expõe `/permutas` como pai dos itens `Borderôs` e `Clientes p/ permuta` (`app-nav.tsx:57-64`), e a resolução de trilha destaca o pai quando o filho está ativo (`sidebar.tsx:69-70`, `nav-item.tsx:130-134`). O objetivo dos dois botões — voltar ao painel — passa a ser servido pela sidebar em desktop e pelo BottomNav em mobile (que já achata pais e filhos como alvos de primeira classe, `bottom-nav.tsx:82-95`).
- **Impacto técnico**: mudar o rótulo/ícone de "voltar ao painel de Permutas" custa 3 pontos de edição em vez de 1 (o pai na sidebar + os dois botões legados). Cada divergência futura (um botão passa a levar a `/permutas?tab=…`, outro fica em `/permutas`) é silenciosa.
- **Impacto de negócio**: baixo isoladamente — o usuário ainda navega. Efeito acumulado: leva a analista a construir modelos mentais concorrentes ("a sidebar leva para X, o botão para Y"). É exatamente o caso que a moldura foi construída para eliminar.
- **Métrica de baseline**: 2 pontos de duplicação; ambos apontam ao mesmo `href="/permutas"` com o mesmo rótulo e ícone.

### F-modifiability-2: `HEADER_HEIGHT`/`HEADER_OFFSET` em `AppShell.tsx` são duas strings Tailwind acopladas por convenção

- **Severidade**: P3
- **Tactic violada**: Encapsulate (a relação `top-14 == h-14` é obrigação do leitor, não do código)
- **Localização**: `src/frontend/components/AppShell.tsx:29-31, 71, 158-161`
- **Evidência (objetiva)**:
  ```
  const HEADER_HEIGHT = 'h-14'
  const HEADER_OFFSET = 'top-14'
  ```
  O comentário adverte "mudam juntas". Ainda são duas fontes de verdade — mudar para `h-16` sem lembrar de `top-16` põe a sidebar por baixo do header sem erro em nenhum gate.
- **Impacto técnico**: a próxima mudança de altura do header (design ou requisito de a11y) tem uma pegadinha silenciosa embutida.
- **Impacto de negócio**: nulo até a mudança acontecer; embutido no custo de qualquer redesign do header.
- **Métrica de baseline**: 2 strings a manter sincronizadas manualmente; 0 teste protege a sincronização.

### F-modifiability-3: `useAppNavGroups` acopla o modelo de nav ao endpoint `/me/permissoes` (Operação) via import direto

- **Severidade**: P3
- **Tactic violada**: Restrict Dependencies (parcial — modelo de dados de UI depende de módulo de fetch de domínio)
- **Localização**: `src/frontend/components/nav/app-nav.tsx:8, 125-143`
- **Evidência (objetiva)**:
  ```
  import { fetchPermissoes } from '@/lib/operacao'
  ```
  Se `fetchPermissoes` mudar contrato (por exemplo o campo passar de `operacao: boolean` para `operacao: { habilitado: boolean }`), o modelo de navegação deixa de compilar. A projeção pura `buildAppNavGroups({ sispagEnabled, isAdmin, operacaoEnabled })` já é imune a isso — a fragilidade mora só no hook.
- **Impacto técnico**: baixo. Uma renomeação de campo dispara erro de tipo em um sítio. Não há efeito em runtime silencioso.
- **Impacto de negócio**: nenhum hoje. Relevante se `fetchPermissoes` virar plataforma compartilhada com múltiplos consumidores concorrentes.
- **Métrica de baseline**: 1 sítio acoplado; a projeção pura já isola o modelo dos detalhes de shape (só passa `boolean`), então o raio de estrago é pequeno.

### F-modifiability-4: A prop `badge` de `SidebarItem` está sem consumidor DE PROPÓSITO — decisão precisa ficar rastreada

- **Severidade**: P3
- **Tactic violada**: N/A (é uma decisão de escopo, não uma violação) — registrada como finding para não sumir do radar
- **Localização**: `src/frontend/components/ui/nav-item.tsx:24-41, 53-86`, `ontology/ui-flows/navegacao-global.md:73-77`
- **Evidência (objetiva)**:
  ```
  nav-item.tsx:24-41  → export interface SidebarItem { ... badge?: NavBadge ... }
  nav-item.tsx:53-86  → NavItemBadge implementado (hide 0 / format 99+ / 4 variantes de tom)
  navegacao-global.md:76 → "a prop `badge` já existe e está sem consumidor, de propósito"
  ```
- **Impacto técnico**: código morto até a rodada seguinte. Se a rodada não chegar em 3–6 meses, vira função "por que isso existe?".
- **Impacto de negócio**: neutro. É defer-binding intencional (o contrato está pronto para o dia em que o endpoint de contagens existir).
- **Métrica de baseline**: 1 prop com 0 consumidores em produção; teste de unidade dá cobertura para os dois formatos (`badge 0`, `badge 140 → 99+`).

## 5. Cards Kanban

### [modifiability-1] Remover os botões "Voltar ao painel" das subpáginas de Permutas

- **Problema**
  > As telas `BorderosPanel.tsx` (`:301`) e `clientes-filtro/page.tsx:180` mantêm um botão de retorno feito à mão para `/permutas`. Com a moldura em pé, a sidebar já expõe `/permutas` como pai dos dois itens e o realce de trilha ativa o pai quando o filho está aberto (`sidebar.tsx:69-70`); o BottomNav também expõe os dois níveis lado a lado (`bottom-nav.tsx:82-95`). O botão é redundante em desktop, duplicado em mobile e cria dois caminhos independentes para a mesma ação — cada divergência futura é silenciosa.

- **Melhoria Proposta**
  > Remover os dois botões e o import de `ArrowLeft`/`Link` que só serviam a eles. Se o time quiser preservar affordance para quem esconde a sidebar, adotar o `Breadcrumb` do design system (spec `layout.md` §Breadcrumb) — UMA fonte, mesmo modelo. **Tactic**: Abstract Common Services. **Arquivos**: `src/frontend/app/permutas/BorderosPanel.tsx`, `src/frontend/app/permutas/clientes-filtro/page.tsx`.

- **Resultado Esperado**
  > Trocar o rótulo/ícone de retorno ao painel de Permutas passa a custar 1 edição em `app-nav.tsx` (ou no `Breadcrumb`) em vez de 3. Zero divergência silenciosa entre botão e sidebar.

- **Tactic alvo**: Abstract Common Services
- **Severidade**: P2
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-1
- **Métricas de sucesso**:
  - Pontos de código que apontam para `/permutas` como "voltar": 3 → 1
  - Testes de rendering de `BorderosPanel`/`clientes-filtro` que referenciam o botão: remover expectativa correspondente
- **Risco de não fazer**: em 6 meses, o rótulo/ícone divergem entre os dois botões e a sidebar; um deles passa a levar a `/permutas?tab=X` e a moldura vira "quase" fonte única.
- **Dependências**: nenhuma

### [modifiability-2] Extrair a altura do header para um único token compartilhado

- **Problema**
  > `AppShell.tsx:29-31` define `HEADER_HEIGHT = 'h-14'` e `HEADER_OFFSET = 'top-14'` como duas strings independentes. O comentário in-source adverte "mudam juntas" — a advertência é a admissão de que não é o código que garante. Mudar para `h-16` sem lembrar de `top-16` esconde a sidebar por baixo do header e nenhum gate protesta (não é warning de Biome, não é falha de teste — só o pixel).

- **Melhoria Proposta**
  > Adotar um número (`const HEADER_H = 14`, unidades de `0.25rem`) e derivar as duas classes (`h-${HEADER_H}` só funciona se as classes estiverem no safelist do Tailwind; alternativa mais segura é usar `style={{ height: '3.5rem' }}` no header e `top-14` como classe única) — OU adicionar teste snapshot que garanta a igualdade string a string. **Tactic**: Encapsulate. **Arquivo**: `src/frontend/components/AppShell.tsx`.

- **Resultado Esperado**
  > Uma única fonte de verdade para altura do header. Redesign de altura passa a ser edição de 1 constante numérica, sem dupla verificação manual.

- **Tactic alvo**: Encapsulate
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-2
- **Métricas de sucesso**:
  - Strings de altura de header em `AppShell.tsx`: 2 → 1
  - Testes que travam a relação `header.height == sidebar.top`: 0 → 1
- **Risco de não fazer**: baixo até a próxima mudança de altura; alto naquele exato momento.
- **Dependências**: nenhuma

### [modifiability-3] Documentar a decisão "badge sem consumidor" com data de expiração e conectar ao backlog

- **Problema**
  > A prop `badge` de `SidebarItem` está implementada, testada (`badge 0` esconde, `badge 140 → 99+`) e sem consumidor real (`ontology/ui-flows/navegacao-global.md:73-77` reconhece; `moldura-navegacao-tasks.md:69-73` idem). É defer-binding intencional — o dia em que o endpoint de contagens existir, o custo é ~60 LOC em `app-nav.tsx`. Sem data ou dono, código intencionalmente morto vira código acidentalmente morto em ~6 meses.

- **Melhoria Proposta**
  > Registrar no `ontology/_inbox/moldura-navegacao-followups.md` (ou reaproveitar o `moldura-navegacao-tasks.md` fechado) uma linha explícita: **"prop `badge` fica sem consumidor até YYYY-MM; se o endpoint de contagens não chegar até lá, revisar se vale manter"**. Opcionalmente, marcar as duas variantes de badge (sidebar e BottomNav) com `@deprecated?` de convenção interna que sinalize "aguardando cliente". **Tactic**: Defer Binding — mantido, com controle temporal explícito.

- **Resultado Esperado**
  > A decisão fica auditável na próxima retro-ontology. Não vira "por que isso existe?" na leitura de código de daqui a 6 meses.

- **Tactic alvo**: Defer Binding (proteger a decisão, não desfazer)
- **Severidade**: P3
- **Esforço estimado**: S (≤1d)
- **Findings relacionados**: F-modifiability-4
- **Métricas de sucesso**:
  - Linha explícita no inbox com data de revisão: 0 → 1
  - `/retro-ontology` da semana X lista essa decisão como "verificar hoje?"
- **Risco de não fazer**: em 6 meses o próximo dev remove `badge` "porque ninguém usa" e o custo do endpoint sobe 60 LOC para restaurar o contrato. Ou pior: mantém e ninguém sabe se ainda é para ser ligado.
- **Dependências**: nenhuma

## 6. Notas do agente

- **Escopo**: `--quick` + frontend + delta. Mediu APENAS os 5 arquivos fonte novos/reescritos do commit `05606a6`; o resto do frontend (~19,5 kLOC) e o backend estão fora. Ontology drift verificado por coerência entre `entity_changed=false` declarado e ausência de mudança em entidades — não roda mais fundo.
- **Cross-QA (para o consolidator)**:
  - **F-modifiability-1** (botões duplicados) cruza com **Testability**: enquanto os botões existirem, cada teste de `PageHeader` de subpágina precisa lembrar deles; após remoção, cai a superfície de teste. Também cruza com **Usability** (não coberto por QA neste run, mas relevante: modelo mental do usuário).
  - **F-modifiability-2** (duplicação `h-14`/`top-14`) cruza com **Deployability** só no sentido invertido: como as classes são Tailwind estáticas, o custo de mudar é build+deploy — sem externalização (nem faria sentido, é medida física do chrome, não regra de negócio).
  - **F-modifiability-3** (acoplamento `app-nav` → `fetchPermissoes`) cruza com **Integrability**: o mesmo padrão de "consulta uma vez por montagem, falha fechada" já aparece em `components/home/OperacaoHomeCard.tsx:33` — vale um card compartilhado para promover esse padrão a helper reutilizável (fora do escopo deste run).
  - **F-modifiability-4** (badge sem consumidor) cruza com **Performance** e **Availability** futuramente: quando o endpoint de contagens existir, o hook precisa ser cache-friendly e falhar fechado (a moldura não pode ficar em spinner por causa de badge).
- **Métrica que tentei coletar e falhou**: complexidade ciclomática canônica — Biome deste repo não expõe métrica CC, só o gate binário `noExcessiveCognitiveComplexity` (0 disparos no delta). Aproximei por contagem de control-flow keywords.
- **Ponto forte destacável**: `resolveActiveItemId` é função pura, exportada, testada e reusada por dois consumidores. É o exemplo canônico de Use an Intermediary aplicado a UI — merece ficar no vocabulário do time para próximas moldura-shaped features.
