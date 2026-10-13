import DeadlineExceededError from '../../errors/DeadlineExceededError.js';
import TimeoutExecutor from './TimeoutExecutor.js';

describe('TimeoutExecutor', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('returns the result when the work finishes in time, without aborting', async () => {
        let signal: AbortSignal | undefined;
        const result = await new TimeoutExecutor({ deadlineMs: 1_000 }).execute(async (s) => {
            signal = s;
            return 'ok';
        });
        expect(result).toBe('ok');
        expect(signal?.aborted).toBe(false);
    });

    it('rejects with DeadlineExceededError and aborts the signal when the work hangs', async () => {
        let signal: AbortSignal | undefined;
        const running = new TimeoutExecutor({ deadlineMs: 1_000 }).execute((s) => {
            signal = s;
            return new Promise<never>(() => undefined); // never settles
        });
        const assertion = expect(running).rejects.toBeInstanceOf(DeadlineExceededError);
        await jest.advanceTimersByTimeAsync(1_000);
        await assertion;
        expect(signal?.aborted).toBe(true);
    });

    it('does not fire at deadline - 1 ms', async () => {
        const fn = jest.fn((_s: AbortSignal) => new Promise<string>(() => undefined));
        const running = new TimeoutExecutor({ deadlineMs: 1_000 }).execute(fn);
        let settled = false;
        running
            .catch(() => undefined)
            .finally(() => {
                settled = true;
            });
        await jest.advanceTimersByTimeAsync(999);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        expect(settled).toBe(true);
    });

    it('propagates the work error as is', async () => {
        await expect(
            new TimeoutExecutor({ deadlineMs: 1_000 }).execute(async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
    });
});
