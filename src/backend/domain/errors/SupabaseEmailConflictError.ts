/**
 * O e-mail já pertence a outro usuário no Supabase Auth (GoTrue 422 `email_exists`). Quem cria
 * decide se vincula (usuário do GoTrue sem `app_user`) ou recusa com 409 (vinculado a outro).
 */
export default class SupabaseEmailConflictError extends Error {
    constructor() {
        super('Supabase Auth: o e-mail já está em uso por outro usuário');
        this.name = 'SupabaseEmailConflictError';
    }
}
