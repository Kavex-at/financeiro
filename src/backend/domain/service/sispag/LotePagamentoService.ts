import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteFilialError from '../../errors/LoteFilialError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import ModalidadePendenteError from '../../errors/ModalidadePendenteError.js';
import TituloEmOutroLoteError from '../../errors/TituloEmOutroLoteError.js';
import TituloForaDeLoteError from '../../errors/TituloForaDeLoteError.js';
import TituloNaoElegivelError from '../../errors/TituloNaoElegivelError.js';
import DuplicateHoldError from '../../errors/DuplicateHoldError.js';
import ItemsRemovedByCheckError from '../../errors/ItemsRemovedByCheckError.js';
import PaymentCheckPendingError from '../../errors/PaymentCheckPendingError.js';
import PendingDuplicateAlertError from '../../errors/PendingDuplicateAlertError.js';
import ContaPagadoraResolver from './ContaPagadoraResolver.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    type AlertaItemLote,
    type ChaveTitulo,
    type CriarLoteInput,
    DUPLICATE_ALERT_TYPES,
    type IncluirTituloInput,
    ITEM_ALERT_STATE,
    type ListarLotesFiltro,
    type LotePagamento,
    type LotePagamentoStatus,
    LOTE_STATUS,
    MODALIDADE,
    type Modalidade,
    VERIFICATION_EVENT,
} from '../../interface/sispag/SispagInterface.js';
import AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import LogService from '../LogService.js';
import VerificacaoTedPixService from './VerificacaoTedPixService.js';

interface TransicaoInput {
    loteId: string;
    versao: number;
    ator: string;
}

/** Chave `filCod:docCod:titCod` de um item/alerta. */
const chaveItem = (c: { filCod: number; docCod: string; titCod: string }): string =>
    `${c.filCod}:${c.docCod}:${c.titCod}`;

/**
 * LotePagamentoService — montagem assistida + gate do lote candidato SISPAG
 * (Fatia 2, ADR-0015). Enforça as invariantes na FRONTEIRA DO AGREGADO:
 *   I2 (elegibilidade autoritativa via re-leitura Conexos), I3 (não-duplicação,
 *   advisory lock + transação), I4 (uma filial), I5 (gate + auditoria),
 *   I6 (optimistic lock). I1: NENHUMA escrita no ERP — só leitura pontual.
 */
@injectable()
export default class LotePagamentoService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly repo: LotePagamentoRepository,
        @inject(TituloAPagarRepository) private readonly tituloRepo: TituloAPagarRepository,
        @inject(ConexosSispagClient) private readonly conexos: ConexosSispagClient,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
        @inject(VerificacaoTedPixService) private readonly verificacao: VerificacaoTedPixService,
        @inject(ContaPagadoraResolver) private readonly contaResolver: ContaPagadoraResolver,
        @inject(AlertaItemLoteRepository) private readonly alertaRepo: AlertaItemLoteRepository,
        @inject(BloqueioDuplicidadeRepository)
        private readonly bloqueioRepo: BloqueioDuplicidadeRepository,
        @inject(VerificacaoEventoRepository) private readonly eventos: VerificacaoEventoRepository,
    ) {}

    public criarLote = async (input: CriarLoteInput): Promise<LotePagamento> => {
        // G-13: sem conta informada, usa a que a FILIAL tem no fin005 (Itaú). Se não houver uma
        // conta inequívoca o lote nasce sem conta e a analista escolhe — o finalizar recusa.
        const padrao =
            input.banco && input.conta
                ? { banco: input.banco, conta: input.conta }
                : await this.contaResolver.resolverPadrao(input.filCod);
        const banco = input.banco ?? padrao?.banco;
        const conta = input.conta ?? padrao?.conta;
        const lote = await this.repo.criarLote({
            filCod: input.filCod,
            ...(banco ? { banco } : {}),
            ...(conta ? { conta } : {}),
            criadoPor: input.ator,
        });
        await this.audit('criarLote', lote.id, input.ator, { filCod: input.filCod });
        return lote;
    };

    /**
     * A3 — troca a conta pagadora do lote (só em RASCUNHO; optimistic lock por `versao`).
     * Default é Itaú; o analista usa isto na exceção rara (fornecedor que não aceita boleto
     * via Itaú). Espelha `transicionar` na distinção conflito-de-versão vs. estado inválido.
     */
    public atualizarContaPagadora = async (input: {
        loteId: string;
        versao: number;
        banco: string;
        conta: string;
        ator: string;
    }): Promise<LotePagamento> => {
        const afetadas = await this.repo.atualizarContaPagadora({
            id: input.loteId,
            banco: input.banco,
            conta: input.conta,
            versaoEsperada: input.versao,
        });
        if (afetadas === 0) {
            const atual = await this.exigirLote(input.loteId);
            if (atual.versao !== input.versao) {
                throw new LoteVersaoConflitoError({
                    loteId: input.loteId,
                    versaoEsperada: input.versao,
                });
            }
            throw new LoteEstadoInvalidoError({
                loteId: input.loteId,
                statusAtual: atual.status,
                acao: 'trocar conta pagadora',
            });
        }
        await this.audit('atualizarContaPagadora', input.loteId, input.ator, {
            banco: input.banco,
            conta: input.conta,
        });
        return this.loteCompleto(input.loteId);
    };

    /**
     * A2 — define/troca a forma de pagamento (modalidade) de um item (só RASCUNHO;
     * optimistic lock por `versao` do lote). Atualiza o item e bumpa a versão do lote
     * numa transação. Distingue conflito-de-versão vs. estado inválido (espelha transicionar).
     */
    public atualizarModalidadeItem = async (input: {
        loteId: string;
        filCod: number;
        docCod: string;
        titCod: string;
        modalidade: Modalidade;
        versao: number;
        ator: string;
    }): Promise<LotePagamento> => {
        await this.db.withTransaction(async (tx) => {
            const afetadas = await this.repo.atualizarModalidadeItem(
                {
                    loteId: input.loteId,
                    filCod: input.filCod,
                    docCod: input.docCod,
                    titCod: input.titCod,
                    modalidade: input.modalidade,
                    versaoEsperada: input.versao,
                },
                tx,
            );
            if (afetadas === 0) {
                const atual = await this.exigirLote(input.loteId);
                if (atual.versao !== input.versao) {
                    throw new LoteVersaoConflitoError({
                        loteId: input.loteId,
                        versaoEsperada: input.versao,
                    });
                }
                throw new LoteEstadoInvalidoError({
                    loteId: input.loteId,
                    statusAtual: atual.status,
                    acao: 'definir modalidade',
                });
            }
            await this.repo.tocarLote(input.loteId, tx);
        });
        await this.audit('atualizarModalidadeItem', input.loteId, input.ator, {
            docCod: input.docCod,
            titCod: input.titCod,
            modalidade: input.modalidade,
        });
        // ADR-0063 I13a — TED/PIX dispara a verificação SÓ deste item (pode retirá-lo do lote se
        // faltar dado de pagamento, I13j); qualquer outra forma descarta as alertas abertas dele.
        const chave = { filCod: input.filCod, docCod: input.docCod, titCod: input.titCod };
        if (this.verificacao.ehVerificavel({ modalidade: input.modalidade })) {
            await this.verificacao.verificarItens(input.loteId, { itens: [chave] });
        } else {
            await this.verificacao.descartarVerificacao(input.loteId, chave, input.ator);
        }
        return this.loteCompleto(input.loteId);
    };

    /** Lotes com as alertas vivas de cada item (ADR-0063): a tela mostra os badges na listagem. */
    public listarLotes = async (filtro: ListarLotesFiltro): Promise<LotePagamento[]> =>
        this.comAlertas(await this.repo.listLotes(filtro));

    public getLote = async (id: string): Promise<LotePagamento | null> => {
        const lote = await this.repo.getLoteComItens(id);
        if (!lote) return null;
        const [completo] = await this.comAlertas([lote]);
        return completo ?? lote;
    };

    /**
     * Inclui um título no lote — I2/I3/I4 na fronteira do agregado.
     * A re-leitura Conexos (I2) roda ANTES do advisory lock, para NÃO segurar uma
     * conexão do pool durante a chamada de rede (evita starvation com pool max=5).
     * O lock serializa apenas o check-I3 + insert (rápido, só DB) por título.
     */
    public incluirTitulo = async (input: IncluirTituloInput): Promise<LotePagamento> => {
        const lote = await this.exigirLote(input.loteId);
        if (lote.status !== LOTE_STATUS.RASCUNHO) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'incluir título',
            });
        }
        // I4 — uma filial por lote.
        if (lote.filCod !== input.filCod) {
            throw new LoteFilialError({ loteFilCod: lote.filCod, tituloFilCod: input.filCod });
        }
        // já está neste lote? idempotente.
        if (lote.itens.some((i) => i.docCod === input.docCod && i.titCod === input.titCod)) {
            return this.loteCompleto(lote.id);
        }
        // ADR-0063 I13g — título retirado por duplicidade não volta a lote enquanto o bloqueio
        // estiver ATIVO (antes de qualquer leitura no Conexos).
        const bloqueio = await this.bloqueioRepo.findAtivo({
            filCod: input.filCod,
            docCod: input.docCod,
            titCod: input.titCod,
        });
        if (bloqueio) {
            throw new DuplicateHoldError({
                filCod: input.filCod,
                docCod: input.docCod,
                titCod: input.titCod,
                motivo: bloqueio.motivo,
                marcadoPor: bloqueio.marcadoPor,
            });
        }
        // I2 — elegibilidade AUTORITATIVA (re-leitura Conexos, FORA do lock/transação).
        const titulo = await this.conexos.getTituloAPagar(input.filCod, input.docCod, input.titCod);
        if (!titulo) {
            throw new TituloNaoElegivelError({
                docCod: input.docCod,
                titCod: input.titCod,
                motivo: 'nao-encontrado',
            });
        }
        if (titulo.pago) {
            throw new TituloNaoElegivelError({
                docCod: input.docCod,
                titCod: input.titCod,
                motivo: 'ja-pago',
            });
        }
        if (!titulo.liberado) {
            throw new TituloNaoElegivelError({
                docCod: input.docCod,
                titCod: input.titCod,
                motivo: 'nao-liberado',
            });
        }
        // A modalidade BOLETO é pré-selecionada a partir da carteira PERSISTIDA, não do
        // `fin064`: o `getTituloAPagar` acima é a fonte autoritativa de ELEGIBILIDADE (pago /
        // liberado), mas não sabe de boleto — `temBoleto` vem `false` de lá por construção.
        // Sem esta leitura, a analista tinha de escolher a forma de pagamento item por item
        // mesmo quando o boleto era o único destino possível.
        //
        // Continua sendo só um DEFAULT de tela: ela pode trocar, e a validação que vale é o
        // `BoletoSemCodigoBarrasError` no envio, que relê o flag ao vivo no momento do import.
        const temBoleto = await this.tituloRepo.temBoletoPersistido({
            filCod: input.filCod,
            docCod: input.docCod,
            titCod: input.titCod,
        });

        // I3 + inserção atômica, serializadas por título (lock só em torno do DB).
        const lockKey = this.lockKey(input.filCod, input.docCod, input.titCod);
        await this.db.withAdvisoryLock(
            lockKey,
            () =>
                this.db.withTransaction(async (tx) => {
                    const outroLote = await this.repo.loteRascunhoComTitulo(
                        { filCod: input.filCod, docCod: input.docCod, titCod: input.titCod },
                        tx,
                    );
                    if (outroLote && outroLote !== input.loteId) {
                        throw new TituloEmOutroLoteError({
                            docCod: input.docCod,
                            titCod: input.titCod,
                            loteId: outroLote,
                        });
                    }
                    await this.repo.adicionarItem(
                        {
                            loteId: input.loteId,
                            filCod: input.filCod,
                            docCod: input.docCod,
                            titCod: input.titCod,
                            credor: titulo.credor,
                            valor: titulo.valor,
                            vencimento: titulo.vencimento,
                            // A2: boleto pré-selecionado quando o ERP tem um DDA casado com o
                            // título; senão "a definir" e o analista escolhe.
                            modalidade: temBoleto ? MODALIDADE.BOLETO : undefined,
                            incluidoPor: input.ator,
                        },
                        tx,
                    );
                    // O analista mexeu num lote automático → vira manual (cron para de gerenciar).
                    if (lote.automatico) await this.repo.marcarManual(input.loteId, tx);
                    await this.repo.tocarLote(input.loteId, tx);
                }),
            async () => {
                // Outro processo inclui o MESMO título agora — peça retry.
                throw new LoteVersaoConflitoError({ loteId: input.loteId, versaoEsperada: -1 });
            },
        );
        await this.audit('incluirTitulo', input.loteId, input.ator, {
            docCod: input.docCod,
            titCod: input.titCod,
        });
        return this.loteCompleto(input.loteId);
    };

    public removerTitulo = async (input: IncluirTituloInput): Promise<LotePagamento> => {
        const lote = await this.exigirLote(input.loteId);
        if (lote.status !== LOTE_STATUS.RASCUNHO) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'remover título',
            });
        }
        await this.db.withTransaction(async (tx) => {
            await this.repo.removerItem(
                {
                    loteId: input.loteId,
                    filCod: input.filCod,
                    docCod: input.docCod,
                    titCod: input.titCod,
                },
                tx,
            );
            // ADR-0063: o item saiu do lote — as alertas vivas dele são DESCARTADAS (trilha).
            await this.alertaRepo.descartarDoItem(
                input.loteId,
                { filCod: input.filCod, docCod: input.docCod, titCod: input.titCod },
                input.ator,
                tx,
            );
            // O analista mexeu num lote automático → vira manual (cron para de gerenciar).
            if (lote.automatico) await this.repo.marcarManual(input.loteId, tx);
            await this.repo.tocarLote(input.loteId, tx);
        });
        await this.audit('removerTitulo', input.loteId, input.ator, {
            docCod: input.docCod,
            titCod: input.titCod,
        });
        return this.loteCompleto(input.loteId);
    };

    /**
     * "Retirar do lote" na aba de títulos (ADR-0050): acha o lote RASCUNHO em que o título está e
     * o remove, com as mesmas regras da lixeira. O título fica solto: pode ir para outro lote à
     * mão, e a formação automática pode lotá-lo de novo numa rodada futura.
     */
    public retirarDoLote = async (
        input: ChaveTitulo & { ator: string },
    ): Promise<LotePagamento> => {
        const chave = { filCod: input.filCod, docCod: input.docCod, titCod: input.titCod };
        const loteId = await this.repo.loteRascunhoComTitulo(chave);
        if (!loteId) throw new TituloForaDeLoteError(chave);
        return this.removerTitulo({ loteId, ...chave, ator: input.ator });
    };

    /** GATE (I5) — finaliza o lote (≥1 item; optimistic lock por `versao`). */
    public finalizarLote = async (input: TransicaoInput): Promise<LotePagamento> => {
        const lote = await this.exigirLote(input.loteId);
        if (lote.status !== LOTE_STATUS.RASCUNHO) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'finalizar',
            });
        }
        const n = await this.repo.contarItens(input.loteId);
        if (n === 0) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'finalizar',
                motivo: 'Não é possível finalizar um lote vazio. Inclua ao menos um título.',
            });
        }
        // G-13: a remessa sai de UMA conta. Sem ela escolhida, falha aqui — não na geração.
        if (!lote.conta) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'finalizar',
                motivo: `Defina a conta pagadora do lote antes de finalizar (a filial ${lote.filCod} não tem uma conta Itaú inequívoca).`,
            });
        }
        // A2: revisão obrigatória — todo item precisa de forma de pagamento definida.
        const semModalidade = await this.repo.contarItensSemModalidade(input.loteId);
        if (semModalidade > 0) {
            throw new ModalidadePendenteError({ loteId: lote.id, pendentes: semModalidade });
        }
        // ADR-0063 (I13a/b/f/j) — re-verifica TODOS os itens TED/PIX antes da transição L3. Substitui
        // a checagem de oferta da ADR-0054/0061 (I12f): o destino é resolvido pela MESMA função
        // (`DestinoPagamentoResolver`), agora dentro da verificação, que aposenta a exceção que o
        // cadastro tornou desnecessária (I12c). Ordem dos bloqueios (documentada no teste):
        //   1. a verificação retirou item(ns) → `ItemsRemovedByCheckError` (lote segue RASCUNHO, Q5);
        //   2. item PENDENTE (Conexos não respondeu) → `PaymentCheckPendingError` (falha fechada);
        //   3. alerta de duplicidade ABERTA → `PendingDuplicateAlertError`. Canal habitual não barra.
        const verificacao = await this.verificacao.verificarItens(input.loteId, {
            aposentarExcecao: true,
        });
        if (verificacao.retirados.length > 0) {
            throw new ItemsRemovedByCheckError({ loteId: lote.id, itens: verificacao.retirados });
        }
        if (verificacao.pendentes.length > 0) {
            throw new PaymentCheckPendingError({ loteId: lote.id, itens: verificacao.pendentes });
        }
        await this.exigirDuplicidadesTratadas(lote);
        return this.transicionar(input, {
            de: [LOTE_STATUS.RASCUNHO],
            para: LOTE_STATUS.FINALIZADO,
            acao: 'finalizar',
            finalizadoPor: input.ator,
        });
    };

    /** L4 — reabre; limpa a conferência (ADR-0063, I13l), com evento na trilha quando havia uma. */
    public reabrirLote = async (input: TransicaoInput): Promise<LotePagamento> => {
        const antes = await this.repo.getLoteComItens(input.loteId);
        return this.transicionar(
            input,
            { de: [LOTE_STATUS.FINALIZADO], para: LOTE_STATUS.RASCUNHO, acao: 'reabrir' },
            antes?.conferidoPor
                ? (tx) =>
                      this.eventos.registrar(
                          {
                              evento: VERIFICATION_EVENT.CONFERENCIA_LIMPA,
                              ator: input.ator,
                              loteId: input.loteId,
                              dados: { conferidoPor: antes.conferidoPor, acao: 'reabrir' },
                          },
                          tx,
                      )
                : undefined,
        );
    };

    public cancelarLote = (input: TransicaoInput): Promise<LotePagamento> =>
        this.transicionar(input, {
            de: [LOTE_STATUS.RASCUNHO, LOTE_STATUS.FINALIZADO],
            para: LOTE_STATUS.CANCELADO,
            acao: 'cancelar',
        });

    // -------------------------------------------------------------- internals

    /**
     * I13f — alerta de duplicidade ABERTA de item que ainda está no lote barra o finalizar, com a
     * lista por item (e a contraparte). Alerta de canal habitual NÃO barra.
     */
    private exigirDuplicidadesTratadas = async (lote: LotePagamento): Promise<void> => {
        const abertas = (await this.alertaRepo.listVivasDosLotes([lote.id])).filter(
            (a) => a.estado === ITEM_ALERT_STATE.ABERTA && DUPLICATE_ALERT_TYPES.includes(a.tipo),
        );
        const porItem = new Map<string, AlertaItemLote[]>();
        for (const a of abertas) {
            const lista = porItem.get(chaveItem(a)) ?? [];
            lista.push(a);
            porItem.set(chaveItem(a), lista);
        }
        const itens = lote.itens.flatMap((i) => {
            const alertas = porItem.get(chaveItem(i));
            if (!alertas) return [];
            return [
                {
                    docCod: i.docCod,
                    titCod: i.titCod,
                    ...(i.credor ? { credor: i.credor } : {}),
                    alertas: alertas.map((a) => ({
                        id: a.id,
                        tipo: a.tipo,
                        ...(a.contraparteFilCod !== undefined
                            ? { contraparteFilCod: a.contraparteFilCod }
                            : {}),
                        ...(a.contraparteDocCod ? { contraparteDocCod: a.contraparteDocCod } : {}),
                    })),
                },
            ];
        });
        if (itens.length > 0) throw new PendingDuplicateAlertError({ loteId: lote.id, itens });
    };

    /** Anexa a cada item as alertas VIVAS dele (ABERTA | RESOLVIDA) — uma consulta por chamada. */
    private comAlertas = async (lotes: LotePagamento[]): Promise<LotePagamento[]> => {
        if (lotes.length === 0) return lotes;
        const alertas = await this.alertaRepo.listVivasDosLotes(lotes.map((l) => l.id));
        if (alertas.length === 0) return lotes;
        const porItem = new Map<string, AlertaItemLote[]>();
        for (const a of alertas) {
            const k = `${a.loteId}|${chaveItem(a)}`;
            const lista = porItem.get(k) ?? [];
            lista.push(a);
            porItem.set(k, lista);
        }
        return lotes.map((l) => ({
            ...l,
            itens: l.itens.map((i) => {
                const doItem = porItem.get(`${l.id}|${chaveItem(i)}`);
                return doItem ? { ...i, alertas: doItem } : i;
            }),
        }));
    };

    /** O lote como sai para a API depois de uma mutação: itens + alertas. */
    private loteCompleto = async (id: string): Promise<LotePagamento> => {
        const [completo] = await this.comAlertas([await this.exigirLote(id)]);
        if (!completo) return this.exigirLote(id);
        return completo;
    };

    private transicionar = async (
        input: TransicaoInput,
        t: {
            de: LotePagamentoStatus[];
            para: LotePagamentoStatus;
            acao: string;
            finalizadoPor?: string;
        },
        /** Efeito na MESMA transação da troca de status (ex.: evento de conferência limpa). */
        naTransacao?: (tx: TransactionClient) => Promise<unknown>,
    ): Promise<LotePagamento> => {
        const afetadas = await this.db.withTransaction(async (tx) => {
            const n = await this.repo.transicionarStatus(
                {
                    id: input.loteId,
                    de: t.de,
                    para: t.para,
                    versaoEsperada: input.versao,
                    finalizadoPor: t.finalizadoPor,
                },
                tx,
            );
            if (n > 0 && naTransacao) await naTransacao(tx);
            return n;
        });
        if (afetadas === 0) {
            // Distingue conflito de versão vs. estado incompatível relendo.
            const atual = await this.exigirLote(input.loteId);
            if (atual.versao !== input.versao) {
                throw new LoteVersaoConflitoError({
                    loteId: input.loteId,
                    versaoEsperada: input.versao,
                });
            }
            throw new LoteEstadoInvalidoError({
                loteId: input.loteId,
                statusAtual: atual.status,
                acao: t.acao,
            });
        }
        await this.audit(t.acao, input.loteId, input.ator, { para: t.para });
        return this.loteCompleto(input.loteId);
    };

    private exigirLote = async (id: string): Promise<LotePagamento> => {
        const lote = await this.repo.getLoteComItens(id);
        if (!lote) {
            throw new LoteEstadoInvalidoError({
                loteId: id,
                statusAtual: 'inexistente',
                acao: 'operar',
                motivo: 'Lote não encontrado.',
            });
        }
        return lote;
    };

    /** Hash determinístico (filCod:docCod:titCod) → int32 p/ advisory lock (I3). */
    private lockKey = (filCod: number, docCod: string, titCod: string): number => {
        const s = `${filCod}:${docCod}:${titCod}`;
        let h = 0;
        for (let i = 0; i < s.length; i += 1) {
            h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
        }
        return h;
    };

    private audit = (
        acao: string,
        loteId: string,
        ator: string,
        extra: Record<string, unknown>,
    ): Promise<void> =>
        this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: `SISPAG lote: ${acao}`,
            data: { loteId, ator, ...extra },
        });
}
