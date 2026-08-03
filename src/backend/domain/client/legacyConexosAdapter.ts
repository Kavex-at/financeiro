import type { ConexosService } from '../../services/conexos.js';
import type { Filial, LegacyConexosShape, PagedResponse } from './ConexosBaseClient.js';

/** Resolve a sessão Conexos a usar NESTA chamada (usuário logado ou robô). */
export type ResolveConexosService = () => Promise<ConexosService>;

/**
 * Adapter que delega para uma sessão Conexos RESOLVIDA POR CHAMADA (ADR-0007 +
 * Fatia B). Antes ele fechava sobre o singleton do robô; agora consulta
 * `resolveService()` a cada método, que devolve a sessão do usuário logado
 * (quando há request autenticada com vínculo válido) ou a do robô (fallback).
 * Assim TODOS os sub-clients passam a operar no nome do usuário sem qualquer
 * mudança neles — a decisão fica num único ponto.
 *
 * Continua um pass-through fino (sem estado próprio): o estado de sessão vive na
 * `ConexosService` resolvida.
 */
export const buildLegacyConexosAdapter = (
    resolveService: ResolveConexosService,
): LegacyConexosShape => {
    const listGeneric = async <T>(
        serviceName: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<T> => {
        const svc = await resolveService();
        const data = await svc.authenticatedPost<{ rows?: T } | T>(`/${serviceName}`, body, opts);
        const maybeRows = (data as { rows?: T }).rows;
        return (maybeRows ?? data) as T;
    };

    /**
     * Paginated variant of `listGeneric` that preserves the `{count, rows}`
     * envelope returned by Conexos list endpoints. Used by `ConexosClient`'s
     * `paginate` helper to drive multi-page loops.
     */
    const listGenericPaginated = async <Row>(
        serviceName: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<PagedResponse<Row>> => {
        const svc = await resolveService();
        const data = await svc.authenticatedPost<{ count?: number; rows?: Row[] }>(
            `/${serviceName}`,
            body,
            opts,
        );
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        const count = typeof data?.count === 'number' ? data.count : rows.length;
        return { count, rows };
    };

    /**
     * GET-style passthrough. Used for endpoints that expose data through GET
     * paths (e.g. `com311/list/<docCod>`, `com311/baixas/list/...`).
     */
    const getGeneric = async <T>(path: string, opts?: { filCod?: number }): Promise<T> => {
        const svc = await resolveService();
        return svc.authenticatedGet<T>(`/${path}`, opts);
    };

    /**
     * Raw POST passthrough for WRITE endpoints (Fase 3 — `fin010` baixa/permuta).
     * Returns the response body as-is (no `.rows` unwrapping).
     */
    const postGeneric = async <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<T> => {
        const svc = await resolveService();
        return svc.authenticatedPost<T>(`/${path}`, body, opts);
    };

    /**
     * Single-attempt POST passthrough (NO 401 re-login/retry) — for the
     * irreversible write `gravarBaixaPermuta`. See `authenticatedPostOnce`.
     */
    const postGenericOnce = async <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<T> => {
        const svc = await resolveService();
        return svc.authenticatedPostOnce<T>(`/${path}`, body, opts);
    };

    /**
     * Single-attempt PUT passthrough (NO 401-retry) — for the com300 fiscal
     * read-modify-write (`PUT com300`). See `authenticatedPutOnce`.
     */
    const putGenericOnce = async <T>(
        path: string,
        body: Record<string, unknown>,
        opts?: { filCod?: number },
    ): Promise<T> => {
        const svc = await resolveService();
        return svc.authenticatedPutOnce<T>(`/${path}`, body, opts);
    };

    /**
     * Single-attempt multipart upload passthrough (NO 401-retry) — para o
     * `carregar` do `.RET` no `fin052`. Delegates to `authenticatedPostMultipart`.
     */
    const postMultipartOnce = async <T>(
        path: string,
        form: FormData,
        opts?: { filCod?: number },
    ): Promise<T> => {
        const svc = await resolveService();
        return svc.authenticatedPostMultipart<T>(`/${path}`, form, opts);
    };

    /** DELETE passthrough — exclusão de baixa do borderô (`fin010/baixas/...`). */
    const deleteGeneric = async <T>(path: string, opts?: { filCod?: number }): Promise<T> => {
        const svc = await resolveService();
        return svc.authenticatedDelete<T>(`/${path}`, opts);
    };

    return {
        ensureSid: async () => {
            const svc = await resolveService();
            return svc.ensureSid();
        },
        listGeneric,
        listGenericPaginated,
        getGeneric,
        postGeneric,
        postGenericOnce,
        putGenericOnce,
        postMultipartOnce,
        deleteGeneric,
        getFiliais: async (): Promise<Filial[]> => {
            const svc = await resolveService();
            return svc.getFiliais();
        },
        getFilCodDefault: async (): Promise<number | null> => {
            const svc = await resolveService();
            return svc.getFilCodDefault();
        },
    };
};

class LegacyConexosAdapterToken {}
export const LegacyConexosAdapter = LegacyConexosAdapterToken;
