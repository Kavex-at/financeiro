import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import ConexosError from '../../errors/ConexosError.js';
import ItemEditadoPorTerceiroError from '../../errors/ItemEditadoPorTerceiroError.js';
import VinculoCodigoBarrasIncompletoError from '../../errors/VinculoCodigoBarrasIncompletoError.js';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../../libs/boleto/CodigoBarrasSintetico.js';
import ElegibilidadeVinculoCodigoBarras from '../../libs/boleto/ElegibilidadeVinculoCodigoBarras.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';
import VinculoCodigoBarrasService from './VinculoCodigoBarrasService.js';

const conv = new CodigoBarrasBoleto();
const VENC = '2026-10-20';
const VENC_EPOCH = Date.UTC(2026, 9, 20);
const BARRAS = CodigoBarrasSintetico.barras({ valor: 1028.8, vencimento: VENC, serie: 1 });
const LINHA = conv.paraLinhaDigitavel(BARRAS) as string;
const BARRAS_2 = CodigoBarrasSintetico.barras({ valor: 500, vencimento: VENC, serie: 2 });
const BARRAS_B = CodigoBarrasSintetico.barras({ valor: 1028.8, vencimento: VENC, serie: 3 });
const LINHA_2 = conv.paraLinhaDigitavel(BARRAS_2) as string;
const LOTE_ID = '00000000-0000-0000-0000-000000000001';
const CTX = { bncCod: 4, flpCod: 36 };
const MASCARA = `${BARRAS.slice(0, 5)}…${BARRAS.slice(-4)}`;

const rejeicao = () =>
    new ConexosError({
        endpoint: 'fin015/finItemSispag',
        cause: { response: { status: 400, data: { messages: [{ key: 'X' }] } } },
    });
const transitorio = () =>
    new ConexosError({
        endpoint: 'fin015/finItemSispag',
        cause: { response: { status: 503, data: {} } },
    });

const itemLote = (doc: string, over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: LOTE_ID,
    filCod: 2,
    docCod: doc,
    titCod: '1',
    credor: 'ACME',
    valor: 1028.8,
    vencimento: VENC_EPOCH,
    modalidade: 'BOLETO',
    incluidoPor: 'ana',
    divergencia: false,
    ...over,
});

const nativo = (doc: string, seq: number, over: Record<string, unknown> = {}) => ({
    filCod: 2,
    docCod: Number(doc),
    titCod: 1,
    bncCod: 4,
    flpCod: 36,
    itsCodSeq: seq,
    itsVldModalidade: 6,
    itsNumCodbar: null,
    itsNumBanco: 0,
    bncDesNome: null,
    itsMnyVlrPgto: 1028.8,
    itsDtaPgto: VENC_EPOCH,
    titDtaVencimento: VENC_EPOCH,
    vldVinculoDda: 0,
    ...over,
});

interface Cenario {
    itens: ItemLote[];
    rascunho: Array<Record<string, unknown>>;
    /** Resultados do `PUT` (por chamada) — default: aplica a edição na row e responde ok. */
    put?: (corpo: Record<string, unknown>) => Promise<void>;
    aberto?: number | 'falha';
    decisoes?: Array<Record<string, unknown>>;
    pares?: Array<Record<string, unknown>>;
    boletoPool?: Record<string, Record<string, unknown> | null>;
    modo?: string;
    live?: boolean;
}

const build = (c: Cenario) => {
    const rascunho = c.rascunho.map((r) => ({ ...r }));
    const ordem: string[] = [];
    const eventos: Array<Record<string, unknown>> = [];

    const write = {
        lerItensDoRascunho: jest.fn(async () => {
            ordem.push('ler');
            return {
                completa: true,
                itens: rascunho.map((row) => ({
                    filCod: Number(row.filCod),
                    docCod: String(row.docCod),
                    titCod: String(row.titCod),
                    itsCodSeq: Number(row.itsCodSeq),
                    row: { ...row },
                })),
            };
        }),
        validarCodigoBarras: jest.fn(
            async (
                _p: { modalidade: number } = { modalidade: 0 },
            ): Promise<{
                splitCodBar: unknown;
                barraVlrPgto: number;
                barraDtaVencimento: number;
            }> => {
                ordem.push('validar');
                return {
                    splitCodBar: { c: 1 },
                    barraVlrPgto: 1028.8,
                    barraDtaVencimento: VENC_EPOCH,
                };
            },
        ),
        confirmarCodigoBarras: jest.fn(async (_p: { modalidade: number } = { modalidade: 0 }) => {
            ordem.push('confirmar');
            return {
                itsMnyVlrPgtoResult: 1028.8,
                itsDtaPgtoResult: VENC_EPOCH,
                itsBncNumCodbancoResult: 341,
                itsBncDesNomeResult: 'ITAU UNIBANCO S.A.',
            };
        }),
        editarItemDoRascunho: jest.fn(
            async (p: { item: Record<string, unknown>; alteracoes: Record<string, unknown> }) => {
                ordem.push('editar');
                if (c.put) {
                    await c.put({ ...p.item, ...p.alteracoes });
                    return;
                }
                const alvo = rascunho.find((r) => r.itsCodSeq === p.item.itsCodSeq);
                if (alvo) Object.assign(alvo, p.alteracoes);
            },
        ),
    };
    const sispag = {
        lerTotalAberto: jest.fn(async () =>
            c.aberto === 'falha'
                ? { legivel: false as const, motivo: 'falha' }
                : { legivel: true as const, totalAberto: c.aberto ?? 1028.8 },
        ),
    };
    const loteRepo = {
        gravarVinculoCodigoBarras: jest.fn(async () => {
            ordem.push('gravar');
            return true;
        }),
    };
    const decisoes = c.decisoes ?? [
        {
            id: 'dec-1',
            filCod: 2,
            docCod: '636',
            titCod: '1',
            ddcCod: 10,
            ditCod: 3,
            decisao: 'CONFIRMADA',
            confirmacaoEmissorId: 'par-1',
            pesCod: '7001',
        },
    ];
    const sugestoes = {
        listarDecisoes: jest.fn(async () => decisoes),
        listarParesVigentes: jest.fn(async () => c.pares ?? [{ id: 'par-1', estado: 'VIGENTE' }]),
        registrarEventoVinculo: jest.fn(async (e: Record<string, unknown>) => {
            eventos.push(e);
            if (e.tipo === 'VINCULO_APLICADO') ordem.push('evento-aplicado');
            return { inserido: true };
        }),
        existeVinculoAplicado: jest.fn(async () => false),
    };
    const boletos = {
        buscarPorChave: jest.fn(async (k: { ddcCod: number; ditCod: number }) => {
            const chave = `${k.ddcCod}:${k.ditCod}`;
            if (c.boletoPool && chave in c.boletoPool) return c.boletoPool[chave];
            return { ddcCod: 10, ditCod: 3, valor: 1028.8, vencimento: VENC, codbar: BARRAS };
        }),
    };
    const titulos = {
        buscarPorChave: jest.fn(async () => ({
            filCod: 2,
            docCod: '636',
            titCod: '1',
            valor: 1028.8,
            vencimento: VENC_EPOCH,
            pesCod: '7001',
            ativo: true,
            pago: false,
            liberado: true,
        })),
    };
    const db = {
        withTransaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({ tx: true })),
    };
    const env = {
        getEnvironmentVars: jest.fn(async () => ({
            sispagBindCodbarFiliais: c.modo ?? '2:on',
            sispagLiveWriteEnabled: c.live ?? true,
        })),
    };
    const logs: unknown[] = [];
    const log = {
        info: jest.fn(async (x: unknown) => void logs.push(x)),
        warn: jest.fn(async (x: unknown) => void logs.push(x)),
        error: jest.fn(async (x: unknown) => void logs.push(x)),
    };
    const service = new VinculoCodigoBarrasService(
        write as unknown as ConexosSispagWriteClient,
        sispag as unknown as ConexosSispagClient,
        loteRepo as unknown as LotePagamentoRepository,
        sugestoes as unknown as SugestaoBoletoRepository,
        boletos as unknown as BoletoDdaRepository,
        titulos as unknown as TituloAPagarRepository,
        new ElegibilidadeVinculoCodigoBarras(conv),
        new RegraSugestaoBoleto(),
        conv,
        new BankingCalendar(),
        env as unknown as EnvironmentProvider,
        log as unknown as LogService,
        db as unknown as PostgreeDatabaseClient,
    );
    const lote = {
        id: LOTE_ID,
        filCod: 2,
        status: 'FINALIZADO',
        versao: 5,
        dataDebito: VENC,
        itens: c.itens,
    } as unknown as LotePagamento;
    return {
        service,
        lote,
        write,
        sispag,
        loteRepo,
        sugestoes,
        boletos,
        db,
        ordem,
        eventos,
        logs,
        rascunho,
    };
};

const umItem = (over: Partial<Cenario> = {}) =>
    build({
        itens: [itemLote('636')],
        rascunho: [nativo('636', 91)],
        ...over,
    });

describe('VinculoCodigoBarrasService.executar (I17e–I17h)', () => {
    it('caminho feliz: ler → validar → confirmar → PUT → releitura; persiste só DEPOIS da releitura', async () => {
        const h = umItem();
        const r = await h.service.executar({ lote: h.lote, ...CTX });
        // `ler` extra: a releitura IMEDIATAMENTE antes do PUT (o ERP não tem lock otimista, V3).
        expect(h.ordem).toEqual([
            'ler',
            'validar',
            'confirmar',
            'ler',
            'editar',
            'ler',
            'gravar',
            'evento-aplicado',
        ]);
        expect(r.vinculados).toHaveLength(1);
        expect(r.vinculados[0]).toMatchObject({
            titulo: { filCod: 2, docCod: '636', titCod: '1' },
            codigoMascarado: MASCARA,
            decisaoId: 'dec-1',
        });
        expect(r.retirar).toEqual([]);
        // O PUT carrega o item lido com a linha digitável e os campos do confirma.
        const put = h.write.editarItemDoRascunho.mock.calls[0]?.[0];
        expect(put?.alteracoes).toEqual({
            itsNumCodbar: LINHA,
            itsNumBanco: 341,
            bncDesNome: 'ITAU UNIBANCO S.A.',
            itsMnyVlrPgto: 1028.8,
            itsDtaPgto: VENC_EPOCH,
        });
        expect(h.loteRepo.gravarVinculoCodigoBarras).toHaveBeenCalledWith(
            expect.objectContaining({
                loteId: LOTE_ID,
                docCod: '636',
                origem: 'DECISAO_HUMANA',
                decisaoId: 'dec-1',
                codigoMascarado: MASCARA,
                flpCod: 36,
            }),
            expect.anything(),
        );
    });

    describe('modalidade do item (HML V4)', () => {
        it('banco do código = banco do lote (341): modalidade 6, sem o 6º campo no PUT', async () => {
            const h = umItem();
            await h.service.executar({ lote: h.lote, ...CTX, bancoLote: 341 });
            const validar = h.write.validarCodigoBarras.mock.calls[0]?.[0] as {
                modalidade: number;
            };
            expect(validar.modalidade).toBe(6);
            const put = h.write.editarItemDoRascunho.mock.calls[0]?.[0];
            expect(put?.alteracoes).not.toHaveProperty('itsVldModalidade');
        });

        it('banco do código ≠ banco do lote: modalidade 7 na validação, no confirma E no item', async () => {
            const barras237 = CodigoBarrasSintetico.barras({
                valor: 1028.8,
                vencimento: VENC,
                banco: '237',
                serie: 5,
            });
            const h = umItem({
                boletoPool: {
                    '10:3': {
                        ddcCod: 10,
                        ditCod: 3,
                        valor: 1028.8,
                        vencimento: VENC,
                        codbar: barras237,
                    },
                },
            });
            h.write.confirmarCodigoBarras.mockResolvedValueOnce({
                itsMnyVlrPgtoResult: 1028.8,
                itsDtaPgtoResult: VENC_EPOCH,
                itsBncNumCodbancoResult: 237,
                itsBncDesNomeResult: 'BRADESCO',
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX, bancoLote: 341 });
            expect(r.vinculados).toHaveLength(1);
            const validar = h.write.validarCodigoBarras.mock.calls[0]?.[0] as {
                modalidade: number;
            };
            const confirmar = h.write.confirmarCodigoBarras.mock.calls[0]?.[0] as {
                modalidade: number;
            };
            expect(validar.modalidade).toBe(7);
            expect(confirmar.modalidade).toBe(7);
            const put = h.write.editarItemDoRascunho.mock.calls[0]?.[0];
            expect(put?.alteracoes).toMatchObject({ itsNumBanco: 237, itsVldModalidade: 7 });
        });

        it('sem `bancoLote` a modalidade da linha é mantida (compat.)', async () => {
            const h = umItem({ rascunho: [nativo('636', 91, { itsVldModalidade: 7 })] });
            await h.service.executar({ lote: h.lote, ...CTX });
            const validar = h.write.validarCodigoBarras.mock.calls[0]?.[0] as {
                modalidade: number;
            };
            expect(validar.modalidade).toBe(7);
        });
    });

    it('edição de terceiro ENTRE a leitura e o PUT: a releitura imediata a pega e nada é sobrescrito', async () => {
        const h = umItem();
        // A 1ª leitura vê o item sem código; a 2ª (antes do PUT) já traz um código de outra pessoa.
        const outro = conv.paraLinhaDigitavel(
            CodigoBarrasSintetico.barras({ valor: 7, vencimento: VENC, serie: 9 }),
        );
        let leituras = 0;
        const original = h.write.lerItensDoRascunho.getMockImplementation();
        h.write.lerItensDoRascunho.mockImplementation(async (...a: unknown[]) => {
            leituras += 1;
            if (leituras === 2) h.rascunho[0] = { ...h.rascunho[0], itsNumCodbar: outro };
            return (original as (...x: unknown[]) => Promise<unknown>)(...a) as never;
        });
        const erro = await h.service.executar({ lote: h.lote, ...CTX }).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(ItemEditadoPorTerceiroError);
        expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
    });

    describe('o sucesso é a OBSERVAÇÃO na releitura, não o status do PUT', () => {
        it('PUT responde 200 mas a releitura não mostra o código ⇒ NÃO é sucesso', async () => {
            const h = umItem({ put: async () => undefined });
            const erro = await h.service
                .executar({ lote: h.lote, ...CTX })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(VinculoCodigoBarrasIncompletoError);
            expect(h.loteRepo.gravarVinculoCodigoBarras).not.toHaveBeenCalled();
            expect(h.eventos.filter((e) => e.tipo === 'VINCULO_APLICADO')).toHaveLength(0);
        });

        it('PUT falha (timeout/5xx) mas a releitura mostra o esperado ⇒ SUCESSO', async () => {
            const h = umItem();
            h.write.editarItemDoRascunho.mockImplementationOnce(async (p) => {
                const alvo = h.rascunho.find((r) => r.itsCodSeq === p.item.itsCodSeq);
                if (alvo) Object.assign(alvo, p.alteracoes);
                throw transitorio();
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.vinculados).toHaveLength(1);
            expect(h.loteRepo.gravarVinculoCodigoBarras).toHaveBeenCalledTimes(1);
        });
    });

    it('decisão e boleto são relidos do banco no momento: decisão anulada ⇒ item retirado, sem PUT', async () => {
        // 636 mantém a decisão; 637 foi ANULADA entre o import e o vínculo (o banco de agora não a tem).
        const h = build({
            itens: [itemLote('636'), itemLote('637')],
            rascunho: [nativo('636', 91), nativo('637', 92)],
        });
        const r = await h.service.executar({ lote: h.lote, ...CTX });
        expect(r.vinculados.map((v) => v.titulo.docCod)).toEqual(['636']);
        expect(r.retirar).toHaveLength(1);
        expect(r.retirar[0]).toMatchObject({ titulo: { docCod: '637' }, motivo: 'SEM_DECISAO' });
        expect(h.write.editarItemDoRascunho).toHaveBeenCalledTimes(1);
        expect(h.sugestoes.listarDecisoes).toHaveBeenCalled();
    });

    it('lote com mais de 500 itens: o vínculo ABORTA (retomável), nunca retira, nenhuma chamada ao ERP', async () => {
        const itens = Array.from({ length: 501 }, (_v, i) => itemLote(String(700 + i)));
        itens[0] = itemLote('636');
        const h = build({ itens, rascunho: [nativo('636', 91)] });
        const erro = await h.service.executar({ lote: h.lote, ...CTX }).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(VinculoCodigoBarrasIncompletoError);
        expect((erro as VinculoCodigoBarrasIncompletoError).details).toMatchObject({
            causa: 'LOTE_ACIMA_DE_500_ITENS',
        });
        for (const fn of Object.values(h.write)) expect(fn).not.toHaveBeenCalled();
        expect(h.loteRepo.gravarVinculoCodigoBarras).not.toHaveBeenCalled();
    });

    it('lote SEM nenhuma decisão confirmada: nenhuma chamada ao client, nenhum evento', async () => {
        const h = umItem({ decisoes: [] });
        const r = await h.service.executar({ lote: h.lote, ...CTX });
        expect(r).toMatchObject({ vinculados: [], retirar: [] });
        for (const fn of Object.values(h.write)) expect(fn).not.toHaveBeenCalled();
        expect(h.sispag.lerTotalAberto).not.toHaveBeenCalled();
        expect(h.sugestoes.registrarEventoVinculo).not.toHaveBeenCalled();
        expect(h.loteRepo.gravarVinculoCodigoBarras).not.toHaveBeenCalled();
    });

    describe('verificações nossas pós-confirma (I17d 3–6): divergência ⇒ retira SEM PUT', () => {
        it('banco do código ≠ banco do confirm', async () => {
            const h = umItem();
            h.write.confirmarCodigoBarras.mockResolvedValueOnce({
                itsMnyVlrPgtoResult: 1028.8,
                itsDtaPgtoResult: VENC_EPOCH,
                itsBncNumCodbancoResult: 237,
                itsBncDesNomeResult: 'BRADESCO',
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.retirar[0]).toMatchObject({ campo: 'BANCO' });
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });

        it('valor decodificado pelo ERP ≠ aberto', async () => {
            const h = umItem();
            h.write.validarCodigoBarras.mockResolvedValueOnce({
                splitCodBar: {},
                barraVlrPgto: 1028.81,
                barraDtaVencimento: VENC_EPOCH,
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.retirar[0]).toMatchObject({ campo: 'VALOR' });
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });

        it('data do confirm ≠ data da barra', async () => {
            const h = umItem();
            h.write.confirmarCodigoBarras.mockResolvedValueOnce({
                itsMnyVlrPgtoResult: 1028.8,
                itsDtaPgtoResult: VENC_EPOCH + 86_400_000,
                itsBncNumCodbancoResult: 341,
                itsBncDesNomeResult: 'ITAU',
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.retirar[0]).toMatchObject({ campo: 'DATA' });
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });

        it('juros/desconto ≠ 0 (itsMnyVlrPgtoResult ≠ valor do boleto)', async () => {
            const h = umItem();
            h.write.confirmarCodigoBarras.mockResolvedValueOnce({
                itsMnyVlrPgtoResult: 1028.82,
                itsDtaPgtoResult: VENC_EPOCH,
                itsBncNumCodbancoResult: 341,
                itsBncDesNomeResult: 'ITAU',
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.retirar[0]).toMatchObject({ campo: 'JUROS_DESCONTO' });
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });
    });

    describe('idempotência e terceiros (I17f)', () => {
        it('item já com o código esperado e valor/data coerentes: nenhuma chamada nova, nenhum evento duplicado', async () => {
            const h = umItem({
                rascunho: [nativo('636', 91, { itsNumCodbar: LINHA, itsNumBanco: 341 })],
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.vinculados).toHaveLength(1);
            expect(h.write.validarCodigoBarras).not.toHaveBeenCalled();
            expect(h.write.confirmarCodigoBarras).not.toHaveBeenCalled();
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
            // O evento é único por (lote, título, decisão): a tentativa repetida não insere.
            h.sugestoes.registrarEventoVinculo.mockResolvedValue({ inserido: false });
            await h.service.executar({ lote: h.lote, ...CTX });
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });

        it('itsNumCodbar diferente do esperado ⇒ ItemEditadoPorTerceiroError; nada sobrescrito nem retirado', async () => {
            const outro = conv.paraLinhaDigitavel(
                CodigoBarrasSintetico.barras({ valor: 7, vencimento: VENC, serie: 9 }),
            );
            const h = umItem({ rascunho: [nativo('636', 91, { itsNumCodbar: outro })] });
            const erro = await h.service
                .executar({ lote: h.lote, ...CTX })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(ItemEditadoPorTerceiroError);
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });

        it('código igual mas valor/data diferentes do que gravaríamos ⇒ terceiro', async () => {
            const h = umItem({
                rascunho: [
                    nativo('636', 91, {
                        itsNumCodbar: LINHA,
                        itsNumBanco: 341,
                        itsMnyVlrPgto: 999,
                    }),
                ],
            });
            const erro = await h.service
                .executar({ lote: h.lote, ...CTX })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(ItemEditadoPorTerceiroError);
        });

        it('item associado ao DDA pelo ERP (vldVinculoDda = 1) não é tocado', async () => {
            const h = umItem({
                rascunho: [nativo('636', 91, { itsNumCodbar: LINHA_2, vldVinculoDda: 1 })],
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.vinculados).toEqual([]);
            expect(r.retirar).toEqual([]);
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });
    });

    describe('matriz de falha (I17g)', () => {
        it('validação OK + confirma transitório ⇒ Incompleto (sem PUT, nunca retira)', async () => {
            const h = umItem();
            h.write.confirmarCodigoBarras.mockRejectedValueOnce(transitorio());
            const erro = await h.service
                .executar({ lote: h.lote, ...CTX })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(VinculoCodigoBarrasIncompletoError);
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });

        it('PUT recusado (4xx de negócio) e a releitura não mostra ⇒ determinístico: retira', async () => {
            const h = umItem({
                put: async () => {
                    throw rejeicao();
                },
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.retirar).toHaveLength(1);
            expect(r.retirar[0]).toMatchObject({
                titulo: { docCod: '636' },
                itsCodSeq: 91,
                codigoMascarado: MASCARA,
            });
            expect(h.eventos.some((e) => e.tipo === 'VINCULO_FALHOU')).toBe(true);
            expect(h.loteRepo.gravarVinculoCodigoBarras).not.toHaveBeenCalled();
        });

        it.each([
            ['timeout/5xx no PUT', 'put'],
            ['leitura da lista falha', 'ler'],
        ])('%s ⇒ Incompleto, NUNCA retira', async (_n, onde) => {
            const h = umItem({
                put:
                    onde === 'put'
                        ? async () => {
                              throw transitorio();
                          }
                        : undefined,
            });
            if (onde === 'ler') {
                h.write.lerItensDoRascunho.mockRejectedValueOnce(transitorio());
            }
            const erro = await h.service
                .executar({ lote: h.lote, ...CTX })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(VinculoCodigoBarrasIncompletoError);
        });

        it('leitura incompleta (truncada) ⇒ Incompleto', async () => {
            const h = umItem();
            h.write.lerItensDoRascunho.mockResolvedValueOnce({ completa: false, itens: [] });
            const erro = await h.service
                .executar({ lote: h.lote, ...CTX })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(VinculoCodigoBarrasIncompletoError);
        });

        it('`totalAberto` indisponível ⇒ FAIL-CLOSED: nada é vinculado, nem retirado', async () => {
            const h = umItem({ aberto: 'falha' });
            const erro = await h.service
                .executar({ lote: h.lote, ...CTX })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(VinculoCodigoBarrasIncompletoError);
            expect(h.write.validarCodigoBarras).not.toHaveBeenCalled();
            expect(h.write.editarItemDoRascunho).not.toHaveBeenCalled();
        });

        it('código já presente em outro item do rascunho ⇒ não vincula e retira (I17g(3))', async () => {
            const h = build({
                itens: [itemLote('636'), itemLote('700')],
                rascunho: [nativo('636', 91), nativo('700', 92, { itsNumCodbar: LINHA })],
                decisoes: [
                    {
                        id: 'dec-1',
                        filCod: 2,
                        docCod: '636',
                        titCod: '1',
                        ddcCod: 10,
                        ditCod: 3,
                        decisao: 'CONFIRMADA',
                        confirmacaoEmissorId: 'par-1',
                        pesCod: '7001',
                    },
                ],
            });
            const r = await h.service.executar({ lote: h.lote, ...CTX });
            expect(r.retirar).toHaveLength(1);
            expect(r.retirar[0]).toMatchObject({ campo: 'CODIGO_REPETIDO' });
            expect(h.write.validarCodigoBarras).not.toHaveBeenCalled();
        });
    });

    it('em SÉRIE: falha transitória no item 2 mantém o item 1 vinculado (parcial persistido)', async () => {
        const decisao = (doc: string, id: string, dit: number) => ({
            id,
            filCod: 2,
            docCod: doc,
            titCod: '1',
            ddcCod: 10,
            ditCod: dit,
            decisao: 'CONFIRMADA',
            confirmacaoEmissorId: 'par-1',
            pesCod: '7001',
        });
        const h = build({
            itens: [itemLote('636'), itemLote('637')],
            rascunho: [nativo('636', 91), nativo('637', 92)],
            decisoes: [decisao('636', 'dec-1', 3), decisao('637', 'dec-2', 4)],
            boletoPool: {
                '10:4': {
                    ddcCod: 10,
                    ditCod: 4,
                    valor: 1028.8,
                    vencimento: VENC,
                    codbar: BARRAS_B,
                },
            },
        });
        h.write.confirmarCodigoBarras
            .mockResolvedValueOnce({
                itsMnyVlrPgtoResult: 1028.8,
                itsDtaPgtoResult: VENC_EPOCH,
                itsBncNumCodbancoResult: 341,
                itsBncDesNomeResult: 'ITAU',
            })
            .mockRejectedValueOnce(transitorio());
        const erro = (await h.service
            .executar({ lote: h.lote, ...CTX })
            .catch((e: unknown) => e)) as VinculoCodigoBarrasIncompletoError;
        expect(erro).toBeInstanceOf(VinculoCodigoBarrasIncompletoError);
        expect(h.loteRepo.gravarVinculoCodigoBarras).toHaveBeenCalledTimes(1);
        const d = erro.details as {
            vinculados: Array<{ docCod: string }>;
            pendentes: Array<{ docCod: string }>;
        };
        expect(d.vinculados.map((v) => v.docCod)).toEqual(['636']);
        expect(d.pendentes.map((v) => v.docCod)).toEqual(['637']);
        // Série, nunca paralelo: a 2ª validação só começa depois do PUT do 1º item.
        const iPut = h.ordem.indexOf('editar');
        const iSegundaValidacao = h.ordem.lastIndexOf('validar');
        expect(iSegundaValidacao).toBeGreaterThan(iPut);
    });
});

describe('VinculoCodigoBarrasService — modos', () => {
    it('`shadow`: ZERO chamadas ao client; grava VINCULO_SIMULADO e devolve a previsão', async () => {
        const h = umItem({ modo: '2:shadow' });
        const modo = await h.service.resolverModo(2);
        expect(modo).toBe('shadow');
        const previsoes = await h.service.prever(h.lote, { registrar: true });
        expect(previsoes).toHaveLength(1);
        expect(previsoes[0]).toMatchObject({ elegivel: true, codigoMascarado: MASCARA });
        for (const fn of Object.values(h.write)) expect(fn).not.toHaveBeenCalled();
        expect(h.sispag.lerTotalAberto).not.toHaveBeenCalled();
        expect(h.eventos).toHaveLength(1);
        expect(h.eventos[0]).toMatchObject({ tipo: 'VINCULO_SIMULADO', loteId: LOTE_ID });
    });

    it('`prever` sem `registrar` (endpoint/dry-run) não grava NADA', async () => {
        const h = umItem({ modo: '2:shadow' });
        await h.service.prever(h.lote);
        expect(h.sugestoes.registrarEventoVinculo).not.toHaveBeenCalled();
        expect(h.eventos).toHaveLength(0);
    });

    it('`off`: nada é avaliado nem gravado', async () => {
        const h = umItem({ modo: '' });
        expect(await h.service.resolverModo(2)).toBe('off');
        const mapa = await h.service.avaliarParaImport(h.lote, 'off');
        expect(mapa.size).toBe(0);
        expect(h.sugestoes.registrarEventoVinculo).not.toHaveBeenCalled();
    });

    it('kill-switch sispagLiveWriteEnabled=false derruba o modo `on`', async () => {
        const h = umItem({ modo: '2:on', live: false });
        expect(await h.service.resolverModo(2)).toBe('off');
    });

    it('`on` pré-import lê o aberto AO VIVO (leitura) e devolve a elegibilidade por chave', async () => {
        const h = umItem({ modo: '2:on' });
        const mapa = await h.service.avaliarParaImport(h.lote, 'on');
        expect(h.sispag.lerTotalAberto).toHaveBeenCalledTimes(1);
        expect(mapa.get('2:636:1')).toMatchObject({ elegivel: true });
        for (const fn of Object.values(h.write)) expect(fn).not.toHaveBeenCalled();
    });

    it('`on` pré-import: aberto ao vivo diferente ⇒ inelegível (VALOR_DIFERENTE)', async () => {
        const h = umItem({ modo: '2:on', aberto: 1000 });
        const mapa = await h.service.avaliarParaImport(h.lote, 'on');
        expect(mapa.get('2:636:1')).toMatchObject({
            elegivel: false,
            motivo: 'VALOR_DIFERENTE',
        });
    });

    it('`on` pré-import: leitura do aberto falha ⇒ inelegível (fail-closed, sem fallback)', async () => {
        const h = umItem({ modo: '2:on', aberto: 'falha' });
        const mapa = await h.service.avaliarParaImport(h.lote, 'on');
        expect(mapa.get('2:636:1')).toMatchObject({
            elegivel: false,
            motivo: 'VALOR_ABERTO_INDISPONIVEL',
        });
    });
});

describe('VinculoCodigoBarrasService — decisão humana e privacidade', () => {
    it('`chavesComDecisaoHumana`: só decisão CONFIRMADA com par VIGENTE', async () => {
        const h = umItem();
        expect([...(await h.service.chavesComDecisaoHumana(h.lote))]).toEqual(['2:636:1']);
        const semPar = umItem({ pares: [] });
        expect((await semPar.service.chavesComDecisaoHumana(semPar.lote)).size).toBe(0);
    });

    it('`existemVinculaveis`: decisão vigente sem vínculo no lote local ⇒ true; já vinculado ⇒ false', async () => {
        const h = umItem();
        expect(await h.service.existemVinculaveis(h.lote)).toBe(true);
        const vinculado = umItem({
            itens: [
                itemLote('636', {
                    vinculoCodigoBarras: {
                        origem: 'DECISAO_HUMANA',
                        decisaoId: 'dec-1',
                        codigoMascarado: MASCARA,
                        aplicadoEm: '2026-10-14T12:00:00.000Z',
                        flpCod: 36,
                    },
                }),
            ],
        });
        expect(await vinculado.service.existemVinculaveis(vinculado.lote)).toBe(false);
        const semPar = umItem({ pares: [] });
        expect(await semPar.service.existemVinculaveis(semPar.lote)).toBe(false);
    });

    it('nenhum log, evento, argumento de gravação ou erro carrega 44 dígitos nem a linha de 47', async () => {
        const h = umItem();
        h.write.confirmarCodigoBarras.mockResolvedValueOnce({
            itsMnyVlrPgtoResult: 1028.8,
            itsDtaPgtoResult: VENC_EPOCH,
            itsBncNumCodbancoResult: 237,
            itsBncDesNomeResult: 'X',
        });
        const r = await h.service.executar({ lote: h.lote, ...CTX });
        const h2 = umItem({ put: async () => undefined });
        const erro = await h2.service
            .executar({ lote: h2.lote, ...CTX })
            .catch((e: unknown) => e as Error);
        const tudo = JSON.stringify([
            r,
            h.logs,
            h.eventos,
            h.loteRepo.gravarVinculoCodigoBarras.mock.calls,
            h2.logs,
            h2.eventos,
            h2.loteRepo.gravarVinculoCodigoBarras.mock.calls,
            (erro as Error).message,
            (erro as { userMessage?: string }).userMessage,
            (erro as { details?: unknown }).details,
        ]);
        expect(tudo).not.toContain(BARRAS);
        expect(tudo).not.toContain(LINHA);
        expect(tudo).not.toMatch(/\d{20,}/);
    });
});
