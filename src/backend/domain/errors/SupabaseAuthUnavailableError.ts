/** Por que o Supabase Auth não pôde responder. */
export type SupabaseAuthUnavailableReason =
    | 'not_configured'
    | 'unreachable'
    | 'timeout'
    | 'server_error'
    | 'rate_limited'
    | 'bad_response';

/**
 * O Supabase Auth (GoTrue) não respondeu de forma utilizável: fora do ar, 5xx, timeout, limite de
 * taxa (429), resposta 2xx fora do formato, ou o backend sem configuração do Supabase.
 *
 * Quem chama decide o HTTP: login → 503 (ou 429 quando `rateLimited`); escrita de credencial →
 * rollback + 503 (R6). A mensagem é para o log do operador, em português, e nunca carrega chave,
 * token ou corpo da resposta.
 */
export default class SupabaseAuthUnavailableError extends Error {
    public readonly reason: SupabaseAuthUnavailableReason;
    public readonly status?: number;
    /** `true` só para o 429 do GoTrue. */
    public readonly rateLimited: boolean;
    /** Repetir pode resolver? Não para 429 (repetir piora) nem para falta de configuração. */
    public readonly retryable: boolean;

    constructor(message: string, reason: SupabaseAuthUnavailableReason, status?: number) {
        super(message);
        this.name = 'SupabaseAuthUnavailableError';
        this.reason = reason;
        this.status = status;
        this.rateLimited = reason === 'rate_limited';
        this.retryable = reason !== 'rate_limited' && reason !== 'not_configured';
    }
}
