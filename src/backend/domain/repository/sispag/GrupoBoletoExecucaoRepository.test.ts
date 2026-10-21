import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import GrupoBoletoExecucaoRepository from './GrupoBoletoExecucaoRepository.js';

const tx = () => ({
    selectFirst: jest.fn(
        async (_sql: string, _p?: Record<string, unknown>): Promise<unknown> => null,
    ),
    selectMany: jest.fn(
        async (_sql: string, _p?: Record<string, unknown>): Promise<unknown[]> => [],
    ),
    update: jest.fn(async (_sql: string, _p?: Record<string, unknown>) => 1),
    insert: jest.fn(async (_sql: string, _p?: Record<string, unknown>) => 1),
});

const db = (t = tx()) => ({
    ...t,
    withTransaction: jest.fn(async (fn: (x: TransactionClient) => Promise<unknown>) =>
        fn(t as unknown as TransactionClient),
    ),
});

describe('GrupoBoletoExecucaoRepository (unidade)', () => {
    const make = (d = db()) => ({
        d,
        repo: new GrupoBoletoExecucaoRepository(d as unknown as PostgreeDatabaseClient),
    });

    it('abrir só nasce em intencao_gravada ou simulado', async () => {
        const { d, repo } = make();
        await expect(
            repo.abrir({ grupoId: 'g', loteId: 'l', filCod: 2, etapa: 'importado' }),
        ).rejects.toThrow(/não nasce/);
        expect(d.selectFirst).not.toHaveBeenCalled();
    });

    it('transição inválida lança antes do UPDATE; a válida é condicionada à etapa de origem', async () => {
        const { d, repo } = make();
        await expect(repo.registrarEtapa('id', 'intencao_gravada', 'importado')).rejects.toThrow(
            /transição inválida/,
        );
        expect(d.update).not.toHaveBeenCalled();
        await repo.registrarEtapa('id', 'intencao_gravada', 'bordero_criado');
        const [sql, params] = d.update.mock.calls[0] as unknown as [
            string,
            Record<string, unknown>,
        ];
        expect(sql).toMatch(/WHERE id = \$id::uuid AND etapa = \$de/);
        expect(params).toMatchObject({ de: 'intencao_gravada', para: 'bordero_criado' });
    });

    it('motivo com dígitos longos é recusado antes do UPDATE', async () => {
        const { d, repo } = make();
        await expect(
            repo.registrarEtapa('id', 'importado', 'retirado', {
                motivo: `barra ${'3'.repeat(44)}`,
            }),
        ).rejects.toThrow(/dígitos/);
        expect(d.update).not.toHaveBeenCalled();
    });

    it('registrarBordero nunca troca uma identidade já gravada (guarda no WHERE)', async () => {
        const { d, repo } = make();
        await repo.registrarBordero('id', { borCod: 253, borTimCad: 1792523939000 });
        const [sql, params] = d.update.mock.calls[0] as unknown as [
            string,
            Record<string, unknown>,
        ];
        expect(sql).toMatch(
            /AND \(bor_cod IS NULL OR \(bor_cod = \$borCod AND bor_tim_cad = \$borTimCad\)\)/,
        );
        expect(params).toMatchObject({ borCod: 253, borTimCad: 1792523939000, t1: null });
    });
});
