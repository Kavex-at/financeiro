import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Thrown when a com297 NDe document reaches homologation with an absent `vldTpNf`.
 *
 * The client-side predicate `finDocIsContingenciaHomologacao` fails OPEN (no `finDoc` → `undefined` →
 * falsy → silently homologates as normal). We deliberately do NOT carry that over: an absent/not-yet-
 * loaded document must fail LOUD instead of silently picking the normal route. `retryable: false` — a
 * retry won't materialise the missing field. See `business-rules/homologacao-nde-com297.md`.
 */
export default class VldTpNfAusenteError extends Error implements HandlerError {
    public readonly code = 'NDE_VLD_TP_NF_AUSENTE';
    public readonly userMessage =
        'Não foi possível decidir a rota de homologação: o tipo da nota (vldTpNf) está ausente no documento.';
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    constructor(message?: string) {
        super(
            message ?? 'vldTpNf ausente — homologação recusada (fail-loud; o UI falharia aberto)',
        );
        this.name = 'VldTpNfAusenteError';
    }
}
