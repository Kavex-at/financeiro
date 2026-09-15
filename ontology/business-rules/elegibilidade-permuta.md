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
last_review: 2026-09-15
has_canonical_test: false
resolved-by:
  - "P0-6 — 'INVOICE casada' = exatamente 1 invoice FINALIZADA no processo (Yuri, 2026-06-17)"
  - "P0-5 — Fatia 1 só 1:1; N:M → backlog bloqueado (composto-nm) (Yuri, 2026-06-17)"
  - "P0-4 — Gate 4 data-base RESOLVIDA (cdiDtaCi imp019 / dioDtaDesembaraco imp223); probe de rede 2026-06-18, filCod=2, 410 adiantamentos reais"
  - "gate-3-pago-via-detail — RESOLVIDO na impl (getDetalheTitulos: mnyTitAberto do detalhe com298/{docCod})"
  - "residual-pago-centavos — RESOLVIDO para o ADIANTAMENTO (ADR-0046, 2026-09-14): tolerância absoluta de R$1,00 nos Gates 2 e 3"
related_decisions: [0005, 0007, 0043, 0046, 0047]
---

# Regra: elegibilidade-permuta (4 gates + INVOICE casada)

> **Invariante I3 — Elegibilidade estrita.** Uma `PermutaCandidata` só é **elegível** quando
> passa nos **4 gates** **E** tem **INVOICE casada**. Caso contrário, é **bloqueada**.
>
> **Desde ADR-0046 (2026-09-14):** "TOTALMENTE PAGO" significa **em aberto ≤ R$ 1,00** e "há saldo a
> permutar" significa **saldo > R$ 1,00**. Resíduo de até R$ 1,00 conta como zero. A estrutura de I3
> não muda.

## Enunciado

```
elegivel(candidata) ⇔
    gate1(tipo = PROFORMA)               ∧
    gate2(valorPermutar > R$1,00)        ∧     // ADR-0046 (antes: > 0)
    gate3(|mnyTitAberto| ≤ R$1,00)         ∧     // TOTALMENTE PAGO — ADR-0046 (antes: = 0)
    gate4(D.I XOR DUIMP atrelada)        ∧
    invoiceCasada(candidata) presente
```

Falha em qualquer conjunto → **um estado não-elegível**, que **não é necessariamente `BLOQUEADA`**:

| Falha | Estado resultante | ADR |
|---|---|---|
| >1 invoice FINALIZADA no processo (4 gates OK) | `CASAMENTO_MANUAL` | 0005 |
| cliente-filtro pago + saldo (Gate 4 dispensado; mesmos predicados ≤/> R$1,00) | `PERMUTA_MANUAL` | 0007, 0046 |
| pago, Gate 2 reprovado (`valorPermutar ≤ R$1,00`) **com `valorPermutado > 0`** — com ou sem D.I | `JA_PERMUTADO` (concluído, terminal) | 0043, 0046 |
| pago, sem saldo, `valorPermutado` 0/ausente (seria `BLOQUEADA / sem-saldo-permutar`) **com `ExcecaoPermuta` ativa** | `JA_PERMUTADO` / `permutado-fora-do-painel` (override manual, T7) | 0047 |
| demais (0 invoice, não pago, sem saldo, XOR, data-base, detalhe indisponível) | `BLOQUEADA` (reportada, NÃO contada como falha do job) | — |

**I3 não muda (ADR-0043):** a definição de *elegível* é exatamente a mesma. *(A ADR-0046 depois mudou só o limiar dos Gates 2 e 3, para R$1,00; ver abaixo.)* O que mudou é o **destino de quem
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
| 2 — `valorPermutar > R$1,00` | `getDetalheTitulos` → `mnyTitPermutar` (BRL, detalhe) | Saldo a permutar disponível. `≤ R$1,00` = sem saldo (ADR-0046). |
| 3 — TOTALMENTE PAGO | `getDetalheTitulos` → `mnyTitAberto` (BRL, detalhe) | `|mnyTitAberto| ≤ R$1,00` (ADR-0046). O `pago` do wire (`mnyTitAberto === 0`) segue estrito e **não** é o gate: ele também serve às invoices. Fonte via detalhe: gap `gate-3-pago-via-detail` RESOLVIDO. |
| 4 — D.I XOR DUIMP | `imp019.cdiDtaCi`/`imp223.dioDtaDesembaraco` por `priCod` | Ver `di-xor-duimp`; data-base RESOLVIDA (P0-4, probe 2026-06-18). |

## Tolerância de resíduo — R$ 1,00 absoluto (ADR-0046)

- **Uma constante de domínio**, `TOLERANCIA_RESIDUO_BRL = 1,00`, a mesma da âncora I-Write-6
  (`fin010-write-contract.md`, `ReconciliacaoPermutaService` `limiteResiduo = 1`). Absoluta, nunca
  proporcional: num adto de R$ 20 mi, um teto percentual absorveria saldo real.
- Aplica-se a **Gate 2**, **Gate 3** e ao roteamento de cliente-filtro (T4). **Não** se aplica a
  `Invoice.pago`, ao `pago` dos títulos do SISPAG nem à cobertura da baixa (I-Write-8a). Estender a
  tolerância a eles exige decisão própria.
- Evidência: 28 adtos `permuta-manual` (INOX) com resíduo de USD 0,00–0,02 (R$ < 0,15) e doc 8721 com
  R$ 0,02 em aberto sobre R$ 20.373.009,89. Resíduos de R$ 21,01 a R$ 2.175,86 (docs 3754, 20418,
  5885, 21841, 4576) seguem `nao-pago`.

## Prioridade dos motivos — única e completa (ADR-0046)

Quando mais de um gate falha, o motivo é escolhido nesta ordem (causa-raiz primeiro):

```
1. nao-pago                                   (Gate 3)
2. ja-permutado | sem-saldo-permutar          (Gate 2)
3. data-base-indisponivel | di-duimp-ambos    (Gate 4)
4. casamento de invoice                       (sem-invoice | composto-nm/multiplas-invoices | 1:1)
```

A ausência de D.I/DUIMP **nunca** mascara motivo de pagamento ou de saldo. I2 (`di-xor-duimp`) não
muda; muda só a precedência do motivo.

## Exceção manual "permutado fora do painel" (ADR-0047)

- **Não é parte de I3 nem da avaliação.** É um override da **eleição**, aplicado depois dos gates e do
  roteamento de cliente-filtro, sobre um único resultado: `BLOQUEADA / sem-saldo-permutar`.
- `ExcecaoPermuta` ativa ∧ resultado calculado = `BLOQUEADA / sem-saldo-permutar` → `JA_PERMUTADO` com
  motivo `permutado-fora-do-painel`.
- Qualquer outro resultado calculado vence a exceção (o ERP manda): `valorPermutado > 0` →
  `JA_PERMUTADO / ja-permutado`; saldo > R$1,00, não pago etc. → o estado calculado, com `BUSINESS_WARN`.
- Nenhuma regra automática infere "permutado por fora" (conta da baixa, baixas cruzadas): ver alternativas
  rejeitadas na ADR-0047.

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
  TaskScoper/TDD. **ADR-0046:** `mnyTitAberto = 0,02` → Gate 3 passa; `valorPermutar = 0,99` com
  `valorPermutado > 0` → `JA_PERMUTADO`; `valorPermutar = 1,01` → há saldo; pago + sem saldo + sem D.I
  → `JA_PERMUTADO` (nunca `data-base-indisponivel`); não pago + sem D.I → `nao-pago`. Âncora real: PDF processo `2048` (priCod=1153). Coberto em
  `ElegibilidadeService.test.ts` (N:M → casamento-manual; sem-invoice → bloqueada).
