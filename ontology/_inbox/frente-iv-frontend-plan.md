# Frente IV — Conciliação de Recebimentos — FRONTEND DESIGN PLAN

Planning-only. Grounded in the existing Next.js frontend (`src/frontend/`) and the Frente IV backend
scaffold + ontology in the same worktree (`/tmp/frente-iv-base-scaffold-wt`).

---

## 0. Ground truth (what actually exists)

### Frontend stack & conventions (confirmed by reading the code)
- **Next.js App Router**, React 19, TS strict. Routes live directly under `src/frontend/app/<route>/page.tsx`
  (e.g. `app/sispag/page.tsx`, `app/permutas/page.tsx`). No `src/` prefix — the DS docs say `src/shared/...`
  but the real tree is flat: atoms in `components/ui/`, feature code co-located under `app/<route>/components/`.
- **No TanStack Query, no TanStack Table.** The DS README *aspires* to them but they are NOT installed
  (`package.json` has no `@tanstack/*`). Data fetching is **plain async functions in `lib/*.ts`** + page-level
  `React.useState`/`useEffect`/`useCallback`. This is the pattern to follow — do not introduce TanStack.
- **HTTP layer:** `lib/http.ts` `apiFetch()` (centralises 401 → `SessionExpiredError` + session-expired bus).
  Every call attaches `await withAuthHeaders()` (`lib/auth/token.ts`, Supabase bearer). Base URL:
  `process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'`. Per-domain client modules: `lib/api.ts`
  (permutas), `lib/sispag.ts` (sispag). **We add `lib/recebimentos.ts`** mirroring `lib/sispag.ts` exactly.
- **Feature gating:** `lib/features.ts` `isSispagEnabled()` reads `NEXT_PUBLIC_*`, fail-safe (only on in
  `NEXT_PUBLIC_ENV=local` unless explicitly `=true`). Mirrors backend gate. Backend already ships a
  `recebimentosGate` (`src/backend/http/recebimentosGate.ts`, 403 when disabled) → **add `isRecebimentosEnabled()`**.
- **Navigation:** there is NO persistent sidebar (the DS `sidebar.md` is aspirational). Nav = the sticky
  header (`components/AppShell.tsx`) + the **home landing cards** (`app/page.tsx`), one `Card` per frente,
  disabled/locked when the flag is off. Auth via `RouteGate` (all routes protected except `/login`, `/docs`).
- **Toasts:** `sonner` (`toast.*`) used directly today in sispag/permutas. DS prescribes a `notify()` wrapper +
  NotificationCenter, but **neither is implemented** — follow the existing `toast.*` usage for consistency.

### Existing reusable pieces (concrete names + paths)
Atoms/molecules/organisms in `components/ui/`:
- `badge.tsx` — `Badge` (cva variants: `default|secondary|destructive|outline`; status colors done via
  `className` overrides e.g. `border-danger/40 text-danger`, as SISPAG's `VencimentoBadge` does).
- `kpi-card.tsx` — `KPIGrid`, `SimpleKPI`, and compound `KPICard.{Root,Header,Label,Dot,Value,Footer}`.
  Colors: `default|primary|success|warning|danger|info|permuta`. `active`+`onClick` → clickable filter KPI.
- `page-header.tsx` — `PageHeader` (title, subtitle, actions slot).
- `empty-state.tsx` — `EmptyState` (icon, title, description, action) — used for both "locked" and "no data".
- `table.tsx` — `Table, TableHeader, TableBody, TableRow, TableHead, TableCell`.
- `tabs.tsx` — `Tabs, TabsList, TabsTrigger, TabsContent`.
- `dialog.tsx`, `card.tsx`, `button.tsx`, `input.tsx`, `select.tsx`, `multi-select.tsx`, `checkbox.tsx`,
  `switch.tsx`, `date-picker.tsx`, `popover.tsx`, `tooltip.tsx`, `collapsible.tsx`, `spinner.tsx`,
  `skeleton.tsx`, `label.tsx`.
Feature helpers to reuse:
- `app/permutas/components/tabela-filtro.tsx` — `useTabelaFiltro(items, getFilCod, getBuscaTexto, pageSize)`
  + `<FiltroBarra>` + `<Paginacao>`. **Client-side filial filter + text search + pagination.** This is the
  exact list/filter/paginate mechanism SISPAG reuses; Recebimentos reuses it too.
- `lib/utils.ts` — `formatBRL`, `cn`. Date: SISPAG uses inline `toLocaleDateString('pt-BR', {timeZone:'UTC'})`.
- `@xyflow/react` IS installed (used by `app/docs/arquitetura/`) → available for a pipeline/flow trace viz.

### Color tokens (globals.css, confirmed)
`--success #10b981`, `--warning #f59e0b`, `--danger #ef4444`, `--info #3b82f6`, `--permuta #8b5cf6`, each with
`-subtle` and `-foreground`. These map cleanly to the state machines below.

### Backend data the FE will render (Frente IV scaffold)
- **Route surface today (`routes/recebimentos.ts`) is thin & mostly stubbed:**
  - `GET /recebimentos/painel` → `{ geradoEm, recebimentos: [], kpis: {} }` (echo/empty — no reads yet).
  - `POST /recebimentos/pipeline/run` → runs the stubbed coordinator; `requireRole('admin')`, per-filial authz,
    `Idempotency-Key`, dry-run default `true`. Body: `{correlationId(uuid), filCod, valorRecebido, dryRun?,
    borVldTipo, contaDestino}`.
- **Entities (frozen DTOs, `domain/interface/recebimentos/`):** `TransacaoBancaria`, `Recebimento` (the spine),
  `RateioRecebimento`, `DocumentoAReceber` (read-through from ERP), `NotaDebitoEletronica`, `CreditoCliente`,
  `RegraRecebimento`.
- **Status constants (`constants.ts`):** `RECEBIMENTO_STATUS` {rascunho,aprovado,executado,estornado};
  `TRANSACAO_BANCARIA_STATUS` {importada,conciliada,parcial,manual,erro}; `MATCH_CLASSIFICACAO`
  {unica,multiplas,parcial,nenhuma}; `TRANSACAO_TIPO`; `PARCELA_FINALIDADE` {PRINCIPAL,MULTA,JUROS,ENCOMENDA};
  `NDE_STATUS_EMISSAO` {pendente,emitida,erro}.
- **State machines (`recebimentoTransitions.ts` + ontology):**
  - Recebimento: `rascunho →(aprovar) aprovado →(executar) executado →(estornar) estornado`, with
    `aprovado →(reabrir) rascunho`. **Gate `rascunho → aprovado` is the irreducible human-in-the-loop point.**
  - Transacao: `importada → {conciliada|parcial|manual|erro}`; `{importada,parcial,manual} → erro`.
    **`manual` = "match incerto/nenhum → fila de análise manual; NUNCA auto-baixa"** (the core invariant).
- **Pipeline (5 stages + observability):** importarTransacoes → atribuirBaixa(+match) → ratearRecebimento
  (+parcelas) → aplicarRegras(+ajustes) → executarRecebimento(+baixa+NDe). All tied by one `correlationId`
  (born on `TransacaoBancaria`, flows to `Recebimento` and `NotaDebitoEletronica`).

---

## 1. Screen / page inventory

Target: **desktop-first** (data-intensive operation), per DS principle 7. Route root: `/recebimentos`.
Feature-gated (locked EmptyState + home card lock, mirroring SISPAG). Each page = "page as maestro":
state/fetch live in the page; DS components only expose data+events.

### 1.1 `/recebimentos` — Painel (dashboard + transactions list)  ← Requirement 1 & 2 (primary)
**Purpose:** the operator's landing — visualize imported bank transactions and the health of the
reconciliation lifecycle at a glance; entry point to every workflow.

**Layout (wireframe):**
```
┌ PageHeader "Recebimentos" · "Conciliação de créditos bancários (Frente IV)" ····· [Atualizar][Ingerir ▾] ┐
├ KPIGrid (clickable filters) ─────────────────────────────────────────────────────────────────────────────┤
│ [Importadas N] [Conciliadas N] [Parciais N] [Fila manual N ⚠] [Erro N] [Valor não alocado R$] [NDe pend N]│
├ Tabs: [ Transações ] [ Conciliações ] [ Fila manual ] [ NDe ] [ Ingestões ] ─────────────────────────────┤
│ FiltroBarra (filial select + busca) ─────────────────────────────────── [status filter chips] ───────────│
│ ┌ Table ──────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ Data | Contraparte | Ref.banc | Tipo | Valor | Status(chip) | Match(chip) | corrId(mono,copy) |  →   │ │
│ │ 20/07 CLIENTE X    PIX-ABC   CRÉDITO R$15.000 [importada]   [—]           corr-0001            [ver] │ │
│ └──────────────────────────────────────────────────────────────────── Paginacao (Mostrando X–Y de Z) ┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
**Key data:** `TransacaoBancaria[]` (dataMovimento, contraparte, referenciaBancaria, tipo, valor+moeda,
status, correlationId) + aggregated `kpis`. **Actions:** row → open detail (1.2); "Ingerir" (admin, opens
ingestion dialog); KPI click → filter table (page-as-maestro). Read-only for non-admins.

**Tabs = the three user goals in one panel:**
- **Transações** (goal 1) — all imported movements.
- **Conciliações** — `Recebimento[]` by lifecycle status (goal 2, the process view).
- **Fila manual** (1.4) — transactions in `manual`/uncertain match awaiting analyst.
- **NDe** (1.5) — Notas de Débito Eletrônica (goal 3).
- **Ingestões** — run history (mirrors SISPAG IngestaoDialog trilha).

### 1.2 `/recebimentos/transacoes/[id]` — Transaction detail + correlation trace  ← Requirement 1 & 2
**Purpose:** deep view of one bank movement, its normalized/raw payload, and the full correlation-id trace
across the 5 pipeline stages.
```
┌ Breadcrumb Recebimentos / Transação corr-0001 ────────────────────────────────────────────┐
│ Header: R$15.000 CRÉDITO · CLIENTE X · filial 4 · [status chip importada] · corrId (copy)   │
├ 2-col ─────────────────────────────────────────────────────────────────────────────────────┤
│ LEFT  Dados: data, moeda, contraparte, ref.banc, naturalKey, importRunId, importadoEm       │
│       Payload: <Collapsible> rawPayload / normalized (mono JSON, read-only)                  │
│ RIGHT Correlation trace (vertical Timeline):                                                 │
│        ● Importada ── ● atribuirBaixa (match: unica) ── ○ ratear ── ○ regras ── ○ executar  │
│        each node: stage, status dot, timestamp; links to the Recebimento (1.3) / NDe (1.6)  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```
**Actions:** navigate to the linked Recebimento; (if `manual`) "Conciliar manualmente" → opens workspace.
No settlement action here (read + navigate only).

### 1.3 `/recebimentos/conciliacoes/[id]` — Reconciliation / Recebimento workspace  ← Requirement 2 (core, HITL)
**Purpose:** where the analyst reviews the match, edits the rateio, sees applied rules, and drives the
lifecycle — this is the human-in-the-loop centre. Analogous to the Permutas `AlocarDialog`/`ReconciliarDialog`
flow, but as a full workspace page (rateio can be N parcelas).
```
┌ Breadcrumb · Header: Recebimento corr-0001 · [status: rascunho] · versão v0 · valorRecebido R$15.000 ┐
├ Match summary card: classificação [única|múltiplas|parcial|nenhuma] · candidatos(DocumentoAReceber)  │
├ Rateio editor (Table, editable rows) ───────────────────────────────────────────────────────────────┤
│  Documento(docCod/titCod) | Processo(priCod) | Finalidade | Componente | Valor alocado |  [x remove]  │
│  ...                                                          [+ adicionar parcela]                    │
│  ── Balance bar: Σ alocado R$X / recebido R$15.000 · diferença não alocada R$Y (green if ≤0 & valid) │
├ Regras aplicadas (list, read-only): regra + rationale (explicabilidade)                                │
├ Footer action bar (state-machine driven, single primary):                                             │
│   [rascunho] → [Aprovar]* (disabled unless rateio balanceado; tooltip explains) · [Descartar]         │
│   [aprovado] → [Executar]* (opens ConfirmDialog: dry-run toggle) · [Reabrir]                           │
│   [executado] → [Estornar] (DestructiveConfirm) · shows resultadoExecucao + NDe link                  │
│   [estornado] → read-only, terminal                                                                    │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
**HITL enforcement (design rule):** the **Aprovar** button is the gate. Execution is only reachable from
`aprovado`. "Executar" always defaults to **dry-run** (backend default `dryRun:true`) and shows a preview;
real settlement requires the explicit toggle + confirm. Uncertain matches (`nenhuma`/`parcial` low score)
**cannot be approved from the auto path** — they land in the manual queue (1.4). Optimistic concurrency:
surface `versão`; a 409 `RECEBIMENTO_VERSAO_CONFLITO` → toast "recarregue, houve alteração".

### 1.4 `/recebimentos` → "Fila manual" tab (+ resolve flow)  ← Requirement 2 (the safety invariant)
**Purpose:** the exceptions queue — transactions the matching engine left as `manual` (uncertain/no match).
Enforces "sistema nunca auto-baixa incerto". This is the operator's daily worklist.
```
┌ Fila manual (Table) · sorted by importadoEm ──────────────────────────────────────────────┐
│ Data | Contraparte | Valor | Motivo(match: nenhuma/parcial, score) | Idade(aging chip) | [Conciliar]│
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```
Each row → opens 1.3 with an empty/seeded rateio for manual allocation. **Aging chip** (green<2d,
warning 2–5d, danger >5d) reusing the `VencimentoBadge` pattern from SISPAG. KPI "Fila manual" on 1.1 links
here (page-as-maestro).

### 1.5 `/recebimentos` → "NDe" tab (list)  ← Requirement 3
**Purpose:** list every Nota de Débito Eletrônica, its emission/idempotency status, and its link back to the
recebimento + transação via correlationId.
```
┌ NDe (Table) ──────────────────────────────────────────────────────────────────────────────────┐
│ Nº NDe | Valor | Filial | Status emissão(chip pendente/emitida/erro) | corrId(link) | emitidaEm │
│ NDE-123  R$15.000  4       [emitida]                                   corr-0001      21/07 14:02│
│ —        R$ 9.000  4       [pendente]                                  corr-0007      —          │
└──────────────────────────────────────────────────────────────────── FiltroBarra + Paginacao ───┘
```
**Actions:** row → NDe detail (1.6). Filter by status. No emit action here (emission happens inside the
executarRecebimento flow, 1.3).

### 1.6 `/recebimentos/nde/[id]` — NDe detail  ← Requirement 3
**Purpose:** single NDe — full emission audit + idempotency key + ERP response, cross-linked to its
Recebimento and TransacaoBancaria.
```
┌ Header: NDE-123 · [emitida] · R$15.000 · filial 4 ──────────────────────────────────────────┐
│ Fields: numeroNde, valor/moeda, statusEmissao, idempotencyKey(mono,copy), emitidaEm, emitidaPor│
│ Links:  Recebimento corr-0001 → (1.3) · Transação → (1.2)   [correlation trace mini]           │
│ <Collapsible> erpResponse (read-only JSON)                                                      │
│ If status=erro: error banner + (admin) "Reprocessar emissão" (idempotent, ties to ledger)      │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.7 Home card (`app/page.tsx`) — add a Recebimentos entry
Add a third real `Card` ("Recebimentos — Frente IV · Conciliação de créditos bancários (Nexxera)") next to
Permutas/SISPAG, gated by `isRecebimentosEnabled()` with the same `Lock` treatment.

---

## 2. Status visualization approach

Two state machines + one classification, each mapped to the existing token palette. Rendered via `Badge`
(chip) with `className` color overrides — exactly the SISPAG `VencimentoBadge` idiom — plus a shared
timeline for lifecycle.

### 2.1 TransacaoBancaria status → chip
| Status | Token / variant | Icon (lucide) | Meaning shown in tooltip |
|--------|-----------------|---------------|--------------------------|
| `importada` | `info` (blue) | `Download` | Importado, ainda não conciliado |
| `conciliada` | `success` (green) | `CheckCircle2` | Casado com confiança |
| `parcial` | `warning` (amber) | `PieChart` | Parte casada, resta saldo |
| `manual` | `permuta` (violet) / warning | `UserSearch` | Fila de análise manual — nunca auto-baixa |
| `erro` | `danger` (red) | `AlertTriangle` | Falha reprocessável |

### 2.2 Recebimento lifecycle → chip + timeline
| Status | Token | Icon |
|--------|-------|------|
| `rascunho` | `muted`/`secondary` | `FileEdit` |
| `aprovado` | `info` | `CheckCircle2` |
| `executado` | `success` | `Landmark` |
| `estornado` | `danger` | `Undo2` |

Lifecycle is also rendered as a **horizontal stepper/timeline** in the workspace header
(`rascunho → aprovado → executado`, with `estornado` as a terminal off-ramp), reusing the DS `Stepper`
concept (net-new molecule) — past steps solid, current highlighted, future muted. The R3 reabrir edge is a
back-arrow affordance.

### 2.3 MatchClassificacao → chip
| Class | Token | Note |
|-------|-------|------|
| `unica` | `success` | 1:1 auto-eligible |
| `multiplas` | `info` | needs analyst pick |
| `parcial` | `warning` | partial + residual |
| `nenhuma` | `danger`/`permuta` | → manual queue |

### 2.4 NDe emission status → chip
`pendente` → `warning` (Clock), `emitida` → `success` (CheckCircle2), `erro` → `danger` (AlertTriangle).

### 2.5 KPI cards (clickable filters) — `SimpleKPI` with `color` + `active` + `onClick`
`Importadas` (info) · `Conciliadas` (success) · `Parciais` (warning) · `Fila manual` (permuta, ⚠) ·
`Erro` (danger) · `Valor não alocado` (default, R$) · `NDe pendentes` (warning). Clicking a KPI sets the
page filter and switches to the relevant tab (page-as-maestro; state in the page, passed via props).

### 2.6 Accessibility (DS principle 8)
Status is **never color-only**: every chip carries icon + text + tooltip explaining the business meaning
(DS "tudo explicado"). Aging/status chips use `border-<token>/40 text-<token>` outline style (matches
SISPAG). `HelpPopover`/tooltip `?` next to "Fila manual", "diferença não alocada", "classificação de match".

---

## 3. NDe visualization approach (Requirement 3, consolidated)

- **List** (1.5, tab on painel): `NotaDebitoEletronica[]` in a `Table` — `numeroNde` (— if not emitted),
  valor, filial, `statusEmissao` chip, `correlationId` (clickable → links to the recebimento/transação),
  `emitidaEm`. Filter by status + filial via `useTabelaFiltro`.
- **Detail** (1.6): full audit — `idempotencyKey` (mono + copy, the "one NDe per Recebimento" guarantee),
  `erpResponse` collapsible JSON, `emitidaPor`, and a **cross-link cluster** to `Recebimento` (1.3) and
  `TransacaoBancaria` (1.2) resolved by `correlationId`. This closes the loop:
  `TransacaoBancaria.correlationId === Recebimento.correlationId === NotaDebitoEletronica.correlationId`,
  so the FE can render "one thread" for a credit end-to-end.
- **Emission status semantics:** NDe is emitted by Conexos during `executarRecebimento`; the FE presents it
  read-through. `pendente` (write-ahead, not yet confirmed) vs `emitida` (numeroNde present) vs `erro`
  (reprocessable). The idempotencyKey is surfaced so support can confirm no double-emission.

---

## 4. Component reuse map

### Reuse as-is (no changes)
| Component | Path | Used for |
|-----------|------|----------|
| `PageHeader` | `components/ui/page-header.tsx` | every page title/subtitle/actions |
| `KPIGrid`, `SimpleKPI` | `components/ui/kpi-card.tsx` | status KPI row (1.1) |
| `Badge` | `components/ui/badge.tsx` | all status/match/NDe/aging chips |
| `Table` set | `components/ui/table.tsx` | all lists + rateio editor |
| `Tabs` set | `components/ui/tabs.tsx` | painel tabs |
| `Dialog` | `components/ui/dialog.tsx` | ingestion, confirm approve/execute/estornar |
| `EmptyState` | `components/ui/empty-state.tsx` | locked frente + empty/no-results |
| `Card`, `Button`, `Input`, `Select`, `MultiSelect`, `Checkbox`, `Switch`, `Collapsible`, `Tooltip`, `Popover`, `Spinner`, `Skeleton`, `Label`, `DatePicker` | `components/ui/*` | forms/dialogs/detail |
| `useTabelaFiltro`, `FiltroBarra`, `Paginacao` | `app/permutas/components/tabela-filtro.tsx` | filial+search+paginate on every list |
| `formatBRL`, `cn` | `lib/utils.ts` | currency, classnames |
| `apiFetch`, `withAuthHeaders`, `SessionExpiredError` | `lib/http.ts`, `lib/auth/token.ts` | data layer |
| `@xyflow/react` | dep | correlation-trace flow (optional, richer than timeline) |

### Net-new — feature components (live in `app/recebimentos/components/`, domain-aware, NOT in DS)
- `TransacaoStatusBadge`, `RecebimentoStatusBadge`, `MatchClassificacaoBadge`, `NdeStatusBadge`,
  `AgingBadge` — thin wrappers configuring `Badge` with the token/icon/tooltip maps in §2 (domain lives in
  feature code; `Badge` stays domain-agnostic per atomic-classification rules).
- `RecebimentoLifecycleStepper` — horizontal state-machine stepper (rascunho→aprovado→executado[/estornado]).
- `CorrelationTrace` — vertical timeline of the 5 pipeline stages for a correlationId (or `@xyflow` flow).
- `RateioEditorTable` — editable N-parcela allocation table + balance bar (wraps `Table` + `Input`).
- `IngestaoRecebimentosDialog` — mirror of `app/sispag/components/IngestaoDialog.tsx` (run + trilha).
- `AprovarRecebimentoDialog` / `ExecutarRecebimentoDialog` (dry-run toggle) / `EstornarRecebimentoDialog`
  (destructive confirm) — mirror the Permutas confirm dialogs.
- Page files: `app/recebimentos/page.tsx`, `app/recebimentos/transacoes/[id]/page.tsx`,
  `app/recebimentos/conciliacoes/[id]/page.tsx`, `app/recebimentos/nde/[id]/page.tsx`.

### Net-new — shared/lib
- `lib/recebimentos.ts` — API client (mirror `lib/sispag.ts`): typed `TransacaoBancaria`/`Recebimento`/
  `RateioRecebimento`/`DocumentoAReceber`/`NotaDebitoEletronica` interfaces + `fetch*`/action functions,
  fixture fallback for the demo (mirror `fetchGestaoPermutas`' safety-net pattern).
- `lib/features.ts` — add `isRecebimentosEnabled()` (mirror `isSispagEnabled`, aligned to backend gate).

### Candidate DS promotions (optional, flag to DesignSystemReviewer)
`Stepper` and `Timeline` are named in the DS docs as molecules but **not implemented**. Building
`RecebimentoLifecycleStepper`/`CorrelationTrace` is a chance to add generic `Stepper`/`Timeline` atoms to
`components/ui/` — but keep the domain wrappers in feature code. Not required for phase 1.

---

## 5. Data / API needs (and gaps to flag to backend)

The current route surface is **insufficient for the read-heavy UI**. Flag these as needed GET endpoints.
The FE can build against fixtures first (§6) so backend work is parallel.

| # | Need | Endpoint (proposed) | Status today |
|---|------|---------------------|--------------|
| 1 | Painel KPIs + recent transactions | `GET /recebimentos/painel` | **exists but returns empty stub** — needs real reads (kpis + `transacoes`) |
| 2 | List/filter transactions | `GET /recebimentos/transacoes?filCod&status&q&page` | **MISSING — needs a GET endpoint** |
| 3 | One transaction + trace | `GET /recebimentos/transacoes/:id` | **MISSING** |
| 4 | List reconciliations | `GET /recebimentos/conciliacoes?status&filCod` | **MISSING** |
| 5 | One recebimento (spine) | `GET /recebimentos/conciliacoes/:id` | **MISSING** |
| 6 | Manual queue | `GET /recebimentos/fila-manual` (or `?status=manual`) | **MISSING** |
| 7 | List NDe | `GET /recebimentos/nde?status&filCod` | **MISSING** |
| 8 | One NDe | `GET /recebimentos/nde/:id` | **MISSING** |
| 9 | Ingestion run history | `GET /recebimentos/ingestoes` | **MISSING** (mirror `GET /sispag/... runs`) |
| 10 | Trigger ingestion (manual) | `POST /recebimentos/ingestao` | **MISSING** (mirror SISPAG ingest; today only `pipeline/run` exists) |
| 11 | Approve (HITL gate) | `POST /recebimentos/conciliacoes/:id/aprovar` | **MISSING** (transition R2) |
| 12 | Reopen | `POST /recebimentos/conciliacoes/:id/reabrir` | **MISSING** (R3) |
| 13 | Edit rateio | `POST/PUT /recebimentos/conciliacoes/:id/rateios` | **MISSING** (Módulo 3) |
| 14 | Execute (baixa+NDe, dry-run) | `POST /recebimentos/conciliacoes/:id/executar` | **partially** — `POST /pipeline/run` exists but is the coordinator entry, not a per-recebimento execute; needs the R4 shape |
| 15 | Estornar | `POST /recebimentos/conciliacoes/:id/estornar` | **MISSING** (R5) |

**Contract notes for backend:** GET responses should already carry `correlationId`, `status`, `versao`
(for optimistic concurrency 409 handling), and derived `valorAlocado`/`diferencaNaoAlocada`. Write endpoints
should honor `Idempotency-Key` (already the `pipeline/run` pattern) and default `dryRun:true`. Errors should
return `{error, code}` (the route already does for 403/400) so the FE can special-case
`RECEBIMENTO_VERSAO_CONFLITO` / `RECEBIMENTO_TRANSICAO_INVALIDA` like it special-cases 409/422 in permutas.

---

## 6. Phasing (aligned to backend Phases 1–6; DesignSystemReviewer gate applies each phase)

The FE can front-run the backend using the **fixture-fallback pattern** already proven in
`lib/api.ts::fetchGestaoPermutas` (try backend → fall back to fixtures so the panel never breaks in review).

- **Phase 1 — Shell + read scaffold (now, against fixtures/stub).**
  Home card + `/recebimentos` painel + Tabs + KPIs + transactions list + `lib/recebimentos.ts` with fixture
  fallback (seed from the backend `__fixtures__`). Feature gate `isRecebimentosEnabled()`. All read-only,
  wired to `GET /painel` (empty stub OK) + fixtures. Status chips (§2) all buildable now (enums are frozen).
  → Ships value immediately; unblocked because DTOs/constants are frozen.
- **Phase 2 — Matching / manual queue read (waits on Módulo 1 ingest + Módulo 2 matching + GET #2,3,6).**
  Transaction detail + correlation trace + Fila manual tab. Match classification chips become real.
- **Phase 3 — Reconciliation workspace read (waits on Recebimento spine reads, GET #4,5).**
  Conciliações tab + workspace (1.3) read-only: match summary, rateio view, rules+rationale, lifecycle stepper.
- **Phase 4 — Rateio editing + rules (waits on Módulo 3 rateio + Módulo 4 rules + write #13).**
  `RateioEditorTable` becomes editable; balance-bar invariant (I-Receb-1) enforced client-side + server.
- **Phase 5 — HITL actions + execution + NDe (waits on Módulo 5 execute + write #10–12,14,15).**
  Approve/reopen/execute(dry-run)/estornar dialogs; NDe list+detail become real (emission status,
  idempotency, erpResponse). This is where the human-in-the-loop gate + dry-run-first discipline land in UI.
- **Phase 6 — Observability polish (waits on Módulo 6).**
  Correlation trace enriched with real stage events/timestamps; optional polling of in-transition rows using
  the DS §8.1 silent-poll pattern (no skeleton on revalidate; stop when nothing is `importada`/in-flight).

**Gate:** every phase that touches `src/frontend/` runs **DesignSystemReviewer** before commit (tokens,
atomic classification, compound patterns, a11y, `.Skeleton` per data component, empty/no-results/error
states). Keep domain out of `components/ui/`; new status wrappers live in `app/recebimentos/components/`.

---

## 7. Key design decisions / risks to confirm with the user
1. **One panel with tabs** (Transações/Conciliações/Fila manual/NDe/Ingestões) vs. separate top-level routes.
   Plan proposes one `/recebimentos` panel + drill-in detail routes — matches SISPAG's single-panel model.
2. **Workspace as a full page** (`/conciliacoes/[id]`) vs. a dialog. Chosen page because rateio can be N
   parcelas + rules + lifecycle (too big for a modal); Permutas uses dialogs only for 1:1/simple cases.
3. **No TanStack** — confirm we stay on the `useState/useEffect` + `lib/*.ts` pattern (consistent with the
   whole codebase) rather than adopting the DS README's aspirational stack.
4. **`toast.*` vs `notify()`** — `notify()`/NotificationCenter aren't implemented; plan uses `toast.*` like
   sispag/permutas. Revisit if/when the NotificationCenter lands.
5. **Backend GET gaps (#2–9,11–15)** are the critical path for anything past Phase 1 — needs backend team
   to add read + transition endpoints. Fixtures unblock FE Phase 1 immediately.
