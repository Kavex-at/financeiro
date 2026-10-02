import type { PasswordRule } from '../interface/auth/PasswordPolicy.js';

/**
 * A senha nova não atende à política (ADR-0059). Lançado ANTES de qualquer bcrypt ou chamada ao
 * Supabase Auth. `regras` são os ids que o front conhece (`tamanho`, `diferente_da_atual`); a rota
 * responde 400 `{ codigo: 'POLITICA', regras, error }`.
 */
export default class PasswordPolicyError extends Error {
    public readonly regras: PasswordRule[];

    constructor(regras: PasswordRule[]) {
        super(`A senha nova não atende à política: ${regras.join(', ')}.`);
        this.name = 'PasswordPolicyError';
        this.regras = regras;
    }
}
