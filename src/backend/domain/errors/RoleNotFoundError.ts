/**
 * O papel pedido não existe (ADR-0053). Distinto de "usuário não encontrado": o route traduz para
 * 404 `'Papel não encontrado.'`.
 */
export default class RoleNotFoundError extends Error {
    constructor(roleId: number) {
        super(`NOT_FOUND: role ${roleId} not found`);
        this.name = 'RoleNotFoundError';
    }
}
