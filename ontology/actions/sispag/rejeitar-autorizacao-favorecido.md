---
name: rejeitarAutorizacaoFavorecido
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
  - "Registro PENDENTE; motivo obrigatório."
postconditions:
  - "PENDENTE → REJEITADO (F3), terminal; evento na trilha."
side_effects:
  - "Escrita local."
---

# rejeitarAutorizacaoFavorecido

ADR-0065. Reaprovação recusada usa `revogarAutorizacaoFavorecido` (F7).
