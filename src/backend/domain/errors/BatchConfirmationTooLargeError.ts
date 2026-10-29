import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Confirmação em conjunto acima do teto de linhas (I15t(3), ADR-0080): nada é confirmado. HTTP 422.
 */
export default class BatchConfirmationTooLargeError extends Error implements HandlerError {
    public readonly code = 'CONFIRMACAO_CONJUNTO_ACIMA_DO_LIMITE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { pedidas: number; maximo: number }) {
        super(`Batch confirmation has ${params.pedidas} rows; maximum is ${params.maximo}`);
        this.name = 'BatchConfirmationTooLargeError';
        this.userMessage = `Confirme no máximo ${params.maximo} títulos de uma vez (${params.pedidas} marcados). Nada foi confirmado.`;
        this.details = { pedidas: params.pedidas, maximo: params.maximo };
    }
}
