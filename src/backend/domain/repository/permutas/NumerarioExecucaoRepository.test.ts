import 'reflect-metadata';
import type ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import NumerarioExecucaoRepository from './NumerarioExecucaoRepository.js';

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
    idempotencyKey: 'sn:A',
    adiantamentoDocCod: 'A',
    filCod: 4,
    gcdCod: 150,
    valor: 1000,
    dryRun: false,
    executadoPor: 'simone@kavex.com',
};

/**
 * A SEXTA ledger write-ahead (ADR-0041). Não tem `_execucao` no nome, mas guarda a cadeia
 * com299 → fin014 → com297 da trilha de PERMUTA — escrita irreversível no ERP como as outras.
 * Este arquivo nasceu junto com a correção de escopo: até aqui o repositório não tinha teste.
 */
describe('NumerarioExecucaoRepository — identidade Conexos (I-2, ADR-0041)', () => {
    it('beginExecution grava as duas colunas e PRESERVA a identidade de uma linha settled', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });

        await new NumerarioExecucaoRepository(
            db,
            identidade('SIMONE_PEREIRA', '14'),
        ).beginExecution(input);

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO solicitacao_numerario');
        expect(sql).toContain('conexos_username');
        expect(sql).toContain('conexos_usn_cod');
        expect(sql).toContain(
            "conexos_username = CASE WHEN solicitacao_numerario.status = 'settled'",
        );
        // Rule #5 — zero interpolação.
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({
            executadoPor: 'simone@kavex.com',
            conexosUsername: 'SIMONE_PEREIRA',
            conexosUsnCod: '14',
        });
    });

    it('markSettled preenche a identidade só quando ainda nula (COALESCE)', async () => {
        const db = buildDb();
        await new NumerarioExecucaoRepository(db, identidade('MPS_ROBO', '97')).markSettled(
            'sn:A',
            {
                ndDocCod: 123,
            },
        );

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username = COALESCE(conexos_username, $conexosUsername)');
        expect(sql).toContain('conexos_usn_cod = COALESCE(conexos_usn_cod, $conexosUsnCod)');
        expect(params).toMatchObject({ conexosUsername: 'MPS_ROBO', conexosUsnCod: '97' });
    });

    it('markError também carimba a identidade', async () => {
        const db = buildDb();
        await new NumerarioExecucaoRepository(db, identidade('MPS_ROBO', '97')).markError('sn:A', {
            etapa: 'sn',
            erroMensagem: 'ERP 500',
        });

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username = COALESCE(conexos_username, $conexosUsername)');
        expect(params).toMatchObject({ conexosUsername: 'MPS_ROBO', conexosUsnCod: '97' });
    });

    it('sem identidade (job/cron) grava NULL, sem quebrar a escrita', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });

        await new NumerarioExecucaoRepository(db, identidade(null, null)).beginExecution(input);

        const [, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(params).toMatchObject({ conexosUsername: null, conexosUsnCod: null });
    });
});
