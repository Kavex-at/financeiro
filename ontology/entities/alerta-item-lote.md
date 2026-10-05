---
name: AlertaItemLote
type: entity
ontology_version: "0.36.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/interface/sispag/SispagInterface.ts
  - src/frontend/app/sispag/components/LoteCard.tsx
properties: [id, loteId, filCod, docCod, titCod, tipo, contraparteFilCod, contraparteDocCod, contraparteTitulos, evidencia, estado, resolucao, justificativa, resolvidoPor, resolvidoEm, criadoEm, verificadoEm]
relationships:
  - "AlertaItemLote N—1 ItemLote (via loteId + filCod:docCod:titCod; a alerta pertence ao item naquele lote)"
  - "AlertaItemLote N—0..1 TituloAPagar contraparte (via contraparteFilCod:contraparteDocCod; lido ao vivo no fin064, pode estar pago)"
  - "AlertaItemLote (CANAL_HABITUAL) N—1 PerfilCanalFornecedor (o perfil que a originou)"
  - "AlertaItemLote 0..1—0..1 BloqueioDuplicidade (resolução RETIRAR cria o bloqueio)"
last_review: 2026-10-05
universality_evidence:
  - "probe-duplicidade-titulos.ts (fin064 PRD, 2026-10-05): fil 4, docs 6173 × 6702 — mesma NF, mesmo favorecido, dois docCod; a ingestão por (filCod, docCod, titCod) não percebe"
  - "probe-canal-por-fornecedor.ts (fin010 × fin095 PRD): 89% do valor pago em fornecedores de canal estável (confiança ALTA)"
  - "Controle universal de contas a pagar: alerta de pagamento em duplicidade (mesma NF / mesmo valor-data ao mesmo fornecedor) e de mudança de canal/destino de pagamento são controles antifraude clássicos de tesouraria"
  - "docs/bpmn/sispag-pagamento-proposto.bpmn — gateway 'Há título com alerta de duplicidade?' e tarefa 'Conferir pagamentos TED e PIX'"
---

# AlertaItemLote

> **Origem:** ADR-0063 (2026-10-05). Um **sinal da verificação TED/PIX** sobre um item de lote:
> possível pagamento em duplicidade ou canal fora do habitual do favorecido. Regras em
> `business-rules/verificacao-ted-pix-sispag.md` (I13). Code-facing: `PaymentItemAlert`; tabela
> proposta `lote_pagamento_item_alerta`.

**Não é o `Alerta` operacional** (`entities/alerta.md`): aquele é incidente de sistema (job parado,
config ausente) com `dedupKey` e sinks; este é decisão de negócio sobre um pagamento, resolvida pela
analista e vista pelo conferente.

## Propriedades

| Campo | Tipo | Notas |
|---|---|---|
| `id` | string (uuid) | |
| `loteId` · `filCod` · `docCod` · `titCod` | — | O item (agregado `LotePagamento`). |
| `tipo` | enum | `DUPLICIDADE_FORTE \| DUPLICIDADE_FRACA \| CANAL_HABITUAL` (constante `ITEM_ALERT_TYPE`). |
| `contraparteFilCod` · `contraparteDocCod` | number · string | Só duplicidade. O **outro documento**; chave da estabilidade da justificativa (I13h). |
| `contraparteTitulos` | lista | Títulos da contraparte vistos na verificação (`titCod`, valor, vencimento, pago). Snapshot para a tela. |
| `evidencia` | objeto | Duplicidade: número de NF normalizado / valor e vencimentos. Canal: grupo dominante, participação, nº de pagamentos e meses do perfil. |
| `estado` | enum | `ABERTA \| RESOLVIDA \| OBSOLETA \| DESCARTADA` (constante `ITEM_ALERT_STATE`). Canal nasce e fica `ABERTA` (informativa; não exige resolução). |
| `resolucao` | enum? | `JUSTIFICADA \| RETIRADA`; só duplicidade. |
| `justificativa` | string? | Obrigatória quando `JUSTIFICADA`. |
| `resolvidoPor` · `resolvidoEm` | string? · Date? | Username canônico autenticado. |
| `criadoEm` · `verificadoEm` | Date | Criação e última re-verificação que a confirmou. |

## Ciclo de vida

| De → Para | Gatilho |
|---|---|
| `(novo) → ABERTA` | `verificarItensTedPix` encontra contraparte nova (I13c/d) ou perfil ALTA divergente (I13i) |
| `ABERTA → RESOLVIDA` | `resolverAlertaDuplicidade` (JUSTIFICAR ou RETIRAR), só em `RASCUNHO` |
| `ABERTA \| RESOLVIDA → OBSOLETA` | re-verificação não encontra mais a contraparte (cancelada/inativa) ou o perfil deixou de ser ALTA divergente |
| `ABERTA \| RESOLVIDA → DESCARTADA` | o item deixou de ser TED/PIX ou saiu do lote |

Só alertas de duplicidade `ABERTA` bloqueiam o `finalizarLote` (I13f).
