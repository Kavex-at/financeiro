import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { MapeamentoConta } from '../../interface/sispag/FornecedorContaBoleto.js';
import FornecedorContaBoletoRepository from './FornecedorContaBoletoRepository.js';

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
        } as unknown as PostgreeDatabaseClient & { selectMany: jest.Mock },
    };
};

const mapeamento = (i: number, over: Partial<MapeamentoConta> = {}): MapeamentoConta => ({
    chave: `237:0001/${String(i).padStart(7, '0')}`,
    pesCod: String(i),
    credor: `FORNECEDOR ${i}`,
    origem: 'INFERIDO',
    ambiguo: false,
    evidencias: 1,
    ultimaEvidenciaEm: new Date('2026-10-30T12:00:00Z'),
    ...over,
});

describe('FornecedorContaBoletoRepository (ADR-0081)', () => {
    it('listEvidencias: as três origens num SELECT só de leitura, sem interpolar valor', async () => {
        const { client } = buildDb();
        const visto = new Date('2026-10-30T12:00:00Z');
        client.selectMany.mockResolvedValue([
            { codbar: 'X', pes_cod: '10', credor: 'ACME', origem: 'VINCULADO', visto_em: visto },
            { codbar: 'Y', pes_cod: '20', credor: null, origem: 'INFERIDO', visto_em: visto },
        ]);
        const r = await new FornecedorContaBoletoRepository(client).listEvidencias();
        const sql: string = client.selectMany.mock.calls[0][0];
        for (const origem of ['VINCULADO', 'CONFIRMADO', 'INFERIDO']) {
            expect(sql).toContain(`'${origem}' AS origem`);
        }
        expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
        expect(sql).toContain("decisao = 'CONFIRMADA'");
        expect(sql).toContain('cancelado_em IS NULL');
        // Vencimento do ERP é dia civil gravado como instante: o dia se lê em UTC.
        expect(sql).toContain("AT TIME ZONE 'UTC'");
        expect(r).toEqual([
            { codbar: 'X', pesCod: '10', credor: 'ACME', origem: 'VINCULADO', vistoEm: visto },
            { codbar: 'Y', pesCod: '20', origem: 'INFERIDO', vistoEm: visto },
        ]);
    });

    it('substituir: apaga e regrava numa transação, em blocos, tudo parametrizado', async () => {
        const { client, tx } = buildDb();
        const todos = Array.from({ length: 205 }, (_, i) => mapeamento(i + 1));
        todos.push(mapeamento(999, { ambiguo: true, pesCod: undefined, credor: undefined }));
        delete todos[205]?.pesCod;
        await new FornecedorContaBoletoRepository(client).substituir(todos);
        expect(client.withTransaction).toHaveBeenCalledTimes(1);
        expect(tx.update.mock.calls[0][0]).toBe('DELETE FROM sispag_fornecedor_conta_boleto');
        expect(tx.insert).toHaveBeenCalledTimes(2);
        const [sql, params] = tx.insert.mock.calls[0];
        expect(sql).toContain('INSERT INTO sispag_fornecedor_conta_boleto');
        expect(sql).not.toContain('FORNECEDOR 1');
        expect(params).toMatchObject({ c0: '237:0001/0000001', p0: '1', n0: 'FORNECEDOR 1' });
        expect(Object.keys(tx.insert.mock.calls[1][1])).toHaveLength(6 * 7);
        expect(tx.insert.mock.calls[1][1]).toMatchObject({ a5: true, p5: null, n5: null });
    });

    it('substituir com lista vazia só apaga', async () => {
        const { client, tx } = buildDb();
        await new FornecedorContaBoletoRepository(client).substituir([]);
        expect(tx.update).toHaveBeenCalledTimes(1);
        expect(tx.insert).not.toHaveBeenCalled();
    });

    it('listMapeamentos devolve um Map por chave, sem nome quando ambígua', async () => {
        const { client } = buildDb();
        const em = new Date('2026-10-30T12:00:00Z');
        client.selectMany.mockResolvedValue([
            {
                chave: '033:0045185',
                pes_cod: null,
                credor: null,
                origem: 'INFERIDO',
                ambiguo: true,
                evidencias: 4,
                ultima_evidencia_em: em,
            },
        ]);
        const m = await new FornecedorContaBoletoRepository(client).listMapeamentos();
        expect(m.get('033:0045185')).toEqual({
            chave: '033:0045185',
            origem: 'INFERIDO',
            ambiguo: true,
            evidencias: 4,
            ultimaEvidenciaEm: em,
        });
    });
});
