import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * A listagem de pares/decisões bateu o teto: devolvê-la truncada faria decisões já tomadas
 * parecerem ausentes (fail-open). HTTP 503.
 */
export default class SuggestionListingTruncatedError extends Error implements HandlerError {
    public readonly code = 'LISTAGEM_SUGESTAO_TRUNCADA';
    public readonly userMessage =
        'A lista de decisões de boleto atingiu o limite e não pode ser exibida por completo. Acione o suporte.';
    public readonly retryable = false;
    public readonly statusCode = 503;
    public readonly details?: unknown;

    public constructor(params: { listagem: string; limite: number }) {
        super(`Suggestion listing ${params.listagem} truncated at ${params.limite} rows`);
        this.name = 'SuggestionListingTruncatedError';
        this.details = { listagem: params.listagem, limite: params.limite };
    }
}
