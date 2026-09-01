import 'reflect-metadata';
import { JOB_RUN_STATUS, PIPELINE, SITUACAO_PIPELINE } from '../../interface/operacao/JobRun.js';
import { LIMITES_STALENESS } from '../../interface/operacao/stalenessLimits.js';
import JobRunReadModel from './JobRunReadModel.js';

const AGORA = new Date('2026-09-01T12:00:00.000Z');
const HORA = 60 * 60 * 1000;

/** Uma run de permutas como `PermutaSnapshotRepository.listRecentRuns` a devolve (datas = `Date`). */
const permutaRun = (over: Partial<Record<string, unknown>> = {}) => ({
    runId: 'perm-1',
    triggeredBy: 'cron',
    startedAt: new Date('2026-09-01T09:00:00.000Z'),
    finishedAt: new Date('2026-09-01T09:02:00.000Z'),
    status: 'success',
    totalCandidatas: 700,
    totalElegiveis: 42,
    totalBloqueadas: 648,
    ...over,
});

/** Uma run de recebimentos (datas = ISO `string` — a fonte diverge das outras duas). */
const recebimentoRun = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'receb-1',
    correlationId: 'corr-1',
    triggeredBy: 'cron',
    status: 'success',
    filCods: [1, 2],
    totalLidas: 100,
    totalInseridas: 8,
    totalDeduplicadas: 92,
    totalContas: 4,
    totalContasFalhas: 0,
    startedAt: '2026-09-01T11:20:00.000Z',
    finishedAt: '2026-09-01T11:20:30.000Z',
    ...over,
});

/** Uma run do SISPAG (datas = ISO `string`; a fonte NÃO tem `partial`). */
const sispagRun = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'sisp-1',
    triggeredBy: 'cron',
    status: 'success',
    totalTitulos: 120,
    totalInativados: 3,
    startedAt: '2026-09-01T10:00:00.000Z',
    finishedAt: '2026-09-01T10:01:00.000Z',
    ...over,
});

const build = (opts: {
    permutas?: unknown[];
    recebimentos?: unknown[];
    sispag?: unknown[];
    jobExecucao?: unknown[];
}) =>
    new JobRunReadModel(
        { listRecentRuns: jest.fn().mockResolvedValue(opts.permutas ?? []) } as never,
        { listRecentRuns: jest.fn().mockResolvedValue(opts.recebimentos ?? []) } as never,
        { listRecentRuns: jest.fn().mockResolvedValue(opts.sispag ?? []) } as never,
        {
            // `lerJobExecucao` é chamado uma vez por pipeline novo (NDe-SEFAZ e o detector), no
            // mesmo repositório — o mock precisa responder POR pipeline, senão os dois recebem as
            // mesmas runs e o teste valida uma fantasia.
            listRecentRuns: jest.fn(async (pipeline: string) =>
                (opts.jobExecucao ?? []).filter(
                    (r) => (r as { pipeline?: string }).pipeline === pipeline,
                ),
            ),
        } as never,
    );

const acharPipeline = (saude: Awaited<ReturnType<JobRunReadModel['exporSaude']>>, p: string) => {
    const encontrado = saude.find((s) => s.pipeline === p);
    if (encontrado === undefined) throw new Error(`pipeline ${p} ausente da saúde`);
    return encontrado;
};

describe('JobRunReadModel — normalização das três fontes', () => {
    it('normaliza as datas apesar de as fontes divergirem entre Date e string ISO', async () => {
        const saude = await build({
            permutas: [permutaRun()],
            recebimentos: [recebimentoRun()],
            sispag: [sispagRun()],
        }).exporSaude(AGORA);

        expect(acharPipeline(saude, PIPELINE.PERMUTAS_ELEICAO).ultimaRun?.startedAt).toBe(
            '2026-09-01T09:00:00.000Z',
        );
        expect(acharPipeline(saude, PIPELINE.RECEBIMENTOS_EXTRATOS).ultimaRun?.startedAt).toBe(
            '2026-09-01T11:20:00.000Z',
        );
        expect(acharPipeline(saude, PIPELINE.SISPAG_PAGAMENTOS).ultimaRun?.startedAt).toBe(
            '2026-09-01T10:00:00.000Z',
        );
    });

    it('projeta as métricas próprias de cada fonte, sem forçar denominador comum', async () => {
        const saude = await build({
            permutas: [permutaRun()],
            recebimentos: [recebimentoRun()],
            sispag: [sispagRun()],
        }).exporSaude(AGORA);

        expect(acharPipeline(saude, PIPELINE.PERMUTAS_ELEICAO).ultimaRun?.metricas).toEqual({
            candidatas: 700,
            elegiveis: 42,
            bloqueadas: 648,
        });
        expect(acharPipeline(saude, PIPELINE.RECEBIMENTOS_EXTRATOS).ultimaRun?.metricas).toEqual({
            lidas: 100,
            inseridas: 8,
            deduplicadas: 92,
            contas: 4,
            contasFalhas: 0,
        });
        expect(acharPipeline(saude, PIPELINE.SISPAG_PAGAMENTOS).ultimaRun?.metricas).toEqual({
            titulos: 120,
            inativados: 3,
        });
    });

    it('calcula duracaoMs e a omite enquanto a run não terminou', async () => {
        const saude = await build({
            permutas: [permutaRun()],
            recebimentos: [recebimentoRun({ status: 'running', finishedAt: undefined })],
        }).exporSaude(AGORA);

        expect(acharPipeline(saude, PIPELINE.PERMUTAS_ELEICAO).ultimaRun?.duracaoMs).toBe(120_000);
        const receb = acharPipeline(saude, PIPELINE.RECEBIMENTOS_EXTRATOS).ultimaRun;
        expect(receb?.finishedAt).toBeUndefined();
        expect(receb?.duracaoMs).toBeUndefined();
    });

    it('propaga errorMessage quando a fonte o traz', async () => {
        const saude = await build({
            sispag: [sispagRun({ status: 'error', errorMessage: 'LOGIN_ERROR_MAX_SESSIONS' })],
        }).exporSaude(AGORA);

        expect(acharPipeline(saude, PIPELINE.SISPAG_PAGAMENTOS).ultimaRun?.errorMessage).toBe(
            'LOGIN_ERROR_MAX_SESSIONS',
        );
    });
});

describe('JobRunReadModel — o invariante do `partial`', () => {
    it('preserva `partial` nas fontes que o distinguem, sem achatar em `success`', async () => {
        const saude = await build({
            permutas: [permutaRun({ status: 'partial' })],
            recebimentos: [recebimentoRun({ status: 'partial', totalContasFalhas: 77 })],
        }).exporSaude(AGORA);

        expect(acharPipeline(saude, PIPELINE.PERMUTAS_ELEICAO).ultimaRun?.status).toBe(
            JOB_RUN_STATUS.PARTIAL,
        );
        expect(acharPipeline(saude, PIPELINE.RECEBIMENTOS_EXTRATOS).ultimaRun?.status).toBe(
            JOB_RUN_STATUS.PARTIAL,
        );
    });

    it('marca distinguePartial=false no SISPAG — cegueira herdada, não sinal de saúde', async () => {
        const saude = await build({ sispag: [sispagRun()] }).exporSaude(AGORA);

        expect(acharPipeline(saude, PIPELINE.SISPAG_PAGAMENTOS).distinguePartial).toBe(false);
        expect(acharPipeline(saude, PIPELINE.PERMUTAS_ELEICAO).distinguePartial).toBe(true);
        expect(acharPipeline(saude, PIPELINE.RECEBIMENTOS_EXTRATOS).distinguePartial).toBe(true);
    });

    it('uma run `partial` NÃO conta como sinal de vida (não vira último sucesso)', async () => {
        const saude = await build({
            recebimentos: [recebimentoRun({ status: 'partial' })],
        }).exporSaude(AGORA);

        const receb = acharPipeline(saude, PIPELINE.RECEBIMENTOS_EXTRATOS);
        expect(receb.ultimoSucessoEm).toBeUndefined();
        expect(receb.situacao).toBe(SITUACAO_PIPELINE.NUNCA_EXECUTOU);
    });
});

describe('JobRunReadModel — situação de staleness (I6: computada na leitura)', () => {
    const limiteReceb = LIMITES_STALENESS[PIPELINE.RECEBIMENTOS_EXTRATOS].limiteMs;

    it('ok logo ANTES do limite', async () => {
        const dentro = new Date(AGORA.getTime() - (limiteReceb - 60_000)).toISOString();
        const saude = await build({
            recebimentos: [recebimentoRun({ startedAt: dentro, finishedAt: dentro })],
        }).exporSaude(AGORA);

        expect(acharPipeline(saude, PIPELINE.RECEBIMENTOS_EXTRATOS).situacao).toBe(
            SITUACAO_PIPELINE.OK,
        );
    });

    it('parado logo DEPOIS do limite', async () => {
        const fora = new Date(AGORA.getTime() - (limiteReceb + 60_000)).toISOString();
        const saude = await build({
            recebimentos: [recebimentoRun({ startedAt: fora, finishedAt: fora })],
        }).exporSaude(AGORA);

        expect(acharPipeline(saude, PIPELINE.RECEBIMENTOS_EXTRATOS).situacao).toBe(
            SITUACAO_PIPELINE.PARADO,
        );
    });

    it('sem nenhum sucesso → nunca-executou (estado próprio, não um ok disfarçado)', async () => {
        const saude = await build({
            sispag: [sispagRun({ status: 'error', errorMessage: 'boom' })],
        }).exporSaude(AGORA);

        const sisp = acharPipeline(saude, PIPELINE.SISPAG_PAGAMENTOS);
        expect(sisp.situacao).toBe(SITUACAO_PIPELINE.NUNCA_EXECUTOU);
        // A última run existe e falhou — quem alerta esse caso é `job-falhou`, não o staleness.
        expect(sisp.ultimaRun?.status).toBe(JOB_RUN_STATUS.ERROR);
    });

    it('pipeline sem run nenhuma → nunca-executou, sem ultimaRun', async () => {
        const saude = await build({}).exporSaude(AGORA);
        const perm = acharPipeline(saude, PIPELINE.PERMUTAS_ELEICAO);

        expect(perm.situacao).toBe(SITUACAO_PIPELINE.NUNCA_EXECUTOU);
        expect(perm.ultimaRun).toBeUndefined();
        expect(perm.idadeDesdeUltimoSucessoMs).toBeUndefined();
    });

    it('acha o último SUCESSO mesmo quando a run mais recente falhou', async () => {
        const saude = await build({
            permutas: [
                permutaRun({ runId: 'perm-2', status: 'error', errorMessage: 'x' }),
                permutaRun({ runId: 'perm-1', status: 'success' }),
            ],
        }).exporSaude(AGORA);

        const perm = acharPipeline(saude, PIPELINE.PERMUTAS_ELEICAO);
        expect(perm.ultimaRun?.runId).toBe('perm-2');
        expect(perm.ultimoSucessoEm).toBe('2026-09-01T09:02:00.000Z');
        expect(perm.idadeDesdeUltimoSucessoMs).toBe(3 * HORA - 2 * 60_000);
        expect(perm.situacao).toBe(SITUACAO_PIPELINE.OK);
    });
});

describe('JobRunReadModel — o reaper deixou de ser cego (ADR-0042, follow-up 2)', () => {
    it('o reaper agora é MONITORADO, com limite próprio', async () => {
        const saude = await build({
            jobExecucao: [
                {
                    id: 'reap-1',
                    pipeline: PIPELINE.SISPAG_REAPER,
                    triggeredBy: 'cron',
                    status: 'success',
                    metricas: { paradas: 0, remessas: 0, conciliacoes: 0 },
                    startedAt: '2026-09-01T11:55:00.000Z',
                    finishedAt: '2026-09-01T11:55:01.000Z',
                },
            ],
        }).exporSaude(AGORA);

        const reaper = acharPipeline(saude, PIPELINE.SISPAG_REAPER);
        expect(reaper.situacao).toBe(SITUACAO_PIPELINE.OK);
        expect(reaper.limiteStalenessMs).toBe(60 * 60 * 1000);
        expect(reaper.ultimaRun?.metricas).toEqual({ paradas: 0, remessas: 0, conciliacoes: 0 });
    });

    it('nenhum pipeline sobra como sem-trilha — a lista de cegos está vazia', async () => {
        const saude = await build({}).exporSaude(AGORA);
        expect(saude.filter((s) => s.situacao === SITUACAO_PIPELINE.SEM_TRILHA)).toEqual([]);
    });

    it('expõe TODOS os pipelines — omitir o cego afirmaria cobertura que não existe', async () => {
        const saude = await build({}).exporSaude(AGORA);
        expect(saude.map((s) => s.pipeline).sort()).toEqual(
            [
                PIPELINE.OPERACAO_DETECTOR,
                PIPELINE.PERMUTAS_ELEICAO,
                PIPELINE.RECEBIMENTOS_EXTRATOS,
                PIPELINE.RECEBIMENTOS_NDE_SEFAZ,
                PIPELINE.SISPAG_PAGAMENTOS,
                PIPELINE.SISPAG_REAPER,
            ].sort(),
        );
    });

    it('o job novo (job_execucao) nasce COM trilha, ao contrário do reaper', async () => {
        const saude = await build({
            jobExecucao: [
                {
                    id: 'nde-1',
                    pipeline: PIPELINE.RECEBIMENTOS_NDE_SEFAZ,
                    triggeredBy: 'cron',
                    status: 'success',
                    metricas: { ndesLidas: 12, reconciliadas: 2 },
                    startedAt: '2026-09-01T11:35:00.000Z',
                    finishedAt: '2026-09-01T11:35:20.000Z',
                },
            ],
        }).exporSaude(AGORA);

        const nde = acharPipeline(saude, PIPELINE.RECEBIMENTOS_NDE_SEFAZ);
        expect(nde.situacao).toBe(SITUACAO_PIPELINE.OK);
        expect(nde.ultimaRun?.metricas).toEqual({ ndesLidas: 12, reconciliadas: 2 });
        expect(nde.distinguePartial).toBe(true);
    });
});

describe('JobRunReadModel — o vigia entra na lista que ele vigia', () => {
    it('expõe o próprio detector como pipeline, para `alertas: []` deixar de ser ambíguo', async () => {
        const saude = await build({
            jobExecucao: [
                {
                    id: 'det-1',
                    pipeline: PIPELINE.OPERACAO_DETECTOR,
                    triggeredBy: 'cron',
                    status: 'success',
                    metricas: { inspecionados: 6, alertasEmitidos: 0 },
                    startedAt: '2026-09-01T11:45:00.000Z',
                    finishedAt: '2026-09-01T11:45:02.000Z',
                },
            ],
        }).exporSaude(AGORA);

        const detector = acharPipeline(saude, PIPELINE.OPERACAO_DETECTOR);
        expect(detector.situacao).toBe(SITUACAO_PIPELINE.OK);
        expect(detector.ultimaRun?.metricas).toEqual({ inspecionados: 6, alertasEmitidos: 0 });
    });

    it('detector que nunca rodou aparece como nunca-executou, não como ok', async () => {
        const saude = await build({}).exporSaude(AGORA);
        expect(acharPipeline(saude, PIPELINE.OPERACAO_DETECTOR).situacao).toBe(
            SITUACAO_PIPELINE.NUNCA_EXECUTOU,
        );
    });
});
