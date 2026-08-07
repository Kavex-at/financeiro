import type { NextFunction, Request, Response } from 'express';
import { isHandlerError } from '../domain/libs/handler/HandlerError.js';

/**
 * Central Express error-handling middleware. Logs the full error detail
 * server-side (including any Conexos response status/body) and returns a
 * generic, non-leaking payload to the client.
 *
 * Arch-review cards security-3 (F-security-5: HTTP 500 leaked `err.message`
 * and the raw Conexos response body) and fault-tolerance-3
 * (F-fault-tolerance-3: unhandled async errors must reach a central handler).
 *
 * ── Exceção CURADA ao genérico (ADR-0032, 2026-08-06) ──
 * Um erro que implementa `HandlerError` já carrega um `userMessage` escrito para
 * ser lido — o contrato o define como "human, pt-BR, curated. Safe to render in a
 * banner", e `details` como whitelisted, sem PII nem segredo. Esses respondem com o
 * próprio `statusCode` e `userMessage`. Tudo que NÃO é typed segue genérico em 500:
 * a regra do F-security-5 continua valendo para `err.message` cru e para o corpo do
 * ERP, que nunca cruzam. O que mudou é que existe um canal declarado para o que a
 * aplicação escolheu dizer — antes, uma recusa de permissão do ERP (que já vem com
 * a instrução de como resolver) chegava ao analista como "Internal server error".
 */
export const errorMiddleware = (
    err: unknown,
    req: Request,
    res: Response,
    _next: NextFunction,
): void => {
    const error = err as { message?: string; response?: { status?: number; data?: unknown } };
    const conexosStatus = error?.response?.status;
    const conexosBody = error?.response?.data;

    console.error(
        `[error] ${req.method} ${req.originalUrl} →`,
        error?.message ?? String(err),
        conexosStatus ? `(Conexos HTTP ${conexosStatus})` : '',
    );
    if (conexosBody !== undefined) {
        console.error('[error] Conexos body:', JSON.stringify(conexosBody));
    }

    if (res.headersSent) {
        return;
    }

    if (isHandlerError(err)) {
        res.status(err.statusCode).json({
            error: err.code,
            message: err.userMessage,
            retryable: err.retryable,
            ...(err.details !== undefined ? { details: err.details } : {}),
        });
        return;
    }

    res.status(500).json({ error: 'Internal server error' });
};
