import 'reflect-metadata';
import MetricasCicloRepository from './MetricasCicloRepository.js';

const row = (over: Record<string, unknown> = {}) => ({
    frente: 'Permutas (Frente I)',
    metrica: 'permutas_valor_baixado',
    rotulo: 'valor baixado em permutas de adiantamento',
    valor: '1283986.92',
    unidade: 'R$',
    janela_inicio: '2026-09-11T20:00:00',
    janela_fim: '2026-09-18T20:00:00',
    baseline: null,
    baseline_desc: 'sem medição do processo manual',
    ...over,
});

describe('MetricasCicloRepository', () => {
    it('converte `numeric` do driver em número e mantém baseline nulo como null', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([row()]) };

        const linhas = await new MetricasCicloRepository(db as never).listar({});

        expect(linhas[0].valor).toBe(1283986.92);
        expect(linhas[0].baseline).toBeNull();
    });

    it('filtra por parâmetro nomeado, com null quando o limite não veio', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([]) };

        await new MetricasCicloRepository(db as never).listar({ fim: '2026-09-18T23:59:59' });

        const [sql, params] = db.selectMany.mock.calls[0];
        expect(sql).toMatch(/FROM metricas\.vw_metricas_ciclo/);
        expect(sql).toMatch(/\$inicio::timestamp IS NULL/);
        expect(params).toEqual({ inicio: null, fim: '2026-09-18T23:59:59' });
    });

    it('linha fora do contrato falha alto em vez de chegar torta à tela', async () => {
        const db = { selectMany: jest.fn().mockResolvedValue([row({ valor: 'abc' })]) };

        await expect(new MetricasCicloRepository(db as never).listar({})).rejects.toThrow();
    });

    it('lê o início da série da função da migration', async () => {
        const db = {
            selectFirst: jest.fn().mockResolvedValue({ serie_inicio: '2026-09-11T20:00:00' }),
        };

        await expect(new MetricasCicloRepository(db as never).serieInicio()).resolves.toBe(
            '2026-09-11T20:00:00',
        );
        expect(db.selectFirst.mock.calls[0][0]).toMatch(/metricas\.serie_inicio\(\)/);
    });
});
