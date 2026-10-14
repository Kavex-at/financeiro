import type { HandlerError } from '../libs/handler/HandlerError.js';

/** A decisão exige o usuário autenticado; ator vazio, `sistema` ou `unknown` é recusado. HTTP 403. */
export default class InvalidDecisionActorError extends Error implements HandlerError {
    public readonly code = 'ATOR_DA_DECISAO_INVALIDO';
    public readonly userMessage =
        'Esta decisão exige um usuário autenticado identificado. Entre novamente e tente de novo.';
    public readonly retryable = false;
    public readonly statusCode = 403;
    public readonly details?: unknown;

    public constructor() {
        super('Invalid decision actor: the decision requires the authenticated user');
        this.name = 'InvalidDecisionActorError';
    }
}
