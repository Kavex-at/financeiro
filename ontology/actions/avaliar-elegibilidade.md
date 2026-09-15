---
name: avaliarElegibilidade
type: action
entity: PermutaCandidata
ontology_version: "0.2"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-09-14
preconditions:
  - "Adiantamento eleito por elegerAdiantamentos."
  - "Sessão Conexos ativa."
postconditions:
  - "Cada Adiantamento marcado como aprovado-nos-4-gates ou bloqueado, com o detalhe por gate (auditoria I5)."
  - "Estado da PermutaCandidata transita descoberta → (elegivel | casamento-manual | permuta-manual | ja-permutado | bloqueada) conforme gates + INVOICE casada (ADR-0005/0007/0043)."
  - "Gate 2 reprovado (valorPermutar ≤ R$1,00) com adiantamento PAGO (|mnyTitAberto| ≤ R$1,00) e valorPermutado > 0 → JA_PERMUTADO (conclusão, terminal), nunca BLOQUEADA — com ou sem D.I (ADR-0043, ADR-0046)."
  - "Motivo escolhido pela prioridade única: nao-pago → ja-permutado/sem-saldo-permutar → data-base-indisponivel/di-duimp-ambos → casamento de invoice (ADR-0046)."
  - "Nenhuma escrita no ERP (I4)."
side_effects:
  - "Leitura detail com298 (getMnyTitPermutar) por candidato — fan-out."
  - "Leitura imp019/imp223 para o Gate 4 (existência/XOR + extração da data-base via cdiDtaCi/dioDtaDesembaraco — P0-4 RESOLVIDO)."
resolved-by:
  - "P0-4 — campo wire da data-base RESOLVIDO (cdiDtaCi imp019 / dioDtaDesembaraco imp223); probe de rede 2026-06-18, filCod=2, 410 adiantamentos reais"
  - "gate-3-pago-via-detail — RESOLVIDO na impl (getDetalheTitulos, mesma chamada do Gate 2; ver integrations/conexos.md)"
  - "residual-pago-centavos — RESOLVIDO p/ o adiantamento (ADR-0046): Gates 2 e 3 com tolerância absoluta de R$1,00"
---

# avaliarElegibilidade (4 gates)

> **Etapa 2.** Aplica os **4 gates** de elegibilidade a cada `Adiantamento` eleito.
> A elegibilidade só se completa quando, além dos 4 gates, há **INVOICE casada**
> (invariante I3 — feito em conjunto com `casarInvoice`).

## Os 4 gates

| Gate | Regra | Origem (wire) | Notas |
|------|-------|---------------|-------|
| Gate 1 | tipo = PROFORMA | `tpdCod=99` + filtro `docVldTipoAdto=1` (FinDocCab) | P0-3 RESOLVIDO (ação `elegerAdiantamentos`; chave wire confirmada por probe 2026-06-18). |
| Gate 2 | `valorPermutar > R$1,00` | `getDetalheTitulos` → `mnyTitPermutar` (BRL) | Saldo a permutar disponível (detail endpoint). `≤ R$1,00` = sem saldo (ADR-0046; antes `> 0`). |
| Gate 3 | TOTALMENTE PAGO = `|mnyTitAberto| ≤ R$1,00` | `getDetalheTitulos` → `mnyTitAberto` (BRL) | ADR-0046 (antes `=== 0`). O `pago` estrito do mapper do wire **não** é o gate (é compartilhado com invoices). Fonte via detalhe: gap `gate-3-pago-via-detail` RESOLVIDO (ver seção abaixo, mantida como histórico). |
| Gate 4 | D.I **XOR** DUIMP atrelada | `imp019.cdiDtaCi` / `imp223.dioDtaDesembaraco` pelo `priCod` | **P0-4 RESOLVIDO** (probe 2026-06-18): existência/XOR **e** extração da data-base disponíveis. |

## Reuso do ConexosClient

- Gate 2: `ConexosClient.getMnyTitPermutar({ docCod, filCod })`.
- Gate 3: derivado do payload do `com298` já lido (`isPago`) — **porém o list não traz o status
  pago populável** (ver gap `gate-3-pago-via-detail` abaixo).
- Gate 4: `imp019/list` (D.I, `cdiDtaCi`) e `imp223/list` (DUIMP, `dioDtaDesembaraco`) —
  re-introduzidos (ADR-0004); **campo da data-base RESOLVIDO (P0-4, probe 2026-06-18)**.

## Gate 4 — XOR e data-base RESOLVIDOS (P0-4, probe 2026-06-18)

- O **Gate 4 valida a existência/XOR** da declaração (D.I `imp019` **XOR** DUIMP `imp223` pelo
  `priCod`) **e** extrai a **data-base**: `cdiDtaCi` (D.I, epoch-ms) ou `dioDtaDesembaraco` (DUIMP,
  epoch-ms). XOR confirmado em dados reais (cada processo tem uma OU outra). Já plugado em
  `ConexosClient.mapDeclaracaoDataBase`. **A coluna aging agora popula.**
- Sem D.I **nem** DUIMP → `bloqueada` com motivo `data-base-indisponivel`; ambas → anomalia XOR →
  `bloqueada` (`falha-gate` / ver `di-xor-duimp`).
- A âncora do aging (P0-8) está definida como a data-base e a **leitura está disponível** — ver
  `business-rules/aging-anchor.md`. **P0-4 deixa de ser `blocked-by`.**

## Tolerância de resíduo nos Gates 2 e 3 (ADR-0046, 2026-09-14)

- Constante única `TOLERANCIA_RESIDUO_BRL = 1,00`, a mesma da âncora I-Write-6. Absoluta, em BRL (a
  moeda em que o ERP informa `mnyTitAberto` e `mnyTitPermutar`).
- Gate 2: `valorPermutar ≤ R$1,00` = sem saldo. Gate 3: `|mnyTitAberto| ≤ R$1,00` = totalmente pago.
- O roteamento de cliente-filtro (`EleicaoPermutasService`) usa os **mesmos** predicados.
- Escopo: só a elegibilidade do adiantamento. Ver `business-rules/elegibilidade-permuta.md`.

## [HISTÓRICO — RESOLVIDO] GAP — Gate 3 (TOTALMENTE PAGO) via detalhe (P1, descoberto no probe 2026-06-18)

> Resolvido na implementação: o status pago é hidratado por `getDetalheTitulos` (detalhe
> `com298/{docCod}`), na mesma chamada do Gate 2. Texto abaixo mantido como registro.

- No `com298/list`, `mnyTitAberto`/`mnyTitPago` vêm **`null`** nos **410 adiantamentos reais**, então
  `isPago` retorna **`false` para TODOS** — o Gate 3 **bloquearia tudo**. O status "TOTALMENTE PAGO"
  provavelmente mora no **endpoint de detalhe** (modal financeiro do adiantamento), igual ao
  `mnyTitPermutar` (já hidratado via `getMnyTitPermutar` detail).
- Gap **`gate-3-pago-via-detail`**: confirmar a fonte wire do status pago (detail vs list) **antes**
  de a eleição produzir candidatas elegíveis. **Bloqueante** para a feature produzir ALGUMA
  candidata elegível, mas **não** foi escopo do probe de 2026-06-18.

## Motivos de bloqueio (taxonomia)

Motivo **específico por gate reprovado** (substituiu o genérico `falha-gate`, 2026-06-19):
- `nao-pago` — Gate 3 reprovado (não totalmente pago, `mnyTitAberto > R$1,00`).
- `sem-saldo-permutar` — Gate 2 reprovado (pago, `mnyTitPermutar ≤ R$1,00`, **e nunca houve permuta**).
- `ja-permutado` — Gate 2 reprovado (`mnyTitPermutar ≤ R$1,00`) com `valorPermutado > 0`: **não é bloqueio**. Leva ao estado
  `JA_PERMUTADO` (conclusão, terminal — ADR-0043); o motivo permanece como informativo do estado.
- `di-duimp-ambos` — Gate 4 anomalia (D.I **e** DUIMP no mesmo processo).
- `data-base-indisponivel` — Gate 4 sem D.I **nem** DUIMP.
- **Prioridade quando >1 gate falha (ADR-0046, completa):**
  `nao-pago` → `ja-permutado` | `sem-saldo-permutar` → `data-base-indisponivel` | `di-duimp-ambos` →
  casamento de invoice. Causa-raiz primeiro: o saldo deriva do valor pago, e a declaração só importa
  para quem está pago e tem saldo. **A ausência de D.I/DUIMP nunca mascara motivo de pagamento ou de
  saldo.** Até 2026-09-14 o código devolvia `data-base-indisponivel` antes de todos
  (`ElegibilidadeService.ts:84-91`): 67 pagos e sem saldo (43 com baixa real, R$ 18,0 mi) e 50 não
  pagos apareciam como "Sem D.I". `falha-gate` permanece só como **fallback** não esperado.

Casamento de invoice (de `casarInvoice`): `0 → sem-invoice` (bloqueada); `>1 → composto-nm`/
`multiplas-invoices` → estado `casamento-manual` (ADR-0005), **não** bloqueada.
Ver `state-machines/elegibilidade-permuta-candidata.md`.

## Postcondição (garantia)

- Toda candidata exposta como **elegível** satisfaz os 4 gates **E** tem INVOICE casada.
  Quem falha qualquer gate (ou tem anomalia XOR / sem declaração) → **bloqueada** com `motivoBloqueio`
  (reportada, não falha).
