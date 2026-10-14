---
name: sugerirBoletoParaTitulo
type: action
entity: BoletoDda
ontology_version: "0.40.0"
implementation_status: implemented
status: draft
owners: [yuri]
related_files:
  - "src/backend/domain/service/sispag/MotorSugestaoBoleto.ts"
  - "src/backend/domain/service/sispag/RegraSugestaoBoleto.ts"
  - "src/backend/domain/service/sispag/BoletoSuggestionService.ts"
  - "src/backend/routes/sispag.ts"
  - "src/frontend/app/sispag/components/SugestaoBoletoPainel.tsx"
last_review: 2026-10-14
preconditions:
  - "Usuário com `sispag:ver`."
  - "Título ativo, não pago, `forma = BOLETO`, `tem_boleto = false`."
postconditions:
  - "Devolve 0..N SugestaoBoleto (value object, NÃO persistido): boleto (ddcCod, ditCod, numero, emissor mascarado), delta com sinal (valor R$/%, dias) destacado quando ATENCAO, sinais, tier (CONHECIDO|FORTE|ATENCAO), indicação de vencido (informativo, I15h)."
  - "Nenhuma sugestão excluída por I15e aparece; boleto disputado por dois títulos fica reservado ao de menor vencimento (empate: menor docCod) e o outro título o vê ausente."
side_effects:
  - "Nenhum. Leitura local de `titulo_a_pagar`, `boleto_dda` e das confirmações. Zero chamadas ao Conexos."
---

# sugerirBoletoParaTitulo

ADR-0068 / I15c–f, I15h. Cálculo puro, igual a `candidatos` de `BoletoDda` (I-DDA1): não grava nada.
Mostra o `ddaDefasado` ao lado quando o pool está parado (ADR-0067). **Implemented** (v0.66.0).
