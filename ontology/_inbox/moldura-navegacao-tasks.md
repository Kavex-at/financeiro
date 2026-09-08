# moldura-navegacao — tasks

> `/feature-tweak --no-ground-truth plataforma/navegacao "feat: implementar a moldura de navegação
> (Sidebar + AppShell) que o design system já especifica"`
> Branch: `feat/moldura-navegacao` · worktree `~/kavex-worktrees/moldura-navegacao`
> `entity_changed=false` — nenhuma entidade, ação, invariante ou máquina de estados do domínio muda.
> `--no-ground-truth`: o delta é casca de aplicação (chrome de navegação). Não toca lógica monetária,
> não lê nem escreve no Conexos, não altera nenhum cálculo. Não há ground truth aplicável.

## Interview (modo tweak — delta)

**Comportamento atual (verificado por varredura em `src/frontend/`, 2026-09-03):**
- `<nav>`: 0 · `role="navigation"`: 0 · `aria-current`: 0 · `role="main"`: 0 · `sr-only`: 0.
- `components/AppShell.tsx` (47 linhas) renderiza header com marca + versão + `UserMenu`. Zero links.
- Mapeando todo `href="/…"`: `/sispag`, `/recebimentos`, `/operacao`, `/usuarios` não têm nenhum link
  de saída. As subpáginas de Permutas têm link de retorno feito à mão, diferente em cada uma
  (`app/permutas/BorderosPanel.tsx:301`, `app/permutas/clientes-filtro/page.tsx:180`).
  Consequência: a home (`/`) é o único roteador da aplicação.
- `AppShell.tsx:25` emite `<h1>Columbia Trading</h1>` e `components/ui/page-header.tsx:27` emite outro
  `<h1>` com o título da página — dois `<h1>` em toda tela autenticada.
- A marca "Columbia Trading" é `<h1>` + spans; clicar não faz nada.

**Comportamento desejado:** a moldura que o design system já especifica em
`src/frontend/docs/design-system/sidebar.md` (385 linhas) e `layout.md` (400 linhas) passa a existir.
Sidebar global persistente, `BottomNav` em mobile, skip link, `role="main"`, marca como link para `/`,
`<h1>` único (o do `PageHeader`).

**Mudança de regra ou bug de implementação?** Nem um nem outro: é implementação de decisão de design
já tomada e escrita. A API e o comportamento vêm da spec; só os *itens de navegação* são adaptados ao
domínio real (a spec usa exemplos de outro produto — "Notas", "NF Automation").

**Invariantes afetadas:** nenhuma do domínio. Uma invariante de UI é **preservada**: o gating de
visibilidade que já existe (SISPAG por `isSispagEnabled()`, Operação por `fetchPermissoes().operacao`,
Usuários por `useIsAdmin()`) continua valendo, agora também na sidebar. Regra do DS
(`feedback.md:221`): **permissão ausente esconde, nunca desabilita**. O gate real permanece
server-side; esconder é ergonomia.

**Caso canônico:** analista abre `/sispag`, precisa ir para `/recebimentos`. Hoje: só pelo botão
voltar do navegador até `/`. Depois: um clique na sidebar.

## Decisões de implementação (desvios da spec, deliberados)

1. **Responsividade por CSS, não por `useBreakpoint()`.** A spec exemplifica
   `const { isMobile } = useBreakpoint()`. Um hook de breakpoint em app SSR produz mismatch de
   hidratação. Sidebar `hidden md:flex`, `BottomNav` `md:hidden`. Mesmo resultado observável,
   sem flash nem erro de hidratação.
2. **`groups` no `Sidebar`.** A spec dá `items: SidebarItem[]` plano ao `Sidebar` e `groups` só ao
   `SettingsSidebar`. O domínio tem dois grupos com pesos diferentes (Frentes × Plataforma) e a
   hierarquia visual entre eles é requisito. Adotado `groups?: SidebarGroup[]` com a mesma forma
   de `SettingsGroup` (`{ id, label?, items }`) — extensão consistente com o DS, não API nova.
   `items` continua funcionando.
3. **`hidden?: boolean` em `SidebarItem`.** A spec já define `hidden` em `SettingsSection` com
   exatamente esta semântica ("permissão ausente esconde; nunca desabilita"). Estender ao
   `SidebarItem` é o que torna a regra do `feedback.md` aplicável à navegação global.
4. **`maxWidth` do `AppShell.Main` default `'none'` neste app.** A spec default é `'xl'`. O app é
   deliberadamente full-bleed (`AppShell.tsx:41`) porque as telas são tabelas densas; impor
   max-width regrediria SISPAG, Recebimentos e Permutas. A prop existe e aceita os valores da spec.
5. **Sub-items com a sidebar colapsada não abrem popover lateral.** A spec pede popover no hover.
   Com a sidebar colapsada o pai continua navegável (todos os pais desta app têm `href`) e ativo;
   os filhos aparecem ao expandir. Popover interativo dentro de tooltip é frágil e a spec do
   próprio DS desaconselha aninhar (`feedback.md:295`). Vira follow-up, não meia-implementação.
6. **`SettingsSidebar` e `AppShell.Nav` não são construídos.** Ambos são `não obrigatório` na spec e
   não têm consumidor nenhum nesta aplicação (não há área de configurações com sub-seções, e o eixo
   de navegação escolhido é a sidebar vertical). Componente sem consumidor é código morto.
7. **Chrome de navegação só para sessão resolvida.** `/login` continua sem chrome (comportamento
   atual). `/docs` é rota pública (`RouteGate:11`): renderiza header + main, sem sidebar, quando o
   visitante não está autenticado — não faz sentido oferecer links que terminam em redirect ao login.

## Fora de escopo (rodadas seguintes)

Home como fila de trabalho · badges com contagem real vinda de endpoint · paleta de comandos ⌘K ·
dark mode · autoria dos primitivos shadcn. A prop `badge` do `Sidebar` **é** implementada e fica sem
consumidor, para que a rodada seguinte só ligue os números.

---

### Task 1: NavItem molecule and Sidebar organism

Implementar o `NavItem` (molecule) e o `Sidebar` (organism) exatamente contra
`src/frontend/docs/design-system/sidebar.md`: forma direta (`items`/`groups`) e forma compound
(`Sidebar.Root` / `Header` / `Nav` / `Item` / `Footer` / `CollapseToggle`), dois níveis, badges,
colapso persistido, tooltips e acessibilidade completa.

Densidade de ferramenta de operação, não de landing page: item `h-8`, label `text-[13px]`, ícone
`size-4`, rótulo de grupo em `text-[11px] uppercase tracking-wider text-muted-foreground`. Estado
ativo com `bg-primary/10`, texto `text-primary` e indicador vertical à esquerda em `bg-primary`
(spec §Estados). Nenhuma cor nova: só tokens já presentes em `app/globals.css`.

**Files to change:**
- `src/frontend/components/ui/nav-item.tsx` (novo)
- `src/frontend/components/ui/sidebar.tsx` (novo)

**Acceptance criteria:**
- `SidebarItem` expõe `id`, `label`, `icon?`, `href?`, `onClick?`, `badge?`, `disabled?`, `hidden?`,
  `tooltip?`, `children?` — a forma da spec, mais `hidden` (decisão 3).
- Largura `w-56` expandido e `w-16` colapsado, com transição de `200ms` `ease-in-out`.
- Estado colapsado persiste em `localStorage` sob a chave `ds:sidebar:collapsed:v1`; a chave é
  sobrescritível por `persistKey`. Acesso a `localStorage` é tolerante a falha (modo privado).
- Wrapper é `<nav role="navigation" aria-label="Navegação principal">` contendo `<ul role="list">`
  com `<li>` por item.
- Exatamente **um** elemento recebe `aria-current="page"`: o item de maior especificidade
  (href mais longo) que casa com a rota atual. Um pai cujo filho está ativo NÃO recebe
  `aria-current`, só o realce de trilha.
- Item com `hidden: true` não renderiza (nem `<li>`, nem link, nem texto acessível).
- Item com `children` tem `aria-expanded` e `aria-controls` apontando para o `<ul>` aninhado;
  o sub-menu auto-expande quando um filho está ativo.
- Toggle de colapso tem `aria-expanded` e `aria-label` `"Colapsar navegação"` / `"Expandir navegação"`.
- Badge com `count: 0` não renderiza; `count >= 100` renderiza `"99+"`.
- Colapsada, a sidebar mostra só ícones e o label de cada item permanece acessível
  (tooltip e/ou nome acessível no link).
- Sem cor fora dos tokens de `app/globals.css`; sem `!` non-null assertion.

**Dependencies:** none

---

### Task 2: BottomNav for mobile

Barra de navegação inferior que substitui a `Sidebar` abaixo de `md`, conforme
`sidebar.md` §BottomNav. Reusa o mesmo modelo de itens da sidebar — uma fonte, dois desenhos.

**Files to change:**
- `src/frontend/components/ui/bottom-nav.tsx` (novo)

**Acceptance criteria:**
- `position: fixed` na base, altura `h-16`, respeitando `env(safe-area-inset-bottom)`.
- Ícone acima do label; item ativo em `text-primary` com indicador de 2px no topo.
- `<nav role="navigation" aria-label="Navegação principal (mobile)">`; item ativo com
  `aria-current="page"`.
- Máximo de 5 itens visíveis; o excedente vai para um item "Mais" que abre a lista restante.
- Itens `hidden` não renderizam, pela mesma regra da Task 1.
- Aceita os mesmos `SidebarItem[]` da Task 1 sem conversão.

**Dependencies:** Task 1

---

### Task 3: Domain navigation model with permission gating

O modelo de navegação real do Financeiro, com o gating de visibilidade que já existe hoje na home
preservado item a item. Uma fonte só, consumida pela `Sidebar` e pelo `BottomNav`.

**Files to change:**
- `src/frontend/components/nav/app-nav.tsx` (novo)

**Acceptance criteria:**
- Grupo **Frentes**: Permutas (`/permutas`, com filhos Borderôs `/permutas/borderos` e
  Clientes p/ permuta `/permutas/clientes-filtro`), SISPAG (`/sispag`),
  Gestão de Adiantamentos (`/recebimentos`).
- Grupo **Plataforma**: Operação (`/operacao`), Usuários (`/usuarios`).
- SISPAG fica `hidden` quando `isSispagEnabled()` é `false` (`lib/features.ts`).
- Usuários fica `hidden` quando `useIsAdmin()` é `false` (`lib/auth/AuthProvider`).
- Operação fica `hidden` até `fetchPermissoes().operacao` resolver `true`; falha na consulta
  mantém escondido (falha fechada — mesma política de `components/home/OperacaoHomeCard.tsx:33`).
- Nenhum item usa `disabled` para expressar permissão (regra do DS, `feedback.md:221`).
- A consulta de permissão é feita uma vez por montagem e não vaza `setState` após desmontar.

**Dependencies:** Task 1

---

### Task 4: AppShell compound with skip link, single h1 and brand link

Reescrever o `AppShell` na forma compound da spec (`layout.md` §AppShell), montando a moldura.
Encerra FE-01 (becos sem saída), FE-03 (marca clicável) e FE-04 (dois `<h1>`).

**Files to change:**
- `src/frontend/components/AppShell.tsx`

**Acceptance criteria:**
- Subcomponentes `AppShell.Header`, `.Logo`, `.EnvBadge`, `.HeaderActions`, `.Sidebar`, `.Main`
  existem e são usados na montagem.
- O primeiro elemento focável da página é um link "Pular para o conteúdo" apontando para
  `#main-content`, invisível (`sr-only`) até receber foco.
- A área principal é `<main role="main" id="main-content">`.
- O `AppShell` **não** emite `<h1>`. A marca "Columbia Trading" é um `<a href="/">` com nome
  acessível próprio. Após a mudança, toda página autenticada tem exatamente um `<h1>` — o do
  `PageHeader`.
- Header `role="banner"`, sticky, altura fixa `h-14`.
- `AppShell.EnvBadge` renderiza o ambiente quando `NEXT_PUBLIC_ENV` não é produção e não renderiza
  nada em produção.
- `/login` continua sem chrome nenhum (comportamento atual preservado).
- Em rota pública (`/docs`) sem sessão, renderiza header + main sem sidebar nem bottom nav.
- Autenticado, `Sidebar` (≥ `md`) e `BottomNav` (< `md`) estão montados em toda rota — não existe
  mais tela autenticada sem saída.
- `ConexosStatusBanner`, `RouteGate` e o selo de versão (`data-testid="app-version"`) continuam
  presentes e funcionando.
- `npm run build` passa (fronteira server/client — o job `frontend` do CI não roda build).

**Dependencies:** Task 1, Task 2, Task 3

---

### Task 5: Component tests for the navigation frame

Teste de componente para a moldura. `jest.config.js` tem `coverageThreshold` global em
`lines: 20`, `branches: 9`, `functions: 14` — componentes novos sem teste derrubam esses números,
então o teste protege o gate além de ser a parte que mais importa fixar.

**Files to change:**
- `src/frontend/components/ui/sidebar.test.tsx` (novo)
- `src/frontend/components/nav/app-nav.test.tsx` (novo)
- `src/frontend/__tests__/AppShell.test.tsx` (novo)

**Acceptance criteria:**
- Sidebar: item da rota atual é o único com `aria-current="page"`; um pai cujo filho está ativo
  não recebe `aria-current`.
- Sidebar: item marcado `hidden` não aparece por texto nem por role.
- Sidebar: colapso é persistido em `ds:sidebar:collapsed:v1` e relido na montagem seguinte.
- Sidebar: badge `0` não renderiza; badge `140` renderiza `99+`.
- Sidebar: `<nav>` tem `aria-label="Navegação principal"`.
- app-nav: SISPAG some com `NEXT_PUBLIC_SISPAG_ENABLED=false`; Usuários some para não-admin;
  Operação some quando `fetchPermissoes` rejeita.
- AppShell: existe link "Pular para o conteúdo" apontando para `#main-content`; existe um
  `role="main"` com `id="main-content"`; o AppShell não emite `<h1>`; a marca é um link para `/`.
- `npm test` passa e `coverageThreshold` global continua satisfeito.

**Dependencies:** Task 1, Task 2, Task 3, Task 4

---

### Task 6: Document the navigation frame in the ontology

Registrar a moldura como fluxo de UI, no molde de `ontology/ui-flows/relatorios-export.md`
(`entity_changed=false`, sem entidade nova).

**Files to change:**
- `ontology/ui-flows/navegacao-global.md` (novo)

**Acceptance criteria:**
- Descreve o modelo de navegação (grupos, itens, rotas), a regra de gating por item com a fonte de
  cada uma, e os desvios deliberados da spec do DS com o motivo.
- Declara explicitamente `entity_changed=false`.

**Dependencies:** Task 3, Task 4
