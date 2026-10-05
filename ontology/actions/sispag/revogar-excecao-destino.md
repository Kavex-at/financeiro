---
name: revogarExcecaoDestino
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
  - "Usuário com `sispag:excecao` (qualquer um, inclusive o cadastrante; I12h)."
  - "Exceção `APROVADA`."
  - "Motivo obrigatório."
postconditions:
  - "`APROVADA → REVOGADA` (E5), terminal."
  - "Evento de revogação na trilha."
  - "Lotes ainda não importados passam a não resolver o destino (I12f/I12g); destino já congelado segue o lote nativo."
side_effects:
  - "Escrita local."
---

# revogarExcecaoDestino

ADR-0061. Transições em `state-machines/excecao-destino.md`; regras em
`business-rules/excecao-destino-sispag.md` (I12).
