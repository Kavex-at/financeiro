import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Transição pedida sobre um grupo de boleto num estado que não a admite (I21t): anular um grupo
 * `PAGO` (terminal). HTTP 409.
 */
export default class GroupedBoletoStateConflictError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_ESTADO_INCOMPATIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: { grupoId: string; estado: string; acao: string };

    public constructor(params: { grupoId: string; estado: string; acao: string }) {
        super(`Grouped boleto ${params.grupoId} is ${params.estado}: cannot ${params.acao}`);
        this.name = 'GroupedBoletoStateConflictError';
        this.userMessage =
            params.estado === 'PAGO'
                ? 'O grupo de boleto já foi pago: não pode ser anulado.'
                : `O grupo de boleto está ${params.estado}: a operação não se aplica.`;
        this.details = { ...params };
    }
}
