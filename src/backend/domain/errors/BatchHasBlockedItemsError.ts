import type { HandlerError } from '../libs/handler/HandlerError.js';
import type { MotivoPagamento } from '../interface/sispag/SituacaoPagamento.js';

export interface ItemBloqueadoNoLote {
    docCod: string;
    titCod: string;
    credor?: string;
    /** Texto curto pronto para a tela ("Aguardando aprovação", "Situação não conferida"). */
    rotulo: string;
    detalhe?: string;
    /** Motivo principal da situação de pagamento, quando o bloqueio veio dela. */
    motivo?: MotivoPagamento;
}

/**
 * Finalização recusada porque algum item do lote não pode ser pago agora (ADR-0076, I20d): a
 * situação de pagamento do título está BLOQUEADA, ou não pôde ser conferida (fora da carteira,
 * Conexos sem resposta, fonte de contexto caída). Roda ANTES da verificação TED/PIX, então nenhum
 * item foi retirado. HTTP 422.
 */
export default class BatchHasBlockedItemsError extends Error implements HandlerError {
    public readonly code = 'LOTE_COM_ITENS_BLOQUEADOS';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { loteId: string; itens: ItemBloqueadoNoLote[] }) {
        super(
            `lot ${params.loteId} has blocked items: ${params.itens.map((i) => `${i.docCod}/${i.titCod}`).join(', ')}`,
        );
        this.name = 'BatchHasBlockedItemsError';
        const linhas = params.itens.map(
            (i) =>
                `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}: ${i.rotulo}${i.detalhe ? `, ${i.detalhe}` : ''}`,
        );
        this.userMessage =
            `O lote não foi finalizado: ${linhas.join('; ')}. ` +
            'Resolva ou retire esses itens e finalize de novo.';
        this.details = { loteId: params.loteId, itens: params.itens };
    }
}
