import 'reflect-metadata';

const readdirSync = jest.fn();
const readFileSync = jest.fn();

jest.mock('node:fs', () => ({
    readdirSync: (...a: unknown[]) => readdirSync(...a),
    readFileSync: (...a: unknown[]) => readFileSync(...a),
}));

/**
 * `MIGRATIONS_DIR` é resolvido com `import.meta`, que não compila sob o ts-jest
 * do projeto. Ele vive num módulo próprio exatamente para poder ser trocado
 * aqui — sem isto o runner inteiro fica fora do alcance dos testes.
 */
jest.mock('./migrationsDirectory.js', () => ({ MIGRATIONS_DIR: '/fake/migrations' }));

import MigrationRunner, { MIGRATION_ADVISORY_LOCK_KEY } from './runMigrations.js';

/**
 * `MigrationFiles` falso por cima do `readdirSync` mockado: a regra real (só `.sql` do nível de
 * cima, ordenados) é coberta nos testes do próprio `MigrationFiles`; aqui importa só a ordem.
 */
const migrationFiles = {
    listOrFail: (dir: string): string[] =>
        (readdirSync(dir) as string[]).filter((f) => f.endsWith('.sql')).sort(),
};

type TxCall = { sql: string; params?: Record<string, unknown> };

/**
 * Banco falso que grava cada statement emitido e delimita as transações, para
 * que os testes possam afirmar o que rodou DENTRO de qual transação.
 */
const buildDatabase = (options: { applied?: string[]; failOn?: string } = {}) => {
    const applied = new Set(options.applied ?? []);
    const transactions: TxCall[][] = [];
    const committed: string[] = [];

    const tx = {
        current: [] as TxCall[],
        selectMany: async (sql: string, params?: Record<string, unknown>) => {
            tx.current.push({ sql, params });
            return [];
        },
        selectFirst: async (sql: string, params?: Record<string, unknown>) => {
            tx.current.push({ sql, params });
            const name = String(params?.name ?? '');
            return applied.has(name) ? { name } : null;
        },
        insert: async (sql: string, params?: Record<string, unknown>) => {
            tx.current.push({ sql, params });
            if (options.failOn && sql.includes(options.failOn)) throw new Error('DDL explodiu');
            return 1;
        },
        update: async () => 0,
    };

    return {
        transactions,
        committed,
        client: {
            selectMany: jest.fn(async () => [...applied].map((name) => ({ name }))),
            withTransaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
                tx.current = [];
                transactions.push(tx.current);
                const result = await fn(tx);
                // Só chega aqui se `fn` não lançou — equivale ao COMMIT.
                for (const call of tx.current) {
                    const name = call.params?.name;
                    if (call.sql.includes('INSERT INTO schema_migrations') && name) {
                        applied.add(String(name));
                        committed.push(String(name));
                    }
                }
                return result;
            }),
        },
    };
};

describe('MigrationRunner — concorrência e atomicidade', () => {
    beforeEach(() => {
        readdirSync.mockReset();
        readFileSync.mockReset();
        readdirSync.mockReturnValue(['0001_a.sql', '0002_b.sql', 'rollbacks']);
        readFileSync.mockImplementation((p: string) => `-- sql de ${p}`);
    });

    it('aplica as migrações pendentes em ordem lexicográfica', async () => {
        const db = buildDatabase();
        const applied = await new MigrationRunner(db.client as any, migrationFiles as any).run();

        expect(applied).toEqual(['0001_a.sql', '0002_b.sql']);
        expect(db.committed).toEqual(['0001_a.sql', '0002_b.sql']);
    });

    it('ignora o que já está em schema_migrations', async () => {
        const db = buildDatabase({ applied: ['0001_a.sql'] });
        const applied = await new MigrationRunner(db.client as any, migrationFiles as any).run();

        expect(applied).toEqual(['0002_b.sql']);
    });

    it('não aplica arquivo que não termina em .sql (rollbacks/ fica de fora)', async () => {
        const db = buildDatabase();
        await new MigrationRunner(db.client as any, migrationFiles as any).run();

        expect(readFileSync).not.toHaveBeenCalledWith(expect.stringContaining('rollbacks'), 'utf8');
    });

    /**
     * O runner tem três gatilhos (bootstrapAppContainer, BootMigrator e o
     * `npm run migrate` de 6 crons). Sem lock, um deploy caindo junto do reaper
     * (que roda de 15 em 15 min) aplica o MESMO arquivo duas vezes.
     */
    it('toda transação começa tomando o advisory lock, com espera limitada', async () => {
        const db = buildDatabase();
        await new MigrationRunner(db.client as any, migrationFiles as any).run();

        expect(db.transactions.length).toBeGreaterThan(0);
        for (const calls of db.transactions) {
            expect(calls[0].sql).toContain('SET LOCAL lock_timeout');
            expect(calls[1].sql).toContain('pg_advisory_xact_lock');
            expect(calls[1].params).toEqual({ lockKey: MIGRATION_ADVISORY_LOCK_KEY });
        }
    });

    it('usa o lock TRANSACIONAL — liberado no commit, nunca um unlock manual', async () => {
        const db = buildDatabase();
        await new MigrationRunner(db.client as any, migrationFiles as any).run();

        const todos = db.transactions.flat().map((c) => c.sql);
        expect(todos.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
        expect(todos.some((s) => s.includes('pg_advisory_unlock'))).toBe(false);
    });

    /**
     * O par DDL + registro era dois statements soltos: um crash entre eles
     * deixava a migração aplicada e NÃO registrada, para ser reaplicada no boot
     * seguinte.
     */
    it('DDL e INSERT em schema_migrations ficam na MESMA transação', async () => {
        const db = buildDatabase();
        await new MigrationRunner(db.client as any, migrationFiles as any).run();

        const deMigracao = db.transactions.filter((calls) =>
            calls.some((c) => c.sql.includes('INSERT INTO schema_migrations')),
        );
        expect(deMigracao).toHaveLength(2);

        for (const calls of deMigracao) {
            const sqls = calls.map((c) => c.sql);
            expect(sqls.some((s) => s.startsWith('-- sql de'))).toBe(true);
            expect(sqls.some((s) => s.includes('INSERT INTO schema_migrations'))).toBe(true);
        }
    });

    it('DDL que falha não registra a migração nem segue para a próxima', async () => {
        const db = buildDatabase({ failOn: '0001_a' });

        await expect(
            new MigrationRunner(db.client as any, migrationFiles as any).run(),
        ).rejects.toThrow('DDL explodiu');
        expect(db.committed).toEqual([]);
    });

    /**
     * Quem esperou o lock precisa reler `schema_migrations` DENTRO da transação:
     * o processo que estava na frente pode ter aplicado o arquivo enquanto isso.
     */
    it('relê schema_migrations dentro da transação e pula o que outro já aplicou', async () => {
        // O estado do banco JÁ tem a 0001 (o processo concorrente a aplicou),
        // mas a leitura inicial — feita antes do lock — ainda não a via.
        const db = buildDatabase({ applied: ['0001_a.sql'] });
        db.client.selectMany.mockResolvedValueOnce([]);

        const applied = await new MigrationRunner(db.client as any, migrationFiles as any).run();

        expect(applied).toEqual(['0002_b.sql']);
        expect(db.committed).toEqual(['0002_b.sql']);
    });

    it('cria schema_migrations sob o lock, antes de ler a lista de aplicadas', async () => {
        const db = buildDatabase();
        await new MigrationRunner(db.client as any, migrationFiles as any).run();

        const primeira = db.transactions[0].map((c) => c.sql);
        expect(
            primeira.some((s) => s.includes('CREATE TABLE IF NOT EXISTS schema_migrations')),
        ).toBe(true);
    });

    it('impõe lock_timeout e statement_timeout à execução do DDL', async () => {
        const db = buildDatabase();
        await new MigrationRunner(db.client as any, migrationFiles as any).run();

        const daMigracao = db.transactions.find((calls) =>
            calls.some((c) => c.sql.includes('INSERT INTO schema_migrations')),
        );
        const sqls = (daMigracao ?? []).map((c) => c.sql);
        expect(sqls.some((s) => s.includes("statement_timeout = '10min'"))).toBe(true);
        expect(sqls.some((s) => s.includes("lock_timeout = '30s'"))).toBe(true);
    });
});
