import 'reflect-metadata';
import type ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import PermutaExecucaoRepository from './PermutaExecucaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

/** Identidade Conexos ausente (fora de request) — o default dos testes de SQL. */
const buildIdentity = () =>
    ({
        current: jest.fn().mockReturnValue(undefined),
        currentParams: jest.fn().mockReturnValue({ conexosUsername: null, conexosUsnCod: null }),
    }) as unknown as jest.Mocked<ConexosIdentityProvider>;

describe('PermutaExecucaoRepository', () => {
    it('beginExecution: UPSERT que PRESERVA settled (idempotência) e é parametrizado', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });
        const repo = new PermutaExecucaoRepository(db, buildIdentity());

        const out = await repo.beginExecution({
            idempotencyKey: 'permuta:A:I',
            adiantamentoDocCod: 'A',
            invoiceDocCod: 'I',
            filCod: 4,
            dryRun: false,
            executadoPor: 'yuri',
        });

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO permuta_alocacao_execucao');
        expect(sql).toContain('ON CONFLICT (idempotency_key) DO UPDATE');
        // O CASE preserva o status quando já é 'settled' (não regride).
        expect(sql).toContain("permuta_alocacao_execucao.status = 'settled'");
        expect(sql).toContain('$newStatus');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({
            key: 'permuta:A:I',
            newStatus: 'reconciling',
            dryRun: false,
        });
        expect(out).toEqual({ status: 'reconciling', alreadySettled: false });
    });

    it('borderoDoPar: SÓ execução REAL com bor_cod (dry_run=false, bor_cod NOT NULL), parametrizado', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ bor_cod: 2039 });
        const repo = new PermutaExecucaoRepository(db, buildIdentity());

        const out = await repo.borderoDoPar('4061', '4117');

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('FROM permuta_alocacao_execucao');
        expect(sql).toContain('dry_run = false');
        expect(sql).toContain('bor_cod IS NOT NULL');
        // IGNORA borderô CANCELADO (bor_vld_finalizado = 2) — baixa estornada no ERP → não trava.
        expect(sql).toContain('NOT EXISTS');
        expect(sql).toContain('permuta_bordero');
        expect(sql).toContain('bor_vld_finalizado = 2');
        // join por PAR (filial + borderô): o nº do borderô é por filial — não pode casar a filial errada.
        expect(sql).toContain('b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod');
        expect(sql).toContain('$adtoDocCod');
        expect(sql).toContain('$invoiceDocCod');
        expect(sql).not.toMatch(/'\s*\+|\$\{/); // sem interpolação
        expect(params).toEqual({ adtoDocCod: '4061', invoiceDocCod: '4117' });
        expect(out).toBe(2039);
    });

    it('borderoDoPar: sem linha → null (par sem borderô vivo: nunca baixou OU borderô cancelado/excluído)', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue(null);
        const repo = new PermutaExecucaoRepository(db, buildIdentity());
        expect(await repo.borderoDoPar('4061', '4117')).toBeNull();
    });

    it('beginExecution: dry-run abre como pending; settled retornado vira alreadySettled', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'settled' });
        const repo = new PermutaExecucaoRepository(db, buildIdentity());

        const out = await repo.beginExecution({
            idempotencyKey: 'permuta:A:I',
            adiantamentoDocCod: 'A',
            invoiceDocCod: 'I',
            filCod: 4,
            dryRun: true,
            executadoPor: 'yuri',
        });

        const [, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(params).toMatchObject({ newStatus: 'pending', dryRun: true });
        expect(out).toEqual({ status: 'settled', alreadySettled: true });
    });

    it('markSettled: UPDATE para settled com bxaCodSeq, JSONB e parametrizado', async () => {
        const db = buildDb();
        const repo = new PermutaExecucaoRepository(db, buildIdentity());

        await repo.markSettled('permuta:A:I', {
            borCod: 1999,
            bxaCodSeq: 1,
            valorBaixado: 40879.9,
            juros: 220,
            contaJuros: 131,
            erpResponse: { ok: true },
        });

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain("status = 'settled'");
        expect(sql).toContain('$erpResponse::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ key: 'permuta:A:I', bxaCodSeq: 1, contaJuros: 131 });
        expect(params.erpResponse).toBe(JSON.stringify({ ok: true }));
    });

    it('markError: UPDATE para error com mensagem + erpResponse', async () => {
        const db = buildDb();
        const repo = new PermutaExecucaoRepository(db, buildIdentity());

        await repo.markError('permuta:A:I', {
            erroMensagem: 'ERP 500',
            erpResponse: { type: 'VALIDATION' },
        });

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain("status = 'error'");
        expect(params).toMatchObject({ key: 'permuta:A:I', erroMensagem: 'ERP 500' });
        expect(params.erpResponse).toBe(JSON.stringify({ type: 'VALIDATION' }));
    });

    it('setBorCod: UPDATE parametrizado do bor_cod', async () => {
        const db = buildDb();
        const repo = new PermutaExecucaoRepository(db, buildIdentity());

        await repo.setBorCod('permuta:A:I', 1999);

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('SET bor_cod = $borCod');
        expect(params).toEqual({ key: 'permuta:A:I', borCod: 1999 });
    });

    it('findByIdempotencyKey: mapeia a linha (camelCase + tipos)', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            idempotency_key: 'permuta:A:I',
            adiantamento_doc_cod: 'A',
            invoice_doc_cod: 'I',
            fil_cod: 4,
            status: 'settled',
            dry_run: false,
            bor_cod: 1999,
            bxa_cod_seq: 1,
            valor_baixado: '40879.9',
            criado_em: '2026-06-23T00:00:00Z',
            atualizado_em: '2026-06-23T00:00:00Z',
        });
        const repo = new PermutaExecucaoRepository(db, buildIdentity());

        const row = await repo.findByIdempotencyKey('permuta:A:I');

        expect(row).toMatchObject({
            idempotencyKey: 'permuta:A:I',
            adiantamentoDocCod: 'A',
            filCod: 4,
            status: 'settled',
            dryRun: false,
            borCod: 1999,
            bxaCodSeq: 1,
            valorBaixado: 40879.9,
        });
    });

    it('findByIdempotencyKey: null quando não existe', async () => {
        const db = buildDb();
        const repo = new PermutaExecucaoRepository(db, buildIdentity());
        expect(await repo.findByIdempotencyKey('nope')).toBeNull();
    });
});

describe('PermutaExecucaoRepository — métodos restantes (testability-2)', () => {
    const sqlOf = (m: jest.Mock) => m.mock.calls[0][0] as string;
    const paramsOf = (m: jest.Mock) => m.mock.calls[0][1] as Record<string, unknown>;

    it('listByAdiantamento: filtra por adiantamento_doc_cod, parametrizado', async () => {
        const db = buildDb();
        await new PermutaExecucaoRepository(db, buildIdentity()).listByAdiantamento('A1');
        const sql = sqlOf(db.selectMany as jest.Mock);
        expect(sql).toContain('FROM permuta_alocacao_execucao');
        expect(sql).toContain('adiantamento_doc_cod = $adtoDocCod');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(paramsOf(db.selectMany as jest.Mock)).toEqual({ adtoDocCod: 'A1' });
    });

    it('listComBordero: só linhas com bor_cod NOT NULL', async () => {
        const db = buildDb();
        await new PermutaExecucaoRepository(db, buildIdentity()).listComBordero();
        expect(sqlOf(db.selectMany as jest.Mock)).toContain('bor_cod IS NOT NULL');
    });

    it('findByBorCodInvoice: WHERE bor_cod AND invoice_doc_cod, parametrizado', async () => {
        const db = buildDb();
        await new PermutaExecucaoRepository(db, buildIdentity()).findByBorCodInvoice(2039, '4117');
        const sql = sqlOf(db.selectFirst as jest.Mock);
        expect(sql).toContain('bor_cod = $borCod');
        expect(sql).toContain('invoice_doc_cod = $invoiceDocCod');
        expect(paramsOf(db.selectFirst as jest.Mock)).toEqual({
            borCod: 2039,
            invoiceDocCod: '4117',
        });
    });

    it('deleteByBorCodInvoice: DELETE por par, retorna nº de linhas', async () => {
        const db = buildDb();
        const n = await new PermutaExecucaoRepository(db, buildIdentity()).deleteByBorCodInvoice(
            2039,
            '4117',
        );
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain('DELETE FROM permuta_alocacao_execucao');
        expect(sql).toContain('bor_cod = $borCod');
        expect(sql).toContain('invoice_doc_cod = $invoiceDocCod');
        expect(paramsOf(db.update as jest.Mock)).toEqual({ borCod: 2039, invoiceDocCod: '4117' });
        expect(n).toBe(1);
    });

    it('listByBorCod: filtra por bor_cod', async () => {
        const db = buildDb();
        await new PermutaExecucaoRepository(db, buildIdentity()).listByBorCod(2039);
        expect(sqlOf(db.selectMany as jest.Mock)).toContain('WHERE bor_cod = $borCod');
        expect(paramsOf(db.selectMany as jest.Mock)).toEqual({ borCod: 2039 });
    });

    it('countByBorCod: count(*) → número (0 quando null)', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ n: '3' });
        expect(await new PermutaExecucaoRepository(db, buildIdentity()).countByBorCod(2039)).toBe(
            3,
        );
        expect(sqlOf(db.selectFirst as jest.Mock)).toContain('count(*)');
        const db2 = buildDb();
        expect(await new PermutaExecucaoRepository(db2, buildIdentity()).countByBorCod(1)).toBe(0);
    });

    it('deleteByBorCod / deleteByKey / setRequestPayload / renameKey: parametrizados', async () => {
        const db = buildDb();
        const repo = new PermutaExecucaoRepository(db, buildIdentity());
        await repo.deleteByBorCod(2039);
        await repo.deleteByKey('permuta:A:I');
        await repo.setRequestPayload('permuta:A:I', { a: 1 });
        await repo.renameKey('old', 'new');
        const calls = (db.update as jest.Mock).mock.calls;
        expect(calls[0][0]).toContain(
            'DELETE FROM permuta_alocacao_execucao WHERE bor_cod = $borCod',
        );
        expect(calls[0][1]).toEqual({ borCod: 2039 });
        expect(calls[1][1]).toEqual({ key: 'permuta:A:I' });
        expect(calls[2][0]).toContain('request_payload = $payload::jsonb');
        expect(calls[2][1]).toEqual({ key: 'permuta:A:I', payload: JSON.stringify({ a: 1 }) });
        expect(calls[3][0]).toContain('SET idempotency_key = $newKey');
        expect(calls[3][1]).toEqual({ oldKey: 'old', newKey: 'new' });
    });

    it('listBorderoCache: ordena por data desc, LIMIT clampado, mapeia situação', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                bor_cod: 9,
                fil_cod: 4,
                bor_vld_finalizado: 2,
                bor_cod_estornado: null,
                vlr_total_liquido: 10,
                bor_dta_mvto: 5,
                usn_des_nome_cad: 'admin',
            },
        ]);
        const out = await new PermutaExecucaoRepository(db, buildIdentity()).listBorderoCache(50);
        const sql = sqlOf(db.selectMany as jest.Mock);
        expect(sql).toContain('FROM permuta_bordero');
        expect(sql).toContain('ORDER BY bor_dta_mvto DESC');
        expect(sql).toContain('LIMIT 50');
        expect(out[0]).toMatchObject({ borCod: 9, filCod: 4, borVldFinalizado: 2 });
    });

    it('listBorderoCache: borderôs da trilha entram por UNION (imunes ao LIMIT)', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([]);
        await new PermutaExecucaoRepository(db, buildIdentity()).listBorderoCache(500);
        const sql = sqlOf(db.selectMany as jest.Mock);
        // Os recentes (top-N) são unidos aos borderôs referenciados pela trilha de execução,
        // casando por PAR (fil_cod, bor_cod) — senão um borderô da plataforma some ao envelhecer.
        expect(sql).toContain('UNION');
        expect(sql).toContain('JOIN permuta_alocacao_execucao');
        expect(sql).toContain('pae.bor_cod = pb.bor_cod AND pae.fil_cod = pb.fil_cod');
    });

    it('replaceBorderoCache: no-op com lista vazia; upsert + delete-dos-ausentes com itens', async () => {
        const db = buildDb();
        const repo = new PermutaExecucaoRepository(db, buildIdentity());
        await repo.replaceBorderoCache([]);
        expect(db.update as jest.Mock).not.toHaveBeenCalled(); // fetch vazio NÃO limpa o cache
        await repo.replaceBorderoCache([
            {
                borCod: 1,
                filCod: 4,
                borVldFinalizado: 1,
                borCodEstornado: null,
                usnDesNomeCad: null,
            },
        ]);
        const calls = (db.update as jest.Mock).mock.calls;
        expect(calls[0][0]).toContain('INSERT INTO permuta_bordero');
        // chave por PAR (fil_cod, bor_cod) — nº do borderô é por filial.
        expect(calls[0][0]).toContain('ON CONFLICT (fil_cod, bor_cod) DO UPDATE');
        expect(calls[1][0]).toContain(
            'DELETE FROM permuta_bordero WHERE (fil_cod, bor_cod) NOT IN',
        );
        expect(calls[0][1]).toMatchObject({ bor_0: 1, fil_0: 4, fin_0: 1 });
    });

    it('updateBorderoCacheSituacao: seta situação por (filCod, borCod) — cancelar → 2', async () => {
        const db = buildDb();
        await new PermutaExecucaoRepository(db, buildIdentity()).updateBorderoCacheSituacao(
            4,
            2038,
            {
                borVldFinalizado: 2,
            },
        );
        const sql = sqlOf(db.update as jest.Mock);
        expect(sql).toContain('UPDATE permuta_bordero');
        expect(sql).toContain('WHERE fil_cod = $fil AND bor_cod = $bor');
        expect(paramsOf(db.update as jest.Mock)).toEqual({ fil: 4, bor: 2038, fin: 2, est: null });
    });

    it('deleteBorderoCache: DELETE por (filCod, borCod)', async () => {
        const db = buildDb();
        await new PermutaExecucaoRepository(db, buildIdentity()).deleteBorderoCache(4, 2038);
        expect(sqlOf(db.update as jest.Mock)).toContain(
            'DELETE FROM permuta_bordero WHERE fil_cod = $fil AND bor_cod = $bor',
        );
        expect(paramsOf(db.update as jest.Mock)).toEqual({ fil: 4, bor: 2038 });
    });
});

describe('PermutaExecucaoRepository — identidade Conexos da execução (I-2, ADR-0041)', () => {
    /** Provider com identidade resolvida — o caso real de uma request autenticada. */
    const identidade = (conexosUsername: string, conexosUsnCod: string) =>
        ({
            current: jest.fn(),
            currentParams: jest.fn().mockReturnValue({ conexosUsername, conexosUsnCod }),
        }) as unknown as jest.Mocked<ConexosIdentityProvider>;

    it('beginExecution grava as duas colunas e PRESERVA a identidade de uma linha settled', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });
        const repo = new PermutaExecucaoRepository(db, identidade('SIMONE_PEREIRA', '14'));

        await repo.beginExecution({
            idempotencyKey: 'permuta:A:I',
            adiantamentoDocCod: 'A',
            invoiceDocCod: 'I',
            filCod: 4,
            dryRun: false,
            executadoPor: 'simone@kavex.com',
        });

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username');
        expect(sql).toContain('conexos_usn_cod');
        // Mesma doutrina do executado_por: settled não regride a autoria.
        expect(sql).toContain(
            "conexos_username = CASE WHEN permuta_alocacao_execucao.status = 'settled'",
        );
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({
            executadoPor: 'simone@kavex.com',
            conexosUsername: 'SIMONE_PEREIRA',
            conexosUsnCod: '14',
        });
    });

    it('markSettled preenche a identidade só quando ainda nula (COALESCE)', async () => {
        const db = buildDb();
        const repo = new PermutaExecucaoRepository(db, identidade('MPS_ROBO', '97'));

        await repo.markSettled('permuta:A:I', { borCod: 19992, bxaCodSeq: 1 });

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username = COALESCE(conexos_username, $conexosUsername)');
        expect(sql).toContain('conexos_usn_cod = COALESCE(conexos_usn_cod, $conexosUsnCod)');
        expect(params).toMatchObject({ conexosUsername: 'MPS_ROBO', conexosUsnCod: '97' });
    });

    it('markError também carimba a identidade (execução que falhou tem autor)', async () => {
        const db = buildDb();
        const repo = new PermutaExecucaoRepository(db, identidade('MPS_ROBO', '97'));

        await repo.markError('permuta:A:I', { erroMensagem: 'ERP 500' });

        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('conexos_username = COALESCE(conexos_username, $conexosUsername)');
        expect(params).toMatchObject({ conexosUsername: 'MPS_ROBO', conexosUsnCod: '97' });
    });

    it('sem identidade (job/cron) grava NULL nas duas colunas, sem quebrar a escrita', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });
        const repo = new PermutaExecucaoRepository(db, buildIdentity());

        await repo.beginExecution({
            idempotencyKey: 'permuta:A:I',
            adiantamentoDocCod: 'A',
            invoiceDocCod: 'I',
            filCod: 4,
            dryRun: false,
            executadoPor: 'cron',
        });

        const [, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(params).toMatchObject({ conexosUsername: null, conexosUsnCod: null });
    });
});
