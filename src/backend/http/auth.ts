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
 * Minimal shape of an authenticated user, decoded from the JWT.
 * `sub` is the canonical `app_user.username` (identity only). `role` is kept for logs and for the
 * old frontend during the deploy window; NO guard reads it (ADR-0053, I1): authorization comes from
 * the database, via `resolverAcesso` / `exigirPermissao` in `http/acesso.ts`.
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
