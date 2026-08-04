import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { NDE_STATUS_EMISSAO } from '../../interface/recebimentos/constants.js';
import type { NotaDebitoEletronica } from '../../interface/recebimentos/NotaDebitoEletronica.js';
import NdeRepository from './NdeRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const buildNde = (o: Partial<NotaDebitoEletronica> = {}): NotaDebitoEletronica => ({
    id: 'nde-1',
    recebimentoId: 'rec-1',
    filCod: 4,
    correlationId: 'corr-1',
    valor: 15000,
    moeda: 'BRL',
    statusEmissao: NDE_STATUS_EMISSAO.PENDENTE,
    idempotencyKey: 'nde:rec-1',
    ...o,
});

describe('NdeRepository', () => {
    it('save: UPSERT por idempotency_key (uma NDe por Recebimento), jsonb, parametrizado', async () => {
        const db = buildDb();
        await new NdeRepository(db).save(buildNde());
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO nota_debito_eletronica');
        expect(sql).toContain('ON CONFLICT (idempotency_key) DO UPDATE');
        expect(sql).toContain('$erpResponse::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ id: 'nde-1', idempotencyKey: 'nde:rec-1' });
    });

    it('findByRecebimentoId: mapeia camelCase; null quando ausente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'nde-1',
            recebimento_id: 'rec-1',
            fil_cod: 4,
            correlation_id: 'corr-1',
            valor: '15000',
            moeda: 'BRL',
            status_emissao: 'emitida',
            idempotency_key: 'nde:rec-1',
        });
        const row = await new NdeRepository(db).findByRecebimentoId('rec-1');
        expect(row).toMatchObject({
            id: 'nde-1',
            recebimentoId: 'rec-1',
            statusEmissao: 'emitida',
            idempotencyKey: 'nde:rec-1',
        });

        const db2 = buildDb();
        expect(await new NdeRepository(db2).findByRecebimentoId('nope')).toBeNull();
    });
});
