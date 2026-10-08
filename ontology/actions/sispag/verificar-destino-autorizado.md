---
name: verificarDestinoAutorizado
type: action
entity: FavorecidoAutorizado
ontology_version: "0.38.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-08
preconditions:
  - "Item TED/PIX (pesCod, modalidade) ou pedido de reconferência de um FavorecidoAutorizado."
postconditions:
  - "Resultado OK | SEM_DADO_PAGAMENTO | FAVORECIDO_NAO_AUTORIZADO | DESTINO_ALTERADO | FALHA_LEITURA (I14d)."
  - "ultimaConferenciaEm/Resultado atualizados quando há registro."
  - "DESTINO_ALTERADO: AUTORIZADO → REAPROVACAO_PENDENTE (F4) + Alerta SISPAG_DESTINO_ALTERADO (dedup pesCod + modalidade)."
side_effects:
  - "Leitura ao vivo do cmn025 pelo DestinoPagamentoResolver (I10). Escrita local só em F4 e no selo. Nenhuma escrita no ERP."
  - "FALHA_LEITURA nunca muda estado (I14f)."
---

# verificarDestinoAutorizado

ADR-0065. Ação do sistema, sem rota própria exceto o botão "reconferir com o Conexos"
(`sispag:ver`). Chamada por `verificarItensTedPix` (definir modalidade e finalizar), por
`gerarRemessa` (L8, só sem lote nativo) e pela aprovação. O efeito sobre o item (aviso, retirada,
barra) é de quem chama (I14e).
