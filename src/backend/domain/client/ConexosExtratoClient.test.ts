import 'reflect-metadata';
import ExtratoTruncadoError from '../errors/ExtratoTruncadoError.js';
import ConexosBaseClient, { type LegacyConexosShape } from './ConexosBaseClient.js';
import ConexosExtratoClient, { EXI_VLD_TIPO } from './ConexosExtratoClient.js';

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

/** Constrói o client sobre um `ConexosBaseClient` REAL — assim os testes exercitam
 *  o `paginate` de verdade e conseguem asserir o body enviado ao Conexos. */
const build = () => {
    const legacy = buildLegacy();
    const base = new ConexosBaseClient(legacy);
    return { legacy, base, client: new ConexosExtratoClient(base) };
};

/** Row mínima e válida do `fin095` (formato real capturado em produção). */
const linhaCredito = (over: Record<string, unknown> = {}) => ({
    extCod: 137,
    exiCodSeq: 128,
    exiDtaLcto: 1768435200000,
    exiVldTipo: 2,
    exiMnyLcto: 791824.74,
    exiEspNrdocto: '20260115128',
    exiEspHistorico: 'SISPAG  BELLIZ INDUSTRIA',
    exiEspCategoria: '299',
    exiEspCategoriaDesc: 'CRÉDITO DESCONHECIDO',
    exiMnyLctoCr: null,
    exiMnyLctoDeb: null,
    exiEspLinha: null,
    vldConciliado: null,
    ...over,
});

describe('ConexosExtratoClient.listContas', () => {
    it('mapeia as contas do fin133 e preserva gerNum/gerDes', async () => {
        const { legacy, client } = build();
        legacy.listGenericPaginated.mockResolvedValue({
            count: 2,
            rows: [
                { gerNum: 38, gerDes: 'BANCO ITAÚ - AG. 0641 CONTA 55.795-4', qtdeBanco: 27 },
                { gerNum: 212, gerDes: 'BANCO BRASIL - AG. 1913 CONTA 105773-1', qtdeBanco: 29 },
            ],
        });

        const contas = await client.listContas(1);

        expect(contas).toHaveLength(2);
        expect(contas[0]).toMatchObject({
            gerNum: 38,
            gerDes: 'BANCO ITAÚ - AG. 0641 CONTA 55.795-4',
            qtdeBanco: 27,
        });
        expect(legacy.listGenericPaginated).toHaveBeenCalledWith(
            'fin133/list',
            expect.objectContaining({ serviceName: 'fin133', filterList: {} }),
            { filCod: 1 },
        );
    });

    it('descarta conta sem gerNum utilizável em vez de coalescer para zero', async () => {
        const { legacy, client } = build();
        legacy.listGenericPaginated.mockResolvedValue({
            count: 2,
            rows: [{ gerNum: 38, gerDes: 'ok' }, { gerDes: 'sem chave' }],
        });

        const contas = await client.listContas(1);

        expect(contas).toHaveLength(1);
        expect(contas[0].gerNum).toBe(38);
    });
});

describe('ConexosExtratoClient.listLancamentos', () => {
    it('envia gerNum, o range de data em epoch-ms e o tipo CRÉDITO por default', async () => {
        const { legacy, client } = build();
        const de = new Date('2026-05-01T00:00:00.000Z');
        const ate = new Date('2026-07-30T00:00:00.000Z');

        await client.listLancamentos({ filCod: 1, gerNum: 38, de, ate });

        expect(legacy.listGenericPaginated).toHaveBeenCalledWith(
            'fin095/list',
            expect.objectContaining({
                serviceName: 'fin095',
                filterList: {
                    gerNum: 38,
                    exiVldTipo: EXI_VLD_TIPO.CREDITO,
                    'exiDtaLcto#GE': de.getTime(),
                    'exiDtaLcto#LE': ate.getTime(),
                },
            }),
            { filCod: 1 },
        );
    });

    it('permite trazer todos os tipos quando exiVldTipo é undefined explícito', async () => {
        const { legacy, client } = build();

        await client.listLancamentos({
            filCod: 1,
            gerNum: 38,
            de: new Date(0),
            ate: new Date(1),
            exiVldTipo: undefined,
        });

        const body = legacy.listGenericPaginated.mock.calls[0][1] as {
            filterList: Record<string, unknown>;
        };
        expect(body.filterList).not.toHaveProperty('exiVldTipo');
    });

    it('mapeia um crédito real preservando identidade, valor e histórico bruto', async () => {
        const { legacy, client } = build();
        legacy.listGenericPaginated.mockResolvedValue({ count: 1, rows: [linhaCredito()] });

        const [l] = await client.listLancamentos({
            filCod: 1,
            gerNum: 38,
            de: new Date(0),
            ate: new Date(),
        });

        expect(l).toMatchObject({
            extCod: '137',
            exiCodSeq: '128',
            gerNum: 38,
            filCod: 1,
            tipo: 'CREDITO',
            valor: 791824.74,
            historico: 'SISPAG  BELLIZ INDUSTRIA',
            numeroDocumento: '20260115128',
            conciliadoNoErp: false,
        });
        // `gerNum`/`filCod` vêm do PARÂMETRO — a linha do ERP traz nulo.
        expect(l.raw).toEqual(linhaCredito());
    });

    it('usa exiMnyLctoDeb no débito e devolve valor sempre positivo', async () => {
        const { legacy, client } = build();
        legacy.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [linhaCredito({ exiVldTipo: 1, exiMnyLcto: -7987.02, exiMnyLctoDeb: -7987.02 })],
        });

        const [l] = await client.listLancamentos({
            filCod: 1,
            gerNum: 38,
            de: new Date(0),
            ate: new Date(),
            exiVldTipo: undefined,
        });

        expect(l.tipo).toBe('DEBITO');
        expect(l.valor).toBe(7987.02);
    });

    it('descarta linha sem identidade e linha de valor zero', async () => {
        const { legacy, client } = build();
        legacy.listGenericPaginated.mockResolvedValue({
            count: 3,
            rows: [
                linhaCredito(),
                linhaCredito({ exiCodSeq: undefined }), // sem identidade
                linhaCredito({ exiCodSeq: 999, exiMnyLcto: 0 }), // sem valor conciliável
            ],
        });

        const lancamentos = await client.listLancamentos({
            filCod: 1,
            gerNum: 38,
            de: new Date(0),
            ate: new Date(),
        });

        expect(lancamentos).toHaveLength(1);
        expect(lancamentos[0].exiCodSeq).toBe('128');
    });

    it('lança ExtratoTruncadoError quando o paginate bate no teto de páginas', async () => {
        const { base, client } = build();
        // Simular 50 páginas cheias seria caríssimo — dispara o onCapHit direto.
        base.paginate = jest.fn(async ({ onCapHit }) => {
            onCapHit?.();
            return [];
        }) as typeof base.paginate;

        await expect(
            client.listLancamentos({ filCod: 1, gerNum: 38, de: new Date(0), ate: new Date() }),
        ).rejects.toBeInstanceOf(ExtratoTruncadoError);
    });
});
