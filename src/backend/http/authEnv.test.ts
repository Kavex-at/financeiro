import { loadAuthEnv } from './authEnv.js';

/** A var legada do template, que saiu (ADR-0054). Montada para o grep de remoção. */
const SEGREDO_LEGADO = ['SUPABASE', 'JWT', 'SECRET'].join('_');
const URL = 'https://uvfcziscjpapjzpzlzuk.supabase.co';

describe('loadAuthEnv', () => {
    const SUPABASE_COMPLETO = {
        SUPABASE_URL: URL,
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
        SUPABASE_SECRET_KEY: 'sb_secret_y',
    };

    it('modo local (default): AUTH_JWT_SECRET assina e verifica; sem Supabase', () => {
        const env = loadAuthEnv({ AUTH_JWT_SECRET: 'app-secret' } as NodeJS.ProcessEnv);
        expect(env).toEqual({
            provider: 'local',
            appJwtSecret: 'app-secret',
            supabaseUrl: undefined,
            devBypass: false,
        });
    });

    it('modo local com SUPABASE_URL: os dois verificadores ficam abertos (convivência)', () => {
        const env = loadAuthEnv({
            AUTH_PROVIDER: 'local',
            AUTH_JWT_SECRET: 'app-secret',
            SUPABASE_URL: `${URL}/`,
        } as NodeJS.ProcessEnv);
        expect(env).toEqual({
            provider: 'local',
            appJwtSecret: 'app-secret',
            supabaseUrl: URL,
            devBypass: false,
        });
    });

    it('D7: modo local sem AUTH_JWT_SECRET → erro que nomeia a variável', () => {
        expect(() => loadAuthEnv({ AUTH_PROVIDER: 'local' } as NodeJS.ProcessEnv)).toThrow(
            /AUTH_JWT_SECRET/,
        );
        expect(() => loadAuthEnv({} as NodeJS.ProcessEnv)).toThrow(/AUTH_JWT_SECRET/);
    });

    it('D7: modo supabase completo, sem AUTH_JWT_SECRET → ok (caminho HS256 fechado)', () => {
        const env = loadAuthEnv({
            AUTH_PROVIDER: 'supabase',
            ...SUPABASE_COMPLETO,
        } as NodeJS.ProcessEnv);
        expect(env).toEqual({
            provider: 'supabase',
            appJwtSecret: undefined,
            supabaseUrl: URL,
            devBypass: false,
        });
    });

    it('D7: modo supabase com AUTH_JWT_SECRET → caminho HS256 continua aberto (janela)', () => {
        const env = loadAuthEnv({
            AUTH_PROVIDER: 'supabase',
            AUTH_JWT_SECRET: 'app-secret',
            ...SUPABASE_COMPLETO,
        } as NodeJS.ProcessEnv);
        expect(env.appJwtSecret).toBe('app-secret');
    });

    for (const falta of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) {
        it(`D7: modo supabase sem ${falta} → erro que nomeia a variável`, () => {
            const env: Record<string, string> = {
                AUTH_PROVIDER: 'supabase',
                AUTH_JWT_SECRET: 'app-secret',
                ...SUPABASE_COMPLETO,
            };
            delete env[falta];
            expect(() => loadAuthEnv(env as NodeJS.ProcessEnv)).toThrow(new RegExp(falta));
        });
    }

    it('D7: AUTH_PROVIDER fora de local|supabase derruba o boot', () => {
        expect(() =>
            loadAuthEnv({ AUTH_PROVIDER: 'xyz', AUTH_JWT_SECRET: 's' } as NodeJS.ProcessEnv),
        ).toThrow(/AUTH_PROVIDER/);
    });

    it('o segredo HS256 legado do Supabase não é mais lido: sozinho, sem bypass, o boot falha', () => {
        expect(() => loadAuthEnv({ [SEGREDO_LEGADO]: 'legado' } as NodeJS.ProcessEnv)).toThrow(
            /AUTH_JWT_SECRET/,
        );
    });

    it('as mensagens de erro são em português e não imprimem valores', () => {
        const segredo = 'valor-que-nao-pode-vazar';
        try {
            loadAuthEnv({
                AUTH_PROVIDER: 'supabase',
                AUTH_JWT_SECRET: segredo,
                SUPABASE_SECRET_KEY: segredo,
            } as NodeJS.ProcessEnv);
            throw new Error('deveria ter falhado');
        } catch (error) {
            const mensagem = (error as Error).message;
            expect(mensagem).toMatch(/obrigat[óo]ria/i);
            expect(mensagem).not.toContain(segredo);
        }
    });

    it('com DEV_AUTH_BYPASS nada é exigido', () => {
        const env = loadAuthEnv({ DEV_AUTH_BYPASS: 'true' } as NodeJS.ProcessEnv);
        expect(env).toEqual({
            provider: 'local',
            appJwtSecret: undefined,
            supabaseUrl: undefined,
            devBypass: true,
        });
    });

    it('throws when SUPABASE_URL is not a valid URL', () => {
        expect(() =>
            loadAuthEnv({ SUPABASE_URL: 'not-a-url', AUTH_JWT_SECRET: 's' } as NodeJS.ProcessEnv),
        ).toThrow();
    });

    it('throws when DEV_AUTH_BYPASS has an invalid value', () => {
        expect(() =>
            loadAuthEnv({ DEV_AUTH_BYPASS: 'yes', AUTH_JWT_SECRET: 's' } as NodeJS.ProcessEnv),
        ).toThrow();
    });

    it('treats DEV_AUTH_BYPASS=false as bypass off', () => {
        const env = loadAuthEnv({
            AUTH_JWT_SECRET: 's',
            DEV_AUTH_BYPASS: 'false',
        } as NodeJS.ProcessEnv);
        expect(env.devBypass).toBe(false);
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
                AUTH_JWT_SECRET: 's',
                environment: 'prd',
            } as NodeJS.ProcessEnv);
            expect(env.devBypass).toBe(false);
        });
    });
});
