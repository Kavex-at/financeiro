---
name: Adiantamento
type: entity
ontology_version: "0.2"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/client/ConexosClient.ts
  - src/backend/domain/client/permutas/conexosPermutasConstants.ts
  - src/backend/domain/service/permutas/EleicaoPermutasService.ts
  - src/backend/domain/repository/permutas/PermutaRelationalRepository.ts
  - src/backend/migrations/0010_adiantamento_pagamento_parcial.sql
  - src/backend/migrations/0011_adiantamento_importador.sql
properties:
  - docCod
  - priCod
  - filCod
  - dataEmissao
  - valor
  - moeda
  - pago
  - valorPermutar
  - valorTotal
  - valorAberto
  - pesCod
  - importador
  - exportador
relationships:
  - "Adiantamento 1—1 DeclaracaoImportacao (via priCod, D.I XOR DUIMP)"
  - "Adiantamento 1—N Invoice (mesmo priCod; casamento via casarInvoice)"
  - "Adiantamento 1—1 PermutaCandidata (lado-débito da candidata)"
  - "Adiantamento N—1 ClienteFiltro (via pesCod; roteia o adto para permuta-manual)"
  - "Adiantamento 1—N Permuta (lado-débito da alocação consumada, ADR-0008)"
last_review: 2026-09-14
universality_evidence:
  - "docs/proposta/Proposta_Kavex_Columbia_Financeiro.md — Frente I (adiantamento ↔ invoice)"
  - "docs-contexto/03_ontologia_financeiro.md §2 Frente I"
  - "ontology/glossary.md — 'Adiantamento / PROFORMA'"
  - "Columbia (priCod=1153): com298 tpdCod=99, exemplo PDF processo 2048"
  - "Probe de rede dev tenant Columbia (2026-06-18, filCod=2): 410 adiantamentos reais com docVldTipoAdto=1, gerNum=198 (ADTO FORNECEDOR INTERNACIONAIS), gcdDesNome='ADIANTAMENTO PROFORMA'"
  - "Conceito universal de comex: pagamento antecipado ao exportador antes da fatura definitiva"
---

# Adiantamento (PROFORMA)

> **Lado-débito** da permuta: valor pago antecipadamente ao exportador, antes da
> fatura (Invoice) definitiva. É o documento PROFORMA finalizado no ERP Conexos.

## Definição de domínio

Um `Adiantamento` é uma obrigação financeira a-pagar do tipo PROFORMA, vinculada a um
**processo de importação** (`priCod`). Representa dinheiro que a trading adiantou ao
exportador. Enquanto não for reconciliado contra a `Invoice` correspondente (a permuta
da Fatia 2), permanece "solto" no ERP — é a fonte do backlog de pendências.

Esta fatia (Fatia 1, READ-ONLY) apenas **lê e avalia** adiantamentos; não os modifica.

## Propriedades

| Propriedade | Tipo | Imutável | Origem (wire) | Notas |
|-------------|------|----------|---------------|-------|
| `docCod` | string | sim | `com298.docCod` | Identidade do documento. |
| `priCod` | string | sim | `com298.priCod` | Código do **processo** — chave de vínculo Adiantamento↔Invoice↔D.I. |
| `filCod` | number | sim | `com298.filCod` (fallback: filial consultada) | **Invariante multi-filial I6** — filial que originou o adiantamento. Propagado ponta-a-ponta até `permuta_candidata_snapshot.fil_cod` (P0-2). Nunca `null`. |
| `dataEmissao` | Date | sim | `com298.docDtaEmissao` | Data de emissão do documento. |
| `valor` | number | não | `com298.docMnyValor` | Valor de face. |
| `moeda` | string | sim | `com298.moeEspSigla` | Moeda do documento. |
| `pago` | boolean | não | derivado do detalhe: `mnyTitAberto === 0` (estrito, wire) | Status literal de pagamento do título. **Não é o Gate 3**: desde ADR-0046 o Gate 3 (TOTALMENTE PAGO) é `valorAberto ≤ R$1,00`, e este campo estrito continua sendo o do mapper compartilhado com as invoices. Fonte: detalhe `com298/{docCod}` (gap `gate-3-pago-via-detail` RESOLVIDO; no `com298/list` o campo vem `null`). |
| `valorPermutar` | number | não | `getMnyTitPermutar(docCod)` (detail `GET /com298/{docCod}`) | Saldo a permutar disponível, em BRL, **já abatido pelo ERP** do que foi baixado em borderô finalizado (ver I-Permuta-1 / ADR-0046). `null` no list — hidratar no detail. Gate 2 (`> R$1,00`, ADR-0046). |
| `valorTotal` | number? | não | `getDetalheTitulos` → `mnyTitValor` (BRL) | Valor de face do título (detalhe). Identidade: `valorTotal = valorPago + valorAberto`. Migration `0010`. Base do **progresso de pagamento** (% pago) exibido nos bloqueados por `nao-pago`. |
| `valorAberto` | number? | não | `getDetalheTitulos` → `mnyTitAberto` (BRL) | Saldo em aberto do título (detalhe). Quanto **falta** pagar. Migration `0010`. **Base do Gate 3:** `≤ R$1,00` = TOTALMENTE PAGO (ADR-0046). |
| `pesCod` | string? | não | `imp021` (listProcessos) | Chave do **importador** do processo, hidratada na eleição. Roteia adtos de `ClienteFiltro` para `permuta-manual` (ADR-0007). Migration `0011`. |
| `importador` | string? | não | `imp021` (listProcessos) | Nome do importador (exibição/seletor do cadastro). Migration `0011`. |
| `exportador` | string? | não | `com298.dpeNomPessoa` (coalesce) | Exibição. |

## Discriminador de tipo (PROFORMA) — P0-3 RESOLVIDO (probe de rede 2026-06-18)

- `tpdCod = 99` (`TPD_PROFORMA`) + `vldStatus = '3'` (FINALIZADO) **+ filtro de adiantamento via o
  campo wire `docVldTipoAdto = 1`** (modelo `FinDocCab`) — confirmado por **probe de rede empírico**
  no dev tenant Columbia (2026-06-18, `filCod=2`, validado contra **410 adiantamentos reais**). Os
  3 filtros da tela `com298`: Adiantamento=SIM + Tipo=PROFORMA + Situação=FINALIZADO (Plano
  Financeiro vazio).
- **Chave wire confirmada:** `docVldTipoAdto` (numérico, valor `1`), modelo `FinDocCab`. Já plugado
  em `conexosPermutasConstants.ts`. O **placeholder anterior** (`adiantamento#EQ` / `'S'`) era um
  **BUG**, não só incerteza: retornava **HTTP 500 `adiantamento (FinDocCab)`** (campo inexistente).
- **Evidência:** as PROFORMA finalizadas com `docVldTipoAdto=1` carregam `gerNum=198`
  (ADTO FORNECEDOR INTERNACIONAIS) e `gcdDesNome="ADIANTAMENTO PROFORMA"`.
- Deixa de ser **build-probe** (chave wire resolvida empiricamente). Resolve também P1-A.
- O caminho `listAdiantamentoFinanceiroAPagar` (`tpdCod=143` / `gerNum=198` como *path*) foi
  **descartado** (P0-3) — `gerNum=198` é evidência de catálogo, não o caminho de eleição.

## Fonte de leitura (Conexos)

- `ConexosClient.listFinanceiroAPagar({ docTip: 'PROFORMA', priCods, filCod })` + filtro
  `docVldTipoAdto=1` (FinDocCab) → `tpdCod=99`, FINALIZADO.
- `ConexosClient.getMnyTitPermutar({ docCod, filCod })` → `valorPermutar` literal (detail).
- **Gate 3 (TOTALMENTE PAGO):** o status pago **não** vem populável no `com298/list`
  (`mnyTitAberto`/`mnyTitPago` = `null`). Fonte = endpoint de **detalhe** (`getDetalheTitulos`), gap
  `gate-3-pago-via-detail` RESOLVIDO. Regra desde ADR-0046: `|mnyTitAberto| ≤ R$1,00`.

## Auto-casamento Simples agora é PARCIAL (ADR-0010)

No casamento automático **1 invoice : N adiantamentos** (`tipoPermuta = simples`), o adiantamento já
**não** usa mais o valor cheio: o em-aberto vivo da invoice (`Invoice.valorAbertoNegociado`) é
distribuído **greedy** (maior saldo primeiro; desempate por aging) entre os adtos casados. Um adto
consumido em parte **mantém o saldo restante em aberto** — o auto-casamento ficou **parcial**, como o
manual (ADR-0008). A variação cambial é recalculada sobre o valor **parcial** usado. Ver
`business-rules/distribuicao-simples-greedy`. (READ-ONLY no ERP — só o snapshot `permuta_casamento`.)

## Fora de escopo (Fatia 1)

- Nenhuma escrita. O Adiantamento nunca é baixado/reconciliado aqui — isso é a Fatia 2 (`fin010`).
