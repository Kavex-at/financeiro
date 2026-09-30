import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import LastUserManagerError from '../../errors/LastUserManagerError.js';
import SelfAccessRemovalError from '../../errors/SelfAccessRemovalError.js';
import { PERMISSION_CATALOG } from '../../interface/auth/Permission.js';
import EffectivePermissionCalculator from '../../service/auth/EffectivePermissionCalculator.js';
import AccessRepository, {
    REPLACE_EXCEPTIONS_RESULT,
    SET_ROLE_RESULT,
} from './AccessRepository.js';

/** Linha de acesso como o SQL a devolve. */
interface AccessRow {
    id: number;
    username: string;
    ativo: boolean;
    role_id: number;
    role_nome: string;
    pacote: string[];
    excecoes: { permissao: string; efeito: string }[];
}

interface PapelFixture {
    id: number;
    nome: string;
    permissoes: string[];
}

const ADMIN: PapelFixture = { id: 1, nome: 'Administrador', permissoes: [...PERMISSION_CATALOG] };
const CONSULTA: PapelFixture = {
    id: 2,
    nome: 'Consulta',
    permissoes: ['permutas:ver', 'sispag:ver'],
};

const linha = (
    id: number,
    username: string,
    opts: Partial<Omit<AccessRow, 'id' | 'username'>> & { papel?: PapelFixture } = {},
): AccessRow => {
    const papel = opts.papel ?? ADMIN;
    return {
        id,
        username,
        ativo: opts.ativo ?? true,
        role_id: papel.id,
        role_nome: papel.nome,
        pacote: opts.pacote ?? papel.permissoes,
        excecoes: opts.excecoes ?? [],
    };
};

/**
 * Transação falsa que responde pelo TEXTO do SQL. Guarda a ordem das chamadas para provar que a
 * trava vem antes da leitura, e que checagem e escrita correm no MESMO `tx` (h).
 */
const buildTx = (usuarios: AccessRow[], papeis = [ADMIN, CONSULTA]) => {
    const chamadas: string[] = [];
    const tx = {
        selectMany: jest.fn(async (sql: string, params?: Record<string, unknown>) => {
            if (/FOR UPDATE/.test(sql) && /WHERE ativo = true/.test(sql)) {
                chamadas.push('trava-ativos');
                return usuarios.filter((u) => u.ativo).map((u) => ({ id: u.id }));
            }
            if (/FROM app_user u/.test(sql)) {
                chamadas.push('le-estado');
                const id = Number(params?.id);
                return usuarios.filter((u) => u.ativo || u.id === id);
            }
            throw new Error(`SQL inesperado no tx: ${sql}`);
        }),
        selectFirst: jest.fn(async (sql: string, params?: Record<string, unknown>) => {
            if (/FROM app_user/.test(sql) && /FOR UPDATE/.test(sql)) {
                chamadas.push('trava-alvo');
                const u = usuarios.find((x) => x.id === Number(params?.id));
                return u ? { id: u.id } : null;
            }
            if (/FROM app_role r/.test(sql)) {
                chamadas.push('le-papel');
                const p = papeis.find((x) => x.id === Number(params?.id));
                return p
                    ? { id: p.id, nome: p.nome, descricao: null, permissoes: p.permissoes }
                    : null;
            }
            throw new Error(`SQL inesperado no tx: ${sql}`);
        }),
        update: jest.fn(async (sql: string, _params?: Record<string, unknown>) => {
            chamadas.push(/DELETE/.test(sql) ? 'delete' : 'update');
            return 1;
        }),
        insert: jest.fn(async (sql: string, _params?: Record<string, unknown>) => {
            chamadas.push(/app_user_access_event/.test(sql) ? 'evento' : 'insert');
            return 1;
        }),
    };
    return { tx, chamadas };
};

const buildDb = (tx: unknown) =>
    ({
        insert: jest.fn(),
        update: jest.fn(),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
        withTransaction: jest.fn().mockImplementation(async (fn) => fn(tx)),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const repoCom = (usuarios: AccessRow[]) => {
    const { tx, chamadas } = buildTx(usuarios);
    const db = buildDb(tx);
    return {
        repo: new AccessRepository(db, new EffectivePermissionCalculator()),
        tx,
        db,
        chamadas,
    };
};

/** Parâmetros do INSERT na trilha. */
const eventoGravado = (tx: ReturnType<typeof buildTx>['tx']) => {
    const call = tx.insert.mock.calls.find(([sql]) => /app_user_access_event/.test(String(sql)));
    return call?.[1] as Record<string, unknown> | undefined;
};

describe('AccessRepository — leituras', () => {
    it('findAccessBySub: UMA ida ao banco, parametrizada, casando lower(username)', async () => {
        const db = buildDb({});
        (db.selectFirst as jest.Mock).mockResolvedValue(
            linha(6, 'Maria@Columbiabr.com', {
                papel: CONSULTA,
                excecoes: [{ permissao: 'sispag:executar', efeito: 'conceder' }],
            }),
        );
        const out = await new AccessRepository(
            db,
            new EffectivePermissionCalculator(),
        ).findAccessBySub('maria@columbiabr.com');

        expect(db.selectFirst).toHaveBeenCalledTimes(1);
        expect(db.selectMany).not.toHaveBeenCalled();
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('lower(u.username) = lower($sub)');
        expect(params).toEqual({ sub: 'maria@columbiabr.com' });
        expect(out).toEqual({
            userId: 6,
            username: 'Maria@Columbiabr.com',
            ativo: true,
            papel: { id: 2, nome: 'Consulta' },
            pacote: ['permutas:ver', 'sispag:ver'],
            excecoes: [{ permissao: 'sispag:executar', efeito: 'conceder' }],
        });
    });

    it('findAccessBySub: null quando o usuário não existe', async () => {
        const db = buildDb({});
        const repo = new AccessRepository(db, new EffectivePermissionCalculator());
        expect(await repo.findAccessBySub('ninguem')).toBeNull();
    });

    it('findAccessByAuthUserId: UMA ida ao banco, parametrizada por auth_user_id, mesmo formato', async () => {
        const uuid = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';
        const db = buildDb({});
        (db.selectFirst as jest.Mock).mockResolvedValue({
            ...linha(6, 'fulano', { papel: CONSULTA }),
            auth_user_id: uuid,
        });
        const out = await new AccessRepository(
            db,
            new EffectivePermissionCalculator(),
        ).findAccessByAuthUserId(uuid);

        expect(db.selectFirst).toHaveBeenCalledTimes(1);
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('u.auth_user_id = $authUserId');
        expect(sql).not.toContain(uuid);
        expect(params).toEqual({ authUserId: uuid });
        expect(out).toMatchObject({ userId: 6, username: 'fulano', authUserId: uuid });
    });

    it('findAccessByAuthUserId: UUID malformado é recusado (Zod) antes do SQL', async () => {
        const db = buildDb({});
        const repo = new AccessRepository(db, new EffectivePermissionCalculator());
        expect(await repo.findAccessByAuthUserId("x' OR '1'='1")).toBeNull();
        expect(db.selectFirst).not.toHaveBeenCalled();
    });

    it('findAccessBySub: linha inválida do banco é recusada (Zod), nunca mapeada às cegas', async () => {
        const db = buildDb({});
        (db.selectFirst as jest.Mock).mockResolvedValue({ ...linha(1, 'a'), pacote: null });
        const repo = new AccessRepository(db, new EffectivePermissionCalculator());
        await expect(repo.findAccessBySub('a')).rejects.toThrow();
    });

    it('listRoles: papéis com pacote, ordenados por nome', async () => {
        const db = buildDb({});
        (db.selectMany as jest.Mock).mockResolvedValue([
            { id: 1, nome: 'Administrador', descricao: 'Tudo', permissoes: ['metricas:ver'] },
            { id: 2, nome: 'Consulta', descricao: null, permissoes: [] },
        ]);
        const out = await new AccessRepository(db, new EffectivePermissionCalculator()).listRoles();
        const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toMatch(/ORDER BY lower\(r\.nome\)/);
        expect(out).toEqual([
            { id: 1, nome: 'Administrador', descricao: 'Tudo', permissoes: ['metricas:ver'] },
            { id: 2, nome: 'Consulta', permissoes: [] },
        ]);
    });

    it('listAccessForUsers: papel, pacote e exceções de todos numa consulta só (sem N+1)', async () => {
        const db = buildDb({});
        (db.selectMany as jest.Mock).mockResolvedValue([
            linha(1, 'a'),
            linha(2, 'b', {
                papel: CONSULTA,
                excecoes: [{ permissao: 'sispag:ver', efeito: 'revogar' }],
            }),
        ]);
        const out = await new AccessRepository(
            db,
            new EffectivePermissionCalculator(),
        ).listAccessForUsers();
        expect(db.selectMany).toHaveBeenCalledTimes(1);
        expect(out.get(2)).toMatchObject({
            papel: { id: 2, nome: 'Consulta' },
            excecoes: [{ permissao: 'sispag:ver', efeito: 'revogar' }],
        });
        expect(out.size).toBe(2);
    });

    it('findRoleById: papel com pacote, ou null', async () => {
        const db = buildDb({});
        (db.selectFirst as jest.Mock).mockResolvedValueOnce({
            id: 2,
            nome: 'Consulta',
            descricao: null,
            permissoes: ['permutas:ver'],
        });
        const repo = new AccessRepository(db, new EffectivePermissionCalculator());
        expect(await repo.findRoleById(2)).toEqual({
            id: 2,
            nome: 'Consulta',
            permissoes: ['permutas:ver'],
        });
        expect((db.selectFirst as jest.Mock).mock.calls[0][1]).toEqual({ id: 2 });
        expect(await repo.findRoleById(99)).toBeNull();
    });
});

describe('AccessRepository.setRole — guarda R9/R-extra', () => {
    it('(b) trocar o papel do único gestor para um sem usuarios:gerenciar: LastUserManagerError', async () => {
        const { repo, tx } = repoCom([linha(1, 'gestor'), linha(2, 'outro', { papel: CONSULTA })]);
        await expect(repo.setRole(1, CONSULTA.id, 'outro')).rejects.toBeInstanceOf(
            LastUserManagerError,
        );
        expect(tx.update).not.toHaveBeenCalled();
        expect(tx.insert).not.toHaveBeenCalled();
    });

    it('(e) o chamador tira de si mesmo, com outro gestor ativo: SelfAccessRemovalError', async () => {
        const { repo, tx } = repoCom([linha(1, 'eu@x.com'), linha(2, 'outro@x.com')]);
        await expect(repo.setRole(1, CONSULTA.id, 'eu@x.com')).rejects.toBeInstanceOf(
            SelfAccessRemovalError,
        );
        expect(tx.update).not.toHaveBeenCalled();
    });

    it('com dois gestores, trocar o papel de um passa e grava um evento papel {id,nome} → {id,nome}', async () => {
        const { repo, tx } = repoCom([linha(1, 'a'), linha(2, 'b')]);
        const out = await repo.setRole(2, CONSULTA.id, 'a');
        expect(out.result).toBe(SET_ROLE_RESULT.UPDATED);
        const [sqlUpdate, paramsUpdate] = tx.update.mock.calls[0];
        expect(sqlUpdate).toContain('UPDATE app_user SET role_id = $roleId WHERE id = $id');
        expect(paramsUpdate).toEqual({ roleId: 2, id: 2 });
        expect(eventoGravado(tx)).toEqual({
            ator: 'a',
            alvo: 2,
            tipo: 'papel',
            antes: JSON.stringify({ id: 1, nome: 'Administrador' }),
            depois: JSON.stringify({ id: 2, nome: 'Consulta' }),
        });
    });

    it('(f) mudar o papel de um usuário INATIVO nunca é barrado pela contagem', async () => {
        const { repo } = repoCom([linha(1, 'gestor'), linha(3, 'ex-gestor', { ativo: false })]);
        await expect(repo.setRole(3, CONSULTA.id, 'gestor')).resolves.toMatchObject({
            result: SET_ROLE_RESULT.UPDATED,
        });
    });

    it('(g) quem tem usuarios:gerenciar só por exceção CONTA como gestor', async () => {
        const { repo } = repoCom([
            linha(1, 'gestor'),
            linha(2, 'consulta-gestora', {
                papel: CONSULTA,
                excecoes: [{ permissao: 'usuarios:gerenciar', efeito: 'conceder' }],
            }),
        ]);
        await expect(repo.setRole(1, CONSULTA.id, 'consulta-gestora')).resolves.toMatchObject({
            result: SET_ROLE_RESULT.UPDATED,
        });
    });

    it('(h) trava os ativos ANTES de ler, e checagem + escrita + evento correm no MESMO tx', async () => {
        const { repo, db, chamadas } = repoCom([linha(1, 'a'), linha(2, 'b')]);
        await repo.setRole(2, CONSULTA.id, 'a');
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        expect(chamadas).toEqual([
            'le-papel',
            'trava-ativos',
            'trava-alvo',
            'le-estado',
            'update',
            'evento',
        ]);
        expect(db.update).not.toHaveBeenCalled();
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('mesmo papel: no-op, sem UPDATE e sem evento', async () => {
        const { repo, tx } = repoCom([linha(1, 'a'), linha(2, 'b')]);
        expect((await repo.setRole(2, ADMIN.id, 'a')).result).toBe(SET_ROLE_RESULT.UNCHANGED);
        expect(tx.update).not.toHaveBeenCalled();
        expect(tx.insert).not.toHaveBeenCalled();
    });

    it('papel inexistente e usuário inexistente são resultados distintos', async () => {
        const { repo } = repoCom([linha(1, 'a')]);
        expect((await repo.setRole(1, 99, 'a')).result).toBe(SET_ROLE_RESULT.ROLE_NOT_FOUND);
        expect((await repo.setRole(42, CONSULTA.id, 'a')).result).toBe(
            SET_ROLE_RESULT.USER_NOT_FOUND,
        );
    });
});

describe('AccessRepository.replaceExceptions — guarda R9/R-extra', () => {
    const revogarGestao = [{ permissao: 'usuarios:gerenciar', efeito: 'revogar' }] as const;

    it('(c) revogar usuarios:gerenciar do único gestor: LastUserManagerError', async () => {
        const { repo, tx } = repoCom([linha(1, 'gestor'), linha(2, 'b', { papel: CONSULTA })]);
        await expect(repo.replaceExceptions(1, [...revogarGestao], 'b')).rejects.toBeInstanceOf(
            LastUserManagerError,
        );
        expect(tx.update).not.toHaveBeenCalled();
        expect(tx.insert).not.toHaveBeenCalled();
    });

    it('(d) com dois gestores, revogar de um passa: DELETE + INSERT e UM evento, no mesmo tx', async () => {
        const { repo, tx, chamadas } = repoCom([linha(1, 'a'), linha(2, 'b')]);
        const out = await repo.replaceExceptions(2, [...revogarGestao], 'a');
        expect(out.result).toBe(REPLACE_EXCEPTIONS_RESULT.UPDATED);
        expect(chamadas).toEqual([
            'trava-ativos',
            'trava-alvo',
            'le-estado',
            'delete',
            'insert',
            'evento',
        ]);

        const [sqlInsert, paramsInsert] = tx.insert.mock.calls[0];
        expect(sqlInsert).toContain('INSERT INTO user_permission');
        expect(paramsInsert).toEqual({
            userId: 2,
            permissoes: ['usuarios:gerenciar'],
            efeitos: ['revogar'],
            ator: 'a',
        });
        expect(eventoGravado(tx)).toEqual({
            ator: 'a',
            alvo: 2,
            tipo: 'excecao',
            antes: JSON.stringify([]),
            depois: JSON.stringify([{ permissao: 'usuarios:gerenciar', efeito: 'revogar' }]),
        });
    });

    it('(e) revogar a própria usuarios:gerenciar, com outro gestor ativo: SelfAccessRemovalError', async () => {
        const { repo, tx } = repoCom([linha(1, 'eu'), linha(2, 'outro')]);
        await expect(repo.replaceExceptions(1, [...revogarGestao], 'eu')).rejects.toBeInstanceOf(
            SelfAccessRemovalError,
        );
        expect(tx.update).not.toHaveBeenCalled();
    });

    it('o próprio chamador pode mexer nas suas outras exceções', async () => {
        const { repo } = repoCom([linha(1, 'eu')]);
        await expect(
            repo.replaceExceptions(1, [{ permissao: 'sispag:executar', efeito: 'revogar' }], 'eu'),
        ).resolves.toMatchObject({ result: REPLACE_EXCEPTIONS_RESULT.UPDATED });
    });

    it('mesmo conjunto (em outra ordem): no-op, sem DELETE e sem evento', async () => {
        const atuais = [
            { permissao: 'sispag:executar', efeito: 'revogar' },
            { permissao: 'metricas:ver', efeito: 'revogar' },
        ];
        const { repo, tx } = repoCom([linha(1, 'a'), linha(2, 'b', { excecoes: atuais })]);
        const out = await repo.replaceExceptions(
            2,
            [
                { permissao: 'metricas:ver', efeito: 'revogar' },
                { permissao: 'sispag:executar', efeito: 'revogar' },
            ],
            'a',
        );
        expect(out.result).toBe(REPLACE_EXCEPTIONS_RESULT.UNCHANGED);
        expect(tx.update).not.toHaveBeenCalled();
        expect(tx.insert).not.toHaveBeenCalled();
    });

    it('conjunto vazio: só DELETE (sem INSERT de exceção), com evento', async () => {
        const { repo, tx } = repoCom([
            linha(1, 'a'),
            linha(2, 'b', { excecoes: [{ permissao: 'sispag:ver', efeito: 'revogar' }] }),
        ]);
        await repo.replaceExceptions(2, [], 'a');
        expect(tx.update).toHaveBeenCalledTimes(1);
        const inserts = tx.insert.mock.calls.map(([sql]) => String(sql));
        expect(inserts.some((s) => s.includes('INSERT INTO user_permission'))).toBe(false);
        expect(eventoGravado(tx)).toMatchObject({ tipo: 'excecao', depois: '[]' });
    });

    it('usuário inexistente: NOT_FOUND', async () => {
        const { repo } = repoCom([linha(1, 'a')]);
        expect((await repo.replaceExceptions(7, [], 'a')).result).toBe(
            REPLACE_EXCEPTIONS_RESULT.NOT_FOUND,
        );
    });
});

describe('trilha app_user_access_event é append-only', () => {
    it('nenhum repositório faz UPDATE ou DELETE na trilha', () => {
        for (const arquivo of ['AccessRepository.ts', 'UserRepository.ts']) {
            const fonte = readFileSync(path.join(__dirname, arquivo), 'utf8');
            expect(fonte).not.toMatch(/UPDATE\s+app_user_access_event/i);
            expect(fonte).not.toMatch(/DELETE\s+FROM\s+app_user_access_event/i);
        }
    });
});
