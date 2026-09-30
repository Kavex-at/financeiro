import { inject, injectable } from 'tsyringe';
import SupabaseAuthClient from '../../client/SupabaseAuthClient.js';
import SupabaseAuthNotConfiguredError from '../../errors/SupabaseAuthNotConfiguredError.js';
import type { SupabaseAdminUser } from '../../interface/auth/SupabaseAuth.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import UserRepository, { type UsuarioParaSync } from '../../repository/auth/UserRepository.js';
import LogService from '../LogService.js';

/** Ação planejada para um usuário. O texto é o que aparece no relatório (em português). */
export const ACAO_SYNC = {
    CRIAR: 'criar',
    VINCULAR: 'vincular',
    RECONCILIAR: 'reconciliar',
    OK: 'ok',
    IGNORADO_INATIVO: 'ignorado: inativo',
    IGNORADO_SEM_EMAIL: 'ignorado: sem e-mail',
    ORFAO: 'divergência: vínculo órfão',
    CONFLITO: 'conflito',
} as const;
export type AcaoSync = (typeof ACAO_SYNC)[keyof typeof ACAO_SYNC];

/** Mudanças de reconciliação num usuário já vinculado. */
interface Reconciliacao {
    email?: string;
    banned?: boolean;
}

interface ItemPlano {
    usuario: UsuarioParaSync;
    acao: AcaoSync;
    /** `vincular`: o usuário do GoTrue achado pelo e-mail. */
    alvo?: SupabaseAdminUser;
    /** `reconciliar`: o que muda no GoTrue. */
    mudanca?: Reconciliacao;
    detalhe?: string;
}

export interface LinhaRelatorio {
    username: string;
    email: string;
    acao: string;
    detalhe?: string;
}

export interface ResumoSync {
    criados: number;
    vinculados: number;
    reconciliados: number;
    ignorados: number;
    conflitos: number;
    falhas: number;
}

export interface RelatorioSync {
    urlAlvo: string;
    executado: boolean;
    linhas: LinhaRelatorio[];
    resumo: ResumoSync;
    /** 1 se houver falha ou conflito; 0 caso contrário. */
    codigoSaida: 0 | 1;
    texto: string;
}

const SENHA_MANTIDA = 'senha do Supabase Auth mantida; se não entrar, redefina a senha';

/**
 * SupabaseAuthSyncService — importação dos ativos para o Supabase Auth e reparo de divergência
 * (ADR-0057, R9). É a lógica do `jobs/sync-supabase-auth.ts`.
 *
 * `app_user` é a fonte da verdade de e-mail e `ativo`. Por usuário:
 * - ativo, com e-mail, sem vínculo → acha no GoTrue pelo e-mail: existe e não é de outro
 *   `app_user` → **vincular** (execução interrompida; a senha do GoTrue é mantida porque o update
 *   ignora `password_hash`, T-1); não existe → **criar** com o `password_hash` atual e e-mail
 *   confirmado.
 * - ativo sem e-mail → ignorado; inativo sem vínculo → ignorado (só ativos são importados, Q4).
 * - com vínculo → **reconciliar** e-mail e ban com o `app_user`; vínculo para usuário inexistente
 *   no GoTrue → divergência reportada, não corrigida sozinha.
 * - e-mail do GoTrue já vinculado a OUTRO `app_user` → conflito reportado, não corrigido.
 *
 * Dry-run por default. Idempotente: a segunda execução sobre o resultado da primeira não faz nada.
 * Cada usuário é aplicado sozinho (o vínculo é um UPDATE próprio): uma falha não desfaz os
 * anteriores nem para os seguintes. Nenhuma senha nem hash vai para o relatório.
 */
@injectable()
export default class SupabaseAuthSyncService {
    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(SupabaseAuthClient)
        private supabaseAuthClient: SupabaseAuthClient,
        @inject(EnvironmentProvider)
        private environmentProvider: EnvironmentProvider,
        @inject(LogService)
        private logService: LogService,
    ) {}

    public executar = async ({ execute }: { execute: boolean }): Promise<RelatorioSync> => {
        await this.preChecar();
        const urlAlvo = (await this.environmentProvider.getEnvironmentVars()).supabaseUrl ?? '';
        const plano = this.planejar(
            await this.userRepository.listForAuthSync(),
            await this.supabaseAuthClient.adminListUsers(),
        );

        const resumo: ResumoSync = {
            criados: 0,
            vinculados: 0,
            reconciliados: 0,
            ignorados: 0,
            conflitos: 0,
            falhas: 0,
        };
        const linhas: LinhaRelatorio[] = [];
        for (const item of plano) {
            linhas.push(await this.processar(item, execute, resumo));
        }

        const codigoSaida = resumo.falhas > 0 || resumo.conflitos > 0 ? 1 : 0;
        const relatorio = { urlAlvo, executado: execute, linhas, resumo, codigoSaida } as const;
        await this.logService.info({
            type: LOG_TYPE.AUTH_SESSAO,
            message: `sync-supabase-auth ${execute ? 'executado' : 'em dry-run'}`,
            data: { urlAlvo, ...resumo },
        });
        return { ...relatorio, texto: this.formatar(relatorio) };
    };

    private preChecar = async (): Promise<void> => {
        if (!(await this.userRepository.hasAuthUserIdColumn())) {
            throw new Error(
                'sync-supabase-auth: a coluna app_user.auth_user_id não existe; aplique a migration 0071.',
            );
        }
        if (!(await this.supabaseAuthClient.isAdminConfigured())) {
            throw new SupabaseAuthNotConfiguredError('sync-supabase-auth');
        }
    };

    private planejar = (usuarios: UsuarioParaSync[], goTrue: SupabaseAdminUser[]): ItemPlano[] => {
        const porId = new Map(goTrue.map((u) => [u.id, u]));
        const porEmail = new Map(
            goTrue.filter((u) => u.email).map((u) => [u.email?.toLowerCase() ?? '', u]),
        );
        const donoDoVinculo = new Map(
            usuarios.filter((u) => u.authUserId).map((u) => [u.authUserId ?? '', u.id]),
        );

        return usuarios.map((usuario): ItemPlano => {
            if (usuario.authUserId) {
                const atual = porId.get(usuario.authUserId);
                if (!atual) return { usuario, acao: ACAO_SYNC.ORFAO, detalhe: usuario.authUserId };
                const mudanca = this.reconciliacao(usuario, atual);
                return Object.keys(mudanca).length > 0
                    ? { usuario, acao: ACAO_SYNC.RECONCILIAR, mudanca }
                    : { usuario, acao: ACAO_SYNC.OK };
            }
            return this.planejarSemVinculo(usuario, porEmail, donoDoVinculo);
        });
    };

    /** Usuário ainda sem vínculo: só ativos com e-mail entram (criar ou vincular). */
    private planejarSemVinculo = (
        usuario: UsuarioParaSync,
        porEmail: Map<string, SupabaseAdminUser>,
        donoDoVinculo: Map<string, number>,
    ): ItemPlano => {
        if (!usuario.ativo) return { usuario, acao: ACAO_SYNC.IGNORADO_INATIVO };
        if (!usuario.email) return { usuario, acao: ACAO_SYNC.IGNORADO_SEM_EMAIL };

        const existente = porEmail.get(usuario.email.toLowerCase());
        if (!existente) return { usuario, acao: ACAO_SYNC.CRIAR };
        const dono = donoDoVinculo.get(existente.id);
        if (dono !== undefined && dono !== usuario.id) {
            return {
                usuario,
                acao: ACAO_SYNC.CONFLITO,
                detalhe: `o e-mail já é o login vinculado ao app_user ${dono}`,
            };
        }
        return { usuario, acao: ACAO_SYNC.VINCULAR, alvo: existente, detalhe: SENHA_MANTIDA };
    };

    private reconciliacao = (
        usuario: UsuarioParaSync,
        atual: SupabaseAdminUser,
    ): Reconciliacao => ({
        ...(usuario.email && usuario.email.toLowerCase() !== atual.email?.toLowerCase()
            ? { email: usuario.email }
            : {}),
        ...(!usuario.ativo && !atual.banned ? { banned: true } : {}),
        ...(usuario.ativo && atual.banned ? { banned: false } : {}),
    });

    private processar = async (
        item: ItemPlano,
        execute: boolean,
        resumo: ResumoSync,
    ): Promise<LinhaRelatorio> => {
        const linha: LinhaRelatorio = {
            username: item.usuario.username,
            email: item.usuario.email ?? '-',
            acao: item.acao,
            ...(item.detalhe !== undefined ? { detalhe: item.detalhe } : {}),
        };
        if (item.mudanca) linha.detalhe = this.descrever(item.mudanca);

        if (
            item.acao === ACAO_SYNC.IGNORADO_INATIVO ||
            item.acao === ACAO_SYNC.IGNORADO_SEM_EMAIL
        ) {
            resumo.ignorados++;
            return linha;
        }
        if (item.acao === ACAO_SYNC.ORFAO || item.acao === ACAO_SYNC.CONFLITO) {
            resumo.conflitos++;
            // Uma linha buscável por usuário: o resumo sozinho não diz QUEM diverge.
            await this.logService.error({
                type: LOG_TYPE.AUTH_DIVERGENCIA,
                message: `sync-supabase-auth: ${item.acao} (não corrigido sozinho)`,
                data: {
                    userId: item.usuario.id,
                    usuario: item.usuario.username,
                    ...(item.usuario.authUserId ? { authUserId: item.usuario.authUserId } : {}),
                },
            });
            return linha;
        }
        if (item.acao === ACAO_SYNC.OK) return linha;
        if (!execute) {
            this.contar(item.acao, resumo);
            return linha;
        }

        try {
            await this.aplicar(item);
            this.contar(item.acao, resumo);
        } catch (error) {
            resumo.falhas++;
            linha.acao = `falha ao ${item.acao}`;
            linha.detalhe = error instanceof Error ? error.message : String(error);
            await this.logService.error({
                type: LOG_TYPE.AUTH_DIVERGENCIA,
                message: `sync-supabase-auth: falha ao ${item.acao} um usuário; rode de novo`,
                data: { userId: item.usuario.id, usuario: item.usuario.username },
            });
        }
        return linha;
    };

    /** No dry-run conta o planejado; na execução, o aplicado. */
    private contar = (acao: AcaoSync, resumo: ResumoSync): void => {
        if (acao === ACAO_SYNC.CRIAR) resumo.criados++;
        if (acao === ACAO_SYNC.VINCULAR) resumo.vinculados++;
        if (acao === ACAO_SYNC.RECONCILIAR) resumo.reconciliados++;
    };

    private aplicar = async (item: ItemPlano): Promise<void> => {
        const { usuario } = item;
        if (item.acao === ACAO_SYNC.CRIAR && usuario.email) {
            const criado = await this.supabaseAuthClient.adminCreateUser({
                email: usuario.email,
                passwordHash: usuario.passwordHash,
            });
            await this.userRepository.linkAuthUser(usuario.id, criado.id);
            return;
        }
        if (item.acao === ACAO_SYNC.VINCULAR && item.alvo) {
            if (item.alvo.banned) {
                await this.supabaseAuthClient.adminUpdateUser(item.alvo.id, { banned: false });
            }
            await this.userRepository.linkAuthUser(usuario.id, item.alvo.id);
            return;
        }
        if (item.acao === ACAO_SYNC.RECONCILIAR && usuario.authUserId && item.mudanca) {
            await this.supabaseAuthClient.adminUpdateUser(usuario.authUserId, item.mudanca);
        }
    };

    private descrever = (m: Reconciliacao): string =>
        [
            ...(m.email !== undefined ? [`e-mail → ${m.email}`] : []),
            ...(m.banned === true ? ['banir'] : []),
            ...(m.banned === false ? ['desbanir'] : []),
        ].join(', ');

    private formatar = (r: Omit<RelatorioSync, 'texto'>): string => {
        const linhas = r.linhas.map(
            (l) =>
                `  ${l.username.padEnd(32)} ${l.email.padEnd(36)} ${l.acao}` +
                (l.detalhe ? ` (${l.detalhe})` : ''),
        );
        const { criados, vinculados, reconciliados, ignorados, conflitos, falhas } = r.resumo;
        return [
            `[sync-supabase-auth] alvo: ${r.urlAlvo}`,
            `[sync-supabase-auth] modo: ${r.executado ? 'EXECUÇÃO (--execute)' : 'dry-run'}`,
            ...linhas,
            `[sync-supabase-auth] ${r.executado ? 'resumo' : 'resumo PLANEJADO'}: criados=${criados} vinculados=${vinculados} ` +
                `reconciliados=${reconciliados} ignorados=${ignorados} conflitos=${conflitos} ` +
                `falhas=${falhas}`,
            r.executado
                ? `[sync-supabase-auth] concluído (saída ${r.codigoSaida}).`
                : '[sync-supabase-auth] nada foi alterado (dry-run). Rode com --execute para aplicar.',
        ].join('\n');
    };
}
