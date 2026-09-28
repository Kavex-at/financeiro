/**
 * O valor já identifica OUTRO usuário — como `email` ou como `username`, sem distinção de caixa.
 * O route traduz para 409. Sem essa recusa, o login por "e-mail ou usuário" poderia casar duas
 * linhas (I3, ADR-0051).
 */
export default class EmailAlreadyInUseError extends Error {
    constructor(email: string) {
        super(`CONFLICT: ${email} already identifies another user`);
        this.name = 'EmailAlreadyInUseError';
    }
}
