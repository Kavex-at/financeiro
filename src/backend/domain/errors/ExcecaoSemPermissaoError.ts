import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O usuário não tem `sispag:excecao` (ADR-0061, I12b). A rota já barra pelo guard; este erro é a
 * segunda trava, no serviço, para quem chamar fora da rota. HTTP 403.
 */
export default class ExcecaoSemPermissaoError extends Error implements HandlerError {
    public readonly code = 'EXCECAO_SEM_PERMISSAO';
    public readonly userMessage =
        'Você não tem a permissão "Exceção de destino (SISPAG)" para esta ação.';
    public readonly retryable = false;
    public readonly statusCode = 403;
    public readonly details?: unknown;

    public constructor() {
        super('sispag:excecao permission required');
        this.name = 'ExcecaoSemPermissaoError';
    }
}
