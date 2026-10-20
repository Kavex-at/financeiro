# sispag-ajuste-centavos — roteiro de rollout (G5) e checklist de pré-`on`

> **Origem:** ADR-0073, Task 17. **Emenda 2026-10-20 (maintainer):** o ajuste **não tem flag dedicada** e fica
> **ativo logo após o merge**, no processo do servidor. O modo efetivo sai dos kill-switches existentes: `on`
> com `SISPAG_LIVE_WRITE_ENABLED` ligado, escrita Conexos ligada, sem `CONEXOS_DRY_RUN` e com credencial do
> servidor; senão `shadow` (leitura ao vivo, zero escrita, `warn`). **Freio:** `SISPAG_LIVE_WRITE_ENABLED=false`.

## Roteiro G5 (acompanhamento após o merge)

**(a) Conferir os primeiros ajustes contra o levantamento.** Comparar os eventos do ledger com o levantamento
de 2026-10-19: **109 títulos NELSON com +R$ 0,01** e o GT5. Divergência de contagem, de valor ou de título
elegível = desligar `SISPAG_LIVE_WRITE_ENABLED` e investigar.

**(b) Primeiro título NELSON real.** Verificar, um a um: `fin064` (líquido aberto == valor do boleto), `fin103`
(só o bloqueio criado pela renegociação, liberado), vínculo do código no item e o `.REM` (J paga o valor da
barra).

**(c) Acompanhar o ledger** (`indeterminado` e `aguardando_aprovacao_manual` são os estados que exigem olho
humano). Os dois já aparecem como `Alerta` `sispag-ajuste-centavos-parado` no Painel de Operação
(`erro` / `aviso`, no máximo um por ajuste por dia), com a ação a tomar no Conexos.

## Checklist

- [x] **G1** (Task 14): sonda de leitura `fin070`/`fin103` com o login do servidor aprovada em PRD
  (MPS_FRANCINEI). Trocar o `CONEXOS_USERNAME` do servidor exige nova sonda (procedimento operacional).
- [ ] **G2** (Task 15): renegociação com vencimento passado/hoje provada em HML.
- [ ] **G3** (Task 15): cancelar a renegociação não finalizada provado em HML **e** o `NotImplementedError` de
  `cancelarRenegociacao` (`ConexosRenegociacaoClient`) substituído pela chamada real, com
  `CANCELAMENTO_FIN070_PROVADO = true`.
- [ ] **G4** (Task 13): medição do líquido e do pagamento parcial em PRD (somente leitura).
- [ ] **I17m ativo** com o default final de `MODO_GUARDA_VALOR_J` (hoje `BLOQUEIA`, aguardando a medição da Task 13).

## Premissas com a Columbia (pendentes, não bloqueiam o rollout)

- Renegociação × correção do documento: a Columbia aceita a renegociação (novo `titCod` no mesmo `docCod`)
  como forma de acertar os centavos?
- Conta contábil de juros/desconto usada pela renegociação.
- Usuário de aprovação no `fin103` (quem libera o bloqueio criado pela renegociação).
