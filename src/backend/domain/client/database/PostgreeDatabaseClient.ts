import { Pool, type PoolClient } from 'pg';
import { inject, injectable, singleton } from 'tsyringe';
import type IClient from '../../core/client/IClient.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import RetryExecutor from '../../libs/executor/RetryExecutor.js';
import { endPoolQuietly, endPoolQuietlyAsync } from '../../libs/pool/endPoolQuietly.js';
import SqlBuilder from '../../libs/sql/SqlBuilder.js';

/**
 * Verbos que MODIFICAM o banco. Serve para decidir se um statement pode ser
 * repetido depois de a conexão cair — ver `isRepeatableStatement`.
 *
 * Sem a flag `g` de propósito: `RegExp.test` com `g` guarda `lastIndex` entre
 * chamadas e passaria a alternar `true`/`false` para o MESMO statement.
 */
const WRITE_STATEMENT_PATTERN =
    /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|REFRESH|GRANT|REVOKE)\b/;

/**
 * Transaction-scoped query surface handed to `withTransaction(fn)`. Mirrors the
 * parameterized helpers of the pool client, but every call runs on the SAME
 * dedicated `PoolClient` between BEGIN and COMMIT, so the work is atomic.
 */
export interface TransactionClient {
    selectMany: (query: string, params?: Record<string, unknown>) => Promise<any[]>;
    selectFirst: <T>(query: string, params?: Record<string, unknown>) => Promise<T | null>;
    insert: (query: string, params?: Record<string, unknown>) => Promise<number>;
    update: (query: string, params?: Record<string, unknown>) => Promise<number>;
}

@singleton()
@injectable()
export default class PostgreeDatabaseClient implements IClient {
    // ≥3 (P0-6): allows the eleicao trigger to hold a transaction/advisory lock
    // while `/painel` (read) and a second concurrent request still get a
    // connection instead of starving on a max=1 pool.
    private readonly poolMaxConnections = 5;
    private readonly poolIdleTimeoutMillis = 10000;
    private readonly poolConnectionTimeoutMillis = 5000;
    private readonly sqlBuilder = new SqlBuilder();
    /**
     * Recusa do POOLER na hora de abrir a sessão. O statement comprovadamente
     * não chegou ao Postgres — não há efeito para duplicar, então retentar é
     * seguro para QUALQUER statement, inclusive escrita não-idempotente.
     */
    private readonly connectionRefusedPatterns = ['MaxClientsInSessionMode', 'too many clients'];

    /**
     * Socket derrubado com o statement EM VOO. O `COMMIT` pode ter acontecido no
     * servidor e só a RESPOSTA ter se perdido — o cliente não tem como
     * distinguir. Retentar um `INSERT` não-idempotente aqui grava a linha DUAS
     * vezes (linha de auditoria, de razão, de execução de job duplicadas).
     * Por isso só retentamos quando o statement é repetível.
     */
    private readonly droppedConnectionPatterns = ['Connection terminated', 'ECONNRESET'];

    /**
     * Statements repetíveis (leitura, ou escrita idempotente via `ON CONFLICT`):
     * retentam nos dois tipos de falha de conexão.
     */
    private readonly repeatableQueryRetryExecutor = new RetryExecutor({
        retries: 3,
        delayMs: 200,
        jitterMs: 200,
        shouldLog: true,
        shouldRetry: (error) =>
            this.isConnectionRefusedError(error) || this.isDroppedConnectionError(error),
    });

    /**
     * Escrita NÃO idempotente: retenta apenas quando a conexão foi recusada
     * ANTES de executar. Conexão caída no meio vira erro para o chamador — que
     * é o desfecho certo: melhor uma falha visível que uma linha duplicada em
     * silêncio.
     */
    private readonly nonRepeatableQueryRetryExecutor = new RetryExecutor({
        retries: 3,
        delayMs: 200,
        jitterMs: 200,
        shouldLog: true,
        shouldRetry: (error) => this.isConnectionRefusedError(error),
    });

    private connectionPool?: Pool;

    constructor(
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
    ) {}

    public init = async (): Promise<void> => {
        if (this.connectionPool) return;

        const retryExecutor = new RetryExecutor({
            retries: 5,
            delayMs: 2000,
            shouldLog: true,
        });

        await retryExecutor.execute(async () => {
            const envVars = await this.environmentProvider.getEnvironmentVars();
            const pool = new Pool({
                connectionString: envVars.databaseConnectionString,
                idleTimeoutMillis: this.poolIdleTimeoutMillis,
                connectionTimeoutMillis: this.poolConnectionTimeoutMillis,
                max: this.poolMaxConnections,
            });
            this.connectionPool = pool;

            // Descarta o pool quebrado E ENCERRA suas conexões. Zerar apenas a
            // referência (como era antes) devolvia o pool ao GC ainda segurando
            // até `poolMaxConnections` sessões no Supabase, e a `init()` seguinte
            // abria mais 5. O laço se fecha porque `'too many clients'` e
            // `'MaxClientsInSessionMode'` estão entre os erros que este cliente
            // trata como transitórios: o handler que existia para recuperar do
            // esgotamento de conexões era justamente o que o acelerava.
            //
            // `pool` fica capturado em const porque o evento `error` dispara uma
            // vez por cliente ocioso derrubado — sem a comparação abaixo, o
            // segundo disparo zeraria uma referência que já aponta para o pool
            // NOVO criado por uma `init()` no meio do caminho.
            let ended = false;
            pool.on('error', (_err) => {
                if (!ended) {
                    ended = true;
                    endPoolQuietly(pool);
                }
                if (this.connectionPool === pool) this.connectionPool = undefined;
            });
        });
    };

    /**
     * Encerra o pool e devolve as conexões ao Postgres. Idempotente e seguro sem
     * `init()` prévia. Usado pelo shutdown gracioso (SIGTERM/SIGINT) para que um
     * deploy não deixe sessões penduradas no pooler até o timeout do servidor.
     */
    public close = async (): Promise<void> => {
        const pool = this.connectionPool;
        if (!pool) return;

        // Zera ANTES do await: uma segunda chamada concorrente não deve esperar
        // pelo mesmo `end()` nem disparar um segundo.
        this.connectionPool = undefined;
        await endPoolQuietlyAsync(pool);
    };

    public selectMany = async (query: string, params?: Record<string, unknown>): Promise<any[]> => {
        return (await this.query(query, params)).rows;
    };

    public selectFirst = async <T>(
        query: string,
        params?: Record<string, unknown>,
    ): Promise<T | null> => {
        const rows = await this.selectMany(query, params);
        return (rows[0] as T) ?? null;
    };

    public update = async (query: string, params?: Record<string, unknown>): Promise<number> => {
        return (await this.query(query, params)).rowCount ?? 0;
    };

    public insert = async (query: string, params?: Record<string, unknown>): Promise<number> => {
        return (await this.query(query, params)).rowCount ?? 0;
    };

    /**
     * Runs `fn` inside a single atomic transaction on a dedicated pooled client
     * (BEGIN → fn → COMMIT, or ROLLBACK + rethrow on any failure). The client is
     * always returned to the pool. Parameterized helpers (`$name` via
     * SqlBuilder) are exposed on the `TransactionClient` — all bound to the SAME
     * session so the work commits or aborts together (Rule #5, atomicity P0-5).
     */
    public withTransaction = async <T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> => {
        await this.init();
        if (!this.connectionPool) throw new Error('Database connection pool not initialized');

        const client = await this.connectionPool.connect();
        const tx = this.buildTransactionClient(client);
        try {
            await client.query('BEGIN');
            const result = await fn(tx);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Swallow rollback failure — surface the ORIGINAL error below.
            }
            throw error;
        } finally {
            client.release();
        }
    };

    /**
     * Session-level advisory lock (P0-6). Returns `true` if acquired, `false` if
     * another session already holds it — never blocks. Used to serialize the
     * eleicao fan-out per `Idempotency-Key`: a concurrent duplicate fails to
     * acquire and short-circuits to the existing run instead of double-firing.
     *
     * NOTE: a session-level lock is held by the SESSION that acquired it. Because
     * the pooler may route a later `pg_advisory_unlock` to a different backend, we
     * acquire AND release the lock on the SAME dedicated pooled client (see
     * `withAdvisoryLock`). The raw `tryAdvisoryLock`/`advisoryUnlock` here run on
     * the shared pool and are kept for callers that manage their own client.
     */
    public withAdvisoryLock = async <T>(
        lockKey: number,
        onAcquired: () => Promise<T>,
        onBusy: () => Promise<T>,
    ): Promise<T> => {
        await this.init();
        if (!this.connectionPool) throw new Error('Database connection pool not initialized');

        const client = await this.connectionPool.connect();
        try {
            const res = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockKey]);
            const acquired = res.rows[0]?.locked === true;
            if (!acquired) return onBusy();
            try {
                return await onAcquired();
            } finally {
                await client.query('SELECT pg_advisory_unlock($1)', [lockKey]);
            }
        } finally {
            client.release();
        }
    };

    private buildTransactionClient = (client: PoolClient): TransactionClient => {
        const run = async (rawQuery: string, rawParams?: Record<string, unknown>): Promise<any> => {
            const { query, params } = rawParams
                ? this.sqlBuilder.build(rawQuery, rawParams)
                : { query: rawQuery, params: undefined };
            if (params) return client.query(query, params as any[]);
            return client.query(query);
        };
        return {
            selectMany: async (query, params) => (await run(query, params)).rows,
            selectFirst: async <T>(query: string, params?: Record<string, unknown>) =>
                ((await run(query, params)).rows[0] as T) ?? null,
            insert: async (query, params) => (await run(query, params)).rowCount ?? 0,
            update: async (query, params) => (await run(query, params)).rowCount ?? 0,
        };
    };

    /**
     * Executes a parameterized query against the pool.
     *
     * IMPORTANT (transaction-mode pooler compatibility): never call
     * `pool.query({ name: '...', text, values })`. Named prepared statements are
     * session-scoped, but Supavisor transaction mode may route each transaction
     * to a different Postgres session, which would throw
     * `prepared statement "X" does not exist`. Always pass query as a string
     * (optionally via SqlBuilder for named params like `$name`).
     */
    private query = async (rawQuery: string, rawParams?: Record<string, unknown>): Promise<any> => {
        const { query, params } = rawParams
            ? this.sqlBuilder.build(rawQuery, rawParams)
            : { query: rawQuery, params: undefined };

        // A política de retentativa é decidida pelo TEXTO do statement, e não
        // pelo método que o chamou: `insert`/`update` também carregam upserts
        // `ON CONFLICT`, que são repetíveis, e um `WITH ... AS (UPDATE ...)`
        // chega aqui por `selectMany` sem deixar de ser escrita.
        const executor = this.isRepeatableStatement(query)
            ? this.repeatableQueryRetryExecutor
            : this.nonRepeatableQueryRetryExecutor;

        return executor.execute(async () => {
            // O pool é reobtido a CADA tentativa, e não congelado fora do retry
            // como antes. Agora que o handler de `error` ENCERRA o pool quebrado,
            // uma retentativa contra a referência congelada bateria em
            // `Cannot use a pool after calling end on the pool` — trocaria um erro
            // recuperável por um fatal. Com a `init()` aqui dentro, a tentativa
            // seguinte pega o pool novo, que é justamente o desfecho que o retry
            // de `'too many clients'`/`'Connection terminated'` existe para obter.
            await this.init();
            const pool = this.connectionPool;
            if (!pool) throw new Error('Database connection pool not initialized');

            if (params) {
                return pool.query(query, params as any[]);
            }
            return pool.query(query);
        });
    };

    /**
     * Um statement é repetível quando reexecutá-lo deixa o banco no MESMO
     * estado: leitura pura, ou escrita com `ON CONFLICT` (o upsert converge).
     * Todo o resto — `INSERT` simples, `UPDATE`, `DELETE`, DDL — não é.
     *
     * Literais e comentários são removidos antes da checagem para que
     * `SELECT ... WHERE motivo = 'DELETE'` não passe por escrita. O erro da
     * heurística cai sempre para o lado seguro: classificar leitura como
     * escrita custa uma retentativa; o contrário custaria uma linha duplicada.
     */
    private isRepeatableStatement = (query: string): boolean => {
        const normalized = query
            .replace(/--[^\n]*/g, ' ')
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/'(?:[^']|'')*'/g, ' ')
            .toUpperCase();

        if (!WRITE_STATEMENT_PATTERN.test(normalized)) return true;
        return /\bON\s+CONFLICT\b/.test(normalized);
    };

    private isConnectionRefusedError = (error: unknown): boolean =>
        this.matchesPattern(error, this.connectionRefusedPatterns);

    private isDroppedConnectionError = (error: unknown): boolean =>
        this.matchesPattern(error, this.droppedConnectionPatterns);

    private matchesPattern = (error: unknown, patterns: readonly string[]): boolean => {
        const message = error instanceof Error ? error.message : String(error);
        return patterns.some((pattern) => message.includes(pattern));
    };
}
