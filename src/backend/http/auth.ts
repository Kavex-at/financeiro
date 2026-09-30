import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
    type JWTPayload,
    type JWTVerifyGetKey,
    createRemoteJWKSet,
    decodeProtectedHeader,
    errors,
    jwtVerify,
} from 'jose';
import type { AuthEnv } from './authEnv.js';

/** Quem emitiu o token: o próprio backend (HS256) ou o GoTrue do projeto (ES256). */
export type TokenIssuer = 'app' | 'supabase';

/**
 * O usuário da requisição.
 *
 * Depois do `buildAuthMiddleware`: `sub` é o do TOKEN (username no emissor `app`, UUID do Supabase
 * no emissor `supabase`) e `emissor` diz qual verificador o aceitou.
 *
 * Depois do `resolverAcesso` (ADR-0054, I2): o `req.user` é REESCRITO a partir do banco para
 * `{ sub: app_user.username, authUserId?, filiais? }`. Tudo o que roda depois dele (identidade
 * Conexos, trilhas de auditoria, guards) lê `sub = username`, para sempre. `email` e `role` do
 * token nunca entram aqui; nenhum guard lê papel do token (ADR-0053, I1).
 */
export interface AuthUser {
    sub: string;
    emissor?: TokenIssuer;
    /** UUID do usuário no Supabase Auth, quando o token veio do GoTrue. */
    authUserId?: string;
    /**
     * Legado: nunca é preenchido desde a ADR-0054. Mantido só para os sítios `sub ?? email` que
     * ainda o citam como segundo recurso.
     */
    email?: string;
    /** Legado, idem: nunca é preenchido; nenhum guard lê papel do token (ADR-0053, I1). */
    role?: string;
    /**
     * Per-filial allow-list (Regis security-1) — the filiais this user may act on for money-moving
     * routes. OPTIONAL: only present when the token carries a top-level `filiais`/`permissions.filiais`
     * claim. `user_metadata` (editável pelo próprio usuário no GoTrue) nunca é lido.
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

/** O que a verificação de um token devolve. */
export interface VerifiedToken {
    sub: string;
    emissor: TokenIssuer;
    filiais?: number[];
}

/** Verifica um access token; lança quando ele não é aceito por nenhum dos caminhos configurados. */
export type VerifyAccessToken = (token: string) => Promise<VerifiedToken>;

const BEARER_PREFIX = 'Bearer ';

/** Audiência exigida nos dois caminhos: tokens `anon`/`service_role` usam outras. */
const AUTHENTICATED_AUDIENCE = 'authenticated';

/** Papel Postgres que o GoTrue põe no token de um usuário logado (I8). */
const AUTHENTICATED_ROLE = 'authenticated';

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
 * Extracts the per-filial allow-list from `filiais` or `permissions.filiais` (Regis security-1).
 * Returns `undefined` when the claim is absent — the guard treats that as "not provisioned yet".
 */
const filiaisFromClaims = (payload: JWTPayload): number[] | undefined => {
    const direct = (payload as { filiais?: unknown }).filiais;
    const nested = (payload as { permissions?: { filiais?: unknown } }).permissions?.filiais;
    const raw = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : undefined;
    if (raw === undefined) return undefined;
    return raw.map((v) => Number(v)).filter((n): n is number => Number.isInteger(n) && n > 0);
};

const toVerified = (payload: JWTPayload, emissor: TokenIssuer): VerifiedToken => {
    if (!payload.sub) {
        throw new Error('token sem claim sub');
    }
    const filiais = filiaisFromClaims(payload);
    return {
        sub: String(payload.sub),
        emissor,
        ...(filiais !== undefined ? { filiais } : {}),
    };
};

/** `true` for HMAC algorithms (HS256/384/512) — verified with a shared secret. */
const isSymmetricAlg = (alg?: string): boolean => alg?.startsWith('HS') ?? false;

/**
 * Monta o verificador de access token com **opções separadas por emissor** (ADR-0054, I8). O
 * verificador é escolhido pelo `alg` do cabeçalho; cada caminho só existe se a sua configuração
 * existir:
 *
 * - **app** (`AUTH_JWT_SECRET`): `algorithms: ['HS256']`, `aud = authenticated`, **sem** exigência
 *   de `iss` (o `AuthService` não emite `iss`). Sem o segredo, todo HS256 é recusado.
 * - **supabase** (`SUPABASE_URL`): `algorithms: ['ES256']` via JWKS de `${SUPABASE_URL}/auth/v1`,
 *   `iss = ${SUPABASE_URL}/auth/v1`, `aud = authenticated`, e ainda `role === 'authenticated'` e
 *   `is_anonymous !== true` no payload. Sem a URL, todo token assimétrico é recusado.
 *
 * Corrige o defeito latente da v0.44: o `issuer` era aplicado aos DOIS caminhos, e definir
 * `SUPABASE_URL` recusaria todo token HS256 (que não tem `iss`).
 *
 * `keyResolver` substitui o JWKS remoto nos testes (chave local, sem rede). Exportado para a rota
 * `POST /auth/logout` (D2), que verifica o token sem passar pelo `resolverAcesso`.
 */
export const buildVerifyAccessToken = (
    authEnv: AuthEnv,
    keyResolver?: JWTVerifyGetKey,
): VerifyAccessToken => {
    const issuer = authEnv.supabaseUrl ? `${authEnv.supabaseUrl}/auth/v1` : undefined;
    const jwks: JWTVerifyGetKey | undefined = issuer
        ? (keyResolver ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)))
        : undefined;
    const appKey = authEnv.appJwtSecret
        ? new TextEncoder().encode(authEnv.appJwtSecret)
        : undefined;

    return async (token: string): Promise<VerifiedToken> => {
        const { alg } = decodeProtectedHeader(token);
        if (isSymmetricAlg(alg)) {
            if (!appKey) {
                throw new Error('token HS256 recebido, mas AUTH_JWT_SECRET não está configurado');
            }
            const { payload } = await jwtVerify(token, appKey, {
                algorithms: ['HS256'],
                audience: AUTHENTICATED_AUDIENCE,
            });
            return toVerified(payload, 'app');
        }
        if (!jwks || !issuer) {
            throw new Error('token assimétrico recebido, mas SUPABASE_URL não está configurada');
        }
        const { payload } = await jwtVerify(token, jwks, {
            algorithms: ['ES256'],
            issuer,
            audience: AUTHENTICATED_AUDIENCE,
        });
        if (payload.role !== AUTHENTICATED_ROLE) {
            throw new Error('token Supabase sem role authenticated');
        }
        if (payload.is_anonymous === true) {
            throw new Error('token Supabase de sessão anônima');
        }
        return toVerified(payload, 'supabase');
    };
};

/**
 * Middleware que valida o access token em toda rota depois dele (cards security-1 / security-7).
 *
 * - `devBypass` → no-op (local/dev apenas; o `loadAuthEnv` derruba o boot fora disso).
 * - Token ausente, malformado, expirado, de outro emissor ou com claims fora do esperado → 401
 *   (`'Token expired'` / `'Invalid token'`, textos que o front já trata).
 * - Aceito → `req.user = { sub, emissor, filiais? }`; o `resolverAcesso` o reescreve em seguida.
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

    if (!authEnv.appJwtSecret && !authEnv.supabaseUrl) {
        // Defensivo: o `loadAuthEnv` já garante isto. Mantém o invariante explícito para que uma
        // refatoração futura não desligue a autenticação em silêncio.
        throw new Error(
            'buildAuthMiddleware: AUTH_JWT_SECRET ou SUPABASE_URL é obrigatória sem DEV_AUTH_BYPASS.',
        );
    }

    const verify = buildVerifyAccessToken(authEnv, keyResolver);

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const token = extractBearerToken(req.headers.authorization);
        if (!token) {
            res.status(401).json({ error: 'Missing or malformed Authorization header' });
            return;
        }

        try {
            req.user = await verify(token);
            next();
        } catch (err: unknown) {
            const expired = err instanceof errors.JWTExpired;
            console.warn(
                `[auth] requisição recusada em ${req.method} ${req.originalUrl}:`,
                expired ? 'token expirado' : 'token inválido',
            );
            res.status(401).json({ error: expired ? 'Token expired' : 'Invalid token' });
        }
    };
};
