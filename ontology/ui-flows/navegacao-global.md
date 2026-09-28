# UI Flow — Navegação global (moldura: AppShell + Sidebar)

> **Tipo:** moldura de aplicação. Não introduz entidade, ação, estado ou invariante de domínio
> (`entity_changed=false`). Nenhuma leitura ou escrita no Conexos. Vigência: 2026-09-03
> (feature `moldura-navegacao`). Visibilidade por permissão: 2026-09-28 (feature
> `auth-permissoes-modulo`, ADR-0053).

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
| Frentes | Permutas | `/permutas` | `permutas:ver` |
| Frentes | ├ Borderôs | `/permutas/borderos` | `permutas:ver` |
| Frentes | └ Clientes p/ permuta | `/permutas/clientes-filtro` | `permutas:ver` |
| Frentes | SISPAG | `/sispag` | `isSispagEnabled()` (`lib/features.ts`) **e** `sispag:ver` |
| Frentes | Adiantamentos | `/recebimentos` | `recebimentos:ver` (ADR-0028: sem flag no frontend) |
| Plataforma | Operação | `/operacao` | `operacao:ver` |
| Plataforma | Métricas | `/metricas` | `metricas:ver` |
| Plataforma | Usuários | `/usuarios` | `usuarios:gerenciar` |

As permissões vêm do catálogo fixo da ADR-0053 e chegam ao front por `GET /me/permissoes`, que
devolve as **efetivas** já calculadas no servidor (papel do usuário mais as exceções concedidas, menos
as revogadas; `executar` implica `ver`). Um hook único, `usePermissoes()`, carrega essa lista uma vez
por sessão (e de novo quando o token muda) e alimenta a nav, os cards da home, o guard de página e os
botões de ação. O front não recalcula nada.

**Home.** Os cards Permutas, SISPAG e Adiantamentos seguem a mesma regra do `:ver` correspondente (o
esmaecimento do SISPAG por flag continua como está); o card de Operação segue `operacao:ver`, e o de
administração, `usuarios:gerenciar`.

**Guard de página.** `/permutas`, `/permutas/borderos`, `/permutas/clientes-filtro`, `/sispag`,
`/recebimentos`, `/metricas` e `/usuarios`, abertas direto pela URL sem a permissão da tabela acima,
mostram só o estado vazio **"Você não tem acesso a esta área."** com link para a home. Não há
redirecionamento silencioso, e a página não dispara as chamadas de dados do módulo. `/operacao`
continua tratando o 404 do backend como "não existe" (ADR-0042).

A marca do header é link para `/`; `/` não é item de sidebar.

## Invariantes do fluxo

- **Nenhuma leitura de domínio.** A moldura não busca dado de negócio. A única chamada é
  `GET /me/permissoes`, que decide a visibilidade de todos os itens condicionados.
- **Permissão esconde, nunca desabilita** (`docs/design-system/feedback.md`). Nenhum item, card ou
  botão usa `disabled` para expressar permissão: sem a permissão, some. Os gates do front são de
  **ergonomia**; o gate real é server-side em todos (ADR-0053): cada rota do backend exige a sua
  permissão (403 com o código da permissão), `/operacao` responde 404 sem `operacao:ver`, e
  `SISPAG_ENABLED` / `RECEBIMENTOS_ENABLED` barram antes da permissão. Front desatualizado esconde ou
  mostra um item; não abre porta.
- **Falha fechada nas permissões.** Consulta que falha deixa o conjunto vazio: os itens condicionados
  ficam escondidos e a tela não quebra. Um item que some é irritante; um item que aparece e leva a um
  403 ou 404 parece defeito. Enquanto a consulta está pendente, nenhum item condicionado aparece para
  depois sumir (sem pisca).
- **Compatibilidade com backend antigo.** Se `/me/permissoes` não trouxer a lista `permissoes`
  (backend anterior à ADR-0053), o front cai no comportamento legado: tudo para `role === 'admin'` no
  token, e Operação conforme a chave `operacao`. Sai no tweak que remover essa chave.
- **Bypass de dev.** Com `DEV_AUTH_BYPASS` (só local/dev), `usePermissoes()` devolve o catálogo
  inteiro.
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
src/frontend/components/nav/app-nav.tsx        # modelo de itens + gating por permissão
src/frontend/components/ui/sidebar.tsx         # organism (+ resolveActiveItemId)
src/frontend/components/ui/nav-item.tsx        # molecule
src/frontend/components/ui/bottom-nav.tsx      # variante mobile
```

## Backlog (não nesta fatia)

Home como fila de trabalho · badges com contagem real vinda de endpoint (a prop `badge` já existe
e está sem consumidor, de propósito) · paleta de comandos ⌘K · dark mode · `SettingsSidebar` quando
existir uma área de configurações · popover de sub-items com a sidebar colapsada.
