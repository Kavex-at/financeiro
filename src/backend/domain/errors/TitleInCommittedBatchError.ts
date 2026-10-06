import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Título que já está num lote COMPROMETIDO — `FINALIZADO` ou `REMESSA_GERADA` (ADR-0064, extensão
 * de I3 a lotes vivos). Não entra em outro lote nem é movido: o pagamento dele já está a caminho
 * do banco. Para mexer, reabra o lote finalizado; com remessa gerada não há como. HTTP 409.
 */
export default class TitleInCommittedBatchError extends Error implements HandlerError {
    public readonly code = 'TITULO_EM_LOTE_COMPROMETIDO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { docCod: string; titCod: string; loteId: string; status: string }) {
        super(
            `title ${params.docCod}/${params.titCod} is in committed batch ${params.loteId} (${params.status})`,
        );
        this.name = 'TitleInCommittedBatchError';
        this.userMessage =
            params.status === 'FINALIZADO'
                ? `O título ${params.docCod}/${params.titCod} está num lote finalizado. Reabra aquele lote para retirá-lo antes de usá-lo em outro.`
                : `O título ${params.docCod}/${params.titCod} está num lote com remessa gerada e não pode entrar em outro lote.`;
        this.details = { ...params };
    }
}
