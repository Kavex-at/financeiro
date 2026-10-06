import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { ChannelProfile } from '../../interface/sispag/SispagInterface.js';
import PerfilCanalFornecedorRepository from './PerfilCanalFornecedorRepository.js';

const buildDb = () => {
    const db = {
        selectFirst: jest.fn().mockResolvedValue(null),
        insert: jest.fn(async () => 1),
        withTransaction: jest.fn(),
    };
    db.withTransaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
    return db;
};

const perfil = (pesCod: string): ChannelProfile => ({
    pesCod,
    credor: `F${pesCod}`,
    contagens: { BOLETO: 5, TED_PIX: 0, OUTROS: 0 },
    pagamentosUnicos: 5,
    mesesDistintos: 3,
    grupoDominante: 'BOLETO',
    participacao: 1,
    confianca: 'ALTA',
    janelaInicio: Date.UTC(2025, 0, 1),
    janelaFim: Date.UTC(2026, 9, 1),
});

describe('PerfilCanalFornecedorRepository (ADR-0063, I13i)', () => {
    it('upsertRodada grava tudo numa transação, UPSERT por pes_cod, parametrizado', async () => {
        const db = buildDb();
        const repo = new PerfilCanalFornecedorRepository(db as unknown as PostgreeDatabaseClient);
        await repo.upsertRodada([perfil('1'), perfil('2')], 'run-9');
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        const [sql, params] = (db.insert.mock.calls[0] ?? []) as unknown as [
            string,
            Record<string, unknown>,
        ];
        expect(sql).toMatch(/ON CONFLICT \(pes_cod\) DO UPDATE SET/);
        expect(sql).not.toContain("'1'");
        expect(params).toMatchObject({ jobRunId: 'run-9', p0: '1', p1: '2', g0: 'BOLETO' });
    });

    it('rodada que falha propaga e não apaga perfil (nenhum DELETE; rollback é da transação)', async () => {
        const db = buildDb();
        db.insert.mockRejectedValueOnce(new Error('falha de banco'));
        const repo = new PerfilCanalFornecedorRepository(db as unknown as PostgreeDatabaseClient);
        await expect(repo.upsertRodada([perfil('1')], 'run-9')).rejects.toThrow('falha de banco');
        for (const [q] of db.insert.mock.calls as unknown as Array<[string]>) {
            expect(q).not.toMatch(/DELETE/i);
        }
    });

    it('rodada vazia não abre transação', async () => {
        const db = buildDb();
        const repo = new PerfilCanalFornecedorRepository(db as unknown as PostgreeDatabaseClient);
        expect(await repo.upsertRodada([], 'run-9')).toBe(0);
        expect(db.withTransaction).not.toHaveBeenCalled();
    });

    it('findByPesCod mapeia numeric e datas', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({
            pes_cod: '1',
            credor: 'F1',
            contagens: { BOLETO: 19, TED_PIX: 1, OUTROS: 0 },
            pagamentos_unicos: 20,
            meses_distintos: 4,
            grupo_dominante: 'BOLETO',
            participacao: '0.9500',
            confianca: 'ALTA',
            janela_inicio: new Date('2025-01-01T00:00:00Z'),
            janela_fim: new Date('2026-10-01T00:00:00Z'),
            calculado_em: new Date('2026-10-05T03:00:00Z'),
            job_run_id: 'run-9',
        });
        const repo = new PerfilCanalFornecedorRepository(db as unknown as PostgreeDatabaseClient);
        expect(await repo.findByPesCod('1')).toMatchObject({
            participacao: 0.95,
            confianca: 'ALTA',
            janelaInicio: Date.UTC(2025, 0, 1),
            jobRunId: 'run-9',
        });
    });
});
