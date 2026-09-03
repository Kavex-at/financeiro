import {
    DEFAULT_DRAIN_TIMEOUT_MS,
    SHUTDOWN_SIGNALS,
    createShutdownHandler,
    registerGracefulShutdown,
} from './gracefulShutdown.js';

/**
 * `server.close` real chama o callback quando a última conexão em voo termina.
 * Este fake deixa o teste controlar esse instante — é o que permite distinguir
 * "drenou" de "estourou o timeout" sem abrir porta nenhuma.
 */
const createServerFake = () => {
    let pending: ((err?: Error) => void) | undefined;
    const close = jest.fn((callback?: (err?: Error) => void) => {
        pending = callback;
    });
    return {
        close,
        /** Simula o fim das requisições em voo. */
        finishDraining: (err?: Error) => pending?.(err),
        get drained() {
            return pending !== undefined;
        },
    };
};

describe('gracefulShutdown (BE-06)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('stops accepting connections, then closes the pool, then exits 0 — in that order', async () => {
        const order: string[] = [];
        const server = createServerFake();
        server.close.mockImplementation((cb?: (err?: Error) => void) => {
            order.push('server.close');
            cb?.();
        });
        const closePool = jest.fn(async () => {
            order.push('closePool');
        });
        const onExit = jest.fn((code: number) => order.push(`exit(${code})`));

        const handler = createShutdownHandler({ server, closePool, onExit, log: () => {} });
        handler('SIGTERM');
        await jest.advanceTimersByTimeAsync(0);

        expect(order).toEqual(['server.close', 'closePool', 'exit(0)']);
        expect(onExit).toHaveBeenCalledWith(0);
    });

    it('treats SIGINT exactly like SIGTERM', async () => {
        const server = createServerFake();
        const closePool = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = createShutdownHandler({ server, closePool, onExit, log: () => {} });
        handler('SIGINT');
        server.finishDraining();
        await jest.advanceTimersByTimeAsync(0);

        expect(server.close).toHaveBeenCalledTimes(1);
        expect(closePool).toHaveBeenCalledTimes(1);
        expect(onExit).toHaveBeenCalledWith(0);
    });

    it('ignores a second signal while a shutdown is already running', async () => {
        const server = createServerFake();
        const closePool = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = createShutdownHandler({ server, closePool, onExit, log: () => {} });
        handler('SIGTERM');
        handler('SIGTERM');
        handler('SIGINT');
        server.finishDraining();
        await jest.advanceTimersByTimeAsync(0);

        expect(server.close).toHaveBeenCalledTimes(1);
        expect(closePool).toHaveBeenCalledTimes(1);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('force-exits with 0 when draining outlasts the timeout (hung request)', async () => {
        const server = createServerFake(); // nunca chama o callback
        const closePool = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = createShutdownHandler({
            server,
            closePool,
            onExit,
            drainTimeoutMs: 5_000,
            log: () => {},
        });
        handler('SIGTERM');

        expect(onExit).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(onExit).toHaveBeenCalledWith(0);
        // A saída forçada não fica represada esperando o pool que nunca foi pedido.
        expect(closePool).not.toHaveBeenCalled();
    });

    it('still exits 0 when closePool rejects (no zombie process)', async () => {
        const server = createServerFake();
        const closePool = jest.fn().mockRejectedValue(new Error('pool already ended'));
        const onExit = jest.fn();
        const log = jest.fn();

        const handler = createShutdownHandler({ server, closePool, onExit, log });
        handler('SIGTERM');
        server.finishDraining();
        await jest.advanceTimersByTimeAsync(0);

        expect(onExit).toHaveBeenCalledWith(0);
        expect(log.mock.calls.flat().join('\n')).toContain('falha ao encerrar o pool');
    });

    it('clears the force-exit timer on the happy path', async () => {
        const server = createServerFake();
        const closePool = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = createShutdownHandler({ server, closePool, onExit, log: () => {} });
        handler('SIGTERM');
        server.finishDraining();
        await jest.advanceTimersByTimeAsync(0);

        // Timer cancelado ⇒ nada pendente, e avançar além do timeout não
        // dispara uma segunda saída.
        expect(jest.getTimerCount()).toBe(0);
        await jest.advanceTimersByTimeAsync(DEFAULT_DRAIN_TIMEOUT_MS * 2);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('unrefs the force-exit timer so it does not hold the event loop', () => {
        const unref = jest.fn();
        jest.spyOn(global, 'setTimeout').mockReturnValue({ unref } as unknown as NodeJS.Timeout);

        const server = createServerFake();
        const handler = createShutdownHandler({
            server,
            closePool: jest.fn(async () => {}),
            onExit: jest.fn(),
            log: () => {},
        });
        handler('SIGTERM');

        expect(unref).toHaveBeenCalledTimes(1);
    });

    it('registers the handler on SIGTERM and SIGINT', () => {
        const on = jest.fn();
        const server = createServerFake();
        const closePool = jest.fn(async () => {});
        const onExit = jest.fn();

        registerGracefulShutdown({ server, closePool, onExit, log: () => {} }, { on });

        expect(SHUTDOWN_SIGNALS).toEqual(['SIGTERM', 'SIGINT']);
        expect(on.mock.calls.map((call) => call[0])).toEqual(['SIGTERM', 'SIGINT']);

        // O listener registrado dispara a drenagem de verdade.
        (on.mock.calls[0][1] as () => void)();
        expect(server.close).toHaveBeenCalledTimes(1);
    });
});
