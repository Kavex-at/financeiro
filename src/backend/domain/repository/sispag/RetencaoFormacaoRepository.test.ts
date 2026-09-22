import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import RetencaoFormacaoRepository from './RetencaoFormacaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const buildTx = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<TransactionClient>;

/** Nenhum valor interpolado no SQL (Rule #5). */
const semInterpolacao = (sql: string) => {
    expect(sql).not.toMatch(/\$\{/);
    expect(sql).not.toMatch(/'\s*\+/);
};

const chave = { filCod: 2, docCod: '100', titCod: '1' };

describe('RetencaoFormacaoRepository', () => {
    it('listAtivas: só as não removidas, mapeadas com data ISO e sem motivo nulo', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                fil_cod: 2,
                doc_cod: '100',
                tit_cod: '1',
                motivo: null,
                marcado_por: 'user-abc',
                marcado_em: new Date('2026-09-22T12:00:00Z'),
            },
            {
                fil_cod: 7,
                doc_cod: '200',
                tit_cod: '3',
                motivo: 'fornecedor pediu para segurar',
                marcado_por: 'user-xyz',
                marcado_em: '2026-09-21T10:00:00Z',
            },
        ]);

        const ativas = await new RetencaoFormacaoRepository(db).listAtivas();

        const sql = (db.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(sql).toContain('FROM titulo_retencao_formacao');
        expect(sql).toContain('WHERE removido_em IS NULL');
        semInterpolacao(sql);
        expect(ativas).toEqual([
            {
                filCod: 2,
                docCod: '100',
                titCod: '1',
                retencao: { marcadoPor: 'user-abc', marcadoEm: '2026-09-22T12:00:00.000Z' },
            },
            {
                filCod: 7,
                docCod: '200',
                titCod: '3',
                retencao: {
                    marcadoPor: 'user-xyz',
                    marcadoEm: '2026-09-21T10:00:00.000Z',
                    motivo: 'fornecedor pediu para segurar',
                },
            },
        ]);
    });

    it('insertAtiva: parametrizado, na transação, idempotente sobre o índice parcial', async () => {
        const db = buildDb();
        const tx = buildTx();

        await new RetencaoFormacaoRepository(db).insertAtiva(tx, {
            ...chave,
            motivo: 'em negociação',
            marcadoPor: 'user-abc',
        });

        expect(db.insert).not.toHaveBeenCalled();
        const [sql, params] = (tx.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO titulo_retencao_formacao');
        expect(sql).toMatch(
            /ON CONFLICT \(fil_cod, doc_cod, tit_cod\) WHERE removido_em IS NULL DO NOTHING/,
        );
        semInterpolacao(sql);
        expect(params).toEqual({
            filCod: 2,
            docCod: '100',
            titCod: '1',
            motivo: 'em negociação',
            marcadoPor: 'user-abc',
        });
    });

    it('insertAtiva sem motivo grava NULL (não string vazia)', async () => {
        const tx = buildTx();
        await new RetencaoFormacaoRepository(buildDb()).insertAtiva(tx, {
            ...chave,
            marcadoPor: 'user-abc',
        });
        expect((tx.insert as jest.Mock).mock.calls[0][1]).toMatchObject({ motivo: null });
    });

    it('liberarAtiva: soft delete com autor e motivo de remoção; devolve a contagem', async () => {
        const tx = buildTx();
        (tx.update as jest.Mock).mockResolvedValue(1);

        const n = await new RetencaoFormacaoRepository(buildDb()).liberarAtiva(tx, {
            ...chave,
            removidoPor: 'user-abc',
            motivoRemocao: 'incluido-no-lote',
        });

        expect(n).toBe(1);
        const [sql, params] = (tx.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('UPDATE titulo_retencao_formacao');
        expect(sql).toContain('removido_em = now()');
        expect(sql).toContain('removido_em IS NULL');
        expect(sql).not.toMatch(/DELETE/i);
        semInterpolacao(sql);
        expect(params).toEqual({
            filCod: 2,
            docCod: '100',
            titCod: '1',
            removidoPor: 'user-abc',
            motivoRemocao: 'incluido-no-lote',
        });
    });
});
