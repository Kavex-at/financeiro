import 'reflect-metadata';
import type { DestinoManual } from '../../interface/sispag/SispagInterface.js';
import DestinoAprovacaoRule from './DestinoAprovacaoRule.js';

const CONTA: DestinoManual = {
    tipo: 'CONTA',
    bancoCod: '237',
    agencia: '1234',
    conta: '99887766',
    contaDv: '1',
    titularDocumento: '11144477735',
};
const CHAVE_CPF: DestinoManual = {
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'CPF_CNPJ',
    chavePix: '11144477735',
    titularDocumento: '11144477735',
};
const LIGADAS = { ted: true, destinoManual: true };

describe('DestinoAprovacaoRule (ADR-0054 D10/D11)', () => {
    const rule = new DestinoAprovacaoRule();

    it('conta digitada exige aprovação; chave PIX CPF/CNPJ não (D11)', () => {
        expect(rule.exige(CONTA)).toBe(true);
        expect(rule.exige(CHAVE_CPF)).toBe(false);
    });

    it('estado: sem destino → undefined; conta sem aprovador → PENDENTE; com → APROVADO', () => {
        expect(rule.estado({})).toBeUndefined();
        expect(rule.estado({ destinoManual: CONTA })).toBe('PENDENTE');
        expect(rule.estado({ destinoManual: CONTA, destinoManualAprovadoPor: 'bia' })).toBe(
            'APROVADO',
        );
        expect(rule.estado({ destinoManual: CHAVE_CPF })).toBe('NAO_EXIGIDA');
    });

    it('bloqueia só a conta pendente que VALE (item TED, flags manual + TED)', () => {
        const pendente = { modalidade: 'TED' as const, destinoManual: CONTA };
        expect(rule.bloqueia(pendente, LIGADAS)).toBe(true);
        expect(rule.bloqueia({ ...pendente, destinoManualAprovadoPor: 'bia' }, LIGADAS)).toBe(
            false,
        );
        // Flags desligadas: o destino digitado é ignorado pelo resolver — nada a aprovar.
        expect(rule.bloqueia(pendente, { ted: false, destinoManual: true })).toBe(false);
        expect(rule.bloqueia(pendente, { ted: true, destinoManual: false })).toBe(false);
        // Conta digitada em item que não é TED não sai como destino.
        expect(rule.bloqueia({ ...pendente, modalidade: 'BOLETO' as const }, LIGADAS)).toBe(false);
        expect(
            rule.bloqueia({ modalidade: 'PIX' as const, destinoManual: CHAVE_CPF }, LIGADAS),
        ).toBe(false);
    });
});
