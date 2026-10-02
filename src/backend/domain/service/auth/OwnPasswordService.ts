import bcrypt from 'bcryptjs';
import { inject, injectable } from 'tsyringe';
import SupabaseAuthClient from '../../client/SupabaseAuthClient.js';
import CurrentPasswordInvalidError from '../../errors/CurrentPasswordInvalidError.js';
import PasswordPolicyError from '../../errors/PasswordPolicyError.js';
import SupabaseAuthRejectedError from '../../errors/SupabaseAuthRejectedError.js';
import SupabaseAuthUnavailableError from '../../errors/SupabaseAuthUnavailableError.js';
import { LOGOUT_SCOPE } from '../../interface/auth/SupabaseAuth.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import { ACCESS_EVENT_TYPE } from '../../repository/auth/AccessRepository.js';
import UserRepository, { type AppUser } from '../../repository/auth/UserRepository.js';
import LogService from '../LogService.js';
import CredentialMirror, { type PassoEspelho } from './CredentialMirror.js';
import PasswordPolicy from './PasswordPolicy.js';

/** Entrada da troca da própria senha. `username` vem do `req.user.sub` (I2), nunca do corpo. */
export interface OwnPasswordChangeInput {
    username: string;
    senhaAtual: string;
    novaSenha: string;
    /** Bearer do chamador, como chegou (o `auth` já o verificou). */
    tokenDoChamador?: string;
    /** `alg` do cabeçalho desse Bearer: `HS256` = token do app; outro = token do GoTrue. */
    algDoToken?: string;
}

/** O que aconteceu com as OUTRAS sessões do usuário — vai para o log de sucesso. */
const REVOCATION = {
    /** `PUT /user` com o token do chamador: o GoTrue manteve a sessão dele e revogou as outras. */
    GOTRUE_PUT_USER: 'gotrue-put-user',
    /** Token HS256: nada a revogar no GoTrue; outros tokens HS256 vivem até o `exp`. */
    PULADA_HS256: 'pulada-hs256',
    /** Sem `auth_user_id` ou sem a API admin: escrita só local (D3). */
    SEM_VINCULO: 'sem-vinculo',
} as const;
type Revocation = (typeof REVOCATION)[keyof typeof REVOCATION];

/**
 * OwnPasswordService — troca da PRÓPRIA senha pelo usuário autenticado (`POST /me/senha`,
 * ADR-0059), provando a senha atual. Sem permissão de módulo.
 *
 * Ordem: política (nada de bcrypt nem GoTrue antes dela) → carrega o `app_user` → verifica a senha
 * atual pelo modo (`local`: bcrypt; `supabase`: password grant com o e-mail, seguido do logout
 * `scope=local` da sessão-sonda, best-effort) → bcrypt da nova → escrita R6 com o evento da trilha na
 * mesma transação → log de sucesso, sem segredo.
 *
 * Revogação das outras sessões, pelo `alg` do Bearer do chamador (não por `AUTH_PROVIDER`): token
 * do GoTrue → o passo do espelho é `PUT /user` com esse token (mantém a sessão atual, revoga as
 * outras: RAMO = put-user, probe Q1); HS256 → update admin (revoga as sessões do GoTrue, que um
 * chamador HS256 não usa) e os outros tokens HS256 seguem até o `exp`.
 *
 * Não invalida o cache de acesso: senha não muda permissão, e o `ativo` é relido a cada request.
 */
@injectable()
export default class OwnPasswordService {
    /** Custo do bcrypt — o mesmo do cadastro, do reset do admin e do `seed-admin`. */
    private static readonly BCRYPT_ROUNDS = 12;

    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(CredentialMirror)
        private credentialMirror: CredentialMirror,
        @inject(SupabaseAuthClient)
        private supabaseAuthClient: SupabaseAuthClient,
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
        @inject(PasswordPolicy)
        private passwordPolicy: PasswordPolicy,
        @inject(LogService)
        private logService: LogService,
    ) {}

    /**
     * Lança `PasswordPolicyError`, `CurrentPasswordInvalidError` ou `SupabaseAuthUnavailableError`
     * (GoTrue fora, 5xx, timeout ou 429 — `rateLimited`). Em qualquer erro, nada foi gravado.
     */
    public alterar = async (input: OwnPasswordChangeInput): Promise<void> => {
        const regras = this.passwordPolicy.violacoes(input.novaSenha, input.senhaAtual);
        if (regras.length > 0) throw new PasswordPolicyError(regras);

        const usuario = await this.userRepository.findByUsername(input.username);
        if (!usuario) {
            throw new Error(`troca de senha: usuário ${input.username} não encontrado`);
        }
        const { authProvider } = await this.environmentProvider.getEnvironmentVars();
        await this.verificarSenhaAtual(usuario, input.senhaAtual, authProvider);

        const tokenDoGoTrue =
            input.tokenDoChamador !== undefined && input.algDoToken !== 'HS256'
                ? input.tokenDoChamador
                : undefined;
        const passwordHash = await bcrypt.hash(input.novaSenha, OwnPasswordService.BCRYPT_ROUNDS);
        const passo = await this.credentialMirror.preparar({
            tipo: 'senha',
            senha: input.novaSenha,
            ...(tokenDoGoTrue !== undefined ? { tokenDoChamador: tokenDoGoTrue } : {}),
        });
        const ok = await this.gravar(passo, usuario, passwordHash);
        if (!ok) throw new Error(`troca de senha: usuário ${usuario.id} sumiu durante a escrita`);

        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'senha alterada pelo próprio usuário',
            data: {
                usuario: usuario.username,
                modo: authProvider,
                revogacao: this.revogacao(passo, usuario, tokenDoGoTrue),
            },
        });
    };

    /**
     * `supabase` com vínculo e e-mail: password grant (a sonda) e, em seguida, encerra a
     * sessão-sonda. Sem vínculo ou sem e-mail (D3), ou em `local`: bcrypt contra o hash do banco.
     */
    private verificarSenhaAtual = async (
        usuario: AppUser,
        senhaAtual: string,
        authProvider: 'local' | 'supabase',
    ): Promise<void> => {
        if (authProvider !== 'supabase' || !usuario.authUserId || !usuario.email) {
            if (!(await bcrypt.compare(senhaAtual, usuario.passwordHash))) {
                throw new CurrentPasswordInvalidError();
            }
            return;
        }
        let tokenDaSonda: string;
        try {
            tokenDaSonda = (
                await this.supabaseAuthClient.signInWithPassword(usuario.email, senhaAtual)
            ).accessToken;
        } catch (error) {
            if (error instanceof SupabaseAuthRejectedError) throw new CurrentPasswordInvalidError();
            throw error;
        }
        await this.encerrarSonda(usuario, tokenDaSonda);
    };

    /** Best-effort: a sessão-sonda expira sozinha; uma falha aqui não muda a resposta. */
    private encerrarSonda = async (usuario: AppUser, tokenDaSonda: string): Promise<void> => {
        try {
            await this.supabaseAuthClient.logout(tokenDaSonda, LOGOUT_SCOPE.LOCAL);
        } catch (error) {
            await this.logService.warn({
                type: LOG_TYPE.AUTH_INDISPONIVEL,
                message:
                    'troca de senha: falha ao encerrar a sessão de verificação; ela expira sozinha',
                data: {
                    usuario: usuario.username,
                    erro: error instanceof Error ? error.name : 'desconhecido',
                },
            });
        }
    };

    /**
     * Escrita R6: hash + evento + passo do espelho na mesma transação. Se o GoTrue já mudou e a
     * gravação local falhou, `aposFalha` deixa o `AUTH_DIVERGENCIA`. Uma recusa do GoTrue no
     * `PUT /user` (ex.: a sessão do chamador já foi revogada por outra troca) vira indisponível:
     * a transação desfez, nada foi alterado, e a rota responde 503, não 500.
     */
    private gravar = async (
        passo: PassoEspelho,
        usuario: AppUser,
        passwordHash: string,
    ): Promise<boolean> => {
        try {
            return await this.userRepository.updatePassword(usuario.id, passwordHash, {
                antesDoCommit: passo.antesDoCommit,
                evento: {
                    actor: usuario.username,
                    targetId: usuario.id,
                    type: ACCESS_EVENT_TYPE.SENHA,
                    before: null,
                    after: null,
                },
            });
        } catch (error) {
            await this.credentialMirror.aposFalha(passo, usuario.id, error);
            if (error instanceof SupabaseAuthRejectedError) {
                await this.logService.warn({
                    type: LOG_TYPE.AUTH_INDISPONIVEL,
                    message: 'troca de senha: o Supabase Auth recusou a troca; nada foi alterado',
                    data: { usuario: usuario.username, codigo: error.code, status: error.status },
                });
                throw new SupabaseAuthUnavailableError(
                    `Supabase Auth recusou a troca de senha (código ${error.code}).`,
                    'bad_response',
                    error.status,
                );
            }
            throw error;
        }
    };

    private revogacao = (
        passo: PassoEspelho,
        usuario: AppUser,
        tokenDoGoTrue?: string,
    ): Revocation => {
        if (!passo.antesDoCommit || !usuario.authUserId) return REVOCATION.SEM_VINCULO;
        return tokenDoGoTrue !== undefined ? REVOCATION.GOTRUE_PUT_USER : REVOCATION.PULADA_HS256;
    };
}
