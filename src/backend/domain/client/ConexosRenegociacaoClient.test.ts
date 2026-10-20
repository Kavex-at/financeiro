import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ConexosError from '../errors/ConexosError.js';
import ConexosWriteDisabledError from '../errors/ConexosWriteDisabledError.js';
import type { SessaoConexos } from '../interface/sispag/RenegociacaoInterface.js';
import type EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import ConexosRenegociacaoClient from './ConexosRenegociacaoClient.js';

const sessao = () => {
    const s = {
        ensureSid: jest.fn(async () => undefined),
        authenticatedPost: jest.fn(async (_p: string, _b: unknown, _o?: unknown) => ({
            count: 0,
            rows: [] as unknown[],
        })),
        authenticatedPostOnce: jest.fn(async (_p: string, _b: unknown, _o?: unknown) => ({})),
        authenticatedPutOnce: jest.fn(async (_p: string, _b: unknown, _o?: unknown) => ({})),
        authenticatedGet: jest.fn(async (_p: string, _o?: unknown): Promise<unknown> => ({})),
        authenticatedDelete: jest.fn(async () => ({})),
        authenticatedDeleteOnce: jest.fn(async (_p: string, _o?: unknown): Promise<unknown> => ''),
    };
    return { s, sessao: s as unknown as SessaoConexos };
};

const env = (over: Record<string, unknown> = {}) =>
    ({
        getEnvironmentVars: jest.fn(async () => ({ conexosWriteEnabled: true, ...over })),
    }) as unknown as EnvironmentProvider;

const make = (o: Record<string, unknown> = {}) => new ConexosRenegociacaoClient(env(o));

const recusa = (key: string) =>
    Object.assign(new Error('400'), {
        response: { status: 400, data: { messages: [{ valid: 'ERRO', message: key }] } },
    });

const HOJE = Date.UTC(2026, 9, 19);
const VENC = Date.UTC(2026, 9, 30);

describe('ConexosRenegociacaoClient (ADR-0074, I18c–e)', () => {
    describe('escritas: tentativa única, corpos do HML (probe-hml-renegociacao-fin070)', () => {
        it('criarRenegociacao: POST fin070 com pesCod, frnVldTipo 2, frnVldTpop 0, data e obs MAIÚSCULA', async () => {
            const { s, sessao: sx } = sessao();
            s.authenticatedPostOnce.mockResolvedValueOnce({ frnCod: 3 });
            const r = await make().criarRenegociacao(sx, {
                filCod: 2,
                pesCod: 121,
                dataRenegEpoch: HOJE,
                obs: 'Ajuste centavos Kavex AJC-ABC boleto 34191*9000',
            });
            expect(r).toEqual({ frnCod: 3 });
            expect(s.authenticatedPostOnce.mock.calls[0]).toEqual([
                '/fin070',
                {
                    filCod: 2,
                    pesCod: 121,
                    frnVldTipo: 2,
                    frnVldTpop: 0,
                    frnDtaReneg: HOJE,
                    frnEspObs: 'AJUSTE CENTAVOS KAVEX AJC-ABC BOLETO 34191*9000',
                },
                { filCod: 2 },
            ]);
            expect(s.authenticatedPost).not.toHaveBeenCalled();
        });

        it('criarRenegociacao sem frnCod na resposta ⇒ ConexosError (a retomada acha pelo marcador)', async () => {
            const { s, sessao: sx } = sessao();
            s.authenticatedPostOnce.mockResolvedValueOnce({});
            await expect(
                make().criarRenegociacao(sx, {
                    filCod: 2,
                    pesCod: 121,
                    dataRenegEpoch: HOJE,
                    obs: 'AJC-X',
                }),
            ).rejects.toBeInstanceOf(ConexosError);
        });

        it('incluirTitulo e gravarComposicao: corpos numéricos, valor aberto e vencimento originais', async () => {
            const { s, sessao: sx } = sessao();
            const c = make();
            await c.incluirTitulo(sx, {
                filCod: 2,
                frnCod: 3,
                docTip: 2,
                docCod: '536',
                titCod: '1',
            });
            await c.gravarComposicao(sx, {
                filCod: 2,
                frnCod: 3,
                docTip: 2,
                docCod: '536',
                titCod: '1',
                valor: 53.53,
                vencimentoEpoch: VENC,
                frgEspNumero: '12294',
                pgtCod: 1,
                dupEspOrdem: 'A',
            });
            const ident = { filCod: 2, frnCod: 3, docTip: 2, docCod: 536, titCod: 1 };
            expect(s.authenticatedPostOnce.mock.calls).toEqual([
                ['/fin070/titulos', ident, { filCod: 2 }],
                [
                    '/fin070/titulos/composicao',
                    {
                        ...ident,
                        frgMnyValor: 53.53,
                        frgDtaVencimento: VENC,
                        frgEspNumero: '12294',
                        pgtCod: 1,
                        dupEspOrdem: 'A',
                    },
                    { filCod: 2 },
                ],
            ]);
        });

        it.each([
            ['juros (caso 1)', 1 as const, 0.01],
            ['desconto (caso 2)', 2 as const, 0.01],
        ])('aplicarAjuste %s: relê o cabeçalho e o regrava com frnMnyValor e frnVldTpop', async (_n, tpop, valor) => {
            const { s, sessao: sx } = sessao();
            s.authenticatedGet.mockResolvedValueOnce({
                frnCod: 3,
                filCod: 2,
                pesCod: 121,
                frnVldTipo: 2,
                frnVldTpop: 0,
                frnEspObs: 'AJC-X',
            });
            await make().aplicarAjuste(sx, {
                filCod: 2,
                frnCod: 3,
                frnMnyValor: valor,
                frnVldTpop: tpop,
            });
            expect(s.authenticatedGet).toHaveBeenCalledWith('/fin070/3', { filCod: 2 });
            expect(s.authenticatedPutOnce.mock.calls[0]).toEqual([
                '/fin070',
                {
                    frnCod: 3,
                    filCod: 2,
                    pesCod: 121,
                    frnVldTipo: 2,
                    frnVldTpop: tpop,
                    frnEspObs: 'AJC-X',
                    frnMnyValor: valor,
                },
                { filCod: 2 },
            ]);
        });

        it('finalizarRenegociacao: PUT fin070/finalizar/{frnCod}', async () => {
            const { s, sessao: sx } = sessao();
            await make().finalizarRenegociacao(sx, { filCod: 2, frnCod: 3 });
            expect(s.authenticatedPutOnce).toHaveBeenCalledWith(
                '/fin070/finalizar/3',
                {},
                {
                    filCod: 2,
                },
            );
        });

        describe('cancelarRenegociacao (G3, HML 2026-10-19: frnCod 5 e 6)', () => {
            const listas = (
                s: ReturnType<typeof sessao>['s'],
                titulos: unknown[],
                comps: unknown[],
            ) =>
                s.authenticatedPost.mockImplementation(async (p: string) =>
                    p.startsWith('/fin070/titulos/composicao/list/')
                        ? { count: comps.length, rows: comps }
                        : p.startsWith('/fin070/titulos/list/')
                          ? { count: titulos.length, rows: titulos }
                          : { count: 0, rows: [] },
                );

            it('não finalizada: DELETE composição → DELETE título → DELETE cabeçalho, nessa ordem, tentativa única', async () => {
                const { s, sessao: sx } = sessao();
                s.authenticatedGet.mockResolvedValueOnce({ frnCod: 5, frnVldFin: 0 });
                listas(s, [{ docTip: 2, docCod: 537, titCod: 1 }], [{ frgCodSeq: 1 }]);
                await make().cancelarRenegociacao(sx, { filCod: 2, frnCod: 5 });
                expect(s.authenticatedDeleteOnce.mock.calls).toEqual([
                    ['/fin070/titulos/composicao/5/2/537/1/1', { filCod: 2 }],
                    ['/fin070/titulos/5/2/537/1', { filCod: 2 }],
                    ['/fin070/5', { filCod: 2 }],
                ]);
                expect(s.authenticatedDelete).not.toHaveBeenCalled();
                // `PUT fin070/cancelar` só vale para renegociação FINALIZADA (REGISTRO_DEVE_ESTAR_FINALIZADO).
                expect(s.authenticatedPutOnce).not.toHaveBeenCalled();
            });

            it('só o cabeçalho (POST cujo título não entrou) ⇒ DELETE fin070/{frnCod}', async () => {
                const { s, sessao: sx } = sessao();
                s.authenticatedGet.mockResolvedValueOnce({ frnCod: 6, frnVldFin: 0 });
                listas(s, [], []);
                await make().cancelarRenegociacao(sx, { filCod: 2, frnCod: 6 });
                expect(s.authenticatedDeleteOnce.mock.calls).toEqual([
                    ['/fin070/6', { filCod: 2 }],
                ]);
            });

            it('renegociação FINALIZADA ⇒ recusa sem nenhum DELETE (depois do finalizar é só para a frente)', async () => {
                const { s, sessao: sx } = sessao();
                s.authenticatedGet.mockResolvedValueOnce({ frnCod: 3, frnVldFin: 1 });
                listas(s, [{ docTip: 2, docCod: 536, titCod: 1 }], [{ frgCodSeq: 1 }]);
                const erro = await make()
                    .cancelarRenegociacao(sx, { filCod: 2, frnCod: 3 })
                    .catch((e: unknown) => e);
                expect(erro).toBeInstanceOf(ConexosError);
                expect(s.authenticatedDeleteOnce).not.toHaveBeenCalled();
            });

            it('DELETE recusado ⇒ ConexosError determinística com a KEY, e para (cabeçalho não é apagado)', async () => {
                const { s, sessao: sx } = sessao();
                s.authenticatedGet.mockResolvedValueOnce({ frnCod: 5, frnVldFin: 0 });
                listas(s, [{ docTip: 2, docCod: 537, titCod: 1 }], []);
                s.authenticatedDeleteOnce.mockRejectedValueOnce(
                    recusa('FIN_070.EXISTEM_COMPOSICOES_DESSA_RENEGOCIACAO_PARA_ESTE_TITULO'),
                );
                const erro = await make()
                    .cancelarRenegociacao(sx, { filCod: 2, frnCod: 5 })
                    .catch((e: unknown) => e);
                expect(ConexosRenegociacaoClient.codigoErp(erro)).toBe(
                    'FIN_070.EXISTEM_COMPOSICOES_DESSA_RENEGOCIACAO_PARA_ESTE_TITULO',
                );
                expect(ConexosRenegociacaoClient.ehDeterministica(erro)).toBe(true);
                expect(s.authenticatedDeleteOnce).toHaveBeenCalledTimes(1);
            });

            it('escrita desligada ⇒ ConexosWriteDisabledError antes de qualquer chamada', async () => {
                const { s, sessao: sx } = sessao();
                await expect(
                    make({ conexosWriteEnabled: false }).cancelarRenegociacao(sx, {
                        filCod: 2,
                        frnCod: 5,
                    }),
                ).rejects.toBeInstanceOf(ConexosWriteDisabledError);
                expect(s.authenticatedGet).not.toHaveBeenCalled();
                expect(s.authenticatedDeleteOnce).not.toHaveBeenCalled();
            });
        });

        describe('renegociacaoDesfeita (releitura do cancelamento)', () => {
            it('ausente do fin070/list ⇒ true; presente e não cancelada ⇒ false; frnVldCan 1 ⇒ true', async () => {
                const { s, sessao: sx } = sessao();
                s.authenticatedPost
                    .mockResolvedValueOnce({ count: 1, rows: [{ frnCod: 3, frnVldFin: 1 }] })
                    .mockResolvedValueOnce({ count: 1, rows: [{ frnCod: 5, frnVldFin: 0 }] })
                    .mockResolvedValueOnce({ count: 1, rows: [{ frnCod: 5, frnVldCan: 1 }] });
                const c = make();
                expect(await c.renegociacaoDesfeita(sx, { filCod: 2, frnCod: 5 })).toBe(true);
                expect(await c.renegociacaoDesfeita(sx, { filCod: 2, frnCod: 5 })).toBe(false);
                expect(await c.renegociacaoDesfeita(sx, { filCod: 2, frnCod: 5 })).toBe(true);
                expect(s.authenticatedPost.mock.calls[0]?.[0]).toBe('/fin070/list');
            });

            it('leitura que falha ⇒ lança (nunca presume desfeita)', async () => {
                const { s, sessao: sx } = sessao();
                s.authenticatedPost.mockRejectedValue(recusa('X'));
                await expect(
                    make().renegociacaoDesfeita(sx, { filCod: 2, frnCod: 5 }),
                ).rejects.toBeInstanceOf(ConexosError);
            });
        });

        it('fin103: validaSelecionado e aplicarComando com { items: [linha lida + fbaCod] }', async () => {
            const { s, sessao: sx } = sessao();
            const linha = { filCod: 2, docCod: 536, titCod: 2, fblCod: 19, ftbCod: 7 };
            const c = make();
            await c.validarSelecionado(sx, { filCod: 2, linha, fbaCod: 3 });
            await c.aplicarComando(sx, { filCod: 2, linha, fbaCod: 3 });
            expect(s.authenticatedPostOnce.mock.calls).toEqual([
                ['/fin103/validaSelecionado', { items: [{ ...linha, fbaCod: 3 }] }, { filCod: 2 }],
                ['/fin103/aplicarComando', { items: [{ ...linha, fbaCod: 3 }] }, { filCod: 2 }],
            ]);
        });

        it('escrita desligada ⇒ ConexosWriteDisabledError ANTES de qualquer chamada', async () => {
            const { s, sessao: sx } = sessao();
            const c = make({ conexosWriteEnabled: false });
            await expect(
                c.criarRenegociacao(sx, { filCod: 2, pesCod: 1, dataRenegEpoch: HOJE, obs: 'X' }),
            ).rejects.toBeInstanceOf(ConexosWriteDisabledError);
            await expect(
                c.finalizarRenegociacao(sx, { filCod: 2, frnCod: 3 }),
            ).rejects.toBeInstanceOf(ConexosWriteDisabledError);
            expect(s.authenticatedPostOnce).not.toHaveBeenCalled();
            expect(s.authenticatedPutOnce).not.toHaveBeenCalled();
        });

        it('recusa do ERP ⇒ ConexosError determinística com a KEY preservada', async () => {
            const { s, sessao: sx } = sessao();
            s.authenticatedGet.mockResolvedValueOnce({ frnCod: 3 });
            s.authenticatedPutOnce.mockRejectedValueOnce(
                recusa('FIN_070.TIPO_OP_NAO_PERMITE_VALOR'),
            );
            const erro = await make()
                .aplicarAjuste(sx, { filCod: 2, frnCod: 3, frnMnyValor: 0.01, frnVldTpop: 1 })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(ConexosError);
            expect(ConexosRenegociacaoClient.codigoErp(erro)).toBe(
                'FIN_070.TIPO_OP_NAO_PERMITE_VALOR',
            );
            expect(ConexosRenegociacaoClient.ehDeterministica(erro)).toBe(true);
        });

        it('timeout/5xx ⇒ transitória', async () => {
            const { s, sessao: sx } = sessao();
            s.authenticatedPutOnce.mockRejectedValueOnce(
                Object.assign(new Error('502'), { response: { status: 502 } }),
            );
            const erro = await make()
                .finalizarRenegociacao(sx, { filCod: 2, frnCod: 3 })
                .catch((e: unknown) => e);
            expect(ConexosRenegociacaoClient.ehDeterministica(erro)).toBe(false);
        });
    });

    describe('leituras (Zod, passthrough)', () => {
        it('lerRenegociacao: cabeçalho + mnyValorTotal somado dos títulos', async () => {
            const { s, sessao: sx } = sessao();
            s.authenticatedGet.mockResolvedValueOnce({
                frnCod: 3,
                frnVldFin: 0,
                frnEspObs: 'AJC-1',
            });
            s.authenticatedPost.mockResolvedValueOnce({
                count: 1,
                rows: [{ docCod: 536, titCod: 1, mnyValorTotal: 53.54 }],
            });
            const r = await make().lerRenegociacao(sx, { filCod: 2, frnCod: 3 });
            expect(r).toEqual({
                frnCod: 3,
                finalizada: false,
                cancelada: false,
                obs: 'AJC-1',
                mnyValorTotal: 53.54,
                titulos: [{ docCod: '536', titCod: '1' }],
            });
        });

        it('buscarRenegociacaoPorMarcador: varre o fin070/list e casa o marcador na obs', async () => {
            const { s, sessao: sx } = sessao();
            s.authenticatedPost.mockResolvedValueOnce({
                count: 2,
                rows: [
                    { frnCod: 3, frnEspObs: 'AJUSTE CENTAVOS KAVEX AJC-OUTRO' },
                    { frnCod: 4, frnEspObs: 'AJUSTE CENTAVOS KAVEX AJC-ABC BOLETO 34191*9000' },
                ],
            });
            const r = await make().buscarRenegociacaoPorMarcador(sx, {
                filCod: 2,
                marcador: 'ajc-abc',
            });
            expect(r).toEqual([4]);
        });

        it('listarTitulosDoDocumento: fin064 por docCod, linha ilegível descartada', async () => {
            const { s, sessao: sx } = sessao();
            s.authenticatedPost.mockResolvedValueOnce({
                count: 2,
                rows: [
                    { docCod: 536, titCod: 2, totalLiquido: 53.54, vldLib: 0, titMnyJuros: 0.01 },
                    { semDoc: true },
                ],
            });
            const r = await make().listarTitulosDoDocumento(sx, { filCod: 2, docCod: '536' });
            expect(r).toHaveLength(1);
            expect(r[0]).toMatchObject({ docCod: '536', titCod: '2', totalLiquido: 53.54 });
            const [p, corpo] = s.authenticatedPost.mock.calls[0] ?? [];
            expect(p).toBe('/fin064/list');
            expect((corpo as { filterList: unknown }).filterList).toEqual({ 'docCod#EQ': '536' });
        });

        it('listarBloqueios e listarComandosDoBloqueio', async () => {
            const { s, sessao: sx } = sessao();
            s.authenticatedPost
                .mockResolvedValueOnce({
                    count: 1,
                    rows: [
                        { docCod: 536, titCod: 2, fblCod: 19, ftbVldStatus: 1, titMnyTotal: 53.54 },
                    ],
                })
                .mockResolvedValueOnce({
                    count: 2,
                    rows: [
                        { fbaCod: 3, fbaDesNome: 'APROVAR', fbaVldStatus: 1 },
                        { fbaCod: 4, fbaDesNome: 'REPROVAR', fbaTimCan: '2026-01-01' },
                    ],
                });
            const c = make();
            const b = await c.listarBloqueios(sx, { filCod: 2, docCod: '536' });
            expect(b[0]).toMatchObject({ fblCod: 19, titCod: '2', titMnyTotal: 53.54 });
            expect(b[0]?.row).toMatchObject({ fblCod: 19 });
            const cmds = await c.listarComandosDoBloqueio(sx, { filCod: 2, fblCod: 19 });
            expect(cmds).toEqual([
                { fbaCod: 3, nome: 'APROVAR', ativo: true },
                { fbaCod: 4, nome: 'REPROVAR', ativo: false },
            ]);
            expect(s.authenticatedPost.mock.calls[1]?.[0]).toBe('/fin106/finBloqCmd/list/19');
        });
    });

    it('nunca resolve a sessão pelo ConexosSessionResolver e não loga código de barras', () => {
        const fonte = readFileSync(path.join(__dirname, 'ConexosRenegociacaoClient.ts'), 'utf8');
        expect(fonte).not.toMatch(/ConexosSessionResolver|\.resolve\(\)/);
        expect(fonte).not.toMatch(/codbar|linhaDigitavel/i);
    });
});
