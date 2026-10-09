---
name: solicitarAutorizacaoFavorecido
type: action
entity: FavorecidoAutorizado
ontology_version: "0.38.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-08
preconditions:
  - "Usuário com `sispag:executar`."
  - "F1: nenhum registro vigente para (pesCod, modalidade). F5: registro em REAPROVACAO_PENDENTE sem solicitadoPor."
postconditions:
  - "F1: novo registro PENDENTE com solicitadoPor = usuário autenticado e origemSolicitacao (ITEM | RELATORIO | MANUAL)."
  - "F5: REAPROVACAO_PENDENTE com solicitadoPor gravado (pedido confirmado)."
side_effects:
  - "Escrita local + evento na trilha. Nenhuma escrita no ERP."
---

# solicitarAutorizacaoFavorecido

ADR-0065. Nunca cria `AUTORIZADO`. Também é a ação disparada pela linha do relatório
(`listarCandidatosAutorizacao`) e pelo atalho "pedir autorização" do item. Ver
`state-machines/favorecido-autorizado.md` (F1, F5) e I14c.

**v0.39.0:** o pedido `MANUAL` nasce de `buscarFavorecidoConexos`: quem pede escolhe o favorecido
numa busca no cadastro do Conexos e vê o destino mascarado; não digita código.
