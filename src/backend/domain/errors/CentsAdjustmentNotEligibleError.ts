import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Motivo legível ao operador para cada inelegibilidade (I18a/I18m). */
const MOTIVO_PT: Readonly<Record<string, string>> = {
    SEM_DECISAO_CONFIRMADA: 'não há boleto confirmado para este título',
    PAR_NAO_VIGENTE: 'o emissor do boleto não está confirmado para este credor',
    NUMERO_DIFERENTE: 'o número do boleto é diferente do número do título',
    BOLETO_INDISPONIVEL: 'o código de barras do boleto não está disponível',
    VENCIMENTO_DIFERENTE: 'o vencimento do boleto é diferente do vencimento do título',
    TITULO_NAO_APROVADO: 'o título não está aprovado no Conexos',
    TITULO_PAGO_OU_PARCIAL: 'o título está pago ou tem pagamento parcial',
    JUROS_OU_DESCONTO_PREVIO: 'o título já tem juros ou desconto',
    VALOR_ABERTO_INDISPONIVEL: 'o Conexos não informou o valor em aberto do título',
    DELTA_ZERO: 'o valor do boleto já é igual ao do título',
    DELTA_ACIMA_LIMITE: 'a diferença passa de R$ 0,05',
    JA_AJUSTADO_NA_LINHAGEM: 'este título já foi ajustado uma vez',
    TITULO_EM_LOTE_FINALIZADO: 'o título está em lote finalizado ou com remessa gerada',
    TITULO_EM_RASCUNHO_NATIVO: 'o título está num lote do SISPAG no Conexos',
    MODO_NAO_ON: 'o ajuste de centavos não está ligado nesta filial',
};

/**
 * "Tentar de novo" sobre um título que não é (mais) elegível ao ajuste de centavos (I18a). Nada foi
 * escrito no Conexos. HTTP 409, com o motivo tipado.
 */
export default class CentsAdjustmentNotEligibleError extends Error implements HandlerError {
    public readonly code = 'AJUSTE_CENTAVOS_INELEGIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: { filCod: number; docCod: string; titCod: string; motivo: string };

    public constructor(params: { filCod: number; docCod: string; titCod: string; motivo: string }) {
        super(
            `Title ${params.filCod}:${params.docCod}:${params.titCod} is not eligible for cents adjustment: ${params.motivo}`,
        );
        this.name = 'CentsAdjustmentNotEligibleError';
        const razao = MOTIVO_PT[params.motivo] ?? params.motivo;
        this.userMessage =
            `O título ${params.docCod}/${params.titCod} não pode ter os centavos ajustados: ` +
            `${razao}. Nada foi alterado no Conexos; se for o caso, ajuste pelo fluxo normal do Conexos.`;
        this.details = { ...params };
    }
}
