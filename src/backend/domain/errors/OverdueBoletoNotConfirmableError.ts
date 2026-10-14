import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Boleto que vence antes da data de débito do título só é informativo: não pode ser confirmado
 * (ADR-0068, I15h). HTTP 422.
 */
export default class OverdueBoletoNotConfirmableError extends Error implements HandlerError {
    public readonly code = 'BOLETO_VENCIDO_NAO_CONFIRMAVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: {
        filCod: number;
        docCod: string;
        titCod: string;
        ddcCod: number;
        ditCod: number;
    }) {
        super(
            `Overdue boleto not confirmable: ${params.filCod}/${params.docCod}/${params.titCod} x ${params.ddcCod}/${params.ditCod}`,
        );
        this.name = 'OverdueBoletoNotConfirmableError';
        this.userMessage =
            'Este boleto vence antes da data de débito do título: é só informativo e não pode ser confirmado.';
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
        };
    }
}
