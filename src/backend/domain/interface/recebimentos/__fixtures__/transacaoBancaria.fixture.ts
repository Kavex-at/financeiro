import { TRANSACAO_BANCARIA_STATUS, TRANSACAO_TIPO } from '../constants.js';
import type { TransacaoBancaria } from '../TransacaoBancaria.js';

/** Sample `TransacaoBancaria` (crédito importado) — valid against `transacaoBancariaSchema`. */
export const transacaoBancariaFixture: TransacaoBancaria = {
    id: 'txn-0001',
    correlationId: 'corr-0001',
    filCod: 4,
    dataMovimento: new Date('2026-07-20T15:00:00.000Z'),
    tipo: TRANSACAO_TIPO.CREDITO,
    valor: 15000,
    moeda: 'BRL',
    contraparte: 'CLIENTE EXEMPLO LTDA',
    referenciaBancaria: 'PIX-ABC123',
    naturalKey: '4:12345:2026-07-20:15000:PIX-ABC123',
    rawPayload: { origem: 'nexxera', bruto: true },
    normalized: { valor: 15000, moeda: 'BRL' },
    status: TRANSACAO_BANCARIA_STATUS.IMPORTADA,
    importRunId: 'run-0001',
    importadoEm: new Date('2026-07-20T15:05:00.000Z'),
};

/** Reusable factory — override any field per test. */
export const buildTransacaoBancaria = (
    overrides: Partial<TransacaoBancaria> = {},
): TransacaoBancaria => ({ ...transacaoBancariaFixture, ...overrides });
