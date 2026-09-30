import { inject, injectable } from 'tsyringe';
import SupabaseAuthClient from '../../client/SupabaseAuthClient.js';
import SupabaseAuthRejectedError from '../../errors/SupabaseAuthRejectedError.js';
import type { SupabaseSession } from '../../interface/auth/SupabaseAuth.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import UserRepository, { type AppUser } from '../../repository/auth/UserRepository.js';
import LogService from '../LogService.js';
import type { LoginInput, LoginResult } from './AuthService.js';

/** Código do GoTrue para usuário banido (T-1). */
const GOTRUE_USER_BANNED = 'user_banned';

/**
 * SupabaseSessionService — login, renovação e logout em modo `AUTH_PROVIDER=supabase`, por PROXY
 * no backend (ADR-0057, Q2): o front continua falando só com o nosso `/auth/*`.
 *
 * **Login (R4).** O identificador (e-mail ou username) é resolvido NO NOSSO BANCO antes de qualquer
 * chamada ao GoTrue: nenhum, ambíguo, inativo, sem vínculo (`auth_user_id`) ou sem e-mail → `null`
 * (o mesmo 401 genérico) sem tocar o GoTrue. Só então o GoTrue recebe o E-MAIL do usuário. A sessão
 * devolvida é conferida contra o vínculo (o `sub` tem de ser o `auth_user_id`).
 *
 * **Refresh.** Não checa `ativo`: a próxima requisição checa (≤ 30 s). Resolve `username`/e-mail
 * pelo `auth_user_id` da sessão nova.
 *
 * **Logout.** Melhor esforço: revoga o refresh token da sessão no GoTrue; falha vira aviso.
 *
 * `SupabaseAuthUnavailableError` (GoTrue fora, 5xx, timeout, 429) PROPAGA: a rota decide 503/429.
 * Log em português, com `username`; nunca senha, token, refresh token ou hash.
 */
@injectable()
export default class SupabaseSessionService {
    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(SupabaseAuthClient)
        private supabaseAuthClient: SupabaseAuthClient,
        @inject(LogService)
        private logService: LogService,
    ) {}

    public login = async ({ username, password }: LoginInput): Promise<LoginResult | null> => {
        const user = await this.resolverCandidato(username);
        if (!user?.authUserId || !user.email) return null;

        let sessao: SupabaseSession;
        try {
            sessao = await this.supabaseAuthClient.signInWithPassword(user.email, password);
        } catch (error) {
            if (!(error instanceof SupabaseAuthRejectedError)) throw error;
            if (error.code === GOTRUE_USER_BANNED) {
                await this.divergencia(
                    'login recusado: usuário ativo no banco e banido no Supabase Auth',
                    user,
                );
            }
            return null;
        }

        if (sessao.userId !== user.authUserId) {
            await this.divergencia(
                'login recusado: a sessão do Supabase Auth não é do usuário vinculado',
                user,
                { authUserIdDaSessao: sessao.userId },
            );
            return null;
        }

        await this.logService.info({
            type: LOG_TYPE.AUTH_SESSAO,
            message: 'login pelo Supabase Auth',
            data: { usuario: user.username },
        });
        return this.resultado(sessao, user);
    };

    public refresh = async (refreshToken: string): Promise<LoginResult | null> => {
        let sessao: SupabaseSession;
        try {
            sessao = await this.supabaseAuthClient.refresh(refreshToken);
        } catch (error) {
            if (error instanceof SupabaseAuthRejectedError) return null;
            throw error;
        }

        const user = await this.userRepository.findByAuthUserId(sessao.userId);
        if (!user) {
            await this.logService.error({
                type: LOG_TYPE.AUTH_DIVERGENCIA,
                message:
                    'renovação recusada: sessão do Supabase Auth sem app_user vinculado; ' +
                    'rode o sync-supabase-auth',
                data: { authUserId: sessao.userId },
            });
            return null;
        }
        await this.logService.info({
            type: LOG_TYPE.AUTH_SESSAO,
            message: 'sessão renovada pelo Supabase Auth',
            data: { usuario: user.username },
        });
        return this.resultado(sessao, user);
    };

    public logout = async (accessToken: string, usuario?: string): Promise<void> => {
        try {
            await this.supabaseAuthClient.logout(accessToken);
            await this.logService.info({
                type: LOG_TYPE.AUTH_SESSAO,
                message: 'logout: sessão encerrada no Supabase Auth',
                data: { usuario },
            });
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.AUTH_SESSAO,
                message: 'logout: não foi possível encerrar a sessão no Supabase Auth',
                data: { usuario, erro: error instanceof Error ? error.name : 'desconhecido' },
            });
        }
    };

    /** A única linha ativa que casa o identificador, ou `undefined` (com log na ambiguidade). */
    private resolverCandidato = async (identificador: string): Promise<AppUser | undefined> => {
        const candidatos = await this.userRepository.findByLoginIdentifier(identificador);
        if (candidatos.length > 1) {
            await this.logService.error({
                type: 'BUSINESS_ERROR',
                message:
                    `login recusado: o identificador casa com ${candidatos.length} usuários ` +
                    '(o e-mail de um, o usuário de outro). Corrija o cadastro em /usuarios.',
                statusCode: 401,
                data: { ids: candidatos.map((c) => c.id) },
            });
            return undefined;
        }
        const [user] = candidatos;
        return user?.ativo ? user : undefined;
    };

    private divergencia = async (
        motivo: string,
        user: AppUser,
        extra: Record<string, unknown> = {},
    ): Promise<void> => {
        await this.logService.error({
            type: LOG_TYPE.AUTH_DIVERGENCIA,
            message: `${motivo}; rode o sync-supabase-auth`,
            data: {
                userId: user.id,
                usuario: user.username,
                authUserId: user.authUserId,
                ...extra,
            },
        });
    };

    private resultado = (sessao: SupabaseSession, user: AppUser): LoginResult => ({
        token: sessao.accessToken,
        refreshToken: sessao.refreshToken,
        expiresAt: sessao.expiresAt,
        username: user.username,
        role: user.role,
        ...(user.email !== undefined ? { email: user.email } : {}),
    });
}
