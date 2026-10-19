import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0087 contra um Postgres DE VERDADE (ADR-0073): ledger do ajuste (etapas, idempotência, um não
 * terminal por título, máscara 5+4), transferência auditada da decisão (anulação pelo sistema só
 * com TITULO_RENEGOCIADO), tipos novos das trilhas. Reaplicar é no-op.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql`:
 *
 *   docker run -d --rm --name sb-pg-test -e POSTGRES_PASSWORD=test -p 55492:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55492/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_ajuste_centavos_it`.
 */

jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const NOME = '0087_sispag_ajuste_centavos.sql';
const BANCO = 'sispag_ajuste_centavos_it';

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

describeComBanco('0087 — ajuste de centavos do título', () => {
    let db: Client;
    const PAR = id(900);

    const inserirDecisao = (
        n: number,
        o: {
            titulo: string;
            ddc: number;
            dit: number;
            dec?: string;
            origem?: number;
            transferidaPor?: string | null;
        },
    ) =>
        db.query(
            `INSERT INTO sispag_decisao_sugestao_boleto
                (id, fil_cod, doc_cod, tit_cod, pes_cod, ddc_cod, dit_cod, codbar_mascarado,
                 valor_titulo, vencimento_titulo, valor_boleto, vencimento_boleto,
                 delta_valor, delta_percentual, delta_dias, tier, emissor_chave,
                 decisao, decidido_por, confirmacao_emissor_id, origem_decisao_id, transferida_por)
             VALUES ($1, 1, '536', $2, '7001', $3, $4, '34191…9000', 462.49, '2026-10-30', 462.50,
                     '2026-10-30', 0.01, 0, 0, 'CONHECIDO', '341:1:1', $5, 'ana', $6, $7, $8)`,
            [
                id(n),
                o.titulo,
                o.ddc,
                o.dit,
                o.dec ?? 'CONFIRMADA',
                PAR,
                o.origem ? id(o.origem) : null,
                o.transferidaPor ?? null,
            ],
        );

    const anular = (n: number, por: string, tipo: string | null) =>
        db.query(
            `UPDATE sispag_decisao_sugestao_boleto
                SET decisao = 'ANULADA', anulada_por = $2, anulada_em = now(),
                    motivo_anulacao = 'titulo renegociado 536/1 -> 536/2, frnCod 3',
                    tipo_anulacao = $3
              WHERE id = $1`,
            [id(n), por, tipo],
        );

    const ledger = (n: number, o: { decisao: number; etapa?: string; mascara?: string }) =>
        db.query(
            `INSERT INTO sispag_ajuste_centavos_execucao
                (id, fil_cod, doc_cod, tit_cod_origem, decisao_id, marcador, etapa,
                 codigo_mascarado)
             VALUES ($1, 1, '536', '1', $2, $3, $4, $5)`,
            [id(n), id(o.decisao), `AJC-${n}`, o.etapa ?? 'pendente', o.mascara ?? '34191…9000'],
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
            `INSERT INTO sispag_confirmacao_emissor_boleto
                (id, pes_cod, emissor_chave, layout_emissor, banco_emissor, emissor_mascarado,
                 confirmado_por)
             VALUES ($1, '7001', '341:1:1', 'GENERICO', '341', '341 / 1 / ***1', 'ana')`,
            [PAR],
        );
        // Decisão LEGADA, gravada antes da 0087 (sem as colunas novas).
        await db.query(
            `INSERT INTO sispag_decisao_sugestao_boleto
                (id, fil_cod, doc_cod, tit_cod, pes_cod, ddc_cod, dit_cod, codbar_mascarado,
                 valor_titulo, vencimento_titulo, valor_boleto, vencimento_boleto,
                 delta_valor, delta_percentual, delta_dias, tier, emissor_chave,
                 decisao, decidido_por, confirmacao_emissor_id)
             VALUES ($1, 1, '536', '1', '7001', 10, 1, '34191…9000', 462.49, '2026-10-30',
                     462.50, '2026-10-30', 0.01, 0, 0, 'CONHECIDO', '341:1:1', 'CONFIRMADA',
                     'ana', $2)`,
            [id(1), PAR],
        );
        await db.query(sqlDe(NOME));
        // Reaplicar é no-op (idempotência).
        await db.query(sqlDe(NOME));
    });

    afterAll(async () => {
        await db?.end();
    });

    it('decisão legada continua sem tipo_anulacao/transferência (sem backfill)', async () => {
        const { rows } = await db.query(
            `SELECT tipo_anulacao, origem_decisao_id, transferida_por
               FROM sispag_decisao_sugestao_boleto WHERE id = $1`,
            [id(1)],
        );
        expect(rows[0]).toEqual({
            tipo_anulacao: null,
            origem_decisao_id: null,
            transferida_por: null,
        });
    });

    it('anulação pelo sistema SEM TITULO_RENEGOCIADO é recusada; com, é aceita', async () => {
        expect(await codigoDoErro(anular(1, 'sistema', null))).toBe('23514');
        expect(await codigoDoErro(anular(1, 'sistema', 'MANUAL'))).toBe('23514');
        expect(await codigoDoErro(anular(1, 'unknown', 'TITULO_RENEGOCIADO'))).toBe('23514');
        expect(await codigoDoErro(anular(1, 'sistema', 'TITULO_RENEGOCIADO'))).toBeUndefined();
    });

    it('tipo_anulacao só em ANULADA', async () => {
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_decisao_sugestao_boleto SET tipo_anulacao = 'MANUAL'
                      WHERE decisao <> 'ANULADA'`,
                ),
            ),
        ).toBeUndefined(); // nenhuma linha não-anulada existe ainda: no-op
        await inserirDecisao(5, { titulo: '5', ddc: 50, dit: 1 });
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_decisao_sugestao_boleto SET tipo_anulacao = 'MANUAL'
                      WHERE id = $1`,
                    [id(5)],
                ),
            ),
        ).toBe('23514');
    });

    it('transferência: CONFIRMADA no título novo herda a analista, com origem e sistema', async () => {
        expect(
            await codigoDoErro(
                inserirDecisao(2, {
                    titulo: '2',
                    ddc: 10,
                    dit: 1,
                    origem: 1,
                    transferidaPor: 'sistema',
                }),
            ),
        ).toBeUndefined();
        // origem sem transferida_por, ou transferida_por ≠ sistema: recusado.
        expect(
            await codigoDoErro(inserirDecisao(3, { titulo: '3', ddc: 30, dit: 1, origem: 1 })),
        ).toBe('23514');
        expect(
            await codigoDoErro(
                inserirDecisao(4, {
                    titulo: '4',
                    ddc: 40,
                    dit: 1,
                    origem: 1,
                    transferidaPor: 'ana',
                }),
            ),
        ).toBe('23514');
    });

    it('decidido_por continua sem "sistema" (transferir não é confirmar)', async () => {
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_decisao_sugestao_boleto SET decidido_por = 'sistema' WHERE id = $1`,
                    [id(2)],
                ),
            ),
        ).toBe('23514');
    });

    it('ledger: dois não terminais para o mesmo título ⇒ erro; terminal libera um novo', async () => {
        expect(await codigoDoErro(ledger(100, { decisao: 1 }))).toBeUndefined();
        expect(await codigoDoErro(ledger(101, { decisao: 2 }))).toBe('23505');
        await db.query(
            `UPDATE sispag_ajuste_centavos_execucao SET etapa = 'cancelado' WHERE id = $1`,
            [id(100)],
        );
        expect(await codigoDoErro(ledger(102, { decisao: 2 }))).toBeUndefined();
    });

    it('ledger: chave de idempotência (título, decisão) única', async () => {
        expect(await codigoDoErro(ledger(103, { decisao: 1, etapa: 'recusado' }))).toBe('23505');
    });

    it('ledger: máscara com 44 dígitos e etapa desconhecida são recusadas', async () => {
        expect(
            await codigoDoErro(
                ledger(104, { decisao: 5, etapa: 'recusado', mascara: '3'.repeat(44) }),
            ),
        ).toBe('23514');
        expect(await codigoDoErro(ledger(105, { decisao: 5, etapa: 'quase' }))).toBe('23514');
    });

    it('trilha da sugestão: tipos novos aceitos, desconhecido recusado; AJUSTE_SIMULADO idempotente', async () => {
        const evento = (n: number, tipo: string, motivo: string | null = null) =>
            db.query(
                `INSERT INTO sispag_sugestao_boleto_evento
                    (id, tipo, ator, fil_cod, doc_cod, tit_cod, decisao_id, motivo)
                 VALUES ($1, $2, 'sistema', 1, '536', '1', $3, $4)`,
                [id(n), tipo, id(1), motivo],
            );
        for (const [n, tipo] of [
            [200, 'TITULO_RENEGOCIADO'],
            [201, 'DECISAO_TRANSFERIDA'],
            [202, 'AJUSTE_RECUSADO'],
            [203, 'AJUSTE_CANCELADO'],
            [204, 'AJUSTE_FALHOU'],
            [205, 'AJUSTE_SIMULADO'],
        ] as const) {
            expect(await codigoDoErro(evento(n, tipo))).toBeUndefined();
        }
        expect(await codigoDoErro(evento(206, 'AJUSTE_SIMULADO'))).toBe('23505');
        expect(await codigoDoErro(evento(207, 'AJUSTE_INVENTADO'))).toBe('23514');
        // Só-inclusão intacta.
        expect(
            await codigoDoErro(db.query('DELETE FROM sispag_sugestao_boleto_evento')),
        ).toBeDefined();
    });

    it('trilha do lote aceita ITEM_TITULO_RENEGOCIADO', async () => {
        expect(
            await codigoDoErro(
                db.query(
                    `INSERT INTO sispag_verificacao_evento (id, evento, ator, fil_cod, doc_cod, tit_cod)
                     VALUES ($1, 'ITEM_TITULO_RENEGOCIADO', 'sistema', 1, '536', '2')`,
                    [id(300)],
                ),
            ),
        ).toBeUndefined();
    });
});
