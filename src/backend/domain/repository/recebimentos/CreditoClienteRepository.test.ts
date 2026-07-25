import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { CREDITO_CLIENTE_STATUS } from '../../interface/recebimentos/constants.js';
import type { CreditoCliente } from '../../interface/recebimentos/CreditoCliente.js';
import CreditoClienteRepository from './CreditoClienteRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const buildCredito = (o: Partial<CreditoCliente> = {}): CreditoCliente => ({
    id: 'cred-1',
    filCod: 4,
    valorOriginal: 1000,
    valorDisponivel: 1000,
    moeda: 'BRL',
    status: CREDITO_CLIENTE_STATUS.DISPONIVEL,
    criadoEm: new Date('2026-07-01T00:00:00Z'),
    ...o,
});

describe('CreditoClienteRepository', () => {
    it('save: UPSERT por id, parametrizado', async () => {
        const db = buildDb();
        await new CreditoClienteRepository(db).save(buildCredito());
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO credito_cliente');
        expect(sql).toContain('ON CONFLICT (id) DO UPDATE');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ id: 'cred-1', filCod: 4, valorDisponivel: 1000 });
    });

    it('findById: mapeia camelCase; null quando ausente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'cred-1',
            fil_cod: 4,
            valor_original: '1000',
            valor_disponivel: '750',
            moeda: 'BRL',
            status: 'parcial',
            criado_em: '2026-07-01T00:00:00Z',
        });
        const row = await new CreditoClienteRepository(db).findById('cred-1');
        expect(row).toMatchObject({
            id: 'cred-1',
            filCod: 4,
            valorOriginal: 1000,
            valorDisponivel: 750,
            status: 'parcial',
        });

        const db2 = buildDb();
        expect(await new CreditoClienteRepository(db2).findById('nope')).toBeNull();
    });
});
