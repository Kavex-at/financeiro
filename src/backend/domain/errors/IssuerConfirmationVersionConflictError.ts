import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Revogação perdeu a corrida: a confirmação de emissor mudou de versão (ADR-0068). HTTP 409. */
export default class IssuerConfirmationVersionConflictError extends Error implements HandlerError {
    public readonly code = 'CONFIRMACAO_EMISSOR_CONFLITO_DE_VERSAO';
    public readonly userMessage =
        'A confirmação de emissor foi alterada por outra pessoa. Atualize a lista e tente de novo.';
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { id: string }) {
        super(`Issuer confirmation ${params.id} version conflict`);
        this.name = 'IssuerConfirmationVersionConflictError';
        this.details = { id: params.id };
    }
}
