import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Rejeitar (F3) e revogar (F7) uma autorização de favorecido exigem motivo (ADR-0065). HTTP 422.
 */
export default class PayeeDecisionReasonRequiredError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_MOTIVO_OBRIGATORIO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { id: string; acao: string }) {
        super(`Payee authorization ${params.id}: reason required to ${params.acao}`);
        this.name = 'PayeeDecisionReasonRequiredError';
        this.userMessage = `Informe o motivo para ${params.acao} a autorização.`;
        this.details = { id: params.id, acao: params.acao };
    }
}
