import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0080 contra um Postgres DE VERDADE (ADR-0065): a guarda que aborta a migração inteira quando
 * alguma tabela que vai sumir ainda tem linha, a conversão de `sispag:excecao` em
 * `sispag:autorizar_favorecido`, a trilha só-inclusão nova e o índice de vigência.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql`:
 *
 *   docker run -d --rm --name fa-pg-test -e POSTGRES_PASSWORD=test -p 55491:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55491/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria os bancos `sispag_fav_aut_it*`.
 */

jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const NOME = '0080_sispag_favorecido_autorizado.sql';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const id = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const migrations = (): string[] =>
    readdirSync(__dirname)
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .sort();

const sqlDe = (arquivo: string): string => readFileSync(path.join(__dirname, arquivo), 'utf8');

/** Banco novo com tudo até a 0079 aplicado (o estado do dia anterior). */
const bancoAte0079 = async (banco: string): Promise<Client> => {
    const dsn = ADMIN_DSN ?? '';
    const host = new URL(dsn).hostname;
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
        throw new Error(`METRICAS_CICLO_TEST_DSN precisa ser local; recebido host "${host}"`);
    }
    const raiz = new Client({ connectionString: dsn });
    await raiz.connect();
    await raiz.query(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
    await raiz.query(`CREATE DATABASE ${banco}`);
    await raiz.end();
    const db = new Client({ connectionString: dsnPara(dsn, banco) });
    await db.connect();
    const todas = migrations();
    expect(todas).toContain(NOME);
    for (const arquivo of todas.filter((f) => f < NOME)) {
        await db.query(sqlDe(arquivo));
    }
    return db;
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0080 — guarda: qualquer linha nas tabelas que somem aborta tudo', () => {
    let db: Client;

    beforeAll(async () => {
        db = await bancoAte0079('sispag_fav_aut_it_guarda');
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 1, 'RASCUNHO', 'ana')`,
            [id(1)],
        );
    });

    afterAll(async () => {
        await db?.end();
    });

    const aplicarFalha = async (): Promise<void> => {
        await expect(db.query(sqlDe(NOME))).rejects.toThrow(/0080/);
        // Nada mudou: a tabela nova não existe e a coluna antiga continua lá.
        const nova = await db.query(`SELECT to_regclass('sispag_favorecido_autorizado') AS t`);
        expect(nova.rows[0].t).toBeNull();
        const coluna = await db.query(
            `SELECT count(*)::int AS n FROM information_schema.columns
              WHERE table_name = 'lote_pagamento_item' AND column_name = 'destino_manual'`,
        );
        expect(coluna.rows[0].n).toBe(1);
    };

    it('linha em excecao_destino', async () => {
        await db.query(
            `INSERT INTO excecao_destino
                (id, pes_cod, fil_cod, tipo, banco_cod, agencia, conta, conta_dv,
                 titular_documento, justificativa, cadastrado_por)
             VALUES ($1, '7001', 1, 'CONTA', '237', '1', '2', '3', '11144477735', 'j', 'ana')`,
            [id(10)],
        );
        await db.query(
            `INSERT INTO excecao_destino_audit (id, excecao_id, evento, ator) VALUES ($1, $2, 'CADASTRO', 'ana')`,
            [id(11), id(10)],
        );
        await aplicarFalha();
    });

    it('linha só em lote_pagamento_item_destino_audit', async () => {
        const limpo = await bancoAte0079('sispag_fav_aut_it_guarda_b');
        try {
            await limpo.query(
                `INSERT INTO lote_pagamento_item_destino_audit
                    (id, lote_id, fil_cod, doc_cod, tit_cod, alterado_por)
                 VALUES ($1, $2, 1, 'D', 'T', 'ana')`,
                [id(20), id(1)],
            );
            await expect(limpo.query(sqlDe(NOME))).rejects.toThrow(/0080/);
        } finally {
            await limpo.end();
        }
    });

    it('linha só em pendencia_cadastro', async () => {
        const limpo = await bancoAte0079('sispag_fav_aut_it_guarda_c');
        try {
            await limpo.query(
                `INSERT INTO pendencia_cadastro (id, pes_cod, fil_cod, tipo, aberta_por)
                 VALUES ($1, '7001', 1, 'CONTA', 'sistema')`,
                [id(30)],
            );
            await expect(limpo.query(sqlDe(NOME))).rejects.toThrow(/0080/);
        } finally {
            await limpo.end();
        }
    });

    it('item com destino_manual preenchido', async () => {
        const limpo = await bancoAte0079('sispag_fav_aut_it_guarda_d');
        try {
            await limpo.query(
                `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 1, 'RASCUNHO', 'ana')`,
                [id(1)],
            );
            await limpo.query(
                `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por, destino_manual)
                 VALUES ($1, 1, 'D', 'T', 'ana', '{"tipo":"CONTA"}'::jsonb)`,
                [id(1)],
            );
            await expect(limpo.query(sqlDe(NOME))).rejects.toThrow(/0080/);
        } finally {
            await limpo.end();
        }
    });
});

describeComBanco('0080 — com as tabelas vazias aplica e converte permissões', () => {
    let db: Client;

    beforeAll(async () => {
        db = await bancoAte0079('sispag_fav_aut_it');
        await db.query(
            `INSERT INTO app_user (username, password_hash, role, role_id)
             SELECT 'ana', 'x', 'admin', id FROM app_role WHERE lower(nome) = 'administrador'`,
        );
        const papel = await db.query(
            `INSERT INTO app_role (nome) VALUES ('Tesouraria IT') RETURNING id`,
        );
        for (const p of ['sispag:excecao', 'sispag:conferir', 'sispag:cadastro']) {
            await db.query(
                `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, $2)`,
                [papel.rows[0].id, p],
            );
        }
        for (const p of ['sispag:excecao', 'sispag:conferir']) {
            await db.query(
                `INSERT INTO user_permission (user_id, permission, efeito, concedido_por)
                 SELECT id, $1, 'conceder', 'adm' FROM app_user WHERE username = 'ana'`,
                [p],
            );
        }
        await db.query(
            `INSERT INTO alerta (tipo, alvo, severidade, janela_inicio, dedup_key, detalhe)
             VALUES ('sispag-excecao-divergencia', 'excecao:x', 'aviso', now(), 'k-x', '{}'::jsonb)`,
        );
        await db.query(sqlDe(NOME));
        // Reaplicar é no-op.
        await db.query(sqlDe(NOME));
    });

    afterAll(async () => {
        await db?.end();
    });

    it('as cinco tabelas e as colunas antigas sumiram; a coluna nova existe', async () => {
        for (const t of [
            'excecao_destino',
            'excecao_destino_audit',
            'lote_pagamento_item_destino_audit',
            'pendencia_cadastro_origem',
            'pendencia_cadastro',
        ]) {
            const r = await db.query(`SELECT to_regclass($1) AS t`, [t]);
            expect(r.rows[0].t).toBeNull();
        }
        const colunas = await db.query(
            `SELECT table_name, column_name FROM information_schema.columns
              WHERE (table_name = 'lote_pagamento_item' AND column_name IN
                        ('excecao_destino_id', 'destino_manual', 'destino_origem',
                         'favorecido_autorizado_id', 'autorizacao_aviso'))
                 OR (table_name = 'lote_pagamento' AND column_name IN
                        ('conferido_por', 'conferido_em', 'devolvido_por', 'devolvido_em',
                         'motivo_devolucao'))
              ORDER BY column_name`,
        );
        expect(colunas.rows.map((r) => r.column_name)).toEqual([
            'autorizacao_aviso',
            'favorecido_autorizado_id',
        ]);
    });

    it('sispag:excecao virou sispag:autorizar_favorecido no papel e no usuário; conferir/cadastro sumiram', async () => {
        const papel = await db.query(
            `SELECT p.permission FROM app_role_permission p JOIN app_role r ON r.id = p.role_id
              WHERE r.nome = 'Tesouraria IT' ORDER BY 1`,
        );
        expect(papel.rows.map((r) => r.permission)).toEqual(['sispag:autorizar_favorecido']);
        const usuario = await db.query(
            `SELECT permission, efeito FROM user_permission u JOIN app_user a ON a.id = u.user_id
              WHERE a.username = 'ana'`,
        );
        expect(usuario.rows).toEqual([
            { permission: 'sispag:autorizar_favorecido', efeito: 'conceder' },
        ]);
        const antigas = await db.query(
            `SELECT
                (SELECT count(*) FROM app_role_permission
                  WHERE permission IN ('sispag:excecao', 'sispag:conferir', 'sispag:cadastro'))::int AS a,
                (SELECT count(*) FROM user_permission
                  WHERE permission IN ('sispag:excecao', 'sispag:conferir', 'sispag:cadastro'))::int AS b`,
        );
        expect(antigas.rows[0]).toEqual({ a: 0, b: 0 });
    });

    it('o Administrador tem sispag:autorizar_favorecido uma vez só', async () => {
        const r = await db.query(
            `SELECT count(*)::int AS n FROM app_role_permission p JOIN app_role r ON r.id = p.role_id
              WHERE p.permission = 'sispag:autorizar_favorecido' AND lower(r.nome) = 'administrador'`,
        );
        expect(r.rows[0].n).toBe(1);
    });

    it('o CHECK de permission recusa sispag:excecao', async () => {
        const papel = await db.query(
            `INSERT INTO app_role (nome) VALUES ('CHECK IT') RETURNING id`,
        );
        await expect(
            db.query(
                `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, 'sispag:excecao')`,
                [papel.rows[0].id],
            ),
        ).rejects.toThrow(/check/i);
    });

    it('o alerta antigo foi apagado e o tipo novo é aceito', async () => {
        const velhos = await db.query(
            `SELECT count(*)::int AS n FROM alerta WHERE tipo = 'sispag-excecao-divergencia'`,
        );
        expect(velhos.rows[0].n).toBe(0);
        await db.query(
            `INSERT INTO alerta (tipo, alvo, severidade, janela_inicio, dedup_key, detalhe)
             VALUES ('sispag-destino-alterado', 'favorecido:1:TED', 'aviso', now(), 'k-y', '{}'::jsonb)`,
        );
    });

    it('uma vigente por (favorecido, modalidade); terminais não disputam', async () => {
        const inserir = (n: number, pes: string, modalidade: string, estado: string, fp?: string) =>
            db.query(
                `INSERT INTO sispag_favorecido_autorizado
                    (id, pes_cod, credor, modalidade, estado, fingerprint, fingerprint_chave_id,
                     origem_solicitacao, solicitado_por, fil_cod_leitura, motivo_decisao)
                 VALUES ($1, $2, 'ACME', $3, $4, $5, $6, 'MANUAL', 'ana', 1, $7)`,
                [
                    id(n),
                    pes,
                    modalidade,
                    estado,
                    fp ?? null,
                    fp ? 'v1' : null,
                    estado === 'REVOGADO' ? 'encerrado' : null,
                ],
            );
        await inserir(100, '9001', 'TED', 'PENDENTE');
        await expect(inserir(101, '9001', 'TED', 'AUTORIZADO', 'f')).rejects.toThrow(
            /unique|duplicate/i,
        );
        await expect(inserir(102, '9001', 'PIX', 'PENDENTE')).resolves.toBeDefined();
        await expect(inserir(103, '9001', 'TED', 'REVOGADO')).resolves.toBeDefined();
        await expect(inserir(104, '9002', 'TED', 'AUTORIZADO')).rejects.toThrow(/check/i);
    });

    it('a trilha recusa UPDATE, DELETE e TRUNCATE', async () => {
        await db.query(
            `INSERT INTO sispag_favorecido_autorizado_evento (id, autorizacao_id, evento, ator)
             VALUES ($1, $2, 'SOLICITADO', 'ana')`,
            [id(900), id(100)],
        );
        await expect(
            db.query(`UPDATE sispag_favorecido_autorizado_evento SET ator = 'x' WHERE id = $1`, [
                id(900),
            ]),
        ).rejects.toThrow(/so de inclusao/);
        await expect(
            db.query(`DELETE FROM sispag_favorecido_autorizado_evento WHERE id = $1`, [id(900)]),
        ).rejects.toThrow(/so de inclusao/);
        await expect(db.query('TRUNCATE sispag_favorecido_autorizado_evento')).rejects.toThrow(
            /so de inclusao/,
        );
    });

    it('AlertaItemLote não aceita mais CANAL_HABITUAL', async () => {
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 1, 'RASCUNHO', 'ana')`,
            [id(500)],
        );
        await expect(
            db.query(
                `INSERT INTO lote_pagamento_item_alerta (id, lote_id, fil_cod, doc_cod, tit_cod, tipo)
                 VALUES ($1, $2, 1, 'D', 'T', 'CANAL_HABITUAL')`,
                [id(501), id(500)],
            ),
        ).rejects.toThrow(/check/i);
    });
});
