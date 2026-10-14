import 'reflect-metadata';
import ConexosError from '../errors/ConexosError.js';
import RascunhoLeituraIncompletaError from '../errors/RascunhoLeituraIncompletaError.js';
import CodigoBarrasSintetico from '../libs/boleto/CodigoBarrasSintetico.js';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosSispagWriteClient from './ConexosSispagWriteClient.js';
import fixture from './__fixtures__/2026-10-14-fin015-vinculo-codbar.json';

const buildBase = () => ({
    ensureSid: jest.fn().mockResolvedValue(undefined),
    postGenericOnce: jest.fn(),
    putGenericOnce: jest.fn(),
    deleteGeneric: jest.fn(),
    getGeneric: jest.fn(),
    listGenericPaginated: jest.fn(),
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
});
const buildLog = () => {
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    return log as typeof log & import('../service/LogService.js').default;
};
const make = (base: ReturnType<typeof buildBase>, log = buildLog()) =>
    new ConexosSispagWriteClient(base as unknown as ConexosBaseClient, log);

const LINHA = CodigoBarrasSintetico.linhaDigitavel({ valor: 1028.8, vencimento: '2026-10-20' });
const VENC = Date.UTC(2026, 9, 20);
const rejeicao = (key: string) => ({
    response: { status: 400, data: { type: 'VALIDATION_LIST', messages: [{ key, vars: {} }] } },
});

describe('ConexosSispagWriteClient — vínculo do código de barras (ADR-0071)', () => {
    describe('validarCodigoBarras', () => {
        it('POST validacao/codigoBarras com o corpo do contrato; devolve split, valor e data', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue(fixture.validacao);
            const r = await make(base).validarCodigoBarras({
                filCod: 2,
                bncCod: 4,
                codigo: LINHA,
                valorLiquido: 1028.8,
                vencimento: VENC,
                modalidade: 6,
            });
            expect(base.postGenericOnce).toHaveBeenCalledTimes(1);
            const [path, body, opts] = base.postGenericOnce.mock.calls[0];
            expect(path).toBe('fin015/finItemSispag/validacao/codigoBarras');
            expect(opts).toEqual({ filCod: 2 });
            expect(body).toEqual({
                bncCodLote: 4,
                itsNumCodbar: LINHA,
                itsVldModalidade: 6,
                titDtaVencimento: VENC,
                titMnyLiquido: 1028.8,
                titMnyJuros: 0,
                titMnyDesconto: 0,
                itsMnyVlrPgto: 1028.8,
            });
            expect(r.barraVlrPgto).toBe(1028.8);
            expect(r.barraDtaVencimento).toBe(1792800000000);
            expect(r.splitCodBar).toEqual(fixture.validacao.responseData.splitCodBar);
        });

        it('aceita a resposta sem o envelope responseData', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue(fixture.validacao.responseData);
            const r = await make(base).validarCodigoBarras({
                filCod: 2,
                bncCod: 4,
                codigo: LINHA,
                valorLiquido: 1,
                vencimento: VENC,
                modalidade: 6,
            });
            expect(r.barraVlrPgto).toBe(1028.8);
        });

        it('SUCESSO com DV corrompido NÃO é validade: o client só decodifica (HML #3)', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({
                responseData: { ...fixture.validacao.responseData, barraVlrPgto: 89012340 },
            });
            const ruim = CodigoBarrasSintetico.corrompido(
                CodigoBarrasSintetico.barras({ valor: 1028.8, vencimento: '2026-10-20' }),
            );
            const r = await make(base).validarCodigoBarras({
                filCod: 2,
                bncCod: 4,
                codigo: ruim,
                valorLiquido: 1028.8,
                vencimento: VENC,
                modalidade: 6,
            });
            // Devolve o que o ERP decodificou, sem o julgar: quem decide é a elegibilidade.
            expect(r.barraVlrPgto).toBe(89012340);
        });

        it('contrato sem os campos da barra ⇒ erro de contrato, nunca default', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({ responseData: { splitCodBar: {} } });
            await expect(
                make(base).validarCodigoBarras({
                    filCod: 2,
                    bncCod: 4,
                    codigo: LINHA,
                    valorLiquido: 1,
                    vencimento: VENC,
                    modalidade: 6,
                }),
            ).rejects.toBeInstanceOf(ConexosError);
        });

        it('recusa de negócio (4xx) é CONEXOS_UPSTREAM_REJECTED, distinguível de timeout', async () => {
            const base = buildBase();
            base.postGenericOnce.mockRejectedValue(rejeicao('FIN_015.CODIGO_BARRA_INVALIDO'));
            const e = await make(base)
                .validarCodigoBarras({
                    filCod: 2,
                    bncCod: 4,
                    codigo: '123',
                    valorLiquido: 1,
                    vencimento: VENC,
                    modalidade: 6,
                })
                .catch((x) => x);
            expect(e).toBeInstanceOf(ConexosError);
            expect((e as ConexosError).code).toBe('CONEXOS_UPSTREAM_REJECTED');
        });

        it('timeout/5xx não é recusa de negócio', async () => {
            const base = buildBase();
            base.postGenericOnce.mockRejectedValue({ response: { status: 503, data: {} } });
            const e = await make(base)
                .validarCodigoBarras({
                    filCod: 2,
                    bncCod: 4,
                    codigo: LINHA,
                    valorLiquido: 1,
                    vencimento: VENC,
                    modalidade: 6,
                })
                .catch((x) => x);
            expect((e as ConexosError).code).not.toBe('CONEXOS_UPSTREAM_REJECTED');
        });
    });

    describe('confirmarCodigoBarras', () => {
        it('reenvia o splitCodBar da etapa anterior e devolve os quatro campos *Result', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue(fixture.confirma);
            const v = {
                splitCodBar: fixture.validacao.responseData.splitCodBar,
                barraVlrPgto: 1028.8,
                barraDtaVencimento: 1792800000000,
            };
            const r = await make(base).confirmarCodigoBarras({
                filCod: 2,
                bncCod: 4,
                codigo: LINHA,
                valorLiquido: 1028.8,
                vencimento: VENC,
                modalidade: 6,
                validacao: v,
            });
            const [path, body] = base.postGenericOnce.mock.calls[0];
            expect(path).toBe('fin015/finItemSispag/validacao/confirmaCodigoBarras');
            expect(body).toMatchObject({
                bncCodLote: 4,
                itsNumCodbar: LINHA,
                splitCodBar: v.splitCodBar,
                barraDtaVencimento: v.barraDtaVencimento,
                barraVlrPgto: v.barraVlrPgto,
                titMnyJuros: 0,
                titMnyDesconto: 0,
            });
            expect(r).toEqual({
                itsMnyVlrPgtoResult: 1028.8,
                itsDtaPgtoResult: 1792800000000,
                itsBncNumCodbancoResult: 341,
                itsBncDesNomeResult: 'ITAU UNIBANCO S.A.',
            });
            // Escrita: tentativa única, nunca por runWithRetry.
            expect(base.runWithRetry).not.toHaveBeenCalled();
        });

        it('campo *Result ausente ⇒ erro de contrato, nunca default', async () => {
            const base = buildBase();
            const { itsBncDesNomeResult: _n, ...incompleto } = fixture.confirma;
            base.postGenericOnce.mockResolvedValue(incompleto);
            await expect(
                make(base).confirmarCodigoBarras({
                    filCod: 2,
                    bncCod: 4,
                    codigo: LINHA,
                    valorLiquido: 1,
                    vencimento: VENC,
                    modalidade: 6,
                    validacao: { splitCodBar: {}, barraVlrPgto: 1, barraDtaVencimento: VENC },
                }),
            ).rejects.toBeInstanceOf(ConexosError);
        });
    });

    describe('lerItemDoRascunho / lerItensDoRascunho', () => {
        const pagina = (rows: unknown[], count = rows.length) => ({ rows, count });

        it('devolve a row COMPLETA do item pelo itsCodSeq (passthrough)', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue(
                pagina([{ ...fixture.item, itsCodSeq: 90 }, fixture.item]),
            );
            const item = await make(base).lerItemDoRascunho({
                filCod: 2,
                bncCod: 4,
                flpCod: 36,
                itsCodSeq: 91,
            });
            expect(item).toEqual(fixture.item);
            expect(base.listGenericPaginated.mock.calls[0][0]).toBe(
                'fin015/finItemSispag/list/2/4/36',
            );
        });

        it('item ausente numa leitura COMPLETA ⇒ undefined, não lança', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue(pagina([fixture.item]));
            await expect(
                make(base).lerItemDoRascunho({ filCod: 2, bncCod: 4, flpCod: 36, itsCodSeq: 5 }),
            ).resolves.toBeUndefined();
        });

        it('leitura INCOMPLETA é erro distinguível de "ausente"', async () => {
            const base = buildBase();
            // 500 linhas por página e `count` maior: o limite de páginas estoura antes do fim.
            const cheia = Array.from({ length: 500 }, (_v, i) => ({
                ...fixture.item,
                itsCodSeq: i,
            }));
            base.listGenericPaginated.mockResolvedValue({ rows: cheia, count: 99999 });
            await expect(
                make(base).lerItemDoRascunho({
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 36,
                    itsCodSeq: 100000,
                }),
            ).rejects.toBeInstanceOf(RascunhoLeituraIncompletaError);
        });

        it('lerItensDoRascunho: chave com filial e itsCodSeq validado', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue(
                pagina([
                    { ...fixture.item, itsCodSeq: '12' },
                    { ...fixture.item, itsCodSeq: null },
                ]),
            );
            const r = await make(base).lerItensDoRascunho({ filCod: 2, bncCod: 4, flpCod: 36 });
            expect(r.completa).toBe(true);
            expect(r.itens[0]).toMatchObject({
                filCod: 2,
                docCod: '636',
                titCod: '1',
                itsCodSeq: 12,
            });
            expect(r.itens[1]).not.toHaveProperty('itsCodSeq');
        });
    });

    describe('editarItemDoRascunho', () => {
        const alteracoes = {
            itsNumCodbar: LINHA,
            itsNumBanco: 341,
            bncDesNome: 'ITAU UNIBANCO S.A.',
            itsMnyVlrPgto: 1028.8,
            itsDtaPgto: 1792800000000,
        };

        it('PUT fin015/finItemSispag, tentativa única, header = filial do lote', async () => {
            const base = buildBase();
            base.putGenericOnce.mockResolvedValue({});
            await make(base).editarItemDoRascunho({
                filCod: 2,
                bncCod: 4,
                flpCod: 36,
                item: fixture.item,
                alteracoes,
            });
            expect(base.putGenericOnce).toHaveBeenCalledTimes(1);
            const [path, , opts] = base.putGenericOnce.mock.calls[0];
            expect(path).toBe('fin015/finItemSispag');
            expect(opts).toEqual({ filCod: 2 });
            expect(base.runWithRetry).not.toHaveBeenCalled();
        });

        it('o corpo é o item LIDO com EXATAMENTE os 5 campos alterados', async () => {
            const base = buildBase();
            base.putGenericOnce.mockResolvedValue({});
            await make(base).editarItemDoRascunho({
                filCod: 2,
                bncCod: 4,
                flpCod: 36,
                item: fixture.item,
                alteracoes: {
                    ...alteracoes,
                    itsNumBanco: 237,
                    itsMnyVlrPgto: 999.9,
                    itsDtaPgto: 1792900000000,
                },
            });
            const corpo = base.putGenericOnce.mock.calls[0][1] as Record<string, unknown>;
            const original = fixture.item as Record<string, unknown>;
            const alterados = Object.keys(corpo).filter(
                (k) => JSON.stringify(original[k]) !== JSON.stringify(corpo[k]),
            );
            expect(alterados.sort()).toEqual(
                ['bncDesNome', 'itsDtaPgto', 'itsMnyVlrPgto', 'itsNumBanco', 'itsNumCodbar'].sort(),
            );
            // Nenhuma chave nova, nenhuma removida.
            expect(Object.keys(corpo).sort()).toEqual(Object.keys(original).sort());
        });

        it('falha vira ConexosError e nenhum código longo aparece na mensagem, log ou details', async () => {
            const base = buildBase();
            const log = buildLog();
            base.putGenericOnce.mockRejectedValue(new Error(`boom ${LINHA}`));
            const erro = await make(base, log)
                .editarItemDoRascunho({
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 36,
                    item: fixture.item,
                    alteracoes,
                })
                .catch((e) => e);
            expect(erro).toBeInstanceOf(ConexosError);
            const tudo = JSON.stringify([
                (erro as Error).message,
                (erro as ConexosError).userMessage,
                (erro as ConexosError).details,
                String(((erro as ConexosError).cause as Error | undefined)?.message ?? ''),
                log.warn.mock.calls,
                log.info.mock.calls,
                log.error.mock.calls,
            ]);
            expect(tudo).not.toMatch(/\d{20,}/);
        });
    });

    describe('listarLinhasDigitaveisDoLote — identidade dos itens SEM código', () => {
        it('devolve `semCodigo` com a identidade (nunca o código) dos itens ainda sem boleto', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                rows: [
                    { ...fixture.item, itsNumCodbar: LINHA, docCod: 1, itsCodSeq: 1 },
                    { ...fixture.item, itsNumCodbar: null, docCod: 2, itsCodSeq: 2 },
                    { ...fixture.item, itsNumCodbar: '', docCod: 3, itsCodSeq: null },
                ],
            });
            const r = await make(base).listarLinhasDigitaveisDoLote({
                filCod: 2,
                bncCod: 4,
                flpCod: 36,
            });
            expect(r.total).toBe(1);
            // Sem `itsCodSeq` não há como apagar: o item não entra (a guarda já aborta por isso).
            expect(r.semCodigo).toEqual([{ docCod: '2', titCod: '1', filCod: 2, itsCodSeq: 2 }]);
        });
    });
});
