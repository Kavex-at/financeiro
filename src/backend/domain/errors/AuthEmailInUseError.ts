/**
 * O e-mail já é o login de OUTRO usuário no Supabase Auth (vinculado a outro `app_user`). A rota
 * responde 409 "Já existe um acesso com este e-mail." e nada muda (ADR-0057).
 */
export default class AuthEmailInUseError extends Error {
    constructor() {
        super('CONFLICT: the email already belongs to another Supabase Auth login');
        this.name = 'AuthEmailInUseError';
    }
}
