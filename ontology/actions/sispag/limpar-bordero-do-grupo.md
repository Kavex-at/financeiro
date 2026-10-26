---
name: limparBorderoDoGrupo
type: action
entity: LotePagamento
ontology_version: "0.48.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/BorderoGrupoBoletoService.ts
  - src/backend/domain/service/sispag/DisparoLimpezaBorderoGrupo.ts
  - src/backend/domain/client/ConexosBaixaClient.ts
last_review: 2026-10-21
preconditions:
  - "Lote nativo NÃO finalizado e SEM .REM gerado, estado lido ao vivo no fin015 antes de excluir (emenda 2026-10-21). vldHasRemessaPgto não é guarda: reflete o import (1 com o item no lote, 0 quando sai)."
  - "Borderô identificado por filCod + borCod + borTimCad do NOSSO write-ahead desta remessa, conferidos na releitura (o mesmo borCod com outro borTimCad é de outra pessoa: nunca tocado; nunca o borderô antigo de um J rejeitado)."
  - "Disparo: retirada I21p(3)/I16d do grupo, ou lote local cancelado (L5) com rascunho nativo aberto."
postconditions:
  - "Item nativo (se importado), as N baixas e o borderô ausentes na releitura; sucesso = ausência observada, nunca o 200. Ausência do borderô = fin010/list borCod#EQ sem linhas, ou só com outro borTimCad (GET de borderô ausente responde 500 RECORDNOTFOUND, não 404)."
  - "Evento BORDERO_LIMPO na trilha."
side_effects:
  - "Escrita no ERP, nesta ordem: DELETE fin015/finItemSispag → releitura → excluirBaixa de cada baixa → excluirBordero → releitura. Ordem imposta pelo ERP (V3, HML 2026-10-20): com o item no lote, excluirBaixa/excluirBordero => 400 FIN_014.FIN_HAS_REMESSA_PGTO."
  - "Nunca cancelarBordero, finalizarBordero nem fin146."
  - "Pré-condição não atendida (lote nativo finalizado ou com .REM gerado, ou identidade divergente): nada é excluído; Alerta sispag-bordero-grupo-pendente e a analista decide (I21q). Borderô reaproveitado (I21s) que falha: só o item nativo do lote novo sai; o borderô fica, com o Alerta."
  - "Falha parcial fecha: não segue para finalizarLote; a retomada termina a limpeza."
---

# limparBorderoDoGrupo

ADR-0077 (P0-4, I21q). Desfaz **só o que o sistema criou**, e só enquanto o lote nativo não foi finalizado nem gerou `.REM`. Espelha
a I16d.3/I16d.6 (local primeiro, ERP depois, releitura, falha parcial fecha). Idempotente: borderô já
ausente não gera novo evento nem nova chamada (a ausência se decide pela releitura, não pelo status do
`DELETE`). **Implemented.**
