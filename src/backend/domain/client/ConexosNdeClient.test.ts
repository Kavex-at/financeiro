import 'reflect-metadata';
import HomologacaoRejeitadaError from '../errors/HomologacaoRejeitadaError.js';
import type { RotaHomologacao } from '../interface/recebimentos/HomologacaoNde.js';
import ConexosBaseClient, { type LegacyConexosShape } from './ConexosBaseClient.js';
import ConexosNdeClient from './ConexosNdeClient.js';

const buildLegacy = (): jest.Mocked<LegacyConexosShape> => ({
    ensureSid: jest.fn().mockResolvedValue(undefined),
    listGeneric: jest.fn(),
    listGenericPaginated: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    getGeneric: jest.fn().mockResolvedValue({ rows: [] }),
    postGeneric: jest.fn().mockResolvedValue({}),
    postGenericOnce: jest.fn().mockResolvedValue({}),
    putGenericOnce: jest.fn().mockResolvedValue({}),
    postMultipartOnce: jest.fn().mockResolvedValue({}),
    deleteGeneric: jest.fn().mockResolvedValue(undefined),
    getFiliais: jest.fn().mockResolvedValue([]),
    getFilCodDefault: jest.fn().mockResolvedValue(null),
});

const buildClient = (legacy: LegacyConexosShape): ConexosNdeClient =>
    new ConexosNdeClient(new ConexosBaseClient(legacy));

const ROTA_NORMAL: RotaHomologacao = {
    contingencia: false,
    verbo: 'homologaNfe',
    vldTpNf: '1',
};
const ROTA_CONTINGENCIA: RotaHomologacao = {
    contingencia: true,
    verbo: 'homologaNfeContingencia',
    aviso: 'DPEC',
    vldTpNf: '11',
};

const INPUT = { docCod: 'DOC-9001', filCod: 4, correlationId: 'corr-0001' };

describe('ConexosNdeClient.homologar — com297 homologation', () => {
    afterEach(() => jest.clearAllMocks());

    it('POSTs com297/homologaNfe/{docCod} with an empty body (docCod in the PATH) on the normal route', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({ docVldComvalidacoes: 1 });
        await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL });
        expect(legacy.postGenericOnce).toHaveBeenCalledWith(
            'com297/homologaNfe/DOC-9001',
            {},
            { filCod: 4 },
        );
    });

    it('uses the homologaNfeContingencia verb on the contingency route', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({ docVldComvalidacoes: 1 });
        await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_CONTINGENCIA });
        expect(legacy.postGenericOnce).toHaveBeenCalledWith(
            'com297/homologaNfeContingencia/DOC-9001',
            {},
            { filCod: 4 },
        );
    });

    it('uses postGenericOnce (single attempt — never postGeneric) so a retry cannot double-homologate', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({ docVldComvalidacoes: 1 });
        await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL });
        expect(legacy.postGenericOnce).toHaveBeenCalledTimes(1);
        expect(legacy.postGeneric).not.toHaveBeenCalled();
    });

    it('docVldComvalidacoes=1 → emitida limpa (no aviso)', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({
            docVldComvalidacoes: 1,
            docEspNumero: 'NDE-123',
        });
        const result = await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL });
        expect(result.docVldComvalidacoes).toBe(1);
        expect(result.avisoValidacoesPendentes).toBe(false);
        expect(result.numeroNde).toBe('NDE-123');
    });

    it('docVldComvalidacoes=2 → emitida COM aviso (validações pendentes — com194)', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({ docVldComvalidacoes: 2 });
        const result = await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL });
        expect(result.avisoValidacoesPendentes).toBe(true);
    });

    it('unwraps a { data: { ... } } envelope and coerces a numeric docEspNumero to string', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({
            data: { docVldComvalidacoes: 1, docEspNumero: 456 },
        });
        const result = await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL });
        expect(result.docVldComvalidacoes).toBe(1);
        expect(result.numeroNde).toBe('456');
    });

    it('docVldComvalidacoes=0 → emitida COM aviso (validações não-bloqueantes: cond.pgto/frete/GTIN)', async () => {
        // Yuri 2026-08-03: essas validações NÃO bloqueiam a homologação na plataforma — ela acontece.
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({ docVldComvalidacoes: 0 });
        const result = await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL });
        expect(result.avisoValidacoesPendentes).toBe(true);
    });

    it('um docVldComvalidacoes DESCONHECIDO (ex. 3) → HomologacaoRejeitadaError (200 ≠ sucesso)', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({ docVldComvalidacoes: 3 });
        await expect(
            buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL }),
        ).rejects.toThrow(HomologacaoRejeitadaError);
    });

    it('tags a validation reject with motivo=validacao + the docVldComvalidacoes, non-retryable', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockResolvedValue({ docVldComvalidacoes: 9 });
        try {
            await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL });
            throw new Error('expected throw');
        } catch (err) {
            const e = err as HomologacaoRejeitadaError;
            expect(e).toBeInstanceOf(HomologacaoRejeitadaError);
            expect(e.details).toMatchObject({ motivo: 'validacao', docVldComvalidacoes: 9 });
            expect(e.retryable).toBe(false);
        }
    });

    it('an upstream POST failure → HomologacaoRejeitadaError(motivo=upstream), non-retryable (fail-closed)', async () => {
        const legacy = buildLegacy();
        legacy.postGenericOnce.mockRejectedValue(new Error('socket hang up'));
        try {
            await buildClient(legacy).homologar({ ...INPUT, rota: ROTA_NORMAL });
            throw new Error('expected throw');
        } catch (err) {
            const e = err as HomologacaoRejeitadaError;
            expect(e).toBeInstanceOf(HomologacaoRejeitadaError);
            expect(e.details.motivo).toBe('upstream');
            expect(e.retryable).toBe(false);
        }
    });
});
