import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import LotePagamentoRepository from '../domain/repository/sispag/LotePagamentoRepository.js';
import VerificacaoEventoRepository from '../domain/repository/sispag/VerificacaoEventoRepository.js';

/**
 * 0069 contra um Postgres DE VERDADE (ADR-0055): as colunas novas do item, os CHECK, o tipo novo de
 * alerta e a gravação da sincronização pelo `LotePagamentoRepository` real — trava de versão,
 * transição e o "só carimbo" sem `versao` (I11h).
 *
 * Não roda no `npm test`. Roda no `npm run test:sql` com o mesmo DSN dos testes da 0067/0068:
 *
 *   docker run -d --rm --name destino-pg-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_sincronizacao_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_sincronizacao_it';
const LOTE = '00000000-0000-0000-0000-000000000069';
const NOME = '0069_sispag_item_situacao_sincronizacao.sql';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0069 — situação do item e sincronização (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let repo: LotePagamentoRepository;

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
        const migrations = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort();
        expect(migrations).toContain(NOME);
        for (const arquivo of migrations) {
            await db.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }
        // Idempotente: aplicar de novo não quebra.
        await db.query(readFileSync(path.join(__dirname, NOME), 'utf8'));

        await db.query(
            `INSERT INTO lote_pagamento
                (id, fil_cod, status, criado_por, native_fil_cod, native_bnc_cod, native_flp_cod,
                 remessa_gerada_em)
             VALUES ($1, 2, 'REMESSA_GERADA', 'u1', 2, 4, 24, now() - interval '6 days')`,
            [LOTE],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por)
             VALUES ($1, 2, '38682', '1', 'u1')`,
            [LOTE],
        );

        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        repo = new LotePagamentoRepository(pool, new VerificacaoEventoRepository(pool));
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('item existente nasce sem situação e com divergencia=false', async () => {
        const item = (await repo.getLoteComItens(LOTE))?.itens[0];
        expect(item?.situacao).toBeUndefined();
        expect(item?.divergencia).toBe(false);
    });

    it('os CHECK recusam situação, origem e fonte fora do catálogo', async () => {
        for (const [coluna, valor] of [
            ['situacao', 'PARCIAL'],
            ['origem_baixa', 'MANUAL'],
            ['baixa_fonte', 'OUTRA'],
        ]) {
            await expect(
                db.query(`UPDATE lote_pagamento_item SET ${coluna} = $1 WHERE lote_id = $2`, [
                    valor,
                    LOTE,
                ]),
            ).rejects.toThrow(/check/i);
        }
    });

    it('alerta aceita os dois tipos novos e continua recusando tipo inventado', async () => {
        for (const tipo of ['sispag-lote-retornado', 'sispag-baixa-divergente']) {
            await db.query(
                `INSERT INTO alerta (tipo, alvo, dedup_key, janela_inicio)
                 VALUES ($1, $2, $3, now())`,
                [tipo, LOTE, `${tipo}:${LOTE}`],
            );
        }
        await expect(
            db.query(
                `INSERT INTO alerta (tipo, alvo, dedup_key, janela_inicio)
                 VALUES ('sispag-inventado', 'x', 'x', now())`,
            ),
        ).rejects.toThrow(/check/i);
    });

    it('listLotesSincronizaveis acha o lote REMESSA_GERADA com chave nativa', async () => {
        expect(await repo.listLotesSincronizaveis(30)).toContain(LOTE);
    });

    it('tocarSincronizacao carimba sincronizado_em SEM mexer em versao (I11h)', async () => {
        const antes = await versao();
        await repo.tocarSincronizacao({
            loteId: LOTE,
            itens: [{ filCod: 2, docCod: '38682', titCod: '1' }],
            em: '2026-09-29T14:35:00.000Z',
        });
        expect(await versao()).toBe(antes);
        const item = (await repo.getLoteComItens(LOTE))?.itens[0];
        expect(item?.sincronizadoEm).toBe('2026-09-29T14:35:00.000Z');
    });

    it('aplicarSincronizacao: conflito de versão não grava nada', async () => {
        const antes = await versao();
        const r = await repo.aplicarSincronizacao({
            loteId: LOTE,
            versaoEsperada: antes + 7,
            statusAtual: 'REMESSA_GERADA',
            para: 'BAIXADO',
            itens: [
                {
                    filCod: 2,
                    docCod: '38682',
                    titCod: '1',
                    situacao: 'PAGO',
                    rejeitado: false,
                    divergencia: false,
                },
            ],
        });
        expect(r).toBe('CONFLITO');
        const item = (await repo.getLoteComItens(LOTE))?.itens[0];
        expect(item?.situacao).toBeUndefined();
        expect(await versao()).toBe(antes);
    });

    it('aplicarSincronizacao: itens + transição + versao numa transação (T1: 38682/1)', async () => {
        const antes = await versao();
        const r = await repo.aplicarSincronizacao({
            loteId: LOTE,
            versaoEsperada: antes,
            statusAtual: 'REMESSA_GERADA',
            para: 'BAIXADO',
            itens: [
                {
                    filCod: 2,
                    docCod: '38682',
                    titCod: '1',
                    situacao: 'PAGO',
                    retornoEvento: 'BD',
                    retornoDescricao: 'PAGAMENTO AGENDADO',
                    rejeitado: false,
                    borCod: 22320,
                    bxaCodSeq: 1,
                    baixaFonte: 'TITULO',
                    origemBaixa: 'FORA_DO_RETORNO',
                    pagoEm: '2026-09-24T15:00:00.000Z',
                    valorPago: 275,
                    pagoObservadoEm: '2026-09-29T14:35:00.000Z',
                    divergencia: false,
                    sincronizadoEm: '2026-09-29T14:35:00.000Z',
                },
            ],
        });
        expect(r).toBe('APLICADO');
        const lote = await repo.getLoteComItens(LOTE);
        expect(lote?.status).toBe('BAIXADO');
        expect(lote?.versao).toBe(antes + 1);
        expect(lote?.itens[0]).toEqual(
            expect.objectContaining({
                situacao: 'PAGO',
                retornoEvento: 'BD',
                borCod: 22320,
                bxaCodSeq: 1,
                baixaFonte: 'TITULO',
                origemBaixa: 'FORA_DO_RETORNO',
                pagoEm: '2026-09-24T15:00:00.000Z',
                valorPago: 275,
                divergencia: false,
            }),
        );
    });

    it('o reverse volta o esquema e o CHECK antigo de alerta', async () => {
        await db.query(
            readFileSync(
                path.join(
                    __dirname,
                    'rollbacks',
                    '0069_sispag_item_situacao_sincronizacao.rollback.sql',
                ),
                'utf8',
            ),
        );
        const colunas = await db.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = 'lote_pagamento_item' AND column_name = 'situacao'`,
        );
        expect(colunas.rowCount).toBe(0);
        await expect(
            db.query(
                `INSERT INTO alerta (tipo, alvo, dedup_key, janela_inicio)
                 VALUES ('sispag-lote-retornado', 'x', 'y', now())`,
            ),
        ).rejects.toThrow(/check/i);
        // e a 0069 reaplica limpa depois do reverse
        await db.query(readFileSync(path.join(__dirname, NOME), 'utf8'));
    });
});
