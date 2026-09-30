/**
 * Reativar um usuário que nunca foi para o Supabase Auth exige criá-lo lá, e o Supabase só aceita
 * login por e-mail. Sem e-mail cadastrado, a reativação é recusada (400) e nada muda (ADR-0056).
 */
export default class ReactivationRequiresEmailError extends Error {
    constructor(userId: number) {
        super(`user ${userId} has no email; cannot create the Supabase Auth login on reactivation`);
        this.name = 'ReactivationRequiresEmailError';
    }
}
