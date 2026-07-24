---
name: adiantamento-cliente
type: business-rule
entity: CreditoCliente
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-07-24
has_canonical_test: false
---

# Regra: adiantamento-cliente (identificação + CreditoCliente) — STUB (Fase 4)

> **STUB (Fase 0) — spec completa na Fase 4 (OfficeHours próprio).** Quando um crédito recebido é um
> **adiantamento do cliente** (pago antes de o recebível existir/maturar), o valor vira um
> `CreditoCliente` (crédito a aplicar em recebíveis futuros) — **nunca** uma baixa incorreta. Esta
> regra define **como identificar** esse caso e o **ciclo de vida** do crédito. **Nada é fixado aqui.**

## O que falta definir (Fase 4)

- **Critério de identificação:** quando um crédito sem match maturado é adiantamento × excedente ×
  erro operacional.
- **Ciclo de vida** detalhado do `CreditoCliente` (`disponivel → parcial → consumido`).
- **Consumo:** como o crédito é aplicado (via `RateioRecebimento`) quando o recebível surge.

## Distinção — `CreditoCliente` × `Adiantamento` (não confundir)

`CreditoCliente` (inbound, cliente→trading) é **distinto** do `Adiantamento` de Permutas (outbound,
trading→exportador). Decisão de entidade nova na ADR-0022. Ver `entities/credito-cliente.md` e
`entities/adiantamento.md`.

## Onde atua

Aplicada em `aplicarRegrasRecebimento` (Módulo 4); a diferença não alocada de um `Recebimento` pode
originar um `CreditoCliente` (ver `business-rules/invariante-rateio.md`).

## Universalidade (provisória)

Um cliente que paga adiantado gera crédito a aplicar — universal em contas-a-receber. A estrutura
(entidade de crédito + regra de identificação/consumo) é do domínio; os critérios concretos são
config/decisão da Columbia, a confirmar na Fase 4.
</content>
</invoke>
