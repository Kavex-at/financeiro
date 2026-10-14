import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import DuplicateResolutionError, {
    DUPLICATE_RESOLUTION_FAILURE,
} from '../../errors/DuplicateResolutionError.js';
import { MOTIVO_LEDGER_LIMPEZA_INCOMPLETA } from '../../errors/BoletoCodigoBarrasRetiradaIncompletaError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type {
    RetiradaDoLoteNaTrilha,
    TituloRetidoPorCodigoBarras,
} from '../../interface/sispag/RetiradaCodigoBarras.js';
import {
    type BloqueioDuplicidade,
    type ChaveTitulo,
    DUPLICATE_ACTION,
    DUPLICATE_HOLD_ORIGIN,
    ORIGENS_RETENCAO_CODIGO_BARRAS,
    DUPLICATE_ALERT_TYPES,
    type DuplicateAction,
    ITEM_ALERT_RESOLUTION,
    ITEM_ALERT_STATE,
    LOTE_STATUS,
    type LotePagamento,
} from '../../interface/sispag/SispagInterface.js';
import AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import RemessaExecucaoRepository from '../../repository/sispag/RemessaExecucaoRepository.js';
import VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import LogService from '../LogService.js';
import LotePagamentoService from './LotePagamentoService.js';

export interface ResolverAlertaInput {
    loteId: string;
    chave: ChaveTitulo;
    alertaId: string;
    acao: DuplicateAction;
    /** JUSTIFICAR: obrigatória. RETIRAR: opcional (vira o motivo do bloqueio). */
    justificativa?: string;
    /** Username canônico AUTENTICADO — nunca do body. */
    ator: string;
}

/**
 * DuplicateResolutionService — `resolverAlertaDuplicidade` (ADR-0063, I13f/I13g). Decisão da
 * analista, item a item e alerta a alerta, só em RASCUNHO:
 *   - JUSTIFICAR: texto livre obrigatório; o item fica; a alerta vira RESOLVIDA/JUSTIFICADA.
 *   - RETIRAR: o item sai do lote e o título ganha um `BloqueioDuplicidade` ATIVO ("cancelamento
 *     pendente no Conexos"); as outras alertas do item são DESCARTADAS. Tudo numa transação.
 * E o desfazer do bloqueio, com motivo, auditado. NADA é escrito no Conexos: o cancelamento do
 * documento duplicado é ato humano no ERP.
 */
@injectable()
export default class DuplicateResolutionService {
    public constructor(
        @inject(LotePagamentoRepository) private readonly loteRepo: LotePagamentoRepository,
        @inject(AlertaItemLoteRepository) private readonly alertaRepo: AlertaItemLoteRepository,
        @inject(BloqueioDuplicidadeRepository)
        private readonly bloqueioRepo: BloqueioDuplicidadeRepository,
        @inject(LotePagamentoService) private readonly lotes: LotePagamentoService,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(LogService) private readonly logService: LogService,
        @inject(VerificacaoEventoRepository)
        private readonly eventos: VerificacaoEventoRepository,
        @inject(RemessaExecucaoRepository) private readonly ledger: RemessaExecucaoRepository,
    ) {}

    public resolverAlertaDuplicidade = async (
        input: ResolverAlertaInput,
    ): Promise<LotePagamento> => {
        const justificativa = input.justificativa?.trim() ?? '';
        if (input.acao === DUPLICATE_ACTION.JUSTIFICAR && justificativa === '') {
            throw new DuplicateResolutionError({
                motivo: DUPLICATE_RESOLUTION_FAILURE.TEXTO_OBRIGATORIO,
                alertaId: input.alertaId,
            });
        }
        const lote = await this.loteRepo.getLoteComItens(input.loteId);
        if (!lote || lote.status !== LOTE_STATUS.RASCUNHO) {
            throw new LoteEstadoInvalidoError({
                loteId: input.loteId,
                statusAtual: lote?.status ?? 'inexistente',
                acao: 'tratar alerta de duplicidade',
                motivo: 'A alerta de duplicidade só é tratada com o lote em RASCUNHO.',
            });
        }
        const alerta = await this.alertaRepo.getById(input.alertaId);
        const doItem =
            alerta !== null &&
            alerta.loteId === input.loteId &&
            alerta.filCod === input.chave.filCod &&
            alerta.docCod === input.chave.docCod &&
            alerta.titCod === input.chave.titCod &&
            DUPLICATE_ALERT_TYPES.includes(alerta.tipo);
        if (!alerta || !doItem) {
            throw new DuplicateResolutionError({
                motivo: DUPLICATE_RESOLUTION_FAILURE.ALERTA_NAO_ENCONTRADA,
                alertaId: input.alertaId,
            });
        }
        if (alerta.estado !== ITEM_ALERT_STATE.ABERTA) {
            throw new DuplicateResolutionError({
                motivo: DUPLICATE_RESOLUTION_FAILURE.ALERTA_NAO_ABERTA,
                alertaId: input.alertaId,
            });
        }

        const retirar = input.acao === DUPLICATE_ACTION.RETIRAR;
        await this.db.withTransaction(async (tx) => {
            const ok = await this.alertaRepo.resolver(
                {
                    alerta,
                    resolucao: retirar
                        ? ITEM_ALERT_RESOLUTION.RETIRADA
                        : ITEM_ALERT_RESOLUTION.JUSTIFICADA,
                    ...(justificativa ? { justificativa } : {}),
                    ator: input.ator,
                },
                tx,
            );
            if (!ok) {
                throw new DuplicateResolutionError({
                    motivo: DUPLICATE_RESOLUTION_FAILURE.ALERTA_NAO_ABERTA,
                    alertaId: input.alertaId,
                });
            }
            if (!retirar) return;
            await this.alertaRepo.descartarDoItem(input.loteId, input.chave, input.ator, tx);
            await this.loteRepo.removerItem({ loteId: input.loteId, ...input.chave }, tx);
            // A analista mexeu num lote automático → vira manual (mesma regra da lixeira).
            if (lote.automatico) await this.loteRepo.marcarManual(input.loteId, tx);
            await this.loteRepo.tocarLote(input.loteId, tx);
            await this.bloqueioRepo.criar(
                {
                    chave: input.chave,
                    alertaId: alerta.id,
                    loteIdOrigem: input.loteId,
                    motivo:
                        justificativa ||
                        `retirado por duplicidade com o documento ${alerta.contraparteDocCod ?? '?'} — cancelamento pendente no Conexos`,
                    ator: input.ator,
                },
                tx,
            );
        });
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: retirar
                ? 'duplicidade: item retirado do lote e título bloqueado'
                : 'duplicidade: alerta justificada',
            data: {
                loteId: input.loteId,
                ...input.chave,
                alertaId: alerta.id,
                tipo: alerta.tipo,
                ator: input.ator,
            },
        });
        const atualizado = await this.lotes.getLote(input.loteId);
        if (!atualizado) {
            throw new LoteEstadoInvalidoError({
                loteId: input.loteId,
                statusAtual: 'inexistente',
                acao: 'tratar alerta de duplicidade',
            });
        }
        return atualizado;
    };

    /**
     * `true` quando a ÚLTIMA execução real de remessa do lote terminou em `error` por limpeza de
     * código de barras incompleta, ou ainda está `reconciling` (em voo/órfã): o rascunho nativo
     * pode ter resíduo (I16d.6, Q10).
     */
    private limpezaPendente = async (loteId: string): Promise<boolean> => {
        const execucoes = await this.ledger.listByLote(loteId);
        const ultima = execucoes.find((e) => !e.dryRun);
        if (ultima === undefined) return false;
        // `reconciling` = limpeza em voo (janela entre a transação local e o DELETE nativo, ou
        // crash nela): desfazer agora quebraria o par marca + evento que reconhece o resíduo.
        if (ultima.status === 'reconciling') return true;
        return (
            ultima.status === 'error' &&
            (ultima.erroMensagem ?? '').includes(MOTIVO_LEDGER_LIMPEZA_INCOMPLETA)
        );
    };

    /** I16g — títulos retidos por código de barras (aba de títulos): só campos mascarados. */
    public listarRetidosPorCodigoDeBarras = async (): Promise<TituloRetidoPorCodigoBarras[]> =>
        this.bloqueioRepo.listAtivosPorOrigemComTitulo([...ORIGENS_RETENCAO_CODIGO_BARRAS]);

    /** I16f(3) — o que o sistema retirou deste lote por código de barras, lido da trilha. */
    public listarRetiradasDoLote = async (loteId: string): Promise<RetiradaDoLoteNaTrilha[]> =>
        this.eventos.listarRetiradasPorCodigoBarras(loteId);

    /** I13g — a analista desfaz o bloqueio ATIVO do título, com motivo obrigatório, auditado. */
    public desfazerBloqueio = async (input: {
        chave: ChaveTitulo;
        motivo: string;
        ator: string;
    }): Promise<BloqueioDuplicidade> => {
        const motivo = input.motivo.trim();
        if (motivo === '') {
            throw new DuplicateResolutionError({
                motivo: DUPLICATE_RESOLUTION_FAILURE.TEXTO_OBRIGATORIO,
            });
        }
        // Q10 — marca por código de barras: não desfaz enquanto o resíduo no rascunho nativo do
        // lote de origem não foi limpo (o par marca + evento que o reconhece quebraria).
        const ativo = await this.bloqueioRepo.findAtivo(input.chave);
        if (
            ativo?.origem !== undefined &&
            ativo.origem !== DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO &&
            ativo.loteIdOrigem !== undefined &&
            (await this.limpezaPendente(ativo.loteIdOrigem))
        ) {
            throw new DuplicateResolutionError({
                motivo: DUPLICATE_RESOLUTION_FAILURE.LIMPEZA_PENDENTE,
            });
        }
        const desfeito = await this.bloqueioRepo.desfazer({
            chave: input.chave,
            motivo,
            ator: input.ator,
        });
        if (!desfeito) {
            throw new DuplicateResolutionError({
                motivo: DUPLICATE_RESOLUTION_FAILURE.SEM_BLOQUEIO_ATIVO,
            });
        }
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'duplicidade: bloqueio do título desfeito',
            data: { ...input.chave, bloqueioId: desfeito.id, ator: input.ator },
        });
        return desfeito;
    };
}
