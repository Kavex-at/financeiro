# Frente V — Plano de frontend + contrato de API refinado

> **Sessão:** Onda 0 · S4 (`frente-v-prompts-sessoes.md:106`). **Data:** 2026-08-19.
> **Escopo:** o que existe hoje no frontend, o checklist que o `DesignSystemReviewer` vai cobrar,
> a proposta de UI das duas telas, e o **contrato de API v1** — que corrige o v0 do
> `frente-v-orquestracao.md:§5` item a item.
> **Somente leitura.** Nenhum arquivo de código foi tocado nesta sessão.
> **Insumos:** `frente-v-probe-resultado.md` (fatos de produção), `frente-v-anatomia-slice.md`
> (§9 mapeou o frontend — aqui está o aprofundamento, com as correções do que estava errado lá).

---

## Sumário executivo — as 8 decisões que este doc trava

| # | Decisão | Consequência |
|---|---------|--------------|
| 1 | **Paginação e ordenação no SERVIDOR**, reusando a *casca* `FiltroBarra`/`Paginacao` via adaptador | 23.632 títulos só na filial 2 — o `useTabelaFiltro` atual é 100% client-side (`tabela-filtro.tsx:46-55`) e não serve |
| 2 | **`etapaAtual` vira `etapasAtuais[]`** | O probe achou 177 etapas em 148 títulos: etapas paralelas existem, e o v0 só cabia uma |
| 3 | **`origem: 'ERP'\|'DERIVADO'` vira objeto com `campoFonte`/`metodo`** | Um enum de duas letras não é auditável: o analista precisa saber *qual campo* ou *quais dois snapshots* |
| 4 | **`lacunas: string[]` vira `Lacuna[]` estruturada**, e vaza para o item da lista | String livre não é testável, não filtra e não pinta ícone no grid |
| 5 | **Não existe denominador de etapas** — a UI nunca mostra `2/3` | O ERP não declara o total planejado. Mostrar fração inventa precisão (armadilha #1 do `anatomia-slice.md:§12`) |
| 6 | **`dataFinalizacao` vira `marcoZero` com proveniência** | `docDtaFinalizacao` **não vem** na projeção que temos (`probe-resultado.md:§3`). O caso canônico do cliente depende dela |
| 7 | **Chips de status via `Badge` outline + ícone + tooltip**, no idiom já existente | `status-badges.tsx:51-71` já resolveu; copiar, não inventar |
| 8 | **`DateFormatter` novo em `lib/datetime.ts`** com fuso fixo `America/Sao_Paulo` | O DS exige (`patterns.md:488-509`) e **não existe no repo** — e a Frente V é a única frente cujo produto *é* a hora |

---

# 1. Levantamento do que existe

## 1.1 Correções ao §9 do `frente-v-anatomia-slice.md`

Três afirmações do mapa anterior estão erradas ou incompletas. Corrigir antes que virem tarefa:

| Afirmação em `anatomia-slice.md:§9` | Realidade | Evidência |
|---|---|---|
| *"`components/AppShell.tsx` — é onde entra o item de menu da Frente V"* | ❌ **O `AppShell` não tem menu nenhum.** São 47 linhas: header sticky com logo, versão e `UserMenu`. A navegação entre frentes é feita por **cards na home** | `components/AppShell.tsx:20-46`; `app/page.tsx:23-81` |
| *"Componentes compartilhados: … `date-picker`, `combobox`, `multi-select`"* | ⚠ existem, mas **não existe `Sheet`/`Drawer`** — o `component-mapping.md:16` manda usar `Sheet` para detalhe lateral e a primitiva não foi criada | `components/ui/` (lista completa em §1.2); `components/ui/dialog.tsx` é o único overlay |
| *"a tabela é própria"* | ✅ correto, mas o alcance é maior: **não existe `DataTable`**. Só as primitivas `<Table>`/`<TableHead>`/`<TableCell>` (38 linhas). Todo grid do repo é `<table>` montado à mão | `components/ui/table.tsx:1-38` |

Duas consequências diretas para a Frente V:

- **O item 22 do checklist do `anatomia-slice.md:§11` ("`components/AppShell.tsx` — editar: item de menu") está errado.** O ponto de entrada é `app/page.tsx`: um quarto `<Card>` com `<Link href="/aprovacoes">`.
- **`TB1` do `DesignSystemReviewer` ("use `DataTable` compound; não escreva `<table>` inline") é dívida herdada, não regra viva neste repo.** A Frente V segue o padrão real (`<Table>` primitivo) e registra a divergência — ver §2.3.

## 1.2 Inventário com `arquivo:linha`

### Casca e navegação

| Peça | Arquivo:linha | Nota para a Frente V |
|---|---|---|
| Shell (header + versão + `RouteGate`) | `components/AppShell.tsx:13-46` | Nada a editar |
| Landing / navegação entre frentes | `app/page.tsx:23-81` | **Adicionar card "Aprovações"** aqui |
| Gate de rota autenticada | `components/auth/RouteGate.tsx` (via `AppShell:43`) | Herdado de graça |
| Título da aba (server component) | `app/recebimentos/layout.tsx:9-11` | **Molde exato** do `app/aprovacoes/layout.tsx` — `page.tsx` é `'use client'` e o Next ignora `metadata` nele |
| Feature flag de frente | `lib/features.ts:11-16` (`isSispagEnabled`) e o comentário `:18-25` explicando por que a Frente IV **não** tem flag no FE | Ver §7 — decisão pendente |

### Padrão de página (o molde a copiar)

`app/recebimentos/page.tsx` é o exemplar mais recente e o mais próximo do que a Frente V precisa:

| Elemento | Linha | Observação |
|---|---|---|
| `'use client'` | `:1` | Toda página de dados é client component |
| Estado no nível da página (page-as-maestro) | `:109-117` | `painel`, `loading`, `error`, `statusFiltro`, `aba`, `alocarTxn` |
| `carregar` em `useCallback` + `useEffect` | `:119-135` | **Sem SWR/react-query no repo** — `fetch` manual em efeito |
| `PageHeader` com "carteira de \<data\>" no subtítulo | `:210-234` | **Precedente direto do `snapshotEm`** da Frente V |
| Botão "Recarregar" com `disabled={loading}` | `:224-231` | |
| Skeleton de primeira carga | `:94-106`, aplicado em `:236-237` | `aria-busy` + `aria-label` no wrapper |
| Estado de erro com retry | `:238-248` | `EmptyState` + botão "Tentar de novo" |
| Banner de lista truncada | `:251-259` | **Molde do banner de snapshot velho** |
| `KPIGrid` com KPIs clicáveis → filtro | `:262-319` | `active={statusFiltro === '…'}` + `onClick` |
| Aviso escrito no código sobre KPI sempre-zero (ADR-0034) | `:272-277` | **Regra de ouro:** não oferecer filtro/KPI sem produtor |
| Filtro por chips de status (server-side) | `:338-359` + `lib/recebimentos.ts:172` | O comentário explica por que migrou de client → server |
| Tabela | `:374-463` | `overflow-x-auto rounded-lg border` + `<Table>` |
| Empty vs no-results distintos | `:361-372` | `transacoes.length === 0` decide a mensagem — **exatamente o `patterns.md:251-258`** |
| Paginação no rodapé | `:465` | `<Paginacao aba={abaTransacoes} />` |

### Grid, filtro e paginação compartilhados — `app/permutas/components/tabela-filtro.tsx`

Reuso obrigatório (`anatomia-slice.md:§12.5`), já consumido por duas frentes
(`app/recebimentos/page.tsx:39`, `app/sispag/page.tsx:53`).

| Export | Linha | O que faz | **Limite que a Frente V esbarra** |
|---|---|---|---|
| `useTabelaFiltro<T>` | `:34-82` | filtro por filial + busca textual + paginação | **Tudo em memória**: `items.filter(...)` `:46-52`, `filtrados.slice(...)` `:55`. Pressupõe o dataset inteiro carregado |
| `TabelaFiltro<T>` (interface) | `:15-28` | contrato de estado (`slice`, `total`, `totalPaginas`, `paginaAtual`, `pageSize`, `filiais`, `setFilial`, `setBusca`, `setPagina`) | É **só uma interface** — nada impede uma implementação server-side |
| `FiltroBarra<T>` | `:85-121` | `<Select>` de filial + `<Input>` de busca, com `aria-label` | Monta as opções de filial a partir de `aba.filiais`, que vem de `items` `:57-59` — **com paginação de servidor isso mostraria só as filiais da página atual** |
| `Paginacao<T>` | `:124-157` | "Mostrando 1–20 de 300" + Anterior/Próxima | Puramente apresentacional sobre a interface. **Reusável sem alteração** |
| Reset de página ao trocar filtro | `:60-67` | `setFilial`/`setBusca` forçam `setPagina(1)` | Comportamento correto, replicar |

**Conclusão operacional:** `FiltroBarra` e `Paginacao` são reusáveis **como estão**; `useTabelaFiltro`
não é. A Frente V escreve `useAprovacoesQuery` que **devolve o mesmo shape `TabelaFiltro<T>`** —
assim os dois componentes de apresentação seguem funcionando sem uma linha de mudança, e o
`FiltroBarra` recebe `filiais` de fora (do backend), não da página. Detalhe em §6.

### Estados de loading / erro / vazio

| Estado | Componente | Arquivo:linha |
|---|---|---|
| Loading (1ª carga) | `Skeleton` (`bg-accent animate-pulse rounded-md`) | `components/ui/skeleton.tsx:3-5`; uso: `app/recebimentos/page.tsx:94-106` |
| Erro | `EmptyState` + `<Button>` retry | `app/recebimentos/page.tsx:238-248` |
| Vazio genuíno vs. no-results | `EmptyState` com mensagem condicional | `app/recebimentos/page.tsx:361-372` |
| `EmptyState` (primitiva) | `title` + `description` + `icon` + `action` | `components/ui/empty-state.tsx:16-39` |
| Aviso não-bloqueante (banner) | `div` com `border-info/40 bg-info/5` | `app/recebimentos/page.tsx:252-259` |
| Toast | `sonner` (`toast.success`/`toast.error` com `description`) | `app/recebimentos/page.tsx:172-183` |

> ⚠ **Não há `useDelayedLoading`** (`skeleton.md:264-272` pede) nem `Skeleton.Table`/`Skeleton.KPICard`
> (`skeleton.md:63-137` pede). Os skeletons do repo são `<Skeleton className="h-24 w-full" />` à mão.

### "Drawer" de detalhe — não existe; o padrão real é **expansão de linha**

O `component-mapping.md:16` prescreve `Sheet` (slide-over). **Nenhum `Sheet` foi criado.** O que existe:

| Padrão | Arquivo:linha |
|---|---|
| Expansão de linha (chevron rotativo + `<TableRow>` extra com `colSpan`) | `app/permutas/components/VisaoGeralTable.tsx:94-152` |
| `aria-expanded` na linha clicável | `VisaoGeralTable.tsx:100`, `:212` |
| Chevron `rotate-90` quando aberto | `VisaoGeralTable.tsx:109-115` |
| Grid `<dl>` de rótulo/valor no painel expandido | `VisaoGeralTable.tsx:131-152` + `Campo` em `app/permutas/components/ui.tsx:149-164` |
| Overlay modal (`Dialog`) com foco preso, ESC, `max-h-[85vh]`, corpo rolável | `components/ui/dialog.tsx:59-126` |
| Menu de linha (3 pontinhos) sobre `Popover`, **porque não há `DropdownMenu`** | `app/recebimentos/components/AcoesLinhaMenu.tsx:26-33` |

### Formatação de moeda e data

| Helper | Arquivo:linha | Comportamento |
|---|---|---|
| `formatBRL(n)` | `lib/utils.ts:8-10` | `Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'})` |
| `formatNumber(n)` | `lib/utils.ts:32-37` | número pt-BR com 2 casas (moeda estrangeira) |
| `formatDate(str)` | `lib/utils.ts:12-25` | trata `YYYY-MM-DD` como data local (evita o off-by-one de UTC) |
| `parseBrl` / `maskBrl` / `numToMask` | `lib/brl.ts:10-27` | entrada monetária mascarada |
| `fmtData` local (recebimentos) | `app/recebimentos/page.tsx:52-53` | `toLocaleDateString('pt-BR', {timeZone:'UTC'})` |
| `fmtData` local (sispag) | `app/sispag/page.tsx:60-61` | idem, mas entrada em epoch ms |
| `tabular-nums` em toda célula numérica | `page.tsx:408`, `ui.tsx:139`, `:161` | |

> 🔴 **Nenhum helper formata HORA.** Todos os formatadores do repo cortam a hora de propósito
> (`timeZone: 'UTC'` é um truque para estabilizar o *dia*). A Frente V é a primeira frente cujo
> produto é `18:09` — precisa de `lib/datetime.ts` novo (§6, arquivo 1).

### Badges de status

| Peça | Arquivo:linha | Idiom |
|---|---|---|
| `Badge` primitivo (CVA, 4 variantes) | `components/ui/badge.tsx:6-29` | `[&>svg]:size-3` — ícone já dimensionado |
| `DomainChip` (núcleo compartilhado da Frente IV) | `app/recebimentos/components/status-badges.tsx:51-71` | `Badge variant="outline"` + `Icon aria-hidden` + label + `title` + `TooltipContent` |
| Comentário que fixa a regra de a11y | `status-badges.tsx:34-40` | *"status NUNCA só por cor — sempre ícone + texto + tooltip"* |
| `Record<Status, ChipSpec>` exaustivo | `status-badges.tsx:75-117`, `:160-185`, `:193-218`, `:227-246` | **Molde exato do `StatusWorkflowBadge`** |
| Idiom "não é fato / é palpite" = **tracejado** | `status-badges.tsx:140` (`previsao`), `:295` (`OrigemErpBadge`) | **Peça-chave para o `DERIVADO`** da Frente V |
| Badge de aging com faixas (verde/âmbar/vermelho) | `status-badges.tsx:324-348` (`AgingBadge`) | **Molde do "tempo parado"** |
| Badge de vencimento com faixas | `app/sispag/page.tsx:63-78` (`VencimentoBadge`) | vencido / ≤7d / resto |
| Badges de permutas (variante `*-subtle`) | `app/permutas/components/ui.tsx:21-132` | segunda gramática de cor no repo (fundo suave em vez de outline) |

> ⚠ **Colisão de vocabulário a evitar:** na Frente IV, `OrigemErpBadge` (`status-badges.tsx:289-301`)
> significa *"veio do ERP, ou seja, NÃO passou pela ferramenta"* e é pintado **tracejado/apagado**.
> Na Frente V, `ERP` é a fonte **autoritativa** e deve ser o traço **sólido**. Usar a palavra "origem"
> sozinha nas duas frentes com sentidos invertidos confundiria. Ver §3.2 (nomes adotados).

### Data fetching e tipos compartilhados com o backend

| Peça | Arquivo:linha | Nota |
|---|---|---|
| `apiFetch` — wrapper de `fetch` que centraliza 401 → `SessionExpiredError` | `lib/http.ts:28-35` | **Obrigatório**: nunca chamar `fetch` cru |
| `withAuthHeaders()` | `lib/auth/token.ts` (usado em `lib/recebimentos.ts:1`) | bearer JWT |
| Base URL | `lib/recebimentos.ts:14` — `NEXT_PUBLIC_API_URL \|\| 'http://localhost:3001'`, com `.replace(/\/$/,'')` | **Sem `/api`** — bate direto na raiz |
| Cliente por frente | `lib/recebimentos.ts`, `lib/sispag.ts`, `lib/api.ts` (permutas), `lib/usuarios.ts` | Frente V → `lib/aprovacoes.ts` |
| Convenção de tipos | `lib/recebimentos.ts:16-18`: *"FE não importa do backend (boundary), então os union types são replicados aqui, um-a-um"* | **Duplicação deliberada.** Repetir na Frente V |
| Query string | `URLSearchParams` + `params.size > 0 ? '?'+params : ''` | `lib/recebimentos.ts:167-173` |
| Erro | `throw new Error(\`API ${res.status}\`)` (às vezes com `detail` do corpo) | `lib/recebimentos.ts:177`; variante com detalhe em `lib/api.ts:43-50` |
| **Anti-padrão já corrigido** | `lib/recebimentos.ts:159-163`: o fallback silencioso para fixture foi **removido** — *"um analista olhando dados de demonstração achando que são reais é pior que uma tela vazia"* | **A Frente V não terá fixture de produção.** Nenhum |
| Normalização defensiva da resposta | `lib/recebimentos.ts:179-193` (`?? []`, `?? {}`) | Repetir |

### Testes de frontend

| Convenção | Onde |
|---|---|
| Runner | `jest` + `ts-jest` + `jsdom`; `moduleNameMapper` `^@/(.*)$` | `jest.config.js:1-11` |
| Polyfills Radix (ResizeObserver, pointer capture, scrollIntoView) | `jest.setup.ts:4-25` |
| Teste colocado ao lado | `app/recebimentos/page.test.tsx`, `components/status-badges.test.tsx`, `NdeTable.test.tsx`, `FalhasTable.test.tsx`, `AlocarProcessosDialog.test.tsx` |
| Testes de lib | `lib/recebimentos.test.ts`, `lib/utils.test.ts`, `lib/features.test.ts` |
| Testes transversais | `__tests__/` (auth, http, ui-primitives, smoke) |
| Mock do módulo de API | `jest.mock('@/lib/recebimentos', …)` com `jest.requireActual` para preservar o resto | `app/recebimentos/page.test.tsx:9-15` |
| `act()` no mount por causa do fetch em efeito | `page.test.tsx:23-27` |
| Asserção por papel acessível, não por classe | `getByRole('heading', {level:1})`, `getAllByRole('columnheader')` | `page.test.tsx:33`, `:53` |
| **Gate de cobertura no CI** | `lines 20 / branches 9 / functions 14` global | `jest.config.js:36-43` — **não regredir** |

---

# 2. Design System — o checklist exato que o `DesignSystemReviewer` vai cobrar

Fonte: `.claude/agents/design-system-reviewer.md:37-126` (as regras), `src/frontend/docs/design-system/*`
(a norma citada), `ontology/design/taste-profile.md` e `ontology/design/component-mapping.md`.

## 2.1 Regras que a Frente V **tem de cumprir** (com o que fazer)

| ID | Regra | O que a Frente V faz |
|---|---|---|
| **P1** Data-first | dado ≤1 clique, padding econômico | Grid denso; a trilha abre **na própria linha** (expansão) — 1 clique |
| **P2** KPIs sempre | página de listagem abre com `KPIGrid` refletindo os filtros | 6 KPIs (§3.1.2), calculados **no backend** sobre a janela inteira, não sobre a página |
| **P3** Page-as-maestro | filtros/seleção/dados no `page.tsx`; filhos emitem eventos | `app/aprovacoes/page.tsx` detém tudo; `AprovacoesTable` e `TrilhaTimeline` são puros |
| **P4** Environment-aware | zero `#hex`; tokens semânticos | Só `text-foreground`, `border-info/40`, `bg-warning-subtle`, etc. |
| **T1–T7** Tokens | sem cor/espaçamento/tipografia/raio/sombra literais | Paleta disponível em `app/globals.css:28-45`: `success`, `warning`, `danger`, `info`, `permuta`, cada um com `-subtle` e `-foreground` |
| **A2–A6** Atomic | átomo sem lógica; **página** faz fetch | `components/` da frente = moléculas/organismos puros; fetch só em `page.tsx` |
| **C3** Reuso antes de criar | procurar em `components/ui/` e nas outras frentes primeiro | Reusa `FiltroBarra`, `Paginacao`, `Badge`, `EmptyState`, `PageHeader`, `KPIGrid`, `Table`, `Skeleton`, `Popover`, `Tooltip`, `Select`, `date-picker`, `multi-select` |
| **AC1** Foco visível | | Herdado de `Button`/`Input`; linha expansível é `<button>` ou `<tr>` com `tabIndex` |
| **AC5/AC6** Semântica | `<th scope="col">`, `aria-label` na tabela | `<Table>` não põe `scope` — **adicionar explicitamente** |
| **AC7** Ícones | `aria-hidden` em decorativo, `aria-label` em acionável | idiom já usado em todo o repo |
| **AC8** `prefers-reduced-motion` | | Nenhuma animação crítica; o chevron usa `transition-transform` (não essencial) |
| **PT1** Loading | `Skeleton` com a forma do conteúdo, **só na 1ª carga** | `AprovacoesSkeleton` espelhando KPIGrid + barra + 10 linhas |
| **PT2** Erro | informativo + retry | `EmptyState` + "Tentar de novo" (molde `page.tsx:238-248`) |
| **PT3** Vazio | `EmptyState`, **dois textos distintos** (`patterns.md:251-258`) | "nenhum título no período" vs "nenhum título com esses filtros" + botão "Limpar filtros" |
| **PT4** Deep-link | filtro/sort/página na URL | **`useSearchParams` + `router.replace`** — §3.1.4. Nenhuma frente do repo faz isso hoje; a Frente V é a primeira a cumprir |
| **K1–K4** KPIs | `KPIGrid` no topo; valor é a maior tipografia; clicável alterna filtro com `active` visível | `SimpleKPI` (`components/ui/kpi-card.tsx:167-179`) já entrega tudo |
| **S1–S3** Skeleton | variante co-localizada, mesma forma, shimmer do DS | `AprovacoesTable.Skeleton` no mesmo arquivo |
| **M3** Modal | `aria-label` no fechar, ESC | Se houver overlay, usar `components/ui/dialog.tsx` (já conforme, `:83-89`) |
| **TB3** Paginação | *"server-mode preferred for >100 rows"* | ✅ é o motivo da decisão #1 |
| **TB5** Expansão de linha | slot documentado | `table.md:481-486`: chevron no início, conteúdo abaixo, **estado não persiste** |

### Do `taste-profile.md` (o gosto, não a norma)

- **Clareza > beleza; densidade informacional é boa** → tabela densa, não cards.
- **`taste-profile.md:29`: "Listas de registros → tabela com paginação server-side"** — reforça a decisão #1.
- **`taste-profile.md:30`: "Status → Badge colorido (não ícone isolado)"**.
- **`taste-profile.md:38`: "Não usar cards onde tabela resolve"** → a timeline é `<ul>`, não uma pilha de `<Card>`.
- **`taste-profile.md:39`: "Não adicionar ícones decorativos sem função"** → cada ícone da timeline carrega significado (tipo de evento / fonte do dado).
- **`taste-profile.md:40`: "Não truncar valores monetários"** → `formatBRL` completo, `tabular-nums`, alinhado à direita.
- **Ações destrutivas sempre com dialog** → **não se aplica**: a Frente V é read-only (D2). Zero `AlertDialog`.

### Do `component-mapping.md`

| Conceito | Componente mandado | Situação real | Decisão da Frente V |
|---|---|---|---|
| Status de entidade | `Badge` | ✅ existe | `StatusWorkflowBadge` sobre `Badge` |
| Lista de registros | `DataTable` server-side | ❌ **não existe** | `<Table>` primitivo + `Paginacao` (§2.3) |
| Histórico / linha do tempo | **`Timeline` (custom), baseado em `ul` com CSS** | ❌ não existe | **Criar `TrilhaTimeline` como `<ol>` semântico** — é literalmente o que o mapping manda |
| Preview / detalhe lateral | `Sheet` (slide-over), não modal | ❌ não existe | **Expansão de linha** (padrão real do repo, `VisaoGeralTable.tsx:128-131`) — preserva contexto igual, sem criar primitiva nova. Divergência registrada em §7 |
| Filtros de lista | `Popover` + `Checkbox` multi-select | ✅ `multi-select.tsx` existe | usar para filial / etapa / aprovador |
| Loading | `Skeleton` só na 1ª carga | ✅ | |
| Estado vazio | `EmptyState` sempre com porquê + próximo passo | ✅ | |
| Indicador numérico | `KpiCard` | ✅ | |
| Notificação de erro | `Toast` (sonner) | ✅ | só para falha de ação; **erro de carga é banner/EmptyState**, não toast |

## 2.2 Regras que a Frente V **não** cumpre — e por quê (declarar antes da review)

| ID | Regra | Por que não se aplica |
|---|---|---|
| **F1–F5** Forms | react-hook-form + Zod | **Não há formulário.** Os filtros são controles isolados (`Select`, `Input`, `date-picker`), não um form submetido. Montar RHF aqui seria cerimônia sem submit |
| **M1/M2** Modais destrutivos | `DestructiveConfirmDialog` | **Read-only.** Nenhuma ação muda estado |
| **TB4** Bulk actions | | Sem ações ⇒ sem seleção em massa ⇒ sem checkbox de linha |
| **PT5** localStorage versionado | | Fase 1 não persiste preferência. Se o `pageSize` vier a persistir, seguir `principles.md:157` (`ds:aprovacoes:<userId>:v1`) |
| **PT6** Cache entre remounts | | O repo não tem SWR/react-query. Manter o padrão `useEffect` das outras frentes; introduzir uma lib de cache só na Frente V criaria duas gramáticas de fetch |

## 2.3 Divergências conhecidas do DS — declarar como **dívida herdada**, não como violação nova

O `DesignSystemReviewer` vai apontar estas. A resposta é a mesma para as três: **a norma descreve um DS
que este repo não implementou**, e a Frente V segue o padrão real das outras quatro frentes.

| Regra | Norma | Realidade do repo | Postura |
|---|---|---|---|
| **C1/TB1** | `<DataTable.Client>` / `<DataTable.Server>` compound (`table.md:533-549`) | Não existe. `components/ui/table.tsx` são 7 primitivas | Seguir o padrão real. **Não** criar um `DataTable` genérico dentro da Frente V — seria uma quinta gramática de tabela |
| **PT1/S1** | `Skeleton.Table`, `Skeleton.KPICard`, `useDelayedLoading` (`skeleton.md:63-137`, `:264-272`) | Não existem | Skeleton à mão, no idiom de `page.tsx:94-106` |
| **§17 patterns** | `DateFormatter` de `@/shared/lib/datetime` | Não existe; nem o alias `@/shared` | **Criar `lib/datetime.ts` com a API exata da spec.** É o único caso em que a Frente V *paga* a dívida, porque hora é o produto (§6, arquivo 1) |
| **`component-mapping.md:16`** | `Sheet` para detalhe lateral | Não existe | Expansão de linha (§7, PV-3) |
| **`@radix-ui/react-dropdown-menu`** | menus | Não é dependência (`package.json`) — `AcoesLinhaMenu.tsx:26-33` explica | Sem menu de linha na Frente V (read-only) |

---

# 3. Proposta de UI

## 3.0 Nome, rota e vocabulário

- **Slug `aprovacoes`** (já justificado em `anatomia-slice.md:§11`). Rota `/aprovacoes`.
- **H1 e título da aba: "Aprovações a Pagar".** Não "Workflow" — `taste-profile` e o CLAUDE.md
  privilegiam vocabulário de domínio; "workflow" é jargão de ferramenta.
- **Subtítulo:** `Trilha de aprovação dos títulos a pagar (Frente V) · snapshot de DD/MM/AAAA HH:mm`
  — espelha o "carteira de …" de `app/recebimentos/page.tsx:212-218`.

## 3.1 Tela 1 — Grid

### 3.1.1 Colunas: justificativa uma a uma

Ordem da esquerda para a direita = ordem de leitura do analista: *onde* → *o quê* → *quanto* →
*em que pé* → **há quanto tempo**.

| # | Coluna | Prioridade (`table.md:624-628`) | Justificativa | Render |
|---|---|---|---|---|
| 1 | **Filial** | **high** | R15 do doc de orquestração: consultar a trilha com o `filCod` errado devolve `count: 0` **sem erro**. A filial é a chave que impede o falso negativo, e o painel é multi-filial por RBAC (`routes/recebimentos.ts:69-75`) | `Filial 2` em `text-xs text-muted-foreground`; com nome quando o backend tiver |
| 2 | **Documento** | **high** | Identidade. **Funde `docCod` + `titCod` numa célula só** (`4156/1`) — são duas colunas em v0 e uma informação só; o par é como o ERP e o analista falam | `font-medium` + `tabular-nums`; ponto de venc. anexado (ver corte C2) |
| 3 | **Fornecedor** | **high** | O "quem cobra". É por ele que o analista busca quando o financeiro liga | `max-w-[18rem] truncate` + `title` completo |
| 4 | **Valor** | **high** | É o valor que **determina a alçada** (`FinTituloBloq.limitaAlcada`) — num painel de aprovação o valor não é enfeite, é a causa da etapa existir. `taste-profile.md:40`: nunca truncar | `formatBRL`, `text-right tabular-nums` |
| 5 | **Vencimento** | medium | Prioriza a fila: título parado na aprovação **e** vencendo é o caso urgente | `VencimentoBadge` (promovido de `app/sispag/page.tsx:63-78`) |
| 6 | **Finalização** | medium | Marco zero do relógio; é o "às 10:00 de 18/08" do caso canônico | `DateFormatter.toBR`; **com marca de proveniência** quando for substituto (§3.3) |
| 7 | **Status do WF** | **high** | Resposta de uma olhada: tem trilha? está parado? acabou? | `StatusWorkflowBadge` |
| 8 | **Etapa atual** | **high** | *Onde* está preso. O probe achou 11 etapas distintas — não é um fluxo único | nome da etapa; se houver >1 aberta, `+N` com tooltip listando |
| 9 | **Aprovador atual** | **high** | *Com quem* está preso. `DANILO_LARA` = 48% das etapas: o gargalo é uma pessoa, e o painel precisa deixar isso à vista | nome; `sem aprovador` em âmbar quando vazio |
| 10 | **Tempo parado** | **high — é a coluna-produto** | Mediana 2,5h, p90 70h, máx 234h: a distribuição é o achado. A UI **não pode** resumir isso numa média | `TempoParadoBadge` com faixas calibradas nos números reais (abaixo) |
| 11 | **Etapas** | low | "aprovações concluídas/necessárias" do enunciado — **mas sem denominador** (ver ⚠) | `2 ok · 1 aberta` |
| 12 | *(sem cabeçalho)* **Lacunas** | medium | Marca a linha cujo dado tem buraco. Sem isso o analista lê um tempo incompleto como se fosse completo | ícone `TriangleAlert` âmbar + `aria-label`; some quando não há |

**Faixas do `TempoParadoBadge`** — derivadas dos percentis medidos (`probe-resultado.md:§2`), não de palpite:

| Faixa | Regra | Token | Racional |
|---|---|---|---|
| normal | ≤ 4h | `border-success/40 text-success` | acima da mediana (2,5h), ainda dentro do dia |
| atenção | 4h – 72h | `border-warning/40 text-warning` | 72h ≈ p90 (70h): entrar aqui é sair do comportamento típico |
| cauda | > 72h | `border-danger/40 text-danger` + ícone `AlertTriangle` | é a cauda de 10 dias que justifica o painel existir |

> ⚠ **Por que não existe "3 de 5 aprovações".** O ERP não declara um total planejado de etapas —
> `fin026/infoTitulo/list` devolve **as etapas que existem agora**, e `regerarBloqueios` pode
> reescrevê-las (R3). Um denominador seria inventado. A célula mostra o que é fato:
> `2 concluídas · 1 aberta`. Se o `fin103` for liberado e trouxer `wffUuid`/`acdCod`, aí sim dá para
> falar em "trilha planejada" — e o contrato já reserva o campo (`etapas.totalEhDefinitivo`).

### Ordem de corte, se ficar larga demais

Critério: cortar primeiro o que **já está a um clique** (na trilha expandida) ou o que **é derivado
de outra coluna visível**. Nunca cortar as sete `high`.

| Corte | Coluna | Para onde vai | Por quê |
|---|---|---|---|
| **C1** | **Finalização** (#6) | trilha expandida (é o primeiro evento dela) e tooltip do "Tempo parado" | O tempo parado **já é** a leitura útil do marco zero. O timestamp absoluto interessa na auditoria, não na varredura |
| **C2** | **Vencimento** (#5) | vira um ponto colorido colado ao número do documento, com tooltip | Só importa quando é ruim (vencido / ≤7d). Uma coluna inteira para um sinal binário é caro |
| **C3** | **Etapas** (#11) | sufixo da "Etapa atual": `CONTROLLER (2ª aberta)` | É contexto da etapa, não um eixo próprio |
| **C4** | **Filial** (#1) | **só** quando o usuário tiver uma única filial acessível (`filiaisPermitidas(user)`) — aí a coluna é constante | Coluna constante não informa (a lição da coluna "Tipo" removida em `app/recebimentos/page.test.tsx:46-56`) |

Com C1–C4 aplicados: **8 colunas** — Documento · Fornecedor · Valor · Status · Etapa atual ·
Aprovador · Tempo parado · ⚠. Cabe confortavelmente em 1280px.

### 3.1.2 KPIs (P2 / K1–K4)

`KPIGrid columns={3}` (duas linhas de 3 em desktop). Todos contados **no backend sobre a janela
filtrada inteira**, nunca sobre a página — a lição escrita em `app/recebimentos/page.tsx:139-152`.

| KPI | Valor | Cor | Clique → filtro | Por que existe |
|---|---|---|---|---|
| Aguardando aprovação | `n` | `warning` | `status=AGUARDANDO` | a fila de trabalho |
| Parados > 72h | `n` | `danger` | `paradoAcimaDeHoras=72` | **a cauda.** É o KPI que a distribuição assimétrica exige |
| Sem workflow | `n` | `default` | `status=SEM_WORKFLOW` | ~50,7% da amostra. Não é erro — é uma classe de título, e "por que este não passou por aprovação?" é pergunta de negócio |
| Concluídos no período | `n` | `success` | `status=CONCLUIDO` | denominador da leitura |
| Tempo mediano de aprovação | `2h30` | `info` | *(não clicável)* | a métrica-produto. **Mediana, não média** — a média de 20,4h esconde que metade sai em 2,5h |
| Com lacunas | `n` | `warning` | `comLacunas=true` | honestidade do dado; se subir, o job de ingestão está com problema |

> **P90 no rodapé do KPI de mediana** (`footer="p90 70h · máx 234h"`). Uma linha de texto torna a
> cauda visível sem gastar um card — e impede a leitura "mediana 2h30, então está tudo bem".

### 3.1.3 Filtros, busca e ordenação

**Barra de filtro** (reusa `FiltroBarra` para filial+busca, acrescenta os demais ao lado):

| Filtro | Controle | Nota |
|---|---|---|
| Filial | `Select` do `FiltroBarra` | opções vindas do **backend** (`filiaisDisponiveis`), não da página atual |
| Busca | `Input` do `FiltroBarra`, **debounce 300ms** (`patterns.md:460`) | casa `docCod`, `titCod` e nome do fornecedor. Placeholder: *"Buscar por documento, título ou fornecedor…"* |
| Período | `date-picker` de/até sobre o **marco zero** | default: últimos 90 dias (o probe amostrou desde 2025-08-01) |
| Status do WF | chips `Button` (`variant default|outline`) | **só renderiza o chip cuja faceta tem produtor** — ver ⚠ abaixo |
| Etapa | `multi-select` | 11 valores reais; alimentado por `facetas.etapas` |
| Aprovador | `multi-select` | 14 pessoas reais; alimentado por `facetas.aprovadores` |
| Fornecedor | `combobox` | busca assíncrona (universo grande) |
| Parado há mais de | `Select` (12h / 24h / 72h / 7d) | atalho para a cauda |
| Só com lacunas | `switch` | |

> ⚠ **A regra do ADR-0034, aplicada preventivamente.** `app/recebimentos/page.tsx:272-277` e
> `:68-74` documentam o erro de oferecer um filtro sem produtor: *"um filtro que nunca casa ensina
> o analista a desconfiar de todos os outros"*. Hoje **não há evidência de rejeição** nos dados
> (só `LIBERAR` 122 e `APROVAR` 34; `ftbVldStatus` ∈ {1, 2, 7}). Por isso o chip `REJEITADO` **não
> é renderizado** enquanto `facetas.status.REJEITADO` for `undefined`. O contrato mantém o valor no
> union (para quando aparecer), a UI só o exibe quando existir.

**Ordenação.** Colunas ordenáveis: Tempo parado, Valor, Vencimento, Finalização, Fornecedor.
Cabeçalho vira `<button>` com `aria-sort` (`table.md:618`). **Default: `tempoParado` desc.**
Justificativa: o painel é uma fila de trabalho sobre uma distribuição de cauda longa — abrir por
"mais recente" enterraria exatamente os títulos de 234h que motivam a ferramenta.

### 3.1.4 Deep-link (PT4)

Parâmetros curtos e estáveis (`patterns.md:110-116`), `router.replace` (não empilha histórico):

```
/aprovacoes?de=2026-05-01&ate=2026-08-19&fil=2&st=AGUARDANDO&etapa=CONTROLLER,TI
           &aprov=DANILO_LARA&q=4156&parado=72&lac=true&ord=tempoParado&dir=desc&p=3&ps=25
```

Datas ISO date-only; arrays por vírgula; booleans `true`/`false`. **Nenhuma frente do repo faz isso
hoje** — a Frente V é a primeira a cumprir PT4, e o utilitário nasce reutilizável (`lib/url-state.ts`).

### 3.1.5 Wireframe ASCII — Tela 1

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Columbia Trading / Financeiro                                                        v0.27.0   [ YT ▾ ]   │
├───────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                           │
│  Aprovações a Pagar                                                                     [ ↻ Atualizar ]   │
│  Trilha de aprovação dos títulos a pagar (Frente V) · snapshot de 19/08/2026 14:03 (há 12 min)            │
│                                                                                                           │
│  ╔═════════════════════════════════════════════════════════════════════════════════════════════════════╗ │
│  ║ ⓘ  Snapshot de 12 min atrás. O ERP pode ter mudado desde então — esta tela não consulta o Conexos   ║ │
│  ║    ao vivo. Próxima ingestão prevista para 15:00.                                        [detalhes] ║ │
│  ╚═════════════════════════════════════════════════════════════════════════════════════════════════════╝ │
│                                                                                                           │
│  ┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐                                │
│  │ ● AGUARDANDO APROV.  ││ ● PARADOS > 72H      ││ ○ SEM WORKFLOW       │                                │
│  │        148           ││         37           ││        152           │                                │
│  │ na fila              ││ cauda — priorize     ││ nunca tiveram etapa  │                                │
│  └──────────────────────┘└──────────────────────┘└──────────────────────┘                                │
│  ┌──────────────────────┐┌──────────────────────┐┌──────────────────────┐                                │
│  │ ● CONCLUÍDOS         ││ ● TEMPO MEDIANO      ││ ● COM LACUNAS        │                                │
│  │        169           ││       2h30           ││         21           │                                │
│  │ no período           ││ p90 70h · máx 234h   ││ dado incompleto      │                                │
│  └──────────────────────┘└──────────────────────┘└──────────────────────┘                                │
│                                                                                                           │
│  Filial            Buscar                                    Período                                      │
│  [ Todas      ▾ ]  [ documento, título ou fornecedor…    ]   [ 01/05/2026 ] até [ 19/08/2026 ]           │
│                                                                                                           │
│  [Todos] [Aguardando] [Concluído] [Sem workflow] [Indeterminado]   Etapa[▾]  Aprovador[▾]  Parado há[▾]   │
│                                                                                        ( ) só com lacunas │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐ │
│  │ Fil │ Documento │ Fornecedor          │      Valor │ Status      │ Etapa atual │ Aprovador   │ Tempo parado ▼│ ⚠ │
│  ├─────┼───────────┼─────────────────────┼────────────┼─────────────┼─────────────┼─────────────┼───────────────┼───┤
│  │  2  │ 4156/1 ●  │ TRANSPORTADORA ABC… │ 128.400,00 │ ⏳Aguardando│ CONTROLLER  │ DANILO_LARA │ ⚠ 234h 24m    │ ⚠ │
│  │  2  │ 4188/1    │ CIA MARITIMA XYZ    │  12.900,50 │ ⏳Aguardando│ TI  +1      │ —           │ ⚠  96h 10m    │   │
│  │  1  │ 4201/2    │ DESPACHANTE SILVA   │   3.410,00 │ ⏳Aguardando│ FISCAL      │ ANA_BARCEL… │ ▲  6h 02m     │   │
│  │ ▸2  │ 4210/1    │ ARMAZEM GERAL LTDA  │  55.000,00 │ ✔ Concluído │ —           │ WALTER_CRO… │ ✓  1h 47m     │   │
│  │  3  │ 4219/1    │ SEGURADORA NACION…  │   8.220,00 │ ○ Sem WF    │ —           │ —           │ —             │   │
│  │  2  │ 4222/1    │ ALFANDEGA PORTO      │  91.000,00 │ ? Indeterm. │ —           │ —           │ —             │ ⚠ │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────┘ │
│  Mostrando 1–25 de 1.412            Página 1 de 57   [ Anterior ]  [ Próxima ]                            │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Legenda:  ● após o nº do documento = vencimento crítico (corte C2)   ▸ = linha expansível (trilha)
          ⚠ na coluna final = há lacunas no dado desta trilha
```

## 3.2 Tela 2 — Timeline da trilha

Abre **na própria linha** (expansão, `VisaoGeralTable.tsx:128-131`), em `<TableRow><TableCell colSpan>`.
O conteúdo é o organismo `TrilhaTimeline` — `<ol>` semântico, conforme `component-mapping.md:15`
(*"Timeline (custom), baseado em `ul` com CSS"*), **nunca** uma pilha de `<Card>` (`taste-profile.md:38`).

### 3.2.1 Anatomia de um evento

```
│
├─● 14/05 07:12:46   ETAPA ABERTA · CONTROLLER          [registro do ERP]
│  ┆                 alçada COMPRAS · aguardando DANILO_LARA
│  ┆                 ⏱ 3h 05m desde o marco zero
│
```

| Elemento | Conteúdo | Regra |
|---|---|---|
| Marcador | ícone por tipo de evento, dentro de um círculo | **nunca só cor** (`principles.md:149`) |
| Timestamp | `DD/MM HH:mm:ss` em `America/Sao_Paulo`, `tabular-nums` | segundos incluídos: é auditoria |
| Tipo | rótulo em maiúsculas | vem do enum, traduzido no FE |
| Ator | nome da pessoa (`usnDesNomeCmd`) | `—` quando ausente, **nunca** o rótulo de alçada no lugar da pessoa |
| Etapa | nome (`fblDesNome`) + alçada (`aprovador`) | os dois, porque o campo `aprovador` mistura setor e pessoa |
| Ação | `LIBERAR` / `APROVAR` | **duas ações distintas** — o probe provou; não fundir |
| Duração | `⏱ Xh Ym desde o evento anterior` | vem **calculada do backend** em segundos |
| **Fonte do dado** | chip `[registro do ERP]` ou `[inferido]` | §3.2.2 — obrigatório |

### 3.2.2 `ERP` vs `DERIVADO` — a marcação obrigatória

Requisito não-negociável do `frente-v-orquestracao.md:§5.1`. Três sinais redundantes por evento
(cor **não** é um deles, por `AC4`/`principles.md:149`):

| Sinal | `ERP` (registro) | `DERIVADO` (inferido por diffing de snapshots) |
|---|---|---|
| **Marcador** | círculo **preenchido**, borda sólida | círculo **vazado**, borda **tracejada** |
| **Conector vertical** | linha **sólida** (`border-l`) | linha **tracejada** (`border-l border-dashed`) |
| **Chip** | `[registro do ERP]` — `Badge variant="outline"` neutro | `[inferido]` — `Badge` **tracejado apagado**, ícone `GitCompare` |
| **Tooltip** | `Campo ftbTimBloq do Conexos (fin026/infoTitulo).` | `Inferido comparando os snapshots de 18/08 06:00 e 18/08 07:00. O Conexos não registra este instante.` |
| **Texto do timestamp** | normal | prefixado por `≈` |

> **Por que o tracejado.** O repo **já tem** esse idiom, e ele significa exatamente isto: em
> `status-badges.tsx:137-146` a modalidade em *previsão* é `border-dashed` com o rótulo prefixado
> por `~`, e o comentário diz: *"o `~` marca o palpite. A tela nunca pode pintar previsão com a
> mesma cara de fato."* A Frente V herda a gramática em vez de inventar outra.

> ⚠ **Nome dos componentes.** Chamar de `OrigemErpBadge` colidiria com
> `app/recebimentos/components/status-badges.tsx:289` — onde "origem ERP" é **tracejado** e significa
> "não passou pela ferramenta", o inverso do sentido aqui. Nomes adotados na Frente V:
> **`FonteEventoBadge`**, com rótulos `registro do ERP` / `inferido`. Nunca "origem" sozinho.

### 3.2.3 Os casos que a timeline precisa representar

| Caso | Representação |
|---|---|
| **Marco zero** (documento finalizado) | Primeiro item, marcador `Flag` maior, régua horizontal cheia, rótulo **`DOCUMENTO FINALIZADO — origem do relógio`**. Se o marco vier de campo substituto, chip `[origem do relógio: emissão]` + entrada em `lacunas[]` |
| **Bloqueio por alçada** | `ETAPA_ABERTA` com `alçada <rótulo> · limite R$ x` (quando o `fin103` liberar `limitaAlcada`); enquanto não houver, só o rótulo |
| **Etapas em paralelo** | Etapas com janelas sobrepostas entram num **agrupador**: um item pai `2 ETAPAS EM PARALELO` com um conector que se **bifurca** (dois `border-l` lado a lado, indentados) e reencontra no evento seguinte. Cada ramo é uma sub-lista `<ol>` com seus próprios eventos. **Nunca serializar** eventos paralelos numa lista única — isso faria a duração "desde o anterior" mentir |
| **Etapa cancelada** | `ETAPA_CANCELADA`, ícone `Ban`, texto com `line-through` no nome da etapa, motivo (`motDesNomeCanc`) na linha secundária, cor `danger` |
| **WF regerado** | **Divisor horizontal de largura total**: `── WORKFLOW REGERADO em 15/05 09:12 por FULANO ──`. Tudo **acima** dele colapsa num `<details>` fechado por padrão, rotulado `Trilha anterior (3 eventos) — substituída`, com `opacity-60`. O relógio **reinicia** no divisor, e o backend recalcula as durações a partir dali |
| **Etapa pendente** | Último item, marcador **pulsante** (`animate-pulse`, desligado sob `prefers-reduced-motion`), rótulo `AGUARDANDO <pessoa>` e `⏱ parado há 234h 24m`, cor da faixa do `TempoParadoBadge` |
| **Sem aprovador atribuído** | `AGUARDANDO — sem aprovador atribuído` em âmbar + lacuna `ETAPA_SEM_APROVADOR` |
| **Fim da trilha** | `TITULO_LIBERADO` com ícone `CheckCheck` e `Total: 23h 29m desde a finalização` |

### 3.2.4 Wireframe ASCII — Tela 2 (linha expandida)

Renderiza o **caso canônico de aceite** do cliente:

```
│  ▾2  │ 4156/1 ●  │ TRANSPORTADORA ABC… │ 128.400,00 │ ✔ Concluído │ —  │ DANILO_LARA │ ✓ 23h 29m │   │
├──────┴───────────┴─────────────────────┴────────────┴─────────────┴────┴─────────────┴───────────┴───┤
│                                                                                                       │
│  Trilha de aprovação — documento 4156, título 1, filial 2                     [ Copiar trilha ]      │
│                                                                                                       │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │ ⚠  Lacunas nesta trilha (2)                                                                   │   │
│  │    • O Conexos não expõe `docDtaFinalizacao` nesta projeção — o marco zero usa a data de       │   │
│  │      emissão do documento. O tempo total pode estar superestimado.                             │   │
│  │    • Não há registro do instante em que a etapa TI foi atribuída. A duração dessa etapa não    │   │
│  │      é apresentada.                                          [ Por que isso acontece? ]        │   │
│  └───────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                       │
│  ⚑══════════════════════════════════════════════════════════════════════════════════════════════     │
│  ●  18/08/2026  10:00:00   DOCUMENTO FINALIZADO — origem do relógio      [registro do ERP]           │
│  ┃                         por MARIANE_FIGA                                                          │
│  ┃                                                                                                   │
│  ●  18/08/2026  18:09:31   ETAPA ABERTA · CONTROLLER                     [registro do ERP]           │
│  ┃                         alçada COMPRAS · aguardando DANILO_LARA                                   │
│  ┃                         ⏱ 8h 09m desde o marco zero                                               │
│  ┃                                                                                                   │
│  ✔  19/08/2026  10:00:00   ETAPA RESOLVIDA · CONTROLLER  ·  LIBERAR      [registro do ERP]           │
│  ┃                         por DANILO_LARA                                                           │
│  ┃                         ⏱ 15h 50m nesta etapa                                                     │
│  ┃                                                                                                   │
│  ○  19/08/2026 ≈10:00:12   TÍTULO LIBERADO                               [inferido ⇄]  ← tracejado   │
│  ┋                         ⏱ Total: 24h 00m desde a finalização do documento                         │
│  ┋                         ⓘ Inferido comparando os snapshots de 19/08 10:00 e 19/08 11:00.          │
│                                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Variante com paralelismo e regeração:

```
│  ●  20/08  08:00:00   ETAPA ABERTA · FISCAL              [registro do ERP]                            │
│  ┣━━━┓                                                                                                │
│  ┃   ┃  2 ETAPAS EM PARALELO                                                                          │
│  ┃   ●  20/08 08:00:00  ETAPA ABERTA · TI          [registro do ERP]  aguardando —  ⚠ sem aprovador   │
│  ✔   ┃  20/08 09:12:03  ETAPA RESOLVIDA · FISCAL · APROVAR   por ANA_BARCELLOS   ⏱ 1h 12m             │
│  ┗━━━┫                                                                                                │
│  ─────┴─── WORKFLOW REGERADO em 20/08 14:30 por WALTER_CROCE ─────────────────────────────────────    │
│       ▸ Trilha anterior (3 eventos) — substituída                                    [expandir]       │
│  ●  20/08  14:30:11   ETAPA ABERTA · DIRETORIA II        [registro do ERP]                            │
│  ┋                    ⏳ AGUARDANDO RICARDO_PRADO · parado há 96h 10m                                  │
```

## 3.3 Estados de exceção

| Estado | Onde aparece | Tratamento | Regra que sustenta |
|---|---|---|---|
| **Sem workflow** (~50,7%) | grid + trilha | Grid: badge **neutro** `○ Sem WF`, sem tom de erro. Trilha: `EmptyState` — *"Este título não tem trilha de aprovação. Nenhuma etapa de bloqueio foi criada para ele no Conexos — o que é normal para títulos abaixo do limite de alçada."* | `patterns.md:255` (empty genuíno ≠ no-results); `empty-state.md` (sempre o porquê) |
| **WF regerado** | trilha | Divisor + colapso da trilha anterior (§3.2.3). Grid: sufixo `(regerado)` no chip de status, com tooltip | R3 |
| **Etapa sem aprovador** | grid + trilha | Grid: `—` em âmbar na coluna Aprovador. Trilha: `⚠ sem aprovador atribuído`. Vira lacuna `ETAPA_SEM_APROVADOR` | |
| **`lacunas[]`** | grid + trilha | Grid: ícone ⚠ na última coluna, `aria-label` com a contagem. Trilha: **banner persistente no topo** (não toast — o aviso precisa sobreviver à leitura). Cada lacuna vira uma linha com texto do backend | `frente-v-orquestracao.md:§5.2`; `patterns.md:262` (error banner preserva os dados) |
| **Snapshot atrasado** (idade > 2× o intervalo de ingestão) | banner de página, tom `info` | *"Snapshot de 12 min atrás… Próxima ingestão prevista para 15:00."* Dados continuam visíveis | `patterns.md:302` — polling/refresh **não** apaga o que está na tela |
| **Snapshot velho** (> 24h, ou última ingestão falhou) | banner de página, tom `warning` + ícone | *"O último snapshot tem 31h. Os tempos abaixo foram medidos contra ele e podem estar desatualizados."* + `[Ver histórico de ingestões]` | idem |
| **`INDETERMINADO`** | grid | Badge `? Indeterminado` neutro + tooltip com a razão do backend (`motivoIndeterminado`). **Não é erro** | `frente-v-orquestracao.md:§5.4` |
| **Cobertura parcial da varredura** | banner de página | Se a ingestão bateu o `MAX_PAGES` do `ConexosBaseClient.ts:113` (corta em 25k linhas **sem lançar**), o painel diz: *"A varredura desta janela foi truncada — há títulos não listados."* | armadilha #6 do `anatomia-slice.md:§12` |
| **Filial não autorizada** (403) | página | `EmptyState` "Sem acesso a esta filial" — não um erro genérico | `routes/recebimentos.ts:144-153` |
| **Sessão expirada** (401) | global | `apiFetch` já dispara o `SessionExpiredModal` (`lib/http.ts:30-33`) — nada a fazer | |

---

# 4. Contrato de API v1 — final

Rotas montadas **na raiz** (`src/backend/index.ts:81-125`), atrás de um gate por frente
(`http/aprovacoesGate.ts`, molde `http/recebimentosGate.ts:15`):

```
GET /aprovacoes                 → AprovacoesListResponse
GET /aprovacoes/:id/trilha      → TrilhaResponse
```

`:id` é `filCod-docTip-docCod-titCod`, ex. `2-2-4156-1` — **`-`, não `:`** (v0 usava `:`, que vira
`%3A` em `encodeURIComponent` e polui a URL e os logs). Validado por Zod: `/^\d+-\d+-\d+-\d+$/`.

## 4.1 Tipos finais

```ts
// ─────────────────────────────────────────────────────────────── enums e primitivas

/** Status agregado do workflow de um título. `REJEITADO` fica reservado: não há
 *  produtor observado em produção (probe 2026-08-18). A UI só o exibe se vier em `facetas`. */
export type StatusWorkflow =
    | 'SEM_WORKFLOW'
    | 'AGUARDANDO'
    | 'CONCLUIDO'        // v0 chamava APROVADO — ver mudança #6
    | 'REJEITADO'
    | 'CANCELADO'
    | 'INDETERMINADO';

/** Ação registrada pelo ERP na etapa (`fbaDesNome`). Aberto de propósito: o Conexos
 *  pode cadastrar novas ações sem avisar. O FE renderiza o rótulo cru quando não conhece. */
export type AcaoEtapa = 'LIBERAR' | 'APROVAR' | (string & {});

/** Situação de uma etapa (derivada de `ftbVldStatus`, cuja legenda é 1=pendente, 2=respondido;
 *  o valor 7 (13 ocorrências) ainda não tem legenda → `DESCONHECIDA`, nunca chutada. */
export type SituacaoEtapa = 'PENDENTE' | 'RESOLVIDA' | 'CANCELADA' | 'DESCONHECIDA';

/** Proveniência auditável de um dado. Substitui o enum `'ERP' | 'DERIVADO'` do v0. */
export interface Fonte {
    tipo: 'ERP' | 'DERIVADO';
    /** ERP: campo lido, ex. 'ftbTimBloq'. DERIVADO: undefined. */
    campoFonte?: string;
    /** ERP: endpoint, ex. 'fin026/infoTitulo/list'. */
    endpoint?: string;
    /** DERIVADO: como foi inferido, ex. 'diff-snapshot'. */
    metodo?: 'diff-snapshot' | 'substituicao-de-campo' | 'calculo';
    /** DERIVADO: os dois snapshots comparados (ISO 8601). Alimenta o tooltip de auditoria. */
    snapshotAnteriorEm?: string;
    snapshotPosteriorEm?: string;
}

/** Buraco conhecido no dado. Estruturado — o v0 usava `string[]`. */
export type LacunaCodigo =
    | 'MARCO_ZERO_SUBSTITUTO'      // docDtaFinalizacao indisponível; usou outro campo
    | 'MARCO_ZERO_AUSENTE'         // nenhum candidato
    | 'ETAPA_SEM_APROVADOR'
    | 'ETAPA_SEM_TIMESTAMP_ABERTURA'
    | 'ETAPA_STATUS_DESCONHECIDO'  // ftbVldStatus = 7
    | 'ACAO_NAO_REGISTRADA'        // fbaDesNome vazio (21 casos na amostra)
    | 'TRILHA_TRUNCADA'            // varredura bateu o teto de paginação
    | 'WORKFLOW_REGERADO';

export interface Lacuna {
    codigo: LacunaCodigo;
    /** Frase pronta em pt-BR, escrita pelo BACKEND. O FE não monta texto de lacuna. */
    mensagem: string;
    severidade: 'alta' | 'media' | 'baixa';
    /** Etapa afetada, quando aplicável (`fblCod:ftbCod`). */
    etapaRef?: string;
}

// ─────────────────────────────────────────────────────────────── GET /aprovacoes

export interface EtapaResumo {
    /** Chave natural da etapa dentro do título: `${fblCod}:${ftbCod}`. */
    ref: string;
    nome: string;                       // fblDesNome, ex. 'CONTROLLER'
    /** Rótulo de alçada (`aprovador`) — mistura setor e pessoa. NUNCA usar como identidade. */
    alcadaRotulo: string | null;
    situacao: SituacaoEtapa;
    aprovador: Ator | null;
    /** Quando a etapa foi aberta (ftbTimBloq). ISO 8601 com offset. */
    abertaEm: string | null;
    /** Segundos corridos desde `abertaEm` até `calculadoEm`. null quando `abertaEm` é null. */
    paradaHaSegundos: number | null;
    fonteAbertura: Fonte;
}

export interface Ator {
    /** `usnCodCmd` do Conexos. HOJE SEMPRE null — não vem na projeção acessível.
     *  O FE deve chavear por `id ?? nome` e nunca tratar `nome` como identidade estável. */
    id: number | null;
    nome: string;
}

export interface MarcoZero {
    em: string | null;                  // ISO 8601
    /** De onde saiu. `docDtaFinalizacao` é o correto; os demais são substitutos declarados. */
    campo: 'docDtaFinalizacao' | 'docDtaEmissao' | 'primeiroBloqueio' | null;
    fonte: Fonte;
    /** true quando `campo !== 'docDtaFinalizacao'` — a UI marca o valor. */
    substituto: boolean;
}

export interface AprovacaoListItem {
    /** `${filCod}-${docTip}-${docCod}-${titCod}`. Seguro para path param. */
    id: string;
    filCod: number;
    filialNome: string | null;
    docTip: number;                     // 2 = ENTRADA A PAGAR (explícito, era só implícito no id)
    docCod: number;                     // era `documentoNumero: string`
    titCod: number;                     // era `tituloNumero: string`
    /** Rótulo pronto para a célula: '4156/1'. */
    documentoLabel: string;

    fornecedorCod: number | null;
    fornecedorNome: string | null;
    valor: number;
    moeda: string;                      // 'BRL' em 100% da amostra; mantido explícito
    dataVencimento: string | null;      // ISO date-only (YYYY-MM-DD) — é DATE no ERP
    marcoZero: MarcoZero;               // era `dataFinalizacao: string | null`

    statusWorkflow: StatusWorkflow;
    /** Preenchido só quando `statusWorkflow === 'INDETERMINADO'`. Frase do backend. */
    motivoIndeterminado: string | null;
    /** true quando houve `regerarBloqueios` nesta trilha. */
    workflowRegerado: boolean;

    etapas: {
        concluidas: number;
        abertas: number;
        canceladas: number;
        /** Quantas o snapshot conhece. NÃO é um total planejado. */
        totalConhecido: number;
        /** Sempre `false` na Fase 1: o ERP não declara a trilha planejada. Reservado
         *  para quando o `fin103` liberar `wffUuid`/`acdCod`. */
        totalEhDefinitivo: boolean;
    };

    /** TODAS as etapas abertas — o v0 tinha um `etapaAtual` singular e o probe achou
     *  177 etapas em 148 títulos. Vazio quando não há etapa aberta. */
    etapasAtuais: EtapaResumo[];
    /** A mais antiga entre as abertas — o que a coluna do grid mostra. Redundante de
     *  propósito: evita que cada consumidor implemente "a principal" à sua maneira. */
    etapaAtualPrincipal: EtapaResumo | null;

    /** Ciclo FECHADO: marcoZero → última resolução. null enquanto houver etapa aberta. */
    tempoAteConclusaoSegundos: number | null;
    /** Ciclo ABERTO: marcoZero → `calculadoEm`. null quando já concluiu. */
    tempoEmAbertoSegundos: number | null;
    /** Reservado (dias úteis). Sempre null na Fase 1 — nunca substitui o corrido. */
    tempoUteisSegundos: number | null;

    /** Quantas lacunas a trilha deste título tem. Alimenta o ⚠ do grid sem exigir
     *  uma chamada à rota de trilha. O detalhe vem em `GET /:id/trilha`. */
    lacunasCount: number;
    lacunasSeveridadeMax: 'alta' | 'media' | 'baixa' | null;
}

export interface AprovacoesFiltros {
    /** ISO date-only. Recorte sobre o marco zero. */
    de?: string;
    ate?: string;
    filCods?: number[];
    status?: StatusWorkflow[];
    etapas?: string[];                  // fblDesNome
    aprovadores?: string[];             // nome (ver Ator.id)
    fornecedorCods?: number[];
    /** Só títulos parados há mais de N horas. Atalho para a cauda. */
    paradoAcimaDeHoras?: number;
    valorMin?: number;
    valorMax?: number;
    comLacunas?: boolean;
    /** Busca textual: docCod, titCod, nome do fornecedor. */
    q?: string;
}

export type AprovacoesOrdenarPor =
    | 'tempoParado' | 'valor' | 'vencimento' | 'marcoZero' | 'fornecedor';

export interface SnapshotInfo {
    /** Fim da última ingestão bem-sucedida. ISO 8601. */
    em: string | null;
    idadeSegundos: number | null;
    /** Classificação feita no BACKEND (thresholds únicos, compartilhados com a Fase 2). */
    status: 'fresco' | 'atrasado' | 'velho' | 'indisponivel';
    proximaIngestaoPrevistaEm: string | null;
    /** true quando a varredura bateu o teto de paginação (MAX_PAGES) — dados incompletos. */
    coberturaParcial: boolean;
}

export interface AprovacoesFacetas {
    /** Contagem por status na janela filtrada. Chaves ausentes = sem produtor:
     *  a UI NÃO renderiza o chip (lição do ADR-0034). */
    status: Partial<Record<StatusWorkflow, number>>;
    etapas: Array<{ nome: string; total: number }>;
    aprovadores: Array<{ nome: string; id: number | null; total: number }>;
    filiais: Array<{ filCod: number; nome: string | null; total: number }>;
}

export interface AprovacoesKpis {
    aguardando: number;
    paradosAcimaDe72h: number;
    semWorkflow: number;
    concluidos: number;
    comLacunas: number;
    /** Sobre etapas RESOLVIDAS na janela. Mediana, não média — a distribuição é assimétrica
     *  (p50 2,5h · média 20,4h · p90 70h · máx 234h). */
    tempoAprovacaoSegundos: {
        p50: number | null;
        p90: number | null;
        max: number | null;
        amostra: number;
    };
}

export interface AprovacoesListResponse {
    items: AprovacaoListItem[];
    page: number;
    pageSize: number;
    total: number;
    totalPaginas: number;
    /** Momento em que o backend calculou as durações. Toda duração relativa é medida
     *  contra ISTO, não contra o relógio do browser. */
    calculadoEm: string;
    snapshot: SnapshotInfo;
    /** KPIs sobre a JANELA FILTRADA inteira — nunca sobre a página. */
    kpis: AprovacoesKpis;
    facetas: AprovacoesFacetas;
    /** Eco dos filtros aplicados (deep-link + depuração). */
    filtros: AprovacoesFiltros;
    ordenarPor: AprovacoesOrdenarPor;
    ordem: 'asc' | 'desc';
}

// ─────────────────────────────────────────────────────── GET /aprovacoes/:id/trilha

/** Tipos GROSSOS de propósito: a ação específica (LIBERAR/APROVAR/…) vai no campo `acao`,
 *  não no tipo. Um union que precisa crescer toda vez que o ERP cadastra uma ação nova é frágil. */
export type TipoEventoTrilha =
    | 'DOCUMENTO_FINALIZADO'
    | 'ETAPA_ABERTA'          // v0 tinha ETAPA_CRIADA + ETAPA_ATRIBUIDA; há UM só timestamp
    | 'ETAPA_RESOLVIDA'       // v0 tinha ETAPA_APROVADA + ETAPA_REJEITADA; ver `acao`/`resultado`
    | 'ETAPA_CANCELADA'
    | 'WORKFLOW_REGERADO'
    | 'TITULO_LIBERADO';

export interface EventoTrilha {
    /** Estável entre requisições — chave do React e âncora de deep-link. */
    id: string;
    tipo: TipoEventoTrilha;
    ocorridoEm: string;                 // ISO 8601 COM offset (-03:00)
    ator: Ator | null;
    etapa: {
        ref: string;                    // `${fblCod}:${ftbCod}`
        nome: string;
        alcadaRotulo: string | null;
        situacao: SituacaoEtapa;
    } | null;
    /** Ação do ERP (`fbaDesNome`), só em ETAPA_RESOLVIDA. null quando não registrada. */
    acao: AcaoEtapa | null;
    /** Leitura de negócio da ação. 'DESCONHECIDO' quando `acao` é null ou não mapeada. */
    resultado: 'APROVADO' | 'RECUSADO' | 'CANCELADO' | 'DESCONHECIDO' | null;
    /** Segundos desde o evento anterior DO MESMO RAMO. null quando indeterminável
     *  (aí há uma Lacuna correspondente). */
    duracaoDesdeAnteriorSegundos: number | null;
    /** Segundos desde o marco zero. Facilita a leitura sem somar durações no cliente. */
    duracaoDesdeMarcoZeroSegundos: number | null;
    observacao: string | null;
    fonte: Fonte;                       // era `origem: 'ERP' | 'DERIVADO'`
    /** Ramo do paralelismo. Eventos com o mesmo `ramoId` são sequenciais entre si;
     *  ramos distintos correm em paralelo. `null` = tronco principal. */
    ramoId: string | null;
    /** Geração da trilha. Incrementa a cada `regerarBloqueios`; a UI colapsa as antigas. */
    geracao: number;
}

export interface TrilhaResponse {
    /** Era `cabecalho`. Mesmo shape da lista — reuso deliberado. */
    titulo: AprovacaoListItem;
    /** Ordem cronológica dentro de cada `ramoId`; ramos intercalados por `ocorridoEm`. */
    eventos: EventoTrilha[];
    /** Geração corrente. Eventos com `geracao < geracaoAtual` são trilha substituída. */
    geracaoAtual: number;
    lacunas: Lacuna[];                  // era `string[]`
    calculadoEm: string;
    snapshot: SnapshotInfo;
}
```

**Query string de `GET /aprovacoes`** (nomes iguais aos da URL do frontend — §3.1.4):

```
de, ate, fil (csv), st (csv), etapa (csv), aprov (csv), forn (csv),
parado (horas), vmin, vmax, lac (true|false), q, ord, dir, p, ps
```

`ps` ∈ {10, 15, 25, 50, 100}, default 25 (`table.md:262`). `p` 1-based (o `Paginacao` do repo é
1-based, `tabela-filtro.tsx:129`).

**Erros:** `400 { error, details }` (Zod, molde `routes/recebimentos.ts:135-138`),
`403 { error, code }` para filial fora da allow-list (`:144-153`), `404` para `:id` inexistente,
`X-Request-Id` em tudo (middleware global).

## 4.2 O que mudou em relação ao v0 — item a item

| # | v0 (`orquestracao.md:§5`) | v1 | Por quê |
|---|---|---|---|
| 1 | `id` = `filCod:docTip:docCod:titCod` | separador `-` | `:` vira `%3A` no path e polui URL, log e teste. Nenhum ganho |
| 2 | `documentoNumero: string`, `tituloNumero: string` | `docCod: number`, `titCod: number`, `docTip: number` + `documentoLabel` | O ERP é numérico; string convida a comparação frouxa. `docTip` era só implícito no `id` — e é filtro de escopo (`docTip#EQ: 2`) |
| 3 | `dataFinalizacao: string \| null` | **`marcoZero: MarcoZero`** (`em` + `campo` + `fonte` + `substituto`) | **O mais importante.** `docDtaFinalizacao` **não vem** na projeção que temos (`probe-resultado.md:§3`, "O que NÃO vem"). Um campo `dataFinalizacao` preenchido com `docDtaEmissao` seria uma mentira silenciosa no exato ponto em que o cliente definiu o aceite ("finalizado às 10:00") |
| 4 | `etapaAtual: {…} \| null` (singular) | **`etapasAtuais: EtapaResumo[]` + `etapaAtualPrincipal`** | 177 etapas em 148 títulos (~29 com mais de uma). Etapas paralelas existem; o v0 não as cabia, e a coluna do grid teria mostrado uma escolhida ao acaso |
| 5 | `etapasConcluidas`, `etapasTotais: number \| null` | **`etapas: { concluidas, abertas, canceladas, totalConhecido, totalEhDefinitivo }`** | `etapasTotais` sugere um denominador planejado que **o ERP não expõe**. `null` na UI vira "?" e o analista completa mentalmente. Nomear `totalConhecido` fecha a porta |
| 6 | `StatusWorkflow.APROVADO` | **`CONCLUIDO`** (+ `CANCELADO` novo) | 122 `LIBERAR` contra 34 `APROVAR`: o desfecho majoritário **não se chama** aprovação. `CONCLUIDO` cobre as duas. `CANCELADO` entra porque `motCodCanc` existe no schema e `ETAPA_CANCELADA` já estava no enum de eventos — faltava o espelho agregado |
| 7 | `REJEITADO` oferecido como filtro | mantido no union, **exibido só se vier em `facetas.status`** | Zero evidência de produtor. ADR-0034: filtro sem produtor destrói a confiança nos outros |
| 8 | *(ausente)* | **`motivoIndeterminado: string \| null`** | `INDETERMINADO` é status de primeira classe (§5.4 do v0), mas sem o porquê ele é indistinguível de um bug |
| 9 | `tempoTotalDecorridoSegundos` ("até conclusão **ou agora**") | **`tempoAteConclusaoSegundos` + `tempoEmAbertoSegundos`** | Um campo com dois significados quebra o analítico da Fase 2: somar ciclos fechados com aging de abertos dá um número sem sentido. Separado, o `GROUP BY` fica correto de graça |
| 10 | `paradaHaSegundos` sem referência | `paradaHaSegundos` **+ `calculadoEm` no topo** | "Parado há X" contra qual relógio? Do snapshot (defasado) ou da requisição? Fixado: **da requisição**, e a resposta declara o instante |
| 11 | `snapshotEm: string` | **`snapshot: SnapshotInfo`** (`em`, `idadeSegundos`, `status`, `proximaIngestaoPrevistaEm`, `coberturaParcial`) | A UI tem de decidir entre banner info e banner warning. Se o limiar morar no FE, a Fase 2 usará outro — e os dois discordarão |
| 12 | *(ausente)* | **`kpis`, `facetas`, `filtros`, `ordenarPor`, `ordem`, `totalPaginas`** | P2 exige KPIs sobre a janela, não sobre a página. `facetas` alimenta os multi-selects e a supressão de chips sem produtor. O eco de filtros fecha o deep-link |
| 13 | *(ausente)* | **`AprovacoesFiltros` como tipo** | O v0 não tinha contrato de filtro nenhum — as fatias F2/F3 teriam inventado nomes divergentes |
| 14 | `origem: 'ERP' \| 'DERIVADO'` | **`fonte: Fonte`** (`campoFonte`, `endpoint`, `metodo`, `snapshotAnteriorEm/PosteriorEm`) | "DERIVADO" sozinho não é auditável. O analista financeiro precisa saber **de onde** saiu — qual campo, ou quais dois snapshots. É a diferença entre um rótulo e uma trilha de auditoria |
| 15 | `lacunas: string[]` | **`Lacuna[]`** (`codigo`, `mensagem`, `severidade`, `etapaRef`) | String livre não filtra, não testa, não pinta ícone e não sobrevive a uma reescrita de texto |
| 16 | lacunas só na trilha | **`lacunasCount` + `lacunasSeveridadeMax` no item da lista** | Sem isso o grid não pode marcar a linha sem uma chamada por título |
| 17 | `ETAPA_CRIADA` + `ETAPA_ATRIBUIDA` | **`ETAPA_ABERTA`** (um só) | Existe **um** timestamp (`ftbTimBloq`). Emitir dois eventos a partir dele fabrica uma precisão que o dado não tem |
| 18 | `ETAPA_APROVADA` + `ETAPA_REJEITADA` | **`ETAPA_RESOLVIDA`** + `acao` + `resultado` | O ERP tem 2 ações hoje e pode cadastrar mais. Tipo grosso + campo aberto absorve a mudança sem quebrar o contrato |
| 19 | *(ausente)* | **`ramoId`** | Sem ele, etapas paralelas viram uma lista serial e `duracaoDesdeAnterior` passa a medir a distância até um evento de **outro** ramo — um número errado, apresentado com confiança |
| 20 | *(ausente)* | **`geracao` + `geracaoAtual`** | `regerarBloqueios` (R3) reescreve a trilha. Sem geração, a UI não sabe o que colapsar nem de onde reiniciar o relógio |
| 21 | *(ausente)* | **`evento.id`** | Chave de React estável e âncora de deep-link para um evento específico |
| 22 | *(ausente)* | **`duracaoDesdeMarcoZeroSegundos`** | O caso canônico é lido a partir do marco zero. Somar durações no cliente reintroduz cálculo derivado no FE |
| 23 | `ator: { nome; codigo: number\|null }` | **`Ator { id: number\|null; nome }`** com comentário de que `id` é sempre `null` hoje | R16: `usnCodCmd` não vem. Documentar no tipo evita que a F3 monte um link por `codigo` que nunca existirá |
| 24 | `etapa.alcada: string\|null` | **`alcadaRotulo`** | O campo `aprovador` **mistura setor e pessoa** (COMPRAS, RICARDO DO PRADO). "alçada" sugere identidade; "rótulo" avisa que não é |
| 25 | `cabecalho: AprovacaoListItem` | **`titulo`** | "cabeçalho" é vocabulário de layout num contrato de domínio |
| 26 | *(ausente)* | **`filialNome`, `fornecedorCod`, `workflowRegerado`, `tempoUteisSegundos`** | `fornecedorCod` é gancho de Fase 2 (§5.3 do v0) sem custo de UI. `tempoUteisSegundos` reserva o campo de dias úteis do §5.5 sem substituir o corrido |
| 27 | rota `/aprovacoes` | mantida | ✅ o v0 já corrigiu de `/api/aprovacoes`. Reconfirmado: `src/backend/index.ts:81-125` monta na raiz |

**Os 5 pontos não-negociáveis do v0 continuam válidos e ficam mais fortes:**
(1) proveniência em todo evento → virou `Fonte` rica; (2) `lacunas[]` explícito → virou estruturado
e chegou ao grid; (3) `snapshotEm` visível → virou `SnapshotInfo` com classificação no backend;
(4) `INDETERMINADO` de primeira classe → ganhou `motivoIndeterminado`; (5) durações em segundos
corridos → mantido, com `tempoUteisSegundos` reservado e nunca substituto.

---

# 5. Ganchos para a Fase 2 (analítico) — reservados, não implementados

Nada de analítico entra na Fase 1. Estes cinco ganchos custam ~zero agora e evitam reescrita depois.

| # | Gancho | Onde já está no contrato | O que evita |
|---|---|---|---|
| **G1** | **`facetas`** (contagem por etapa / aprovador / filial / status) | `AprovacoesFacetas` | É o `GROUP BY` do analítico com outro nome. Quando a Fase 2 chegar, o agregado já existe e já **concorda** com o painel |
| **G2** | **`Ator.id` no contrato desde já**, mesmo sempre `null` | `Ator` | Quando o `fin103` liberar `usnCodCmd`, o campo é preenchido e **nenhum consumidor muda**. Se ele não existisse, "tempo médio por funcionário" exigiria migração de contrato |
| **G3** | **Dimensões de negócio no item** (`fornecedorCod`, `filCod`) | `AprovacaoListItem` | §8.3 do doc de orquestração: sem elas, a Fase 2 precisa de join retroativo contra um ERP que talvez já não tenha o histórico |
| **G4** | **Durações separadas** (`tempoAteConclusao` vs `tempoEmAberto`) e **por evento** (`duracaoDesdeAnterior`) | `AprovacaoListItem`, `EventoTrilha` | §8.1: com a duração materializada por evento, o analítico é `AVG`/`PERCENTILE_CONT`, não recomputação de trilha |
| **G5** | **`tempoAprovacaoSegundos: {p50, p90, max, amostra}`** já nos KPIs | `AprovacoesKpis` | A Fase 2 herda a definição de percentil do painel. Se cada tela calcular a sua, os números divergem e ninguém confia em nenhum |

**Reservas sem implementação:**
- Rota `GET /aprovacoes/metricas` — **nome reservado**, não criada.
- Params de URL `agrupar=` e `metrica=` — reservados, não lidos.
- `TrilhaTimeline` recebe **só** `eventos: EventoTrilha[]` (nenhum fetch, nenhum contexto), então
  um drill-down analítico futuro a reusa sem refatorar (`principles.md:193-197`).
- `lib/aprovacoes.ts` exporta os tipos, não só as funções — o módulo analítico importará daí.

---

# 6. Arquivos a criar — ordem de implementação

`src/frontend/lib/` primeiro (F2 e F3 dependem), depois a página (F2), depois a timeline (F3).

## 6.1 `src/frontend/lib/`

| # | Arquivo | Conteúdo | Fatia | Novo/edita |
|---|---|---|---|---|
| 1 | **`lib/datetime.ts`** | `DateFormatter` com a API exata de `patterns.md:492-500`: `toBR`, `toBRDate`, `toBRTime`; **+ `toBRFull` (com segundos)** e **`formatDuracao(segundos)`** (`234h 24m`, `2h 30m`, `47m`, `< 1m`). Fuso fixo `America/Sao_Paulo` via `Intl.DateTimeFormat`. `''` para `null`/`undefined`/vazio | F2 | **novo** — paga a dívida do DS; é o único helper de HORA do repo |
| 2 | `lib/datetime.test.ts` | Fuso fixo (roda igual em qualquer TZ de CI); `null`→`''`; travessia de horário de verão; `formatDuracao` nas 4 faixas | F2 | novo |
| 3 | **`lib/aprovacoes.ts`** | Tipos do §4.1 replicados um-a-um (convenção de `lib/recebimentos.ts:16-18`); `fetchAprovacoes(filtros, paginacao)` e `fetchTrilha(id)` sobre `apiFetch` + `withAuthHeaders`; `URLSearchParams`; **sem fixture** (`lib/recebimentos.ts:159-163`) | F2 (fetch da lista) / F3 (`fetchTrilha`) | novo |
| 4 | `lib/aprovacoes.test.ts` | Montagem da query string; normalização defensiva (`?? []`); erro `API 4xx`; `id` malformado | F2 | novo |
| 5 | **`lib/url-state.ts`** | `useUrlState` genérico sobre `useSearchParams`/`useRouter`, `router.replace`, serialização por vírgula, datas ISO date-only, booleans `true`/`false` (`patterns.md:110-116`) | F2 | novo — primeira implementação de PT4 no repo |
| 6 | `lib/url-state.test.ts` | round-trip serialize/deserialize; ausência → default; `replace` e não `push` | F2 | novo |

## 6.2 `src/frontend/app/aprovacoes/`

| # | Arquivo | Conteúdo | Fatia |
|---|---|---|---|
| 7 | **`layout.tsx`** | `export const metadata = { title: 'Aprovações a Pagar' }` + passthrough. Server component (molde `app/recebimentos/layout.tsx:1-15`) | F2 |
| 8 | **`page.tsx`** | `'use client'`. **Page-as-maestro (P3)**: detém filtros, ordenação, página, `painel`, `loading`, `error`, `expandidoId`. `PageHeader` com snapshot no subtítulo; banners de snapshot/cobertura; `KPIGrid`; `FiltroBarra` + controles extras; `<AprovacoesTable>`; `<Paginacao>`. Único lugar com fetch | F2 |
| 9 | **`components/useAprovacoesQuery.ts`** | Hook que **devolve o shape `TabelaFiltro<AprovacaoListItem>`** de `tabela-filtro.tsx:15-28`, alimentado pelo servidor: `slice` = página atual, `total`/`totalPaginas` = meta da resposta, `filiais` = `facetas.filiais` (**não** derivadas dos itens), setters disparam refetch + `useUrlState`. Debounce 300ms na busca. Reset para página 1 ao trocar filtro (`tabela-filtro.tsx:60-67`) | F2 |
| 10 | **`components/AprovacoesTable.tsx`** | Organismo puro (props in, eventos out). `<Table>` primitivo; `<th scope="col">` + `aria-label`; cabeçalhos ordenáveis com `aria-sort`; linha expansível com chevron `rotate-90` e `aria-expanded` (`VisaoGeralTable.tsx:98-115`); `<TableRow>` extra com `colSpan` para a trilha. Exporta **`AprovacoesTable.Skeleton`** no mesmo arquivo (S1) | F2 |
| 11 | **`components/status-badges.tsx`** | `DomainChip` local (cópia fina de `app/recebimentos/components/status-badges.tsx:51-71`) + `StatusWorkflowBadge` (`Record<StatusWorkflow, ChipSpec>` exaustivo), `TempoParadoBadge` (faixas 4h/72h), `SituacaoEtapaBadge`, **`FonteEventoBadge`** (`registro do ERP` sólido / `inferido` tracejado + `GitCompare`), `LacunaIndicador` | F2 (grid) / F3 (trilha) |
| 12 | **`components/AprovacoesFiltros.tsx`** | Os controles que o `FiltroBarra` não cobre: período (`date-picker`), chips de status **derivados de `facetas`**, `multi-select` de etapa/aprovador, `combobox` de fornecedor, "parado há", switch de lacunas. Emite `onChange(filtros)` — nenhum estado próprio de domínio | F2 |
| 13 | **`components/AprovacoesKpis.tsx`** | `KPIGrid columns={3}` + 6 `SimpleKPI`, com `active`/`onClick` ligados ao filtro. `p90 · máx` no `footer` do KPI de mediana | F2 |
| 14 | **`components/TrilhaTimeline.tsx`** | Organismo `<ol>` semântico. Marcadores por tipo; conector sólido/tracejado por `fonte.tipo`; agrupador de `ramoId` com bifurcação; divisor de `geracao` + `<details>` da trilha anterior; banner de `lacunas`; item pendente pulsante (desligado sob `prefers-reduced-motion`). **Recebe só `eventos` + `lacunas` + `geracaoAtual`** — zero fetch (G-Fase 2). Exporta `TrilhaTimeline.Skeleton` | F3 |
| 15 | **`components/TrilhaPanel.tsx`** | Molécula que liga a linha expandida à API: `fetchTrilha(id)` sob demanda, com loading/erro/retry, e passa os dados ao `TrilhaTimeline` | F3 |
| 16 | `page.test.tsx` | H1 e `metadata.title`; cabeçalhos de coluna esperados; empty vs no-results; banner de snapshot velho; KPI clicável altera o filtro. Molde `app/recebimentos/page.test.tsx` | F2 |
| 17 | `components/status-badges.test.tsx` | Cada status renderiza label + ícone + tooltip; faixas do `TempoParadoBadge` nos limites 4h/72h; **`FonteEventoBadge` distingue ERP de inferido por texto, não por cor** | F2 |
| 18 | `components/AprovacoesTable.test.tsx` | Ordenação emite o evento certo com `aria-sort`; expansão alterna `aria-expanded`; ⚠ de lacunas presente | F2 |
| 19 | `components/TrilhaTimeline.test.tsx` | **Caso canônico de aceite** renderizado inteiro (18/08 10:00 → 18:09 → 19/08 10:00); evento `DERIVADO` traz o chip "inferido"; ramos paralelos não serializam; geração antiga vem colapsada | F3 |

## 6.3 Edições em arquivos existentes

| # | Arquivo:linha | Edição | Fatia |
|---|---|---|---|
| 20 | `app/page.tsx:23-81` | Quarto `<Card>`: `ClipboardCheck` + "Aprovações a Pagar" + `<Link href="/aprovacoes">` | F2 |
| 21 | `app/sispag/page.tsx:63-78` | **Promover `VencimentoBadge`** para `components/ui/` (ou `app/aprovacoes/components/status-badges.tsx` se a promoção gerar conflito com a F1/F3) — hoje é privado da página do SISPAG | F2 |
| 22 | `lib/features.ts` | `isAprovacoesEnabled()` — **só se** a decisão PV-6 (§7) for "com flag" | F2 |

> **Ordem de merge** (`orquestracao.md:§4`): F1 → F2 → F3. Os arquivos 14/15/19 são exclusivos da F3;
> 8/9/10/12/13/16/17/18 são exclusivos da F2; **1–6 e 11 são compartilhados** — devem nascer na F2 e a
> F3 apenas consumi-los, nunca editá-los, senão o merge conflita (R7).

---

# 7. PENDENTE DE VALIDAÇÃO COM O TIME

Cada linha: a decisão, a **premissa que estou adotando para não travar**, e **o que muda se a resposta for outra**.

### Bloqueia o aceite (P0)

| # | Questão | Premissa adotada | Impacto se mudar |
|---|---|---|---|
| **PV-1** | **Qual campo é o "documento finalizado" do caso canônico?** `docDtaFinalizacao` **não vem** na projeção acessível (`probe-resultado.md:§3`) | O marco zero usa `docDtaEmissao` do `psq014` como **substituto declarado**, com `marcoZero.substituto = true`, marca visual e lacuna `MARCO_ZERO_SUBSTITUTO` | **Alto.** Se a resposta for "é outro campo, e vem em X": remove a lacuna, muda a coluna Finalização e **todos os tempos totais mudam de valor**. Se for "só existe no `fin103`": o aceite do caso canônico fica **bloqueado no acesso ao `fin103`** (PV-2) — o painel entrega tudo menos a frase exata do cliente. **É o maior risco de escopo da frente** |
| **PV-2** | **O acesso do usuário de API à tela `fin103` sai?** (`probe-resultado.md:§4`) | Não sai a tempo. O painel é desenhado para funcionar sem ele | **Alto e positivo.** Com o acesso: `docDtaFinalizacao` resolve PV-1, `usnCodCmd` preenche `Ator.id` (destrava a Fase 2 por pessoa), `limitaAlcada` habilita "bloqueado por alçada de R$ X" na timeline, e a ingestão cai 2 ordens de grandeza. **Nenhum tipo do contrato muda** — foi desenhado para absorver isso preenchendo campos hoje `null` |
| **PV-3** | **`LIBERAR` × `APROVAR` — qual a diferença de negócio?** (122 × 34 ocorrências) | São dois desfechos **equivalentes** para o status agregado; ambos levam a `CONCLUIDO`. A timeline mostra o rótulo cru | **Médio.** Se `LIBERAR` for "destravar sem julgar" e `APROVAR` for "aprovar de fato", o status agregado precisa distingui-los (`LIBERADO` × `APROVADO`), a coluna Status ganha um valor, e o KPI "Concluídos" se divide em dois |
| **PV-4** | **`ftbVldStatus = 7`** — 13 ocorrências sem legenda | Mapeado para `SituacaoEtapa.DESCONHECIDA` + lacuna `ETAPA_STATUS_DESCONHECIDO`. Não conta como concluída nem como aberta | **Médio.** Se for "cancelada": os 13 casos migram para `CANCELADA`, o KPI de concluídos muda e a lacuna some. Se for "encaminhada a outro gestor": vira **um tipo de evento novo** (`ETAPA_ENCAMINHADA`) e a timeline ganha um caso |
| **PV-5** | **`ftbTimBloq` é mesmo "quando o aprovador recebeu"?** (`probe-resultado.md:§6`, P0 nº 3) | Sim. É o `18:09` do caso canônico e o início do cronômetro de cada etapa | **Alto.** Se for "quando o bloqueio foi criado" e a atribuição ao aprovador vier depois, **todas as durações por etapa estão superestimadas** e a coluna Tempo parado precisa de um asterisco permanente |

### Muda a UI, não o aceite (P1)

| # | Questão | Premissa adotada | Impacto se mudar |
|---|---|---|---|
| **PV-6** | **A rota `/aprovacoes` nasce ligada em produção?** | Nasce **desligada** por `aprovacoesGate` no backend, e **com** flag no frontend (`isAprovacoesEnabled`, molde SISPAG) até a homologação | Baixo. Se nascer ligada, remove-se a flag do FE (o kill-switch do backend basta — é o argumento de `lib/features.ts:18-25`) |
| **PV-7** | **Expansão de linha ou painel lateral (`Sheet`)?** O `component-mapping.md:16` manda `Sheet`, que **não existe** no repo | **Expansão de linha** — padrão real de `VisaoGeralTable.tsx:128-131`, preserva contexto igual e não cria primitiva nova | Médio. Se o time quiser `Sheet`: cria-se `components/ui/sheet.tsx` (Radix Dialog com `side`), e a F3 troca o container sem tocar no `TrilhaTimeline` (que é puro). **Custo de ~1 dia, isolado** |
| **PV-8** | **Faixas do `TempoParadoBadge`** — 4h / 72h | Calibradas nos percentis medidos: 4h ≈ acima da mediana (2,5h), 72h ≈ p90 (70h) | Baixo. É uma constante. Se o time disser "SLA interno é 24h", troca-se o número — mas então **o KPI "parados > 72h" também muda** e o painel passa a medir SLA em vez de dispersão |
| **PV-9** | **Período default do grid** | Últimos 90 dias sobre o marco zero | Médio no desempenho. Se o analista precisa de 12 meses por padrão, o `total` e as facetas ficam caros e a paginação precisa de índice dedicado (assunto da F1) |
| **PV-10** | **A tela mostra títulos de filiais que o usuário não pode ver?** | **Não.** `filiaisPermitidas(user)` recorta tudo — grid, KPIs e facetas (`routes/recebimentos.ts:69-75`) | Baixo, mas precisa ser dito em voz alta: os KPIs de um usuário de uma filial **não batem** com os de um usuário multi-filial. É correto, e o rodapé do KPI deve dizer "nas suas filiais" |
| **PV-11** | **Ordenação default `tempoParado desc`** | O painel é fila de trabalho sobre uma cauda longa | Baixo. Se o time preferir "mais recente", os títulos de 234h — o motivo da ferramenta — ficam na página 57 |
| **PV-12** | **Etapas paralelas: o Conexos realmente abre duas ao mesmo tempo?** O probe viu ~29 títulos com >1 etapa, mas **não confirmou sobreposição temporal** | Sim, podem ser paralelas. A timeline suporta `ramoId` desde o dia 1 | Médio. Se forem **sempre sequenciais**, o `ramoId` fica sempre `null` e a bifurcação é código morto (barato). O inverso — descobrir paralelismo depois de assumir série — teria feito `duracaoDesdeAnterior` mentir em produção. Por isso a aposta é nesta direção |
| **PV-13** | **`regerarBloqueios` é usado na operação, e com que frequência?** | Raro, mas possível. `geracao` no contrato desde o dia 1 | Médio. Se for **frequente**, o divisor de geração deixa de ser exceção e vira caso comum: a timeline precisa de um seletor de geração em vez de um `<details>` colapsado |
| **PV-14** | **Aprovação por e-mail conta como etapa?** (`probe-resultado.md:§6`, P0 nº 5) | Não. Só existe o que está no ERP | Médio. Se contar e **não** estiver no ERP, a trilha é estruturalmente incompleta e cada título ganha uma lacuna permanente — o que muda a leitura do painel de "rastreamento" para "rastreamento parcial" |
| **PV-15** | **Limiar de "snapshot velho"** | `atrasado` > 2× o intervalo de ingestão; `velho` > 24h | Baixo. Constantes no backend (por isso `SnapshotInfo.status` é calculado lá, não no FE) |
| **PV-16** | **`REJEITADO` existe na operação?** | Não há evidência. O chip não é renderizado enquanto não houver faceta | Baixo. O valor já está no union — quando aparecer o primeiro caso, o chip surge sozinho |

---

## Apêndice — evidências citadas

**Frontend:** `app/recebimentos/page.tsx`, `app/recebimentos/layout.tsx`,
`app/recebimentos/components/status-badges.tsx`, `app/recebimentos/components/AcoesLinhaMenu.tsx`,
`app/recebimentos/page.test.tsx`, `app/permutas/components/tabela-filtro.tsx`,
`app/permutas/components/VisaoGeralTable.tsx`, `app/permutas/components/ui.tsx`,
`app/sispag/page.tsx`, `app/page.tsx`, `components/AppShell.tsx`,
`components/ui/{table,badge,empty-state,page-header,kpi-card,skeleton,dialog}.tsx`,
`lib/{http,api,utils,brl,recebimentos,features}.ts`, `app/globals.css`, `jest.config.js`,
`jest.setup.ts`, `package.json`.

**Design system:** `src/frontend/docs/design-system/{principles,patterns,table,skeleton,tokens,kpi,accessibility}.md`,
`.claude/agents/design-system-reviewer.md`, `ontology/design/{taste-profile,component-mapping}.md`.

**Backend:** `src/backend/index.ts:75-130`, `src/backend/routes/recebimentos.ts:60-168`.

**Domínio:** `ontology/_inbox/frente-v-{orquestracao,probe-resultado,anatomia-slice,aprovacoes-conexos-spike,prompts-sessoes}.md`.
