---
name: rejeitarExcecaoDestino
type: action
entity: ExcecaoDestino
ontology_version: "0.33.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/ExcecaoDestinoService.ts
  - src/backend/domain/repository/sispag/ExcecaoDestinoRepository.ts
  - src/backend/routes/sispag.ts
last_review: 2026-10-05
preconditions:
  - "Usuário com `sispag:excecao`."
  - "Exceção `PENDENTE`."
  - "Motivo obrigatório."
postconditions:
  - "`PENDENTE → REJEITADA` (E3), terminal."
  - "Evento de rejeição na trilha."
side_effects:
  - "Escrita local."
---

# rejeitarExcecaoDestino

ADR-0061. Transições em `state-machines/excecao-destino.md`; regras em
`business-rules/excecao-destino-sispag.md` (I12).
