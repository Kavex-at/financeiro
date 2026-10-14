import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0086 contra um Postgres DE VERDADE (ADR-0071): os CHECKs do vínculo no item (origem, tudo-ou-
 * nada, máscara 5+4), os três tipos novos da trilha e o índice único de idempotência, e a origem
 * nova da marca de retenção. Reaplicar é no-op.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql`:
 *
 *   docker run -d --rm --name sb-pg-test -e POSTGRES_PASSWORD=test -p 55492:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55492/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_vinculo_codbar_it`.
 */

jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const NOME = '0086_sispag_vinculo_codigo_barras.sql';
const BANCO = 'sispag_vinculo_codbar_it';

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

describeComBanco('0086 — vínculo do código de barras ao item', () => {
    let db: Client;
    const LOTE = id(1);

    const setVinculo = (titulo: number, campos: Record<string, unknown>) =>
        db.query(
            `UPDATE lote_pagamento_item SET
                vinculo_origem = $2, vinculo_decisao_id = $3, vinculo_codigo_mascarado = $4,
                vinculo_aplicado_em = $5, vinculo_flp_cod = $6
              WHERE lote_id = $1 AND doc_cod = $7`,
            [
                LOTE,
                campos.origem ?? null,
                campos.decisao ?? null,
                campos.mascarado ?? null,
                campos.aplicadoEm ?? null,
                campos.flp ?? null,
                String(titulo),
            ],
        );

    const evento = (
        n: number,
        o: { tipo: string; motivo?: string | null; decisao?: string | null },
    ) =>
        db.query(
            `INSERT INTO sispag_sugestao_boleto_evento
                (id, tipo, ator, fil_cod, doc_cod, tit_cod, lote_id, decisao_id, motivo)
             VALUES ($1, $2, 'sistema', 1, '500', '1', $3, $4, $5)`,
            [id(n), o.tipo, LOTE, o.decisao ?? null, o.motivo ?? null],
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
        for (const arquivo of todas.filter((f) => f < NOME)) {
            await db.query(sqlDe(arquivo));
        }
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por)
             VALUES ($1, 1, 'RASCUNHO', 'ana')`,
            [LOTE],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por)
             VALUES ($1, 1, '500', '1', 'ana'), ($1, 1, '501', '1', 'ana')`,
            [LOTE],
        );
        await db.query(sqlDe(NOME));
        // Reaplicar é no-op (idempotência).
        await db.query(sqlDe(NOME));
    });

    afterAll(async () => {
        await db?.end();
    });

    it('item existente continua sem vínculo (nada reescrito)', async () => {
        const { rows } = await db.query(
            `SELECT vinculo_origem, vinculo_decisao_id, vinculo_codigo_mascarado,
                    vinculo_aplicado_em, vinculo_flp_cod
               FROM lote_pagamento_item WHERE lote_id = $1`,
            [LOTE],
        );
        expect(rows).toHaveLength(2);
        for (const r of rows) {
            expect(Object.values(r).every((v) => v === null)).toBe(true);
        }
    });

    it('vínculo completo e válido é aceito', async () => {
        await setVinculo(500, {
            origem: 'DECISAO_HUMANA',
            decisao: id(77),
            mascarado: '34191…9000',
            aplicadoEm: new Date().toISOString(),
            flp: 42,
        });
        const { rows } = await db.query(
            `SELECT vinculo_origem FROM lote_pagamento_item WHERE doc_cod = '500'`,
        );
        expect(rows[0].vinculo_origem).toBe('DECISAO_HUMANA');
    });

    it('origem inválida é recusada', async () => {
        const code = await codigoDoErro(
            setVinculo(501, {
                origem: 'MANUAL',
                decisao: id(1),
                mascarado: '34191…9000',
                aplicadoEm: new Date().toISOString(),
                flp: 42,
            }),
        );
        expect(code).toBe('23514');
    });

    it('máscara com 44 dígitos (código longo) é recusada pelo esquema (I17j)', async () => {
        const code = await codigoDoErro(
            setVinculo(501, {
                origem: 'DECISAO_HUMANA',
                decisao: id(1),
                mascarado: '3'.repeat(44),
                aplicadoEm: new Date().toISOString(),
                flp: 42,
            }),
        );
        expect(code).toBe('23514');
    });

    it('tudo-ou-nada: origem sem as demais colunas é recusada; DECISAO_HUMANA exige a decisão', async () => {
        expect(await codigoDoErro(setVinculo(501, { origem: 'ERP_DDA' }))).toBe('23514');
        expect(
            await codigoDoErro(
                setVinculo(501, {
                    origem: 'DECISAO_HUMANA',
                    mascarado: '34191…9000',
                    aplicadoEm: new Date().toISOString(),
                    flp: 42,
                }),
            ),
        ).toBe('23514');
        // ERP_DDA sem decisão é válido (o vínculo é do próprio ERP).
        expect(
            await codigoDoErro(
                setVinculo(501, {
                    origem: 'ERP_DDA',
                    mascarado: '34191…9000',
                    aplicadoEm: new Date().toISOString(),
                    flp: 42,
                }),
            ),
        ).toBeUndefined();
    });

    it('a trilha aceita os 3 tipos novos e recusa tipo desconhecido', async () => {
        expect(await codigoDoErro(evento(10, { tipo: 'VINCULO_APLICADO', decisao: id(5) }))).toBe(
            undefined,
        );
        expect(await codigoDoErro(evento(11, { tipo: 'VINCULO_SIMULADO', decisao: id(5) }))).toBe(
            undefined,
        );
        expect(await codigoDoErro(evento(12, { tipo: 'VINCULO_FALHOU', decisao: id(5) }))).toBe(
            undefined,
        );
        expect(await codigoDoErro(evento(13, { tipo: 'VINCULO_QUALQUER' }))).toBe('23514');
        // Os tipos antigos seguem valendo.
        expect(await codigoDoErro(evento(14, { tipo: 'LINHA_COPIADA' }))).toBeUndefined();
    });

    it('VINCULO_APLICADO é único por (lote, título, decisão) — a segunda é recusada', async () => {
        expect(await codigoDoErro(evento(20, { tipo: 'VINCULO_APLICADO', decisao: id(5) }))).toBe(
            '23505',
        );
        // Outra decisão para o mesmo título é outro fato.
        expect(
            await codigoDoErro(evento(21, { tipo: 'VINCULO_APLICADO', decisao: id(6) })),
        ).toBeUndefined();
    });

    it('VINCULO_SIMULADO é único por resultado; sem decisão não fura a unicidade', async () => {
        expect(
            await codigoDoErro(
                evento(30, { tipo: 'VINCULO_SIMULADO', decisao: null, motivo: 'SEM_DECISAO' }),
            ),
        ).toBeUndefined();
        expect(
            await codigoDoErro(
                evento(31, { tipo: 'VINCULO_SIMULADO', decisao: null, motivo: 'SEM_DECISAO' }),
            ),
        ).toBe('23505');
        expect(
            await codigoDoErro(
                evento(32, { tipo: 'VINCULO_SIMULADO', decisao: null, motivo: 'VALOR_DIFERENTE' }),
            ),
        ).toBeUndefined();
    });

    it('VINCULO_FALHOU repete (cada tentativa que falha é um fato)', async () => {
        expect(await codigoDoErro(evento(40, { tipo: 'VINCULO_FALHOU', decisao: id(5) }))).toBe(
            undefined,
        );
        expect(await codigoDoErro(evento(41, { tipo: 'VINCULO_FALHOU', decisao: id(5) }))).toBe(
            undefined,
        );
    });

    it('a trilha continua só-inclusão', async () => {
        expect(
            await codigoDoErro(
                db.query(`UPDATE sispag_sugestao_boleto_evento SET motivo = 'x' WHERE id = $1`, [
                    id(10),
                ]),
            ),
        ).toBe('P0001');
    });

    it('a marca de retenção aceita a origem nova e continua recusando as desconhecidas', async () => {
        const inserir = (n: number, origem: string, mascarado: string | null) =>
            db.query(
                `INSERT INTO titulo_bloqueio_duplicidade
                    (id, fil_cod, doc_cod, tit_cod, motivo, estado, marcado_por, origem,
                     codigo_mascarado)
                 VALUES ($1, 1, $2, '1', 'teste', 'ATIVO', 'sistema', $3, $4)`,
                [id(n), `9${n}`, origem, mascarado],
            );
        expect(
            await codigoDoErro(inserir(50, 'VINCULO_CODIGO_BARRAS_FALHOU', '34191…9000')),
        ).toBeUndefined();
        expect(await codigoDoErro(inserir(51, 'OUTRA_COISA', null))).toBe('23514');
    });
});
