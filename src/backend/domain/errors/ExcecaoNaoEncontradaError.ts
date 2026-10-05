import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Exceção de destino inexistente (ADR-0060). HTTP 404. */
export default class ExcecaoNaoEncontradaError extends Error implements HandlerError {
    public readonly code = 'EXCECAO_NAO_ENCONTRADA';
    public readonly userMessage = 'Exceção de destino não encontrada.';
    public readonly retryable = false;
    public readonly statusCode = 404;
    public readonly details?: unknown;

    public constructor(params: { excecaoId: string }) {
        super(`destination exception ${params.excecaoId} not found`);
        this.name = 'ExcecaoNaoEncontradaError';
        this.details = { excecaoId: params.excecaoId };
    }
}
