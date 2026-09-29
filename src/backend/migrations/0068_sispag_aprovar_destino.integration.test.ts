import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import type { DestinoManual } from '../domain/interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import LotePagamentoRepository from '../domain/repository/sispag/LotePagamentoRepository.js';

/**
 * 0068 contra um Postgres DE VERDADE (ADR-0054 D10): o `CHECK` novo das permissões, o selo do
 * Administrador e a aprovação derivada da trilha — pelo `LotePagamentoRepository` real.
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
const LOTE = '00000000-0000-0000-0000-000000000068';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const CONTA: DestinoManual = {
    tipo: 'CONTA',
    bancoCod: '237',
    agencia: '1234',
    conta: '99887766',
    contaDv: '1',
    titularDocumento: '11144477735',
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0068 — aprovação do destino digitado (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let repo: LotePagamentoRepository;
    const chave = { loteId: LOTE, filCod: 1, docCod: '100', titCod: '1' };

    const versao = async (): Promise<number> =>
        (await db.query('SELECT versao FROM lote_pagamento WHERE id = $1', [LOTE])).rows[0].versao;
    const item = async () => (await repo.getLoteComItens(LOTE))?.itens[0];

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
        expect(migrations).toContain('0068_sispag_aprovar_destino.sql');
        for (const arquivo of migrations) {
            await db.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }
        // Idempotente: aplicar de novo não quebra nem duplica.
        await db.query(
            readFileSync(path.join(__dirname, '0068_sispag_aprovar_destino.sql'), 'utf8'),
        );

        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por)
             VALUES ($1, 1, 'RASCUNHO', 'u1')`,
            [LOTE],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por, modalidade)
             VALUES ($1, 1, '100', '1', 'u1', 'TED')`,
            [LOTE],
        );

        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        repo = new LotePagamentoRepository(pool);
    });

    afterAll(async () => {
        await pool?.close();
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

    it('gravar → pendente; aprovar → aprovado sem mudar a gravação vigente; regravar → pendente de novo', async () => {
        const g1 = await repo.setDestinoManualItem({
            ...chave,
            versaoEsperada: await versao(),
            destino: CONTA,
            usuario: 'ana',
        });
        expect(g1.atualizado).toBe(true);
        const gravado = await item();
        expect(gravado?.destinoManualAuditId).toBe(g1.auditId);
        expect(gravado?.destinoManualAprovadoPor).toBeUndefined();

        const ap = await repo.aprovarDestinoManualItem({
            ...chave,
            versaoEsperada: await versao(),
            usuario: 'ana',
        });
        expect(ap.atualizado).toBe(true);
        const aprovado = await item();
        expect(aprovado?.destinoManualAprovadoPor).toBe('ana');
        // A aprovação não vira "a gravação mais recente": o pin do ledger (I10f) não muda.
        expect(aprovado?.destinoManualAuditId).toBe(g1.auditId);
        expect(aprovado?.destinoManualInformadoPor).toBe('ana');

        const g2 = await repo.setDestinoManualItem({
            ...chave,
            versaoEsperada: await versao(),
            destino: { ...CONTA, conta: '11112222' },
            usuario: 'bia',
        });
        const regravado = await item();
        expect(regravado?.destinoManualAuditId).toBe(g2.auditId);
        expect(regravado?.destinoManualAprovadoPor).toBeUndefined();
    });

    it('versão velha: a aprovação não grava nada', async () => {
        const antes = await db.query(
            `SELECT count(*)::int AS n FROM lote_pagamento_item_destino_audit WHERE evento = 'APROVACAO'`,
        );
        const r = await repo.aprovarDestinoManualItem({
            ...chave,
            versaoEsperada: 1,
            usuario: 'ana',
        });
        expect(r.atualizado).toBe(false);
        const depois = await db.query(
            `SELECT count(*)::int AS n FROM lote_pagamento_item_destino_audit WHERE evento = 'APROVACAO'`,
        );
        expect(depois.rows[0].n).toBe(antes.rows[0].n);
    });

    it('a linha de aprovação continua só-inclusão', async () => {
        await expect(
            db.query(
                `UPDATE lote_pagamento_item_destino_audit SET alterado_por = 'x' WHERE evento = 'APROVACAO'`,
            ),
        ).rejects.toThrow(/s[oó] de inclus[aã]o/i);
    });
});
