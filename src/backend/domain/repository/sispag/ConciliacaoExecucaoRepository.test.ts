import 'reflect-metadata';
import type ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import ConciliacaoExecucaoRepository from './ConciliacaoExecucaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const identidade = (conexosUsername: string | null, conexosUsnCod: string | null) =>
    ({
        current: jest.fn(),
        currentParams: jest.fn().mockReturnValue({ conexosUsername, conexosUsnCod }),
    }) as unknown as jest.Mocked<ConexosIdentityProvider>;

const input = {
    idempotencyKey: 'conc:4:1:10:20',
    filCod: 4,
    bncCod: 1,
    gtbCodSeq: 10,
    garCodSeq: 20,
    dryRun: false,
    executadoPor: 'simone@kavex.com',
};

/**
 * Era a ÚNICA das seis ledgers sem arquivo de teste (Regis-Review testability F-2). O
 * `PUT fin052/arquivosRetorno/processar` que ela guarda é irreversível — gera baixas no fin010.
 */
describe('ConciliacaoExecucaoRepository — identidade Conexos (I-2, ADR-0041)', () => {
    it('beginExecution grava as duas colunas e PRESERVA a identidade de uma linha settled', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });

        await new ConciliacaoExecucaoRepository(
            db,
            identidade('SIMONE_PEREIRA', '14'),
        ).beginExecution(input);

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO conciliacao_execucao');
        expect(sql).toContain('conexos_username');
        expect(sql).toContain(
            "conexos_username = CASE WHEN conciliacao_execucao.status = 'settled'",
        );
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({
            conexosUsername: 'SIMONE_PEREIRA',
            conexosUsnCod: '14',
        });
    });

    it('settle preenche a identidade só quando ainda nula (COALESCE)', async () => {
        const db = buildDb();
        await new ConciliacaoExecucaoRepository(db, identidade('MPS_ROBO', '97')).settle(
            'conc:4:1:10:20',
            {
                processou: true,
                totalLinhas: 10,
                pagos: 9,
                rejeitados: 1,
                varreduraIncompleta: false,
            },
        );

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username = COALESCE(conexos_username, $conexosUsername)');
        expect(params).toMatchObject({ conexosUsername: 'MPS_ROBO', conexosUsnCod: '97' });
    });

    it('fail também carimba a identidade', async () => {
        const db = buildDb();
        await new ConciliacaoExecucaoRepository(db, identidade('MPS_ROBO', '97')).fail(
            'conc:4:1:10:20',
            'ERP recusou',
        );

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username = COALESCE(conexos_username, $conexosUsername)');
        expect(params).toMatchObject({ conexosUsername: 'MPS_ROBO', conexosUsnCod: '97' });
    });

    it('sem identidade (job/cron) grava NULL, sem quebrar a escrita', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });

        await new ConciliacaoExecucaoRepository(db, identidade(null, null)).beginExecution(input);

        const [, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(params).toMatchObject({ conexosUsername: null, conexosUsnCod: null });
    });
});
