import { inject, injectable, singleton } from 'tsyringe';
import type { z } from 'zod';
import SupabaseAuthRejectedError from '../errors/SupabaseAuthRejectedError.js';
import SupabaseAuthUnavailableError, {
    type SupabaseAuthUnavailableReason,
} from '../errors/SupabaseAuthUnavailableError.js';
import SupabaseEmailConflictError from '../errors/SupabaseEmailConflictError.js';
import {
    type SupabaseAdminCreateInput,
    type SupabaseAdminUpdateInput,
    type SupabaseAdminUser,
    type SupabaseSession,
    supabaseAdminUserListResponseSchema,
    supabaseAdminUserResponseSchema,
    supabaseErrorResponseSchema,
    supabaseSessionResponseSchema,
} from '../interface/auth/SupabaseAuth.js';
import { LOG_TYPE } from '../interface/log/LogInterface.js';
import EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import RetryExecutor from '../libs/executor/RetryExecutor.js';
import LogService from '../service/LogService.js';

/** Configuração do Supabase lida do `EnvironmentProvider`. */
interface SupabaseConfig {
    authUrl: string;
    publishableKey?: string;
    secretKey?: string;
}

type Acesso = 'publico' | 'admin';

interface Requisicao {
    operacao: string;
    metodo: 'GET' | 'POST' | 'PUT';
    caminho: string;
    acesso: Acesso;
    corpo?: unknown;
    /** Bearer do PRÓPRIO usuário (logout). */
    tokenDoUsuario?: string;
}

interface RespostaBruta {
    status: number;
    corpo: unknown;
}

/**
 * SupabaseAuthClient — HTTP simples para o Supabase Auth (GoTrue) do projeto, sem
 * `@supabase/supabase-js` (ADR-0054, Q8). Zod em toda resposta.
 *
 * - **Público** (login por senha, refresh, logout): cabeçalho `apikey` com a chave publicável.
 *   Chamado PELO BACKEND (proxy); o front não conhece chave nenhuma (I6).
 * - **Admin** (`/admin/users`): `apikey` com a chave secreta e, só quando ela é a legada (JWT
 *   `service_role`), também `Authorization: Bearer` — a `sb_secret_…` no `Authorization` é recusada
 *   pelo gateway (T-1).
 *
 * O env é lido na PRIMEIRA chamada, não no construtor e não no `bootstrapAppContainer` (gotcha dos
 * ~58 jobs: este client só é resolvido por quem precisa dele). Sem configuração, as chamadas
 * lançam "Supabase Auth não configurado" e `isAdminConfigured()` deixa o chamador decidir (D3).
 *
 * Timeout por chamada via `AbortSignal` (sem laço de `setTimeout`). Escrita admin NUNCA é repetida
 * (o create não é idempotente); leitura admin repete em indisponibilidade pelo `RetryExecutor`.
 * Falhas do GoTrue são logadas com operação, status e duração — nunca o corpo (pode ter token),
 * nunca a chave, nunca a senha.
 *
 * Nenhum SQL no schema `auth` (I7): tudo passa pela API.
 */
@singleton()
@injectable()
export default class SupabaseAuthClient {
    /** Limite de cada chamada ao GoTrue. Uma escrita de credencial trava a linha até ele (R6). */
    public static readonly REQUEST_TIMEOUT_MS = 10_000;
    /** Ban "para sempre" (~100 anos, D15); `none` desbane. */
    public static readonly BAN_DURATION = '876000h';
    public static readonly UNBAN_DURATION = 'none';
    /** Página da listagem admin. Com ~15 usuários, uma página basta. */
    public static readonly ADMIN_PAGE_SIZE = 200;
    /** Trava contra paginação sem fim (resposta torta do servidor). */
    private static readonly ADMIN_MAX_PAGES = 50;

    private readonly adminReadRetry = new RetryExecutor({
        retries: 2,
        delayMs: 200,
        shouldLog: false,
        shouldRetry: (error) => error instanceof SupabaseAuthUnavailableError && error.retryable,
    });

    constructor(
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
        @inject(LogService)
        private logService: LogService,
    ) {}

    /** URL e chave secreta presentes: as escritas de credencial são espelhadas no GoTrue (D3). */
    public isAdminConfigured = async (): Promise<boolean> => {
        const config = await this.lerConfig();
        return config !== null && Boolean(config.secretKey);
    };

    public signInWithPassword = async (email: string, password: string): Promise<SupabaseSession> =>
        this.toSession(
            await this.enviar(
                {
                    operacao: 'signInWithPassword',
                    metodo: 'POST',
                    caminho: '/token?grant_type=password',
                    acesso: 'publico',
                    corpo: { email, password },
                },
                supabaseSessionResponseSchema,
            ),
        );

    public refresh = async (refreshToken: string): Promise<SupabaseSession> =>
        this.toSession(
            await this.enviar(
                {
                    operacao: 'refresh',
                    metodo: 'POST',
                    caminho: '/token?grant_type=refresh_token',
                    acesso: 'publico',
                    corpo: { refresh_token: refreshToken },
                },
                supabaseSessionResponseSchema,
            ),
        );

    /** Revoga o refresh token da sessão dona deste access token (`scope=local`). */
    public logout = async (accessToken: string): Promise<void> => {
        await this.enviar({
            operacao: 'logout',
            metodo: 'POST',
            caminho: '/logout?scope=local',
            acesso: 'publico',
            tokenDoUsuario: accessToken,
        });
    };

    public adminCreateUser = async (input: SupabaseAdminCreateInput): Promise<SupabaseAdminUser> =>
        this.toAdminUser(
            await this.enviar(
                {
                    operacao: 'adminCreateUser',
                    metodo: 'POST',
                    caminho: '/admin/users',
                    acesso: 'admin',
                    corpo: {
                        email: input.email,
                        password_hash: input.passwordHash,
                        email_confirm: true,
                        ...(input.banned ? { ban_duration: SupabaseAuthClient.BAN_DURATION } : {}),
                    },
                },
                supabaseAdminUserResponseSchema,
            ),
        );

    public adminUpdateUser = async (
        id: string,
        input: SupabaseAdminUpdateInput,
    ): Promise<SupabaseAdminUser> =>
        this.toAdminUser(
            await this.enviar(
                {
                    operacao: 'adminUpdateUser',
                    metodo: 'PUT',
                    caminho: `/admin/users/${encodeURIComponent(id)}`,
                    acesso: 'admin',
                    corpo: {
                        ...(input.email !== undefined
                            ? { email: input.email, email_confirm: true }
                            : {}),
                        ...(input.password !== undefined ? { password: input.password } : {}),
                        ...(input.banned !== undefined
                            ? {
                                  ban_duration: input.banned
                                      ? SupabaseAuthClient.BAN_DURATION
                                      : SupabaseAuthClient.UNBAN_DURATION,
                              }
                            : {}),
                    },
                },
                supabaseAdminUserResponseSchema,
            ),
        );

    /** `null` quando o GoTrue não conhece o id (404). */
    public adminGetUser = async (id: string): Promise<SupabaseAdminUser | null> =>
        this.adminReadRetry.execute(async () => {
            try {
                return this.toAdminUser(
                    await this.enviar(
                        {
                            operacao: 'adminGetUser',
                            metodo: 'GET',
                            caminho: `/admin/users/${encodeURIComponent(id)}`,
                            acesso: 'admin',
                        },
                        supabaseAdminUserResponseSchema,
                    ),
                );
            } catch (error) {
                if (error instanceof SupabaseAuthRejectedError && error.status === 404) {
                    return null;
                }
                throw error;
            }
        });

    /** Todos os usuários do GoTrue, paginando `GET /admin/users`. */
    public adminListUsers = async (): Promise<SupabaseAdminUser[]> => {
        const todos: SupabaseAdminUser[] = [];
        for (let pagina = 1; pagina <= SupabaseAuthClient.ADMIN_MAX_PAGES; pagina++) {
            const { users } = await this.adminReadRetry.execute(() =>
                this.enviar(
                    {
                        operacao: 'adminListUsers',
                        metodo: 'GET',
                        caminho: `/admin/users?page=${pagina}&per_page=${SupabaseAuthClient.ADMIN_PAGE_SIZE}`,
                        acesso: 'admin',
                    },
                    supabaseAdminUserListResponseSchema,
                ),
            );
            todos.push(...users.map(this.toAdminUser));
            if (users.length < SupabaseAuthClient.ADMIN_PAGE_SIZE) break;
        }
        return todos;
    };

    /** Usuário do GoTrue com este e-mail (sem distinção de caixa), ou `null`. */
    public adminFindUserByEmail = async (email: string): Promise<SupabaseAdminUser | null> => {
        const alvo = email.trim().toLowerCase();
        const usuarios = await this.adminListUsers();
        return usuarios.find((u) => u.email?.toLowerCase() === alvo) ?? null;
    };

    private lerConfig = async (): Promise<SupabaseConfig | null> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        if (!env.supabaseUrl) return null;
        return {
            authUrl: `${env.supabaseUrl.replace(/\/+$/, '')}/auth/v1`,
            publishableKey: env.supabasePublishableKey,
            secretKey: env.supabaseSecretKey,
        };
    };

    private cabecalhos = (config: SupabaseConfig, req: Requisicao): Record<string, string> => {
        const chave = req.acesso === 'admin' ? config.secretKey : config.publishableKey;
        if (!chave) {
            const variavel =
                req.acesso === 'admin' ? 'SUPABASE_SECRET_KEY' : 'SUPABASE_PUBLISHABLE_KEY';
            throw new SupabaseAuthUnavailableError(
                `Supabase Auth não configurado: defina ${variavel}.`,
                'not_configured',
            );
        }
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            apikey: chave,
        };
        if (req.tokenDoUsuario !== undefined) {
            headers.authorization = `Bearer ${req.tokenDoUsuario}`;
        } else if (req.acesso === 'admin' && chave.startsWith('eyJ')) {
            // Chave legada (JWT service_role): o GoTrue a lê do Authorization.
            headers.authorization = `Bearer ${chave}`;
        }
        return headers;
    };

    private enviar: {
        (req: Requisicao): Promise<unknown>;
        <T>(req: Requisicao, schema: z.ZodType<T>): Promise<T>;
    } = async <T>(req: Requisicao, schema?: z.ZodType<T>): Promise<T | unknown> => {
        const config = await this.lerConfig();
        if (config === null) {
            throw new SupabaseAuthUnavailableError(
                'Supabase Auth não configurado: defina SUPABASE_URL.',
                'not_configured',
            );
        }
        const headers = this.cabecalhos(config, req);
        const inicio = Date.now();
        const bruta = await this.buscar(config, req, headers, inicio);
        if (bruta.status >= 200 && bruta.status < 300) {
            if (schema === undefined) return bruta.corpo;
            const parsed = schema.safeParse(bruta.corpo);
            if (parsed.success) return parsed.data;
            await this.logarFalha(req, bruta.status, inicio, 'bad_response');
            throw new SupabaseAuthUnavailableError(
                `Supabase Auth devolveu uma resposta inesperada em ${req.operacao}.`,
                'bad_response',
                bruta.status,
            );
        }
        throw await this.erroDaResposta(req, bruta, inicio);
    };

    private buscar = async (
        config: SupabaseConfig,
        req: Requisicao,
        headers: Record<string, string>,
        inicio: number,
    ): Promise<RespostaBruta> => {
        try {
            const res = await fetch(`${config.authUrl}${req.caminho}`, {
                method: req.metodo,
                headers,
                body: req.corpo === undefined ? undefined : JSON.stringify(req.corpo),
                signal: AbortSignal.timeout(SupabaseAuthClient.REQUEST_TIMEOUT_MS),
            });
            const texto = await res.text();
            return { status: res.status, corpo: this.jsonOuNada(texto) };
        } catch (error) {
            const timeout = (error as { name?: unknown } | null)?.name === 'TimeoutError';
            const reason: SupabaseAuthUnavailableReason = timeout ? 'timeout' : 'unreachable';
            await this.logarFalha(req, undefined, inicio, reason);
            throw new SupabaseAuthUnavailableError(
                timeout
                    ? `Supabase Auth não respondeu dentro do tempo limite (${SupabaseAuthClient.REQUEST_TIMEOUT_MS} ms) em ${req.operacao}.`
                    : `Supabase Auth inalcançável em ${req.operacao}.`,
                reason,
            );
        }
    };

    private erroDaResposta = async (
        req: Requisicao,
        bruta: RespostaBruta,
        inicio: number,
    ): Promise<Error> => {
        const erro = supabaseErrorResponseSchema.safeParse(bruta.corpo);
        const code = (erro.success ? (erro.data.error_code ?? erro.data.error) : undefined) ?? '-';
        if (bruta.status === 429) {
            await this.logarFalha(req, bruta.status, inicio, 'rate_limited', code);
            return new SupabaseAuthUnavailableError(
                `Supabase Auth recusou por limite de taxa em ${req.operacao}.`,
                'rate_limited',
                bruta.status,
            );
        }
        if (bruta.status >= 500) {
            await this.logarFalha(req, bruta.status, inicio, 'server_error', code);
            return new SupabaseAuthUnavailableError(
                `Supabase Auth respondeu ${bruta.status} em ${req.operacao}.`,
                'server_error',
                bruta.status,
            );
        }
        if (bruta.status === 422 && code === 'email_exists') {
            return new SupabaseEmailConflictError();
        }
        return new SupabaseAuthRejectedError(code, bruta.status);
    };

    private logarFalha = async (
        req: Requisicao,
        status: number | undefined,
        inicio: number,
        motivo: SupabaseAuthUnavailableReason,
        codigo?: string,
    ): Promise<void> => {
        try {
            await this.logService.warn({
                type: LOG_TYPE.AUTH_INDISPONIVEL,
                message: `falha ao chamar o Supabase Auth (${req.operacao}): ${motivo}`,
                data: {
                    operacao: req.operacao,
                    ...(status !== undefined ? { status } : {}),
                    duracaoMs: Date.now() - inicio,
                    motivo,
                    ...(codigo !== undefined ? { codigo } : {}),
                },
            });
        } catch {
            // Logar é best-effort: a falha original sobe de qualquer jeito.
        }
    };

    private jsonOuNada = (texto: string): unknown => {
        if (texto === '') return undefined;
        try {
            return JSON.parse(texto);
        } catch {
            return undefined;
        }
    };

    private toSession = (r: z.infer<typeof supabaseSessionResponseSchema>): SupabaseSession => ({
        accessToken: r.access_token,
        refreshToken: r.refresh_token,
        expiresAt: r.expires_at ?? Math.floor(Date.now() / 1000) + r.expires_in,
        userId: r.user.id,
        ...(r.user.email ? { email: r.user.email } : {}),
    });

    private toAdminUser = (
        r: z.infer<typeof supabaseAdminUserResponseSchema>,
    ): SupabaseAdminUser => ({
        id: r.id,
        ...(r.email ? { email: r.email } : {}),
        banned:
            typeof r.banned_until === 'string' && new Date(r.banned_until).getTime() > Date.now(),
    });
}
