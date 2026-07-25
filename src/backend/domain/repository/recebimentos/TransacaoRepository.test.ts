import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import {
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import TransacaoRepository from './TransacaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const buildTransacao = (o: Partial<TransacaoBancaria> = {}): TransacaoBancaria => ({
    id: 'txn-1',
    correlationId: 'corr-1',
    filCod: 4,
    dataMovimento: new Date('2026-07-01T00:00:00Z'),
    tipo: TRANSACAO_TIPO.CREDITO,
    valor: 15000,
    moeda: 'BRL',
    naturalKey: 'nk-1',
    rawPayload: null,
    normalized: null,
    status: TRANSACAO_BANCARIA_STATUS.IMPORTADA,
    importadoEm: new Date('2026-07-01T00:00:00Z'),
    ...o,
});

describe('TransacaoRepository', () => {
    it('save: UPSERT por natural_key, jsonb, parametrizado', async () => {
        const db = buildDb();
        await new TransacaoRepository(db).save(buildTransacao());
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO transacao_bancaria');
        expect(sql).toContain('ON CONFLICT (natural_key) DO UPDATE');
        expect(sql).toContain('$rawPayload::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ id: 'txn-1', naturalKey: 'nk-1', filCod: 4 });
        expect(params.rawPayload).toBe(JSON.stringify(null));
    });

    it('findById: mapeia camelCase + tipos; null quando ausente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'txn-1',
            correlation_id: 'corr-1',
            fil_cod: 4,
            data_movimento: '2026-07-01T00:00:00Z',
            tipo: 'CREDITO',
            valor: '15000',
            moeda: 'BRL',
            natural_key: 'nk-1',
            raw_payload: null,
            normalized: null,
            status: 'importada',
            importado_em: '2026-07-01T00:00:00Z',
        });
        const row = await new TransacaoRepository(db).findById('txn-1');
        expect(row).toMatchObject({ id: 'txn-1', filCod: 4, valor: 15000, moeda: 'BRL' });

        const db2 = buildDb();
        expect(await new TransacaoRepository(db2).findById('nope')).toBeNull();
    });
});
