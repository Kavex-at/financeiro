import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Anular exige uma decisão `CONFIRMADA` para o título (ADR-0068, I15l). Título sem confirmação,
 * ou só com rejeição, não tem o que anular. HTTP 409.
 */
export default class DecisionNotConfirmedError extends Error implements HandlerError {
    public readonly code = 'DECISAO_NAO_CONFIRMADA';
    public readonly userMessage = 'Este título não tem boleto confirmado para anular.';
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { filCod: number; docCod: string; titCod: string }) {
        super(
            `Title ${params.filCod}:${params.docCod}:${params.titCod} has no CONFIRMADA decision to annul`,
        );
        this.name = 'DecisionNotConfirmedError';
        this.details = { filCod: params.filCod, docCod: params.docCod, titCod: params.titCod };
    }
}
