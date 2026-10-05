import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0068 contra um Postgres DE VERDADE (ADR-0054 D10): o `CHECK` das permissões, o selo do
 * Administrador e a aprovação na trilha só-inclusão.
 *
 * É HISTÓRICO: a ADR-0060 (migration 0075) trocou `sispag:aprovar_destino` por `sispag:excecao` e
 * retirou o destino digitado por item. Por isso aplica só as migrations ATÉ a 0068 — o estado do
 * banco no dia em que ela subiu — e testa o esquema com SQL cru (o repositório que gravava e
 * aprovava o destino do item foi removido). A conversão para `sispag:excecao` está no teste da 0075.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql` com o mesmo DSN do teste da 0067:
 *
 *   docker run -d --rm --name destino-pg-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_aprovar_destino_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_aprovar_destino_it';
const NOME_0068 = '0068_sispag_aprovar_destino.sql';
const LOTE = '00000000-0000-0000-0000-000000000068';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0068 — aprovação do destino digitado (integração, histórico)', () => {
    let db: Client;

    const gravacao = async (id: string): Promise<void> => {
        await db.query(
            `INSERT INTO lote_pagamento_item_destino_audit
                (id, lote_id, fil_cod, doc_cod, tit_cod, alterado_por, evento, depois)
             VALUES ($1, $2, 1, '100', '1', 'ana', 'GRAVACAO', '{"tipo":"CONTA"}'::jsonb)`,
            [id, LOTE],
        );
    };

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
        expect(migrations).toContain(NOME_0068);
        // Só até a 0068: o esquema do dia em que ela subiu.
        for (const arquivo of migrations.filter((f) => f <= NOME_0068)) {
            await db.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }
        // Idempotente: aplicar de novo não quebra nem duplica.
        await db.query(readFileSync(path.join(__dirname, NOME_0068), 'utf8'));

        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por)
             VALUES ($1, 1, 'RASCUNHO', 'u1')`,
            [LOTE],
        );
    });

    afterAll(async () => {
        await db?.end();
    });

    it('o Administrador tem sispag:aprovar_destino, uma vez só', async () => {
        const r = await db.query(
            `SELECT count(*)::int AS n FROM app_role_permission p JOIN app_role r ON r.id = p.role_id
             WHERE lower(r.nome) = 'administrador' AND p.permission = 'sispag:aprovar_destino'`,
        );
        expect(r.rows[0].n).toBe(1);
    });

    it('o CHECK novo aceita a permissão nova e recusa valor fora do catálogo', async () => {
        const papel = await db.query(
            `INSERT INTO app_role (nome) VALUES ('Aprovador IT') RETURNING id`,
        );
        const id = papel.rows[0].id;
        await db.query(
            `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, 'sispag:aprovar_destino')`,
            [id],
        );
        await expect(
            db.query(
                `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, 'sispag:inventada')`,
                [id],
            ),
        ).rejects.toThrow(/check/i);
    });

    it('APROVACAO sem a gravação aprovada é recusada pelo CHECK', async () => {
        await expect(
            db.query(
                `INSERT INTO lote_pagamento_item_destino_audit
                    (id, lote_id, fil_cod, doc_cod, tit_cod, alterado_por, evento)
                 VALUES ('00000000-0000-0000-0000-0000000000b1', $1, 1, '100', '1', 'x', 'APROVACAO')`,
                [LOTE],
            ),
        ).rejects.toThrow(/check/i);
    });

    it('GRAVACAO → APROVACAO apontando para ela; a trilha continua só-inclusão', async () => {
        const g = '00000000-0000-0000-0000-0000000000c1';
        await gravacao(g);
        await db.query(
            `INSERT INTO lote_pagamento_item_destino_audit
                (id, lote_id, fil_cod, doc_cod, tit_cod, alterado_por, evento, aprova_audit_id)
             VALUES ('00000000-0000-0000-0000-0000000000c2', $1, 1, '100', '1', 'bia', 'APROVACAO', $2)`,
            [LOTE, g],
        );
        await expect(
            db.query(
                `UPDATE lote_pagamento_item_destino_audit SET alterado_por = 'x' WHERE evento = 'APROVACAO'`,
            ),
        ).rejects.toThrow(/s[oó] de inclus[aã]o/i);
    });
});
