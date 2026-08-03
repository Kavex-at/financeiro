import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Thrown (fail-closed) when a step of the 3-screen numerário flow ("telas Conexos" guide) hits an
 * endpoint that has NOT been confirmed yet (no HAR / no bundle) — Tela 2 (fin014 recebimento) and
 * the Tela 3 (com297) fiscal/observações/homologar sub-steps. We NEVER guess an irreversible write:
 * in a real (non-dry-run) run the flow aborts here with a clear message so the operator finishes the
 * step manually and we capture the HAR before wiring it. Dry-run still previews the intended payload.
 */
export default class NumerarioGapError extends Error implements HandlerError {
    public readonly etapa: string;
    public readonly code = 'NUMERARIO_ETAPA_GAP';
    public readonly retryable = false;
    public readonly statusCode = 501;
    public readonly userMessage: string;
    public readonly details?: unknown;

    constructor(params: { etapa: string; message?: string; details?: unknown }) {
        super(params.message ?? `numerário step "${params.etapa}" not implemented (endpoint GAP)`);
        this.name = 'NumerarioGapError';
        this.etapa = params.etapa;
        this.userMessage =
            `Etapa "${params.etapa}" ainda não automatizada (endpoint não confirmado) — ` +
            `conclua manualmente no Conexos e capture o HAR para habilitar.`;
        this.details = params.details;
    }
}
