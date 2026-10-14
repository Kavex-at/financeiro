---
name: copiarLinhaDigitavel
type: action
entity: BoletoDda
ontology_version: "0.40.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/backend/domain/libs/boleto/CodigoBarrasBoleto.ts"
  - "src/backend/routes/sispag.ts"
  - "src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx"
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:ver` (Q4 re-decidida em 2026-10-14; confirmar/rejeitar/revogar seguem `sispag:executar`)."
  - "Boleto presente no pool local (`boleto_dda.codbar`)."
postconditions:
  - "Devolve a linha digitável (derivada de `codbar`) ao navegador do usuário; evento LINHA_COPIADA (quem, quando, título, boleto) — toda cópia é auditada (decisão do maintainer)."
side_effects:
  - "Escrita local apenas (trilha). A linha completa nunca vai para log nem ledger (I15k)."
---

# copiarLinhaDigitavel

ADR-0068, I15k. Existe para o analista conferir no portal do banco/ERP sem digitar. Auditada a cada
cópia; Permissão `sispag:ver`, igual a `GET /boletos-dda` e ao lote (ADR-0053); fail-closed: sem trilha, sem linha. **Implemented** (v0.66.0).
