import 'reflect-metadata';
import FatorVencimentoBoleto from './FatorVencimentoBoleto.js';

const fator = new FatorVencimentoBoleto();

describe('FatorVencimentoBoleto.decodificar', () => {
    it('fator 1000 é o reinício de 22/02/2025 e o seguinte é 23/02/2025', () => {
        expect(fator.decodificar(1000, '2025-03-01')).toEqual({ vencimento: '2025-02-22' });
        expect(fator.decodificar('1001', '2025-03-01')).toEqual({ vencimento: '2025-02-23' });
    });

    it('9999 no fim do ciclo vigente cai em 2049', () => {
        expect(fator.decodificar('9999', '2049-10-01')).toEqual({ vencimento: '2049-10-13' });
    });

    it('fator 0000 é "sem vencimento"', () => {
        expect(fator.decodificar('0000', '2026-10-20')).toEqual({ semVencimento: true });
        expect(fator.decodificar(0, '2026-10-20')).toEqual({ semVencimento: true });
    });

    it('fator 0999 com referência de 20/02/2025 cai no ciclo anterior ao reinício', () => {
        expect(fator.decodificar('0999', '2025-02-20')).toEqual({ vencimento: '2025-02-21' });
    });

    it('a mesma entrada com referências diferentes escolhe ciclos diferentes, de forma determinística', () => {
        expect(fator.decodificar(5000, '2012-01-01')).toEqual({ vencimento: '2011-06-16' });
        expect(fator.decodificar(5000, '2036-01-01')).toEqual({ vencimento: '2036-02-05' });
        expect(fator.decodificar(5000, '2012-01-01')).toEqual(
            fator.decodificar(5000, '2012-01-01'),
        );
    });

    it('entrada inválida devolve undefined', () => {
        expect(fator.decodificar(Number.NaN, '2026-10-20')).toBeUndefined();
        expect(fator.decodificar('12345', '2026-10-20')).toBeUndefined();
        expect(fator.decodificar('abcd', '2026-10-20')).toBeUndefined();
        expect(fator.decodificar(-1, '2026-10-20')).toBeUndefined();
        expect(fator.decodificar(10_000, '2026-10-20')).toBeUndefined();
        expect(fator.decodificar(1000, 'não-é-data')).toBeUndefined();
    });

    it('referência fora de qualquer ciclo plausível devolve undefined', () => {
        expect(fator.decodificar(1000, '2200-01-01')).toBeUndefined();
    });

    it('não consulta o relógio', () => {
        const antes = fator.decodificar('1580', '2026-10-20');
        jest.useFakeTimers().setSystemTime(new Date('2099-01-01T00:00:00Z'));
        try {
            expect(fator.decodificar('1580', '2026-10-20')).toEqual(antes);
        } finally {
            jest.useRealTimers();
        }
        expect(antes).toEqual({ vencimento: '2026-09-25' });
    });
});
