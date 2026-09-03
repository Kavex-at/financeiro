const poolEnd = jest.fn();

/**
 * Pools criados pelo `buildSessionStoreFromEnv`, na ordem, com acesso aos
 * handlers de `error` — o mock precisa expor o listener porque é exatamente ali
 * que morava o defeito (`() => undefined`, a assinatura do BE-05 repetida).
 */
const createdPools: Array<{ emitError: (err?: Error) => void; query: jest.Mock }> = [];

/**
 * Mock endurecido (card `testability-1`).
 *
 * O mock anterior **mentia sobre estado terminal**: `query` continuava resolvendo depois do
 * `end()`. Foi exatamente por isso que o defeito da rodada 2 — encerrar o pool sem reconstruí-lo —
 * passou verde por 20 minutos. Aqui `query` rejeita como o `pg` real, então a classe inteira de
 * defeito fica coberta **por construção**, e não por convenção de quem escreve o teste.
 */
jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation(() => {
        const errorHandlers: Array<(err: Error) => void> = [];
        let ended = false;
        const pool = {
            query: jest.fn(async () => {
                if (ended) throw new Error('Cannot use a pool after calling end on the pool');
                return { rows: [], rowCount: 0 };
            }),
            on: (event: string, handler: (err: Error) => void) => {
                if (event === 'error') errorHandlers.push(handler);
            },
            end: () => {
                ended = true;
                return poolEnd();
            },
            emitError: (err: Error = new Error('Connection terminated unexpectedly')) => {
                for (const handler of [...errorHandlers]) handler(err);
            },
        };
        createdPools.push(pool);
        return pool;
    }),
}));

import { Pool } from 'pg';
import {
    buildSessionStoreFromEnv,
    closeConexosSessionStorePool,
    getSessionStorePoolStats,
    resetSessionStorePoolEventSink,
    type SessionStorePoolEvent,
    setSessionStorePoolEventSink,
} from './conexosSessionStore.js';

const envWithDb = { databaseConnectionString: 'postgresql://u:p@h:6543/db' } as NodeJS.ProcessEnv;

describe('conexosSessionStore — ciclo de vida do 2º pool (integrability-2, P1)', () => {
    beforeEach(async () => {
        // Drena qualquer pool que o singleton do módulo tenha aberto no import.
        await closeConexosSessionStorePool();
        poolEnd.mockReset();
        poolEnd.mockResolvedValue(undefined);
        createdPools.length = 0;
        // O sink é estado de módulo — sem isto, um teste que o troca contamina os seguintes.
        resetSessionStorePoolEventSink();
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

    // ── availability-2 / fault-tolerance-3 / availability-1 ──────────────────────
    describe('backoff, contador e canal estruturado', () => {
        /**
         * Sem janela mínima, um pooler indisponível faz `openPool()` a CADA chamada, e cada uma
         * paga os 5s de `connectionTimeoutMillis` antes de falhar — o retry vira amplificador.
         */
        it('suppresses a second rebuild inside the minimum window', async () => {
            const store = buildSessionStoreFromEnv(envWithDb);

            createdPools[0].emitError();
            await store.acquire(); // 1ª reconstrução: imediata
            expect(createdPools).toHaveLength(2);

            createdPools[1].emitError();
            await expect(store.acquire()).resolves.toBeNull(); // dentro da janela: suprimida
            expect(createdPools).toHaveLength(2);
        });

        it('rebuilds again once the window has elapsed', async () => {
            const store = buildSessionStoreFromEnv(envWithDb);
            createdPools[0].emitError();
            await store.acquire();
            expect(createdPools).toHaveLength(2);

            createdPools[1].emitError();
            // Avança o relógio para além da janela de 5s.
            const agora = Date.now();
            const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(agora + 6_000);

            await store.acquire();

            expect(createdPools).toHaveLength(3);
            nowSpy.mockRestore();
        });

        it('counts rebuilds so a flapping pool is measurable', async () => {
            const store = buildSessionStoreFromEnv(envWithDb);
            expect(getSessionStorePoolStats().rebuilds).toBe(0);

            createdPools[0].emitError();
            await store.acquire();

            expect(getSessionStorePoolStats().rebuilds).toBe(1);
            expect(getSessionStorePoolStats().fechado).toBe(false);
        });

        it('routes lifecycle events to the injected sink instead of console', async () => {
            const eventos: SessionStorePoolEvent[] = [];
            setSessionStorePoolEventSink((evento) => eventos.push(evento));
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

            const store = buildSessionStoreFromEnv(envWithDb);
            createdPools[0].emitError();
            await store.acquire();
            createdPools[1].emitError();
            await store.acquire(); // suprimida

            expect(eventos.map((e) => e.tipo)).toEqual(['rebuild', 'rebuild', 'rebuild-suprimido']);
            // Os eventos DO POOL saem pelo sink, não pelo console. O `console.warn` que sobra é o
            // do próprio store degradando para "miss" (`acquire failed`), que é outro canal e
            // continua sendo console por design.
            const logged = warn.mock.calls.flat().join('\n');
            expect(logged).not.toContain('pool derrubado por erro de socket');
            expect(logged).not.toContain('reconstrução suprimida');
            warn.mockRestore();
        });

        it('reports the store as closed in the stats after shutdown', async () => {
            buildSessionStoreFromEnv(envWithDb);
            await closeConexosSessionStorePool();

            const stats = getSessionStorePoolStats();
            expect(stats.fechado).toBe(true);
            expect(stats.poolsAbertos).toBe(0);
        });
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
