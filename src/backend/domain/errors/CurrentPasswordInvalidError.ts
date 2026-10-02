/**
 * A senha atual informada na troca da própria senha não confere (ADR-0059): bcrypt local falso, ou
 * o Supabase Auth recusou a sonda. Nada foi gravado. A rota responde 422 `SENHA_ATUAL_INVALIDA`,
 * nunca 401 (401 é "sessão expirada" para o front).
 */
export default class CurrentPasswordInvalidError extends Error {
    constructor() {
        super('A senha atual não confere.');
        this.name = 'CurrentPasswordInvalidError';
    }
}
