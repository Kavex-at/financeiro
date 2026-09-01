---
name: validarConfiguracao
type: action
entity: Alerta
ontology_version: "0.22"
implementation_status: planned
status: draft
owners: [yuri]
related_files: []
last_review: 2026-09-01
preconditions: []
postconditions:
  - "Cada var conhecida classificada em configurado | ausente | usando-default."
  - "Var obrigatória ausente gera Alerta 'config-ausente' no boot."
side_effects:
  - "Escreve Alerta quando há var obrigatória ausente."
---

# validarConfiguracao

> Um manifesto em código (qual frente **exige** vs. **usa opcionalmente** cada var) confrontado com
> o ambiente do processo. Roda no boot e sob demanda pelo painel.

## Por que isto existe

Duas vars não configuradas já produziram defeito visível em produção:

- **`RECEBIMENTO_TITULARES_INTERNOS` ausente** → `ehTransferenciaInterna` nunca dispara,
  `transferencia_interna = 0` em 338 linhas, e o ruído de tesouraria contamina a carteira **na tela
  do analista**, não só no relatório (`docs/impacto/h0-recebimentos-achados.md` §2).
- **`COM297_GCD_NOTA_DEBITO` ausente** → a única falha real de valor da Frente IV,
  R$ 477.741,70 (`h0` §1).

Ambas são uma linha de configuração. Ambas falharam no momento de tocar dinheiro, em vez de no
deploy. Esta ação move a descoberta para o boot.

## Invariante I3 — nunca imprime valor de secret

A saída é a **classificação**, jamais o valor: `configurado | ausente | usando-default`. Vale para o
log de boot e para o painel. Um diagnóstico de configuração que vaza credencial troca um problema
de operação por um de segurança.
