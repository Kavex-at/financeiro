# Frente IV — Conciliação de Recebimentos & Nota de Débito Eletrônica (NDe)

> **Status:** Planning brief (ultraplan local — cloud session unavailable). Not yet approved.
> **Date:** 2026-07-24 · **Author:** Claude Code (for Yuri)
> **Decisions taken (from interview):** (1) Full 6-module pipeline, phased into fatias. (2) Module 1
> imports bank movimentações **directly from Nexxera** (new client, API or SFTP/CNAB) — not via Conexos.

## 1. What this is

A new **inbound / receivables** frente — the mirror image of SISPAG (which is outbound payments).
It imports bank movimentações from Nexxera, attributes each credit to open financial documents,
rateia (allocates) the value, applies Columbia's business rules, and executes the downstream
financial actions culminating in the emission of a **Nota de Débito Eletrônica**. The user framed
the goal as "automate the NDe," but the NDe is the *final* output of a 6-module reconciliation
pipeline; the plan treats it as **Frente IV — Conciliação de Recebimentos**, with NDe as Module 5's
terminal action.

Human-in-the-loop invariant (ADR-0002) holds: the analyst approves matches, defines rateio, and
resolves exceptions; the solution does the mechanical work and audits everything.

## 2. Reuse map — this frente is ~60% pattern-isomorphic to SISPAG + Permutas

| Need (this frente) | Reuse from existing code | Path |
|---|---|---|
| DDD chain route→service→repository | SISPAG/Permutas routes + services | `src/backend/routes/sispag.ts`, `domain/service/sispag/*` |
| Daily ingestion (lock + idempotency + run audit + anti-ghost) | `IngestaoPagamentosService` | `domain/service/sispag/IngestaoPagamentosService.ts` |
| Persisted read-model + UPSERT fan-out by filial | `TituloAPagarRepository` | `domain/repository/sispag/TituloAPagarRepository.ts` |
| Draft-revisable N:M allocation (→ our rateio) | Permuta alocação rascunho (ADR-0008) | `domain/service/permutas/*`, `permuta_alocacao` |
| Idempotent, reversible ERP write + ledger + dry-run gate | Permuta reconciliação fin010 handshake (ADR-0013) | `domain/client/ConexosBaixaClient.ts`, `permuta_execucao` |
| Workflow aggregate w/ state machine (RASCUNHO→…) | `LotePagamentoService` + lote state machine | `domain/service/sispag/LotePagamentoService.ts` |
| Concurrency, retry, tx, advisory lock, feature gate, Zod boundaries | libs + http middleware | `domain/libs/*`, `http/sispagGate.ts` |
| Open-documents (contas a receber) reads | `ConexosSispagClient` / `ConexosFinanceiroClient` (fin010/com298/com299) | `domain/client/ConexosSispagClient.ts` |

**Net new build:** a **direct `NexxeraClient`** (no direct Nexxera code exists today — SISPAG assumes
the ERP talks to Nexxera), the **matching engine**, the **rateio engine**, the **configurable/versioned
business-rules engine**, the **NDe entity + emission integration**, and the **observability layer**.

## 3. Blockers that gate the plan (all pre-documented as P0 in `migration-debt.md`)

| ID | Blocker | Gates | Resolution |
|---|---|---|---|
| **O7** | Nexxera **direct** contract unconfirmed — auth, channel (API vs SFTP), extrato format (CNAB240 vs API JSON) | Module 1 | Vendor contract + probe/spike in Phase 0. **Chosen: direct** — so this is on our side, not the ERP's. |
| **O3** | ConexosClient write path for **receivables baixa/quitação** — is it the same fin010 handshake Permutas uses, or a different endpoint? | Module 5 | Confirm ERP write contract; likely reuse `ConexosBaixaClient` handshake, gated dry-run first. |
| **O4** | No job/scheduler runtime (Express request/response) | Modules 1 & 6 (daily import, monitoring cadence) | Start with manual-trigger + cron probe (as SISPAG ingestão does today); EventBridge is the alvo. |
| **NDe-def** | "Nota de Débito Eletrônica" is **undefined in the domain** — what is it in Columbia's context, and through what channel is it emitted (ERP? fiscal/municipal system? PDF+GED)? | Module 5 | OfficeHours interview + integration contract in Phase 0/Phase 5. |

**Business-rule ambiguities** (flagged by the user's own notes — each needs an OfficeHours interview
before its module codes):
- **Encomenda 0.1% / 0.9%**: base of calculation, meaning of each percentage, destination accounts/docs, rounding.
- **Adiantamento de cliente**: identification criteria; register as `CreditoCliente` (new) vs reuse `Adiantamento`.
- **Multa e juros**: informed vs calculated; destination of each parcel; how to treat expected-vs-paid divergence.

## 4. Domain model to add (via OntologyCurator, Phase 0)

New entities: `TransacaoBancaria` (raw + normalized movimento), `DocumentoAReceber` (read-model of
contas a receber), `Recebimento` (the reconciliation aggregate), `RateioRecebimento` (allocation
draft, mirrors `permuta_alocacao`), `NotaDebitoEletronica`, `CreditoCliente` (client advance credit),
`RegraRecebimento` (configurable+versioned rule). New state machines: `transacao-bancaria`
(importada → conciliada/parcial/manual/erro), `recebimento` (rascunho → aprovado → executado →
estornado). New integrations: `ontology/integrations/nexxera.md` (direct), `ontology/integrations/nde.md`.
New business-rules: `encomenda-percentuais`, `adiantamento-cliente`, `separacao-multa-juros`,
`invariante-rateio` (Σ ≤ recebido; toda parcela com finalidade; diferença registrada), `idempotencia-quitacao`.

## 5. Phased roadmap (each phase = one or more `/feature-new` runs through the full pipeline)

Every phase runs: worktree → OfficeHours → OntologyCurator diff → TaskScoper → AutoLoopRunner (TDD →
typecheck → lint → tests → PatternGuardian) → Regis-Review gate (P0 remediated) → rebase main →
version bump → PR. Code is born DDD/Lambda-ready (tsyringe, Zod boundaries, parameterized SQL) even on
Express/Render. Observability (Module 6) is **seeded in every phase** (correlation id, run audit,
structured logs) and consolidated in Phase 6.

### Phase 0 — Foundations & de-risking *(mostly ontology + contracts, low code)*
- Model Frente IV in `ontology/` (entities/state-machines/integrations/business-rules above).
- ADR: "Frente IV scope + direct-Nexxera decision."
- Resolve/spike **O7** (Nexxera direct: auth, channel, extrato format) with a probe under `jobs/`.
- Confirm **O3** receivables write contract and **NDe** definition/emission channel (OfficeHours).
- **Deliverable:** approved ontology diff + ADR + confirmed contracts. No user-facing feature yet.

### Phase 1 — Module 1: Nexxera import
- New `NexxeraClient` (`@singleton() @injectable()`, direct), `TransacaoBancaria` entity + repository +
  migration, `IngestaoTransacoesService` (advisory lock, idempotency key, run-audit, **dedup by natural
  key**, raw-payload storage, normalization to internal shape). Manual trigger + cron probe.
- Read-only painel of imported transactions (frontend → DesignSystemReviewer gate).
- **Deliverable:** transactions imported, deduped, stored raw+normalized, visible. Correlation id born here.

### Phase 2 — Module 2: Atribuição da baixa (matching)
- Read-model of documentos em aberto (contas a receber) from Conexos. `MatchingEngine` scoring by
  cliente/CNPJ/valor/nº documento/ref bancária/nº processo/vencimento/descrição/id Pix. Classify:
  única / múltiplas-candidatas / parcial / nenhuma. Uncertain → **manual analysis queue**.
- Painel: matching review UI (human approves).
- **Deliverable:** each credit routed to a confident match or the exceptions queue — no incorrect auto-baixa.

### Phase 3 — Module 3: Rateio
- `RateioEngine`: distribute value across documents/processos/componentes. Enforce invariants (Σ ≤
  recebido; each parcel has a finalidade; unallocated difference registered; revisable before confirm;
  fully audited). Draft (rascunho) revisable — reuse Permuta alocação pattern.
- **Deliverable:** analyst-revisable allocation, provably balanced, audit-trailed.

### Phase 4 — Module 4: Regras de negócio *(OfficeHours-heavy — the 3 ambiguous rule sets)*
- Configurable + versioned `RegraRecebimento` engine. Implement encomenda (0.1%/0.9%), adiantamento de
  cliente (→ `CreditoCliente`), multa/juros separation — **each after its interview**. Every decision
  carries a recorded rationale (audit).
- **Deliverable:** rules applied on top of rateio, versioned and explainable.

### Phase 5 — Module 5: Borderô, quitação & NDe *(highest risk — gated, homologação-first)*
- Execute: create/update borderô, quitação total/parcial, update saldo, register no ERP (reuse
  `ConexosBaixaClient` fin010 handshake + `conexosWriteEnabled`/`conexosDryRun` gating), **emit NDe**
  (new integration). **Idempotent** via `recebimento_execucao` ledger; **reversible** (estorno/undo for
  estorno bancário / erro operacional / conciliação incorreta).
- **Deliverable:** end-to-end quitação + NDe, dry-run first, then gated live in homologação.

### Phase 6 — Module 6: Observability & monitoring *(consolidation of what earlier phases seeded)*
- Dashboards + metrics + structured logs + alerts + execution history + per-transaction tracing (via
  correlation id from Phase 1) + exception reports. Answers: última consulta Nexxera, nº importadas /
  auto-conciliadas / manuais / com erro, integrações atrasadas, documentos não quitados, reprocessadas,
  tempo por etapa. Addresses migration-debt **B4** (no X-Ray/CloudWatch).
- **Deliverable:** operational health visibility across the whole pipeline.

## 6. Sequencing notes
- Phases are mostly **sequential** (each consumes the prior's output), **except**: Phase 0 contract
  spikes (O7/O3/NDe) can run in parallel, and Module 6 observability is incremental across all phases.
- Phase 4 depends on Phase 3; both depend on Phase 2; Phase 2 depends on Phase 1. Phase 5 depends on
  4 + confirmed O3/NDe contracts.
- **Recommended first action:** kick off Phase 0 via `/feature-new` to model Frente IV and open the
  three contract spikes — nothing downstream is safe to build until O7/O3/NDe are pinned.

## 7. Open questions to resolve (carry into Phase 0 OfficeHours)
1. Nexxera direct channel: API or SFTP? extrato format (CNAB240 / OFX / JSON)? auth method? sandbox?
2. NDe: exact definition in Columbia's context + emission channel + idempotency key for "already emitted."
3. Receivables baixa: same fin010 handshake as Permutas, or a distinct ERP endpoint?
4. Encomenda: base of 0.1%/0.9%, meaning, destination accounts, rounding policy.
5. Adiantamento de cliente: identification criteria; new `CreditoCliente` vs reuse `Adiantamento`.
6. Multa/juros: informed vs calculated; per-parcel destination; expected-vs-paid divergence handling.
7. Scheduler: acceptable to start manual-trigger + cron probe (like SISPAG) until EventBridge (O4)?
