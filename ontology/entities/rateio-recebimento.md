---
name: RateioRecebimento
type: entity
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties:
  - id
  - recebimentoId
  - documentoDocCod
  - documentoTitCod
  - filCod
  - priCod
  - componente
  - finalidade
  - valorAlocado
  - moeda
  - incluidoPor
relationships:
  - "RateioRecebimento N—1 Recebimento (via recebimentoId — a parcela pertence a uma conciliação; membro do agregado)"
  - "RateioRecebimento N—1 DocumentoAReceber (via filCod:documentoDocCod:documentoTitCod — o recebível alvo da parcela)"
last_review: 2026-07-24
universality_evidence:
  - "docs-contexto/03_ontologia_financeiro.md — Frente IV: distribuir o valor recebido por documentos/processos/componentes é o rateio"
  - "ontology/_inbox/frente-iv-recebimentos-interview.md — Eixo 1: RateioRecebimento (rascunho revisável de alocação; mirror de permuta_alocacao)"
  - "ontology/_inbox/frente-iv-recebimentos-nde-plan.md §4 / Fase 3 — RateioRecebimento espelha permuta_alocacao (rascunho revisável)"
  - "Conceito universal de financeiro: um pagamento recebido raramente casa 1:1 com um único recebível — distribuir (ratear) o valor por vários documentos/componentes com saldo é intrínseco à conciliação"
---

# RateioRecebimento (parcela de alocação — Frente IV)

> **SKELETON (Fase 0).** Um `RateioRecebimento` é uma **parcela de alocação**: distribui parte do
> valor recebido (`Recebimento`) sobre **um** `DocumentoAReceber` / processo / componente. É um
> **rascunho revisável** antes do confirm — **espelha o `permuta_alocacao`** da Frente I (rascunho
> local, editável, sobrevive à re-leitura). É **membro do agregado `Recebimento`** (não existe fora
> dele). A modelagem profunda do rateio (motor de distribuição, componentes) é **Fase 3** (Módulo 3).

## Definição de domínio

O rateio resolve o fato de que um crédito recebido cobre, em geral, **vários** recebíveis (ou
componentes de um recebível: principal, multa, juros, encomenda). Cada `RateioRecebimento` é uma
linha "deste valor, X vai para o documento D com finalidade F". O conjunto de parcelas de um
`Recebimento` deve respeitar o **invariante de rateio** (`business-rules/invariante-rateio.md`):
`Σ valorAlocado ≤ valorRecebido`, **toda parcela tem uma finalidade identificada**, e a **diferença
não alocada é registrada** explicitamente (no `Recebimento`, podendo virar `CreditoCliente`).

É **rascunho revisável**: a analista ajusta as parcelas antes de aprovar o `Recebimento` — nada toca
o ERP até `executarRecebimento` (Fase 5, gated).

## Propriedades (SKELETON)

| Propriedade | Tipo | Coluna | Notas |
|-------------|------|--------|-------|
| `id` | string (uuid) | `rateio_recebimento.id` | Identidade da parcela. |
| `recebimentoId` | string (uuid) | `rateio_recebimento.recebimento_id` | FK → o agregado raiz. |
| `documentoDocCod` | string | `rateio_recebimento.doc_cod` | Documento do recebível alvo. Parte da chave `filCod:docCod:titCod`. |
| `documentoTitCod` | string | `rateio_recebimento.tit_cod` | Título/parcela do recebível alvo. |
| `filCod` | number | `rateio_recebimento.fil_cod` | Igual ao `filCod` do `Recebimento` (multi-filial). |
| `priCod` | string? | `rateio_recebimento.pri_cod` | Processo, quando a alocação é por processo. |
| `componente` | enum? | `rateio_recebimento.componente` | `PRINCIPAL \| MULTA \| JUROS \| ENCOMENDA \| …` — componente do valor (enum detalhado na Fase 4, junto de `separacao-multa-juros` / `encomenda-percentuais`). |
| `finalidade` | string | `rateio_recebimento.finalidade` | **Toda parcela tem finalidade** (invariante do rateio). Texto/enum identificando para que serve a alocação. |
| `valorAlocado` | number | `rateio_recebimento.valor_alocado` | Valor desta parcela (Σ ≤ `valorRecebido`). |
| `moeda` | string | `rateio_recebimento.moeda` | Moeda da alocação. |
| `incluidoPor` | string | `rateio_recebimento.incluido_por` | Auditoria: quem criou/ajustou a parcela. |

## Distinção — mirror de `permuta_alocacao`

Assim como a alocação de Permutas (rascunho local editável, sobrevive à re-ingestão, valores em moeda
negociada), o `RateioRecebimento` é rascunho local. Diferença de direção: a Permuta aloca um
**adiantamento a-pagar** contra invoices; o `RateioRecebimento` aloca um **crédito recebido** contra
recebíveis. Ver a entidade `Permuta` (`entities/permuta.md`) para a doutrina de alocação.

## Fora de escopo (Fase 0 — SKELETON)

- Motor de distribuição (greedy? por saldo? por vencimento?), enum de componentes e a interação com as
  regras (multa/juros/encomenda) são **Fase 3/4**. Aqui só a **forma** da parcela.
</content>
</invoke>
