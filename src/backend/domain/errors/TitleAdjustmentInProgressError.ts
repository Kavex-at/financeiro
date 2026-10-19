import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O lote tem título com ajuste de centavos em curso (I18k/M5): finalizar agora fixaria o título
 * antigo no lote nativo. HTTP 409 — espere o ajuste terminar e finalize de novo.
 */
export default class TitleAdjustmentInProgressError extends Error implements HandlerError {
    public readonly code = 'AJUSTE_CENTAVOS_EM_CURSO';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details: {
        loteId: string;
        titulos: Array<{ docCod: string; titCod: string }>;
    };

    public constructor(params: {
        loteId: string;
        titulos: Array<{ docCod: string; titCod: string }>;
    }) {
        const lista = params.titulos.map((t) => `${t.docCod}/${t.titCod}`).join(', ');
        super(`Lote ${params.loteId} has titles with a cents adjustment in progress: ${lista}`);
        this.name = 'TitleAdjustmentInProgressError';
        this.userMessage =
            `O lote tem título com ajuste de centavos em andamento no Conexos (${lista}). ` +
            'Aguarde o ajuste terminar e finalize o lote de novo.';
        this.details = { loteId: params.loteId, titulos: params.titulos };
    }
}
