import ValorAbertoLiquido, { type ValoresAbertoTitulo } from './ValorAbertoLiquido.js';

const titulo = (over: Partial<ValoresAbertoTitulo> = {}): ValoresAbertoTitulo => ({
    totalLiquido: 1028.8,
    totalPago: 0,
    totalAberto: 1028.8,
    titMnyJuros: 0,
    titMnyDesconto: 0,
    ...over,
});

describe('ValorAbertoLiquido (I17b emendada, ADR-0073)', () => {
    it('título sem juros/desconto/pagamento: líquido aberto = totalAberto (regressão)', () => {
        expect(ValorAbertoLiquido.calcularCentavos(titulo())).toBe(102880);
    });

    it('HML 536/2: base 53,53 + juros 0,01 ⇒ líquido 53,54 (as duas fórmulas batem)', () => {
        const v = titulo({
            totalLiquido: 53.54,
            totalAberto: 53.53,
            titMnyJuros: 0.01,
        });
        expect(ValorAbertoLiquido.calcularCentavos(v)).toBe(5354);
    });

    it('HML 540/2: base 178,78 − desconto 0,01 ⇒ líquido 178,77', () => {
        const v = titulo({
            totalLiquido: 178.77,
            totalAberto: 178.78,
            titMnyDesconto: 0.01,
        });
        expect(ValorAbertoLiquido.calcularCentavos(v)).toBe(17877);
    });

    it('pagamento parcial: o totalLiquido do fin064 JÁ desconta o pago (PRD 2026-10-20, 15/15)', () => {
        const v = titulo({ totalLiquido: 60, totalPago: 40, totalAberto: 60 });
        expect(ValorAbertoLiquido.calcularCentavos(v)).toBe(6000);
    });

    it('pagamento parcial com líquido bruto do pago ⇒ diverge do aberto ⇒ indisponível', () => {
        const v = titulo({ totalLiquido: 100, totalPago: 40, totalAberto: 60 });
        expect(ValorAbertoLiquido.calcularCentavos(v)).toBeUndefined();
    });

    it('fórmulas divergentes ⇒ indisponível (fail-closed)', () => {
        const v = titulo({ totalLiquido: 53.54, totalAberto: 53.53 });
        expect(ValorAbertoLiquido.calcularCentavos(v)).toBeUndefined();
    });

    it.each([
        'totalLiquido',
        'totalAberto',
        'titMnyJuros',
        'titMnyDesconto',
    ] as const)('campo %s ausente ou não finito ⇒ indisponível', (campo) => {
        const { [campo]: _x, ...sem } = titulo();
        expect(ValorAbertoLiquido.calcularCentavos(sem)).toBeUndefined();
        expect(
            ValorAbertoLiquido.calcularCentavos(titulo({ [campo]: Number.NaN })),
        ).toBeUndefined();
        expect(
            ValorAbertoLiquido.calcularCentavos(titulo({ [campo]: Number.POSITIVE_INFINITY })),
        ).toBeUndefined();
    });

    it('sem valores ⇒ indisponível; líquido negativo ⇒ indisponível', () => {
        expect(ValorAbertoLiquido.calcularCentavos(undefined)).toBeUndefined();
        expect(
            ValorAbertoLiquido.calcularCentavos(titulo({ totalLiquido: -5, totalAberto: -5 })),
        ).toBeUndefined();
    });

    it('`bate` usa a mesma régua e compara em centavos', () => {
        const spy = jest.spyOn(ValorAbertoLiquido, 'calcularCentavos');
        const v = titulo({ totalLiquido: 53.54, totalAberto: 53.53, titMnyJuros: 0.01 });
        expect(ValorAbertoLiquido.bate(v, 5354)).toBe(true);
        expect(ValorAbertoLiquido.bate(v, 5353)).toBe(false);
        expect(ValorAbertoLiquido.bate(undefined, 5354)).toBe(false);
        expect(spy).toHaveBeenCalledTimes(3);
        spy.mockRestore();
    });

    it('`daLinhaFin064`: juros/desconto nulos viram 0; chave ausente ou lixo seguem ausentes', () => {
        expect(
            ValorAbertoLiquido.daLinhaFin064({
                totalLiquido: 53.54,
                totalPago: 0,
                totalAberto: '53.53',
                titMnyJuros: 0.01,
                titMnyDesconto: null,
            }),
        ).toEqual({
            totalLiquido: 53.54,
            totalPago: 0,
            totalAberto: 53.53,
            titMnyJuros: 0.01,
            titMnyDesconto: 0,
        });
        expect(ValorAbertoLiquido.daLinhaFin064({ totalLiquido: 'x', totalPago: null })).toEqual(
            {},
        );
    });

    it('`semAcrescimos` monta a tupla coerente de um título sem juros/desconto/pagamento', () => {
        expect(ValorAbertoLiquido.semAcrescimos(462.49)).toEqual({
            totalLiquido: 462.49,
            totalPago: 0,
            totalAberto: 462.49,
            titMnyJuros: 0,
            titMnyDesconto: 0,
        });
        expect(ValorAbertoLiquido.semAcrescimos(undefined)).toBeUndefined();
    });
});
