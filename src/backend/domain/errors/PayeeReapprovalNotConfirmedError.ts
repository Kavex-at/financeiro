import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Reaprovação aberta pelo sistema (F4) ainda sem pedido confirmado por alguém com `sispag:executar`
 * (ADR-0065 F5/F6). Sem `solicitadoPor` a reaprovação não pode ser aprovada. HTTP 409.
 */
export default class PayeeReapprovalNotConfirmedError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_REAPROVACAO_NAO_CONFIRMADA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { id: string }) {
        super(`Payee reapproval ${params.id} was not confirmed by a requester`);
        this.name = 'PayeeReapprovalNotConfirmedError';
        this.userMessage =
            'O destino deste favorecido mudou no cadastro do Conexos. Antes de aprovar, alguém com permissão de executar pagamentos precisa confirmar o pedido.';
        this.details = { id: params.id };
    }
}
