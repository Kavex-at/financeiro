import { registerLastResortHandlers } from './lastResortHandlers.js';

describe('registerLastResortHandlers (fault-tolerance-3)', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('registers on both fatal events', () => {
        const on = jest.fn();

        registerLastResortHandlers(
            { closeResources: jest.fn(async () => {}), onExit: jest.fn(), log: () => {} },
            { on },
        );

        expect(on.mock.calls.map((c) => c[0])).toEqual(['unhandledRejection', 'uncaughtException']);
    });

    /**
     * O ponto: sem isto o processo morria SEM drenar, cortando requisições em voo — e uma delas
     * entre `createRun` e `finishRun` vira órfã em `reconciling`.
     */
    it('releases resources before exiting', async () => {
        const order: string[] = [];
        const closeResources = jest.fn(async () => {
            order.push('closeResources');
        });
        const onExit = jest.fn((code: number) => order.push(`exit(${code})`));

        const handler = registerLastResortHandlers({
            closeResources,
            onExit,
            log: () => {},
        });
        handler('uncaughtException', new Error('boom'));
        await jest.advanceTimersByTimeAsync(0);

        expect(order).toEqual(['closeResources', 'exit(1)']);
    });

    /** Código 1, não 0: isto é falha do programa, e o deploy precisa ser marcado como quebrado. */
    it('exits with 1, unlike the SIGTERM path', async () => {
        const onExit = jest.fn();

        registerLastResortHandlers({
            closeResources: jest.fn(async () => {}),
            onExit,
            log: () => {},
        })('unhandledRejection', 'falha');
        await jest.advanceTimersByTimeAsync(0);

        expect(onExit).toHaveBeenCalledWith(1);
    });

    it('exits anyway when releasing resources hangs', async () => {
        const onExit = jest.fn();

        registerLastResortHandlers({
            closeResources: () => new Promise<void>(() => {}), // nunca resolve
            onExit,
            closeTimeoutMs: 1_000,
            log: () => {},
        })('uncaughtException', new Error('boom'));

        expect(onExit).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1_000);
        expect(onExit).toHaveBeenCalledWith(1);
    });

    it('exits anyway when releasing resources rejects', async () => {
        const onExit = jest.fn();

        registerLastResortHandlers({
            closeResources: jest.fn().mockRejectedValue(new Error('pool already ended')),
            onExit,
            log: () => {},
        })('uncaughtException', new Error('boom'));
        await jest.advanceTimersByTimeAsync(0);

        expect(onExit).toHaveBeenCalledWith(1);
    });

    it('ignores a second fatal error while already dying', async () => {
        const closeResources = jest.fn(async () => {});
        const onExit = jest.fn();

        const handler = registerLastResortHandlers({ closeResources, onExit, log: () => {} });
        handler('uncaughtException', new Error('primeiro'));
        handler('unhandledRejection', new Error('segundo'));
        await jest.advanceTimersByTimeAsync(0);

        expect(closeResources).toHaveBeenCalledTimes(1);
        expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('unrefs the close timer so it does not hold the event loop', () => {
        const unref = jest.fn();
        jest.spyOn(global, 'setTimeout').mockReturnValue({ unref } as unknown as NodeJS.Timeout);

        registerLastResortHandlers({
            closeResources: jest.fn(async () => {}),
            onExit: jest.fn(),
            log: () => {},
        })('uncaughtException', new Error('boom'));

        expect(unref).toHaveBeenCalledTimes(1);
    });

    it('tolerates a timer handle without unref', () => {
        jest.spyOn(global, 'setTimeout').mockReturnValue({} as unknown as NodeJS.Timeout);

        expect(() =>
            registerLastResortHandlers({
                closeResources: jest.fn(async () => {}),
                onExit: jest.fn(),
                log: () => {},
            })('uncaughtException', new Error('boom')),
        ).not.toThrow();
    });

    it('stringifies a non-Error fatal value', () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        registerLastResortHandlers({
            closeResources: jest.fn(async () => {}),
            onExit: jest.fn(),
        })('unhandledRejection', 'pooler sumiu');

        expect(consoleError.mock.calls.flat().join('\n')).toContain('pooler sumiu');
    });

    it('redacts the error before logging it', () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        registerLastResortHandlers({
            closeResources: jest.fn(async () => {}),
            onExit: jest.fn(),
        })('uncaughtException', new Error('password authentication failed for user "financeiro"'));

        const logged = consoleError.mock.calls.flat().join('\n');
        expect(logged).toContain('for user "[REDACTED]"');
        expect(logged).not.toContain('"financeiro"');
    });
});
