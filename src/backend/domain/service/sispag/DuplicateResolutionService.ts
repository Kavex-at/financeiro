import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import DuplicateResolutionError, {
    DUPLICATE_RESOLUTION_FAILURE,
} from '../../errors/DuplicateResolutionError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    type BloqueioDuplicidade,
    type ChaveTitulo,
    DUPLICATE_ACTION,
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
