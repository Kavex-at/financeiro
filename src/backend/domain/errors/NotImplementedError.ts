import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Thrown by a deliberately-unwired seam that must NEVER execute yet.
 *
 * Frente IV — Solicitação de Numerário: the live com299 `gerDocProcesso` POST is DRY-RUN-ONLY until
 * HML creds + HAR confirm the exact `gcdCod`/payload. The `enviarAoErp` seam exists only so the code
 * shape is ready, but any actual invocation throws this — there is genuinely NO reachable ERP write
 * path. `retryable: false` (a retry cannot make an unimplemented path succeed).
 */
export default class NotImplementedError extends Error implements HandlerError {
    public readonly code = 'NOT_IMPLEMENTED';
    public readonly userMessage =
        'Esta operação ainda não está implementada (envio ao ERP indisponível — apenas simulação).';
    public readonly retryable = false;
    public readonly statusCode = 501;
    public readonly details?: unknown;

    constructor(message?: string) {
        super(
            message ??
                'not implemented — live ERP write path is intentionally disabled (dry-run only)',
        );
        this.name = 'NotImplementedError';
    }
}
