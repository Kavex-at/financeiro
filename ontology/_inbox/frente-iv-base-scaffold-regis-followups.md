# Regis-Review follow-ups — Frente IV base scaffold

> **Run:** `2026-07-24-2153` · **Weighted score:** 7.77/10 · **Feature:** `frente-iv-base-scaffold`
> **Source:** `docs/regis-review/2026-07-24-2153/REPORT.md` + `KANBAN.md` (full card details: Problema /
> Melhoria Proposta / Resultado Esperado / file locations / métricas per card).
> **Remediated in this slice (NOT here):** the 1 P0 + all 13 P1 cards (S/M effort) — see the commit.
> **This file = the deferred backlog:** 21 P2 + 7 P3 cards → tickets for the module-owning teams, NOT
> implemented in the scaffold slice (per the /feature-new gate: only P0 re-enters the loop).

## P2 — Médio (21)
| Card | Title | Effort | Best owner / phase |
|---|---|---|---|
| availability-4 | Emitir `outcome:'error'` no MetricsPort em todos os 5 estágios | S | Module 6 (Observability) |
| availability-5 | Política de retomada quando ledger em `error`/`reconciling` órfão | M | Module 5 (Execution) |
| deployability-2 | Teste do fail-safe de `RECEBIMENTOS_ENABLED` (paridade SISPAG) | S | Module 6 / infra |
| deployability-3 | Runbook de cutover e rollback da Frente IV | S | infra / tech-lead |
| deployability-4 | Drift detection do `schema_migrations` | S | infra |
| integrability-2 | `rawMovimentoSchema` (Zod) + parse obrigatório no impl Nexxera | S | Module 1 (Import) |
| integrability-3 | Publicar `BorderoCriadoSchema`/`BaixaGravadaSchema` em `ports.ts` | S | Module 5 |
| integrability-4 | Contract-test suite compartilhada por porta | M | architecture / all teams |
| modifiability-2 | Fatiar `ports.ts` por módulo (`ports/matching.ts`, …) | S | architecture (before ports.ts becomes a merge hotspot) |
| modifiability-3 | Pipeline de stages plugável (`PipelineStage[]`) | M | architecture |
| modifiability-4 | Registro plugável de regras (`RegrasEngine.register`) antes da Fase 4 | S | Module 4 (Rules) |
| performance-3 | Variante batch `gravarBaixaBatch` no ErpReceivables port | S | Module 5 |
| performance-4 | Cache de `regra_recebimento` ativas (TTL) + índice composto | S | Module 4 |
| performance-5 | `loadAggregate`/`list(filter,pagination)`/`findByIds` no Recebimento repo | S | Module 2/5 (painel + fila) |
| fault-tolerance-4 | Seam de estorno (`estornarRecebimento`) no coordinator/service | M | Module 5 |
| fault-tolerance-5 | Seams de reconciliação: `listStuckExecucoes` + `ReceivablesReconcilerInterface` | S | Module 5/6 |
| security-3 | Enforcement runtime de PII-safety no `MetricsPortInterface` | S | Module 6 |
| security-4 | RBAC leve na leitura de `/recebimentos/painel` (viewer/analyst/admin) | S | Module 2 |
| testability-4 | Completar fixtures — 3 → 6 factories `buildX` | S | all teams |
| testability-5 | Testes negativos de Zod para os 4 schemas restantes | S | all teams |
| testability-6 | Teste do `recebimentosGate` (403 feature-flag) no CI | S | Module 6 / infra |

## P3 — Baixo (7)
| Card | Title | Effort |
|---|---|---|
| integrability-5 | `channel`/`apiVersion` em `RawMovimento`/`NexxeraFetchPeriod` | S |
| integrability-6 | Fechar tipo `MetricsEvent.attributes` contra PII (branded/whitelist) | S |
| modifiability-5 | `evolveRecebimento(prev, patch)` incrementando `versao` por mutação | S |
| modifiability-6 | Plugar entidades Frente IV em `_index.json` + `_coverage.json` (quando impl real aterrissar) | S |
| fault-tolerance-6 | Fortalecer contrato de `MetricsPort.withCorrelationId` (teste de propagação) | S |
| security-5 | Apertar `runPipelineSchema` — `valorRecebido.positive().finite()` + regex `contaDestino` | S |
| deployability-5 | Staging Render separado do prod (roadmap) | — |

## Notes
- `modifiability-2` (split `ports.ts`) is worth doing **early** — the file is already a 6-way merge hotspot;
  architecture should decide before the module teams start editing it in parallel.
- `integrability-4` (shared contract-test suite) unblocks all 6 teams validating their impls against the
  stub semantics — high leverage; schedule alongside Module 1.
- `modifiability-6` (ontology `_index`/`_coverage`) lands when the first REAL module logic ships (entities
  move from `planned` → `implemented`), not in the scaffold.

## Remediation sub-loop notes (P0 + all P1 — remediated pre-commit, 2026-07-24)

The P0 (`p0-executar-recebimento-safety`) plus all 13→ (the 13 listed as P1 in KANBAN; the sub-loop
brief scoped 14 cards P0+P1) were remediated in this worktree. Two cards were partially downscoped —
documented here so architecture can decide the residue:

- **security-1 (per-filial authz)** — there is NO per-filial primitive in the platform today: the
  Supabase JWT carries only `sub`/`email`/`role`, and there is no `app_user_filial` table. Implemented a
  MINIMAL guard `src/backend/http/filialAuthz.ts` (`assertUserCanActOnFilial`) that reads an OPTIONAL
  `filiais`/`permissions.filiais` claim off the token (`src/backend/http/auth.ts` now extracts it) and is
  wired into `POST /recebimentos/pipeline/run`. Policy while the claim is not provisioned: user WITH a
  `filiais` list → allow only listed; user WITHOUT a list → allow (role gate still applies) — the seam is
  in place to lock down with ONE change once the claim/table exists. FOLLOW-UP: provision the real
  `permissions.filiais` claim (or `app_user_filial`) and flip the default to deny; replicate the guard on
  the SISPAG money-moving routes (`POST /sispag/lotes/:id/finalizar`) for parity (the card's 2nd route).
- **testability-1 (ledger integration test)** — the repo has NO integration harness
  (`docker-compose.test.yml` absent; jest `testPathIgnorePatterns` excludes `*.integration.test.ts`). The
  real-Postgres integration test was downscoped to a STATEMENT-level contract test in
  `RecebimentoExecucaoRepository.test.ts` that pins the `CASE WHEN status='settled'` preservation SQL and
  the 3 begin branches (pending/reconciling/settled) + markSettled/markError/setBorCod paths. FOLLOW-UP:
  add `docker-compose.test.yml` + an `npm run test:integration` job, then promote the CASE-WHEN cases to a
  real Postgres round-trip.

New migration added for the aggregate round-trip (modifiability-1): `0039_recebimento_regra_aplicada.sql`
(association table so `findById` re-hydrates `regrasAplicadas`).
