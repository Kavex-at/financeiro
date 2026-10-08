import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import AuthorizedPayeeActiveExistsError from '../../errors/AuthorizedPayeeActiveExistsError.js';
import SqlBuilder from '../../libs/sql/SqlBuilder.js';
import AuthorizedPayeeRepository from './AuthorizedPayeeRepository.js';

/**
 * `AuthorizedPayeeRepository` contra um Postgres DE VERDADE com todas as migrations aplicadas.
 * Roda no `npm run test:sql` (ver `migrations/0080_*.integration.test.ts` para o DSN local).
 */
jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
const BANCO = 'sispag_fav_aut_repo_it';
const MIGRATIONS = path.join(__dirname, '../../../migrations');

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

/** Adaptador mínimo do `PostgreeDatabaseClient` sobre um `pg.Client` (mesmo SqlBuilder). */
const adaptar = (db: Client): PostgreeDatabaseClient => {
    const sb = new SqlBuilder();
    const run = async (q: string, p?: Record<string, unknown>) => {
        const { query, params } = p ? sb.build(q, p) : { query: q, params: undefined };
        return db.query(query, params as unknown[] | undefined);
    };
    return {
        selectMany: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rows,
        selectFirst: async (q: string, p?: Record<string, unknown>) =>
            (await run(q, p)).rows[0] ?? null,
        insert: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rowCount ?? 0,
        update: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rowCount ?? 0,
    } as unknown as PostgreeDatabaseClient;
};

describeComBanco('AuthorizedPayeeRepository — integração (ADR-0065)', () => {
    let db: Client;
    let repo: AuthorizedPayeeRepository;

    beforeAll(async () => {
        const dsn = ADMIN_DSN ?? '';
        if (!['localhost', '127.0.0.1', '::1'].includes(new URL(dsn).hostname)) {
            throw new Error('METRICAS_CICLO_TEST_DSN precisa ser local');
        }
        const raiz = new Client({ connectionString: dsn });
        await raiz.connect();
        await raiz.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
        await raiz.query(`CREATE DATABASE ${BANCO}`);
        await raiz.end();
        const url = new URL(dsn);
        url.pathname = `/${BANCO}`;
        db = new Client({ connectionString: url.toString() });
        await db.connect();
        for (const f of readdirSync(MIGRATIONS)
            .filter((n) => /^\d{4}_.*\.sql$/.test(n))
            .sort()) {
            await db.query(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
        }
        repo = new AuthorizedPayeeRepository(adaptar(db));
    });

    afterAll(async () => {
        await db?.end();
    });

    it('ciclo: inserir PENDENTE → aprovar com versão → vigente devolve AUTORIZADO', async () => {
        const id = await repo.inserir({
            pesCod: '8001',
            credor: 'ACME',
            modalidade: 'TED',
            origemSolicitacao: 'RELATORIO',
            filCodLeitura: 2,
            solicitadoPor: 'ana',
        });
        const pendente = await repo.buscarVigente('8001', 'TED');
        expect(pendente).toMatchObject({ id, estado: 'PENDENTE', versao: 1, filCodLeitura: 2 });
        expect(
            await repo.atualizarComVersao(id, 1, {
                estado: 'AUTORIZADO',
                fingerprint: 'f'.repeat(64),
                fingerprintChaveId: 'v1',
                destinoMascarado: 'banco 237 · ag. 1 · cc ****4321-0',
                decididoPor: 'bia',
                decididoEm: new Date(),
            }),
        ).toBe(1);
        // Versão velha não aplica.
        expect(await repo.atualizarComVersao(id, 1, { estado: 'REVOGADO' })).toBe(0);
        const vigente = await repo.buscarVigente('8001', 'TED');
        expect(vigente).toMatchObject({ estado: 'AUTORIZADO', versao: 2, decididoPor: 'bia' });
        const lote = await repo.listarVigentesPorPesCods(['8001', '9999']);
        expect(lote.map((a) => a.id)).toEqual([id]);
    });

    it('segundo pedido vigente para o mesmo par → AuthorizedPayeeActiveExistsError', async () => {
        await repo.inserir({
            pesCod: '8002',
            modalidade: 'PIX',
            origemSolicitacao: 'ITEM',
            filCodLeitura: 1,
            solicitadoPor: 'ana',
        });
        await expect(
            repo.inserir({
                pesCod: '8002',
                modalidade: 'PIX',
                origemSolicitacao: 'ITEM',
                filCodLeitura: 1,
                solicitadoPor: 'carla',
            }),
        ).rejects.toBeInstanceOf(AuthorizedPayeeActiveExistsError);
    });

    it('a trilha não pode ser alterada nem apagada', async () => {
        const id = await repo.inserir({
            pesCod: '8003',
            modalidade: 'TED',
            origemSolicitacao: 'MANUAL',
            filCodLeitura: 1,
            solicitadoPor: 'ana',
        });
        const evento = await repo.registrarEvento({
            autorizacaoId: id,
            evento: 'SOLICITADO',
            ator: 'ana',
            dados: { origem: 'MANUAL' },
        });
        await expect(
            db.query(`UPDATE sispag_favorecido_autorizado_evento SET ator = 'x' WHERE id = $1`, [
                evento,
            ]),
        ).rejects.toThrow(/so de inclusao/);
        await expect(
            db.query('DELETE FROM sispag_favorecido_autorizado_evento WHERE id = $1', [evento]),
        ).rejects.toThrow(/so de inclusao/);
        const eventos = await repo.listarEventos(id);
        expect(eventos).toEqual([
            expect.objectContaining({
                evento: 'SOLICITADO',
                ator: 'ana',
                dados: { origem: 'MANUAL' },
            }),
        ]);
    });

    it('nenhuma coluna guarda conta, agência ou chave completas', async () => {
        const r = await db.query(
            `SELECT column_name FROM information_schema.columns
              WHERE table_name IN ('sispag_favorecido_autorizado', 'sispag_favorecido_autorizado_evento')`,
        );
        const nomes = r.rows.map((x) => x.column_name as string);
        for (const n of nomes) expect(n).not.toMatch(/^(conta|agencia|chave_pix|banco_cod)/);
    });
});
