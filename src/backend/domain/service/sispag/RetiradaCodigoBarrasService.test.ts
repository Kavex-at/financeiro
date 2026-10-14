import 'reflect-metadata';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import BoletoCodigoBarrasRetiradaIncompletaError from '../../errors/BoletoCodigoBarrasRetiradaIncompletaError.js';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import AnaliseCodigoBarrasRepetido from '../../libs/boleto/AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../../libs/boleto/CodigoBarrasSintetico.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import type LogService from '../LogService.js';
import RetiradaCodigoBarrasService from './RetiradaCodigoBarrasService.js';

const conv = new CodigoBarrasBoleto();
const DIA = 86_400_000;
const BASE = Date.UTC(2026, 9, 20);
const LINHA_A = CodigoBarrasSintetico.linhaDigitavel({
    valor: 100,
    vencimento: '2026-10-20',
    serie: 1,
});
const LINHA_B = CodigoBarrasSintetico.linhaDigitavel({
    valor: 200,
    vencimento: '2026-10-20',
    serie: 2,
});
const MASCARA_A = `${(conv.paraBarras(LINHA_A) as string).slice(0, 5)}…${(conv.paraBarras(LINHA_A) as string).slice(-4)}`;
const CTX = { bncCod: 4, flpCod: 36 };

const item = (doc: string, over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L1',
    filCod: 2,
    docCod: doc,
    titCod: '1',
    credor: 'ACME',
    valor: 100,
    vencimento: BASE,
    modalidade: 'BOLETO',
    incluidoPor: 'ana',
    divergencia: false,
    ...over,
});

const lote = (itens: ItemLote[]): LotePagamento =>
    ({ id: 'L1', filCod: 2, status: 'FINALIZADO', versao: 4, itens }) as unknown as LotePagamento;

interface Nativo {
    docCod: string;
    seq: number;
    linha?: string;
}

const build = (o: {
    nativos: Nativo[];
    lote: LotePagamento;
    marcas?: Array<Record<string, unknown>>;
    retirados?: string[];
}) => {
    const estado = [...o.nativos];
    const removidos: number[] = [];
    const write = {
        listarLinhasDigitaveisDoLote: jest.fn(async () => {
            const comCodigo = estado.filter((n) => n.linha !== undefined);
            const semCodigo = estado.filter((n) => n.linha === undefined);
            return {
                itens: comCodigo.map((n) => ({
                    docCod: n.docCod,
                    titCod: '1',
                    linhaDigitavel: n.linha as string,
                    filCod: 2,
                    itsCodSeq: n.seq,
                })),
                total: comCodigo.length,
                dropped: 0,
                completa: true,
                ...(semCodigo.length > 0
                    ? {
                          semCodigo: semCodigo.map((n) => ({
                              docCod: n.docCod,
                              titCod: '1',
                              filCod: 2,
                              itsCodSeq: n.seq,
                          })),
                      }
                    : {}),
            };
        }),
        removerItemDoRascunho: jest.fn(async (p: { itsCodSeq: number }) => {
            removidos.push(p.itsCodSeq);
            const i = estado.findIndex((n) => n.seq === p.itsCodSeq);
            if (i >= 0) estado.splice(i, 1);
        }),
    };
    let atual = o.lote;
    const retirados: Array<Record<string, unknown>> = [];
    const loteRepo = {
        retirarItemPorCodigoDeBarras: jest.fn(async (p: Record<string, unknown>) => {
            retirados.push(p);
            atual = {
                ...atual,
                itens: atual.itens.filter((i) => i.docCod !== p.docCod),
            } as LotePagamento;
            return { removido: true };
        }),
        getLoteComItens: jest.fn(async () => atual),
    };
    const db = { withTransaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})) };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const bloqueios = { listAtivosPorOrigem: jest.fn().mockResolvedValue(o.marcas ?? []) };
    const eventos = {
        listarChavesRetiradasPeloSistema: jest.fn().mockResolvedValue(new Set(o.retirados ?? [])),
    };
    const service = new RetiradaCodigoBarrasService(
        write as unknown as ConexosSispagWriteClient,
        loteRepo as unknown as LotePagamentoRepository,
        db as unknown as PostgreeDatabaseClient,
        new AnaliseCodigoBarrasRepetido(conv),
        log as unknown as LogService,
        bloqueios as unknown as BloqueioDuplicidadeRepository,
        eventos as unknown as VerificacaoEventoRepository,
    );
    return { service, write, loteRepo, retirados, removidos, log };
};

describe('RetiradaCodigoBarrasService — vínculo falho (ADR-0071, I17g(3))', () => {
    it('retira o item cujo vínculo falhou: local primeiro, DELETE com o itsCodSeq da leitura, ausência observada', async () => {
        const l = lote([item('636'), item('700')]);
        const h = build({
            lote: l,
            nativos: [
                { docCod: '636', seq: 91 }, // sem código: o vínculo falhou
                { docCod: '700', seq: 92, linha: LINHA_B },
            ],
        });
        const r = await h.service.garantir({
            lote: l,
            ...CTX,
            rascunhoAberto: true,
            retiradosPeloVinculo: [
                { titulo: { filCod: 2, docCod: '636', titCod: '1' }, codigoMascarado: MASCARA_A },
            ],
        });
        expect(h.retirados).toEqual([
            expect.objectContaining({
                docCod: '636',
                motivo: 'VINCULO_CODIGO_BARRAS_FALHOU',
                codigoMascarado: MASCARA_A,
            }),
        ]);
        expect(h.removidos).toEqual([91]);
        expect(r.retirados).toHaveLength(1);
        expect(r.retirados[0]).toMatchObject({
            titulo: { docCod: '636' },
            motivo: 'VINCULO_CODIGO_BARRAS_FALHOU',
            codigoMascarado: MASCARA_A,
        });
        expect(r.avisos.join(' ')).toMatch(/vínculo do código de barras confirmado falhou/);
        expect(r.lote.itens.map((i) => i.docCod)).toEqual(['700']);
    });

    it('item que já não está no rascunho: sai local, sem DELETE (ausência observada)', async () => {
        const l = lote([item('636'), item('700')]);
        const h = build({ lote: l, nativos: [{ docCod: '700', seq: 92, linha: LINHA_B }] });
        const r = await h.service.garantir({
            lote: l,
            ...CTX,
            rascunhoAberto: true,
            retiradosPeloVinculo: [{ titulo: { filCod: 2, docCod: '636', titCod: '1' } }],
        });
        expect(h.removidos).toEqual([]);
        expect(r.retirados).toHaveLength(1);
    });

    it('boleto local SEM código que NÃO é do vínculo continua abortando (I16c: CODIGO_AUSENTE)', async () => {
        const l = lote([item('636'), item('700')]);
        const h = build({
            lote: l,
            nativos: [
                { docCod: '636', seq: 91 }, // sem código e ninguém declarou a falha
                { docCod: '700', seq: 92, linha: LINHA_B },
            ],
        });
        const erro = await h.service
            .garantir({ lote: l, ...CTX, rascunhoAberto: true })
            .catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(BoletoCodigoBarrasRetiradaIncompletaError);
        expect((erro as BoletoCodigoBarrasRetiradaIncompletaError).details).toMatchObject({
            modo: 'leitura',
            causa: 'CODIGO_AUSENTE',
        });
        expect(h.removidos).toEqual([]);
        expect(h.retirados).toEqual([]);
    });

    it('idempotência (I16d.5): resíduo do vínculo (marca ATIVA + evento) sai só pelo DELETE', async () => {
        // O item já saiu do lote local numa tentativa anterior; o rascunho ainda o tem sem código.
        const l = lote([item('700')]);
        const h = build({
            lote: l,
            nativos: [
                { docCod: '636', seq: 91 },
                { docCod: '700', seq: 92, linha: LINHA_B },
            ],
            marcas: [
                {
                    filCod: 2,
                    docCod: '636',
                    titCod: '1',
                    origem: 'VINCULO_CODIGO_BARRAS_FALHOU',
                    codigoMascarado: MASCARA_A,
                },
            ],
            retirados: ['2:636:1'],
        });
        const r = await h.service.garantir({
            lote: l,
            ...CTX,
            rascunhoAberto: true,
            forcarLeitura: true,
        });
        expect(h.retirados).toEqual([]); // nada local de novo
        expect(h.removidos).toEqual([91]);
        expect(r.retirados).toHaveLength(1);
        expect(r.retirados[0]?.motivo).toBe('VINCULO_CODIGO_BARRAS_FALHOU');
    });

    it('lote nativo FINALIZADO nunca retira: aborta (rascunhoAberto = false)', async () => {
        const l = lote([item('636')]);
        const h = build({ lote: l, nativos: [{ docCod: '636', seq: 91 }] });
        await expect(
            h.service.garantir({
                lote: l,
                ...CTX,
                rascunhoAberto: false,
                retiradosPeloVinculo: [{ titulo: { filCod: 2, docCod: '636', titCod: '1' } }],
            }),
        ).rejects.toBeInstanceOf(BoletoCodigoBarrasRetiradaIncompletaError);
        expect(h.removidos).toEqual([]);
    });
});

describe('RetiradaCodigoBarrasService — desempate por decisão humana (I17h)', () => {
    it('grupo repetido com exatamente um título de decisão humana: ele fica, mesmo com vencimento maior', async () => {
        const l = lote([item('100', { vencimento: BASE + 3 * DIA }), item('101')]);
        const h = build({
            lote: l,
            nativos: [
                { docCod: '100', seq: 1, linha: LINHA_A },
                { docCod: '101', seq: 2, linha: LINHA_A },
            ],
        });
        const r = await h.service.garantir({
            lote: l,
            ...CTX,
            rascunhoAberto: true,
            preferidos: new Set(['2:100:1']),
        });
        expect(r.retirados.map((x) => x.titulo.docCod)).toEqual(['101']);
        expect(r.retirados[0]?.tituloMantido).toMatchObject({ docCod: '100' });
        expect(h.removidos).toEqual([2]);
    });

    it('sem preferidos vale a ordem de hoje (menor vencimento fica)', async () => {
        const l = lote([item('100', { vencimento: BASE + 3 * DIA }), item('101')]);
        const h = build({
            lote: l,
            nativos: [
                { docCod: '100', seq: 1, linha: LINHA_A },
                { docCod: '101', seq: 2, linha: LINHA_A },
            ],
        });
        const r = await h.service.garantir({ lote: l, ...CTX, rascunhoAberto: true });
        expect(r.retirados.map((x) => x.titulo.docCod)).toEqual(['100']);
    });
});
