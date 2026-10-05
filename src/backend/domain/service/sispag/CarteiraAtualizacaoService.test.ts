import 'reflect-metadata';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import CarteiraAtualizacaoService from './CarteiraAtualizacaoService.js';
import type IngestaoPagamentosService from './IngestaoPagamentosService.js';

const MIN = 60_000;
const AGORA = Date.parse('2026-10-05T15:00:00.000Z');
const minAtras = (m: number) => new Date(AGORA - m * MIN);

type RunLinha = {
    status: 'running' | 'success' | 'error';
    startedAt: string;
    finishedAt?: string;
    errorMessage?: string;
};

const make = (
    o: {
        ultimoSucesso?: Date | null;
        ultimaRun?: RunLinha;
        executar?: jest.Mock;
        ttlMin?: number;
        cooldownMin?: number;
    } = {},
) => {
    const executar =
        o.executar ??
        jest.fn().mockResolvedValue({
            runId: 'R-NOVA',
            status: 'success',
            totalTitulos: 1398,
            totalInativados: 2,
        });
    const runRepo = {
        findLatestSuccessFinishedAt: jest.fn().mockResolvedValue(o.ultimoSucesso ?? null),
        listRecentRuns: jest.fn().mockResolvedValue(o.ultimaRun ? [o.ultimaRun] : []),
    };
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            sispagCarteiraTtlMin: o.ttlMin ?? 30,
            sispagCarteiraCooldownMin: o.cooldownMin ?? 5,
        }),
    };
    const service = new CarteiraAtualizacaoService(
        { executar } as unknown as IngestaoPagamentosService,
        runRepo as unknown as PagamentoIngestaoRunRepository,
        env as unknown as EnvironmentProvider,
    );
    return { service, executar, runRepo };
};

const pedir = (service: CarteiraAtualizacaoService) =>
    service.atualizarSeDefasada({ triggeredBy: 'abertura:u1', agora: AGORA });

describe('CarteiraAtualizacaoService (ADR-0060)', () => {
    it('fresca: ingestão com menos de 30 min NÃO roda e devolve a idade', async () => {
        const { service, executar } = make({ ultimoSucesso: minAtras(12) });
        const r = await pedir(service);
        expect(r).toMatchObject({ estado: 'fresca', idadeMin: 12 });
        expect(r.ultimaIngestaoEm).toBe(minAtras(12).toISOString());
        expect(executar).not.toHaveBeenCalled();
    });

    it('defasada: com 31 min roda a ingestão e devolve `atualizada` com o resultado', async () => {
        const { service, executar } = make({ ultimoSucesso: minAtras(31) });
        const r = await pedir(service);
        expect(executar).toHaveBeenCalledWith({ triggeredBy: 'abertura:u1' });
        expect(r).toMatchObject({
            estado: 'atualizada',
            idadeMin: 0,
            run: { runId: 'R-NOVA', totalTitulos: 1398 },
        });
    });

    it('nunca ingerida (sem run alguma): roda', async () => {
        const { service, executar } = make({ ultimoSucesso: null });
        expect((await pedir(service)).estado).toBe('atualizada');
        expect(executar).toHaveBeenCalledTimes(1);
    });

    it('o TTL vem da configuração', async () => {
        const { service, executar } = make({ ultimoSucesso: minAtras(12), ttlMin: 10 });
        expect((await pedir(service)).estado).toBe('atualizada');
        expect(executar).toHaveBeenCalledTimes(1);
    });

    it('em_andamento: run `running` recente não é refeita', async () => {
        const { service, executar } = make({
            ultimoSucesso: minAtras(90),
            ultimaRun: { status: 'running', startedAt: minAtras(2).toISOString() },
        });
        const r = await pedir(service);
        expect(r).toMatchObject({ estado: 'em_andamento', idadeMin: 90 });
        expect(executar).not.toHaveBeenCalled();
    });

    it('run `running` MORTA (>10 min, processo derrubado) não bloqueia o refresh', async () => {
        const { service, executar } = make({
            ultimoSucesso: minAtras(90),
            ultimaRun: { status: 'running', startedAt: minAtras(45).toISOString() },
        });
        expect((await pedir(service)).estado).toBe('atualizada');
        expect(executar).toHaveBeenCalledTimes(1);
    });

    it('lock ocupado na corrida (IngestLockBusyError) vira em_andamento, não erro', async () => {
        const executar = jest.fn().mockRejectedValue(new IngestLockBusyError('busy'));
        const { service } = make({ ultimoSucesso: minAtras(90), executar });
        expect((await pedir(service)).estado).toBe('em_andamento');
    });

    it('falha_recente: última run com erro há < 5 min não repete (um 403 não vira loop)', async () => {
        const { service, executar } = make({
            ultimoSucesso: minAtras(300),
            ultimaRun: {
                status: 'error',
                startedAt: minAtras(3).toISOString(),
                finishedAt: minAtras(2).toISOString(),
                errorMessage: 'ingestão sem leitura: nenhuma das 7 filiais foi lida',
            },
        });
        const r = await pedir(service);
        expect(r).toMatchObject({
            estado: 'falha_recente',
            motivo: expect.stringContaining('nenhuma das 7 filiais'),
        });
        expect(executar).not.toHaveBeenCalled();
    });

    it('depois do cooldown a falha anterior não impede nova tentativa', async () => {
        const { service, executar } = make({
            ultimoSucesso: minAtras(300),
            ultimaRun: {
                status: 'error',
                startedAt: minAtras(9).toISOString(),
                finishedAt: minAtras(8).toISOString(),
                errorMessage: 'x',
            },
        });
        expect((await pedir(service)).estado).toBe('atualizada');
        expect(executar).toHaveBeenCalledTimes(1);
    });

    it('falha inesperada da ingestão propaga (a rota responde 500; a tela avisa)', async () => {
        const executar = jest.fn().mockRejectedValue(new Error('ingestão sem leitura'));
        const { service } = make({ ultimoSucesso: minAtras(90), executar });
        await expect(pedir(service)).rejects.toThrow('ingestão sem leitura');
    });
});
