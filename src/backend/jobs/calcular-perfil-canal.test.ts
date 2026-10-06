import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type JobExecucaoRepository from '../domain/repository/operacao/JobExecucaoRepository.js';
import type LogService from '../domain/service/LogService.js';
import type PerfilCanalService from '../domain/service/sispag/PerfilCanalService.js';
import type { ResumoPerfilCanal } from '../domain/service/sispag/PerfilCanalService.js';
import CalcularPerfilCanalJob from './CalcularPerfilCanalJob.js';

/** Job `calcular-perfil-canal` com o serviço mockado (ADR-0063, Task 10). */

const resumo = (over: Partial<ResumoPerfilCanal> = {}): ResumoPerfilCanal => ({
    filiais: 7,
    contas: 9,
    debitos: 3000,
    borderos: 400,
    baixas: 2500,
    perfis: 320,
    porConfianca: { ALTA: 120, MEDIA: 80, BAIXA: 120 },
    ambiguos: 40,
    semDebito: 200,
    semFavorecido: 3,
    falhasLeitura: 0,
    gravado: true,
    janelaInicio: Date.UTC(2024, 9, 1),
    janelaFim: Date.UTC(2026, 9, 1),
    ...over,
});

const setup = (r: ResumoPerfilCanal | Error) => {
    const perfil = {
        calcular: jest.fn(async () => {
            if (r instanceof Error) throw r;
            return r;
        }),
    };
    const runRepo = {
        createRun: jest.fn().mockResolvedValue('RUN-9'),
        finishRun: jest.fn().mockResolvedValue(undefined),
    };
    const log = { info: jest.fn(), error: jest.fn() };
    const job = new CalcularPerfilCanalJob(
        perfil as unknown as PerfilCanalService,
        runRepo as unknown as JobExecucaoRepository,
        log as unknown as LogService,
    );
    return { job, perfil, runRepo, log };
};

describe('CalcularPerfilCanalJob', () => {
    beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
    afterEach(() => jest.restoreAllMocks());

    it('rodada boa → exit 0, run success com as contagens, jobRunId repassado', async () => {
        const s = setup(resumo());
        expect(await s.job.executar('cron')).toBe(0);
        expect(s.runRepo.createRun).toHaveBeenCalledWith({
            pipeline: 'sispag-perfil-canal',
            triggeredBy: 'cron',
        });
        expect(s.perfil.calcular).toHaveBeenCalledWith({ jobRunId: 'RUN-9' });
        expect(s.runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'success',
                metricas: expect.objectContaining({
                    fornecedoresLidos: 320,
                    perfisAlta: 120,
                    perfisMedia: 80,
                    perfisBaixa: 120,
                    ambiguosDescartados: 40,
                }),
            }),
        );
    });

    it('log de início e fim em português, com contagens', async () => {
        const s = setup(resumo());
        await s.job.executar('cron');
        const mensagens = s.log.info.mock.calls.map(([p]) => p.message);
        expect(mensagens).toEqual(['perfil de canal: início', 'perfil de canal: fim']);
        expect(s.log.info.mock.calls[1]?.[0].data).toMatchObject({ perfisAlta: 120 });
    });

    it('leitura que falhou → exit 1, run error, nada gravado (perfis anteriores valem)', async () => {
        const s = setup(resumo({ falhasLeitura: 2, gravado: false }));
        expect(await s.job.executar('cron')).toBe(1);
        expect(s.runRepo.finishRun.mock.calls[0]?.[0]).toMatchObject({
            status: 'error',
            errorMessage: expect.stringContaining('rodada não gravada'),
        });
        expect(s.log.error).toHaveBeenCalled();
    });

    it('zero perfis NÃO é sucesso silencioso → exit 1 com log explícito', async () => {
        const s = setup(
            resumo({ perfis: 0, gravado: false, porConfianca: { ALTA: 0, MEDIA: 0, BAIXA: 0 } }),
        );
        expect(await s.job.executar('cron')).toBe(1);
        expect(s.log.error.mock.calls[0]?.[0].message).toMatch(/nenhum perfil calculado/);
    });

    it('exceção → exit 1, run error com a mensagem REDIGIDA', async () => {
        const s = setup(new Error('password authentication failed for user "robo" senha=abc'));
        expect(await s.job.executar('manual')).toBe(1);
        const fechamento = s.runRepo.finishRun.mock.calls[0]?.[0];
        expect(fechamento.status).toBe('error');
        expect(fechamento.errorMessage).not.toContain('senha=abc');
    });

    it('o ponto de entrada importa reflect-metadata e não acrescenta nada ao bootstrapAppContainer', () => {
        const entrada = readFileSync(path.join(__dirname, 'calcular-perfil-canal.ts'), 'utf8');
        expect(entrada).toMatch(/^import 'reflect-metadata';/);
        expect(entrada).toMatch(/await bootstrapAppContainer\(\);/);
        const container = readFileSync(
            path.join(__dirname, '..', 'domain', 'appContainer.ts'),
            'utf8',
        );
        expect(container).not.toMatch(/PerfilCanal|CalcularPerfil/);
    });

    it('o workflow é semanal + manual, usa os secrets CONEXOS_* e alerta na falha', () => {
        const wf = readFileSync(
            path.join(
                __dirname,
                '..',
                '..',
                '..',
                '.github',
                'workflows',
                'calcular-perfil-canal.yml',
            ),
            'utf8',
        );
        expect(wf).toMatch(/cron: '17 6 \* \* 0'/);
        expect(wf).toMatch(/workflow_dispatch/);
        expect(wf).toMatch(/CONEXOS_PASSWORD: \$\{\{ secrets\.CONEXOS_PASSWORD \}\}/);
        expect(wf).toMatch(/run: npm run job:perfil-canal/);
        expect(wf).toMatch(/PIPELINE_ALVO: sispag-perfil-canal/);
        // Minuto sem colisão com os crons que leem o ERP (:00, :10/:25/:40/:55, :20, :35, :48).
        for (const ocupado of ['0', '10', '20', '25', '35', '40', '48', '55']) {
            expect(wf).not.toMatch(new RegExp(`cron: '${ocupado} `));
        }
    });
});
