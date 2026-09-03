const poolEnd = jest.fn();

/**
 * Pools criados pelo `buildSessionStoreFromEnv`, na ordem, com acesso aos
 * handlers de `error` — o mock precisa expor o listener porque é exatamente ali
 * que morava o defeito (`() => undefined`, a assinatura do BE-05 repetida).
 */
const createdPools: Array<{ emitError: (err?: Error) => void }> = [];

jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation(() => {
        const errorHandlers: Array<(err: Error) => void> = [];
        const pool = {
            query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
            on: (event: string, handler: (err: Error) => void) => {
                if (event === 'error') errorHandlers.push(handler);
            },
            end: () => poolEnd(),
            emitError: (err: Error = new Error('Connection terminated unexpectedly')) => {
                for (const handler of [...errorHandlers]) handler(err);
            },
        };
        createdPools.push(pool);
        return pool;
    }),
}));

import { buildSessionStoreFromEnv, closeConexosSessionStorePool } from './conexosSessionStore.js';

const envWithDb = { databaseConnectionString: 'postgresql://u:p@h:6543/db' } as NodeJS.ProcessEnv;

describe('conexosSessionStore — ciclo de vida do 2º pool (integrability-2, P1)', () => {
    beforeEach(async () => {
        // Drena qualquer pool que o singleton do módulo tenha aberto no import.
        await closeConexosSessionStorePool();
        poolEnd.mockReset();
        poolEnd.mockResolvedValue(undefined);
        createdPools.length = 0;
    });

    it('ends the pool on error instead of just swallowing it', async () => {
        buildSessionStoreFromEnv(envWithDb);
        expect(createdPools).toHaveLength(1);

        createdPools[0].emitError();

        expect(poolEnd).toHaveBeenCalledTimes(1);
    });

    it('ends the pool only once when the error event fires repeatedly', async () => {
        buildSessionStoreFromEnv(envWithDb);

        createdPools[0].emitError();
        createdPools[0].emitError();
        createdPools[0].emitError();

        expect(poolEnd).toHaveBeenCalledTimes(1);
    });

    it('survives an end() that rejects (no unhandled rejection)', async () => {
        poolEnd.mockRejectedValue(new Error('pool already ended'));
        buildSessionStoreFromEnv(envWithDb);

        expect(() => createdPools[0].emitError()).not.toThrow();
        await Promise.resolve();
        expect(poolEnd).toHaveBeenCalledTimes(1);
    });

    describe('closeConexosSessionStorePool', () => {
        it('closes the pool the store opened', async () => {
            buildSessionStoreFromEnv(envWithDb);

            await closeConexosSessionStorePool();

            expect(poolEnd).toHaveBeenCalledTimes(1);
        });

        it('is idempotent', async () => {
            buildSessionStoreFromEnv(envWithDb);

            await closeConexosSessionStorePool();
            await closeConexosSessionStorePool();

            expect(poolEnd).toHaveBeenCalledTimes(1);
        });

        it('is a no-op when the store was built without a database', async () => {
            buildSessionStoreFromEnv({} as NodeJS.ProcessEnv);

            await expect(closeConexosSessionStorePool()).resolves.toBeUndefined();
            expect(createdPools).toHaveLength(0);
            expect(poolEnd).not.toHaveBeenCalled();
        });

        it('does not re-end a pool already ended by its error handler', async () => {
            buildSessionStoreFromEnv(envWithDb);
            createdPools[0].emitError();

            await closeConexosSessionStorePool();

            expect(poolEnd).toHaveBeenCalledTimes(1);
        });

        it('swallows an end() that rejects', async () => {
            poolEnd.mockRejectedValue(new Error('pool already ended'));
            buildSessionStoreFromEnv(envWithDb);

            await expect(closeConexosSessionStorePool()).resolves.toBeUndefined();
        });
    });
});
