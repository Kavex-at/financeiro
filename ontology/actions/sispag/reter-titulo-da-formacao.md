---
name: reterTituloDaFormacao
type: action
entity: TituloAPagar
ontology_version: "0.28"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/repository/sispag/TituloAPagarRepository.ts
  - src/backend/domain/service/sispag/SispagPainelService.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/page.tsx
last_review: 2026-09-22
preconditions:
  - "Mutações com requireRole('admin'); autor sempre do JWT (ADR-0006), nunca do corpo."
  - "retirarDoLote: o título está num lote RASCUNHO (o mesmo guard de removerTituloDoLote, L2)."
  - "liberar: existe retenção ativa para o título."
  - "No máximo uma retenção ativa por (filCod, docCod, titCod)."
postconditions:
  - "retirarDoLote: ItemLote removido (L2, marcarManual se o lote era automático) E retenção ativa criada, na mesma transação."
  - "removerTituloDoLote (lixeira na tela do lote): se o lote era automático (lido ANTES do marcarManual), retenção ativa criada na mesma transação; lote manual não retém."
  - "liberar: retenção soft-deleted (removidoPor, removidoEm, motivoRemocao='liberado')."
  - "Enquanto a retenção está ativa, formarLotesAutomaticos não inclui o título (I8)."
side_effects:
  - "Escrita LOCAL (Postgres): tabela de retenção (soft-delete) + lote_pagamento_item/lote_pagamento no caso retirarDoLote. Nenhuma escrita no ERP (I1)."
  - "Auditoria: LogService em português + trilha na própria tabela."
---

# reterTituloDaFormacao: retirar do lote, reter e liberar (ADR-0050)

> **Vigência:** aceita em 2026-09-22 (v0.28.0, ADR-0050). Agrupa as operações sobre a retenção de um
> título da formação automática. A outra forma de encerrar a retenção, incluir o título num
> lote à mão, pertence a `incluirTituloNoLote` ([`gerenciarLoteCandidato`](./gerenciar-lote-candidato.md)).

## Operações

| Operação | Onde aparece | Efeito |
|----------|--------------|--------|
| `retirarDoLote` | linha do título na aba "Títulos a pagar", só quando ele está num lote RASCUNHO | `removerTituloDoLote` + retenção ativa, atômico |
| lixeira no lote | card do lote, **só quando o lote é automático** | remoção + retenção, atômico (P1-1) |
| `liberar` | linha do título retido (badge "Não lotar automaticamente") | retenção liberada, `motivoRemocao = 'liberado'` |

As rotas concretas ficam com o TaskScoper. A `DELETE /sispag/lotes/:id/itens/:filCod/:docCod/:titCod`
existente passa a reter quando o lote é **automático** (P1-1, respondida em 2026-09-22). O serviço lê
`automatico` antes de `marcarManual` virar o lote para manual, na mesma transação; ler depois daria
sempre `false`. Num lote manual, a remoção continua sem reter.

Não há "Reter" num título solto: proposto e rejeitado pelo usuário (P1-2).

## Por que a atomicidade importa

Se o item sai do lote e a retenção não é gravada, o próximo cron re-lota o título: é o defeito que
motivou a ADR. Se a retenção é gravada e o item não sai, o título fica num lote com badge de retido.
As duas escritas vão numa transação só.

## Projeção no painel

A linha do título passa a carregar o lote RASCUNHO em que ele está (id e rótulo, com link), no lugar
do `emLote` booleano, e a retenção ativa (autor, data, motivo). É leitura da relação `ItemLote` e da
tabela de retenção. Ver [`montarPainelPagamentos`](./montar-painel-pagamentos.md).

## Por que está na ontologia (universalidade)

O *payment block* (SAP) e o *hold* (Oracle) são a mesma operação: tirar um item em aberto da proposta
automática de pagamento sem proibir o pagamento manual. Ver
`business-rules/retencao-formacao-automatica.md` (I8).
