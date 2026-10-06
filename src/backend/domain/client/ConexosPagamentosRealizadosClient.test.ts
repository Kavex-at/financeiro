import 'reflect-metadata';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosPagamentosRealizadosClient from './ConexosPagamentosRealizadosClient.js';

const DIA = 86_400_000;
const DESDE = Date.UTC(2025, 9, 1);

const buildBase = () => ({
    listGenericPaginated: jest.fn(),
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
    // Nenhum método de escrita existe no mock: se o client tentar escrever, o teste quebra.
});
const make = (base: ReturnType<typeof buildBase>) =>
    new ConexosPagamentosRealizadosClient(base as unknown as ConexosBaseClient);

describe('ConexosPagamentosRealizadosClient (read-only, ADR-0063)', () => {
    it('borderôs: pede finalizados de pagamento, do mais recente, e para ao sair da janela', async () => {
        const base = buildBase();
        const cheia = Array.from({ length: 400 }, (_, i) => ({
            borCod: i + 1,
            borDtaMvto: DESDE + (500 - i) * DIA,
        }));
        const segunda = [
            { borCod: 1001, borDtaMvto: DESDE + DIA },
            { borCod: 1002, borDtaMvto: DESDE - DIA },
        ];
        // a 2ª página termina fora da janela: não há 3ª chamada.
        segunda.push(
            ...Array.from({ length: 398 }, (_, i) => ({
                borCod: 2000 + i,
                borDtaMvto: DESDE - 2 * DIA,
            })),
        );
        base.listGenericPaginated
            .mockResolvedValueOnce({ count: 5000, rows: cheia })
            .mockResolvedValueOnce({ count: 5000, rows: segunda });
        const borderos = await make(base).listBorderosPagamento(2, DESDE);
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(2);
        expect(borderos).toHaveLength(401);
        expect(borderos.every((b) => (b.borDtaMvto ?? 0) >= DESDE)).toBe(true);
        const [endpoint, body, opts] = base.listGenericPaginated.mock.calls[0] ?? [];
        expect(endpoint).toBe('fin010/list');
        expect(body).toMatchObject({
            filterList: { 'borVldTipo#EQ': 2, 'borVldFinalizado#EQ': 1 },
            pageNumber: 1,
        });
        expect(opts).toEqual({ filCod: 2 });
    });

    it('baixas: pagina pelo count, descarta permuta e linha sem valor, lê pesCod', async () => {
        const base = buildBase();
        const pagina1 = Array.from({ length: 500 }, (_, i) => ({
            pesCod: 10,
            dpeNomPessoa: 'ACME',
            bxaMnyLiquido: -(100 + i),
            lcbDtaCompensado: DESDE + i,
        }));
        const pagina2 = [
            { pesCod: '20', bxaMnyValor: 50, borDtaMvto: DESDE },
            { pesCod: '30', bxaMnyLiquido: 70, vldPermuta: 1 },
            { pesCod: '40', bxaMnyLiquido: 80, gerNumPermuta: '9' },
            { pesCod: '50', bxaMnyLiquido: 0 },
        ];
        base.listGenericPaginated
            .mockResolvedValueOnce({ count: 504, rows: pagina1 })
            .mockResolvedValueOnce({ count: 504, rows: pagina2 });
        const baixas = await make(base).listBaixasPagamento(2, { borCod: 77, borDtaMvto: DESDE });
        expect(base.listGenericPaginated).toHaveBeenCalledTimes(2);
        expect(base.listGenericPaginated.mock.calls[0]?.[0]).toBe('fin010/baixas/list/77');
        expect(baixas).toHaveLength(501);
        expect(baixas[0]).toEqual({ pesCod: '10', credor: 'ACME', valor: 100, data: DESDE });
        expect(baixas[500]).toEqual({ pesCod: '20', valor: 50, data: DESDE });
    });

    it('falha de leitura propaga (o job registra a rodada como falha, sem apagar perfis)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockRejectedValueOnce(new Error('HTTP 500'));
        await expect(make(base).listBorderosPagamento(2, DESDE)).rejects.toThrow('HTTP 500');
    });
});
