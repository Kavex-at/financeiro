import { z } from 'zod';
import AdminRoleMissingError from '../domain/errors/AdminRoleMissingError.js';
import SupabaseAuthRejectedError from '../domain/errors/SupabaseAuthRejectedError.js';
import SupabaseAuthUnavailableError from '../domain/errors/SupabaseAuthUnavailableError.js';

/** Credenciais do admin semeado, já validadas. */
export interface SeedAdminCredentials {
    email: string;
    password: string;
}

/**
 * O env do `seed-admin` está incompleto ou inválido. A mensagem nomeia as vars e NUNCA carrega o
 * valor delas (a senha acabaria no log do job).
 */
export class MissingSeedAdminEnvError extends Error {
    constructor(problems: string[]) {
        super(`seed-admin: configuração inválida — ${problems.join('; ')}`);
        this.name = 'MissingSeedAdminEnvError';
    }
}

const schema = z.object({
    ADMIN_EMAIL: z
        .string({ required_error: 'ADMIN_EMAIL é obrigatória' })
        .trim()
        .toLowerCase()
        .email('ADMIN_EMAIL inválida: precisa ser um e-mail'),
    ADMIN_PASSWORD: z
        .string({ required_error: 'ADMIN_PASSWORD é obrigatória' })
        .min(8, 'ADMIN_PASSWORD inválida: precisa ter ao menos 8 caracteres'),
});

/**
 * SeedAdminConfig — lê e valida o env do `jobs/seed-admin.ts` (R12, ADR-0051).
 *
 * Sem default de credencial no código (I6): faltando `ADMIN_EMAIL` ou `ADMIN_PASSWORD`, o job
 * termina com erro em vez de semear um admin com senha conhecida. Classe à parte para ser testável
 * sem rodar o job (que conecta no banco no import).
 */
export default class SeedAdminConfig {
    public parse = (env: Record<string, string | undefined>): SeedAdminCredentials => {
        const parsed = schema.safeParse({
            ADMIN_EMAIL: env.ADMIN_EMAIL,
            ADMIN_PASSWORD: env.ADMIN_PASSWORD,
        });
        if (!parsed.success) {
            // Só as mensagens do schema, que são fixas: nenhum valor lido do env entra aqui.
            throw new MissingSeedAdminEnvError(parsed.error.issues.map((i) => i.message));
        }
        return { email: parsed.data.ADMIN_EMAIL, password: parsed.data.ADMIN_PASSWORD };
    };

    /**
     * Mensagem ao operador quando o seed falha. O papel `Administrador` ausente é a 0066 não
     * aplicada neste banco (ADR-0053): o texto diz o que fazer, em vez do erro técnico.
     */
    public mensagemDeFalha = (error: unknown): string => {
        if (error instanceof AdminRoleMissingError) {
            return (
                'o papel "Administrador" não existe neste banco: aplique as migrations ' +
                '(npm run migrate) antes de rodar o seed.'
            );
        }
        if (
            error instanceof SupabaseAuthUnavailableError ||
            error instanceof SupabaseAuthRejectedError
        ) {
            return (
                `Supabase Auth indisponível (${error.message}): o admin ficou gravado no banco, ` +
                'mas não no Supabase Auth. Rode o seed de novo.'
            );
        }
        return error instanceof Error ? error.message : String(error);
    };
}
