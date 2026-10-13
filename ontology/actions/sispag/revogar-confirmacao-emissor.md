---
name: revogarConfirmacaoEmissor
type: action
entity: ConfirmacaoEmissorBoleto
ontology_version: "0.40.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:executar` (qualquer um; decisão do maintainer, Q-A); motivo obrigatório."
  - "Par VIGENTE."
postconditions:
  - "→ REVOGADA, terminal; evento PAR_REVOGADO."
  - "Decisões por título do par ainda não aplicadas no ERP são canceladas (Q-E, default revisável; no passo 1 não existe nenhuma aplicada). As demais ficam como histórico (derivado PAR_REVOGADO); sugestões futuras do par perdem o tier CONHECIDO."
side_effects:
  - "Escrita local apenas. Nada a desfazer no ERP (I15b)."
---

# revogarConfirmacaoEmissor

ADR-0068. Sem expiração: revogar é a única saída de `VIGENTE`. Reconfirmar cria nova linha. **Planned.**
