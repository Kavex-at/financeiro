import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0076–0079 contra um Postgres DE VERDADE (ADR-0063): unicidades parciais (alerta viva, bloqueio
 * ATIVO, pendência ABERTA), CHECKs, trilha só-inclusão e as permissões novas sem concessão.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql` com o DSN LOCAL das migrations anteriores:
 *
 *   docker run -d --rm --name excecao-pg-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 *
 * O teste apaga e recria o banco `sispag_verificacoes_ted_pix_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_verificacoes_ted_pix_it';
const NOVAS = [
    '0076_sispag_alerta_item_lote.sql',
    '0077_sispag_bloqueio_pendencia.sql',
    '0078_sispag_perfil_canal_conferencia.sql',
    '0079_permissoes_sispag_conferir_cadastro.sql',
];

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const uuid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0076–0079 — verificação TED/PIX (integração)', () => {
    let db: Client;
    const LOTE = uuid(1);

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
        const migrations = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort();
        for (const nova of NOVAS) expect(migrations).toContain(nova);
        for (const arquivo of migrations) {
            await db.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }
        // Idempotente: aplicar as quatro de novo não quebra nem duplica.
        for (const nova of NOVAS) {
            await db.query(readFileSync(path.join(__dirname, nova), 'utf8'));
        }
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 4, 'RASCUNHO', 'ana')`,
            [LOTE],
        );
    });

    afterAll(async () => {
        await db?.end();
    });

    const alerta = (n: number, campos: Record<string, unknown> = {}) =>
        db.query(
            `INSERT INTO lote_pagamento_item_alerta
                (id, lote_id, fil_cod, doc_cod, tit_cod, tipo, contraparte_fil_cod,
                 contraparte_doc_cod, estado, resolucao, justificativa, resolvido_por)
             VALUES ($1, $2, 4, '6173', '1', $3, $4, $5, $6, $7, $8, $9)`,
            [
                uuid(n),
                LOTE,
                campos.tipo ?? 'DUPLICIDADE_FORTE',
                campos.cfil ?? 4,
                campos.cdoc ?? '6702',
                campos.estado ?? 'ABERTA',
                campos.resolucao ?? null,
                campos.justificativa ?? null,
                campos.por ?? null,
            ],
        );

    it('uma alerta viva por (item, tipo, contraparte); a obsoleta não conta', async () => {
        await alerta(100);
        await expect(alerta(101)).rejects.toThrow(/ux_lote_pagamento_item_alerta_viva/);
        await db.query(`UPDATE lote_pagamento_item_alerta SET estado = 'OBSOLETA' WHERE id = $1`, [
            uuid(100),
        ]);
        await alerta(102);
        // Outra contraparte é outra alerta.
        await alerta(103, { cdoc: '6999' });
    });

    it('JUSTIFICADA exige texto; tipo e estado fora do catálogo são recusados', async () => {
        await expect(
            alerta(110, {
                cdoc: '7000',
                estado: 'RESOLVIDA',
                resolucao: 'JUSTIFICADA',
                justificativa: '   ',
                por: 'ana',
            }),
        ).rejects.toThrow(/justificativa_check/);
        await expect(alerta(111, { tipo: 'OUTRO', cdoc: '7001' })).rejects.toThrow(/tipo_check/);
        await expect(alerta(112, { estado: 'FECHADA', cdoc: '7002' })).rejects.toThrow(
            /estado_check/,
        );
    });

    it('item ganha verificacao_estado PENDENTE|OK e destino só mascarado', async () => {
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por,
                verificacao_estado, destino_origem, destino_mascarado)
             VALUES ($1, 4, '6173', '1', 'ana', 'PENDENTE', 'CADASTRO', '341 / ****-5')`,
            [LOTE],
        );
        await expect(
            db.query(
                `UPDATE lote_pagamento_item SET verificacao_estado = 'TALVEZ' WHERE lote_id = $1`,
                [LOTE],
            ),
        ).rejects.toThrow(/verificacao_estado_check/);
    });

    it('a alerta cai junto com o lote (CASCADE)', async () => {
        const outro = uuid(2);
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 4, 'RASCUNHO', 'ana')`,
            [outro],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item_alerta (id, lote_id, fil_cod, doc_cod, tit_cod, tipo)
             VALUES ($1, $2, 4, '1', '1', 'CANAL_HABITUAL')`,
            [uuid(120), outro],
        );
        await db.query(`DELETE FROM lote_pagamento WHERE id = $1`, [outro]);
        const r = await db.query(`SELECT 1 FROM lote_pagamento_item_alerta WHERE id = $1`, [
            uuid(120),
        ]);
        expect(r.rowCount).toBe(0);
    });

    it('no máximo um bloqueio ATIVO por título; desfazer exige motivo', async () => {
        const bloqueio = (n: number, estado = 'ATIVO') =>
            db.query(
                `INSERT INTO titulo_bloqueio_duplicidade
                    (id, fil_cod, doc_cod, tit_cod, motivo, estado, marcado_por, encerrado_em)
                 VALUES ($1, 4, '6702', '1', 'duplicata do 6173', $2, 'ana', $3)`,
                [uuid(n), estado, estado === 'ENCERRADO' ? new Date() : null],
            );
        await bloqueio(200);
        await expect(bloqueio(201)).rejects.toThrow(/ux_titulo_bloqueio_duplicidade_ativo/);
        await bloqueio(202, 'ENCERRADO');
        await expect(
            db.query(`UPDATE titulo_bloqueio_duplicidade SET estado = 'DESFEITO' WHERE id = $1`, [
                uuid(200),
            ]),
        ).rejects.toThrow(/desfeito_check/);
    });

    it('no máximo uma pendência ABERTA por (favorecido, tipo); origem não duplica', async () => {
        const pendencia = (n: number, tipo = 'CONTA') =>
            db.query(
                `INSERT INTO pendencia_cadastro (id, pes_cod, fil_cod, tipo, aberta_por)
                 VALUES ($1, '90001', 4, $2, 'sistema')`,
                [uuid(n), tipo],
            );
        await pendencia(300);
        await expect(pendencia(301)).rejects.toThrow(/ux_pendencia_cadastro_aberta/);
        await pendencia(302, 'CHAVE_PIX');
        const origem = () =>
            db.query(
                `INSERT INTO pendencia_cadastro_origem
                    (id, pendencia_id, lote_id, fil_cod, doc_cod, tit_cod, desfecho)
                 VALUES (gen_random_uuid(), $1, $2, 4, '6173', '1', 'RETIRADO')
                 ON CONFLICT DO NOTHING`,
                [uuid(300), LOTE],
            );
        await origem();
        await origem();
        const n = await db.query(
            `SELECT count(*)::int AS n FROM pendencia_cadastro_origem WHERE pendencia_id = $1`,
            [uuid(300)],
        );
        expect(n.rows[0].n).toBe(1);
    });

    it('a trilha recusa UPDATE, DELETE e TRUNCATE', async () => {
        await db.query(
            `INSERT INTO sispag_verificacao_evento (id, evento, ator, lote_id) VALUES ($1, 'LOTE_CONFERIDO', 'bia', $2)`,
            [uuid(400), LOTE],
        );
        await expect(
            db.query(`UPDATE sispag_verificacao_evento SET ator = 'x' WHERE id = $1`, [uuid(400)]),
        ).rejects.toThrow(/so de inclusao/);
        await expect(
            db.query(`DELETE FROM sispag_verificacao_evento WHERE id = $1`, [uuid(400)]),
        ).rejects.toThrow(/so de inclusao/);
        await expect(db.query('TRUNCATE sispag_verificacao_evento')).rejects.toThrow(
            /so de inclusao/,
        );
        await expect(
            db.query(
                `INSERT INTO sispag_verificacao_evento (id, evento, ator) VALUES ($1, 'INVENTADO', 'x')`,
                [uuid(401)],
            ),
        ).rejects.toThrow(/evento_check/);
    });

    it('perfil: um por pes_cod, grupo/confiança/participação no catálogo', async () => {
        const perfil = (grupo: string, participacao: number) =>
            db.query(
                `INSERT INTO perfil_canal_fornecedor (pes_cod, contagens, pagamentos_unicos,
                    meses_distintos, grupo_dominante, participacao, confianca, janela_inicio,
                    janela_fim, job_run_id)
                 VALUES ('90001', '{}'::jsonb, 5, 3, $1, $2, 'ALTA', now(), now(), 'run-1')`,
                [grupo, participacao],
            );
        await perfil('BOLETO', 1);
        await expect(perfil('BOLETO', 1)).rejects.toThrow(/perfil_canal_fornecedor_pkey/);
        await db.query(`DELETE FROM perfil_canal_fornecedor`);
        await expect(perfil('PIX', 1)).rejects.toThrow(/grupo_check/);
        await expect(perfil('TED_PIX', 1.2)).rejects.toThrow(/participacao/);
    });

    it('lote ganha as colunas de conferência', async () => {
        await db.query(
            `UPDATE lote_pagamento SET conferido_por = 'bia', conferido_em = now(),
                devolvido_por = 'bia', devolvido_em = now(), motivo_devolucao = 'x' WHERE id = $1`,
            [LOTE],
        );
    });

    it('as permissões novas passam no CHECK e ninguém as recebeu (gap Q8)', async () => {
        const concedidas = await db.query(
            `SELECT count(*)::int AS n FROM app_role_permission
              WHERE permission IN ('sispag:conferir', 'sispag:cadastro')`,
        );
        expect(concedidas.rows[0].n).toBe(0);
        const papel = await db.query(
            `INSERT INTO app_role (nome) VALUES ('Conferente IT') RETURNING id`,
        );
        for (const p of ['sispag:conferir', 'sispag:cadastro', 'sispag:excecao', 'sispag:ver']) {
            await db.query(
                `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, $2)`,
                [papel.rows[0].id, p],
            );
        }
        await expect(
            db.query(
                `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, 'sispag:tudo')`,
                [papel.rows[0].id],
            ),
        ).rejects.toThrow(/permission_check/);
    });
});
