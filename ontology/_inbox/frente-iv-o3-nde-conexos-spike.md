# Spike O3 + NDe — Conexos receivables baixa & NDe emission (Frente IV, Module 5)

> **Type:** contract spike (field / HAR capture) · **Opened:** 2026-07-24 · **Blocks:** Phase 5 (execution)
> **Owner:** Yuri + Flávia (Columbia) · **Feature:** `frente-iv-recebimentos`
> **Decision context:** O3 = **assume `fin010`, parametrize**; confirm shape at build (ADR-0022 D2). NDe
> is **emitted by the Conexos ERP** (ADR-0022 D1). Both are Conexos write contracts — captured together.

## Why this is lighter than the Permutas write-back was
The reusable **machinery** already exists and carries over unchanged: the write-ahead ledger pattern
(`permuta_alocacao_execucao`), single-attempt irreversible write (no retry on the settling POST),
anti-drift check against the ERP's live open balance, and the `CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN`
dry-run gate. What is **permuta-coupled and must be parametrized/confirmed**: `borVldTipo` (hardcoded
`2` = permuta), the `bxaVldAdto: 1` permuta flag, and account routing (variação cambial 131/130 — a
domestic receivable has no exchange variation). See the handshake analysis carried into this feature.

## Questions to answer (capture a real ERP action's HAR)
1. **Receivables baixa endpoint:** is it the same `fin010` module with a different `borVldTipo`, or a
   different module entirely? Capture the exact endpoint path(s) of one real contas-a-receber quitação.
2. **Borderô type:** what `borVldTipo` value does a receivables borderô use?
3. **Account routing:** which account codes receive discount / multa / juros on the receivables side
   (the permuta 131/130 variação-cambial accounts almost certainly do NOT apply)?
4. **Adto flag equivalent:** is there a `bxaVldAdto`-style flag, or is it omitted for receivables?
5. **Partial baixa:** behavior when a título already has a prior partial baixa (does step-2 live balance
   reflect it)?
6. **NDe emission:** which Conexos endpoint/trigger emits the Nota de Débito Eletrônica? What is the
   idempotency handle that says "this NDe was already emitted" (so a retry never double-emits)? Is NDe
   emission coupled to the baixa, or a separate call after quitação?

## Acceptance criteria
- [ ] HAR (or documented request/response) of one real receivables baixa, sensitive data redacted.
- [ ] Confirmed: same `fin010` (parametrized) OR a distinct module — with the exact write shape.
- [ ] `borVldTipo` value + account-routing table for receivables documented.
- [ ] NDe emission endpoint + idempotency handle documented.
- [ ] Verdict recorded: how much of `ConexosBaixaClient` parametrizes vs needs a new client.

## Unblocks
Phase 5 — `executarRecebimento` (parametrized borderô+baixa + NDe emit), `recebimento_execucao`
ledger, idempotency (`I-Receb-2`), reversibility (estorno). Runs dry-run first, then gated live in HML.
