import 'reflect-metadata';
import type { MetricaCiclo } from '../../interface/metricas/MetricaCiclo.js';
import MetricasCicloService from './MetricasCicloService.js';

const linha: MetricaCiclo = {
    frente: 'Permutas (Frente I)',
    metrica: 'permutas_valor_baixado',
    rotulo: 'valor baixado em permutas de adiantamento',
    valor: 1283986.92,
    unidade: 'R$',
    janela_inicio: '2026-09-11T20:00:00',
    janela_fim: '2026-09-18T20:00:00',
    baseline: null,
    baseline_desc: 'sem medição do processo manual',
};

const montar = () => {
    const repository = {
        listar: jest.fn().mockResolvedValue([linha]),
        serieInicio: jest.fn().mockResolvedValue('2026-09-11T20:00:00'),
    };
    return { repository, service: new MetricasCicloService(repository as never) };
};

describe('MetricasCicloService.ler', () => {
    it('devolve a série vigente junto das linhas', async () => {
        const { service } = montar();

        await expect(service.ler({})).resolves.toEqual({
            serieInicio: '2026-09-11T20:00:00',
            metricas: [linha],
        });
    });

    it('sem filtro, não inventa limite', async () => {
        const { repository, service } = montar();

        await service.ler({});

        expect(repository.listar).toHaveBeenCalledWith({});
    });

    it('`fim` só com data cobre o dia inteiro — a janela que fecha às 20:00 não some (gap K1)', async () => {
        const { repository, service } = montar();

        await service.ler({ inicio: '2026-09-11', fim: '2026-09-18' });

        expect(repository.listar).toHaveBeenCalledWith({
            inicio: '2026-09-11T00:00:00',
            fim: '2026-09-18T23:59:59',
        });
    });

    it('completa os segundos e preserva hora explícita', async () => {
        const { repository, service } = montar();

        await service.ler({ inicio: '2026-09-11T20:00', fim: '2026-09-18T20:00:00' });

        expect(repository.listar).toHaveBeenCalledWith({
            inicio: '2026-09-11T20:00:00',
            fim: '2026-09-18T20:00:00',
        });
    });
});
