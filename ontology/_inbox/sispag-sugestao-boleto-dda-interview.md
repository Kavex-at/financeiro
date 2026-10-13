## Interview Transcript — sispag-sugestao-boleto-dda — 2026-10-13

**Mode:** new (DRAFT — pre-filled from the prompt evidence and the repo; the user was not asked live)
**Entity affected:** TituloAPagar (boleto sem DDA), BoletoDda (pool fin124), NEW `ConfirmacaoEmissorBoleto` (proposed)

> Legend: `[prompt]` = measured/stated by the user 2026-10-13/14. `[repo: path]` = read in the worktree.
> `[inferido]` = my deduction, to be confirmed. Nothing below is a decision until the user approves.

### Summary

Columbia sees few boletos associated in SISPAG: ~836 of ~1090 BOLETO titles are "boleto sem DDA". The
ERP only flags exact value + exact due date, so it cannot associate titles whose boleto differs by
cents/days or whose issuer account is unknown to it. STEP 1 shows, in the titles tab, a suggestion
of the free fin124 boleto (not used by any ERP-flagged title nor suggested to another title) with the
evidence, and a Confirm action recording the human decision per (creditor `pesCod`, issuer key
bank+agency+account derived from the barcode). Step 1 writes nothing to Conexos. The recorded
confirmation is the seed for step 2 (bind barcode to the lote item, needs HML proof) and step 3
(automatic only for confirmed pairs). The money-moving decision stays validated live at remessa time
(ADR-0040).

---

## Axis 1 — Entity

| # | Question | Pre-filled answer | Source |
|---|---|---|---|
| E1 | Core object | The suggestion pairs one `TituloAPagar` (BOLETO, `tem_boleto=false`) with one free `BoletoDda`. The suggestion itself is COMPUTED, not persisted (same stance as I-DDA1: candidate is not stored). | [repo: boleto-dda.md I-DDA1] |
| E2 | Does an entity exist? | `BoletoDda` and `TituloAPagar` exist (read-only mirrors). `FavorecidoAutorizado` exists but is per (favorecido, modalidade TED/PIX, destination fingerprint) — different concept. No entity holds "this creditor's boletos come from this issuer account". | [repo: entities/] |
| E3 | New entity needed? | YES, proposed: `ConfirmacaoEmissorBoleto` (code-facing `BoletoIssuerConfirmation`). Key: (`pesCod`, `emissorChave`). Props: `id`, `pesCod`, `credor` (snapshot), `emissorChave` (e.g. `237:2656:0092740`), `emissorMascarado`, `banco`, `estado` (`CONFIRMADO` \| `REVOGADO`), `evidencia` (snapshot JSON: título ref, boleto ddcCod/ditCod/numero, valor/venc, diff centavos, diff dias, sinais usados), `confirmadoPor`, `confirmadoEm`, `revogadoPor`, `revogadoEm`, `motivoRevogacao`, `versao`. At most 1 vigente per (`pesCod`, `emissorChave`). | [prompt: "per (creditor, issuer account)"; repo: favorecido-autorizado.md as model] |
| E4 | Immutable vs historical | Immutable: `pesCod`, `emissorChave`, `evidencia`, `confirmadoPor/Em`. Historical: state transitions via append-only event trail (reuse the ledger pattern of ADR-0065, trigger refusing UPDATE/DELETE on events). | [inferido from ADR-0065] |
| E5 | Relation to neighbours | N—1 creditor (`pesCod`, no local entity, like `TituloAPagar`). Does NOT link to a specific boleto/title (scope is the pair, not the instance). A per-title decision record ("this suggestion was confirmed/rejected for title X") is the open question Q2. | [inferido] |
| E6 | Variation of existing? | Genuinely new, but borrows structure from `FavorecidoAutorizado` (state, who/when, revoke with reason, audit). Not the same: that one authorizes a payment DESTINATION; this one asserts "boletos of this issuer belong to this creditor". Do not overload it. | [repo: favorecido-autorizado.md "Diferenças"] |
| E7 | Issuer key derivation | fin124 item has no beneficiary/CNPJ (15 fields). Issuer = bank + agency + account parsed from the 44-digit barcode; layouts known for 341 Itaú and 237 Bradesco. `CodigoBarrasBoleto` today only exposes `paraLinhaDigitavel` and `bancoEmissor`; agency/account parsing is NEW. | [prompt; repo: CodigoBarrasBoleto.ts, ConsolidacaoBoletoDda.derivadosDoCodigo] |

## Axis 2 — Action

| # | Question | Pre-filled answer | Source |
|---|---|---|---|
| A1 | Operation | `sugerirBoletoParaTitulo` (read, pure compute) + `confirmarEmissorBoleto` / `rejeitarSugestao` / `revogarConfirmacaoEmissor` (local writes only). | [prompt] |
| A2 | Preconditions of the suggestion | Title: active (not paid), `forma = BOLETO`, `tem_boleto=false`. Boleto: free (no `docCod/titCod`), not used by an ERP-flagged title, not already suggested to another title (one boleto -> one title; resolve ties by best evidence, else mark ambiguous and show nothing as "confirmable"). Boleto due date not before the title's debit date for the "safe" tier. | [prompt; repo: boleto-dda.md I-DDA2] |
| A3 | Signals / tiers (proposal) | T1 "emissor conhecido": (pesCod, emissorChave) confirmed before + value delta within tolerance + date delta within tolerance. T2 "forte": same value+day OR supplier doc number equal (strict digits, `doc_esp_numero` x `boleto_dda.numero`) combined with same day / small delta (<=1.6%?) . T3 "fraca": value+day only (no number): ambiguous by construction (MULTILOG 77 titles). Number alone is ~50% precise -> never sufficient. | [prompt: measurements; inferido tiers] |
| A4 | Postconditions of Confirm | One `ConfirmacaoEmissorBoleto` row CONFIRMADO + event row, with evidence snapshot. Title, lote and ERP untouched. UI shows the title as "boleto confirmado (emissor X)" (informative). | [prompt: step 1 no ERP write] |
| A5 | Write-back to Conexos | NONE in step 1. | [prompt] |
| A6 | Idempotency | Confirm on an already-vigente (pesCod, emissorChave) is a no-op returning the existing row (unique partial index on vigente). Re-running the suggestion is pure. Revoke on non-vigente is a no-op. | [inferido] |
| A7 | Copy digitável | Allowed in the row for roles that may see barcodes (see I5). Copy must be audited? (Q7) | [prompt: sensitive barcode] |
| A8 | Cents / days differences | Shown, never hidden: `delta valor` (R$ and % signed, boleto minus title), `delta dias` (signed, boleto minus title, same convention as `diferencaDias` of I-DDA3). Boleto > title = "paga a mais"; boleto < title = "paga a menos" (interest/discount semantics to confirm: Q6). | [repo: I-DDA3; prompt: NELSON +R$0.01 in 93/94, AR SOLUÇÕES +1-3 days] |

## Axis 3 — Invariants

| # | Invariant | Source |
|---|---|---|
| I1 | Step 1 NEVER writes to Conexos (no `importar`, no `validacao/codigoBarras`, no `titVldReflexoDdaAssoc=1`). | [prompt] |
| I2 | Money-moving validation stays LIVE at remessa time (`BoletoSemCodigoBarrasError`, ADR-0040); the local pool and any confirmation are never the authority. A confirmation does NOT make `temBoleto=true`. | [repo: boleto-exige-codigo-de-barras.md; prompt] |
| I3 | Exclusions: boleto linked by ERP to any title; boleto flagged-used (reserved by a flagged title with same value+day); boleto already suggested to another title. | [prompt; repo: I-DDA2] |
| I4 | Boleto due before the debit date is overdue (interest): never "safe", never in T1 automatic path (step 3). Dates compared as UTC-midnight civil dates (BRT). | [prompt] |
| I5 | Confirmation scope = (`pesCod`, `emissorChave`), never global, never per creditor alone, never per bank alone. MULTILOG BRASIL cc 0092740 confirmed does not cover MULTILOG S/A (cc 0006500) nor another account of the same creditor. | [prompt] |
| I6 | Barcode/linha digitável/issuer data visible only to permitted roles. Today `GET /sispag/boletos-dda` is `admin`; lote linhas digitáveis are `sispag:ver` (ADR-0053). The titles tab is used by analysts (`ver`/`executar`) -> permission choice is open (Q3). Issuer displayed MASKED (account last 4 digits) like ADR-0065 I14l. | [repo: boleto-dda.md "Acesso", routes/sispag.ts:106; ADR-0065] |
| I7 | Every confirm/reject/revoke audited (who, when, evidence snapshot, reason on reject/revoke); append-only trail. System is never the confirmer. | [repo: ADR-0065 pattern; CLAUDE.md human-in-the-loop] |
| I8 | Unknown issuer layout (bank other than 341/237): generic key = `banco:hash(campo livre?)` is NOT acceptable as an automatic-eligible key; such pairs can be confirmed per instance only and are excluded from step 3 (Q5). | [inferido] |
| I9 | Blast radius: a wrong confirmation in step 1 = wrong evidence shown (no money moves). In step 3 it would pay a wrong boleto -> that is why step 3 needs the key to be strict and live re-validation. Design the key now as if step 3 trusted it. | [inferido] |

## Axis 4 — Integration

| # | Question | Pre-filled answer | Source |
|---|---|---|---|
| N1 | External systems in step 1 | None new. Reads local `boleto_dda` and `titulo_a_pagar` (+ `doc_esp_numero`, migration 0083). Depends on the DDA sync inside ingestion (ADR-0067) for freshness; show the existing stale warning (`ddaDefasado`) beside suggestions. | [repo: ADR-0067, ddaDefasado.ts] |
| N2 | API contract with Conexos | Unchanged. | [prompt] |
| N3 | New SSM/env | None. | [inferido] |
| N4 | Tenant variation | Single tenant (Columbia); tolerances (cents, days, %) as config constants in code, not per-tenant, for now. | [inferido] |
| N5 | What step 2 needs (so the model does not block it) | (a) stable key to find the boleto: `ddcCod`+`ditCod` and `codbar` at confirmation time (snapshot in evidence) — but re-read live at bind time; (b) per-title decision record (Q2) to bind exactly one boleto; (c) the `filCod/docCod/titCod` of the title + lote item id when bound; (d) a state `APLICADO_NO_ERP` per instance, not per pair; (e) HML proof of `finItemSispag/validacao/codigoBarras` or `titulosPendentes/importar` + `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO`. HML refuses the PRD user (memory: conexos-hml-recusa-usuario-de-producao) -> needs own HML credential. | [prompt; memory] |

---

## Extracted rules (draft)

- R1: Suggestion is computed on demand from local data; not persisted; excludes boletos used by ERP-flagged titles and boletos already suggested to another title.
- R2: Supplier document number equality is supporting evidence only, never sufficient alone (~50% precision).
- R3: Confirmation is per (`pesCod`, `emissorChave`); revocable; audited; carries an evidence snapshot.
- R4: Step 1 has zero Conexos writes; remessa-time live validation remains the only authority.
- R5: Overdue boleto (due < debit date) is never presented as safe.
- R6: Barcode and issuer are sensitive; issuer is shown masked.

## Open questions

### P0 (blocks the design)

- **Q1 [P0] Confirmation granularity: pair only, or pair + instance?** The prompt says "records the human decision per (creditor, issuer account)". But the analyst confirms looking at ONE title+boleto.
  - (a) Pair only: one click makes the pair CONFIRMADO; each subsequent suggestion in the pair is displayed as "emissor confirmado" but there is no per-title record. Simplest; step 2 has nothing per-instance to bind.
  - (b) Pair + per-title decision record (`DecisaoSugestaoBoleto`: title ref, boleto ref, estado CONFIRMADA/REJEITADA, evidence), pair confirmation created as side effect. Step 2 binds from the instance record.
  - (c) Pair confirmed only after N (e.g. 2) distinct instances confirmed.
  - **Recommended: (b).** The pair row is the scope for step 3; the instance row is the audit anchor and what step 2 will bind. It also lets "Reject" mean "this boleto is not this title" without poisoning the pair.

- **Q2 [P0] What does "Confirm" mean for the pair when a title differs in value/date?** Does confirming the pair also bless the observed tolerance (e.g. NELSON +R$0.01, AR SOLUÇÕES +1-3 days)?
  - (a) Pair only: tolerance is not part of the confirmation; each suggestion re-evaluated against global limits.
  - (b) Store the observed delta pattern in the evidence and show it ("já confirmado com +R$0,01"); limits remain global.
  - (c) Per-pair tolerance learned from confirmations (used by step 3).
  - **Recommended: (b)** for step 1; defer (c) to step 3's own interview. Do not let a confirmation widen tolerance silently.

- **Q3 [P0] Who may confirm?**
  - (a) `sispag:executar` (analyst), single person. Fast; no money moves in step 1.
  - (b) Two people (solicitante `executar` + aprovador with a new permission), like ADR-0065. Safer for step 3 but friction now, and few boletos get associated because of friction.
  - (c) Single person now (`executar`), but step 3 (automatic) requires a second-person approval of the PAIR the first time it becomes automatic.
  - **Recommended: (c).** Step 1 only records evidence and moves no money; the control is placed where money starts moving automatically. Needs the user's decision because ADR-0065 sets the precedent for two people.

- **Q4 [P0] Visibility: which permission sees the suggestion with linha digitável/issuer?** Titles tab is `ver`/`executar`; barcode endpoint is `admin`; lote linhas digitáveis are `ver` (ADR-0053).
  - (a) Suggestion + masked issuer + number/value/date for `ver`; copy digitável only for `executar`.
  - (b) Everything for `executar`; `ver` sees only "há sugestão".
  - (c) Admin only (as today).
  - **Recommended: (a).** The analyst needs the evidence to decide; the full linha digitável is what is sensitive, and the lote already exposes it to `ver`, so (a) does not widen the exposure beyond ADR-0053's existing decision — but this is a security decision, confirm.

- **Q5 [P0] Issuer key for banks other than 341/237.**
  - (a) Support only 341 and 237 now; others get no suggestion tier above T3 and cannot be confirmed per pair (instance-only).
  - (b) Generic key `banco` + 'campo livre' prefix (not reliable: layouts differ).
  - (c) Probe PRD to list the banks in the pool before deciding (read-only).
  - **Recommended: (c) then (a).** Count boletos per bank of free pool first (cheap, read-only); a wrong generic key is worse than no key because step 3 would trust it.

### P1 (desirable)

- **Q6 [P1] How the UI shows value/date differences.** Options: (a) signed R$ and % (boleto − título) + signed days, with color/label for "boleto maior" and "vence depois"; (b) only absolute with badge; (c) hide differences below R$0.05. **Default: (a)**, matching the `DiferencaBadge` convention (+N dias). Flag value-higher > 1% or date-later as warning, not as block.

- **Q7 [P1] Audit of "copiar digitável".** (a) audit each copy; (b) no audit, the permission is the control. **Default: (b)** for `executar`, because the lote already hands this out under `ver` without per-copy audit.

- **Q8 [P1] Does Confirm mark the title/lote?** (a) Visual only in the titles tab ("boleto confirmado, aguardando associação no ERP"), no lote impact; (b) also adds an informative alert on the lote item (`AlertaItemLote`) that the remessa will still be blocked until step 2; (c) nothing. **Default: (a)+(b-lite):** keep the existing "sem boleto DDA" warning in the lote unchanged, since the remessa is still blocked (I2) — making it look resolved would mislead the analyst.

- **Q9 [P1] Reject semantics.** Reject with mandatory reason, hides this boleto for this title; reappears if boleto/title change? **Default:** reject is per (title, boleto); a new candidate boleto for the same title is shown anew.

- **Q10 [P1] Success metrics.** Confirmation rate (confirmed / suggested, by tier); precision proxy: share of confirmations later concordant with the ERP (when ERP flags the title or step 2 binds the same boleto); coverage: share of 836 unflagged titles with a suggestion (baseline 175 by number + value/day candidates ~146 unique). **Default:** log these three from the start; ERP-concordance computed in the retro.

- **Q11 [P1] Where in the UI.** Row action in the "Títulos a pagar" tab for 'boleto sem DDA' (reuse `BoletosDoTituloDialog`/`CandidatosBoletoDialog`, which already list candidates from ±3 days and exact value) vs. a new column. **Default:** extend the existing dialog: it already has `DiferencaBadge` and the candidate flow; add the evidence list, tiers and Confirm. Note the existing candidate rule is exact value ±3 days; the new one needs value tolerance, so the consolidation changes or a new service is added.

- **Q12 [P1] Tolerance limits.** Value: abs <= R$ 10 and <= 2%? (observed: +R$0.01, +1.6%, +R$10); days: <= 3 (existing `JANELA_CANDIDATO_DIAS`). **Default:** value delta max(R$10; 2%) AND boleto not below the title value by more than R$0.05 (boleto lower = discount, treat as suspicious); days ±3. Confirm numbers with the user.

## Proposal

### entity_changed: true
### Ontology diff needed: yes
### Reason: new entity (`ConfirmacaoEmissorBoleto`, plus possibly per-title `DecisaoSugestaoBoleto` per Q1) + new actions (`sugerirBoletoParaTitulo`, `confirmarEmissorBoleto`, `rejeitarSugestaoBoleto`, `revogarConfirmacaoEmissor`) + new invariant (confirmation scope per pair; step 1 no ERP write) + issuer-key parsing in `CodigoBarrasBoleto`. Also touches `BoletoDda` (candidate rule: tolerance) and `TituloAPagar` (informative state). Migration needed (tables + append-only events).

Hand off to OntologyCurator after Q1–Q5 are answered; otherwise the diff cannot fix the entity key and the permission model.

## DECISÕES (respondidas em 2026-10-14, na sessão — o usuário aceitou os defaults recomendados)

| # | Pergunta | Decisão |
|---|---|---|
| Q1 | Granularidade | **Par + registro por título.** O par (pesCod, emissorChave) é a confirmação; cada título sugerido/confirmado grava um registro (boleto, delta, quem, quando). O passo 2 fará o bind a partir do registro. |
| Q2 | O par abençoa o delta? | **Não.** O delta (R$, %, dias com sinal) é mostrado e gravado na evidência; os limites são **globais** e uma confirmação de par nunca os alarga. |
| Q3 | Quem confirma | **Um analista com `sispag:executar`** no passo 1 (nada é escrito no ERP). Segunda pessoa só quando o par virar automático (passo 3). |
| Q4 | Visibilidade | **`sispag:ver`** vê a sugestão com o emissor **mascarado**; **`sispag:executar`** copia a linha digitável e confirma. |
| Q5 | Chave do emissor fora de 341/237 | Medido em PRD (2026-10-14, boletos livres × títulos sem flag com candidato único): **237 = 162, 341 = 82, 104 = 17, 329 = 14, 422 = 7, 033 = 3, demais ≤ 1** — 341+237 cobrem **244 de 290 (84%)**. Parsear com layout real só **341 e 237**. Os demais bancos usam chave genérica (banco + 8 dígitos do campo livre): podem ser sugeridos e confirmados por humano, **mas nunca elegíveis a automático (passo 3)** até o layout ser verificado. |

Limites globais propostos (números a validar com a Columbia, ver P1): diferença de valor ≤ R$ 0,05 e mesmo dia (arredondamento); valor igual com boleto vencendo de 1 a 5 dias DEPOIS do título (não vencido na data de débito); acima disso (ex.: +1,6%, +R$ 10) só aparece como sugestão com a diferença destacada; boleto com vencimento ANTES da data de débito, ou número igual com valor/data muito distantes (colisão), não é sugerido como seguro.

### Pre-check suggestions for the OntologyCurator (not decisions)
- Stay with the ADR-0065 shape (state, events, versao, partial unique index on vigente).
- Add an ADR stating explicitly: the confirmation is evidence, not authority (I2) — and that step 2 and step 3 will each get their own interview/ADR.
- Reconcile the hypothesis noted in `boleto-dda.md` I-DDA3 ("ERP requires identical due date — not confirmed"): measured 2026-10-13, ERP flags exact value + exact day, 0 divergences in ~250 flagged. Update the entity text in the diff.
