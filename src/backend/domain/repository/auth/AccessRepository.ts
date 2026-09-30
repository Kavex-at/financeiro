import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import LastUserManagerError from '../../errors/LastUserManagerError.js';
import SelfAccessRemovalError from '../../errors/SelfAccessRemovalError.js';
import SelfDeactivationError from '../../errors/SelfDeactivationError.js';
import {
    PERMISSION,
    type PermissionException,
    type RoleRef,
    type ValidPermissionException,
} from '../../interface/auth/Permission.js';
import EffectivePermissionCalculator from '../../service/auth/EffectivePermissionCalculator.js';

/** Acesso de um usuário como está no banco — a entrada do `EffectivePermissionCalculator`. */
export interface UserAccess {
    userId: number;
    username: string;
    ativo: boolean;
    /** `app_user.auth_user_id` (ADR-0054). Ausente = ainda sem vínculo com o Supabase Auth. */
    authUserId?: string;
    papel: RoleRef;
    /** Pacote do papel, cru (pode ter valor antigo fora do catálogo — R4). */
    pacote: string[];
    /** Exceções do usuário, cruas. */
    excecoes: PermissionException[];
}

/** Papel com o seu pacote, para a tela e para validar a escrita. */
export interface RoleWithPermissions {
    id: number;
    nome: string;
    descricao?: string;
    permissoes: string[];
}

/** Tipo de evento da trilha `app_user_access_event`. */
export const ACCESS_EVENT_TYPE = {
    PAPEL: 'papel',
    EXCECAO: 'excecao',
    ATIVO: 'ativo',
} as const;
export type AccessEventType = (typeof ACCESS_EVENT_TYPE)[keyof typeof ACCESS_EVENT_TYPE];

/** Uma linha da trilha. `before`/`after` viram JSONB; `null` em `before` = criação. */
export interface AccessEvent {
    actor: string;
    targetId: number;
    type: AccessEventType;
    before: unknown;
    after: unknown;
}

export const SET_ROLE_RESULT = {
    UPDATED: 'updated',
    UNCHANGED: 'unchanged',
    USER_NOT_FOUND: 'user_not_found',
    ROLE_NOT_FOUND: 'role_not_found',
} as const;
export type SetRoleResult = (typeof SET_ROLE_RESULT)[keyof typeof SET_ROLE_RESULT];

export interface SetRoleOutcome {
    result: SetRoleResult;
    before?: RoleRef;
    after?: RoleRef;
}

export const REPLACE_EXCEPTIONS_RESULT = {
    UPDATED: 'updated',
    UNCHANGED: 'unchanged',
    NOT_FOUND: 'not_found',
} as const;
export type ReplaceExceptionsResult =
    (typeof REPLACE_EXCEPTIONS_RESULT)[keyof typeof REPLACE_EXCEPTIONS_RESULT];

export interface ReplaceExceptionsOutcome {
    result: ReplaceExceptionsResult;
    before?: PermissionException[];
    after?: PermissionException[];
}

/** O que a guarda devolve quando deixa a escrita seguir. */
export interface GuardedChange {
    before: UserAccess;
    after: UserAccess;
}

/**
 * Colunas do estado de acesso: usuário, papel, pacote e exceções numa linha só (sem N+1).
 * Constante estática; nenhum valor de entrada entra no texto (Rule #5 — o filtro vem por `$nome`).
 */
const ACCESS_STATE_SELECT = `
    SELECT u.id, u.username, u.ativo, u.auth_user_id, u.role_id, r.nome AS role_nome,
           COALESCE(
               (SELECT array_agg(rp.permission ORDER BY rp.permission)
                  FROM app_role_permission rp
                 WHERE rp.role_id = u.role_id),
               ARRAY[]::text[]
           ) AS pacote,
           COALESCE(
               (SELECT json_agg(
                           json_build_object('permissao', up.permission, 'efeito', up.efeito)
                           ORDER BY up.permission)
                  FROM user_permission up
                 WHERE up.user_id = u.id),
               '[]'::json
           ) AS excecoes
      FROM app_user u
      JOIN app_role r ON r.id = u.role_id`;

/** Papel com o pacote agregado. Constante estática, como a de cima. */
const ROLE_SELECT = `
    SELECT r.id, r.nome, r.descricao,
           COALESCE(
               array_agg(rp.permission ORDER BY rp.permission)
                   FILTER (WHERE rp.permission IS NOT NULL),
               ARRAY[]::text[]
           ) AS permissoes
      FROM app_role r
      LEFT JOIN app_role_permission rp ON rp.role_id = r.id`;

/** Zod na borda do banco: linha nula ou torta falha alto, nunca é mapeada às cegas. */
const accessRowSchema = z.object({
    id: z.coerce.number().int(),
    username: z.string(),
    ativo: z.boolean(),
    auth_user_id: z.string().nullable().optional(),
    role_id: z.coerce.number().int(),
    role_nome: z.string(),
    pacote: z.array(z.string()),
    excecoes: z.array(z.object({ permissao: z.string(), efeito: z.string() })),
});

/** O `sub` de um token do Supabase é o UUID do `auth.users`. */
const uuidSchema = z.string().uuid();

const roleRowSchema = z.object({
    id: z.coerce.number().int(),
    nome: z.string(),
    descricao: z.string().nullable().optional(),
    permissoes: z.array(z.string()),
});

/**
 * AccessRepository — papéis, pacotes, exceções por usuário e a trilha de acesso (ADR-0053).
 *
 * Leituras: `findAccessBySub` (uma ida ao banco por requisição com cache frio), `listRoles`,
 * `listAccessForUsers` (tela de usuários, sem N+1), `findRoleById`/`findRoleByName`.
 *
 * Escritas guardadas (R9/R-extra): `setRole` e `replaceExceptions` aqui, e a desativação no
 * `UserRepository` — as três passam pelo MESMO `lockAndCheck`, dentro da transação da escrita.
 *
 * A trilha `app_user_access_event` é append-only: este repositório só faz INSERT nela.
 * SQL 100% parametrizado (`$nome` via SqlBuilder — Rule #5).
 */
@injectable()
export default class AccessRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
        @inject(EffectivePermissionCalculator)
        private calculator: EffectivePermissionCalculator,
    ) {}

    /** Acesso do dono do token. Casa `sub` sem distinção de caixa. `null` = não existe. */
    public findAccessBySub = async (sub: string): Promise<UserAccess | null> => {
        const row = await this.databaseClient.selectFirst<unknown>(
            `${ACCESS_STATE_SELECT}
             WHERE lower(u.username) = lower($sub)`,
            { sub },
        );
        return row ? this.toUserAccess(row) : null;
    };

    /**
     * Acesso do dono de um token do Supabase Auth, pelo vínculo `auth_user_id` (ADR-0054). UUID
     * malformado é recusado (Zod) antes do SQL: `null`, sem consulta. `null` também = sem vínculo.
     */
    public findAccessByAuthUserId = async (authUserId: string): Promise<UserAccess | null> => {
        if (!uuidSchema.safeParse(authUserId).success) return null;
        const row = await this.databaseClient.selectFirst<unknown>(
            `${ACCESS_STATE_SELECT}
             WHERE u.auth_user_id = $authUserId`,
            { authUserId },
        );
        return row ? this.toUserAccess(row) : null;
    };

    /** Acesso de um usuário pelo `id` (resposta das escritas da tela). `null` = não existe. */
    public findAccessByUserId = async (userId: number): Promise<UserAccess | null> => {
        const row = await this.databaseClient.selectFirst<unknown>(
            `${ACCESS_STATE_SELECT}
             WHERE u.id = $userId`,
            { userId },
        );
        return row ? this.toUserAccess(row) : null;
    };

    /** Acesso de todos os usuários, por `id`, numa consulta. Alimenta o `GET /usuarios` (D6). */
    public listAccessForUsers = async (): Promise<Map<number, UserAccess>> => {
        const rows = await this.databaseClient.selectMany(
            `${ACCESS_STATE_SELECT}
             ORDER BY u.id`,
        );
        const out = new Map<number, UserAccess>();
        for (const row of rows) {
            const access = this.toUserAccess(row);
            out.set(access.userId, access);
        }
        return out;
    };

    /** Papéis com seus pacotes, por nome. */
    public listRoles = async (): Promise<RoleWithPermissions[]> => {
        const rows = await this.databaseClient.selectMany(
            `${ROLE_SELECT}
             GROUP BY r.id
             ORDER BY lower(r.nome)`,
        );
        return rows.map(this.toRole);
    };

    public findRoleById = async (id: number): Promise<RoleWithPermissions | null> => {
        const row = await this.databaseClient.selectFirst<unknown>(
            `${ROLE_SELECT}
             WHERE r.id = $id
             GROUP BY r.id`,
            { id },
        );
        return row ? this.toRole(row) : null;
    };

    public findRoleByName = async (nome: string): Promise<RoleWithPermissions | null> => {
        const row = await this.databaseClient.selectFirst<unknown>(
            `${ROLE_SELECT}
             WHERE lower(r.nome) = lower($nome)
             GROUP BY r.id`,
            { nome },
        );
        return row ? this.toRole(row) : null;
    };

    /**
     * Troca o papel do usuário. Mesmo papel = no-op (sem UPDATE, sem evento). Papel e usuário
     * inexistentes são resultados distintos. A guarda pode recusar com `LastUserManagerError` ou
     * `SelfAccessRemovalError`.
     */
    public setRole = async (
        userId: number,
        roleId: number,
        actor: string,
    ): Promise<SetRoleOutcome> =>
        this.databaseClient.withTransaction(async (tx) => {
            const roleRow = await tx.selectFirst<unknown>(
                `${ROLE_SELECT}
                 WHERE r.id = $id
                 GROUP BY r.id`,
                { id: roleId },
            );
            if (!roleRow) return { result: SET_ROLE_RESULT.ROLE_NOT_FOUND };
            const role = this.toRole(roleRow);
            const after: RoleRef = { id: role.id, nome: role.nome };

            const change = await this.lockAndCheck(tx, {
                targetId: userId,
                actor,
                simulate: (current) => ({ ...current, papel: after, pacote: role.permissoes }),
            });
            if (!change) return { result: SET_ROLE_RESULT.USER_NOT_FOUND };

            const before = change.before.papel;
            if (before.id === after.id) return { result: SET_ROLE_RESULT.UNCHANGED, before, after };

            await tx.update(`UPDATE app_user SET role_id = $roleId WHERE id = $id`, {
                roleId,
                id: userId,
            });
            await this.recordEvent(tx, {
                actor,
                targetId: userId,
                type: ACCESS_EVENT_TYPE.PAPEL,
                before,
                after,
            });
            return { result: SET_ROLE_RESULT.UPDATED, before, after };
        });

    /**
     * Substitui o conjunto INTEIRO de exceções do usuário (DELETE + INSERT na mesma transação),
     * com `concedido_por = actor`. Mesmo conjunto (em qualquer ordem) = no-op sem evento.
     */
    public replaceExceptions = async (
        userId: number,
        exceptions: ValidPermissionException[],
        actor: string,
    ): Promise<ReplaceExceptionsOutcome> =>
        this.databaseClient.withTransaction(async (tx) => {
            const after = this.sortExceptions(exceptions);
            const change = await this.lockAndCheck(tx, {
                targetId: userId,
                actor,
                simulate: (current) => ({ ...current, excecoes: after }),
            });
            if (!change) return { result: REPLACE_EXCEPTIONS_RESULT.NOT_FOUND };

            const before = this.sortExceptions(change.before.excecoes);
            if (this.sameExceptions(before, after)) {
                return { result: REPLACE_EXCEPTIONS_RESULT.UNCHANGED, before, after };
            }

            await tx.update(`DELETE FROM user_permission WHERE user_id = $userId`, { userId });
            if (after.length > 0) {
                await tx.insert(
                    `INSERT INTO user_permission (user_id, permission, efeito, concedido_por)
                     SELECT $userId, t.permission, t.efeito, $ator
                       FROM unnest($permissoes::text[], $efeitos::text[]) AS t(permission, efeito)`,
                    {
                        userId,
                        permissoes: after.map((e) => e.permissao),
                        efeitos: after.map((e) => e.efeito),
                        ator: actor,
                    },
                );
            }
            await this.recordEvent(tx, {
                actor,
                targetId: userId,
                type: ACCESS_EVENT_TYPE.EXCECAO,
                before,
                after,
            });
            return { result: REPLACE_EXCEPTIONS_RESULT.UPDATED, before, after };
        });

    /**
     * A guarda R9/R-extra — ÚNICA, usada por `setRole`, `replaceExceptions` e
     * `UserRepository.deactivateGuarded`. Roda DENTRO da transação da escrita:
     *
     * 1. trava as linhas dos usuários ativos (`FOR UPDATE`, em ordem de id) ANTES de ler o alvo —
     *    duas mudanças concorrentes serializam, e a segunda relê o estado já com a primeira;
     * 2. trava e confirma o alvo (`null` = não existe);
     * 3. lê papel, pacote e exceções dos ativos e do alvo, na mesma transação;
     * 4. simula o alvo DEPOIS da escrita e calcula as efetivas com o `EffectivePermissionCalculator`.
     *
     * Recusa, nesta ordem: desativar a si mesmo (`SelfDeactivationError`); tirar de si mesmo a
     * `usuarios:gerenciar` (`SelfAccessRemovalError`); deixar zero usuários ativos com
     * `usuarios:gerenciar` efetivo (`LastUserManagerError`). A contagem só atua quando a escrita
     * TIRA um gestor — mudar um usuário inativo, ou que não gere, nunca é barrado por ela.
     */
    public lockAndCheck = async (
        tx: TransactionClient,
        input: { targetId: number; actor: string; simulate: (current: UserAccess) => UserAccess },
    ): Promise<GuardedChange | null> => {
        await tx.selectMany(
            `SELECT id FROM app_user
             WHERE ativo = true
             ORDER BY id
             FOR UPDATE`,
        );
        const target = await tx.selectFirst<{ id: number }>(
            `SELECT id FROM app_user WHERE id = $id FOR UPDATE`,
            { id: input.targetId },
        );
        if (!target) return null;

        const rows = await tx.selectMany(
            `${ACCESS_STATE_SELECT}
             WHERE u.ativo = true OR u.id = $id
             ORDER BY u.id`,
            { id: input.targetId },
        );
        const states = rows.map(this.toUserAccess);
        const before = states.find((s) => s.userId === input.targetId);
        if (!before) return null;
        const after = input.simulate(before);

        const isSelf = before.username.toLowerCase() === input.actor.toLowerCase();
        if (isSelf && before.ativo && !after.ativo) throw new SelfDeactivationError();

        const managedBefore = this.isActiveManager(before);
        const managedAfter = this.isActiveManager(after);
        if (managedBefore && !managedAfter) {
            if (isSelf) throw new SelfAccessRemovalError();
            const otherManagers = states.filter(
                (s) => s.userId !== input.targetId && this.isActiveManager(s),
            );
            if (otherManagers.length === 0) throw new LastUserManagerError();
        }
        return { before, after };
    };

    /** Uma linha na trilha append-only, na transação da escrita. */
    public recordEvent = async (tx: TransactionClient, event: AccessEvent): Promise<void> => {
        await tx.insert(
            `INSERT INTO app_user_access_event (ator, alvo_user_id, tipo, antes, depois)
             VALUES ($ator, $alvo, $tipo, $antes::jsonb, $depois::jsonb)`,
            {
                ator: event.actor,
                alvo: event.targetId,
                tipo: event.type,
                antes: event.before === null ? null : JSON.stringify(event.before),
                depois: event.after === null ? null : JSON.stringify(event.after),
            },
        );
    };

    private isActiveManager = (access: UserAccess): boolean =>
        access.ativo &&
        this.calculator.tem(
            this.calculator.calcular(access.pacote, access.excecoes).permissoes,
            PERMISSION.USUARIOS_GERENCIAR,
        );

    private sortExceptions = (list: readonly PermissionException[]): PermissionException[] =>
        [...list]
            .map((e) => ({ permissao: e.permissao, efeito: e.efeito }))
            .sort((a, b) => a.permissao.localeCompare(b.permissao));

    private sameExceptions = (
        a: readonly PermissionException[],
        b: readonly PermissionException[],
    ): boolean =>
        a.length === b.length &&
        a.every((e, i) => e.permissao === b[i]?.permissao && e.efeito === b[i]?.efeito);

    private toUserAccess = (raw: unknown): UserAccess => {
        const row = accessRowSchema.parse(raw);
        return {
            userId: row.id,
            username: row.username,
            ativo: row.ativo,
            ...(row.auth_user_id != null ? { authUserId: row.auth_user_id } : {}),
            papel: { id: row.role_id, nome: row.role_nome },
            pacote: row.pacote,
            excecoes: row.excecoes,
        };
    };

    private toRole = (raw: unknown): RoleWithPermissions => {
        const row = roleRowSchema.parse(raw);
        return {
            id: row.id,
            nome: row.nome,
            ...(row.descricao != null ? { descricao: row.descricao } : {}),
            permissoes: row.permissoes,
        };
    };
}
