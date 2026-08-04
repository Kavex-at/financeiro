---
name: DocumentoAReceber
type: entity
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties:
  - docCod
  - titCod
  - filCod
  - cliente
  - pesCod
  - valor
  - valorAberto
  - moeda
  - vencimento
  - numDocumento
  - priCod
  - ativo
relationships:
  - "DocumentoAReceber N—1 Filial (via filCod — a filial que originou o recebível)"
  - "DocumentoAReceber N—1 Recebimento (um recebível é alvo de baixa de uma ou mais conciliações)"
  - "DocumentoAReceber 1—N RateioRecebimento (um recebível recebe parcelas de rateio de um crédito)"
last_review: 2026-07-24
universality_evidence:
  - "docs-contexto/03_ontologia_financeiro.md — Frente IV: o alvo da baixa é o documento em aberto (conta a receber)"
  - "ontology/_inbox/frente-iv-recebimentos-interview.md — Eixo 1: DocumentoAReceber (read-model de recebível em aberto no Conexos)"
  - "ontology/_inbox/frente-iv-recebimentos-nde-plan.md §4 / Fase 2 — read-model de documentos em aberto (contas a receber) do Conexos"
  - "Conceito universal de financeiro: um documento a receber (cliente, valor, vencimento, saldo em aberto) é o alvo natural de uma baixa por crédito recebido"
---

# DocumentoAReceber (recebível em aberto — read-model Frente IV)

> **SKELETON (Fase 0).** Um `DocumentoAReceber` é o **read-model de um recebível em aberto** (conta a
> receber) lido do **Conexos** — o **alvo da baixa** de um `Recebimento`. É o espelho inbound do
> `TituloAPagar` (SISPAG): o SISPAG lê a carteira a-pagar; a Frente IV lê a carteira a-receber. A
> **fonte exata no ERP** (módulo/endpoint) é **confirmada na Fase 2** (Módulo 2) — o plano assume o
> caminho de leitura financeira do Conexos, a parametrizar. Ver `integrations/conexos.md`.

## Definição de domínio

Um `DocumentoAReceber` é o que **um cliente deve à trading**, com valor, vencimento e saldo em
aberto. É lido do ERP (READ) e é o insumo do **matching** (`atribuirBaixa`): o motor de conciliação
casa um crédito (`TransacaoBancaria`) contra um ou mais documentos em aberto por
cliente/CNPJ/valor/nº documento/ref bancária/nº processo/vencimento.

Nesta frente a entidade **lê** o recebível; a **baixa** (escrita no ERP) é o `executarRecebimento`
(Módulo 5), gated e parametrizado — ver `business-rules/idempotencia-quitacao-nde.md` e a decisão
**O3** em `integrations/conexos.md`.

## Propriedades (SKELETON — wire/fonte a confirmar na Fase 2)

| Propriedade | Tipo | Origem (wire/coluna) | Notas |
|-------------|------|----------------------|-------|
| `docCod` | string | Conexos (fonte a confirmar) | Documento do recebível. Parte da chave natural. |
| `titCod` | string | Conexos | Título/parcela dentro do documento. Parte da chave natural. |
| `filCod` | number | Conexos | **Invariante multi-filial** — filial do recebível. Nunca `null`. |
| `cliente` | string? | Conexos | Nome do cliente devedor (insumo do matching + exibição). |
| `pesCod` | string? | Conexos | Código da pessoa (cliente). Chave de matching por cliente. |
| `valor` | number? | Conexos | Valor de face do título. |
| `valorAberto` | number? | Conexos | **Saldo em aberto** — o que falta receber (base do rateio + anti-super-baixa). |
| `moeda` | string? | Conexos | Moeda do recebível. |
| `vencimento` | Date? | Conexos | Data de vencimento (matching por vencimento; aging). |
| `numDocumento` | string? | Conexos | Nº do documento (NF/fatura) — chave forte de matching. |
| `priCod` | string? | Conexos | Nº do **processo** de importação, quando aplicável (chave de matching cross-referência). |
| `ativo` | boolean | anti-fantasma | Recebível fora da leitura mais recente → `ativo=false` (espelha o anti-fantasma do `TituloAPagar`). |

## Distinção — recebível (esta) × a-pagar (`TituloAPagar`) × adiantamento

- `DocumentoAReceber` = o cliente deve à trading (inbound). `TituloAPagar` (SISPAG) = a trading deve
  ao fornecedor (outbound). Ver `entities/titulo-a-pagar.md`.
- **Não confundir com `CreditoCliente`:** um `DocumentoAReceber` é um recebível **já emitido/maturado**
  que existe no ERP; um `CreditoCliente` é um **adiantamento do cliente** pago **antes** de o documento
  existir/maturar (crédito a aplicar). Ver `entities/credito-cliente.md`.

## Fora de escopo (Fase 0 — SKELETON)

- Fonte exata no ERP (módulo/endpoint), wire e chave natural: **Fase 2** (Módulo 2).
- O motor de matching (`atribuirBaixa`) é modelado como ação (skeleton); regras de score na Fase 2.
