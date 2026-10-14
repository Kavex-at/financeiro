import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import SugestaoBoletoRepository from './SugestaoBoletoRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * Vínculo do código de barras ao item (ADR-0071) contra um Postgres DE VERDADE: gravação no item
 * de um lote FINALIZADO (a remessa só roda assim), leitura no `getLoteComItens`, idempotência do
 * `VINCULO_APLICADO` por (lote, título, decisão) e retirada com a origem nova.
 *
 * Roda no `npm run test:sql` com DSN LOCAL (apaga e recria o banco `sispag_vinculo_repo_it`).
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_vinculo_repo_it';
const LOTE = '00000000-0000-0000-0000-000000000861';
const DECISAO = '00000000-0000-0000-0000-0000000008d1';
const OUTRA_DECISAO = '00000000-0000-0000-0000-0000000008d2';
const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'migrations');
const MASCARA = '34191…9000';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('vínculo do código de barras (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let lotes: LotePagamentoRepository;
    let sugestoes: SugestaoBoletoRepository;
    let bloqueios: BloqueioDuplicidadeRepository;

    const versao = async (): Promise<number> =>
        (await db.query('SELECT versao FROM lote_pagamento WHERE id = $1', [LOTE])).rows[0].versao;

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
             VALUES ($1, 2, 'FINALIZADO', 'ana', '55795-4')`,
            [LOTE],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item
                (lote_id, fil_cod, doc_cod, tit_cod, incluido_por, modalidade, valor, vencimento,
                 credor)
             VALUES ($1, 2, '636', '1', 'ana', 'BOLETO', 1028.80, '2026-10-20', 'ACME'),
                    ($1, 2, '637', '1', 'ana', 'BOLETO', 10.00, '2026-10-20', 'ACME')`,
            [LOTE],
        );
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        const eventos = new VerificacaoEventoRepository(pool);
        bloqueios = new BloqueioDuplicidadeRepository(pool, eventos);
        lotes = new LotePagamentoRepository(pool, eventos, bloqueios);
        sugestoes = new SugestaoBoletoRepository(pool);
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('grava o vínculo no item de um lote FINALIZADO, bumpa a versão e o lê de volta', async () => {
        const antes = await versao();
        const ok = await lotes.gravarVinculoCodigoBarras({
            loteId: LOTE,
            filCod: 2,
            docCod: '636',
            titCod: '1',
            origem: 'DECISAO_HUMANA',
            decisaoId: DECISAO,
            codigoMascarado: MASCARA,
            flpCod: 36,
        });
        expect(ok).toBe(true);
        expect(await versao()).toBe(antes + 1);

        const lote = await lotes.getLoteComItens(LOTE);
        const vinculado = lote?.itens.find((i) => i.docCod === '636');
        expect(vinculado?.vinculoCodigoBarras).toMatchObject({
            origem: 'DECISAO_HUMANA',
            decisaoId: DECISAO,
            codigoMascarado: MASCARA,
            flpCod: 36,
        });
        expect(lote?.itens.find((i) => i.docCod === '637')).not.toHaveProperty(
            'vinculoCodigoBarras',
        );
    });

    it('o esquema recusa código longo mesmo que o guard da aplicação fosse burlado', async () => {
        await expect(
            db.query(
                `UPDATE lote_pagamento_item SET vinculo_origem = 'DECISAO_HUMANA',
                        vinculo_decisao_id = $2, vinculo_codigo_mascarado = $3,
                        vinculo_aplicado_em = now(), vinculo_flp_cod = 1
                  WHERE lote_id = $1 AND doc_cod = '637'`,
                [LOTE, DECISAO, '3'.repeat(44)],
            ),
        ).rejects.toMatchObject({ code: '23514' });
    });

    it('VINCULO_APLICADO é idempotente por (lote, título, decisão): o segundo não entra', async () => {
        const evento = {
            tipo: 'VINCULO_APLICADO' as const,
            ator: 'sistema',
            loteId: LOTE,
            decisaoId: DECISAO,
            filCod: 2,
            docCod: '636',
            titCod: '1',
            detalhe: { codigoMascarado: MASCARA, flpCod: 36 },
        };
        expect(await sugestoes.registrarEventoVinculo(evento)).toEqual({ inserido: true });
        expect(await sugestoes.registrarEventoVinculo(evento)).toEqual({ inserido: false });
        expect(
            await sugestoes.existeVinculoAplicado({
                loteId: LOTE,
                filCod: 2,
                docCod: '636',
                titCod: '1',
                decisaoId: DECISAO,
            }),
        ).toBe(true);
        expect(
            await sugestoes.existeVinculoAplicado({
                loteId: LOTE,
                filCod: 2,
                docCod: '636',
                titCod: '1',
                decisaoId: OUTRA_DECISAO,
            }),
        ).toBe(false);
        // Outra decisão para o mesmo título é outro fato.
        expect(
            await sugestoes.registrarEventoVinculo({ ...evento, decisaoId: OUTRA_DECISAO }),
        ).toEqual({ inserido: true });
    });

    it('sob concorrência só um VINCULO_APLICADO entra', async () => {
        const evento = {
            tipo: 'VINCULO_APLICADO' as const,
            ator: 'sistema',
            loteId: LOTE,
            decisaoId: DECISAO,
            filCod: 2,
            docCod: '637',
            titCod: '1',
        };
        const resultados = await Promise.all(
            Array.from({ length: 5 }, () => sugestoes.registrarEventoVinculo(evento)),
        );
        expect(resultados.filter((r) => r.inserido)).toHaveLength(1);
    });

    it('retirada por vínculo falho: remove o item, mantém o status e cria a marca com a origem nova', async () => {
        const r = await pool.withTransaction((tx) =>
            lotes.retirarItemPorCodigoDeBarras(
                {
                    loteId: LOTE,
                    filCod: 2,
                    docCod: '637',
                    titCod: '1',
                    motivo: 'VINCULO_CODIGO_BARRAS_FALHOU',
                    codigoMascarado: MASCARA,
                },
                tx,
            ),
        );
        expect(r.removido).toBe(true);
        const marca = await bloqueios.findAtivo({ filCod: 2, docCod: '637', titCod: '1' });
        expect(marca).toMatchObject({
            origem: 'VINCULO_CODIGO_BARRAS_FALHOU',
            codigoMascarado: MASCARA,
            loteIdOrigem: LOTE,
        });
        const lote = await lotes.getLoteComItens(LOTE);
        expect(lote?.status).toBe('FINALIZADO');
        expect(lote?.itens.map((i) => i.docCod)).toEqual(['636']);
    });
});
