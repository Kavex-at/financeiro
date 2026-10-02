import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import AccessRepository, { ACCESS_EVENT_TYPE } from '../domain/repository/auth/AccessRepository.js';
import UserRepository from '../domain/repository/auth/UserRepository.js';
import EffectivePermissionCalculator from '../domain/service/auth/EffectivePermissionCalculator.js';

/**
 * 0073 contra um Postgres DE VERDADE (ADR-0059): a CHECK ampliada, a reaplicação idempotente e a
 * escrita de senha do `UserRepository` real — hash e evento `senha` na MESMA transação, com
 * ROLLBACK dos dois quando o passo do espelho falha.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql` com o mesmo DSN dos testes da 0067–0069:
 *
 *   docker run -d --rm --name senha-pg-test -e POSTGRES_PASSWORD=test -p 55473:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55473/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `auth_senha_propria_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'auth_senha_propria_it';
const NOME = '0073_app_user_access_event_tipo_senha.sql';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0073 — tipo senha na trilha de acesso (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let repo: UserRepository;
    let userId = 0;

    const hashAtual = async (): Promise<string> =>
        (await db.query('SELECT password_hash FROM app_user WHERE id = $1', [userId])).rows[0]
            .password_hash;
    const eventosSenha = async (): Promise<number> =>
        Number(
            (
                await db.query(
                    `SELECT count(*) AS n FROM app_user_access_event
                     WHERE tipo = 'senha' AND alvo_user_id = $1`,
                    [userId],
                )
            ).rows[0].n,
        );

    beforeAll(async () => {
        const dsn = ADMIN_DSN ?? '';
        const host = new URL(dsn).hostname;
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
            throw new Error(`METRICAS_CICLO_TEST_DSN precisa ser local; recebido host "${host}"`);
        }
        const raiz = new Client({ connectionString: dsn });
        await raiz.connect();
        await raiz.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
        await raiz.query(`CREATE DATABASE ${BANCO}`);
        await raiz.end();

        const dsnBanco = dsnPara(dsn, BANCO);
        db = new Client({ connectionString: dsnBanco });
        await db.connect();
        const migrations = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort();
        expect(migrations).toContain(NOME);
        for (const arquivo of migrations) {
            await db.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }
        // Idempotente: aplicar de novo não quebra.
        await db.query(readFileSync(path.join(__dirname, NOME), 'utf8'));

        const criado = await db.query(
            `INSERT INTO app_user (username, password_hash, role_id, ativo)
             VALUES ('beto@qa.local', 'hash-antigo',
                     (SELECT id FROM app_role WHERE lower(nome) = 'administrador'), true)
             RETURNING id`,
        );
        userId = Number(criado.rows[0].id);

        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        repo = new UserRepository(
            pool,
            new AccessRepository(pool, new EffectivePermissionCalculator()),
        );
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it("a CHECK aceita exatamente 'papel', 'excecao', 'ativo', 'senha'", async () => {
        const def = (
            await db.query(
                `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
                 WHERE conname = 'app_user_access_event_tipo_check'`,
            )
        ).rows;
        expect(def).toHaveLength(1);
        for (const tipo of ['papel', 'excecao', 'ativo', 'senha']) {
            expect(def[0].def).toContain(`'${tipo}'`);
        }
    });

    it("INSERT com tipo 'senha' passa; com 'outro' é recusado", async () => {
        await db.query(
            `INSERT INTO app_user_access_event (ator, alvo_user_id, tipo)
             VALUES ('sonda', $1, 'senha')`,
            [userId],
        );
        await expect(
            db.query(
                `INSERT INTO app_user_access_event (ator, alvo_user_id, tipo)
                 VALUES ('sonda', $1, 'outro')`,
                [userId],
            ),
        ).rejects.toThrow(/app_user_access_event_tipo_check/);
        await db.query(`DELETE FROM app_user_access_event WHERE ator = 'sonda'`);
    });

    it('updatePassword com evento e passo falhando: ROLLBACK do hash E do evento', async () => {
        await expect(
            repo.updatePassword(userId, 'hash-novo', {
                evento: {
                    actor: 'beto@qa.local',
                    targetId: userId,
                    type: ACCESS_EVENT_TYPE.SENHA,
                    before: null,
                    after: null,
                },
                antesDoCommit: async () => {
                    throw new Error('gotrue fora');
                },
            }),
        ).rejects.toThrow('gotrue fora');
        expect(await hashAtual()).toBe('hash-antigo');
        expect(await eventosSenha()).toBe(0);
    });

    it('updatePassword com evento: hash novo e UMA linha senha com antes/depois NULL', async () => {
        const ok = await repo.updatePassword(userId, 'hash-novo', {
            evento: {
                actor: 'beto@qa.local',
                targetId: userId,
                type: ACCESS_EVENT_TYPE.SENHA,
                before: null,
                after: null,
            },
        });
        expect(ok).toBe(true);
        expect(await hashAtual()).toBe('hash-novo');
        const linhas = (
            await db.query(
                `SELECT ator, tipo, antes, depois FROM app_user_access_event
                 WHERE alvo_user_id = $1 AND tipo = 'senha'`,
                [userId],
            )
        ).rows;
        expect(linhas).toEqual([
            { ator: 'beto@qa.local', tipo: 'senha', antes: null, depois: null },
        ]);
    });

    it('updatePassword sem passo (reset do admin sem espelho): id inexistente → false', async () => {
        expect(await repo.updatePassword(999_999, 'h')).toBe(false);
    });
});
