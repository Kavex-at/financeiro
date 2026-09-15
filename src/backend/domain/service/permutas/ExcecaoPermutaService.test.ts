import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import ExcecaoPermutaRecusadaError from '../../errors/ExcecaoPermutaRecusadaError.js';
import type Adiantamento from '../../interface/permutas/Adiantamento.js';
import {
    ESTADO_ELEGIBILIDADE,
    type EstadoElegibilidade,
    MOTIVO_BLOQUEIO,
    type MotivoBloqueio,
} from '../../interface/permutas/EstadoElegibilidade.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';
import { GATE } from '../../interface/permutas/PermutaCandidata.js';
import type ExcecaoPermutaRepository from '../../repository/permutas/ExcecaoPermutaRepository.js';
import type {
    AdiantamentoAtivo,
    default as PermutaRelationalRepository,
} from '../../repository/permutas/PermutaRelationalRepository.js';
import type LogService from '../LogService.js';
import ExcecaoPermutaService from './ExcecaoPermutaService.js';

const buildService = () =>
    new ExcecaoPermutaService(
        {} as unknown as PostgreeDatabaseClient,
        {} as unknown as PermutaRelationalRepository,
        {} as unknown as ExcecaoPermutaRepository,
        { info: jest.fn(), warn: jest.fn() } as unknown as LogService,
    );

const adto8721: Adiantamento = {
    docCod: '8721',
    priCod: '124',
    filCod: 2,
    dataEmissao: new Date('2026-01-10'),
    valor: 20373009.89,
    moeda: 'USD',
    pago: true,
    valorPermutar: 0,
    valorAberto: 0.02,
};

const gates8721 = [
    { gate: GATE.PROFORMA, passed: true },
    { gate: GATE.VALOR_PERMUTAR, passed: false, detail: 'sem saldo' },
    { gate: GATE.TOTALMENTE_PAGO, passed: true },
];

const candidata = (
    estado: EstadoElegibilidade,
    motivo?: MotivoBloqueio,
    over: Partial<Adiantamento> = {},
): PermutaCandidata => ({
    priCod: '124',
    adiantamento: { ...adto8721, ...over },
    estadoElegibilidade: estado,
    ...(motivo !== undefined ? { motivoBloqueio: motivo } : {}),
    gatesAvaliados: gates8721,
});

describe('ExcecaoPermutaService', () => {
    describe('guardaSatisfeita', () => {
        it('só BLOQUEADA + sem-saldo-permutar satisfaz a guarda', () => {
            const service = buildService();
            expect(
                service.guardaSatisfeita(
                    ESTADO_ELEGIBILIDADE.BLOQUEADA,
                    MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
                ),
            ).toBe(true);
            expect(
                service.guardaSatisfeita(ESTADO_ELEGIBILIDADE.BLOQUEADA, MOTIVO_BLOQUEIO.NAO_PAGO),
            ).toBe(false);
            expect(
                service.guardaSatisfeita(
                    ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                    MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
                ),
            ).toBe(false);
            expect(service.guardaSatisfeita(ESTADO_ELEGIBILIDADE.ELEGIVEL)).toBe(false);
        });
    });

    describe('aplicarExcecoes', () => {
        it('8721 sem saldo + exceção ativa → JA_PERMUTADO / permutado-fora-do-painel, gates intactos', () => {
            const service = buildService();
            const original = candidata(
                ESTADO_ELEGIBILIDADE.BLOQUEADA,
                MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
            );

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set(['8721']));

            expect(avisos).toEqual([]);
            expect(candidatas[0].estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.JA_PERMUTADO);
            expect(candidatas[0].motivoBloqueio).toBe(MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL);
            // Auditoria dos gates: o Gate 2 segue reprovado — a exceção só troca a classificação.
            expect(candidatas[0].gatesAvaliados).toEqual(gates8721);
            expect(
                candidatas[0].gatesAvaliados.find((g) => g.gate === GATE.VALOR_PERMUTAR)?.passed,
            ).toBe(false);
            // Não muta a candidata recebida.
            expect(original.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        });

        it('mesma candidata SEM exceção → inalterada (mesma referência)', () => {
            const service = buildService();
            const original = candidata(
                ESTADO_ELEGIBILIDADE.BLOQUEADA,
                MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
            );

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set());

            expect(candidatas[0]).toBe(original);
            expect(avisos).toEqual([]);
        });

        it.each([
            [ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL, MOTIVO_BLOQUEIO.CLIENTE_FILTRO],
            [ESTADO_ELEGIBILIDADE.BLOQUEADA, MOTIVO_BLOQUEIO.NAO_PAGO],
        ])('exceção ativa + calculado %s/%s → o cálculo vence e emite aviso', (estado, motivo) => {
            const service = buildService();
            const original = candidata(estado, motivo, { valorPermutar: 5000 });

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set(['8721']));

            expect(candidatas[0]).toBe(original);
            expect(avisos).toEqual([
                {
                    docCod: '8721',
                    estadoCalculado: estado,
                    motivoCalculado: motivo,
                    transiente: false,
                },
            ]);
        });

        it('exceção ativa + calculado ja-permutado (valorPermutado > 0) → o motivo do ERP vence', () => {
            const service = buildService();
            const original = candidata(
                ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                MOTIVO_BLOQUEIO.JA_PERMUTADO,
                { valorPermutado: 20373009.87 },
            );

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set(['8721']));

            expect(candidatas[0].motivoBloqueio).toBe(MOTIVO_BLOQUEIO.JA_PERMUTADO);
            expect(avisos).toHaveLength(1);
            expect(avisos[0]).toMatchObject({
                docCod: '8721',
                estadoCalculado: ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                motivoCalculado: MOTIVO_BLOQUEIO.JA_PERMUTADO,
                transiente: false,
            });
        });

        it('exceção ativa + detail-indisponivel → mantém o calculado e marca o aviso como transiente', () => {
            const service = buildService();
            const original = candidata(
                ESTADO_ELEGIBILIDADE.BLOQUEADA,
                MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL,
            );

            const { candidatas, avisos } = service.aplicarExcecoes([original], new Set(['8721']));

            expect(candidatas[0]).toBe(original);
            expect(avisos).toEqual([
                {
                    docCod: '8721',
                    estadoCalculado: ESTADO_ELEGIBILIDADE.BLOQUEADA,
                    motivoCalculado: MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL,
                    transiente: true,
                },
            ]);
        });

        it('exceções de docCod sem candidata na run → ignoradas, sem aviso nem erro', () => {
            const service = buildService();
            const outro = candidata(
                ESTADO_ELEGIBILIDADE.BLOQUEADA,
                MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
                { docCod: '9999' },
            );

            const { candidatas, avisos } = service.aplicarExcecoes(
                [outro],
                new Set(['8721', '5555']),
            );

            expect(candidatas).toEqual([outro]);
            expect(avisos).toEqual([]);
        });
    });

    // ─── marcar / desfazer (efeito imediato na linha, na MESMA transação) ─────────
    describe('marcar e desfazer', () => {
        const linha = (over: Partial<AdiantamentoAtivo> = {}): AdiantamentoAtivo => ({
            docCod: '8721',
            priCod: '124',
            filCod: 2,
            pago: true,
            estadoElegibilidade: 'bloqueada',
            motivoBloqueio: 'sem-saldo-permutar',
            stale: false,
            ...over,
        });

        const JUSTIFICATIVA = 'Baixas cruzadas 21 x 198 em 30/04 com a invoice 7329';

        const montar = (opts: {
            adto?: AdiantamentoAtivo | null;
            ativa?: boolean;
            reclassificadas?: number;
            removidas?: number;
            insertError?: unknown;
        }) => {
            const tx = {
                insert: jest.fn(),
                update: jest.fn(),
                selectMany: jest.fn(),
                selectFirst: jest.fn(),
            } as unknown as jest.Mocked<TransactionClient>;
            const db = {
                withTransaction: jest.fn(async (fn: (t: TransactionClient) => Promise<unknown>) =>
                    fn(tx),
                ),
            } as unknown as jest.Mocked<PostgreeDatabaseClient>;
            const relational = {
                findAdiantamento: jest
                    .fn()
                    .mockResolvedValue(opts.adto === undefined ? linha() : opts.adto),
                reclassificarAdiantamento: jest.fn().mockResolvedValue(opts.reclassificadas ?? 1),
            } as unknown as jest.Mocked<PermutaRelationalRepository>;
            const excecaoRepo = {
                findAtiva: jest.fn().mockResolvedValue(
                    opts.ativa
                        ? {
                              id: '1',
                              adiantamentoDocCod: '8721',
                              justificativa: JUSTIFICATIVA,
                              criadoPor: 'user-abc',
                              criadoEm: new Date(),
                          }
                        : null,
                ),
                insertAtiva:
                    opts.insertError !== undefined
                        ? jest.fn().mockRejectedValue(opts.insertError)
                        : jest.fn().mockResolvedValue(undefined),
                softDeleteAtiva: jest.fn().mockResolvedValue(opts.removidas ?? 1),
            } as unknown as jest.Mocked<ExcecaoPermutaRepository>;
            const log = {
                info: jest.fn().mockResolvedValue(undefined),
                warn: jest.fn().mockResolvedValue(undefined),
            } as unknown as jest.Mocked<LogService>;
            const service = new ExcecaoPermutaService(db, relational, excecaoRepo, log);
            return { service, tx, db, relational, excecaoRepo, log };
        };

        const statusDoErro = async (p: Promise<unknown>) => {
            const erro = await p.then(
                () => null,
                (e: unknown) => e,
            );
            expect(erro).toBeInstanceOf(ExcecaoPermutaRecusadaError);
            return erro as ExcecaoPermutaRecusadaError;
        };

        describe('marcar', () => {
            it('bloqueada/sem-saldo-permutar → insertAtiva + reclassificação na MESMA transação', async () => {
                const { service, tx, db, relational, excecaoRepo, log } = montar({});

                await service.marcar({
                    docCod: '8721',
                    justificativa: JUSTIFICATIVA,
                    criadoPor: 'user-abc',
                });

                expect(db.withTransaction).toHaveBeenCalledTimes(1);
                expect(excecaoRepo.insertAtiva).toHaveBeenCalledWith(tx, {
                    adiantamentoDocCod: '8721',
                    justificativa: JUSTIFICATIVA,
                    criadoPor: 'user-abc',
                });
                expect(relational.reclassificarAdiantamento).toHaveBeenCalledWith(tx, {
                    docCod: '8721',
                    de: {
                        estado: ESTADO_ELEGIBILIDADE.BLOQUEADA,
                        motivo: MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
                    },
                    para: {
                        estado: ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                        motivo: MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL,
                    },
                });
                // Auditoria: docCod + autor, SEM a justificativa inteira no log.
                expect(log.info).toHaveBeenCalledTimes(1);
                const entrada = (log.info as jest.Mock).mock.calls[0][0];
                expect(entrada.data).toMatchObject({ docCod: '8721', criadoPor: 'user-abc' });
                expect(JSON.stringify(entrada)).not.toContain(JUSTIFICATIVA);
            });

            it.each([
                ['bloqueada', 'nao-pago'],
                ['bloqueada', 'data-base-indisponivel'],
                ['elegivel', undefined],
                ['permuta-manual', 'cliente-filtro'],
                ['ja-permutado', 'ja-permutado'],
            ] as const)('linha %s/%s → 422 com o rótulo do motivo, sem transação', async (estado, motivo) => {
                const { service, db, excecaoRepo } = montar({
                    adto: linha({
                        estadoElegibilidade: estado,
                        ...(motivo !== undefined ? { motivoBloqueio: motivo } : {}),
                    }),
                });

                const erro = await statusDoErro(
                    service.marcar({
                        docCod: '8721',
                        justificativa: JUSTIFICATIVA,
                        criadoPor: 'u',
                    }),
                );

                expect(erro.statusCode).toBe(422);
                expect(erro.code).toBe('EXCECAO_GUARDA_RECUSADA');
                expect(erro.userMessage).toContain('Sem saldo a permutar');
                expect(db.withTransaction).not.toHaveBeenCalled();
                expect(excecaoRepo.insertAtiva).not.toHaveBeenCalled();
            });

            it('cita o motivo atual pelo rótulo (ex.: "Não totalmente pago")', async () => {
                const { service } = montar({ adto: linha({ motivoBloqueio: 'nao-pago' }) });

                const erro = await statusDoErro(
                    service.marcar({
                        docCod: '8721',
                        justificativa: JUSTIFICATIVA,
                        criadoPor: 'u',
                    }),
                );

                expect(erro.userMessage).toContain('Não totalmente pago');
            });

            it.each([
                ['inexistente', null],
                ['stale', linha({ stale: true })],
            ])('adiantamento %s → 404', async (_caso, adto) => {
                const { service, db } = montar({ adto });

                const erro = await statusDoErro(
                    service.marcar({
                        docCod: '8721',
                        justificativa: JUSTIFICATIVA,
                        criadoPor: 'u',
                    }),
                );

                expect(erro.statusCode).toBe(404);
                expect(erro.code).toBe('ADIANTAMENTO_NAO_ENCONTRADO');
                expect(db.withTransaction).not.toHaveBeenCalled();
            });

            it('exceção já ativa (findAtiva) → 409 sem transação', async () => {
                const { service, db } = montar({ ativa: true });

                const erro = await statusDoErro(
                    service.marcar({
                        docCod: '8721',
                        justificativa: JUSTIFICATIVA,
                        criadoPor: 'u',
                    }),
                );

                expect(erro.statusCode).toBe(409);
                expect(erro.code).toBe('EXCECAO_JA_ATIVA');
                expect(db.withTransaction).not.toHaveBeenCalled();
            });

            it('violação 23505 do índice parcial dentro da tx (corrida) → 409', async () => {
                const unique = Object.assign(new Error('duplicate key value'), { code: '23505' });
                const { service, relational } = montar({ insertError: unique });

                const erro = await statusDoErro(
                    service.marcar({
                        docCod: '8721',
                        justificativa: JUSTIFICATIVA,
                        criadoPor: 'u',
                    }),
                );

                expect(erro.statusCode).toBe(409);
                expect(relational.reclassificarAdiantamento).not.toHaveBeenCalled();
            });

            it('outro erro de banco no insert não vira 409 (propaga cru)', async () => {
                const boom = new Error('connection reset');
                const { service } = montar({ insertError: boom });

                await expect(
                    service.marcar({
                        docCod: '8721',
                        justificativa: JUSTIFICATIVA,
                        criadoPor: 'u',
                    }),
                ).rejects.toBe(boom);
            });

            it('reclassificação concorrente (0 linhas) → erro DENTRO da tx (rollback) e 422', async () => {
                const { service, db, excecaoRepo } = montar({ reclassificadas: 0 });
                let lancouDentroDaTx = false;
                (db.withTransaction as jest.Mock).mockImplementation(
                    async (fn: (t: TransactionClient) => Promise<unknown>) => {
                        try {
                            return await fn({} as TransactionClient);
                        } catch (e) {
                            lancouDentroDaTx = true;
                            throw e;
                        }
                    },
                );

                const erro = await statusDoErro(
                    service.marcar({
                        docCod: '8721',
                        justificativa: JUSTIFICATIVA,
                        criadoPor: 'u',
                    }),
                );

                expect(erro.statusCode).toBe(422);
                expect(lancouDentroDaTx).toBe(true);
                expect(excecaoRepo.insertAtiva).toHaveBeenCalledTimes(1);
            });
        });

        describe('desfazer', () => {
            it('exceção aplicada → soft delete + volta a bloqueada/sem-saldo-permutar na MESMA tx', async () => {
                const { service, tx, db, relational, excecaoRepo, log } = montar({});

                await service.desfazer({ docCod: '8721', removidoPor: 'user-abc' });

                expect(db.withTransaction).toHaveBeenCalledTimes(1);
                expect(excecaoRepo.softDeleteAtiva).toHaveBeenCalledWith(tx, {
                    adiantamentoDocCod: '8721',
                    removidoPor: 'user-abc',
                });
                expect(relational.reclassificarAdiantamento).toHaveBeenCalledWith(tx, {
                    docCod: '8721',
                    de: {
                        estado: ESTADO_ELEGIBILIDADE.JA_PERMUTADO,
                        motivo: MOTIVO_BLOQUEIO.PERMUTADO_FORA_DO_PAINEL,
                    },
                    para: {
                        estado: ESTADO_ELEGIBILIDADE.BLOQUEADA,
                        motivo: MOTIVO_BLOQUEIO.SEM_SALDO_PERMUTAR,
                    },
                });
                expect(log.info).toHaveBeenCalledTimes(1);
                expect((log.info as jest.Mock).mock.calls[0][0].data).toMatchObject({
                    docCod: '8721',
                    removidoPor: 'user-abc',
                });
            });

            it('exceção INATIVA (linha em outro estado) → só o soft delete; 0 reclassificadas não é erro', async () => {
                const { service, excecaoRepo } = montar({ reclassificadas: 0 });

                await expect(
                    service.desfazer({ docCod: '8721', removidoPor: 'user-abc' }),
                ).resolves.toBeUndefined();
                expect(excecaoRepo.softDeleteAtiva).toHaveBeenCalledTimes(1);
            });

            it('sem exceção ativa → 404', async () => {
                const { service, relational } = montar({ removidas: 0 });

                const erro = await statusDoErro(
                    service.desfazer({ docCod: '8721', removidoPor: 'user-abc' }),
                );

                expect(erro.statusCode).toBe(404);
                expect(erro.code).toBe('EXCECAO_NAO_ENCONTRADA');
                expect(relational.reclassificarAdiantamento).not.toHaveBeenCalled();
            });
        });
    });
});
