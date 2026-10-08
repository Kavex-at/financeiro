---
name: aprovarAutorizacaoFavorecido
type: action
entity: FavorecidoAutorizado
ontology_version: "0.38.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-08
preconditions:
  - "Usuário com `sispag:autorizar_favorecido`, diferente de solicitadoPor (I14c)."
  - "Registro PENDENTE (F2) ou REAPROVACAO_PENDENTE com solicitadoPor não nulo (F6)."
  - "Leitura do cmn025 ao vivo bem-sucedida, com destino para a modalidade; fingerprint atual = fingerprint que a tela mostrou."
postconditions:
  - "AUTORIZADO com fingerprint, fingerprintChaveId, destinoMascarado e avisos do destino lido agora."
  - "decididoPor/decididoEm gravados; evento na trilha."
side_effects:
  - "Leitura ao vivo do cmn025; escrita local. Nenhuma escrita no ERP."
---

# aprovarAutorizacaoFavorecido

ADR-0065. Erros: `PayeeApprovalBySolicitorError`, `PayeeReapprovalNotConfirmedError`,
`PayeeDestinationChangedSinceShownError`, `PayeeWithoutPaymentDataError` (I14).
