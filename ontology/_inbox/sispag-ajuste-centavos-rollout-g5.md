# sispag-ajuste-centavos — roteiro de rollout (G5) e checklist de pré-`on`

> **Origem:** ADR-0073, Task 17. O código está entregue com o modo `off` por default (ontologia v0.44.0,
> regra e ação `partial`). Este documento registra o que falta para ligar o ajuste em PRD. **Escrita em PRD
> só com go explícito do maintainer.**

## Roteiro G5 (nesta ordem, sem pular)

**(a) `shadow` em PRD, por filial.** Ligar `shadow` numa filial (nenhuma escrita no ERP) e conferir os eventos
`AJUSTE_SIMULADO` contra o levantamento de 2026-10-19: **109 títulos NELSON com +R$ 0,01** e o GT5. Divergência
de contagem, de valor ou de título elegível = parar e investigar antes de seguir.

**(b) UM título NELSON real, controlado.** Com go explícito do maintainer, ajustar um único título e verificar,
um a um: `fin064` (líquido aberto == valor do boleto), `fin103` (só o bloqueio criado pela renegociação,
liberado), vínculo do código no item e o `.REM` (J paga o valor da barra).

**(c) Só então `on`, por filial.** Uma filial por vez, acompanhando o ledger (`indeterminado` e
`aguardando_aprovacao_manual` são os estados que exigem olho humano).

## Checklist de pré-`on`

- [ ] **G1** (Task 14): sonda de leitura `fin070`/`fin103` com o login do servidor aprovada.
- [ ] **G2** (Task 15): renegociação com vencimento passado/hoje provada em HML.
- [ ] **G3** (Task 15): cancelar a renegociação não finalizada provado em HML **e** o `NotImplementedError` de
  `cancelarRenegociacao` (`ConexosRenegociacaoClient`) substituído pela chamada real, com
  `CANCELAMENTO_FIN070_PROVADO = true`.
- [ ] **G4** (Task 13): medição do líquido e do pagamento parcial em PRD (somente leitura).
- [ ] **I17m ativo** com o default final de `MODO_GUARDA_VALOR_J` (hoje `BLOQUEIA`, aguardando a medição da Task 13).
- [ ] `SISPAG_AJUSTE_CENTAVOS_LOGIN_SONDADO` igual ao login efetivamente sondado (= `CONEXOS_USERNAME` do servidor).

## Premissas com a Columbia (pendentes, não bloqueiam o rollout)

- Renegociação × correção do documento: a Columbia aceita a renegociação (novo `titCod` no mesmo `docCod`)
  como forma de acertar os centavos?
- Conta contábil de juros/desconto usada pela renegociação.
- Usuário de aprovação no `fin103` (quem libera o bloqueio criado pela renegociação).
