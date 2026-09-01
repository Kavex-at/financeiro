import 'reflect-metadata';
import { ALERTA_SEVERIDADE, ALERTA_TIPO } from '../../interface/operacao/Alerta.js';
import {
    JOB_RUN_STATUS,
    PIPELINE,
    type PipelineSaude,
    SITUACAO_PIPELINE,
} from '../../interface/operacao/JobRun.js';
import { LIMITES_STALENESS } from '../../interface/operacao/stalenessLimits.js';
import StalenessDetector from './StalenessDetector.js';

const AGORA = new Date('2026-09-01T12:00:00.000Z');
const LIMITE_RECEB = LIMITES_STALENESS[PIPELINE.RECEBIMENTOS_EXTRATOS].limiteMs;

const saudeDe = (over: Partial<PipelineSaude> = {}): PipelineSaude => ({
    pipeline: PIPELINE.RECEBIMENTOS_EXTRATOS,
    rotulo: 'Recebimentos — ingestão de extratos',
    cadencia: '20 * * * *',
    limiteStalenessMs: LIMITE_RECEB,
    situacao: SITUACAO_PIPELINE.OK,
    distinguePartial: true,
    runsRecentes: [],
    ...over,
});

const runDe = (over: Record<string, unknown> = {}) => ({
    runId: 'r-1',
    pipeline: PIPELINE.RECEBIMENTOS_EXTRATOS,
    status: JOB_RUN_STATUS.SUCCESS,
    triggeredBy: 'cron',
    startedAt: '2026-09-01T11:20:00.000Z',
    finishedAt: '2026-09-01T11:20:30.000Z',
    metricas: {},
    ...over,
});

const montar = (saude: PipelineSaude[]) => {
    const emitidos: { tipo: string; alvo: string; janelaInicio: Date }[] = [];
    const notif = {
        emitir: jest.fn(async (a) => {
            emitidos.push(a);
            return { ...a, id: emitidos.length, dedupKey: 'k', sinkResultados: [], criadoEm: '' };
        }),
    };
    const readModel = { exporSaude: jest.fn().mockResolvedValue(saude) };
    return {
        detector: new StalenessDetector(readModel as never, notif as never),
        notif,
        emitidos,
    };
};

describe('StalenessDetector — staleness', () => {
    it('alerta job-parado quando a situação é parado', async () => {
        const { detector, emitidos } = montar([
            saudeDe({
                situacao: SITUACAO_PIPELINE.PARADO,
                idadeDesdeUltimoSucessoMs: LIMITE_RECEB + 60_000,
                ultimoSucessoEm: '2026-09-01T08:00:00.000Z',
            }),
        ]);

        await detector.detectar(AGORA);

        expect(emitidos).toHaveLength(1);
        expect(emitidos[0]).toMatchObject({
            tipo: ALERTA_TIPO.JOB_PARADO,
            alvo: PIPELINE.RECEBIMENTOS_EXTRATOS,
            severidade: ALERTA_SEVERIDADE.ERRO,
        });
    });

    it('NÃO alerta quando está ok', async () => {
        const { detector, notif } = montar([saudeDe({ situacao: SITUACAO_PIPELINE.OK })]);
        await detector.detectar(AGORA);
        expect(notif.emitir).not.toHaveBeenCalled();
    });

    it('SUPRIME o staleness em nunca-executou (decisão do Yuri) — mas não some da inspeção', async () => {
        const { detector, notif } = montar([
            saudeDe({ situacao: SITUACAO_PIPELINE.NUNCA_EXECUTOU }),
        ]);

        const r = await detector.detectar(AGORA);

        expect(notif.emitir).not.toHaveBeenCalled();
        expect(r.inspecionados).toEqual([
            {
                pipeline: PIPELINE.RECEBIMENTOS_EXTRATOS,
                situacao: SITUACAO_PIPELINE.NUNCA_EXECUTOU,
            },
        ]);
    });

    it('nunca-executou ainda alerta job-falhou se a última run FALHOU', async () => {
        const { detector, emitidos } = montar([
            saudeDe({
                situacao: SITUACAO_PIPELINE.NUNCA_EXECUTOU,
                ultimaRun: runDe({ status: JOB_RUN_STATUS.ERROR, errorMessage: 'boom' }) as never,
            }),
        ]);

        await detector.detectar(AGORA);

        // O silêncio é só do staleness: um pipeline quebrado desde o dia 1 NÃO fica calado.
        expect(emitidos.map((e) => e.tipo)).toEqual([ALERTA_TIPO.JOB_FALHOU]);
    });

    it('NÃO alerta pipeline sem-trilha — alertar seria inventar um sinal', async () => {
        const { detector, notif } = montar([
            saudeDe({
                pipeline: PIPELINE.SISPAG_REAPER,
                situacao: SITUACAO_PIPELINE.SEM_TRILHA,
                limiteStalenessMs: undefined,
            }),
        ]);

        await detector.detectar(AGORA);
        expect(notif.emitir).not.toHaveBeenCalled();
    });
});

describe('StalenessDetector — falha e parcialidade da última run', () => {
    it('alerta job-falhou com o erro da run', async () => {
        const { detector, emitidos } = montar([
            saudeDe({
                ultimaRun: runDe({
                    status: JOB_RUN_STATUS.ERROR,
                    errorMessage: 'LOGIN_ERROR_MAX_SESSIONS',
                }) as never,
            }),
        ]);

        await detector.detectar(AGORA);
        expect(emitidos[0]).toMatchObject({ tipo: ALERTA_TIPO.JOB_FALHOU });
    });

    it('alerta job-parcial como AVISO — incidente distinto do staleness', async () => {
        const { detector, emitidos } = montar([
            saudeDe({ ultimaRun: runDe({ status: JOB_RUN_STATUS.PARTIAL }) as never }),
        ]);

        await detector.detectar(AGORA);
        expect(emitidos[0]).toMatchObject({
            tipo: ALERTA_TIPO.JOB_PARCIAL,
            severidade: ALERTA_SEVERIDADE.AVISO,
        });
    });

    it('run `running` DENTRO do limite não gera alerta — está apenas em andamento', async () => {
        const recente = new Date(AGORA.getTime() - 60_000).toISOString();
        const { detector, notif } = montar([
            saudeDe({
                ultimaRun: runDe({
                    status: JOB_RUN_STATUS.RUNNING,
                    startedAt: recente,
                    finishedAt: undefined,
                }) as never,
            }),
        ]);
        await detector.detectar(AGORA);
        expect(notif.emitir).not.toHaveBeenCalled();
    });

    it('run `running` ALÉM do limite é run ABANDONADA e alerta (F-fault-tolerance-1)', async () => {
        // Runner morto entre createRun e finishRun: `running` não é `error`, então sem esta regra
        // a única detecção residual seria o staleness do último SUCESSO — até 30h de janela cega
        // no SISPAG.
        const velha = new Date(AGORA.getTime() - (LIMITE_RECEB + 60_000)).toISOString();
        const { detector, emitidos } = montar([
            saudeDe({
                ultimaRun: runDe({
                    status: JOB_RUN_STATUS.RUNNING,
                    startedAt: velha,
                    finishedAt: undefined,
                }) as never,
            }),
        ]);

        await detector.detectar(AGORA);

        expect(emitidos).toHaveLength(1);
        expect(emitidos[0]).toMatchObject({ tipo: ALERTA_TIPO.JOB_FALHOU });
        expect(
            (emitidos[0] as unknown as { detalhe: { motivo: string } }).detalhe.motivo,
        ).toContain('abandonada');
    });

    it('a run abandonada alerta UMA vez, não a cada rodada do detector', async () => {
        const velha = new Date(AGORA.getTime() - LIMITE_RECEB * 3).toISOString();
        const abandonada = saudeDe({
            ultimaRun: runDe({
                status: JOB_RUN_STATUS.RUNNING,
                startedAt: velha,
                finishedAt: undefined,
            }) as never,
        });

        const a = montar([abandonada]);
        await a.detector.detectar(AGORA);
        const b = montar([abandonada]);
        await b.detector.detectar(new Date(AGORA.getTime() + 2 * 60 * 60 * 1000));

        // Janela = a run, não o relógio.
        expect(a.emitidos[0].janelaInicio.toISOString()).toBe(
            b.emitidos[0].janelaInicio.toISOString(),
        );
    });

    it('pipeline sem-trilha com run `running` não alerta — sem limite, sem teto aplicável', async () => {
        const { detector, notif } = montar([
            saudeDe({
                pipeline: PIPELINE.SISPAG_REAPER,
                situacao: SITUACAO_PIPELINE.SEM_TRILHA,
                limiteStalenessMs: undefined,
                ultimaRun: runDe({
                    status: JOB_RUN_STATUS.RUNNING,
                    startedAt: '2020-01-01T00:00:00.000Z',
                    finishedAt: undefined,
                }) as never,
            }),
        ]);
        await detector.detectar(AGORA);
        expect(notif.emitir).not.toHaveBeenCalled();
    });

    it('parado E com última run falhada gera os DOIS alertas', async () => {
        const { detector, emitidos } = montar([
            saudeDe({
                situacao: SITUACAO_PIPELINE.PARADO,
                idadeDesdeUltimoSucessoMs: LIMITE_RECEB * 2,
                ultimaRun: runDe({ status: JOB_RUN_STATUS.ERROR }) as never,
            }),
        ]);

        await detector.detectar(AGORA);
        expect(emitidos.map((e) => e.tipo).sort()).toEqual(
            [ALERTA_TIPO.JOB_FALHOU, ALERTA_TIPO.JOB_PARADO].sort(),
        );
    });
});

describe('StalenessDetector — janela de dedup', () => {
    it('mesma janela para duas rodadas dentro do mesmo bloco de limite', async () => {
        const parado = saudeDe({
            situacao: SITUACAO_PIPELINE.PARADO,
            idadeDesdeUltimoSucessoMs: LIMITE_RECEB * 2,
        });

        const a = montar([parado]);
        await a.detector.detectar(new Date('2026-09-01T12:00:00.000Z'));
        const b = montar([parado]);
        await b.detector.detectar(new Date('2026-09-01T13:59:00.000Z'));

        // Detector a cada 15min sobre limite de 3h: 1 alerta por bloco, não 12.
        expect(a.emitidos[0].janelaInicio.toISOString()).toBe(
            b.emitidos[0].janelaInicio.toISOString(),
        );
    });

    it('janela NOVA quando o bloco vira — parado há muito merece ser dito de novo', async () => {
        const parado = saudeDe({
            situacao: SITUACAO_PIPELINE.PARADO,
            idadeDesdeUltimoSucessoMs: LIMITE_RECEB * 3,
        });

        const a = montar([parado]);
        await a.detector.detectar(new Date('2026-09-01T11:00:00.000Z'));
        const b = montar([parado]);
        await b.detector.detectar(new Date('2026-09-01T15:00:00.000Z'));

        expect(a.emitidos[0].janelaInicio.toISOString()).not.toBe(
            b.emitidos[0].janelaInicio.toISOString(),
        );
    });

    it('a janela do job-falhou é a RUN, não o relógio — a mesma falha não realerta', async () => {
        const comFalha = saudeDe({
            ultimaRun: runDe({ status: JOB_RUN_STATUS.ERROR }) as never,
        });

        const a = montar([comFalha]);
        await a.detector.detectar(new Date('2026-09-01T12:00:00.000Z'));
        const b = montar([comFalha]);
        await b.detector.detectar(new Date('2026-09-01T18:00:00.000Z'));

        expect(a.emitidos[0].janelaInicio.toISOString()).toBe(
            b.emitidos[0].janelaInicio.toISOString(),
        );
    });
});

describe('StalenessDetector — resultado', () => {
    it('conta só os alertas efetivamente criados (dedup devolve null)', async () => {
        const readModel = {
            exporSaude: jest.fn().mockResolvedValue([
                saudeDe({
                    situacao: SITUACAO_PIPELINE.PARADO,
                    idadeDesdeUltimoSucessoMs: LIMITE_RECEB * 2,
                }),
            ]),
        };
        const notif = { emitir: jest.fn().mockResolvedValue(null) }; // suprimido pela dedup
        const detector = new StalenessDetector(readModel as never, notif as never);

        const r = await detector.detectar(AGORA);
        expect(r.emitidos).toEqual([]);
        expect(r.verificadoEm).toBe(AGORA.toISOString());
    });

    it('inspeciona todos os pipelines, inclusive os que não alertaram', async () => {
        const { detector } = montar([
            saudeDe({ pipeline: PIPELINE.PERMUTAS_ELEICAO, situacao: SITUACAO_PIPELINE.OK }),
            saudeDe({ pipeline: PIPELINE.SISPAG_REAPER, situacao: SITUACAO_PIPELINE.SEM_TRILHA }),
        ]);

        const r = await detector.detectar(AGORA);
        expect(r.inspecionados).toHaveLength(2);
    });
});

describe('StalenessDetector — o erro da run não vaza credencial (achado de segurança)', () => {
    it('redige a mensagem de erro antes de gravá-la em alerta.detalhe', async () => {
        const { detector, emitidos } = montar([
            saudeDe({
                ultimaRun: runDe({
                    status: JOB_RUN_STATUS.ERROR,
                    errorMessage:
                        'connect failed: postgresql://financeiro:s3nh4Secreta@db:5432/fin — ' +
                        'password authentication failed for user "financeiro"',
                }) as never,
            }),
        ]);

        await detector.detectar(AGORA);

        const serializado = JSON.stringify(emitidos);
        expect(serializado).not.toContain('s3nh4Secreta');
        expect(serializado).not.toContain('"financeiro"');
        // Mas o operador ainda precisa saber QUE falhou e onde.
        expect(serializado).toContain('connect failed');
    });

    it('omite o campo `erro` quando a run não trouxe mensagem', async () => {
        const { detector, emitidos } = montar([
            saudeDe({ ultimaRun: runDe({ status: JOB_RUN_STATUS.ERROR }) as never }),
        ]);

        await detector.detectar(AGORA);
        expect(
            (emitidos[0] as unknown as { detalhe: Record<string, unknown> }).detalhe,
        ).not.toHaveProperty('erro');
    });
});

describe('StalenessDetector — isolamento por pipeline (F-avail-3)', () => {
    it('uma pipeline que explode ao emitir NÃO impede a inspeção das seguintes', async () => {
        const readModel = {
            exporSaude: jest.fn().mockResolvedValue([
                saudeDe({
                    pipeline: PIPELINE.PERMUTAS_ELEICAO,
                    situacao: SITUACAO_PIPELINE.PARADO,
                    idadeDesdeUltimoSucessoMs: LIMITE_RECEB * 2,
                }),
                saudeDe({
                    pipeline: PIPELINE.SISPAG_PAGAMENTOS,
                    situacao: SITUACAO_PIPELINE.PARADO,
                    idadeDesdeUltimoSucessoMs: LIMITE_RECEB * 2,
                }),
            ]),
        };
        const notif = {
            emitir: jest
                .fn()
                .mockRejectedValueOnce(new Error('pool exausto'))
                .mockResolvedValueOnce({ id: 2, tipo: 'job-parado', alvo: 'x' }),
        };
        const detector = new StalenessDetector(readModel as never, notif as never);

        const r = await detector.detectar(AGORA);

        // A segunda pipeline foi inspecionada apesar de a primeira ter explodido — sem isto, um
        // defeito em permutas cegaria SISPAG na mesma rodada.
        expect(notif.emitir).toHaveBeenCalledTimes(2);
        expect(r.emitidos).toHaveLength(1);
        expect(r.inspecionados).toHaveLength(2);
    });
});
