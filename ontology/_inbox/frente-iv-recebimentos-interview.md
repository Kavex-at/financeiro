# OfficeHours Interview — Frente IV: Conciliação de Recebimentos + NDe (Phase 0)

> **Mode:** new (deep, 4 axes) · **Date:** 2026-07-24 · **Interviewee:** Yuri
> **Feature slug:** `frente-iv-recebimentos` · **Worktree:** `/tmp/frente-iv-recebimentos-wt`
> **entity_changed:** `true` (new frente — multiple new entities)
> **Scope of THIS phase (Phase 0):** model the Frente IV ontology skeleton + open the contract spikes
> (O7 Nexxera, O3 receivables write). Deep business rules (encomenda %, multa/juros) are deferred to
> their own surgical interviews in **Phase 4**. See `frente-iv-recebimentos-nde-plan.md`.

## Axis 1 — Entity

Frente IV is the **inbound / receivables** mirror of SISPAG (outbound payments). New entities:

- **TransacaoBancaria** — a single bank movimento imported from Nexxera (crédito, débito, estorno,
  tarifa, juros, …). Holds the **raw original payload** + a **normalized** internal shape. Carries a
  **correlation id** from birth (feeds observability, Module 6). Deduped by natural key.
- **DocumentoAReceber** — read-model of an open receivable (conta a receber) from Conexos, the target
  of a baixa. (Read surface; exact ERP source to confirm in build.)
- **Recebimento** — the reconciliation aggregate: links a TransacaoBancaria (credit) to one or more
  DocumentoAReceber, carries the match classification, the rateio, applied rules, and the execution
  result. Lifecycle: rascunho → aprovado → executado → estornado.
- **RateioRecebimento** — allocation draft distributing the received value across documents / processos
  / componentes. Revisable before confirm. Mirrors the Permuta `permuta_alocacao` pattern.
- **CreditoCliente** — **NEW** (Yuri, 2026-07-24). Client-side advance credit: a customer paying us
  *before* the document exists / matures. Explicitly **distinct** from the import-side `Adiantamento`
  (which is a PROFORMA advance *to a foreign exporter*, opposite direction, different lifecycle).
- **NotaDebitoEletronica (NDe)** — the terminal artifact, **emitted by the Conexos ERP** (Yuri) — not a
  separate fiscal system, not self-generated. Modeled as an ERP-triggered action + a local record for
  idempotency ("already emitted").
- **RegraRecebimento** — a configurable, versioned business rule (encomenda / adiantamento-cliente /
  multa-juros). Full modeling deferred to Phase 4; skeleton only now.

## Axis 2 — Action

- `importarTransacoesNexxera` (Module 1) — pull movimentações, store raw + normalized, dedup, run-audit.
- `atribuirBaixa` (Module 2) — match a credit to open documents; classify única / múltiplas / parcial /
  nenhuma; uncertain → manual queue.
- `ratearRecebimento` (Module 3) — distribute value across docs/processos/componentes (invariant-checked).
- `aplicarRegrasRecebimento` (Module 4) — encomenda %, adiantamento-cliente, multa/juros; each decision
  carries a recorded rationale.
- `executarRecebimento` (Module 5) — borderô + quitação (parametrized fin010 write) + **emit NDe via
  Conexos**; idempotent + reversible.
- (Module 6 is cross-cutting observability, not a single action.)

## Axis 3 — Invariant

- **Human-in-the-loop** (ADR-0002): analyst approves matches, defines rateio, resolves exceptions.
- **No incorrect auto-baixa**: uncertain matches go to the manual queue, never auto-settled.
- **Rateio balance**: Σ allocated ≤ value received; every parcel has an identified finalidade;
  unallocated difference is explicitly registered.
- **Idempotent execution**: a retry never produces two quitações or two NDe (write-ahead ledger +
  single-attempt irreversible write, per the Permutas pattern).
- **Reversible**: controlled undo/estorno for estorno bancário, erro operacional, conciliação incorreta.
- **Full audit trail** + **per-transaction correlation id** end-to-end (Nexxera → quitação → NDe).
- **Rules configurable + versioned + explainable**.

## Axis 4 — Integration

- **Nexxera (direct)** — channel **UNKNOWN** (Yuri): API vs SFTP/CNAB not confirmed. → **O7 spike** in
  Phase 0; design a **channel-agnostic ingest port** so API/SFTP/file is a pluggable adapter.
- **Conexos — receivables baixa (O3)** — decision: **assume the fin010 module, parametrize** the write
  (borVldTipo, account codes, adto flag are permuta-specific and must become parameters). The reusable
  machinery (write-ahead ledger, single-attempt write, anti-drift, dry-run gate) carries over; the
  payload/endpoint shape is **confirmed during build** (capture a real receivables baixa if the
  parametrized bet proves wrong). See handshake analysis in this feature's notes.
- **Conexos — NDe emission** — NDe is emitted by the ERP; needs the emission endpoint/trigger contract
  (confirm alongside O3).

## Decisions log (this interview)
1. NDe is emitted by **Conexos ERP** (not a separate fiscal system, not self-generated).
2. O3: **assume fin010 + parametrize**; confirm during build.
3. Client advance → **new `CreditoCliente` entity** (distinct from import `Adiantamento`).
4. Nexxera channel **unknown → spike**; channel-agnostic port.

## Deferred to Phase 4 (surgical interviews, one per rule)
- Encomenda 0,1% / 0,9%: base of calc, meaning, destination accounts, rounding.
- Adiantamento de cliente: identification criteria + `CreditoCliente` lifecycle detail.
- Multa/juros: informed vs calculated, per-parcel destination, expected-vs-paid divergence.
