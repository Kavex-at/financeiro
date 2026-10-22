import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import SqlBuilder from '../../libs/sql/SqlBuilder.js';
import TituloAPagarRepository from './TituloAPagarRepository.js';

/**
 * `TituloAPagarRepository.buscarPorChave` contra um Postgres DE VERDADE com todas as migrations
 * aplicadas (ADR-0068, anti-TOCTOU). Os testes com `selectFirst` mockado não pegam um SELECT que
 * esquece uma coluna que o mapper lê (`doc_esp_numero`, `forma_pagamento_conexos`, `tem_boleto`):
 * o mock devolve a linha que o teste escreveu, e o campo some em silêncio em produção.
 *
 * Roda no `npm run test:sql`. O DSN precisa ser LOCAL: o teste apaga e recria o banco
 * `titulo_a_pagar_repo_it`.
 */
jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
const BANCO = 'titulo_a_pagar_repo_it';
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

describeComBanco('TituloAPagarRepository.buscarPorChave — integração (ADR-0068)', () => {
    let db: Client;
    let repo: TituloAPagarRepository;

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
        repo = new TituloAPagarRepository(adaptar(db));
    });

    afterAll(async () => {
        await db?.end();
    });

    const inserir = (
        chave: { fil: number; doc: string; tit: string },
        over: Record<string, unknown> = {},
    ) => {
        const c = {
            credor: 'ADP BRASIL LTDA',
            pes_cod: '7001',
            valor: '1234.56',
            moeda: 'BRL',
            vencimento: '2026-10-20T00:00:00Z',
            aprovado: true,
            pago: false,
            banco: '237',
            num_remessa: 'REM-9',
            tpd_cod: '157',
            pronto_para_remessa: true,
            tem_boleto: true,
            forma_pagamento_conexos: 6,
            doc_esp_numero: 'NF-5046',
            ativo: true,
            ...over,
        };
        return db.query(
            `INSERT INTO titulo_a_pagar
                (fil_cod, doc_cod, tit_cod, credor, pes_cod, valor, moeda, vencimento, aprovado,
                 pago, banco, num_remessa, tpd_cod, pronto_para_remessa, tem_boleto,
                 forma_pagamento_conexos, doc_esp_numero, ativo)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [
                chave.fil,
                chave.doc,
                chave.tit,
                c.credor,
                c.pes_cod,
                c.valor,
                c.moeda,
                c.vencimento,
                c.aprovado,
                c.pago,
                c.banco,
                c.num_remessa,
                c.tpd_cod,
                c.pronto_para_remessa,
                c.tem_boleto,
                c.forma_pagamento_conexos,
                c.doc_esp_numero,
                c.ativo,
            ],
        );
    };

    it('mapeia TODA coluna que o mapper lê: nenhuma se perde entre o SELECT e o objeto', async () => {
        await inserir({ fil: 2, doc: '5046', tit: '1' });
        const t = await repo.buscarPorChave({ filCod: 2, docCod: '5046', titCod: '1' });
        expect(t).toEqual({
            filCod: 2,
            docCod: '5046',
            titCod: '1',
            credor: 'ADP BRASIL LTDA',
            pesCod: '7001',
            valor: 1234.56,
            moeda: 'BRL',
            vencimento: Date.parse('2026-10-20T00:00:00Z'),
            liberado: true,
            pago: false,
            banco: '237',
            numRemessa: 'REM-9',
            tpdCod: '157',
            prontoParaRemessa: true,
            temBoleto: true,
            formaPagamentoConexos: 6,
            numeroDocumento: 'NF-5046',
            ativo: true,
        });
    });

    it('doc_esp_numero, forma_pagamento_conexos e tem_boleto chegam com valores distintos dos padrões', async () => {
        await inserir(
            { fil: 2, doc: '5047', tit: '1' },
            { doc_esp_numero: '001532761', forma_pagamento_conexos: 10, tem_boleto: false },
        );
        const t = await repo.buscarPorChave({ filCod: 2, docCod: '5047', titCod: '1' });
        expect(t?.numeroDocumento).toBe('001532761');
        expect(t?.formaPagamentoConexos).toBe(10);
        expect(t?.temBoleto).toBe(false);
    });

    it('título inativo volta com ativo = false (a releitura do serviço o recusa)', async () => {
        await inserir({ fil: 2, doc: '5048', tit: '1' }, { ativo: false });
        const t = await repo.buscarPorChave({ filCod: 2, docCod: '5048', titCod: '1' });
        expect(t?.ativo).toBe(false);
    });

    it('colunas nulas viram ausência e o tri-estado de pronto_para_remessa é preservado', async () => {
        await inserir(
            { fil: 2, doc: '5049', tit: '1' },
            {
                credor: null,
                pes_cod: null,
                moeda: null,
                banco: null,
                num_remessa: null,
                tpd_cod: null,
                pronto_para_remessa: null,
                forma_pagamento_conexos: null,
                doc_esp_numero: null,
                vencimento: null,
                valor: null,
            },
        );
        const t = await repo.buscarPorChave({ filCod: 2, docCod: '5049', titCod: '1' });
        expect(t).toMatchObject({ filCod: 2, docCod: '5049', titCod: '1', valor: 0, ativo: true });
        for (const campo of [
            'credor',
            'pesCod',
            'moeda',
            'vencimento',
            'banco',
            'numRemessa',
            'tpdCod',
            'prontoParaRemessa',
            'formaPagamentoConexos',
            'numeroDocumento',
        ] as const) {
            expect(t?.[campo]).toBeUndefined();
        }
    });

    it('buscarPorChaves (ADR-0076): vários numa consulta, só as chaves EXATAS, inativo com ativo = false', async () => {
        await inserir({ fil: 2, doc: '6001', tit: '1' });
        await inserir({ fil: 2, doc: '6001', tit: '2' }, { ativo: false });
        await inserir({ fil: 7, doc: '6001', tit: '1' }, { credor: 'OUTRA FILIAL' });
        const lidos = await repo.buscarPorChaves([
            { filCod: 2, docCod: '6001', titCod: '1' },
            { filCod: 2, docCod: '6001', titCod: '2' },
            { filCod: 2, docCod: 'nada', titCod: '1' },
        ]);
        const porChave = new Map(lidos.map((t) => [`${t.filCod}:${t.docCod}:${t.titCod}`, t]));
        expect([...porChave.keys()].sort()).toEqual(['2:6001:1', '2:6001:2']);
        expect(porChave.get('2:6001:1')).toMatchObject({ ativo: true, credor: 'ADP BRASIL LTDA' });
        expect(porChave.get('2:6001:2')).toMatchObject({ ativo: false });
        // mesma doc/tit na filial 7 não vaza para a chave da filial 2
        expect(lidos.some((t) => t.credor === 'OUTRA FILIAL')).toBe(false);
        expect(await repo.buscarPorChaves([])).toEqual([]);
    });

    it('chave inexistente → null; a chave é (filial, documento, título)', async () => {
        expect(await repo.buscarPorChave({ filCod: 2, docCod: 'nada', titCod: '1' })).toBeNull();
        // mesma doc/tit em outra filial não vaza
        expect(await repo.buscarPorChave({ filCod: 9, docCod: '5046', titCod: '1' })).toBeNull();
    });
});
