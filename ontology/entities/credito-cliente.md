---
name: CreditoCliente
type: entity
ontology_version: "0.11"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
properties:
  - id
  - filCod
  - cliente
  - pesCod
  - valorOriginal
  - valorDisponivel
  - moeda
  - origemRecebimentoId
  - status
  - criadoEm
relationships:
  - "CreditoCliente N—1 Filial (via filCod — a filial que recebeu o adiantamento do cliente)"
  - "CreditoCliente 1—1 Recebimento (via origemRecebimentoId — o recebimento cuja diferença não alocada originou o crédito)"
  - "CreditoCliente 1—N RateioRecebimento (o crédito é consumido ao ratear contra recebíveis futuros)"
last_review: 2026-07-24
universality_evidence:
  - "ontology/_inbox/frente-iv-recebimentos-interview.md — Eixo 1 + Decisão 3 (Yuri, 2026-07-24): CreditoCliente é entidade NOVA, distinta do Adiantamento import-side"
  - "ontology/_inbox/frente-iv-recebimentos-nde-plan.md §4 — CreditoCliente (client advance credit), a modelar na regra adiantamento-cliente (Fase 4)"
  - "Conceito universal de financeiro: um cliente que paga antes de o documento existir/maturar gera um crédito a aplicar em recebíveis futuros — adiantamento DE cliente (inbound), oposto do adiantamento A fornecedor (outbound)"
---

# CreditoCliente (adiantamento DE cliente — Frente IV)

> **SKELETON (Fase 0). Entidade NOVA (decisão Yuri, 2026-07-24).** Um `CreditoCliente` é um
> **adiantamento do cliente**: o cliente paga a trading **antes** de o `DocumentoAReceber`
> existir/maturar, gerando um **crédito a aplicar** em recebíveis futuros. É o **oposto direcional**
> do `Adiantamento` (Frente I), que é um adiantamento **A** um exportador estrangeiro. A modelagem
> profunda (critério de identificação, ciclo de vida detalhado, consumo) é **Fase 4** (regra
> `business-rules/adiantamento-cliente.md`).

## Definição de domínio

Quando um crédito recebido (`TransacaoBancaria`) **não casa** com nenhum recebível maturado — porque
o cliente pagou adiantado — o valor não deve ser forçado numa baixa incorreta (invariante "sem baixa
incorreta"). Em vez disso, o excedente/adiantamento é registrado como `CreditoCliente`: um saldo a
favor do cliente, consumível quando o recebível correspondente surgir (via `RateioRecebimento`).

Pode nascer também da **diferença não alocada** de um `Recebimento` (o `valorRecebido` maior que o
`Σ valorAlocado`) — ver `entities/recebimento.md` e `business-rules/invariante-rateio.md`.

## Distinção EXPLÍCITA — `CreditoCliente` × `Adiantamento` (não confundir)

| | `CreditoCliente` (Frente IV) | `Adiantamento` (Frente I / Permutas) |
|---|---|---|
| **Direção** | Cliente → trading (**inbound**) | Trading → exportador (**outbound**) |
| **O que é** | Cliente paga antes do recebível maturar (crédito a aplicar) | Trading paga o exportador antes da INVOICE (PROFORMA) |
| **Documento ERP** | Crédito local (não é PROFORMA) | Documento PROFORMA finalizado (`com298`, `tpdCod=99`, `docVldTipoAdto=1`) |
| **Consome contra** | `DocumentoAReceber` futuros (rateio) | `Invoice` do exportador (permuta/baixa `fin010`) |
| **Frente** | IV — Conciliação de Recebimentos | I — Permutas |

> **Por que é entidade nova, não reúso do `Adiantamento`:** apesar do nome análogo ("adiantamento"),
> a direção do dinheiro, a contraparte (cliente × exportador), o documento de origem e o ciclo de
> consumo são **distintos**. Modelar como `Adiantamento` poluiria a semântica outbound de Permutas.
> Decisão registrada na ADR-0022. Ver `entities/adiantamento.md` para o lado outbound.

## Propriedades (SKELETON — spec completa na Fase 4)

| Propriedade | Tipo | Coluna | Notas |
|-------------|------|--------|-------|
| `id` | string (uuid) | `credito_cliente.id` | Identidade do crédito. |
| `filCod` | number | `credito_cliente.fil_cod` | Filial (multi-filial). Nunca `null`. |
| `cliente` | string? | `credito_cliente.cliente` | Nome do cliente. |
| `pesCod` | string? | `credito_cliente.pes_cod` | Código da pessoa (cliente) — chave de aplicação futura. |
| `valorOriginal` | number | `credito_cliente.valor_original` | Valor recebido adiantado. |
| `valorDisponivel` | number | `credito_cliente.valor_disponivel` | Saldo ainda não aplicado (decresce ao consumir em rateios). |
| `moeda` | string | `credito_cliente.moeda` | Moeda do crédito. |
| `origemRecebimentoId` | string? (uuid) | FK → `Recebimento` | O recebimento que originou o crédito (adiantamento puro ou diferença não alocada). |
| `status` | enum | `credito_cliente.status` | Ciclo (ex.: `disponivel \| parcial \| consumido`) — enum na Fase 4. |
| `criadoEm` | Date | `credito_cliente.criado_em` | Timestamp. |

## Fora de escopo (Fase 0 — SKELETON)

- Critério de identificação (quando um crédito é adiantamento × excedente × erro), ciclo de vida
  detalhado e o consumo contra recebíveis futuros: **Fase 4** (OfficeHours próprio, regra
  `adiantamento-cliente`).
</content>
</invoke>
