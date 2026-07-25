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
 * Minimal shape of an authenticated Supabase user, decoded from the JWT.
 * `sub` is the Supabase user id; `role` is the Postgres role claim.
 */
export interface AuthUser {
    sub: string;
    email?: string;
    role?: string;
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
const toAuthUser = (payload: JWTPayload): AuthUser => {
    if (!payload.sub) {
        throw new Error('missing sub claim');
    }
    return {
        sub: String(payload.sub),
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
 * Both verifiers enforce `audience: 'authenticated'`, and `issuer:
 * ${SUPABASE_URL}/auth/v1` whenever `SUPABASE_URL` is configured. A token whose
 * `alg` needs a verifier that was not configured is rejected.
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
    const baseOptions: JWTVerifyOptions = {
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

    const verify = async (token: string): Promise<JWTPayload> => {
        const { alg } = decodeProtectedHeader(token);
        if (isSymmetricAlg(alg)) {
            if (!hsKey) {
                throw new Error('HS256 token received but SUPABASE_JWT_SECRET is not configured');
            }
            const { payload } = await jwtVerify(token, hsKey, {
                ...baseOptions,
                algorithms: ['HS256'],
            });
            return payload;
        }
        if (!jwks) {
            throw new Error('Asymmetric token received but SUPABASE_URL (JWKS) is not configured');
        }
        const { payload } = await jwtVerify(token, jwks, baseOptions);
        return payload;
    };

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const token = extractBearerToken(req.headers.authorization);
        if (!token) {
            res.status(401).json({ error: 'Missing or malformed Authorization header' });
            return;
        }

        try {
            req.user = toAuthUser(await verify(token));
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
