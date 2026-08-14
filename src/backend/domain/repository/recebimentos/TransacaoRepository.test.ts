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

describe('TransacaoRepository — marcarStatus (guarda de origem, ADR-0034)', () => {
    it('aplica as origens permitidas no WHERE e é parametrizado', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            antes: 'importada',
            depois: 'processada',
        });

        const out = await new TransacaoRepository(db).marcarStatus(
            'txn-1',
            TRANSACAO_BANCARIA_STATUS.PROCESSADA,
        );

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('UPDATE transacao_bancaria SET status = $destino');
        expect(sql).toContain('status = ANY($origens)');
        expect(sql).toContain('status <> $destino');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params.destino).toBe('processada');
        // `processada` NUNCA é origem — é o que impede uma escrita tardia de rebaixar o terminal.
        expect(params.origens).not.toContain('processada');
        expect(params.origens).toEqual(
            expect.arrayContaining(['importada', 'conciliada', 'parcial', 'manual', 'erro']),
        );
        expect(out).toEqual({ antes: 'importada', mudou: true });
    });

    it('origem proibida não muda nada e devolve o estado atual', async () => {
        const db = buildDb();
        // Linha já `processada`: o UPDATE não alcança, o CTE `atual` ainda devolve o status.
        (db.selectFirst as jest.Mock).mockResolvedValue({ antes: 'processada', depois: null });

        const out = await new TransacaoRepository(db).marcarStatus(
            'txn-1',
            TRANSACAO_BANCARIA_STATUS.PARCIAL,
        );

        const [, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(params.origens).not.toContain('processada');
        expect(out).toEqual({ antes: 'processada', mudou: false });
    });

    it('destino igual ao atual é no-op silencioso, não bloqueio', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ antes: 'erro', depois: null });
        const out = await new TransacaoRepository(db).marcarStatus(
            'txn-1',
            TRANSACAO_BANCARIA_STATUS.ERRO,
        );
        expect(out).toEqual({ antes: 'erro', mudou: false });
    });

    it('transação inexistente devolve mudou=false sem antes', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ antes: null, depois: null });
        const out = await new TransacaoRepository(db).marcarStatus(
            'txn-sumida',
            TRANSACAO_BANCARIA_STATUS.PROCESSADA,
        );
        expect(out).toEqual({ mudou: false });
    });
});

describe('TransacaoRepository — latch da reingestão (ADR-0034)', () => {
    it('upsertMany só refresca linha intocada E sem nenhuma linha de ledger', async () => {
        const db = buildDb();
        const tx = {
            selectMany: jest.fn().mockResolvedValue([{ inserida: true }]),
            selectFirst: jest.fn(),
            insert: jest.fn(),
            update: jest.fn(),
        };
        (db.withTransaction as unknown as jest.Mock) = jest
            .fn()
            .mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));

        await new TransacaoRepository(db).upsertMany([buildTransacao()], 'run-1');

        const [sql, params] = tx.selectMany.mock.calls[0];
        expect(sql).toContain('WHERE transacao_bancaria.status = $statusIntocado');
        expect(sql).toContain('NOT EXISTS');
        expect(sql).toContain('e.txn_id = transacao_bancaria.id');
        expect(params.statusIntocado).toBe('importada');
        // O cron não pode mexer no `valor`, que é o denominador da regra Σ, de um crédito com
        // alocação em curso — e uma marcação de status que falhou deixava a linha em `importada`.
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
    });
});

describe('TransacaoRepository — reconciliarStatusPorLedger (ADR-0034)', () => {
    const rodar = async () => {
        const db = buildDb();
        const tx = {
            selectMany: jest.fn().mockResolvedValue([]),
            selectFirst: jest.fn(),
            insert: jest.fn(),
            update: jest.fn().mockResolvedValue(2),
        };
        (db.withTransaction as unknown as jest.Mock) = jest
            .fn()
            .mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
        const total = await new TransacaoRepository(db).reconciliarStatusPorLedger();
        return { tx, total };
    };

    it('roda três statements na ordem processada → parcial → erro', async () => {
        const { tx, total } = await rodar();
        expect(tx.update).toHaveBeenCalledTimes(3);
        expect(total).toBe(6);

        const destinos = tx.update.mock.calls.map((c) => (c[1] as { destino: string }).destino);
        // `erro` por último: quem escreve o status é o ÚLTIMO evento do ledger — mesma regra do
        // caminho vivo. Inverter faria o backfill produzir um estado que o runtime nunca produz.
        expect(destinos).toEqual(['processada', 'parcial', 'erro']);
    });

    it('compara dinheiro em centavos inteiros, nunca em float', async () => {
        const { tx } = await rodar();
        const [sqlProcessada] = tx.update.mock.calls[0];
        const [sqlParcial] = tx.update.mock.calls[1];
        expect(sqlProcessada).toContain('ROUND(s.alocado * 100) >= ROUND(t.valor * 100)');
        expect(sqlParcial).toContain('ROUND(s.alocado * 100) < ROUND(t.valor * 100)');
        expect(sqlProcessada).not.toContain('float8');
    });

    it('só soma alocação settled e não-dry-run, e não adivinha sobre valor nulo', async () => {
        const { tx } = await rodar();
        const [sql] = tx.update.mock.calls[0];
        expect(sql).toContain("status = 'settled'");
        expect(sql).toContain('dry_run = FALSE');
        expect(sql).toContain('HAVING SUM(valor) IS NOT NULL');
    });

    it('a statement de erro captura também a execução INTERROMPIDA', async () => {
        const { tx } = await rodar();
        const [sql, params] = tx.update.mock.calls[2];
        // Sem esta cláusula, o processo que morre no meio nunca roda o `catch`, nunca chama
        // `registrarFalha`, e o crédito com documento possivelmente órfão no ERP fica `importada` —
        // invisível na única tela que mostraria esse estado.
        expect(sql).toContain("u.status = 'error'");
        expect(sql).toContain("u.status = 'reconciling'");
        expect(sql).toContain('make_interval(mins => $minutosParado::int)');
        expect((params as { minutosParado: number }).minutosParado).toBe(15);
    });

    it('nenhuma statement admite processada como origem', async () => {
        const { tx } = await rodar();
        for (const [, params] of tx.update.mock.calls) {
            expect((params as { origens: string[] }).origens).not.toContain('processada');
        }
    });
});

describe('TransacaoRepository — somarValorPorStatus com alocado (ADR-0034)', () => {
    it('faz LEFT JOIN com o ledger e qualifica as colunas do filtro', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            { status: 'parcial', total: 100000, alocado: 90000, em_aberto: 10000 },
        ]);

        const out = await new TransacaoRepository(db).somarValorPorStatus({ filCods: [1] });

        const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('LEFT JOIN');
        expect(sql).toContain('s.txn_id = t.id');
        expect(sql).toContain('GROUP BY t.status');
        // Corte em zero POR LINHA: no grupo, um crédito sobre-alocado cancelaria o saldo aberto de
        // outro e o KPI esconderia dinheiro que ainda precisa ser distribuído.
        expect(sql).toContain('GREATEST(t.valor - COALESCE(s.alocado, 0), 0)');
        // Colunas qualificadas: sem o prefixo, um JOIN futuro que exponha as mesmas colunas
        // tornaria o filtro ambíguo em vez de errado — falha barulhenta, mas evitável.
        expect(sql).toContain('t.fil_cod');
        expect(sql).toContain('t.arquivada_em');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(out).toEqual({ parcial: { total: 100000, alocado: 90000, emAberto: 10000 } });
    });

    it('sem filiais permitidas não consulta o banco', async () => {
        const db = buildDb();
        expect(await new TransacaoRepository(db).somarValorPorStatus({ filCods: [] })).toEqual({});
        expect(db.selectMany).not.toHaveBeenCalled();
    });
});
