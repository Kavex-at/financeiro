import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import EmailAlreadyInUseError from '../../errors/EmailAlreadyInUseError.js';
import LastActiveAdminError from '../../errors/LastActiveAdminError.js';
import SelfDeactivationError from '../../errors/SelfDeactivationError.js';
import UserRepository, { DEACTIVATE_RESULT, SET_EMAIL_RESULT } from './UserRepository.js';

/** Cliente de transação isolado: prova que o que roda nele NÃO roda no pool. */
const buildTx = () => ({
    insert: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(1),
    selectMany: jest.fn().mockResolvedValue([]),
    selectFirst: jest.fn().mockResolvedValue(null),
});

const buildDb = (tx = buildTx()) =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
        withTransaction: jest.fn().mockImplementation(async (fn) => fn(tx)),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

/** Erro de violação de unicidade como o `pg` o entrega. */
const uniqueViolation = () => Object.assign(new Error('duplicate key'), { code: '23505' });

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
        const out = await new UserRepository(db).findByUsername('marilyn.mutafci@kavex.com');
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

    it('create: grava username = email (mesmo valor) e devolve o público (sem hash)', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 8,
            username: 'novo@columbiabr.com',
            email: 'novo@columbiabr.com',
            role: 'operador',
            ativo: true,
            created_by: 'simone@kavex.com',
            created_at: '2026-07-10T12:00:00.000Z',
        });
        const out = await new UserRepository(db).create({
            email: 'novo@columbiabr.com',
            passwordHash: 'hash',
            role: 'operador',
            createdBy: 'simone@kavex.com',
        });
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain(
            'INSERT INTO app_user (username, email, password_hash, role, created_by)',
        );
        expect(sql).toContain('SELECT $email, $email, $passwordHash, $role, $createdBy');
        expect(sql).toContain('ON CONFLICT (username) DO NOTHING');
        expect(sql).toContain('RETURNING');
        // O RETURNING (o que sai do banco) nunca expõe o hash de senha.
        expect(sql.split('RETURNING')[1]).not.toContain('password_hash');
        expect(params).toMatchObject({ email: 'novo@columbiabr.com', role: 'operador' });
        expect(out).toMatchObject({
            id: 8,
            username: 'novo@columbiabr.com',
            email: 'novo@columbiabr.com',
            createdBy: 'simone@kavex.com',
        });
        expect(out).not.toHaveProperty('passwordHash');
    });

    it('create: a checagem cruzada (email OU username de outro) mora no mesmo statement', async () => {
        const db = buildDb();
        await new UserRepository(db)
            .create({ email: 'maria@columbiabr.com', passwordHash: 'h', role: 'operador' })
            .catch(() => undefined);
        const [sql] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/WHERE NOT EXISTS/);
        expect(sql).toContain('lower(o.email) = $email OR lower(o.username) = $email');
    });

    it('create: B tem email maria@columbiabr.com; criar maria@columbiabr.com dá EmailAlreadyInUseError (I3)', async () => {
        // B: username 'bsilva', email 'maria@columbiabr.com'. O INSERT não devolve linha (o NOT
        // EXISTS barrou): sem esse 409, o login por esse identificador casaria duas linhas.
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue(null);
        await expect(
            new UserRepository(db).create({
                email: 'maria@columbiabr.com',
                passwordHash: 'h',
                role: 'operador',
            }),
        ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
    });

    it('create: violação de índice único (23505) também vira EmailAlreadyInUseError', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockRejectedValue(uniqueViolation());
        await expect(
            new UserRepository(db).create({
                email: 'x@columbiabr.com',
                passwordHash: 'h',
                role: 'operador',
            }),
        ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
    });

    it('getVinculoConexos: só devolve quando ativo e ambas as colunas preenchidas', async () => {
        const db = buildDb();
        const repo = new UserRepository(db);
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
        const repo = new UserRepository(db);
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

    it('setAtivo/updatePassword: parametrizados; false quando nenhuma linha afetada', async () => {
        const db = buildDb();
        (db.update as jest.Mock).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
        const repo = new UserRepository(db);
        expect(await repo.setAtivo(6, false)).toBe(true);
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('UPDATE app_user SET ativo = $ativo WHERE id = $id');
        expect(params).toEqual({ id: 6, ativo: false });
        expect(await repo.updatePassword(999, 'h')).toBe(false); // id inexistente
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
            const out = await new UserRepository(db).findByLoginIdentifier('TI@ColumbiaBR.com');
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
            expect(await new UserRepository(db).findByLoginIdentifier('ninguem')).toEqual([]);
        });
    });

    it('findByUsername e getVinculoConexos continuam casando por username EXATO (I1)', async () => {
        const db = buildDb();
        const repo = new UserRepository(db);
        await repo.findByUsername('admin');
        await repo.getVinculoConexos('admin');
        const sqls = (db.selectFirst as jest.Mock).mock.calls.map((c) => c[0] as string);
        expect(sqls).toHaveLength(2);
        for (const sql of sqls) {
            expect(sql).toContain('WHERE username = $username');
            expect(sql).not.toContain('lower(');
        }
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
        const out = await new UserRepository(db).listAll();
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
            const out = await new UserRepository(db).setEmail(
                7,
                'maria@columbiabr.com',
                'simone@kavex.com',
            );
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
            const out = await new UserRepository(db).setEmail(999, 'x@columbiabr.com', 'a');
            expect(out).toBe(SET_EMAIL_RESULT.NOT_FOUND);
            const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
            expect(sql).toContain('WHERE id = $id');
            expect(params).toEqual({ id: 999 });
        });

        it('colisão com email ou username de outro: EmailAlreadyInUseError', async () => {
            const db = buildDb();
            (db.update as jest.Mock).mockResolvedValue(0);
            (db.selectFirst as jest.Mock).mockResolvedValue({ id: 7, email: null });
            await expect(
                new UserRepository(db).setEmail(7, 'b@kavex.com', 'a'),
            ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
        });

        it('mesmo e-mail que o usuário já tem: no-op idempotente, sem reescrever a trilha', async () => {
            const db = buildDb();
            // O UPDATE só toca a linha quando o valor muda, então não reescreve email_updated_*.
            (db.update as jest.Mock).mockResolvedValue(0);
            (db.selectFirst as jest.Mock).mockResolvedValue({
                id: 7,
                email: 'maria@columbiabr.com',
            });
            const out = await new UserRepository(db).setEmail(7, 'maria@columbiabr.com', 'a');
            expect(out).toBe(SET_EMAIL_RESULT.UNCHANGED);
            const [sql] = (db.update as jest.Mock).mock.calls[0];
            expect(sql).toContain('email IS DISTINCT FROM $email');
        });

        it('violação do índice único (23505): EmailAlreadyInUseError', async () => {
            const db = buildDb();
            (db.update as jest.Mock).mockRejectedValue(uniqueViolation());
            await expect(
                new UserRepository(db).setEmail(7, 'x@columbiabr.com', 'a'),
            ).rejects.toBeInstanceOf(EmailAlreadyInUseError);
        });

        it('outro erro do banco é propagado como está', async () => {
            const db = buildDb();
            (db.update as jest.Mock).mockRejectedValue(new Error('conexão caiu'));
            await expect(
                new UserRepository(db).setEmail(7, 'x@columbiabr.com', 'a'),
            ).rejects.toThrow('conexão caiu');
        });
    });

    describe('deactivateGuarded', () => {
        const admin = (id: number, username: string) => ({
            id,
            username,
            role: 'admin',
            ativo: true,
        });

        it('trava os admins ativos e o alvo, checa e atualiza NA MESMA transação', async () => {
            const tx = buildTx();
            tx.selectMany.mockResolvedValue([admin(1, 'a@kavex.com'), admin(2, 'b@kavex.com')]);
            tx.selectFirst.mockResolvedValue(admin(2, 'b@kavex.com'));
            const db = buildDb(tx);
            const out = await new UserRepository(db).deactivateGuarded(2, 'a@kavex.com');

            expect(out).toBe(DEACTIVATE_RESULT.DEACTIVATED);
            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            // Nada roda no pool: checagem e update no mesmo cliente de transação.
            expect(db.selectMany).not.toHaveBeenCalled();
            expect(db.selectFirst).not.toHaveBeenCalled();
            expect(db.update).not.toHaveBeenCalled();
            const [lockSql, lockParams] = tx.selectMany.mock.calls[0];
            expect(lockSql).toContain('FOR UPDATE');
            expect(lockSql).toContain('role = $role AND ativo = true');
            expect(lockParams).toEqual({ role: 'admin' });
            expect(tx.selectFirst.mock.calls[0][0]).toContain('FOR UPDATE');
            const [updSql, updParams] = tx.update.mock.calls[0];
            expect(updSql).toContain('UPDATE app_user SET ativo = false WHERE id = $id');
            expect(updParams).toEqual({ id: 2 });
            // Ordem: travar os admins antes de ler o alvo, e só então atualizar.
            expect(tx.selectMany.mock.invocationCallOrder[0]).toBeLessThan(
                tx.selectFirst.mock.invocationCallOrder[0],
            );
            expect(tx.selectFirst.mock.invocationCallOrder[0]).toBeLessThan(
                tx.update.mock.invocationCallOrder[0],
            );
        });

        it('alvo é o próprio ator: SelfDeactivationError, sem UPDATE', async () => {
            const tx = buildTx();
            tx.selectMany.mockResolvedValue([admin(1, 'a@kavex.com'), admin(2, 'b@kavex.com')]);
            tx.selectFirst.mockResolvedValue(admin(1, 'a@kavex.com'));
            const db = buildDb(tx);
            await expect(
                new UserRepository(db).deactivateGuarded(1, 'a@kavex.com'),
            ).rejects.toBeInstanceOf(SelfDeactivationError);
            expect(tx.update).not.toHaveBeenCalled();
        });

        it('alvo é o último admin ativo: LastActiveAdminError, sem UPDATE', async () => {
            const tx = buildTx();
            tx.selectMany.mockResolvedValue([admin(1, 'a@kavex.com')]);
            tx.selectFirst.mockResolvedValue(admin(1, 'a@kavex.com'));
            const db = buildDb(tx);
            await expect(
                new UserRepository(db).deactivateGuarded(1, 'b@kavex.com'),
            ).rejects.toBeInstanceOf(LastActiveAdminError);
            expect(tx.update).not.toHaveBeenCalled();
        });

        it('alvo operador: desativa mesmo com um único admin ativo', async () => {
            const tx = buildTx();
            tx.selectMany.mockResolvedValue([admin(1, 'a@kavex.com')]);
            tx.selectFirst.mockResolvedValue({
                id: 5,
                username: 'op@kavex.com',
                role: 'operador',
                ativo: true,
            });
            const db = buildDb(tx);
            expect(await new UserRepository(db).deactivateGuarded(5, 'a@kavex.com')).toBe(
                DEACTIVATE_RESULT.DEACTIVATED,
            );
            expect(tx.update).toHaveBeenCalledTimes(1);
        });

        it('id inexistente: NOT_FOUND, sem UPDATE', async () => {
            const tx = buildTx();
            tx.selectMany.mockResolvedValue([admin(1, 'a@kavex.com')]);
            tx.selectFirst.mockResolvedValue(null);
            const db = buildDb(tx);
            expect(await new UserRepository(db).deactivateGuarded(99, 'a@kavex.com')).toBe(
                DEACTIVATE_RESULT.NOT_FOUND,
            );
            expect(tx.update).not.toHaveBeenCalled();
        });
    });

    it('setAtivo (reativar) não passa pela guarda nem abre transação', async () => {
        const db = buildDb();
        await new UserRepository(db).setAtivo(6, true);
        expect(db.withTransaction).not.toHaveBeenCalled();
        expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('upsertAdmin: username = email = $email; o conflito reativa e atualiza hash, role e email', async () => {
        const db = buildDb();
        await new UserRepository(db).upsertAdmin('ti@columbiabr.com', 'hash');
        const [sql, params] = (db.insert as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO app_user (username, email, password_hash, role, ativo)');
        expect(sql).toContain('VALUES ($email, $email, $passwordHash, $role, true)');
        expect(sql).toContain('ON CONFLICT (username) DO UPDATE SET');
        expect(sql).toContain('password_hash = EXCLUDED.password_hash');
        expect(sql).toContain('role = EXCLUDED.role');
        expect(sql).toContain('email = EXCLUDED.email');
        expect(sql).toContain('ativo = true');
        expect(params).toEqual({ email: 'ti@columbiabr.com', passwordHash: 'hash', role: 'admin' });
    });
});
