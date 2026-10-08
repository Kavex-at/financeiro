import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * A autorização mudou desde que foi lida (lock otimista por `versao`, ADR-0065). HTTP 409.
 */
export default class AuthorizedPayeeVersionConflictError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_VERSAO_CONFLITO';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { id: string; versaoEsperada: number }) {
        super(
            `Payee authorization ${params.id} changed (expected version ${params.versaoEsperada})`,
        );
        this.name = 'AuthorizedPayeeVersionConflictError';
        this.userMessage =
            'A autorização foi alterada por outra pessoa. Atualize a tela e tente de novo.';
        this.details = { id: params.id, versaoEsperada: params.versaoEsperada };
    }
}
