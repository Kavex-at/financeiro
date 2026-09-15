import 'reflect-metadata';
import type ConexosCadastroClient from '../../client/ConexosCadastroClient.js';
import type ConexosFinanceiroClient from '../../client/ConexosFinanceiroClient.js';
import type ConexosTitulosClient from '../../client/ConexosTitulosClient.js';
import AlocacaoSaldoError from '../../errors/AlocacaoSaldoError.js';
import AlocacaoEmBorderoError from '../../errors/AlocacaoEmBorderoError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type PermutaAlocacaoRepository from '../../repository/permutas/PermutaAlocacaoRepository.js';
import type PermutaExecucaoRepository from '../../repository/permutas/PermutaExecucaoRepository.js';
import type PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import type LogService from '../LogService.js';
import AlocacaoPermutasService from './AlocacaoPermutasService.js';
import VariacaoCambialPermutaService from './VariacaoCambialPermutaService.js';

const log = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as LogService;

/**
 * Combined Conexos mock — the CC-2 split moved the methods used here across
 * three sub-clients (Financeiro/Cadastro/Titulos). The test fakes them all on
 * a single object and injects it into each sub-client slot.
 */
type PublicShape<T> = { [K in keyof T]: T[K] };
type ConexosMock = PublicShape<ConexosFinanceiroClient> &
    PublicShape<ConexosCadastroClient> &
    PublicShape<ConexosTitulosClient>;

const buildConexos = (over: Partial<jest.Mocked<ConexosMock>> = {}) =>
    ({
        listFiliais: jest.fn().mockResolvedValue([{ filCod: 2 }, { filCod: 4 }]),
        listFinanceiroAPagar: jest
            .fn()
            .mockImplementation(async ({ filCod }: { filCod: number }) =>
                filCod === 2
                    ? {
                          proformas: [],
                          invoices: [
                              {
                                  docCod: 'I7',
                                  priCod: '510',
                                  moeda: 'USD',
                                  valor: 4000,
                                  pago: false,
                                  referencia: 'INV/7',
                              },
                              {
                                  // já paga (liquidada) → deve ser FILTRADA da busca.
                                  docCod: 'I8-PAGA',
                                  priCod: '510',
                                  moeda: 'USD',
                                  valor: 1000,
                                  pago: true,
                                  referencia: 'INV/8',
                              },
                          ],
                      }
                    : { proformas: [], invoices: [] },
            ),
        listDeclaracaoByProcesso: jest
            .fn()
            .mockResolvedValue([
                { variante: 'DI', priCod: '510', dataBase: new Date('2026-02-10') },
            ]),
        listTitulosAPagar: jest
            .fn()
            .mockResolvedValue([{ valorNegociado: 800, taxa: 5.3, moedaNome: 'USD' }]),
        // EM ABERTO via detalhe (lista é inconfiável p/ pago): I7 aberta, I8-PAGA paga.
        getDetalheTitulos: jest.fn().mockImplementation(async ({ docCod }: { docCod: string }) => ({
            pago: docCod === 'I8-PAGA',
            valorAberto: docCod === 'I8-PAGA' ? 0 : 4000,
        })),
        ...over,
    }) as unknown as ConexosMock;

const buildAlocacaoRepo = (sums: { adto?: number; invoice?: number } = {}) => {
    const upsertAlocacao = jest.fn().mockResolvedValue(undefined);
    return {
        repo: {
            upsertAlocacao,
            sumByAdiantamento: jest.fn().mockResolvedValue(sums.adto ?? 0),
            sumByInvoice: jest.fn().mockResolvedValue(sums.invoice ?? 0),
            deleteAlocacao: jest.fn().mockResolvedValue(1),
        } as unknown as jest.Mocked<PermutaAlocacaoRepository>,
        upsertAlocacao,
    };
};

// adto: saldo a permutar 5500 BRL / taxa 5.5 = 1000 USD negociado.
const buildRelational = (
    over: {
        valorPermutar?: number;
        taxa?: number;
        priCod?: string;
        estado?: 'permuta-manual' | 'casamento-manual';
    } = {},
) =>
    ({
        findAdiantamento: jest.fn().mockResolvedValue({
            docCod: 'A9',
            priCod: over.priCod ?? '1153',
            filCod: 2,
            pago: true,
            valorPermutar: over.valorPermutar ?? 5500,
            taxa: over.taxa ?? 5.5,
            moedaNegociada: 'USD',
            estadoElegibilidade: over.estado ?? 'permuta-manual',
            stale: false,
        }),
    }) as unknown as jest.Mocked<PermutaRelationalRepository>;

const build = (opts: {
    conexos?: ConexosMock;
    sums?: { adto?: number; invoice?: number };
    relational?: jest.Mocked<PermutaRelationalRepository>;
    borCodDoPar?: number | null;
}) => {
    const { repo, upsertAlocacao } = buildAlocacaoRepo(opts.sums);
    const borderoDoPar = jest.fn().mockResolvedValue(opts.borCodDoPar ?? null);
    const execucaoRepo = { borderoDoPar } as unknown as jest.Mocked<PermutaExecucaoRepository>;
    const conexos = opts.conexos ?? buildConexos();
    const service = new AlocacaoPermutasService(
        conexos as unknown as ConexosFinanceiroClient,
        conexos as unknown as ConexosCadastroClient,
        conexos as unknown as ConexosTitulosClient,
        new VariacaoCambialPermutaService(),
        repo,
        execucaoRepo,
        opts.relational ?? buildRelational(),
        log(),
        new BoundedConcurrency(),
    );
    return { service, upsertAlocacao, repo, borderoDoPar };
};

describe('AlocacaoPermutasService', () => {
    it('buscarInvoices (escopada à filial) filtra em-aberto, enriquece e marca temDi', async () => {
        const { service } = build({});
        const invoices = await service.buscarInvoices('510', 2);
        // Só a invoice EM ABERTO (I7); a já paga (I8-PAGA) é filtrada.
        expect(invoices).toHaveLength(1);
        expect(invoices.some((i) => i.docCod === 'I8-PAGA')).toBe(false);
        expect(invoices[0]).toMatchObject({
            docCod: 'I7',
            priCod: '510',
            filCod: 2,
            valorMoedaNegociada: 800,
            taxa: 5.3,
            temDi: true,
            jaAlocado: 0,
        });
        expect(invoices[0].dataBase).toBeDefined();
    });

    it('buscarInvoices: INVOICE com R$ 0,02 em aberto segue EM ABERTO (tolerância é só do adto, ADR-0046)', async () => {
        const conexos = buildConexos({
            // Wire estrito: `pago` do detalhe = (valorAberto === 0) ⇒ 0,02 ⇒ false.
            getDetalheTitulos: jest.fn().mockImplementation(async ({ docCod }) => ({
                pago: docCod === 'I8-PAGA',
                valorAberto: docCod === 'I8-PAGA' ? 0 : 0.02,
            })),
        } as Partial<jest.Mocked<ConexosMock>>);
        const { service } = build({ conexos });
        const invoices = await service.buscarInvoices('510', 2);
        expect(invoices.map((i) => i.docCod)).toEqual(['I7']);
    });

    it('buscarInvoices reporta jaAlocado (consumo de OUTROS adtos) e exclui o próprio', async () => {
        // 300 já alocados na invoice por outros adiantamentos.
        const { repo } = buildAlocacaoRepo({ invoice: 300 });
        const conexos = buildConexos();
        const service = new AlocacaoPermutasService(
            conexos as unknown as ConexosFinanceiroClient,
            conexos as unknown as ConexosCadastroClient,
            conexos as unknown as ConexosTitulosClient,
            new VariacaoCambialPermutaService(),
            repo,
            {
                borderoDoPar: jest.fn().mockResolvedValue(null),
            } as unknown as jest.Mocked<PermutaExecucaoRepository>,
            buildRelational(),
            log(),
            new BoundedConcurrency(),
        );
        const invoices = await service.buscarInvoices('510', 2, 'A9');
        expect(invoices[0].jaAlocado).toBe(300);
        // disponível = valorMoedaNegociada(800) − jaAlocado(300) = 500.
        expect((invoices[0].valorMoedaNegociada ?? 0) - invoices[0].jaAlocado).toBe(500);
        // o próprio adiantamento (A9) é EXCLUÍDO do somatório.
        expect(repo.sumByInvoice).toHaveBeenCalledWith('I7', 'A9');
    });

    it('alocar grava com variação recalculada pela taxa da invoice (valor parcial)', async () => {
        const { service, upsertAlocacao } = build({});
        await service.alocar({
            adiantamentoDocCod: 'A9',
            invoiceDocCod: 'I7',
            invoicePriCod: '510',
            valorAlocado: 600,
            criadoPor: 'simone',
        });
        expect(upsertAlocacao).toHaveBeenCalledTimes(1);
        const arg = upsertAlocacao.mock.calls[0][0];
        expect(arg).toMatchObject({
            adiantamentoDocCod: 'A9',
            invoiceDocCod: 'I7',
            valorAlocado: 600,
        });
        // delta = 600 × (5.5 − 5.3) = 120 → JUROS.
        expect(arg.variacaoClassificacao).toBe('JUROS');
        expect(arg.variacaoResultado).toBeCloseTo(120, 5);
    });

    it('alocar excede saldo do ADIANTAMENTO → AlocacaoSaldoError', async () => {
        // saldo adto = 1000 USD; pedir 1200.
        const { service } = build({});
        await expect(
            service.alocar({
                adiantamentoDocCod: 'A9',
                invoiceDocCod: 'I7',
                invoicePriCod: '510',
                valorAlocado: 1200,
            } as never),
        ).rejects.toBeInstanceOf(AlocacaoSaldoError);
    });

    it('alocar excede saldo da INVOICE → AlocacaoSaldoError', async () => {
        // invoice saldo = 800 USD; adto folgado (saldo alto). Pedir 900.
        const { service } = build({
            relational: buildRelational({ valorPermutar: 999999, taxa: 1 }),
        });
        await expect(
            service.alocar({
                adiantamentoDocCod: 'A9',
                invoiceDocCod: 'I7',
                invoicePriCod: '510',
                valorAlocado: 900,
                criadoPor: 'u',
            }),
        ).rejects.toBeInstanceOf(AlocacaoSaldoError);
    });

    it('alocar (casamento-manual) rejeita invoice de OUTRO processo (same-process)', async () => {
        // adto casamento-manual no processo 1153; tentar alocar invoice do processo 510.
        const { service } = build({
            relational: buildRelational({ estado: 'casamento-manual', priCod: '1153' }),
        });
        await expect(
            service.alocar({
                adiantamentoDocCod: 'A9',
                invoiceDocCod: 'I7',
                invoicePriCod: '510',
                valorAlocado: 100,
                criadoPor: 'u',
            }),
        ).rejects.toThrow(/same-process/);
    });

    it('alocar rejeita moeda divergente (adto USD × invoice BRL)', async () => {
        // invoice negociada em BRL (moedaNome BRL) vs adto USD → mismatch.
        const conexos = buildConexos({
            listTitulosAPagar: jest
                .fn()
                .mockResolvedValue([{ valorNegociado: 1000, taxa: 1, moedaNome: 'BRL' }]),
        } as Partial<jest.Mocked<ConexosMock>>);
        const { service } = build({ conexos }); // adto moedaNegociada 'USD' (default)
        await expect(
            service.alocar({
                adiantamentoDocCod: 'A9',
                invoiceDocCod: 'I7',
                invoicePriCod: '510',
                valorAlocado: 100,
                criadoPor: 'u',
            }),
        ).rejects.toThrow(/currency mismatch/);
    });

    it('alocar rejeita invoice SEM D.I/DUIMP', async () => {
        const conexos = buildConexos({
            listDeclaracaoByProcesso: jest.fn().mockResolvedValue([]), // sem D.I
        } as Partial<jest.Mocked<ConexosMock>>);
        const { service } = build({ conexos });
        await expect(
            service.alocar({
                adiantamentoDocCod: 'A9',
                invoiceDocCod: 'I7',
                invoicePriCod: '510',
                valorAlocado: 100,
                criadoPor: 'u',
            }),
        ).rejects.toThrow(/D\.I/);
    });

    // ───────────────── Auto-alocação (regra 2026-06-24 — baixa real no fin010) ─────────────────
    describe('remover (trava de integridade: alocação usada em borderô)', () => {
        it('RECUSA remover quando a alocação já abriu borderô (lança AlocacaoEmBorderoError, NÃO deleta)', async () => {
            const { service, repo, borderoDoPar } = build({ borCodDoPar: 2039 });
            await expect(service.remover('4061', '4117')).rejects.toBeInstanceOf(
                AlocacaoEmBorderoError,
            );
            expect(borderoDoPar).toHaveBeenCalledWith('4061', '4117');
            expect(repo.deleteAlocacao).not.toHaveBeenCalled();
        });

        it('REMOVE quando não há borderô para o par (borderoDoPar null) — ex.: depois de excluir o borderô', async () => {
            const { service, repo, borderoDoPar } = build({ borCodDoPar: null });
            await service.remover('4061', '4117');
            expect(borderoDoPar).toHaveBeenCalledWith('4061', '4117');
            expect(repo.deleteAlocacao).toHaveBeenCalledWith('4061', '4117');
        });
    });

    describe('autoAlocarSeElegivel / autoAlocarDeCasamento', () => {
        const buildAuto = (opts: {
            valorPermutar?: number;
            ativas?: Array<{ adiantamentoDocCod: string }>;
            ativosProcesso?: Array<{ priCod: string; estadoElegibilidade: string }>;
            casamentos?: Array<{
                adiantamentoDocCod: string;
                invoiceDocCod: string;
                priCod: string;
                valorASerUsado?: number;
            }>;
            conexos?: ConexosMock;
        }) => {
            const upsertAlocacao = jest.fn().mockResolvedValue(undefined);
            const deleteAlocacao = jest.fn().mockResolvedValue(1);
            const alocacaoRepo = {
                upsertAlocacao,
                deleteAlocacao,
                sumByAdiantamento: jest.fn().mockResolvedValue(0),
                sumByInvoice: jest.fn().mockResolvedValue(0),
                listAtivas: jest.fn().mockResolvedValue(opts.ativas ?? []),
            } as unknown as jest.Mocked<PermutaAlocacaoRepository>;
            const relational = {
                findAdiantamento: jest.fn().mockResolvedValue({
                    docCod: 'A9',
                    priCod: '510',
                    filCod: 2,
                    pago: true,
                    valorPermutar: opts.valorPermutar ?? 5500, // /5.5 = 1000 USD negociado
                    taxa: 5.5,
                    moedaNegociada: 'USD',
                    estadoElegibilidade: 'casamento-manual',
                    stale: false,
                }),
                listAdiantamentosAtivos: jest
                    .fn()
                    .mockResolvedValue(
                        opts.ativosProcesso ?? [
                            { priCod: '510', estadoElegibilidade: 'casamento-manual' },
                        ],
                    ),
                listCasamentos: jest.fn().mockResolvedValue(opts.casamentos ?? []),
            } as unknown as jest.Mocked<PermutaRelationalRepository>;
            const execucaoRepo = {
                borderoDoPar: jest.fn().mockResolvedValue(null),
            } as unknown as jest.Mocked<PermutaExecucaoRepository>;
            const conexos = opts.conexos ?? buildConexos();
            const service = new AlocacaoPermutasService(
                conexos as unknown as ConexosFinanceiroClient,
                conexos as unknown as ConexosCadastroClient,
                conexos as unknown as ConexosTitulosClient,
                new VariacaoCambialPermutaService(),
                alocacaoRepo,
                execucaoRepo,
                relational,
                log(),
                new BoundedConcurrency(),
            );
            return { service, upsertAlocacao, deleteAlocacao };
        };

        it('múltipla automática (saldo cobre as invoices) → aloca e retorna true', async () => {
            const { service, upsertAlocacao } = buildAuto({ valorPermutar: 5500 }); // 1000 USD ≥ 800
            const ok = await service.autoAlocarSeElegivel('A9', 'sys');
            expect(ok).toBe(true);
            expect(upsertAlocacao).toHaveBeenCalledTimes(1); // I7 (a única em aberto c/ D.I)
        });

        it('Σ invoices > saldo do adto → NÃO aloca (segue manual, false)', async () => {
            const { service, upsertAlocacao } = buildAuto({ valorPermutar: 2200 }); // 400 USD < 800
            const ok = await service.autoAlocarSeElegivel('A9', 'sys');
            expect(ok).toBe(false);
            expect(upsertAlocacao).not.toHaveBeenCalled();
        });

        it('cross-over (>1 casamento-manual no processo) → false', async () => {
            const { service, upsertAlocacao } = buildAuto({
                ativosProcesso: [
                    { priCod: '510', estadoElegibilidade: 'casamento-manual' },
                    { priCod: '510', estadoElegibilidade: 'casamento-manual' },
                ],
            });
            const ok = await service.autoAlocarSeElegivel('A9', 'sys');
            expect(ok).toBe(false);
            expect(upsertAlocacao).not.toHaveBeenCalled();
        });

        it('idempotente: já tem alocação → true sem recriar', async () => {
            const { service, upsertAlocacao } = buildAuto({
                ativas: [{ adiantamentoDocCod: 'A9' }],
            });
            const ok = await service.autoAlocarSeElegivel('A9', 'sys');
            expect(ok).toBe(true);
            expect(upsertAlocacao).not.toHaveBeenCalled();
        });

        it('ATÔMICO: falha no meio reverte os rascunhos criados nesta chamada e re-lança', async () => {
            // 2 casamentos: I7 (existe na busca) e I9 (NÃO existe → alocar lança) → reverte I7.
            const { service, deleteAlocacao } = buildAuto({
                casamentos: [
                    {
                        adiantamentoDocCod: 'A9',
                        invoiceDocCod: 'I7',
                        priCod: '510',
                        valorASerUsado: 100,
                    },
                    {
                        adiantamentoDocCod: 'A9',
                        invoiceDocCod: 'I9',
                        priCod: '510',
                        valorASerUsado: 100,
                    },
                ],
            });
            await expect(service.autoAlocarDeCasamento('A9', 'sys')).rejects.toThrow(/I9/);
            expect(deleteAlocacao).toHaveBeenCalledWith('A9', 'I7'); // rollback do 1º
        });
    });
});
