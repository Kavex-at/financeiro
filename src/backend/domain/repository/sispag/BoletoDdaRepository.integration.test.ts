import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import SqlBuilder from '../../libs/sql/SqlBuilder.js';
import BoletoDdaRepository from './BoletoDdaRepository.js';

/**
 * `BoletoDdaRepository.buscarPorChave` contra um Postgres DE VERDADE com todas as migrations
 * aplicadas (ADR-0068, anti-TOCTOU). O teste com `selectFirst` mockado devolve a linha que o
 * próprio teste escreveu; só o banco real prova que o SELECT traz todas as colunas que o mapper lê
 * (`numero`, `codbar`, o vínculo do ERP, `arquivo`, `importado_em`) e que arquivo cancelado some.
 *
 * Roda no `npm run test:sql`. O DSN precisa ser LOCAL: o teste apaga e recria o banco
 * `boleto_dda_repo_it`.
 */
jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
const BANCO = 'boleto_dda_repo_it';
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
    } as unknown as PostgreeDatabaseClient;
};

describeComBanco('BoletoDdaRepository.buscarPorChave — integração (ADR-0068)', () => {
    let db: Client;
    let repo: BoletoDdaRepository;

    const IMPORTADO_EM = '2026-10-13T11:30:00Z';

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
        repo = new BoletoDdaRepository(adaptar(db));
        await db.query(
            `INSERT INTO boleto_dda_arquivo (ddc_cod, nome, importado_em, cancelado_em, status, total_itens)
             VALUES (900, 'DDA_2026-10-13.RET', $1, NULL, 1, 3),
                    (901, 'DDA_CANCELADO.RET', $1, now(), 2, 1)`,
            [IMPORTADO_EM],
        );
    });

    afterAll(async () => {
        await db?.end();
    });

    const inserir = (ddc: number, dit: number, over: Record<string, unknown> = {}) => {
        const c = {
            numero: '001532761',
            valor: '4321.09',
            vencimento: '2026-10-22',
            codbar: '23791265609000000712800927406000148153300000000',
            fil_cod: null,
            doc_cod: null,
            tit_cod: null,
            flp_cod: null,
            bnc_cod: null,
            ...over,
        };
        return db.query(
            `INSERT INTO boleto_dda
                (ddc_cod, dit_cod, numero, valor, vencimento, codbar, fil_cod, doc_cod, tit_cod,
                 flp_cod, bnc_cod)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
                ddc,
                dit,
                c.numero,
                c.valor,
                c.vencimento,
                c.codbar,
                c.fil_cod,
                c.doc_cod,
                c.tit_cod,
                c.flp_cod,
                c.bnc_cod,
            ],
        );
    };

    it('mapeia TODA coluna que o mapper lê, inclusive o vínculo do ERP, o arquivo e a importação', async () => {
        await inserir(900, 1, {
            fil_cod: 2,
            doc_cod: '5046',
            tit_cod: '1',
            flp_cod: 77,
            bnc_cod: 237,
        });
        const b = await repo.buscarPorChave({ ddcCod: 900, ditCod: 1 });
        expect(b).toEqual({
            ddcCod: 900,
            ditCod: 1,
            numero: '001532761',
            valor: 4321.09,
            vencimento: '2026-10-22',
            codbar: '23791265609000000712800927406000148153300000000',
            filCod: 2,
            docCod: '5046',
            titCod: '1',
            flpCod: 77,
            bncCod: 237,
            arquivo: 'DDA_2026-10-13.RET',
            importadoEm: Date.parse(IMPORTADO_EM),
        });
    });

    it('boleto livre: sem vínculo do ERP, e o vencimento sai como data civil sem deslocar o dia', async () => {
        await inserir(900, 2, { vencimento: '2026-10-31' });
        const b = await repo.buscarPorChave({ ddcCod: 900, ditCod: 2 });
        expect(b).toMatchObject({ ddcCod: 900, ditCod: 2, vencimento: '2026-10-31' });
        for (const campo of ['filCod', 'docCod', 'titCod', 'flpCod', 'bncCod'] as const) {
            expect(b?.[campo]).toBeUndefined();
        }
    });

    it('colunas nulas viram ausência (número, vencimento e barras)', async () => {
        await inserir(900, 3, { numero: null, vencimento: null, codbar: null });
        const b = await repo.buscarPorChave({ ddcCod: 900, ditCod: 3 });
        expect(b).toMatchObject({ ddcCod: 900, ditCod: 3, valor: 4321.09 });
        for (const campo of ['numero', 'vencimento', 'codbar'] as const) {
            expect(b?.[campo]).toBeUndefined();
        }
    });

    it('arquivo cancelado não devolve o boleto; chave inexistente → null', async () => {
        await inserir(901, 1);
        expect(await repo.buscarPorChave({ ddcCod: 901, ditCod: 1 })).toBeNull();
        expect(await repo.buscarPorChave({ ddcCod: 900, ditCod: 99 })).toBeNull();
    });

    it('buscarPorChave e listBoletos devolvem o MESMO objeto para o mesmo boleto', async () => {
        const doPool = (await repo.listBoletos({})).find((x) => x.ddcCod === 900 && x.ditCod === 1);
        const pontual = await repo.buscarPorChave({ ddcCod: 900, ditCod: 1 });
        expect(pontual).toBeDefined();
        expect(pontual).toEqual(doPool);
    });
});
