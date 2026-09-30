import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import AdminRoleMissingError from '../../errors/AdminRoleMissingError.js';
import EmailAlreadyInUseError from '../../errors/EmailAlreadyInUseError.js';
import LastUserManagerError from '../../errors/LastUserManagerError.js';
import SelfDeactivationError from '../../errors/SelfDeactivationError.js';
import { PERMISSION_CATALOG } from '../../interface/auth/Permission.js';
import EffectivePermissionCalculator from '../../service/auth/EffectivePermissionCalculator.js';
import AccessRepository from './AccessRepository.js';
import UserRepository, {
    DEACTIVATE_RESULT,
    REACTIVATE_RESULT,
    SET_EMAIL_RESULT,
} from './UserRepository.js';

/** Cliente de transação isolado: prova que o que roda nele NÃO roda no pool. */
const buildTx = () => ({
    insert: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(1),
    selectMany: jest.fn().mockResolvedValue([]),
    selectFirst: jest.fn().mockResolvedValue(null),
});

const buildDb = (tx: unknown = buildTx()) =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
        withTransaction: jest.fn().mockImplementation(async (fn) => fn(tx)),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

/** O repositório real de acesso sobre o MESMO banco falso: a guarda roda de verdade. */
const repoOf = (db: jest.Mocked<PostgreeDatabaseClient>): UserRepository =>
    new UserRepository(db, new AccessRepository(db, new EffectivePermissionCalculator()));

/** Erro de violação de unicidade como o `pg` o entrega. */
const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' });

interface PapelFixture {
    id: number;
    nome: string;
    permissoes: string[];
}

const ADMIN: PapelFixture = { id: 1, nome: 'Administrador', permissoes: [...PERMISSION_CATALOG] };
const CONSULTA: PapelFixture = { id: 2, nome: 'Consulta', permissoes: ['permutas:ver'] };

interface Pessoa {
    id: number;
    username: string;
    ativo?: boolean;
    papel?: PapelFixture;
    excecoes?: { permissao: string; efeito: string }[];
}

/**
 * Transação falsa para a guarda: responde pelo TEXTO do SQL e registra a ordem das chamadas.
 * Mesmo formato que o `AccessRepository.test.ts` usa.
 */
const buildGuardTx = (pessoas: Pessoa[]) => {
    const chamadas: string[] = [];
    const linha = (p: Pessoa) => ({
        id: p.id,
        username: p.username,
        ativo: p.ativo ?? true,
        role_id: (p.papel ?? ADMIN).id,
        role_nome: (p.papel ?? ADMIN).nome,
        pacote: (p.papel ?? ADMIN).permissoes,
        excecoes: p.excecoes ?? [],
    });
    const tx = {
        selectMany: jest.fn(async (sql: string, params?: Record<string, unknown>) => {
            if (/FOR UPDATE/.test(sql) && /WHERE ativo = true/.test(sql)) {
                chamadas.push('trava-ativos');
                return pessoas.filter((p) => p.ativo ?? true).map((p) => ({ id: p.id }));
            }
            if (/FROM app_user u/.test(sql)) {
                chamadas.push('le-estado');
                return pessoas
                    .filter((p) => (p.ativo ?? true) || p.id === Number(params?.id))
                    .map(linha);
            }
            throw new Error(`SQL inesperado: ${sql}`);
        }),
        selectFirst: jest.fn(async (_sql: string, params?: Record<string, unknown>) => {
            chamadas.push('trava-alvo');
            const p = pessoas.find((x) => x.id === Number(params?.id));
            return p ? { id: p.id } : null;
        }),
        update: jest.fn(async (_sql: string, _params?: Record<string, unknown>) => {
            chamadas.push('update');
            return 1;
        }),
        insert: jest.fn(async (_sql: string, _params?: Record<string, unknown>) => {
            chamadas.push('evento');
            return 1;
        }),
    };
    return { tx, chamadas };
};

const UUID_VINCULO = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';

describe('UserRepository', () => {
    it('findByUsername: mapeia ativo e é parametrizado', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            password_hash: 'h',
            role: 'admin',
            ativo: true,
        });
        const out = await repoOf(db).findByUsername('marilyn.mutafci@kavex.com');
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('SELECT id, username, password_hash, role, ativo');
        expect(sql).toContain('WHERE username = $username');
        expect(params).toEqual({ username: 'marilyn.mutafci@kavex.com' });
        expect(out).toEqual({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            passwordHash: 'h',
            role: 'admin',
            ativo: true,
        });
    });

    describe('create', () => {
        const linhaCriada = {
            id: 8,
            username: 'novo@columbiabr.com',
            email: 'novo@columbiabr.com',
            role: 'admin',
            ativo: true,
            created_by: 'simone@kavex.com',
            created_at: '2026-07-10T12:00:00.000Z',
        };

        const txDeCriacao = (retorno: unknown = linhaCriada) => {
            const tx = buildTx();
            tx.selectFirst.mockImplementation(async (sql: string) => {
                if (/INSERT INTO app_user/.test(sql)) return retorno;
                if (/FROM app_role/.test(sql)) return { id: 2, nome: 'Consulta' };
                return null;
            });
            return tx;
        };

        it('grava username = email e role_id, NÃO escreve role (D3), e devolve o público com o papel', async () => {
            const tx = txDeCriacao();
            const db = buildDb(tx);
            const out = await repoOf(db).create({
                email: 'novo@columbiabr.com',
                passwordHash: 'hash',
                roleId: 2,
                createdBy: 'simone@kavex.com',
            });
            const [sql, params] = tx.selectFirst.mock.calls[0];
            expect(sql).toContain(
                'INSERT INTO app_user (username, email, password_hash, role_id, created_by)',
            );
            expect(sql).toContain('SELECT $email, $email, $passwordHash, $roleId, $createdBy');
            expect(sql).not.toContain('$role,');
            expect(sql).toContain('ON CONFLICT (username) DO NOTHING');
            // O RETURNING (o que sai do banco) nunca expõe o hash de senha.
            expect(sql.split('RETURNING')[1]).not.toContain('password_hash');
            expect(params).toMatchObject({ email: 'novo@columbiabr.com', roleId: 2 });
            expect(params).not.toHaveProperty('role');
            expect(out).toMatchObject({
                id: 8,
                username: 'novo@columbiabr.com',
                email: 'novo@columbiabr.com',
                createdBy: 'simone@kavex.com',
                papel: { id: 2, nome: 'Consulta' },
            });
            expect(out).not.toHaveProperty('passwordHash');
        });

        it('grava UM evento papel (antes = null) na MESMA transação (D5)', async () => {
            const tx = txDeCriacao();
            const db = buildDb(tx);
            await repoOf(db).create({
                email: 'novo@columbiabr.com',
                passwordHash: 'h',
                roleId: 2,
                createdBy: 'simone@kavex.com',
            });
            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            expect(db.insert).not.toHaveBeenCalled();
            const [sql, params] = tx.insert.mock.calls[0];
            expect(sql).toContain('INSERT INTO app_user_access_event');
            expect(params).toEqual({
                ator: 'simone@kavex.com',
                alvo: 8,
                tipo: 'papel',
                antes: null,
                depois: JSON.stringify({ id: 2, nome: 'Consulta' }),
            });
        });

        it('a checagem cruzada (email OU username de outro) mora no mesmo statement', async () => {
            const tx = txDeCriacao(null);
            const db = buildDb(tx);
            await repoOf(db)
                .create({
                    email: 'maria@columbiabr.com',
                    passwordHash: 'h',
                    roleId: 1,
                    createdBy: 'a',
                })
                .catch(() => undefined);
            const [sql] = tx.selectFirst.mock.calls[0];
            expect(sql).toMatch(/WHERE NOT EXISTS/);
            expect(sql).toContain('lower(o.email) = $email OR lower(o.username) = $email');
        });

        it('INSERT sem linha (NOT EXISTS barrou): EmailAlreadyInUseError, sem evento (I3)', async () => {
            const tx = txDeCriacao(null);
            const db = buildDb(tx);
            await expect(
                repoOf(db).create({
                    email: 'maria@columbiabr.com',
                    passwordHash: 'h',
                    roleId: 1,
                    createdBy: 'a',
                }),
            ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
            expect(tx.insert).not.toHaveBeenCalled();
        });

        it('violação de índice único (23505) também vira EmailAlreadyInUseError', async () => {
            const tx = buildTx();
            tx.selectFirst.mockRejectedValue(uniqueViolation());
            const db = buildDb(tx);
            await expect(
                repoOf(db).create({
                    email: 'x@columbiabr.com',
                    passwordHash: 'h',
                    roleId: 1,
                    createdBy: 'a',
                }),
            ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
        });
    });

    it('getVinculoConexos: só devolve quando ativo e ambas as colunas preenchidas', async () => {
        const db = buildDb();
        const repo = repoOf(db);
        (db.selectFirst as jest.Mock)
            .mockResolvedValueOnce({
                conexos_username: 'MARILYN_MUTAFCI',
                conexos_password_enc: 'enc',
            })
            .mockResolvedValueOnce({ conexos_username: null, conexos_password_enc: null });
        expect(await repo.getVinculoConexos('marilyn@kavex.com')).toEqual({
            conexosUsername: 'MARILYN_MUTAFCI',
            conexosPasswordEnc: 'enc',
        });
        const [sql] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('ativo = true'); // inativo nunca opera no ERP
        expect(await repo.getVinculoConexos('sem@kavex.com')).toBeNull(); // colunas nulas
    });

    it('setVinculoConexos: grava cifrado; null limpa as duas colunas', async () => {
        const db = buildDb();
        const repo = repoOf(db);
        await repo.setVinculoConexos(6, { conexosUsername: 'X', conexosPasswordEnc: 'enc' });
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('SET conexos_username = $conexosUsername');
        expect(params).toEqual({ id: 6, conexosUsername: 'X', conexosPasswordEnc: 'enc' });
        await repo.setVinculoConexos(6, null);
        expect((db.update as jest.Mock).mock.calls[1][1]).toEqual({
            id: 6,
            conexosUsername: null,
            conexosPasswordEnc: null,
        });
    });

    it('updatePassword: parametrizado; false quando nenhuma linha afetada', async () => {
        const db = buildDb();
        (db.update as jest.Mock).mockResolvedValueOnce(0);
        expect(await repoOf(db).updatePassword(999, 'h')).toBe(false); // id inexistente
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('UPDATE app_user SET password_hash = $passwordHash WHERE id = $id');
        expect(params).toEqual({ id: 999, passwordHash: 'h' });
    });

    describe('findByLoginIdentifier', () => {
        it('casa username OU email sem distinção de caixa, parametrizado, e devolve TODAS as linhas', async () => {
            const db = buildDb();
            (db.selectMany as jest.Mock).mockResolvedValue([
                {
                    id: 1,
                    username: 'admin',
                    password_hash: 'h1',
                    role: 'admin',
                    ativo: true,
                    email: 'ti@columbiabr.com',
                },
                {
                    id: 2,
                    username: 'ti@columbiabr.com',
                    password_hash: 'h2',
                    role: 'admin',
                    ativo: true,
                    email: null,
                },
            ]);
            const out = await repoOf(db).findByLoginIdentifier('TI@ColumbiaBR.com');
            const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];
            expect(sql).toContain(
                'WHERE lower(username) = $identifier OR lower(email) = $identifier',
            );
            expect(params).toEqual({ identifier: 'ti@columbiabr.com' });
            // O repositório não decide a ambiguidade: devolve as duas.
            expect(out).toEqual([
                {
                    id: 1,
                    username: 'admin',
                    passwordHash: 'h1',
                    role: 'admin',
                    ativo: true,
                    email: 'ti@columbiabr.com',
                },
                {
                    id: 2,
                    username: 'ti@columbiabr.com',
                    passwordHash: 'h2',
                    role: 'admin',
                    ativo: true,
                },
            ]);
        });

        it('sem linha: lista vazia', async () => {
            const db = buildDb();
            expect(await repoOf(db).findByLoginIdentifier('ninguem')).toEqual([]);
        });

        it('devolve também o auth_user_id (vínculo com o Supabase Auth, ADR-0054)', async () => {
            const db = buildDb();
            (db.selectMany as jest.Mock).mockResolvedValue([
                {
                    id: 1,
                    username: 'fulano',
                    password_hash: 'h',
                    role: 'admin',
                    ativo: true,
                    email: 'f@columbiabr.com',
                    auth_user_id: UUID_VINCULO,
                },
            ]);
            const [out] = await repoOf(db).findByLoginIdentifier('fulano');
            const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
            expect(sql).toContain('auth_user_id');
            expect(out).toMatchObject({ email: 'f@columbiabr.com', authUserId: UUID_VINCULO });
        });
    });

    describe('findByAuthUserId', () => {
        it('parametrizado por auth_user_id; devolve o usuário com o vínculo', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({
                id: 3,
                username: 'fulano',
                password_hash: 'h',
                role: 'admin',
                ativo: false,
                email: 'f@columbiabr.com',
                auth_user_id: UUID_VINCULO,
            });
            const out = await repoOf(db).findByAuthUserId(UUID_VINCULO);
            const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
            expect(sql).toContain('WHERE auth_user_id = $authUserId');
            expect(sql).not.toContain(UUID_VINCULO);
            expect(params).toEqual({ authUserId: UUID_VINCULO });
            expect(out).toMatchObject({ id: 3, username: 'fulano', ativo: false });
        });

        it('UUID malformado: null sem consultar o banco', async () => {
            const db = buildDb();
            expect(await repoOf(db).findByAuthUserId('lixo')).toBeNull();
            expect(db.selectFirst).not.toHaveBeenCalled();
        });
    });

    it('findByUsername e getVinculoConexos continuam casando por username EXATO (I1)', async () => {
        const db = buildDb();
        const repo = repoOf(db);
        await repo.findByUsername('admin');
        await repo.getVinculoConexos('admin');
        const sqls = (db.selectFirst as jest.Mock).mock.calls.map((c) => c[0] as string);
        expect(sqls).toHaveLength(2);
        for (const sql of sqls) {
            expect(sql).toContain('WHERE username = $username');
            expect(sql).not.toContain('lower(');
        }
    });

    it('listAll: nunca expõe auth_user_id nem password_hash, mesmo se vierem na linha', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                id: 1,
                username: 'a',
                role: 'admin',
                ativo: true,
                created_at: '2026-09-30T00:00:00Z',
                auth_user_id: UUID_VINCULO,
                password_hash: 'h',
            },
        ]);
        const [linha] = await repoOf(db).listAll();
        const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).not.toContain('auth_user_id');
        expect(sql).not.toContain('password_hash');
        expect(Object.keys(linha).sort()).toEqual(['ativo', 'createdAt', 'id', 'role', 'username']);
    });

    it('listAll: mapeia email e a trilha de edição, omitindo os nulos; nunca o hash', async () => {
        const db = buildDb();
        const base = {
            role: 'admin',
            ativo: true,
            created_by: null,
            created_at: '2026-07-10T12:00:00.000Z',
            conexos_username: null,
        };
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                ...base,
                id: 1,
                username: 'admin',
                email: 'ti@columbiabr.com',
                email_updated_by: 'simone@kavex.com',
                email_updated_at: '2026-09-28T12:00:00.000Z',
            },
            {
                ...base,
                id: 2,
                username: 'b@kavex.com',
                email: null,
                email_updated_by: null,
                email_updated_at: null,
            },
        ]);
        const out = await repoOf(db).listAll();
        const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('email, email_updated_by, email_updated_at');
        expect(sql).not.toContain('password_hash');
        expect(out[0]).toMatchObject({
            email: 'ti@columbiabr.com',
            emailUpdatedBy: 'simone@kavex.com',
            emailUpdatedAt: '2026-09-28T12:00:00.000Z',
        });
        expect(out[1]).not.toHaveProperty('email');
        expect(out[1]).not.toHaveProperty('emailUpdatedBy');
        expect(out[1]).not.toHaveProperty('emailUpdatedAt');
    });

    describe('setEmail', () => {
        it('um único UPDATE com a checagem cruzada no mesmo statement e a trilha de edição', async () => {
            const db = buildDb();
            (db.update as jest.Mock).mockResolvedValue(1);
            const out = await repoOf(db).setEmail(7, 'maria@columbiabr.com', 'simone@kavex.com');
            expect(out).toBe(SET_EMAIL_RESULT.UPDATED);
            expect(db.update).toHaveBeenCalledTimes(1);
            const [sql, params] = (db.update as jest.Mock).mock.calls[0];
            expect(sql).toContain('UPDATE app_user');
            expect(sql).toContain('email_updated_by = $updatedBy');
            expect(sql).toContain('email_updated_at = now()');
            expect(sql).toContain('WHERE id = $id');
            expect(sql).toMatch(/AND NOT EXISTS/);
            expect(sql).toContain('o.id <> $id');
            expect(sql).toContain('lower(o.email) = $email OR lower(o.username) = $email');
            expect(params).toEqual({
                id: 7,
                email: 'maria@columbiabr.com',
                updatedBy: 'simone@kavex.com',
            });
        });

        it('id inexistente: NOT_FOUND, distinguido por SELECT de existência', async () => {
            const db = buildDb();
            (db.update as jest.Mock).mockResolvedValue(0);
            (db.selectFirst as jest.Mock).mockResolvedValue(null);
            const out = await repoOf(db).setEmail(999, 'x@columbiabr.com', 'a');
            expect(out).toBe(SET_EMAIL_RESULT.NOT_FOUND);
            const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
            expect(sql).toContain('WHERE id = $id');
            expect(params).toEqual({ id: 999 });
        });

        it('colisão com email ou username de outro: EmailAlreadyInUseError', async () => {
            const db = buildDb();
            (db.update as jest.Mock).mockResolvedValue(0);
            (db.selectFirst as jest.Mock).mockResolvedValue({ id: 7, email: null });
            await expect(repoOf(db).setEmail(7, 'b@kavex.com', 'a')).rejects.toBeInstanceOf(
                EmailAlreadyInUseError,
            );
        });

        it('mesmo e-mail que o usuário já tem: no-op idempotente, sem reescrever a trilha', async () => {
            const db = buildDb();
            // O UPDATE só toca a linha quando o valor muda, então não reescreve email_updated_*.
            (db.update as jest.Mock).mockResolvedValue(0);
            (db.selectFirst as jest.Mock).mockResolvedValue({
                id: 7,
                email: 'maria@columbiabr.com',
            });
            const out = await repoOf(db).setEmail(7, 'maria@columbiabr.com', 'a');
            expect(out).toBe(SET_EMAIL_RESULT.UNCHANGED);
            const [sql] = (db.update as jest.Mock).mock.calls[0];
            expect(sql).toContain('email IS DISTINCT FROM $email');
        });

        it('violação do índice único (23505): EmailAlreadyInUseError', async () => {
            const db = buildDb();
            (db.update as jest.Mock).mockRejectedValue(uniqueViolation());
            await expect(repoOf(db).setEmail(7, 'x@columbiabr.com', 'a')).rejects.toBeInstanceOf(
                EmailAlreadyInUseError,
            );
        });

        it('outro erro do banco é propagado como está', async () => {
            const db = buildDb();
            (db.update as jest.Mock).mockRejectedValue(new Error('conexão caiu'));
            await expect(repoOf(db).setEmail(7, 'x@columbiabr.com', 'a')).rejects.toThrow(
                'conexão caiu',
            );
        });
    });

    describe('deactivateGuarded — guarda sobre usuarios:gerenciar efetivo (R9/R-extra)', () => {
        it('(h) trava os ativos, lê o alvo, checa, atualiza e grava o evento NA MESMA transação', async () => {
            const { tx, chamadas } = buildGuardTx([
                { id: 1, username: 'a@kavex.com' },
                { id: 2, username: 'b@kavex.com' },
            ]);
            const db = buildDb(tx);
            const out = await repoOf(db).deactivateGuarded(2, 'a@kavex.com');

            expect(out).toBe(DEACTIVATE_RESULT.DEACTIVATED);
            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            // Nada roda no pool: checagem e update no mesmo cliente de transação.
            expect(db.selectMany).not.toHaveBeenCalled();
            expect(db.selectFirst).not.toHaveBeenCalled();
            expect(db.update).not.toHaveBeenCalled();
            expect(db.insert).not.toHaveBeenCalled();
            expect(chamadas).toEqual([
                'trava-ativos',
                'trava-alvo',
                'le-estado',
                'update',
                'evento',
            ]);

            const [lockSql] = tx.selectMany.mock.calls[0];
            expect(lockSql).toContain('FOR UPDATE');
            expect(lockSql).not.toMatch(/role\s*=/);
            const [updSql, updParams] = tx.update.mock.calls[0];
            expect(updSql).toContain('UPDATE app_user SET ativo = false WHERE id = $id');
            expect(updParams).toEqual({ id: 2 });
            expect(tx.insert.mock.calls[0][1]).toEqual({
                ator: 'a@kavex.com',
                alvo: 2,
                tipo: 'ativo',
                antes: 'true',
                depois: 'false',
            });
        });

        it('alvo é o próprio ator: SelfDeactivationError, sem UPDATE', async () => {
            const { tx } = buildGuardTx([
                { id: 1, username: 'a@kavex.com' },
                { id: 2, username: 'b@kavex.com' },
            ]);
            await expect(
                repoOf(buildDb(tx)).deactivateGuarded(1, 'a@kavex.com'),
            ).rejects.toBeInstanceOf(SelfDeactivationError);
            expect(tx.update).not.toHaveBeenCalled();
        });

        it('(a) desativar o único gestor ativo: LastUserManagerError, sem UPDATE', async () => {
            const { tx } = buildGuardTx([
                { id: 1, username: 'gestor@kavex.com' },
                { id: 2, username: 'consulta@kavex.com', papel: CONSULTA },
            ]);
            await expect(
                repoOf(buildDb(tx)).deactivateGuarded(1, 'consulta@kavex.com'),
            ).rejects.toBeInstanceOf(LastUserManagerError);
            expect(tx.update).not.toHaveBeenCalled();
        });

        it('alvo sem usuarios:gerenciar: desativa mesmo com um único gestor ativo', async () => {
            const { tx } = buildGuardTx([
                { id: 1, username: 'a@kavex.com' },
                { id: 5, username: 'op@kavex.com', papel: CONSULTA },
            ]);
            expect(await repoOf(buildDb(tx)).deactivateGuarded(5, 'a@kavex.com')).toBe(
                DEACTIVATE_RESULT.DEACTIVATED,
            );
            expect(tx.update).toHaveBeenCalledTimes(1);
        });

        it('(g) gestor só por exceção conta: desativar o outro gestor passa', async () => {
            const { tx } = buildGuardTx([
                { id: 1, username: 'a@kavex.com' },
                {
                    id: 2,
                    username: 'b@kavex.com',
                    papel: CONSULTA,
                    excecoes: [{ permissao: 'usuarios:gerenciar', efeito: 'conceder' }],
                },
            ]);
            expect(await repoOf(buildDb(tx)).deactivateGuarded(1, 'b@kavex.com')).toBe(
                DEACTIVATE_RESULT.DEACTIVATED,
            );
        });

        it('alvo já inativo: nada a fazer, sem UPDATE e sem evento', async () => {
            const { tx } = buildGuardTx([
                { id: 1, username: 'a@kavex.com' },
                { id: 3, username: 'x@kavex.com', ativo: false },
            ]);
            expect(await repoOf(buildDb(tx)).deactivateGuarded(3, 'a@kavex.com')).toBe(
                DEACTIVATE_RESULT.DEACTIVATED,
            );
            expect(tx.update).not.toHaveBeenCalled();
            expect(tx.insert).not.toHaveBeenCalled();
        });

        it('id inexistente: NOT_FOUND, sem UPDATE', async () => {
            const { tx } = buildGuardTx([{ id: 1, username: 'a@kavex.com' }]);
            expect(await repoOf(buildDb(tx)).deactivateGuarded(99, 'a@kavex.com')).toBe(
                DEACTIVATE_RESULT.NOT_FOUND,
            );
            expect(tx.update).not.toHaveBeenCalled();
        });
    });

    describe('reactivate', () => {
        it('reativa e grava o evento ativo false → true na mesma transação (D5)', async () => {
            const tx = buildTx();
            tx.update.mockResolvedValue(1);
            const db = buildDb(tx);
            expect(await repoOf(db).reactivate(6, 'a@kavex.com')).toBe(
                REACTIVATE_RESULT.REACTIVATED,
            );
            const [sql, params] = tx.update.mock.calls[0];
            expect(sql).toContain(
                'UPDATE app_user SET ativo = true WHERE id = $id AND ativo = false',
            );
            expect(params).toEqual({ id: 6 });
            expect(tx.insert.mock.calls[0][1]).toEqual({
                ator: 'a@kavex.com',
                alvo: 6,
                tipo: 'ativo',
                antes: 'false',
                depois: 'true',
            });
            expect(db.update).not.toHaveBeenCalled();
        });

        it('já ativo: UNCHANGED, sem evento', async () => {
            const tx = buildTx();
            tx.update.mockResolvedValue(0);
            tx.selectFirst.mockResolvedValue({ id: 6 });
            expect(await repoOf(buildDb(tx)).reactivate(6, 'a')).toBe(REACTIVATE_RESULT.UNCHANGED);
            expect(tx.insert).not.toHaveBeenCalled();
        });

        it('id inexistente: NOT_FOUND', async () => {
            const tx = buildTx();
            tx.update.mockResolvedValue(0);
            tx.selectFirst.mockResolvedValue(null);
            expect(await repoOf(buildDb(tx)).reactivate(99, 'a')).toBe(REACTIVATE_RESULT.NOT_FOUND);
        });
    });

    describe('upsertAdmin', () => {
        it('username = email = $email; grava role_id do Administrador no INSERT e no conflito', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValueOnce({
                id: 1,
                nome: 'Administrador',
                descricao: null,
                permissoes: [...PERMISSION_CATALOG],
            });
            await repoOf(db).upsertAdmin('ti@columbiabr.com', 'hash');
            const [roleSql, roleParams] = (db.selectFirst as jest.Mock).mock.calls[0];
            expect(roleSql).toContain('lower(r.nome) = lower($nome)');
            expect(roleParams).toEqual({ nome: 'Administrador' });
            const [sql, params] = (db.insert as jest.Mock).mock.calls[0];
            expect(sql).toContain(
                'INSERT INTO app_user (username, email, password_hash, role_id, ativo)',
            );
            expect(sql).toContain('VALUES ($email, $email, $passwordHash, $roleId, true)');
            expect(sql).toContain('ON CONFLICT (username) DO UPDATE SET');
            expect(sql).toContain('password_hash = EXCLUDED.password_hash');
            expect(sql).toContain('role_id = EXCLUDED.role_id');
            expect(sql).toContain('email = EXCLUDED.email');
            expect(sql).toContain('ativo = true');
            expect(params).toEqual({ email: 'ti@columbiabr.com', passwordHash: 'hash', roleId: 1 });
        });

        it('sem o papel Administrador (migration não aplicada): AdminRoleMissingError, sem INSERT', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValueOnce(null);
            await expect(repoOf(db).upsertAdmin('a@b.com', 'h')).rejects.toBeInstanceOf(
                AdminRoleMissingError,
            );
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('tabela app_role inexistente (42P01) também vira AdminRoleMissingError', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockRejectedValueOnce(
                Object.assign(new Error('relation "app_role" does not exist'), { code: '42P01' }),
            );
            await expect(repoOf(db).upsertAdmin('a@b.com', 'h')).rejects.toBeInstanceOf(
                AdminRoleMissingError,
            );
        });
    });

    it('nenhuma consulta decide acesso por role = admin (a guarda é sobre permissão efetiva)', () => {
        const fonte = readFileSync(path.join(__dirname, 'UserRepository.ts'), 'utf8');
        expect(fonte).not.toContain('role = $role');
        expect(fonte).not.toMatch(/role\s*=\s*'admin'/);
        expect(fonte).not.toContain('ADMIN_ROLE =');
    });
});

/**
 * R6 (ADR-0054): escrita de credencial espelhada no Supabase Auth. O passo "antes do commit" roda
 * DENTRO da transação, depois da escrita local com a linha travada: BEGIN → trava → escrita →
 * chamada admin → COMMIT. Falha no passo = ROLLBACK (nada muda no banco).
 */
describe('UserRepository — passo antes do commit (R6)', () => {
    const LINHA = {
        id: 4,
        username: 'beto',
        email: 'beto@qa.local',
        auth_user_id: UUID_VINCULO,
        ativo: true,
        password_hash: '$2a$12$velho',
    };

    /** Banco falso que registra BEGIN/COMMIT/ROLLBACK e cada statement da transação. */
    const bancoComOrdem = (linha: Record<string, unknown> | null = LINHA) => {
        const ordem: string[] = [];
        const tx = {
            selectFirst: jest.fn(async (sql: string) => {
                ordem.push(/FOR UPDATE/.test(sql) ? 'trava' : 'le');
                return linha;
            }),
            selectMany: jest.fn(async () => []),
            update: jest.fn(async () => {
                ordem.push('escrita');
                return 1;
            }),
            insert: jest.fn(async () => {
                ordem.push('evento');
                return 1;
            }),
        };
        const db = buildDb(tx);
        (db.withTransaction as jest.Mock).mockImplementation(async (fn) => {
            ordem.push('BEGIN');
            try {
                const out = await fn(tx);
                ordem.push('COMMIT');
                return out;
            } catch (error) {
                ordem.push('ROLLBACK');
                throw error;
            }
        });
        return { db, tx, ordem };
    };

    const passo = (ordem: string[], falha?: Error) =>
        jest.fn(async () => {
            ordem.push('admin');
            if (falha) throw falha;
        });

    it('updatePassword: BEGIN → trava → escrita → admin → COMMIT, com a linha travada', async () => {
        const { db, ordem } = bancoComOrdem();
        const antes = passo(ordem);
        expect(await repoOf(db).updatePassword(4, '$2a$12$novo', antes)).toBe(true);
        expect(ordem).toEqual(['BEGIN', 'trava', 'escrita', 'admin', 'COMMIT']);
        expect(antes).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                id: 4,
                authUserId: UUID_VINCULO,
                passwordHash: '$2a$12$novo',
            }),
        );
    });

    it('updatePassword: falha no admin → ROLLBACK e o erro sobe', async () => {
        const { db, ordem } = bancoComOrdem();
        await expect(
            repoOf(db).updatePassword(4, 'h', passo(ordem, new Error('gotrue fora'))),
        ).rejects.toThrow('gotrue fora');
        expect(ordem).toEqual(['BEGIN', 'trava', 'escrita', 'admin', 'ROLLBACK']);
    });

    it('updatePassword com passo: id inexistente → false, sem escrita nem admin', async () => {
        const { db, ordem } = bancoComOrdem(null);
        const antes = passo(ordem);
        expect(await repoOf(db).updatePassword(99, 'h', antes)).toBe(false);
        expect(antes).not.toHaveBeenCalled();
    });

    it('setEmail com passo: trava, grava, chama o admin com o e-mail NOVO, e só então commita', async () => {
        const { db, ordem } = bancoComOrdem();
        const antes = passo(ordem);
        expect(await repoOf(db).setEmail(4, 'beto2@qa.local', 'adm', antes)).toBe(
            SET_EMAIL_RESULT.UPDATED,
        );
        expect(ordem).toEqual(['BEGIN', 'trava', 'escrita', 'admin', 'COMMIT']);
        expect(antes).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ email: 'beto2@qa.local', authUserId: UUID_VINCULO }),
        );
    });

    it('setEmail com passo: mesmo e-mail = UNCHANGED sem chamar o admin', async () => {
        const { db, tx, ordem } = bancoComOrdem();
        (tx.update as jest.Mock).mockResolvedValue(0);
        const antes = passo(ordem);
        expect(await repoOf(db).setEmail(4, 'beto@qa.local', 'adm', antes)).toBe(
            SET_EMAIL_RESULT.UNCHANGED,
        );
        expect(antes).not.toHaveBeenCalled();
    });

    it('create com passo: o admin roda DENTRO da transação da criação, com o hash gravado', async () => {
        const { db, tx, ordem } = bancoComOrdem();
        (tx.selectFirst as jest.Mock).mockImplementation(async (sql: string) => {
            if (/INSERT INTO app_user/.test(sql)) {
                ordem.push('escrita');
                return {
                    id: 9,
                    username: 'ana@qa.local',
                    email: 'ana@qa.local',
                    role: 'admin',
                    ativo: true,
                    created_by: 'adm',
                    created_at: '2026-09-30T00:00:00Z',
                };
            }
            return { id: 2, nome: 'Consulta' };
        });
        const antes = passo(ordem);
        await repoOf(db).create(
            { email: 'ana@qa.local', passwordHash: 'h', roleId: 2, createdBy: 'adm' },
            antes,
        );
        expect(ordem).toEqual(['BEGIN', 'escrita', 'evento', 'admin', 'COMMIT']);
        expect(antes).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ id: 9, email: 'ana@qa.local', passwordHash: 'h' }),
        );
    });

    it('linkAuthUser: fora de transação, parametrizado', async () => {
        const db = buildDb();
        await repoOf(db).linkAuthUser(4, UUID_VINCULO);
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('SET auth_user_id = $authUserId WHERE id = $id');
        expect(params).toEqual({ id: 4, authUserId: UUID_VINCULO });
    });

    it('setAuthUserId e findIdByAuthUserId: parametrizados, na transação recebida', async () => {
        const { db, tx } = bancoComOrdem({ id: 4 });
        const repo = repoOf(db);
        await repo.setAuthUserId(tx as never, 4, UUID_VINCULO);
        const [sql, params] = (tx.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('SET auth_user_id = $authUserId');
        expect(params).toEqual({ id: 4, authUserId: UUID_VINCULO });
        expect(await repo.findIdByAuthUserId(tx as never, UUID_VINCULO)).toBe(4);
        expect((tx.selectFirst as jest.Mock).mock.calls[0][1]).toEqual({
            authUserId: UUID_VINCULO,
        });
    });

    it('reactivate com passo: o admin roda depois do UPDATE e antes do COMMIT', async () => {
        const { db, ordem } = bancoComOrdem({ ...LINHA, ativo: true });
        const antes = passo(ordem);
        expect(await repoOf(db).reactivate(4, 'adm', antes)).toBe(REACTIVATE_RESULT.REACTIVATED);
        expect(ordem).toEqual(['BEGIN', 'escrita', 'evento', 'le', 'admin', 'COMMIT']);
    });
});
