# Roteiro de QA manual — data divergente (Fase 1: confirmar, faixa, filtros)

Ambiente: tenant de desenvolvimento/HML, usuário com `sispag:executar`. **Não** ligar
`SISPAG_BIND_CODBAR_DATA_DIVERGENTE_FILIAIS` (Fase 2 não existe): nada aqui grava código de barras.

## Preparação
Escolher (ou forjar no banco de HML) quatro títulos "boleto sem DDA" com par DDA de **valor igual**:
- **A:** boleto vence **depois** do título em 7 dias.
- **B:** boleto vence **antes** do título (Δ = −2) e ainda não venceu hoje.
- **C:** boleto vence **hoje**, título vence daqui a 5 dias.
- **D:** boleto venceu **ontem**, título ainda a vencer, par com âncora (número igual ou par vigente).

## Casos
1. **Confirmar A (Δ +7):** abre o diálogo "Boleto com data divergente do título", mostra valor e "+7 dias". Botão Confirmar desabilitado até marcar o checkbox **e** o motivo ter ≥ 10 caracteres. Foco inicial no motivo. Esc fecha sem gravar.
2. **Confirmar B (Δ −2):** o diálogo é o mesmo (substitui o aviso simples). Após confirmar, a decisão fica `CONFIRMADA` com o reconhecimento gravado.
3. **Erro 422 desatualizado:** com o diálogo aberto, alterar o boleto/valor no banco e confirmar. A mensagem do servidor aparece **dentro** do diálogo, que continua aberto, e a lista recarrega ao fundo.
4. **Faixa "bloqueados vencem hoje":** o título C aparece com "Boleto sugerido vence hoje · título vence dd/mm" e entra na contagem e no valor da faixa. Em título com 2+ candidatos seguros, mostra "N candidatos" com o prazo do mais cedo.
5. **Perdido (D):** aparece na região "Perdido: resolver no portal do banco", sem botão, **fora** da contagem de "vencem hoje", e no filtro "Vencidos". Não ganha o motivo `VENCIDO`.
6. **Filtro de/até:** filtrar pelo dia do boleto de B traz o título B; filtrar pelo dia do título também o traz. A linha mostra as duas datas.
7. **Candidato fraco (sem âncora):** não puxa o título para a faixa nem vira "perdido".
8. **Regressão:** par de valor igual, Δ entre 0 e 5, sem divergência: confirma sem pedir ack, como antes. Título sem boleto candidato: prazo = vencimento do título.
9. **Anular e reconfirmar:** anular a decisão de B e confirmar de novo pede novo ack.

## Critério de aceite
Nenhum caso grava escrita no Conexos. Conferir no log do servidor: zero `PUT`/`importar`/`fin070`/`fin026` durante o roteiro.
