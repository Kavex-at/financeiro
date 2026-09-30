import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import SqlBuilder from '../domain/libs/sql/SqlBuilder.js';
import MetricasCicloRepository from '../domain/repository/metricas/MetricasCicloRepository.js';

/**
 * `vw_metricas_ciclo` contra um Postgres DE VERDADE (ADR-0045).
 *
 * Aplica 0001..0058 num banco novo, semeia os dois ledgers e prova o comportamento com um "agora"
 * fixo, chamando `metricas.metricas_ciclo(serie_inicio, agora)` — a view é essa função com a série do
 * ciclo 6 e `now()`. Quem lê em produção é a aplicação (`GET /metricas/ciclo`), sem role dedicado.
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
const SERIE = '2026-09-11 18:00:00';
/** Piso do histórico da tela (ADR-0048) — cinco semanas antes da série, na MESMA grade de sexta. */
const HISTORICO = '2026-08-07 18:00:00';
const AGORA = '2026-09-26 10:00:00';
const JANELA_A = { inicio: '2026-09-11 18:00:00', fim: '2026-09-18 18:00:00' };
const JANELA_B = { inicio: '2026-09-18 18:00:00', fim: '2026-09-25 18:00:00' };
/** Semana EM CURSO no `AGORA` do teste: começou sexta 25/09 18:00 e fecharia sexta 02/10 18:00. */
const JANELA_C = { inicio: '2026-09-25 18:00:00', fim: '2026-10-02 18:00:00' };

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
    parcial: boolean;
    apurado_ate: string;
}

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const SELECT_LINHAS = `
    SELECT frente, metrica, rotulo, valor::text AS valor, unidade,
           janela_inicio::text AS janela_inicio, janela_fim::text AS janela_fim,
           baseline::text AS baseline, baseline_desc, parcial, apurado_ate::text AS apurado_ate
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
        expect(migrations).toContain('0058_vw_metricas_ciclo.sql');
        expect(migrations).toContain('0060_metricas_historico_inicio.sql');
        expect(migrations).toContain('0065_metricas_ciclo_data_pelo_encerramento.sql');
        for (const arquivo of migrations) {
            await admin.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }

        // Mesma derivação da tela de borderôs. Só o 100 (FINALIZADO) conclui (gap G2, 2026-09-14):
        // 200 cancelado, 300 estornado, 400 em cadastro; o 500 não existe no cache.
        await admin.query(`
            INSERT INTO permuta_bordero (bor_cod, fil_cod, bor_vld_finalizado, bor_cod_estornado) VALUES
                (100, 1, 1, NULL),
                (200, 1, 2, NULL),
                (300, 1, 0, 901),
                (400, 1, 0, NULL)
        `);

        // Janela A (sex 11/09 18:00 → sex 18/09 18:00, horário de São Paulo).
        await admin.query(`
            INSERT INTO permuta_alocacao_execucao
                (idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                 bor_cod, valor_baixado, criado_em)
            VALUES
                ('p-antes-serie', 'A0', 'I0', 1, 'settled', false, 100,  777.00, '2026-09-10 10:00:00-03'),
                ('p-inicio-exato','A1', 'I1', 1, 'settled', false, 100, 1000.00, '2026-09-11 18:00:00-03'),
                ('p-cancelado',   'A2', 'I2', 1, 'settled', false, 200,  500.00, '2026-09-15 10:00:00-03'),
                ('p-estornado',   'A3', 'I3', 1, 'settled', false, 300,  400.00, '2026-09-15 11:00:00-03'),
                ('p-em-cadastro', 'AC', 'IC', 1, 'settled', false, 400,  250.00, '2026-09-15 12:00:00-03'),
                ('p-parc-cadast', 'AD', 'ID', 1, 'parcial', false, 400,   80.00, '2026-09-15 13:00:00-03'),
                ('p-sem-cache',   'AE', 'IE', 1, 'settled', false, 500,  120.00, '2026-09-15 14:00:00-03'),
                ('p-erro',        'A4', 'I4', 1, 'error',   false, NULL,   NULL, '2026-09-16 10:00:00-03'),
                ('p-parcial',     'A5', 'I5', 1, 'parcial', false, 100,  300.00, '2026-09-17 10:00:00-03'),
                ('p-dry-run',     'A6', 'I6', 1, 'settled', true,  100, 9999.00, '2026-09-17 11:00:00-03'),
                ('p-utc-na-A',    'A7', 'I7', 1, 'error',   false, NULL,   NULL, '2026-09-18 20:30:00+00'),
                ('p-fim-A',       'A8', 'I8', 1, 'settled', false, 100,   50.00, '2026-09-18 17:59:59-03'),
                ('p-inicio-B',    'A9', 'I9', 1, 'settled', false, 100,   70.00, '2026-09-18 18:00:00-03'),
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

    it('emite as semanas desde a série — nada antes dela — e a em curso marcada como parcial', () => {
        const janelas = [
            ...new Set(linhas.map((l) => `${l.janela_inicio}→${l.janela_fim}→${l.parcial}`)),
        ].sort();

        expect(janelas).toEqual([
            `${JANELA_A.inicio}→${JANELA_A.fim}→false`,
            `${JANELA_B.inicio}→${JANELA_B.fim}→false`,
            `${JANELA_C.inicio}→${JANELA_C.fim}→true`,
        ]);
    });

    it('semana em curso: número apurado até o agora, com o horário de corte na linha', () => {
        // Só `p-aberta` (settled, borderô 100 finalizado, R$ 5) caiu na semana C até o AGORA.
        expect(linha('permutas_baixas_concluidas_pct', JANELA_C.inicio)).toMatchObject({
            valor: '100.0',
            rotulo: 'baixas de adiantamento concluídas, com borderô finalizado — 1 de 1 tentativas',
            parcial: true,
            apurado_ate: AGORA,
        });
        expect(linha('permutas_valor_baixado', JANELA_C.inicio)).toMatchObject({
            valor: '5.00',
            parcial: true,
            apurado_ate: AGORA,
        });
        expect(linha('recebimentos_valor_alocado', JANELA_C.inicio)).toMatchObject({
            valor: '0.00',
            parcial: true,
        });
    });

    it('semana fechada: apurada até o próprio fim, nunca parcial', () => {
        for (const l of linhas.filter((x) => x.janela_inicio !== JANELA_C.inicio)) {
            expect(l.parcial).toBe(false);
            expect(l.apurado_ate).toBe(l.janela_fim);
        }
    });

    it('lida exatamente no instante em que a semana fecha, não abre uma semana vazia', async () => {
        const { rows } = await admin.query<Linha>(SELECT_LINHAS, [SERIE, JANELA_B.fim]);

        expect(new Set(rows.map((r) => r.janela_inicio))).toEqual(
            new Set([JANELA_A.inicio, JANELA_B.inicio]),
        );
        expect(rows.every((r) => !r.parcial)).toBe(true);
    });

    it('Permutas: concluídas ÷ tentativas, com o absoluto no rótulo', () => {
        // Tentativas A: início-exato, cancelado, estornado, em-cadastro, parc-cadast, sem-cache, erro,
        // parcial, utc-na-A, fim-A = 10.
        // Concluídas A: início-exato, fim-A = 2. Cancelado, estornado, em cadastro e sem cache não
        // concluem (G2); parcial nunca conclui.
        expect(linha('permutas_baixas_concluidas_pct', JANELA_A.inicio)).toEqual({
            frente: 'Permutas (Frente I)',
            metrica: 'permutas_baixas_concluidas_pct',
            rotulo: 'baixas de adiantamento concluídas, com borderô finalizado — 2 de 10 tentativas',
            valor: '20.0',
            unidade: '%',
            janela_inicio: JANELA_A.inicio,
            janela_fim: JANELA_A.fim,
            baseline: null,
            baseline_desc: 'sem medição do processo manual',
            parcial: false,
            apurado_ate: JANELA_A.fim,
        });
    });

    it('Permutas: R$ soma settled e parcial de borderô finalizado; ignora dry-run e o resto', () => {
        // 1000 (início-exato) + 300 (parcial, borderô 100) + 50 (fim-A). Fora: cancelado 500,
        // estornado 400, em cadastro 250 + 80, sem cache 120, dry-run 9999.
        expect(linha('permutas_valor_baixado', JANELA_A.inicio)).toMatchObject({
            valor: '1350.00',
            unidade: 'R$',
            rotulo: 'valor baixado em permutas de adiantamento',
        });
    });

    it('fronteira: 17:59:59 de sexta fica na semana anterior, 18:00:00 abre a seguinte', () => {
        expect(linha('permutas_baixas_concluidas_pct', JANELA_B.inicio)).toMatchObject({
            valor: '100.0',
            rotulo: 'baixas de adiantamento concluídas, com borderô finalizado — 1 de 1 tentativas',
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
            '2026-09-11T18:00:00',
            '2026-09-18T18:00:00',
        ]);
        const soData = await admin.query(filtro, [SERIE, AGORA, '2026-09-11', '2026-09-18']);

        // 2 de Permutas + 2 de Recebimentos + o R$ do SISPAG, emitido em toda semana (0070).
        expect(comHora.rows).toHaveLength(5);
        expect(soData.rows).toHaveLength(0);
    });

    it('a view é a função só com as semanas fechadas e as 9 colunas do contrato', async () => {
        const view = await admin.query('SELECT * FROM metricas.vw_metricas_ciclo ORDER BY 1, 2, 6');
        const funcao = await admin.query(
            `SELECT frente, metrica, rotulo, valor, unidade, janela_inicio, janela_fim, baseline, baseline_desc
               FROM metricas.metricas_ciclo(metricas.serie_inicio(), (now() AT TIME ZONE 'America/Sao_Paulo'))
              WHERE NOT parcial
             ORDER BY 1, 2, 6`,
        );

        expect(view.fields.map((f) => f.name)).toEqual([
            'frente',
            'metrica',
            'rotulo',
            'valor',
            'unidade',
            'janela_inicio',
            'janela_fim',
            'baseline',
            'baseline_desc',
        ]);

        expect(view.rows).toEqual(funcao.rows);
    });

    it('reaplicar a migration é no-op', async () => {
        // Numa transação desfeita: o backfill da 0065 carimbaria `encerrado_em = atualizado_em` (o
        // instante do seed) nas linhas semeadas sem carimbo, e os casos seguintes perderiam a semana.
        await admin.query('BEGIN');
        try {
            for (const arquivo of [
                '0058_vw_metricas_ciclo.sql',
                '0065_metricas_ciclo_data_pelo_encerramento.sql',
                '0070_metricas_ciclo_sispag.sql',
            ]) {
                const sql = readFileSync(path.join(__dirname, arquivo), 'utf8');
                await expect(admin.query(sql)).resolves.toBeDefined();
            }
        } finally {
            await admin.query('ROLLBACK');
        }
    });

    it('o repositório da API roda contra o banco real: SQL, casts e formato de data', async () => {
        const builder = new SqlBuilder();
        const db = {
            selectMany: async (sql: string, params: Record<string, unknown>) => {
                const { query, params: valores } = builder.build(sql, params);
                return (await admin.query(query, valores)).rows;
            },
            selectFirst: async (sql: string) => (await admin.query(sql)).rows[0] ?? null,
        };
        const repository = new MetricasCicloRepository(db as never);

        await expect(repository.serieInicio()).resolves.toBe('2026-09-11T18:00:00');
        // Nenhuma janela termina antes de 2026-09-18 18:00: o filtro com `fim` precisa rodar e vir vazio.
        await expect(repository.listar({ fim: '2026-09-11T18:00:00' })).resolves.toEqual([]);
        for (const linha of await repository.listar({})) {
            expect(linha.janela_inicio).toMatch(/^\d{4}-\d{2}-\d{2}T18:00:00$/);
            expect(linha.apurado_ate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
            expect(typeof linha.parcial).toBe('boolean');
        }
    });

    it('a série vigente vem de `metricas.serie_inicio()` — ciclo 6', async () => {
        const { rows } = await admin.query<{ serie: string }>(
            'SELECT metricas.serie_inicio()::text AS serie',
        );

        expect(rows[0].serie).toBe(SERIE);
    });

    // --- Data pelo encerramento (ADR-0052) ---
    //
    // Cada caso roda numa transação desfeita no fim: as linhas semeadas acima (todas com
    // `encerrado_em` NULL, logo datadas pelo `criado_em`) e as asserções delas não mudam.

    const emTransacao = async <T>(fn: () => Promise<T>): Promise<T> => {
        await admin.query('BEGIN');
        try {
            return await fn();
        } finally {
            await admin.query('ROLLBACK');
        }
    };

    const linhasDoHistorico = async (): Promise<Linha[]> =>
        (await admin.query<Linha>(SELECT_LINHAS, [HISTORICO, AGORA])).rows;

    const doHistorico = (ls: Linha[], metrica: string, janelaInicio: string): Linha | undefined =>
        ls.find((l) => l.metrica === metrica && l.janela_inicio === janelaInicio);

    it('retentativa conta na semana em que liquidou, não na da 1ª tentativa', async () => {
        // O caso real (id 341): nasceu 10/08, falhou, foi reexecutada e liquidou 14/09 12:43.
        const ls = await emTransacao(async () => {
            await admin.query(`
                INSERT INTO permuta_alocacao_execucao
                    (idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status,
                     dry_run, bor_cod, valor_baixado, criado_em, encerrado_em)
                VALUES ('p-retentativa', 'R1', 'R1', 1, 'settled', false, 100, 150061.81,
                        '2026-08-10 09:00:00-03', '2026-09-14 12:43:00-03')
            `);
            return linhasDoHistorico();
        });

        // Semana A: 1350 do seed + 150.061,81; 3 de 11 tentativas.
        expect(doHistorico(ls, 'permutas_valor_baixado', JANELA_A.inicio)?.valor).toBe('151411.81');
        expect(doHistorico(ls, 'permutas_baixas_concluidas_pct', JANELA_A.inicio)?.rotulo).toBe(
            'baixas de adiantamento concluídas, com borderô finalizado — 3 de 11 tentativas',
        );
        // A semana de 07/08 → 14/08, onde ela nasceu, não a vê.
        expect(doHistorico(ls, 'permutas_valor_baixado', '2026-08-07 18:00:00')?.valor).toBe(
            '0.00',
        );
        expect(
            doHistorico(ls, 'permutas_baixas_concluidas_pct', '2026-08-07 18:00:00'),
        ).toBeUndefined();
    });

    it('SN reexecutada também conta na semana do encerramento', async () => {
        const ls = await emTransacao(async () => {
            await admin.query(`
                INSERT INTO solicitacao_numerario_execucao
                    (idempotency_key, fil_cod, pri_cod, status, dry_run, valor, criado_em, encerrado_em)
                VALUES ('s-retentativa', 2, 13, 'settled', false, 300.00,
                        '2026-08-20 09:00:00-03', '2026-09-16 15:00:00-03')
            `);
            return linhasDoHistorico();
        });

        expect(doHistorico(ls, 'recebimentos_valor_alocado', JANELA_A.inicio)?.valor).toBe(
            '500.00',
        );
        expect(doHistorico(ls, 'recebimentos_valor_alocado', '2026-08-14 18:00:00')?.valor).toBe(
            '0.00',
        );
    });

    it('re-clique depois de liquidar (só `atualizado_em` anda) não muda a semana', async () => {
        const ls = await emTransacao(async () => {
            await admin.query(`
                INSERT INTO permuta_alocacao_execucao
                    (idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status,
                     dry_run, bor_cod, valor_baixado, criado_em, encerrado_em, atualizado_em)
                VALUES ('p-reclique', 'R2', 'R2', 1, 'settled', false, 100, 10.00,
                        '2026-09-12 09:00:00-03', '2026-09-12 09:05:00-03', '2026-09-20 10:00:00-03')
            `);
            return linhasDoHistorico();
        });

        expect(doHistorico(ls, 'permutas_valor_baixado', JANELA_A.inicio)?.valor).toBe('1360.00');
        expect(doHistorico(ls, 'permutas_valor_baixado', JANELA_B.inicio)?.valor).toBe('70.00');
    });

    it('backfill da 0065: permuta terminal ganha encerrado_em = atualizado_em; em voo e SN seguem NULL', async () => {
        const linhas0065 = await emTransacao(async () => {
            await admin.query(`
                INSERT INTO permuta_alocacao_execucao
                    (idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status,
                     dry_run, criado_em, atualizado_em)
                VALUES
                    ('b-settled', 'B1', 'B1', 1, 'settled',     false, '2026-07-03 09:00-03', '2026-08-14 11:00-03'),
                    ('b-erro',    'B2', 'B2', 1, 'error',       false, '2026-07-03 09:00-03', '2026-07-04 11:00-03'),
                    ('b-em-voo',  'B3', 'B3', 1, 'reconciling', false, '2026-07-03 09:00-03', '2026-07-03 09:01-03')
            `);
            await admin.query(`
                INSERT INTO solicitacao_numerario_execucao
                    (idempotency_key, fil_cod, pri_cod, status, dry_run, valor, criado_em, atualizado_em)
                VALUES ('b-sn', 2, 99, 'settled', false, 1.00, '2026-08-03 18:54-03', '2026-08-17 18:15-03')
            `);
            await admin.query(
                readFileSync(
                    path.join(__dirname, '0065_metricas_ciclo_data_pelo_encerramento.sql'),
                    'utf8',
                ),
            );
            return (
                await admin.query<{ k: string; igual: boolean | null }>(`
                    SELECT idempotency_key AS k, encerrado_em = atualizado_em AS igual
                      FROM permuta_alocacao_execucao
                     WHERE idempotency_key LIKE 'b-%'
                    UNION ALL
                    SELECT idempotency_key, encerrado_em = atualizado_em
                      FROM solicitacao_numerario_execucao
                     WHERE idempotency_key LIKE 'b-%'
                     ORDER BY 1
                `)
            ).rows;
        });

        expect(linhas0065).toEqual([
            { k: 'b-em-voo', igual: null },
            { k: 'b-erro', igual: true },
            { k: 'b-settled', igual: true },
            // SN sem backfill: o `atualizado_em` dela foi reescrito em lote em 17/08 (ADR-0052, D3).
            { k: 'b-sn', igual: null },
        ]);
    });

    it('a 0065 não altera o contrato: mesmas 11 colunas, e a view segue com as 9', async () => {
        const { fields } = await admin.query(`${SELECT_LINHAS} LIMIT 0`, [SERIE, AGORA]);
        expect(fields.map((f) => f.name)).toEqual([
            'frente',
            'metrica',
            'rotulo',
            'valor',
            'unidade',
            'janela_inicio',
            'janela_fim',
            'baseline',
            'baseline_desc',
            'parcial',
            'apurado_ate',
        ]);
    });

    // --- O piso do histórico (ADR-0048) ---

    it('o piso do histórico vem de `metricas.historico_inicio()` — 2026-08-07 18:00', async () => {
        const { rows } = await admin.query<{ piso: string }>(
            'SELECT metricas.historico_inicio()::text AS piso',
        );

        expect(rows[0].piso).toBe(HISTORICO);
    });

    /**
     * O invariante que torna o recuo seguro (ADR-0048, D2). Se os dois pisos não caíssem no mesmo
     * ponto da grade semanal, recuar a tela rebateria toda janela já fechada — e todo número que o
     * report já publicou mudaria de valor. Aqui isso é PROVADO contra o Postgres, não argumentado:
     * as linhas das janelas comuns aos dois pisos têm que ser idênticas, campo a campo.
     */
    it('recuar o piso não move uma vírgula das janelas que já existiam', async () => {
        const doPiso = async (piso: string): Promise<Linha[]> =>
            (
                await admin.query<Linha>(
                    `SELECT * FROM metricas.metricas_ciclo($1::timestamp, $2::timestamp)
                      ORDER BY janela_inicio, frente, metrica`,
                    [piso, AGORA],
                )
            ).rows;

        const serie = await doPiso(SERIE);
        const historico = await doPiso(HISTORICO);

        const janelasDaSerie = new Set(serie.map((l) => String(l.janela_inicio)));
        const sobrepostas = historico.filter((l) => janelasDaSerie.has(String(l.janela_inicio)));

        expect(sobrepostas).toEqual(serie);
    });

    it('o recuo acrescenta exatamente cinco janelas, e só à frente da série', async () => {
        const janelas = async (piso: string): Promise<string[]> =>
            (
                await admin.query<{ janela_inicio: string }>(
                    `SELECT DISTINCT janela_inicio
                       FROM metricas.metricas_ciclo($1::timestamp, $2::timestamp)
                      ORDER BY janela_inicio`,
                    [piso, AGORA],
                )
            ).rows.map((r) => String(r.janela_inicio));

        const daSerie = await janelas(SERIE);
        const doHistorico = await janelas(HISTORICO);

        expect(doHistorico).toHaveLength(daSerie.length + 5);
        // As da série continuam lá, na mesma ordem, no fim da lista.
        expect(doHistorico.slice(5)).toEqual(daSerie);
    });

    it('a VIEW continua ancorada no ciclo 6 — o report não ganha agosto', async () => {
        const { rows } = await admin.query<{ janela_inicio: string }>(
            'SELECT DISTINCT janela_inicio FROM metricas.vw_metricas_ciclo ORDER BY janela_inicio',
        );

        for (const r of rows) {
            expect(new Date(r.janela_inicio).getTime()).toBeGreaterThanOrEqual(
                new Date(`${SERIE}Z`).getTime(),
            );
        }
    });

    it('o repositório com `historico` lê o piso recuado, e sem ele lê a série', async () => {
        const builder = new SqlBuilder();
        const db = {
            selectMany: async (sql: string, params: Record<string, unknown>) => {
                const { query, params: valores } = builder.build(sql, params);
                return (await admin.query(query, valores)).rows;
            },
            selectFirst: async (sql: string) => (await admin.query(sql)).rows[0] ?? null,
        };
        const repository = new MetricasCicloRepository(db as never);

        await expect(repository.serieInicio(true)).resolves.toBe('2026-08-07T18:00:00');
        await expect(repository.serieInicio()).resolves.toBe('2026-09-11T18:00:00');

        const comHistorico = await repository.listar({ historico: true });
        const semHistorico = await repository.listar({});

        expect(comHistorico.length).toBeGreaterThan(semHistorico.length);
        // A janela de agosto existe no recuado e não existe na série.
        expect(comHistorico.some((l) => l.janela_inicio.startsWith('2026-08-07'))).toBe(true);
        expect(semHistorico.some((l) => l.janela_inicio.startsWith('2026-08'))).toBe(false);
    });

    // --- SISPAG (Frente II), ADR-0056 ---
    //
    // Numa transação desfeita, como os casos da ADR-0052: o seed acima não tem SISPAG, e as
    // asserções de Permutas/Recebimentos não podem depender destes lotes.

    const semearSispag = async (): Promise<void> => {
        await admin.query(`
            INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES
                ('00000000-0000-0000-0000-00000000a001', 2, 'REMESSA_GERADA', 't'),
                ('00000000-0000-0000-0000-00000000a002', 2, 'CANCELADO',      't'),
                ('00000000-0000-0000-0000-00000000a003', 2, 'REMESSA_GERADA', 't'),
                ('00000000-0000-0000-0000-00000000a004', 2, 'FINALIZADO',     't'),
                ('00000000-0000-0000-0000-00000000a005', 1, 'BAIXADO',        't')
        `);
        await admin.query(`
            INSERT INTO lote_pagamento_item
                (lote_id, fil_cod, doc_cod, tit_cod, credor, valor, incluido_por, situacao)
            VALUES
                ('00000000-0000-0000-0000-00000000a001', 2, 'D1', '1', 'c',  275.00, 't', 'AGENDADO'),
                ('00000000-0000-0000-0000-00000000a001', 2, 'D2', '1', 'c', 1856.16, 't', 'PAGO'),
                ('00000000-0000-0000-0000-00000000a001', 2, 'D3', '1', 'c',  100.00, 't', 'REJEITADO'),
                ('00000000-0000-0000-0000-00000000a001', 2, 'D4', '1', 'c',   50.00, 't', 'SEM_RETORNO'),
                ('00000000-0000-0000-0000-00000000a001', 2, 'D5', '1', 'c',   25.00, 't', NULL),
                ('00000000-0000-0000-0000-00000000a002', 2, 'D6', '1', 'c', 9999.00, 't', 'AGENDADO'),
                ('00000000-0000-0000-0000-00000000a003', 2, 'D7', '1', 'c', 8888.00, 't', 'PAGO'),
                ('00000000-0000-0000-0000-00000000a004', 2, 'D8', '1', 'c', 7777.00, 't', 'AGENDADO'),
                ('00000000-0000-0000-0000-00000000a005', 1, 'D9', '1', 'c',   10.00, 't', 'PAGO')
        `);
        await admin.query(`
            INSERT INTO remessa_execucao
                (idempotency_key, lote_id, fil_cod, bnc_cod, status, dry_run, criado_em, encerrado_em)
            VALUES
                -- Nasceu antes da série e encerrou na semana B: vale o encerramento.
                ('r-real',     '00000000-0000-0000-0000-00000000a001', 2, 341, 'settled', false,
                 '2026-09-10 10:00:00-03', '2026-09-23 16:08:00-03'),
                ('r-cancelado','00000000-0000-0000-0000-00000000a002', 2, 341, 'settled', false,
                 '2026-09-21 10:00:00-03', '2026-09-21 10:00:05-03'),
                ('r-dry-run',  '00000000-0000-0000-0000-00000000a003', 2, 341, 'settled', true,
                 '2026-09-21 11:00:00-03', '2026-09-21 11:00:05-03'),
                ('r-erro',     '00000000-0000-0000-0000-00000000a004', 2, 341, 'error',   false,
                 '2026-09-21 12:00:00-03', '2026-09-21 12:00:05-03'),
                -- Duas execuções settled do mesmo lote: o título conta UMA vez, na semana da 1ª.
                ('r-dupla-1',  '00000000-0000-0000-0000-00000000a005', 1, 341, 'settled', false,
                 '2026-09-17 10:00:00-03', '2026-09-17 10:00:05-03'),
                ('r-dupla-2',  '00000000-0000-0000-0000-00000000a005', 1, 341, 'settled', false,
                 '2026-09-25 20:00:00-03', '2026-09-25 20:00:05-03')
        `);
    };

    it('SISPAG: aceitos (AGENDADO + PAGO) ÷ títulos enviados, com os aguardando no rótulo', async () => {
        const ls = await emTransacao(async () => {
            await semearSispag();
            return (await admin.query<Linha>(SELECT_LINHAS, [SERIE, AGORA])).rows;
        });
        const achar = (metrica: string, janela: string) =>
            ls.find((l) => l.metrica === metrica && l.janela_inicio === janela);

        // Semana B: só o lote real. REJEITADO conta no denominador; NULL e SEM_RETORNO aguardam.
        // Fora: cancelado 9999, dry-run 8888, só-erro 7777.
        expect(achar('sispag_titulos_aceitos_pct', JANELA_B.inicio)).toEqual({
            frente: 'SISPAG (Frente II)',
            metrica: 'sispag_titulos_aceitos_pct',
            rotulo: 'títulos aceitos pelo banco em remessa gerada — 2 de 5 títulos, 2 aguardando retorno',
            valor: '40.0',
            unidade: '%',
            janela_inicio: JANELA_B.inicio,
            janela_fim: JANELA_B.fim,
            baseline: null,
            baseline_desc: 'sem medição do processo manual',
            parcial: false,
            apurado_ate: JANELA_B.fim,
        });
        expect(achar('sispag_valor_aceito', JANELA_B.inicio)).toMatchObject({
            valor: '2131.16',
            unidade: 'R$',
            rotulo: 'valor de títulos aceitos pelo banco',
        });

        // Semana A: o lote de duas execuções, contado uma vez, na da 1ª.
        expect(achar('sispag_titulos_aceitos_pct', JANELA_A.inicio)).toMatchObject({
            valor: '100.0',
            rotulo: 'títulos aceitos pelo banco em remessa gerada — 1 de 1 títulos, 0 aguardando retorno',
        });
        expect(achar('sispag_valor_aceito', JANELA_A.inicio)?.valor).toBe('10.00');

        // Semana C: a 2ª execução do lote duplo NÃO recontou. Sem título, sem % (nunca 0/0); R$ zero.
        expect(achar('sispag_titulos_aceitos_pct', JANELA_C.inicio)).toBeUndefined();
        expect(achar('sispag_valor_aceito', JANELA_C.inicio)).toMatchObject({
            valor: '0.00',
            parcial: true,
        });
    });

    it('SISPAG: aceite que chega depois recalcula a semana da GERAÇÃO', async () => {
        const [antes, depois] = await emTransacao(async () => {
            await semearSispag();
            const a = (await admin.query<Linha>(SELECT_LINHAS, [SERIE, AGORA])).rows;
            await admin.query(
                `UPDATE lote_pagamento_item SET situacao = 'AGENDADO'
                  WHERE lote_id = '00000000-0000-0000-0000-00000000a001' AND situacao IS NULL`,
            );
            const d = (await admin.query<Linha>(SELECT_LINHAS, [SERIE, AGORA])).rows;
            return [a, d];
        });
        const pct = (ls: Linha[]) =>
            ls.find(
                (l) =>
                    l.metrica === 'sispag_titulos_aceitos_pct' &&
                    l.janela_inicio === JANELA_B.inicio,
            );

        expect(pct(antes)?.valor).toBe('40.0');
        expect(pct(depois)).toMatchObject({
            valor: '60.0',
            rotulo: 'títulos aceitos pelo banco em remessa gerada — 3 de 5 títulos, 1 aguardando retorno',
        });
    });

    it('SISPAG não move uma vírgula de Permutas nem de Recebimentos', async () => {
        const outras = (ls: Linha[]) => ls.filter((l) => !l.metrica.startsWith('sispag_'));
        const com = await emTransacao(async () => {
            await semearSispag();
            return (await admin.query<Linha>(SELECT_LINHAS, [SERIE, AGORA])).rows;
        });

        expect(outras(com)).toEqual(outras(linhas));
    });

    it('backfill da 0070: remessa terminal ganha encerrado_em = atualizado_em; em voo segue NULL', async () => {
        const rows = await emTransacao(async () => {
            await admin.query(`
                INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES
                    ('00000000-0000-0000-0000-00000000b001', 2, 'REMESSA_GERADA', 't')
            `);
            await admin.query(`
                INSERT INTO remessa_execucao
                    (idempotency_key, lote_id, fil_cod, bnc_cod, status, dry_run, criado_em, atualizado_em)
                VALUES
                    ('bf-ok',   '00000000-0000-0000-0000-00000000b001', 2, 341, 'settled',     false,
                     '2026-09-23 10:00:00-03', '2026-09-23 10:00:07-03'),
                    ('bf-erro', '00000000-0000-0000-0000-00000000b001', 2, 341, 'error',       false,
                     '2026-09-22 10:00:00-03', '2026-09-23 11:42:40-03'),
                    ('bf-voo',  '00000000-0000-0000-0000-00000000b001', 2, 341, 'reconciling', false,
                     '2026-09-24 10:00:00-03', '2026-09-24 10:00:03-03')
            `);
            await admin.query(
                readFileSync(path.join(__dirname, '0070_metricas_ciclo_sispag.sql'), 'utf8'),
            );
            return (
                await admin.query<{ k: string; e: string | null }>(
                    `SELECT idempotency_key AS k, (encerrado_em = atualizado_em)::text AS e
                       FROM remessa_execucao WHERE idempotency_key LIKE 'bf-%' ORDER BY 1`,
                )
            ).rows;
        });

        expect(rows).toEqual([
            { k: 'bf-erro', e: 'true' },
            { k: 'bf-ok', e: 'true' },
            { k: 'bf-voo', e: null },
        ]);
    });
});
