import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Confirmação de emissor inexistente (ADR-0068). HTTP 404. */
export default class IssuerConfirmationNotFoundError extends Error implements HandlerError {
    public readonly code = 'CONFIRMACAO_EMISSOR_NAO_ENCONTRADA';
    public readonly userMessage = 'Confirmação de emissor não encontrada.';
    public readonly retryable = false;
    public readonly statusCode = 404;
    public readonly details?: unknown;

    public constructor(params: { id: string }) {
        super(`Issuer confirmation ${params.id} not found`);
        this.name = 'IssuerConfirmationNotFoundError';
        this.details = { id: params.id };
    }
}
