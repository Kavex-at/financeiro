import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Exceção de destino desligada (ADR-0060): `SISPAG_EXCECAO_DESTINO_ENABLED` (alias
 * `SISPAG_DESTINO_MANUAL_ENABLED`) não está ligada. As flags ficam desligadas até o teste
 * supervisionado em produção provar o H3/H5. HTTP 403.
 */
export default class ExcecaoDesabilitadaError extends Error implements HandlerError {
    public readonly code = 'EXCECAO_DESABILITADA';
    public readonly userMessage = 'A exceção de destino de pagamento ainda não está habilitada.';
    public readonly retryable = false;
    public readonly statusCode = 403;
    public readonly details?: unknown;

    public constructor() {
        super('payment destination exception disabled');
        this.name = 'ExcecaoDesabilitadaError';
    }
}
