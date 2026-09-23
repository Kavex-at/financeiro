import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import TituloAPagarRepository from './TituloAPagarRepository.js';

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    docCod: '100',
    titCod: '1',
    filCod: 2,
    valor: 500,
    liberado: true,
    pago: false,
    vencimento: 1_760_000_000_000,
    ...over,
});

const buildDb = () => {
    const tx = { insert: jest.fn().mockResolvedValue(1) };
    return {
        tx,
        client: {
            withTransaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
            update: jest.fn().mockResolvedValue(0),
            selectMany: jest.fn().mockResolvedValue([]),
        } as unknown as PostgreeDatabaseClient,
    };
};

describe('TituloAPagarRepository', () => {
    it('upsertMany faz INSERT ... ON CONFLICT num chunk', async () => {
        const { client, tx } = buildDb();
        await new TituloAPagarRepository(client).upsertMany(
            [titulo(), titulo({ titCod: '2' })],
            'RUN1',
        );
        expect(tx.insert).toHaveBeenCalledTimes(1);
        const [sql, params] = tx.insert.mock.calls[0];
        expect(sql).toContain('ON CONFLICT (fil_cod, doc_cod, tit_cod) DO UPDATE');
        expect(params).toMatchObject({ runId: 'RUN1', f0: 2, d0: '100', t1: '2' });
    });

    it('upsertMany com lista vazia não abre transação', async () => {
        const { client } = buildDb();
        await new TituloAPagarRepository(client).upsertMany([], 'RUN1');
        expect(client.withTransaction as jest.Mock).not.toHaveBeenCalled();
    });

    it('marcarInativosForaDaRun inativa só nas filiais lidas e devolve a contagem', async () => {
        const { client } = buildDb();
        (client.update as jest.Mock).mockResolvedValue(4);
        const n = await new TituloAPagarRepository(client).marcarInativosForaDaRun('RUN1', [2, 4]);
        expect(n).toBe(4);
        const [sql, params] = (client.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('ativo = FALSE');
        expect(sql).toContain('fil_cod = ANY($filCodsLidas)');
        expect(params).toMatchObject({ runId: 'RUN1', filCodsLidas: [2, 4] });
    });

    it('marcarInativosForaDaRun não inativa nada se NENHUMA filial foi lida (fault-tolerance)', async () => {
        const { client } = buildDb();
        const n = await new TituloAPagarRepository(client).marcarInativosForaDaRun('RUN1', []);
        expect(n).toBe(0);
        expect(client.update as jest.Mock).not.toHaveBeenCalled();
    });

    it('listAtivos mapeia as linhas (valor numérico, vencimento epoch, ativo)', async () => {
        const { client } = buildDb();
        (client.selectMany as jest.Mock).mockResolvedValue([
            {
                fil_cod: 2,
                doc_cod: '100',
                tit_cod: '1',
                credor: 'ACME',
                pes_cod: '9',
                valor: '500.5',
                moeda: 'BRL',
                vencimento: new Date('2026-08-01T00:00:00Z'),
                aprovado: true,
                pago: false,
                banco: 'ITAÚ',
                num_remessa: null,
                tpd_cod: null,
                pronto_para_remessa: true,
            },
        ]);
        const titulos = await new TituloAPagarRepository(client).listAtivos();
        expect(titulos[0]).toMatchObject({
            docCod: '100',
            valor: 500.5,
            liberado: true,
            prontoParaRemessa: true,
            ativo: true,
        });
        expect(typeof titulos[0].vencimento).toBe('number');
    });
});
