import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import IngestLockBusyError from '../domain/errors/IngestLockBusyError.js';
import type LogService from '../domain/service/LogService.js';
import type { ResumoSincronizacao } from '../domain/service/sispag/SincronizacaoLoteService.js';
import type SincronizacaoPassadaService from '../domain/service/sispag/SincronizacaoPassadaService.js';
import type { PassadaSincronizacao } from '../domain/service/sispag/SincronizacaoPassadaService.js';
import SincronizarLotesSispagJob from './SincronizarLotesSispagJob.js';

/**
 * Job `sincronizar-lotes-sispag` com a passada mockada (ADR-0055, ADR-0066). O status da run
 * (success/partial/error) é testado em `SincronizacaoPassadaService.test.ts`; aqui, o exit code.
 */

const resumo: ResumoSincronizacao = {
    lotes: 2,
    transicionados: 1,
    atualizados: 0,
    semMudanca: 1,
    pulados: 0,
    falhasLeitura: 0,
    eventosNaoLidos: 0,
    resultados: [],
};

const setup = (r: PassadaSincronizacao | Error) => {
    const passada = {
        executarPassada:
            r instanceof Error ? jest.fn().mockRejectedValue(r) : jest.fn().mockResolvedValue(r),
    };
    const logService = { info: jest.fn().mockResolvedValue(undefined) };
    const job = new SincronizarLotesSispagJob(
        passada as unknown as SincronizacaoPassadaService,
        logService as unknown as LogService,
    );
    return { job, passada, logService };
};

describe('SincronizarLotesSispagJob', () => {
    beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it('roda a passada com o triggeredBy e imprime os contadores em pt-BR', async () => {
        const s = setup({ runId: 'run-1', status: 'success', resumo });
        expect(await s.job.executar('cron')).toBe(0);
        expect(s.passada.executarPassada).toHaveBeenCalledWith({ triggeredBy: 'cron' });
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

    it('passada partial → exit 0', async () => {
        const s = setup({ runId: 'run-1', status: 'partial', resumo });
        expect(await s.job.executar('cron')).toBe(0);
    });

    it('passada error (ex.: nenhum título lido) → exit 1 — o workflow fica VERMELHO', async () => {
        const s = setup({ runId: 'run-1', status: 'error', errorMessage: 'Bad Credentials' });
        expect(await s.job.executar('cron')).toBe(1);
    });

    it('outra passada em andamento (a tela de alguém) → exit 0, não é falha', async () => {
        const s = setup(new IngestLockBusyError('ocupada'));
        expect(await s.job.executar('cron')).toBe(0);
        expect(s.logService.info).toHaveBeenCalled();
    });

    it('erro inesperado fora da passada propaga (o ponto de entrada sai com 1)', async () => {
        const s = setup(new Error('pool do banco caiu'));
        await expect(s.job.executar('cron')).rejects.toThrow('pool do banco caiu');
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
