import axios, { type AxiosInstance } from 'axios';
import { boxLog, DEBUG_VERBOSE } from '../utils/index.js';
import { config } from '../config.js';
import MissingFilCodError from '../domain/errors/MissingFilCodError.js';
import {
    type ConexosSessionStore,
    conexosSessionStore,
    type ConexosSessionRecord,
} from './conexosSessionStore.js';

export interface Filial {
    filCod: number;
    filDesNome: string;
    filDocFederalFmt: string;
    ufEspSigla?: string;
    filVldStatus?: number;
}

/** Keys whose values must never reach the logs in plain text. */
const SENSITIVE_KEYS = [
    'password',
    'senha',
    'pwd',
    'secret',
    'token',
    'authorization',
    'sid',
    'username',
    'usuario',
];

const REDACTED = '<REDACTED>';

/**
 * TTL mínimo restante para um sid vindo do store compartilhado (CC-3) valer a
 * adoção — adotar um sid prestes a expirar só trocaria um login por outro no
 * meio de uma request.
 */
const STORE_SID_MIN_TTL_MS = 60_000;

const isSensitiveKey = (key: string): boolean => SENSITIVE_KEYS.includes(key.toLowerCase());

/**
 * Returns a log-safe copy of an HTTP request body with the values of any
 * sensitive keys (`password`, `username`, `token`, …) replaced by
 * `'<REDACTED>'`. Accepts either an object or a JSON string; non-JSON
 * strings and non-sensitive payloads are returned unchanged.
 *
 * arch-review card `security-2` / finding `F-security-4`: the Conexos
 * `/login` request body carries the production ERP password — it must
 * never be logged in clear text.
 */
export const redactSensitive = (body: unknown): string => {
    const redactValue = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(redactValue);
        if (value !== null && typeof value === 'object') {
            const out: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(value)) {
                out[key] = isSensitiveKey(key) ? REDACTED : redactValue(val);
            }
            return out;
        }
        return value;
    };

    if (typeof body === 'string') {
        try {
            return JSON.stringify(redactValue(JSON.parse(body)));
        } catch {
            // Not JSON — return as-is; nothing structured to redact.
            return body;
        }
    }
    return JSON.stringify(redactValue(body));
};

/**
 * Credenciais + store de uma sessão Conexos. Sem `opts`, usa o ROBÔ
 * (`CONEXOS_USERNAME/PASSWORD` do env + o store compartilhado default) — o
 * comportamento histórico. O registry de sessões (Fatia B) instancia uma
 * ConexosService POR usuário vinculado, passando as credenciais dele + um store
 * derivado com a chave `columbia:user:<login>`.
 */
export interface ConexosServiceOptions {
    username?: string;
    password?: string;
    baseUrl?: string;
    sessionStore?: ConexosSessionStore;
}

export class ConexosService {
    private sid: string | null = null;
    private sidExpiresAt: number | null = null;
    private client: AxiosInstance;
    private filiais: Filial[] = [];
    private filCodDefault: number | null = null;
    /** `usnCod` captured from `/login` response — single source of truth for `cnx-usncod`. */
    private usnCod: string | null = null;
    /** Mutex de login: evita logins paralelos em requests concorrentes
     * (sem ele, 2+ chamadas simultâneas a `login()` disparam 2+ POST /login
     * → o segundo retorna LOGIN_ERROR_MAX_SESSIONS). */
    private loginPromise: Promise<void> | null = null;
    /** Version da linha do store compartilhado lida no último acquire (CC-3) —
     * base do update-if-unchanged em `persistSessionToStore`. */
    private storeVersion: number | null = null;
    /** Credenciais desta sessão (robô por default; usuário vinculado no registry). */
    private username: string | undefined;
    private password: string | undefined;
    /** Store desta sessão (linha própria por chave). Default = store do robô. */
    private sessionStore: ConexosSessionStore;

    constructor(opts: ConexosServiceOptions = {}) {
        this.username = opts.username ?? process.env.CONEXOS_USERNAME;
        this.password = opts.password ?? process.env.CONEXOS_PASSWORD;
        this.sessionStore = opts.sessionStore ?? conexosSessionStore;
        this.client = axios.create({
            baseURL:
                opts.baseUrl ||
                process.env.CONEXOS_BASE_URL ||
                'https://columbiatrading.conexos.cloud/api',
            timeout: 40000,
        });

        // ── Axios request/response interceptors ──────────────────────────────
        this.client.interceptors.request.use((config) => {
            const { method, url, data } = config;
            console.log(`[CONEXOS →] ${(method ?? 'GET').toUpperCase()} ${url}`);
            if (data) console.log(`[CONEXOS →] body=${redactSensitive(data)}`);
            return config;
        });

        this.client.interceptors.response.use(
            (resp) => {
                const { method, url } = resp.config;
                const count =
                    resp.data?.count ??
                    resp.data?.rows?.length ??
                    (Array.isArray(resp.data) ? resp.data.length : undefined);
                const countStr = count !== undefined ? ` count=${count}` : '';
                console.log(
                    `[CONEXOS ←] ${(method ?? 'GET').toUpperCase()} ${url} → ${resp.status}${countStr}`,
                );
                if (DEBUG_VERBOSE) console.log(`[CONEXOS ←] data=${JSON.stringify(resp.data)}`);
                return resp;
            },
            (err) => {
                const { method, url } = err.config ?? {};
                const status = err.response?.status ?? 'ERR';
                const body = err.response?.data;
                console.error(`[CONEXOS ✗] ${(method ?? '?').toUpperCase()} ${url} → ${status}`);
                if (body) console.error(`[CONEXOS ✗] body=${JSON.stringify(body)}`);
                return Promise.reject(err);
            },
        );
        // ─────────────────────────────────────────────────────────────────────
    }

    private extractSidFromSetCookie(setCookie: string[] | undefined): string | null {
        if (!setCookie) return null;
        const sidCookie = setCookie.find((c) => c.startsWith('sid='));
        if (!sidCookie) return null;
        return sidCookie.split(';')[0].replace('sid=', '');
    }

    async login(sessionToKill?: string): Promise<void> {
        // Mutex: se já existe um login em andamento e este não é um retry de
        // sessionToKill, espera o promise compartilhado em vez de abrir uma 2ª
        // sessão paralela (Conexos rejeita com LOGIN_ERROR_MAX_SESSIONS).
        if (this.loginPromise && !sessionToKill) {
            if (DEBUG_VERBOSE) console.log('[Conexos] Login já em andamento — aguardando');
            return this.loginPromise;
        }
        this.loginPromise = this._doLogin(sessionToKill).finally(() => {
            // Limpa o mutex apenas no login "principal"; retries por
            // sessionToKill não devem liberar o mutex porque ainda fazem parte
            // do mesmo fluxo de login que iniciou.
            if (!sessionToKill) this.loginPromise = null;
        });
        return this.loginPromise;
    }

    private async _doLogin(sessionToKill?: string): Promise<void> {
        boxLog('Conexos: login attempt', { sessionToKill });

        // Shared session store (CC-3): tenta ADOTAR antes de logar. Outro processo
        // (Render, dev server, script) pode já ter um sid compartilhado válido;
        // reusá-lo mantém toda a frota em UM dos ~3 slots de MAX_SESSIONS. Pulado
        // no retry por sessionToKill (já decidimos por um login fresco).
        if (!sessionToKill) {
            const deadSid = this.sid;
            const stored = await this.sessionStore.acquire();
            this.storeVersion = stored?.version ?? null;
            if (
                stored &&
                stored.sid !== deadSid &&
                stored.usnCod !== null &&
                stored.expiresAt > Date.now() + STORE_SID_MIN_TTL_MS
            ) {
                this.adoptSession(stored);
                if (DEBUG_VERBOSE) {
                    console.log('[Conexos] shared sid adopted from store (no POST /login)');
                }
                return;
            }
            if (deadSid && stored?.sid === deadSid) {
                // Nosso sid (agora inválido/expirado) ainda é o compartilhado —
                // remove para nenhum outro processo adotar uma sessão morta.
                await this.sessionStore.invalidate(deadSid);
                this.storeVersion = null;
            }
        }

        const username = this.username;
        const password = this.password;
        if (!username || !password)
            throw new Error('CONEXOS_USERNAME and CONEXOS_PASSWORD are required');

        const body: { username: string; password: string; sessionToKill?: string } = {
            username,
            password,
        };
        if (sessionToKill) body.sessionToKill = sessionToKill;

        try {
            const resp = await this.client.post('/login', body);
            const sid = this.extractSidFromSetCookie(resp.headers['set-cookie']);
            if (!sid) throw new Error('Failed to extract sid from Conexos login response');
            this.sid = sid;
            this.sidExpiresAt = Date.now() + 25 * 60 * 1000;
            if (Array.isArray(resp.data?.filiais)) {
                this.filiais = resp.data.filiais as Filial[];
                if (DEBUG_VERBOSE)
                    console.log(`[Conexos] ${this.filiais.length} filiais capturadas do login`);
            }
            if (typeof resp.data?.filCodDefault === 'number') {
                this.filCodDefault = resp.data.filCodDefault;
            }
            if (typeof resp.data?.usnCod === 'number') {
                this.usnCod = String(resp.data.usnCod);
            }
            // CC-3: publica o sid fresco no store compartilhado (concorrência
            // otimista; numa corrida perdida adotamos o vencedor).
            await this.persistSessionToStore();
            if (DEBUG_VERBOSE) console.log('[Conexos] Login successful');
        } catch (err: any) {
            const errorData = err.response?.data;
            if (
                errorData?.type === 'LOGIN_ERROR_MAX_SESSIONS' &&
                Array.isArray(errorData.sessions) &&
                !sessionToKill
            ) {
                const sessions = errorData.sessions as Array<{
                    sessionId: string;
                    sessionLastAccessedTime: number;
                }>;
                const oldestSession = sessions.reduce((oldest, current) =>
                    current.sessionLastAccessedTime < oldest.sessionLastAccessedTime
                        ? current
                        : oldest,
                );
                if (DEBUG_VERBOSE)
                    console.log(
                        `[Conexos] Session limit reached — killing oldest ${oldestSession.sessionId.substring(0, 8)}...`,
                    );
                return this.login(oldestSession.sessionId);
            }
            throw err;
        }
    }

    async ensureSid() {
        if (!this.sid || (this.sidExpiresAt && Date.now() > this.sidExpiresAt)) {
            // `login()` consulta o store compartilhado ANTES (CC-3): um sid válido
            // persistido por outro processo é adotado sem novo POST /login.
            await this.login();
        }
    }

    /** Adota uma sessão compartilhada vinda do store (CC-3). */
    private adoptSession(record: ConexosSessionRecord): void {
        this.sid = record.sid;
        this.sidExpiresAt = record.expiresAt;
        if (record.usnCod !== null) this.usnCod = record.usnCod;
        const payload = record.loginPayload;
        if (Array.isArray(payload?.filiais) && payload.filiais.length > 0) {
            this.filiais = payload.filiais;
        }
        if (typeof payload?.filCodDefault === 'number') {
            this.filCodDefault = payload.filCodDefault;
        }
        this.storeVersion = record.version;
    }

    /**
     * Publica a sessão local (recém-logada) no store compartilhado. Concorrência
     * otimista (CC-3): se outro processo persistiu um sid diferente no meio
     * (`lost`), ADOTAMOS o sid do vencedor e abandonamos nosso login — ele expira
     * sozinho no lado do Conexos. Falhas do store degradam em silêncio (sessão por
     * processo, comportamento antigo).
     */
    private async persistSessionToStore(): Promise<void> {
        if (!this.sessionStore.enabled || !this.sid || !this.sidExpiresAt) return;
        const result = await this.sessionStore.persist({
            sid: this.sid,
            usnCod: this.usnCod,
            expiresAt: this.sidExpiresAt,
            loginPayload: { filiais: this.filiais, filCodDefault: this.filCodDefault },
            expectedVersion: this.storeVersion,
        });
        if (result.outcome === 'won') {
            this.storeVersion = result.version;
            return;
        }
        if (result.outcome === 'lost') {
            const winner = result.current;
            if (
                winner &&
                winner.sid !== this.sid &&
                winner.usnCod !== null &&
                winner.expiresAt > Date.now() + STORE_SID_MIN_TTL_MS
            ) {
                if (DEBUG_VERBOSE) {
                    console.log('[Conexos] lost login race — adopting winner sid');
                }
                this.adoptSession(winner);
            }
            // senão: mantém nosso sid fresco localmente; o próximo acquire re-sincroniza.
        }
    }

    /** Returns filiais captured from the last successful login. */
    async getFiliais(): Promise<Filial[]> {
        await this.ensureSid();
        return this.filiais;
    }

    /** Default filCod for the authenticated user, captured from `/login` response. */
    async getFilCodDefault(): Promise<number | null> {
        await this.ensureSid();
        return this.filCodDefault;
    }

    /**
     * `usnCod` JÁ capturado no `/login` desta sessão, SEM disparar login (ao contrário de
     * `getSid`). É o identificador que o ERP grava do lado dele, e é o que a trilha de
     * auditoria persiste no ledger (ADR-0041) no momento da escrita — quando o login já
     * aconteceu. `null` enquanto esta sessão nunca logou.
     */
    getCapturedUsnCod(): string | null {
        return this.usnCod;
    }

    /**
     * Public sid accessor — pattern from nf-projects `ConexosClient.getSid`.
     * Used by `legacyConexosAdapter` to consume the already-authenticated
     * session instead of opening a parallel one (ADR-0007).
     */
    async getSid(): Promise<{ sid: string; usnCod: string }> {
        await this.ensureSid();
        if (!this.sid) throw new Error('Conexos session not available');
        if (!this.usnCod) throw new Error('Conexos usnCod not captured from /login response');
        return { sid: this.sid, usnCod: this.usnCod };
    }

    /**
     * Generic authenticated POST helper. Used by closing-reports endpoints
     * (com298, com299, com308, com017) that the legacy methods don't wrap.
     * Single point for 401 retry — re-issues a `login()` (which has the
     * MAX_SESSIONS retry built in) on first 401.
     */
    async authenticatedPost<T = unknown>(
        path: string,
        body: unknown,
        opts: { filCod?: number } = {},
    ): Promise<T> {
        await this.ensureSid();
        const url = path.startsWith('/') ? path : `/${path}`;
        const headers = this.defaultHeaders(opts.filCod);
        try {
            const resp = await this.client.post<T>(url, body, { headers });
            return resp.data;
        } catch (err: unknown) {
            const status = (err as { response?: { status?: number } }).response?.status;
            if (status !== 401) throw err;
            await this.login();
            const resp = await this.client.post<T>(url, body, {
                headers: this.defaultHeaders(opts.filCod),
            });
            return resp.data;
        }
    }

    /**
     * Single-attempt authenticated POST — NO 401 re-login/retry. Used ONLY by
     * the irreversible write (`gravarBaixaPermuta` → `fin010/baixas`): the
     * normal `authenticatedPost` silently re-POSTs on 401, which for an
     * irreversible write opens a double-baixa (super-pagamento) window if the
     * 401 ever surfaces post-apply. Here a 401 propagates to the caller, which
     * fails the reconciliation (fail-closed) for manual review instead of
     * blindly re-sending the write.
     */
    async authenticatedPostOnce<T = unknown>(
        path: string,
        body: unknown,
        opts: { filCod?: number } = {},
    ): Promise<T> {
        await this.ensureSid();
        const url = path.startsWith('/') ? path : `/${path}`;
        const headers = this.defaultHeaders(opts.filCod);
        const resp = await this.client.post<T>(url, body, { headers });
        return resp.data;
    }

    /**
     * Single-attempt authenticated PUT — NO 401 re-login/retry, mirroring
     * `authenticatedPostOnce`. Used by the com300 fiscal read-modify-write
     * (`PUT /api/com300`, no id in the URL): the RMW rewrites the whole
     * `finDocFiscal`, so a silent re-PUT on 401 could clobber concurrently-changed
     * state. A 401 propagates to the caller (fail-closed) for manual review.
     */
    async authenticatedPutOnce<T = unknown>(
        path: string,
        body: unknown,
        opts: { filCod?: number } = {},
    ): Promise<T> {
        await this.ensureSid();
        const url = path.startsWith('/') ? path : `/${path}`;
        const headers = this.defaultHeaders(opts.filCod);
        const resp = await this.client.put<T>(url, body, { headers });
        return resp.data;
    }

    /**
     * Authenticated MULTIPART upload (`multipart/form-data`) — para o `carregar`
     * de arquivo de retorno do SISPAG (`fin052/arquivosRetorno/carregar`, o `.RET`).
     * O stack é JSON-only; este é o único caminho de upload de arquivo.
     *
     * Preserva a auth (cookie `sid` + `cnx-filcod` + `cnx-usncod`) mas REMOVE o
     * `content-type: application/json` do `defaultHeaders` — o axios seta o
     * `multipart/form-data; boundary=…` a partir do `FormData` nativo.
     *
     * TENTATIVA ÚNICA (sem 401-retry cego), espelhando `authenticatedPostOnce`:
     * um re-POST silencioso de upload cria um arquivo de retorno DUPLICADO no ERP.
     * O 401 propaga para o caller tratar (fail-closed).
     */
    async authenticatedPostMultipart<T = unknown>(
        path: string,
        form: FormData,
        opts: { filCod?: number } = {},
    ): Promise<T> {
        await this.ensureSid();
        const url = path.startsWith('/') ? path : `/${path}`;
        const headers: Record<string, string | undefined> = {
            ...this.defaultHeaders(opts.filCod),
        };
        // Deixa o axios derivar o boundary do FormData (não force JSON).
        delete headers['content-type'];
        const resp = await this.client.post<T>(url, form, { headers });
        return resp.data;
    }

    /**
     * Generic authenticated GET helper. Mirrors `authenticatedPost` but for
     * Conexos endpoints that expose data via GET — currently the NF Saída
     * `com311/list/<docCod>` and `com311/baixas/list/<docCod>/<titCod>/<vldCheck>`
     * routes (Phase 1, exposure-from-invoice-baixa).
     *
     * Same 401-retry semantics as `authenticatedPost`. `filCod` is required
     * by ADR-0009 — the caller MUST pass `opts.filCod` so the multi-filial
     * header is set correctly; absence will throw `MissingFilCodError`.
     */
    async authenticatedGet<T = unknown>(path: string, opts: { filCod?: number } = {}): Promise<T> {
        await this.ensureSid();
        const url = path.startsWith('/') ? path : `/${path}`;
        const headers = this.defaultHeaders(opts.filCod);
        try {
            const resp = await this.client.get<T>(url, { headers });
            return resp.data;
        } catch (err: unknown) {
            const status = (err as { response?: { status?: number } }).response?.status;
            if (status !== 401) throw err;
            await this.login();
            const resp = await this.client.get<T>(url, {
                headers: this.defaultHeaders(opts.filCod),
            });
            return resp.data;
        }
    }

    /**
     * Generic authenticated DELETE helper. Mirrors `authenticatedGet` (mesmo 401-retry).
     * Usado pela exclusão de baixa do borderô (`fin010/baixas/{bor}/{fil}/{doc}/{tit}/{seq}`).
     */
    async authenticatedDelete<T = unknown>(
        path: string,
        opts: { filCod?: number } = {},
    ): Promise<T> {
        await this.ensureSid();
        const url = path.startsWith('/') ? path : `/${path}`;
        try {
            const resp = await this.client.delete<T>(url, {
                headers: this.defaultHeaders(opts.filCod),
            });
            return resp.data;
        } catch (err: unknown) {
            const status = (err as { response?: { status?: number } }).response?.status;
            if (status !== 401) throw err;
            await this.login();
            const resp = await this.client.delete<T>(url, {
                headers: this.defaultHeaders(opts.filCod),
            });
            return resp.data;
        }
    }

    private getAuthHeaders() {
        return this.sid ? { Cookie: `sid=${this.sid}` } : {};
    }

    private defaultHeaders(filCod?: number) {
        // ADR-0009: filCod must be provided explicitly OR via CONEXOS_FIL_COD
        // env override. The previous silent fallback to the literal `2`
        // leaked Columbia's branch into multi-filial requests. When neither
        // source supplies a number, throw MissingFilCodError loudly.
        const resolved = filCod ?? config.conexos.filCod;
        if (!Number.isFinite(resolved)) {
            throw new MissingFilCodError({});
        }
        if (!this.usnCod) {
            throw new Error(
                'Conexos usnCod not captured — call ensureSid() before defaultHeaders()',
            );
        }
        return {
            ...this.getAuthHeaders(),
            'content-type': 'application/json;charset=UTF-8',
            'cnx-filcod': String(resolved),
            // PR #19: usnCod is captured at runtime from /login response.
            'cnx-usncod': this.usnCod,
            'cnx-datalanguage': 'pt',
            accept: 'application/json, text/plain, */*',
        };
    }
}

export const conexosService = new ConexosService();
