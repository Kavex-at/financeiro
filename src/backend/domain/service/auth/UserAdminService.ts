import bcrypt from 'bcryptjs';
import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import RoleNotFoundError from '../../errors/RoleNotFoundError.js';
import {
    ADMIN_ROLE_NAME,
    PERMISSION_CATALOG,
    type Permission,
    type PermissionException,
    type RoleRef,
    type ValidPermissionException,
    exceptionEffectSchema,
    isPermission,
} from '../../interface/auth/Permission.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import SecretCipher from '../../libs/crypto/SecretCipher.js';
import AccessRepository, {
    ACCESS_EVENT_TYPE,
    type AccessEventType,
    REPLACE_EXCEPTIONS_RESULT,
    type RoleWithPermissions,
    SET_ROLE_RESULT,
} from '../../repository/auth/AccessRepository.js';
import UserRepository, {
    type AppUserPublic,
    DEACTIVATE_RESULT,
    REACTIVATE_RESULT,
    SET_EMAIL_RESULT,
} from '../../repository/auth/UserRepository.js';
import LogService from '../LogService.js';
import AccessService from './AccessService.js';
import CredentialMirror, { type PassoEspelho } from './CredentialMirror.js';
import EffectivePermissionCalculator from './EffectivePermissionCalculator.js';

/** Custo do bcrypt — espelha o `seed-admin` (BCRYPT_ROUNDS = 12). */
const BCRYPT_ROUNDS = 12;

/**
 * Valor do `role` que o front da v0.43 manda ao criar um admin (D2). Aceito como alias do papel
 * `Administrador` só na janela de deploy; sai com a coluna `role` no passo 3.
 */
const LEGACY_ADMIN_ROLE = 'admin';

const MENSAGEM_PAPEL_OBRIGATORIO = 'Atualize a página para escolher o papel do usuário.';

/** E-mail no boundary: aparado, minúsculo e válido (I4). */
const emailField = z.string().trim().toLowerCase().email('E-mail inválido.');

/**
 * Vínculo Conexos no boundary: login + senha em CLARO (o service cifra). Ambos
 * juntos, ou nenhum. `conexosPassword` vazio no PATCH = manter a senha atual.
 */
export const vinculoConexosSchema = z.object({
    conexosUsername: z.string().trim().min(1),
    conexosPassword: z.string().min(1),
});

/** Entrada validada da criação. `papelId` OU `usarAdministrador` (alias do front antigo, D2). */
export interface CreateUserInput {
    email: string;
    password: string;
    papelId?: number;
    usarAdministrador?: boolean;
    conexosUsername?: string;
    conexosPassword?: string;
}

/**
 * Zod no boundary — criação de usuário (e-mail + senha + papel + vínculo opcional).
 *
 * O usuário novo nasce com `username = email` (R6) e o papel ESCOLHIDO (`papelId`, sem default —
 * Q3). `username` continua aceito como ALIAS de `email`: o front antigo (Vercel) ainda o envia na
 * janela entre os dois deploys. Os dois juntos com valores diferentes são recusados — não há como
 * saber qual o admin quis.
 *
 * Janela de deploy (D2): sem `papelId`, `role: 'admin'` vira o papel `Administrador`; qualquer
 * outra coisa (o default do diálogo antigo, ou nada) é 400 pedindo para atualizar.
 */
export const createUserSchema = z
    .object({
        email: emailField.optional(),
        username: emailField.optional(),
        password: z.string().min(8, 'a senha deve ter ao menos 8 caracteres'),
        papelId: z.number().int().positive().optional(),
        role: z.string().optional(),
        conexosUsername: z.string().trim().min(1).optional(),
        conexosPassword: z.string().min(1).optional(),
    })
    .superRefine((input, ctx) => {
        if (input.email === undefined && input.username === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Informe o e-mail.' });
        }
        if (
            input.email !== undefined &&
            input.username !== undefined &&
            input.email !== input.username
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'E-mail e usuário informados são diferentes.',
            });
        }
        if (input.papelId === undefined && input.role !== LEGACY_ADMIN_ROLE) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: MENSAGEM_PAPEL_OBRIGATORIO });
        }
    })
    .transform(
        ({ email, username, role: _role, papelId, ...rest }): CreateUserInput => ({
            ...rest,
            // O refine garante que ao menos um existe; `?? ''` só satisfaz o tipo.
            email: email ?? username ?? '',
            ...(papelId !== undefined ? { papelId } : { usarAdministrador: true }),
        }),
    );

/** Zod no boundary — troca de papel. */
export const setRoleSchema = z.object({ papelId: z.number().int().positive() });

/**
 * Zod no boundary — conjunto de exceções do usuário. `permissao` validada contra o catálogo
 * (R4) e cada uma no máximo uma vez (a PK do banco é `(user_id, permission)`).
 */
export const exceptionsBodySchema = z
    .object({
        excecoes: z.array(z.object({ permissao: z.string(), efeito: exceptionEffectSchema })),
    })
    .superRefine((body, ctx) => {
        if (body.excecoes.some((e) => !isPermission(e.permissao))) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Permissão desconhecida.' });
            return;
        }
        const vistas = new Set(body.excecoes.map((e) => e.permissao));
        if (vistas.size !== body.excecoes.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'Cada permissão pode aparecer uma vez só.',
            });
        }
    })
    .transform((body) => ({
        excecoes: body.excecoes.flatMap((e): ValidPermissionException[] =>
            isPermission(e.permissao) ? [{ permissao: e.permissao, efeito: e.efeito }] : [],
        ),
    }));

/** Usuário para a tela de gestão: o público + papel, exceções e efetivas (D6). */
export interface AppUserWithAccess extends AppUserPublic {
    excecoes?: PermissionException[];
    permissoesEfetivas?: Permission[];
}

/** Papéis para o seletor da tela, mais o catálogo (o front não duplica a lista). */
export interface RolesListing {
    papeis: RoleWithPermissions[];
    catalogo: Permission[];
}

/**
 * Zod no boundary — edição do e-mail de login. Só `email`: campos extras (ex.: `username`) são
 * descartados, porque nenhuma rota edita `username` (I1).
 */
export const setEmailSchema = z.object({ email: emailField });

/** Zod no boundary — redefinição de senha. */
export const resetPasswordSchema = z.object({
    password: z.string().min(8, 'a senha deve ter ao menos 8 caracteres'),
});

/**
 * UserAdminService — gestão de usuários da plataforma (Fatia A) e do acesso deles (ADR-0053).
 *
 * Encapsula as regras de cadastro: valida o input (Zod), gera o hash bcrypt da senha (nunca guarda
 * a senha em claro) e delega a persistência aos repositórios. A AUTORIZAÇÃO (`usuarios:gerenciar`)
 * é feita no route; este service assume que o chamador já foi autorizado.
 *
 * Escritas de CREDENCIAL (criar, senha, e-mail, ativo) são espelhadas no Supabase Auth pelo
 * `CredentialMirror` (R6, ADR-0057): o passo roda dentro da transação local, antes do commit.
 *
 * Toda escrita que muda acesso (papel, exceções, ativo, criação) chama `AccessService.invalidar`
 * DEPOIS do commit — a próxima requisição do alvo relê o banco — e emite uma linha de log em
 * português com ator, alvo, tipo e antes → depois (R12). A trilha durável é o
 * `app_user_access_event`, gravado pelos repositórios na transação da escrita.
 */
@injectable()
export default class UserAdminService {
    constructor(
        @inject(UserRepository)
        private userRepository: UserRepository,
        @inject(AccessRepository)
        private accessRepository: AccessRepository,
        @inject(EffectivePermissionCalculator)
        private calculator: EffectivePermissionCalculator,
        @inject(AccessService)
        private accessService: AccessService,
        @inject(SecretCipher)
        private secretCipher: SecretCipher,
        @inject(LogService)
        private logService: LogService,
        @inject(CredentialMirror)
        private credentialMirror: CredentialMirror,
    ) {}

    /**
     * Lista todos os usuários (sem hash de senha), cada um com papel, exceções e permissões
     * efetivas calculadas aqui (D6). Uma consulta de usuários e UMA de acesso, sem N+1. `role`
     * continua no JSON para o front antigo.
     */
    public list = async (): Promise<AppUserWithAccess[]> => {
        const [users, accessById] = await Promise.all([
            this.userRepository.listAll(),
            this.accessRepository.listAccessForUsers(),
        ]);
        return users.map((user) => {
            const access = accessById.get(user.id);
            if (!access) return user;
            return {
                ...user,
                papel: access.papel,
                excecoes: access.excecoes,
                permissoesEfetivas: this.efetivas(access.pacote, access.excecoes),
            };
        });
    };

    /** Papéis com seus pacotes, e o catálogo inteiro. */
    public listarPapeis = async (): Promise<RolesListing> => ({
        papeis: await this.accessRepository.listRoles(),
        catalogo: [...PERMISSION_CATALOG],
    });

    /**
     * Troca o papel do usuário (guarda R9/R-extra no repositório). Mesmo papel = sucesso sem
     * mudança. Lança `RoleNotFoundError`, NOT_FOUND (usuário), `LastUserManagerError` ou
     * `SelfAccessRemovalError`.
     */
    public atribuirPapel = async (
        id: number,
        papelId: number,
        ator: string,
    ): Promise<{ id: number; papel: RoleRef }> => {
        const outcome = await this.accessRepository.setRole(id, papelId, ator);
        if (outcome.result === SET_ROLE_RESULT.ROLE_NOT_FOUND) throw new RoleNotFoundError(papelId);
        if (outcome.result === SET_ROLE_RESULT.USER_NOT_FOUND || !outcome.after) {
            throw new Error(`NOT_FOUND: user ${id} not found`);
        }
        if (outcome.result === SET_ROLE_RESULT.UPDATED) {
            this.accessService.invalidar(id);
            await this.logarMudanca(
                ator,
                id,
                ACCESS_EVENT_TYPE.PAPEL,
                outcome.before,
                outcome.after,
            );
        }
        return { id, papel: outcome.after };
    };

    /**
     * Substitui o conjunto de exceções do usuário (guarda R9/R-extra no repositório). Devolve as
     * exceções gravadas e as efetivas relidas depois do commit.
     */
    public definirExcecoes = async (
        id: number,
        excecoes: ValidPermissionException[],
        ator: string,
    ): Promise<{
        id: number;
        excecoes: PermissionException[];
        permissoesEfetivas: Permission[];
    }> => {
        const outcome = await this.accessRepository.replaceExceptions(id, excecoes, ator);
        if (outcome.result === REPLACE_EXCEPTIONS_RESULT.NOT_FOUND) {
            throw new Error(`NOT_FOUND: user ${id} not found`);
        }
        if (outcome.result === REPLACE_EXCEPTIONS_RESULT.UPDATED) {
            this.accessService.invalidar(id);
            await this.logarMudanca(
                ator,
                id,
                ACCESS_EVENT_TYPE.EXCECAO,
                outcome.before,
                outcome.after,
            );
        }
        const access = await this.accessRepository.findAccessByUserId(id);
        if (!access) throw new Error(`NOT_FOUND: user ${id} not found`);
        return {
            id,
            excecoes: access.excecoes,
            permissoesEfetivas: this.efetivas(access.pacote, access.excecoes),
        };
    };

    /**
     * Cria um usuário com `username = email` e o papel escolhido. `createdBy` = username de quem
     * cria (auditoria e ator do evento). Papel inexistente: `RoleNotFoundError`, antes de gravar.
     * Se o input trouxer `conexosUsername` + `conexosPassword`, grava o vínculo Conexos já na
     * criação (senha cifrada). Ambos juntos, ou nenhum. Colisão com o e-mail ou o usuário de outro:
     * `EmailAlreadyInUseError`.
     */
    public create = async (input: CreateUserInput, createdBy: string): Promise<AppUserPublic> => {
        const role =
            input.papelId !== undefined
                ? await this.accessRepository.findRoleById(input.papelId)
                : await this.accessRepository.findRoleByName(ADMIN_ROLE_NAME);
        if (!role) throw new RoleNotFoundError(input.papelId ?? 0);

        const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
        const passo = await this.credentialMirror.preparar({
            tipo: 'criar',
            senha: input.password,
        });
        const created = await this.comEspelho(passo, undefined, () =>
            this.userRepository.create(
                { email: input.email, passwordHash, roleId: role.id, createdBy },
                passo.antesDoCommit,
            ),
        );
        this.accessService.invalidar(created.id);
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: 'usuário criado com papel',
            data: {
                ator: createdBy,
                alvo: created.id,
                tipo: ACCESS_EVENT_TYPE.PAPEL,
                antes: null,
                depois: { id: role.id, nome: role.nome },
            },
        });
        if (input.conexosUsername && input.conexosPassword) {
            await this.setVinculo(created.id, {
                conexosUsername: input.conexosUsername,
                conexosPassword: input.conexosPassword,
            });
            return { ...created, conexosUsername: input.conexosUsername };
        }
        return created;
    };

    /**
     * Grava o e-mail de login de um usuário, com o admin que editou (`updatedBy`) na trilha.
     * Gravar o mesmo valor é no-op. Lança NOT_FOUND para id inexistente e `EmailAlreadyInUseError`
     * quando o valor já identifica outro usuário.
     */
    public setEmail = async (id: number, email: string, updatedBy: string): Promise<void> => {
        const passo = await this.credentialMirror.preparar({ tipo: 'email' });
        const result = await this.comEspelho(passo, id, () =>
            this.userRepository.setEmail(id, email, updatedBy, passo.antesDoCommit),
        );
        if (result === SET_EMAIL_RESULT.NOT_FOUND) {
            throw new Error(`NOT_FOUND: user ${id} not found`);
        }
        if (result === SET_EMAIL_RESULT.UPDATED) {
            await this.logService.info({
                type: 'BUSINESS_INFO',
                message: 'e-mail de login do usuário atualizado',
                data: { id, ator: updatedBy },
            });
        }
    };

    /**
     * Define (ou limpa, com `vinculo=null`) o vínculo Conexos de um usuário. A
     * senha é CIFRADA (AES-GCM) antes de persistir — nunca em claro. Lança se a
     * chave de cripto não estiver configurada (`MissingEncryptionKeyError`) ou o
     * id não existir.
     */
    public setVinculo = async (
        id: number,
        vinculo: { conexosUsername: string; conexosPassword: string } | null,
    ): Promise<void> => {
        if (vinculo === null) {
            const ok = await this.userRepository.setVinculoConexos(id, null);
            if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
            return;
        }
        const conexosPasswordEnc = await this.secretCipher.encrypt(vinculo.conexosPassword);
        const ok = await this.userRepository.setVinculoConexos(id, {
            conexosUsername: vinculo.conexosUsername,
            conexosPasswordEnc,
        });
        if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
    };

    /** True quando a cripto está configurada (habilita o cadastro de vínculo na UI). */
    public vinculoDisponivel = async (): Promise<boolean> => this.secretCipher.isEnabled();

    /**
     * Ativa/desativa o acesso de um usuário. Desativar passa pela guarda R9/R-extra (nem o próprio
     * acesso, nem o último usuário ativo com `usuarios:gerenciar`), com `actorUsername` = quem
     * pede. Reativar não passa, mas grava o evento. Nas duas direções o cache do alvo é invalidado:
     * desativado, a próxima requisição dele já dá 401. Lança NOT_FOUND se o id não existir.
     */
    public setAtivo = async (id: number, ativo: boolean, actorUsername: string): Promise<void> => {
        if (!ativo) {
            const passo = await this.credentialMirror.preparar({ tipo: 'desativar' });
            const result = await this.comEspelho(passo, id, () =>
                this.userRepository.deactivateGuarded(id, actorUsername, passo.antesDoCommit),
            );
            if (result === DEACTIVATE_RESULT.NOT_FOUND) {
                throw new Error(`NOT_FOUND: user ${id} not found`);
            }
            this.accessService.invalidar(id);
            await this.logarMudanca(actorUsername, id, ACCESS_EVENT_TYPE.ATIVO, true, false);
            return;
        }
        const passo = await this.credentialMirror.preparar({ tipo: 'reativar' });
        const result = await this.comEspelho(passo, id, () =>
            this.userRepository.reactivate(id, actorUsername, passo.antesDoCommit),
        );
        if (result === REACTIVATE_RESULT.NOT_FOUND)
            throw new Error(`NOT_FOUND: user ${id} not found`);
        this.accessService.invalidar(id);
        if (result === REACTIVATE_RESULT.REACTIVATED) {
            await this.logarMudanca(actorUsername, id, ACCESS_EVENT_TYPE.ATIVO, false, true);
        }
    };

    /**
     * Redefine a senha de um usuário. Lança se o id não existir. Grava o bcrypt local e, com vínculo,
     * a mesma senha no Supabase Auth (R7; em claro, porque o update ignora `password_hash` — T-1).
     */
    public resetPassword = async (id: number, password: string): Promise<void> => {
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const passo = await this.credentialMirror.preparar({ tipo: 'senha', senha: password });
        const ok = await this.comEspelho(passo, id, () =>
            this.userRepository.updatePassword(id, passwordHash, passo.antesDoCommit),
        );
        if (!ok) throw new Error(`NOT_FOUND: user ${id} not found`);
    };

    /**
     * Roda a escrita local com o passo de espelhamento (R6). Se ela falhar DEPOIS de o Supabase Auth
     * ter mudado (commit, vínculo), deixa o `AUTH_DIVERGENCIA` para o sync reparar, e o erro sobe.
     */
    private comEspelho = async <T>(
        passo: PassoEspelho,
        userId: number | undefined,
        escrita: () => Promise<T>,
    ): Promise<T> => {
        try {
            return await escrita();
        } catch (error) {
            await this.credentialMirror.aposFalha(passo, userId, error);
            throw error;
        }
    };

    /** Efetivas ordenadas — sempre pelo `EffectivePermissionCalculator` (I7). */
    private efetivas = (
        pacote: readonly string[],
        excecoes: readonly PermissionException[],
    ): Permission[] => [...this.calculator.calcular(pacote, excecoes).permissoes].sort();

    /** Uma linha de log por mudança de acesso, em português (R12). */
    private logarMudanca = async (
        ator: string,
        alvo: number,
        tipo: AccessEventType,
        antes: unknown,
        depois: unknown,
    ): Promise<void> => {
        await this.logService.info({
            type: LOG_TYPE.BUSINESS_INFO,
            message: `acesso do usuário alterado: ${tipo}`,
            data: { ator, alvo, tipo, antes, depois },
        });
    };
}
