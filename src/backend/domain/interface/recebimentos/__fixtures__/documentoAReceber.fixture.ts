import type { DocumentoAReceber } from '../DocumentoAReceber.js';

/** Sample `DocumentoAReceber` (recebível em aberto) — valid against `documentoAReceberSchema`. */
export const documentoAReceberFixture: DocumentoAReceber = {
    docCod: 'DOC-9001',
    titCod: 'TIT-1',
    filCod: 4,
    cliente: 'CLIENTE EXEMPLO LTDA',
    pesCod: 'PES-555',
    valor: 15000,
    valorAberto: 15000,
    moeda: 'BRL',
    vencimento: new Date('2026-07-25T15:00:00.000Z'),
    numDocumento: 'NF-12345',
    priCod: 'PRI-777',
    ativo: true,
};

/** Reusable factory — override any field per test. */
export const buildDocumentoAReceber = (
    overrides: Partial<DocumentoAReceber> = {},
): DocumentoAReceber => ({ ...documentoAReceberFixture, ...overrides });
