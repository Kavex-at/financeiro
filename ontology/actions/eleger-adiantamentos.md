---
name: elegerAdiantamentos
type: action
entity: Adiantamento
ontology_version: "0.2"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-09-15
preconditions:
  - "Sessão Conexos ativa (ensureSid)."
  - "Escopo de filiais definido (multi-filial, I6)."
postconditions:
  - "Lista de Adiantamentos (PROFORMA FINALIZADO) candidatos, por processo/filial."
  - "Override ExcecaoPermuta (T7, ADR-0047): candidata avaliada como BLOQUEADA/sem-saldo-permutar com exceção ativa → JA_PERMUTADO/permutado-fora-do-painel; exceção ativa cuja guarda falhou → estado calculado + BUSINESS_WARN."
  - "Nenhuma escrita no ERP (I4)."
side_effects:
  - "Leitura paginada do com298 (rate-limit — nota de implementação, paginate cap existente)."
  - "Registro de auditoria da execução (I5)."
resolved-by:
  - "P0-3 — caminho = listFinanceiroAPagar(PROFORMA) + filtro docVldTipoAdto=1 (FinDocCab); chave wire confirmada por probe de rede (dev tenant Columbia, 2026-06-18, filCod=2, 410 adiantamentos reais)"
  - "P0-7 — query lista TODAS via 3 filtros, depois elege; sem janela incremental; multi-filial (Yuri, 2026-06-17)"
---

# elegerAdiantamentos (job diário)

> **Etapa 1.** Lista os adiantamentos (PROFORMA finalizados) em aberto, por processo/filial.
> Primeira ação da cadeia; produz o universo de candidatos a avaliar.

## Query-base (P0-3 + P0-7 — RESOLVIDO)

A eleição lista **TODAS** as candidatas via os **3 filtros** confirmados por screenshot na tela
`com298` (FILTROS), depois elege:

| Filtro | Valor | Wire |
|--------|-------|------|
| **Adiantamento** | `SIM` | `docVldTipoAdto=1` (modelo `FinDocCab`) — chave wire confirmada por probe |
| **Tipo de Documento** | `PROFORMA` | `tpdCod=99` |
| **Situação** | `FINALIZADO` | `vldStatus=['3']` |
| **Plano Financeiro** | _(VAZIO)_ | — |

- Caminho correto: **`ConexosClient.listFinanceiroAPagar({ docTip: 'PROFORMA' })`**
  (`tpdCod=99`, `vldStatus=FINALIZADO`) **+ o filtro `docVldTipoAdto=1`** (FinDocCab).
- **NÃO** é o caminho `listAdiantamentoFinanceiroAPagar` / `tpdCod=143` / `gerNum=198` (path) — esse
  caminho alternativo foi **descartado** (P0-3 resolvido).
- **Sem janela incremental** especificada: a query lista todas via os 3 filtros e elege as
  candidatas. **Multi-filial** (I6). Performance/rate-limit (paginate cap existente,
  `PAGE_SIZE=500`, `MAX_PAGES=50`) é **nota de implementação não-bloqueante**.

## Chave wire RESOLVIDA (probe de rede 2026-06-18)

- A chave wire do filtro de adiantamento é **`docVldTipoAdto` = `1`** (numérico, modelo
  `FinDocCab`), confirmada por **probe de rede empírico** no dev tenant Columbia (2026-06-18,
  `filCod=2`, validado contra **410 adiantamentos reais**). Já plugado em
  `conexosPermutasConstants.ts`.
- O **placeholder anterior** (`adiantamento#EQ` / `'S'`) era um **BUG**: retornava
  **HTTP 500 `adiantamento (FinDocCab)`** (campo inexistente) — não apenas incerteza.
- **Evidência:** as PROFORMA finalizadas com `docVldTipoAdto=1` carregam `gerNum=198`
  (ADTO FORNECEDOR INTERNACIONAIS) e `gcdDesNome="ADIANTAMENTO PROFORMA"`.
- **Deixa de ser build-probe** — chave wire resolvida empiricamente.

## Idempotência

- Idempotente por design: recomputa o backlog a cada run, sem efeito colateral externo.
  Rodar 2× no mesmo dia produz o mesmo conjunto de candidatos.
