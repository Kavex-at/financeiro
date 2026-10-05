---
name: registrarExcecaoDestino
type: action
entity: ExcecaoDestino
ontology_version: "0.33.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/ExcecaoDestinoService.ts
  - src/backend/routes/sispag.ts
  - src/backend/domain/libs/sispag/ExcecaoDestinoRule.ts
last_review: 2026-10-05
preconditions:
  - "Usuário com `sispag:excecao`."
  - "Favorecido existe no `cmn025`; `titularDocumento` = `pdcDocFederal` lido ao vivo (I10i)."
  - "Formato válido (`DestinoManualValidator`); PIX só chave CPF/CNPJ igual ao documento do favorecido (I12i)."
  - "Justificativa informada."
postconditions:
  - "Exceção criada em `PENDENTE` (E1), `origem = MANUAL`; nunca `APROVADA`."
  - "Evento de cadastro na trilha só-inclusão (I12e)."
side_effects:
  - "Escrita local; nenhuma escrita no Conexos."
---

# registrarExcecaoDestino

ADR-0061. Transições em `state-machines/excecao-destino.md`; regras em
`business-rules/excecao-destino-sispag.md` (I12).
