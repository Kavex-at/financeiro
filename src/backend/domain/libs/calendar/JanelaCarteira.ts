/**
 * Janela de vencimento que a carteira (`titulo_a_pagar`) carrega do fin064: de hoje − 15 a hoje + 45
 * dias. Fonte ÚNICA — a ingestão (`IngestaoPagamentosService`) e a consolidação dos boletos DDA
 * (`ConsolidacaoBoletoDda`) leem daqui; boleto livre fora dela nunca acha o título na carteira.
 */
export const JANELA_CARTEIRA_DIAS_ATRAS = 15;
export const JANELA_CARTEIRA_DIAS_ADIANTE = 45;
