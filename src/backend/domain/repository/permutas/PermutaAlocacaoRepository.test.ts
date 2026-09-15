import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import PermutaAlocacaoRepository from './PermutaAlocacaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue({ total: 0 }),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

describe('PermutaAlocacaoRepository', () => {
    it('upsertAlocacao: INSERT ON CONFLICT (par) DO UPDATE, parametrizado', async () => {
        const db = buildDb();
        const repo = new PermutaAlocacaoRepository(db);

        await repo.upsertAlocacao({
            adiantamentoDocCod: 'A9',
            invoiceDocCod: 'I7',
            invoicePriCod: '510',
            valorAlocado: 1000,
            moeda: 'USD',
            variacaoClassificacao: 'JUROS',
            variacaoResultado: 12,
            taxaAdiantamento: 5.3,
            taxaInvoice: 5.18,
            criadoPor: 'simone',
        });

        const [sql, params] = (db.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO permuta_alocacao');
        expect(sql).toContain('ON CONFLICT (adiantamento_doc_cod, invoice_doc_cod) DO UPDATE');
        expect(sql).toContain('$valorAlocado');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({
            adtoDocCod: 'A9',
            invoiceDocCod: 'I7',
            invoicePriCod: '510',
            valorAlocado: 1000,
            criadoPor: 'simone',
        });
    });

    it('listByAdiantamento: SELECT parametrizado por adiantamento, mapeia atualizadoEm', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                adiantamento_doc_cod: 'A9',
                invoice_doc_cod: 'I7',
                valor_alocado: '1500.25',
                criado_em: '2026-09-01T10:00:00Z',
                atualizado_em: '2026-09-02T10:00:00Z',
            },
        ]);
        const repo = new PermutaAlocacaoRepository(db);

        const rows = await repo.listByAdiantamento('A9');

        const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('FROM permuta_alocacao');
        expect(sql).toContain('adiantamento_doc_cod = $adtoDocCod');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toEqual({ adtoDocCod: 'A9' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            adiantamentoDocCod: 'A9',
            invoiceDocCod: 'I7',
            valorAlocado: 1500.25,
            atualizadoEm: new Date('2026-09-02T10:00:00Z'),
        });
    });

    it('sumByInvoice: SUM parametrizado por invoice', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ total: 200 });
        const repo = new PermutaAlocacaoRepository(db);

        const total = await repo.sumByInvoice('I7');
        expect(total).toBe(200);
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('invoice_doc_cod = $invoiceDocCod');
        expect(params).toEqual({ invoiceDocCod: 'I7', excludeAdto: null });
    });

    it('deleteAlocacao: DELETE parametrizado pelo par', async () => {
        const db = buildDb();
        const repo = new PermutaAlocacaoRepository(db);
        await repo.deleteAlocacao('A9', 'I7');
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('DELETE FROM permuta_alocacao');
        expect(params).toEqual({ adtoDocCod: 'A9', invoiceDocCod: 'I7' });
    });

    it('listAtivas: mapeia as linhas', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                adiantamento_doc_cod: 'A9',
                invoice_doc_cod: 'I7',
                invoice_pri_cod: '510',
                valor_alocado: '1000',
                moeda: 'USD',
                variacao_classificacao: 'JUROS',
                variacao_resultado: '12',
                criado_em: '2026-06-20T10:00:00Z',
            },
        ]);
        const repo = new PermutaAlocacaoRepository(db);
        const list = await repo.listAtivas();
        expect(list[0]).toMatchObject({
            adiantamentoDocCod: 'A9',
            invoiceDocCod: 'I7',
            invoicePriCod: '510',
            valorAlocado: 1000,
            variacaoClassificacao: 'JUROS',
        });
        expect(list[0].criadoEm).toBeInstanceOf(Date);
    });
});
