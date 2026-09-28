import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import EmailAlreadyInUseError from '../../errors/EmailAlreadyInUseError.js';
import LastActiveAdminError from '../../errors/LastActiveAdminError.js';
import SelfDeactivationError from '../../errors/SelfDeactivationError.js';

/** Linha de `app_user` mapeada para o domínio (camelCase). */
export interface AppUser {
    id: number;
    username: string;
    passwordHash: string;
    role: string;
    ativo: boolean;
    /** E-mail de login (ADR-0051). Ausente = pendente de cadastro pelo admin. */
    email?: string;
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

/** Papel que a guarda de desativação protege. */
const ADMIN_ROLE = 'admin';

/** SQLSTATE de violação de unicidade (`uq_app_user_email_lower` / `uq_app_user_username_lower`). */
const UNIQUE_VIOLATION = '23505';

interface AppUserRow {
    id: number;
    username: string;
    password_hash: string;
    role: string;
    ativo: boolean;
    email?: string | null;
}

interface GuardRow {
    id: number;
    username: string;
    role: string;
    ativo: boolean;
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
            `SELECT id, username, password_hash, role, ativo, email
             FROM app_user
             WHERE lower(username) = $identifier OR lower(email) = $identifier`,
            { identifier: identifier.toLowerCase() },
        );
        return rows.map(this.toAppUser);
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
     * Cria um novo usuário com `username = email` (R6). Lança `EmailAlreadyInUseError` quando o
     * valor já é o `email` ou o `username` de outro usuário: o `NOT EXISTS` barra no mesmo
     * statement, o `ON CONFLICT DO NOTHING` cobre o `username` idêntico e o índice em `lower()`
     * cobre a corrida (23505).
     */
    public create = async (input: {
        email: string;
        passwordHash: string;
        role: string;
        createdBy?: string;
    }): Promise<AppUserPublic> => {
        const row = await this.databaseClient
            .selectFirst<{
                id: number;
                username: string;
                email: string | null;
                role: string;
                ativo: boolean;
                created_by: string | null;
                created_at: string;
            }>(
                `INSERT INTO app_user (username, email, password_hash, role, created_by)
                 SELECT $email, $email, $passwordHash, $role, $createdBy
                 WHERE NOT EXISTS (
                     SELECT 1 FROM app_user o
                     WHERE lower(o.email) = $email OR lower(o.username) = $email
                 )
                 ON CONFLICT (username) DO NOTHING
                 RETURNING id, username, email, role, ativo, created_by, created_at`,
                {
                    email: input.email,
                    passwordHash: input.passwordHash,
                    role: input.role,
                    createdBy: input.createdBy ?? null,
                },
            )
            .catch((error: unknown) => this.rethrowUniqueViolation(error, input.email));
        if (!row) throw new EmailAlreadyInUseError(input.email);
        return {
            id: Number(row.id),
            username: String(row.username),
            role: String(row.role),
            ativo: Boolean(row.ativo),
            ...(row.created_by != null ? { createdBy: String(row.created_by) } : {}),
            createdAt: new Date(row.created_at).toISOString(),
            ...(row.email != null ? { email: String(row.email) } : {}),
        };
    };

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

    /** Ativa/desativa o acesso de um usuário (soft-disable). Retorna false se o id não existe. */
    public setAtivo = async (id: number, ativo: boolean): Promise<boolean> => {
        const affected = await this.databaseClient.update(
            `UPDATE app_user SET ativo = $ativo WHERE id = $id`,
            { id, ativo },
        );
        return affected > 0;
    };

    /**
     * Desativa um usuário com a guarda da R11: ninguém desativa o próprio acesso, e o último admin
     * ativo não pode ser desativado.
     *
     * Checagem e update na MESMA transação, com as linhas dos admins ativos travadas (`FOR UPDATE`,
     * em ordem de id) ANTES de ler o alvo. Dois admins que se desativam ao mesmo tempo serializam:
     * o segundo espera o primeiro, relê o conjunto já sem ele e recusa. Um `SELECT count` fora de
     * transação deixaria os dois passarem e zeraria os admins.
     */
    public deactivateGuarded = async (
        id: number,
        actorUsername: string,
    ): Promise<DeactivateResult> =>
        this.databaseClient.withTransaction(async (tx) => {
            const activeAdmins: GuardRow[] = await tx.selectMany(
                `SELECT id, username, role, ativo
                 FROM app_user
                 WHERE role = $role AND ativo = true
                 ORDER BY id
                 FOR UPDATE`,
                { role: ADMIN_ROLE },
            );
            const target = await tx.selectFirst<GuardRow>(
                `SELECT id, username, role, ativo
                 FROM app_user
                 WHERE id = $id
                 FOR UPDATE`,
                { id },
            );
            if (!target) return DEACTIVATE_RESULT.NOT_FOUND;

            if (String(target.username) === actorUsername) throw new SelfDeactivationError();

            const targetIsActiveAdmin = target.role === ADMIN_ROLE && Boolean(target.ativo);
            const otherActiveAdmins = activeAdmins.filter((a) => Number(a.id) !== Number(id));
            if (targetIsActiveAdmin && otherActiveAdmins.length === 0) {
                throw new LastActiveAdminError();
            }

            await tx.update(`UPDATE app_user SET ativo = false WHERE id = $id`, { id });
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
     * Cria ou atualiza o admin do seed com `username = email = $email` (R12). UPSERT por
     * `username`: re-seed atualiza hash, papel e e-mail e reativa a conta.
     */
    public upsertAdmin = async (email: string, passwordHash: string): Promise<void> => {
        await this.databaseClient.insert(
            `INSERT INTO app_user (username, email, password_hash, role, ativo)
             VALUES ($email, $email, $passwordHash, $role, true)
             ON CONFLICT (username) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                role = EXCLUDED.role,
                email = EXCLUDED.email,
                ativo = true`,
            { email, passwordHash, role: ADMIN_ROLE },
        );
    };

    private toAppUser = (row: AppUserRow): AppUser => ({
        id: Number(row.id),
        username: String(row.username),
        passwordHash: String(row.password_hash),
        role: String(row.role),
        ativo: Boolean(row.ativo),
        ...(row.email != null ? { email: String(row.email) } : {}),
    });

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
