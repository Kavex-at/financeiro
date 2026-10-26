import 'reflect-metadata';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import HmlDataDivergenteCasos from './hmlDataDivergenteCasos.js';

// Segunda-feira, 26/10/2026 (meio-dia BRT).
const calendar = BankingCalendar.withClock(() => new Date('2026-10-26T15:00:00Z'));
const HOJE = '2026-10-26';

describe('HmlDataDivergenteCasos', () => {
    describe('casosV10', () => {
        it('gera um caso por Δ, com a barra em título + Δ', () => {
            const casos = HmlDataDivergenteCasos.casosV10(calendar, HOJE);
            expect(casos.map((c) => c.delta)).toEqual([-5, -2, -1, 0, 6, 10]);
            for (const c of casos) {
                expect(calendar.addDays(c.tituloVenc, c.delta)).toBe(c.barraVenc);
            }
        });

        it('usa ids estáveis e únicos', () => {
            const ids = HmlDataDivergenteCasos.casosV10(calendar, HOJE).map((c) => c.id);
            expect(new Set(ids).size).toBe(ids.length);
            expect(ids).toContain('V10m2');
            expect(ids).toContain('V10p6');
        });
    });

    describe('lotes', () => {
        const lotes = HmlDataDivergenteCasos.lotes(calendar, HOJE);

        it('planeja três lotes e só o L-J gera remessa', () => {
            expect(lotes.map((l) => l.id)).toEqual(['L-J', 'L-R2', 'L-ROLAGEM']);
            expect(lotes.filter((l) => l.gerarRemessa).map((l) => l.id)).toEqual(['L-J']);
        });

        it('mantém débito e barras em dia útil nos lotes L-J e L-R2', () => {
            for (const l of lotes.filter((x) => x.id !== 'L-ROLAGEM')) {
                expect(calendar.isBusinessDay(l.debito)).toBe(true);
                for (const i of l.itens) expect(calendar.isBusinessDay(i.barraVenc)).toBe(true);
            }
        });

        it('L-J: o débito vem antes das duas barras (finalizar deve passar)', () => {
            const j = lotes.find((l) => l.id === 'L-J');
            for (const i of j?.itens ?? []) expect(i.barraVenc > (j?.debito ?? '')).toBe(true);
        });

        it('L-R2: a barra vence ANTES do débito (provoca a R2)', () => {
            const r2 = lotes.find((l) => l.id === 'L-R2');
            expect((r2?.itens[0]?.barraVenc ?? '') < (r2?.debito ?? '')).toBe(true);
        });

        it('L-ROLAGEM: a barra é um sábado e o débito é o dia útil seguinte', () => {
            const rol = lotes.find((l) => l.id === 'L-ROLAGEM');
            const sab = rol?.itens[0]?.barraVenc ?? '';
            expect(new Date(`${sab}T00:00:00Z`).getUTCDay()).toBe(6);
            expect(rol?.debito).toBe(calendar.nextBusinessDay(sab));
        });
    });

    describe('fonteDaData', () => {
        const ref = { titulo: '2025-12-02', barra: '2026-10-29', item: '2026-10-30' };

        it('reconhece a barra, o título e o item, nessa ordem', () => {
            expect(HmlDataDivergenteCasos.fonteDaData('2026-10-29', ref)).toBe('barra');
            expect(HmlDataDivergenteCasos.fonteDaData('2025-12-02', ref)).toBe('titulo');
            expect(HmlDataDivergenteCasos.fonteDaData('2026-10-30', ref)).toBe('item');
        });

        it('devolve "outra" quando não bate com nenhuma referência', () => {
            expect(HmlDataDivergenteCasos.fonteDaData('2026-11-11', ref)).toBe('outra');
        });

        it('prefere "barra" quando barra e título coincidem (não conclui por acaso)', () => {
            expect(
                HmlDataDivergenteCasos.fonteDaData('2026-10-29', {
                    titulo: '2026-10-29',
                    barra: '2026-10-29',
                }),
            ).toBe('barra');
        });
    });

    describe('mascarar', () => {
        it('mostra só 5+4 dígitos de um código de 44', () => {
            const barras = '34191234567890123456789012345678901234567890';
            const nome = '3419123456789012345678901234567890123456789012';
            expect(HmlDataDivergenteCasos.mascarar(barras)).toBe(
                `${barras.slice(0, 5)}…${barras.slice(-4)}`,
            );
            expect(HmlDataDivergenteCasos.mascarar(nome)).not.toContain('67890123456');
        });

        it('trata curto e vazio sem vazar dígitos', () => {
            expect(HmlDataDivergenteCasos.mascarar('12345')).toBe('(curto)');
            expect(HmlDataDivergenteCasos.mascarar(undefined)).toBe('');
        });
    });
});
