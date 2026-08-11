import { z } from 'zod';

/**
 * Zod schema for the authentication-related environment variables. Validated
 * once at boundary (per repo convention: external inputs — including
 * `process.env` — are parsed with Zod, never read raw).
 *
 * Arch-review cards security-1 (Microsoft/Azure AD auth via Supabase) and
 * security-7 (backend JWT validation on every API route).
 *
 * The middleware picks the verifier PER TOKEN by its `alg` header, so BOTH
 * vars may be set at once — the project can sign HS256 today and ES256
 * tomorrow (a Supabase signing-key rotation) without a redeploy:
 * - `SUPABASE_URL` — the Supabase project URL (e.g. `https://<ref>.supabase.co`).
 *   Enables ASYMMETRIC (ES256/RS256) verification against the project's JWKS
 *   (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`), with issuer
 *   `${SUPABASE_URL}/auth/v1`. Also supplies the issuer enforced on the HS256
 *   path. Required for projects whose current signing key is asymmetric.
 * - `SUPABASE_JWT_SECRET` — the HS256 shared signing secret (Supabase →
 *   Settings → API → JWT Keys / Legacy JWT Secret). Enables SYMMETRIC (HS256)
 *   verification. HS256 keys are never published in a JWKS, so this is the only
 *   way to verify HS256 login tokens. Can be set ALONGSIDE `SUPABASE_URL`.
 * - `DEV_AUTH_BYPASS` — when `'true'`, the JWT middleware is skipped. Default
 *   off; must never be `'true'` in a deployed environment.
 *
 * At least one of `SUPABASE_URL` or `SUPABASE_JWT_SECRET` is required UNLESS
 * `DEV_AUTH_BYPASS` is on, so local dev can run before credentials are
 * provisioned. Set BOTH to accept either signing scheme.
 */
const RawAuthEnvSchema = z.object({
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_JWT_SECRET: z.string().min(1).optional(),
    // HS256 secret for the app's own login JWTs (simple username/password auth,
    // no Supabase). Preferred over SUPABASE_JWT_SECRET when both are set. The
    // AuthService signs with it; the middleware verifies HS256 tokens with it.
    AUTH_JWT_SECRET: z.string().min(1).optional(),
    // Service-role key da Admin API do GoTrue (convite, criação, ban, reset). Ela IGNORA RLS
    // e pode criar usuários: vive SÓ no backend, NUNCA como `NEXT_PUBLIC_*` (ADR-0030 §4).
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    // Chave pública (anon) — publicável; aqui só para paridade de configuração.
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    // Botão de ROLLBACK da Fase 3 do cutover (ADR-0030 §6). Default `true` durante o rollout:
    // desligar o login legado enquanto houver `app_user` com `auth_user_id IS NULL` deixa esse
    // usuário SEM NENHUM caminho de login. O gate é `listPendingMigration()` vazio.
    AUTH_LEGACY_LOGIN_ENABLED: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v !== 'false'),
    DEV_AUTH_BYPASS: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    // `environment` mirrors `EnvironmentVars.environment` (read raw from
    // `process.env.environment` across the codebase). Free-form string —
    // unset defaults to local, matching EnvironmentProvider.
    environment: z.string().optional(),
});

/**
 * Deployed (non-local) environments where authentication must always be
 * enforced. If `DEV_AUTH_BYPASS=true` reaches any of these, startup must fail
 * loudly instead of booting an unauthenticated API. Arch-review card security-1.
 */
// Ambientes LOCAIS/DEV onde o bypass de auth é tolerável. DENY-BY-DEFAULT (security-1/R-5): QUALQUER
// outro nome — incl. 'production' (o que o Render seta!), 'prd'/'stg'/'hml', ou um typo — é tratado como
// DEPLOYED, então o boot FALHA se o bypass estiver ligado. A allow-list anterior (['prd','stg','hml'])
// deixava 'production' ESCAPAR → a API financeira poderia subir sem JWT em produção.
const LOCAL_ENVIRONMENTS = ['local', 'dev', 'development', 'test'];

export interface AuthEnv {
    /**
     * Supabase project URL used to derive the JWKS URI and issuer for
     * asymmetric (ES256) verification. Preferred over `jwtSecret`.
     */
    supabaseUrl?: string;
    /** Legacy HS256 secret used to verify Supabase-issued JWTs. */
    jwtSecret?: string;
    /**
     * GoTrue Admin API key. Backend-only — it bypasses RLS and can create users, so it must
     * never be exposed as `NEXT_PUBLIC_*` (ADR-0030 §4). `redactBody` masks it in logs.
     */
    serviceRoleKey?: string;
    /** Public (anon) key. Publishable; kept here only for configuration parity. */
    anonKey?: string;
    /**
     * Rollout Phase-3 rollback switch (ADR-0030 §6). `false` disables `POST /auth/login`.
     * Defaults to **true** so an unset variable never locks anyone out mid-rollout; turning
     * it off is gated on `listPendingMigration()` being empty.
     */
    legacyLoginEnabled: boolean;
    /** When true, JWT validation is skipped entirely (local dev only). */
    devBypass: boolean;
}

/**
 * Parses and validates the auth env vars. Throws (fail-fast at startup) when
 * the configuration is incoherent — e.g. JWT validation is enabled but neither
 * a JWKS URL nor a legacy secret was provided.
 */
export const loadAuthEnv = (env: NodeJS.ProcessEnv = process.env): AuthEnv => {
    const parsed = RawAuthEnvSchema.parse({
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
        AUTH_JWT_SECRET: env.AUTH_JWT_SECRET,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
        SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
        AUTH_LEGACY_LOGIN_ENABLED: env.AUTH_LEGACY_LOGIN_ENABLED,
        DEV_AUTH_BYPASS: env.DEV_AUTH_BYPASS,
        environment: env.environment,
    });

    // The app signs its own login tokens with AUTH_JWT_SECRET (simple
    // username/password auth). It is the HS256 secret used to BOTH sign and
    // verify those tokens; SUPABASE_JWT_SECRET is the legacy fallback.
    const jwtSecret = parsed.AUTH_JWT_SECRET ?? parsed.SUPABASE_JWT_SECRET;

    // Fail-fast: DEV_AUTH_BYPASS disables JWT validation entirely, so it must never reach a deployed
    // environment. Crossing the bypass flag with the running environment turns a silent unauthenticated
    // boot into a startup crash. DENY-BY-DEFAULT (security-1/R-5): só ambiente LOCAL/DEV (ou `environment`
    // não setado = local) tolera o bypass; qualquer outro nome (incl. 'production') CRASHA.
    const envName = (parsed.environment ?? '').trim().toLowerCase();
    const isLocalEnvironment = envName === '' || LOCAL_ENVIRONMENTS.includes(envName);
    if (parsed.DEV_AUTH_BYPASS && !isLocalEnvironment) {
        throw new Error(
            `DEV_AUTH_BYPASS must not be enabled outside a local/dev environment ` +
                `(environment "${parsed.environment}"). It disables all JWT validation and would leave ` +
                `the API open. Unset DEV_AUTH_BYPASS (or set it to false) for any deployed environment.`,
        );
    }

    if (!parsed.DEV_AUTH_BYPASS && !parsed.SUPABASE_URL && !jwtSecret) {
        throw new Error(
            'AUTH_JWT_SECRET (app login HS256) or SUPABASE_URL (JWKS/ES256) or ' +
                'SUPABASE_JWT_SECRET (legacy HS256) is required unless DEV_AUTH_BYPASS=true.',
        );
    }

    return {
        supabaseUrl: parsed.SUPABASE_URL,
        jwtSecret,
        serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
        anonKey: parsed.SUPABASE_ANON_KEY,
        legacyLoginEnabled: parsed.AUTH_LEGACY_LOGIN_ENABLED,
        devBypass: parsed.DEV_AUTH_BYPASS,
    };
};
