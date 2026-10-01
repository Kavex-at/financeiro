import 'reflect-metadata';
import PerfilQueryInvalidError from '../../errors/PerfilQueryInvalidError.js';
import type Clock from '../../libs/clock/Clock.js';
import PeriodoPerfil, { ANCORA_SEMANA_UTC_MS, TIPO_PERIODO } from './PeriodoPerfil.js';

/** Horário de São Paulo (UTC-3, sem horário de verão desde 2019) → instante UTC. */
const sp = (local: string): Date => new Date(`${local}-03:00`);

const comRelogio = (agoraSp: string): PeriodoPerfil => {
    const clock = { now: () => sp(agoraSp).getTime() } as Clock;
    return new PeriodoPerfil(clock);
};

const SETE_DIAS_MS = 7 * 24 * 3600 * 1000;

describe('PeriodoPerfil — hoje', () => {
    it('à 00:00:00 SP começa no próprio dia', () => {
        const p = comRelogio('2026-10-01T00:00:00').calcular({ tipo: TIPO_PERIODO.HOJE });
        expect(p.inicio.toISOString()).toBe(sp('2026-10-01T00:00:00').toISOString());
        expect(p.fim.toISOString()).toBe(sp('2026-10-01T00:00:00').toISOString());
    });

    it('às 23:59:59 SP ainda é o mesmo dia (já é o dia seguinte em UTC)', () => {
        const p = comRelogio('2026-10-01T23:59:59').calcular({ tipo: TIPO_PERIODO.HOJE });
        expect(p.inicio.toISOString()).toBe('2026-10-01T03:00:00.000Z');
        expect(p.fim.toISOString()).toBe('2026-10-02T02:59:59.000Z');
    });
});

describe('PeriodoPerfil — semana (grade sexta 18:00 SP de metricas_ciclo)', () => {
    it('a âncora é metricas.serie_inicio() = 2026-09-11 18:00 SP', () => {
        expect(new Date(ANCORA_SEMANA_UTC_MS).toISOString()).toBe(
            sp('2026-09-11T18:00:00').toISOString(),
        );
    });

    it('sexta 17:59:59 SP começa na sexta ANTERIOR 18:00', () => {
        const p = comRelogio('2026-10-02T17:59:59').calcular({ tipo: TIPO_PERIODO.SEMANA });
        expect(p.inicio.toISOString()).toBe(sp('2026-09-25T18:00:00').toISOString());
    });

    it('sexta 18:00:00 SP começa nela mesma', () => {
        const p = comRelogio('2026-10-02T18:00:00').calcular({ tipo: TIPO_PERIODO.SEMANA });
        expect(p.inicio.toISOString()).toBe(sp('2026-10-02T18:00:00').toISOString());
    });

    it('sábado e quinta começam na última sexta 18:00', () => {
        expect(
            comRelogio('2026-10-03T09:00:00')
                .calcular({ tipo: TIPO_PERIODO.SEMANA })
                .inicio.toISOString(),
        ).toBe(sp('2026-10-02T18:00:00').toISOString());
        expect(
            comRelogio('2026-10-01T12:00:00')
                .calcular({ tipo: TIPO_PERIODO.SEMANA })
                .inicio.toISOString(),
        ).toBe(sp('2026-09-25T18:00:00').toISOString());
    });

    it('todo início de semana é âncora + k·7 dias (inclusive antes da âncora)', () => {
        const agoras = [
            '2026-08-07T18:00:00',
            '2026-08-20T03:00:00',
            '2026-09-11T17:00:00',
            '2026-10-01T10:00:00',
            '2027-03-05T18:00:01',
        ];
        for (const agora of agoras) {
            const inicio = comRelogio(agora).calcular({ tipo: TIPO_PERIODO.SEMANA }).inicio;
            const k = (inicio.getTime() - ANCORA_SEMANA_UTC_MS) / SETE_DIAS_MS;
            expect(Number.isInteger(k)).toBe(true);
            expect(inicio.getTime()).toBeLessThanOrEqual(sp(agora).getTime());
            expect(sp(agora).getTime() - inicio.getTime()).toBeLessThan(SETE_DIAS_MS);
        }
    });

    it('fim = agora', () => {
        const p = comRelogio('2026-10-01T12:34:56').calcular({ tipo: TIPO_PERIODO.SEMANA });
        expect(p.fim.toISOString()).toBe(sp('2026-10-01T12:34:56').toISOString());
    });
});

describe('PeriodoPerfil — mês', () => {
    it('no dia 1 00:00 SP começa nele', () => {
        const p = comRelogio('2026-10-01T00:00:00').calcular({ tipo: TIPO_PERIODO.MES });
        expect(p.inicio.toISOString()).toBe(sp('2026-10-01T00:00:00').toISOString());
    });

    it('no dia 31 23:59 SP começa no dia 1 do mesmo mês', () => {
        const p = comRelogio('2026-10-31T23:59:00').calcular({ tipo: TIPO_PERIODO.MES });
        expect(p.inicio.toISOString()).toBe(sp('2026-10-01T00:00:00').toISOString());
        expect(p.fim.toISOString()).toBe(sp('2026-10-31T23:59:00').toISOString());
    });

    it('virada de ano: 31/12 22:00 SP ainda é dezembro; 01/01 00:00 SP já é janeiro', () => {
        expect(
            comRelogio('2026-12-31T22:00:00')
                .calcular({ tipo: TIPO_PERIODO.MES })
                .inicio.toISOString(),
        ).toBe(sp('2026-12-01T00:00:00').toISOString());
        expect(
            comRelogio('2026-12-31T22:00:00')
                .calcular({ tipo: TIPO_PERIODO.HOJE })
                .inicio.toISOString(),
        ).toBe(sp('2026-12-31T00:00:00').toISOString());
        expect(
            comRelogio('2027-01-01T00:00:00')
                .calcular({ tipo: TIPO_PERIODO.MES })
                .inicio.toISOString(),
        ).toBe(sp('2027-01-01T00:00:00').toISOString());
    });
});

describe('PeriodoPerfil — personalizado', () => {
    it('datas locais SP, fim exclusivo no dia seguinte 00:00 SP', () => {
        const p = comRelogio('2026-10-01T12:00:00').calcular({
            tipo: TIPO_PERIODO.PERSONALIZADO,
            inicio: '2026-09-01',
            fim: '2026-09-30',
        });
        expect(p.inicio.toISOString()).toBe(sp('2026-09-01T00:00:00').toISOString());
        expect(p.fim.toISOString()).toBe(sp('2026-10-01T00:00:00').toISOString());
    });

    it('um dia só (inicio = fim) é válido', () => {
        const p = comRelogio('2026-10-01T12:00:00').calcular({
            tipo: TIPO_PERIODO.PERSONALIZADO,
            inicio: '2026-09-15',
            fim: '2026-09-15',
        });
        expect(p.fim.getTime() - p.inicio.getTime()).toBe(24 * 3600 * 1000);
    });

    it('inicio >= fim → erro de validação', () => {
        expect(() =>
            comRelogio('2026-10-01T12:00:00').calcular({
                tipo: TIPO_PERIODO.PERSONALIZADO,
                inicio: '2026-09-16',
                fim: '2026-09-15',
            }),
        ).toThrow(PerfilQueryInvalidError);
    });

    it('intervalo > 366 dias → erro de validação; 366 dias passa', () => {
        const periodo = comRelogio('2026-10-01T12:00:00');
        expect(() =>
            periodo.calcular({
                tipo: TIPO_PERIODO.PERSONALIZADO,
                inicio: '2025-01-01',
                fim: '2026-01-02',
            }),
        ).toThrow(PerfilQueryInvalidError);
        expect(() =>
            periodo.calcular({
                tipo: TIPO_PERIODO.PERSONALIZADO,
                inicio: '2025-01-01',
                fim: '2026-01-01',
            }),
        ).not.toThrow();
    });

    it('sem as duas datas, ou data impossível → erro de validação', () => {
        const periodo = comRelogio('2026-10-01T12:00:00');
        expect(() =>
            periodo.calcular({ tipo: TIPO_PERIODO.PERSONALIZADO, inicio: '2026-09-01' }),
        ).toThrow(PerfilQueryInvalidError);
        expect(() =>
            periodo.calcular({
                tipo: TIPO_PERIODO.PERSONALIZADO,
                inicio: '2026-02-30',
                fim: '2026-03-01',
            }),
        ).toThrow(PerfilQueryInvalidError);
    });
});

describe('PeriodoPerfil — período anterior', () => {
    it('[inicio − (fim − inicio), inicio) para os 4 tipos', () => {
        const periodo = comRelogio('2026-10-01T12:00:00');
        const pedidos = [
            { tipo: TIPO_PERIODO.HOJE },
            { tipo: TIPO_PERIODO.SEMANA },
            { tipo: TIPO_PERIODO.MES },
            { tipo: TIPO_PERIODO.PERSONALIZADO, inicio: '2026-09-01', fim: '2026-09-10' },
        ];
        for (const pedido of pedidos) {
            const atual = periodo.calcular(pedido);
            const anterior = periodo.anterior(atual);
            expect(anterior.fim.getTime()).toBe(atual.inicio.getTime());
            expect(anterior.fim.getTime() - anterior.inicio.getTime()).toBe(
                atual.fim.getTime() - atual.inicio.getTime(),
            );
        }
    });
});

describe('PeriodoPerfil — janela do histórico', () => {
    it('default: últimos 30 dias até agora', () => {
        const j = comRelogio('2026-10-01T12:00:00').janelaHistorico({});
        expect(j.fim.toISOString()).toBe(sp('2026-10-01T12:00:00').toISOString());
        expect(j.fim.getTime() - j.inicio.getTime()).toBe(30 * 24 * 3600 * 1000);
    });

    it('com datas: locais SP, fim exclusivo; invertido → erro', () => {
        const periodo = comRelogio('2026-10-01T12:00:00');
        const j = periodo.janelaHistorico({ inicio: '2026-09-01', fim: '2026-09-02' });
        expect(j.inicio.toISOString()).toBe(sp('2026-09-01T00:00:00').toISOString());
        expect(j.fim.toISOString()).toBe(sp('2026-09-03T00:00:00').toISOString());
        expect(() => periodo.janelaHistorico({ inicio: '2026-09-05', fim: '2026-09-01' })).toThrow(
            PerfilQueryInvalidError,
        );
    });

    it('só inicio: até agora; só fim: 30 dias antes do fim', () => {
        const periodo = comRelogio('2026-10-01T12:00:00');
        expect(periodo.janelaHistorico({ inicio: '2026-09-20' }).fim.toISOString()).toBe(
            sp('2026-10-01T12:00:00').toISOString(),
        );
        const soFim = periodo.janelaHistorico({ fim: '2026-09-10' });
        expect(soFim.fim.toISOString()).toBe(sp('2026-09-11T00:00:00').toISOString());
        expect(soFim.fim.getTime() - soFim.inicio.getTime()).toBe(30 * 24 * 3600 * 1000);
    });
});
