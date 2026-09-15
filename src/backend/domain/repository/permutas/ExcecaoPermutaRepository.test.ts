import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import ExcecaoPermutaRepository from './ExcecaoPermutaRepository.js';

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

describe('ExcecaoPermutaRepository', () => {
    it('listAtivas: só as não removidas, mapeadas sem removido_*', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                id: '7',
                adiantamento_doc_cod: '8721',
                justificativa: 'baixas cruzadas 21 x 198 em 30/04',
                criado_por: 'user-abc',
                criado_em: '2026-09-15T12:00:00Z',
                removido_por: null,
                removido_em: null,
            },
        ]);
        const repo = new ExcecaoPermutaRepository(db);

        const ativas = await repo.listAtivas();

        const sql = (db.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(sql).toContain('FROM permuta_excecao_manual');
        expect(sql).toContain('WHERE removido_em IS NULL');
        semInterpolacao(sql);
        expect(ativas).toHaveLength(1);
        expect(ativas[0]).toMatchObject({
            id: '7',
            adiantamentoDocCod: '8721',
            justificativa: 'baixas cruzadas 21 x 198 em 30/04',
            criadoPor: 'user-abc',
        });
        expect(ativas[0].criadoEm).toBeInstanceOf(Date);
        expect(ativas[0]).not.toHaveProperty('removidoPor');
        expect(ativas[0]).not.toHaveProperty('removidoEm');
    });

    it('findAtiva: parametrizado por $adiantamentoDocCod e só entre as ativas', async () => {
        const db = buildDb();
        const repo = new ExcecaoPermutaRepository(db);

        const nenhuma = await repo.findAtiva('8721');

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('FROM permuta_excecao_manual');
        expect(sql).toContain('adiantamento_doc_cod = $adiantamentoDocCod');
        expect(sql).toContain('removido_em IS NULL');
        semInterpolacao(sql);
        expect(params).toEqual({ adiantamentoDocCod: '8721' });
        expect(nenhuma).toBeNull();
    });

    it('findAtiva: mapeia removido_* quando presentes (guard != null, sem cast solto)', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 3,
            adiantamento_doc_cod: '8721',
            justificativa: 'justificativa longa',
            criado_por: 'user-abc',
            criado_em: new Date('2026-09-15T12:00:00Z'),
            removido_por: 'user-xyz',
            removido_em: '2026-09-16T08:00:00Z',
        });
        const repo = new ExcecaoPermutaRepository(db);

        const excecao = await repo.findAtiva('8721');

        expect(excecao).toMatchObject({ id: '3', removidoPor: 'user-xyz' });
        expect(excecao?.removidoEm).toBeInstanceOf(Date);
    });

    it('insertAtiva: INSERT na transação, com $adiantamentoDocCod, $justificativa e $criadoPor', async () => {
        const db = buildDb();
        const tx = buildTx();
        const repo = new ExcecaoPermutaRepository(db);

        await repo.insertAtiva(tx, {
            adiantamentoDocCod: '8721',
            justificativa: 'baixas cruzadas 21 x 198 em 30/04',
            criadoPor: 'user-abc',
        });

        expect(db.insert).not.toHaveBeenCalled();
        const [sql, params] = (tx.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO permuta_excecao_manual');
        expect(sql).toContain('$adiantamentoDocCod');
        expect(sql).toContain('$justificativa');
        expect(sql).toContain('$criadoPor');
        semInterpolacao(sql);
        expect(params).toEqual({
            adiantamentoDocCod: '8721',
            justificativa: 'baixas cruzadas 21 x 198 em 30/04',
            criadoPor: 'user-abc',
        });
    });

    it('softDeleteAtiva: grava removido_por/removido_em só na ativa e devolve o rowCount', async () => {
        const db = buildDb();
        const tx = buildTx();
        (tx.update as jest.Mock).mockResolvedValue(1);
        const repo = new ExcecaoPermutaRepository(db);

        const removidas = await repo.softDeleteAtiva(tx, {
            adiantamentoDocCod: '8721',
            removidoPor: 'user-abc',
        });

        expect(removidas).toBe(1);
        expect(db.update).not.toHaveBeenCalled();
        const [sql, params] = (tx.update as jest.Mock).mock.calls[0];
        const normalizado = (sql as string).replace(/\s+/g, ' ');
        expect(normalizado).toContain('UPDATE permuta_excecao_manual');
        expect(normalizado).toContain('SET removido_por = $removidoPor, removido_em = now()');
        expect(normalizado).toContain(
            'WHERE adiantamento_doc_cod = $adiantamentoDocCod AND removido_em IS NULL',
        );
        semInterpolacao(sql);
        expect(params).toEqual({ adiantamentoDocCod: '8721', removidoPor: 'user-abc' });
    });

    it('softDeleteAtiva: 0 quando não há exceção ativa', async () => {
        const db = buildDb();
        const tx = buildTx();
        (tx.update as jest.Mock).mockResolvedValue(0);
        const repo = new ExcecaoPermutaRepository(db);

        await expect(
            repo.softDeleteAtiva(tx, { adiantamentoDocCod: '8721', removidoPor: 'u' }),
        ).resolves.toBe(0);
    });
});
