import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Título com `BloqueioDuplicidade` ATIVO (ADR-0063, I13g): foi retirado de um lote por duplicidade
 * e aguarda o cancelamento de um dos documentos no Conexos. Não entra em lote até o título sumir do
 * fin064 ou a analista desfazer o bloqueio (com motivo). HTTP 409.
 */
export default class DuplicateHoldError extends Error implements HandlerError {
    public readonly code = 'TITULO_BLOQUEADO_DUPLICIDADE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        filCod: number;
        docCod: string;
        titCod: string;
        motivo?: string;
        marcadoPor?: string;
    }) {
        super(`title ${params.filCod}/${params.docCod}/${params.titCod} is held as a duplicate`);
        this.name = 'DuplicateHoldError';
        this.userMessage =
            `O título ${params.docCod}/${params.titCod} foi retirado por duplicidade` +
            `${params.marcadoPor ? ` por ${params.marcadoPor}` : ''} e aguarda o cancelamento no ` +
            'Conexos. Ele não entra em lote enquanto o bloqueio estiver ativo; se a duplicidade não ' +
            'se confirmou, desfaça o bloqueio informando o motivo.';
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            ...(params.motivo ? { motivo: params.motivo } : {}),
        };
    }
}
