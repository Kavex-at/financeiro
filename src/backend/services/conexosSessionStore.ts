import { Pool } from 'pg';
import { endPoolQuietly, endPoolQuietlyAsync } from '../domain/libs/pool/endPoolQuietly.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
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
        //
        // Redigido (card `security-3`): quem chega aqui é erro de query do `pg`, que traz usuário
        // do Postgres e host interno na mensagem — e o `JSON.stringify` de um não-Error pode
        // arrastar um objeto de conexão inteiro. Terceiro e último sítio de log deste arquivo a
        // ganhar o redator; não sobra assimetria.
        const detail = cause instanceof Error ? cause.message : JSON.stringify(cause);
        const safe = redactErrorMessage(detail);
        console.warn(`[ConexosSessionStore] ${message}: ${safe}`);
        if (DEBUG_VERBOSE) boxLog('ConexosSessionStore warn', { message, detail: safe });
    }
}

/**
 * Monta o store a partir do ambiente. Desabilitado (db null) quando
 * `databaseConnectionString` está ausente — dev local sem banco mantém o
 * comportamento anterior (login por processo). Uma falha de construção do Pool
 * TAMBÉM degrada para desabilitado (o store nunca pode derrubar o backend no
 * boot). Pool dedicado e pequeno (max 2): só é tocado no fluxo de login.
 */
/** Slot do pool corrente de um store. Vazio ⇒ a próxima chamada reconstrói. */
interface PoolHolder {
    pool?: Pool;
}

/**
 * Evento do ciclo de vida do pool, já com a mensagem redigida.
 *
 * O `console.warn` do rebuild ficava fora do canal estruturado enquanto o force-exit do shutdown,
 * no mesmo delta, ia para o `LogService` — assimetria real: shutdown estourado aparecia no
 * `/operacao`, pool flapando não (card `availability-1`). Um pooler que reinicia clientes ociosos
 * a cada 30s produziria dezenas de rebuilds por hora afogados no drain de logs do Render.
 *
 * O sink é injetado de fora para este módulo legado não conhecer o container (o `index.ts` o
 * amarra no `LogService`). Default = `console.warn`, para que job e script sigam funcionando.
 */
export interface SessionStorePoolEvent {
    tipo: 'rebuild' | 'construcao-falhou' | 'rebuild-suprimido';
    mensagem: string;
    rebuildsTotal: number;
}

type PoolEventSink = (evento: SessionStorePoolEvent) => void;

const defaultSink: PoolEventSink = (evento) =>
    console.warn(`[ConexosSessionStore] ${evento.mensagem}`);

let poolEventSink: PoolEventSink = defaultSink;

/** Amarra os eventos do pool a um canal estruturado. Ver `index.ts`. */
export const setSessionStorePoolEventSink = (sink: PoolEventSink): void => {
    poolEventSink = sink;
};

/** Volta ao `console.warn`. Usado por teste e por quem quiser desamarrar o canal. */
export const resetSessionStorePoolEventSink = (): void => {
    poolEventSink = defaultSink;
};

/**
 * Intervalo mínimo entre reconstruções (card `availability-2`).
 *
 * Sem teto, um pooler indisponível faz `openPool()` a CADA chamada, e cada uma paga os 5s de
 * `connectionTimeoutMillis` antes de falhar — o retry vira amplificador. Com a janela, a primeira
 * reconstrução é imediata (o caso comum, socket ocioso isolado) e as seguintes esperam.
 */
const MIN_REBUILD_INTERVAL_MS = 5_000;

const openPools = new Set<Pool>();
const poolHolders = new Set<PoolHolder>();
/** Trava a reconstrução preguiçosa depois do shutdown. */
let storeClosed = false;
let rebuildsTotal = 0;
let ultimoRebuildEm = 0;

/**
 * Contadores do ciclo de vida do pool (card `fault-tolerance-3`). Sem isto, o único sinal de que
 * a frota inteira caiu em "miss" era `console.warn` no stdout.
 */
export const getSessionStorePoolStats = (): {
    rebuilds: number;
    poolsAbertos: number;
    fechado: boolean;
} => ({ rebuilds: rebuildsTotal, poolsAbertos: openPools.size, fechado: storeClosed });

/**
 * Encerra o pool do session store no shutdown gracioso. Idempotente e no-op
 * quando o store nasceu desabilitado (sem `databaseConnectionString`).
 *
 * Existe porque este é o SEGUNDO pool Postgres do processo: o
 * `PostgreeDatabaseClient` já era fechado no SIGTERM, este não era, e cada deploy
 * deixava até 2 sessões penduradas no pooler até o `idleTimeoutMillis`.
 */
export const closeConexosSessionStorePool = async (): Promise<void> => {
    storeClosed = true;
    const pools = [...openPools];
    openPools.clear();
    // Esvaziar os holders impede que uma query em voo reabra um pool enquanto o
    // processo desce — o `storeClosed` é o que segura a reconstrução preguiçosa.
    // O `clear()` importa: sem ele o Set cresce a cada `buildSessionStoreFromEnv`
    // e nunca encolhe, o que é inócuo hoje mas vira armadilha no dia em que
    // alguém iterar `poolHolders` com semântica (sonda de readiness, métrica).
    for (const holder of poolHolders) holder.pool = undefined;
    poolHolders.clear();
    await Promise.all(pools.map((pool) => endPoolQuietlyAsync(pool)));
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
        // Reset do estado de módulo: construir um store novo significa que não estamos mais no
        // caminho de shutdown. Em produção a factory roda UMA vez (singleton no import); a
        // reinvocação só existe em teste. Ver `fault-tolerance-1`.
        storeClosed = false;
        ultimoRebuildEm = 0;
        rebuildsTotal = 0;
        const holder: PoolHolder = {};
        poolHolders.add(holder);

        /**
         * Abre o pool e arma o handler de `error`.
         *
         * O listener existe para o processo NÃO cair num erro de socket ocioso —
         * essa propriedade é preservada. O que muda em relação ao `() => undefined`
         * original são duas coisas:
         *
         * 1. O pool quebrado é **encerrado e esquecido**, para o holder reconstruí-lo
         *    na próxima chamada. Encerrar sem reconstruir seria pior que engolir:
         *    `db.query` fecharia sobre um pool morto e o store degradaria em silêncio
         *    até o processo terminar. Encerrar + reconstruir preserva a resiliência e
         *    devolve as conexões.
         * 2. O erro deixa de ser invisível. `console.warn` redigido — barulho mínimo,
         *    mas rastro existente. Nada de `throw`: derrubaria o backend.
         */
        const openPool = (): Pool => {
            const pool = new Pool({
                connectionString,
                max: 2,
                idleTimeoutMillis: 10000,
                connectionTimeoutMillis: 5000,
            });
            openPools.add(pool);
            // Guarda de reentrada: o evento dispara uma vez por cliente ocioso
            // derrubado, e sem ela o segundo disparo mataria o pool já reconstruído.
            let ended = false;
            pool.on('error', (cause: unknown) => {
                if (ended) return;
                ended = true;
                openPools.delete(pool);
                const detail = cause instanceof Error ? cause.message : String(cause);
                poolEventSink({
                    tipo: 'rebuild',
                    mensagem: `pool derrubado por erro de socket — reconstruído na próxima chamada: ${redactErrorMessage(detail)}`,
                    rebuildsTotal,
                });
                endPoolQuietly(pool);
                if (holder.pool === pool) holder.pool = undefined;
            });
            holder.pool = pool;
            return pool;
        };

        /**
         * Reconstrução preguiçosa, com janela mínima entre tentativas.
         *
         * Devolve `undefined` quando não deve reconstruir — depois do shutdown (reabrir conexões
         * enquanto o processo desce anularia o drain) ou dentro da janela de espera. Nos dois
         * casos a query falha e o store degrada para "miss", que é o contrato dele em qualquer
         * erro.
         */
        const reconstruirPool = (): Pool | undefined => {
            if (storeClosed) return undefined;
            const agora = Date.now();
            if (ultimoRebuildEm !== 0 && agora - ultimoRebuildEm < MIN_REBUILD_INTERVAL_MS) {
                poolEventSink({
                    tipo: 'rebuild-suprimido',
                    mensagem: `reconstrução suprimida — menos de ${MIN_REBUILD_INTERVAL_MS}ms desde a anterior`,
                    rebuildsTotal,
                });
                return undefined;
            }
            ultimoRebuildEm = agora;
            rebuildsTotal += 1;
            return openPool();
        };

        openPool();
        const db: SessionStoreDb = {
            query: (sql, params) => {
                const pool = holder.pool ?? reconstruirPool();
                if (!pool) throw new Error('ConexosSessionStore: pool indisponível');
                return pool.query(sql, params as unknown[] | undefined);
            },
        };
        return new ConexosSessionStore({ db });
    } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        // Redigido como os outros dois sítios de log deste arquivo. Este é o MAIS perigoso:
        // quem lança aqui é o parser da connection string, e ele põe a URL de entrada — com a
        // senha — dentro da mensagem. O drain de logs do Render sai do perímetro do processo.
        poolEventSink({
            tipo: 'construcao-falhou',
            mensagem: `construção do Pool falhou — store desabilitado: ${redactErrorMessage(detail)}`,
            rebuildsTotal,
        });
        return new ConexosSessionStore({ db: null });
    }
};

/** Singleton consumido pelo `services/conexos.ts` (e, portanto, por todo script). */
export const conexosSessionStore = buildSessionStoreFromEnv();
