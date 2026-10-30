import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import EmptyDdaFileError from '../../errors/EmptyDdaFileError.js';
import BoletoDdaRepository from './BoletoDdaRepository.js';

const buildDb = () => {
    const tx = {
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(0),
        selectFirst: jest.fn().mockResolvedValue({ n: 0 }),
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

    describe('lista vazia não apaga (v0.53.0)', () => {
        it('arquivo com itens no snapshot + lista vazia: lança e não grava nada', async () => {
            const { client, tx } = buildDb();
            tx.selectFirst.mockResolvedValue({ n: 3 });
            await expect(
                new BoletoDdaRepository(client).salvarArquivo({ ddcCod: 152 }, []),
            ).rejects.toEqual(expect.any(EmptyDdaFileError));
            const [sql, params] = tx.selectFirst.mock.calls[0];
            expect(sql).toContain('FROM boleto_dda');
            expect(params).toEqual({ ddcCod: 152 });
            expect(tx.insert).not.toHaveBeenCalled();
            expect(tx.update).not.toHaveBeenCalled();
        });

        it('arquivo novo (nada no snapshot) com lista vazia grava o cabeçalho', async () => {
            const { client, tx } = buildDb();
            await new BoletoDdaRepository(client).salvarArquivo({ ddcCod: 153 }, []);
            expect(tx.insert).toHaveBeenCalledTimes(1);
            expect(tx.insert.mock.calls[0][1]).toMatchObject({ ddcCod: 153, totalItens: 0 });
        });

        it('arquivo cancelado com lista vazia segue o caminho normal (sai pelo cancelado_em)', async () => {
            const { client, tx } = buildDb();
            tx.selectFirst.mockResolvedValue({ n: 3 });
            await new BoletoDdaRepository(client).salvarArquivo(
                { ddcCod: 154, canceladoEm: 1_000 },
                [],
            );
            expect(tx.selectFirst).not.toHaveBeenCalled();
            expect(tx.insert).toHaveBeenCalledTimes(1);
        });

        it('lista com itens não consulta o snapshot', async () => {
            const { client, tx } = buildDb();
            await new BoletoDdaRepository(client).salvarArquivo({ ddcCod: 155 }, [
                { ddcCod: 155, ditCod: 1, valor: 1 },
            ]);
            expect(tx.selectFirst).not.toHaveBeenCalled();
        });
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

    it('buscarPorChave: só de arquivo não cancelado, parametrizado; null quando não existe', async () => {
        const { client } = buildDb();
        client.selectFirst
            .mockResolvedValueOnce({
                ddc_cod: 152,
                dit_cod: 7,
                numero: 'NF1',
                valor: '10.50',
                vencimento: '2026-10-20',
                codbar: null,
                fil_cod: null,
                doc_cod: null,
                tit_cod: null,
                flp_cod: null,
                bnc_cod: null,
                arquivo: 'X.RET',
                importado_em: null,
            })
            .mockResolvedValueOnce(null);
        const repo = new BoletoDdaRepository(client);
        const b = await repo.buscarPorChave({ ddcCod: 152, ditCod: 7 });
        const [sql, params] = client.selectFirst.mock.calls[0];
        expect(sql).toContain('a.cancelado_em IS NULL');
        expect(sql).toContain('b.ddc_cod = $ddcCod AND b.dit_cod = $ditCod');
        expect(params).toEqual({ ddcCod: 152, ditCod: 7 });
        expect(b).toMatchObject({ ddcCod: 152, ditCod: 7, valor: 10.5, vencimento: '2026-10-20' });
        expect(await repo.buscarPorChave({ ddcCod: 1, ditCod: 1 })).toBeNull();
    });

    describe('conferência rápida (I-DDA6)', () => {
        it('atualizarCabecalho mexe só em boleto_dda_arquivo, parametrizado', async () => {
            const { client } = buildDb();
            const update = jest.fn().mockResolvedValue(1);
            (client as unknown as { update: jest.Mock }).update = update;
            await new BoletoDdaRepository(client).atualizarCabecalho({
                ddcCod: 7,
                nome: 'X.RET',
                canceladoEm: 2_000,
                status: 2,
            });
            const [sql, params] = update.mock.calls[0] ?? [];
            expect(sql).toContain('UPDATE boleto_dda_arquivo');
            expect(sql).not.toContain('boleto_dda ');
            expect(params).toMatchObject({ ddcCod: 7, nome: 'X.RET', status: 2 });
            expect(params.canceladoEm).toEqual(new Date(2_000));
        });

        it('registrarConferencia é UPSERT da linha única; ultimaConferencia lê o epoch', async () => {
            const { client } = buildDb();
            const insert = jest.fn().mockResolvedValue(1);
            (client as unknown as { insert: jest.Mock }).insert = insert;
            const repo = new BoletoDdaRepository(client);
            await repo.registrarConferencia({
                origem: 'abertura:u1',
                arquivosLidos: 2,
                arquivosCabecalho: 1,
            });
            const [sql, params] = insert.mock.calls[0] ?? [];
            expect(sql).toContain('INSERT INTO boleto_dda_conferencia');
            expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
            expect(params).toEqual({
                origem: 'abertura:u1',
                arquivosLidos: 2,
                arquivosCabecalho: 1,
            });
            client.selectFirst.mockResolvedValue({ em: new Date(9_000) });
            expect(await repo.ultimaConferencia()).toBe(9_000);
            client.selectFirst.mockResolvedValue(null);
            expect(await repo.ultimaConferencia()).toBeUndefined();
        });

        it('listArquivosEstado mapeia nome/status/cancelado_em por arquivo', async () => {
            const { client } = buildDb();
            client.selectMany.mockResolvedValue([
                { ddc_cod: 1, nome: 'A', status: 1, cancelado_em: null, importado_em: null },
                {
                    ddc_cod: 2,
                    nome: null,
                    status: null,
                    cancelado_em: new Date(3_000),
                    importado_em: new Date(1_000),
                },
            ]);
            const m = await new BoletoDdaRepository(client).listArquivosEstado();
            expect(m.get(1)).toEqual({ nome: 'A', status: 1 });
            expect(m.get(2)).toEqual({ canceladoEm: 3_000, importadoEm: 1_000 });
        });
    });
});
