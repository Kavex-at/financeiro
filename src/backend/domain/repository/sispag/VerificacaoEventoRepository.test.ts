import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

describe('VerificacaoEventoRepository (ADR-0063, I13m)', () => {
    it('só INSERT, parametrizado, no tx de quem chama quando há um', async () => {
        const pool = { insert: jest.fn().mockResolvedValue(1) };
        const tx = { insert: jest.fn().mockResolvedValue(1) };
        const repo = new VerificacaoEventoRepository(pool as unknown as PostgreeDatabaseClient);
        const id = await repo.registrar(
            {
                evento: 'LOTE_CONFERIDO',
                ator: "o'hara",
                loteId: 'L1',
                dados: { motivo: 'x' },
            },
            tx as never,
        );
        expect(pool.insert).not.toHaveBeenCalled();
        const [sql, params] = tx.insert.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/^INSERT INTO sispag_verificacao_evento/);
        expect(String(sql)).not.toContain("o'hara");
        expect(params).toMatchObject({
            id,
            evento: 'LOTE_CONFERIDO',
            ator: "o'hara",
            loteId: 'L1',
            filCod: null,
            dados: JSON.stringify({ motivo: 'x' }),
        });
    });

    it('listarChavesRetiradasPeloSistema: chaves com filial, só ator sistema, só os motivos pedidos', async () => {
        const pool = {
            selectMany: jest.fn().mockResolvedValue([
                { fil_cod: 2, doc_cod: '6171', tit_cod: '1' },
                { fil_cod: null, doc_cod: '9', tit_cod: '1' },
            ]),
        };
        const chaves = await new VerificacaoEventoRepository(
            pool as unknown as PostgreeDatabaseClient,
        ).listarChavesRetiradasPeloSistema('L1', ['CODIGO_BARRAS_REPETIDO']);
        expect([...chaves]).toEqual(['2:6171:1']);
        const [sql, params] = pool.selectMany.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/dados->>'motivo' = ANY\(\$motivos\)/);
        expect(params).toEqual({
            evento: 'ITEM_REMOVIDO_SISTEMA',
            loteId: 'L1',
            ator: 'sistema',
            motivos: ['CODIGO_BARRAS_REPETIDO'],
        });
    });

    it('sem tx, grava no pool', async () => {
        const pool = { insert: jest.fn().mockResolvedValue(1) };
        await new VerificacaoEventoRepository(pool as unknown as PostgreeDatabaseClient).registrar({
            evento: 'ALERTA_CRIADA',
            ator: 'sistema',
        });
        expect(pool.insert).toHaveBeenCalledTimes(1);
        expect(pool.insert.mock.calls[0]?.[1]).toMatchObject({ dados: null, loteId: null });
    });
});
