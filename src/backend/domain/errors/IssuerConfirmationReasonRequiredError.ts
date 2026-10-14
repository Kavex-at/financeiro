import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Rejeitar a sugestão e revogar a confirmação do emissor exigem motivo (ADR-0068, I15g).
 * HTTP 422.
 */
export default class IssuerConfirmationReasonRequiredError extends Error implements HandlerError {
    public readonly code = 'CONFIRMACAO_EMISSOR_MOTIVO_OBRIGATORIO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { acao: string }) {
        super(`Issuer confirmation: reason required to ${params.acao}`);
        this.name = 'IssuerConfirmationReasonRequiredError';
        this.userMessage = `Informe o motivo para ${params.acao}.`;
        this.details = { acao: params.acao };
    }
}
