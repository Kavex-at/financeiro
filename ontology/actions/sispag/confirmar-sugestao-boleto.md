---
name: confirmarSugestaoBoleto
type: action
entity: DecisaoSugestaoBoleto
ontology_version: "0.44.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/backend/domain/repository/sispag/SugestaoBoletoRepository.ts"
  - "src/backend/routes/sispag.ts"
  - "src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx"
last_review: 2026-10-19
preconditions:
  - "Usuário com `sispag:executar`; identidade do JWT (nunca `sistema`)."
  - "A sugestão (título, boleto) ainda é válida ao vivo-local: boleto livre, título sem vínculo, sem decisão ativa conflitante, boleto não reservado a outro título (anti-TOCTOU, I15e)."
  - "Boleto não vencido em relação à data de débito (I15h); boleto vencido não é confirmável no passo 1."
postconditions:
  - "1 DecisaoSugestaoBoleto CONFIRMADA com evidência (snapshot, delta com sinal, sinais, tier)."
  - "Se o par (pesCod, emissorChave) não estava VIGENTE: cria ConfirmacaoEmissorBoleto VIGENTE na MESMA transação; se estava, reutiliza (no-op no par)."
  - "Eventos DECISAO_CONFIRMADA (+ PAR_CONFIRMADO quando criou o par)."
  - "temBoleto, lote, título e ERP intactos (I15a, I15b)."
side_effects:
  - "Escrita local apenas, dentro da transação do confirmar."
  - "Depois do commit, fora da transação: dispara ajustarCentavosTitulo (assíncrono) quando o par tem 0 < |Δ| <= R$ 0,05 no mesmo dia e o modo da filial não é off (I18g, ADR-0073, planned). A resposta não espera o ERP; o derivado ajuste começa AGUARDANDO."
---

# confirmarSugestaoBoleto

ADR-0068, Q1 (par + registro por título). Idempotente (I15j). A UI mostra o título como
"boleto confirmado (emissor X) — remessa ainda depende do ERP" e **mantém** o aviso do lote.
Confirmação de tier `ATENCAO` é permitida (diferença com sinal já visível), mas nunca alarga limite
(I15d). **Implemented** (v0.66.0).
