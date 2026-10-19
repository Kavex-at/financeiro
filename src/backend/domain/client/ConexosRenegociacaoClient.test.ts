import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ConexosError from '../errors/ConexosError.js';
import ConexosWriteDisabledError from '../errors/ConexosWriteDisabledError.js';
import NotImplementedError from '../errors/NotImplementedError.js';
import type { SessaoConexos } from '../interface/sispag/RenegociacaoInterface.js';
import type EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import ConexosRenegociacaoClient, {
    CANCELAMENTO_FIN070_PROVADO,
} from './ConexosRenegociacaoClient.js';

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

describe('ConexosRenegociacaoClient (ADR-0073, I18c–e)', () => {
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

        it('cancelarRenegociacao: NotImplementedError até o portão G3 provar a rota', async () => {
            const { s, sessao: sx } = sessao();
            expect(CANCELAMENTO_FIN070_PROVADO).toBe(false);
            await expect(
                make().cancelarRenegociacao(sx, { filCod: 2, frnCod: 3 }),
            ).rejects.toBeInstanceOf(NotImplementedError);
            expect(s.authenticatedPutOnce).not.toHaveBeenCalled();
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
