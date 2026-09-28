/** Um admin tentou desativar o próprio acesso (R11, ADR-0051). O route traduz para 409. */
export default class SelfDeactivationError extends Error {
    constructor() {
        super('CONFLICT: a user cannot deactivate their own access');
        this.name = 'SelfDeactivationError';
    }
}
