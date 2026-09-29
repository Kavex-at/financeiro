import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type JobExecucaoRepository from '../domain/repository/operacao/JobExecucaoRepository.js';
import type LogService from '../domain/service/LogService.js';
import type SincronizacaoLoteService from '../domain/service/sispag/SincronizacaoLoteService.js';
import type { ResumoSincronizacao } from '../domain/service/sispag/SincronizacaoLoteService.js';
import SincronizarLotesSispagJob from './SincronizarLotesSispagJob.js';

/** Job `sincronizar-lotes-sispag` com o serviço mockado (ADR-0055, Task 11). */

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

const setup = (r: ResumoSincronizacao | Error) => {
    const sincronizacao = {
        sincronizarTodos:
            r instanceof Error ? jest.fn().mockRejectedValue(r) : jest.fn().mockResolvedValue(r),
    };
    const runRepo = {
        createRun: jest.fn().mockResolvedValue('run-1'),
        finishRun: jest.fn().mockResolvedValue(undefined),
    };
    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const job = new SincronizarLotesSispagJob(
        sincronizacao as unknown as SincronizacaoLoteService,
        runRepo as unknown as JobExecucaoRepository,
        logService as unknown as LogService,
    );
    return { job, sincronizacao, runRepo, logService };
};

describe('SincronizarLotesSispagJob', () => {
    beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it('abre a trilha no pipeline sispag-sincronizacao e fecha success com os contadores', async () => {
        const s = setup(resumo());
        expect(await s.job.executar('cron')).toBe(0);
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
    });

    it('loga em pt-BR o início e o fim com lotes lidos, transicionados, sem mudança, pulados, falhas', async () => {
        const s = setup(resumo());
        await s.job.executar('cron');
        const mensagens = s.logService.info.mock.calls.map((c) => c[0].message);
        expect(mensagens).toEqual([
            'sincronização de lotes SISPAG: início',
            'sincronização de lotes SISPAG: fim',
        ]);
        const linha = (console.log as jest.Mock).mock.calls.flat().join(' ');
        for (const termo of [
            'lotes lidos',
            'transicionados',
            'sem mudança',
            'pulados',
            'falhas de leitura',
        ]) {
            expect(linha).toContain(termo);
        }
    });

    it('TODAS as leituras falharam (ex.: Bad Credentials) → exit 1 e run em error — nunca "success com 0"', async () => {
        const s = setup(resumo({ lotes: 3, falhasLeitura: 3, transicionados: 0, semMudanca: 0 }));
        expect(await s.job.executar('cron')).toBe(1);
        expect(s.runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'error', errorMessage: expect.any(String) }),
        );
        expect(s.logService.error).toHaveBeenCalled();
    });

    it('falha parcial → exit 0 e run partial (o painel pinta de amarelo)', async () => {
        const s = setup(resumo({ falhasLeitura: 1 }));
        expect(await s.job.executar('cron')).toBe(0);
        expect(s.runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'partial' }),
        );
    });

    it('nenhum lote a sincronizar não é falha', async () => {
        const s = setup(resumo({ lotes: 0, transicionados: 0, semMudanca: 0 }));
        expect(await s.job.executar('cron')).toBe(0);
    });

    it('exceção do serviço → exit 1, run em error com a mensagem REDIGIDA', async () => {
        const s = setup(new Error('password authentication failed for user "robo" senha=abc'));
        expect(await s.job.executar('manual')).toBe(1);
        const fechamento = s.runRepo.finishRun.mock.calls[0][0];
        expect(fechamento.status).toBe('error');
        expect(fechamento.errorMessage).not.toContain('senha=abc');
    });

    it('o ponto de entrada não acrescenta nada ao bootstrapAppContainer (compartilhado por ~58 jobs)', () => {
        const entrada = readFileSync(path.join(__dirname, 'sincronizar-lotes-sispag.ts'), 'utf8');
        expect(entrada).toMatch(/await bootstrapAppContainer\(\);/);
        const container = readFileSync(
            path.join(__dirname, '..', 'domain', 'appContainer.ts'),
            'utf8',
        );
        expect(container).not.toMatch(/Sincroniza/);
    });
});
