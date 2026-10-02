import { injectable } from 'tsyringe';
import {
    PASSWORD_RULE,
    type PasswordPolicyDescription,
    type PasswordRule,
} from '../../interface/auth/PasswordPolicy.js';

export { PASSWORD_RULE, type PasswordPolicyDescription, type PasswordRule };

/**
 * PasswordPolicy — a política da troca da própria senha (ADR-0059).
 *
 * - Mínimo de 8 CARACTERES (o mesmo do cadastro e do reset do admin).
 * - Máximo de 72 BYTES UTF-8: o bcrypt ignora o que passa disso, e o GoTrue recusa. O front mede
 *   caracteres; uma senha não-ASCII entre 72 caracteres e 72 bytes volta 400 aqui (aceito).
 * - A nova não pode ser igual à atual.
 *
 * `descrever()` devolve `regras: []`: tamanho sai de `minimo`/`maximo` e "diferente da atual" o
 * front desenha sozinho; repetir aqui duplicaria os itens do checklist.
 */
@injectable()
export default class PasswordPolicy {
    public static readonly MINIMO = 8;
    public static readonly MAXIMO_BYTES = 72;

    public descrever = (): PasswordPolicyDescription => ({
        minimo: PasswordPolicy.MINIMO,
        maximo: PasswordPolicy.MAXIMO_BYTES,
        regras: [],
    });

    /** As regras que `nova` viola, na ordem do contrato. Vazio = aceita. */
    public violacoes = (nova: string, atual: string): PasswordRule[] => {
        const regras: PasswordRule[] = [];
        if (
            nova.length < PasswordPolicy.MINIMO ||
            Buffer.byteLength(nova, 'utf8') > PasswordPolicy.MAXIMO_BYTES
        ) {
            regras.push(PASSWORD_RULE.TAMANHO);
        }
        if (nova === atual) regras.push(PASSWORD_RULE.DIFERENTE_DA_ATUAL);
        return regras;
    };
}
