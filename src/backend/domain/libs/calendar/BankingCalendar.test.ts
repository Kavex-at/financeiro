import 'reflect-metadata';
import BankingCalendar from './BankingCalendar.js';

const cal = new BankingCalendar();

describe('BankingCalendar', () => {
    describe('easter', () => {
        it.each([
            [2024, '2024-03-31'],
            [2025, '2025-04-20'],
            [2026, '2026-04-05'],
            [2027, '2027-03-28'],
        ])('Páscoa de %i = %s', (year, expected) => {
            expect(cal.easter(year)).toBe(expected);
        });
    });

    describe('feriados móveis', () => {
        it.each([
            '2026-02-16',
            '2026-02-17',
            '2026-04-03',
            '2026-06-04',
            '2025-03-03',
            '2025-03-04',
            '2025-04-18',
            '2025-06-19',
        ])('%s não é dia útil', (d) => {
            expect(cal.isBusinessDay(d)).toBe(false);
        });

        it('Quarta-feira de Cinzas (2026-02-18) é dia útil', () => {
            expect(cal.isBusinessDay('2026-02-18')).toBe(true);
        });
    });

    describe('feriados fixos', () => {
        it.each([
            '2026-01-01',
            '2026-04-21',
            '2026-05-01',
            '2026-09-07',
            '2026-10-12',
            '2026-11-02',
            '2026-11-15',
            '2026-11-20',
            '2026-12-25',
        ])('%s não é dia útil', (d) => {
            expect(cal.isBusinessDay(d)).toBe(false);
        });

        it('20/11 só vale a partir de 2024 (Lei 14.759/2023)', () => {
            expect(cal.isBusinessDay('2023-11-20')).toBe(true);
            expect(cal.isBusinessDay('2024-11-20')).toBe(false);
        });

        it('holidays(2026) inclui fixos e móveis', () => {
            const h = cal.holidays(2026);
            expect(h).toContain('2026-11-20');
            expect(h).toContain('2026-02-17');
            expect(h).not.toContain('2026-02-18');
        });
    });

    describe('fim de semana', () => {
        it('sábado e domingo não são dias úteis; terça comum é', () => {
            expect(cal.isBusinessDay('2026-09-26')).toBe(false);
            expect(cal.isBusinessDay('2026-09-27')).toBe(false);
            expect(cal.isBusinessDay('2026-09-22')).toBe(true);
        });
    });

    describe('nextBusinessDay', () => {
        it('sexta → segunda', () => {
            expect(cal.nextBusinessDay('2026-09-25')).toBe('2026-09-28');
        });
        it('pula fim de semana e Carnaval', () => {
            expect(cal.nextBusinessDay('2026-02-13')).toBe('2026-02-18');
        });
    });

    describe('addDays', () => {
        it('atravessa mês e ano', () => {
            expect(cal.addDays('2026-12-31', 1)).toBe('2027-01-01');
            expect(cal.addDays('2026-03-01', -1)).toBe('2026-02-28');
        });
    });

    describe('todayBrt', () => {
        it('23:30 de Brasília ainda é o mesmo dia (02:30Z do dia seguinte)', () => {
            const c = BankingCalendar.withClock(() => new Date('2026-09-22T02:30:00Z'));
            expect(c.todayBrt()).toBe('2026-09-21');
        });
        it('meia-noite de Brasília vira o dia (03:00Z)', () => {
            const c = BankingCalendar.withClock(() => new Date('2026-09-22T03:00:00Z'));
            expect(c.todayBrt()).toBe('2026-09-22');
        });
    });

    describe('codificação do ERP', () => {
        it('toErpEpoch usa meia-noite UTC do dia civil (mesmo encoding do antigo hojeUtc)', () => {
            expect(cal.toErpEpoch('2026-09-22')).toBe(Date.UTC(2026, 8, 22));
        });
        it('fromErpEpoch lê o dia pelo relógio UTC (00:00Z e 15:00Z caem no mesmo dia)', () => {
            expect(cal.fromErpEpoch(Date.UTC(2026, 8, 29))).toBe('2026-09-29');
            expect(cal.fromErpEpoch(Date.UTC(2026, 8, 29, 15))).toBe('2026-09-29');
        });
    });

    describe('datas malformadas', () => {
        it.each(['2026-02-30', '22/09/2026', '2026-9-22', ''])('%s é recusada', (d) => {
            expect(cal.isValidCivilDate(d)).toBe(false);
            expect(() => cal.isBusinessDay(d)).toThrow();
            expect(() => cal.toErpEpoch(d)).toThrow();
        });
        it('data válida é aceita', () => {
            expect(cal.isValidCivilDate('2024-02-29')).toBe(true);
        });
    });
});
