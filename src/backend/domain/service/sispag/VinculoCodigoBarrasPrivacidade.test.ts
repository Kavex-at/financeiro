import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { LotePagamento } from '../../interface/sispag/SispagInterface.js';
import AnaliseCodigoBarrasRepetido from '../../libs/boleto/AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../../libs/boleto/CodigoBarrasSintetico.js';
import ElegibilidadeVinculoCodigoBarras from '../../libs/boleto/ElegibilidadeVinculoCodigoBarras.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import RemessaCnabValidator from '../../libs/cnab/RemessaCnabValidator.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type RemessaExecucaoRepository from '../../repository/sispag/RemessaExecucaoRepository.js';
import type SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import type LogService from '../LogService.js';
import type AuthorizedPayeeService from './AuthorizedPayeeService.js';
import DebitDateService from './DebitDateService.js';
import DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';
import RemessaService from './RemessaService.js';
import RetiradaCodigoBarrasService from './RetiradaCodigoBarrasService.js';
import VinculoCodigoBarrasService from './VinculoCodigoBarrasService.js';

/**
 * Privacidade TRANSVERSAL do vínculo do código de barras (ADR-0071, I17j). Junta o serviço
 * REAL do vínculo, a guarda REAL de retirada e o `RemessaService` REAL, com fakes que registram
 * TUDO que sai por log, ledger, trilhas, marcas, erros e resultado. A varredura exige que nenhum
 * desses canais tenha 44 dígitos contíguos nem a linha de 47 — só o que vai ao ERP (`write.*`,
 * em memória) pode carregar o código.
 */

const conv = new CodigoBarrasBoleto();
const VENC = '2026-10-20';
const VENC_EPOCH = Date.UTC(2026, 9, 20, 0);

const BARRAS_OK = CodigoBarrasSintetico.barras({ valor: 1028.8, vencimento: VENC, serie: 1 });
const BARRAS_DIV = CodigoBarrasSintetico.barras({ valor: 500, vencimento: VENC, serie: 2 });
const BARRAS_DDA = CodigoBarrasSintetico.barras({ valor: 77, vencimento: VENC, serie: 3 });
const LINHA = (b: string): string => conv.paraLinhaDigitavel(b) as string;
const TODOS = [BARRAS_OK, BARRAS_DIV, BARRAS_DDA, LINHA(BARRAS_OK), LINHA(BARRAS_DIV)];

const itemLote = (doc: string, valor: number) => ({
    loteId: 'L1',
    filCod: 2,
    docCod: doc,
    titCod: '1',
    credor: 'ACME',
    valor,
    vencimento: VENC_EPOCH,
    modalidade: 'BOLETO' as const,
    incluidoPor: 'u1',
    divergencia: false,
});

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

interface Rastro {
    saidas: unknown[];
    gravacoes: unknown[];
}

const montar = (opcoes: { confirmaTransitorio?: boolean; semDecisao?: boolean } = {}) => {
    const rastro: Rastro = { saidas: [], gravacoes: [] };
    const guarda = <T>(x: T): T => {
        rastro.saidas.push(JSON.parse(JSON.stringify(x ?? null)));
        return x;
    };

    let lote: LotePagamento = {
        id: 'L1',
        filCod: 2,
        conta: '55795-4',
        status: 'FINALIZADO',
        criadoPor: 'u1',
        versao: 3,
        dataDebito: VENC,
        itens: [itemLote('801', 1028.8), itemLote('802', 500), itemLote('803', 77)],
    } as unknown as LotePagamento;

    // Rascunho nativo com estado: 801 e 802 sem código; 803 com o DDA do próprio ERP.
    const rascunho: Array<Record<string, unknown>> = [
        {
            filCod: 2,
            docCod: 801,
            titCod: 1,
            itsCodSeq: 11,
            itsVldModalidade: 6,
            itsNumCodbar: null,
            itsNumBanco: 0,
            bncDesNome: null,
            itsMnyVlrPgto: 1028.8,
            itsDtaPgto: VENC_EPOCH,
            titDtaVencimento: VENC_EPOCH,
            vldVinculoDda: 0,
        },
        {
            filCod: 2,
            docCod: 802,
            titCod: 1,
            itsCodSeq: 12,
            itsVldModalidade: 6,
            itsNumCodbar: null,
            itsNumBanco: 0,
            bncDesNome: null,
            itsMnyVlrPgto: 500,
            itsDtaPgto: VENC_EPOCH,
            titDtaVencimento: VENC_EPOCH,
            vldVinculoDda: 0,
        },
        {
            filCod: 2,
            docCod: 803,
            titCod: 1,
            itsCodSeq: 13,
            itsVldModalidade: 6,
            itsNumCodbar: LINHA(BARRAS_DDA),
            itsNumBanco: 341,
            bncDesNome: 'ITAU',
            itsMnyVlrPgto: 77,
            itsDtaPgto: VENC_EPOCH,
            titDtaVencimento: VENC_EPOCH,
            vldVinculoDda: 1,
        },
    ];
    const abertos: Record<string, number> = { '801': 1028.8, '802': 500, '803': 77 };

    const write = {
        criarLote: jest.fn().mockResolvedValue({ flpCod: 12, filCod: 2, bncCod: 4 }),
        getLoteNativo: jest.fn().mockResolvedValue(undefined),
        listarChavesDoLote: jest.fn().mockResolvedValue(new Set<string>()),
        listarLotesNativos: jest.fn().mockResolvedValue([]),
        listarTitulosPendentes: jest.fn().mockResolvedValue(
            ['801', '802', '803'].map((d) => ({
                filCod: 2,
                docCod: d,
                titCod: '1',
                temBoletoDda: d === '803',
                ddaLegivel: true,
                raw: {
                    filCod: 2,
                    docCod: Number(d),
                    titCod: 1,
                    pesCod: 1161,
                    dpeNomPessoa: 'ACME',
                    titMnyValor: abertos[d],
                    titDtaVencimento: VENC_EPOCH,
                },
            })),
        ),
        importarTitulos: jest.fn().mockResolvedValue(undefined),
        finalizarLote: jest.fn().mockResolvedValue(undefined),
        sugerirRemessa: jest
            .fn()
            .mockResolvedValue({ numRemessa: 12, nomeArquivo: 'PG210801.REM' }),
        gerarRemessa: jest.fn().mockResolvedValue({ sucesso: true }),
        listarArquivosRemessa: jest
            .fn()
            .mockResolvedValue([{ gabCod: 52, nomeArquivo: 'PG210801.REM', conteudo: 'CNAB' }]),
        lerItensDoRascunho: jest.fn(async () => ({
            completa: true,
            itens: rascunho.map((row) => ({
                filCod: Number(row.filCod),
                docCod: String(row.docCod),
                titCod: String(row.titCod),
                itsCodSeq: Number(row.itsCodSeq),
                row: { ...row },
            })),
        })),
        validarCodigoBarras: jest.fn(async (p: { codigo: string }) => {
            const barras = conv.paraBarras(p.codigo) as string;
            const valor = Number(barras.slice(9, 19)) / 100;
            return { splitCodBar: { x: 1 }, barraVlrPgto: valor, barraDtaVencimento: VENC_EPOCH };
        }),
        confirmarCodigoBarras: jest.fn(async (p: { codigo: string }) => {
            if (opcoes.confirmaTransitorio) {
                throw Object.assign(new Error(`falha de rede com ${p.codigo}`), {
                    response: { status: 503, data: { echo: p.codigo } },
                });
            }
            const barras = conv.paraBarras(p.codigo) as string;
            const valor = Number(barras.slice(9, 19)) / 100;
            // 802: o ERP "soma juros" ao valor da barra (HML #4) — o vínculo é recusado.
            const juros = barras === BARRAS_DIV ? 0.02 : 0;
            return {
                itsMnyVlrPgtoResult: valor + juros,
                itsDtaPgtoResult: VENC_EPOCH,
                itsBncNumCodbancoResult: 341,
                itsBncDesNomeResult: 'ITAU UNIBANCO S.A.',
            };
        }),
        editarItemDoRascunho: jest.fn(
            async (p: { item: Record<string, unknown>; alteracoes: Record<string, unknown> }) => {
                const alvo = rascunho.find((r) => r.itsCodSeq === p.item.itsCodSeq);
                if (alvo) Object.assign(alvo, p.alteracoes);
            },
        ),
        listarLinhasDigitaveisDoLote: jest.fn(async () => {
            const comCodigo = rascunho.filter((r) => r.itsNumCodbar);
            const sem = rascunho.filter((r) => !r.itsNumCodbar);
            return {
                itens: comCodigo.map((r) => ({
                    docCod: String(r.docCod),
                    titCod: '1',
                    linhaDigitavel: String(r.itsNumCodbar),
                    filCod: 2,
                    itsCodSeq: Number(r.itsCodSeq),
                })),
                total: comCodigo.length,
                dropped: 0,
                completa: true,
                ...(sem.length > 0
                    ? {
                          semCodigo: sem.map((r) => ({
                              docCod: String(r.docCod),
                              titCod: '1',
                              filCod: 2,
                              itsCodSeq: Number(r.itsCodSeq),
                          })),
                      }
                    : {}),
            };
        }),
        removerItemDoRascunho: jest.fn(async (p: { itsCodSeq: number }) => {
            const i = rascunho.findIndex((r) => r.itsCodSeq === p.itsCodSeq);
            if (i >= 0) rascunho.splice(i, 1);
        }),
    };

    const sispag = {
        listContasCorrentes: jest.fn().mockResolvedValue([
            {
                ccoCod: 2,
                bncCod: 4,
                agencia: '0641',
                numeroConta: 55795,
                dvConta: '4',
                gerNum: 38,
            },
        ]),
        listContasFavorecido: jest.fn().mockResolvedValue([]),
        listChavesPixFavorecido: jest.fn().mockResolvedValue([]),
        getTituloAPagar: jest.fn().mockResolvedValue({ pesCod: '1161' }),
        getDocumentoFavorecido: jest.fn().mockResolvedValue(undefined),
        lerTotalAberto: jest.fn(async (_f: number, doc: string) => ({
            legivel: true as const,
            totalAberto: abertos[doc] ?? 0,
        })),
    };

    const loteRepo = {
        getLoteComItens: jest.fn(async () => lote),
        setChavesNativas: jest.fn().mockResolvedValue(undefined),
        setDataDebito: jest.fn().mockResolvedValue(undefined),
        setFavorecidoAutorizadoItem: jest.fn().mockResolvedValue(1),
        setRemessaGerada: jest.fn().mockResolvedValue(undefined),
        transicionarStatus: jest.fn().mockResolvedValue(1),
        gravarVinculoCodigoBarras: jest.fn(async (p: Record<string, unknown>) => {
            rastro.gravacoes.push(JSON.parse(JSON.stringify(p)));
            lote = {
                ...lote,
                versao: lote.versao + 1,
                itens: lote.itens.map((i) =>
                    i.docCod === p.docCod
                        ? {
                              ...i,
                              vinculoCodigoBarras: {
                                  origem: 'DECISAO_HUMANA',
                                  decisaoId: String(p.decisaoId),
                                  codigoMascarado: String(p.codigoMascarado),
                                  aplicadoEm: '2026-10-14T12:00:00.000Z',
                                  flpCod: Number(p.flpCod),
                              },
                          }
                        : i,
                ),
            } as LotePagamento;
            return true;
        }),
        retirarItemPorCodigoDeBarras: jest.fn(async (p: Record<string, unknown>) => {
            rastro.gravacoes.push(JSON.parse(JSON.stringify(p)));
            lote = {
                ...lote,
                itens: lote.itens.filter((i) => i.docCod !== p.docCod),
            } as LotePagamento;
            return { removido: true };
        }),
    };

    const eventosSugestao: unknown[] = [];
    const sugestoes = {
        listarDecisoes: jest.fn(async () =>
            opcoes.semDecisao ? [] : [decisao('801', 'dec-801', 3), decisao('802', 'dec-802', 4)],
        ),
        listarParesVigentes: jest.fn(async () => [{ id: 'par-1', estado: 'VIGENTE' }]),
        registrarEventoVinculo: jest.fn(async (e: Record<string, unknown>) => {
            eventosSugestao.push(JSON.parse(JSON.stringify(e)));
            rastro.gravacoes.push(JSON.parse(JSON.stringify(e)));
            return { inserido: true };
        }),
        existeVinculoAplicado: jest.fn(async () => false),
    };
    const pool = {
        buscarPorChave: jest.fn(async (k: { ddcCod: number; ditCod: number }) => ({
            ddcCod: k.ddcCod,
            ditCod: k.ditCod,
            valor: k.ditCod === 3 ? 1028.8 : 500,
            vencimento: VENC,
            codbar: k.ditCod === 3 ? BARRAS_OK : BARRAS_DIV,
        })),
    };
    const titulos = {
        buscarPorChave: jest.fn(async (k: { docCod: string }) => ({
            filCod: 2,
            docCod: k.docCod,
            titCod: '1',
            valor: abertos[k.docCod],
            vencimento: VENC_EPOCH,
            ativo: true,
            pago: false,
            liberado: true,
        })),
    };

    const db = {
        withAdvisoryLock: jest.fn(async (_k: number, onAcquired: () => Promise<unknown>) =>
            onAcquired(),
        ),
        withTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    };
    const ledgerPayloads: unknown[] = [];
    const ledger = {
        findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        beginExecution: jest.fn().mockResolvedValue({ status: 'reconciling' }),
        setNativeFlpCod: jest.fn().mockResolvedValue(undefined),
        setEtapa: jest.fn(async (_k: string, e: string) => void ledgerPayloads.push(e)),
        setRequestPayload: jest.fn(async (_k: string, p: unknown) => {
            ledgerPayloads.push(JSON.parse(JSON.stringify(p)));
        }),
        settle: jest.fn().mockResolvedValue(undefined),
        fail: jest.fn(async (_k: string, p: unknown) => void ledgerPayloads.push(p)),
    };
    const log = {
        info: jest.fn(async (x: unknown) => void guarda(x)),
        warn: jest.fn(async (x: unknown) => void guarda(x)),
        error: jest.fn(async (x: unknown) => void guarda(x)),
    };
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            conexosWriteEnabled: true,
            sispagLiveWriteEnabled: true,
            sispagDdaAssocEnabled: true,
            conexosDryRun: false,
            sispagBindCodbarFiliais: '2:on',
        }),
    };
    const bloqueios = { listAtivosPorOrigem: jest.fn().mockResolvedValue([]) };
    const eventosVerificacao = {
        listarChavesRetiradasPeloSistema: jest.fn().mockResolvedValue(new Set<string>()),
    };

    const calendar = BankingCalendar.withClock(() => new Date('2026-09-22T15:00:00Z'));
    const retirada = new RetiradaCodigoBarrasService(
        write as unknown as ConexosSispagWriteClient,
        loteRepo as unknown as LotePagamentoRepository,
        db as unknown as PostgreeDatabaseClient,
        new AnaliseCodigoBarrasRepetido(conv),
        log as unknown as LogService,
        bloqueios as unknown as BloqueioDuplicidadeRepository,
        eventosVerificacao as unknown as VerificacaoEventoRepository,
    );
    const vinculo = new VinculoCodigoBarrasService(
        write as unknown as ConexosSispagWriteClient,
        sispag as unknown as ConexosSispagClient,
        loteRepo as unknown as LotePagamentoRepository,
        sugestoes as unknown as SugestaoBoletoRepository,
        pool as unknown as BoletoDdaRepository,
        titulos as unknown as TituloAPagarRepository,
        new ElegibilidadeVinculoCodigoBarras(conv),
        new RegraSugestaoBoleto(),
        conv,
        calendar,
        env as unknown as EnvironmentProvider,
        log as unknown as LogService,
        db as unknown as PostgreeDatabaseClient,
    );
    const remessa = new RemessaService(
        loteRepo as unknown as LotePagamentoRepository,
        ledger as unknown as RemessaExecucaoRepository,
        write as unknown as ConexosSispagWriteClient,
        sispag as unknown as ConexosSispagClient,
        env as unknown as EnvironmentProvider,
        log as unknown as LogService,
        db as unknown as PostgreeDatabaseClient,
        new RemessaCnabValidator(),
        new DebitDateService(loteRepo as unknown as LotePagamentoRepository, calendar),
        calendar,
        new DestinoPagamentoResolver(sispag as unknown as ConexosSispagClient, new MaskDestino()),
        {
            verificarDestinoAutorizado: jest.fn().mockResolvedValue(new Map()),
        } as unknown as AuthorizedPayeeService,
        retirada,
        vinculo,
    );
    return { remessa, write, rastro, ledgerPayloads, eventosSugestao, loteRepo, rascunho };
};

const semCodigo = (nome: string, valor: unknown): void => {
    const texto = JSON.stringify(valor);
    for (const c of TODOS)
        expect({ nome, vazou: texto.includes(c) }).toEqual({ nome, vazou: false });
    expect({ nome, longo: /\d{30,}/.test(texto) }).toEqual({ nome, longo: false });
};

describe('privacidade transversal do vínculo (ADR-0071, I17j)', () => {
    it('fluxo completo (1 vinculado, 1 retirado por juros, 1 DDA do ERP): nenhum canal carrega o código', async () => {
        const h = montar();
        const r = await h.remessa.gerarRemessa({ loteId: 'L1', ator: 'u' });

        expect(r.status).toBe('gerada');
        expect(r.vinculados?.map((v) => v.titulo.docCod)).toEqual(['801']);
        expect(r.retiradosPorCodigoBarras?.map((x) => x.titulo.docCod)).toEqual(['802']);
        expect(r.retiradosPorCodigoBarras?.[0]?.motivo).toBe('VINCULO_CODIGO_BARRAS_FALHOU');

        // O código completo ENTROU no ERP (é o ponto): só aí ele existe.
        const enviado = JSON.stringify(h.write.editarItemDoRascunho.mock.calls);
        expect(enviado).toContain(LINHA(BARRAS_OK));

        semCodigo('resultado', r);
        semCodigo('ledger', h.ledgerPayloads);
        semCodigo('trilha da sugestão', h.eventosSugestao);
        semCodigo('gravações (item, evento, marca)', h.rastro.gravacoes);
        semCodigo('log', h.rastro.saidas);
        semCodigo('retirada local', h.loteRepo.retirarItemPorCodigoDeBarras.mock.calls);
        // A máscara 5+4 é o que persiste.
        const mascarado = `${BARRAS_OK.slice(0, 5)}…${BARRAS_OK.slice(-4)}`;
        expect(JSON.stringify(h.loteRepo.gravarVinculoCodigoBarras.mock.calls)).toContain(
            mascarado,
        );
    });

    it('falha transitória: o erro, o ledger e o log também não carregam o código (nem o eco do ERP)', async () => {
        const h = montar({ confirmaTransitorio: true });
        const erro = await h.remessa
            .gerarRemessa({ loteId: 'L1', ator: 'u' })
            .catch((e: unknown) => e as Error & { userMessage?: string; details?: unknown });
        expect(erro).toMatchObject({ code: 'VINCULO_CODIGO_BARRAS_INCOMPLETO' });
        semCodigo('erro', [
            (erro as Error).message,
            (erro as { userMessage?: string }).userMessage,
            (erro as { details?: unknown }).details,
        ]);
        semCodigo('ledger', h.ledgerPayloads);
        semCodigo('log', h.rastro.saidas);
        semCodigo('gravações', h.rastro.gravacoes);
        // Rascunho preservado: nenhuma retirada, nada finalizado.
        expect(h.write.removerItemDoRascunho).not.toHaveBeenCalled();
        expect(h.write.finalizarLote).not.toHaveBeenCalled();
    });

    it('lote sem item elegível: o client novo não é chamado, nenhum evento é gravado e o resultado não ganha campos', async () => {
        const h = montar({ semDecisao: true });
        // Só o item que o ERP associou ao DDA e os dois sem decisão confirmada.
        const r = await h.remessa
            .gerarRemessa({ loteId: 'L1', ator: 'u' })
            .catch((e: unknown) => e);
        // 801/802 não têm decisão: o BOLETO sem DDA barra ANTES de qualquer escrita, como sempre. Nada do
        // vínculo foi tocado.
        expect(r).toMatchObject({ code: 'BOLETO_SEM_CODIGO_BARRAS' });
        for (const fn of [
            h.write.lerItensDoRascunho,
            h.write.validarCodigoBarras,
            h.write.confirmarCodigoBarras,
            h.write.editarItemDoRascunho,
        ]) {
            expect(fn).not.toHaveBeenCalled();
        }
        expect(h.eventosSugestao).toEqual([]);
        expect(h.loteRepo.gravarVinculoCodigoBarras).not.toHaveBeenCalled();
    });
});
