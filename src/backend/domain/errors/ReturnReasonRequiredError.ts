import type { HandlerError } from '../libs/handler/HandlerError.js';

/** `devolverLote` (L13) sem motivo (ADR-0063, I13l): o motivo é obrigatório. HTTP 400. */
export default class ReturnReasonRequiredError extends Error implements HandlerError {
    public readonly code = 'DEVOLUCAO_MOTIVO_OBRIGATORIO';
    public readonly userMessage =
        'Informe o motivo da devolução: ele fica visível no lote para quem vai corrigir.';
    public readonly retryable = false;
    public readonly statusCode = 400;
    public readonly details?: unknown;

    public constructor(params: { loteId: string }) {
        super(`return of lot ${params.loteId} requires a reason`);
        this.name = 'ReturnReasonRequiredError';
        this.details = { loteId: params.loteId };
    }
}
