import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';

/**
 * 0075 contra um Postgres DE VERDADE (ADR-0060): trilha só-inclusão, uma APROVADA por
 * (favorecido, tipo), aprovador ≠ cadastrante no banco, conversão idempotente de
 * `sispag:aprovar_destino` em `sispag:excecao` e o `CHECK` do alerta.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql` com o mesmo DSN das migrations anteriores:
 *
 *   docker run -d --rm --name excecao-pg-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 *
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_excecao_destino_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_excecao_destino_it';
const NOME = '0075_sispag_excecao_destino.sql';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const id = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('0075 — exceção de destino (integração)', () => {
    let db: Client;
    let proximo = 100;

    const destinoDe = (tipo: string): unknown[] =>
        tipo === 'CONTA'
            ? ['237', '1234', '99887766', '1', null, null]
            : [null, null, null, null, 'CPF_CNPJ', '11144477735'];

    const novaConta = async (
        campos: {
            pes?: string;
            tipo?: string;
            estado?: string;
            por?: string;
            aprovador?: string;
        } = {},
    ): Promise<string> => {
        proximo += 1;
        const novoId = id(proximo);
        const estado = campos.estado ?? 'PENDENTE';
        const aprovada = estado === 'APROVADA';
        await db.query(
            `INSERT INTO excecao_destino
                (id, pes_cod, fil_cod, tipo, banco_cod, agencia, conta, conta_dv,
                 chave_pix_tipo, chave_pix, titular_documento, estado, justificativa,
                 cadastrado_por, aprovado_por, aprovado_em)
             VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, '11144477735', $10, 'cadastro errado',
                     $11, $12, $13)`,
            [
                novoId,
                campos.pes ?? '7001',
                campos.tipo ?? 'CONTA',
                ...destinoDe(campos.tipo ?? 'CONTA'),
                estado,
                campos.por ?? 'ana',
                campos.aprovador ?? (aprovada ? 'bia' : null),
                aprovada ? new Date() : null,
            ],
        );
        return novoId;
    };

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
        expect(migrations).toContain(NOME);
        // Até a 0074: o estado do dia anterior, com concessões de `aprovar_destino` para converter.
        for (const arquivo of migrations.filter((f) => f < NOME)) {
            await db.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }
        await db.query(
            `INSERT INTO app_user (username, password_hash, role, role_id)
             SELECT 'ana', 'x', 'admin', id FROM app_role WHERE lower(nome) = 'administrador'`,
        );
        const papel = await db.query(
            `INSERT INTO app_role (nome) VALUES ('Aprovador IT') RETURNING id`,
        );
        await db.query(
            `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, 'sispag:aprovar_destino')`,
            [papel.rows[0].id],
        );
        await db.query(
            `INSERT INTO user_permission (user_id, permission, efeito, concedido_por)
             SELECT id, 'sispag:aprovar_destino', 'conceder', 'adm' FROM app_user WHERE username = 'ana'`,
        );
        await db.query(readFileSync(path.join(__dirname, NOME), 'utf8'));
        // Idempotente: aplicar de novo não quebra nem duplica.
        await db.query(readFileSync(path.join(__dirname, NOME), 'utf8'));
    });

    afterAll(async () => {
        await db?.end();
    });

    it('a trilha recusa UPDATE, DELETE e TRUNCATE', async () => {
        const excecao = await novaConta();
        await db.query(
            `INSERT INTO excecao_destino_audit (id, excecao_id, evento, ator) VALUES ($1, $2, 'CADASTRO', 'ana')`,
            [id(9001), excecao],
        );
        await expect(
            db.query(`UPDATE excecao_destino_audit SET ator = 'x' WHERE id = $1`, [id(9001)]),
        ).rejects.toThrow(/so de inclusao/);
        await expect(
            db.query(`DELETE FROM excecao_destino_audit WHERE id = $1`, [id(9001)]),
        ).rejects.toThrow(/so de inclusao/);
        await expect(db.query('TRUNCATE excecao_destino_audit')).rejects.toThrow(/so de inclusao/);
    });

    it('evento fora dos sete é recusado pelo CHECK', async () => {
        const excecao = await novaConta();
        await expect(
            db.query(
                `INSERT INTO excecao_destino_audit (id, excecao_id, evento, ator) VALUES ($1, $2, 'EDICAO', 'ana')`,
                [id(9002), excecao],
            ),
        ).rejects.toThrow(/check/i);
    });

    it('uma segunda APROVADA para o mesmo (favorecido, tipo) falha; outro tipo ou favorecido passa', async () => {
        await novaConta({ pes: '7100', estado: 'APROVADA' });
        await expect(novaConta({ pes: '7100', estado: 'APROVADA' })).rejects.toThrow(
            /unique|duplicate/i,
        );
        await expect(
            novaConta({ pes: '7100', tipo: 'CHAVE_PIX', estado: 'APROVADA' }),
        ).resolves.toBeDefined();
        await expect(novaConta({ pes: '7101', estado: 'APROVADA' })).resolves.toBeDefined();
        // Substituída/pendente não disputam o índice.
        await expect(novaConta({ pes: '7100', estado: 'SUBSTITUIDA' })).resolves.toBeDefined();
        await expect(novaConta({ pes: '7100' })).resolves.toBeDefined();
    });

    it('o aprovador não pode ser o cadastrante, nem com o estado ainda PENDENTE', async () => {
        await expect(
            novaConta({ pes: '7200', estado: 'APROVADA', por: 'ana', aprovador: 'ana' }),
        ).rejects.toThrow(/excecao_destino_aprovador_check/);
        const pendente = await novaConta({ pes: '7201' });
        await expect(
            db.query(`UPDATE excecao_destino SET aprovado_por = 'ana' WHERE id = $1`, [pendente]),
        ).rejects.toThrow(/excecao_destino_aprovador_check/);
    });

    it('APROVADA sem aprovador é recusada', async () => {
        await expect(
            db.query(
                `INSERT INTO excecao_destino
                    (id, pes_cod, fil_cod, tipo, banco_cod, agencia, conta, conta_dv, titular_documento,
                     estado, justificativa, cadastrado_por)
                 VALUES ($1, '7300', 1, 'CONTA', '237', '1', '1', '1', '11144477735', 'APROVADA', 'j', 'ana')`,
                [id(9003)],
            ),
        ).rejects.toThrow(/excecao_destino_aprovada_check/);
    });

    it('PIX só aceita chave CPF_CNPJ e CONTA não carrega chave', async () => {
        await expect(
            db.query(
                `INSERT INTO excecao_destino
                    (id, pes_cod, fil_cod, tipo, chave_pix_tipo, chave_pix, titular_documento, justificativa, cadastrado_por)
                 VALUES ($1, '7400', 1, 'CHAVE_PIX', 'EMAIL', 'a@b.com', '11144477735', 'j', 'ana')`,
                [id(9004)],
            ),
        ).rejects.toThrow(/excecao_destino_campos_check/);
    });

    it('a concessão de aprovar_destino virou sispag:excecao no papel e no usuário, sem sobra', async () => {
        const papel = await db.query(
            `SELECT p.permission FROM app_role_permission p JOIN app_role r ON r.id = p.role_id
             WHERE r.nome = 'Aprovador IT'`,
        );
        expect(papel.rows.map((r) => r.permission)).toEqual(['sispag:excecao']);
        const usuario = await db.query(
            `SELECT permission, efeito FROM user_permission u JOIN app_user a ON a.id = u.user_id
             WHERE a.username = 'ana'`,
        );
        expect(usuario.rows).toEqual([{ permission: 'sispag:excecao', efeito: 'conceder' }]);
        const antigas = await db.query(
            `SELECT
                (SELECT count(*) FROM app_role_permission WHERE permission = 'sispag:aprovar_destino')::int AS a,
                (SELECT count(*) FROM user_permission WHERE permission = 'sispag:aprovar_destino')::int AS b`,
        );
        expect(antigas.rows[0]).toEqual({ a: 0, b: 0 });
    });

    it('o Administrador tem sispag:excecao uma vez só; o Analista não tem', async () => {
        const r = await db.query(
            `SELECT lower(r.nome) AS nome, count(*)::int AS n
               FROM app_role_permission p JOIN app_role r ON r.id = p.role_id
              WHERE p.permission = 'sispag:excecao' AND lower(r.nome) IN ('administrador', 'analista')
              GROUP BY 1`,
        );
        expect(r.rows).toEqual([{ nome: 'administrador', n: 1 }]);
    });

    it('o CHECK de permission recusa o valor antigo e aceita o novo', async () => {
        const papel = await db.query(
            `INSERT INTO app_role (nome) VALUES ('CHECK IT') RETURNING id`,
        );
        await expect(
            db.query(
                `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, 'sispag:aprovar_destino')`,
                [papel.rows[0].id],
            ),
        ).rejects.toThrow(/check/i);
        await db.query(
            `INSERT INTO app_role_permission (role_id, permission) VALUES ($1, 'sispag:excecao')`,
            [papel.rows[0].id],
        );
    });

    it('o alerta de divergência é aceito pelo CHECK de alerta.tipo', async () => {
        await db.query(
            `INSERT INTO alerta (tipo, alvo, severidade, janela_inicio, dedup_key, detalhe)
             VALUES ('sispag-excecao-divergencia', 'excecao:x', 'aviso', now(), 'k-excecao', '{}'::jsonb)`,
        );
    });
});
