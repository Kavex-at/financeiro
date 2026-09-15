import ToleranciaResiduo from './ToleranciaResiduo.js';

/**
 * ADR-0046 D1 — tolerância absoluta de R$ 1,00 (BRL) na elegibilidade do ADIANTAMENTO.
 * Mesmo teto da âncora I-Write-6 (ADR-0020). Comparação em centavos, para que o ruído de
 * ponto flutuante nunca mude o veredito na fronteira.
 */
describe('ToleranciaResiduo (ADR-0046 D1)', () => {
    it('LIMITE_BRL é R$ 1,00', () => {
        expect(ToleranciaResiduo.LIMITE_BRL).toBe(1);
    });

    describe('semSaldoPermutar (Gate 2 reprova quando saldo ≤ R$ 1,00)', () => {
        it.each([
            [0, true],
            [0.1, true],
            [1.0, true],
            [1.01, false],
            [1000, false],
        ])('valorPermutar=%p → %p', (valor, esperado) => {
            expect(ToleranciaResiduo.semSaldoPermutar(valor)).toBe(esperado);
        });

        it('valorPermutar ausente → sem saldo (conservador, igual ao `?? 0` de antes)', () => {
            expect(ToleranciaResiduo.semSaldoPermutar(undefined)).toBe(true);
        });

        it('ruído de float não muda o veredito na fronteira', () => {
            expect(ToleranciaResiduo.semSaldoPermutar(0.1 + 0.2)).toBe(true);
            expect(ToleranciaResiduo.semSaldoPermutar(1.0000000001)).toBe(true);
            expect(ToleranciaResiduo.semSaldoPermutar(0.7 + 0.1 + 0.2)).toBe(true);
            expect(ToleranciaResiduo.semSaldoPermutar(1.0099999999)).toBe(false);
        });
    });

    describe('adiantamentoTotalmentePago (Gate 3 passa quando em aberto ≤ R$ 1,00)', () => {
        it('doc 8721: em aberto R$ 0,02 → pago', () => {
            expect(ToleranciaResiduo.adiantamentoTotalmentePago({ valorAberto: 0.02 })).toBe(true);
        });

        it('fronteira: R$ 1,00 → pago; R$ 1,01 → não pago', () => {
            expect(ToleranciaResiduo.adiantamentoTotalmentePago({ valorAberto: 1.0 })).toBe(true);
            expect(ToleranciaResiduo.adiantamentoTotalmentePago({ valorAberto: 1.01 })).toBe(false);
        });

        it('doc 3754: resíduo real de R$ 21,01 → não pago', () => {
            expect(ToleranciaResiduo.adiantamentoTotalmentePago({ valorAberto: 21.01 })).toBe(
                false,
            );
        });

        it('sem prova (nem valorAberto nem pago) → não pago (nunca infere pago)', () => {
            expect(ToleranciaResiduo.adiantamentoTotalmentePago({})).toBe(false);
        });

        it('sem valorAberto, cai no `pago` do wire', () => {
            expect(ToleranciaResiduo.adiantamentoTotalmentePago({ pago: true })).toBe(true);
            expect(ToleranciaResiduo.adiantamentoTotalmentePago({ pago: false })).toBe(false);
        });

        it('valorAberto vence o `pago` estrito do wire (0,02 ⇒ wire diz false)', () => {
            expect(
                ToleranciaResiduo.adiantamentoTotalmentePago({ pago: false, valorAberto: 0.02 }),
            ).toBe(true);
        });

        it('ruído de float não muda o veredito na fronteira', () => {
            expect(
                ToleranciaResiduo.adiantamentoTotalmentePago({ valorAberto: 1.0000000001 }),
            ).toBe(true);
            expect(ToleranciaResiduo.adiantamentoTotalmentePago({ valorAberto: 0.1 + 0.2 })).toBe(
                true,
            );
        });
    });
});
