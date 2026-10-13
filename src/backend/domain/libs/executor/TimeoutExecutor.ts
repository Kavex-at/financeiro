import DeadlineExceededError from '../../errors/DeadlineExceededError.js';
import type IExecutor from './domain/IExecutor.js';

/**
 * Runs `fn` against a deadline. Past `deadlineMs` it aborts the signal handed to `fn` and rejects
 * with `DeadlineExceededError` — the caller gets control back even if `fn` is stuck on a call that
 * never answers (a hung Conexos read holding an advisory lock, ADR-0066).
 *
 * Aborting is cooperative: `fn` must check the signal to stop; a call already in flight is
 * abandoned, not cancelled. Only wrap work that is safe to abandon.
 */
export default class TimeoutExecutor implements IExecutor {
    private readonly deadlineMs: number;

    constructor({ deadlineMs }: { deadlineMs: number }) {
        this.deadlineMs = deadlineMs;
    }

    public execute = async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new DeadlineExceededError(this.deadlineMs));
            }, this.deadlineMs);
        });
        try {
            return await Promise.race([fn(controller.signal), deadline]);
        } finally {
            clearTimeout(timer);
        }
    };
}
