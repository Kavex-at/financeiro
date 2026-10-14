---
name: rejeitarSugestaoBoleto
type: action
entity: DecisaoSugestaoBoleto
ontology_version: "0.40.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts"
  - "src/backend/routes/sispag.ts"
  - "src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx"
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:executar`; motivo obrigatório."
postconditions:
  - "1 DecisaoSugestaoBoleto REJEITADA para (título, boleto): esconde aquele boleto para aquele título."
  - "Evento DECISAO_REJEITADA. O par do emissor NÃO é tocado."
side_effects:
  - "Escrita local apenas."
---

# rejeitarSugestaoBoleto

ADR-0068, Q1. "Este boleto não é deste título" não envenena o par. Outro candidato para o mesmo
título volta a ser sugerido. **Implemented** (v0.66.0).
