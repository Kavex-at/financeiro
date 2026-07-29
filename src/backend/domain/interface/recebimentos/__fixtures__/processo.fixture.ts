import type { Processo } from '../GerDocProcesso.js';

/** Sample `Processo` (candidato de importação) — valid against `processoSchema`. */
export const processoFixture: Processo = {
    priCod: 90001,
    priEspRefcliente: 'REF-CLI-0001',
    filCod: 4,
    pesCod: 555,
    dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
    moeCod: 790,
    valor: 15000,
    contraparte: 'CLIENTE EXEMPLO LTDA',
};

/** Reusable factory — override any field per test. */
export const buildProcesso = (overrides: Partial<Processo> = {}): Processo => ({
    ...processoFixture,
    ...overrides,
});

/**
 * Seed de candidatos do STUB — cobre a mesma filial (4) em variações + uma outra filial (7) para
 * exercitar o filtro por `filCod`. Sem DB/SQL; determinístico para a review e os testes.
 */
export const processoCandidatosSeed: Processo[] = [
    processoFixture,
    buildProcesso({
        priCod: 90002,
        priEspRefcliente: 'REF-CLI-0002',
        pesCod: 556,
        dpeNomPessoa: 'IMPORTADORA ATLAS S.A.',
        valor: 32500.5,
        contraparte: 'IMPORTADORA ATLAS S.A.',
    }),
    buildProcesso({
        priCod: 90003,
        priEspRefcliente: 'REF-CLI-0003',
        pesCod: 557,
        dpeNomPessoa: 'GRUPO MERIDIAN',
        valor: 21750,
        contraparte: 'GRUPO MERIDIAN',
    }),
    buildProcesso({
        priCod: 90007,
        priEspRefcliente: 'REF-CLI-0007',
        filCod: 7,
        pesCod: 771,
        dpeNomPessoa: 'COMERCIAL VERTEX LTDA',
        valor: 9000,
        contraparte: 'COMERCIAL VERTEX LTDA',
    }),
];
