import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import BoletoDdaRepository from './BoletoDdaRepository.js';

const buildDb = () => {
    const tx = {
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(0),
    };
    return {
        tx,
        client: {
            withTransaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
            selectMany: jest.fn().mockResolvedValue([]),
            selectFirst: jest.fn().mockResolvedValue(null),
        } as unknown as PostgreeDatabaseClient & {
            selectMany: jest.Mock;
            selectFirst: jest.Mock;
        },
    };
};

describe('BoletoDdaRepository', () => {
    it('salvarArquivo grava cabeçalho, apaga itens que sumiram e faz upsert — tudo parametrizado', async () => {
        const { client, tx } = buildDb();
        await new BoletoDdaRepository(client).salvarArquivo(
            { ddcCod: 152, nome: 'X.RET', importadoEm: 1_000 },
            [
                { ddcCod: 152, ditCod: 1, valor: 10, vencimento: '2026-09-25' },
                { ddcCod: 152, ditCod: 2, valor: 20, docCod: '5046', titCod: '1', filCod: 1 },
            ],
        );
        const [sqlArquivo, pArquivo] = tx.insert.mock.calls[0];
        expect(sqlArquivo).toContain('ON CONFLICT (ddc_cod) DO UPDATE');
        expect(pArquivo).toMatchObject({ ddcCod: 152, nome: 'X.RET', totalItens: 2 });

        const [sqlDelete, pDelete] = tx.update.mock.calls[0];
        expect(sqlDelete).toContain('NOT (dit_cod = ANY($ditCods))');
        expect(pDelete).toEqual({ ddcCod: 152, ditCods: [1, 2] });

        const [sqlItens, pItens] = tx.insert.mock.calls[1];
        expect(sqlItens).toContain('ON CONFLICT (ddc_cod, dit_cod) DO UPDATE');
        expect(sqlItens).not.toContain('2026-09-25');
        expect(pItens).toMatchObject({ ve0: '2026-09-25', d0: null, d1: '5046', f1: 1 });
    });

    it('listBoletos filtra por vencimento só quando pedido e mapeia a linha', async () => {
        const { client } = buildDb();
        client.selectMany.mockResolvedValue([
            {
                ddc_cod: 152,
                dit_cod: 7,
                numero: '001532761',
                valor: '4815.33',
                vencimento: '2026-09-25',
                codbar: '341',
                fil_cod: null,
                doc_cod: null,
                tit_cod: null,
                flp_cod: null,
                bnc_cod: null,
                arquivo: 'X.RET',
                importado_em: new Date(1_000),
            },
        ]);
        const repo = new BoletoDdaRepository(client);
        const [b] = await repo.listBoletos({ vencimentoDesde: '2026-09-23' });
        expect(client.selectMany.mock.calls[0][1]).toEqual({ desde: '2026-09-23' });
        expect(b).toEqual({
            ddcCod: 152,
            ditCod: 7,
            numero: '001532761',
            valor: 4815.33,
            vencimento: '2026-09-25',
            codbar: '341',
            arquivo: 'X.RET',
            importadoEm: 1_000,
        });

        await repo.listBoletos({});
        expect(client.selectMany.mock.calls[1][1]).toEqual({ desde: null });
    });
});
