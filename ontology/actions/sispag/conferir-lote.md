---
name: conferirLote
type: action
entity: LotePagamento
ontology_version: "0.36.0"
implementation_status: planned
status: draft
owners: [yuri]
related_files:
  - src/backend/domain/service/sispag/LotePagamentoService.ts
  - src/backend/domain/interface/auth/Permission.ts
  - src/backend/routes/sispag.ts
  - src/frontend/app/sispag/components/LoteCard.tsx
last_review: 2026-10-05
preconditions:
  - "Usuário com sispag:conferir."
  - "Lote em FINALIZADO, exigeConferencia = true (≥1 item TED ou PIX), ainda não conferido; versao esperada (I6)."
  - "Conferente ≠ finalizadoPor, ≠ incluidoPor de qualquer item, ≠ criadoPor quando o lote é manual (automatico = false) — username canônico autenticado, checado no backend (I13l). Violação: SelfConferenceError."
postconditions:
  - "L12 FINALIZADO → FINALIZADO: grava conferidoPor + conferidoEm; incrementa versao."
  - "gerarRemessa (L8) passa a ser permitido para o lote."
side_effects:
  - "Escrita local + trilha (I13m). Nenhuma escrita no Conexos."
---

# conferirLote (L12)

ADR-0063, I13l. A segunda pessoa confere os pagamentos TED/PIX antes da remessa. Vê, por item
TED/PIX: favorecido, conta/chave mascarada (I10h) e origem do destino, valor, alertas de duplicidade
com a justificativa e alertas de canal habitual. Discordou → `devolverLote` (L13).

Lote só de boleto não passa por aqui (`exigeConferencia = false`).
