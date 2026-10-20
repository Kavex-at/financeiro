---
name: limparBorderoDoGrupo
type: action
entity: LotePagamento
ontology_version: "0.47.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-10-20
preconditions:
  - "Lote nativo NÃO finalizado; borderô com vldHasRemessaPgto = 0."
  - "Borderô achado pelo marcador do NOSSO write-ahead desta remessa (nunca um borderô de terceiro, nunca o borderô antigo de um J rejeitado)."
  - "Disparo: retirada I19p(3)/I16d do grupo, ou lote local cancelado (L5) com rascunho nativo aberto."
postconditions:
  - "Item nativo (se importado), as N baixas e o borderô ausentes na releitura; sucesso = ausência observada, nunca o 200."
  - "Evento BORDERO_LIMPO na trilha."
side_effects:
  - "Escrita no ERP, nesta ordem: DELETE fin015/finItemSispag → releitura → excluirBaixa de cada baixa → excluirBordero → releitura."
  - "Nunca cancelarBordero, finalizarBordero nem fin146."
  - "Pré-condição não atendida (vldHasRemessaPgto = 1 ou lote nativo finalizado): nada é excluído; Alerta sispag-bordero-grupo-pendente e a analista decide (I19q). Borderô reaproveitado (I19s) que falha: só o item nativo do lote novo sai; o borderô fica, com o Alerta."
  - "Falha parcial fecha: não segue para finalizarLote; a retomada termina a limpeza."
---

# limparBorderoDoGrupo

ADR-0076 (P0-4, I19q). Desfaz **só o que o sistema criou**, e só enquanto o borderô não foi a remessa. Espelha
a I16d.3/I16d.6 (local primeiro, ERP depois, releitura, falha parcial fecha). Idempotente: borderô já
ausente não gera novo evento nem nova chamada (a ausência se decide pela releitura, não pelo status do
`DELETE`). **Planned.**
