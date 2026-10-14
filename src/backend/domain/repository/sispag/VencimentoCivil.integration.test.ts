import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import TituloAPagarRepository from './TituloAPagarRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * Integração — "vence hoje não é vencido" contra um Postgres real (incidente 14/10).
 *
 * O ERP grava o vencimento como 00:00Z (às vezes 15:00Z) do dia civil. Com `now()` o título que
 * vence hoje sumia da formação e o lote automático dele era DESFEITO a partir das 09:00 BRT.
 * Aqui a janela é pelo dia civil recebido (`hoje`), e o teste prova as bordas no SQL de verdade.
 *
 * Mesmo banco descartável dos demais testes de integração (`METRICAS_CICLO_TEST_DSN`, local).
 */
jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_vencimento_civil_it';
const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'migrations');
const HOJE = new Date('2026-10-14T00:00:00Z');
const LOTE_HOJE = '00000000-0000-0000-0000-000000001014';
const LOTE_ONTEM = '00000000-0000-0000-0000-000000001013';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('vencimento por dia civil (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;

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
        for (const arquivo of readdirSync(MIGRATIONS)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort()) {
            await db.query(readFileSync(path.join(MIGRATIONS, arquivo), 'utf8'));
        }
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('formação: hoje (00:00Z e 15:00Z) e hoje+7 entram; ontem e hoje+8 não', async () => {
        await db.query(
            `INSERT INTO titulo_a_pagar (fil_cod, doc_cod, tit_cod, valor, vencimento, aprovado, pago, ativo)
             VALUES (2, 'ontem', '1', 10, '2026-10-13T00:00:00Z', TRUE, FALSE, TRUE),
                    (2, 'hoje00', '1', 10, '2026-10-14T00:00:00Z', TRUE, FALSE, TRUE),
                    (2, 'hoje15', '1', 10, '2026-10-14T15:00:00Z', TRUE, FALSE, TRUE),
                    (2, 'mais7', '1', 10, '2026-10-21T15:00:00Z', TRUE, FALSE, TRUE),
                    (2, 'mais8', '1', 10, '2026-10-22T00:00:00Z', TRUE, FALSE, TRUE)`,
        );
        const elegiveis = await new TituloAPagarRepository(pool).listElegiveisParaFormacao(7, HOJE);
        expect(elegiveis.map((t) => t.docCod).sort()).toEqual(['hoje00', 'hoje15', 'mais7']);
    });

    it('desfazer: lote com título de hoje fica; lote com título de ontem é desfeito', async () => {
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por, automatico)
             VALUES ($1, 2, 'RASCUNHO', 'cron', TRUE), ($2, 2, 'RASCUNHO', 'cron', TRUE)`,
            [LOTE_HOJE, LOTE_ONTEM],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, vencimento, incluido_por)
             VALUES ($1, 2, 'hoje00', '1', '2026-10-14T00:00:00Z', 'cron'),
                    ($2, 2, 'ontem', '1', '2026-10-13T00:00:00Z', 'cron')`,
            [LOTE_HOJE, LOTE_ONTEM],
        );
        const eventos = new VerificacaoEventoRepository(pool);
        const repo = new LotePagamentoRepository(
            pool,
            eventos,
            new BloqueioDuplicidadeRepository(pool, eventos),
        );
        expect(await repo.desfazerAutomaticosVencidos(HOJE)).toBe(1);
        const { rows } = await db.query('SELECT id FROM lote_pagamento ORDER BY id');
        expect(rows.map((r) => r.id)).toEqual([LOTE_HOJE]);
    });
});
