import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import type { JobExecucao } from '../../repository/operacao/JobExecucaoRepository.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type JobExecucaoRepository from '../../repository/operacao/JobExecucaoRepository.js';
import type LogService from '../LogService.js';
import type SincronizacaoLoteService from './SincronizacaoLoteService.js';
import type { ResumoSincronizacao } from './SincronizacaoLoteService.js';
import SincronizacaoPassadaService, {
    SISPAG_SINCRONIZACAO_LOCK_KEY,
} from './SincronizacaoPassadaService.js';

/** Passada completa de L11 com trava e trilha (ADR-0055, ADR-0066). */

const MIN = 60_000;
const AGORA = Date.parse('2026-10-13T14:00:00.000Z');
const ha = (min: number) => new Date(AGORA - min * MIN).toISOString();

const resumo = (over: Partial<ResumoSincronizacao> = {}): ResumoSincronizacao => ({
    lotes: 2,
    transicionados: 1,
    atualizados: 0,
    semMudanca: 1,
    pulados: 0,
    falhasLeitura: 0,
    eventosNaoLidos: 0,
    resultados: [],
    ...over,
});

const run = (over: Partial<JobExecucao>): JobExecucao =>
    ({
        id: 'r',
        pipeline: 'sispag-sincronizacao',
        triggeredBy: 'cron',
        status: 'success',
        metricas: {},
        startedAt: ha(60),
        ...over,
    }) as JobExecucao;

const setup = (
    opts: {
        resumo?: ResumoSincronizacao | Error;
        runs?: JobExecucao[];
        travaOcupada?: boolean;
    } = {},
) => {
    const r = opts.resumo ?? resumo();
    const sincronizacao = {
        sincronizarTodos:
            r instanceof Error ? jest.fn().mockRejectedValue(r) : jest.fn().mockResolvedValue(r),
    };
    const runRepo = {
        createRun: jest.fn().mockResolvedValue('run-1'),
        finishRun: jest.fn().mockResolvedValue(undefined),
        listRecentRuns: jest.fn().mockResolvedValue(opts.runs ?? []),
    };
    const db = {
        withAdvisoryLock: jest.fn(
            async (
                _k: number,
                onAcquired: () => Promise<unknown>,
                onBusy: () => Promise<unknown>,
            ) => (opts.travaOcupada ? onBusy() : onAcquired()),
        ),
    };
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            sispagLotesSyncTtlMin: 30,
            sispagLotesSyncCooldownMin: 5,
            sispagLotesSyncPrazoSeg: 120,
        }),
    };
    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SincronizacaoPassadaService(
        sincronizacao as unknown as SincronizacaoLoteService,
        runRepo as unknown as JobExecucaoRepository,
        db as unknown as PostgreeDatabaseClient,
        env as unknown as EnvironmentProvider,
        logService as unknown as LogService,
    );
    return { service, sincronizacao, runRepo, db, logService };
};

describe('SincronizacaoPassadaService.executarPassada', () => {
    it('roda sob a trava própria e fecha a run success com os contadores', async () => {
        const s = setup();
        const p = await s.service.executarPassada({ triggeredBy: 'cron' });
        expect(s.db.withAdvisoryLock.mock.calls[0]?.[0]).toBe(SISPAG_SINCRONIZACAO_LOCK_KEY);
        expect(s.runRepo.createRun).toHaveBeenCalledWith({
            pipeline: 'sispag-sincronizacao',
            triggeredBy: 'cron',
        });
        expect(s.runRepo.finishRun).toHaveBeenCalledWith({
            runId: 'run-1',
            status: 'success',
            metricas: {
                lotesLidos: 2,
                transicionados: 1,
                atualizados: 0,
                semMudanca: 1,
                pulados: 0,
                falhasLeitura: 0,
                eventosNaoLidos: 0,
            },
        });
        expect(p).toEqual({ runId: 'run-1', status: 'success', resumo: resumo() });
        const mensagens = s.logService.info.mock.calls.map((c) => c[0].message);
        expect(mensagens).toEqual([
            'sincronização de lotes SISPAG: início',
            'sincronização de lotes SISPAG: fim',
        ]);
    });

    it('TODAS as leituras falharam → run error com mensagem — nunca "success com 0"', async () => {
        const s = setup({
            resumo: resumo({ lotes: 3, falhasLeitura: 3, transicionados: 0, semMudanca: 0 }),
        });
        const p = await s.service.executarPassada({ triggeredBy: 'cron' });
        expect(p.status).toBe('error');
        expect(s.runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'error', errorMessage: expect.any(String) }),
        );
        expect(s.logService.error).toHaveBeenCalled();
    });

    it('falha parcial → run partial', async () => {
        const s = setup({ resumo: resumo({ falhasLeitura: 1 }) });
        expect((await s.service.executarPassada({ triggeredBy: 'cron' })).status).toBe('partial');
    });

    it('nenhum lote a sincronizar não é falha', async () => {
        const s = setup({ resumo: resumo({ lotes: 0, transicionados: 0, semMudanca: 0 }) });
        expect((await s.service.executarPassada({ triggeredBy: 'cron' })).status).toBe('success');
    });

    it('exceção do serviço → run error com a mensagem REDIGIDA, sem lançar', async () => {
        const s = setup({
            resumo: new Error('password authentication failed for user "robo" senha=abc'),
        });
        const p = await s.service.executarPassada({ triggeredBy: 'manual' });
        expect(p.status).toBe('error');
        const fechamento = s.runRepo.finishRun.mock.calls[0][0];
        expect(fechamento.status).toBe('error');
        expect(fechamento.errorMessage).not.toContain('senha=abc');
    });

    it('trava ocupada → IngestLockBusyError, sem abrir run', async () => {
        const s = setup({ travaOcupada: true });
        await expect(s.service.executarPassada({ triggeredBy: 'cron' })).rejects.toBeInstanceOf(
            IngestLockBusyError,
        );
        expect(s.runRepo.createRun).not.toHaveBeenCalled();
    });
});

describe('SincronizacaoPassadaService — prazo da passada (ADR-0066)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('leitura pendurada: no prazo fecha a run em error, solta a trava e pede para parar', async () => {
        const s = setup();
        let sinal: AbortSignal | undefined;
        s.sincronizacao.sincronizarTodos.mockImplementation(
            (_agora: Date, recebido: AbortSignal) => {
                sinal = recebido;
                return new Promise(() => undefined); // Conexos nunca responde
            },
        );
        const passada = s.service.executarPassada({ triggeredBy: 'cron' });
        await jest.advanceTimersByTimeAsync(119_999);
        expect(s.runRepo.finishRun).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);

        const p = await passada; // devolveu: a trava (withAdvisoryLock) foi solta
        expect(p.status).toBe('error');
        expect(p.errorMessage).toMatch(/excedeu o prazo de 120 s/);
        expect(s.runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'error', errorMessage: p.errorMessage }),
        );
        expect(sinal?.aborted).toBe(true);
    });

    it('na abertura, o prazo estourado vira atualizada com o motivo (a tela avisa)', async () => {
        const s = setup({ runs: [] });
        s.sincronizacao.sincronizarTodos.mockReturnValue(new Promise(() => undefined));
        const r = s.service.sincronizarSeDefasada({ triggeredBy: 'abertura:ana', agora: AGORA });
        await jest.advanceTimersByTimeAsync(120_000);
        expect((await r).motivo).toMatch(/excedeu o prazo/);
    });
});

describe('SincronizacaoPassadaService.sincronizarSeDefasada (abertura da tela)', () => {
    const abrir = (s: ReturnType<typeof setup>) =>
        s.service.sincronizarSeDefasada({ triggeredBy: 'abertura:ana', agora: AGORA });

    it('fresca: última passada finalizada há menos do TTL → não roda', async () => {
        const s = setup({ runs: [run({ status: 'success', finishedAt: ha(10) })] });
        expect(await abrir(s)).toEqual({
            estado: 'fresca',
            ultimaSincronizacaoEm: ha(10),
            idadeMin: 10,
        });
        expect(s.sincronizacao.sincronizarTodos).not.toHaveBeenCalled();
    });

    it('partial também conta como passada finalizada', async () => {
        const s = setup({ runs: [run({ status: 'partial', finishedAt: ha(10) })] });
        expect((await abrir(s)).estado).toBe('fresca');
    });

    it('defasada → roda a passada e devolve atualizada com o resumo', async () => {
        const s = setup({ runs: [run({ status: 'success', finishedAt: ha(45) })] });
        const r = await abrir(s);
        expect(r.estado).toBe('atualizada');
        expect(r.passada?.resumo?.transicionados).toBe(1);
        expect(s.runRepo.createRun).toHaveBeenCalledWith(
            expect.objectContaining({ triggeredBy: 'abertura:ana' }),
        );
    });

    it('nunca sincronizou → roda', async () => {
        const s = setup({ runs: [] });
        expect((await abrir(s)).estado).toBe('atualizada');
    });

    it('run running recente → em_andamento, sem rodar', async () => {
        const s = setup({
            runs: [run({ status: 'running', startedAt: ha(1) }), run({ finishedAt: ha(50) })],
        });
        expect((await abrir(s)).estado).toBe('em_andamento');
        expect(s.sincronizacao.sincronizarTodos).not.toHaveBeenCalled();
    });

    it('run running velha (> 10 min, processo morto) NÃO bloqueia', async () => {
        const s = setup({
            runs: [run({ status: 'running', startedAt: ha(20) }), run({ finishedAt: ha(50) })],
        });
        expect((await abrir(s)).estado).toBe('atualizada');
    });

    it('falha recente (< cooldown) → falha_recente com o motivo, sem rodar', async () => {
        const s = setup({
            runs: [
                run({ status: 'error', finishedAt: ha(2), errorMessage: 'Bad Credentials' }),
                run({ finishedAt: ha(50) }),
            ],
        });
        const r = await abrir(s);
        expect(r).toEqual(
            expect.objectContaining({ estado: 'falha_recente', motivo: 'Bad Credentials' }),
        );
        expect(s.sincronizacao.sincronizarTodos).not.toHaveBeenCalled();
    });

    it('falha antiga (> cooldown) → tenta de novo', async () => {
        const s = setup({ runs: [run({ status: 'error', finishedAt: ha(6) })] });
        expect((await abrir(s)).estado).toBe('atualizada');
    });

    it('perde a corrida pela trava → em_andamento, não erro', async () => {
        const s = setup({ runs: [], travaOcupada: true });
        expect((await abrir(s)).estado).toBe('em_andamento');
    });

    it('passada que fecha em error → atualizada com o motivo (a tela avisa)', async () => {
        const s = setup({ runs: [], resumo: new Error('timeout no fin064') });
        const r = await abrir(s);
        expect(r.estado).toBe('atualizada');
        expect(r.passada?.status).toBe('error');
        expect(r.motivo).toContain('timeout');
    });
});

describe('SincronizacaoPassadaService.forcar ("Sincronizar agora" da tela)', () => {
    it('ignora TTL e cooldown: roda mesmo com passada recente e falha recente', async () => {
        const s = setup({
            runs: [run({ status: 'error', finishedAt: ha(1) }), run({ finishedAt: ha(2) })],
        });
        const r = await s.service.forcar({ triggeredBy: 'manual:ana', agora: AGORA });
        expect(r.estado).toBe('atualizada');
        expect(s.runRepo.listRecentRuns).not.toHaveBeenCalled();
    });

    it('respeita "uma por vez": trava ocupada → em_andamento', async () => {
        const s = setup({ travaOcupada: true });
        expect((await s.service.forcar({ triggeredBy: 'manual:ana' })).estado).toBe('em_andamento');
    });
});
