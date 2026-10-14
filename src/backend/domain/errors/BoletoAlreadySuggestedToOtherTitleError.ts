import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O boleto já foi confirmado para outro título, ou a reserva dele agora é de outro título
 * (disputa I15e, ADR-0068). HTTP 409.
 */
export default class BoletoAlreadySuggestedToOtherTitleError extends Error implements HandlerError {
    public readonly code = 'BOLETO_JA_SUGERIDO_A_OUTRO_TITULO';
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
    }) {
        super(
            `Boleto already suggested to another title: ${params.filCod}/${params.docCod}/${params.titCod} x ${params.ddcCod}/${params.ditCod}`,
        );
        this.name = 'BoletoAlreadySuggestedToOtherTitleError';
        this.userMessage =
            'Este boleto já está reservado a outro título. Atualize a lista para ver a sugestão vigente.';
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
        };
    }
}
