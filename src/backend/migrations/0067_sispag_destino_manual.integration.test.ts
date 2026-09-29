import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0067 contra um Postgres DE VERDADE: a trilha do destino manual (I10g) é só-inclusão.
 *
 * Não roda no `npm test` (padrão `*.integration.test.ts`). Roda no `npm run test:sql` (job
 * `backend-sql` do CI) com o mesmo DSN do teste de métricas:
 *
 *   docker run -d --rm --name destino-pg-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_destino_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_destino_it';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0067 — trilha do destino manual (integração)', () => {
    let db: Client;

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

        db = new Client({ connectionString: dsnPara(dsn, BANCO) });
        await db.connect();
        const migrations = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort();
        expect(migrations).toContain('0067_sispag_destino_manual.sql');
        for (const arquivo of migrations) {
            await db.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }
        // Idempotente: aplicar de novo não quebra.
        await db.query(
            readFileSync(path.join(__dirname, '0067_sispag_destino_manual.sql'), 'utf8'),
        );

        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por)
             VALUES ('00000000-0000-0000-0000-000000000001', 1, 'RASCUNHO', 'u1')`,
        );
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por)
             VALUES ('00000000-0000-0000-0000-000000000001', 1, '100', '1', 'u1')`,
        );
        await db.query(
            `INSERT INTO lote_pagamento_item_destino_audit
                (id, lote_id, fil_cod, doc_cod, tit_cod, alterado_por, antes, depois)
             VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001',
                     1, '100', '1', 'u1', NULL, '{"tipo":"CONTA"}'::jsonb)`,
        );
    });

    afterAll(async () => {
        await db?.end();
    });

    it('destino_manual nasce NULL e aceita jsonb', async () => {
        const antes = await db.query('SELECT destino_manual FROM lote_pagamento_item');
        expect(antes.rows[0].destino_manual).toBeNull();
        await db.query(`UPDATE lote_pagamento_item SET destino_manual = '{"tipo":"CONTA"}'::jsonb`);
        const depois = await db.query('SELECT destino_manual FROM lote_pagamento_item');
        expect(depois.rows[0].destino_manual).toEqual({ tipo: 'CONTA' });
    });

    it('INSERT na trilha funciona', async () => {
        const r = await db.query(
            'SELECT count(*)::int AS n FROM lote_pagamento_item_destino_audit',
        );
        expect(r.rows[0].n).toBe(1);
    });

    it('UPDATE na trilha é recusado', async () => {
        await expect(
            db.query(`UPDATE lote_pagamento_item_destino_audit SET alterado_por = 'x'`),
        ).rejects.toThrow(/s[oó] de inclus[aã]o/i);
    });

    it('DELETE na trilha é recusado', async () => {
        await expect(db.query('DELETE FROM lote_pagamento_item_destino_audit')).rejects.toThrow(
            /s[oó] de inclus[aã]o/i,
        );
    });

    it('TRUNCATE na trilha é recusado', async () => {
        await expect(db.query('TRUNCATE lote_pagamento_item_destino_audit')).rejects.toThrow(
            /s[oó] de inclus[aã]o/i,
        );
    });

    it('apagar o lote (desfazer automático) não apaga nem é barrado pela trilha', async () => {
        await db.query(
            `DELETE FROM lote_pagamento WHERE id = '00000000-0000-0000-0000-000000000001'`,
        );
        const r = await db.query(
            'SELECT count(*)::int AS n FROM lote_pagamento_item_destino_audit',
        );
        expect(r.rows[0].n).toBe(1);
    });
});
