import { z } from 'zod';

/**
 * Variáveis de autenticação, validadas UMA vez no boundary (Zod) — o `process.env` é entrada
 * externa e não é lido cru fora daqui e do `EnvironmentProvider`.
 *
 * Dois emissores de token convivem durante o corte para o Supabase Auth (ADR-0054, I8):
 * - **app** (HS256): o token próprio que o `AuthService` assina com `AUTH_JWT_SECRET`. Aceito
 *   **enquanto `AUTH_JWT_SECRET` existir**; apagar a variável fecha a janela de convivência.
 * - **supabase** (ES256): o token do GoTrue do projeto, verificado pelo JWKS de
 *   `${SUPABASE_URL}/auth/v1`. Aceito **sempre que `SUPABASE_URL` existir**, em qualquer modo.
 *
 * `AUTH_PROVIDER` (`local` | `supabase`, default `local`) decide só QUEM emite no login; o
 * rollback é trocar o valor e reiniciar. Matriz do boot (D7, fail-fast, mensagem em português que
 * nomeia a variável e nunca o valor):
 * - `local` exige `AUTH_JWT_SECRET` (é quem assina);
 * - `supabase` exige `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`;
 *   `AUTH_JWT_SECRET` é opcional (a presença só mantém o caminho HS256 aberto);
 * - com `DEV_AUTH_BYPASS` (só local/dev) nada disso é exigido.
 *
 * `SUPABASE_JWT_SECRET` (legado do template) **não é mais lido**: definido, não reabre nada.
 */
const RawAuthEnvSchema = z.object({
    AUTH_PROVIDER: z
        .enum(['local', 'supabase'], {
            errorMap: () => ({
                message: 'AUTH_PROVIDER inválida: use "local" ou "supabase".',
            }),
        })
        .optional(),
    SUPABASE_URL: z
        .string()
        .url('SUPABASE_URL inválida: precisa ser uma URL.')
        .transform((url) => url.replace(/\/+$/, ''))
        .optional(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_SECRET_KEY: z.string().min(1).optional(),
    AUTH_JWT_SECRET: z.string().min(1).optional(),
    DEV_AUTH_BYPASS: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    // `environment` mirrors `EnvironmentVars.environment` (read raw from
    // `process.env.environment` across the codebase). Free-form string —
    // unset defaults to local, matching EnvironmentProvider.
    environment: z.string().optional(),
});

// Ambientes LOCAIS/DEV onde o bypass de auth é tolerável. DENY-BY-DEFAULT (security-1/R-5): QUALQUER
// outro nome — incl. 'production' (o que o Render seta!), 'prd'/'stg'/'hml', ou um typo — é tratado como
// DEPLOYED, então o boot FALHA se o bypass estiver ligado. A allow-list anterior (['prd','stg','hml'])
// deixava 'production' ESCAPAR → a API financeira poderia subir sem JWT em produção.
const LOCAL_ENVIRONMENTS = ['local', 'dev', 'development', 'test'];

export type AuthProvider = 'local' | 'supabase';

export interface AuthEnv {
    /** Quem emite o token no `POST /auth/login`. Default `local`. */
    provider: AuthProvider;
    /** Segredo HS256 do token próprio. Ausente = caminho HS256 fechado (nenhum token app passa). */
    appJwtSecret?: string;
    /** URL do projeto Supabase (sem barra final). Ausente = caminho ES256 fechado. */
    supabaseUrl?: string;
    /** When true, JWT validation is skipped entirely (local dev only). */
    devBypass: boolean;
}

/** Erro de configuração de boot: a mensagem nomeia as variáveis, nunca os valores. */
export class AuthEnvConfigError extends Error {
    constructor(problemas: string[]) {
        super(`Configuração de autenticação inválida: ${problemas.join('; ')}`);
        this.name = 'AuthEnvConfigError';
    }
}

/**
 * Parses and validates the auth env vars. Throws (fail-fast at startup) when the configuration is
 * incoherent for the chosen `AUTH_PROVIDER` (D7).
 */
export const loadAuthEnv = (env: NodeJS.ProcessEnv = process.env): AuthEnv => {
    const result = RawAuthEnvSchema.safeParse({
        AUTH_PROVIDER: env.AUTH_PROVIDER === '' ? undefined : env.AUTH_PROVIDER,
        SUPABASE_URL: env.SUPABASE_URL === '' ? undefined : env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY || undefined,
        SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY || undefined,
        AUTH_JWT_SECRET: env.AUTH_JWT_SECRET || undefined,
        DEV_AUTH_BYPASS: env.DEV_AUTH_BYPASS,
        environment: env.environment,
    });
    if (!result.success) {
        // Só as mensagens (fixas) e os caminhos: nenhum valor lido do env entra aqui.
        throw new AuthEnvConfigError(
            result.error.issues.map((i) =>
                i.message.includes(String(i.path[0])) ? i.message : `${i.path[0]}: ${i.message}`,
            ),
        );
    }
    const parsed = result.data;
    const provider: AuthProvider = parsed.AUTH_PROVIDER ?? 'local';

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

    if (!parsed.DEV_AUTH_BYPASS) {
        const faltando = obrigatoriasAusentes(provider, parsed);
        if (faltando.length > 0) {
            throw new AuthEnvConfigError(
                faltando.map((nome) => `${nome} é obrigatória com AUTH_PROVIDER=${provider}`),
            );
        }
    }

    return {
        provider,
        appJwtSecret: parsed.AUTH_JWT_SECRET,
        supabaseUrl: parsed.SUPABASE_URL,
        devBypass: parsed.DEV_AUTH_BYPASS,
    };
};

/** D7: as variáveis que o modo exige e que não vieram (nomes, nunca valores). */
const obrigatoriasAusentes = (
    provider: AuthProvider,
    parsed: z.infer<typeof RawAuthEnvSchema>,
): string[] => {
    if (provider === 'local') {
        return parsed.AUTH_JWT_SECRET ? [] : ['AUTH_JWT_SECRET'];
    }
    const exigidas: Array<[string, string | undefined]> = [
        ['SUPABASE_URL', parsed.SUPABASE_URL],
        ['SUPABASE_PUBLISHABLE_KEY', parsed.SUPABASE_PUBLISHABLE_KEY],
        ['SUPABASE_SECRET_KEY', parsed.SUPABASE_SECRET_KEY],
    ];
    return exigidas.filter(([, valor]) => !valor).map(([nome]) => nome);
};
