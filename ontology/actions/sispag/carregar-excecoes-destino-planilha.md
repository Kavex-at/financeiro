---
name: carregarExcecoesDestinoPlanilha
type: action
entity: ExcecaoDestino
ontology_version: "0.33.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-05
preconditions:
  - "Usuário com `sispag:excecao`."
  - "Layout da planilha definido (BLOQUEADO: gap Q1; nada foi inventado)."
  - "Cada linha passa a validação de E1."
postconditions:
  - "Cada linha válida vira `PENDENTE` com `origem = PLANILHA` e `cargaId` (I12d); nenhuma `APROVADA`."
  - "Recarga não altera aprovadas (regra exata: gap Q10)."
  - "Linhas inválidas reportadas por linha, sem gravar."
side_effects:
  - "Escrita local; trilha por linha."
---

# carregarExcecoesDestinoPlanilha

ADR-0061. Transições em `state-machines/excecao-destino.md`; regras em
`business-rules/excecao-destino-sispag.md` (I12).
