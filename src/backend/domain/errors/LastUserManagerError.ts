/**
 * A mudança de acesso deixaria a plataforma sem nenhum usuário ativo com `usuarios:gerenciar`
 * efetivo (R9/R-extra, ADR-0053). Substitui o `LastActiveAdminError` do passo 1, que olhava
 * `role = 'admin'`. O route traduz para 409.
 */
export default class LastUserManagerError extends Error {
    constructor() {
        super('CONFLICT: cannot remove the last active user with usuarios:gerenciar');
        this.name = 'LastUserManagerError';
    }
}
