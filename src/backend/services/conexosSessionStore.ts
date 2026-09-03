import { Pool } from 'pg';
import { boxLog, DEBUG_VERBOSE } from '../utils/index.js';
import type { Filial } from './conexos.js';

/**
 * Shared Conexos session store backed by Postgres (portado do
 * fechamento-processos — Task 10 / CC-3).
 *
 * Problema: cada processo (Render prod, dev servers, scripts/validators) rodava
 * seu próprio `POST /login`, brigando pelos ~3 slots de MAX_SESSIONS da conta
 * Conexos e disparando kill-oldest em cascata.
 *
 * Solução: UMA linha em `conexos_sessions` guarda o `sid` compartilhado atual.
 * Os processos a adquirem antes de logar; após um login fresco, persistem com
 * CONCORRÊNCIA OTIMISTA (update-if-version-unchanged / insert-on-absent) — o
 * perdedor de uma corrida de login re-lê e adota o sid do vencedor em vez de
 * manter uma sessão concorrente.
 *
 * Degradação graciosa: quando `databaseConnectionString` está ausente (dev local
 * sem banco) o store é DESABILITADO e o `ConexosService` se comporta exatamente
 * como antes (login por processo). Qualquer erro do banco degrada para "miss" —
 * o store NUNCA pode derrubar a integração com o Conexos.
 *
 * Convenção: módulo legacy em `services/` lê `process.env` direto, como
 * `services/conexos.ts`.
 */

/** Chave lógica padrão — a sessão do ROBÔ (acesso compartilhado). Cada usuário
 * com vínculo Conexos usa a sua própria chave (`columbia:user:<login>`). */
const SESSION_KEY = 'columbia-default';
const TABLE = 'conexos_sessions';

export interface ConexosSessionRecord {
    sid: string;
    usnCod: string | null;
    expiresAt: number;
    version: number;
    loginPayload: { filiais?: Filial[]; filCodDefault?: number | null } | null;
}

export interface PersistInput {
    sid: string;
    usnCod: string | null;
    expiresAt: number;
    loginPayload?: { filiais?: Filial[]; filCodDefault?: number | null };
    /** Version lida no último acquire; null/undefined ⇒ espera INSERT. */
    expectedVersion?: number | null;
}

export type PersistResult =
    | { outcome: 'won'; version: number }
    | { outcome: 'lost'; current: ConexosSessionRecord | null }
    | { outcome: 'disabled' };

/**
 * Superfície mínima de banco consumida pelo store — permite injetar um mock nos
 * testes sem subir um Pool real do `pg`. `query` segue a assinatura do
 * `pg.Pool.query(text, params)` (protocolo simples, sem prepared statements
 * nomeados — compatível com o pooler em modo transação).
 */
export interface SessionStoreDb {
    query: (
        sql: string,
        params?: unknown[],
    ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

const SELECT_COLUMNS = 'sid, usn_cod, expires_at, version, login_payload';

const toRecord = (row: Record<string, unknown> | undefined): ConexosSessionRecord | null => {
    if (!row || typeof row.sid !== 'string') return null;
    const expiresAtMs = Date.parse(String(row.expires_at ?? ''));
    if (!Number.isFinite(expiresAtMs)) return null;
    return {
        sid: row.sid,
        usnCod: row.usn_cod != null ? String(row.usn_cod) : null,
        expiresAt: expiresAtMs,
        version: Number(row.version ?? 0),
        loginPayload:
            row.login_payload && typeof row.login_payload === 'object'
                ? (row.login_payload as ConexosSessionRecord['loginPayload'])
                : null,
    };
};

export class ConexosSessionStore {
    private db: SessionStoreDb | null;
    private holder: string;
    /** Chave lógica desta instância (uma linha por conta/usuário Conexos). */
    private key: string;

    constructor(deps: { db?: SessionStoreDb | null; holder?: string; key?: string } = {}) {
        this.db = deps.db ?? null;
        this.holder = deps.holder ?? `pid:${process.pid}`;
        this.key = deps.key ?? SESSION_KEY;
    }

    get enabled(): boolean {
        return this.db !== null;
    }

    /**
     * Deriva um store para OUTRA chave lógica compartilhando o MESMO pool de
     * banco (sem abrir um novo Pool por usuário). Usado pelo registry de sessões
     * para dar a cada usuário Conexos vinculado a sua própria linha de sessão.
     */
    public withKey(key: string): ConexosSessionStore {
        return new ConexosSessionStore({ db: this.db, holder: this.holder, key });
    }

    /**
     * Lê a linha de sessão compartilhada. Retorna null em miss, store desabilitado
     * ou QUALQUER erro de banco (degrada para login por processo — nunca lança).
     */
    public async acquire(): Promise<ConexosSessionRecord | null> {
        if (!this.db) return null;
        try {
            const { rows } = await this.db.query(
                `SELECT ${SELECT_COLUMNS} FROM ${TABLE} WHERE key = $1`,
                [this.key],
            );
            return toRecord(rows[0]);
        } catch (cause) {
            this.warn('acquire failed', cause);
            return null;
        }
    }

    /**
     * Persiste um sid recém-logado com concorrência otimista:
     *   - `expectedVersion` null ⇒ INSERT (linha ausente no acquire); uma colisão
     *     de chave única significa que outro processo venceu a corrida ⇒ `lost` + re-leitura;
     *   - caso contrário UPDATE ... WHERE key AND version = expectedVersion; zero
     *     linhas atualizadas ⇒ outro processo rotacionou o sid antes ⇒ `lost`.
     *
     * Em `lost`, o chamador DEVE adotar `current.sid` (sessão do vencedor) para
     * que dois processos nunca mantenham dois logins concorrentes.
     */
    public async persist(input: PersistInput): Promise<PersistResult> {
        if (!this.db) return { outcome: 'disabled' };
        const expiresAtIso = new Date(input.expiresAt).toISOString();
        const loginPayload = input.loginPayload != null ? JSON.stringify(input.loginPayload) : null;
        const updatedAtIso = new Date().toISOString();
        try {
            if (input.expectedVersion == null) {
                const { rows } = await this.db.query(
                    `INSERT INTO ${TABLE} (key, sid, usn_cod, expires_at, login_payload, version, holder, updated_at)
                     VALUES ($1, $2, $3, $4, $5, 1, $6, $7)
                     ON CONFLICT (key) DO NOTHING
                     RETURNING version`,
                    [
                        this.key,
                        input.sid,
                        input.usnCod,
                        expiresAtIso,
                        loginPayload,
                        this.holder,
                        updatedAtIso,
                    ],
                );
                if (rows.length === 0) {
                    // Conflito: outro processo inseriu primeiro — re-lê e entrega o vencedor.
                    return { outcome: 'lost', current: await this.acquire() };
                }
                return { outcome: 'won', version: Number(rows[0]?.version ?? 1) };
            }
            const nextVersion = input.expectedVersion + 1;
            const { rowCount } = await this.db.query(
                `UPDATE ${TABLE}
                 SET sid = $2, usn_cod = $3, expires_at = $4, login_payload = $5,
                     version = $6, holder = $7, updated_at = $8
                 WHERE key = $1 AND version = $9`,
                [
                    this.key,
                    input.sid,
                    input.usnCod,
                    expiresAtIso,
                    loginPayload,
                    nextVersion,
                    this.holder,
                    updatedAtIso,
                    input.expectedVersion,
                ],
            );
            if (!rowCount) {
                // CAS miss: outro processo rotacionou o sid no meio.
                return { outcome: 'lost', current: await this.acquire() };
            }
            return { outcome: 'won', version: nextVersion };
        } catch (cause) {
            this.warn('persist threw', cause);
            return { outcome: 'lost', current: null };
        }
    }

    /**
     * Deleta a linha compartilhada CONDICIONALMENTE — só quando ela ainda contém
     * o `deadSid` dado, para que um sid fresco persistido por outro processo nunca
     * seja apagado. Usado no caminho de 401 antes do re-login.
     */
    public async invalidate(deadSid: string): Promise<void> {
        if (!this.db) return;
        try {
            await this.db.query(`DELETE FROM ${TABLE} WHERE key = $1 AND sid = $2`, [
                this.key,
                deadSid,
            ]);
        } catch (cause) {
            this.warn('invalidate threw', cause);
        }
    }

    private warn(message: string, cause: unknown): void {
        // Problemas do store devem ser visíveis mas NUNCA fatais.
        const detail = cause instanceof Error ? cause.message : JSON.stringify(cause);
        console.warn(`[ConexosSessionStore] ${message}: ${detail}`);
        if (DEBUG_VERBOSE) boxLog('ConexosSessionStore warn', { message, detail });
    }
}

/**
 * Monta o store a partir do ambiente. Desabilitado (db null) quando
 * `databaseConnectionString` está ausente — dev local sem banco mantém o
 * comportamento anterior (login por processo). Uma falha de construção do Pool
 * TAMBÉM degrada para desabilitado (o store nunca pode derrubar o backend no
 * boot). Pool dedicado e pequeno (max 2): só é tocado no fluxo de login.
 */
const openPools = new Set<Pool>();

/**
 * Encerra o pool do session store no shutdown gracioso. Idempotente e no-op
 * quando o store nasceu desabilitado (sem `databaseConnectionString`).
 *
 * Existe porque este é o SEGUNDO pool Postgres do processo: o
 * `PostgreeDatabaseClient` já era fechado no SIGTERM, este não era, e cada deploy
 * deixava até 2 sessões penduradas no pooler até o `idleTimeoutMillis`.
 */
export const closeConexosSessionStorePool = async (): Promise<void> => {
    const pools = [...openPools];
    openPools.clear();
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
};

export const buildSessionStoreFromEnv = (
    env: NodeJS.ProcessEnv = process.env,
): ConexosSessionStore => {
    const connectionString = env.databaseConnectionString;
    if (!connectionString) {
        if (DEBUG_VERBOSE) {
            boxLog('ConexosSessionStore', {
                enabled: false,
                reason: 'databaseConnectionString ausente',
            });
        }
        return new ConexosSessionStore({ db: null });
    }
    try {
        const pool = new Pool({
            connectionString,
            max: 2,
            idleTimeoutMillis: 10000,
            connectionTimeoutMillis: 5000,
        });
        openPools.add(pool);
        // Um Pool sem listener de 'error' derruba o processo num erro de socket
        // ocioso. Mantém o store resiliente (mesma defesa do PostgreeDatabaseClient).
        //
        // O handler ENCERRA o pool, não só engole o erro. `() => undefined` era a
        // assinatura exata do BE-05 repetida aqui: o pool quebrado seguia segurando
        // até 2 sessões no pooler, sem ninguém para liberá-las (Regis-Review,
        // card `integrability-2` — único P1 do run). Guarda de reentrada porque o
        // evento dispara uma vez por cliente ocioso derrubado.
        let ended = false;
        pool.on('error', () => {
            if (ended) return;
            ended = true;
            openPools.delete(pool);
            // `end()` de um pool já quebrado rejeita; um throw aqui derrubaria o
            // processo por unhandled rejection.
            void pool.end().catch(() => undefined);
        });
        const db: SessionStoreDb = {
            query: (sql, params) => pool.query(sql, params as unknown[] | undefined),
        };
        return new ConexosSessionStore({ db });
    } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        console.warn(
            `[ConexosSessionStore] construção do Pool falhou — store desabilitado: ${detail}`,
        );
        return new ConexosSessionStore({ db: null });
    }
};

/** Singleton consumido pelo `services/conexos.ts` (e, portanto, por todo script). */
export const conexosSessionStore = buildSessionStoreFromEnv();
