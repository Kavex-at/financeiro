import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Lançado ao liberar a retenção de um título que não tem retenção ativa (já foi liberada, ou o
 * título foi incluído num lote à mão, que a encerra — ADR-0050 D4). Rota → HTTP 404.
 */
export default class RetencaoInexistenteError extends Error implements HandlerError {
    public readonly code = 'RETENCAO_INEXISTENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 404;
    public readonly details?: unknown;

    public constructor(params: { filCod: number; docCod: string; titCod: string }) {
        super(`titulo ${params.filCod}:${params.docCod}/${params.titCod} has no active retention`);
        this.name = 'RetencaoInexistenteError';
        this.userMessage =
            'Este título não está retido da formação automática. Atualize a tela e confira.';
        this.details = { filCod: params.filCod, docCod: params.docCod, titCod: params.titCod };
    }
}
