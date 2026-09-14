import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

/**
 * `vw_metricas_ciclo` contra um Postgres DE VERDADE (ADR-0045).
 *
 * Aplica 0001..0058 num banco novo, semeia os dois ledgers e prova o comportamento com um "agora"
 * fixo, chamando `metricas.metricas_ciclo(serie_inicio, agora)` — a view é essa função com a série do
 * ciclo 6 e `now()`. Também conecta COMO o leitor para provar o alcance do role.
 *
 * Não roda no `npm test` (padrão `*.integration.test.ts` do jest.config). Roda no CI, no job
 * `backend-sql` (Postgres 17 como service), e localmente com:
 *
 *   docker run -d --rm --name metricas-ciclo-pg-test -e POSTGRES_PASSWORD=test \
 *     -p 55432:5432 postgres:17-alpine
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 *
 * O DSN precisa ser de superusuário (cria banco e role) e LOCAL — o teste recusa qualquer outro
 * host, porque apaga e recria o banco `metricas_ciclo_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;

// Regis-Review 2026-09-14 (card `testability-1`, P0): as 13 garantias comportamentais não rodavam em
// lugar nenhum automaticamente. No CI, DSN ausente tem que DERRUBAR o job — um `describe.skip` sai
// verde com zero asserts, e é exatamente o defeito que o job existe para fechar.
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'metricas_ciclo_it';
const SERIE = '2026-09-11 20:00:00';
const AGORA = '2026-09-26 10:00:00';
const JANELA_A = { inicio: '2026-09-11 20:00:00', fim: '2026-09-18 20:00:00' };
const JANELA_B = { inicio: '2026-09-18 20:00:00', fim: '2026-09-25 20:00:00' };

interface Linha {
    frente: string;
    metrica: string;
    rotulo: string;
    valor: string;
    unidade: string;
    janela_inicio: string;
    janela_fim: string;
    baseline: string | null;
    baseline_desc: string;
}

const dsnPara = (dsn: string, banco: string, usuario?: string, senha?: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    if (usuario !== undefined) url.username = usuario;
    if (senha !== undefined) url.password = senha;
    return url.toString();
};

const SELECT_LINHAS = `
    SELECT frente, metrica, rotulo, valor::text AS valor, unidade,
           janela_inicio::text AS janela_inicio, janela_fim::text AS janela_fim,
           baseline::text AS baseline, baseline_desc
    FROM metricas.metricas_ciclo($1::timestamp, $2::timestamp)
`;

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('vw_metricas_ciclo — integração', () => {
    let admin: Client;
    let linhas: Linha[];

    const linha = (metrica: string, janelaInicio: string): Linha | undefined =>
        linhas.find((l) => l.metrica === metrica && l.janela_inicio === janelaInicio);

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

        admin = new Client({ connectionString: dsnPara(dsn, BANCO) });
        await admin.connect();

        const migrations = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort();
        expect(migrations[migrations.length - 1]).toBe('0058_vw_metricas_ciclo.sql');
        for (const arquivo of migrations) {
            await admin.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }

        // Borderô 200 cancelado, 300 estornado, 100 vivo — mesma derivação da tela de borderôs.
        await admin.query(`
            INSERT INTO permuta_bordero (bor_cod, fil_cod, bor_vld_finalizado, bor_cod_estornado) VALUES
                (100, 1, 1, NULL),
                (200, 1, 2, NULL),
                (300, 1, 0, 901)
        `);

        // Janela A (sex 11/09 20:00 → sex 18/09 20:00, horário de São Paulo).
        await admin.query(`
            INSERT INTO permuta_alocacao_execucao
                (idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                 bor_cod, valor_baixado, criado_em)
            VALUES
                ('p-antes-serie', 'A0', 'I0', 1, 'settled', false, 100,  777.00, '2026-09-10 10:00:00-03'),
                ('p-inicio-exato','A1', 'I1', 1, 'settled', false, 100, 1000.00, '2026-09-11 20:00:00-03'),
                ('p-cancelado',   'A2', 'I2', 1, 'settled', false, 200,  500.00, '2026-09-15 10:00:00-03'),
                ('p-estornado',   'A3', 'I3', 1, 'settled', false, 300,  400.00, '2026-09-15 11:00:00-03'),
                ('p-erro',        'A4', 'I4', 1, 'error',   false, NULL,   NULL, '2026-09-16 10:00:00-03'),
                ('p-parcial',     'A5', 'I5', 1, 'parcial', false, 100,  300.00, '2026-09-17 10:00:00-03'),
                ('p-dry-run',     'A6', 'I6', 1, 'settled', true,  100, 9999.00, '2026-09-17 11:00:00-03'),
                ('p-utc-na-A',    'A7', 'I7', 1, 'error',   false, NULL,   NULL, '2026-09-18 22:30:00+00'),
                ('p-fim-A',       'A8', 'I8', 1, 'settled', false, 100,   50.00, '2026-09-18 19:59:59-03'),
                ('p-inicio-B',    'A9', 'I9', 1, 'settled', false, 100,   70.00, '2026-09-18 20:00:00-03'),
                ('p-aberta',      'AX', 'IX', 1, 'settled', false, 100,    5.00, '2026-09-25 21:00:00-03')
        `);

        await admin.query(`
            INSERT INTO solicitacao_numerario_execucao
                (idempotency_key, fil_cod, pri_cod, status, dry_run, valor, criado_em)
            VALUES
                ('s-ok',      2, 10, 'settled', false,  200.00, '2026-09-14 09:00:00-03'),
                ('s-erro',    2, 11, 'error',   false,  100.00, '2026-09-14 10:00:00-03'),
                ('s-dry-run', 2, 12, 'settled', true,  5000.00, '2026-09-14 11:00:00-03')
        `);

        linhas = (await admin.query<Linha>(SELECT_LINHAS, [SERIE, AGORA])).rows;
    });

    afterAll(async () => {
        await admin?.end();
    });

    it('emite só janelas fechadas a partir da série — nem antes, nem a semana em curso', () => {
        const janelas = [
            ...new Set(linhas.map((l) => `${l.janela_inicio}→${l.janela_fim}`)),
        ].sort();

        expect(janelas).toEqual([
            `${JANELA_A.inicio}→${JANELA_A.fim}`,
            `${JANELA_B.inicio}→${JANELA_B.fim}`,
        ]);
    });

    it('Permutas: concluídas ÷ tentativas, com o absoluto no rótulo', () => {
        // Tentativas A: início-exato, cancelado, estornado, erro, parcial, utc-na-A, fim-A = 7.
        // Concluídas A: início-exato, fim-A = 2 (cancelado/estornado desfeitos; parcial não conclui).
        expect(linha('permutas_baixas_concluidas_pct', JANELA_A.inicio)).toEqual({
            frente: 'Permutas (Frente I)',
            metrica: 'permutas_baixas_concluidas_pct',
            rotulo: 'baixas de adiantamento concluídas sem erro — 2 de 7 tentativas',
            valor: '28.6',
            unidade: '%',
            janela_inicio: JANELA_A.inicio,
            janela_fim: JANELA_A.fim,
            baseline: null,
            baseline_desc: 'sem medição do processo manual',
        });
    });

    it('Permutas: R$ soma settled e parcial que ficaram de pé; ignora dry-run e borderô desfeito', () => {
        expect(linha('permutas_valor_baixado', JANELA_A.inicio)).toMatchObject({
            valor: '1350.00',
            unidade: 'R$',
            rotulo: 'valor baixado em permutas de adiantamento',
        });
    });

    it('fronteira: 19:59:59 de sexta fica na semana anterior, 20:00:00 abre a seguinte', () => {
        expect(linha('permutas_baixas_concluidas_pct', JANELA_B.inicio)).toMatchObject({
            valor: '100.0',
            rotulo: 'baixas de adiantamento concluídas sem erro — 1 de 1 tentativas',
        });
        expect(linha('permutas_valor_baixado', JANELA_B.inicio)?.valor).toBe('70.00');
    });

    it('Recebimentos: taxa e R$ da trilha da SN, sem dry-run', () => {
        expect(linha('recebimentos_alocacoes_concluidas_pct', JANELA_A.inicio)).toMatchObject({
            frente: 'Conciliação de Recebimentos (Frente IV)',
            valor: '50.0',
            rotulo: 'créditos de cliente alocados até a NDe sem erro — 1 de 2 tentativas',
        });
        expect(linha('recebimentos_valor_alocado', JANELA_A.inicio)?.valor).toBe('200.00');
    });

    it('semana sem tentativa: nenhum % (nunca 0/0), R$ zero', () => {
        expect(linha('recebimentos_alocacoes_concluidas_pct', JANELA_B.inicio)).toBeUndefined();
        expect(linha('recebimentos_valor_alocado', JANELA_B.inicio)?.valor).toBe('0.00');
    });

    it('o SELECT do metrics.py acha a janela com hora, e nenhuma com data sem hora', async () => {
        const filtro = `SELECT * FROM (${SELECT_LINHAS}) m
                        WHERE janela_inicio::timestamp >= $3 AND janela_fim::timestamp <= $4`;

        const comHora = await admin.query(filtro, [
            SERIE,
            AGORA,
            '2026-09-11T20:00:00',
            '2026-09-18T20:00:00',
        ]);
        const soData = await admin.query(filtro, [SERIE, AGORA, '2026-09-11', '2026-09-18']);

        expect(comHora.rows).toHaveLength(4);
        expect(soData.rows).toHaveLength(0);
    });

    it('a view é a função com a série do ciclo 6 e o agora de São Paulo', async () => {
        const view = await admin.query('SELECT * FROM metricas.vw_metricas_ciclo ORDER BY 1, 2, 6');
        const funcao = await admin.query(
            `SELECT * FROM metricas.metricas_ciclo($1::timestamp, (now() AT TIME ZONE 'America/Sao_Paulo'))
             ORDER BY 1, 2, 6`,
            [SERIE],
        );

        expect(view.rows).toEqual(funcao.rows);
    });

    it('reaplicar a migration é no-op', async () => {
        const sql = readFileSync(path.join(__dirname, '0058_vw_metricas_ciclo.sql'), 'utf8');

        await expect(admin.query(sql)).resolves.toBeDefined();
    });

    describe('como o role leitor', () => {
        let leitor: Client;

        beforeAll(async () => {
            // Simula o passo humano do cabeçalho da migration.
            await admin.query(
                `ALTER ROLE metricas_ciclo_leitor WITH LOGIN PASSWORD 'leitor-teste'`,
            );
            leitor = new Client({
                connectionString: dsnPara(
                    ADMIN_DSN ?? '',
                    BANCO,
                    'metricas_ciclo_leitor',
                    'leitor-teste',
                ),
            });
            await leitor.connect();
        });

        afterAll(async () => {
            await leitor?.end();
            await admin.query('ALTER ROLE metricas_ciclo_leitor WITH NOLOGIN PASSWORD NULL');
        });

        it('lê `vw_metricas_ciclo` sem qualificar o schema, como o metrics.py faz', async () => {
            await expect(
                leitor.query(
                    'SELECT frente, metrica, rotulo, valor, unidade, janela_inicio, janela_fim, baseline, baseline_desc FROM vw_metricas_ciclo',
                ),
            ).resolves.toBeDefined();
        });

        it('não lê as tabelas de origem', async () => {
            await expect(
                leitor.query('SELECT 1 FROM public.permuta_alocacao_execucao'),
            ).rejects.toThrow(/permission denied/);
            await expect(
                leitor.query('SELECT 1 FROM public.solicitacao_numerario_execucao'),
            ).rejects.toThrow(/permission denied/);
        });

        it('não recua a série chamando a função', async () => {
            await expect(
                leitor.query(`SELECT * FROM metricas.metricas_ciclo('2026-01-01', '2026-09-26')`),
            ).rejects.toThrow(/permission denied/);
        });

        it('não escreve', async () => {
            await expect(leitor.query('CREATE TABLE metricas.x (a int)')).rejects.toThrow(
                /read-only transaction|permission denied/,
            );
        });
    });
});
