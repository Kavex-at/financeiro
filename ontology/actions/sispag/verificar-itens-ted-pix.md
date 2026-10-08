---
name: verificarItensTedPix
type: action
entity: LotePagamento
ontology_version: "0.38.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
  - src/backend/domain/client/ConexosSispagClient.ts
last_review: 2026-10-08
preconditions:
  - "Lote em RASCUNHO (chamada por atualizarModalidadeItem) ou em transição RASCUNHO → FINALIZADO (chamada por finalizarLote)."
  - "Escopo: só itens com modalidade TED ou PIX (I13a). BOLETO e sem modalidade nunca."
postconditions:
  - "Por item: verificacaoEstado = VERIFICADO (+ verificadoEm) ou PENDENTE quando alguma leitura do Conexos falhou (I13b)."
  - "Duplicidade (I13c–e, h): AlertaItemLote ABERTA por contraparte nova; resolução mantida para contraparte já vista; OBSOLETA para contraparte que sumiu."
  - "Dados de pagamento e autorização (I13j, I14): resultado de verificarDestinoAutorizado em autorizacaoAviso. Chamada por atualizarModalidadeItem: só aviso, nunca retira. Chamada por finalizarLote: SEM_DADO_PAGAMENTO | FAVORECIDO_NAO_AUTORIZADO | DESTINO_ALTERADO → item removido do lote (ator sistema, motivo gravado)."
  - "DESTINO_ALTERADO leva a FavorecidoAutorizado a REAPROVACAO_PENDENTE (F4)."
side_effects:
  - "Leitura ao vivo no Conexos: fin064 (títulos do favorecido, sem filtro de vldPago) e cmn025 (conta/chave, via DestinoPagamentoResolver). Nenhuma escrita no ERP."
  - "Escrita local: lote_pagamento_item (verificacao_estado, verificado_em; remoção), lote_pagamento_item_alerta, sispag_favorecido_autorizado (só F4 e selo), trilha (I13m, I14j)."
  - "Remoção pelo sistema incrementa versao do lote (é edição do agregado, I6)."
---

# verificarItensTedPix

ADR-0063, revisada pela ADR-0065; regras I13 e I14 (`business-rules/verificacao-ted-pix-sispag.md`). Não é rota própria: é chamada
por `atualizarModalidadeItem` (um item) e por `finalizarLote` (todos os itens TED/PIX).

## Ordem por item

1. **Dados de pagamento e autorização** (I13j, I14) com `verificarDestinoAutorizado` (usa o
   `DestinoPagamentoResolver`, a mesma função da oferta e do envio, I10b). No `finalizarLote`, se o
   item sai do lote, o passo 2 não roda para ele.
2. **Duplicidade** (I13c–e): lê no `fin064` os títulos do favorecido, compara com o título do item.

Qualquer leitura que falha deixa o item `PENDENTE` e **não** retira, **não** abre reaprovação e
**não** fecha alerta (I13b, I14f).

## No `finalizarLote`

Roda antes da transição L3. Itens retirados ficam gravados e o lote **finaliza na mesma chamada**
com os restantes (ADR-0065); se esvaziar, fica `RASCUNHO` (`BatchEmptiedByCheckError`). Item
`PENDENTE` → `PaymentCheckPendingError`; duplicidade `ABERTA` → `PendingDuplicateAlertError` (as
retiradas ficam gravadas mesmo assim).
