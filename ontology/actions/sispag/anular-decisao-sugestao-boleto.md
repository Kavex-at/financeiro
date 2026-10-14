---
name: anularDecisaoSugestaoBoleto
type: action
entity: DecisaoSugestaoBoleto
ontology_version: "0.40.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts"
  - "src/backend/routes/sispag.ts"
  - "src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx"
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:executar`; ator vem do JWT (nunca `sistema`/`unknown`); motivo de 10 a 500 caracteres."
  - "O título tem decisão `CONFIRMADA` (senão `DecisionNotConfirmedError`, 409)."
postconditions:
  - "`CONFIRMADA` → `ANULADA` (terminal) com `anuladaPor`, `anuladaEm`, `motivoAnulacao`; evento `DECISAO_ANULADA` na MESMA transação, com lock otimista por `versao`."
  - "Título e boleto liberados: podem ser confirmados de novo (índices únicos só da `CONFIRMADA`)."
  - "Idempotente: título já `ANULADA` devolve a decisão, 200, sem escrita."
  - "O par (credor, emissor) NÃO muda."
side_effects:
  - "Escrita local apenas. Nada a desfazer no ERP (I15b). Invalida o cache de sugestões do processo."
---

# anularDecisaoSugestaoBoleto

ADR-0068, emenda 2026-10-14 (2) (I15l). `POST /sispag/sugestoes-boleto/anular`, corpo estrito
`{ filCod, docCod, titCod, motivo }`. Vale também para confirmação **órfã** (boleto fora do pool,
título sinalizado pelo ERP, título pago ou inativo) — é a única saída dela. A revogação do par
executa a mesma anulação em cascata (motivo `par revogado: <motivo>`), um evento por decisão.
