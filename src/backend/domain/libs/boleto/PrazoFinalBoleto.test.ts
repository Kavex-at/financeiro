import 'reflect-metadata';
import PrazoFinalBoleto from './PrazoFinalBoleto.js';

describe('PrazoFinalBoleto.calcular (I15h, ADR-0078)', () => {
    it('dia útil bancário é o próprio dia', () => {
        expect(PrazoFinalBoleto.calcular('2026-10-26')).toBe('2026-10-26'); // segunda
        expect(PrazoFinalBoleto.calcular('2026-10-23')).toBe('2026-10-23'); // sexta
    });

    it('sábado e domingo rolam para a segunda útil', () => {
        expect(PrazoFinalBoleto.calcular('2026-10-24')).toBe('2026-10-26');
        expect(PrazoFinalBoleto.calcular('2026-10-25')).toBe('2026-10-26');
    });

    it('feriado nacional rola para o próximo dia útil', () => {
        // 12/10/2026 é segunda (Nossa Senhora Aparecida) ⇒ terça 13/10.
        expect(PrazoFinalBoleto.calcular('2026-10-12')).toBe('2026-10-13');
        // Sexta-feira Santa 2026 (03/04) ⇒ segunda 06/04.
        expect(PrazoFinalBoleto.calcular('2026-04-03')).toBe('2026-04-06');
    });

    it('feriado colado em fim de semana rola até o dia útil', () => {
        // 02/11/2025 é domingo (Finados) ⇒ segunda 03/11.
        expect(PrazoFinalBoleto.calcular('2025-11-02')).toBe('2025-11-03');
    });

    it('data inválida devolve undefined (nunca lança)', () => {
        expect(PrazoFinalBoleto.calcular('')).toBeUndefined();
        expect(PrazoFinalBoleto.calcular('2026-02-30')).toBeUndefined();
        expect(PrazoFinalBoleto.calcular('amanhã')).toBeUndefined();
    });
});
