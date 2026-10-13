import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Thrown by `TimeoutExecutor` when the wrapped work does not finish within its deadline. The work
 * was asked to stop (its `AbortSignal` is aborted), but a call already in flight may still settle
 * later: only use it around work that is safe to abandon (read-only, or guarded by optimistic lock).
 */
export default class DeadlineExceededError extends Error implements HandlerError {
    public readonly code = 'DEADLINE_EXCEEDED';
    public readonly userMessage = 'A operação passou do prazo e foi interrompida. Tente de novo.';
    public readonly retryable = true;
    public readonly statusCode = 504;
    public readonly details?: unknown;

    constructor(public readonly deadlineMs: number) {
        super(`deadline of ${deadlineMs} ms exceeded`);
        this.name = 'DeadlineExceededError';
    }
}
