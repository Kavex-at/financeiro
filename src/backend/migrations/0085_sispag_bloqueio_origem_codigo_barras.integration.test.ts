import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0085 contra um Postgres DE VERDADE (ADR-0069 emenda 1): os CHECKs de origem, de máscara (o
 * esquema recusa código longo) e do título mantido, e a idempotência do índice ATIVO.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql`:
 *
 *   docker run -d --rm --name sb-pg-test -e POSTGRES_PASSWORD=test -p 55492:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55492/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_bloq_origem_it`.
 */

jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const NOME = '0085_sispag_bloqueio_origem_codigo_barras.sql';
const BANCO = 'sispag_bloq_origem_it';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const id = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const sqlDe = (arquivo: string): string => readFileSync(path.join(__dirname, arquivo), 'utf8');

const codigoDoErro = async (promessa: Promise<unknown>): Promise<string | undefined> => {
    try {
        await promessa;
        return undefined;
    } catch (e) {
        return (e as { code?: string }).code;
    }
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0085 — origem do bloqueio por código de barras', () => {
    let db: Client;

    const inserir = (
        n: number,
        o: {
            titulo: number;
            origem?: string;
            mascarado?: string | null;
            mantido?: [number, string, string] | null;
            estado?: string;
        },
    ) =>
        db.query(
            `INSERT INTO titulo_bloqueio_duplicidade
                (id, fil_cod, doc_cod, tit_cod, motivo, estado, marcado_por, encerrado_em,
                 origem, codigo_mascarado, titulo_mantido_fil_cod, titulo_mantido_doc_cod,
                 titulo_mantido_tit_cod)
             VALUES ($1, 1, $2, '1', 'teste', $3, 'sistema',
                     CASE WHEN $3 = 'ENCERRADO' THEN now() END,
                     $4, $5, $6, $7, $8)`,
            [
                id(n),
                String(o.titulo),
                o.estado ?? 'ATIVO',
                o.origem ?? 'DUPLICIDADE_TITULO',
                o.mascarado ?? null,
                o.mantido?.[0] ?? null,
                o.mantido?.[1] ?? null,
                o.mantido?.[2] ?? null,
            ],
        );

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
        const todas = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort();
        expect(todas).toContain(NOME);
        // Linha pré-existente (antes da 0085) tem que sobreviver como DUPLICIDADE_TITULO.
        for (const arquivo of todas.filter((f) => f < NOME)) {
            await db.query(sqlDe(arquivo));
        }
        await db.query(
            `INSERT INTO titulo_bloqueio_duplicidade
                (id, fil_cod, doc_cod, tit_cod, motivo, marcado_por)
             VALUES ($1, 1, '900', '1', 'legado', 'ana')`,
            [id(900)],
        );
        await db.query(sqlDe(NOME));
        // Reaplicar é no-op (idempotência).
        await db.query(sqlDe(NOME));
    });

    afterAll(async () => {
        await db?.end();
    });

    it('linha pré-existente fica DUPLICIDADE_TITULO, sem máscara', async () => {
        const { rows } = await db.query(
            `SELECT origem, codigo_mascarado FROM titulo_bloqueio_duplicidade WHERE id = $1`,
            [id(900)],
        );
        expect(rows[0]).toEqual({ origem: 'DUPLICIDADE_TITULO', codigo_mascarado: null });
    });

    it('origem inválida é recusada (23514)', async () => {
        expect(await codigoDoErro(inserir(1, { titulo: 1, origem: 'OUTRA' }))).toBe('23514');
    });

    it('máscara com 44 dígitos (ou qualquer forma fora de 5+…+4) é recusada (23514)', async () => {
        const longo = '1'.repeat(44);
        expect(
            await codigoDoErro(
                inserir(2, { titulo: 2, origem: 'CODIGO_BARRAS_REPETIDO', mascarado: longo }),
            ),
        ).toBe('23514');
        expect(
            await codigoDoErro(
                inserir(3, {
                    titulo: 3,
                    origem: 'CODIGO_BARRAS_REPETIDO',
                    mascarado: '34191...5555',
                }),
            ),
        ).toBe('23514');
    });

    it('máscara 5+…+4 e título mantido são aceitos nas origens de código de barras', async () => {
        await inserir(4, {
            titulo: 4,
            origem: 'CODIGO_BARRAS_REPETIDO',
            mascarado: '34191…5555',
            mantido: [1, '777', '1'],
        });
        await inserir(5, {
            titulo: 5,
            origem: 'CODIGO_BARRAS_ILEGIVEL',
            mascarado: '34191…5555',
        });
    });

    it('DUPLICIDADE_TITULO com máscara ou título mantido é recusada (23514)', async () => {
        expect(await codigoDoErro(inserir(6, { titulo: 6, mascarado: '34191…5555' }))).toBe(
            '23514',
        );
        expect(await codigoDoErro(inserir(7, { titulo: 7, mantido: [1, '777', '1'] }))).toBe(
            '23514',
        );
    });

    it('título mantido incompleto é recusado (23514)', async () => {
        expect(
            await codigoDoErro(
                db.query(
                    `INSERT INTO titulo_bloqueio_duplicidade
                        (id, fil_cod, doc_cod, tit_cod, motivo, marcado_por, origem,
                         titulo_mantido_fil_cod)
                     VALUES ($1, 1, '8', '1', 't', 'sistema', 'CODIGO_BARRAS_REPETIDO', 1)`,
                    [id(8)],
                ),
            ),
        ).toBe('23514');
    });

    it('continua um ATIVO por título, qualquer origem (23505)', async () => {
        expect(
            await codigoDoErro(
                inserir(9, {
                    titulo: 4,
                    origem: 'CODIGO_BARRAS_ILEGIVEL',
                    mascarado: '34191…5555',
                }),
            ),
        ).toBe('23505');
    });
});
