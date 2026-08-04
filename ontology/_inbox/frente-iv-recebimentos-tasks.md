# Tasks — Frente IV Phase 0 (model + spikes)

> **Feature:** `frente-iv-recebimentos` · **Worktree:** `/tmp/frente-iv-recebimentos-wt`
> **Phase 0 scope:** model the Frente IV ontology skeleton + open the O7/O3/NDe contract spikes.
> **No production code in this phase** — deliverables are ontology docs, ADR, doc sync, and spike briefs.

## Definition of Done (Phase 0)
Ontology skeleton approved · narrative docs synced to "quatro frentes" · three contract spikes
defined with acceptance criteria and owners · changes landed via a docs PR. Downstream phases
(1–6) do NOT start until O7 (and, for Phase 5, O3/NDe) return.

## Tasks

| # | Task | Status | Acceptance |
|---|------|--------|-----------|
| 1 | Ontology skeleton (7 entities, 5 actions, 2 state machines, `nexxera.md`, 5 rule stubs) | ✅ done | All `status: planned`; conventions match existing files; approved by Yuri |
| 2 | ADR-0022 (bootstrap Frente IV + 4 decisions D1–D5) | ✅ done | Records NDe-via-ERP, O3 assume-fin010-parametrize, new `CreditoCliente`, Nexxera unknown→spike |
| 3 | `_index.json` / `_coverage.json` bump 0.10.0 → 0.11.0 | ✅ done | Counters consistent; JSON validated |
| 4 | Sync narrative docs to "quatro frentes" | ✅ done | `ontology/README.md` + `docs-contexto/03_ontologia_financeiro.md` (+ Frente IV subsection) |
| 5 | Spike O7 — Nexxera direct channel | ⏳ open (field/vendor) | See `frente-iv-o7-nexxera-spike.md` acceptance criteria |
| 6 | Spike O3 + NDe — Conexos receivables baixa & NDe emission | ⏳ open (field/HAR) | See `frente-iv-o3-nde-conexos-spike.md` acceptance criteria |

## Gate notes
- **Version bump:** no-op. Delta touches only `ontology/` + `docs-contexto/` — no `feat`/`fix`/`perf` in
  `src/`, so `scripts/bump-version.ps1` does not bump the app version (green-criteria #10).
- **Regis-Review:** the 8-QA architecture gate audits code/architecture. This delta has **zero code
  surface** (docs/ontology only) — nothing new for the QA agents to audit. Recommend skipping with an
  explicit reason recorded in the PR (per the opt-out clause), and running it for real in Phase 1 when
  the first backend code (NexxeraClient/ingestão) lands.
- **PR:** `docs(ontology): bootstrap Frente IV — Conciliação de Recebimentos + NDe (ADR-0022)`.

## Human-in-the-loop / next actions for Yuri
- Assign owners + kick off spikes O7 and O3/NDe (both need Columbia/Nexxera field access).
- Phase 1 (`/feature-new` Module 1) starts once O7 returns the channel + sample payload.
