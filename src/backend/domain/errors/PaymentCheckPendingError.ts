import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Item TED/PIX com verificação PENDENTE no `finalizarLote` (ADR-0063, I13b): a leitura do Conexos
 * (fin064/cmn025) falhou e a re-verificação também não conseguiu decidir. Falha fechada — o lote não
 * finaliza sem a verificação. Nomeia os títulos, nunca conta/chave (I10h). HTTP 409, retryable.
 */
export default class PaymentCheckPendingError extends Error implements HandlerError {
    public readonly code = 'VERIFICACAO_PAGAMENTO_PENDENTE';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        loteId: string;
        itens: Array<{ docCod: string; titCod: string; credor?: string }>;
    }) {
        super(
            `TED/PIX check pending for lot ${params.loteId}: ${params.itens.map((i) => `${i.docCod}/${i.titCod}`).join(', ')}`,
        );
        this.name = 'PaymentCheckPendingError';
        const nomes = params.itens.map(
            (i) => `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}`,
        );
        this.userMessage =
            `Não foi possível verificar no Conexos os itens TED/PIX: ${nomes.join('; ')}. ` +
            'Sem a verificação de duplicidade e de dados de pagamento o lote não é finalizado. ' +
            'Tente finalizar de novo em instantes.';
        this.details = {
            loteId: params.loteId,
            itens: params.itens.map((i) => `${i.docCod}/${i.titCod}`),
        };
    }
}
