import 'reflect-metadata';

const poolQuery = jest.fn();
const clientQuery = jest.fn();
const clientRelease = jest.fn();
const poolEnd = jest.fn();
const poolConnect = jest.fn(async () => ({
    query: (sql: string, params?: unknown[]) => clientQuery(sql, params),
    release: () => clientRelease(),
}));

/**
 * Pools criados pelo cliente, na ordem. O mock anterior descartava o listener
 * (`on: jest.fn()`), o que deixava o handler de `error` — exatamente onde o pool
 * vazava — inalcançável pelo teste. Aqui cada pool guarda seus handlers e expõe
 * `emitError` para dispará-los.
 */
const createdPools: Array<{ emitError: (err?: Error) => void }> = [];

jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation(() => {
        const errorHandlers: Array<(err: Error) => void> = [];
        const pool = {
            query: (sql: string, params?: unknown[]) => poolQuery(sql, params),
            connect: () => poolConnect(),
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

import PostgreeDatabaseClient from './PostgreeDatabaseClient.js';

describe('PostgreeDatabaseClient', () => {
    const environmentProvider = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            databaseConnectionString: 'postgresql://user:pass@host:6543/postgres?pgbouncer=true',
        }),
    };

    beforeEach(() => {
        poolQuery.mockReset();
        clientQuery.mockReset();
        clientRelease.mockReset();
        poolConnect.mockClear();
        // `mockReset` apagaria a implementação e `end()` devolveria `undefined`,
        // quebrando o `.catch()` do handler. Reset + implementação explícita.
        poolEnd.mockReset();
        poolEnd.mockResolvedValue(undefined);
        createdPools.length = 0;
        environmentProvider.getEnvironmentVars.mockClear();
    });

    it('retries query on transient MaxClientsInSessionMode error', async () => {
        poolQuery
            .mockRejectedValueOnce(new Error('MaxClientsInSessionMode exceeded'))
            .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

        const client = new PostgreeDatabaseClient(environmentProvider as any);
        const rows = await client.selectMany('SELECT 1');

        expect(rows).toEqual([{ id: 1 }]);
        expect(poolQuery).toHaveBeenCalledTimes(2);
    });

    it('retries query on Connection terminated error', async () => {
        poolQuery
            .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const client = new PostgreeDatabaseClient(environmentProvider as any);
        const rows = await client.selectMany('SELECT 1');

        expect(rows).toEqual([]);
        expect(poolQuery).toHaveBeenCalledTimes(2);
    });

    it('does not retry on non-transient errors', async () => {
        poolQuery.mockRejectedValue(new Error('syntax error at or near "FROM"'));

        const client = new PostgreeDatabaseClient(environmentProvider as any);
        await expect(client.selectMany('SELECT broken')).rejects.toThrow('syntax error');
        expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('gives up after exhausting retries on persistent transient error', async () => {
        poolQuery.mockRejectedValue(new Error('too many clients already'));

        const client = new PostgreeDatabaseClient(environmentProvider as any);
        await expect(client.selectMany('SELECT 1')).rejects.toThrow('too many clients');
        expect(poolQuery).toHaveBeenCalledTimes(3);
    });

    it('selectFirst returns first row or null', async () => {
        poolQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

        const client = new PostgreeDatabaseClient(environmentProvider as any);
        const row = await client.selectFirst<{ id: number }>('SELECT 1');

        expect(row).toEqual({ id: 1 });
    });

    it('selectFirst returns null when no rows', async () => {
        poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const client = new PostgreeDatabaseClient(environmentProvider as any);
        const row = await client.selectFirst<{ id: number }>('SELECT 1');

        expect(row).toBeNull();
    });

    it('insert returns rowCount', async () => {
        poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

        const client = new PostgreeDatabaseClient(environmentProvider as any);
        const count = await client.insert('INSERT INTO t VALUES (1), (2), (3)');

        expect(count).toBe(3);
    });

    it('update returns rowCount', async () => {
        poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 5 });

        const client = new PostgreeDatabaseClient(environmentProvider as any);
        const count = await client.update('UPDATE t SET x = $1 WHERE y = $2', {
            x: 'new',
            y: 'old',
        });

        expect(count).toBe(5);
    });

    describe('withTransaction', () => {
        it('wraps fn in BEGIN/COMMIT on a dedicated pooled client and releases it', async () => {
            clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });

            const client = new PostgreeDatabaseClient(environmentProvider as any);
            const result = await client.withTransaction(async (tx) => {
                await tx.insert('INSERT INTO t (x) VALUES ($x)', { x: 1 });
                await tx.insert('INSERT INTO t (x) VALUES ($x)', { x: 2 });
                return 'done';
            });

            expect(result).toBe('done');
            // dedicated client from the pool, released exactly once.
            expect(poolConnect).toHaveBeenCalledTimes(1);
            expect(clientRelease).toHaveBeenCalledTimes(1);

            const issued = clientQuery.mock.calls.map((c) => c[0] as string);
            // exactly one BEGIN and one COMMIT, no ROLLBACK on success.
            expect(issued.filter((q) => q === 'BEGIN')).toHaveLength(1);
            expect(issued.filter((q) => q === 'COMMIT')).toHaveLength(1);
            expect(issued).not.toContain('ROLLBACK');
            // queries went through the dedicated client, NOT the pool.
            expect(poolQuery).not.toHaveBeenCalled();
        });

        it('rolls back and rethrows when fn throws mid-transaction (partial rollback)', async () => {
            clientQuery.mockImplementation(async (sql: string) => {
                if (sql.includes('FAIL')) throw new Error('boom');
                return { rows: [], rowCount: 1 };
            });

            const client = new PostgreeDatabaseClient(environmentProvider as any);

            await expect(
                client.withTransaction(async (tx) => {
                    await tx.insert('INSERT INTO t (x) VALUES ($x)', { x: 1 });
                    await tx.insert('FAIL', { x: 2 });
                }),
            ).rejects.toThrow('boom');

            const issued = clientQuery.mock.calls.map((c) => c[0] as string);
            expect(issued).toContain('BEGIN');
            expect(issued).toContain('ROLLBACK');
            expect(issued).not.toContain('COMMIT');
            // client always released even on failure.
            expect(clientRelease).toHaveBeenCalledTimes(1);
        });
    });

    describe('withAdvisoryLock (P0-6)', () => {
        it('runs onAcquired and releases the lock when pg_try_advisory_lock succeeds', async () => {
            clientQuery.mockImplementation(async (sql: string) => {
                if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
                return { rows: [{}] };
            });
            const onAcquired = jest.fn().mockResolvedValue('did-work');
            const onBusy = jest.fn().mockResolvedValue('busy');

            const client = new PostgreeDatabaseClient(environmentProvider as any);
            const result = await client.withAdvisoryLock(42, onAcquired, onBusy);

            expect(result).toBe('did-work');
            expect(onAcquired).toHaveBeenCalledTimes(1);
            expect(onBusy).not.toHaveBeenCalled();
            const issued = clientQuery.mock.calls.map((c) => c[0] as string);
            expect(issued.some((q) => q.includes('pg_try_advisory_lock'))).toBe(true);
            expect(issued.some((q) => q.includes('pg_advisory_unlock'))).toBe(true);
            expect(clientRelease).toHaveBeenCalledTimes(1);
        });

        it('runs onBusy (no unlock) when the lock is already held', async () => {
            clientQuery.mockImplementation(async (sql: string) => {
                if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: false }] };
                return { rows: [{}] };
            });
            const onAcquired = jest.fn().mockResolvedValue('did-work');
            const onBusy = jest.fn().mockResolvedValue('busy');

            const client = new PostgreeDatabaseClient(environmentProvider as any);
            const result = await client.withAdvisoryLock(42, onAcquired, onBusy);

            expect(result).toBe('busy');
            expect(onAcquired).not.toHaveBeenCalled();
            const issued = clientQuery.mock.calls.map((c) => c[0] as string);
            expect(issued.some((q) => q.includes('pg_advisory_unlock'))).toBe(false);
            expect(clientRelease).toHaveBeenCalledTimes(1);
        });
    });

    /**
     * BE-05. O handler de `error` zerava `connectionPool` sem chamar `end()`: o
     * pool quebrado ia para o GC ainda segurando até 5 sessões no Supabase, e a
     * `init()` seguinte abria mais 5. Como `'too many clients'` e
     * `'MaxClientsInSessionMode'` são erros que este cliente trata como
     * transitórios, o handler que existia para recuperar do esgotamento de
     * conexões era o que o acelerava.
     */
    describe('pool error handling (BE-05)', () => {
        const primePool = async (client: PostgreeDatabaseClient): Promise<void> => {
            poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
            await client.selectMany('SELECT 1');
        };

        it('ends the broken pool and drops the reference on a pool error', async () => {
            const client = new PostgreeDatabaseClient(environmentProvider as any);
            await primePool(client);
            expect(createdPools).toHaveLength(1);

            createdPools[0].emitError();

            expect(poolEnd).toHaveBeenCalledTimes(1);

            // referência zerada ⇒ a próxima query abre um pool NOVO.
            await client.selectMany('SELECT 1');
            expect(createdPools).toHaveLength(2);
        });

        it('ends the pool only once when the error event fires repeatedly', async () => {
            const client = new PostgreeDatabaseClient(environmentProvider as any);
            await primePool(client);

            createdPools[0].emitError();
            createdPools[0].emitError();
            createdPools[0].emitError();

            expect(poolEnd).toHaveBeenCalledTimes(1);
        });

        it('a late error from the OLD pool does not kill the pool created meanwhile', async () => {
            const client = new PostgreeDatabaseClient(environmentProvider as any);
            await primePool(client);

            createdPools[0].emitError();
            await client.selectMany('SELECT 1'); // cria o pool novo
            expect(createdPools).toHaveLength(2);

            // Disparo tardio do pool ANTIGO — não pode zerar a referência corrente.
            createdPools[0].emitError();

            expect(poolEnd).toHaveBeenCalledTimes(1);
            await expect(client.selectMany('SELECT 1')).resolves.toEqual([]);
            expect(createdPools).toHaveLength(2); // nenhum pool extra foi aberto
        });

        /**
         * Regressão do próprio BE-05: encerrar o pool quebrado tornou fatal uma
         * retentativa que antes funcionava. `query` congelava a referência fora
         * do `RetryExecutor`, então a 2ª tentativa bateria em `Cannot use a pool
         * after calling end on the pool` em vez de usar o pool novo — trocando um
         * erro recuperável por um definitivo, justamente no caminho que o retry
         * de `Connection terminated` existe para salvar.
         */
        it('retries against a NEW pool after the broken one was ended', async () => {
            poolQuery
                .mockImplementationOnce(async () => {
                    createdPools[0].emitError();
                    throw new Error('Connection terminated unexpectedly');
                })
                .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 });

            const client = new PostgreeDatabaseClient(environmentProvider as any);
            const rows = await client.selectMany('SELECT 1');

            expect(rows).toEqual([{ id: 1 }]);
            expect(poolEnd).toHaveBeenCalledTimes(1);
            // a retentativa reabriu o pool em vez de reusar o encerrado.
            expect(createdPools).toHaveLength(2);
        });

        it('survives an end() that rejects (no unhandled rejection)', async () => {
            poolEnd.mockRejectedValue(new Error('pool already ended'));
            const client = new PostgreeDatabaseClient(environmentProvider as any);
            await primePool(client);

            expect(() => createdPools[0].emitError()).not.toThrow();
            await Promise.resolve(); // deixa o `.catch()` do handler rodar
            expect(poolEnd).toHaveBeenCalledTimes(1);
        });
    });

    describe('close (shutdown gracioso)', () => {
        it('ends the pool and is idempotent', async () => {
            poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
            const client = new PostgreeDatabaseClient(environmentProvider as any);
            await client.selectMany('SELECT 1');

            await client.close();
            await client.close();

            expect(poolEnd).toHaveBeenCalledTimes(1);
        });

        it('is a no-op when the pool was never initialized', async () => {
            const client = new PostgreeDatabaseClient(environmentProvider as any);

            await expect(client.close()).resolves.toBeUndefined();
            expect(poolEnd).not.toHaveBeenCalled();
        });

        it('swallows an end() that rejects', async () => {
            poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
            poolEnd.mockRejectedValue(new Error('pool already ended'));
            const client = new PostgreeDatabaseClient(environmentProvider as any);
            await client.selectMany('SELECT 1');

            await expect(client.close()).resolves.toBeUndefined();
        });
    });
});
