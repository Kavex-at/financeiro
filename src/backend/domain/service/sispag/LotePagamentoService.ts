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
import DestinoPagamentoAusenteError from '../../errors/DestinoPagamentoAusenteError.js';
import ContaPagadoraResolver from './ContaPagadoraResolver.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    type ChaveTitulo,
    type CriarLoteInput,
    type IncluirTituloInput,
    type ListarLotesFiltro,
    type LotePagamento,
    type LotePagamentoStatus,
    LOTE_STATUS,
    MODALIDADE,
    type Modalidade,
} from '../../interface/sispag/SispagInterface.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import LogService from '../LogService.js';
import SispagPainelService from './SispagPainelService.js';

interface TransicaoInput {
    loteId: string;
    versao: number;
    ator: string;
}

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
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(SispagPainelService) private readonly painel: SispagPainelService,
        @inject(ContaPagadoraResolver) private readonly contaResolver: ContaPagadoraResolver,
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
        return this.exigirLote(input.loteId);
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
        return this.exigirLote(input.loteId);
    };

    public listarLotes = (filtro: ListarLotesFiltro): Promise<LotePagamento[]> =>
        this.repo.listLotes(filtro);

    public getLote = (id: string): Promise<LotePagamento | null> => this.repo.getLoteComItens(id);

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
            return lote;
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
        return this.exigirLote(input.loteId);
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
            // O analista mexeu num lote automático → vira manual (cron para de gerenciar).
            if (lote.automatico) await this.repo.marcarManual(input.loteId, tx);
            await this.repo.tocarLote(input.loteId, tx);
        });
        await this.audit('removerTitulo', input.loteId, input.ator, {
            docCod: input.docCod,
            titCod: input.titCod,
        });
        return this.exigirLote(input.loteId);
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
        // ADR-0054 (Adendo) + ADR-0060 I12f — FALHA FECHADA: item TED/PIX sem destino resolvível
        // (cadastro do Conexos ou exceção APROVADA) barra o finalizar.
        await this.exigirDestinoOfertado(lote);
        return this.transicionar(input, {
            de: [LOTE_STATUS.RASCUNHO],
            para: LOTE_STATUS.FINALIZADO,
            acao: 'finalizar',
            finalizadoPor: input.ator,
        });
    };

    public reabrirLote = (input: TransicaoInput): Promise<LotePagamento> =>
        this.transicionar(input, {
            de: [LOTE_STATUS.FINALIZADO],
            para: LOTE_STATUS.RASCUNHO,
            acao: 'reabrir',
        });

    public cancelarLote = (input: TransicaoInput): Promise<LotePagamento> =>
        this.transicionar(input, {
            de: [LOTE_STATUS.RASCUNHO, LOTE_STATUS.FINALIZADO],
            para: LOTE_STATUS.CANCELADO,
            acao: 'cancelar',
        });

    // -------------------------------------------------------------- internals

    private flagsDestino = async (): Promise<{
        ted: boolean;
        pix: boolean;
        excecao: boolean;
    }> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        return {
            ted: env.sispagTedEnabled === true,
            pix: env.sispagPixEnabled === true,
            excecao: env.sispagExcecaoDestinoEnabled === true,
        };
    };

    /**
     * Checagem do finalizar (ADR-0054 Adendo, ADR-0060 I12f): item TED/PIX — com a flag da
     * modalidade ligada — sem a modalidade na OFERTA do painel. A oferta usa o mesmo resolver do
     * envio (cadastro primeiro, exceção APROVADA como fallback), então "ofertado" cobre os dois.
     * Pede também a aposentadoria das exceções que o cadastro tornou desnecessárias (I12c). A
     * checagem estrita, autoritativa, continua no envio. Com as flags desligadas não consulta
     * nada. A mensagem nomeia o item (docCod/titCod, credor), nunca o destino (I10h).
     */
    private exigirDestinoOfertado = async (lote: LotePagamento): Promise<void> => {
        const flags = await this.flagsDestino();
        const alvo = lote.itens.filter(
            (i) =>
                (i.modalidade === MODALIDADE.TED && flags.ted) ||
                (i.modalidade === MODALIDADE.PIX && flags.pix),
        );
        if (alvo.length === 0) return;
        const oferta = await this.painel.modalidadesDisponiveisDoLote(lote.id, {
            aposentarExcecao: true,
        });
        const ofertadas = new Map(oferta.map((o) => [`${o.docCod}:${o.titCod}`, o.modalidades]));
        const semDestino = alvo.filter((i) => {
            const modalidade = i.modalidade;
            return !modalidade || !ofertadas.get(`${i.docCod}:${i.titCod}`)?.includes(modalidade);
        });
        if (semDestino.length > 0) {
            throw new DestinoPagamentoAusenteError({
                itens: semDestino.map((i) => ({
                    docCod: i.docCod,
                    titCod: i.titCod,
                    ...(i.credor ? { credor: i.credor } : {}),
                    ...(i.modalidade ? { modalidade: i.modalidade } : {}),
                })),
            });
        }
    };

    private transicionar = async (
        input: TransicaoInput,
        t: {
            de: LotePagamentoStatus[];
            para: LotePagamentoStatus;
            acao: string;
            finalizadoPor?: string;
        },
    ): Promise<LotePagamento> => {
        const afetadas = await this.repo.transicionarStatus({
            id: input.loteId,
            de: t.de,
            para: t.para,
            versaoEsperada: input.versao,
            finalizadoPor: t.finalizadoPor,
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
        return this.exigirLote(input.loteId);
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
