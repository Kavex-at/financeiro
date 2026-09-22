# Tasks: sispag-data-pagamento

**Spec source:** ADR-0049 (`ontology/decisions/0049-data-de-debito-da-remessa-sispag-escolhivel.md`),
`ontology/business-rules/data-debito-remessa-sispag.md`, invariant I8 in
`ontology/entities/lote-pagamento.md`; open P1 questions in `ontology/_inbox/sispag-data-pagamento-gap.md`
(none blocking).
**Ontology diff:** yes (committed in db74626) — `decisions/0049-…`, `business-rules/data-debito-remessa-sispag.md`,
`entities/lote-pagamento.md` (I8, `dataDebito`), `business-rules/retomada-remessa-sispag.md`, state-machine note on L8.
**entity_changed:** true
**Estimated scope:** L (migration + new calendar lib + new domain service + change to the fin015 write
orchestration + 2 routes + new frontend dialog)

## Design decisions taken here (the ADR left them to the TaskScoper)

- **Window upper bound: `ItemLote.vencimento` snapshot, not a live ERP read.** The ERP's R2 compares with
  `itsDtaPgto`, which is itself a snapshot of `titDtaVencimento` taken at import from the same data our
  ingestion snapshots. A live read would add a Conexos round-trip every time the dialog opens, with no
  gain in authority: `finalizarLote` stays the final word. If the due date changed in the ERP after
  inclusion, `finalizarLote` fails as it does today (fail-closed, existing path). The snapshot is already
  what `desfazerAutomaticosVencidos` trusts.
- **Civil date of a due date = UTC day key** (`brDayKey` semantics in `src/backend/utils/index.ts:42`),
  **not** the BRT day: Conexos date epochs are 00:00Z/15:00Z of the intended day, and converting them to
  BRT would move the due date back one day and shrink the window by one day.
- **"Hoje" = BRT civil date** (`America/Sao_Paulo`, via `Intl`, no new dependency). **ERP encoding
  unchanged:** the civil date goes to `flpDtaCredito` as `Date.UTC(y, m, d)`, exactly what `hojeUtc()`
  sends today, so the watermark comparison (`l.dataDebito === payload.dataDebito`) keeps working.
- **Default when `dataDebito` is omitted (API/jobs): the first business day of the window** (= today BRT
  when today is a business day, per the rule's "se hoje não é dia útil, o default é o primeiro dia útil
  da janela"). Empty window with no date given → the same out-of-window error.
- **I8b "native lote exists"** = the existing expression
  `retomarDe === 'criar_lote' ? undefined : (flpCodRetomado ?? anterior?.nativeFlpCod)`, evaluated after
  the ERP sync and **before** `ledger.beginExecution`. When it is defined: the persisted
  `lote.dataDebito` is used; a different date in the request → `DebitDateFrozenError`; no date in the
  request → the persisted one.
- **Frozen date now in the past blocks only while `finalizar` has not happened in the ERP**
  (`retomarDe ∈ {importar, finalizar}` or native lote reused from the ledger with no later stage). If
  the ERP has already finalized (`retomarDe ∈ {gerar_remessa, concluido}`), R1 is no longer checked and
  blocking would strand a valid remessa.
- **Legacy in-flight lote** (native lote exists but `data_debito IS NULL`, created before the
  migration): no frozen value is known and none is sent to the ERP (the `criarLote` is skipped), so
  accept, do not persist a guess, log `BUSINESS_WARN`. The ERP's R1 at `finalizar` remains the guard.
- **Due date missing on an item** → empty window with reason `titulo_sem_vencimento` (fail-closed, as the
  rule demands when in doubt). See risk R1.
- **Window logic lives in a new `DebitDateService`**, not in `RemessaService` (already over 1,000 lines).
  `RemessaService` and the GET route both consume it.
- **Identifiers in English** (CLAUDE.md): `BankingCalendar.isBusinessDay` / `nextBusinessDay` /
  `todayBrt` are the `isDiaUtil` / `proximoDiaUtil` / `hojeBrt` of the brief. Operator messages in
  Portuguese.

## Task list

### Task 1: Write failing tests for the banking calendar
**Files to change:**
- `src/backend/domain/libs/calendar/BankingCalendar.test.ts` (new)

**Acceptance criteria:**
- [ ] Easter: 2024 = 2024-03-31, 2025 = 2025-04-20, 2026 = 2026-04-05, 2027 = 2027-03-28
- [ ] 2026 movable holidays: Carnaval 2026-02-16 and 2026-02-17, Good Friday 2026-04-03, Corpus Christi 2026-06-04; Ash Wednesday 2026-02-18 is a business day
- [ ] 2025 movable holidays: Carnaval 2025-03-03/04, Good Friday 2025-04-18, Corpus Christi 2025-06-19
- [ ] Fixed holidays for 2026: 01-01, 04-21, 05-01, 09-07, 10-12, 11-02, 11-15, 11-20, 12-25 are not business days
- [ ] 20/11 rule: 2023-11-20 (Monday) IS a business day; 2024-11-20 (Wednesday) is NOT
- [ ] Weekends: 2026-09-26 (Saturday) and 2026-09-27 (Sunday) are not business days; 2026-09-22 is
- [ ] `nextBusinessDay('2026-09-25')` = `'2026-09-28'`; `nextBusinessDay('2026-02-13')` = `'2026-02-18'` (skips weekend + Carnaval)
- [ ] `todayBrt()` with an injected clock at `2026-09-22T02:30:00Z` (= 21/09 23:30 BRT) returns `'2026-09-21'`; at `2026-09-22T03:00:00Z` returns `'2026-09-22'`
- [ ] `toErpEpoch('2026-09-22')` = `Date.UTC(2026, 8, 22)` (same encoding as the current `hojeUtc()`)
- [ ] Malformed civil dates (`'2026-02-30'`, `'22/09/2026'`) are rejected
- [ ] Tests fail (module does not exist yet)

**Dependencies:** none

---

### Task 2: Implement BankingCalendar
**Files to change:**
- `src/backend/domain/libs/calendar/BankingCalendar.ts` (new)

**Acceptance criteria:**
- [ ] Exported class, `@singleton() @injectable()`, arrow-function methods with explicit access modifiers
- [ ] Easter via a deterministic algorithm (anonymous Gregorian / Meeus-Jones-Butcher); no table, no network, no new dependency
- [ ] Public API: `easter(year)`, `holidays(year)`, `isBusinessDay(civil)`, `nextBusinessDay(civil)`, `todayBrt()`, `toErpEpoch(civil)`, `fromErpEpoch(epoch)` (UTC day key), `addDays(civil, n)`; civil dates are `'YYYY-MM-DD'` strings
- [ ] `todayBrt()` uses `Intl` with `timeZone: 'America/Sao_Paulo'` and an injectable clock (for tests); no `process.env`
- [ ] All Task 1 tests pass; `npm run typecheck` and `npm run lint` pass in `src/backend`

**Dependencies:** Task 1

---

### Task 3: Migration and repository for `lote_pagamento.data_debito`
**Files to change:**
- `src/backend/migrations/0061_lote_data_debito.sql` (new)
- `src/backend/domain/repository/sispag/LotePagamentoRepository.ts`
- `src/backend/domain/repository/sispag/LotePagamentoRepository.test.ts`
- `src/backend/domain/interface/sispag/SispagInterface.ts` (`LotePagamento.dataDebito?: string`)

**Acceptance criteria:**
- [ ] Migration is idempotent: `ALTER TABLE lote_pagamento ADD COLUMN IF NOT EXISTS data_debito DATE` (nullable, no backfill, so no rollback script is required by the rollbacks policy), with a header comment citing ADR-0049/I8
- [ ] Failing repository tests written first, then green
- [ ] `getLoteComItens` and `listLotes` return `dataDebito` as `'YYYY-MM-DD'`, read with `to_char(data_debito, 'YYYY-MM-DD')` (never through node-pg's DATE→local `Date` parsing); `null` maps to `undefined`
- [ ] New `setDataDebito({ loteId, dataDebito }, tx?)` writes with a parameterized query (`$loteId`, `$dataDebito`); no string interpolation
- [ ] `typecheck` / `lint` / `npm test` pass

**Dependencies:** none

---

### Task 4: Domain errors for the debit date
**Files to change:**
- `src/backend/domain/errors/DebitDateOutsideWindowError.ts` (new)
- `src/backend/domain/errors/DebitDateFrozenError.ts` (new)
- matching `*.test.ts` if the other domain errors have one (follow `LoteAnteriorCanceladoError.ts`)

**Acceptance criteria:**
- [ ] Both follow the existing HandlerError shape (`code`, `statusCode`, `userMessage`, `details`, `retryable: false`), so `respondLoteError` in `routes/sispag.ts` maps them with no new branch
- [ ] `DebitDateOutsideWindowError`: `code = 'DATA_DEBITO_FORA_DA_JANELA'`, HTTP 422; `details` carry `{ dataDebito?, min?, max?, motivo, limitante? }`; the Portuguese message names the limiting title when the date is above the max (e.g. "Data 30/09 depois do vencimento do título 123/1 (FORNECEDOR X, vence 29/09). Permitido: 22/09 a 29/09.") and states the reason for an empty window
- [ ] `DebitDateFrozenError`: `code = 'DATA_DEBITO_CONGELADA'`, HTTP 409; `details.motivo ∈ {'diferente', 'no_passado'}`, `details.dataCongelada`, `details.nativeFlpCod`; the `no_passado` message tells the operator to cancel lote nativo `flp N` in `fin015` and generate again (the `LoteAnteriorCanceladoError` flow then allows a new date)
- [ ] Class names in English; operator messages in Portuguese

**Dependencies:** none

---

### Task 5: DebitDateService — allowed window of a FINALIZADO lote
**Files to change:**
- `src/backend/domain/service/sispag/DebitDateService.ts` (new)
- `src/backend/domain/service/sispag/DebitDateService.test.ts` (new, written first)

**Acceptance criteria:**
- [ ] `getWindow(loteId)` returns `{ hoje, sugerida?, amanha?, min?, max?, limitante?: { itemId, credor, documento, vencimento }, naoUteis: string[], vazia?: { motivo }, congelada?: { data, nativeFlpCod, motivo } }` (`itemId` = `filCod:docCod:titCod`, `documento` = `docCod/titCod`)
- [ ] `min` = first business day ≥ `hoje` (BRT); `max` = last business day ≤ min(item due dates, as UTC day keys); `naoUteis` = the non-business days inside `[min, max]`; `sugerida` = `min`; `amanha` = `nextBusinessDay(hoje)` when it is inside the window
- [ ] Test (clock 2026-09-22): item due 2026-09-26 (Saturday) → `min 2026-09-22`, `max 2026-09-25`, `limitante` names that item
- [ ] Test: two items, the earlier due date defines `max` and `limitante`
- [ ] Test: an item already overdue → `vazia.motivo = 'titulo_vencido'`, with `limitante`
- [ ] Test: today Saturday 2026-09-26, lowest due date 2026-09-27 → `vazia.motivo = 'sem_dia_util'`
- [ ] Test: an item with no due date → `vazia.motivo = 'titulo_sem_vencimento'`
- [ ] Test: `max` falling on Carnaval Tuesday 2026-02-17 → `max = 2026-02-13`
- [ ] Test: lote with `nativeFlpCod` and `dataDebito` persisted → `congelada` is filled in and the window is still reported
- [ ] Lote not FINALIZADO or not found → `LoteEstadoInvalidoError` (same as `gerarRemessa`)
- [ ] `validate(lote, dataDebito)` (used by Task 6) throws `DebitDateOutsideWindowError` for a date outside the window, a non-business day or an empty window
- [ ] `@injectable()`, dependencies via constructor (repository + `BankingCalendar`), no raw `process.env`

**Dependencies:** Tasks 2, 3, 4

---

### Task 6: RemessaService.gerarRemessa takes `dataDebito` (I8a + I8b)
**Files to change:**
- `src/backend/domain/service/sispag/RemessaService.ts`
- `src/backend/domain/service/sispag/RemessaService.test.ts` (regression tests first)

**Acceptance criteria:**
- [ ] `GerarRemessaInput.dataDebito?: string` (`'YYYY-MM-DD'`); `GerarRemessaResult.dataDebito?: string`
- [ ] `hojeUtc()` is removed; the date comes from `BankingCalendar`/`DebitDateService`; the ERP still gets `toErpEpoch(civil)` in `criarLote` and in the ledger watermark `requestPayload.dataDebito`
- [ ] Test: date above `max` → `DebitDateOutsideWindowError`, and `ledger.beginExecution`, `write.listarLotesNativos`, `write.criarLote` and `loteRepo.setDataDebito` are **not** called
- [ ] Test: a Saturday or a holiday → same rejection, nothing written
- [ ] Test: no `dataDebito` → the first business day of the window is used and returned
- [ ] Test (clock at 23:30 BRT on 21/09 = 02:30Z on 22/09): `criarLote` receives `Date.UTC(2026, 8, 21)`, not the 22nd
- [ ] Test: fresh creation persists `loteRepo.setDataDebito` **before** `write.criarLote` (call order asserted)
- [ ] Test (I8b): with the native lote reused (`anterior.nativeFlpCod` set) and `lote.dataDebito = '2026-09-23'`, a request for `'2026-09-24'` → `DebitDateFrozenError(motivo='diferente')`, nothing written; a request for `'2026-09-23'` or no date → proceeds and returns `'2026-09-23'`
- [ ] Test (I8b past): native lote reused, frozen date < today, `retomarDe` ∈ {`importar`, `finalizar`} → `DebitDateFrozenError(motivo='no_passado')` thrown before `beginExecution`; with `retomarDe = 'gerar_remessa'` it proceeds
- [ ] Test: `sync.etapa = 'criar_lote'` after `confirmarNovoLote` (native lote cancelled) → the new date is accepted and replaces the old one, even if it differs from `lote.dataDebito`
- [ ] Test: legacy lote (native exists, `lote.dataDebito` undefined) → proceeds, logs `BUSINESS_WARN`, persists nothing
- [ ] Test: `adotarPorMarcaDagua` still matches on the ledger-stored `dataDebito` epoch (existing tests stay green)
- [ ] Test: dry-run validates the date (invalid → same error) and returns `dataDebito` in the result and the log; no persistence
- [ ] All existing `RemessaService.test.ts` tests stay green
- [ ] `typecheck` / `lint` / `npm test` pass

**Dependencies:** Task 5

---

### Task 7: Routes — `dataDebito` on POST remessa, GET window
**Files to change:**
- `src/backend/routes/sispag.ts`
- `src/backend/routes/sispag.test.ts`

**Acceptance criteria:**
- [ ] `POST /sispag/lotes/:id/remessa` validates the body with Zod: `dataDebito` optional, `/^\d{4}-\d{2}-\d{2}$/` plus a valid calendar date; invalid → 400 and the service is not called
- [ ] Valid `dataDebito` is passed through to `gerarRemessa`; `dryRun` and `confirmarNovoLote` behave exactly as before (existing tests green)
- [ ] `GET /sispag/lotes/:id/remessa/janela` → 200 with the `DebitDateService.getWindow` body; same auth as the other lote reads; domain errors through `respondLoteError`
- [ ] Route tests: 422 `DATA_DEBITO_FORA_DA_JANELA` and 409 `DATA_DEBITO_CONGELADA` come out with `code` and `details`; 400 on `'22/09/2026'`; window 200
- [ ] `typecheck` / `lint` / `npm test` pass

**Dependencies:** Tasks 5, 6

---

### Task 8: Frontend API client and types
**Files to change:**
- `src/frontend/lib/sispag.ts`
- `src/frontend/lib/sispag.test.ts`

**Acceptance criteria:**
- [ ] `LotePagamento.dataDebito?: string`; `GerarRemessaResult.dataDebito?: string`; new `JanelaDataDebito` type mirroring Task 5
- [ ] `gerarRemessa(loteId, opts)` accepts `opts.dataDebito` and sends it in the body only when present; the `Idempotency-Key` stays `remessa:${loteId}`
- [ ] New `fetchJanelaDataDebito(loteId)`
- [ ] Error mapping: `code` `DATA_DEBITO_FORA_DA_JANELA` / `DATA_DEBITO_CONGELADA` become typed error classes (following `LoteAnteriorCanceladoError`) that carry `details`
- [ ] `formatCivilDate('2026-09-22')` → `'22/09'` by string split, never `new Date(...)` (no timezone drift)
- [ ] Tests: body contains `dataDebito` and `confirmarNovoLote` together; body without `dataDebito` when omitted; both error codes map to their classes; formatter
- [ ] `npm run typecheck` / `npm run lint` / `npm test` pass in `src/frontend`

**Dependencies:** Task 7

---

### Task 9: "Gerar remessa" dialog and "débito em dd/mm" on the card
**Files to change:**
- `src/frontend/app/sispag/components/GerarRemessaDialog.tsx` (new, same shadcn `Dialog` pattern as `AdicionarTituloDialog.tsx` / `IngestaoDialog.tsx`)
- `src/frontend/app/sispag/components/GerarRemessaDialog.test.tsx` (new)
- `src/frontend/app/sispag/components/LoteCard.tsx`
- `src/frontend/app/sispag/page.tsx` (toast for the two new error classes, next to `LoteAnteriorCanceladoError`)

**Acceptance criteria:**
- [ ] "Gerar remessa (.REM)" opens the dialog instead of calling the API; the dialog loads `fetchJanelaDataDebito` on open (loading and error states)
- [ ] Summary: number of titles, total (`lib/brl.ts`), paying account (`l.conta`)
- [ ] Quick buttons "Hoje dd/mm" and "Amanhã dd/mm" use `hoje`/`amanha` from the backend (no calendar logic in the frontend); each is disabled when its date is outside the window or is not a business day
- [ ] Date input = `components/ui/date-picker.tsx` with `min`/`max` from the window; the native input cannot disable individual days, so choosing a day in `naoUteis` shows an inline error ("dd/mm não é dia útil bancário") and disables "Gerar remessa"
- [ ] Shows "Permitido: dd/mm a dd/mm" and the limiting title ("limitado pelo título DOC/TIT — CREDOR, vence dd/mm")
- [ ] Empty window: explanation matching `vazia.motivo`, "Gerar remessa" disabled
- [ ] Frozen date (`congelada`): shown read-only with the reason ("lote nativo flp N já criado no Conexos com esta data; para mudar, cancele no fin015") and generation proceeds with that date
- [ ] Default selection = `congelada.data` ?? `sugerida`
- [ ] Confirm calls `acao((o) => gerarRemessa(l.id, { ...o, dataDebito }), okMsg)`, so the `LoteAnteriorCanceladoError` toast retry in `page.tsx` repeats the call with the **same** date plus `confirmarNovoLote: true` (test asserts both fields on the retried call)
- [ ] The existing success/dry-run/skipped messages are kept; the success message includes "débito em dd/mm"
- [ ] The card shows "débito em dd/mm" whenever `l.dataDebito` is set (FINALIZADO with a frozen date, REMESSA_GERADA, RETORNADO)
- [ ] `page.tsx`: `DATA_DEBITO_FORA_DA_JANELA` → warning toast with the backend message; `DATA_DEBITO_CONGELADA` → warning toast pointing to fin015; neither falls into the generic error toast
- [ ] Component tests: renders the window, disables quick buttons outside the window, blocks a non-business day, sends the chosen date, read-only frozen mode, empty-window mode
- [ ] `npm run typecheck` / `npm run lint` / `npm test` pass in `src/frontend`

**Dependencies:** Task 8

---

### Task 10: Jobs that hard-code `hojeUtc()`
**Files to change:**
- `src/backend/jobs/validate-retomada-remessa-v1.ts`
- `src/backend/jobs/execute-fin015-prd.ts`

**Acceptance criteria:**
- [ ] Trivial swap only: the local `hojeUtc()` becomes `calendar.toErpEpoch(calendar.todayBrt())` via `BankingCalendar` (no other logic change); the comment "o MESMO cálculo do `RemessaService.hojeUtc`" is updated
- [ ] If either swap turns out not to be trivial (e.g. container bootstrap needed only for this), leave that file untouched and record it in the PR body
- [ ] `preflight-fin015-prd.ts` and `validate-fin015-import.ts` also have a local `hojeUtc()`: out of scope, listed in the PR body as follow-up
- [ ] `typecheck` / `lint` pass

**Dependencies:** Task 2

---

### Task 11: Live check in HML (human-in-the-loop, QaCoach script)
**Files to change:**
- none (manual run in the HML tenant; evidence noted in the PR body)

**Acceptance criteria:**
- [ ] A remessa with a debit date of D+1 (business day) finalizes in `fin015`, and the native lote's `flpDtaCredito` read back via `listarLotesNativos` equals `Date.UTC` of the chosen date
- [ ] A date after the lowest due date is refused by us (422) with no native lote created (count of native lotes for the filial/bank unchanged)
- [ ] Retry after a forced failure following `criarLote` reuses the same date; a different date is refused (409)

**Dependencies:** Tasks 6, 7, 9

## Definition of Done

All tasks complete AND:
- [ ] `npm run typecheck` ✅ (`src/backend` and `src/frontend`)
- [ ] `npm run lint` ✅ (`src/backend` and `src/frontend`)
- [ ] `npm test` ✅ (`src/backend` and `src/frontend`)
- [ ] PatternGuardian gate ✅
- [ ] entity_changed: ontology diff in `ontology/` present ✅ (db74626); after the code lands, set `implementation_status` / `has_canonical_test` in `business-rules/data-debito-remessa-sispag.md` and update `_index.json`/`_coverage.json`
- [ ] frontend touched: DesignSystemReviewer gate ✅
- [ ] new handler/job: not applicable (no new Lambda/job; ObservabilityAdvisor is not triggered)
- [ ] Regis-Review gate ✅ (P0 fixed; P1–P3 go to `ontology/_inbox/sispag-data-pagamento-regis-followups.md`)
- [ ] Rebase on `main` ✅
- [ ] delta has `feat` in `src/`: app version bumped as **minor** (FE+BE lockstep, both `package.json` by hand because there is no pwsh on this machine) + `CHANGELOG.md` updated ✅

## Ground-Truth Validation

**The gate does not apply.** GTV compares our monetary computation with what Conexos booked (CTB066,
rpImp180…). This change computes no amounts. It picks a date that we send to the ERP, and the ERP
itself accepts or rejects it (R1/R2 at `finalizarLote`). There is no native ground truth to compare
against. The equivalent live proof is Task 11, a manual write in HML, not a read-only
`validate-<slug>-vN.ts` script.

## Risks and ambiguities

- **R1 — items with no due date.** The window fails closed (`titulo_sem_vencimento`). Before Task 5,
  count the rows with `vencimento IS NULL` in `lote_pagamento_item` for FINALIZADO lotes (read-only). If
  there are any, the decision goes back to Yuri: fail closed, or ignore those rows and let the ERP decide.
- **R2 — non-business days in the native `<input type="date">`.** The native input cannot grey out
  individual days. The fallback here is an inline error plus a disabled submit button. If
  DesignSystemReviewer asks for days that are actually greyed out, that means a calendar grid (no
  `react-day-picker` in the repo today, so adding one is a new dependency).
- **R3 — the frozen date shown by the dialog may belong to a native lote that was already cancelled in
  the ERP.** The GET endpoint does not ask the ERP. The POST then raises `LoteAnteriorCanceladoError`,
  and the toast retry carries the old date. If that date is still valid, it works. If not, the 422 tells
  the operator to reopen the dialog. This is accepted.
- **R4 — municipal holidays and 31/12** are not blocked (gap P1-1/P1-2). This is intentional in this
  delivery.
