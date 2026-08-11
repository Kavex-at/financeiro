import { loadAuthEnv } from './authEnv.js';

const URL = 'https://uvfcziscjpapjzpzlzuk.supabase.co';

describe('loadAuthEnv', () => {
    it('parses SUPABASE_URL (preferred, JWKS/ES256) with bypass off', () => {
        const env = loadAuthEnv({ SUPABASE_URL: URL } as NodeJS.ProcessEnv);
        expect(env).toEqual({
            supabaseUrl: URL,
            jwtSecret: undefined,
            serviceRoleKey: undefined,
            anonKey: undefined,
            legacyLoginEnabled: true,
            devBypass: false,
        });
    });

    it('parses AUTH_JWT_SECRET (app login HS256) with bypass off', () => {
        const env = loadAuthEnv({ AUTH_JWT_SECRET: 'app-secret' } as NodeJS.ProcessEnv);
        expect(env).toMatchObject({
            supabaseUrl: undefined,
            jwtSecret: 'app-secret',
            devBypass: false,
        });
    });

    it('prefers AUTH_JWT_SECRET over SUPABASE_JWT_SECRET', () => {
        const env = loadAuthEnv({
            AUTH_JWT_SECRET: 'app-secret',
            SUPABASE_JWT_SECRET: 'legacy',
        } as NodeJS.ProcessEnv);
        expect(env.jwtSecret).toBe('app-secret');
    });

    it('parses a legacy HS256 secret with bypass off', () => {
        const env = loadAuthEnv({ SUPABASE_JWT_SECRET: 'shhh' } as NodeJS.ProcessEnv);
        expect(env).toMatchObject({ supabaseUrl: undefined, jwtSecret: 'shhh', devBypass: false });
    });

    it('keeps both when SUPABASE_URL and SUPABASE_JWT_SECRET are set', () => {
        const env = loadAuthEnv({
            SUPABASE_URL: URL,
            SUPABASE_JWT_SECRET: 'shhh',
        } as NodeJS.ProcessEnv);
        expect(env).toMatchObject({ supabaseUrl: URL, jwtSecret: 'shhh', devBypass: false });
    });

    it('allows missing url/secret when DEV_AUTH_BYPASS=true', () => {
        const env = loadAuthEnv({ DEV_AUTH_BYPASS: 'true' } as NodeJS.ProcessEnv);
        expect(env).toMatchObject({
            supabaseUrl: undefined,
            jwtSecret: undefined,
            devBypass: true,
        });
    });

    it('throws when neither url nor secret and bypass off', () => {
        expect(() => loadAuthEnv({} as NodeJS.ProcessEnv)).toThrow(
            /SUPABASE_URL .* or SUPABASE_JWT_SECRET/,
        );
    });

    it('throws when SUPABASE_URL is not a valid URL', () => {
        expect(() => loadAuthEnv({ SUPABASE_URL: 'not-a-url' } as NodeJS.ProcessEnv)).toThrow();
    });

    it('throws when DEV_AUTH_BYPASS has an invalid value', () => {
        expect(() =>
            loadAuthEnv({ DEV_AUTH_BYPASS: 'yes', SUPABASE_URL: URL } as NodeJS.ProcessEnv),
        ).toThrow();
    });

    it('treats DEV_AUTH_BYPASS=false as bypass off', () => {
        const env = loadAuthEnv({
            SUPABASE_URL: URL,
            DEV_AUTH_BYPASS: 'false',
        } as NodeJS.ProcessEnv);
        expect(env.devBypass).toBe(false);
    });

    // ── Campos novos do cutover (ADR-0030) ────────────────────────────────────────────────
    describe('supabase-auth rollout vars', () => {
        it('parses the Admin API service-role key and the anon key', () => {
            const env = loadAuthEnv({
                SUPABASE_URL: URL,
                SUPABASE_SERVICE_ROLE_KEY: 'sk-service-role',
                SUPABASE_ANON_KEY: 'pk-anon',
            } as NodeJS.ProcessEnv);
            expect(env.serviceRoleKey).toBe('sk-service-role');
            expect(env.anonKey).toBe('pk-anon');
        });

        it('AUTH_LEGACY_LOGIN_ENABLED defaults to TRUE when unset — never lock anyone out', () => {
            // Default-on é deliberado (ADR-0030 §6): uma env var esquecida no Render não pode
            // desligar o único caminho de login de quem ainda não foi migrado.
            const env = loadAuthEnv({ SUPABASE_URL: URL } as NodeJS.ProcessEnv);
            expect(env.legacyLoginEnabled).toBe(true);
        });

        it('AUTH_LEGACY_LOGIN_ENABLED=false is the Phase-3 switch (and "true" turns it back on)', () => {
            expect(
                loadAuthEnv({
                    SUPABASE_URL: URL,
                    AUTH_LEGACY_LOGIN_ENABLED: 'false',
                } as NodeJS.ProcessEnv).legacyLoginEnabled,
            ).toBe(false);
            expect(
                loadAuthEnv({
                    SUPABASE_URL: URL,
                    AUTH_LEGACY_LOGIN_ENABLED: 'true',
                } as NodeJS.ProcessEnv).legacyLoginEnabled,
            ).toBe(true);
        });

        it('throws when AUTH_LEGACY_LOGIN_ENABLED has an invalid value', () => {
            // Fail-fast: um typo não pode ser lido como "false" e derrubar o login legado.
            expect(() =>
                loadAuthEnv({
                    SUPABASE_URL: URL,
                    AUTH_LEGACY_LOGIN_ENABLED: 'no',
                } as NodeJS.ProcessEnv),
            ).toThrow();
        });
    });

    describe('DEV_AUTH_BYPASS × environment guard (security-1)', () => {
        // 'production' é o nome que o Render seta (render.yaml) — a allow-list antiga o deixava ESCAPAR.
        // Deny-by-default: qualquer nome não-local crasha. (security-1/R-5)
        for (const environment of ['prd', 'stg', 'hml', 'production', 'prod', 'Production']) {
            it(`throws at startup when DEV_AUTH_BYPASS=true in ${environment}`, () => {
                expect(() =>
                    loadAuthEnv({
                        DEV_AUTH_BYPASS: 'true',
                        environment,
                    } as NodeJS.ProcessEnv),
                ).toThrow(
                    new RegExp(
                        `DEV_AUTH_BYPASS.*must not be enabled.*environment "${environment}"`,
                    ),
                );
            });
        }

        it('lists the exact deployed environment in the error message', () => {
            expect(() =>
                loadAuthEnv({ DEV_AUTH_BYPASS: 'true', environment: 'prd' } as NodeJS.ProcessEnv),
            ).toThrow(/environment "prd"/);
        });

        it('does NOT throw when DEV_AUTH_BYPASS=true in local', () => {
            const env = loadAuthEnv({
                DEV_AUTH_BYPASS: 'true',
                environment: 'local',
            } as NodeJS.ProcessEnv);
            expect(env.devBypass).toBe(true);
        });

        it('does NOT throw when DEV_AUTH_BYPASS=true and environment is unset (defaults to local)', () => {
            const env = loadAuthEnv({ DEV_AUTH_BYPASS: 'true' } as NodeJS.ProcessEnv);
            expect(env.devBypass).toBe(true);
        });

        it('does NOT throw when DEV_AUTH_BYPASS=true in dev', () => {
            const env = loadAuthEnv({
                DEV_AUTH_BYPASS: 'true',
                environment: 'dev',
            } as NodeJS.ProcessEnv);
            expect(env.devBypass).toBe(true);
        });

        it('does NOT throw in prd when bypass is off and credentials are present', () => {
            const env = loadAuthEnv({
                SUPABASE_URL: URL,
                environment: 'prd',
            } as NodeJS.ProcessEnv);
            expect(env.devBypass).toBe(false);
        });
    });
});
