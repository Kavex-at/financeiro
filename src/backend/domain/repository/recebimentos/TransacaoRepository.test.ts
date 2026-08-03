import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import {
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import TransacaoRepository from './TransacaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const buildTransacao = (o: Partial<TransacaoBancaria> = {}): TransacaoBancaria => ({
    id: 'txn-1',
    correlationId: 'corr-1',
    filCod: 4,
    dataMovimento: new Date('2026-07-01T00:00:00Z'),
    tipo: TRANSACAO_TIPO.CREDITO,
    valor: 15000,
    moeda: 'BRL',
    naturalKey: 'nk-1',
    rawPayload: null,
    normalized: null,
    status: TRANSACAO_BANCARIA_STATUS.IMPORTADA,
    importadoEm: new Date('2026-07-01T00:00:00Z'),
    ...o,
});

describe('TransacaoRepository', () => {
    it('save: UPSERT por natural_key, jsonb, parametrizado', async () => {
        const db = buildDb();
        await new TransacaoRepository(db).save(buildTransacao());
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO transacao_bancaria');
        expect(sql).toContain('ON CONFLICT (natural_key) DO UPDATE');
        expect(sql).toContain('$rawPayload::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ id: 'txn-1', naturalKey: 'nk-1', filCod: 4 });
        expect(params.rawPayload).toBe(JSON.stringify(null));
    });

    it('findById: mapeia camelCase + tipos; null quando ausente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'txn-1',
            correlation_id: 'corr-1',
            fil_cod: 4,
            data_movimento: '2026-07-01T00:00:00Z',
            tipo: 'CREDITO',
            valor: '15000',
            moeda: 'BRL',
            natural_key: 'nk-1',
            raw_payload: null,
            normalized: null,
            status: 'importada',
            importado_em: '2026-07-01T00:00:00Z',
        });
        const row = await new TransacaoRepository(db).findById('txn-1');
        expect(row).toMatchObject({ id: 'txn-1', filCod: 4, valor: 15000, moeda: 'BRL' });

        const db2 = buildDb();
        expect(await new TransacaoRepository(db2).findById('nope')).toBeNull();
    });
});

/** `withTransaction` real o bastante para o upsert: entrega um tx mockado. */
const buildDbComTx = (retorno: Array<{ inserida: boolean }>) => {
    const tx = { selectMany: jest.fn().mockResolvedValue(retorno) };
    const db = {
        ...buildDb(),
        withTransaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as unknown as jest.Mocked<PostgreeDatabaseClient>;
    return { db, tx };
};

describe('TransacaoRepository.upsertMany', () => {
    it('NÃO devolve para importada uma transação já trabalhada pelo analista', async () => {
        // Este é o teste central da Fase B. O `save` unitário faz
        // `status = EXCLUDED.status`, então a reingestão diária zeraria o trabalho
        // do analista. O upsert em lote precisa do guard de status.
        const { db, tx } = buildDbComTx([{ inserida: true }]);
        await new TransacaoRepository(db).upsertMany([buildTransacao()], 'run-1');

        const [sql, params] = tx.selectMany.mock.calls[0];
        expect(sql).toContain('WHERE transacao_bancaria.status = $statusIntocado');
        expect(params.statusIntocado).toBe(TRANSACAO_BANCARIA_STATUS.IMPORTADA);
        // Propriedades de nascimento nunca são sobrescritas no conflito.
        const setClause = sql.slice(sql.indexOf('DO UPDATE SET'), sql.indexOf('WHERE transacao'));
        expect(setClause).not.toContain('status =');
        expect(setClause).not.toContain('correlation_id =');
        expect(setClause).not.toContain('import_run_id =');
        expect(setClause).not.toMatch(/\bid =/);
        expect(setClause).not.toContain('importado_em =');
    });

    it('conta inseridas via xmax e deriva deduplicadas do total enviado', async () => {
        const { db } = buildDbComTx([{ inserida: true }, { inserida: false }]);
        const r = await new TransacaoRepository(db).upsertMany(
            [
                buildTransacao({ id: 'a', naturalKey: 'nk-a' }),
                buildTransacao({ id: 'b', naturalKey: 'nk-b' }),
                // barrada pelo WHERE (já conciliada) → não volta no RETURNING
                buildTransacao({ id: 'c', naturalKey: 'nk-c' }),
            ],
            'run-1',
        );
        expect(r).toEqual({ inseridas: 1, deduplicadas: 2 });
    });

    it('grava ger_num e categoria, e é 100% parametrizado', async () => {
        const { db, tx } = buildDbComTx([{ inserida: true }]);
        await new TransacaoRepository(db).upsertMany(
            [buildTransacao({ gerNum: 38, categoria: '209', categoriaDesc: 'TED' })],
            'run-1',
        );
        const [sql, params] = tx.selectMany.mock.calls[0];
        expect(sql).toContain('ger_num');
        expect(sql).toContain('RETURNING (xmax = 0) AS inserida');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ gn0: 38, ca0: '209', cd0: 'TED', runId: 'run-1' });
    });

    it('lista vazia não abre transação', async () => {
        const { db } = buildDbComTx([]);
        const r = await new TransacaoRepository(db).upsertMany([], 'run-1');
        expect(r).toEqual({ inseridas: 0, deduplicadas: 0 });
        expect(db.withTransaction).not.toHaveBeenCalled();
    });

    it('grava o canal de origem (upload manual x fin095)', async () => {
        const { db, tx } = buildDbComTx([{ inserida: true }]);
        await new TransacaoRepository(db).upsertMany(
            [buildTransacao({ canal: 'xlsx_bradesco' })],
            'run-1',
        );
        const [sql, params] = tx.selectMany.mock.calls[0];
        expect(sql).toContain('canal');
        expect(params.cl0).toBe('xlsx_bradesco');
    });
});

describe('TransacaoRepository.existingNaturalKeys', () => {
    it('lista vazia não consulta o banco', async () => {
        const db = buildDb();
        const set = await new TransacaoRepository(db).existingNaturalKeys([]);
        expect(set.size).toBe(0);
        expect(db.selectMany).not.toHaveBeenCalled();
    });

    it('devolve só as chaves presentes, parametrizado por ANY', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([{ natural_key: 'nk-a' }]);
        const set = await new TransacaoRepository(db).existingNaturalKeys(['nk-a', 'nk-b']);
        expect(set.has('nk-a')).toBe(true);
        expect(set.has('nk-b')).toBe(false);
        const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('natural_key = ANY($naturalKeys)');
        expect(params).toEqual({ naturalKeys: ['nk-a', 'nk-b'] });
    });
});

describe('TransacaoRepository — leitura para o painel', () => {
    it('listParaPainel filtra por filial, tipo, janela e categorias excluídas', async () => {
        const db = buildDb();
        await new TransacaoRepository(db).listParaPainel({
            filCods: [1, 2],
            tipos: [TRANSACAO_TIPO.CREDITO],
            categoriasExcluidas: ['206', '210'],
            desde: new Date('2026-05-01T00:00:00Z'),
            limit: 500,
        });
        const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('fil_cod = ANY($filCods)');
        expect(sql).toContain('tipo = ANY($tipos)');
        expect(sql).toContain('data_movimento >= $desde');
        expect(sql).toContain('ORDER BY data_movimento DESC');
        expect(params).toMatchObject({ filCods: [1, 2], limit: 500 });
    });

    it('categoria NULL sobrevive ao filtro de ruído — desconhecido não é ruído', async () => {
        const db = buildDb();
        await new TransacaoRepository(db).listParaPainel({
            filCods: [1],
            categoriasExcluidas: ['206'],
            limit: 10,
        });
        const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('categoria IS NULL OR NOT (categoria = ANY($categoriasExcluidas))');
    });

    it('sem filiais permitidas não consulta o banco', async () => {
        const db = buildDb();
        const repo = new TransacaoRepository(db);
        expect(await repo.listParaPainel({ filCods: [], limit: 10 })).toEqual([]);
        expect(await repo.contarKpis({ filCods: [] })).toEqual({});
        expect(db.selectMany).not.toHaveBeenCalled();
    });

    it('contarKpis agrupa por status sobre a janela inteira', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            { status: 'importada', total: 1200 },
            { status: 'conciliada', total: 37 },
        ]);
        const kpis = await new TransacaoRepository(db).contarKpis({ filCods: [1] });
        const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('GROUP BY status');
        expect(sql).not.toContain('LIMIT');
        expect(kpis).toEqual({ importada: 1200, conciliada: 37 });
    });
});
