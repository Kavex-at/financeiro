import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0084 contra um Postgres DE VERDADE (ADR-0068): índice único parcial do par, CHECKs de
 * revogação/rejeição/confirmação, índices únicos da decisão e a trilha só-inclusão.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql`:
 *
 *   docker run -d --rm --name sb-pg-test -e POSTGRES_PASSWORD=test -p 55492:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55492/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_sug_boleto_it`.
 */

jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const NOME = '0084_sispag_sugestao_boleto.sql';
const BANCO = 'sispag_sug_boleto_it';

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

describeComBanco('0084 — sugestão de boleto DDA', () => {
    let db: Client;

    const inserirPar = (n: number, pes: string, chave: string, estado = 'VIGENTE') =>
        db.query(
            `INSERT INTO sispag_confirmacao_emissor_boleto
                (id, pes_cod, emissor_chave, layout_emissor, banco_emissor, emissor_mascarado,
                 estado, confirmado_por, motivo_revogacao, revogado_por, revogado_em)
             VALUES ($1, $2, $3, 'BRADESCO_237', '237', '237 / 2656 / ***2740', $4, 'ana',
                     CASE WHEN $4 = 'REVOGADA' THEN 'conta errada' END,
                     CASE WHEN $4 = 'REVOGADA' THEN 'bia' END,
                     CASE WHEN $4 = 'REVOGADA' THEN now() END)`,
            [id(n), pes, chave, estado],
        );

    const inserirDecisao = (
        n: number,
        o: { dec: string; titulo: number; ddc: number; dit: number; par?: number; motivo?: string },
    ) =>
        db.query(
            `INSERT INTO sispag_decisao_sugestao_boleto
                (id, fil_cod, doc_cod, tit_cod, pes_cod, ddc_cod, dit_cod, codbar_mascarado,
                 valor_titulo, vencimento_titulo, valor_boleto, vencimento_boleto,
                 delta_valor, delta_percentual, delta_dias, tier, emissor_chave,
                 decisao, decidido_por, motivo, confirmacao_emissor_id)
             VALUES ($1, 1, $2, '1', '7001', $3, $4, '237***', 100, '2026-10-20', 100, '2026-10-20',
                     0, 0, 0, 'FORTE', '237:2656:0092740', $5, 'ana', $6, $7)`,
            [
                id(n),
                String(o.titulo),
                o.ddc,
                o.dit,
                o.dec,
                o.motivo ?? null,
                o.par ? id(o.par) : null,
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
        for (const arquivo of todas.filter((f) => f <= NOME)) {
            await db.query(sqlDe(arquivo));
        }
        // Reaplicar é no-op (idempotência).
        await db.query(sqlDe(NOME));
    });

    afterAll(async () => {
        await db?.end();
    });

    it('segunda VIGENTE do mesmo par falha com 23505; após REVOGADA, nova VIGENTE é aceita', async () => {
        await inserirPar(1, '7001', '237:2656:0092740');
        expect(await codigoDoErro(inserirPar(2, '7001', '237:2656:0092740'))).toBe('23505');
        // outro emissor do mesmo credor e o mesmo emissor de outro credor passam
        await inserirPar(3, '7001', '237:2656:0006500');
        await inserirPar(4, '7002', '237:2656:0092740');

        await db.query(
            `UPDATE sispag_confirmacao_emissor_boleto
                SET estado = 'REVOGADA', revogado_por = 'bia', revogado_em = now(),
                    motivo_revogacao = 'conta errada'
              WHERE id = $1`,
            [id(1)],
        );
        await inserirPar(5, '7001', '237:2656:0092740');
    });

    it('REVOGADA sem motivo, e confirmado_por = sistema, são recusados (23514)', async () => {
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_confirmacao_emissor_boleto
                        SET estado = 'REVOGADA', revogado_por = 'bia', revogado_em = now()
                      WHERE id = $1`,
                    [id(3)],
                ),
            ),
        ).toBe('23514');
        expect(
            await codigoDoErro(
                db.query(
                    `INSERT INTO sispag_confirmacao_emissor_boleto
                        (id, pes_cod, emissor_chave, layout_emissor, banco_emissor,
                         emissor_mascarado, confirmado_por)
                     VALUES ($1, '7009', '237:1:1', 'GENERICO', '237', 'x', 'sistema')`,
                    [id(6)],
                ),
            ),
        ).toBe('23514');
    });

    it('pes_cod em branco é recusado (23514)', async () => {
        expect(
            await codigoDoErro(
                db.query(
                    `INSERT INTO sispag_confirmacao_emissor_boleto
                        (id, pes_cod, emissor_chave, layout_emissor, banco_emissor,
                         emissor_mascarado, confirmado_por)
                     VALUES ($1, '  ', '237:1:2', 'GENERICO', '237', 'x', 'ana')`,
                    [id(7)],
                ),
            ),
        ).toBe('23514');
    });

    it('CONFIRMADA exige par e tier; REJEITADA exige motivo', async () => {
        expect(
            await codigoDoErro(
                inserirDecisao(10, { dec: 'CONFIRMADA', titulo: 1, ddc: 1, dit: 1 }),
            ),
        ).toBe('23514');
        expect(
            await codigoDoErro(inserirDecisao(11, { dec: 'REJEITADA', titulo: 1, ddc: 1, dit: 1 })),
        ).toBe('23514');
    });

    it('1 CONFIRMADA por título, 1 por boleto e 1 REJEITADA por (título, boleto)', async () => {
        await inserirDecisao(20, { dec: 'CONFIRMADA', titulo: 100, ddc: 5, dit: 1, par: 5 });
        // mesmo título, outro boleto
        expect(
            await codigoDoErro(
                inserirDecisao(21, { dec: 'CONFIRMADA', titulo: 100, ddc: 5, dit: 2, par: 5 }),
            ),
        ).toBe('23505');
        // outro título, mesmo boleto
        expect(
            await codigoDoErro(
                inserirDecisao(22, { dec: 'CONFIRMADA', titulo: 101, ddc: 5, dit: 1, par: 5 }),
            ),
        ).toBe('23505');

        await inserirDecisao(23, {
            dec: 'REJEITADA',
            titulo: 102,
            ddc: 6,
            dit: 1,
            motivo: 'outro',
        });
        expect(
            await codigoDoErro(
                inserirDecisao(24, { dec: 'REJEITADA', titulo: 102, ddc: 6, dit: 1, motivo: 'x' }),
            ),
        ).toBe('23505');
        // outro candidato para o mesmo título é aceito
        await inserirDecisao(25, {
            dec: 'REJEITADA',
            titulo: 102,
            ddc: 6,
            dit: 2,
            motivo: 'outro',
        });
    });

    it('ANULADA libera o título e o boleto e é terminal; exige quem, quando e motivo (I15l)', async () => {
        await inserirDecisao(40, { dec: 'CONFIRMADA', titulo: 200, ddc: 8, dit: 1, par: 5 });
        // sem os campos da anulação: 23514
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_decisao_sugestao_boleto SET decisao = 'ANULADA' WHERE id = $1`,
                    [id(40)],
                ),
            ),
        ).toBe('23514');
        // `sistema` não anula: 23514
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_decisao_sugestao_boleto
                        SET decisao = 'ANULADA', anulada_por = 'sistema', anulada_em = now(),
                            motivo_anulacao = 'confirmação errada', versao = versao + 1
                      WHERE id = $1`,
                    [id(40)],
                ),
            ),
        ).toBe('23514');
        // campos de anulação em linha não anulada: 23514
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_decisao_sugestao_boleto SET motivo_anulacao = 'x' WHERE id = $1`,
                    [id(40)],
                ),
            ),
        ).toBe('23514');

        await db.query(
            `UPDATE sispag_decisao_sugestao_boleto
                SET decisao = 'ANULADA', anulada_por = 'bia', anulada_em = now(),
                    motivo_anulacao = 'confirmação errada', versao = versao + 1
              WHERE id = $1`,
            [id(40)],
        );
        // o mesmo título e o mesmo boleto voltam a poder ser confirmados (índices só da CONFIRMADA)
        await inserirDecisao(41, { dec: 'CONFIRMADA', titulo: 200, ddc: 8, dit: 1, par: 5 });
        // anular outra vez a mesma (título, boleto) é possível: várias ANULADA convivem
        await db.query(
            `UPDATE sispag_decisao_sugestao_boleto
                SET decisao = 'ANULADA', anulada_por = 'bia', anulada_em = now(),
                    motivo_anulacao = 'outra vez', versao = versao + 1
              WHERE id = $1`,
            [id(41)],
        );
        const { rows } = await db.query(
            `SELECT count(*)::int AS n FROM sispag_decisao_sugestao_boleto
              WHERE decisao = 'ANULADA' AND doc_cod = '200'`,
        );
        expect(rows[0].n).toBe(2);
    });

    it('a trilha aceita DECISAO_ANULADA e segue recusando UPDATE, DELETE e TRUNCATE', async () => {
        await db.query(
            `INSERT INTO sispag_sugestao_boleto_evento (id, tipo, ator, motivo)
             VALUES ($1, 'DECISAO_ANULADA', 'bia', 'confirmação errada')`,
            [id(32)],
        );
    });

    it('a trilha recusa UPDATE, DELETE e TRUNCATE', async () => {
        await db.query(
            `INSERT INTO sispag_sugestao_boleto_evento (id, tipo, ator, pes_cod)
             VALUES ($1, 'LINHA_COPIADA', 'ana', '7001')`,
            [id(30)],
        );
        expect(
            await codigoDoErro(
                db.query(`UPDATE sispag_sugestao_boleto_evento SET ator = 'x' WHERE id = $1`, [
                    id(30),
                ]),
            ),
        ).toBe('P0001');
        expect(
            await codigoDoErro(
                db.query(`DELETE FROM sispag_sugestao_boleto_evento WHERE id = $1`, [id(30)]),
            ),
        ).toBe('P0001');
        expect(await codigoDoErro(db.query(`TRUNCATE sispag_sugestao_boleto_evento`))).toBe(
            'P0001',
        );
        expect(
            await codigoDoErro(
                db.query(
                    `INSERT INTO sispag_sugestao_boleto_evento (id, tipo, ator) VALUES ($1, 'OUTRO', 'ana')`,
                    [id(31)],
                ),
            ),
        ).toBe('23514');
    });
});
