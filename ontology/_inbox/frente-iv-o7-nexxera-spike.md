# Spike O7 — Nexxera direct channel (Frente IV, Module 1)

> **Type:** contract spike (field + vendor) · **Opened:** 2026-07-24 · **Blocks:** Phase 1 (Module 1 import)
> **Owner:** Yuri + Columbia/Nexxera contact · **Feature:** `frente-iv-recebimentos`
> **Decision context:** integration is **direct** (not via Conexos), channel **unknown** (ADR-0022 D4).

## Goal
Confirm exactly how Columbia can pull **bank movimentações / extrato** from Nexxera, so Module 1's
`NexxeraClient` + `importarTransacoesNexxera` can be built against a real contract instead of a guess.

## Questions to answer
1. **Channel:** REST/JSON API, or SFTP + file (CNAB240 extrato / OFX / other)? Any webhook/push option?
2. **Auth:** API keys / OAuth / mTLS / SFTP key? Where do credentials live (→ SSM in prod, `.env` in dev)?
3. **Data shape:** what fields does a movimento carry — value, date, type (crédito/débito/estorno/tarifa/
   juros), counterparty CPF/CNPJ, bank reference, Pix id, description, document/process hints?
4. **Natural key for dedup:** what uniquely identifies a movimento across re-fetches (so we never
   double-import)? (bank + account + date + sequence? an id from Nexxera?)
5. **Windowing:** how are periods/pagination requested? Can we re-fetch a past window safely?
6. **Sandbox/homologação:** is there a Nexxera test environment + sample payloads/files?

## Acceptance criteria
- [ ] Channel confirmed (API vs SFTP vs file) + a sample real payload/file captured (sensitive data redacted).
- [ ] Auth mechanism + credential storage path documented.
- [ ] Field mapping table: Nexxera field → normalized `TransacaoBancaria` field.
- [ ] Dedup natural key defined.
- [ ] Sandbox availability confirmed (or explicit "prod-only, use redacted samples").

## Design note (build-time, not this spike)
Module 1 designs a **channel-agnostic ingest port** (interface) with the concrete channel as a
pluggable adapter — so whichever answer O7 returns, the matching/rateio/rules downstream are unaffected.

## Unblocks
Phase 1 — `NexxeraClient`, `TransacaoBancaria` repository/migration, `IngestaoTransacoesService`
(mirrors `IngestaoPagamentosService`: advisory lock, idempotency, run-audit, dedup, raw+normalized store).
