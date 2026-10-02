import { z } from 'zod';

/**
 * Contratos do Supabase Auth (GoTrue) que o `SupabaseAuthClient` aceita — Zod na borda: resposta
 * 2xx fora deste formato vira erro, nunca "sucesso parcial". Formatos conferidos no GoTrue v2.197
 * pelo spike T-1 (`jobs/probe-gotrue-local.ts`, ADR-0057).
 */

/** `POST /token?grant_type=password|refresh_token` → sessão. */
export const supabaseSessionResponseSchema = z.object({
    access_token: z.string().min(1),
    refresh_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    /** Segundos desde a época. Ausente em versões antigas: calculado pelo `expires_in`. */
    expires_at: z.number().int().positive().optional(),
    user: z.object({
        id: z.string().uuid(),
        email: z.string().nullable().optional(),
    }),
});

/** Usuário da API admin (`/admin/users`, `/admin/users/:id`). */
export const supabaseAdminUserResponseSchema = z.object({
    id: z.string().uuid(),
    email: z.string().nullable().optional(),
    banned_until: z.string().nullable().optional(),
});

/** `GET /admin/users?page&per_page`. */
export const supabaseAdminUserListResponseSchema = z.object({
    users: z.array(supabaseAdminUserResponseSchema),
});

/** Corpo de erro do GoTrue: formato novo (`error_code`/`msg`) ou OAuth (`error`). */
export const supabaseErrorResponseSchema = z
    .object({
        error_code: z.string().optional(),
        error: z.string().optional(),
    })
    .passthrough();

/**
 * Escopo do `POST /logout` do GoTrue: `local` encerra só a sessão dona do token; `others` encerra
 * as OUTRAS sessões do usuário e mantém a dele. Sempre destas constantes, nunca do request.
 */
export const LOGOUT_SCOPE = {
    LOCAL: 'local',
    OTHERS: 'others',
} as const;
export type LogoutScope = (typeof LOGOUT_SCOPE)[keyof typeof LOGOUT_SCOPE];

/** Sessão devolvida ao nosso login/refresh. */
export interface SupabaseSession {
    accessToken: string;
    refreshToken: string;
    /** Segundos desde a época (D10). */
    expiresAt: number;
    /** `sub` do token = `auth.users.id` = `app_user.auth_user_id`. */
    userId: string;
    email?: string;
}

/** Usuário do GoTrue como o domínio precisa dele. */
export interface SupabaseAdminUser {
    id: string;
    email?: string;
    /** `banned_until` no futuro. */
    banned: boolean;
}

export interface SupabaseAdminCreateInput {
    email: string;
    /** bcrypt `$2a$12$…` — o create aceita o hash como está (T-1). */
    passwordHash: string;
    banned?: boolean;
}

/**
 * Update admin. `password` vai EM CLARO (TLS backend → Supabase): o GoTrue v2.197 ignora
 * `password_hash` no update em silêncio (responde 200 sem efeito — T-1). O bcrypt local continua
 * sendo gravado pelo nosso lado (R7).
 */
export interface SupabaseAdminUpdateInput {
    email?: string;
    password?: string;
    banned?: boolean;
}
