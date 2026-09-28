/**
 * Desativar o alvo deixaria a plataforma sem nenhum admin ativo (R11, ADR-0051). O route traduz
 * para 409.
 */
export default class LastActiveAdminError extends Error {
    constructor() {
        super('CONFLICT: cannot deactivate the last active admin');
        this.name = 'LastActiveAdminError';
    }
}
