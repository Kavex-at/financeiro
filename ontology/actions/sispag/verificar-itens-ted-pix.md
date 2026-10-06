---
name: verificarItensTedPix
type: action
entity: LotePagamento
ontology_version: "0.36.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
  - src/backend/domain/client/ConexosSispagClient.ts
last_review: 2026-10-05
preconditions:
  - "Lote em RASCUNHO (chamada por atualizarModalidadeItem) ou em transição RASCUNHO → FINALIZADO (chamada por finalizarLote)."
  - "Escopo: só itens com modalidade TED ou PIX (I13a). BOLETO e sem modalidade nunca."
postconditions:
  - "Por item: verificacaoEstado = VERIFICADO (+ verificadoEm) ou PENDENTE quando alguma leitura do Conexos falhou (I13b)."
  - "Duplicidade (I13c–e, h): AlertaItemLote ABERTA por contraparte nova; resolução mantida para contraparte já vista; OBSOLETA para contraparte que sumiu."
  - "Canal (I13i): AlertaItemLote CANAL_HABITUAL quando o PerfilCanalFornecedor é ALTA e o grupo dominante não é TED_PIX."
  - "Dados de pagamento (I13j): sem cadastro e sem exceção APROVADA → item removido do lote (ator sistema, motivo SEM_DADO_PAGAMENTO) + PendenciaCadastro aberta/acrescida; com exceção APROVADA → item fica + PendenciaCadastro aberta/acrescida."
  - "PendenciaCadastro ABERTA do favorecido cuja leitura agora acha o dado → RESOLVIDA (I13k)."
side_effects:
  - "Leitura ao vivo no Conexos: fin064 (títulos do favorecido, sem filtro de vldPago) e cmn025 (conta/chave, via DestinoPagamentoResolver). Nenhuma escrita no ERP."
  - "Escrita local: lote_pagamento_item (verificacao_estado, verificado_em; remoção), lote_pagamento_item_alerta, sispag_pendencia_cadastro, trilha (I13m)."
  - "Remoção pelo sistema incrementa versao do lote (é edição do agregado, I6)."
---

# verificarItensTedPix

ADR-0063, regra I13 (`business-rules/verificacao-ted-pix-sispag.md`). Não é rota própria: é chamada
por `atualizarModalidadeItem` (um item) e por `finalizarLote` (todos os itens TED/PIX).

## Ordem por item

1. **Dados de pagamento** (I13j) com o `DestinoPagamentoResolver` (a mesma função da oferta e do
   envio, I10b). Se o item sai do lote, os passos 2 e 3 não rodam para ele.
2. **Duplicidade** (I13c–e): lê no `fin064` os títulos do favorecido, compara com o título do item.
3. **Canal** (I13i): lê o `PerfilCanalFornecedor` local (sem chamada ao ERP).

Qualquer leitura que falha nos passos 1–2 deixa o item `PENDENTE` e **não** retira, **não** abre
pendência e **não** fecha alerta (I13b).

## No `finalizarLote`

Roda antes da transição L3. Se retirou algum item, a finalização **não** acontece
(`ItemsRemovedByCheckError`): a retirada fica gravada, o lote segue `RASCUNHO` e a analista revê e
finaliza de novo. Item `PENDENTE` → `PaymentCheckPendingError`; duplicidade `ABERTA` →
`PendingDuplicateAlertError`. Alerta de canal não barra.
