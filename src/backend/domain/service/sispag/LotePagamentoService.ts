import { inject, injectable } from 'tsyringe';
import ConexosSispagClient from '../../client/ConexosSispagClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteFilialError from '../../errors/LoteFilialError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import ModalidadePendenteError from '../../errors/ModalidadePendenteError.js';
import TitleAdjustmentInProgressError from '../../errors/TitleAdjustmentInProgressError.js';
import TituloEmOutroLoteError from '../../errors/TituloEmOutroLoteError.js';
import TitleInCommittedBatchError from '../../errors/TitleInCommittedBatchError.js';
import TituloForaDeLoteError from '../../errors/TituloForaDeLoteError.js';
import TituloNaoElegivelError from '../../errors/TituloNaoElegivelError.js';
import BatchHasBlockedItemsError, {
    type ItemBloqueadoNoLote,
} from '../../errors/BatchHasBlockedItemsError.js';
import DuplicateHoldError from '../../errors/DuplicateHoldError.js';
import BatchEmptiedByCheckError from '../../errors/BatchEmptiedByCheckError.js';
import PaymentModalityUnavailableError from '../../errors/PaymentModalityUnavailableError.js';
import PaymentCheckPendingError from '../../errors/PaymentCheckPendingError.js';
import PendingDuplicateAlertError from '../../errors/PendingDuplicateAlertError.js';
import GroupedBoletoIndivisibleError from '../../errors/GroupedBoletoIndivisibleError.js';
import GroupedBoletoNotFoundError from '../../errors/GroupedBoletoNotFoundError.js';
import GroupedBoletoStateConflictError from '../../errors/GroupedBoletoStateConflictError.js';
import GroupedBoletoTitleIneligibleError, {
    type TituloInelegivelGrupo,
} from '../../errors/GroupedBoletoTitleIneligibleError.js';
import {
    type ChaveTituloGrupo,
    GRUPO_BOLETO_ESTADO,
    type GrupoBoleto,
    MOTIVO_GRUPO_INELEGIVEL,
    MOTIVO_GRUPO_ORFAO,
    type MotivoGrupoInelegivel,
    type MotivoGrupoOrfao,
} from '../../interface/sispag/GrupoBoletoInterface.js';
import {
    AVISO_INCLUSAO_GRUPO,
    type AvisoInclusaoGrupo,
    type GrupoNoLote,
} from '../../interface/sispag/GrupoNoLoteInterface.js';
import ContaPagadoraResolver from './ContaPagadoraResolver.js';
import SituacaoPagamentoService, {
    AVALIACAO_INCLUSAO,
    type AvaliacaoInclusao,
} from './SituacaoPagamentoService.js';
import {
    type CriarLotesPorFilialInput,
    type CriarLotesPorFilialResult,
    type LoteCriadoPorFilial,
    RESULTADO_LOTE_FILIAL,
    type TituloRecusadoNoLote,
} from '../../interface/sispag/SituacaoPagamento.js';
import { isHandlerError } from '../../libs/handler/HandlerError.js';
import {
    ESTADO_PAGAMENTO,
    type MotivoPagamento,
} from '../../interface/sispag/SituacaoPagamento.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    type AlertaItemLote,
    type ItemLote,
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
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import LotePagamentoRepository, {
    RESULTADO_OPERACAO_GRUPO,
} from '../../repository/sispag/LotePagamentoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import LogService from '../LogService.js';
import DisparoLimpezaBorderoGrupo from './DisparoLimpezaBorderoGrupo.js';
import LeituraGrupoBoleto from './LeituraGrupoBoleto.js';
import VerificacaoTedPixService, {
    type ItemRetirado,
    VERIFICATION_MODE,
} from './VerificacaoTedPixService.js';

interface TransicaoInput {
    loteId: string;
    versao: number;
    ator: string;
}

/** Resultado do finalizar (ADR-0065 L3): o lote e os itens que a verificação retirou. */
export interface LoteFinalizado {
    lote: LotePagamento;
    retirados: ItemRetirado[];
}

/** Resultado de incluir um grupo de boleto no lote: o lote e os avisos (não barram). */
export interface GrupoIncluidoNoLote {
    lote: LotePagamento;
    avisos: AvisoInclusaoGrupo[];
}

/** Motivo do órfão (I21u) na língua da inelegibilidade de título (I21c). */
const MOTIVO_DO_ORFAO: Readonly<Record<MotivoGrupoOrfao, MotivoGrupoInelegivel>> = {
    [MOTIVO_GRUPO_ORFAO.BOLETO_FORA_DO_POOL]: MOTIVO_GRUPO_INELEGIVEL.BOLETO_INDISPONIVEL,
    [MOTIVO_GRUPO_ORFAO.BOLETO_VINCULADO_ERP]: MOTIVO_GRUPO_INELEGIVEL.BOLETO_VINCULADO_ERP,
    [MOTIVO_GRUPO_ORFAO.TITULO_PAGO]: MOTIVO_GRUPO_INELEGIVEL.PAGO,
    [MOTIVO_GRUPO_ORFAO.TITULO_INATIVO]: MOTIVO_GRUPO_INELEGIVEL.INATIVO,
    [MOTIVO_GRUPO_ORFAO.TITULO_COM_DDA_ERP]: MOTIVO_GRUPO_INELEGIVEL.TEM_BOLETO_ERP,
    [MOTIVO_GRUPO_ORFAO.VALOR_LIQUIDO_DIVERGENTE]: MOTIVO_GRUPO_INELEGIVEL.SOMA_DIFERENTE,
};

const chaveDoTitulo = (c: ChaveTituloGrupo): ChaveTituloGrupo => ({
    filCod: c.filCod,
    docCod: c.docCod,
    titCod: c.titCod,
});

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
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(SituacaoPagamentoService)
        private readonly situacaoPagamento: SituacaoPagamentoService,
        @inject(GrupoBoletoRepository) private readonly grupoRepo: GrupoBoletoRepository,
        @inject(LeituraGrupoBoleto) private readonly leituraGrupo: LeituraGrupoBoleto,
        @inject(DisparoLimpezaBorderoGrupo)
        private readonly disparoLimpeza: DisparoLimpezaBorderoGrupo,
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
        await this.exigirModalidadeDisponivel(input.loteId, input.modalidade);
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
        // ADR-0063 I13a / ADR-0065 I14e-1 — TED/PIX dispara a verificação SÓ deste item, que só
        // AVISA (selo `autorizacaoAviso`), nunca retira; qualquer outra forma descarta as alertas.
        const chave = { filCod: input.filCod, docCod: input.docCod, titCod: input.titCod };
        if (this.verificacao.ehVerificavel({ modalidade: input.modalidade })) {
            await this.verificacao.verificarItens(input.loteId, {
                itens: [chave],
                modo: VERIFICATION_MODE.AVISO,
            });
        } else {
            await this.verificacao.descartarVerificacao(input.loteId, chave, input.ator);
        }
        return this.loteCompleto(input.loteId);
    };

    /** Lotes com as alertas vivas de cada item (ADR-0063): a tela mostra os badges na listagem. */
    public listarLotes = async (filtro: ListarLotesFiltro): Promise<LotePagamento[]> =>
        this.comGrupos(await this.comAlertas(await this.repo.listLotes(filtro)));

    public getLote = async (id: string): Promise<LotePagamento | null> => {
        const lote = await this.repo.getLoteComItens(id);
        if (!lote) return null;
        const [completo] = await this.comGrupos(await this.comAlertas([lote]));
        return completo ?? lote;
    };

    /**
     * ADR-0075 (D8, D15): um lote por filial, criado de uma vez. Cada título passa por
     * `incluirTitulo` (a MESMA regra do caminho manual, inclusive a situação de pagamento); o que é
     * recusado volta em `recusados` com o motivo, sem derrubar o resto. Um lote que falha NÃO desfaz
     * os outros, e um lote em que nenhum título entrou é descartado (nasceu vazio, sem rastro).
     */
    public criarLotesPorFilial = async (
        input: CriarLotesPorFilialInput & { ator: string },
    ): Promise<CriarLotesPorFilialResult> => {
        const porFilial = new Map<number, ChaveTitulo[]>();
        const vistos = new Set<string>();
        for (const t of input.titulos) {
            const chave = `${t.filCod}:${t.docCod}:${t.titCod}`;
            if (vistos.has(chave)) continue;
            vistos.add(chave);
            porFilial.set(t.filCod, [...(porFilial.get(t.filCod) ?? []), t]);
        }
        const lotes: LoteCriadoPorFilial[] = [];
        for (const [filCod, titulos] of porFilial) {
            lotes.push(await this.criarLoteDaFilial(filCod, titulos, input));
        }
        return { lotes };
    };

    private criarLoteDaFilial = async (
        filCod: number,
        titulos: ChaveTitulo[],
        input: { ator: string; mover?: boolean },
    ): Promise<LoteCriadoPorFilial> => {
        const recusados: TituloRecusadoNoLote[] = [];
        const incluidos: ChaveTitulo[] = [];
        let lote: LotePagamento;
        try {
            lote = await this.criarLote({ filCod, ator: input.ator });
        } catch (error) {
            const recusa = await this.recusaDe(error);
            return {
                filCod,
                resultado: RESULTADO_LOTE_FILIAL.RECUSADO,
                incluidos,
                recusados: titulos.map((chave) => ({ chave, ...recusa })),
            };
        }
        for (const chave of titulos) {
            try {
                await this.incluirTitulo({
                    loteId: lote.id,
                    ...chave,
                    ator: input.ator,
                    ...(input.mover ? { mover: true } : {}),
                });
                incluidos.push(chave);
            } catch (error) {
                recusados.push({ chave, ...(await this.recusaDe(error)) });
            }
        }
        if (incluidos.length === 0) {
            await this.repo.cancelarSeVazio(lote.id).catch(() => false);
            return { filCod, resultado: RESULTADO_LOTE_FILIAL.RECUSADO, incluidos, recusados };
        }
        return {
            filCod,
            resultado:
                recusados.length > 0 ? RESULTADO_LOTE_FILIAL.PARCIAL : RESULTADO_LOTE_FILIAL.CRIADO,
            loteId: lote.id,
            incluidos,
            recusados,
        };
    };

    /** Recusa de um título: regra de domínio devolve a mensagem dela; o resto vira erro genérico. */
    private recusaDe = async (
        error: unknown,
    ): Promise<Pick<TituloRecusadoNoLote, 'codigo' | 'mensagem' | 'motivo'>> => {
        if (isHandlerError(error)) {
            const motivo = (error.details as { motivoPagamento?: MotivoPagamento } | undefined)
                ?.motivoPagamento;
            return {
                codigo: error.code,
                mensagem: error.userMessage,
                ...(motivo !== undefined ? { motivo } : {}),
            };
        }
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message: 'criação de lotes por filial: falha inesperada ao incluir um título',
            data: { erro: error instanceof Error ? error.message : String(error) },
        });
        return {
            codigo: 'ERRO_INESPERADO',
            mensagem:
                'Não foi possível incluir este título. Tente de novo; se persistir, avise o time.',
        };
    };

    /**
     * ADR-0075: a MESMA regra da tela. Aprovação, pagamento e vencimento são os lidos AO VIVO; tipo
     * (permuta), forma no Conexos, ajuste de centavos e boleto vêm do contexto. Título bloqueado não
     * entra, com o motivo, o dono e a ação na resposta (422).
     *
     * I19s, fail-closed: título que a regra não conseguiu avaliar por inteiro também não entra —
     * fora da carteira persistida, leitura falhou ou alguma fonte de contexto caiu. Bloqueado vem
     * primeiro: se o que se leu já bloqueia, a analista vê o motivo real, não "tente de novo".
     */
    private exigirSituacaoPagavel = async (
        chave: { filCod: number; docCod: string; titCod: string },
        vivo: TituloAPagar,
    ): Promise<void> => {
        const avaliacao = await this.situacaoPagamento.avaliarVivo(
            { filCod: chave.filCod, docCod: chave.docCod, titCod: chave.titCod },
            vivo,
        );
        const titulo = { docCod: chave.docCod, titCod: chave.titCod };
        if (avaliacao.resultado !== AVALIACAO_INCLUSAO.AVALIADA) {
            throw new TituloNaoElegivelError({
                ...titulo,
                motivo:
                    avaliacao.resultado === AVALIACAO_INCLUSAO.FORA_DA_CARTEIRA
                        ? 'fora-da-carteira'
                        : 'situacao-indisponivel',
            });
        }
        const { situacao, fontesIndisponiveis } = avaliacao;
        if (situacao.estado === ESTADO_PAGAMENTO.BLOQUEADO) {
            throw new TituloNaoElegivelError({ ...titulo, motivo: 'situacao-pagamento', situacao });
        }
        if (fontesIndisponiveis.length > 0) {
            throw new TituloNaoElegivelError({
                ...titulo,
                motivo: 'situacao-indisponivel',
                fontesIndisponiveis,
            });
        }
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
                origem: bloqueio.origem,
                ...(bloqueio.codigoMascarado !== undefined
                    ? { codigoMascarado: bloqueio.codigoMascarado }
                    : {}),
                ...(bloqueio.tituloMantido
                    ? {
                          tituloMantido: {
                              docCod: bloqueio.tituloMantido.docCod,
                              titCod: bloqueio.tituloMantido.titCod,
                          },
                      }
                    : {}),
            });
        }
        // ADR-0077 I21j — título de grupo de boleto confirmado só entra, sai e se move com o grupo.
        await this.exigirForaDeGrupo(input);
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
        await this.exigirSituacaoPagavel(input, titulo);
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
        const chave = { filCod: input.filCod, docCod: input.docCod, titCod: input.titCod };
        let origem: { loteId: string; cancelado: boolean } | undefined;
        await this.db.withAdvisoryLock(
            lockKey,
            () =>
                this.db.withTransaction(async (tx) => {
                    // ADR-0064 — lote FINALIZADO/REMESSA_GERADA compromete o título: nem entra
                    // em outro lote, nem se move (o pagamento já está a caminho do banco).
                    const comprometido = await this.repo.loteComprometidoComTitulo(chave, tx);
                    if (comprometido) {
                        throw new TitleInCommittedBatchError({
                            docCod: input.docCod,
                            titCod: input.titCod,
                            loteId: comprometido.loteId,
                            status: comprometido.status,
                        });
                    }
                    const outroLote = await this.repo.loteRascunhoComTitulo(chave, tx);
                    if (outroLote && outroLote !== input.loteId) {
                        if (!input.mover) {
                            throw new TituloEmOutroLoteError({
                                docCod: input.docCod,
                                titCod: input.titCod,
                                loteId: outroLote,
                            });
                        }
                        // ADR-0064 — mover: sai da origem na MESMA transação em que entra aqui.
                        origem = await this.retirarDaOrigem(outroLote, chave, input.ator, tx);
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
        await this.audit(origem ? 'moverTitulo' : 'incluirTitulo', input.loteId, input.ator, {
            docCod: input.docCod,
            titCod: input.titCod,
            ...(origem ? { loteOrigem: origem.loteId, origemCancelada: origem.cancelado } : {}),
        });
        return this.loteCompleto(input.loteId);
    };

    /**
     * Metade "sai" do mover (ADR-0064), dentro da transação do incluir: remove o item da origem só
     * se ela ainda é RASCUNHO, descarta as alertas vivas dele lá, adota a origem como manual (a
     * analista mexeu nela — `marcarManual` é idempotente), bumpa a versão (quem estiver com a
     * origem aberta recebe conflito) e cancela a origem se ela ficou vazia.
     */
    private retirarDaOrigem = async (
        loteId: string,
        chave: ChaveTitulo,
        ator: string,
        tx: TransactionClient,
    ): Promise<{ loteId: string; cancelado: boolean }> => {
        const removidos = await this.repo.removerItemDeRascunho({ loteId, ...chave }, tx);
        if (removidos === 0) {
            throw new LoteEstadoInvalidoError({
                loteId,
                statusAtual: 'alterado',
                acao: 'mover título',
                motivo: 'O lote de origem deixou de ser rascunho. Atualize a tela e tente de novo.',
            });
        }
        await this.alertaRepo.descartarDoItem(loteId, chave, ator, tx);
        await this.repo.marcarManual(loteId, tx);
        await this.repo.tocarLote(loteId, tx);
        const cancelado = await this.repo.cancelarSeVazio(loteId, tx);
        return { loteId, cancelado };
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
        // ADR-0077 I21j — um título de grupo nunca sai sozinho.
        const doGrupo = lote.itens.find(
            (i) => i.docCod === input.docCod && i.titCod === input.titCod && i.grupoBoletoId,
        )?.grupoBoletoId;
        if (doGrupo) throw await this.erroIndivisivelPorId(doGrupo);
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

    // ─────────────────────────────────────────── grupo de boleto (ADR-0077, I21j, L2)

    /**
     * Inclui um grupo de boleto `CONFIRMADO` inteiro no lote RASCUNHO da mesma filial (I21j, L2):
     * N itens `BOLETO` com `grupoBoletoId`, numa transação, ou nada. Antes do lock, sem segurar
     * conexão: retenção e órfão locais (I21c, I21u) e I2 por título na re-leitura Conexos, como o
     * `incluirTitulo`. Dentro da transação, sob os locks I3 dos títulos: lote comprometido recusa
     * (ADR-0064); título em outro RASCUNHO exige `mover` (sai de lá na mesma transação); título
     * avulso neste lote vira item do grupo. I21h com a `dataDebito` do lote quando houver.
     * Grupo com J rejeitado entra à mão (I21r) e a resposta traz o aviso do borderô antigo.
     */
    public incluirGrupo = async (input: {
        loteId: string;
        grupoId: string;
        mover?: boolean;
        ator: string;
        versaoEsperada?: number;
    }): Promise<GrupoIncluidoNoLote> => {
        const lote = await this.exigirLote(input.loteId);
        if (lote.status !== LOTE_STATUS.RASCUNHO) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'incluir grupo de boleto',
            });
        }
        if (input.versaoEsperada !== undefined && lote.versao !== input.versaoEsperada) {
            throw new LoteVersaoConflitoError({
                loteId: lote.id,
                versaoEsperada: input.versaoEsperada,
            });
        }
        const grupo = await this.exigirGrupoConfirmado(input.grupoId);
        if (grupo.filCod !== lote.filCod) {
            throw new LoteFilialError({ loteFilCod: lote.filCod, tituloFilCod: grupo.filCod });
        }
        const chaves = grupo.titulos.map(chaveDoTitulo);
        const jaNoLote = chaves.every((c) =>
            lote.itens.some(
                (i) =>
                    i.grupoBoletoId === grupo.id &&
                    i.filCod === c.filCod &&
                    i.docCod === c.docCod &&
                    i.titCod === c.titCod,
            ),
        );
        if (jaNoLote) {
            return { lote: await this.loteCompleto(lote.id), avisos: await this.avisos(grupo) };
        }
        await this.exigirGrupoLivre(grupo);
        const lidos = await this.lerTitulosDoGrupo(grupo);
        if (lote.dataDebito !== undefined && grupo.vencimentoBoleto < lote.dataDebito) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'incluir grupo de boleto',
                motivo:
                    `O boleto agrupado vence em ${grupo.vencimentoBoleto}, antes da data de débito ` +
                    `do lote (${lote.dataDebito}). Troque a data de débito ou use outro lote.`,
            });
        }
        let origens: string[] = [];
        await this.db.withTransaction(async (tx) => {
            // Ordem fixa de locks (T8): boleto → títulos (a mesma da confirmação e da anulação),
            // depois as chaves I3 da inclusão avulsa, que só este caminho toma em transação.
            await this.grupoRepo.travar(tx, [
                GrupoBoletoRepository.chaveLockBoleto(grupo.ddcCod, grupo.ditCod),
                ...chaves.map(GrupoBoletoRepository.chaveLockTitulo),
            ]);
            await this.repo.travarTitulosNaTransacao(
                chaves.map((c) => this.lockKey(c.filCod, c.docCod, c.titCod)),
                tx,
            );
            const atual = await this.grupoRepo.buscarPorId(grupo.id, tx);
            if (!atual || atual.estado !== GRUPO_BOLETO_ESTADO.CONFIRMADO) {
                throw this.erroGrupoNaoConfirmado(atual ?? grupo);
            }
            origens = await this.liberarTitulosParaOGrupo(lote.id, chaves, input, tx);
            const r = await this.repo.adicionarGrupo(
                {
                    loteId: lote.id,
                    grupoId: grupo.id,
                    itens: chaves.map((c, i) => ({
                        ...c,
                        credor: lidos[i]?.credor ?? grupo.credor,
                        valor: lidos[i]?.valor,
                        vencimento: lidos[i]?.vencimento,
                    })),
                    incluidoPor: input.ator,
                    ...(input.versaoEsperada !== undefined
                        ? { versaoEsperada: input.versaoEsperada }
                        : {}),
                },
                tx,
            );
            if (r !== RESULTADO_OPERACAO_GRUPO.APLICADO) {
                throw new LoteVersaoConflitoError({
                    loteId: lote.id,
                    versaoEsperada: input.versaoEsperada ?? -1,
                });
            }
            if (lote.automatico) await this.repo.marcarManual(lote.id, tx);
        });
        await this.audit(origens.length > 0 ? 'moverGrupo' : 'incluirGrupo', lote.id, input.ator, {
            grupoId: grupo.id,
            codbarMascarado: grupo.codbarMascarado,
            titulos: chaves.length,
            ...(origens.length > 0 ? { lotesOrigem: origens } : {}),
        });
        return { lote: await this.loteCompleto(lote.id), avisos: await this.avisos(grupo) };
    };

    /** Retira os N itens do grupo do lote RASCUNHO numa transação (I21j, L2). Idempotente. */
    public removerGrupo = async (input: {
        loteId: string;
        grupoId: string;
        ator: string;
        versaoEsperada?: number;
    }): Promise<LotePagamento> => {
        const lote = await this.exigirLote(input.loteId);
        if (lote.status !== LOTE_STATUS.RASCUNHO) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'retirar grupo de boleto',
            });
        }
        const itens = lote.itens.filter((i) => i.grupoBoletoId === input.grupoId);
        if (itens.length === 0) return this.loteCompleto(lote.id);
        await this.db.withTransaction(async (tx) => {
            const r = await this.repo.removerGrupo(
                {
                    loteId: lote.id,
                    grupoId: input.grupoId,
                    ...(input.versaoEsperada !== undefined
                        ? { versaoEsperada: input.versaoEsperada }
                        : {}),
                },
                tx,
            );
            if (r === RESULTADO_OPERACAO_GRUPO.CONFLITO) {
                throw new LoteVersaoConflitoError({
                    loteId: lote.id,
                    versaoEsperada: input.versaoEsperada ?? -1,
                });
            }
            for (const i of itens) {
                await this.alertaRepo.descartarDoItem(lote.id, chaveDoTitulo(i), input.ator, tx);
            }
            if (lote.automatico) await this.repo.marcarManual(lote.id, tx);
        });
        await this.audit('removerGrupo', lote.id, input.ator, {
            grupoId: input.grupoId,
            titulos: itens.length,
        });
        return this.loteCompleto(lote.id);
    };

    /**
     * Move os N itens do grupo de um RASCUNHO para outro da mesma filial numa transação (I21j,
     * L2): `versao + 1` nos dois; a origem que esvazia vai a `CANCELADO` (ADR-0064).
     */
    public moverGrupo = async (input: {
        origemId: string;
        destinoId: string;
        grupoId: string;
        ator: string;
        versaoOrigem?: number;
        versaoDestino?: number;
    }): Promise<LotePagamento> => {
        const [origem, destino] = await Promise.all([
            this.exigirLote(input.origemId),
            this.exigirLote(input.destinoId),
        ]);
        for (const l of [origem, destino]) {
            if (l.status !== LOTE_STATUS.RASCUNHO) {
                throw new LoteEstadoInvalidoError({
                    loteId: l.id,
                    statusAtual: l.status,
                    acao: 'mover grupo de boleto',
                });
            }
        }
        const grupo = await this.exigirGrupoConfirmado(input.grupoId);
        if (destino.filCod !== grupo.filCod) {
            throw new LoteFilialError({ loteFilCod: destino.filCod, tituloFilCod: grupo.filCod });
        }
        const itens = origem.itens.filter((i) => i.grupoBoletoId === grupo.id);
        let origemCancelada = false;
        await this.db.withTransaction(async (tx) => {
            const r = await this.repo.moverGrupo(
                {
                    origemId: origem.id,
                    destinoId: destino.id,
                    grupoId: grupo.id,
                    ...(input.versaoOrigem !== undefined
                        ? { versaoOrigem: input.versaoOrigem }
                        : {}),
                    ...(input.versaoDestino !== undefined
                        ? { versaoDestino: input.versaoDestino }
                        : {}),
                },
                tx,
            );
            if (r === RESULTADO_OPERACAO_GRUPO.CONFLITO) {
                throw new LoteVersaoConflitoError({
                    loteId: destino.id,
                    versaoEsperada: input.versaoDestino ?? -1,
                });
            }
            if (r === RESULTADO_OPERACAO_GRUPO.AUSENTE) {
                throw new LoteEstadoInvalidoError({
                    loteId: origem.id,
                    statusAtual: origem.status,
                    acao: 'mover grupo de boleto',
                    motivo: 'O grupo de boleto não está neste lote. Atualize a tela.',
                });
            }
            for (const i of itens) {
                await this.alertaRepo.descartarDoItem(origem.id, chaveDoTitulo(i), input.ator, tx);
            }
            await this.repo.marcarManual(origem.id, tx);
            if (destino.automatico) await this.repo.marcarManual(destino.id, tx);
            origemCancelada = await this.repo.cancelarSeVazio(origem.id, tx);
        });
        await this.audit('moverGrupo', destino.id, input.ator, {
            grupoId: grupo.id,
            loteOrigem: origem.id,
            origemCancelada,
        });
        return this.loteCompleto(destino.id);
    };

    /**
     * GATE (I5) — finaliza o lote (≥1 item; optimistic lock por `versao`). ADR-0065 L3: a
     * verificação TED/PIX RETIRA os itens cujo favorecido não está autorizado e o lote finaliza na
     * MESMA chamada com os restantes (a resposta lista os retirados). Ordem dos bloqueios (as
     * retiradas já gravadas ficam):
     *   0. (antes da verificação, ADR-0076 I20d) item com situação de pagamento BLOQUEADA ou não
     *      conferida → `BatchHasBlockedItemsError`, sem retirar nada;
     *   1. item PENDENTE (Conexos não respondeu) → `PaymentCheckPendingError` (falha fechada);
     *   2. todos retirados → `BatchEmptiedByCheckError` (lote segue RASCUNHO);
     *   3. alerta de duplicidade ABERTA → `PendingDuplicateAlertError`.
     */
    public finalizarLote = async (input: TransicaoInput): Promise<LoteFinalizado> => {
        const lote = await this.exigirLote(input.loteId);
        if (lote.status !== LOTE_STATUS.RASCUNHO) {
            throw new LoteEstadoInvalidoError({
                loteId: lote.id,
                statusAtual: lote.status,
                acao: 'finalizar',
            });
        }
        // A versão é checada ANTES da verificação: as retiradas do sistema bumpam a versão, e o
        // que se protege é a edição concorrente de outra pessoa sobre o lote que esta tela viu.
        if (lote.versao !== input.versao) {
            throw new LoteVersaoConflitoError({ loteId: lote.id, versaoEsperada: input.versao });
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
        // I18k/M5 (ADR-0074): título com ajuste de centavos em curso não entra em lote finalizado —
        // o lote nativo fixaria o título antigo, que a renegociação está consumindo.
        const emAjuste = await this.repo.titulosComAjusteNaoTerminalNoLote(input.loteId);
        if (emAjuste.length > 0) {
            throw new TitleAdjustmentInProgressError({ loteId: lote.id, titulos: emAjuste });
        }
        // A2: revisão obrigatória — todo item precisa de forma de pagamento definida.
        const semModalidade = await this.repo.contarItensSemModalidade(input.loteId);
        if (semModalidade > 0) {
            throw new ModalidadePendenteError({ loteId: lote.id, pendentes: semModalidade });
        }
        // ADR-0076 I20d: ANTES da verificação TED/PIX, para nada ser retirado de um lote recusado.
        await this.exigirSituacoesPagaveis(lote);
        // ADR-0077 L3 — título de grupo inelegível (I2) barra listando o GRUPO: nunca finaliza
        // parte do grupo nem o retira em silêncio.
        await this.exigirGruposElegiveis(lote);
        const verificacao = await this.verificacao.verificarItens(input.loteId, {
            modo: VERIFICATION_MODE.RETIRAR,
        });
        const { retirados } = verificacao;
        if (verificacao.pendentes.length > 0) {
            throw new PaymentCheckPendingError({ loteId: lote.id, itens: verificacao.pendentes });
        }
        let atual = lote;
        if (retirados.length > 0) {
            if ((await this.repo.contarItens(input.loteId)) === 0) {
                throw new BatchEmptiedByCheckError({ loteId: lote.id, itens: retirados });
            }
            atual = await this.exigirLote(input.loteId);
        }
        await this.exigirDuplicidadesTratadas(atual);
        const finalizado = await this.transicionar(
            { ...input, versao: input.versao + retirados.length },
            {
                de: [LOTE_STATUS.RASCUNHO],
                para: LOTE_STATUS.FINALIZADO,
                acao: 'finalizar',
                finalizadoPor: input.ator,
            },
        );
        return { lote: finalizado, retirados };
    };

    /** L4 — reabre (FINALIZADO → RASCUNHO). Desde a ADR-0065 não há conferência a limpar. */
    public reabrirLote = (input: TransicaoInput): Promise<LotePagamento> =>
        this.transicionar(input, {
            de: [LOTE_STATUS.FINALIZADO],
            para: LOTE_STATUS.RASCUNHO,
            acao: 'reabrir',
        });

    /**
     * L5 — cancela o lote local (I1: sempre local). ADR-0077/G3: DEPOIS do commit, o borderô de
     * grupo que esta remessa criou é entregue à limpeza (I21q), que confere ao vivo o lote nativo;
     * falha vira `Alerta` `sispag-bordero-grupo-pendente`, nunca desfaz o cancelamento.
     */
    public cancelarLote = async (input: TransicaoInput): Promise<LotePagamento> => {
        const cancelado = await this.transicionar(input, {
            de: [LOTE_STATUS.RASCUNHO, LOTE_STATUS.FINALIZADO],
            para: LOTE_STATUS.CANCELADO,
            acao: 'cancelar',
        });
        await this.disparoLimpeza.aposCancelarLote({ loteId: input.loteId, ator: input.ator });
        return cancelado;
    };

    // -------------------------------------------------------------- internals

    /**
     * I14k — TED/PIX só com a guarda do favorecido autorizado ligada no tenant e a flag da
     * modalidade ligada (a mesma condição da oferta). Outras formas passam.
     */
    private exigirModalidadeDisponivel = async (
        loteId: string,
        modalidade: Modalidade,
    ): Promise<void> => {
        if (modalidade !== MODALIDADE.TED && modalidade !== MODALIDADE.PIX) return;
        const env = await this.environmentProvider.getEnvironmentVars();
        const flag = modalidade === MODALIDADE.TED ? env.sispagTedEnabled : env.sispagPixEnabled;
        if (env.sispagFavorecidoAutorizadoEnabled === true && flag === true) return;
        throw new PaymentModalityUnavailableError({ loteId, modalidade });
    };

    /**
     * ADR-0076 I20d — a situação de pagamento de cada item, relida como na inclusão (aprovação,
     * pagamento e vencimento AO VIVO no `fin064`; tipo, forma e contexto da carteira gravada).
     * Fail-closed (I19s): título sem resposta do Conexos, fora da carteira ou com fonte de contexto
     * caída também barra. Junta TODOS os itens bloqueados numa recusa só.
     */
    private exigirSituacoesPagaveis = async (lote: LotePagamento): Promise<void> => {
        const { bloqueados, lidos } = await this.lerItensAoVivo(lote.itens);
        const avaliacoes = await this.situacaoPagamento.avaliarVivos(
            lidos.map(({ item, vivo }) => ({
                chave: { filCod: item.filCod, docCod: item.docCod, titCod: item.titCod },
                vivo,
            })),
        );
        lidos.forEach(({ item }, i) => {
            const bloqueio = this.bloqueioDaAvaliacao(avaliacoes[i]);
            if (bloqueio) bloqueados.push({ ...this.identificacao(item), ...bloqueio });
        });
        if (bloqueados.length > 0) {
            throw new BatchHasBlockedItemsError({ loteId: lote.id, itens: bloqueados });
        }
    };

    private identificacao = (
        item: ItemLote,
    ): Pick<ItemBloqueadoNoLote, 'docCod' | 'titCod' | 'credor'> => ({
        docCod: item.docCod,
        titCod: item.titCod,
        ...(item.credor ? { credor: item.credor } : {}),
    });

    /** `fin064` ao vivo, item a item; sem resposta, sumido ou já pago já barra aqui. */
    private lerItensAoVivo = async (
        itens: ItemLote[],
    ): Promise<{
        bloqueados: ItemBloqueadoNoLote[];
        lidos: Array<{ item: ItemLote; vivo: TituloAPagar }>;
    }> => {
        const bloqueados: ItemBloqueadoNoLote[] = [];
        const lidos: Array<{ item: ItemLote; vivo: TituloAPagar }> = [];
        for (const item of itens) {
            const vivo = await this.conexos
                .getTituloAPagar(item.filCod, item.docCod, item.titCod)
                .catch(() => undefined);
            if (vivo === undefined) {
                bloqueados.push({
                    ...this.identificacao(item),
                    rotulo: 'situação não conferida',
                    detalhe: 'o Conexos não respondeu; tente de novo em instantes',
                });
            } else if (vivo === null) {
                bloqueados.push({
                    ...this.identificacao(item),
                    rotulo: 'título não encontrado no Conexos',
                });
            } else if (vivo.pago) {
                bloqueados.push({
                    ...this.identificacao(item),
                    rotulo: 'título já pago no Conexos',
                });
            } else {
                lidos.push({ item, vivo });
            }
        }
        return { bloqueados, lidos };
    };

    /** O que barra numa avaliação (I19s fail-closed); `undefined` = o item pode seguir. */
    private bloqueioDaAvaliacao = (
        a: AvaliacaoInclusao | undefined,
    ): Pick<ItemBloqueadoNoLote, 'rotulo' | 'detalhe' | 'motivo'> | undefined => {
        if (!a || a.resultado !== AVALIACAO_INCLUSAO.AVALIADA) {
            return {
                rotulo: 'situação não conferida',
                ...(a?.resultado === AVALIACAO_INCLUSAO.FORA_DA_CARTEIRA
                    ? { detalhe: 'o título não está na carteira do SISPAG' }
                    : {}),
            };
        }
        const { situacao } = a;
        if (situacao.estado === ESTADO_PAGAMENTO.BLOQUEADO) {
            return {
                rotulo: situacao.rotulo ?? 'bloqueado para pagamento',
                ...(situacao.detalhe ? { detalhe: situacao.detalhe } : {}),
                ...(situacao.principal ? { motivo: situacao.principal } : {}),
            };
        }
        if (a.fontesIndisponiveis.length > 0) {
            return {
                rotulo: 'situação não conferida',
                detalhe: 'uma consulta da situação de pagamento falhou; tente de novo',
            };
        }
        return undefined;
    };

    /**
     * I13f — alerta de duplicidade ABERTA de item que ainda está no lote barra o finalizar, com a
     * lista por item (e a contraparte).
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

    /**
     * Dentro da transação do `incluirGrupo`: confere ADR-0064 por título e tira os títulos de
     * onde estão (avulsos neste lote; outro RASCUNHO só com `mover`). Devolve os lotes de origem.
     */
    private liberarTitulosParaOGrupo = async (
        loteId: string,
        chaves: ChaveTituloGrupo[],
        input: { mover?: boolean; ator: string },
        tx: TransactionClient,
    ): Promise<string[]> => {
        const origens = new Set<string>();
        for (const c of chaves) {
            const comprometido = await this.repo.loteComprometidoComTitulo(c, tx);
            if (comprometido) {
                throw new TitleInCommittedBatchError({
                    docCod: c.docCod,
                    titCod: c.titCod,
                    loteId: comprometido.loteId,
                    status: comprometido.status,
                });
            }
            const onde = await this.repo.loteRascunhoComTitulo(c, tx);
            if (!onde) continue;
            if (onde === loteId) {
                // Avulso neste mesmo lote: vira item do grupo (sai e entra na mesma transação).
                await this.repo.removerItem({ loteId, ...c }, tx);
                await this.alertaRepo.descartarDoItem(loteId, c, input.ator, tx);
                continue;
            }
            if (!input.mover) {
                throw new TituloEmOutroLoteError({
                    docCod: c.docCod,
                    titCod: c.titCod,
                    loteId: onde,
                });
            }
            await this.retirarDaOrigem(onde, c, input.ator, tx);
            origens.add(onde);
        }
        return [...origens];
    };

    /**
     * I21j: título de grupo `CONFIRMADO` não entra avulso (`GroupedBoletoTitleIneligibleError`)
     * nem se move sozinho (`GroupedBoletoIndivisibleError`).
     */
    private exigirForaDeGrupo = async (input: IncluirTituloInput): Promise<void> => {
        const chave = { filCod: input.filCod, docCod: input.docCod, titCod: input.titCod };
        const grupo = await this.grupoRepo.buscarConfirmadoPorTitulo(chave);
        if (!grupo) return;
        if (input.mover) throw this.erroIndivisivel(grupo);
        throw new GroupedBoletoTitleIneligibleError({
            grupoId: grupo.id,
            titulos: [{ ...chave, motivo: MOTIVO_GRUPO_INELEGIVEL.EM_OUTRO_GRUPO }],
        });
    };

    /** I21c/I21u locais: nenhum título retido e o grupo não é órfão. */
    private exigirGrupoLivre = async (grupo: GrupoBoleto): Promise<void> => {
        const retidos = await this.leituraGrupo.titulosRetidos(grupo);
        if (retidos.length > 0) {
            throw new GroupedBoletoTitleIneligibleError({
                grupoId: grupo.id,
                titulos: retidos.map((c) => ({
                    ...c,
                    motivo: MOTIVO_GRUPO_INELEGIVEL.MARCA_RETENCAO_ATIVA,
                })),
            });
        }
        const orfao = await this.leituraGrupo.orfao(grupo);
        if (orfao.orfao) {
            const motivo = MOTIVO_DO_ORFAO[orfao.motivo ?? MOTIVO_GRUPO_ORFAO.BOLETO_FORA_DO_POOL];
            const titulos = orfao.titulo ? [orfao.titulo] : grupo.titulos.map(chaveDoTitulo);
            throw new GroupedBoletoTitleIneligibleError({
                grupoId: grupo.id,
                titulos: titulos.map((c) => ({ ...chaveDoTitulo(c), motivo })),
            });
        }
    };

    /** I2 por título, na re-leitura Conexos (fora de lock/transação). */
    private lerTitulosDoGrupo = async (grupo: GrupoBoleto) => {
        const lidos = await Promise.all(
            grupo.titulos.map((t) => this.conexos.getTituloAPagar(t.filCod, t.docCod, t.titCod)),
        );
        const inelegiveis = this.inelegiveisI2(grupo.titulos.map(chaveDoTitulo), lidos);
        if (inelegiveis.length > 0) {
            throw new GroupedBoletoTitleIneligibleError({
                grupoId: grupo.id,
                titulos: inelegiveis,
            });
        }
        return lidos;
    };

    /** I2 de cada título relido: ausente ⇒ saiu da carteira; pago; não liberado (alçada). */
    private inelegiveisI2 = (
        chaves: ChaveTituloGrupo[],
        lidos: ReadonlyArray<{ pago: boolean; liberado: boolean } | null | undefined>,
    ): TituloInelegivelGrupo[] =>
        chaves.flatMap((c, k): TituloInelegivelGrupo[] => {
            const lido = lidos[k];
            let motivo: MotivoGrupoInelegivel | undefined;
            if (!lido) motivo = MOTIVO_GRUPO_INELEGIVEL.INATIVO;
            else if (lido.pago) motivo = MOTIVO_GRUPO_INELEGIVEL.PAGO;
            else if (!lido.liberado) motivo = MOTIVO_GRUPO_INELEGIVEL.NAO_LIBERADO;
            return motivo ? [{ ...c, motivo }] : [];
        });

    /** L3: os títulos de cada grupo do lote relidos no Conexos (I2); inelegível barra o lote. */
    private exigirGruposElegiveis = async (lote: LotePagamento): Promise<void> => {
        const porGrupo = new Map<string, ChaveTituloGrupo[]>();
        for (const i of lote.itens) {
            if (!i.grupoBoletoId) continue;
            porGrupo.set(i.grupoBoletoId, [
                ...(porGrupo.get(i.grupoBoletoId) ?? []),
                chaveDoTitulo(i),
            ]);
        }
        for (const [grupoId, chaves] of porGrupo) {
            const lidos = await Promise.all(
                chaves.map((c) => this.conexos.getTituloAPagar(c.filCod, c.docCod, c.titCod)),
            );
            const titulos = this.inelegiveisI2(chaves, lidos);
            if (titulos.length > 0)
                throw new GroupedBoletoTitleIneligibleError({ grupoId, titulos });
        }
    };

    private exigirGrupoConfirmado = async (grupoId: string): Promise<GrupoBoleto> => {
        const grupo = await this.grupoRepo.buscarPorId(grupoId);
        if (!grupo) throw new GroupedBoletoNotFoundError({ grupoId });
        if (grupo.estado !== GRUPO_BOLETO_ESTADO.CONFIRMADO) {
            throw this.erroGrupoNaoConfirmado(grupo);
        }
        return grupo;
    };

    private erroGrupoNaoConfirmado = (grupo: GrupoBoleto): GroupedBoletoStateConflictError =>
        new GroupedBoletoStateConflictError({
            grupoId: grupo.id,
            estado: grupo.estado,
            acao: 'entrar em lote',
        });

    private erroIndivisivel = (grupo: GrupoBoleto): GroupedBoletoIndivisibleError =>
        new GroupedBoletoIndivisibleError({
            grupoId: grupo.id,
            codigoMascarado: grupo.codbarMascarado,
            titulos: grupo.titulos.map(chaveDoTitulo),
        });

    private erroIndivisivelPorId = async (
        grupoId: string,
    ): Promise<GroupedBoletoIndivisibleError> => {
        const grupo = await this.grupoRepo.buscarPorId(grupoId);
        return grupo
            ? this.erroIndivisivel(grupo)
            : new GroupedBoletoIndivisibleError({ grupoId, titulos: [] });
    };

    /** I21r/PI-9: grupo com J rejeitado volta à mão, com o aviso do borderô antigo. */
    private avisos = async (grupo: GrupoBoleto): Promise<AvisoInclusaoGrupo[]> =>
        (await this.leituraGrupo.rejeicaoNaoResolvida(grupo.id))
            ? [AVISO_INCLUSAO_GRUPO.BORDERO_ANTERIOR_A_RESOLVER]
            : [];

    /**
     * Anexa a cada lote os grupos de boleto dele, um bloco por grupo (I21j), com a situação
     * derivada no contexto do lote. Lote sem item de grupo passa sem nenhuma leitura.
     */
    private comGrupos = async (lotes: LotePagamento[]): Promise<LotePagamento[]> => {
        const ids = [
            ...new Set(lotes.flatMap((l) => l.itens.flatMap((i) => i.grupoBoletoId ?? []))),
        ];
        if (ids.length === 0) return lotes;
        const grupos = new Map<string, GrupoBoleto>();
        for (const g of await Promise.all(ids.map((id) => this.grupoRepo.buscarPorId(id)))) {
            if (g) grupos.set(g.id, g);
        }
        return Promise.all(
            lotes.map(async (lote) => {
                const doLote = [...new Set(lote.itens.flatMap((i) => i.grupoBoletoId ?? []))];
                if (doLote.length === 0) return lote;
                const blocos = await Promise.all(
                    doLote.flatMap((id) => {
                        const g = grupos.get(id);
                        return g ? [this.blocoDoGrupo(lote, g)] : [];
                    }),
                );
                return { ...lote, grupos: blocos };
            }),
        );
    };

    private blocoDoGrupo = async (
        lote: LotePagamento,
        grupo: GrupoBoleto,
    ): Promise<GrupoNoLote> => {
        const itens = lote.itens.filter((i) => i.grupoBoletoId === grupo.id);
        const situacao = await this.leituraGrupo.situacao(grupo, {
            loteStatus: lote.status,
            divergente: itens.some((i) => i.divergencia === true),
        });
        return {
            grupoId: grupo.id,
            codbarMascarado: grupo.codbarMascarado,
            valorBoleto: grupo.valorBoletoCentavos / 100,
            vencimentoBoleto: grupo.vencimentoBoleto,
            ...(grupo.credor !== undefined ? { credor: grupo.credor } : {}),
            situacao,
            titulos: itens.map(chaveDoTitulo),
        };
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
        const [completo] = await this.comGrupos(await this.comAlertas([await this.exigirLote(id)]));
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
