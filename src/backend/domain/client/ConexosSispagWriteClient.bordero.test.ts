import 'reflect-metadata';
import ConexosError from '../errors/ConexosError.js';
import ConexosWriteDisabledError from '../errors/ConexosWriteDisabledError.js';
import ErpPerguntaError from '../errors/ErpPerguntaError.js';
import RascunhoLeituraIncompletaError from '../errors/RascunhoLeituraIncompletaError.js';
import type EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import type LogService from '../service/LogService.js';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosSispagWriteClient from './ConexosSispagWriteClient.js';

/**
 * `ConexosSispagWriteClient` — borderô de grupo no `fin015` (ADR-0077, Task 7). Fixtures com a
 * forma medida em HML em 2026-10-20 (achados T1/T5/T6): linha de `borderosPendentes/list` do
 * borderô 253 e o item de borderô no rascunho do lote 51 (sem `docCod/titCod`).
 */

const buildBase = () => ({
    ensureSid: jest.fn().mockResolvedValue(undefined),
    postGenericOnce: jest.fn().mockResolvedValue({ messages: [{ valid: 'SUCESSO' }] }),
    deleteGeneric: jest.fn().mockResolvedValue(undefined),
    getGeneric: jest.fn(),
    listGenericPaginated: jest.fn().mockResolvedValue({ count: 0, rows: [] }),
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
});
const buildLog = () =>
    ({
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    }) as unknown as LogService;
const env = (over: Record<string, unknown> = {}) =>
    ({
        getEnvironmentVars: jest.fn(async () => ({ conexosWriteEnabled: true, ...over })),
    }) as unknown as EnvironmentProvider;

const make = (base = buildBase(), ...e: [EnvironmentProvider?]) => ({
    base,
    client: new ConexosSispagWriteClient(
        base as unknown as ConexosBaseClient,
        buildLog(),
        e.length > 0 ? e[0] : env(),
    ),
});

/** Linha real de `borderosPendentes/list/2/4/51` (HML, eco das 13 chaves). */
const PENDENTE_253 = {
    filCod: 2,
    borVldTipo: 2,
    borDtaMvto: 1792627200000,
    borCod: 253,
    gerNum: 38,
    pesCodCont: 1147,
    pesCod: 1147,
    dpeNomPessoa: 'DHL GLOBAL FORWARDING (BRAZIL) LOGISTICS LTDA.',
    vlrPrincipal: 682,
    vlrTotal: 682,
    juros: 0,
    desconto: 0,
    itemy: 0,
};

/** Item de borderô no rascunho do lote 51 (nasce modalidade 4, valor 682; sem docCod/titCod). */
const ITEM_BORDERO_253 = {
    filCod: 2,
    bncCod: 4,
    flpCod: 51,
    itsCodSeq: 1,
    borCod: 253,
    borVldTipo: 2,
    docTip: null,
    docCod: null,
    titCod: null,
    itsMnyValor: 682,
    itsVldModalidade: 4,
};

const ITEM_TITULO = {
    filCod: 2,
    bncCod: 4,
    flpCod: 51,
    itsCodSeq: 2,
    borCod: null,
    docTip: 2,
    docCod: 571,
    titCod: 1,
    itsMnyValor: 1080.93,
    itsVldModalidade: 7,
};

describe('ConexosSispagWriteClient — borderô de grupo (ADR-0077)', () => {
    describe('listarBorderosPendentes', () => {
        it('lê o grid do lote (leitura com retry) e devolve a linha crua com o borCod', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [PENDENTE_253] });
            const r = await client.listarBorderosPendentes({ filCod: 2, bncCod: 4, flpCod: 51 });
            const [endpoint, body, opts] = base.listGenericPaginated.mock.calls[0];
            expect(endpoint).toBe('fin015/finItemSispag/borderosPendentes/list/2/4/51');
            expect(body).toMatchObject({ serviceName: 'fin015', pageNumber: 1 });
            expect(opts).toEqual({ filCod: 2 });
            expect(base.runWithRetry).toHaveBeenCalled();
            expect(r).toEqual([{ filCod: 2, borCod: 253, vlrTotal: 682, row: PENDENTE_253 }]);
        });

        it('linha sem borCod ⇒ erro de contrato (nunca "não pendente")', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ ...PENDENTE_253, borCod: null }],
            });
            await expect(
                client.listarBorderosPendentes({ filCod: 2, bncCod: 4, flpCod: 51 }),
            ).rejects.toBeInstanceOf(ConexosError);
        });

        it('grid maior que a varredura ⇒ erro (nunca conclui ausência de lista truncada)', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 10_000,
                rows: Array.from({ length: 200 }, (_, i) => ({ ...PENDENTE_253, borCod: i + 1 })),
            });
            await expect(
                client.listarBorderosPendentes({ filCod: 2, bncCod: 4, flpCod: 51, maxPaginas: 2 }),
            ).rejects.toBeInstanceOf(ConexosError);
        });
    });

    describe('importarBorderoPendente', () => {
        const params = {
            linha: { filCod: 2, borCod: 253, vlrTotal: 682, row: PENDENTE_253 },
            filCodLote: 2,
            bncCod: 4,
            flpCod: 51,
            bncCodFin015: 4,
        };

        it('força itemy 1 e op 1 sobre a linha lida (itemy 0) e usa tentativa única', async () => {
            const { base, client } = make();
            await client.importarBorderoPendente(params);
            expect(base.postGenericOnce).toHaveBeenCalledWith(
                'fin015/finItemSispag/borderosPendentes/importar',
                {
                    items: [
                        {
                            ...PENDENTE_253,
                            filCodLote: 2,
                            bncCod: 4,
                            flpCod: 51,
                            itemy: 1,
                            op: 1,
                            bncCodFin015: 4,
                        },
                    ],
                    op: 1,
                    bncCodFin015: 4,
                },
                { filCod: 2 },
            );
        });

        it('a resposta não é prova: devolve void mesmo com SUCESSO (o serviço relê o rascunho)', async () => {
            const { client } = make();
            await expect(client.importarBorderoPendente(params)).resolves.toBeUndefined();
        });

        it('pergunta do ERP ⇒ ErpPerguntaError (nunca auto-respondida)', async () => {
            const { base, client } = make();
            base.postGenericOnce.mockRejectedValue({
                response: {
                    status: 400,
                    data: {
                        type: 'QUESTION',
                        questions: [{ id: 'q1', key: 'FIN_041.QUALQUER_COISA' }],
                    },
                },
            });
            await expect(client.importarBorderoPendente(params)).rejects.toBeInstanceOf(
                ErpPerguntaError,
            );
            expect(base.postGenericOnce).toHaveBeenCalledTimes(1);
        });

        it('escrita desligada (ou sem EnvironmentProvider) ⇒ ConexosWriteDisabledError antes de qualquer chamada', async () => {
            for (const e of [env({ conexosWriteEnabled: false }), undefined]) {
                const { base, client } = make(buildBase(), e);
                await expect(client.importarBorderoPendente(params)).rejects.toBeInstanceOf(
                    ConexosWriteDisabledError,
                );
                expect(base.ensureSid).not.toHaveBeenCalled();
                expect(base.postGenericOnce).not.toHaveBeenCalled();
            }
        });
    });

    describe('listarChavesDoLote e lerItensDoRascunho reconhecem o item de borderô', () => {
        it('linha com borCod e sem docCod vira "{fil}:bor:{borCod}" (nunca "{fil}::1")', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [ITEM_BORDERO_253, ITEM_TITULO],
            });
            const chaves = await client.listarChavesDoLote({ filCod: 2, bncCod: 4, flpCod: 51 });
            expect(chaves).toEqual(new Set(['2:bor:253', '2:571:1']));
        });

        it('item de borderô ganha borCod; item de título fica igual', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [ITEM_BORDERO_253, ITEM_TITULO],
            });
            const { itens, completa } = await client.lerItensDoRascunho({
                filCod: 2,
                bncCod: 4,
                flpCod: 51,
            });
            expect(completa).toBe(true);
            expect(itens[0]).toEqual({
                filCod: 2,
                docCod: '',
                titCod: '1',
                itsCodSeq: 1,
                borCod: 253,
                row: ITEM_BORDERO_253,
            });
            expect(itens[1]).toEqual({
                filCod: 2,
                docCod: '571',
                titCod: '1',
                itsCodSeq: 2,
                row: ITEM_TITULO,
            });
        });
    });

    describe('lerItemDeBordero', () => {
        it('devolve o item com o borCod: itsCodSeq, itsMnyValor e modalidade', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [ITEM_TITULO, ITEM_BORDERO_253],
            });
            const item = await client.lerItemDeBordero({
                filCod: 2,
                bncCod: 4,
                flpCod: 51,
                borCod: 253,
            });
            expect(item).toEqual({
                filCod: 2,
                borCod: 253,
                itsCodSeq: 1,
                itsMnyValor: 682,
                itsVldModalidade: 4,
                row: ITEM_BORDERO_253,
            });
        });

        it('ausente numa leitura COMPLETA ⇒ undefined', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [ITEM_TITULO] });
            await expect(
                client.lerItemDeBordero({ filCod: 2, bncCod: 4, flpCod: 51, borCod: 253 }),
            ).resolves.toBeUndefined();
        });

        it('leitura incompleta sem o item ⇒ RascunhoLeituraIncompletaError (nunca "ausente")', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 5000,
                rows: Array.from({ length: 500 }, (_, i) => ({ ...ITEM_TITULO, itsCodSeq: i + 2 })),
            });
            await expect(
                client.lerItemDeBordero({
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 51,
                    borCod: 253,
                    maxPaginas: 1,
                }),
            ).rejects.toBeInstanceOf(RascunhoLeituraIncompletaError);
        });

        it('item achado sem itsCodSeq ou sem valor ⇒ RascunhoLeituraIncompletaError (identidade incompleta)', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ ...ITEM_BORDERO_253, itsCodSeq: null }],
            });
            await expect(
                client.lerItemDeBordero({ filCod: 2, bncCod: 4, flpCod: 51, borCod: 253 }),
            ).rejects.toBeInstanceOf(RascunhoLeituraIncompletaError);
        });
    });

    describe('listarLinhasDigitaveisDoLote lê o item de borderô à parte (guarda I16, Task 17)', () => {
        // Linha digitável SINTÉTICA, com os verificadores corretos.
        const LINHA_OK = '00191234546789012345767890123457199990000012345';
        const DV_RUIM = '00191234546789012345867890123457199990000012345';

        it('item de borderô com barra vai em `itensDeBordero` (borCod, itsCodSeq, linha), nunca em `itens` nem em `invalidos`', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [{ ...ITEM_BORDERO_253, itsNumCodbar: LINHA_OK }, ITEM_TITULO],
            });
            const r = await client.listarLinhasDigitaveisDoLote({
                filCod: 2,
                bncCod: 4,
                flpCod: 51,
            });
            expect(r.itensDeBordero).toEqual([
                { filCod: 2, borCod: 253, itsCodSeq: 1, linhaDigitavel: LINHA_OK },
            ]);
            expect(r.itens.map((i) => i.docCod)).not.toContain('');
            expect(r.invalidos ?? []).toEqual([]);
            expect(r.semCodigo?.some((i) => i.docCod === '') ?? false).toBe(false);
            expect(r.completa).toBe(true);
        });

        it('item de borderô SEM barra entra em `itensDeBordero` sem linha (a guarda aborta como CODIGO_AUSENTE)', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ ...ITEM_BORDERO_253, itsNumCodbar: null }],
            });
            const r = await client.listarLinhasDigitaveisDoLote({
                filCod: 2,
                bncCod: 4,
                flpCod: 51,
            });
            expect(r.itensDeBordero).toEqual([{ filCod: 2, borCod: 253, itsCodSeq: 1 }]);
            expect(r.itens).toEqual([]);
        });

        it('barra com dígito verificador errado no item de borderô ⇒ `invalido`, sem a linha (I16e)', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ ...ITEM_BORDERO_253, itsNumCodbar: DV_RUIM }],
            });
            const r = await client.listarLinhasDigitaveisDoLote({
                filCod: 2,
                bncCod: 4,
                flpCod: 51,
            });
            expect(r.itensDeBordero).toEqual([
                { filCod: 2, borCod: 253, itsCodSeq: 1, invalido: true },
            ]);
            expect(JSON.stringify(r)).not.toContain(DV_RUIM);
        });

        it('lote sem item de borderô: `itensDeBordero` ausente (paridade com o que existia)', async () => {
            const { base, client } = make();
            base.listGenericPaginated.mockResolvedValue({ count: 1, rows: [ITEM_TITULO] });
            const r = await client.listarLinhasDigitaveisDoLote({
                filCod: 2,
                bncCod: 4,
                flpCod: 51,
            });
            expect(r).not.toHaveProperty('itensDeBordero');
        });
    });
});
