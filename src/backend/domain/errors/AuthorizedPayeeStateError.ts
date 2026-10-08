import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Transição que a state machine `favorecido-autorizado` não permite a partir do estado atual
 * (ADR-0065). Terminais (REJEITADO, REVOGADO) recusam tudo. HTTP 409.
 */
export default class AuthorizedPayeeStateError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_ESTADO_INVALIDO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { id: string; estado: string; acao: string }) {
        super(`Payee authorization ${params.id} in state ${params.estado} cannot ${params.acao}`);
        this.name = 'AuthorizedPayeeStateError';
        this.userMessage = `A autorização está ${params.estado.toLowerCase().replace('_', ' ')} e não pode ser ${params.acao}. Atualize a tela.`;
        this.details = { id: params.id, estado: params.estado, acao: params.acao };
    }
}
