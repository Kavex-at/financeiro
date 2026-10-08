---
name: revogarAutorizacaoFavorecido
type: action
entity: FavorecidoAutorizado
ontology_version: "0.38.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-08
preconditions:
  - "Usuário com `sispag:autorizar_favorecido`."
  - "Registro AUTORIZADO ou REAPROVACAO_PENDENTE; motivo obrigatório."
postconditions:
  - "→ REVOGADO (F7), terminal; evento na trilha."
  - "Itens de lotes ainda não importados passam a FAVORECIDO_NAO_AUTORIZADO; destino já congelado segue o lote nativo (I14g)."
side_effects:
  - "Escrita local."
---

# revogarAutorizacaoFavorecido

ADR-0065. Sem expiração: revogar é a única saída de `AUTORIZADO` além da reaprovação pelo sistema.
