import 'reflect-metadata';
import PermutaSnapshotRepository, {
    type PermutaEleicaoRunInput,
} from './PermutaSnapshotRepository.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import {
    ESTADO_ELEGIBILIDADE,
    type EstadoElegibilidade,
    MOTIVO_BLOQUEIO,
    type MotivoBloqueio,
} from '../../interface/permutas/EstadoElegibilidade.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';

/**
 * Captures the calls issued INSIDE `withTransaction(fn)` so the tests can assert
 * that persistRun runs exactly one transaction and batches the candidata INSERTs.
 */
const buildDb = () => {
    const txInsert = jest.fn().mockResolvedValue(1);
    const tx = {
        insert: txInsert,
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue(0),
    };
    const withTransaction = jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    return Object.assign(
        {
            insert: jest.fn().mockResolvedValue(1),
            selectMany: jest.fn().mockResolvedValue([]),
            selectFirst: jest.fn().mockResolvedValue(null),
            withTransaction,
        },
        { __tx: tx, __txInsert: txInsert, __withTransaction: withTransaction },
    ) as unknown as jest.Mocked<PostgreeDatabaseClient> & {
        __tx: typeof tx;
        __txInsert: jest.Mock;
        __withTransaction: jest.Mock;
    };
};

const baseRun = (over: Partial<PermutaEleicaoRunInput> = {}): PermutaEleicaoRunInput => ({
    flowId: 'flow-1',
    startedAt: new Date('2026-06-17T10:00:00Z'),
    finishedAt: new Date('2026-06-17T10:01:00Z'),
    status: 'success',
    triggeredBy: 'user-x',
    totalCandidatas: 1,
    totalElegiveis: 1,
    totalBloqueadas: 0,
    totalCasamentoManual: 0,
    totalPermutaManual: 0,
    totalJaPermutado: 0,
    bloqueadasByMotivo: {},
    ...over,
});

const elegivelCandidata: PermutaCandidata = {
    priCod: '2048',
    adiantamento: {
        docCod: 'A1',
        priCod: '2048',
        filCod: 2,
        dataEmissao: new Date('2026-03-01'),
        valor: 1000,
        moeda: 'USD',
        pago: true,
        valorPermutar: 1000,
    },
    invoiceCasada: {
        docCod: 'I1',
        priCod: '2048',
        dataEmissao: new Date('2026-04-01'),
        valor: 1000,
        moeda: 'USD',
        pago: false,
    },
    estadoElegibilidade: ESTADO_ELEGIBILIDADE.ELEGIVEL,
    gatesAvaliados: [],
};

/**
 * Candidata em um estado arbitrário da máquina — base do CASO CANÔNICO da
 * invariante I5 (`ontology/business-rules/fidelidade-snapshot-eleicao.md`):
 * uma run com 1 candidata de CADA um dos 5 estados.
 */
const candidataNoEstado = (
    estado: EstadoElegibilidade,
    docCod: string,
    motivo?: MotivoBloqueio,
): PermutaCandidata => ({
    priCod: `pri-${docCod}`,
    adiantamento: {
        ...elegivelCandidata.adiantamento,
        docCod,
        priCod: `pri-${docCod}`,
    },
    estadoElegibilidade: estado,
    ...(motivo !== undefined ? { motivoBloqueio: motivo } : {}),
    gatesAvaliados: [],
});

/** 1 candidata de cada um dos 5 estados — o caso canônico da entrevista. */
const cincoEstados = (): PermutaCandidata[] => [
    candidataNoEstado(ESTADO_ELEGIBILIDADE.ELEGIVEL, 'A-ELEG'),
    candidataNoEstado(ESTADO_ELEGIBILIDADE.BLOQUEADA, 'A-BLOQ', MOTIVO_BLOQUEIO.SEM_INVOICE),
    candidataNoEstado(ESTADO_ELEGIBILIDADE.CASAMENTO_MANUAL, 'A-CASA', MOTIVO_BLOQUEIO.COMPOSTO_NM),
    candidataNoEstado(
        ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL,
        'A-PMAN',
        MOTIVO_BLOQUEIO.CLIENTE_FILTRO,
    ),
    candidataNoEstado(ESTADO_ELEGIBILIDADE.JA_PERMUTADO, 'A-JAPE', MOTIVO_BLOQUEIO.JA_PERMUTADO),
];

describe('PermutaSnapshotRepository', () => {
    it('persists run + snapshot inside ONE transaction (atomicity, success)', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);

        const runId = await repo.persistRun(baseRun(), [elegivelCandidata]);

        expect(typeof runId).toBe('string');
        // Whole persist is wrapped in a single transaction (BEGIN/COMMIT 0→1).
        expect(db.__withTransaction).toHaveBeenCalledTimes(1);
        // 1 run insert + 1 multi-row candidata insert = 2 round-trips for N=1.
        expect(db.__txInsert).toHaveBeenCalledTimes(2);
        // The pool-level insert is NEVER used (everything goes through the tx).
        expect(db.insert as jest.Mock).not.toHaveBeenCalled();

        const runSql = db.__txInsert.mock.calls[0][0] as string;
        expect(runSql).toContain('INSERT INTO permuta_eleicao_run');
        // Parameterized — named params only (Rule #5), no string interpolation.
        expect(runSql).toContain('$flowId');
        expect(runSql).not.toMatch(/'\s*\+|\$\{/);

        const candidataSql = db.__txInsert.mock.calls[1][0] as string;
        const candidataParams = db.__txInsert.mock.calls[1][1] as Record<string, unknown>;
        expect(candidataSql).toContain('INSERT INTO permuta_candidata_snapshot');
        // Multi-row insert is fully parameterized (no interpolation).
        expect(candidataSql).not.toMatch(/'\s*\+|\$\{/);
        expect(candidataParams.runId).toBe(runId);
        expect(candidataParams.status_0).toBe('elegivel');
        expect(candidataParams.invoiceDocCod_0).toBe('I1');
        expect(candidataParams.agingDays_0).toBeNull(); // ⏸ GATED-P0-4
    });

    it('round-trips for N=200 candidatas stay ≤ 2 (1 run + 1 batch ≤500)', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);
        const candidatas: PermutaCandidata[] = Array.from({ length: 200 }, (_, i) => ({
            ...elegivelCandidata,
            priCod: String(i),
            adiantamento: { ...elegivelCandidata.adiantamento, docCod: `A${i}`, priCod: String(i) },
        }));

        await repo.persistRun(baseRun({ totalCandidatas: 200, totalElegiveis: 200 }), candidatas);

        expect(db.__withTransaction).toHaveBeenCalledTimes(1);
        // 1 run header + 1 multi-row chunk (200 ≤ 500) = 2 inserts (was 201).
        expect(db.__txInsert).toHaveBeenCalledTimes(2);
    });

    it('chunks candidatas into multi-row inserts of 500', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);
        const candidatas: PermutaCandidata[] = Array.from({ length: 1100 }, (_, i) => ({
            ...elegivelCandidata,
            priCod: String(i),
            adiantamento: { ...elegivelCandidata.adiantamento, docCod: `A${i}`, priCod: String(i) },
        }));

        await repo.persistRun(baseRun({ totalCandidatas: 1100, totalElegiveis: 1100 }), candidatas);

        // 1 run header + 3 chunks (500 + 500 + 100) = 4 inserts.
        expect(db.__txInsert).toHaveBeenCalledTimes(4);
    });

    it('rolls back: when a chunk insert fails mid-transaction, persistRun rejects', async () => {
        const db = buildDb();
        // Run header ok, candidata batch throws → withTransaction rolls back.
        db.__txInsert.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('insert exploded'));

        const repo = new PermutaSnapshotRepository(db);
        await expect(repo.persistRun(baseRun(), [elegivelCandidata])).rejects.toThrow(
            'insert exploded',
        );
        // The transaction body threw — the real withTransaction would ROLLBACK,
        // so NOTHING is committed (header + candidatas all aborted together).
        expect(db.__withTransaction).toHaveBeenCalledTimes(1);
    });

    it('aborted run → status=error + error_message, ZERO snapshot rows', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);

        await repo.persistRun(
            baseRun({ status: 'error', errorMessage: 'boom', totalCandidatas: 0 }),
            [],
        );

        // Only the run header insert — no candidata rows.
        expect(db.__txInsert).toHaveBeenCalledTimes(1);
        const runParams = db.__txInsert.mock.calls[0][1] as Record<string, unknown>;
        expect(runParams.status).toBe('error');
        expect(runParams.errorMessage).toBe('boom');
    });

    it('persists blocked candidata with motivo, null invoice and fil_cod', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);
        const bloqueada: PermutaCandidata = {
            priCod: '3000',
            adiantamento: {
                ...elegivelCandidata.adiantamento,
                docCod: 'A2',
                priCod: '3000',
                filCod: 7,
            },
            estadoElegibilidade: ESTADO_ELEGIBILIDADE.BLOQUEADA,
            motivoBloqueio: MOTIVO_BLOQUEIO.SEM_INVOICE,
            gatesAvaliados: [],
        };

        await repo.persistRun(baseRun({ totalElegiveis: 0, totalBloqueadas: 1 }), [bloqueada]);

        const candidataParams = db.__txInsert.mock.calls[1][1] as Record<string, unknown>;
        expect(candidataParams.status_0).toBe('bloqueada');
        expect(candidataParams.motivoBloqueio_0).toBe(MOTIVO_BLOQUEIO.SEM_INVOICE);
        expect(candidataParams.invoiceDocCod_0).toBeNull();
        // P0-2 — fil_cod propagated end-to-end, NOT null.
        expect(candidataParams.filCod_0).toBe(7);
    });

    it('findRunIdByIdempotencyKey returns the run_id within TTL, null otherwise (P0-6)', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValueOnce({ run_id: 'run-7' });
        const repo = new PermutaSnapshotRepository(db);

        const found = await repo.findRunIdByIdempotencyKey('idem-key');
        expect(found).toBe('run-7');

        const sql = (db.selectFirst as jest.Mock).mock.calls[0][0] as string;
        // Parameterized + TTL window enforced in SQL.
        expect(sql).toContain('$key');
        expect(sql).toContain("INTERVAL '24 hours'");
        expect(sql).not.toMatch(/'\s*\+|\$\{/);

        (db.selectFirst as jest.Mock).mockResolvedValueOnce(null);
        expect(await repo.findRunIdByIdempotencyKey('absent')).toBeNull();
    });

    it('recordIdempotencyKey inserts the key→runId mapping (ON CONFLICT DO NOTHING)', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);

        await repo.recordIdempotencyKey('idem-key', 'run-9');

        const [sql, params] = (db.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO permuta_eleicao_idempotency');
        expect(sql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
        expect(params).toMatchObject({ key: 'idem-key', runId: 'run-9' });
    });

    it('listRecentRuns maps run rows (cron + manual), most recent first, parameterized LIMIT', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                id: 'run-2',
                triggered_by: 'simone',
                started_at: '2026-06-21T13:52:00Z',
                finished_at: '2026-06-21T13:52:30Z',
                status: 'success',
                total_candidatas: 509,
                total_elegiveis: 27,
                total_bloqueadas: 413,
                error_message: null,
            },
            {
                id: 'run-1',
                triggered_by: 'cron',
                started_at: '2026-06-21T09:00:00Z',
                finished_at: '2026-06-21T09:00:25Z',
                status: 'error',
                total_candidatas: 0,
                total_elegiveis: 0,
                total_bloqueadas: 0,
                error_message: 'conexos timeout',
            },
        ]);
        const repo = new PermutaSnapshotRepository(db);

        const runs = await repo.listRecentRuns(10);

        expect(runs).toHaveLength(2);
        expect(runs[0]).toMatchObject({
            runId: 'run-2',
            triggeredBy: 'simone',
            status: 'success',
            totalElegiveis: 27,
        });
        expect(runs[0].errorMessage).toBeUndefined();
        expect(runs[0].finishedAt).toBeInstanceOf(Date);
        expect(runs[1]).toMatchObject({ triggeredBy: 'cron', status: 'error' });
        expect(runs[1].errorMessage).toBe('conexos timeout');

        const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('FROM permuta_eleicao_run');
        expect(sql).toContain('ORDER BY finished_at DESC');
        // Dedup: filtra o header de ingest BEM-SUCEDIDO (duplicado com elegiveis=0),
        // mas mantém o header de ingest com erro (falha visível na trilha).
        expect(sql).toContain("NOT (kind = 'ingest' AND status = 'success')");
        // LIMIT parameterized (Rule #5) — no interpolation.
        expect(sql).toContain('$limit');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toEqual({ limit: 10 });
    });

    it('findLatestSnapshot returns null when no successful run exists', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);
        const result = await repo.findLatestSnapshot();
        expect(result).toBeNull();
    });

    it('insertRunHeader grava os 3 buckets novos, parametrizados por $nome', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);

        await repo.persistRun(
            baseRun({
                totalCandidatas: 5,
                totalElegiveis: 1,
                totalBloqueadas: 1,
                totalCasamentoManual: 1,
                totalPermutaManual: 1,
                totalJaPermutado: 1,
            }),
            [],
        );

        const [sql, params] = db.__txInsert.mock.calls[0] as [string, Record<string, unknown>];
        expect(sql).toContain('total_casamento_manual');
        expect(sql).toContain('$totalCasamentoManual');
        expect(sql).toContain('$totalPermutaManual');
        expect(sql).toContain('$totalJaPermutado');
        // Zero interpolação de valor (Rule #5).
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({
            totalCasamentoManual: 1,
            totalPermutaManual: 1,
            totalJaPermutado: 1,
        });
    });

    it('listRecentRuns carrega os 3 buckets novos no resumo', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                id: 'run-3',
                triggered_by: 'cron',
                started_at: '2026-09-08T18:15:00Z',
                finished_at: '2026-09-08T18:16:00Z',
                status: 'success',
                total_candidatas: 704,
                total_elegiveis: 27,
                total_bloqueadas: 249,
                total_casamento_manual: 48,
                total_permuta_manual: 300,
                total_ja_permutado: 80,
                error_message: null,
            },
        ]);
        const repo = new PermutaSnapshotRepository(db);

        const [run] = await repo.listRecentRuns(10);

        expect(run).toMatchObject({
            totalBloqueadas: 249,
            totalCasamentoManual: 48,
            totalPermutaManual: 300,
            totalJaPermutado: 80,
        });
    });

    it('findRunSummaryById carrega os 3 buckets — o caminho do REPLAY idempotente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'run-4',
            flow_id: 'flow-4',
            status: 'success',
            total_candidatas: 704,
            total_elegiveis: 27,
            total_bloqueadas: 249,
            total_casamento_manual: 48,
            total_permuta_manual: 300,
            total_ja_permutado: 80,
            bloqueadas_by_motivo: { 'nao-pago': 35 },
        });
        const repo = new PermutaSnapshotRepository(db);

        const summary = await repo.findRunSummaryById('run-4');

        expect(summary).toMatchObject({
            totalCasamentoManual: 48,
            totalPermutaManual: 300,
            totalJaPermutado: 80,
        });
        const sql = (db.selectFirst as jest.Mock).mock.calls[0][0] as string;
        expect(sql).toContain('total_ja_permutado');
        expect(sql).toContain('$runId');
    });

    // ─── Fidelidade da projeção (I5 cláusula 1) — ADR-0043 ────────────────────
    it('CASO CANÔNICO: 5 candidatas em 5 estados → 5 linhas com 5 status DISTINTOS', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);

        await repo.persistRun(baseRun({ totalCandidatas: 5 }), cincoEstados());

        const params = db.__txInsert.mock.calls[1][1] as Record<string, unknown>;
        const status = [0, 1, 2, 3, 4].map((i) => params[`status_${i}`]);
        expect(status).toEqual([
            'elegivel',
            'bloqueada',
            'casamento-manual',
            'permuta-manual',
            'ja-permutado',
        ]);
        // Nenhum achatamento: 5 estados entram, 5 valores distintos saem.
        expect(new Set(status).size).toBe(5);
    });

    it('regressão do achatamento: casamento-manual NÃO vira bloqueada na escrita', async () => {
        const db = buildDb();
        const repo = new PermutaSnapshotRepository(db);

        await repo.persistRun(baseRun({ totalCandidatas: 1 }), [
            candidataNoEstado(
                ESTADO_ELEGIBILIDADE.CASAMENTO_MANUAL,
                'A-CASA',
                MOTIVO_BLOQUEIO.COMPOSTO_NM,
            ),
        ]);

        const params = db.__txInsert.mock.calls[1][1] as Record<string, unknown>;
        expect(params.status_0).toBe('casamento-manual');
        expect(params.status_0).not.toBe('bloqueada');
    });

    it('round-trip: casamento-manual / permuta-manual / ja-permutado voltam ÍNTEGROS da leitura', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'run-5',
            finished_at: '2026-09-08T18:16:00Z',
        });
        (db.selectMany as jest.Mock).mockResolvedValue(
            ['elegivel', 'bloqueada', 'casamento-manual', 'permuta-manual', 'ja-permutado'].map(
                (status, i) => ({
                    run_id: 'run-5',
                    doc_cod: `A${i}`,
                    fil_cod: 2,
                    pri_cod: String(i),
                    status,
                    motivo_bloqueio: null,
                    aging_days: null,
                    invoice_doc_cod: null,
                    variacao_classificacao: null,
                    variacao_resultado: null,
                }),
            ),
        );
        const repo = new PermutaSnapshotRepository(db);

        const result = await repo.findLatestSnapshot();

        expect(result?.rows.map((r) => r.status)).toEqual([
            'elegivel',
            'bloqueada',
            'casamento-manual',
            'permuta-manual',
            'ja-permutado',
        ]);
    });

    it('status fora do enum FALHA ALTO na leitura — nunca vira `bloqueada` em silêncio', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'run-6',
            finished_at: '2026-09-08T18:16:00Z',
        });
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                run_id: 'run-6',
                doc_cod: 'A1',
                fil_cod: 2,
                pri_cod: '2048',
                status: 'estado-que-nao-existe',
                motivo_bloqueio: null,
                aging_days: null,
                invoice_doc_cod: null,
                variacao_classificacao: null,
                variacao_resultado: null,
            },
        ]);
        const repo = new PermutaSnapshotRepository(db);

        await expect(repo.findLatestSnapshot()).rejects.toThrow(/estado-que-nao-existe/);
    });

    it('findLatestSnapshot maps rows of the latest successful run', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'run-9',
            finished_at: '2026-06-17T10:01:00Z',
        });
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                run_id: 'run-9',
                doc_cod: 'A1',
                fil_cod: 2,
                pri_cod: '2048',
                status: 'elegivel',
                motivo_bloqueio: null,
                aging_days: null,
                invoice_doc_cod: 'I1',
                variacao_classificacao: 'JUROS',
                variacao_resultado: 200,
            },
        ]);
        const repo = new PermutaSnapshotRepository(db);

        const result = await repo.findLatestSnapshot();

        expect(result?.runId).toBe('run-9');
        expect(result?.rows[0]).toMatchObject({
            docCod: 'A1',
            status: 'elegivel',
            invoiceDocCod: 'I1',
            variacaoClassificacao: 'JUROS',
            variacaoResultado: 200,
        });
        expect(result?.rows[0].agingDays).toBeUndefined();
    });
});
