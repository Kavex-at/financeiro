import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * A trilha da cópia da linha digitável não pôde ser gravada: a linha NÃO é devolvida (fail-closed,
 * ADR-0068, I15k). HTTP 503.
 */
export default class LineCopyAuditFailedError extends Error implements HandlerError {
    public readonly code = 'COPIA_LINHA_SEM_TRILHA';
    public readonly userMessage =
        'Não foi possível registrar a cópia da linha digitável; por segurança ela não foi exibida. Tente novamente.';
    public readonly retryable = true;
    public readonly statusCode = 503;
    public readonly details?: unknown;

    public constructor(params: { filCod: number; docCod: string; titCod: string }) {
        super(
            `Digitable line copy refused: audit trail unavailable for ${params.filCod}/${params.docCod}/${params.titCod}`,
        );
        this.name = 'LineCopyAuditFailedError';
        this.details = { filCod: params.filCod, docCod: params.docCod, titCod: params.titCod };
    }
}
