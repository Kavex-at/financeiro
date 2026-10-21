import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0090 contra um Postgres DE VERDADE (ADR-0076): grupo de boleto (índices únicos parciais da I19i,
 * soma exata, ator humano, máscara 5+4, coerência grupo × títulos no COMMIT), ledger do borderô
 * (identidade borCod + borTimCad, `t1` nulo, um não terminal por grupo), trilha só-inclusão,
 * item do lote, etapa `preparar_bordero`, origem `GRUPO_BOLETO` e alerta novo. Reaplicar é no-op.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql`:
 *
 *   docker run -d --rm --name sb-pg-test -e POSTGRES_PASSWORD=test -p 55492:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55492/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_grupo_boleto_it`.
 */

jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const NOME = '0090_sispag_grupo_boleto.sql';
const BANCO = 'sispag_grupo_boleto_it';

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

interface GrupoFixture {
    ddc?: number;
    titulos?: { doc: string; valor: number; fil?: number }[];
    soma?: number;
    valor?: number;
    por?: string;
    mascara?: string;
    estadoTitulo?: string;
}

describeComBanco('0090 — boleto agrupado', () => {
    let db: Client;
    const PAR = id(900);
    const LOTE = id(800);
    let remessaId = 0;

    /** Grupo + N títulos numa transação (a coerência é conferida no COMMIT). */
    const grupo = async (n: number, o: GrupoFixture = {}): Promise<void> => {
        const titulos = o.titulos ?? [
            { doc: `${n}1`, valor: 52500 },
            { doc: `${n}2`, valor: 52500 },
            { doc: `${n}3`, valor: 52500 },
        ];
        const soma = o.soma ?? titulos.reduce((s, t) => s + t.valor, 0);
        await db.query('BEGIN');
        try {
            await db.query(
                `INSERT INTO sispag_grupo_boleto
                    (id, fil_cod, pes_cod, emissor_chave, ddc_cod, dit_cod, codbar_mascarado,
                     valor_boleto_centavos, vencimento_boleto, soma_titulos_centavos, origem,
                     confirmacao_emissor_id, confirmado_por)
                 VALUES ($1, 2, '7001', '341:1:1', $2, 1, $3, $4, '2026-10-21', $5, 'SUGERIDO',
                         $6, $7)`,
                [
                    id(n),
                    o.ddc ?? n,
                    o.mascara ?? '34191…8200',
                    o.valor ?? soma,
                    soma,
                    PAR,
                    o.por ?? 'ana',
                ],
            );
            for (const t of titulos) {
                await db.query(
                    `INSERT INTO sispag_grupo_boleto_titulo
                        (grupo_id, fil_cod, doc_cod, tit_cod, valor_liquido_centavos, vencimento,
                         estado)
                     VALUES ($1, $2, $3, '1', $4, '2026-10-21', $5)`,
                    [id(n), t.fil ?? 2, t.doc, t.valor, o.estadoTitulo ?? 'CONFIRMADO'],
                );
            }
            await db.query('COMMIT');
        } catch (e) {
            await db.query('ROLLBACK');
            throw e;
        }
    };

    const anular = async (n: number, por = 'ana', tipo = 'MANUAL'): Promise<void> => {
        await db.query('BEGIN');
        try {
            await db.query(
                `UPDATE sispag_grupo_boleto
                    SET estado = 'ANULADO', anulado_por = $2, anulado_em = now(),
                        motivo_anulacao = 'boleto errado, analista corrigiu', tipo_anulacao = $3,
                        versao = versao + 1
                  WHERE id = $1`,
                [id(n), por, tipo],
            );
            await db.query(
                `UPDATE sispag_grupo_boleto_titulo SET estado = 'ANULADO' WHERE grupo_id = $1`,
                [id(n)],
            );
            await db.query('COMMIT');
        } catch (e) {
            await db.query('ROLLBACK');
            throw e;
        }
    };

    const execucao = (
        n: number,
        o: { grupo: number; etapa?: string; borCod?: number | null; borTimCad?: number | null },
    ) =>
        db.query(
            `INSERT INTO sispag_grupo_boleto_execucao
                (id, grupo_id, remessa_execucao_id, lote_id, fil_cod, etapa, bor_cod, bor_tim_cad,
                 escrita_iniciada_em)
             VALUES ($1, $2, $3, $4, 2, $5, $6, $7, now())`,
            [
                id(n),
                id(o.grupo),
                remessaId,
                LOTE,
                o.etapa ?? 'intencao_gravada',
                o.borCod ?? null,
                o.borTimCad ?? null,
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
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por)
             VALUES ($1, 2, 'RASCUNHO', 'ana')`,
            [LOTE],
        );
        // Item legado, gravado antes da 0090 (sem grupo_boleto_id).
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por)
             VALUES ($1, 2, '100', '1', 'ana')`,
            [LOTE],
        );
        await db.query(sqlDe(NOME));
        // Reaplicar é no-op (idempotência).
        await db.query(sqlDe(NOME));
        const { rows } = await db.query(
            `INSERT INTO remessa_execucao (idempotency_key, lote_id, fil_cod, bnc_cod, etapa)
             VALUES ('gb-1', $1, 2, 4, 'preparar_bordero') RETURNING id`,
            [LOTE],
        );
        remessaId = Number(rows[0].id);
    });

    afterAll(async () => {
        await db?.end();
    });

    it('item legado continua sem grupo (sem backfill); item novo aceita o grupo', async () => {
        const { rows } = await db.query(
            `SELECT grupo_boleto_id FROM lote_pagamento_item WHERE doc_cod = '100'`,
        );
        expect(rows[0].grupo_boleto_id).toBeNull();
        await grupo(1);
        expect(
            await codigoDoErro(
                db.query(
                    `INSERT INTO lote_pagamento_item
                        (lote_id, fil_cod, doc_cod, tit_cod, incluido_por, grupo_boleto_id)
                     VALUES ($1, 2, '11', '1', 'ana', $2)`,
                    [LOTE, id(1)],
                ),
            ),
        ).toBeUndefined();
    });

    it('I19i: dois grupos CONFIRMADO para o mesmo boleto ⇒ erro', async () => {
        expect(
            await codigoDoErro(
                grupo(2, {
                    ddc: 1,
                    titulos: [
                        { doc: '21', valor: 100 },
                        { doc: '22', valor: 100 },
                    ],
                }),
            ),
        ).toBe('23505');
    });

    it('I19i: o mesmo título em dois grupos CONFIRMADO ⇒ erro; depois de anular o primeiro ⇒ ok', async () => {
        const mesmoTitulo = {
            titulos: [
                { doc: '11', valor: 52500 },
                { doc: '31', valor: 52500 },
            ],
        };
        expect(await codigoDoErro(grupo(3, mesmoTitulo))).toBe('23505');
        await anular(1);
        expect(await codigoDoErro(grupo(3, mesmoTitulo))).toBeUndefined();
        // E o boleto do grupo anulado fica livre de novo.
        expect(
            await codigoDoErro(
                grupo(4, {
                    ddc: 1,
                    titulos: [
                        { doc: '41', valor: 100 },
                        { doc: '42', valor: 100 },
                    ],
                }),
            ),
        ).toBeUndefined();
    });

    it('I19b: soma ≠ boleto ⇒ erro; Σ dos títulos ≠ soma do grupo ⇒ erro no COMMIT', async () => {
        expect(await codigoDoErro(grupo(5, { valor: 157501 }))).toBe('23514');
        expect(await codigoDoErro(grupo(6, { soma: 157600, valor: 157600 }))).toBe('23514');
    });

    it('I19a/I19d: um título só ⇒ erro; título de outra filial ⇒ erro; estado divergente ⇒ erro', async () => {
        expect(await codigoDoErro(grupo(7, { titulos: [{ doc: '71', valor: 100 }] }))).toBe(
            '23514',
        );
        expect(
            await codigoDoErro(
                grupo(8, {
                    titulos: [
                        { doc: '81', valor: 100 },
                        { doc: '82', valor: 100, fil: 3 },
                    ],
                }),
            ),
        ).toBe('23514');
        expect(await codigoDoErro(grupo(9, { estadoTitulo: 'ANULADO' }))).toBe('23514');
    });

    it('anular só o grupo (sem os títulos) ⇒ erro no COMMIT', async () => {
        await db.query('BEGIN');
        await db.query(
            `UPDATE sispag_grupo_boleto
                SET estado = 'ANULADO', anulado_por = 'ana', anulado_em = now(),
                    motivo_anulacao = 'esqueci os titulos', tipo_anulacao = 'MANUAL'
              WHERE id = $1`,
            [id(3)],
        );
        expect(await codigoDoErro(db.query('COMMIT'))).toBe('23514');
    });

    it('confirmado_por = sistema ⇒ erro; máscara com 44 dígitos ⇒ erro', async () => {
        expect(await codigoDoErro(grupo(10, { por: 'sistema' }))).toBe('23514');
        expect(await codigoDoErro(grupo(11, { mascara: '3'.repeat(44) }))).toBe('23514');
    });

    it('anulação: sistema só com PAR_REVOGADO; motivo curto recusado', async () => {
        await grupo(12);
        expect(await codigoDoErro(anular(12, 'sistema', 'MANUAL'))).toBe('23514');
        await expect(anular(12, 'sistema', 'PAR_REVOGADO')).resolves.toBeUndefined();
        await grupo(13);
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_grupo_boleto
                        SET estado = 'ANULADO', anulado_por = 'ana', anulado_em = now(),
                            motivo_anulacao = 'curto', tipo_anulacao = 'MANUAL'
                      WHERE id = $1`,
                    [id(13)],
                ),
            ),
        ).toBe('23514');
    });

    it('execução: identidade exige borCod E borTimCad; t1 pode ficar nulo', async () => {
        expect(await codigoDoErro(execucao(100, { grupo: 3, borCod: 253 }))).toBe('23514');
        expect(
            await codigoDoErro(
                execucao(100, {
                    grupo: 3,
                    etapa: 'bordero_criado',
                    borCod: 253,
                    borTimCad: 1792523939000,
                }),
            ),
        ).toBeUndefined();
        const { rows } = await db.query(
            `SELECT escrita_concluida_em FROM sispag_grupo_boleto_execucao WHERE id = $1`,
            [id(100)],
        );
        expect(rows[0].escrita_concluida_em).toBeNull();
        // bor_tim_cad devolve o epoch ms exato (BIGINT ⇒ string no pg, sem arredondamento).
        const { rows: r2 } = await db.query(
            `SELECT bor_tim_cad FROM sispag_grupo_boleto_execucao WHERE id = $1`,
            [id(100)],
        );
        expect(r2[0].bor_tim_cad).toBe('1792523939000');
    });

    it('execução: no máximo uma não terminal por grupo; terminal libera; reaproveitar o mesmo borderô é permitido', async () => {
        expect(await codigoDoErro(execucao(101, { grupo: 3 }))).toBe('23505');
        await db.query(
            `UPDATE sispag_grupo_boleto_execucao SET etapa = 'concluido' WHERE id = $1`,
            [id(100)],
        );
        expect(
            await codigoDoErro(
                execucao(101, {
                    grupo: 3,
                    etapa: 'reaproveitado',
                    borCod: 253,
                    borTimCad: 1792523939000,
                }),
            ),
        ).toBeUndefined();
        expect(await codigoDoErro(execucao(102, { grupo: 4, etapa: 'quase' }))).toBe('23514');
        expect(await codigoDoErro(execucao(103, { grupo: 4, etapa: 'marcador_gravado' }))).toBe(
            '23514',
        );
    });

    it('execução: t1 antes de t0 ⇒ erro', async () => {
        expect(
            await codigoDoErro(
                db.query(
                    `UPDATE sispag_grupo_boleto_execucao
                        SET escrita_concluida_em = escrita_iniciada_em - interval '1 second'
                      WHERE id = $1`,
                    [id(101)],
                ),
            ),
        ).toBe('23514');
    });

    it('apagar o lote local não bloqueia nem apaga o ledger (remessa_execucao_id vira nulo)', async () => {
        const OUTRO = id(801);
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 2, 'RASCUNHO', 'ana')`,
            [OUTRO],
        );
        const { rows } = await db.query(
            `INSERT INTO remessa_execucao (idempotency_key, lote_id, fil_cod, bnc_cod)
             VALUES ('gb-2', $1, 2, 4) RETURNING id`,
            [OUTRO],
        );
        await db.query(
            `INSERT INTO sispag_grupo_boleto_execucao
                (id, grupo_id, remessa_execucao_id, lote_id, fil_cod, etapa)
             VALUES ($1, $2, $3, $4, 2, 'simulado')`,
            [id(104), id(4), rows[0].id, OUTRO],
        );
        await db.query(`DELETE FROM lote_pagamento WHERE id = $1`, [OUTRO]);
        const { rows: r } = await db.query(
            `SELECT remessa_execucao_id FROM sispag_grupo_boleto_execucao WHERE id = $1`,
            [id(104)],
        );
        expect(r[0].remessa_execucao_id).toBeNull();
    });

    it('trilha: tipos conhecidos aceitos, desconhecido recusado; UPDATE/DELETE/TRUNCATE recusados', async () => {
        const evento = (n: number, tipo: string, mascara: string | null = '34191…8200') =>
            db.query(
                `INSERT INTO sispag_grupo_boleto_evento (id, grupo_id, tipo, ator, codigo_mascarado)
                 VALUES ($1, $2, $3, 'ana', $4)`,
                [id(n), id(3), tipo, mascara],
            );
        expect(await codigoDoErro(evento(200, 'GRUPO_CONFIRMADO'))).toBeUndefined();
        expect(await codigoDoErro(evento(201, 'BORDERO_REAPROVEITADO'))).toBeUndefined();
        expect(await codigoDoErro(evento(202, 'GRUPO_SUMIU'))).toBe('23514');
        expect(await codigoDoErro(evento(203, 'GRUPO_PAGO', '3'.repeat(44)))).toBe('23514');
        expect(
            await codigoDoErro(
                db.query(`UPDATE sispag_grupo_boleto_evento SET ator = 'x' WHERE id = $1`, [
                    id(200),
                ]),
            ),
        ).toBe('P0001');
        expect(
            await codigoDoErro(
                db.query(`DELETE FROM sispag_grupo_boleto_evento WHERE id = $1`, [id(200)]),
            ),
        ).toBe('P0001');
        expect(await codigoDoErro(db.query('TRUNCATE sispag_grupo_boleto_evento'))).toBe('P0001');
    });

    it('origem GRUPO_BOLETO aceita na marca de retenção; desconhecida recusada', async () => {
        const marca = (n: number, origem: string) =>
            db.query(
                `INSERT INTO titulo_bloqueio_duplicidade
                    (id, fil_cod, doc_cod, tit_cod, motivo, estado, marcado_por, origem,
                     codigo_mascarado)
                 VALUES ($1, 2, $2, '1', 'grupo retirado', 'ATIVO', 'sistema', $3, '34191…8200')`,
                [id(n), `9${n}`, origem],
            );
        expect(await codigoDoErro(marca(300, 'GRUPO_BOLETO'))).toBeUndefined();
        expect(await codigoDoErro(marca(301, 'GRUPO_QUALQUER'))).toBe('23514');
    });

    it('alerta sispag-bordero-grupo-pendente aceito; desconhecido recusado', async () => {
        const alerta = (tipo: string, chave: string) =>
            db.query(
                `INSERT INTO alerta (tipo, alvo, severidade, janela_inicio, dedup_key, detalhe)
                 VALUES ($1, '2:bor:253', 'erro', now(), $2, '{}'::jsonb)`,
                [tipo, chave],
            );
        expect(
            await codigoDoErro(alerta('sispag-bordero-grupo-pendente', 'gb-pendente-1')),
        ).toBeUndefined();
        expect(await codigoDoErro(alerta('sispag-grupo-qualquer', 'gb-x'))).toBe('23514');
    });

    it('remessa_execucao aceita preparar_bordero; etapa desconhecida recusada', async () => {
        expect(
            await codigoDoErro(
                db.query(`UPDATE remessa_execucao SET etapa = 'preparar_bordero' WHERE id = $1`, [
                    remessaId,
                ]),
            ),
        ).toBeUndefined();
        expect(
            await codigoDoErro(
                db.query(`UPDATE remessa_execucao SET etapa = 'vincular_codbar' WHERE id = $1`, [
                    remessaId,
                ]),
            ),
        ).toBe('23514');
    });
});
