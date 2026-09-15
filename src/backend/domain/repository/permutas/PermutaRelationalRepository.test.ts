import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import PermutaRelationalRepository, {
    type AdiantamentoRow,
    type CasamentoRow,
    type DeclaracaoRow,
    type IngestRunHeader,
    type InvoiceRow,
} from './PermutaRelationalRepository.js';

const buildTx = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(0),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<TransactionClient>;

const buildDb = (tx: jest.Mocked<TransactionClient>) =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(0),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
        withTransaction: jest.fn(async (fn: (t: TransactionClient) => Promise<unknown>) => fn(tx)),
        withAdvisoryLock: jest.fn(async (_key: number, onAcquired: () => Promise<unknown>) =>
            onAcquired(),
        ),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const header = (over: Partial<IngestRunHeader> = {}): IngestRunHeader => ({
    flowId: 'flow-1',
    startedAt: new Date('2026-06-18T10:00:00Z'),
    finishedAt: new Date('2026-06-18T10:05:00Z'),
    status: 'success',
    triggeredBy: 'cron',
    totalAdiantamentos: 1,
    totalInvoices: 1,
    totalCasamentos: 1,
    totalStale: 0,
    ...over,
});

const adiantamento: AdiantamentoRow = {
    docCod: 'A1',
    priCod: '2048',
    filCod: 2,
    referencia: 'CT/1',
    exportador: 'DBP',
    pago: true,
    valorMoedaNegociada: 1000,
    moeda: 'BRL',
    moedaNegociada: 'USD',
    estadoElegibilidade: 'elegivel',
    agingDays: 30,
    valorTotal: 1000,
    valorAberto: 400,
    pesCod: '191',
    importador: 'INOX-TECH',
};
const invoice: InvoiceRow = {
    docCod: 'I1',
    priCod: '2048',
    filCod: 2,
    referencia: 'INV/1',
    pago: false,
    valorMoedaNegociada: 1000,
    moeda: 'BRL',
    moedaNegociada: 'USD',
};
const declaracao: DeclaracaoRow = { priCod: '2048', variante: 'DI' };
const casamento: CasamentoRow = {
    invoiceDocCod: 'I1',
    adiantamentoDocCod: 'A1',
    priCod: '2048',
    valorASerUsado: 1000,
    moeda: 'USD',
    variacaoClassificacao: 'JUROS',
    variacaoResultado: 120,
};

describe('PermutaRelationalRepository', () => {
    it('persistIngestRun runs header + write inside ONE tx under advisory lock', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);
        const write = jest.fn().mockResolvedValue(undefined);

        const runId = await repo.persistIngestRun(header(), 999, write);

        expect(typeof runId).toBe('string');
        expect(db.withAdvisoryLock as jest.Mock).toHaveBeenCalledTimes(1);
        expect(db.withTransaction as jest.Mock).toHaveBeenCalledTimes(1);
        // Header insert ran on the tx (not the pool).
        const headerSql = (tx.insert as jest.Mock).mock.calls[0][0] as string;
        expect(headerSql).toContain('INSERT INTO permuta_eleicao_run');
        expect(headerSql).toContain("'ingest'");
        expect(headerSql).not.toMatch(/'\s*\+|\$\{/);
        // write() received the tx and the generated runId.
        expect(write).toHaveBeenCalledWith(tx, runId);
    });

    it('persistIngestRun throws when the advisory lock is busy', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        (db.withAdvisoryLock as jest.Mock).mockImplementation(
            async (_k: number, _ok: () => Promise<unknown>, onBusy: () => Promise<unknown>) =>
                onBusy(),
        );
        const repo = new PermutaRelationalRepository(db);

        await expect(repo.persistIngestRun(header(), 999, jest.fn())).rejects.toThrow(
            /advisory lock busy/,
        );
    });

    it('upsertAdiantamentos: ON CONFLICT DO UPDATE, parameterized, stale=false', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        await repo.upsertAdiantamentos(tx, 'run-1', [adiantamento]);

        const [sql, params] = (tx.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO permuta_adiantamento');
        expect(sql).toContain('ON CONFLICT (doc_cod) DO UPDATE');
        expect(sql).toContain('stale = FALSE');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params.runId).toBe('run-1');
        expect(params.docCod_0).toBe('A1');
        expect(params.estado_0).toBe('elegivel');
        expect(params.valorMoedaNegociada_0).toBe(1000);
        // moeda NEGOCIADA (USD) is persisted distinctly from the doc moeda (BRL).
        expect(sql).toContain('moeda_negociada');
        expect(params.moeda_0).toBe('BRL');
        expect(params.moedaNegociada_0).toBe('USD');
        // Progresso de pagamento: face + saldo em aberto, parametrizados (Rule #5).
        expect(sql).toContain('valor_total');
        expect(sql).toContain('valor_aberto');
        expect(params.valorTotal_0).toBe(1000);
        expect(params.valorAberto_0).toBe(400);
        // Importador (cliente-filtro) persistido, parametrizado.
        expect(sql).toContain('pes_cod');
        expect(sql).toContain('importador');
        expect(params.pesCod_0).toBe('191');
        expect(params.importador_0).toBe('INOX-TECH');
    });

    it('listImportadores: distinct pes_cod/importador do backlog ativo, parametrizado', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        (db.selectMany as jest.Mock).mockResolvedValue([
            { pes_cod: '191', importador: 'INOX-TECH', qtd: 290 },
        ]);
        const repo = new PermutaRelationalRepository(db);

        const list = await repo.listImportadores();

        const sql = (db.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(sql).toContain('FROM permuta_adiantamento');
        expect(sql).toContain('GROUP BY pes_cod, importador');
        expect(list[0]).toEqual({ pesCod: '191', importador: 'INOX-TECH', qtdAdtos: 290 });
    });

    it('upsertAdiantamentos chunks into multi-row inserts of 500', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);
        const rows: AdiantamentoRow[] = Array.from({ length: 1100 }, (_, i) => ({
            ...adiantamento,
            docCod: `A${i}`,
        }));

        await repo.upsertAdiantamentos(tx, 'run-1', rows);
        // 500 + 500 + 100 = 3 inserts.
        expect(tx.insert as jest.Mock).toHaveBeenCalledTimes(3);
    });

    it('upsertAdiantamentos dedups by doc_cod (last wins) — avoids "ON CONFLICT cannot affect row a second time"', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);
        // mesmo doc_cod repetido (fan-out multi-filial) + um distinto.
        const rows: AdiantamentoRow[] = [
            { ...adiantamento, docCod: 'A1', valorMoedaNegociada: 1000 },
            { ...adiantamento, docCod: 'A1', valorMoedaNegociada: 2000 },
            { ...adiantamento, docCod: 'A2', valorMoedaNegociada: 3000 },
        ];

        await repo.upsertAdiantamentos(tx, 'run-1', rows);

        const [, params] = (tx.insert as jest.Mock).mock.calls[0];
        // 2 tuplas únicas (A1, A2) — não 3.
        expect(params.docCod_0).toBe('A1');
        expect(params.docCod_1).toBe('A2');
        expect(params.docCod_2).toBeUndefined();
        // último A1 vence.
        expect(params.valorMoedaNegociada_0).toBe(2000);
    });

    it('upsertInvoices: ON CONFLICT DO UPDATE, parameterized', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        await repo.upsertInvoices(tx, 'run-1', [invoice]);

        const [sql, params] = (tx.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO permuta_invoice');
        expect(sql).toContain('ON CONFLICT (doc_cod) DO UPDATE');
        expect(params.docCod_0).toBe('I1');
        expect(params.pago_0).toBe(false);
        // moeda NEGOCIADA (USD) persisted distinctly from the doc moeda (BRL).
        expect(sql).toContain('moeda_negociada');
        expect(params.moeda_0).toBe('BRL');
        expect(params.moedaNegociada_0).toBe('USD');
    });

    it('upsertDeclaracoes: ON CONFLICT (pri_cod, variante) DO UPDATE', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        await repo.upsertDeclaracoes(tx, 'run-1', [declaracao]);

        const [sql, params] = (tx.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO permuta_declaracao_importacao');
        expect(sql).toContain('ON CONFLICT (pri_cod, variante) DO UPDATE');
        expect(params.priCod_0).toBe('2048');
        expect(params.variante_0).toBe('DI');
    });

    it('replaceAutoCasamentos DELETEs then bulk-inserts the run casamentos', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        await repo.replaceAutoCasamentos(tx, 'run-1', [casamento]);

        const deleteSql = (tx.update as jest.Mock).mock.calls[0][0] as string;
        expect(deleteSql).toContain('DELETE FROM permuta_casamento');
        const [insertSql, params] = (tx.insert as jest.Mock).mock.calls[0];
        expect(insertSql).toContain('INSERT INTO permuta_casamento');
        expect(params.invoiceDocCod_0).toBe('I1');
        expect(params.adiantamentoDocCod_0).toBe('A1');
        expect(params.varClass_0).toBe('JUROS');
    });

    it('replaceAutoCasamentos with empty rows still DELETEs (recompute clears stale matches)', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        await repo.replaceAutoCasamentos(tx, 'run-1', []);
        expect(tx.update as jest.Mock).toHaveBeenCalledTimes(1); // DELETE only.
        expect(tx.insert as jest.Mock).not.toHaveBeenCalled();
    });

    it('markStale flags non-current-run rows across the three fact tables', async () => {
        const tx = buildTx();
        (tx.update as jest.Mock).mockResolvedValue(2);
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        const total = await repo.markStale(tx, 'run-1');

        expect(tx.update as jest.Mock).toHaveBeenCalledTimes(3);
        expect(total).toBe(6); // 2 per table × 3 tables.
        for (const call of (tx.update as jest.Mock).mock.calls) {
            const sql = call[0] as string;
            expect(sql).toContain('SET stale = TRUE');
            expect(sql).toContain('last_ingest_run_id IS DISTINCT FROM $runId');
            expect(sql).not.toMatch(/'\s*\+|\$\{/);
        }
    });

    it('listAdiantamentosAtivos filters NOT stale and maps rows', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                doc_cod: 'A1',
                pri_cod: '2048',
                fil_cod: 2,
                referencia: 'CT/1',
                pago: true,
                valor_moeda_negociada: 1000,
                moeda: 'BRL',
                moeda_negociada: 'USD',
                estado_elegibilidade: 'elegivel',
                aging_days: 30,
                stale: false,
            },
        ]);
        const repo = new PermutaRelationalRepository(db);

        const list = await repo.listAdiantamentosAtivos();
        const sql = (db.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(sql).toContain('WHERE NOT stale');
        expect(list[0]).toMatchObject({
            docCod: 'A1',
            estadoElegibilidade: 'elegivel',
            valorMoedaNegociada: 1000,
            // doc moeda (BRL) and negotiated moeda (USD) are mapped distinctly.
            moeda: 'BRL',
            moedaNegociada: 'USD',
            agingDays: 30,
        });
    });

    it('listAdiantamentosAtivos with estado filter parameterizes the predicate', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        await repo.listAdiantamentosAtivos({ estadoElegibilidade: 'elegivel' });
        const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('estado_elegibilidade = $estado');
        expect(params).toMatchObject({ estado: 'elegivel' });
    });

    it('listAdiantamentosAtivos filtra pelo estado ja-permutado com SQL parametrizado', async () => {
        // ADR-0043 — o union do filtro era HARDCODED e separado do da row; sem
        // esta linha a tela não conseguia filtrar o estado novo, e nada quebrava.
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        await repo.listAdiantamentosAtivos({ estadoElegibilidade: 'ja-permutado' });

        const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('estado_elegibilidade = $estado');
        // Rule #5 — nenhum valor interpolado na string.
        expect(sql).not.toContain('ja-permutado');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ estado: 'ja-permutado' });
    });

    it('mapAdiantamentoRow devolve o estado ja-permutado íntegro (union da row)', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                doc_cod: '8266',
                pri_cod: '5000',
                pago: true,
                estado_elegibilidade: 'ja-permutado',
                motivo_bloqueio: 'ja-permutado',
                stale: false,
            },
        ]);
        const repo = new PermutaRelationalRepository(db);

        const [row] = await repo.listAdiantamentosAtivos();

        expect(row.estadoElegibilidade).toBe('ja-permutado');
    });

    it('estado_elegibilidade fora do domínio FALHA ALTO na leitura — sem `as` cego', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                doc_cod: 'A404',
                pri_cod: '5000',
                pago: true,
                estado_elegibilidade: 'estado-que-nao-existe',
                stale: false,
            },
        ]);
        const repo = new PermutaRelationalRepository(db);

        await expect(repo.listAdiantamentosAtivos()).rejects.toThrow(/estado-que-nao-existe/);
    });

    it('listInvoicesEmAberto filters NOT pago AND NOT stale', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);
        await repo.listInvoicesEmAberto();
        const sql = (db.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(sql).toContain('NOT stale AND NOT pago');
    });

    it('findAdiantamento returns null when absent', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);
        expect(await repo.findAdiantamento('absent')).toBeNull();
    });

    it('reclassificarAdiantamento: UPDATE parametrizado com o estado de ORIGEM no WHERE, na tx', async () => {
        const tx = buildTx();
        (tx.update as jest.Mock).mockResolvedValue(1);
        const db = buildDb(tx);
        const repo = new PermutaRelationalRepository(db);

        const linhas = await repo.reclassificarAdiantamento(tx, {
            docCod: '8721',
            de: { estado: 'bloqueada', motivo: 'sem-saldo-permutar' },
            para: { estado: 'ja-permutado', motivo: 'permutado-fora-do-painel' },
        });

        expect(linhas).toBe(1);
        expect(db.update).not.toHaveBeenCalled();
        const [sql, params] = (tx.update as jest.Mock).mock.calls[0];
        const normalizado = (sql as string).replace(/\s+/g, ' ').trim();
        expect(normalizado).toBe(
            'UPDATE permuta_adiantamento SET estado_elegibilidade = $paraEstado, motivo_bloqueio = $paraMotivo WHERE doc_cod = $docCod AND NOT stale AND estado_elegibilidade = $deEstado AND motivo_bloqueio = $deMotivo',
        );
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toEqual({
            docCod: '8721',
            deEstado: 'bloqueada',
            deMotivo: 'sem-saldo-permutar',
            paraEstado: 'ja-permutado',
            paraMotivo: 'permutado-fora-do-painel',
        });
    });

    it('reclassificarAdiantamento devolve 0 quando a linha não está no estado de origem', async () => {
        const tx = buildTx();
        (tx.update as jest.Mock).mockResolvedValue(0);
        const repo = new PermutaRelationalRepository(buildDb(tx));

        await expect(
            repo.reclassificarAdiantamento(tx, {
                docCod: '8721',
                de: { estado: 'ja-permutado', motivo: 'permutado-fora-do-painel' },
                para: { estado: 'bloqueada', motivo: 'sem-saldo-permutar' },
            }),
        ).resolves.toBe(0);
    });
});
