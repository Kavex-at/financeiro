import 'reflect-metadata';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import BoletoCodigoBarrasRetiradaIncompletaError from '../../errors/BoletoCodigoBarrasRetiradaIncompletaError.js';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import AnaliseCodigoBarrasRepetido from '../../libs/boleto/AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../../libs/boleto/CodigoBarrasSintetico.js';
import type { GrupoBoletoExecucao } from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import type BorderoGrupoBoletoService from './BorderoGrupoBoletoService.js';
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
    /** Item de título. Ausente quando é item de borderô (`borCod`). */
    docCod?: string;
    /** Item de borderô do boleto agrupado (ADR-0077): sem `docCod/titCod`. */
    borCod?: number;
    seq: number;
    linha?: string;
}

const build = (o: {
    nativos: Nativo[];
    lote: LotePagamento;
    marcas?: Array<Record<string, unknown>>;
    retirados?: string[];
    /** Execuções do borderô por grupo (ledger do grupo). */
    execucoes?: Array<Partial<GrupoBoletoExecucao> & { grupoId: string }>;
    /** Grupos (com os títulos) lidos por `buscarPorId`. */
    grupos?: Array<{
        id: string;
        titulos: Array<{ filCod: number; docCod: string; titCod: string }>;
    }>;
    /** Desfecho da limpeza do borderô (default: limpo, e o item some do rascunho). */
    limpeza?: 'limpo' | 'pendente' | 'nada_a_limpar';
}) => {
    const estado = [...o.nativos];
    const removidos: number[] = [];
    const write = {
        listarLinhasDigitaveisDoLote: jest.fn(async () => {
            const titulos = estado.filter((n) => n.borCod === undefined);
            const bordero = estado.filter((n) => n.borCod !== undefined);
            const comCodigo = titulos.filter((n) => n.linha !== undefined);
            const semCodigo = titulos.filter((n) => n.linha === undefined);
            return {
                ...(bordero.length > 0
                    ? {
                          itensDeBordero: bordero.map((n) => ({
                              filCod: 2,
                              borCod: n.borCod as number,
                              itsCodSeq: n.seq,
                              ...(n.linha !== undefined ? { linhaDigitavel: n.linha } : {}),
                          })),
                      }
                    : {}),
                itens: comCodigo.map((n) => ({
                    docCod: n.docCod as string,
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
                              docCod: n.docCod as string,
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
        /** ADR-0077: N itens + N marcas + N eventos numa transação; sai do lote local. */
        retirarGrupoPeloSistema: jest.fn(
            async (p: { titulos: Array<{ docCod: string }> } & Record<string, unknown>) => {
                gruposRetirados.push(p);
                const docs = new Set(p.titulos.map((t) => t.docCod));
                atual = {
                    ...atual,
                    itens: atual.itens.filter((i) => !docs.has(i.docCod)),
                } as LotePagamento;
                return { removidos: p.titulos.length };
            },
        ),
    };
    const gruposRetirados: Array<Record<string, unknown>> = [];
    const execs = new Map(
        (o.execucoes ?? []).map((e) => [
            e.grupoId,
            {
                id: `E-${e.grupoId}`,
                loteId: 'L1',
                filCod: 2,
                baixas: [],
                tentativas: 1,
                etapa: 'importado',
                ...e,
            } as unknown as GrupoBoletoExecucao,
        ]),
    );
    const trilha: string[] = [];
    const grupoRepo = {
        registrarEvento: jest.fn(async (e: Record<string, unknown>) => {
            trilha.push(String(e.tipo));
            return 'ev';
        }),
        buscarPorId: jest.fn(async (id: string) => o.grupos?.find((g) => g.id === id) ?? null),
    };
    const execucoesRepo = {
        ultimaPorGrupo: jest.fn(async (id: string) => execs.get(id) ?? null),
        listarPorLote: jest.fn(async () => [...execs.values()]),
    };
    const borderoGrupo = {
        limpar: jest.fn(async (p: { execucao: GrupoBoletoExecucao }) => {
            trilha.push('limpar');
            const desfecho = o.limpeza ?? 'limpo';
            if (desfecho === 'limpo') {
                const i = estado.findIndex((n) => n.borCod === p.execucao.borCod);
                if (i >= 0) estado.splice(i, 1);
            }
            return { desfecho, execucaoId: p.execucao.id };
        }),
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
        grupoRepo as unknown as GrupoBoletoRepository,
        execucoesRepo as unknown as GrupoBoletoExecucaoRepository,
        borderoGrupo as unknown as BorderoGrupoBoletoService,
    );
    return {
        service,
        write,
        loteRepo,
        retirados,
        removidos,
        log,
        grupoRepo,
        borderoGrupo,
        gruposRetirados,
        trilha,
    };
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

describe('RetiradaCodigoBarrasService — boleto agrupado (ADR-0077, I16, I21p(3), I21q)', () => {
    const BOR = 251;
    const TITULOS = ['901', '902', '903'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' }));
    const itemDoGrupo = (docCod: string): ItemLote => item(docCod, { grupoBoletoId: 'G1' });
    const loteComGrupo = (): LotePagamento =>
        lote([item('700'), ...['901', '902', '903'].map(itemDoGrupo)]);
    const grupoNaGuarda = (over: Record<string, unknown> = {}) => ({
        grupoId: 'G1',
        borCod: BOR,
        titulos: TITULOS,
        codigoMascarado: MASCARA_A,
        ...over,
    });
    const cenario = (over: Partial<Parameters<typeof build>[0]> = {}) =>
        build({
            lote: loteComGrupo(),
            nativos: [
                { docCod: '700', seq: 1, linha: LINHA_B },
                { borCod: BOR, seq: 5, linha: LINHA_A },
            ],
            execucoes: [{ grupoId: 'G1', borCod: BOR, borTimCad: 1_790_000_000_000 }],
            grupos: [{ id: 'G1', titulos: TITULOS }],
            ...over,
        });
    const garantir = (h: ReturnType<typeof cenario>, extra: Record<string, unknown> = {}) =>
        h.service.garantir({
            lote: loteComGrupo(),
            ...CTX,
            rascunhoAberto: true,
            grupos: [grupoNaGuarda()],
            ...extra,
        });

    it('o grupo conta como UM item nativo: os 3 itens locais não são lidos como código ausente', async () => {
        const h = cenario();
        const r = await garantir(h);
        expect(r.retirados).toEqual([]);
        expect(h.removidos).toEqual([]);
        expect(h.gruposRetirados).toEqual([]);
    });

    it('item de borderô SEM barra antes do finalizar aborta como hoje (CODIGO_AUSENTE, ADR-0040)', async () => {
        const h = cenario({
            nativos: [
                { docCod: '700', seq: 1, linha: LINHA_B },
                { borCod: BOR, seq: 5 },
            ],
        });
        const erro = await garantir(h).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(BoletoCodigoBarrasRetiradaIncompletaError);
        expect((erro as BoletoCodigoBarrasRetiradaIncompletaError).details).toMatchObject({
            modo: 'leitura',
            causa: 'CODIGO_AUSENTE',
        });
        expect(h.gruposRetirados).toEqual([]);
        expect(h.removidos).toEqual([]);
    });

    it('I16a: a barra do grupo repetida num título avulso é detectada; I16d.1: o item de borderô (decisão humana) fica e o avulso sai', async () => {
        const h = cenario({
            nativos: [
                { docCod: '700', seq: 1, linha: LINHA_A },
                { borCod: BOR, seq: 5, linha: LINHA_A },
            ],
        });
        const r = await garantir(h);
        expect(r.retirados.map((x) => x.titulo.docCod)).toEqual(['700']);
        expect(r.retirados[0]).toMatchObject({
            motivo: 'CODIGO_BARRAS_REPETIDO',
            tituloMantido: { filCod: 2, docCod: 'bor', titCod: String(BOR) },
        });
        expect(h.removidos).toEqual([1]);
        expect(h.gruposRetirados).toEqual([]);
    });

    describe('retirada do grupo inteiro (I21p(3))', () => {
        const retirar = (motivo = 'GRUPO_BOLETO_FALHOU') => ({ retirar: { motivo } });

        it('local primeiro (N itens + N marcas + N eventos numa transação), GRUPO_RETIRADO na mesma transação, e só então a limpeza do borderô', async () => {
            const h = cenario();
            const r = await garantir(h, { grupos: [grupoNaGuarda(retirar())] });
            expect(h.loteRepo.retirarGrupoPeloSistema).toHaveBeenCalledTimes(1);
            expect(h.loteRepo.retirarGrupoPeloSistema).toHaveBeenCalledWith(
                expect.objectContaining({
                    loteId: 'L1',
                    grupoId: 'G1',
                    motivo: 'GRUPO_BOLETO_FALHOU',
                    titulos: TITULOS,
                    codigoMascarado: MASCARA_A,
                }),
                expect.anything(),
            );
            expect(h.grupoRepo.registrarEvento).toHaveBeenCalledWith(
                expect.objectContaining({
                    grupoId: 'G1',
                    tipo: 'GRUPO_RETIRADO',
                    loteId: 'L1',
                    borCod: BOR,
                    codigoMascarado: MASCARA_A,
                }),
                expect.anything(),
            );
            expect(h.borderoGrupo.limpar).toHaveBeenCalledTimes(1);
            expect(h.borderoGrupo.limpar).toHaveBeenCalledWith(
                expect.objectContaining({
                    execucao: expect.objectContaining({ grupoId: 'G1', borCod: BOR }),
                }),
            );
            // local → evento → limpeza (nunca o DELETE antes de o local sair)
            expect(h.trilha).toEqual(['GRUPO_RETIRADO', 'limpar']);
            expect(r.retirados.map((x) => x.titulo.docCod)).toEqual(['901', '902', '903']);
            expect(r.retirados.every((x) => x.motivo === 'GRUPO_BOLETO_FALHOU')).toBe(true);
            expect(r.gruposRetirados).toEqual([
                expect.objectContaining({ grupoId: 'G1', borCod: BOR, limpeza: 'limpo' }),
            ]);
            expect(r.lote.itens.map((i) => i.docCod)).toEqual(['700']);
        });

        it('a guarda NÃO apaga o item de borderô sozinha: quem apaga é a limpeza (ordem V3 do ERP)', async () => {
            const h = cenario();
            await garantir(h, { grupos: [grupoNaGuarda(retirar())] });
            expect(h.write.removerItemDoRascunho).not.toHaveBeenCalled();
        });

        it('motivo BORDERO_ANTERIOR_NAO_RESOLVIDO sem borderô nosso (borCod ausente): sai só local, sem limpeza nem DELETE no ERP', async () => {
            const h = cenario({
                nativos: [{ docCod: '700', seq: 1, linha: LINHA_B }],
            });
            const r = await garantir(h, {
                grupos: [
                    grupoNaGuarda({
                        borCod: undefined,
                        ...retirar('BORDERO_ANTERIOR_NAO_RESOLVIDO'),
                    }),
                ],
            });
            expect(h.loteRepo.retirarGrupoPeloSistema).toHaveBeenCalledWith(
                expect.objectContaining({ motivo: 'BORDERO_ANTERIOR_NAO_RESOLVIDO' }),
                expect.anything(),
            );
            expect(h.borderoGrupo.limpar).not.toHaveBeenCalled();
            expect(h.write.removerItemDoRascunho).not.toHaveBeenCalled();
            expect(r.retirados.map((x) => x.motivo)).toEqual([
                'BORDERO_ANTERIOR_NAO_RESOLVIDO',
                'BORDERO_ANTERIOR_NAO_RESOLVIDO',
                'BORDERO_ANTERIOR_NAO_RESOLVIDO',
            ]);
        });

        it('limpeza pendente (falha parcial) FECHA: BoletoCodigoBarrasRetiradaIncompletaError (limpeza), não segue para o finalizar', async () => {
            const h = cenario({ limpeza: 'pendente' });
            const erro = await garantir(h, { grupos: [grupoNaGuarda(retirar())] }).catch(
                (e: unknown) => e,
            );
            expect(erro).toBeInstanceOf(BoletoCodigoBarrasRetiradaIncompletaError);
            expect((erro as BoletoCodigoBarrasRetiradaIncompletaError).details).toMatchObject({
                modo: 'limpeza',
            });
            // O local já saiu: a retomada termina a limpeza (resíduo reconhecido, I16h).
            expect(h.loteRepo.retirarGrupoPeloSistema).toHaveBeenCalledTimes(1);
        });

        it('item de borderô que continua no rascunho depois da limpeza (releitura) também fecha', async () => {
            const h = cenario({ limpeza: 'nada_a_limpar' });
            await expect(
                garantir(h, { grupos: [grupoNaGuarda(retirar())] }),
            ).rejects.toBeInstanceOf(BoletoCodigoBarrasRetiradaIncompletaError);
        });

        it('lote nativo FINALIZADO nunca retira o grupo: aborta sem tocar em nada', async () => {
            const h = cenario();
            await expect(
                garantir(h, { rascunhoAberto: false, grupos: [grupoNaGuarda(retirar())] }),
            ).rejects.toBeInstanceOf(BoletoCodigoBarrasRetiradaIncompletaError);
            expect(h.loteRepo.retirarGrupoPeloSistema).not.toHaveBeenCalled();
            expect(h.borderoGrupo.limpar).not.toHaveBeenCalled();
        });

        it('I16e: o aviso cita o borderô, os títulos do grupo e o código mascarado — nunca o código', async () => {
            const h = cenario();
            const r = await garantir(h, { grupos: [grupoNaGuarda(retirar())] });
            const aviso = r.avisos.join(' ');
            expect(aviso).toContain(String(BOR));
            expect(aviso).toContain('901/1');
            expect(aviso).toContain('903/1');
            expect(aviso).toContain(MASCARA_A);
            const saida = JSON.stringify([r, h.log.warn.mock.calls, h.log.info.mock.calls]);
            expect(saida).not.toMatch(/\d{44}|\d{47}/);
        });
    });

    describe('resíduo de grupo retirado (I16h)', () => {
        const marcasDoGrupo = TITULOS.map((t) => ({
            ...t,
            origem: 'GRUPO_BOLETO',
            codigoMascarado: MASCARA_A,
        }));
        const retiradosDoGrupo = TITULOS.map((t) => `${t.filCod}:${t.docCod}:${t.titCod}`);

        it('item com borCod cujo grupo tem as marcas E o evento do sistema neste lote ⇒ resíduo', async () => {
            const h = cenario({
                marcas: marcasDoGrupo,
                retirados: retiradosDoGrupo,
            });
            const { residuos, estranhos } = await h.service.classificarIntrusos('L1', [
                `2:bor:${BOR}`,
            ]);
            expect([...residuos.keys()]).toEqual([`2:bor:${BOR}`]);
            expect(estranhos).toEqual([]);
        });

        it('outro borCod (de terceiro ou reusado pelo ERP) ⇒ estranho, nunca tocado', async () => {
            const h = cenario({ marcas: marcasDoGrupo, retirados: retiradosDoGrupo });
            const { residuos, estranhos } = await h.service.classificarIntrusos('L1', [
                '2:bor:999',
            ]);
            expect(residuos.size).toBe(0);
            expect(estranhos).toEqual(['2:bor:999']);
        });

        it('grupo sem as marcas (ou sem o evento) ⇒ o item de borderô é estranho', async () => {
            const semMarcas = cenario({ retirados: retiradosDoGrupo });
            expect(
                (await semMarcas.service.classificarIntrusos('L1', [`2:bor:${BOR}`])).estranhos,
            ).toEqual([`2:bor:${BOR}`]);
            const semEvento = cenario({ marcas: marcasDoGrupo });
            expect(
                (await semEvento.service.classificarIntrusos('L1', [`2:bor:${BOR}`])).estranhos,
            ).toEqual([`2:bor:${BOR}`]);
        });

        it('a retomada termina a limpeza: o resíduo do grupo (itens locais já fora) sai pela limpeza do borderô, sem retirada local nova', async () => {
            const l = lote([item('700')]);
            const h = build({
                lote: l,
                nativos: [
                    { docCod: '700', seq: 1, linha: LINHA_B },
                    { borCod: BOR, seq: 5 },
                ],
                marcas: marcasDoGrupo,
                retirados: retiradosDoGrupo,
                execucoes: [{ grupoId: 'G1', borCod: BOR, borTimCad: 1_790_000_000_000 }],
                grupos: [{ id: 'G1', titulos: TITULOS }],
            });
            const r = await h.service.garantir({
                lote: l,
                ...CTX,
                rascunhoAberto: true,
                forcarLeitura: true,
            });
            expect(h.loteRepo.retirarGrupoPeloSistema).not.toHaveBeenCalled();
            expect(h.borderoGrupo.limpar).toHaveBeenCalledTimes(1);
            expect(r.gruposRetirados?.[0]).toMatchObject({ grupoId: 'G1', limpeza: 'limpo' });
        });
    });
});
