---
name: revogarConfirmacaoEmissor
type: action
entity: ConfirmacaoEmissorBoleto
ontology_version: "0.40.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts"
  - "src/backend/routes/sispag.ts"
  - "src/frontend/app/sispag/components/ConfirmacoesEmissorPainel.tsx"
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:executar` (qualquer um; decisão do maintainer, Q-A); motivo obrigatório."
  - "Par VIGENTE."
postconditions:
  - "→ REVOGADA, terminal; evento PAR_REVOGADO."
  - "Toda decisão `CONFIRMADA` do par vira `ANULADA` NA MESMA transação, com motivo `par revogado: <motivo>` e um evento `DECISAO_ANULADA` cada (Q-E, I15l; implementado em 2026-10-14). Sugestões futuras do par perdem o tier CONHECIDO."
side_effects:
  - "Escrita local apenas. Nada a desfazer no ERP (I15b)."
---

# revogarConfirmacaoEmissor

ADR-0068. Sem expiração: revogar é a única saída de `VIGENTE`. Reconfirmar cria nova linha. **Implemented** (v0.66.0).
