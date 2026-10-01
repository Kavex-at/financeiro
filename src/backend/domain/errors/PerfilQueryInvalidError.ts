import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Consulta do perfil inválida: período mal formado, intervalo invertido ou longo demais, cursor
 * adulterado. HTTP 400 — quem pediu precisa corrigir a requisição. Mensagem ao operador em
 * português (ADR-0042).
 */
export default class PerfilQueryInvalidError extends Error implements HandlerError {
    public readonly code = 'PERFIL_QUERY_INVALID';
    public readonly retryable = false;
    public readonly statusCode = 400;

    public constructor(public readonly userMessage: string) {
        super(userMessage);
        this.name = 'PerfilQueryInvalidError';
    }
}
