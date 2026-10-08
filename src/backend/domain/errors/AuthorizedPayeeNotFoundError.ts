import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Autorização de favorecido inexistente. HTTP 404.
 */
export default class AuthorizedPayeeNotFoundError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_NAO_ENCONTRADA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 404;
    public readonly details?: unknown;

    public constructor(params: { id: string }) {
        super(`Payee authorization ${params.id} not found`);
        this.name = 'AuthorizedPayeeNotFoundError';
        this.userMessage = 'Autorização de favorecido não encontrada.';
        this.details = { id: params.id };
    }
}
