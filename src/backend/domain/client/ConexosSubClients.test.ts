import 'reflect-metadata';
import ConexosError from '../errors/ConexosError.js';
import ConexosBaixaClient from './ConexosBaixaClient.js';
import ConexosBaseClient, { type LegacyConexosShape } from './ConexosBaseClient.js';
import ConexosCadastroClient from './ConexosCadastroClient.js';
import ConexosFinanceiroClient from './ConexosFinanceiroClient.js';
import ConexosTitulosClient, { siglaMoedaNegociada } from './ConexosTitulosClient.js';

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

/**
 * CC-2 split: `ConexosClient` was broken into a shared `ConexosBaseClient`
 * plus four per-family sub-clients. This suite still exercises the SAME
 * behaviour, so it builds every sub-client over one shared base and merges
 * their public (arrow-bound) methods into a single facade — each method keeps
 * the `this` of its owning instance, so calls behave identically to before.
 */
/** Public method shape of a sub-client (drops the private `base`, so the
 * four shapes can be intersected without collapsing to `never`). */
type PublicShape<T> = { [K in keyof T]: T[K] };

const buildClient = (legacy: LegacyConexosShape) => {
    const base = new ConexosBaseClient(legacy);
    return Object.assign(
        Object.create(null),
        new ConexosCadastroClient(base),
        new ConexosFinanceiroClient(base),
        new ConexosTitulosClient(base),
        new ConexosBaixaClient(base),
    ) as PublicShape<ConexosCadastroClient> &
        PublicShape<ConexosFinanceiroClient> &
        PublicShape<ConexosTitulosClient> &
        PublicShape<ConexosBaixaClient>;
};

describe('siglaMoedaNegociada', () => {
    it('maps moedaCod 220 → USD (preferred over moedaNome)', () => {
        expect(siglaMoedaNegociada({ moedaCod: 220, moedaNome: 'IGNORED' })).toBe('USD');
    });

    it('maps moedaCod 1 → BRL', () => {
        expect(siglaMoedaNegociada({ moedaCod: 1 })).toBe('BRL');
    });

    it('falls back to moedaNome when moedaCod is unknown/absent', () => {
        expect(siglaMoedaNegociada({ moedaNome: 'DOLAR DOS EUA' })).toBe('DOLAR DOS EUA');
        expect(siglaMoedaNegociada({ moedaCod: 999, moedaNome: 'OUTRA' })).toBe('OUTRA');
    });

    it('defaults to BRL when neither code nor name is present', () => {
        expect(siglaMoedaNegociada({})).toBe('BRL');
    });

    it('returns undefined when there is no título at all', () => {
        expect(siglaMoedaNegociada(undefined)).toBeUndefined();
    });
});

describe('ConexosClient', () => {
    describe('listFinanceiroAPagar', () => {
        it('chunks priCods in batches of 50 and aggregates', async () => {
            const legacy = buildLegacy();
            const priCods = Array.from({ length: 120 }, (_, i) => `P${i + 1}`);
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [
                    {
                        docCod: 'D1',
                        priCod: 'P1',
                        dataEmissao: '2026-04-01',
                        valor: 1000,
                        moeda: 'USD',
                    },
                ],
            });
            const client = buildClient(legacy);

            const result = await client.listFinanceiroAPagar({
                priCods,
                docTip: 'INVOICE',
                filCod: 2,
            });

            // 120 / 50 = 3 chunks; each chunk's loop terminates on first short page
            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(3);
            expect(result.invoices).toHaveLength(3); // one row per chunk
            expect(result.proformas).toEqual([]);
        });

        it('listInvoicesFinalizadas: tpdCod=128 INVOICE + FINALIZADO, SEM priCod (universo completo)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ docCod: 'D9', priCod: 'P9', valor: 500, moeda: 'USD' }],
            });
            const client = buildClient(legacy);

            const result = await client.listInvoicesFinalizadas({ filCod: 2 });

            const body = legacy.listGenericPaginated.mock.calls[0][1] as Record<string, unknown>;
            const filterList = body.filterList as Record<string, unknown>;
            expect(filterList['tpdCod#EQ']).toBe(128);
            expect(filterList['priCod#IN']).toBeUndefined(); // sem filtro de processo
            expect(filterList['vldStatus#IN']).toBeDefined();
            expect(result.invoices).toHaveLength(1);
            expect(result.invoices[0]).toMatchObject({ docCod: 'D9', priCod: 'P9' });
        });

        it('sends tpdCod#EQ=99 filter for PROFORMA', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await client.listFinanceiroAPagar({
                priCods: ['P1', 'P2'],
                docTip: 'PROFORMA',
                filCod: 2,
            });

            const body = legacy.listGenericPaginated.mock.calls[0][1] as Record<string, unknown>;
            const filterList = body.filterList as Record<string, unknown>;
            expect(filterList['tpdCod#EQ']).toBe(99);
            expect(filterList['priCod#IN']).toEqual(['P1', 'P2']);
        });

        it('sends tpdCod#EQ=128 filter for INVOICE', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await client.listFinanceiroAPagar({
                priCods: ['P1'],
                docTip: 'INVOICE',
                filCod: 2,
            });

            const body = legacy.listGenericPaginated.mock.calls[0][1] as Record<string, unknown>;
            const filterList = body.filterList as Record<string, unknown>;
            expect(filterList['tpdCod#EQ']).toBe(128);
        });

        it('maps docMnyValor → valor and dpeNomPessoa → exportador, extracts pago from mnyTitAberto', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [
                    {
                        docCod: 5974,
                        priCod: 1153,
                        docDtaEmissao: 1767571200000,
                        docMnyValor: 723094.81,
                        dpeNomPessoa: 'MLTI PRIVATE LIMITED',
                        mnyTitAberto: 0,
                    },
                    {
                        docCod: 5975,
                        priCod: 1154,
                        docDtaEmissao: 1767571200000,
                        docMnyValor: 100,
                        dpeNomPessoa: 'OTHER EXPORTER',
                        mnyTitAberto: 50,
                    },
                ],
            });
            const client = buildClient(legacy);

            const { invoices } = await client.listFinanceiroAPagar({
                priCods: ['1153', '1154'],
                docTip: 'INVOICE',
                filCod: 2,
            });

            expect(invoices).toHaveLength(2);
            expect(invoices[0]).toMatchObject({
                docCod: '5974',
                priCod: '1153',
                valor: 723094.81,
                exportador: 'MLTI PRIVATE LIMITED',
                pago: true,
            });
            expect(invoices[1].pago).toBe(false);
        });

        it('paginates within a chunk until a short page is returned', async () => {
            const legacy = buildLegacy();
            const fullPage = Array.from({ length: 500 }, (_, i) => ({
                docCod: `D${i + 1}`,
                priCod: 'P1',
                docMnyValor: 1,
                dpeNomPessoa: 'EXP',
                mnyTitAberto: 0,
            }));
            const tailPage = Array.from({ length: 200 }, (_, i) => ({
                docCod: `D${500 + i + 1}`,
                priCod: 'P1',
                docMnyValor: 1,
                dpeNomPessoa: 'EXP',
                mnyTitAberto: 0,
            }));
            legacy.listGenericPaginated
                .mockResolvedValueOnce({ count: 700, rows: fullPage })
                .mockResolvedValueOnce({ count: 700, rows: tailPage });
            const client = buildClient(legacy);

            const { invoices } = await client.listFinanceiroAPagar({
                priCods: ['P1'],
                docTip: 'INVOICE',
                filCod: 2,
            });

            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(2);
            expect(invoices).toHaveLength(700);
            // pageNumber should advance.
            const firstBody = legacy.listGenericPaginated.mock.calls[0][1] as Record<
                string,
                unknown
            >;
            const secondBody = legacy.listGenericPaginated.mock.calls[1][1] as Record<
                string,
                unknown
            >;
            expect(firstBody.pageNumber).toBe(1);
            expect(secondBody.pageNumber).toBe(2);
            expect(firstBody.pageSize).toBe(500);
        });
    });

    describe('listBaixasTitulo (POST com308/financeiroAPagar/baixas/list)', () => {
        it('parses borDtaMvto and sends canonical filter body', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ borDtaMvto: '2026-04-15', bxaMnyLiquido: 500 }],
            });
            const client = buildClient(legacy);

            const out = await client.listBaixasTitulo({ docCod: 'D1', titCod: 'T1', filCod: 2 });
            expect(out).toHaveLength(1);
            expect(out[0].borDtaMvto).toBeInstanceOf(Date);
            expect(out[0].valor).toBe(500);

            // Empty body triggers Conexos 400 NotNull — must include filterList
            // borVldFinalizado and orderList.
            const [path, body, opts] = legacy.listGenericPaginated.mock.calls[0];
            expect(path).toBe('com308/financeiroAPagar/baixas/list/D1/T1/0');
            expect(body).toMatchObject({
                filterList: { 'borVldFinalizado#IN': [1] },
                orderList: { orderList: [{ propertyName: 'borCod', order: 'asc' }] },
            });
            expect(opts).toEqual({ filCod: 2 });
        });

        // Addendum 2026-06-08 #1 (vc-multi-titulo): `bxaMnyValor` (principal BRL
        // @ câmbio de contrato) é exposto como campo DEDICADO, independente do
        // coalesce `valor` (que prioriza o líquido). Insumo do saldo residual
        // sobre o principal. Wire row onde principal ≠ líquido (desconto).
        it('expõe bxaMnyValor (principal) independente de bxaMnyLiquido (líquido)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                // principal 1000; líquido 968 (= 1000 − R$32 de desconto).
                rows: [{ borDtaMvto: '2026-04-15', bxaMnyValor: 1000, bxaMnyLiquido: 968 }],
            });
            const client = buildClient(legacy);

            const out = await client.listBaixasTitulo({ docCod: 'D1', titCod: '7', filCod: 2 });
            expect(out).toHaveLength(1);
            // Campo dedicado = principal (1000), NÃO o líquido (968).
            expect(out[0].bxaMnyValor).toBe(1000);
            // `valor` legacy coalesce: na ausência de `valor`/`borVlrMvto`, cai
            // no líquido (968) — comportamento preservado p/ outros callers.
            expect(out[0].valor).toBe(968);

            // titCod arbitrário é forwarded no path (per-título, sem hardcode 1).
            const [path] = legacy.listGenericPaginated.mock.calls[0];
            expect(path).toBe('com308/financeiroAPagar/baixas/list/D1/7/0');
        });

        // Defensivo (watchlist Addendum 2026-06-08 #1): baixa com bxaMnyValor
        // ausente → default 0 (nunca soma null em pagoBRL).
        it('bxaMnyValor ausente → 0 (default defensivo)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ borDtaMvto: '2026-04-15', bxaMnyLiquido: 500 }],
            });
            const client = buildClient(legacy);

            const out = await client.listBaixasTitulo({ docCod: 'D1', titCod: '1', filCod: 2 });
            expect(out[0].bxaMnyValor).toBe(0);
        });
    });

    describe('listProcessos', () => {
        it('with no priCods sends canonical body shape and forwards filCod opt', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await client.listProcessos({ filCod: 7 });

            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(1);
            const [endpoint, body, opts] = legacy.listGenericPaginated.mock.calls[0];
            // The 1st arg is the URL path the adapter uses to build the
            // request (`/imp021/list`); the body-field `serviceName` is a
            // distinct request payload concern.
            expect(endpoint).toBe('imp021/list');

            // Canonical Conexos body shape for the imp021/list query.
            // pageNumber/pageSize injected by the paginate helper, not by callers.
            // v0.5: fieldList is now explicit so pesCod and priEspRefcliente
            // come back from imp021 (default `[]` was omitting them).
            // Addendum 2026-06-08 #2: `priVldTipo` added for the "Und. Negócio"
            // column of the Variação Cambial report.
            expect(body).toEqual({
                fieldList: [
                    'priCod',
                    'pesCod',
                    'priEspRefcliente',
                    'priVldTipo',
                    'dpeNomPessoa',
                    'priDtaAbertura',
                    'filCod',
                ],
                filterList: { 'priVldStatus#IN': ['1'] },
                pageNumber: 1,
                pageSize: 500,
                serviceName: 'imp021',
                orderList: { orderList: [{ propertyName: 'priCod', order: 'asc' }] },
            });

            // Bug 1 regression — filCod must NOT leak into the body.
            const bodyRecord = body as Record<string, unknown>;
            expect(bodyRecord.filCod).toBeUndefined();
            expect(bodyRecord.page).toBeUndefined();

            // Bug 2 regression — filCod must travel via opts to the adapter.
            expect(opts).toEqual({ filCod: 7 });
        });

        it('with no priCods paginates until a short page is returned', async () => {
            const legacy = buildLegacy();
            const fullPage = Array.from({ length: 500 }, (_, i) => ({ priCod: i + 1 }));
            const partialPage = Array.from({ length: 26 }, (_, i) => ({ priCod: 500 + i + 1 }));
            legacy.listGenericPaginated
                .mockResolvedValueOnce({ count: 526, rows: fullPage })
                .mockResolvedValueOnce({ count: 526, rows: partialPage });
            const client = buildClient(legacy);

            const out = await client.listProcessos({ filCod: 2 });

            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(2);
            expect(out).toHaveLength(526);
            const pageNumbers = legacy.listGenericPaginated.mock.calls.map(
                (call) => (call[1] as Record<string, unknown>).pageNumber,
            );
            expect(pageNumbers).toEqual([1, 2]);
        });

        it('with no priCods stops when accumulated rows reach reported count', async () => {
            const legacy = buildLegacy();
            // count=500 even though the server returns a full page → loop must stop
            // on the next iteration without making a third call (it makes a 2nd to
            // discover < pageSize OR count cap; whichever fires first ends loop).
            legacy.listGenericPaginated.mockResolvedValueOnce({
                count: 500,
                rows: Array.from({ length: 500 }, (_, i) => ({ priCod: i + 1 })),
            });
            const client = buildClient(legacy);

            const out = await client.listProcessos({ filCod: 2 });

            // Single call: rows.length === pageSize but accumulated >= count → stop.
            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(1);
            expect(out).toHaveLength(500);
        });

        it('with priCods chunks the batches and forwards filCod opt on every chunk', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);
            const priCods = Array.from({ length: 75 }, (_, i) => `P${i + 1}`);

            await client.listProcessos({ filCod: 3, priCods });

            // 75 / 50 = 2 chunks; each chunk paginates and stops on first empty page.
            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(2);
            for (const call of legacy.listGenericPaginated.mock.calls) {
                const [, , opts] = call;
                expect(opts).toEqual({ filCod: 3 });
            }
        });

        // imp021's row carries the cliente importador under the canonical
        // Conexos field `dpeNomPessoa` (verified against the legacy
        // `routes/processes.ts:24` mapping which ships in production today).
        // A literal `importador` key does not exist on imp021 — relying on
        // it leaves every linha with importador=undefined.
        it('maps dpeNomPessoa → importador when no literal importador field is present', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValueOnce({
                count: 1,
                rows: [
                    {
                        priCod: 1153,
                        dpeNomPessoa: 'COLUMBIA TRADING CLIENT XYZ',
                    },
                ],
            });
            const client = buildClient(legacy);

            const out = await client.listProcessos({ filCod: 2 });

            expect(out).toHaveLength(1);
            expect(out[0]).toMatchObject({
                priCod: '1153',
                importador: 'COLUMBIA TRADING CLIENT XYZ',
            });
        });

        it('prefers literal importador over dpeNomPessoa when both are present', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValueOnce({
                count: 1,
                rows: [
                    {
                        priCod: 1,
                        importador: 'EXPLICIT IMPORTER',
                        dpeNomPessoa: 'FALLBACK NAME',
                    },
                ],
            });
            const client = buildClient(legacy);

            const out = await client.listProcessos({ filCod: 2 });

            expect(out[0].importador).toBe('EXPLICIT IMPORTER');
        });

        it('leaves importador undefined when neither importador nor dpeNomPessoa is present', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValueOnce({
                count: 1,
                rows: [{ priCod: 9 }],
            });
            const client = buildClient(legacy);

            const out = await client.listProcessos({ filCod: 2 });

            expect(out[0].importador).toBeUndefined();
        });

        // v0.5 (G2): pesCod and priEspRefcliente must be mapped explicitly so
        // the `nf-saida-mesmo-pescod-do-processo` filter (G3) and the
        // canonical "Ref. Externa" column (G4) have the data they need.
        it('maps pesCod and priEspRefcliente from imp021 row (string-cast)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValueOnce({
                count: 1,
                rows: [
                    {
                        priCod: 1153,
                        pesCod: 1234,
                        priEspRefcliente: 'PO-2026-0042',
                        priVldTipo: 3,
                        dpeNomPessoa: 'IMPORTER A',
                    },
                ],
            });
            const client = buildClient(legacy);

            const out = await client.listProcessos({ filCod: 2 });

            expect(out[0]).toMatchObject({
                priCod: '1153',
                pesCod: '1234',
                priEspRefcliente: 'PO-2026-0042',
                // Addendum 2026-06-08 #2: priVldTipo coerced to number.
                priVldTipo: 3,
            });
        });

        it('leaves priEspRefcliente/priVldTipo undefined when missing from row, defaults pesCod to ""', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValueOnce({
                count: 1,
                rows: [{ priCod: 1 }], // no pesCod, no priEspRefcliente, no priVldTipo
            });
            const client = buildClient(legacy);

            const out = await client.listProcessos({ filCod: 2 });
            expect(out[0].pesCod).toBe('');
            expect(out[0].priEspRefcliente).toBeUndefined();
            expect(out[0].priVldTipo).toBeUndefined();
        });
    });

    describe('legacyConexosAdapter.listGeneric', () => {
        it('forwards filCod opt to the resolved session authenticatedPost', async () => {
            const authenticatedPost = jest.fn().mockResolvedValue({ rows: [] });
            // A sessão resolvida (robô ou usuário) expõe os métodos da ConexosService.
            const resolvedSession = {
                authenticatedPost,
                authenticatedGet: jest.fn().mockResolvedValue({ rows: [] }),
            } as unknown as import('../../services/conexos.js').ConexosService;

            const { buildLegacyConexosAdapter } = await import('./legacyConexosAdapter.js');
            const adapter = buildLegacyConexosAdapter(async () => resolvedSession);

            await adapter.listGeneric<unknown[]>('imp021/list', { fieldList: [] }, { filCod: 9 });

            expect(authenticatedPost).toHaveBeenCalledWith(
                '/imp021/list',
                { fieldList: [] },
                { filCod: 9 },
            );
        });
    });

    describe('FINALIZADO filter (vldStatus = 3)', () => {
        it("listFinanceiroAPagar sends vldStatus#IN: ['3'] in body", async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await client.listFinanceiroAPagar({
                priCods: ['P1'],
                docTip: 'INVOICE',
                filCod: 2,
            });

            const body = legacy.listGenericPaginated.mock.calls[0][1] as Record<string, unknown>;
            const filterList = body.filterList as Record<string, unknown>;
            expect(filterList['vldStatus#IN']).toEqual(['3']);
        });
    });

    describe('error handling', () => {
        it('retries failed call once then succeeds', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated
                .mockRejectedValueOnce(new Error('500'))
                .mockResolvedValueOnce({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await expect(client.listProcessos({ priCods: ['P1'], filCod: 2 })).resolves.toEqual([]);
            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(2);
        });

        it('wraps exhausted retry in ConexosError with endpoint info', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockRejectedValue(new Error('502'));
            const client = buildClient(legacy);

            try {
                await client.listProcessos({ priCods: ['P1'], filCod: 2 });
                fail('expected ConexosError');
            } catch (err) {
                expect(err).toBeInstanceOf(ConexosError);
                const ce = err as ConexosError;
                expect(ce.endpoint).toBe('imp021/list');
                expect(ce.priCod).toBe('P1');
            }
        });
    });

    // ------------------------------------------------------------------
    // parseDate timezone handling
    // ------------------------------------------------------------------
    // Conexos encodes dates as "midnight UTC of the calendar day in BR".
    // A naive `new Date(ms)` lands on 00:00 UTC, which renders as the
    // PREVIOUS day in BR (UTC-3). We shift numeric timestamps to 15:00 UTC
    // (= 12:00 BRT) so the wall-clock day matches the Conexos portal in
    // any timezone within UTC ± 12h, regardless of formatting locale.
    describe('parseDate (timezone-safe handling of Conexos timestamps)', () => {
        it('numeric timestamp 1768780800000 (Conexos "19/01/2026") parses to calendar day 19 in BR', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ borDtaMvto: 1768780800000, bxaMnyLiquido: 100 }],
            });
            const client = buildClient(legacy);

            const out = await client.listBaixasTitulo({
                docCod: 'D1',
                titCod: 'T1',
                filCod: 2,
            });

            const d = out[0].borDtaMvto;
            // BR wall-clock day must be 19 (matches Conexos portal display).
            expect(d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })).toBe(
                '19/01/2026',
            );
            // ISO slice should also report the same calendar day, not a day before.
            expect(d.toISOString().slice(0, 10)).toBe('2026-01-19');
        });

        it('numeric timestamp 1768521600000 (Conexos "16/01/2026") parses to calendar day 16 in BR', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ borDtaMvto: 1768521600000, bxaMnyLiquido: 100 }],
            });
            const client = buildClient(legacy);

            const out = await client.listBaixasTitulo({
                docCod: 'D1',
                titCod: 'T1',
                filCod: 2,
            });

            const d = out[0].borDtaMvto;
            expect(d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })).toBe(
                '16/01/2026',
            );
            expect(d.toISOString().slice(0, 10)).toBe('2026-01-16');
        });

        it('ISO date string is preserved as-is (no shift applied)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ borDtaMvto: '2026-04-15', bxaMnyLiquido: 100 }],
            });
            const client = buildClient(legacy);

            const out = await client.listBaixasTitulo({
                docCod: 'D1',
                titCod: 'T1',
                filCod: 2,
            });

            // Same string-based behavior preserved: ISO slice still reports
            // the encoded day. No shift applied to string inputs (they are
            // already calendar-day-anchored at UTC midnight).
            expect(out[0].borDtaMvto.toISOString().slice(0, 10)).toBe('2026-04-15');
        });

        it('Date instance passes through unchanged', async () => {
            const legacy = buildLegacy();
            const fixed = new Date('2026-07-04T10:30:00.000Z');
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ borDtaMvto: fixed, bxaMnyLiquido: 100 }],
            });
            const client = buildClient(legacy);

            const out = await client.listBaixasTitulo({
                docCod: 'D1',
                titCod: 'T1',
                filCod: 2,
            });

            expect(out[0].borDtaMvto.getTime()).toBe(fixed.getTime());
        });
    });

    // ──────────────────────────────────────────────────────────────────
    // AdiantamentoFinanceiro (v0.4 — `implantacao-saldo-financeiro`)
    //
    // Wire-field contract:
    //   - `tpdCod#EQ` numeric 143 (TPD_IMPLANTACAO_SALDO)
    //   - `gerNum#EQ` / `gerNum#IN`  (NOT `gerCod` — `FinDocCab` has no `gerCod`)
    //   - `vldStatus#IN ['3']`
    //
    // The 4 numeric IDs (143, 198, 210, 233) come from the empirical probe
    // documented in `ontology/_inbox/implantacao-saldo-financeiro-conexos-ids.md`.
    // ──────────────────────────────────────────────────────────────────

    describe('listAdiantamentoFinanceiroAPagar (com298, ADTO_FORN_INT débito)', () => {
        it('sends tpdCod#EQ 143 + gerNum#EQ 198 + vldStatus FINALIZADO', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await client.listAdiantamentoFinanceiroAPagar({
                priCods: ['1153'],
                filCod: 2,
            });

            const [path, body, opts] = legacy.listGenericPaginated.mock.calls[0];
            expect(path).toBe('com298/list');
            const filterList = (body as Record<string, unknown>).filterList as Record<
                string,
                unknown
            >;
            // Critical: numeric IDs (Conexos rejects string IDs on numeric columns).
            // Yuri 2026-05-12: com298 (débito) tem DOIS planos financeiros para
            // IMPLANTAÇÃO DE SALDO — ADTO_FORN_INT (198) e ADTO_CLIENTE_NAC
            // (233, lado débito). Filtro mudou de `gerNum#EQ 198` para
            // `gerNum#IN [198, 233]`.
            expect(filterList['tpdCod#EQ']).toBe(143);
            expect(filterList['gerNum#IN']).toEqual([198, 233]);
            expect(filterList['vldStatus#IN']).toEqual(['3']);
            expect(filterList['priCod#IN']).toEqual(['1153']);
            expect(opts).toEqual({ filCod: 2 });
        });

        it('maps com298 rows to AdiantamentoFinanceiro (débito + ADTO_FORN_INT)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [
                    {
                        docCod: 21291,
                        priCod: 1153,
                        docDtaEmissao: 1778112000000,
                        docMnyValor: 221265,
                        dpeNomPessoa: 'JINLING TRADE (HK) LIMITED',
                        gerNum: 198,
                        tpdCod: 143,
                        filCod: 2,
                        moeEspSigla: 'USD',
                    },
                    {
                        docCod: 21292,
                        priCod: 1153,
                        docDtaEmissao: 1778112000000,
                        docMnyValor: 10000,
                        dpeNomPessoa: 'OTHER FORN',
                        gerNum: 198,
                        tpdCod: 143,
                        filCod: 2,
                    },
                ],
            });
            const client = buildClient(legacy);

            const out = await client.listAdiantamentoFinanceiroAPagar({
                priCods: ['1153'],
                filCod: 2,
            });

            expect(out).toHaveLength(2);
            expect(out[0]).toMatchObject({
                direcao: 'debito',
                tipo: 'ADTO_FORN_INT',
                docCod: '21291',
                priCod: '1153',
                valor: 221265,
                moeda: 'USD',
                filCod: 2,
                vldStatus: '3',
                pessoa: 'JINLING TRADE (HK) LIMITED',
            });
            expect(out[0].dataBaixa).toBeUndefined();
            expect(out[1].moeda).toBe('BRL'); // fallback default
        });

        it('returns empty array when no rows', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            const out = await client.listAdiantamentoFinanceiroAPagar({
                priCods: ['1153'],
                filCod: 2,
            });
            expect(out).toEqual([]);
        });

        it('returns empty array (no Conexos call) when priCods is empty', async () => {
            const legacy = buildLegacy();
            const client = buildClient(legacy);

            const out = await client.listAdiantamentoFinanceiroAPagar({
                priCods: [],
                filCod: 2,
            });
            expect(out).toEqual([]);
            expect(legacy.listGenericPaginated).not.toHaveBeenCalled();
        });

        it('chunks priCods in batches of 50 and aggregates', async () => {
            const legacy = buildLegacy();
            const priCods = Array.from({ length: 75 }, (_, i) => `P${i + 1}`);
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await client.listAdiantamentoFinanceiroAPagar({ priCods, filCod: 2 });

            // 75 / 50 = 2 chunks (50 + 25).
            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(2);
        });
    });

    describe('listAdiantamentoFinanceiroAReceber (com299, ADTO_CLIENTE_* crédito)', () => {
        it('sends tpdCod#EQ 143 + gerNum#IN [210, 233] (numeric array) + FINALIZADO', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await client.listAdiantamentoFinanceiroAReceber({
                priCods: ['1153'],
                filCod: 2,
            });

            const [path, body] = legacy.listGenericPaginated.mock.calls[0];
            expect(path).toBe('com299/list');
            const filterList = (body as Record<string, unknown>).filterList as Record<
                string,
                unknown
            >;
            expect(filterList['tpdCod#EQ']).toBe(143);
            // Critical: numeric IN (no string IDs); Conexos rejects '210' on
            // numeric columns.
            expect(filterList['gerNum#IN']).toEqual([210, 233]);
            expect(filterList['vldStatus#IN']).toEqual(['3']);
        });

        it('maps com299 rows to crédito side discriminated by gerNum', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [
                    {
                        docCod: 5001,
                        priCod: 1153,
                        docDtaEmissao: 1778500000000,
                        docMnyValor: 89800,
                        gerNum: 210,
                        tpdCod: 143,
                        filCod: 2,
                        dpeNomPessoa: 'CLIENTE EXTERIOR',
                    },
                    {
                        docCod: 5002,
                        priCod: 1153,
                        docDtaEmissao: 1778500000000,
                        docMnyValor: 50000,
                        gerNum: 233,
                        tpdCod: 143,
                        filCod: 2,
                        dpeNomPessoa: 'CLIENTE NACIONAL',
                    },
                ],
            });
            const client = buildClient(legacy);

            const out = await client.listAdiantamentoFinanceiroAReceber({
                priCods: ['1153'],
                filCod: 2,
            });

            expect(out).toHaveLength(2);
            expect(out[0]).toMatchObject({
                direcao: 'credito',
                tipo: 'ADTO_CLIENTE_EXT',
                docCod: '5001',
                valor: 89800,
            });
            expect(out[1]).toMatchObject({
                direcao: 'credito',
                tipo: 'ADTO_CLIENTE_NAC',
                docCod: '5002',
                valor: 50000,
            });
        });

        it("drops rows with unrecognized gerNum (defensive — shouldn't happen given filter)", async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [
                    { docCod: 9001, priCod: 1, gerNum: 210, docMnyValor: 100 },
                    { docCod: 9002, priCod: 1, gerNum: 999, docMnyValor: 100 }, // unknown
                ],
            });
            const client = buildClient(legacy);

            const out = await client.listAdiantamentoFinanceiroAReceber({
                priCods: ['1'],
                filCod: 2,
            });
            expect(out).toHaveLength(1);
            expect(out[0].docCod).toBe('9001');
        });

        it('returns empty array when no rows', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            const out = await client.listAdiantamentoFinanceiroAReceber({
                priCods: ['1'],
                filCod: 2,
            });
            expect(out).toEqual([]);
        });
    });

    // v0.5 — variacao-cambial (2026-05-28)
    describe('listTitulosAPagar — foreign-currency contracting fields', () => {
        it('populates valorNegociado/taxa/moedaCod/moedaNome from com308 wire fields (docCod=24107 sample)', async () => {
            const legacy = buildLegacy();
            legacy.listGeneric.mockResolvedValue([
                {
                    titCod: 1,
                    titFltTaxaMneg: 5.0211,
                    titMnyValorMneg: 75094,
                    moeCodMneg: 220,
                    moeEspNome: 'DOLAR DOS EUA',
                },
            ]);
            const client = buildClient(legacy);

            const titles = await client.listTitulosAPagar({ docCod: '24107', filCod: 2 });

            expect(titles).toHaveLength(1);
            expect(titles[0].titCod).toBe('1');
            expect(titles[0].valorNegociado).toBe(75094);
            expect(titles[0].taxa).toBe(5.0211);
            expect(titles[0].moedaCod).toBe(220);
            expect(titles[0].moedaNome).toBe('DOLAR DOS EUA');
        });

        it('sends the extended fieldList including the four mneg fields', async () => {
            const legacy = buildLegacy();
            legacy.listGeneric.mockResolvedValue([]);
            const client = buildClient(legacy);

            await client.listTitulosAPagar({ docCod: '24107', filCod: 2 });

            const body = legacy.listGeneric.mock.calls[0][1] as Record<string, unknown>;
            const fieldList = body.fieldList as string[];
            expect(fieldList).toEqual(
                expect.arrayContaining([
                    'titCod',
                    'titFltTaxaMneg',
                    'titMnyValorMneg',
                    'moeCodMneg',
                    'moeEspNome',
                ]),
            );
        });

        it('leaves optional fields undefined when Conexos omits them', async () => {
            const legacy = buildLegacy();
            legacy.listGeneric.mockResolvedValue([{ titCod: 1 }]);
            const client = buildClient(legacy);

            const titles = await client.listTitulosAPagar({ docCod: '6074', filCod: 2 });

            expect(titles).toHaveLength(1);
            expect(titles[0].titCod).toBe('1');
            expect(titles[0].valorNegociado).toBeUndefined();
            expect(titles[0].taxa).toBeUndefined();
            expect(titles[0].moedaCod).toBeUndefined();
            expect(titles[0].moedaNome).toBeUndefined();
            expect(titles[0].valorPago).toBeUndefined();
        });

        // invoice-pago-detalhe (2026-08-28) — o `pago` da invoice passa a sair daqui,
        // porque o com298/list não popula saldo nenhum. Números reais do doc 14042
        // (filial 2, processo 1953), sonda `probe-invoice-pago` em PRD.
        it('mapeia titMnyTotPago → valorPago (doc 14042: face == pago, invoice quitada)', async () => {
            const legacy = buildLegacy();
            legacy.listGeneric.mockResolvedValue([
                {
                    titCod: 1,
                    titMnyValor: 2032384.41,
                    titMnyTotPago: 2032384.41,
                    titFltTaxaMneg: 5.2647,
                    titMnyValorMneg: 386039.93,
                    moeCodMneg: 220,
                    moeEspNome: 'DOLAR DOS EUA',
                },
            ]);
            const client = buildClient(legacy);

            const titles = await client.listTitulosAPagar({ docCod: '14042', filCod: 2 });

            expect(titles[0].valorBrl).toBe(2032384.41);
            expect(titles[0].valorPago).toBe(2032384.41);
        });

        it('pede titMnyTotPago no fieldList — sem ele não há como derivar o pago', async () => {
            const legacy = buildLegacy();
            legacy.listGeneric.mockResolvedValue([]);
            const client = buildClient(legacy);

            await client.listTitulosAPagar({ docCod: '14042', filCod: 2 });

            const body = legacy.listGeneric.mock.calls[0][1] as Record<string, unknown>;
            expect(body.fieldList as string[]).toEqual(
                expect.arrayContaining(['titMnyValor', 'titMnyTotPago']),
            );
        });
    });

    // Addendum #10 ADR-0020 (2026-06-05) — `dpeNomPessoa` (destino do
    // pagamento do documento) vira campo DEDICADO de `DocFinanceiroAPagar`,
    // em vez de ser coalescido apenas dentro de `exportador`. A coluna
    // "Cliente" do relatório VC passa a vir desse campo. `exportador`
    // CONTINUA populado pelo coalesce existente (FM/JVE dependem).
    describe('listFinanceiroAPagarByGerNum — dpeNomPessoa dedicated field (Addendum #10)', () => {
        it('maps row.dpeNomPessoa to a dedicated dpeNomPessoa field', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [
                    {
                        docCod: 21841,
                        priCod: 1320,
                        docDtaEmissao: 1767571200000,
                        docMnyValor: 46538.58,
                        gerNum: 198,
                        gerDes: 'ADTO FORNECEDOR INTERNACIONAIS',
                        dpeNomPessoa: 'JINLING TRADE (HK) LIMITED',
                    },
                ],
            });
            const client = buildClient(legacy);

            const docs = await client.listFinanceiroAPagarByGerNum({
                priCods: ['1320'],
                gerNums: [198, 21, 276],
                filCod: 2,
            });

            expect(docs).toHaveLength(1);
            expect(docs[0].dpeNomPessoa).toBe('JINLING TRADE (HK) LIMITED');
        });

        it('regression: exportador STILL populated by existing coalesce (exportador ?? dpeNomPessoa) — FM/JVE depend on it', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 2,
                rows: [
                    {
                        docCod: 1,
                        priCod: 1,
                        gerNum: 21,
                        dpeNomPessoa: 'DESTINO DO PAGAMENTO',
                    },
                    {
                        docCod: 2,
                        priCod: 1,
                        gerNum: 21,
                        exportador: 'EXPORTADOR EXPLICITO',
                        dpeNomPessoa: 'DESTINO DO PAGAMENTO',
                    },
                ],
            });
            const client = buildClient(legacy);

            const docs = await client.listFinanceiroAPagarByGerNum({
                priCods: ['1'],
                gerNums: [21],
                filCod: 2,
            });

            // coalesce: when exportador absent, falls back to dpeNomPessoa
            expect(docs[0].exportador).toBe('DESTINO DO PAGAMENTO');
            // explicit exportador wins
            expect(docs[1].exportador).toBe('EXPORTADOR EXPLICITO');
            // dedicated dpeNomPessoa field independent of exportador
            expect(docs[0].dpeNomPessoa).toBe('DESTINO DO PAGAMENTO');
            expect(docs[1].dpeNomPessoa).toBe('DESTINO DO PAGAMENTO');
        });

        it('dpeNomPessoa absent/null → dedicated field undefined (service owns the "" normalization, D10f)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [
                    {
                        docCod: 3,
                        priCod: 1,
                        gerNum: 21,
                        // no dpeNomPessoa, no exportador
                    },
                ],
            });
            const client = buildClient(legacy);

            const docs = await client.listFinanceiroAPagarByGerNum({
                priCods: ['1'],
                gerNums: [21],
                filCod: 2,
            });

            expect(docs[0].dpeNomPessoa).toBeUndefined();
            expect(docs[0].exportador).toBeUndefined();
        });
    });

    describe('listAdiantamentosProforma (eleição — Permutas Fatia 1)', () => {
        it('lists all proformas without priCod, with PROFORMA + FINALIZADO + adiantamento filters', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            await client.listAdiantamentosProforma({ filCod: 2 });

            const body = legacy.listGenericPaginated.mock.calls[0][1] as Record<string, unknown>;
            const filterList = body.filterList as Record<string, unknown>;
            expect(filterList['tpdCod#EQ']).toBe(99);
            expect(filterList['vldStatus#IN']).toEqual(['3']);
            // P0-3 confirmado (probe 2026-06-18): filtro docVldTipoAdto=1.
            expect(filterList['docVldTipoAdto#EQ']).toBe(1);
            // P0-7: no priCod filter — the eleição lists all.
            expect(filterList['priCod#IN']).toBeUndefined();
        });

        it('paginates the union and maps rows to Adiantamento (pago via mnyTitAberto)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated
                .mockResolvedValueOnce({
                    count: 600,
                    rows: Array.from({ length: 500 }, (_, i) => ({
                        docCod: i + 1,
                        priCod: 1153,
                        docDtaEmissao: 1767571200000,
                        docMnyValor: 1000,
                        mnyTitAberto: 0,
                    })),
                })
                .mockResolvedValueOnce({
                    count: 600,
                    rows: Array.from({ length: 100 }, (_, i) => ({
                        docCod: 1000 + i,
                        priCod: 2048,
                        docDtaEmissao: 1767571200000,
                        docMnyValor: 50,
                        mnyTitAberto: 10,
                    })),
                });
            const client = buildClient(legacy);

            const { adiantamentos, capHit } = await client.listAdiantamentosProforma({ filCod: 2 });

            expect(legacy.listGenericPaginated).toHaveBeenCalledTimes(2);
            expect(adiantamentos).toHaveLength(600);
            expect(adiantamentos[0]).toMatchObject({ docCod: '1', priCod: '1153', pago: true });
            expect(adiantamentos[500]).toMatchObject({
                docCod: '1000',
                priCod: '2048',
                pago: false,
            });
            expect(capHit).toBe(false);
        });

        it('reports capHit=true when pagination hits MAX_PAGES (silent truncation)', async () => {
            const legacy = buildLegacy();
            // Every page is full (500 rows) and count never satisfied → loop runs
            // until MAX_PAGES (50) and exits without a short page → capHit.
            legacy.listGenericPaginated.mockResolvedValue({
                count: 999_999,
                rows: Array.from({ length: 500 }, (_, i) => ({ docCod: i + 1, priCod: 1 })),
            });
            const client = buildClient(legacy);

            const { capHit } = await client.listAdiantamentosProforma({ filCod: 2 });

            expect(capHit).toBe(true);
        });

        it('rejects a row without docCod via Zod', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [{ priCod: 1153, docMnyValor: 1 }],
            });
            const client = buildClient(legacy);

            await expect(client.listAdiantamentosProforma({ filCod: 2 })).rejects.toThrow();
        });
    });

    describe('listDeclaracaoByProcesso (D.I imp019 XOR DUIMP imp223)', () => {
        const onlyDi = (
            endpoint: string,
        ): { count: number; rows: Array<Record<string, unknown>> } =>
            endpoint.startsWith('imp019')
                ? { count: 1, rows: [{ priCod: 2048 }] }
                : { count: 0, rows: [] };

        it('returns only DI when only imp019 has a row', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockImplementation(async (endpoint: string) =>
                onlyDi(endpoint),
            );
            const client = buildClient(legacy);

            const result = await client.listDeclaracaoByProcesso({ priCods: ['2048'], filCod: 2 });

            expect(result).toEqual([{ variante: 'DI', priCod: '2048' }]);
        });

        it('returns only DUIMP when only imp223 has a row', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockImplementation(async (endpoint: string) =>
                endpoint.startsWith('imp223')
                    ? { count: 1, rows: [{ priCod: '3000' }] }
                    : { count: 0, rows: [] },
            );
            const client = buildClient(legacy);

            const result = await client.listDeclaracaoByProcesso({ priCods: ['3000'], filCod: 2 });

            expect(result).toEqual([{ variante: 'DUIMP', priCod: '3000' }]);
        });

        it('returns two entries (DI + DUIMP) when both exist — XOR decided in the service', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockImplementation(async (endpoint: string) =>
                endpoint.startsWith('imp019')
                    ? { count: 1, rows: [{ priCod: '4000' }] }
                    : { count: 1, rows: [{ priCod: '4000' }] },
            );
            const client = buildClient(legacy);

            const result = await client.listDeclaracaoByProcesso({ priCods: ['4000'], filCod: 2 });

            expect(result).toHaveLength(2);
            expect(result.map((d) => d.variante).sort()).toEqual(['DI', 'DUIMP']);
        });

        it('returns [] when neither declaration exists', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });
            const client = buildClient(legacy);

            const result = await client.listDeclaracaoByProcesso({ priCods: ['9999'], filCod: 2 });

            expect(result).toEqual([]);
        });

        it('extracts dataBase from cdiDtaCi for D.I (P0-4 resolvido)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockImplementation(async (endpoint: string) =>
                endpoint.startsWith('imp019')
                    ? { count: 1, rows: [{ priCod: '2048', cdiDtaCi: 1768521600000 }] }
                    : { count: 0, rows: [] },
            );
            const client = buildClient(legacy);

            const result = await client.listDeclaracaoByProcesso({ priCods: ['2048'], filCod: 2 });

            expect(result[0].dataBase).toBeInstanceOf(Date);
            expect(result[0].dataBase?.toISOString().slice(0, 10)).toBe('2026-01-16');
        });

        it('extracts dataBase from dioDtaDesembaraco for DUIMP (P0-4 resolvido)', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockImplementation(async (endpoint: string) =>
                endpoint.startsWith('imp223')
                    ? { count: 1, rows: [{ priCod: '3000', dioDtaDesembaraco: 1769040000000 }] }
                    : { count: 0, rows: [] },
            );
            const client = buildClient(legacy);

            const result = await client.listDeclaracaoByProcesso({ priCods: ['3000'], filCod: 2 });

            expect(result[0].variante).toBe('DUIMP');
            expect(result[0].dataBase?.toISOString().slice(0, 10)).toBe('2026-01-22');
        });

        it('leaves dataBase undefined when the wire date field is absent', async () => {
            const legacy = buildLegacy();
            legacy.listGenericPaginated.mockImplementation(async (endpoint: string) =>
                onlyDi(endpoint),
            );
            const client = buildClient(legacy);

            const result = await client.listDeclaracaoByProcesso({ priCods: ['2048'], filCod: 2 });

            expect(result[0].dataBase).toBeUndefined();
        });
    });

    describe('getDetalheTitulos (P0-3 — retry + ConexosError; valorPermutar + pago)', () => {
        it('returns valorPermutar and pago=false when mnyTitAberto > 0 (doc 26471, NÃO pago)', async () => {
            const legacy = buildLegacy();
            // Wire real 2026-06-18, filCod=2, doc 26471 (NÃO pago).
            legacy.getGeneric.mockResolvedValue({
                mnyTitValor: 384119.95,
                mnyTitPago: 0,
                mnyTitAberto: 384119.95,
                mnyTitPermutar: 0,
            });
            const client = buildClient(legacy);

            const detail = await client.getDetalheTitulos({ docCod: '26471', filCod: 2 });

            expect(detail.valorPermutar).toBe(0);
            expect(detail.pago).toBe(false);
            // Progresso de pagamento: face + saldo em aberto (NÃO pago → aberto = face).
            expect(detail.valorTotal).toBe(384119.95);
            expect(detail.valorAberto).toBe(384119.95);
        });

        it('returns pago=true when mnyTitAberto === 0 (doc 24166, TOTALMENTE pago)', async () => {
            const legacy = buildLegacy();
            // Wire real 2026-06-18, filCod=2, doc 24166 (TOTALMENTE pago).
            legacy.getGeneric.mockResolvedValue({
                mnyTitValor: 266350.43,
                mnyTitPago: 266350.43,
                mnyTitAberto: 0,
                mnyTitPermutar: 266350.43,
            });
            const client = buildClient(legacy);

            const detail = await client.getDetalheTitulos({ docCod: '24166', filCod: 2 });

            expect(detail.valorPermutar).toBe(266350.43);
            expect(detail.pago).toBe(true);
            // Totalmente pago → saldo em aberto = 0.
            expect(detail.valorTotal).toBe(266350.43);
            expect(detail.valorAberto).toBe(0);
        });

        it('returns pago=undefined when mnyTitAberto is absent (conservative — Gate 3 reprova)', async () => {
            const legacy = buildLegacy();
            legacy.getGeneric.mockResolvedValue({ mnyTitPermutar: 44917.24 });
            const client = buildClient(legacy);

            const detail = await client.getDetalheTitulos({ docCod: '21841', filCod: 2 });

            expect(detail.valorPermutar).toBe(44917.24);
            expect(detail.pago).toBeUndefined();
            // Sem mnyTitValor/mnyTitAberto no payload → campos omitidos.
            expect(detail.valorTotal).toBeUndefined();
            expect(detail.valorAberto).toBeUndefined();
        });

        it('retries a transient detail failure, then succeeds', async () => {
            const legacy = buildLegacy();
            legacy.getGeneric
                .mockRejectedValueOnce(new Error('socket hang up'))
                .mockResolvedValueOnce({ mnyTitPermutar: 100, mnyTitAberto: 0 });
            const client = buildClient(legacy);

            const detail = await client.getDetalheTitulos({ docCod: 'D1', filCod: 2 });

            expect(detail.valorPermutar).toBe(100);
            expect(detail.pago).toBe(true);
            expect(legacy.getGeneric).toHaveBeenCalledTimes(2);
        });

        it('throws ConexosError (NOT a default object) after retries are exhausted', async () => {
            const legacy = buildLegacy();
            legacy.getGeneric.mockRejectedValue(new Error('upstream 503'));
            const client = buildClient(legacy);

            await expect(
                client.getDetalheTitulos({ docCod: 'D9', filCod: 2 }),
            ).rejects.toBeInstanceOf(ConexosError);
            // RetryExecutor retries=2 → 2 attempts before giving up.
            expect(legacy.getGeneric).toHaveBeenCalledTimes(2);
        });

        it('returns valorPermutado from mnyTitPermuta (doc 8266 — pago E 100% já permutado)', async () => {
            const legacy = buildLegacy();
            // Print real Conexos doc 8266: RESUMO DOS TÍTULOS com Valor Pago =
            // Valor Permutado = 378636.28, Valor em Aberto = 0, Valor à
            // Permutar = 0. Pago E já 100% permutado → mnyTitPermutar=0 mas
            // mnyTitPermuta>0 ⇒ caller deve resolver "já permutado".
            legacy.getGeneric.mockResolvedValue({
                mnyTitValor: 378636.28,
                mnyTitPago: 378636.28,
                mnyTitAberto: 0,
                mnyTitPermutar: 0,
                mnyTitPermuta: 378636.28,
            });
            const client = buildClient(legacy);

            const detail = await client.getDetalheTitulos({ docCod: '8266', filCod: 2 });

            expect(detail.valorPermutar).toBe(0);
            expect(detail.pago).toBe(true);
            expect(detail.valorPermutado).toBe(378636.28);
        });

        it('returns valorPermutado=undefined when mnyTitPermuta is absent', async () => {
            const legacy = buildLegacy();
            legacy.getGeneric.mockResolvedValue({
                mnyTitAberto: 0,
                mnyTitPermutar: 0,
            });
            const client = buildClient(legacy);

            const detail = await client.getDetalheTitulos({ docCod: 'D2', filCod: 2 });

            expect(detail.valorPermutado).toBeUndefined();
        });

        it('treats the 400-VALIDATION-with-responseData quirk as a valid response (no throw)', async () => {
            const legacy = buildLegacy();
            legacy.getGeneric.mockRejectedValue({
                response: {
                    status: 400,
                    data: { responseData: { mnyTitPermutar: 7, mnyTitAberto: 0 } },
                },
            });
            const client = buildClient(legacy);

            const detail = await client.getDetalheTitulos({ docCod: '10649', filCod: 2 });

            expect(detail.valorPermutar).toBe(7);
            expect(detail.pago).toBe(true);
            // Quirk path succeeds on the first attempt — no retry.
            expect(legacy.getGeneric).toHaveBeenCalledTimes(1);
        });
    });

    describe('fin010 write methods (Fase 3 — baixa/permuta)', () => {
        it('criarBordero posts the borderô payload and returns borCod', async () => {
            const legacy = buildLegacy();
            legacy.postGeneric.mockResolvedValue({
                borCod: 1999,
                filCod: 4,
                borVldTipo: 2,
                borDtaMvto: 1782172800000,
            });
            const client = buildClient(legacy);

            const out = await client.criarBordero({ filCod: 4, dataMovto: 1782172800000 });

            expect(out.borCod).toBe(1999);
            expect(legacy.postGeneric).toHaveBeenCalledWith(
                'fin010',
                {
                    filCod: 4,
                    borVldTipo: 2,
                    borVldFinalizado: 0,
                    frontModelName: 'bordero',
                    borDtaMvto: 1782172800000,
                },
                { filCod: 4 },
            );
        });

        it('validarTituloBaixa sends the invoice docCod and titCod', async () => {
            const legacy = buildLegacy();
            legacy.postGeneric.mockResolvedValue({
                messages: [{ valid: 'AVISO' }],
                responseData: { bxaMnyValor: 40879.9, bxaCodGerJuros: 58 },
            });
            const client = buildClient(legacy);

            const out = await client.validarTituloBaixa({
                filCod: 4,
                borCod: 1999,
                invoiceDocCod: 5078,
                titCod: 1,
            });

            expect(out.responseData?.bxaMnyValor).toBe(40879.9);
            const [path, body] = legacy.postGeneric.mock.calls[0];
            expect(path).toBe('fin010/baixas/validacao/tituloBaixa');
            expect(body).toMatchObject({ docCod: 5078, titCod: 1, borCod: 1999, docTip: 2 });
        });

        it('validarTituloPermuta sends the adiantamento docCod', async () => {
            const legacy = buildLegacy();
            legacy.postGeneric.mockResolvedValue({
                messages: [{ valid: 'SUCESSO' }],
                responseData: { gerNumPermuta: 198, pesCod: 2658, bxaMnyValorPermuta: 41175.97 },
            });
            const client = buildClient(legacy);

            await client.validarTituloPermuta({
                filCod: 4,
                borCod: 1999,
                adiantamentoDocCod: 2767,
                bxaTitCod: 1,
            });

            const [path, body] = legacy.postGeneric.mock.calls[0];
            expect(path).toBe('fin010/baixas/validacao/tituloPermuta');
            expect(body).toMatchObject({ bxaDocCod: 2767, bxaTitCod: 1, borCod: 1999 });
        });

        it('atualizarValorLiquido sends valor + juros and returns liquido', async () => {
            const legacy = buildLegacy();
            legacy.postGeneric.mockResolvedValue({
                messages: [{ valid: 'SUCESSO' }],
                responseData: { bxaMnyLiquido: 41099.9 },
            });
            const client = buildClient(legacy);

            const out = await client.atualizarValorLiquido({
                filCod: 4,
                borCod: 1999,
                invoiceDocCod: 5078,
                titCod: 1,
                valor: 40879.9,
                juros: 220,
            });

            expect(out.responseData?.bxaMnyLiquido).toBe(41099.9);
            const [, body] = legacy.postGeneric.mock.calls[0];
            expect(body).toMatchObject({
                bxaMnyValor: 40879.9,
                bxaMnyJuros: 220,
                bxaMnyDesconto: 0,
            });
        });

        it('gravarBaixaPermuta posts the consolidated payload and returns bxaCodSeq', async () => {
            const legacy = buildLegacy();
            // Irreversible write goes through postGenericOnce (no 401 re-POST).
            legacy.postGenericOnce.mockResolvedValue({
                bxaCodSeq: 1,
                borCod: 1999,
                docCod: 5078,
                bxaDocCod: 2767,
                bxaMnyValor: 40879.9,
                bxaMnyJuros: 220,
                bxaMnyLiquido: 41099.9,
            });
            const client = buildClient(legacy);

            const payload = { borCod: 1999, docCod: 5078, bxaDocCod: 2767, bxaMnyJuros: 220 };
            const out = await client.gravarBaixaPermuta({ filCod: 4, payload });

            expect(out.bxaCodSeq).toBe(1);
            expect(legacy.postGenericOnce).toHaveBeenCalledWith('fin010/baixas', payload, {
                filCod: 4,
            });
            // It must NOT use the retrying postGeneric for the irreversible write.
            expect(legacy.postGeneric).not.toHaveBeenCalled();
        });

        it('wraps write failures in ConexosError', async () => {
            const legacy = buildLegacy();
            legacy.postGeneric.mockRejectedValue(new Error('upstream 500'));
            const client = buildClient(legacy);

            await expect(client.criarBordero({ filCod: 4, dataMovto: 1 })).rejects.toBeInstanceOf(
                ConexosError,
            );
        });

        it('does NOT retry the irreversible writes (criarBordero, gravarBaixaPermuta)', async () => {
            // Regis F-fault-tolerance-1: um retry após timeout-pós-sucesso geraria borderô/baixa
            // duplicados. As escritas devem ser tentativa única (≠ reads, que retentam 3×).
            const legacy = buildLegacy();
            legacy.postGeneric.mockRejectedValue(new Error('upstream timeout'));
            const client = buildClient(legacy);

            await expect(client.criarBordero({ filCod: 4, dataMovto: 1 })).rejects.toBeInstanceOf(
                ConexosError,
            );
            expect(legacy.postGeneric).toHaveBeenCalledTimes(1);

            // gravarBaixaPermuta uses postGenericOnce (no 401 re-POST either): single attempt.
            legacy.postGenericOnce.mockRejectedValue(new Error('upstream timeout'));
            await expect(
                client.gravarBaixaPermuta({ filCod: 4, payload: { borCod: 1 } }),
            ).rejects.toBeInstanceOf(ConexosError);
            expect(legacy.postGenericOnce).toHaveBeenCalledTimes(1);
        });
    });
});

describe('ConexosClient — fin010 write contract (Fase 3.1)', () => {
    it('excluirBaixa: 2º segmento do path é o docTip (NÃO o filCod) — regressão do bug docTip-vs-filCod', async () => {
        const legacy = buildLegacy();
        const client = buildClient(legacy);
        // filCod 4 (≠ docTip): o path deve usar docTip=2, e filCod vai no header (opts).
        await client.excluirBaixa({
            filCod: 4,
            borCod: 14709,
            docTip: 2,
            invoiceDocCod: 3942,
            titCod: 1,
            bxaCodSeq: 1,
        });
        expect(legacy.deleteGeneric).toHaveBeenCalledWith('fin010/baixas/14709/2/3942/1/1', {
            filCod: 4,
        });
    });

    it('excluirBaixa: docTip default = 2 (invoice) quando omitido', async () => {
        const legacy = buildLegacy();
        const client = buildClient(legacy);
        await client.excluirBaixa({
            filCod: 2,
            borCod: 14707,
            invoiceDocCod: 18780,
            titCod: 1,
            bxaCodSeq: 1,
        });
        expect(legacy.deleteGeneric).toHaveBeenCalledWith('fin010/baixas/14707/2/18780/1/1', {
            filCod: 2,
        });
    });

    it('excluirBordero: DELETE fin010/{borCod} (só borCod no path; filCod no header)', async () => {
        const legacy = buildLegacy();
        const client = buildClient(legacy);
        await client.excluirBordero({ filCod: 4, borCod: 14709 });
        expect(legacy.deleteGeneric).toHaveBeenCalledWith('fin010/14709', { filCod: 4 });
    });

    it('finalizar/cancelar/estornarBordero: POST fin010/{acao}/{borCod} body vazio + filCod header', async () => {
        const legacy = buildLegacy();
        const client = buildClient(legacy);
        await client.finalizarBordero({ filCod: 2, borCod: 100 });
        await client.cancelarBordero({ filCod: 2, borCod: 101 });
        await client.estornarBordero({ filCod: 2, borCod: 102 });
        expect(legacy.postGeneric).toHaveBeenCalledWith('fin010/finalizar/100', {}, { filCod: 2 });
        expect(legacy.postGeneric).toHaveBeenCalledWith('fin010/cancelar/101', {}, { filCod: 2 });
        expect(legacy.postGeneric).toHaveBeenCalledWith('fin010/estornar/102', {}, { filCod: 2 });
    });

    it('listBaixas: POST fin010/baixas/list/{borCod}; mapeia docTip/docCod/titCod/bxaCodSeq', async () => {
        const legacy = buildLegacy();
        legacy.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [{ filCod: 2, docTip: 2, docCod: 18779, titCod: 1, bxaCodSeq: 1 }],
        });
        const client = buildClient(legacy);
        const out = await client.listBaixas({ filCod: 2, borCod: 14709 });
        expect(legacy.listGenericPaginated).toHaveBeenCalledWith(
            'fin010/baixas/list/14709',
            expect.any(Object),
            { filCod: 2 },
        );
        expect(out[0]).toMatchObject({
            filCod: 2,
            docTip: 2,
            docCod: 18779,
            titCod: 1,
            bxaCodSeq: 1,
        });
    });

    it('listBorderos: POST fin010/list filtrando borVldTipo=2 (permuta)', async () => {
        const legacy = buildLegacy();
        legacy.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [{ borCod: 14709, filCod: 2, borVldFinalizado: 0, borCodEstornado: null }],
        });
        const client = buildClient(legacy);
        const out = await client.listBorderos({ filCod: 2 });
        const [path, body, opts] = legacy.listGenericPaginated.mock.calls[0];
        expect(path).toBe('fin010/list');
        expect((body as { filterList?: Record<string, unknown> }).filterList).toMatchObject({
            'borVldTipo#EQ': 2,
        });
        expect(opts).toEqual({ filCod: 2 });
        expect(out[0]).toMatchObject({ borCod: 14709, filCod: 2 });
    });
});

describe('ConexosClient — fin010 Zod no boundary (Regis P0 integrability)', () => {
    it('criarBordero: rejeita resposta sem borCod numérico (não cria borderô fantasma)', async () => {
        const legacy = buildLegacy();
        legacy.postGeneric.mockResolvedValue({ filCod: 2 }); // sem borCod
        const client = buildClient(legacy);
        await expect(
            client.criarBordero({ filCod: 2, dataMovto: 1782172800000 }),
        ).rejects.toBeInstanceOf(ConexosError);
    });

    it('criarBordero: aceita e coage borCod string→number', async () => {
        const legacy = buildLegacy();
        legacy.postGeneric.mockResolvedValue({ borCod: '14709', filCod: 2 });
        const client = buildClient(legacy);
        const out = await client.criarBordero({ filCod: 2, dataMovto: 1782172800000 });
        expect(out.borCod).toBe(14709);
    });

    it('gravarBaixaPermuta: rejeita resposta sem bxaCodSeq (não marca settled errado)', async () => {
        const legacy = buildLegacy();
        legacy.postGeneric.mockResolvedValue({ borCod: 14709 }); // sem bxaCodSeq
        const client = buildClient(legacy);
        await expect(
            client.gravarBaixaPermuta({ filCod: 2, payload: { borCod: 14709 } }),
        ).rejects.toBeInstanceOf(ConexosError);
    });
});
