---
name: devolverLote
type: action
entity: LotePagamento
ontology_version: "0.36.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/components/LoteCard.tsx
last_review: 2026-10-05
preconditions:
  - "Usuário com sispag:conferir e as mesmas restrições de pessoa de conferirLote (I13l)."
  - "Lote em FINALIZADO com exigeConferencia = true; versao esperada (I6)."
  - "Motivo não vazio."
postconditions:
  - "L13 FINALIZADO → RASCUNHO: grava devolvidoPor, devolvidoEm, motivoDevolucao; limpa conferidoPor/conferidoEm, finalizadoPor/finalizadoEm; incrementa versao."
side_effects:
  - "Escrita local + trilha (I13m). Nenhuma escrita no Conexos."
---

# devolverLote (L13)

ADR-0063, I13l. O conferente devolve o lote à analista para corrigir pendências (BPMN: "Corrigir
pendências do lote"). O motivo fica visível no lote em `RASCUNHO` até a próxima finalização. Efeito
de estado igual ao de `reabrirLote` (L4); difere no ator (o conferente, não quem finalizou) e no
motivo obrigatório.
