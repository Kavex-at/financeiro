---
name: listarCandidatosAutorizacao
type: action
entity: FavorecidoAutorizado
ontology_version: "0.38.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-08
preconditions:
  - "Usuário com `sispag:ver`."
postconditions:
  - "Lista por favorecido: pesCod, credor, grupo dominante, participação, nº de pagamentos, meses, confiança (PerfilCanalFornecedor), se tem conta/chave no cmn025 e o estado da autorização por modalidade."
  - "Seção TED/PIX retirados por falta de dado (motivo SEM_DADO_PAGAMENTO), para quem quiser cobrar o cadastro."
side_effects:
  - "Somente leitura (local + cmn025). Nenhuma escrita no ERP, nenhum estado muda."
---

# listarCandidatosAutorizacao

ADR-0065. Relatório para validar a lista com a Columbia antes de ligar a guarda (I14k). O perfil
de canal **não** pré-preenche a lista. A partir de uma linha, `solicitarAutorizacaoFavorecido`
cria `PENDENTE` (nunca aprova). Colunas e exportação são UI.
