import { MATCH_CLASSIFICACAO, PARCELA_FINALIDADE, RECEBIMENTO_STATUS } from '../constants.js';
import type { RateioRecebimento } from '../RateioRecebimento.js';
import type { Recebimento } from '../Recebimento.js';

/** Sample rateio parcela — valid against `rateioRecebimentoSchema`. */
export const rateioRecebimentoFixture: RateioRecebimento = {
    id: 'rat-0001',
    recebimentoId: 'rec-0001',
    documentoDocCod: 'DOC-9001',
    documentoTitCod: 'TIT-1',
    filCod: 4,
    priCod: 'PRI-777',
    componente: PARCELA_FINALIDADE.PRINCIPAL,
    finalidade: 'principal',
    valorAlocado: 15000,
    moeda: 'BRL',
    incluidoPor: 'analista',
};

/** Sample `Recebimento` (aggregate root, status rascunho) — valid against `recebimentoSchema`. */
export const recebimentoFixture: Recebimento = {
    id: 'rec-0001',
    correlationId: 'corr-0001',
    transacaoBancariaId: 'txn-0001',
    filCod: 4,
    classificacaoMatch: MATCH_CLASSIFICACAO.UNICA,
    status: RECEBIMENTO_STATUS.RASCUNHO,
    valorRecebido: 15000,
    valorAlocado: 15000,
    diferencaNaoAlocada: 0,
    regrasAplicadas: [],
    rateios: [rateioRecebimentoFixture],
    versao: 0,
    criadoPor: 'analista',
    criadoEm: new Date('2026-07-20T15:10:00.000Z'),
};

/** Reusable factory — override any field per test. */
export const buildRecebimento = (overrides: Partial<Recebimento> = {}): Recebimento => ({
    ...recebimentoFixture,
    ...overrides,
});
