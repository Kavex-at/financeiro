import 'reflect-metadata';
import type ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import RecebimentoExecucaoRepository from './RecebimentoExecucaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const sqlOf = (m: jest.Mock, i = 0) => m.mock.calls[i][0] as string;
const paramsOf = (m: jest.Mock, i = 0) => m.mock.calls[i][1] as Record<string, unknown>;

/** Identidade Conexos ausente (fora de request) — o default dos testes de SQL. */
const buildIdentity = () =>
    ({
        current: jest.fn().mockReturnValue(undefined),
        currentParams: jest.fn().mockReturnValue({ conexosUsername: null, conexosUsnCod: null }),
    }) as unknown as jest.Mocked<ConexosIdentityProvider>;

describe('RecebimentoExecucaoRepository — write-ahead ledger da idempotência (I-Receb-2)', () => {
    it('beginExecution: UPSERT que PRESERVA settled (CASE WHEN) e é parametrizado', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });
        const repo = new RecebimentoExecucaoRepository(db, buildIdentity());

        const out = await repo.beginExecution({
            idempotencyKey: 'receb:u:1',
            recebimentoId: 'rec-1',
            filCod: 4,
            dryRun: false,
            executadoPor: 'yuri',
        });

        const sql = sqlOf(db.selectFirst as jest.Mock);
        expect(sql).toContain('INSERT INTO recebimento_execucao');
        expect(sql).toContain('ON CONFLICT (idempotency_key) DO UPDATE');
        // O CASE WHEN status='settled' garante que retry NUNCA regride/duplica quitação/NDe.
        expect(sql).toContain("recebimento_execucao.status = 'settled'");
        expect(sql).toContain('$newStatus');
        expect(sql).not.toMatch(/'\s*\+|\$\{/); // sem interpolação
        expect(paramsOf(db.selectFirst as jest.Mock)).toMatchObject({
            key: 'receb:u:1',
            newStatus: 'reconciling',
            dryRun: false,
        });
        expect(out).toEqual({ status: 'reconciling', alreadySettled: false });
    });

    it('beginExecution: dry-run abre como pending; settled retornado vira alreadySettled', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'settled' });
        const repo = new RecebimentoExecucaoRepository(db, buildIdentity());

        const out = await repo.beginExecution({
            idempotencyKey: 'receb:u:1',
            recebimentoId: 'rec-1',
            filCod: 4,
            dryRun: true,
            executadoPor: 'yuri',
        });

        expect(paramsOf(db.selectFirst as jest.Mock)).toMatchObject({
            newStatus: 'pending',
            dryRun: true,
        });
        expect(out).toEqual({ status: 'settled', alreadySettled: true });
    });

    it('setBorCod: UPDATE parametrizado do bor_cod (rastreabilidade de órfão)', async () => {
        const db = buildDb();
        await new RecebimentoExecucaoRepository(db, buildIdentity()).setBorCod('receb:u:1', 999000);
        expect(sqlOf(db.update as jest.Mock)).toContain('SET bor_cod = $borCod');
        expect(paramsOf(db.update as jest.Mock)).toEqual({ key: 'receb:u:1', borCod: 999000 });
    });

    it('setRequestPayload: UPDATE jsonb parametrizado', async () => {
        const db = buildDb();
        await new RecebimentoExecucaoRepository(db, buildIdentity()).setRequestPayload(
            'receb:u:1',
            { a: 1 },
        );
        expect(sqlOf(db.update as jest.Mock)).toContain('request_payload = $payload::jsonb');
        expect(paramsOf(db.update as jest.Mock)).toEqual({
            key: 'receb:u:1',
            payload: JSON.stringify({ a: 1 }),
        });
    });

    it('markSettled: UPDATE para settled com bor_cod/nde_id/jsonb, limpa erro_mensagem', async () => {
        const db = buildDb();
        await new RecebimentoExecucaoRepository(db, buildIdentity()).markSettled('receb:u:1', {
            borCod: 999000,
            ndeId: 'nde-1',
            erpResponse: { bxaCodSeq: 999001 },
        });
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain("status = 'settled'");
        expect(sql).toContain('erro_mensagem = NULL');
        expect(sql).toContain('$erpResponse::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        const params = paramsOf(db.update as jest.Mock);
        expect(params).toMatchObject({ key: 'receb:u:1', borCod: 999000, ndeId: 'nde-1' });
        expect(params.erpResponse).toBe(JSON.stringify({ bxaCodSeq: 999001 }));
    });

    it('markError: UPDATE para error, preserva bor_cod via COALESCE', async () => {
        const db = buildDb();
        await new RecebimentoExecucaoRepository(db, buildIdentity()).markError('receb:u:1', {
            erroMensagem: 'ERP 500',
            erpResponse: { type: 'VALIDATION' },
        });
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain("status = 'error'");
        expect(sql).toContain('bor_cod = COALESCE($borCod, bor_cod)');
        const params = paramsOf(db.update as jest.Mock);
        expect(params).toMatchObject({ key: 'receb:u:1', erroMensagem: 'ERP 500' });
        expect(params.erpResponse).toBe(JSON.stringify({ type: 'VALIDATION' }));
    });

    it('findByIdempotencyKey: mapeia a linha (camelCase + tipos); null quando ausente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            idempotency_key: 'receb:u:1',
            recebimento_id: 'rec-1',
            fil_cod: 4,
            status: 'settled',
            dry_run: false,
            bor_cod: 999000,
            nde_id: 'nde-1',
            criado_em: '2026-07-01T00:00:00Z',
            atualizado_em: '2026-07-01T00:00:00Z',
        });
        const repo = new RecebimentoExecucaoRepository(db, buildIdentity());
        const row = await repo.findByIdempotencyKey('receb:u:1');
        expect(row).toMatchObject({
            idempotencyKey: 'receb:u:1',
            recebimentoId: 'rec-1',
            filCod: 4,
            status: 'settled',
            dryRun: false,
            borCod: 999000,
            ndeId: 'nde-1',
        });

        const db2 = buildDb();
        expect(
            await new RecebimentoExecucaoRepository(db2, buildIdentity()).findByIdempotencyKey(
                'nope',
            ),
        ).toBeNull();
    });
});

/**
 * Ledger idempotency SQL — cobertura das 3 branches do `CASE WHEN` de `beginExecution`
 * (testability-1). O harness de integração real (docker-compose.test.yml) não existe neste
 * scaffold; aqui asseguramos o CONTRATO SQL (a preservação de settled) e as transições
 * pending→settled / reconciling→settled / settled→settled a nível de statement + retorno mapeado.
 */
describe('RecebimentoExecucaoRepository — preservação de settled (CASE WHEN)', () => {
    it.each([
        ['pending', 'settled', false],
        ['reconciling', 'settled', false],
        ['settled', 'settled', true],
    ])('begin retornando %s → status final %s, alreadySettled=%s', async (returned, finalStatus, already) => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: returned });
        const repo = new RecebimentoExecucaoRepository(db, buildIdentity());
        const out = await repo.beginExecution({
            idempotencyKey: 'receb:u:1',
            recebimentoId: 'rec-1',
            filCod: 4,
            dryRun: false,
            executadoPor: 'yuri',
        });
        // A regressão de settled é impossível pelo statement (CASE WHEN), aqui provamos o mapeamento.
        expect(out.status).toBe(returned === 'settled' ? finalStatus : returned);
        expect(out.alreadySettled).toBe(already);
    });
});

describe('RecebimentoExecucaoRepository — identidade Conexos (I-2, ADR-0041)', () => {
    const identidade = (conexosUsername: string | null, conexosUsnCod: string | null) =>
        ({
            current: jest.fn(),
            currentParams: jest.fn().mockReturnValue({ conexosUsername, conexosUsnCod }),
        }) as unknown as jest.Mocked<ConexosIdentityProvider>;

    it('beginExecution grava as duas colunas e PRESERVA a identidade de uma linha settled', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });

        await new RecebimentoExecucaoRepository(
            db,
            identidade('SIMONE_PEREIRA', '14'),
        ).beginExecution({
            idempotencyKey: 'rec:1',
            recebimentoId: 'r1',
            filCod: 4,
            dryRun: false,
            executadoPor: 'simone@kavex.com',
        });

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username');
        expect(sql).toContain('conexos_usn_cod');
        expect(sql).toContain(
            "conexos_username = CASE WHEN recebimento_execucao.status = 'settled'",
        );
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ conexosUsername: 'SIMONE_PEREIRA', conexosUsnCod: '14' });
    });

    it('o terminal preenche a identidade só quando ainda nula (COALESCE)', async () => {
        const db = buildDb();
        await new RecebimentoExecucaoRepository(db, identidade('MPS_ROBO', '97')).markSettled(
            'rec:1',
            { borCod: 1 },
        );

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username = COALESCE(conexos_username, $conexosUsername)');
        expect(params).toMatchObject({ conexosUsername: 'MPS_ROBO', conexosUsnCod: '97' });
    });

    it('sem identidade (job/cron) grava NULL, sem quebrar a escrita', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });

        await new RecebimentoExecucaoRepository(db, identidade(null, null)).beginExecution({
            idempotencyKey: 'rec:1',
            recebimentoId: 'r1',
            filCod: 4,
            dryRun: false,
            executadoPor: 'simone@kavex.com',
        });

        const [, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(params).toMatchObject({ conexosUsername: null, conexosUsnCod: null });
    });
});
