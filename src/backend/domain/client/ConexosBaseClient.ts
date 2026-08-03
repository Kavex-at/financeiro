import { inject, injectable, singleton } from 'tsyringe';
import ConexosError from '../errors/ConexosError.js';
import RetryExecutor from '../libs/executor/RetryExecutor.js';

export const LEGACY_CONEXOS_TOKEN = Symbol('LegacyConexosShape');

/**
 * Conexos numeric timestamps are encoded as midnight UTC of the calendar
 * day in BR. Naively parsing them lands on 00:00 UTC, which renders as
 * the previous day in BR (UTC-3). Shifting +15h snaps to 12:00 BRT
 * (15:00 UTC) so the wall-clock day is preserved across any formatter
 * within UTC ± 12h. See `parseDate` for the full rationale.
 */
const BR_NOON_SHIFT_MS = 15 * 60 * 60 * 1000;

export interface Filial {
    filCod: number;
    filDesNome: string;
    filDocFederalFmt: string;
    ufEspSigla?: string;
    filVldStatus?: number;
}

export interface PagedResponse<Row> {
    count: number;
    rows: Row[];
}

/**
 * Shape of the legacy ConexosService (services/conexos.ts) that we depend
 * on. Keeping it as an `interface` rather than a concrete import lets the
 * unit tests inject a mock without hitting the legacy auth/cookie code.
 *
 * v0.2 will replace this adapter with native HTTP calls and ssm-backed
 * auth, at which point services/conexos.ts can be deleted.
 */
export interface LegacyConexosShape {
    ensureSid: () => Promise<void>;
    listGeneric: <T>(
        serviceName: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ) => Promise<T>;
    listGenericPaginated: <Row>(
        serviceName: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ) => Promise<PagedResponse<Row>>;
    /**
     * GET-style passthrough used by `com311/baixas/list`.
     * Returns the raw envelope (Conexos shape varies per endpoint).
     */
    getGeneric: <T>(path: string, opts?: { filCod?: number }) => Promise<T>;
    /**
     * Raw POST passthrough for WRITE endpoints (Fase 3 — baixa/permuta `fin010`).
     * Unlike `listGeneric`, it does NOT unwrap a `.rows` envelope: write endpoints
     * answer a plain object (e.g. `{ borCod }`, `{ bxaCodSeq }`, `{ messages, responseData }`).
     * Same 401-retry + header semantics as the read path (delegates to
     * `conexosService.authenticatedPost`).
     */
    postGeneric: <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ) => Promise<T>;
    /**
     * Single-attempt POST (NO 401 re-login/retry) for the IRREVERSIBLE write
     * (`gravarBaixaPermuta` → `fin010/baixas`). A silent re-POST on 401 could
     * double the baixa; this surfaces the 401 so the reconciliation fails closed.
     */
    postGenericOnce: <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ) => Promise<T>;
    /**
     * Single-attempt PUT (NO 401-retry) for the com300 fiscal read-modify-write
     * (`PUT com300`). The RMW rewrites the whole `finDocFiscal`; a silent re-PUT
     * on 401 could clobber state, so the 401 surfaces (fail-closed).
     */
    putGenericOnce: <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ) => Promise<T>;
    /**
     * Single-attempt MULTIPART upload (NO 401-retry) — para o `carregar` do `.RET`
     * no `fin052` (`arquivosRetorno/carregar`). O `FormData` carrega o arquivo; o
     * re-POST silencioso criaria um arquivo de retorno duplicado (por isso once).
     */
    postMultipartOnce: <T>(path: string, form: FormData, opts?: { filCod?: number }) => Promise<T>;
    /** DELETE passthrough (exclusão de baixa do borderô — Fase 3.1). */
    deleteGeneric: <T>(path: string, opts?: { filCod?: number }) => Promise<T>;
    getFiliais: () => Promise<Filial[]>;
    getFilCodDefault: () => Promise<number | null>;
}

const CHUNK_SIZE = 50;

/**
 * Per-page row limit used when fan-out paginating Conexos list endpoints.
 * Larger than the legacy 100 to keep round-trip count low — the backend
 * found that a single filCod=2 (no priCod filter) returns ~2.5k processes,
 * and a single priCod can have hundreds of PROFORMAs/SolNums.
 */
const PAGE_SIZE = 500;

/**
 * Safety cap on total pages walked by `paginate`. At PAGE_SIZE=500 this
 * caps any single endpoint+filter combo at 25k rows. If a real query ever
 * blows past this, the loop returns what it has and a warning is logged
 * upstream — it does NOT throw, so a single oversize tenant can't take
 * down the whole closing report.
 */
const MAX_PAGES = 50;

/**
 * Split a list into fixed-size chunks. Shared by every family that
 * fan-outs a `priCod#IN` filter across batches (com298/com299/imp*).
 */
export const chunked = <T>(items: readonly T[], size = CHUNK_SIZE): T[][] => {
    if (items.length === 0) return [];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size) as T[]);
    }
    return out;
};

/**
 * Shared infrastructure for every Conexos sub-client: legacy session
 * (login/cookie/sid via the injected `LegacyConexosShape`), the HTTP
 * passthroughs (get/post/delete/list), the `RetryExecutor` (1 retry,
 * 500 ms delay, jitter 200 ms), the pagination walker and the wire
 * coercion helpers (`parseDate` / `parseOptionalNumber` / `isPago`).
 *
 * Sub-clients consume this by composition (`@inject(ConexosBaseClient)`) —
 * the auth/HTTP/pagination behaviour is IDENTICAL to the former monolithic
 * `ConexosClient`; only the public method grouping changed.
 *
 * v0.1 wraps the legacy `ConexosService` exported from `services/conexos.ts`
 * so we don't duplicate the cookie session handling. v0.2 will own the HTTP
 * layer directly.
 */
@singleton()
@injectable()
export default class ConexosBaseClient {
    private retryExecutor: RetryExecutor;
    private legacy: LegacyConexosShape;

    constructor(@inject(LEGACY_CONEXOS_TOKEN) legacy: LegacyConexosShape) {
        this.legacy = legacy;
        this.retryExecutor = new RetryExecutor({
            retries: 2,
            delayMs: 500,
            shouldLog: true,
            jitterMs: 200,
        });
    }

    // ── Legacy session / HTTP passthroughs ──────────────────────────────────
    public ensureSid = (): Promise<void> => this.legacy.ensureSid();

    public getFiliais = (): Promise<Filial[]> => this.legacy.getFiliais();

    public getFilCodDefault = (): Promise<number | null> => this.legacy.getFilCodDefault();

    public getGeneric = <T>(path: string, opts?: { filCod?: number }): Promise<T> =>
        this.legacy.getGeneric<T>(path, opts);

    public postGeneric = <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<T> => this.legacy.postGeneric<T>(path, body, opts);

    /** Single-attempt POST (no 401 retry) — irreversible write only. See `LegacyConexosShape`. */
    public postGenericOnce = <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<T> => this.legacy.postGenericOnce<T>(path, body, opts);

    /** Single-attempt PUT (no 401 retry) — com300 fiscal RMW. See `LegacyConexosShape`. */
    public putGenericOnce = <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<T> => this.legacy.putGenericOnce<T>(path, body, opts);

    /**
     * Single-attempt multipart upload (no 401-retry) — para o `carregar` do `.RET`
     * (`fin052/arquivosRetorno/carregar`). Único caminho de upload de arquivo do stack.
     */
    public postMultipartOnce = <T>(
        path: string,
        form: FormData,
        opts?: { filCod?: number },
    ): Promise<T> => this.legacy.postMultipartOnce<T>(path, form, opts);

    public deleteGeneric = <T>(path: string, opts?: { filCod?: number }): Promise<T> =>
        this.legacy.deleteGeneric<T>(path, opts);

    public listGenericPaginated = <Row>(
        serviceName: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<PagedResponse<Row>> =>
        this.legacy.listGenericPaginated<Row>(serviceName, body, opts);

    /**
     * Runs `fn` inside the shared `RetryExecutor` (same 1-retry/500 ms/jitter
     * policy used by every read path). Sub-clients use this to wrap their
     * retried calls without owning a private executor.
     */
    public runWithRetry = <T>(fn: () => Promise<T>): Promise<T> => this.retryExecutor.execute(fn);

    /**
     * Single `listGeneric` call wrapped in the shared retry + `ensureSid`,
     * surfacing failures as a typed `ConexosError`. Used for non-paginated
     * list endpoints (e.g. `com308/financeiroAPagar/list/{docCod}`).
     */
    public callList = async <T>(
        endpoint: string,
        body: Record<string, unknown>,
        serviceName: string,
        priCodsBatch?: string[],
        opts?: { filCod?: number },
    ): Promise<T> => {
        try {
            return await this.retryExecutor.execute(async () => {
                await this.legacy.ensureSid();
                return this.legacy.listGeneric<T>(serviceName, body, opts);
            });
        } catch (cause) {
            throw new ConexosError({
                endpoint,
                priCod: priCodsBatch?.[0],
                cause,
            });
        }
    };

    /**
     * Walk a Conexos list endpoint until exhausted. Stops when one of:
     *   - server returns < `pageSize` rows (last page reached);
     *   - accumulated rows >= reported `count` (envelope honoured);
     *   - safety cap `MAX_PAGES` reached (logs upstream via accumulator).
     *
     * Each page is wrapped in the same `RetryExecutor` as `callList` so
     * a transient 5xx on page N doesn't kill the whole loop. On any
     * exhausted retry the failure surfaces as `ConexosError` carrying
     * `endpoint` (and the first `priCod` of the batch when applicable).
     */
    public paginate = async <Row>(params: {
        endpoint: string;
        bodyBase: Record<string, unknown>;
        priCodsBatch?: string[];
        opts?: { filCod?: number };
        /**
         * Invoked once with `true` when the loop exits because it hit `MAX_PAGES`
         * (silent truncation) rather than a short/exhausted page. Lets callers
         * emit a `BUSINESS_WARN` cap-hit without leaking pagination internals.
         */
        onCapHit?: () => void;
    }): Promise<Row[]> => {
        const { endpoint, bodyBase, priCodsBatch, opts, onCapHit } = params;
        const accumulated: Row[] = [];
        let expectedTotal: number | undefined;
        let exhausted = false;

        for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
            const body: Record<string, unknown> = {
                ...bodyBase,
                pageNumber,
                pageSize: PAGE_SIZE,
            };

            let page: PagedResponse<Row>;
            try {
                page = await this.retryExecutor.execute(async () => {
                    await this.legacy.ensureSid();
                    // `endpoint` is the URL path (e.g. `imp021/list`); the
                    // adapter prepends `/`. The body-field `serviceName` is
                    // a distinct request payload field and is already inside
                    // `bodyBase` — never use it as the URL.
                    return this.legacy.listGenericPaginated<Row>(endpoint, body, opts);
                });
            } catch (cause) {
                throw new ConexosError({
                    endpoint,
                    priCod: priCodsBatch?.[0],
                    cause,
                });
            }

            accumulated.push(...page.rows);
            if (expectedTotal === undefined && Number.isFinite(page.count)) {
                expectedTotal = page.count;
            }

            const pageWasShort = page.rows.length < PAGE_SIZE;
            const reachedExpected =
                expectedTotal !== undefined && accumulated.length >= expectedTotal;
            if (pageWasShort || reachedExpected) {
                exhausted = true;
                break;
            }
        }

        if (!exhausted) onCapHit?.();
        return accumulated;
    };

    /**
     * Conexos encodes dates as "midnight UTC of the calendar day in BR".
     * A naive `new Date(ms)` lands on 00:00 UTC, which renders as the
     * PREVIOUS day in BR (UTC-3) — bug visible in the portal: "19/01"
     * shows up as "18/01" in our UI.
     *
     * Fix: when the input is a numeric timestamp, shift forward 15h
     * (i.e. snap to 12:00 BRT = 15:00 UTC). Any formatter in UTC ± 12h
     * then reports the same wall-clock day.
     *
     * String inputs (e.g. ISO `'2026-04-15'`) are NOT shifted — they are
     * already anchored at UTC midnight by spec, and shifting would break
     * downstream `toISOString().slice(0,10)` round-trips.
     *
     * Date instances pass through untouched (caller already chose).
     */
    public parseDate = (raw: unknown): Date => {
        if (raw instanceof Date) return raw;
        if (typeof raw === 'number') {
            const d = new Date(raw + BR_NOON_SHIFT_MS);
            if (!Number.isNaN(d.getTime())) return d;
        }
        if (typeof raw === 'string') {
            const d = new Date(raw);
            if (!Number.isNaN(d.getTime())) return d;
        }
        return new Date(0);
    };

    /**
     * Coerce a raw Conexos value to a finite number, returning `undefined`
     * for null/missing/non-numeric values. Used by `listTitulosAPagar`
     * (v0.5 variacao-cambial) for the optional foreign-currency fields:
     * absent fields stay `undefined`, distinguishing "field not requested"
     * from "field is 0".
     */
    public parseOptionalNumber = (raw: unknown): number | undefined => {
        if (raw === null || raw === undefined || raw === '') return undefined;
        const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
        return Number.isFinite(n) ? n : undefined;
    };

    /**
     * Conexos paid-status convention:
     *   - `mnyTitAberto === 0` ⇒ fully paid;
     *   - `pago === 1` (com298/financeiroAPagar/list shape) ⇒ paid;
     *   - fallback to false when neither is present.
     */
    public isPago = (row: Record<string, unknown>): boolean => {
        if (typeof row.mnyTitAberto === 'number') return row.mnyTitAberto === 0;
        if (typeof row.pago === 'number') return row.pago === 1;
        if (typeof row.pago === 'boolean') return row.pago;
        return false;
    };
}
