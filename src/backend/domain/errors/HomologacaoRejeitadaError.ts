import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Por que a homologação não confirmou como emitida. */
export type HomologacaoRejeitadaMotivo = 'validacao' | 'upstream' | 'nao-homologado';

/**
 * Thrown by `ConexosNdeClient.homologar` when a com297 homologation did NOT cleanly succeed. Two
 * flavours, both **non-retryable** (fail-closed for an irreversible fiscal write — a pipeline retry
 * must never re-POST a homologation):
 *   - `validacao` — HTTP 200 but `docVldComvalidacoes` fell to the `default` branch (com194 + error
 *     toast in the UI). Treating a 200 as done would silently mark a failed homologation as emitida.
 *   - `upstream`  — the POST itself failed (5xx/timeout/network). Ambiguous outcome: the request may
 *     have landed, so we do NOT auto-retry; the execution is marked error and reconciled via the
 *     write-ahead ledger (which refuses to re-emit an already-`emitida` NDe).
 *   - `nao-homologado` — HTTP 200, `docVldComvalidacoes` in the accepted set, but the document did NOT
 *     move: `docVldNfehom` stayed `0`. Raised by the SERVICE from the read-back, not by the client —
 *     the response cannot be trusted to report this (prod 2026-08-11, doc 18771). Ver ADR-0036.
 *
 * See `integrations/conexos-com297-homologacao.md` and `business-rules/homologacao-nde-com297.md`.
 */
export default class HomologacaoRejeitadaError extends Error implements HandlerError {
    public readonly code = 'NDE_HOMOLOGACAO_REJEITADA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details: {
        docCod: string;
        motivo: HomologacaoRejeitadaMotivo;
        docVldComvalidacoes?: number;
        docVldNfehom?: number;
        validacoes?: unknown;
    };

    constructor(params: {
        docCod: string;
        motivo: HomologacaoRejeitadaMotivo;
        docVldComvalidacoes?: number;
        docVldNfehom?: number;
        validacoes?: unknown;
        userMessage?: string;
        cause?: unknown;
        message?: string;
    }) {
        super(
            params.message ??
                `homologação com297 do documento ${params.docCod} rejeitada (${params.motivo}` +
                    (params.docVldComvalidacoes !== undefined
                        ? `, docVldComvalidacoes=${params.docVldComvalidacoes}`
                        : '') +
                    ')',
            params.cause !== undefined ? { cause: params.cause } : undefined,
        );
        this.name = 'HomologacaoRejeitadaError';
        this.userMessage =
            params.userMessage ??
            'A homologação da Nota de Débito Eletrônica não foi confirmada pelo ERP. Verifique as validações e tente novamente.';
        this.details = {
            docCod: params.docCod,
            motivo: params.motivo,
            ...(params.docVldComvalidacoes !== undefined
                ? { docVldComvalidacoes: params.docVldComvalidacoes }
                : {}),
            ...(params.docVldNfehom !== undefined ? { docVldNfehom: params.docVldNfehom } : {}),
            ...(params.validacoes !== undefined ? { validacoes: params.validacoes } : {}),
        };
    }
}
