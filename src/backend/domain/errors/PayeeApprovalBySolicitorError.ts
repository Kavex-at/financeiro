import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Quem pediu (ou confirmou a reaprovação de) uma autorização de favorecido não pode aprová-la (ADR-0065
 * I14c, F2/F6). Comparado pelo usuário autenticado, no backend. HTTP 403.
 */
export default class PayeeApprovalBySolicitorError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_APROVADOR_E_SOLICITANTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 403;
    public readonly details?: unknown;

    public constructor(params: { id: string }) {
        super(`Payee authorization ${params.id} cannot be approved by its requester`);
        this.name = 'PayeeApprovalBySolicitorError';
        this.userMessage =
            'Quem pediu a autorização não pode aprová-la. Peça a outra pessoa com a permissão de autorizar favorecidos.';
        this.details = { id: params.id };
    }
}
