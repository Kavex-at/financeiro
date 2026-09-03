import {
    DEFAULT_DRAIN_TIMEOUT_MS,
    SHUTDOWN_SIGNALS,
    createShutdownHandler,
    registerGracefulShutdown,
} from './gracefulShutdown.js';
import { isDraining, resetReadinessForTests } from './readinessState.js';

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
    const closeIdleConnections = jest.fn();
    return {
        close,
        closeIdleConnections,
        /** Simula o fim das requisições em voo. */
        finishDraining: (err?: Error) => pending?.(err),
    };
};

describe('gracefulShutdown (BE-06)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        resetReadinessForTests();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
        resetReadinessForTests();
    });

    it('drains in order: readiness → idle sockets → close → resources → exit 0', async () => {
        const order: string[] = [];
        const server = createServerFake();
        server.closeIdleConnections.mockImplementation(() => order.push('closeIdleConnections'));
        server.close.mockImplementation((cb?: (err?: Error) => void) => {
            order.push('server.close');
            cb?.();
        });
        const closeResources = jest.fn(async () => {
            order.push('closeResources');
        });
        const onExit = jest.fn((code: number) => order.push(`exit(${code})`));

        const handler = createShutdownHandler({ server, closeResources, onExit, log: () => {} });
        handler('SIGTERM');
        await jest.advanceTimersByTimeAsync(0);

        expect(order).toEqual([
            'closeIdleConnections',
            'server.close',
            'closeResources',
            'exit(0)',
        ]);
        expect(onExit).toHaveBeenCalledWith(0);
    });

    it('treats SIGINT exactly like SIGTERM', async () => {
        const server = createServerFake();
        const closeResources = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = createShutdownHandler({ server, closeResources, onExit, log: () => {} });
        handler('SIGINT');
        server.finishDraining();
        await jest.advanceTimersByTimeAsync(0);

        expect(server.close).toHaveBeenCalledTimes(1);
        expect(closeResources).toHaveBeenCalledTimes(1);
        expect(onExit).toHaveBeenCalledWith(0);
    });

    it('ignores a second signal while a shutdown is already running', async () => {
        const server = createServerFake();
        const closeResources = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = createShutdownHandler({ server, closeResources, onExit, log: () => {} });
        handler('SIGTERM');
        handler('SIGTERM');
        handler('SIGINT');
        server.finishDraining();
        await jest.advanceTimersByTimeAsync(0);

        expect(server.close).toHaveBeenCalledTimes(1);
        expect(closeResources).toHaveBeenCalledTimes(1);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('force-exits with 0 when draining outlasts the timeout (hung request)', async () => {
        const server = createServerFake(); // nunca chama o callback
        const closeResources = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = createShutdownHandler({
            server,
            closeResources,
            onExit,
            drainTimeoutMs: 5_000,
            log: () => {},
        });
        handler('SIGTERM');

        expect(onExit).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(5_000);

        expect(onExit).toHaveBeenCalledWith(0);
        expect(closeResources).not.toHaveBeenCalled();
    });

    it('still exits 0 when closeResources rejects (no zombie process)', async () => {
        const server = createServerFake();
        const closeResources = jest.fn().mockRejectedValue(new Error('pool already ended'));
        const onExit = jest.fn();
        const log = jest.fn();

        const handler = createShutdownHandler({ server, closeResources, onExit, log });
        handler('SIGTERM');
        server.finishDraining();
        await jest.advanceTimersByTimeAsync(0);

        expect(onExit).toHaveBeenCalledWith(0);
        expect(log.mock.calls.flat().join('\n')).toContain('falha ao encerrar recursos');
    });

    it('clears the force-exit timer on the happy path', async () => {
        const server = createServerFake();
        const closeResources = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = createShutdownHandler({ server, closeResources, onExit, log: () => {} });
        handler('SIGTERM');
        server.finishDraining();
        await jest.advanceTimersByTimeAsync(0);

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
            closeResources: jest.fn(async () => {}),
            onExit: jest.fn(),
            log: () => {},
        });
        handler('SIGTERM');

        expect(unref).toHaveBeenCalledTimes(1);
    });

    it('registers the handler on SIGTERM and SIGINT', () => {
        const on = jest.fn();
        const server = createServerFake();

        registerGracefulShutdown(
            {
                server,
                closeResources: jest.fn(async () => {}),
                onExit: jest.fn(),
                log: () => {},
            },
            { on },
        );

        expect(SHUTDOWN_SIGNALS).toEqual(['SIGTERM', 'SIGINT']);
        expect(on.mock.calls.map((call) => call[0])).toEqual(['SIGTERM', 'SIGINT']);

        (on.mock.calls[0][1] as () => void)();
        expect(server.close).toHaveBeenCalledTimes(1);
    });

    // ── availability-1 ────────────────────────────────────────────────────────
    describe('readiness (availability-1)', () => {
        it('marks the process as draining before it stops accepting connections', () => {
            const server = createServerFake();
            server.close.mockImplementation(() => {
                // Lido DENTRO do close: prova que a marcação veio antes, e não
                // apenas que aconteceu em algum momento.
                expect(isDraining()).toBe(true);
            });

            expect(isDraining()).toBe(false);
            createShutdownHandler({
                server,
                closeResources: jest.fn(async () => {}),
                onExit: jest.fn(),
                log: () => {},
            })('SIGTERM');

            expect(isDraining()).toBe(true);
            expect(server.close).toHaveBeenCalledTimes(1);
        });
    });

    // ── availability-2 ────────────────────────────────────────────────────────
    describe('keep-alive sockets (availability-2)', () => {
        it('releases idle connections exactly once, before server.close', () => {
            const server = createServerFake();

            createShutdownHandler({
                server,
                closeResources: jest.fn(async () => {}),
                onExit: jest.fn(),
                log: () => {},
            })('SIGTERM');

            expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
            expect(server.closeIdleConnections.mock.invocationCallOrder[0]).toBeLessThan(
                server.close.mock.invocationCallOrder[0],
            );
        });

        it('works on a server without closeIdleConnections (older runtimes)', async () => {
            const close = jest.fn((cb?: (err?: Error) => void) => cb?.());
            const onExit = jest.fn();

            createShutdownHandler({
                server: { close },
                closeResources: jest.fn(async () => {}),
                onExit,
                log: () => {},
            })('SIGTERM');
            await jest.advanceTimersByTimeAsync(0);

            expect(close).toHaveBeenCalledTimes(1);
            expect(onExit).toHaveBeenCalledWith(0);
        });
    });

    // ── fault-tolerance-1 ─────────────────────────────────────────────────────
    describe('drain ceiling (fault-tolerance-1)', () => {
        it('defaults to 25s, using ~83% of the Render SIGTERM→SIGKILL envelope', () => {
            expect(DEFAULT_DRAIN_TIMEOUT_MS).toBe(25_000);
        });

        it('still honours an injected ceiling', async () => {
            const server = createServerFake();
            const onExit = jest.fn();

            createShutdownHandler({
                server,
                closeResources: jest.fn(async () => {}),
                onExit,
                drainTimeoutMs: 1_000,
                log: () => {},
            })('SIGTERM');

            await jest.advanceTimersByTimeAsync(999);
            expect(onExit).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(1);
            expect(onExit).toHaveBeenCalledWith(0);
        });
    });

    // ── fault-tolerance-2 ─────────────────────────────────────────────────────
    describe('force-exit visibility (fault-tolerance-2)', () => {
        it('publishes the force-exit through onForceExit before exiting', async () => {
            const server = createServerFake();
            const onForceExit = jest.fn(async (_reason: string) => {});
            const onExit = jest.fn();

            createShutdownHandler({
                server,
                closeResources: jest.fn(async () => {}),
                onExit,
                onForceExit,
                drainTimeoutMs: 2_000,
                log: () => {},
            })('SIGTERM');
            await jest.advanceTimersByTimeAsync(2_000);

            expect(onForceExit).toHaveBeenCalledTimes(1);
            expect(onForceExit.mock.calls[0][0]).toContain('drenagem excedeu 2000ms');
            expect(onExit).toHaveBeenCalledWith(0);
        });

        it('does not publish anything when the drain completes normally', async () => {
            const server = createServerFake();
            const onForceExit = jest.fn(async (_reason: string) => {});

            createShutdownHandler({
                server,
                closeResources: jest.fn(async () => {}),
                onExit: jest.fn(),
                onForceExit,
                log: () => {},
            })('SIGTERM');
            server.finishDraining();
            await jest.advanceTimersByTimeAsync(0);

            expect(onForceExit).not.toHaveBeenCalled();
        });

        it('exits anyway when onForceExit rejects', async () => {
            const server = createServerFake();
            const onExit = jest.fn();
            const log = jest.fn();

            createShutdownHandler({
                server,
                closeResources: jest.fn(async () => {}),
                onExit,
                onForceExit: jest.fn().mockRejectedValue(new Error('painel fora do ar')),
                drainTimeoutMs: 1_000,
                log,
            })('SIGTERM');
            await jest.advanceTimersByTimeAsync(1_000);

            expect(onExit).toHaveBeenCalledWith(0);
            expect(log.mock.calls.flat().join('\n')).toContain('falha ao publicar o force-exit');
        });
    });

    // ── security-1 ────────────────────────────────────────────────────────────
    describe('log redaction (security-1)', () => {
        it('redacts the Postgres user out of a failing close', async () => {
            const server = createServerFake();
            const log = jest.fn();

            createShutdownHandler({
                server,
                closeResources: jest
                    .fn()
                    .mockRejectedValue(
                        new Error('password authentication failed for user "financeiro"'),
                    ),
                onExit: jest.fn(),
                log,
            })('SIGTERM');
            server.finishDraining();
            await jest.advanceTimersByTimeAsync(0);

            const logged = log.mock.calls.flat().join('\n');
            expect(logged).toContain('for user "[REDACTED]"');
            expect(logged).not.toContain('"financeiro"');
        });
    });

    // ── testability-1 ─────────────────────────────────────────────────────────
    describe('uncovered branches (testability-1)', () => {
        it('logs a server.close error and drains anyway', async () => {
            const server = createServerFake();
            const closeResources = jest.fn(async () => {});
            const onExit = jest.fn();
            const log = jest.fn();

            createShutdownHandler({ server, closeResources, onExit, log })('SIGTERM');
            server.finishDraining(new Error('EADDRINUSE'));
            await jest.advanceTimersByTimeAsync(0);

            expect(log.mock.calls.flat().join('\n')).toContain('server.close reportou');
            // O erro no close não pode abortar a liberação de recursos.
            expect(closeResources).toHaveBeenCalledTimes(1);
            expect(onExit).toHaveBeenCalledWith(0);
        });

        /**
         * A guarda `if (exited) return` do `exitOnce`. A requisição pendurada
         * termina DEPOIS do force-exit — o drain roda e chama `exitOnce` uma
         * segunda vez. Sem a guarda, `onExit` sairia 2× em produção; e drenar
         * antes do teto não prova nada, porque ali o timer é cancelado e o
         * segundo caminho nunca chega a existir.
         */
        it('exits once when the drain finishes after the force-exit already fired', async () => {
            const server = createServerFake();
            const onExit = jest.fn();

            createShutdownHandler({
                server,
                closeResources: jest.fn(async () => {}),
                onExit,
                drainTimeoutMs: 1_000,
                log: () => {},
            })('SIGTERM');

            // O teto estoura primeiro: force-exit.
            await jest.advanceTimersByTimeAsync(1_000);
            expect(onExit).toHaveBeenCalledTimes(1);

            // Só então a requisição em voo termina.
            server.finishDraining();
            await jest.advanceTimersByTimeAsync(0);
            expect(onExit).toHaveBeenCalledTimes(1);
        });

        it('falls back to console.log when no logger is injected', () => {
            const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
            const server = createServerFake();

            createShutdownHandler({
                server,
                closeResources: jest.fn(async () => {}),
                onExit: jest.fn(),
            })('SIGTERM');

            expect(consoleLog).toHaveBeenCalledWith(
                expect.stringContaining('[shutdown] SIGTERM recebido'),
            );
        });

        it('reports a non-Error rejection without crashing', async () => {
            const server = createServerFake();
            const log = jest.fn();
            const onExit = jest.fn();

            createShutdownHandler({
                server,
                closeResources: jest.fn().mockRejectedValue('pooler indisponível'),
                onExit,
                log,
            })('SIGTERM');
            server.finishDraining();
            await jest.advanceTimersByTimeAsync(0);

            expect(log.mock.calls.flat().join('\n')).toContain('pooler indisponível');
            expect(onExit).toHaveBeenCalledWith(0);
        });

        it('tolerates a timer handle without unref', () => {
            jest.spyOn(global, 'setTimeout').mockReturnValue({} as unknown as NodeJS.Timeout);
            const server = createServerFake();

            expect(() =>
                createShutdownHandler({
                    server,
                    closeResources: jest.fn(async () => {}),
                    onExit: jest.fn(),
                    log: () => {},
                })('SIGTERM'),
            ).not.toThrow();
        });

        it('defaults the signal target to the real process', () => {
            const server = createServerFake();
            const handler = registerGracefulShutdown({
                server,
                closeResources: jest.fn(async () => {}),
                onExit: jest.fn(),
                log: () => {},
            });

            try {
                expect(process.listenerCount('SIGTERM')).toBeGreaterThan(0);
                expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);
            } finally {
                // Não vazar listener para os demais testes do runner.
                for (const signal of SHUTDOWN_SIGNALS) process.removeAllListeners(signal);
            }
            expect(typeof handler).toBe('function');
        });
    });
});
