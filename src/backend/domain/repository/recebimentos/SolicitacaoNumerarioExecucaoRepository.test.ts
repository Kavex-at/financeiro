import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import SolicitacaoNumerarioExecucaoRepository from './SolicitacaoNumerarioExecucaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const sqlOf = (m: jest.Mock, i = 0) => m.mock.calls[i][0] as string;
const paramsOf = (m: jest.Mock, i = 0) => m.mock.calls[i][1] as Record<string, unknown>;

describe('SolicitacaoNumerarioExecucaoRepository — write-ahead ledger da SN (com299)', () => {
    it('beginExecution: UPSERT que PRESERVA settled (CASE WHEN) e é parametrizado', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });
        const repo = new SolicitacaoNumerarioExecucaoRepository(db);

        const out = await repo.beginExecution({
            idempotencyKey: 'sn:u:1',
            correlationId: 'corr-1',
            filCod: 2,
            priCod: 90001,
            txnId: 'txn-1',
            valor: 15000,
            dryRun: false,
            executadoPor: 'yuri',
        });

        const sql = sqlOf(db.selectFirst as jest.Mock);
        expect(sql).toContain('INSERT INTO solicitacao_numerario_execucao');
        expect(sql).toContain('ON CONFLICT (idempotency_key) DO UPDATE');
        // O CASE WHEN status='settled' garante que retry NUNCA regride/duplica a SN.
        expect(sql).toContain("solicitacao_numerario_execucao.status = 'settled'");
        expect(sql).toContain('$newStatus');
        expect(sql).toContain('$txnId');
        expect(sql).toContain('$valor');
        expect(sql).not.toMatch(/'\s*\+|\$\{/); // sem interpolação
        expect(paramsOf(db.selectFirst as jest.Mock)).toMatchObject({
            key: 'sn:u:1',
            correlationId: 'corr-1',
            priCod: 90001,
            txnId: 'txn-1',
            valor: 15000,
            newStatus: 'reconciling',
            dryRun: false,
        });
        expect(out).toEqual({ status: 'reconciling', alreadySettled: false });
    });

    it('beginExecution: dry-run abre como pending; settled retornado vira alreadySettled', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'settled' });
        const repo = new SolicitacaoNumerarioExecucaoRepository(db);

        const out = await repo.beginExecution({
            idempotencyKey: 'sn:u:1',
            filCod: 2,
            priCod: 90001,
            dryRun: true,
            executadoPor: 'yuri',
        });

        expect(paramsOf(db.selectFirst as jest.Mock)).toMatchObject({
            newStatus: 'pending',
            dryRun: true,
            correlationId: null,
            txnId: null,
            valor: null,
        });
        expect(out).toEqual({ status: 'settled', alreadySettled: true });
    });

    it('setDocCod: UPDATE parametrizado do doc_cod (rastreabilidade de órfão) + etapa sn', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).setDocCod('sn:u:1', 18202);
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain('SET doc_cod = $docCod');
        expect(sql).toContain("etapa = 'sn'");
        expect(paramsOf(db.update as jest.Mock)).toEqual({ key: 'sn:u:1', docCod: 18202 });
    });

    it('setFin014BorCod: UPDATE parametrizado do borderô + etapa fin014-done', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).setFin014BorCod('sn:u:1', 77);
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain('fin014_bor_cod = $borCod');
        expect(sql).toContain("etapa = 'fin014-done'");
        expect(paramsOf(db.update as jest.Mock)).toEqual({ key: 'sn:u:1', borCod: 77 });
    });

    it('setNdDocCod: UPDATE parametrizado da nota de débito + etapa nota-debito', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).setNdDocCod('sn:u:1', 18337);
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain('nd_doc_cod = $docCod');
        expect(sql).toContain("etapa = 'nota-debito'");
        expect(paramsOf(db.update as jest.Mock)).toEqual({ key: 'sn:u:1', docCod: 18337 });
    });

    it('setEtapa: UPDATE parametrizado da etapa (leg fiscal)', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).setEtapa('sn:u:1', 'fiscal-done');
        expect(sqlOf(db.update as jest.Mock)).toContain('SET etapa = $etapa');
        expect(paramsOf(db.update as jest.Mock)).toEqual({ key: 'sn:u:1', etapa: 'fiscal-done' });
    });

    it('setRevisaoHumana: UPDATE parametrizado do flag de revisão', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).setRevisaoHumana('sn:u:1', true);
        expect(sqlOf(db.update as jest.Mock)).toContain('revisao_humana = $revisao');
        expect(paramsOf(db.update as jest.Mock)).toEqual({ key: 'sn:u:1', revisao: true });
    });

    it('setNdeAutorizado: UPDATE parametrizado do flag de autorização SEFAZ', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).setNdeAutorizado('sn:u:1', true);
        expect(sqlOf(db.update as jest.Mock)).toContain('nde_autorizado = $autorizado');
        expect(paramsOf(db.update as jest.Mock)).toEqual({ key: 'sn:u:1', autorizado: true });
    });

    it('setRequestPayload: UPDATE jsonb parametrizado', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).setRequestPayload('sn:u:1', { a: 1 });
        expect(sqlOf(db.update as jest.Mock)).toContain('request_payload = $payload::jsonb');
        expect(paramsOf(db.update as jest.Mock)).toEqual({
            key: 'sn:u:1',
            payload: JSON.stringify({ a: 1 }),
        });
    });

    it('markSettled: UPDATE para settled com doc_cod/jsonb, limpa erro_mensagem', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).markSettled('sn:u:1', {
            docCod: 18202,
            erpResponse: { docVldComvalidacoes: 1 },
        });
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain("status = 'settled'");
        expect(sql).toContain("etapa = 'concluido'");
        expect(sql).toContain('erro_mensagem = NULL');
        expect(sql).toContain('$erpResponse::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        const params = paramsOf(db.update as jest.Mock);
        expect(params).toMatchObject({ key: 'sn:u:1', docCod: 18202 });
        expect(params.erpResponse).toBe(JSON.stringify({ docVldComvalidacoes: 1 }));
    });

    it('markError: UPDATE para error, preserva doc_cod via COALESCE', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).markError('sn:u:1', {
            erroMensagem: 'ERP 500',
            erpResponse: { docVldComvalidacoes: 3 },
        });
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain("status = 'error'");
        expect(sql).toContain('doc_cod = COALESCE($docCod, doc_cod)');
        const params = paramsOf(db.update as jest.Mock);
        expect(params).toMatchObject({ key: 'sn:u:1', erroMensagem: 'ERP 500' });
        expect(params.erpResponse).toBe(JSON.stringify({ docVldComvalidacoes: 3 }));
    });

    it('findByIdempotencyKey: mapeia a linha (camelCase + tipos); null quando ausente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            idempotency_key: 'sn:u:1',
            correlation_id: 'corr-1',
            fil_cod: 2,
            pri_cod: 90001,
            txn_id: 'txn-1',
            valor: '15000.00',
            status: 'settled',
            dry_run: false,
            doc_cod: 18202,
            fin014_bor_cod: 77,
            nd_doc_cod: 18337,
            etapa: 'concluido',
            revisao_humana: false,
            nde_autorizado: true,
            criado_em: '2026-07-01T00:00:00Z',
            atualizado_em: '2026-07-01T00:00:00Z',
        });
        const repo = new SolicitacaoNumerarioExecucaoRepository(db);
        const row = await repo.findByIdempotencyKey('sn:u:1');
        expect(row).toMatchObject({
            idempotencyKey: 'sn:u:1',
            correlationId: 'corr-1',
            filCod: 2,
            priCod: 90001,
            txnId: 'txn-1',
            valor: 15000,
            status: 'settled',
            dryRun: false,
            docCod: 18202,
            fin014BorCod: 77,
            ndDocCod: 18337,
            etapa: 'concluido',
            revisaoHumana: false,
            ndeAutorizado: true,
        });

        const db2 = buildDb();
        expect(
            await new SolicitacaoNumerarioExecucaoRepository(db2).findByIdempotencyKey('nope'),
        ).toBeNull();
    });
});

/**
 * Ledger idempotency SQL — cobertura das 3 branches do `CASE WHEN` de `beginExecution`
 * (testability-1). Espelha o `RecebimentoExecucaoRepository`: aqui asseguramos o CONTRATO SQL (a
 * preservação de settled) e as transições pending→settled / reconciling→settled / settled→settled.
 */
describe('SolicitacaoNumerarioExecucaoRepository — preservação de settled (CASE WHEN)', () => {
    it.each([
        ['pending', 'settled', false],
        ['reconciling', 'settled', false],
        ['settled', 'settled', true],
    ])('begin retornando %s → status final %s, alreadySettled=%s', async (returned, finalStatus, already) => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: returned });
        const repo = new SolicitacaoNumerarioExecucaoRepository(db);
        const out = await repo.beginExecution({
            idempotencyKey: 'sn:u:1',
            filCod: 2,
            priCod: 90001,
            dryRun: false,
            executadoPor: 'yuri',
        });
        expect(out.status).toBe(returned === 'settled' ? finalStatus : returned);
        expect(out.alreadySettled).toBe(already);
    });
});
