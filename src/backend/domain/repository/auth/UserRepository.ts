import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import AdminRoleMissingError from '../../errors/AdminRoleMissingError.js';
import EmailAlreadyInUseError from '../../errors/EmailAlreadyInUseError.js';
import { ADMIN_ROLE_NAME, type RoleRef } from '../../interface/auth/Permission.js';
import AccessRepository, { ACCESS_EVENT_TYPE } from './AccessRepository.js';

/** Linha de `app_user` mapeada para o domínio (camelCase). */
export interface AppUser {
    id: number;
    username: string;
    passwordHash: string;
    role: string;
    ativo: boolean;
    /** E-mail de login (ADR-0051). Ausente = pendente de cadastro pelo admin. */
    email?: string;
    /** `auth.users.id` do usuário no Supabase Auth (ADR-0054). Ausente = ainda sem vínculo. */
    authUserId?: string;
}

/** Usuário para exibição/gestão (SEM o hash de senha — nunca sai do backend). */
export interface AppUserPublic {
    id: number;
    username: string;
    role: string;
    ativo: boolean;
    createdBy?: string;
    createdAt: string;
    /** Login Conexos vinculado (ex.: MARILYN_MUTAFCI). Ausente = sem vínculo (opera via robô). */
    conexosUsername?: string;
    /** E-mail de login. Ausente = pendente (a tela destaca). */
    email?: string;
    /** `username` do admin que gravou o e-mail por último. */
    emailUpdatedBy?: string;
    /** Quando o e-mail foi gravado por último (ISO). */
    emailUpdatedAt?: string;
    /** Papel do usuário (ADR-0053). Presente na criação; a lista o acrescenta no service (D6). */
    papel?: RoleRef;
}

/** Vínculo Conexos do usuário — login + senha CIFRADA (nunca em claro). */
export interface ConexosVinculo {
    conexosUsername: string;
    conexosPasswordEnc: string;
}

/** Resultado de `setEmail`. Colisão não é resultado: é `EmailAlreadyInUseError`. */
export const SET_EMAIL_RESULT = {
    UPDATED: 'updated',
    UNCHANGED: 'unchanged',
    NOT_FOUND: 'not_found',
} as const;
export type SetEmailResult = (typeof SET_EMAIL_RESULT)[keyof typeof SET_EMAIL_RESULT];

/** Resultado de `deactivateGuarded`. As recusas da guarda são erros tipados. */
export const DEACTIVATE_RESULT = {
    DEACTIVATED: 'deactivated',
    NOT_FOUND: 'not_found',
} as const;
export type DeactivateResult = (typeof DEACTIVATE_RESULT)[keyof typeof DEACTIVATE_RESULT];

/** Resultado de `reactivate`. Reativar não passa pela guarda: só acrescenta acesso. */
export const REACTIVATE_RESULT = {
    REACTIVATED: 'reactivated',
    UNCHANGED: 'unchanged',
    NOT_FOUND: 'not_found',
} as const;
export type ReactivateResult = (typeof REACTIVATE_RESULT)[keyof typeof REACTIVATE_RESULT];

/** `auth.users.id` é UUID; qualquer outra coisa nem chega ao SQL. */
const uuidSchema = z.string().uuid();

/** SQLSTATE de violação de unicidade (`uq_app_user_email_lower` / `uq_app_user_username_lower`). */
const UNIQUE_VIOLATION = '23505';

/** SQLSTATE de tabela inexistente — `app_role` antes da 0066. */
const UNDEFINED_TABLE = '42P01';

interface AppUserRow {
    id: number;
    username: string;
    password_hash: string;
    role: string;
    ativo: boolean;
    email?: string | null;
    auth_user_id?: string | null;
}

/**
 * UserRepository — acesso à tabela `app_user` (login simples usuário/senha).
 *
 * SQL 100% parametrizado (`$nome` via SqlBuilder — Rule #5, zero interpolação).
 */
@injectable()
export default class UserRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
        @inject(AccessRepository)
        private accessRepository: AccessRepository,
    ) {}

    /** Busca um usuário pelo `username` EXATO. `null` quando não existe. */
    public findByUsername = async (username: string): Promise<AppUser | null> => {
        const row = await this.databaseClient.selectFirst<AppUserRow>(
            `SELECT id, username, password_hash, role, ativo
             FROM app_user
             WHERE username = $username`,
            { username },
        );
        if (!row) return null;
        return this.toAppUser(row);
    };

    /**
     * Todas as linhas cujo `username` OU `email` casa com o identificador, sem distinção de caixa.
     *
     * Devolve a LISTA de propósito: decidir o que fazer com duas linhas (ambiguidade) é regra de
     * autenticação, e mora no `AuthService`, não aqui.
     */
    public findByLoginIdentifier = async (identifier: string): Promise<AppUser[]> => {
        const rows: AppUserRow[] = await this.databaseClient.selectMany(
            `SELECT id, username, password_hash, role, ativo, email, auth_user_id
             FROM app_user
             WHERE lower(username) = $identifier OR lower(email) = $identifier`,
            { identifier: identifier.toLowerCase() },
        );
        return rows.map(this.toAppUser);
    };

    /**
     * O usuário vinculado a um usuário do Supabase Auth (`auth_user_id`, ADR-0054). UUID malformado
     * = `null` sem consultar o banco. Não filtra `ativo`: quem chama decide.
     */
    public findByAuthUserId = async (authUserId: string): Promise<AppUser | null> => {
        if (!uuidSchema.safeParse(authUserId).success) return null;
        const row = await this.databaseClient.selectFirst<AppUserRow>(
            `SELECT id, username, password_hash, role, ativo, email, auth_user_id
             FROM app_user
             WHERE auth_user_id = $authUserId`,
            { authUserId },
        );
        return row ? this.toAppUser(row) : null;
    };

    /** Lista todos os usuários (sem o hash) — mais recentes primeiro. Gestão pela UI. */
    public listAll = async (): Promise<AppUserPublic[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT id, username, role, ativo, created_by, created_at, conexos_username,
                    email, email_updated_by, email_updated_at
             FROM app_user
             ORDER BY created_at DESC, id DESC`,
        );
        return rows.map((r) => ({
            id: Number(r.id),
            username: String(r.username),
            role: String(r.role),
            ativo: Boolean(r.ativo),
            ...(r.created_by != null ? { createdBy: String(r.created_by) } : {}),
            createdAt: new Date(r.created_at).toISOString(),
            ...(r.conexos_username != null ? { conexosUsername: String(r.conexos_username) } : {}),
            ...(r.email != null ? { email: String(r.email) } : {}),
            ...(r.email_updated_by != null ? { emailUpdatedBy: String(r.email_updated_by) } : {}),
            ...(r.email_updated_at != null
                ? { emailUpdatedAt: new Date(r.email_updated_at).toISOString() }
                : {}),
        }));
    };

    /**
     * Cria um novo usuário com `username = email` (R6) e o papel escolhido (`role_id`, ADR-0053).
     * A coluna `role` não é escrita (D3): o `DEFAULT 'admin'` da 0007 a preenche, e nenhum guard a
     * lê. Lança `EmailAlreadyInUseError` quando o valor já é o `email` ou o `username` de outro
     * usuário: o `NOT EXISTS` barra no mesmo statement, o `ON CONFLICT DO NOTHING` cobre o
     * `username` idêntico e o índice em `lower()` cobre a corrida (23505).
     *
     * Grava, na mesma transação, o evento `papel` com `antes = null` (D5): criar é mudança de
     * acesso (R12).
     */
    public create = async (input: {
        email: string;
        passwordHash: string;
        roleId: number;
        createdBy: string;
    }): Promise<AppUserPublic> =>
        this.databaseClient.withTransaction(async (tx) => {
            const row = await tx
                .selectFirst<{
                    id: number;
                    username: string;
                    email: string | null;
                    role: string;
                    ativo: boolean;
                    created_by: string | null;
                    created_at: string;
                }>(
                    `INSERT INTO app_user (username, email, password_hash, role_id, created_by)
                     SELECT $email, $email, $passwordHash, $roleId, $createdBy
                     WHERE NOT EXISTS (
                         SELECT 1 FROM app_user o
                         WHERE lower(o.email) = $email OR lower(o.username) = $email
                     )
                     ON CONFLICT (username) DO NOTHING
                     RETURNING id, username, email, role, ativo, created_by, created_at`,
                    {
                        email: input.email,
                        passwordHash: input.passwordHash,
                        roleId: input.roleId,
                        createdBy: input.createdBy,
                    },
                )
                .catch((error: unknown) => this.rethrowUniqueViolation(error, input.email));
            if (!row) throw new EmailAlreadyInUseError(input.email);

            const role = await tx.selectFirst<{ id: number; nome: string }>(
                `SELECT id, nome FROM app_role WHERE id = $roleId`,
                { roleId: input.roleId },
            );
            const papel: RoleRef = {
                id: Number(role?.id ?? input.roleId),
                nome: String(role?.nome ?? ''),
            };
            await this.accessRepository.recordEvent(tx, {
                actor: input.createdBy,
                targetId: Number(row.id),
                type: ACCESS_EVENT_TYPE.PAPEL,
                before: null,
                after: papel,
            });

            return {
                id: Number(row.id),
                username: String(row.username),
                role: String(row.role),
                ativo: Boolean(row.ativo),
                ...(row.created_by != null ? { createdBy: String(row.created_by) } : {}),
                createdAt: new Date(row.created_at).toISOString(),
                ...(row.email != null ? { email: String(row.email) } : {}),
                papel,
            };
        });

    /**
     * Grava o e-mail de login de um usuário (só admin chega aqui).
     *
     * Um único `UPDATE`, com a checagem cruzada no mesmo statement: o valor não pode ser o `email`
     * nem o `username` de OUTRO usuário. Só toca a linha quando o valor muda — gravar o mesmo
     * e-mail é no-op e não reescreve `email_updated_*`. Quando nenhuma linha muda, um SELECT de
     * existência separa as três causas (id inexistente, no-op, colisão); o `rowCount` sozinho não
     * distingue.
     */
    public setEmail = async (
        id: number,
        email: string,
        updatedBy: string,
    ): Promise<SetEmailResult> => {
        const affected = await this.databaseClient
            .update(
                `UPDATE app_user
                 SET email = $email, email_updated_by = $updatedBy, email_updated_at = now()
                 WHERE id = $id
                   AND email IS DISTINCT FROM $email
                   AND NOT EXISTS (
                       SELECT 1 FROM app_user o
                       WHERE o.id <> $id
                         AND (lower(o.email) = $email OR lower(o.username) = $email)
                   )`,
                { id, email, updatedBy },
            )
            .catch((error: unknown) => this.rethrowUniqueViolation(error, email));
        if (affected > 0) return SET_EMAIL_RESULT.UPDATED;

        const current = await this.databaseClient.selectFirst<{
            id: number;
            email: string | null;
        }>(
            `SELECT id, email
             FROM app_user
             WHERE id = $id`,
            { id },
        );
        if (!current) return SET_EMAIL_RESULT.NOT_FOUND;
        if (current.email === email) return SET_EMAIL_RESULT.UNCHANGED;
        throw new EmailAlreadyInUseError(email);
    };

    /**
     * Reativa um usuário (soft-enable). Não passa pela guarda — só acrescenta acesso —, mas grava o
     * evento `ativo` `false → true` na mesma transação (D5). Já ativo = no-op sem evento.
     */
    public reactivate = async (id: number, actor: string): Promise<ReactivateResult> =>
        this.databaseClient.withTransaction(async (tx) => {
            const affected = await tx.update(
                `UPDATE app_user SET ativo = true WHERE id = $id AND ativo = false`,
                { id },
            );
            if (affected > 0) {
                await this.accessRepository.recordEvent(tx, {
                    actor,
                    targetId: id,
                    type: ACCESS_EVENT_TYPE.ATIVO,
                    before: false,
                    after: true,
                });
                return REACTIVATE_RESULT.REACTIVATED;
            }
            const exists = await tx.selectFirst<{ id: number }>(
                `SELECT id FROM app_user WHERE id = $id`,
                { id },
            );
            return exists ? REACTIVATE_RESULT.UNCHANGED : REACTIVATE_RESULT.NOT_FOUND;
        });

    /**
     * Desativa um usuário sob a guarda R9/R-extra (ADR-0053): ninguém desativa o próprio acesso, e
     * a desativação não pode deixar zero usuários ativos com `usuarios:gerenciar` EFETIVO. A guarda
     * é a mesma de `setRole`/`replaceExceptions` (`AccessRepository.lockAndCheck`): trava os ativos
     * `FOR UPDATE` antes de ler o alvo, e checa, atualiza e grava o evento na MESMA transação. Dois
     * gestores que se desativam ao mesmo tempo serializam; o segundo relê o conjunto já sem o
     * primeiro e recusa.
     */
    public deactivateGuarded = async (
        id: number,
        actorUsername: string,
    ): Promise<DeactivateResult> =>
        this.databaseClient.withTransaction(async (tx) => {
            const change = await this.accessRepository.lockAndCheck(tx, {
                targetId: id,
                actor: actorUsername,
                simulate: (current) => ({ ...current, ativo: false }),
            });
            if (!change) return DEACTIVATE_RESULT.NOT_FOUND;
            if (!change.before.ativo) return DEACTIVATE_RESULT.DEACTIVATED;

            await tx.update(`UPDATE app_user SET ativo = false WHERE id = $id`, { id });
            await this.accessRepository.recordEvent(tx, {
                actor: actorUsername,
                targetId: id,
                type: ACCESS_EVENT_TYPE.ATIVO,
                before: true,
                after: false,
            });
            return DEACTIVATE_RESULT.DEACTIVATED;
        });

    /** Redefine a senha (hash) de um usuário. Retorna false se o id não existe. */
    public updatePassword = async (id: number, passwordHash: string): Promise<boolean> => {
        const affected = await this.databaseClient.update(
            `UPDATE app_user SET password_hash = $passwordHash WHERE id = $id`,
            { id, passwordHash },
        );
        return affected > 0;
    };

    /**
     * Vínculo Conexos de um usuário pelo `username` (email da plataforma) — usado
     * pelo resolver de sessão. `null` quando não há vínculo (ambas as colunas
     * preenchidas) ou o usuário está INATIVO (inativo nunca opera no ERP).
     */
    public getVinculoConexos = async (username: string): Promise<ConexosVinculo | null> => {
        const row = await this.databaseClient.selectFirst<{
            conexos_username: string | null;
            conexos_password_enc: string | null;
        }>(
            `SELECT conexos_username, conexos_password_enc
             FROM app_user
             WHERE username = $username AND ativo = true`,
            { username },
        );
        if (!row || row.conexos_username == null || row.conexos_password_enc == null) return null;
        return {
            conexosUsername: String(row.conexos_username),
            conexosPasswordEnc: String(row.conexos_password_enc),
        };
    };

    /**
     * Define (ou limpa, com `vinculo=null`) o vínculo Conexos de um usuário.
     * A senha JÁ chega CIFRADA (o service cifra). Retorna false se o id não existe.
     */
    public setVinculoConexos = async (
        id: number,
        vinculo: ConexosVinculo | null,
    ): Promise<boolean> => {
        const affected = await this.databaseClient.update(
            `UPDATE app_user
             SET conexos_username = $conexosUsername, conexos_password_enc = $conexosPasswordEnc
             WHERE id = $id`,
            {
                id,
                conexosUsername: vinculo?.conexosUsername ?? null,
                conexosPasswordEnc: vinculo?.conexosPasswordEnc ?? null,
            },
        );
        return affected > 0;
    };

    /**
     * Cria ou atualiza o admin do seed com `username = email = $email` (R12) e o papel
     * `Administrador` (ADR-0053). UPSERT por `username`: re-seed atualiza hash, papel e e-mail e
     * reativa a conta. Sem o papel (0066 não aplicada), `AdminRoleMissingError` — antes de gravar.
     */
    public upsertAdmin = async (email: string, passwordHash: string): Promise<void> => {
        const role = await this.accessRepository
            .findRoleByName(ADMIN_ROLE_NAME)
            .catch((error: unknown) => this.rethrowMissingRoleTable(error));
        if (!role) throw new AdminRoleMissingError();

        await this.databaseClient.insert(
            `INSERT INTO app_user (username, email, password_hash, role_id, ativo)
             VALUES ($email, $email, $passwordHash, $roleId, true)
             ON CONFLICT (username) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                role_id = EXCLUDED.role_id,
                email = EXCLUDED.email,
                ativo = true`,
            { email, passwordHash, roleId: role.id },
        );
    };

    private toAppUser = (row: AppUserRow): AppUser => ({
        id: Number(row.id),
        username: String(row.username),
        passwordHash: String(row.password_hash),
        role: String(row.role),
        ativo: Boolean(row.ativo),
        ...(row.email != null ? { email: String(row.email) } : {}),
        ...(row.auth_user_id != null ? { authUserId: String(row.auth_user_id) } : {}),
    });

    /** `app_role` inexistente é a 0066 não aplicada; qualquer outro erro sobe como está. */
    private rethrowMissingRoleTable = (error: unknown): never => {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === UNDEFINED_TABLE
        ) {
            throw new AdminRoleMissingError();
        }
        throw error;
    };

    /** Violação de índice único vira colisão de identificador; qualquer outro erro sobe como está. */
    private rethrowUniqueViolation = (error: unknown, email: string): never => {
        if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === UNIQUE_VIOLATION
        ) {
            throw new EmailAlreadyInUseError(email);
        }
        throw error;
    };
}
