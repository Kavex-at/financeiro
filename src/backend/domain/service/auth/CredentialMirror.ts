import { inject, injectable } from 'tsyringe';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import SupabaseAuthClient from '../../client/SupabaseAuthClient.js';
import AuthEmailInUseError from '../../errors/AuthEmailInUseError.js';
import ReactivationRequiresEmailError from '../../errors/ReactivationRequiresEmailError.js';
import SupabaseAuthUnavailableError from '../../errors/SupabaseAuthUnavailableError.js';
import SupabaseEmailConflictError from '../../errors/SupabaseEmailConflictError.js';
import type { SupabaseAdminUser } from '../../interface/auth/SupabaseAuth.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import UserRepository, {
    type AntesDoCommit,
    type CredencialLinha,
} from '../../repository/auth/UserRepository.js';
import LogService from '../LogService.js';

/** As escritas de credencial que o `app_user` projeta no Supabase Auth. */
export type OperacaoCredencial =
    | { tipo: 'criar'; senha: string }
    | { tipo: 'senha'; senha: string }
    | { tipo: 'email' }
    | { tipo: 'desativar' }
    | { tipo: 'reativar' };

/** O que aconteceu no Supabase Auth durante o passo — para o log de divergência pós-commit. */
export interface EstadoEspelho {
    supabaseAlterado: boolean;
    authUserId?: string;
}

/**
 * O passo de uma escrita. `antesDoCommit` ausente = escrita só local (D3). `estado` é preenchido
 * pelo passo e lido por `aposFalha`.
 */
export interface PassoEspelho {
    operacao: OperacaoCredencial['tipo'];
    antesDoCommit?: AntesDoCommit;
    estado: EstadoEspelho;
}

/**
 * CredentialMirror — a ÚNICA classe que decide se uma escrita de credencial é espelhada no Supabase
 * Auth (D3) e a traduz para o `SupabaseAuthClient` (ADR-0057, R6/R7).
 *
 * `app_user` é a fonte da verdade; o GoTrue é projeção da credencial. O passo devolvido roda dentro
 * da transação da escrita local (depois da linha travada e gravada, antes do COMMIT): erro aqui =
 * ROLLBACK, e a rota responde 503 "nada foi alterado". Se o GoTrue mudou e o COMMIT falhou depois,
 * `aposFalha` deixa um `AUTH_DIVERGENCIA` com os ids — o `sync-supabase-auth` repara.
 *
 * - Espelha quando a API admin está configurada (`SUPABASE_URL` + `SUPABASE_SECRET_KEY`), em
 *   qualquer `AUTH_PROVIDER`. Sem ela, a escrita é só local.
 * - Sem vínculo (`auth_user_id`): senha, e-mail e desativar são só locais (o sync importa depois,
 *   com o hash e o e-mail atuais); criar e reativar criam no GoTrue e vinculam.
 * - Senha: o create aceita o bcrypt como está; o update IGNORA `password_hash` em silêncio (T-1),
 *   então a troca de senha manda `password` em claro (TLS backend → Supabase). O bcrypt local
 *   continua sendo gravado (R7): o rollback por configuração segue funcionando.
 * - **Desativar nunca fica bloqueado pelo GoTrue** (decisão do dono do ciclo, 2026-09-30): se o ban
 *   falhar, o `ativo = false` é comitado assim mesmo e fica um `AUTH_DIVERGENCIA`; o sync bane depois.
 *   O corte vale pelo `ativo` lido a cada requisição (≤ 30 s).
 */
@injectable()
export default class CredentialMirror {
    constructor(
        @inject(SupabaseAuthClient)
        private supabaseAuthClient: SupabaseAuthClient,
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(LogService)
        private logService: LogService,
    ) {}

    public preparar = async (operacao: OperacaoCredencial): Promise<PassoEspelho> => {
        const estado: EstadoEspelho = { supabaseAlterado: false };
        if (!(await this.supabaseAuthClient.isAdminConfigured())) {
            return { operacao: operacao.tipo, estado };
        }
        return {
            operacao: operacao.tipo,
            estado,
            antesDoCommit: (tx, linha) => this.espelhar(operacao, tx, linha, estado),
        };
    };

    /** Escrita local falhou (inclusive o COMMIT) depois de o GoTrue ter mudado: divergência. */
    public aposFalha = async (
        passo: PassoEspelho,
        userId: number | undefined,
        error: unknown,
    ): Promise<void> => {
        if (!passo.estado.supabaseAlterado) return;
        await this.logService.error({
            type: LOG_TYPE.AUTH_DIVERGENCIA,
            message:
                'escrita de credencial: o Supabase Auth foi alterado, mas a gravação local falhou; ' +
                'o sync-supabase-auth repara',
            data: {
                userId,
                authUserId: passo.estado.authUserId,
                operacao: passo.operacao,
                erro: error instanceof Error ? error.message : String(error),
            },
        });
    };

    private espelhar = async (
        operacao: OperacaoCredencial,
        tx: TransactionClient,
        linha: CredencialLinha,
        estado: EstadoEspelho,
    ): Promise<void> => {
        switch (operacao.tipo) {
            case 'criar':
                return this.criarEVincular(tx, linha, estado, operacao.senha);
            case 'senha':
                return this.atualizar(linha, estado, { password: operacao.senha });
            case 'email':
                return this.trocarEmail(linha, estado);
            case 'desativar':
                return this.banir(linha, estado);
            case 'reativar':
                return this.reativar(tx, linha, estado);
        }
    };

    private atualizar = async (
        linha: CredencialLinha,
        estado: EstadoEspelho,
        mudanca: { password?: string; banned?: boolean; email?: string },
    ): Promise<void> => {
        if (!linha.authUserId) return;
        await this.supabaseAuthClient.adminUpdateUser(linha.authUserId, mudanca);
        estado.supabaseAlterado = true;
        estado.authUserId = linha.authUserId;
    };

    private trocarEmail = async (linha: CredencialLinha, estado: EstadoEspelho): Promise<void> => {
        if (!linha.authUserId || !linha.email) return;
        try {
            await this.atualizar(linha, estado, { email: linha.email });
        } catch (error) {
            if (error instanceof SupabaseEmailConflictError) throw new AuthEmailInUseError();
            throw error;
        }
    };

    private banir = async (linha: CredencialLinha, estado: EstadoEspelho): Promise<void> => {
        try {
            await this.atualizar(linha, estado, { banned: true });
        } catch (error) {
            // Exceção à R6: desativar nunca é bloqueado pelo GoTrue.
            await this.logService.error({
                type: LOG_TYPE.AUTH_DIVERGENCIA,
                message:
                    'usuário desativado sem ban no Supabase Auth; o sync-supabase-auth aplica o ban',
                data: {
                    userId: linha.id,
                    usuario: linha.username,
                    authUserId: linha.authUserId,
                    erro: error instanceof Error ? error.name : 'desconhecido',
                },
            });
        }
    };

    private reativar = async (
        tx: TransactionClient,
        linha: CredencialLinha,
        estado: EstadoEspelho,
    ): Promise<void> => {
        if (linha.authUserId) {
            await this.atualizar(linha, estado, { banned: false });
            return;
        }
        if (!linha.email) throw new ReactivationRequiresEmailError(linha.id);
        await this.criarEVincular(tx, linha, estado);
    };

    /**
     * Cria no GoTrue com o hash atual e vincula. E-mail já existente no GoTrue: vincula se aquele
     * usuário não pertence a outro `app_user` (execução interrompida, cadastro manual), senão 409.
     * Vinculando, grava a senha quando a temos em claro; sem ela, a senha do GoTrue é mantida.
     */
    private criarEVincular = async (
        tx: TransactionClient,
        linha: CredencialLinha,
        estado: EstadoEspelho,
        senha?: string,
    ): Promise<void> => {
        if (!linha.email) throw new ReactivationRequiresEmailError(linha.id);
        let usuario: SupabaseAdminUser;
        try {
            usuario = await this.supabaseAuthClient.adminCreateUser({
                email: linha.email,
                passwordHash: linha.passwordHash,
            });
        } catch (error) {
            if (!(error instanceof SupabaseEmailConflictError)) throw error;
            usuario = await this.vincularExistente(tx, linha, senha);
        }
        estado.supabaseAlterado = true;
        estado.authUserId = usuario.id;
        await this.userRepository.setAuthUserId(tx, linha.id, usuario.id);
    };

    private vincularExistente = async (
        tx: TransactionClient,
        linha: CredencialLinha,
        senha?: string,
    ): Promise<SupabaseAdminUser> => {
        const existente = await this.supabaseAuthClient.adminFindUserByEmail(linha.email ?? '');
        if (!existente) {
            throw new SupabaseAuthUnavailableError(
                'Supabase Auth acusou e-mail em uso, mas não o encontrou na listagem.',
                'bad_response',
            );
        }
        const dono = await this.userRepository.findIdByAuthUserId(tx, existente.id);
        if (dono !== undefined && dono !== linha.id) throw new AuthEmailInUseError();

        await this.supabaseAuthClient.adminUpdateUser(existente.id, {
            ...(senha !== undefined ? { password: senha } : {}),
            banned: false,
        });
        if (senha === undefined) {
            await this.logService.error({
                type: LOG_TYPE.AUTH_DIVERGENCIA,
                message:
                    'vinculado a um usuário que já existia no Supabase Auth; senha do Supabase Auth ' +
                    'mantida: se o usuário não entrar, redefina a senha',
                data: { userId: linha.id, usuario: linha.username, authUserId: existente.id },
            });
        }
        return existente;
    };
}
