import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';

/** Linha de `app_user` mapeada para o domínio (camelCase). */
export interface AppUser {
    id: number;
    username: string;
    /**
     * `deprecated` — some na Fase 4 (ADR-0030 §6). OPCIONAL desde a migration `0047`:
     * usuários criados pelo GoTrue não têm hash local, e o login legado deve tratar a
     * ausência como "credencial não confere" em vez de estourar.
     */
    passwordHash?: string;
    role: string;
    ativo: boolean;
}

/** Usuário para exibição/gestão (SEM o hash de senha — nunca sai do backend). */
export interface AppUserPublic {
    id: number;
    username: string;
    role: string;
    ativo: boolean;
    /**
     * Discriminador PERSISTIDO de `convidado` (ADR-0030 / migration `0047`). Junto com
     * `ativo` deriva o `UsuarioStatus` — sem ele, "nunca entrou" e "acesso revogado" são a
     * mesma linha no banco (ambos `ativo = false`).
     */
    convitePendente: boolean;
    createdBy?: string;
    createdAt: string;
    /** Login Conexos vinculado (ex.: MARILYN_MUTAFCI). Ausente = sem vínculo (opera via robô). */
    conexosUsername?: string;
}

/**
 * Contexto de AUTORIZAÇÃO resolvido do banco a cada request (I-Usuario-9). É o que
 * `appUserContext` grava em `req.user`, sobrescrevendo o `role` do token — a claim `role`
 * do GoTrue é sempre `'authenticated'` e é descartada.
 */
export interface AppUserContext {
    id: number;
    username: string;
    role: string;
    ativo: boolean;
    convitePendente: boolean;
}

/**
 * Linha de `app_user` com o ponteiro de identidade — o que a GESTÃO precisa antes de
 * escrever. Diferente de `AppUserContext` (que é o caminho quente da autorização) por
 * carregar o `authUserId`: sem ele não há como banir/desbanir no provedor nem invalidar o
 * cache de contexto pela chave certa.
 */
export interface AppUserRecord {
    id: number;
    username: string;
    role: string;
    ativo: boolean;
    convitePendente: boolean;
    /** `undefined` = pendente de migração (ADR-0030 §6). */
    authUserId?: string;
}

/**
 * Linha pendente de migração para o GoTrue (`auth_user_id IS NULL`). `passwordHash` é a
 * fonte do import bcrypt (Fase 1) e some na Fase 4 junto com a coluna.
 */
export interface PendingMigrationUser {
    id: number;
    username: string;
    passwordHash?: string;
}

/** Vínculo Conexos do usuário — login + senha CIFRADA (nunca em claro). */
export interface ConexosVinculo {
    conexosUsername: string;
    conexosPasswordEnc: string;
}

/** Erro lançado quando o `username` (email) já existe — o route traduz para 409. */
export class UsernameAlreadyExistsError extends Error {
    constructor(username: string) {
        super(`CONFLICT: user with email ${username} already exists`);
        this.name = 'UsernameAlreadyExistsError';
    }
}

/**
 * Forma canônica de um UUID v1–v5. Usado apenas como **guarda de entrada** de
 * `findByAuthUserId` — a coluna `auth_user_id` é `UUID` e um valor de outra forma não é
 * "não encontrado", é erro de sintaxe do Postgres.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    /** Busca um usuário pelo `username`. `null` quando não existe. */
    public findByUsername = async (username: string): Promise<AppUser | null> => {
        const row = await this.databaseClient.selectFirst<{
            id: number;
            username: string;
            password_hash: string;
            role: string;
            ativo: boolean;
        }>(
            `SELECT id, username, password_hash, role, ativo
             FROM app_user
             WHERE username = $username`,
            { username },
        );
        if (!row) return null;
        return {
            id: Number(row.id),
            username: String(row.username),
            ...(row.password_hash != null ? { passwordHash: String(row.password_hash) } : {}),
            role: String(row.role),
            ativo: Boolean(row.ativo),
        };
    };

    /**
     * Resolve o contexto de AUTORIZAÇÃO pelo `sub` do JWT (I-Usuario-9). É a query mais
     * quente da plataforma: roda uma vez por request (mitigada pelo cache TTL de
     * `appUserContext`).
     *
     * **Deliberadamente SEM `AND ativo = true`.** Filtrar aqui colapsaria "linha inativa" e
     * "linha inexistente" no mesmo `null`. As duas respondem 403 (`autorizacao-resolvida-do-banco.md`),
     * mas são diagnósticos diferentes — e o ramo `convidado` (U2) precisa **ver** a linha
     * inativa para poder ativá-la.
     */
    public findByAuthUserId = async (authUserId: string): Promise<AppUserContext | null> => {
        // BACKSTOP ESTRUTURAL (ADR-0030 §6 / Regis `cutover-rollback-broken`). A coluna é
        // `UUID` e não há cast em lugar nenhum: passar um username aqui faz o Postgres
        // recusar a sintaxe (22P02) e a request vira **500**, não 403 — exatamente no
        // caminho de recuperação, onde o operador mais precisa de um erro legível.
        //
        // O roteamento correto é do `appUserContext` (por `authScheme`); esta guarda existe
        // para que uma classificação errada custe um 403 diagnosticável em vez de derrubar
        // toda request autenticada. Fail-closed, nunca crash.
        if (!UUID_PATTERN.test(authUserId)) {
            console.warn(
                `[UserRepository] findByAuthUserId called with a non-UUID subject — the token ` +
                    'was routed to the provider lookup but does not carry a GoTrue id. ' +
                    'Treating as "no row" (403). Check the authScheme classification.',
            );
            return null;
        }
        const row = await this.databaseClient.selectFirst<{
            id: number;
            username: string;
            role: string;
            ativo: boolean;
            convite_pendente: boolean;
        }>(
            `SELECT id, username, role, ativo, convite_pendente
             FROM app_user
             WHERE auth_user_id = $authUserId`,
            { authUserId },
        );
        if (!row) return null;
        return {
            id: Number(row.id),
            username: String(row.username),
            role: String(row.role),
            ativo: Boolean(row.ativo),
            convitePendente: Boolean(row.convite_pendente),
        };
    };

    /**
     * O mesmo contexto de autorização, resolvido pelo `username` — o caminho do **token
     * legado**, cujo `sub` é o username (`AuthService.signToken` chama `.setSubject(username)`).
     *
     * **Existe para que as fases 2 e 3 do rollout sejam reversíveis** (ADR-0030 §6). Sem
     * ele, "o backend aceita os dois tokens" seria verdade só na verificação da assinatura:
     * a camada de autorização logo abaixo fala UUID, e todo request com token legado
     * morreria em 500.
     *
     * Espelha `findByAuthUserId` de propósito, inclusive a ausência de `AND ativo` — as duas
     * respostas 403 (inativo × inexistente) continuam sendo diagnósticos distintos.
     *
     * **Morre na Fase 4**, junto do HS256, do `password_hash` e do `AuthService`.
     */
    public findContextByUsername = async (username: string): Promise<AppUserContext | null> => {
        const row = await this.databaseClient.selectFirst<{
            id: number;
            username: string;
            role: string;
            ativo: boolean;
            convite_pendente: boolean;
        }>(
            `SELECT id, username, role, ativo, convite_pendente
             FROM app_user
             WHERE username = $username`,
            { username },
        );
        if (!row) return null;
        return {
            id: Number(row.id),
            username: String(row.username),
            role: String(row.role),
            ativo: Boolean(row.ativo),
            convitePendente: Boolean(row.convite_pendente),
        };
    };

    /**
     * Carrega um usuário pelo `id` interno, **incluindo o `authUserId`**. É o que a gestão
     * precisa antes de escrever: comparar o alvo com o ator (I-Usuario-6) e saber qual
     * registro banir/desbanir no provedor. `null` quando o id não existe.
     */
    public findById = async (id: number): Promise<AppUserRecord | null> => {
        const row = await this.databaseClient.selectFirst<{
            id: number;
            username: string;
            role: string;
            ativo: boolean;
            convite_pendente: boolean;
            auth_user_id: string | null;
        }>(
            `SELECT id, username, role, ativo, convite_pendente, auth_user_id
             FROM app_user
             WHERE id = $id`,
            { id },
        );
        if (!row) return null;
        return {
            id: Number(row.id),
            username: String(row.username),
            role: String(row.role),
            ativo: Boolean(row.ativo),
            convitePendente: Boolean(row.convite_pendente),
            ...(row.auth_user_id != null ? { authUserId: String(row.auth_user_id) } : {}),
        };
    };

    /**
     * Grava o ponteiro para `auth.users` — **e nada mais**. Regra de
     * `actions/usuario/migrar-para-supabase.md`: o job de migração NUNCA desativa, NUNCA
     * muda `role`, NUNCA toca `username` (imutável por I-Usuario-2 e ator da trilha por
     * I-Usuario-1). Retorna false se o id não existe.
     */
    public linkAuthUser = async (id: number, authUserId: string): Promise<boolean> => {
        const affected = await this.databaseClient.update(
            `UPDATE app_user SET auth_user_id = $authUserId WHERE id = $id`,
            { id, authUserId },
        );
        return affected > 0;
    };

    /**
     * Usuários ainda não migrados para o GoTrue (`auth_user_id IS NULL`).
     *
     * **É o GATE operacional da Fase 3, não um relatório** (ADR-0030 §6 / I13): desligar
     * `AUTH_LEGACY_LOGIN_ENABLED` enquanto esta lista não estiver vazia deixa esses usuários
     * SEM NENHUM caminho de login — o legado desligado e eles inexistentes no provedor.
     */
    public listPendingMigration = async (): Promise<PendingMigrationUser[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT id, username, password_hash
             FROM app_user
             WHERE auth_user_id IS NULL
             ORDER BY id`,
        );
        return rows.map((r) => ({
            id: Number(r.id),
            username: String(r.username),
            ...(r.password_hash != null ? { passwordHash: String(r.password_hash) } : {}),
        }));
    };

    /**
     * Reflete o aceite do convite (U2): ativa **e** limpa o discriminador num ÚNICO UPDATE.
     * Separá-los em dois abriria uma janela em que a linha é `ativo = true` **e** ainda
     * `convite_pendente` — um estado que a state-machine não tem. Retorna false se o id não existe.
     */
    public markConviteAceito = async (id: number): Promise<boolean> => {
        const affected = await this.databaseClient.update(
            `UPDATE app_user SET ativo = true, convite_pendente = false WHERE id = $id`,
            { id },
        );
        return affected > 0;
    };

    /** Liga/desliga o discriminador de convite pendente. Retorna false se o id não existe. */
    public setConvitePendente = async (id: number, convitePendente: boolean): Promise<boolean> => {
        const affected = await this.databaseClient.update(
            `UPDATE app_user SET convite_pendente = $convitePendente WHERE id = $id`,
            { id, convitePendente },
        );
        return affected > 0;
    };

    /** Lista todos os usuários (sem o hash) — mais recentes primeiro. Gestão pela UI. */
    public listAll = async (): Promise<AppUserPublic[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT id, username, role, ativo, convite_pendente, created_by, created_at,
                    conexos_username
             FROM app_user
             ORDER BY created_at DESC, id DESC`,
        );
        return rows.map((r) => ({
            id: Number(r.id),
            username: String(r.username),
            role: String(r.role),
            ativo: Boolean(r.ativo),
            convitePendente: Boolean(r.convite_pendente),
            ...(r.created_by != null ? { createdBy: String(r.created_by) } : {}),
            createdAt: new Date(r.created_at).toISOString(),
            ...(r.conexos_username != null ? { conexosUsername: String(r.conexos_username) } : {}),
        }));
    };

    /**
     * Cria um novo usuário. Lança `UsernameAlreadyExistsError` se o email já existe
     * (o `ON CONFLICT DO NOTHING` + `RETURNING` devolve zero linhas nesse caso).
     *
     * **`password_hash` não é escrito.** A custódia da credencial é do GoTrue (ADR-0030 §7);
     * o `auth_user_id` já chega preenchido porque as duas pontas nascem juntas ou nenhuma
     * nasce (atomicidade entre sistemas — U1/U3).
     */
    public create = async (input: {
        username: string;
        role: string;
        authUserId: string;
        ativo: boolean;
        convitePendente: boolean;
        createdBy?: string;
    }): Promise<AppUserPublic> => {
        const row = await this.databaseClient.selectFirst<{
            id: number;
            username: string;
            role: string;
            ativo: boolean;
            convite_pendente: boolean;
            created_by: string | null;
            created_at: string;
        }>(
            `INSERT INTO app_user (username, role, created_by, auth_user_id, ativo, convite_pendente)
             VALUES ($username, $role, $createdBy, $authUserId, $ativo, $convitePendente)
             ON CONFLICT (username) DO NOTHING
             RETURNING id, username, role, ativo, convite_pendente, created_by, created_at`,
            {
                username: input.username,
                role: input.role,
                createdBy: input.createdBy ?? null,
                authUserId: input.authUserId,
                ativo: input.ativo,
                convitePendente: input.convitePendente,
            },
        );
        if (!row) throw new UsernameAlreadyExistsError(input.username);
        return {
            id: Number(row.id),
            username: String(row.username),
            role: String(row.role),
            ativo: Boolean(row.ativo),
            convitePendente: Boolean(row.convite_pendente),
            ...(row.created_by != null ? { createdBy: String(row.created_by) } : {}),
            createdAt: new Date(row.created_at).toISOString(),
        };
    };

    /** Ativa/desativa o acesso de um usuário (soft-disable). Retorna false se o id não existe. */
    public setAtivo = async (id: number, ativo: boolean): Promise<boolean> => {
        const affected = await this.databaseClient.update(
            `UPDATE app_user SET ativo = $ativo WHERE id = $id`,
            { id, ativo },
        );
        return affected > 0;
    };

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
     * Cria ou atualiza o usuário admin (seed). UPSERT por `username` —
     * `ON CONFLICT DO UPDATE` re-aponta o `auth_user_id` e o `role` para re-seed idempotente.
     *
     * **Não escreve `password_hash`**: a custódia da credencial é do GoTrue (ADR-0030 §7).
     * Também garante `ativo = true` e `convite_pendente = false` — um seed de emergência que
     * deixasse a conta inativa não seria escape hatch nenhum.
     */
    public upsertAdmin = async (username: string, authUserId: string): Promise<void> => {
        await this.databaseClient.insert(
            `INSERT INTO app_user (username, role, auth_user_id, ativo, convite_pendente)
             VALUES ($username, 'admin', $authUserId, true, false)
             ON CONFLICT (username) DO UPDATE SET
                role = 'admin',
                auth_user_id = EXCLUDED.auth_user_id,
                ativo = true,
                convite_pendente = false`,
            { username, authUserId },
        );
    };
}
