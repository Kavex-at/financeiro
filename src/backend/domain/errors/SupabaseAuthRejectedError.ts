/**
 * O Supabase Auth (GoTrue) respondeu e RECUSOU: credencial inválida (`invalid_credentials`),
 * usuário banido (`user_banned`), refresh token inválido ou já usado, token do usuário inválido,
 * usuário inexistente na API admin, etc. `code` é o `error_code` do GoTrue, para quem chama
 * distinguir os casos (ex.: banido com `ativo = true` no nosso banco é divergência).
 */
export default class SupabaseAuthRejectedError extends Error {
    public readonly code: string;
    public readonly status: number;

    constructor(code: string, status: number) {
        super(`Supabase Auth recusou a operação (status ${status}, código ${code})`);
        this.name = 'SupabaseAuthRejectedError';
        this.code = code;
        this.status = status;
    }
}
