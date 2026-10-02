import 'reflect-metadata';
import PasswordPolicy, { PASSWORD_RULE } from './PasswordPolicy.js';

const policy = new PasswordPolicy();
const ATUAL = 'Senha-atual-1';

describe('PasswordPolicy (ADR-0059)', () => {
    it('descrever: { minimo: 8, maximo: 72, regras: [] } — o front desenha tamanho e "diferente" sozinho', () => {
        expect(policy.descrever()).toEqual({ minimo: 8, maximo: 72, regras: [] });
        expect(PasswordPolicy.MINIMO).toBe(8);
        expect(PasswordPolicy.MAXIMO_BYTES).toBe(72);
    });

    it('nova válida e diferente da atual: nenhuma violação', () => {
        expect(policy.violacoes('Nova-senha-22', ATUAL)).toEqual([]);
    });

    it('7 caracteres → tamanho', () => {
        expect(policy.violacoes('abcdefg', ATUAL)).toEqual([PASSWORD_RULE.TAMANHO]);
    });

    it('8 caracteres → aceita (mínimo em caracteres)', () => {
        expect(policy.violacoes('abcdefgh', ATUAL)).toEqual([]);
    });

    it("'a' × 72 → aceita; 'a' × 73 → tamanho", () => {
        expect(policy.violacoes('a'.repeat(72), ATUAL)).toEqual([]);
        expect(policy.violacoes('a'.repeat(73), ATUAL)).toEqual([PASSWORD_RULE.TAMANHO]);
    });

    it("'ç' × 40 (40 caracteres, 80 bytes UTF-8) → tamanho: o máximo é em BYTES (bcrypt)", () => {
        const nova = 'ç'.repeat(40);
        expect(nova.length).toBe(40);
        expect(Buffer.byteLength(nova, 'utf8')).toBe(80);
        expect(policy.violacoes(nova, ATUAL)).toEqual([PASSWORD_RULE.TAMANHO]);
    });

    it('nova === atual → diferente_da_atual (id do contrato com o front)', () => {
        expect(PASSWORD_RULE.DIFERENTE_DA_ATUAL).toBe('diferente_da_atual');
        expect(policy.violacoes(ATUAL, ATUAL)).toEqual(['diferente_da_atual']);
    });

    it('curta E igual à atual: as duas violações', () => {
        expect(policy.violacoes('abc', 'abc')).toEqual(['tamanho', 'diferente_da_atual']);
    });
});
