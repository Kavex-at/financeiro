---
name: aposentarExcecoesSubstituidas
type: action
entity: ExcecaoDestino
ontology_version: "0.33.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/ExcecaoSubstituicaoService.ts
  - src/backend/domain/service/sispag/ExcecaoDestinoService.ts
  - src/backend/domain/service/sispag/DestinoPagamentoResolver.ts
  - src/backend/jobs/aposentar-excecoes-substituidas.ts
last_review: 2026-10-05
preconditions:
  - "Exceção `APROVADA`."
  - "Cadastro `cmn025` do favorecido tem destino válido para o tipo (definição e cadência: gap Q3)."
postconditions:
  - "`APROVADA → SUBSTITUIDA` (E4), terminal."
  - "Se o valor do cadastro difere: evento `DIVERGENCIA_CADASTRO` com valores mascarados (I12c)."
side_effects:
  - "Leitura do Conexos (read-only); escrita local."
---

# aposentarExcecoesSubstituidas

ADR-0060. Transições em `state-machines/excecao-destino.md`; regras em
`business-rules/excecao-destino-sispag.md` (I12).
