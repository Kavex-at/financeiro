import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * A sugestão não está mais disponível na releitura da confirmação: título pago ou já sinalizado
 * pelo ERP, boleto vinculado ou fora do pool, ou o motor deixou de sugerir o par (ADR-0068,
 * I15a/I15e). HTTP 409.
 */
export default class BoletoSuggestionNotAvailableError extends Error implements HandlerError {
    public readonly code = 'SUGESTAO_BOLETO_INDISPONIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        filCod: number;
        docCod: string;
        titCod: string;
        ddcCod: number;
        ditCod: number;
        motivo?: string;
    }) {
        super(
            `Boleto suggestion not available: ${params.filCod}/${params.docCod}/${params.titCod} x ${params.ddcCod}/${params.ditCod}`,
        );
        this.name = 'BoletoSuggestionNotAvailableError';
        this.userMessage =
            params.motivo ??
            'Esta sugestão não está mais disponível: o título ou o boleto mudou. Atualize a lista.';
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
        };
    }
}
