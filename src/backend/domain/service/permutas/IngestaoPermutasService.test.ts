import 'reflect-metadata';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import {
    ESTADO_ELEGIBILIDADE,
    MOTIVO_BLOQUEIO,
} from '../../interface/permutas/EstadoElegibilidade.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';
import type PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import type PermutaSnapshotRepository from '../../repository/permutas/PermutaSnapshotRepository.js';
import type EleicaoPermutasService from './EleicaoPermutasService.js';
import IngestaoPermutasService, { INGEST_LOCK_KEY } from './IngestaoPermutasService.js';
import type LogService from '../LogService.js';
import VariacaoCambialPermutaService from './VariacaoCambialPermutaService.js';

/** Serviço de variação real (puro, sem deps) — recalcula a variação por parcial. */
const variacao = new VariacaoCambialPermutaService();

/** Mock do BorderoGestaoService — só o refresh do cache de borderôs (best-effort na ingestão). */
const borderoGestao = {
    refreshCache: jest.fn().mockResolvedValue(undefined),
} as unknown as import('./BorderoGestaoService.js').default;

type LogCall = { type: string; data?: Record<string, unknown> };

const buildLogService = () => {
    const calls: LogCall[] = [];
    const capture = jest.fn(async (p: LogCall) => {
        calls.push(p);
    });
    return {
        logService: {
            info: capture,
            warn: capture,
            error: capture,
            success: capture,
        } as unknown as LogService,
        calls,
    };
};

const elegivel: PermutaCandidata = {
    priCod: '2048',
    adiantamento: {
        docCod: 'A1',
        priCod: '2048',
        filCod: 2,
        dataEmissao: new Date('2026-03-01'),
        valor: 1000,
        moeda: 'BRL',
        moedaNegociada: 'USD',
        pago: true,
        valorPermutar: 1000,
        referencia: 'CT/1',
        exportador: 'DBP',
        valorMoedaNegociada: 1000,
    },
    invoiceCasada: {
        docCod: 'I1',
        priCod: '2048',
        dataEmissao: new Date('2026-04-01'),
        valor: 1000,
        moeda: 'BRL',
        moedaNegociada: 'USD',
        pago: false,
        referencia: 'INV/1',
        valorMoedaNegociada: 1000,
    },
    declaracaoImportacao: { priCod: '2048', variante: 'DI' },
    variacaoCambial: {
        moeda: 'USD',
        principalMoeda: 1000,
        taxaAdiantamento: 5.31,
        taxaInvoice: 5.19,
        delta: 120,
        resultado: 120,
        classificacao: 'JUROS',
        contaContabil: '131',
    },
    estadoElegibilidade: ESTADO_ELEGIBILIDADE.ELEGIVEL,
    aging: 30,
    gatesAvaliados: [],
};

const bloqueada: PermutaCandidata = {
    priCod: '3000',
    adiantamento: {
        docCod: 'A2',
        priCod: '3000',
        filCod: 7,
        dataEmissao: new Date('2026-03-01'),
        valor: 500,
        moeda: 'USD',
        pago: true,
    },
    estadoElegibilidade: ESTADO_ELEGIBILIDADE.BLOQUEADA,
    motivoBloqueio: MOTIVO_BLOQUEIO.SEM_INVOICE,
    gatesAvaliados: [],
};

const casamentoManual: PermutaCandidata = {
    priCod: '4000',
    adiantamento: {
        docCod: 'A3',
        priCod: '4000',
        filCod: 2,
        dataEmissao: new Date('2026-03-01'),
        valor: 2000,
        moeda: 'USD',
        pago: true,
        valorPermutar: 2000,
    },
    estadoElegibilidade: ESTADO_ELEGIBILIDADE.CASAMENTO_MANUAL,
    motivoBloqueio: MOTIVO_BLOQUEIO.COMPOSTO_NM,
    gatesAvaliados: [],
};

const permutaManual: PermutaCandidata = {
    priCod: '1153',
    adiantamento: {
        docCod: 'A9',
        priCod: '1153',
        filCod: 2,
        dataEmissao: new Date('2026-02-23'),
        valor: 5910,
        moeda: 'USD',
        pago: true,
        valorPermutar: 1100,
        pesCod: '191',
        importador: 'INOX-TECH',
    },
    estadoElegibilidade: ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL,
    motivoBloqueio: MOTIVO_BLOQUEIO.CLIENTE_FILTRO,
    gatesAvaliados: [],
};

const buildEleicao = (candidatas: PermutaCandidata[]) =>
    ({
        computeCandidatas: jest.fn().mockResolvedValue({
            candidatas,
            flowId: 'flow-1',
            totals: {
                totalCandidatas: candidatas.length,
                totalElegiveis: candidatas.filter(
                    (c) => c.estadoElegibilidade === ESTADO_ELEGIBILIDADE.ELEGIVEL,
                ).length,
                totalBloqueadas: candidatas.filter(
                    (c) => c.estadoElegibilidade === ESTADO_ELEGIBILIDADE.BLOQUEADA,
                ).length,
                bloqueadasByMotivo: {},
            },
        }),
    }) as unknown as jest.Mocked<EleicaoPermutasService>;

const buildRelational = () => {
    const tx = {
        insert: jest.fn(),
        update: jest.fn(),
        selectMany: jest.fn(),
        selectFirst: jest.fn(),
    } as unknown as TransactionClient;
    const repo = {
        persistIngestRun: jest.fn(
            async (
                _header: unknown,
                _lockKey: number,
                write: (t: TransactionClient, runId: string) => Promise<void>,
            ) => {
                await write(tx, 'ingest-run-1');
                return 'ingest-run-1';
            },
        ),
        insertIngestRunHeader: jest.fn().mockResolvedValue('error-run-1'),
        upsertAdiantamentos: jest.fn().mockResolvedValue(undefined),
        upsertInvoices: jest.fn().mockResolvedValue(undefined),
        upsertDeclaracoes: jest.fn().mockResolvedValue(undefined),
        replaceAutoCasamentos: jest.fn().mockResolvedValue(undefined),
        markStale: jest.fn().mockResolvedValue(3),
    } as unknown as jest.Mocked<PermutaRelationalRepository>;
    return { repo, tx };
};

const buildSnapshot = () =>
    ({
        persistRun: jest.fn().mockResolvedValue('snap-1'),
    }) as unknown as jest.Mocked<PermutaSnapshotRepository>;

describe('IngestaoPermutasService', () => {
    it('persists facts + auto casamento + sweep under the ingest lock, plus snapshot back-compat', async () => {
        const eleicao = buildEleicao([elegivel, bloqueada]);
        const { repo } = buildRelational();
        const snapshot = buildSnapshot();
        const { logService } = buildLogService();
        const service = new IngestaoPermutasService(
            eleicao,
            repo,
            snapshot,
            variacao,
            borderoGestao,
            logService,
        );

        const result = await service.executar({ triggeredBy: 'cron' });

        expect(result.status).toBe('success');
        expect(result.runId).toBe('ingest-run-1');
        // 2 adiantamentos, 1 invoice (only elegivel had one), 1 casamento.
        expect(result.totalAdiantamentos).toBe(2);
        expect(result.totalInvoices).toBe(1);
        expect(result.totalCasamentos).toBe(1);
        expect(result.totalStale).toBe(3);

        // Persisted under the ingest advisory lock.
        expect(repo.persistIngestRun).toHaveBeenCalledTimes(1);
        expect(repo.persistIngestRun.mock.calls[0][1]).toBe(INGEST_LOCK_KEY);

        // Write phase: upserts → recompute casamento → sweep, in order.
        expect(repo.upsertAdiantamentos).toHaveBeenCalledTimes(1);
        expect(repo.upsertInvoices).toHaveBeenCalledTimes(1);
        expect(repo.upsertDeclaracoes).toHaveBeenCalledTimes(1);
        expect(repo.replaceAutoCasamentos).toHaveBeenCalledTimes(1);
        expect(repo.markStale).toHaveBeenCalledTimes(1);

        // Casamento carries the VC sign-fixed classification (JUROS) and the
        // NEGOCIADA currency (USD) — not the doc currency (BRL).
        const casamentoRows = repo.replaceAutoCasamentos.mock.calls[0][2];
        expect(casamentoRows).toHaveLength(1);
        expect(casamentoRows[0]).toMatchObject({
            invoiceDocCod: 'I1',
            adiantamentoDocCod: 'A1',
            variacaoClassificacao: 'JUROS',
            moeda: 'USD',
        });
        // Variação RECALCULADA pela distribuição (usado=1000, Δtaxa 0.12) → ~120.
        expect(casamentoRows[0]?.variacaoResultado).toBeCloseTo(120, 4);
        expect(casamentoRows[0]?.valorASerUsado).toBeCloseTo(1000, 4);

        // moeda NEGOCIADA (USD) maps onto the fact rows distinctly from the doc
        // moeda (BRL), so the Gestão column labels the value as USD.
        const adiantamentoRows = repo.upsertAdiantamentos.mock.calls[0][2];
        expect(adiantamentoRows[0]).toMatchObject({ moeda: 'BRL', moedaNegociada: 'USD' });
        const invoiceRows = repo.upsertInvoices.mock.calls[0][2];
        expect(invoiceRows[0]).toMatchObject({ moeda: 'BRL', moedaNegociada: 'USD' });

        // Back-compat: snapshot persisted too.
        expect(snapshot.persistRun).toHaveBeenCalledTimes(1);
    });

    // Regressão do Regis-Review 2026-08-28 (invoice-pago-detalhe).
    //
    // `toInvoiceRows` monta as linhas em duas passadas: candidatas primeiro, universo depois
    // com `if (byDocCod.has(...)) continue`. A invoice da candidata carrega o `pago` do
    // `com298/list` (via `isPago`), que é SEMPRE false — o list não popula saldo. Se a
    // candidata vencer, a correção do `pago` não alcança nenhuma invoice de processo COM
    // adiantamento, que são as que mais importam para permuta.
    //
    // Os demais testes deste arquivo passam `todasInvoices` vazio (default do mock), então
    // nenhum exercitava esta precedência — foi o ponto cego que deixou o bug passar.
    it('o `pago` do universo hidratado VENCE o da candidata (que vem do list, sempre false)', async () => {
        const eleicao = {
            computeCandidatas: jest.fn().mockResolvedValue({
                candidatas: [elegivel],
                flowId: 'flow-1',
                // MESMA invoice I1 da candidata, agora com o `pago` REAL derivado do com308.
                todasInvoices: [
                    {
                        inv: { ...elegivel.invoiceCasada, pago: true },
                        filCod: 2,
                    },
                ],
                totals: {
                    totalCandidatas: 1,
                    totalElegiveis: 1,
                    totalBloqueadas: 0,
                    bloqueadasByMotivo: {},
                },
            }),
        } as unknown as jest.Mocked<EleicaoPermutasService>;
        const { repo } = buildRelational();
        const service = new IngestaoPermutasService(
            eleicao,
            repo,
            buildSnapshot(),
            variacao,
            borderoGestao,
            buildLogService().logService,
        );

        await service.executar({ triggeredBy: 'cron' });

        const invoiceRows = repo.upsertInvoices.mock.calls[0][2];
        const i1 = invoiceRows.find((r) => r.docCod === 'I1');
        // A candidata dizia `pago: false`; o universo hidratado diz `true`. Vence o universo,
        // senão a invoice liquidada volta a aparecer na aba "Invoices em aberto".
        expect(i1?.pago).toBe(true);
    });

    it('sem entrada no universo, o `pago` da candidata é preservado (piso conservador)', async () => {
        // Cap de paginação ou invoice fora do universo: nunca inferimos `pago=true` sem prova.
        const eleicao = buildEleicao([elegivel]);
        const { repo } = buildRelational();
        const service = new IngestaoPermutasService(
            eleicao,
            repo,
            buildSnapshot(),
            variacao,
            borderoGestao,
            buildLogService().logService,
        );

        await service.executar({ triggeredBy: 'cron' });

        const invoiceRows = repo.upsertInvoices.mock.calls[0][2];
        expect(invoiceRows.find((r) => r.docCod === 'I1')?.pago).toBe(false);
    });

    it('only elegivel-with-invoice candidatas become auto casamentos', async () => {
        const eleicao = buildEleicao([elegivel, bloqueada]);
        const { repo } = buildRelational();
        const service = new IngestaoPermutasService(
            eleicao,
            repo,
            buildSnapshot(),
            variacao,
            borderoGestao,
            buildLogService().logService,
        );

        await service.executar({ triggeredBy: 'cron' });
        const adiantamentoRows = repo.upsertAdiantamentos.mock.calls[0][2];
        expect(adiantamentoRows.map((r) => r.docCod).sort()).toEqual(['A1', 'A2']);
        const invoiceRows = repo.upsertInvoices.mock.calls[0][2];
        expect(invoiceRows.map((r) => r.docCod)).toEqual(['I1']);
    });

    it('persists estado_elegibilidade=casamento-manual for N:M candidatas (ADR-0005)', async () => {
        const eleicao = buildEleicao([elegivel, casamentoManual]);
        const { repo } = buildRelational();
        const service = new IngestaoPermutasService(
            eleicao,
            repo,
            buildSnapshot(),
            variacao,
            borderoGestao,
            buildLogService().logService,
        );

        await service.executar({ triggeredBy: 'cron' });

        const adiantamentoRows = repo.upsertAdiantamentos.mock.calls[0][2];
        const nmRow = adiantamentoRows.find((r) => r.docCod === 'A3');
        expect(nmRow?.estadoElegibilidade).toBe('casamento-manual');
        expect(nmRow?.motivoBloqueio).toBe('composto-nm');
        // N:M não vira casamento automático (só elegível com invoice casada).
        expect(repo.replaceAutoCasamentos.mock.calls[0][2]).toHaveLength(1);
    });

    it('lock busy: rethrows IngestLockBusyError WITHOUT writing an error run (ADR-0006)', async () => {
        const eleicao = buildEleicao([elegivel]);
        const { repo } = buildRelational();
        // Advisory lock held by another ingestion → persistIngestRun rejects.
        (repo.persistIngestRun as jest.Mock).mockRejectedValue(new IngestLockBusyError());
        const snapshot = buildSnapshot();
        const { logService, calls } = buildLogService();
        const service = new IngestaoPermutasService(
            eleicao,
            repo,
            snapshot,
            variacao,
            borderoGestao,
            logService,
        );

        await expect(service.executar({ triggeredBy: 'simone' })).rejects.toBeInstanceOf(
            IngestLockBusyError,
        );

        // Lock contention is NOT a failure: no error run header, no snapshot, no
        // error log polluting the audit trail.
        expect(repo.insertIngestRunHeader).not.toHaveBeenCalled();
        expect(snapshot.persistRun).not.toHaveBeenCalled();
        expect(calls.some((c) => c.type === 'FLOW_ERROR')).toBe(false);
    });

    it('persiste estado permuta-manual + pesCod/importador na row (cliente-filtro)', async () => {
        const eleicao = buildEleicao([permutaManual]);
        const { repo } = buildRelational();
        const service = new IngestaoPermutasService(
            eleicao,
            repo,
            buildSnapshot(),
            variacao,
            borderoGestao,
            buildLogService().logService,
        );

        await service.executar({ triggeredBy: 'cron' });

        const rows = repo.upsertAdiantamentos.mock.calls[0][2];
        const row = rows.find((r) => r.docCod === 'A9');
        expect(row?.estadoElegibilidade).toBe('permuta-manual');
        expect(row?.pesCod).toBe('191');
        expect(row?.importador).toBe('INOX-TECH');
    });

    it('on compute failure: ROLLBACK (no write) + error header outside tx, rethrows', async () => {
        const boom = new Error('conexos down');
        const eleicao = {
            computeCandidatas: jest.fn().mockRejectedValue(boom),
        } as unknown as jest.Mocked<EleicaoPermutasService>;
        const { repo } = buildRelational();
        const snapshot = buildSnapshot();
        const { logService, calls } = buildLogService();
        const service = new IngestaoPermutasService(
            eleicao,
            repo,
            snapshot,
            variacao,
            borderoGestao,
            logService,
        );

        await expect(service.executar({ triggeredBy: 'cron' })).rejects.toThrow('conexos down');

        // No relational write happened.
        expect(repo.persistIngestRun).not.toHaveBeenCalled();
        // Error header written OUTSIDE the tx.
        expect(repo.insertIngestRunHeader).toHaveBeenCalledTimes(1);
        expect(repo.insertIngestRunHeader.mock.calls[0][0]).toMatchObject({
            status: 'error',
            errorMessage: 'conexos down',
        });
        // No snapshot on failure.
        expect(snapshot.persistRun).not.toHaveBeenCalled();
        expect(calls.some((c) => c.type !== undefined)).toBe(true);
    });
});

// ---- Distribuição greedy N:1 com teto (permuta Simples) ----

/**
 * Candidata ELEGIVEL casada com uma invoice, com saldo do adto (negociado) e o
 * teto da invoice (valorAbertoNegociado, fallback valorMoedaNegociada) ajustáveis.
 * `taxa` omitida → saldoDisponivelNeg cai no valorMoedaNegociada (= saldo).
 */
const elegivelGreedy = (over: {
    docCod: string;
    saldo: number;
    invoiceDocCod: string;
    tetoVivo?: number;
    tetoNegociado?: number;
    aging?: number;
    dataEmissao?: Date;
}): PermutaCandidata => ({
    priCod: '1408',
    adiantamento: {
        docCod: over.docCod,
        priCod: '1408',
        filCod: 4,
        dataEmissao: over.dataEmissao ?? new Date('2026-03-01'),
        valor: over.saldo,
        moeda: 'BRL',
        moedaNegociada: 'USD',
        pago: true,
        valorPermutar: over.saldo,
        valorMoedaNegociada: over.saldo,
    },
    invoiceCasada: {
        docCod: over.invoiceDocCod,
        priCod: '1408',
        dataEmissao: new Date('2026-04-01'),
        valor: 260064,
        moeda: 'BRL',
        moedaNegociada: 'USD',
        pago: false,
        valorMoedaNegociada: over.tetoNegociado ?? 260064,
        ...(over.tetoVivo !== undefined ? { valorAbertoNegociado: over.tetoVivo } : {}),
    },
    declaracaoImportacao: { priCod: '1408', variante: 'DI' },
    estadoElegibilidade: ESTADO_ELEGIBILIDADE.ELEGIVEL,
    ...(over.aging !== undefined ? { aging: over.aging } : {}),
    gatesAvaliados: [],
});

/** Roda a ingestão e devolve as linhas de casamento (replaceAutoCasamentos[2]). */
const casamentoRowsDe = async (candidatas: PermutaCandidata[]) => {
    const eleicao = buildEleicao(candidatas);
    const { repo } = buildRelational();
    const service = new IngestaoPermutasService(
        eleicao,
        repo,
        buildSnapshot(),
        variacao,
        borderoGestao,
        buildLogService().logService,
    );
    await service.executar({ triggeredBy: 'cron' });
    return repo.replaceAutoCasamentos.mock.calls[0][2];
};

describe('IngestaoPermutasService — distribuição greedy N:1 (Simples)', () => {
    it('capa no teto e consome o MAIOR saldo primeiro (caso 1408)', async () => {
        // invoice 260.064; adtos 11566=668.736 (maior) e 5751=74.304.
        const rows = await casamentoRowsDe([
            elegivelGreedy({ docCod: '5751', saldo: 74304, invoiceDocCod: 'INV1408' }),
            elegivelGreedy({ docCod: '11566', saldo: 668736, invoiceDocCod: 'INV1408' }),
        ]);
        const a11566 = rows.find((r) => r.adiantamentoDocCod === '11566');
        const a5751 = rows.find((r) => r.adiantamentoDocCod === '5751');
        // 11566 (maior) cobre a invoice sozinho → 260.064; 5751 não precisou → 0.
        expect(a11566?.valorASerUsado).toBeCloseTo(260064, 4);
        expect(a5751?.valorASerUsado).toBe(0);
        // Σ usado ≤ teto da invoice.
        const total = rows.reduce((s, r) => s + (r.valorASerUsado ?? 0), 0);
        expect(total).toBeCloseTo(260064, 4);
    });

    it('usa o EM-ABERTO VIVO como teto (menor que o negociado por baixa externa)', async () => {
        // negociado 260.064, mas vivo 160.064 (100k baixados por fora) → teto 160.064.
        const rows = await casamentoRowsDe([
            elegivelGreedy({
                docCod: '11566',
                saldo: 668736,
                invoiceDocCod: 'INV1408',
                tetoNegociado: 260064,
                tetoVivo: 160064,
            }),
        ]);
        expect(rows[0]?.valorASerUsado).toBeCloseTo(160064, 4);
    });

    it('desempate por aging: mais antigo (maior aging) primeiro', async () => {
        // saldos iguais (150k cada), teto 200k. O mais antigo (aging 90) enche
        // primeiro (150k), o mais novo (aging 10) leva o restante (50k).
        const rows = await casamentoRowsDe([
            elegivelGreedy({
                docCod: 'NOVO',
                saldo: 150000,
                invoiceDocCod: 'INVX',
                tetoNegociado: 200000,
                aging: 10,
            }),
            elegivelGreedy({
                docCod: 'ANTIGO',
                saldo: 150000,
                invoiceDocCod: 'INVX',
                tetoNegociado: 200000,
                aging: 90,
            }),
        ]);
        expect(rows.find((r) => r.adiantamentoDocCod === 'ANTIGO')?.valorASerUsado).toBeCloseTo(
            150000,
            4,
        );
        expect(rows.find((r) => r.adiantamentoDocCod === 'NOVO')?.valorASerUsado).toBeCloseTo(
            50000,
            4,
        );
    });

    it('Σ adtos < invoice → todos integrais (invoice fica parcial)', async () => {
        const rows = await casamentoRowsDe([
            elegivelGreedy({
                docCod: 'P1',
                saldo: 30000,
                invoiceDocCod: 'INVY',
                tetoNegociado: 260064,
            }),
            elegivelGreedy({
                docCod: 'P2',
                saldo: 40000,
                invoiceDocCod: 'INVY',
                tetoNegociado: 260064,
            }),
        ]);
        expect(rows.find((r) => r.adiantamentoDocCod === 'P1')?.valorASerUsado).toBeCloseTo(
            30000,
            4,
        );
        expect(rows.find((r) => r.adiantamentoDocCod === 'P2')?.valorASerUsado).toBeCloseTo(
            40000,
            4,
        );
    });
});
