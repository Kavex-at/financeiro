# UI Flow — Navegação global (moldura: AppShell + Sidebar)

> **Tipo:** moldura de aplicação. Não introduz entidade, ação, estado ou invariante de domínio
> (`entity_changed=false`). Nenhuma leitura ou escrita no Conexos. Vigência: 2026-09-03
> (feature `moldura-navegacao`).

## O que existia antes

Varredura em `src/frontend/` (2026-09-03, antes do delta): **zero** `<nav>`, **zero**
`role="navigation"`, **zero** `aria-current`, **zero** `role="main"`, **zero** `sr-only`.
O `components/AppShell.tsx` tinha 47 linhas e nenhum link. Mapeando todo `href="/…"`, as páginas
`/sispag`, `/recebimentos`, `/operacao` e `/usuarios` não continham link nenhum: uma vez dentro, a
única saída era o botão voltar do navegador. A home (`/`) era o único roteador da aplicação, e toda
troca de frente passava por voltar à raiz.

A solução completa já estava escrita em `src/frontend/docs/design-system/sidebar.md` e
`layout.md` — nunca havia sido construída.

## Modelo de navegação

Fonte única: `src/frontend/components/nav/app-nav.tsx` (`buildAppNavGroups`), consumida pela
`Sidebar` (≥ `md`) e pelo `BottomNav` (< `md`).

| Grupo | Item | Rota | Visível quando |
|---|---|---|---|
| Frentes | Permutas | `/permutas` | sempre |
| Frentes | ├ Borderôs | `/permutas/borderos` | sempre |
| Frentes | └ Clientes p/ permuta | `/permutas/clientes-filtro` | sempre |
| Frentes | SISPAG | `/sispag` | `isSispagEnabled()` (`lib/features.ts`) |
| Frentes | Adiantamentos | `/recebimentos` | sempre (ADR-0028: sem flag no frontend) |
| Plataforma | Operação | `/operacao` | `fetchPermissoes().operacao` (allow-list `OPERACAO_USUARIOS`, ADR-0042) |
| Plataforma | Usuários | `/usuarios` | `useIsAdmin()` |

A marca do header é link para `/`; `/` não é item de sidebar.

## Invariantes do fluxo

- **Nenhuma leitura de domínio.** A moldura não busca dado de negócio. A única chamada é
  `GET /me/permissoes`, que já existia e serve só para decidir a visibilidade do item de Operação.
- **Permissão esconde, nunca desabilita** (`docs/design-system/feedback.md`). Nenhum item usa
  `disabled` para expressar permissão. Os três gates são de **ergonomia**; o gate real é
  server-side em todos: `SISPAG_ENABLED` no backend, 404 nas rotas `/operacao`,
  `requireRole('admin')` em `/usuarios`.
- **Falha fechada na permissão de Operação.** Consulta que não responde mantém o item escondido —
  um item que some é irritante; um item que aparece e leva a um 404 parece defeito. Mesma política
  de `components/home/OperacaoHomeCard.tsx`.
- **Um `aria-current="page"` por vez.** O item ativo é o de href mais específico que casa com a
  rota; um pai cujo filho está ativo recebe realce de trilha, não `aria-current`.
- **Um `<h1>` por página** — o do `PageHeader`. O `AppShell` não emite `<h1>`.
- **`/login` sem moldura**; `/docs` (rota pública, `RouteGate:11`) sem sidebar quando não há sessão.

## Desvios deliberados da spec do design system

| Desvio | Motivo |
|---|---|
| Responsividade por CSS (`hidden md:flex` / `md:hidden`) em vez de `useBreakpoint()` | Hook de breakpoint mede o viewport só depois de montar e o servidor não mede nada — mismatch de hidratação em toda página. |
| `groups` na `Sidebar` (a spec só dá `groups` ao `SettingsSidebar`) | Frentes e Plataforma têm pesos diferentes; achatá-los produziria uma fileira uniforme de links. A forma de `SidebarGroup` é a de `SettingsGroup`, já definida na spec. |
| `hidden` em `SidebarItem` | A spec já define `hidden` em `SettingsSection` com esta exata semântica; estendê-lo é o que torna a regra do `feedback.md` aplicável à navegação global. |
| `AppShell.Main` com `maxWidth` default `'none'` (spec: `'xl'`) | O app é full-bleed de propósito — as telas são tabelas densas de operação. |
| Sub-items com a sidebar colapsada não abrem popover lateral | O pai continua navegável e ativo; popover interativo dentro de tooltip é frágil e o próprio DS desaconselha aninhar (`feedback.md`). Registrado como follow-up. |
| `SettingsSidebar` e `AppShell.Nav` não construídos | Ambos `não obrigatório` na spec e sem consumidor nesta aplicação. |

## Arquivos

```
src/frontend/components/AppShell.tsx           # moldura (compound) + composição
src/frontend/components/nav/app-nav.tsx        # modelo de itens + gating
src/frontend/components/ui/sidebar.tsx         # organism (+ resolveActiveItemId)
src/frontend/components/ui/nav-item.tsx        # molecule
src/frontend/components/ui/bottom-nav.tsx      # variante mobile
```

## Backlog (não nesta fatia)

Home como fila de trabalho · badges com contagem real vinda de endpoint (a prop `badge` já existe
e está sem consumidor, de propósito) · paleta de comandos ⌘K · dark mode · `SettingsSidebar` quando
existir uma área de configurações · popover de sub-items com a sidebar colapsada.
