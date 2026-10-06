import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import {
    type DuplicateCandidate,
    ITEM_ALERT_TYPE,
} from '../../interface/sispag/SispagInterface.js';
import DuplicateDetector from './DuplicateDetector.js';

/**
 * I13c–e (ADR-0063): duplicidade FORTE (mesmo favorecido + mesma NF normalizada) e FRACA (mesmo
 * favorecido + mesmo valor em centavos + vencimento a ±N dias), sempre com `docCod` diferente e na
 * filial do item (gap Q2). Puro: nenhum teste toca rede nem banco.
 */

const DIA = 86_400_000;
const BASE_VENC = Date.UTC(2026, 9, 10);
const DESDE = Date.UTC(2026, 0, 1);

const fixture = JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', 'fin064-fil4-6173-6702.json'), 'utf8'),
) as { count: number; rows: Array<Record<string, unknown>> };

/** As linhas do fin064 passam pelo MESMO mapeamento da produção (client com base mockada). */
const candidatosDe = async (
    rows: Array<Record<string, unknown>>,
    filCod: number,
    pesCod: string,
): Promise<DuplicateCandidate[]> => {
    const base = {
        listGenericPaginated: jest.fn().mockResolvedValue({ count: rows.length, rows }),
        runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
    };
    const client = new ConexosSispagClient(base as unknown as ConexosBaseClient);
    return client.listTitulosFavorecidoParaDuplicidade(filCod, pesCod, DESDE);
};

const titulo = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
    filCod: 1,
    docCod: '100',
    titCod: '1',
    favorecido: '777',
    numeroNota: '1234',
    valorCentavos: 100_000,
    vencimento: BASE_VENC,
    pago: false,
    ...over,
});

const detector = new DuplicateDetector();
const detectar = (alvo: DuplicateCandidate, universo: DuplicateCandidate[], janela = 15) =>
    detector.detectar(alvo, universo, { janelaFracaDias: janela });

describe('DuplicateDetector — caso canônico fil 4, docs 6173 × 6702', () => {
    it('o item do 6173 tem um par FORTE com a contraparte (4, 6702)', async () => {
        const universo = await candidatosDe(fixture.rows, 4, '90001');
        const alvo = universo.find((t) => t.docCod === '6173' && t.titCod === '1');
        expect(alvo).toBeDefined();
        const achados = detectar(alvo as DuplicateCandidate, universo);
        const fortes = achados.filter((a) => a.tipo === ITEM_ALERT_TYPE.DUPLICIDADE_FORTE);
        expect(fortes).toHaveLength(1);
        expect(fortes[0]).toMatchObject({ contraparteFilCod: 4, contraparteDocCod: '6702' });
        expect(fortes[0]?.contraparteTitulos.map((t) => t.titCod)).toEqual(['1']);
        // Nenhuma outra contraparte: parcela do mesmo doc, NF diferente, outro favorecido, sem NF.
        expect(achados.map((a) => a.contraparteDocCod)).toEqual(['6702']);
    });

    it('e vice-versa: o item do 6702 tem um par FORTE com a contraparte (4, 6173), as duas parcelas', async () => {
        const universo = await candidatosDe(fixture.rows, 4, '90001');
        const alvo = universo.find((t) => t.docCod === '6702');
        const achados = detectar(alvo as DuplicateCandidate, universo);
        expect(achados).toHaveLength(1);
        expect(achados[0]).toMatchObject({
            tipo: ITEM_ALERT_TYPE.DUPLICIDADE_FORTE,
            contraparteFilCod: 4,
            contraparteDocCod: '6173',
        });
        expect(achados[0]?.contraparteTitulos.map((t) => t.titCod).sort()).toEqual(['1', '2']);
        // A contraparte já paga entra (é justamente o caso perigoso) e vem marcada como paga.
        expect(achados[0]?.contraparteTitulos.find((t) => t.titCod === '1')?.pago).toBe(true);
        expect(achados[0]?.evidencia).toMatchObject({ numeroNota: '45871' });
    });
});

describe('DuplicateDetector — FORTE (I13c)', () => {
    it('casa por pesCod; com pesCod vazio usa o pesCodFor', async () => {
        const rows = [
            { docCod: 1, titCod: 1, pesCod: '555', pesCodFor: '999', docEspNumero: '10' },
            { docCod: 2, titCod: 1, pesCod: '', pesCodFor: '555', docEspNumero: '10' },
            { docCod: 3, titCod: 1, pesCod: null, pesCodFor: '555', docEspNumero: '10' },
            { docCod: 4, titCod: 1, pesCod: '999', pesCodFor: '555', docEspNumero: '10' },
        ].map((r) => ({ ...r, titMnyValor: 10, titDtaVencimento: BASE_VENC, vldPago: 0 }));
        const universo = await candidatosDe(rows, 1, '555');
        expect(universo.map((t) => t.docCod).sort()).toEqual(['1', '2', '3']);
        const alvo = universo.find((t) => t.docCod === '1') as DuplicateCandidate;
        expect(
            detectar(alvo, universo)
                .map((a) => a.contraparteDocCod)
                .sort(),
        ).toEqual(['2', '3']);
    });

    it('normaliza a NF: só dígitos, sem zeros à esquerda', () => {
        const alvo = titulo({ numeroNota: detector.normalizarNota('NF 000.123-A') });
        expect(alvo.numeroNota).toBe('123');
        const outro = titulo({ docCod: '200', numeroNota: detector.normalizarNota('123') });
        expect(detectar(alvo, [alvo, outro])[0]?.tipo).toBe(ITEM_ALERT_TYPE.DUPLICIDADE_FORTE);
    });

    it('NF vazia depois de normalizar não casa (nem "000", nem ausente)', () => {
        expect(detector.normalizarNota('000')).toBe('');
        expect(detector.normalizarNota(undefined)).toBe('');
        const alvo = titulo({ numeroNota: '', valorCentavos: 1 });
        const outro = titulo({ docCod: '200', numeroNota: '', valorCentavos: 2 });
        expect(detectar(alvo, [alvo, outro])).toEqual([]);
    });

    it('qualquer tipo de documento e inclusive título já pago', () => {
        const alvo = titulo({ docTipo: 'NF' });
        const pago = titulo({ docCod: '200', docTipo: 'FATURA', pago: true, valorCentavos: 5 });
        const achados = detectar(alvo, [alvo, pago]);
        expect(achados).toHaveLength(1);
        expect(achados[0]?.tipo).toBe(ITEM_ALERT_TYPE.DUPLICIDADE_FORTE);
        expect(achados[0]?.contraparteTitulos[0]?.pago).toBe(true);
    });

    it('outro favorecido com a mesma NF não é duplicidade', () => {
        const alvo = titulo();
        const outro = titulo({ docCod: '200', favorecido: '888' });
        expect(detectar(alvo, [alvo, outro])).toEqual([]);
    });

    it('item sem favorecido não casa com nada', () => {
        const alvo = titulo({ favorecido: undefined });
        const outro = titulo({ docCod: '200', favorecido: undefined });
        expect(detectar(alvo, [alvo, outro])).toEqual([]);
    });
});

describe('DuplicateDetector — FRACA (I13d)', () => {
    const semNota = (over: Partial<DuplicateCandidate> = {}) => titulo({ numeroNota: '', ...over });

    it('mesmo favorecido + mesmo valor em centavos + vencimento a ±15 dias (borda 15 casa, 16 não)', () => {
        const alvo = semNota();
        const quinze = semNota({ docCod: '200', vencimento: BASE_VENC + 15 * DIA });
        const dezesseis = semNota({ docCod: '300', vencimento: BASE_VENC - 16 * DIA });
        const achados = detectar(alvo, [alvo, quinze, dezesseis]);
        expect(achados).toHaveLength(1);
        expect(achados[0]).toMatchObject({
            tipo: ITEM_ALERT_TYPE.DUPLICIDADE_FRACA,
            contraparteDocCod: '200',
        });
    });

    it('a janela N é injetada (config do tenant)', () => {
        const alvo = semNota();
        const quatro = semNota({ docCod: '200', vencimento: BASE_VENC + 4 * DIA });
        expect(detectar(alvo, [alvo, quatro], 3)).toEqual([]);
        expect(detectar(alvo, [alvo, quatro], 4)).toHaveLength(1);
    });

    it('valor diferente em um centavo não casa', () => {
        const alvo = semNota();
        const outro = semNota({ docCod: '200', valorCentavos: 100_001 });
        expect(detectar(alvo, [alvo, outro])).toEqual([]);
    });

    it('compara também contra título já pago (Q6)', () => {
        const alvo = semNota();
        const pago = semNota({ docCod: '200', pago: true, vencimento: BASE_VENC - 3 * DIA });
        expect(detectar(alvo, [alvo, pago])[0]?.tipo).toBe(ITEM_ALERT_TYPE.DUPLICIDADE_FRACA);
    });

    it('sem vencimento de um dos lados não casa', () => {
        const alvo = semNota({ vencimento: undefined });
        const outro = semNota({ docCod: '200' });
        expect(detectar(alvo, [alvo, outro])).toEqual([]);
    });
});

describe('DuplicateDetector — exclusões (I13d, I13e, Q2)', () => {
    it('par FORTE não gera também FRACA', () => {
        const alvo = titulo();
        const mesmo = titulo({ docCod: '200' }); // mesma NF, mesmo valor, mesmo vencimento
        const achados = detectar(alvo, [alvo, mesmo]);
        expect(achados).toHaveLength(1);
        expect(achados[0]?.tipo).toBe(ITEM_ALERT_TYPE.DUPLICIDADE_FORTE);
    });

    it('parcelas do mesmo (filCod, docCod) nunca são contraparte', () => {
        const alvo = titulo({ titCod: '1' });
        const parcela = titulo({ titCod: '2' });
        expect(detectar(alvo, [alvo, parcela])).toEqual([]);
    });

    it('contraparte de outra filial é ignorada', () => {
        const alvo = titulo({ filCod: 1 });
        const outraFilial = titulo({ filCod: 2, docCod: '200' });
        expect(detectar(alvo, [alvo, outraFilial])).toEqual([]);
    });

    it('vários títulos do mesmo documento-contraparte viram UMA alerta por tipo', () => {
        const alvo = titulo();
        const t1 = titulo({ docCod: '200', titCod: '1' });
        const t2 = titulo({ docCod: '200', titCod: '2', valorCentavos: 9 });
        const achados = detectar(alvo, [alvo, t1, t2]);
        expect(achados).toHaveLength(1);
        expect(achados[0]?.contraparteTitulos.map((t) => t.titCod)).toEqual(['1', '2']);
    });
});
