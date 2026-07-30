import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Thrown when a com297 NDe document carries a `vldTpNf` that is neither a known contingency code
 * (`11`/`12`) nor in the explicit known-normal allowlist (`NDE_NORMAL_TP_NF_CONHECIDOS`).
 *
 * The UI's whitelist predicate routes EVERY unknown value down `homologaNfe` (fail-open). We invert
 * it: an unrecognised code (e.g. a future SVC variant) is REFUSED and surfaced, not silently
 * homologated as normal — the one case that would actually hurt. `retryable: false`. Seed the
 * allowlist from the real `vldTpNf` distribution before go-live. See
 * `business-rules/homologacao-nde-com297.md`.
 */
export default class VldTpNfDesconhecidoError extends Error implements HandlerError {
    public readonly code = 'NDE_VLD_TP_NF_DESCONHECIDO';
    public readonly userMessage =
        'Tipo de nota (vldTpNf) não reconhecido para homologação — revise antes de emitir a NDe.';
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details: { vldTpNf: string };

    constructor(vldTpNf: string, message?: string) {
        super(
            message ??
                `vldTpNf desconhecido '${vldTpNf}' — homologação recusada (não está em contingência nem na allowlist normal)`,
        );
        this.name = 'VldTpNfDesconhecidoError';
        this.details = { vldTpNf };
    }
}
