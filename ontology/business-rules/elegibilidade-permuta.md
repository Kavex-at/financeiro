---
name: elegibilidade-permuta
type: business-rule
entity: PermutaCandidata
ontology_version: "0.2"
implementation_status: planned
status: draft
owners: [yuri]
invariant: I3
related_files:
  - src/backend/domain/service/permutas/ElegibilidadeService.ts
  - src/backend/domain/service/permutas/EleicaoPermutasService.ts
last_review: 2026-09-08
has_canonical_test: false
resolved-by:
  - "P0-6 — 'INVOICE casada' = exatamente 1 invoice FINALIZADA no processo (Yuri, 2026-06-17)"
  - "P0-5 — Fatia 1 só 1:1; N:M → backlog bloqueado (composto-nm) (Yuri, 2026-06-17)"
  - "P0-4 — Gate 4 data-base RESOLVIDA (cdiDtaCi imp019 / dioDtaDesembaraco imp223); probe de rede 2026-06-18, filCod=2, 410 adiantamentos reais"
open-gap:
  - "gate-3-pago-via-detail (P1) — Gate 3 (TOTALMENTE PAGO) vem null no com298/list; fonte provável = endpoint de detalhe (probe 2026-06-18). Bloqueante p/ a eleição produzir ALGUMA candidata elegível."
---

# Regra: elegibilidade-permuta (4 gates + INVOICE casada)

> **Invariante I3 — Elegibilidade estrita.** Uma `PermutaCandidata` só é **elegível** quando
> passa nos **4 gates** **E** tem **INVOICE casada**. Caso contrário, é **bloqueada**.

## Enunciado

```
elegivel(candidata) ⇔
    gate1(tipo = PROFORMA)               ∧
    gate2(valorPermutar > 0)             ∧
    gate3(TOTALMENTE PAGO)               ∧
    gate4(D.I XOR DUIMP atrelada)        ∧
    invoiceCasada(candidata) presente
```

Falha em qualquer conjunto → **um estado não-elegível**, que **não é necessariamente `BLOQUEADA`**:

| Falha | Estado resultante | ADR |
|---|---|---|
| >1 invoice FINALIZADA no processo (4 gates OK) | `CASAMENTO_MANUAL` | 0005 |
| cliente-filtro pago + saldo (Gate 4 dispensado) | `PERMUTA_MANUAL` | 0007 |
| pago, Gate 2 reprovado **com `valorPermutado > 0`** | `JA_PERMUTADO` (concluído, terminal) | 0043 |
| demais (0 invoice, não pago, sem saldo, XOR, data-base, detalhe indisponível) | `BLOQUEADA` (reportada, NÃO contada como falha do job) | — |

**I3 não muda:** a definição de *elegível* é exatamente a mesma. O que mudou é o **destino de quem
não é elegível**.

> **Dívida preexistente, fechada de carona (2026-09-08, ADR-0043).** O enunciado acima dizia, até
> hoje, que *qualquer* falha ia para `BLOQUEADA`. Isso já era **falso desde junho de 2026** para
> dois estados — `CASAMENTO_MANUAL` (ADR-0005, 2026-06-18) e `PERMUTA_MANUAL` (ADR-0007,
> 2026-06-20) —, que mudaram a máquina de estados sem atualizar esta regra. O ciclo
> `permuta-snapshot-estados` **não criou** essa dívida: ela é anterior, e foi corrigida aqui junto
> com a entrada de `JA_PERMUTADO`. Quem ler o histórico deve conseguir distinguir as duas coisas.

## Gates (referência)

| Gate | Fonte | Detalhe |
|------|-------|---------|
| 1 — PROFORMA | `com298` `tpdCod=99` + filtro `docVldTipoAdto=1` (FinDocCab) | P0-3 RESOLVIDO (chave wire confirmada por probe 2026-06-18). |
| 2 — `valorPermutar > 0` | `getMnyTitPermutar(docCod)` | Saldo a permutar disponível. |
| 3 — TOTALMENTE PAGO | `isPago` (`mnyTitAberto===0`/`pago===1`) | **NOVO GAP `gate-3-pago-via-detail`:** `mnyTitAberto`/`mnyTitPago`=`null` no `com298/list` (410 reais); fonte provável = endpoint de detalhe. |
| 4 — D.I XOR DUIMP | `imp019.cdiDtaCi`/`imp223.dioDtaDesembaraco` por `priCod` | Ver `di-xor-duimp`; data-base RESOLVIDA (P0-4, probe 2026-06-18). |

## Definição de "INVOICE casada" (P0-6 + P0-5 — RESOLVIDO)

- **"INVOICE casada" = exatamente 1 invoice FINALIZADA no processo.** Por contagem:
  - **1** → casamento auto 1:1 → `ELEGIVEL`.
  - **0** → `BLOQUEADA` (motivo `sem-invoice`, aguardando emissão).
  - **>1** → `CASAMENTO_MANUAL` (motivo informativo `composto-nm` / `multiplas-invoices`).
    **ADR-0005:** passou os 4 gates; **não é bloqueio** — falta só o analista escolher a invoice.
- **Fatia 1 executa o auto 1:1** e **sinaliza o N:M** como `CASAMENTO_MANUAL` (pronto para a escolha
  do analista). A **escrita final** (escolha + baixa) é **Fatia 2**. `PermutaCandidata` mantém shape
  **1:1** no relacional (a invoice casada do N:M é resolvida na Fatia 2). Ver `actions/casar-invoice.md`,
  `decisions/0005-estado-casamento-manual.md` e a taxonomia em
  `state-machines/elegibilidade-permuta-candidata.md`.

## Teste canônico (a escrever no TDD)

- `has_canonical_test: false` — caso canônico: 1 adiantamento + 1 invoice + D.I, 4 gates
  verdes → ELEGIVEL; mesma candidata sem invoice → BLOQUEADA (`sem-invoice`); com múltiplas
  invoices → **CASAMENTO_MANUAL** (`composto-nm`, 4 gates passados — ADR-0005); adto pago cujo
  Gate 2 reprova com `valorPermutado > 0` → **JA_PERMUTADO** (ADR-0043), nunca `BLOQUEADA`. Fixado pelo
  TaskScoper/TDD. Âncora real: PDF processo `2048` (priCod=1153). Coberto em
  `ElegibilidadeService.test.ts` (N:M → casamento-manual; sem-invoice → bloqueada).
