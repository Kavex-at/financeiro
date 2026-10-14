import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * Retirada automática por código de barras (ADR-0069 emenda 1, I16d.3/I16d.8) contra um Postgres
 * DE VERDADE: `DELETE ... USING ... RETURNING` com gate de status, marca ATIVA por origem,
 * evento na trilha e atomicidade (rollback desfaz a remoção).
 *
 * Não roda no `npm test`. Roda no `npm run test:sql` com DSN LOCAL:
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 * Apaga e recria o banco `sispag_retirada_codbar_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_retirada_codbar_it';
const FINALIZADO = '00000000-0000-0000-0000-000000000691';
const GERADA = '00000000-0000-0000-0000-000000000692';
const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'migrations');
const MASCARA = '34191…5555';
const MANTIDO = { filCod: 2, docCod: '6170', titCod: '1' };

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('retirada por código de barras (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let repo: LotePagamentoRepository;
    let bloqueios: BloqueioDuplicidadeRepository;

    const params = (docCod: string, over: Record<string, unknown> = {}) => ({
        loteId: FINALIZADO,
        filCod: 2,
        docCod,
        titCod: '1',
        motivo: 'CODIGO_BARRAS_REPETIDO' as const,
        codigoMascarado: MASCARA,
        tituloMantido: MANTIDO,
        ...over,
    });

    const dadosDoLote = async (id: string) =>
        (await db.query('SELECT status, versao FROM lote_pagamento WHERE id = $1', [id])).rows[0];
    const itens = async (id: string): Promise<string[]> =>
        (
            await db.query(
                'SELECT doc_cod FROM lote_pagamento_item WHERE lote_id = $1 ORDER BY doc_cod',
                [id],
            )
        ).rows.map((r) => r.doc_cod);
    const contarEventos = async (evento: string, loteId = FINALIZADO): Promise<number> =>
        (
            await db.query(
                'SELECT count(*)::int AS n FROM sispag_verificacao_evento WHERE evento = $1 AND lote_id = $2',
                [evento, loteId],
            )
        ).rows[0].n;

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
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por, conta)
             VALUES ($1, 2, 'FINALIZADO', 'ana', '55795-4'),
                    ($2, 2, 'REMESSA_GERADA', 'ana', '55795-4')`,
            [FINALIZADO, GERADA],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item
                (lote_id, fil_cod, doc_cod, tit_cod, incluido_por, modalidade, valor, vencimento,
                 credor)
             VALUES ($1, 2, '6170', '1', 'ana', 'BOLETO', 1412.00, '2026-10-20', 'PEDRONI'),
                    ($1, 2, '6171', '1', 'ana', 'BOLETO', 1412.00, '2026-10-20', 'PEDRONI'),
                    ($1, 2, '6172', '1', 'ana', 'BOLETO', 1412.00, '2026-10-21', 'PEDRONI'),
                    ($2, 2, '6180', '1', 'ana', 'BOLETO', 10.00, '2026-10-20', 'ACME')`,
            [FINALIZADO, GERADA],
        );
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        const eventos = new VerificacaoEventoRepository(pool);
        bloqueios = new BloqueioDuplicidadeRepository(pool, eventos);
        repo = new LotePagamentoRepository(pool, eventos, bloqueios);
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('lote FINALIZADO: remove o item, mantém o status, versao+1, marca ATIVA e dois eventos', async () => {
        const antes = await dadosDoLote(FINALIZADO);
        const r = await pool.withTransaction((tx) =>
            repo.retirarItemPorCodigoDeBarras(params('6171'), tx),
        );
        expect(r).toMatchObject({ removido: true, valor: 1412, vencimento: '2026-10-20' });

        expect(await itens(FINALIZADO)).toEqual(['6170', '6172']);
        const depois = await dadosDoLote(FINALIZADO);
        expect(depois.status).toBe('FINALIZADO');
        expect(depois.versao).toBe(antes.versao + 1);

        const marca = await bloqueios.findAtivo({ filCod: 2, docCod: '6171', titCod: '1' });
        expect(marca).toMatchObject({
            origem: 'CODIGO_BARRAS_REPETIDO',
            codigoMascarado: MASCARA,
            tituloMantido: MANTIDO,
            loteIdOrigem: FINALIZADO,
            marcadoPor: 'sistema',
        });
        expect(await contarEventos('ITEM_REMOVIDO_SISTEMA')).toBe(1);
        expect(await contarEventos('BLOQUEIO_CRIADO')).toBe(1);
        const ev = await db.query(
            `SELECT dados FROM sispag_verificacao_evento WHERE evento = 'ITEM_REMOVIDO_SISTEMA'`,
        );
        expect(ev.rows[0].dados).toEqual({
            motivo: 'CODIGO_BARRAS_REPETIDO',
            codigoMascarado: MASCARA,
            tituloMantido: MANTIDO,
            valor: 1412,
            vencimento: '2026-10-20',
        });
    });

    it('idempotente: repetir sobre o item já retirado não grava evento nem marca', async () => {
        const r = await pool.withTransaction((tx) =>
            repo.retirarItemPorCodigoDeBarras(params('6171'), tx),
        );
        expect(r.removido).toBe(false);
        expect(await contarEventos('ITEM_REMOVIDO_SISTEMA')).toBe(1);
        expect(await contarEventos('BLOQUEIO_CRIADO')).toBe(1);
    });

    it('lote que não está FINALIZADO recusa: item fica, nada é gravado', async () => {
        const r = await pool.withTransaction((tx) =>
            repo.retirarItemPorCodigoDeBarras(params('6180', { loteId: GERADA }), tx),
        );
        expect(r.removido).toBe(false);
        expect(await itens(GERADA)).toEqual(['6180']);
        expect(await contarEventos('ITEM_REMOVIDO_SISTEMA', GERADA)).toBe(0);
        expect(await bloqueios.findAtivo({ filCod: 2, docCod: '6180', titCod: '1' })).toBeNull();
    });

    it('atomicidade: marca que falha desfaz a remoção do item (rollback)', async () => {
        // Marca ATIVA pré-existente de OUTRA origem não falha (ON CONFLICT); para forçar a falha
        // usamos uma máscara que o esquema recusa, contornando o guard da aplicação com SQL cru.
        await expect(
            pool.withTransaction(async (tx) => {
                await repo.retirarItemPorCodigoDeBarras(params('6172'), tx);
                await tx.update(
                    `UPDATE titulo_bloqueio_duplicidade SET codigo_mascarado = $codigo
                     WHERE doc_cod = '6172'`,
                    { codigo: '1'.repeat(44) },
                );
            }),
        ).rejects.toThrow();
        expect(await itens(FINALIZADO)).toEqual(['6170', '6172']);
        expect(await bloqueios.findAtivo({ filCod: 2, docCod: '6172', titCod: '1' })).toBeNull();
        expect(await contarEventos('ITEM_REMOVIDO_SISTEMA')).toBe(1);
    });

    it('marca ATIVA de outra origem não é sobrescrita; o evento do item ainda é gravado', async () => {
        await pool.withTransaction((tx) =>
            bloqueios.criar(
                {
                    chave: { filCod: 2, docCod: '6172', titCod: '1' },
                    alertaId: FINALIZADO,
                    loteIdOrigem: FINALIZADO,
                    motivo: 'duplicata do 6173',
                    ator: 'ana',
                },
                tx,
            ),
        );
        const r = await pool.withTransaction((tx) =>
            repo.retirarItemPorCodigoDeBarras(params('6172'), tx),
        );
        expect(r.removido).toBe(true);
        const marca = await bloqueios.findAtivo({ filCod: 2, docCod: '6172', titCod: '1' });
        expect(marca?.origem).toBe('DUPLICIDADE_TITULO');
        expect(await contarEventos('ITEM_REMOVIDO_SISTEMA')).toBe(2);
    });

    it('listAtivosPorOrigem devolve só as marcas por código de barras', async () => {
        const r = await bloqueios.listAtivosPorOrigem([
            'CODIGO_BARRAS_REPETIDO',
            'CODIGO_BARRAS_ILEGIVEL',
        ]);
        expect(r.map((b) => b.docCod)).toEqual(['6171']);
    });
});
