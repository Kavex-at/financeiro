import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';

/**
 * Usuário do GoTrue (`auth.users`) — o **custodiante da credencial**, não a entidade de
 * domínio. O `Usuario` da ontologia é a linha `app_user` (ADR-0030 / `entities/usuario.md`).
 */
export interface GoTrueUser {
    id: string;
    email?: string;
    /** Momento em que o titular confirmou o e-mail — a prova de que o convite foi ACEITO. */
    emailConfirmedAt?: string;
    /** Preenchido quando o convite foi enviado; some quando o titular conclui o cadastro. */
    invitedAt?: string;
    bannedUntil?: string;
}

/**
 * O provedor disse "esse usuário não existe" — semanticamente diferente de "não consegui
 * falar com o provedor". A distinção é o que permite ao service decidir entre compensar e
 * abortar: tratar indisponibilidade como inexistência apagaria a linha errada.
 */
export class SupabaseUserNotFoundError extends Error {
    constructor(reference: string) {
        super(`NOT_FOUND: GoTrue user ${reference} does not exist`);
        this.name = 'SupabaseUserNotFoundError';
    }
}

/** Falha de transporte/5xx/configuração da Admin API. NUNCA significa "não existe". */
export class SupabaseAdminError extends Error {
    public readonly operation: string;

    constructor(operation: string, cause: string) {
        super(`SUPABASE_ADMIN_FAILED: ${operation} — ${cause}`);
        this.name = 'SupabaseAdminError';
        this.operation = operation;
    }
}

/** O e-mail já existe no GoTrue. O route traduz para 409 (nunca duplicata). */
export class SupabaseEmailAlreadyExistsError extends Error {
    constructor(email: string) {
        super(`CONFLICT: GoTrue user with email ${email} already exists`);
        this.name = 'SupabaseEmailAlreadyExistsError';
    }
}

/**
 * Zod no boundary — a resposta da Admin API é **input externo**, como qualquer outro. Campos
 * desconhecidos passam; o que consumimos é validado.
 */
const goTrueUserSchema = z
    .object({
        id: z.string().min(1),
        email: z.string().optional(),
        email_confirmed_at: z.string().nullish(),
        invited_at: z.string().nullish(),
        banned_until: z.string().nullish(),
    })
    .passthrough();

const toGoTrueUser = (raw: unknown): GoTrueUser => {
    const parsed = goTrueUserSchema.parse(raw);
    return {
        id: parsed.id,
        ...(parsed.email ? { email: parsed.email } : {}),
        ...(parsed.email_confirmed_at ? { emailConfirmedAt: parsed.email_confirmed_at } : {}),
        ...(parsed.invited_at ? { invitedAt: parsed.invited_at } : {}),
        ...(parsed.banned_until ? { bannedUntil: parsed.banned_until } : {}),
    };
};

/** Marcadores de "não existe" nas mensagens do GoTrue (a Admin API não expõe um código estável). */
const NOT_FOUND_MARKERS = ['user not found', 'not_found', 'user_not_found'];

/** Marcadores de "e-mail já registrado". */
const ALREADY_EXISTS_MARKERS = [
    'already registered',
    'already been registered',
    'email_exists',
    'user_already_exists',
    'duplicate key',
];

const hasMarker = (message: string, markers: string[]): boolean => {
    const lower = message.toLowerCase();
    return markers.some((m) => lower.includes(m));
};

/** Ban "para sempre" que o GoTrue aceita — reversível pelo unban (`'none'`). */
const BAN_FOREVER = '876000h';

/**
 * `SupabaseAdminClient` — a superfície da Admin API do GoTrue usada pela gestão de usuários.
 *
 * A service-role key **ignora RLS e pode criar usuários**: ela vive **só no backend**, lida
 * via `EnvironmentProvider` (nunca `process.env` cru), **nunca** como `NEXT_PUBLIC_*`, e é
 * mascarada por `redactBody` (ADR-0030 §4).
 *
 * ## ⚠️ `deleteUser` é EXCLUSIVO de compensação transacional
 *
 * Hard delete de usuário é **proibido** (I-Usuario-3): a saída de um usuário é
 * `ativo = false`, jamais `DELETE` — senão a trilha de auditoria deixa de ser **resolvível**
 * (as colunas são `TEXT` sem FK, então nada quebraria *sintaticamente*, e é justamente por
 * isso que a regra precisa ser explícita).
 *
 * A única exceção é o rollback do cadastro (U1/U3), quando ainda **não houve nenhuma ação
 * atribuída** ao usuário. Sem essa compensação, um passo local que falha deixa um **órfão no
 * GoTrue** e o **e-mail fica queimado** para um cadastro futuro (`auth.users.email` é único)
 * — sintoma que aparece semanas depois como "não consigo cadastrar essa pessoa", sem rastro
 * da causa.
 *
 * **`deleteUser` não é exposto em rota** — há teste-guarda para isso.
 */
@singleton()
@injectable()
export default class SupabaseAdminClient {
    private client?: SupabaseClient;

    constructor(
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
    ) {}

    /**
     * Cliente admin (lazy). Falha alto e claro quando a configuração está ausente: um
     * cadastro que "não faz nada" silenciosamente é pior do que um que recusa.
     */
    private getClient = async (): Promise<SupabaseClient> => {
        if (this.client) return this.client;
        const env = await this.environmentProvider.getEnvironmentVars();
        if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
            throw new SupabaseAdminError(
                'getClient',
                'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the GoTrue Admin API',
            );
        }
        this.client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });
        return this.client;
    };

    /**
     * Traduz `{ data, error }` da Admin API para exceção tipada. A distinção entre
     * "não existe", "já existe" e "falhou" é o contrato de que o service depende.
     */
    private unwrap = (
        operation: string,
        result: { data: unknown; error: unknown },
    ): { user?: unknown } => {
        const error = result.error as { message?: string; status?: number } | null;
        if (error) {
            const message = error.message ?? 'unknown error';
            if (hasMarker(message, ALREADY_EXISTS_MARKERS)) {
                throw new SupabaseEmailAlreadyExistsError(operation);
            }
            if (error.status === 404 || hasMarker(message, NOT_FOUND_MARKERS)) {
                throw new SupabaseUserNotFoundError(operation);
            }
            throw new SupabaseAdminError(operation, message);
        }
        return (result.data ?? {}) as { user?: unknown };
    };

    /**
     * **U1 — caminho padrão.** Cria o usuário e dispara o e-mail de convite; o titular define
     * a própria senha, e **nenhum humano além dele a conhece**. É o que sustenta atribuir uma
     * baixa `fin010` a uma pessoa. **Depende de SMTP** — daí existir o fallback U3.
     */
    public inviteByEmail = async (email: string): Promise<GoTrueUser> => {
        const client = await this.getClient();
        const data = this.unwrap(
            `inviteByEmail(${email})`,
            await client.auth.admin.inviteUserByEmail(email),
        );
        return toGoTrueUser(data.user);
    };

    /**
     * **U3 — fallback sem SMTP.** O admin define a senha inicial e o usuário nasce confirmado
     * (`email_confirm: true`), portanto **`ativo`**: não há aceite a esperar, a credencial já
     * existe. O custo reconhecido é que um humano além do titular conhece a senha inicial —
     * por isso este é o caminho SECUNDÁRIO.
     */
    public createUser = async (input: { email: string; password: string }): Promise<GoTrueUser> => {
        const client = await this.getClient();
        const data = this.unwrap(
            `createUser(${input.email})`,
            await client.auth.admin.createUser({
                email: input.email,
                password: input.password,
                email_confirm: true,
            }),
        );
        return toGoTrueUser(data.user);
    };

    /**
     * Migração (Fase 1): cria o usuário **reaproveitando o hash bcrypt existente**. É isto que
     * evita o lockout geral no cutover — ninguém precisa trocar de senha para continuar
     * trabalhando (o GoTrue também usa bcrypt).
     *
     * ⚠️ Modo de falha provável: o hash é **aceito mas não confere**, e ninguém descobre até o
     * primeiro login. Validar numa conta de teste **antes** de rodar em todo mundo.
     */
    public createUserWithPasswordHash = async (input: {
        email: string;
        passwordHash: string;
    }): Promise<GoTrueUser> => {
        const client = await this.getClient();
        const data = this.unwrap(
            `createUserWithPasswordHash(${input.email})`,
            await client.auth.admin.createUser({
                email: input.email,
                password_hash: input.passwordHash,
                email_confirm: true,
            } as Parameters<SupabaseClient['auth']['admin']['createUser']>[0]),
        );
        return toGoTrueUser(data.user);
    };

    /**
     * Estado do usuário no provedor. **É o que prova o aceite do convite (U2)**: apresentar um
     * JWT válido NÃO é prova — o próprio link de convite abre sessão no GoTrue antes de a
     * senha existir. Confirmação no provedor é.
     *
     * `null` quando não existe (a ausência é resposta legítima, não erro).
     */
    public getUserById = async (id: string): Promise<GoTrueUser | null> => {
        const client = await this.getClient();
        try {
            const data = this.unwrap(`getUserById(${id})`, await client.auth.admin.getUserById(id));
            return data.user ? toGoTrueUser(data.user) : null;
        } catch (err) {
            if (err instanceof SupabaseUserNotFoundError) return null;
            throw err;
        }
    };

    /** Atualiza atributos do usuário no provedor (e-mail, metadata, senha). */
    public updateUserById = async (
        id: string,
        attributes: Record<string, unknown>,
    ): Promise<GoTrueUser> => {
        const client = await this.getClient();
        const data = this.unwrap(
            `updateUserById(${id})`,
            await client.auth.admin.updateUserById(id, attributes),
        );
        return toGoTrueUser(data.user);
    };

    /**
     * **Barreira 2 da revogação** (I-Usuario-8): impede **renovar** o refresh token / abrir
     * sessão nova — efeito imediato. A barreira 1 (`ativo = false` local) é a que barra cada
     * request, com latência ≤ TTL. Falhar aqui é **sucesso parcial**, não erro duro.
     */
    public setBanned = async (id: string, banned: boolean): Promise<GoTrueUser> =>
        this.updateUserById(id, { ban_duration: banned ? BAN_FOREVER : 'none' });

    /**
     * Dispara o e-mail de recuperação de senha. **Depende de SMTP** — e aqui, diferente do
     * cadastro, **não há fallback**: voltar a gravar hash local reintroduziria exatamente o
     * problema que a mudança resolve (um admin conhecer a senha de outra pessoa).
     */
    public sendRecoveryLink = async (email: string): Promise<void> => {
        const client = await this.getClient();
        const result = await client.auth.resetPasswordForEmail(email);
        this.unwrap(`sendRecoveryLink(${email})`, { data: result.data, error: result.error });
    };

    /**
     * ⚠️ **COMPENSAÇÃO TRANSACIONAL APENAS** (I-Usuario-3). Ver a doc da classe: hard delete
     * é proibido; esta chamada existe só para desfazer um cadastro cuja gravação local
     * falhou, quando nenhuma ação foi atribuída ao usuário. **Não é exposta em rota.**
     */
    public deleteUser = async (id: string): Promise<void> => {
        const client = await this.getClient();
        this.unwrap(`deleteUser(${id})`, await client.auth.admin.deleteUser(id));
    };
}
