import 'reflect-metadata';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosSispagClient from './ConexosSispagClient.js';

const buildBase = () => ({
    listGenericPaginated: jest.fn(),
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
});
const make = (base: ReturnType<typeof buildBase>) =>
    new ConexosSispagClient(base as unknown as ConexosBaseClient);

const linha = (over: Record<string, unknown> = {}) => ({
    docCod: '636',
    titCod: '1',
    titMnyValor: 1028.8,
    totalAberto: 1028.8,
    ...over,
});

describe('ConexosSispagClient.lerTotalAberto (ADR-0071, I17b)', () => {
    it('lê por docCod no fin064 e devolve o totalAberto ao vivo', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [linha()] });
        const r = await make(base).lerTotalAberto(2, '636', '1');
        expect(r).toEqual({ legivel: true, totalAberto: 1028.8 });
        const [endpoint, body, opts] = base.listGenericPaginated.mock.calls[0];
        expect(endpoint).toBe('fin064/list');
        expect(body.filterList).toEqual({ 'docCod#EQ': '636' });
        expect(opts).toEqual({ filCod: 2 });
    });

    it('NÃO cai em titMnyAberto nem em titMnyValor quando totalAberto falta (fail-closed)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [linha({ totalAberto: null, titMnyAberto: 1028.8, titMnyValor: 1028.8 })],
        });
        const r = await make(base).lerTotalAberto(2, '636', '1');
        expect(r.legivel).toBe(false);
    });

    it('totalAberto zero é legível (título quitado), negativo/ilegível não', async () => {
        const base = buildBase();
        base.listGenericPaginated
            .mockResolvedValueOnce({ count: 1, rows: [linha({ totalAberto: 0 })] })
            .mockResolvedValueOnce({ count: 1, rows: [linha({ totalAberto: -5 })] })
            .mockResolvedValueOnce({ count: 1, rows: [linha({ totalAberto: 'abc' })] });
        const client = make(base);
        expect(await client.lerTotalAberto(2, '636', '1')).toEqual({
            legivel: true,
            totalAberto: 0,
        });
        expect((await client.lerTotalAberto(2, '636', '1')).legivel).toBe(false);
        expect((await client.lerTotalAberto(2, '636', '1')).legivel).toBe(false);
    });

    it('título que não veio na leitura, ou de outra parcela, é ilegível', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [linha({ titCod: '2' })] });
        const r = await make(base).lerTotalAberto(2, '636', '1');
        expect(r).toEqual({ legivel: false, motivo: expect.stringMatching(/não encontrado/) });
    });

    it('falha HTTP não lança: vira ilegível', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockRejectedValue({ response: { status: 500 } });
        const r = await make(base).lerTotalAberto(2, '636', '1');
        expect(r.legivel).toBe(false);
    });
});
