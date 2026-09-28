/**
 * O papel `Administrador` não existe: a migration 0066 não foi aplicada neste banco. O
 * `seed-admin` traduz para uma mensagem em português que manda rodar as migrations.
 */
export default class AdminRoleMissingError extends Error {
    constructor() {
        super('Administrador role not found: apply migration 0066 before seeding');
        this.name = 'AdminRoleMissingError';
    }
}
