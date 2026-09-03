const poolEnd = jest.fn();

/**
 * Pools criados pelo `buildSessionStoreFromEnv`, na ordem, com acesso aos
 * handlers de `error` — o mock precisa expor o listener porque é exatamente ali
 * que morava o defeito (`() => undefined`, a assinatura do BE-05 repetida).
 */
const createdPools: Array<{ emitError: (err?: Error) => void; query: jest.Mock }> = [];

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

import { Pool } from 'pg';
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

    /**
     * A prova que faltava. Encerrar o pool no handler SEM reconstruí-lo é pior que
     * engolir o erro: `db.query` fecharia sobre um pool morto e o store degradaria
     * em silêncio até o processo terminar — trocando 2 conexões vazadas por deploy
     * por um session store permanentemente cego. O pg, sozinho, apenas remove o
     * cliente ocioso com erro e segue servindo.
     */
    it('rebuilds the pool on the next call after an error killed it', async () => {
        const store = buildSessionStoreFromEnv(envWithDb);
        expect(createdPools).toHaveLength(1);

        createdPools[0].emitError();
        expect(poolEnd).toHaveBeenCalledTimes(1);

        // A próxima leitura precisa funcionar, num pool NOVO.
        await store.acquire();

        expect(createdPools).toHaveLength(2);
        expect(createdPools[1].query).toHaveBeenCalledTimes(1);
        expect(createdPools[0].query).not.toHaveBeenCalled();
    });

    it('logs a redacted warning instead of swallowing the error silently', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        buildSessionStoreFromEnv(envWithDb);

        createdPools[0].emitError(
            new Error('password authentication failed for user "financeiro"'),
        );

        const logged = warn.mock.calls.flat().join('\n');
        expect(logged).toContain('pool derrubado por erro de socket');
        expect(logged).toContain('for user "[REDACTED]"');
        expect(logged).not.toContain('"financeiro"');
        warn.mockRestore();
    });

    /**
     * O contrato que a docstring do módulo promete — "o store NUNCA pode derrubar
     * a integração com o Conexos" — e que nenhum teste garantia. Quem lança aqui é
     * o parser da connection string, e ele põe a URL de entrada, com a senha,
     * dentro da mensagem.
     */
    it('fails open with a redacted log when the Pool constructor throws', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        (Pool as unknown as jest.Mock).mockImplementationOnce(() => {
            throw new Error(
                'invalid connection string: postgresql://financeiro:s3nh4-sup3r@db.supabase.co:5432/postgres',
            );
        });

        const store = buildSessionStoreFromEnv(envWithDb);

        // Fail-open: store desabilitado, backend de pé.
        expect(store.enabled).toBe(false);
        await expect(store.acquire()).resolves.toBeNull();

        const logged = warn.mock.calls.flat().join('\n');
        expect(logged).toContain('construção do Pool falhou');
        expect(logged).not.toContain('s3nh4-sup3r');
        warn.mockRestore();
    });

    it('does not reopen a pool after the shutdown already closed the store', async () => {
        const store = buildSessionStoreFromEnv(envWithDb);
        await closeConexosSessionStorePool();
        const poolsAfterShutdown = createdPools.length;

        // Uma query em voo não pode reabrir conexões enquanto o processo desce.
        // O store degrada para "miss", que é o contrato dele em qualquer erro.
        await expect(store.acquire()).resolves.toBeNull();
        expect(createdPools).toHaveLength(poolsAfterShutdown);
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
