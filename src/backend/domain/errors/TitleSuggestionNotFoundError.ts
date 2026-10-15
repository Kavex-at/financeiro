import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O título não tem desfecho de sugestão: não é elegível (pago, inativo, já sinalizado pelo ERP,
 * outra forma de pagamento) ou saiu da carteira (ADR-0072, I15m). HTTP 404.
 */
export default class TitleSuggestionNotFoundError extends Error implements HandlerError {
    public readonly code = 'TITULO_SEM_SUGESTAO';
    public readonly userMessage =
        'Este título não está elegível à sugestão de boleto (pago, inativo, já sinalizado ou fora da carteira).';
    public readonly retryable = false;
    public readonly statusCode = 404;
    public readonly details?: unknown;

    public constructor(params: { filCod: number; docCod: string; titCod: string }) {
        super(`Title ${params.filCod}:${params.docCod}:${params.titCod} has no suggestion outcome`);
        this.name = 'TitleSuggestionNotFoundError';
        this.details = { filCod: params.filCod, docCod: params.docCod, titCod: params.titCod };
    }
}
