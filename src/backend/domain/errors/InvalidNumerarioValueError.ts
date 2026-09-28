import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Valor da Solicitação de Numerário que não é positivo depois de arredondado a 2 casas. A rota já
 * exige `valor > 0`; isto pega o que sobra (ex.: 0,004 vira 0,00). Pedido bem-formado que a regra
 * recusa → 422, como as demais recusas de valor da permuta.
 */
export default class InvalidNumerarioValueError extends Error implements HandlerError {
    public readonly code = 'NUMERARIO_VALOR_INVALIDO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    constructor(params: { valor: number }) {
        super(`invalid value for SN (${params.valor})`);
        this.name = 'InvalidNumerarioValueError';
        this.userMessage =
            `Valor inválido para a Solicitação de Numerário (${params.valor}): ele precisa ser ` +
            'maior que zero depois de arredondado a 2 casas.';
        this.details = params;
    }
}
