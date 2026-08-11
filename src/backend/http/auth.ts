import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
    type JWTPayload,
    type JWTVerifyGetKey,
    type JWTVerifyOptions,
    createRemoteJWKSet,
    decodeProtectedHeader,
    errors,
    jwtVerify,
} from 'jose';
import type { AuthEnv } from './authEnv.js';

/**
 * Which identity scheme proved this request — and therefore **what `sub` means**.
 *
 * It is not a diagnostic label: it selects the `app_user` lookup, and getting it wrong is
 * not a soft failure.
 *
 * | Scheme | Issued by | `sub` is | Resolved by |
 * |---|---|---|---|
 * | `'provider'` | Supabase GoTrue | the `auth.users` **UUID** | `auth_user_id` |
 * | `'legacy'` | our own `AuthService.signToken` | the **username** (`setSubject(username)`) | `username` |
 *
 * The two coexist for the whole of rollout phases 2–3 (ADR-0030 §6). Feeding a legacy `sub`
 * to the `auth_user_id` lookup makes Postgres reject `'marilyn@kavex.com'` as invalid UUID
 * syntax — **500 on every authenticated request**, which is the failure that turns the
 * documented rollback into a lockout.
 */
export type AuthScheme = 'provider' | 'legacy';

/**
 * The authenticated actor of a request.
 *
 * **Two layers, two sources** (ADR-0030 / `business-rules/autorizacao-resolvida-do-banco.md`):
 * - `sub` (and `email`) come from the **JWT** — they prove IDENTITY. What `sub` *contains*
 *   depends on `authScheme`: a GoTrue UUID, or the legacy username. Either way it is an
 *   internal join key: it is **never** displayed, and **never** persisted as the actor of
 *   the audit trail (I-Usuario-1).
 * - `role`, `username` and `appUserId` come from **`app_user`**, resolved from the database
 *   on every request by `appUserContext` — they carry AUTHORIZATION. The JWT's own `role`
 *   claim is always `'authenticated'` (the Postgres role) and is **discarded**.
 *
 * Until `appUserContext` runs, `role`/`username` are absent — which is why `requireRole`
 * must always be mounted after it.
 */
export interface AuthUser {
    sub: string;
    email?: string;
    /**
     * How this request proved identity — and therefore how `sub` must be looked up.
     * Set by `buildAuthMiddleware`; read by `appUserContext`. Absent only where a test
     * harness builds `req.user` by hand, which `appUserContext` treats as `'provider'`.
     */
    authScheme?: AuthScheme;
    /** Business role resolved from `app_user.role` — `'admin' | 'operador'`. NOT the JWT claim. */
    role?: string;
    /**
     * `app_user.username` (the e-mail). **The one and only actor of the audit trail**
     * (I-Usuario-1) and the key of the Conexos link. Populated by `appUserContext`.
     */
    username?: string;
    /** `app_user.id` — internal surrogate. Never leaves for the ERP nor for the audit trail. */
    appUserId?: number;
    /**
     * Per-filial allow-list (Regis security-1) — the filiais this user may act on for money-moving
     * routes. OPTIONAL: only present when the token carries a `filiais`/`permissions.filiais` claim.
     * Absent today (Supabase tokens carry only sub/email/role) — the seam is ready for the real claim.
     */
    filiais?: number[];
}

declare global {
    namespace Express {
        interface Request {
            user?: AuthUser;
        }
    }
}

const BEARER_PREFIX = 'Bearer ';

/**
 * The Supabase access-token audience for authenticated users. Anon/service
 * keys use other audiences and must not pass user-route verification.
 */
const AUTHENTICATED_AUDIENCE = 'authenticated';

/**
 * Extracts the raw token from an `Authorization: Bearer <token>` header.
 * Returns `undefined` when the header is missing or malformed.
 */
export const extractBearerToken = (header?: string): string | undefined => {
    if (!header?.startsWith(BEARER_PREFIX)) {
        return undefined;
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    return token.length > 0 ? token : undefined;
};

/**
 * Maps a verified JWT payload to an `AuthUser`. Throws when the `sub` claim is
 * absent, so a token without a subject is treated as invalid.
 */
const toAuthUser = (payload: JWTPayload, authScheme: AuthScheme): AuthUser => {
    if (!payload.sub) {
        throw new Error('missing sub claim');
    }
    return {
        sub: String(payload.sub),
        authScheme,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        role: typeof payload.role === 'string' ? payload.role : undefined,
        ...(filiaisFromClaims(payload) !== undefined
            ? { filiais: filiaisFromClaims(payload) }
            : {}),
    };
};

/**
 * Extracts the per-filial allow-list from `filiais` or `permissions.filiais` (Regis security-1).
 * Returns `undefined` when the claim is absent — the guard treats that as "not provisioned yet".
 */
const filiaisFromClaims = (payload: JWTPayload): number[] | undefined => {
    const direct = (payload as { filiais?: unknown }).filiais;
    const nested = (payload as { permissions?: { filiais?: unknown } }).permissions?.filiais;
    const raw = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : undefined;
    if (raw === undefined) return undefined;
    const nums = raw.map((v) => Number(v)).filter((n): n is number => Number.isInteger(n) && n > 0);
    return nums;
};

/** `true` for HMAC algorithms (HS256/384/512) — verified with a shared secret. */
const isSymmetricAlg = (alg?: string): boolean => alg?.startsWith('HS') ?? false;

/**
 * Builds the Express middleware that validates the Supabase-issued JWT on
 * every request.
 *
 * The verifier is chosen **per token, by its `alg` header**, so the same
 * deployment works regardless of which signing scheme the Supabase project
 * currently uses (it can be rotated between symmetric and asymmetric):
 * - **Symmetric (HS256)** tokens are verified with the shared secret
 *   (`SUPABASE_JWT_SECRET`). HS256 keys are never published in a JWKS.
 * - **Asymmetric (ES256/RS256/…)** tokens are verified against the project's
 *   JWKS (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`). The remote key set
 *   is built ONCE (closure) and caches keys.
 *
 * **The verification options are SEPARATE PER PATH — and that separation is the whole
 * point.** Both enforce `audience: 'authenticated'` (the `anon` and `service_role` keys use
 * other audiences and must never pass a user route). Only the **asymmetric** path enforces
 * `issuer`:
 * - **JWKS/ES256** — `issuer` REQUIRED. It is what proves the token came from our project.
 * - **HS256 legacy** — `issuer` NOT required. The app's own login tokens
 *   (`AuthService.signToken`) never carried an `iss` claim. Sharing one options object
 *   between the two verifiers meant that merely SETTING `SUPABASE_URL` would start demanding
 *   `iss` from every legacy token and **drop every live session at once** (ADR-0030 §6).
 *   Guarded by the named regression test in `auth.test.ts`.
 *
 * A token whose `alg` needs a verifier that was not configured is rejected.
 *
 * - When `authEnv.devBypass` is true the middleware is a no-op (local dev).
 * - Missing, malformed, expired or wrong-signature/issuer/audience tokens are
 *   rejected with HTTP 401. On success the decoded user is attached to
 *   `req.user`.
 *
 * The optional `keyResolver` overrides the remote JWKS resolver (used by tests
 * to inject a local public key and avoid a network fetch).
 *
 * Arch-review cards security-1 / security-7.
 */
export const buildAuthMiddleware = (
    authEnv: AuthEnv,
    keyResolver?: JWTVerifyGetKey,
): RequestHandler => {
    if (authEnv.devBypass) {
        console.warn(
            '[auth] DEV_AUTH_BYPASS is enabled — JWT validation is DISABLED. ' +
                'Never use this in a deployed environment.',
        );
        return (_req: Request, _res: Response, next: NextFunction): void => {
            next();
        };
    }

    const issuer = authEnv.supabaseUrl ? `${authEnv.supabaseUrl}/auth/v1` : undefined;

    // Symmetric (legacy) — audience ONLY. Adding `issuer` here is the regression that drops
    // every live session the moment SUPABASE_URL is configured (ADR-0030 §6).
    const hsOptions: JWTVerifyOptions = { audience: AUTHENTICATED_AUDIENCE };

    // Asymmetric (provider) — audience AND issuer. Here the issuer is what proves origin.
    const jwksOptions: JWTVerifyOptions = {
        audience: AUTHENTICATED_AUDIENCE,
        ...(issuer ? { issuer } : {}),
    };

    // Asymmetric (JWKS) resolver — available when a JWKS source exists. Tests
    // inject `keyResolver` directly to avoid a network fetch.
    const jwks: JWTVerifyGetKey | undefined =
        keyResolver ??
        (authEnv.supabaseUrl && issuer
            ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
            : undefined);

    // Symmetric (HS256) key — available when a shared secret is configured.
    const hsKey = authEnv.jwtSecret ? new TextEncoder().encode(authEnv.jwtSecret) : undefined;

    if (!jwks && !hsKey) {
        // Defensive: loadAuthEnv() already guarantees this, but keep the
        // invariant explicit so a future refactor cannot silently disable auth.
        throw new Error(
            'buildAuthMiddleware: SUPABASE_URL or SUPABASE_JWT_SECRET is required ' +
                'when devBypass is off.',
        );
    }

    /**
     * Classifies a **already-verified** payload as provider- or legacy-issued.
     *
     * **The discriminator is `iss`, not the algorithm** — and that distinction is the whole
     * reason this is a function instead of `isSymmetricAlg(alg) ? 'legacy' : 'provider'`.
     * A Supabase project whose JWT keys are still symmetric issues HS256 tokens too, and
     * those carry a UUID `sub`. Classifying by `alg` would send them to the username lookup
     * and lock out every user of such a project.
     *
     * `AuthService.signToken` never calls `.setIssuer()`, so the app's own tokens have no
     * `iss` at all — which is precisely why `hsOptions` must not demand one (ADR-0030 §6).
     * Asymmetric tokens are always provider-issued: `jwksOptions` already enforced the
     * issuer before we get here.
     */
    const schemeFor = (alg: string | undefined, payload: JWTPayload): AuthScheme => {
        if (!isSymmetricAlg(alg)) return 'provider';
        return issuer !== undefined && payload.iss === issuer ? 'provider' : 'legacy';
    };

    const verify = async (token: string): Promise<{ payload: JWTPayload; scheme: AuthScheme }> => {
        const { alg } = decodeProtectedHeader(token);
        if (isSymmetricAlg(alg)) {
            if (!hsKey) {
                throw new Error('HS256 token received but SUPABASE_JWT_SECRET is not configured');
            }
            const { payload } = await jwtVerify(token, hsKey, {
                ...hsOptions,
                algorithms: ['HS256'],
            });
            return { payload, scheme: schemeFor(alg, payload) };
        }
        if (!jwks) {
            throw new Error('Asymmetric token received but SUPABASE_URL (JWKS) is not configured');
        }
        const { payload } = await jwtVerify(token, jwks, jwksOptions);
        return { payload, scheme: schemeFor(alg, payload) };
    };

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const token = extractBearerToken(req.headers.authorization);
        if (!token) {
            res.status(401).json({ error: 'Missing or malformed Authorization header' });
            return;
        }

        try {
            const { payload, scheme } = await verify(token);
            req.user = toAuthUser(payload, scheme);
            next();
        } catch (err: unknown) {
            const expired = err instanceof errors.JWTExpired;
            console.warn(
                `[auth] rejected request to ${req.method} ${req.originalUrl}:`,
                expired ? 'token expired' : 'invalid token',
            );
            res.status(401).json({ error: expired ? 'Token expired' : 'Invalid token' });
        }
    };
};

/**
 * The actor written to an audit column (`executado_por`, `criado_por`, `created_by`).
 *
 * **Always `username` (the e-mail). Never `sub`** — I-Usuario-1 /
 * `business-rules/ator-da-trilha-de-auditoria.md`.
 *
 * ### Why a helper instead of 19 inline expressions
 *
 * The old shape — `req.user?.sub ?? req.user?.email ?? 'unknown'` — reads as defensive and
 * is not. Once `sub` stops being the e-mail and becomes a UUID, it is still **present**, so
 * it **wins** the `??` and the fallback is never reached. The trail silently starts
 * recording UUIDs: no error, no log, no red test. `BorderosPanel.tsx` renders those values
 * raw and builds its "filter by user" dropdown from them, so the same person would appear
 * twice and the historical filter would stop finding her work.
 *
 * Centralising it makes the invariant greppable and testable **once**. The repository had
 * three competing doctrines (two local `ator` helpers plus 17 inline expressions, 2 of them
 * with the operands inverted) — which is exactly how the inverted ones got there.
 *
 * ### Why `fallback` is a parameter and not a constant
 *
 * Two of the 19 sites persist `'manual'` and the other 17 persist `'unknown'`. Passing the
 * fallback keeps both values **byte-identical to what is already in the database**;
 * unifying them would change a persisted value to fix a cosmetic inconsistency.
 *
 * ### Why two call sites deliberately do NOT use this helper
 *
 * `routes/me.ts` and `http/conexosIdentity.ts` read `req.user?.username` **directly**,
 * because they **need** the `undefined`: `conexosIdentity` uses its absence to fall back to
 * the robot session, and `me.ts` uses it to answer `'ausente'`. Injecting `'unknown'` there
 * would run `getVinculoConexos('unknown')` — a guaranteed-empty SELECT disguised as "no
 * link". A fallback is right for an audit column and wrong for a join key.
 */
export const auditActor = (req: Request, fallback = 'unknown'): string =>
    req.user?.username ?? fallback;

/**
 * RBAC server-side (security-1 / Bass: Authorize Actors). Middleware-factory que
 * exige que o `role` do usuário autenticado (já populado por `buildAuthMiddleware`)
 * esteja entre os `allowed`. Aplicar APÓS o auth middleware, nas rotas de MUTAÇÃO.
 * Sem `req.user` → 401 (não autenticado); role fora da lista → 403 (proibido).
 * Mantém as rotas de LEITURA abertas a qualquer usuário autenticado.
 */
export const requireRole = (...allowed: string[]): RequestHandler => {
    const allowedSet = new Set(allowed);
    return (req: Request, res: Response, next: NextFunction): void => {
        const role = req.user?.role;
        if (!req.user) {
            res.status(401).json({ error: 'Not authenticated' });
            return;
        }
        if (role === undefined || !allowedSet.has(role)) {
            console.warn(
                `[auth] forbidden ${req.method} ${req.originalUrl}: role='${role ?? 'none'}' not in [${allowed.join(', ')}]`,
            );
            res.status(403).json({ error: 'Forbidden: insufficient role' });
            return;
        }
        next();
    };
};
