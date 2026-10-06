---
name: resolverAlertaDuplicidade
type: action
entity: AlertaItemLote
ontology_version: "0.36.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/components/LoteCard.tsx
last_review: 2026-10-05
preconditions:
  - "Usuário com sispag:executar (mesma permissão de editar o lote)."
  - "Lote em RASCUNHO; versao esperada (I6)."
  - "AlertaItemLote de duplicidade (FORTE ou FRACA) em estado ABERTA."
  - "JUSTIFICAR: justificativa não vazia. RETIRAR: motivo não vazio."
  - "Desfazer bloqueio: BloqueioDuplicidade ATIVO; motivo não vazio."
postconditions:
  - "JUSTIFICAR: alerta → RESOLVIDA (resolucao JUSTIFICADA, justificativa, resolvidoPor/Em). Item fica no lote."
  - "RETIRAR: alerta → RESOLVIDA (resolucao RETIRADA); item removido do lote (removerTituloDoLote); BloqueioDuplicidade ATIVO criado no título (I13g). Demais alertas do item → DESCARTADA."
  - "Desfazer bloqueio: BloqueioDuplicidade ATIVO → DESFEITO (desfeitoPor/Em, motivoDesfazer); título volta a ser elegível pelas regras normais (I2/I3/I4)."
side_effects:
  - "Escrita local + trilha (I13m). Nenhuma escrita no Conexos: o cancelamento do documento duplicado é ato humano no ERP."
---

# resolverAlertaDuplicidade

ADR-0063, I13f–I13h. Três operações:

- **Justificar** — "não é duplicado, quero pagar". O conferente verá a justificativa (I13l).
- **Retirar** — "é duplicado". O item sai do lote e o título fica bloqueado até o documento sumir do
  `fin064` ou a analista desfazer o bloqueio.
- **Desfazer bloqueio** — na aba "Títulos a pagar", quando a retirada foi engano. Auditado.

A resolução vale para a contraparte daquela alerta; contraparte nova abre alerta nova (I13h).
