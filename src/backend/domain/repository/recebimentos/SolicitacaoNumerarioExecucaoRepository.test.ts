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
        // Sem override, o settle continua gravando `concluido` (trilha completa, com NDe).
        expect(sql).toContain("etapa = COALESCE($etapa, 'concluido')");
        expect(sql).toContain('erro_mensagem = NULL');
        expect(sql).toContain('$erpResponse::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        const params = paramsOf(db.update as jest.Mock);
        expect(params).toMatchObject({ key: 'sn:u:1', docCod: 18202, etapa: null });
        expect(params.erpResponse).toBe(JSON.stringify({ docVldComvalidacoes: 1 }));
    });

    it('markSettled: etapa override grava o terminal do ramo sem NDe (ADR-0031)', async () => {
        const db = buildDb();
        await new SolicitacaoNumerarioExecucaoRepository(db).markSettled('sn:u:2', {
            docCod: 18203,
            etapa: 'quitado-sem-nde',
        });
        const sql = sqlOf(db.update as jest.Mock);
        // Mesmo UPDATE parametrizado — o COALESCE é o único ponto de variação (nada interpolado).
        expect(sql).toContain("etapa = COALESCE($etapa, 'concluido')");
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        const params = paramsOf(db.update as jest.Mock);
        // `ndDocCod` fica null: neste ramo a nota nunca é emitida.
        expect(params).toMatchObject({
            key: 'sn:u:2',
            docCod: 18203,
            etapa: 'quitado-sem-nde',
            ndDocCod: null,
        });
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

describe('SolicitacaoNumerarioExecucaoRepository — auditoria (listByTxnId / listByStatus)', () => {
    const row = {
        idempotency_key: 'sn-real:txn-1:3254:100',
        fil_cod: 2,
        pri_cod: 3254,
        txn_id: 'txn-1',
        valor: 100,
        status: 'error',
        dry_run: false,
        nd_doc_cod: 18348,
        etapa: 'obs-done',
        erro_mensagem: 'homologação rejeitada',
        criado_em: '2026-08-03T00:00:00Z',
        atualizado_em: '2026-08-03T01:00:00Z',
    };

    it('listByTxnId: WHERE txn_id, ordena por atualizado_em DESC, parametrizado, mapeia as linhas', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([row]);
        const repo = new SolicitacaoNumerarioExecucaoRepository(db);
        const out = await repo.listByTxnId('txn-1');
        const sql = sqlOf(db.selectMany as jest.Mock);
        expect(sql).toContain('WHERE txn_id = $txnId');
        expect(sql).toContain('ORDER BY atualizado_em DESC');
        expect(paramsOf(db.selectMany as jest.Mock)).toEqual({ txnId: 'txn-1' });
        expect(out[0]).toMatchObject({ txnId: 'txn-1', ndDocCod: 18348, status: 'error' });
    });

    it('listByStatus: WHERE status + LIMIT, parametrizado', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([row]);
        const repo = new SolicitacaoNumerarioExecucaoRepository(db);
        await repo.listByStatus('error', 50);
        const sql = sqlOf(db.selectMany as jest.Mock);
        expect(sql).toContain('WHERE status = $status');
        expect(sql).toContain('LIMIT $limit');
        expect(paramsOf(db.selectMany as jest.Mock)).toEqual({ status: 'error', limit: 50 });
    });
});

describe('SolicitacaoNumerarioExecucaoRepository — regra Σ e aba Falhas (ADR-0034)', () => {
    describe('somarSettledPorTxnId', () => {
        it('soma só settled e não-dry-run, parametrizado', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({ total: '7500.00', linhas: '2' });
            const repo = new SolicitacaoNumerarioExecucaoRepository(db);

            const out = await repo.somarSettledPorTxnId('txn-1');

            const sql = sqlOf(db.selectFirst as jest.Mock);
            expect(sql).toContain('SUM(valor)');
            expect(sql).toContain('WHERE txn_id = $txnId');
            expect(sql).toContain("status = 'settled'");
            expect(sql).toContain('dry_run = FALSE');
            expect(sql).not.toMatch(/'\s*\+|\$\{/);
            expect(paramsOf(db.selectFirst as jest.Mock)).toEqual({ txnId: 'txn-1' });
            expect(out).toBe(7500);
        });

        it('zero linhas → undefined (indeterminado, o chamador não regride o status)', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({ total: null, linhas: '0' });
            const repo = new SolicitacaoNumerarioExecucaoRepository(db);
            await expect(repo.somarSettledPorTxnId('txn-1')).resolves.toBeUndefined();
        });

        it('linhas sem valor (pré-0042) → 0, não undefined: houve execução, a Σ é que é 0', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({ total: null, linhas: '3' });
            const repo = new SolicitacaoNumerarioExecucaoRepository(db);
            await expect(repo.somarSettledPorTxnId('txn-1')).resolves.toBe(0);
        });

        it('sem linha de retorno → undefined', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue(null);
            const repo = new SolicitacaoNumerarioExecucaoRepository(db);
            await expect(repo.somarSettledPorTxnId('txn-1')).resolves.toBeUndefined();
        });
    });

    describe('listUltimaFalhaPorTxnIds', () => {
        const falha = {
            txn_id: 'txn-1',
            pri_cod: 90001,
            valor: '2500.00',
            etapa: 'fin014',
            erro_mensagem: 'Título já baixado no Conexos.',
            doc_cod: 18342,
            nd_doc_cod: null,
            executado_por: 'yuri',
            status: 'error',
            atualizado_em: '2026-08-12T10:00:00Z',
        };

        it('lista vazia não vai ao banco', async () => {
            const db = buildDb();
            const repo = new SolicitacaoNumerarioExecucaoRepository(db);
            await expect(repo.listUltimaFalhaPorTxnIds([])).resolves.toEqual(new Map());
            expect(db.selectMany).not.toHaveBeenCalled();
        });

        it('DISTINCT ON pega a mais recente, fan-in por ANY, parametrizado', async () => {
            const db = buildDb();
            (db.selectMany as jest.Mock).mockResolvedValue([falha]);
            const repo = new SolicitacaoNumerarioExecucaoRepository(db);

            const out = await repo.listUltimaFalhaPorTxnIds(['txn-1', 'txn-2']);

            const sql = sqlOf(db.selectMany as jest.Mock);
            expect(sql).toContain('DISTINCT ON (txn_id)');
            expect(sql).toContain('txn_id = ANY($txnIds)');
            expect(sql).toContain('ORDER BY txn_id, atualizado_em DESC');
            expect(sql).not.toMatch(/'\s*\+|\$\{/);
            expect(paramsOf(db.selectMany as jest.Mock)).toEqual({
                txnIds: ['txn-1', 'txn-2'],
                minutosParado: 15,
            });
            expect(out.get('txn-1')).toMatchObject({
                priCod: 90001,
                valor: 2500,
                etapa: 'fin014',
                mensagem: 'Título já baixado no Conexos.',
                docCod: 18342,
                executadoPor: 'yuri',
                interrompida: false,
            });
        });

        it('inclui reconciling parado além da janela, marcado como interrompida', async () => {
            const db = buildDb();
            (db.selectMany as jest.Mock).mockResolvedValue([
                { ...falha, status: 'reconciling', erro_mensagem: null },
            ]);
            const repo = new SolicitacaoNumerarioExecucaoRepository(db);

            const out = await repo.listUltimaFalhaPorTxnIds(['txn-1']);

            const sql = sqlOf(db.selectMany as jest.Mock);
            expect(sql).toContain("status = 'reconciling'");
            expect(sql).toContain('make_interval(mins => $minutosParado::int)');
            expect(out.get('txn-1')).toMatchObject({ interrompida: true });
            expect(out.get('txn-1')).not.toHaveProperty('mensagem');
        });

        it('NUNCA seleciona erp_response nem request_payload — a aba não é admin-only', async () => {
            const db = buildDb();
            (db.selectMany as jest.Mock).mockResolvedValue([]);
            const repo = new SolicitacaoNumerarioExecucaoRepository(db);
            await repo.listUltimaFalhaPorTxnIds(['txn-1']);
            const sql = sqlOf(db.selectMany as jest.Mock);
            expect(sql).not.toContain('erp_response');
            expect(sql).not.toContain('request_payload');
        });
    });
});
