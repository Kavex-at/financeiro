---
name: aprovarExcecaoDestino
type: action
entity: ExcecaoDestino
ontology_version: "0.33.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/ExcecaoDestinoService.ts
  - src/backend/domain/repository/sispag/ExcecaoDestinoRepository.ts
  - src/backend/domain/libs/sispag/ExcecaoDestinoRule.ts
  - src/backend/routes/sispag.ts
last_review: 2026-10-05
preconditions:
  - "Usuário com `sispag:excecao`."
  - "Exceção `PENDENTE`."
  - "`aprovadoPor ≠ cadastradoPor` (id autenticado, I12b)."
  - "I10i reconferida ao vivo."
postconditions:
  - "`PENDENTE → APROVADA` (E2); `decididoPor/Em` gravados."
  - "`APROVADA` anterior do mesmo (favorecido, tipo) vai a `SUBSTITUIDA` (I12a)."
  - "Evento de aprovação na trilha."
side_effects:
  - "Escrita local; nenhuma escrita no Conexos."
---

# aprovarExcecaoDestino

ADR-0060. Transições em `state-machines/excecao-destino.md`; regras em
`business-rules/excecao-destino-sispag.md` (I12).
