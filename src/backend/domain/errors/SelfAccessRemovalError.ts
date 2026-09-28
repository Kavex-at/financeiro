/**
 * O chamador tentou tirar de si mesmo a `usuarios:gerenciar` (troca de papel ou exceção), R-extra
 * da ADR-0053. O route traduz para 409.
 */
export default class SelfAccessRemovalError extends Error {
    constructor() {
        super('CONFLICT: a user cannot remove their own usuarios:gerenciar');
        this.name = 'SelfAccessRemovalError';
    }
}
