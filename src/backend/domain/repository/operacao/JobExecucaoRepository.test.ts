import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import JobExecucaoRepository from './JobExecucaoRepository.js';

describe('JobExecucaoRepository.existeConcluidaDesde', () => {
    const build = (row: unknown) => {
        const selectFirst = jest.fn().mockResolvedValue(row);
        const repo = new JobExecucaoRepository({
            selectFirst,
        } as unknown as PostgreeDatabaseClient);
        return { repo, selectFirst };
    };

    it('parametrizado, só success/partial, desde o instante pedido', async () => {
        const { repo, selectFirst } = build({ existe: true });
        const desde = new Date('2026-10-30T03:00:00Z');
        expect(await repo.existeConcluidaDesde('sispag-formacao-lotes', desde)).toBe(true);
        const [sql, params] = selectFirst.mock.calls[0] ?? [];
        expect(sql).toContain("status IN ('success', 'partial')");
        expect(sql).toContain('started_at >= $desde');
        expect(sql).toContain('pipeline = $pipeline');
        expect(params).toEqual({ pipeline: 'sispag-formacao-lotes', desde });
    });

    it('sem linha = false', async () => {
        const { repo } = build(null);
        expect(await repo.existeConcluidaDesde('x', new Date(0))).toBe(false);
    });
});
