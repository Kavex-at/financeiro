import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import RecebimentoIngestaoRunRepository from './RecebimentoIngestaoRunRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

describe('RecebimentoIngestaoRunRepository', () => {
    it('createRun abre a run como running e devolve o id gerado', async () => {
        const db = buildDb();
        const runId = await new RecebimentoIngestaoRunRepository(db).createRun({
            correlationId: 'corr-1',
            triggeredBy: 'cron',
            filCods: [1, 2],
            periodoDe: new Date('2026-05-01T00:00:00Z'),
            periodoAte: new Date('2026-07-30T00:00:00Z'),
        });

        expect(runId).toMatch(/^[0-9a-f-]{36}$/);
        const [sql, params] = (db.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain("'running'");
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({
            correlationId: 'corr-1',
            triggeredBy: 'cron',
            filCods: [1, 2],
        });
    });

    it('finishRun grava as contagens e aceita o status partial', async () => {
        const db = buildDb();
        await new RecebimentoIngestaoRunRepository(db).finishRun({
            runId: 'run-1',
            status: 'partial',
            totalLidas: 1759,
            totalInseridas: 1700,
            totalDeduplicadas: 59,
            totalContas: 7,
            totalContasFalhas: 1,
        });
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('finished_at = now()');
        expect(params).toMatchObject({
            status: 'partial',
            totalLidas: 1759,
            totalContasFalhas: 1,
            errorMessage: null,
        });
    });

    it('findLatestSuccessFinishedAt ignora runs partial — carteira incompleta não vira rótulo', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            finished_at: new Date('2026-07-30T12:00:00Z'),
        });
        const quando = await new RecebimentoIngestaoRunRepository(db).findLatestSuccessFinishedAt();
        const [sql] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain("status = 'success'");
        expect(quando).toBe('2026-07-30T12:00:00.000Z');
    });

    it('idempotência: grava a chave e recupera a run existente', async () => {
        const db = buildDb();
        const repo = new RecebimentoIngestaoRunRepository(db);

        await repo.recordIdempotencyKey('key-1', 'run-1');
        const [insertSql] = (db.insert as jest.Mock).mock.calls[0];
        expect(insertSql).toContain('ON CONFLICT (idempotency_key) DO NOTHING');

        (db.selectFirst as jest.Mock).mockResolvedValue({ run_id: 'run-1' });
        expect(await repo.findRunIdByIdempotencyKey('key-1')).toBe('run-1');

        (db.selectFirst as jest.Mock).mockResolvedValue(null);
        expect(await repo.findRunIdByIdempotencyKey('nope')).toBeNull();
    });

    it('listRecentRuns mapeia para camelCase com datas ISO', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                id: 'run-1',
                correlation_id: 'corr-1',
                triggered_by: 'cron',
                status: 'success',
                fil_cods: [1],
                periodo_de: new Date('2026-05-01T00:00:00Z'),
                periodo_ate: new Date('2026-07-30T00:00:00Z'),
                total_lidas: 10,
                total_inseridas: 8,
                total_deduplicadas: 2,
                total_contas: 7,
                total_contas_falhas: 0,
                error_message: null,
                started_at: new Date('2026-07-30T11:00:00Z'),
                finished_at: new Date('2026-07-30T11:05:00Z'),
            },
        ]);
        const [run] = await new RecebimentoIngestaoRunRepository(db).listRecentRuns(10);
        expect(run).toMatchObject({
            id: 'run-1',
            triggeredBy: 'cron',
            status: 'success',
            filCods: [1],
            totalInseridas: 8,
            finishedAt: '2026-07-30T11:05:00.000Z',
        });
        expect(run.errorMessage).toBeUndefined();
    });
});
