import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteFilialError from '../../errors/LoteFilialError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import ModalidadePendenteError from '../../errors/ModalidadePendenteError.js';
import TituloEmOutroLoteError from '../../errors/TituloEmOutroLoteError.js';
import TituloNaoElegivelError from '../../errors/TituloNaoElegivelError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    CONTA_PAGADORA_DEFAULT,
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
import LogService from '../LogService.js';

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
    ) {}

    public criarLote = async (input: CriarLoteInput): Promise<LotePagamento> => {
        // A3: conta pagadora default = Itaú (o analista troca na revisão se preciso).
        const lote = await this.repo.criarLote({
            filCod: input.filCod,
            banco: input.banco ?? CONTA_PAGADORA_DEFAULT.banco,
            conta: input.conta ?? CONTA_PAGADORA_DEFAULT.conta,
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
        // A2: revisão obrigatória — todo item precisa de forma de pagamento definida.
        const semModalidade = await this.repo.contarItensSemModalidade(input.loteId);
        if (semModalidade > 0) {
            throw new ModalidadePendenteError({ loteId: lote.id, pendentes: semModalidade });
        }
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

    /**
     * Retorno do Nexxera recebido: FINALIZADO (aguardando) → RETORNADO ("de volta do Nexxera").
     * Hoje é acionado manualmente (simula o retorno); o gatilho real é o robô-poller (Fatia 3).
     */
    public marcarRetorno = (input: TransicaoInput): Promise<LotePagamento> =>
        this.transicionar(input, {
            de: [LOTE_STATUS.FINALIZADO],
            para: LOTE_STATUS.RETORNADO,
            acao: 'marcar retorno',
        });

    // -------------------------------------------------------------- internals

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
