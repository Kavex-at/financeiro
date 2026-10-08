import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O destino que o cadastro do Conexos resolve agora não é o que a tela mostrou ao aprovador (ADR-0065
 * I14c, anti-TOCTOU). Nada é gravado; a tela recarrega. Sem valores (I10h). HTTP 409.
 */
export default class PayeeDestinationChangedSinceShownError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_DESTINO_MUDOU';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { id: string }) {
        super(`Payee authorization ${params.id}: destination changed since it was shown`);
        this.name = 'PayeeDestinationChangedSinceShownError';
        this.userMessage =
            'O destino deste favorecido mudou no cadastro do Conexos desde que a tela foi aberta. Atualize e confira de novo antes de aprovar.';
        this.details = { id: params.id };
    }
}
