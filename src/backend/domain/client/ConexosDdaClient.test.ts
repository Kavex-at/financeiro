import 'reflect-metadata';
import ConexosError from '../errors/ConexosError.js';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosDdaClient from './ConexosDdaClient.js';

const buildBase = () => ({
    ensureSid: jest.fn().mockResolvedValue(undefined),
    listGenericPaginated: jest.fn(),
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
});
const make = (base: ReturnType<typeof buildBase>) =>
    new ConexosDdaClient(base as unknown as ConexosBaseClient);

/** Formato medido em PRD (fin124/itens/list/152, 2026-09-23). */
const itemRow = (over: Record<string, unknown> = {}) => ({
    ditCod: 7,
    ditEspNumero: '001532761      ',
    ditMnyValor: 4815.33,
    ditDtaVencimento: 1790294400000,
    ditEspCodbar: '34193158000004815331090113433700004286589000',
    filCod: null,
    docCod: null,
    titCod: null,
    flpCod: null,
    bncCod: null,
    ...over,
});

describe('ConexosDdaClient (read-only)', () => {
    it('mapeia item livre: número aparado, vencimento civil, sem campos de vínculo', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [itemRow()] });
        const itens = await make(base).listarItens({ filCod: 1, ddcCod: 152 });
        expect(itens).toEqual([
            {
                ddcCod: 152,
                ditCod: 7,
                numero: '001532761',
                valor: 4815.33,
                vencimento: '2026-09-25',
                codbar: '34193158000004815331090113433700004286589000',
            },
        ]);
        expect(base.listGenericPaginated).toHaveBeenCalledWith(
            'fin124/itens/list/152',
            expect.objectContaining({ serviceName: 'fin124', pageNumber: 1 }),
            { filCod: 1 },
        );
    });

    it('mapeia o vínculo gravado pelo Conexos', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [itemRow({ filCod: 2, docCod: 37058, titCod: 1, flpCod: 21, bncCod: 4 })],
        });
        const [item] = await make(base).listarItens({ filCod: 1, ddcCod: 150 });
        expect(item).toMatchObject({
            filCod: 2,
            docCod: '37058',
            titCod: '1',
            flpCod: 21,
            bncCod: 4,
        });
    });

    it('descarta linha sem valor em vez de inventar zero', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 2,
            rows: [itemRow({ ditMnyValor: null }), itemRow({ ditCod: 8 })],
        });
        const itens = await make(base).listarItens({ filCod: 1, ddcCod: 152 });
        expect(itens.map((i) => i.ditCod)).toEqual([8]);
    });

    it('pagina até o fim quando a página vem cheia', async () => {
        const base = buildBase();
        const cheia = Array.from({ length: 1000 }, (_, i) => ({ ddcCod: i + 1 }));
        base.listGenericPaginated
            .mockResolvedValueOnce({ count: 1001, rows: cheia })
            .mockResolvedValueOnce({ count: 1001, rows: [{ ddcCod: 1001, ddcTimCanc: 5 }] });
        const arquivos = await make(base).listarArquivos({ filCod: 1 });
        expect(arquivos).toHaveLength(1001);
        expect(arquivos[1000]).toEqual({ ddcCod: 1001, canceladoEm: 5 });
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(2);
    });

    it('embrulha falha do Conexos em ConexosError', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockRejectedValue(new Error('504'));
        await expect(make(base).listarArquivos({ filCod: 1 })).rejects.toBeInstanceOf(ConexosError);
    });
});
