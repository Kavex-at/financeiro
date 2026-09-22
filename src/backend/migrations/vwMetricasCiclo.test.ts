import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardas estáticas da `0058_vw_metricas_ciclo.sql` (ADR-0045) — rodam sem banco.
 *
 * O comportamento (janelas, taxas, borderô finalizado) é provado em
 * `vwMetricasCiclo.integration.test.ts` contra um Postgres de verdade, no job `backend-sql` do CI.
 * Aqui fica o que tem que valer mesmo onde não há banco: a forma do contrato que a API e o report
 * leem, o somente-leitura e a ausência de caminho de acesso paralelo à aplicação.
 */

const MIGRATION = readFileSync(path.join(__dirname, '0058_vw_metricas_ciclo.sql'), 'utf8');
const SQL = MIGRATION.replace(/--.*$/gm, '');

const COLUNAS_DO_CONTRATO = [
    'frente',
    'metrica',
    'rotulo',
    'valor',
    'unidade',
    'janela_inicio',
    'janela_fim',
    'baseline',
    'baseline_desc',
];

describe('0058_vw_metricas_ciclo — guardas estáticas', () => {
    it('não escreve nada (sem DML fora de comentário)', () => {
        expect(SQL).not.toMatch(
            /\b(INSERT\s+INTO|UPDATE\s+[a-z_.]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i,
        );
    });

    it('a função devolve as nove colunas do contrato, nesta ordem, e depois parcial e apurado_ate', () => {
        const retornos = [...SQL.matchAll(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/g)];

        expect(retornos).toHaveLength(1);
        const colunas = retornos[0][1]
            .split(',')
            .map((c) => c.trim().split(/\s+/)[0])
            .filter((c) => c !== '');

        expect(colunas).toEqual([...COLUNAS_DO_CONTRATO, 'parcial', 'apurado_ate']);
    });

    it('a view tem só semanas fechadas — a parcial sai só pela função (a API)', () => {
        expect(SQL).toMatch(/\) AS m\s+WHERE NOT m\.parcial;/);
    });

    it('a view projeta as nove colunas do contrato, nesta ordem', () => {
        const view = SQL.match(
            /CREATE OR REPLACE VIEW metricas\.vw_metricas_ciclo AS\s+SELECT([\s\S]*?)FROM/,
        );

        const colunas = (view?.[1] ?? '')
            .split(',')
            .map((c) => c.trim().replace(/^m\./, ''))
            .filter((c) => c !== '');

        expect(colunas).toEqual(COLUNAS_DO_CONTRATO);
    });

    it('as janelas são timestamp sem fuso (a sessão do Supabase é UTC)', () => {
        expect(SQL).toMatch(/janela_inicio\s+timestamp,/);
        expect(SQL).toMatch(/janela_fim\s+timestamp,/);
        expect(SQL).not.toMatch(/timestamptz|with time zone/i);
    });

    it('a série do ciclo 6 mora só em `metricas.serie_inicio()`, e a view a usa', () => {
        const literais = SQL.match(/TIMESTAMP '2026-09-11 18:00:00'/g) ?? [];

        expect(literais).toHaveLength(1);
        expect(SQL).toMatch(
            /FUNCTION metricas\.serie_inicio\(\)[\s\S]*?TIMESTAMP '2026-09-11 18:00:00'/,
        );
        expect(SQL).toMatch(/metricas\.metricas_ciclo\(\s*metricas\.serie_inicio\(\),/);
    });

    it('sem caminho paralelo à aplicação: nenhum role, GRANT ou SECURITY DEFINER (ADR-0045, D5)', () => {
        expect(SQL).not.toMatch(/CREATE ROLE|ALTER ROLE|GRANT |SECURITY DEFINER|PASSWORD/i);
        expect(SQL).toMatch(
            /REVOKE ALL ON FUNCTION metricas\.metricas_ciclo\(timestamp, timestamp\) FROM PUBLIC;/,
        );
        expect(SQL).toMatch(/REVOKE ALL ON FUNCTION metricas\.serie_inicio\(\) FROM PUBLIC;/);
    });

    it('a Frente IV não lê a spine `recebimento*`, vazia em produção (ADR-0045, D1)', () => {
        expect(SQL).not.toMatch(/public\.(recebimento|recebimento_execucao|rateio_recebimento)\b/);
        expect(SQL).toMatch(/public\.solicitacao_numerario_execucao/);
    });

    it('só borderô FINALIZADO e sem estorno conclui (gap G2)', () => {
        expect(SQL).toMatch(/b\.bor_vld_finalizado = 1\s+AND b\.bor_cod_estornado IS NULL/);
    });
});

/**
 * Guardas estáticas da `0060_metricas_historico_inicio.sql` (ADR-0048) — o segundo piso da série.
 *
 * Moram no MESMO arquivo que as da 0058 de propósito: a ADR-0048 aceita conviver com dois pisos, e a
 * mitigação que ela nomeia para a divergência é justamente esta — quem mexer num vê o outro.
 */
const MIGRATION_0060 = readFileSync(
    path.join(__dirname, '0060_metricas_historico_inicio.sql'),
    'utf8',
);
const SQL_0060 = MIGRATION_0060.replace(/--.*$/gm, '');

/** `TIMESTAMP 'YYYY-MM-DD HH:MM:SS'` → `Date` em UTC, para comparar as duas datas sem fuso no meio. */
const literalDeData = (sql: string, funcao: string): Date => {
    const m = new RegExp(
        `FUNCTION metricas\\.${funcao}\\(\\)[\\s\\S]*?TIMESTAMP '(\\d{4})-(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}):(\\d{2})'`,
    ).exec(sql);
    if (m === null) throw new Error(`piso de metricas.${funcao}() não encontrado`);
    return new Date(
        Date.UTC(
            Number(m[1]),
            Number(m[2]) - 1,
            Number(m[3]),
            Number(m[4]),
            Number(m[5]),
            Number(m[6]),
        ),
    );
};

const DIA_MS = 24 * 60 * 60 * 1000;

describe('0060_metricas_historico_inicio — guardas estáticas', () => {
    it('não escreve nada (sem DML fora de comentário)', () => {
        expect(SQL_0060).not.toMatch(
            /\b(INSERT\s+INTO|UPDATE\s+[a-z_.]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i,
        );
    });

    it('é ADITIVA: não redefine nada da 0058', () => {
        expect(SQL_0060).not.toMatch(/FUNCTION metricas\.serie_inicio\(\)/);
        expect(SQL_0060).not.toMatch(/FUNCTION metricas\.metricas_ciclo\(/);
        expect(SQL_0060).not.toMatch(/VIEW metricas\.vw_metricas_ciclo/);
        expect(SQL_0060).not.toMatch(/DROP |CREATE SCHEMA/i);
    });

    it('o piso do histórico é 2026-08-07 18:00 e mora só aqui', () => {
        const literais = SQL_0060.match(/TIMESTAMP '2026-08-07 18:00:00'/g) ?? [];

        expect(literais).toHaveLength(1);
        expect(SQL_0060).toMatch(
            /FUNCTION metricas\.historico_inicio\(\)[\s\S]*?TIMESTAMP '2026-08-07 18:00:00'/,
        );
        // A 0058 não conhece o piso do histórico — cada um na sua migration.
        expect(SQL).not.toMatch(/historico_inicio/);
    });

    it('sem caminho paralelo à aplicação: nenhum role, GRANT ou SECURITY DEFINER (ADR-0045, D5)', () => {
        expect(SQL_0060).not.toMatch(/CREATE ROLE|ALTER ROLE|GRANT |SECURITY DEFINER|PASSWORD/i);
        expect(SQL_0060).toMatch(
            /REVOKE ALL ON FUNCTION metricas\.historico_inicio\(\) FROM PUBLIC;/,
        );
    });

    it('timestamp sem fuso, como a 0058 (a sessão do Supabase é UTC)', () => {
        expect(SQL_0060).toMatch(/RETURNS timestamp/);
        expect(SQL_0060).not.toMatch(/timestamptz|with time zone/i);
    });

    /**
     * O invariante que torna o recuo seguro (ADR-0048, D2).
     *
     * `metricas_ciclo` gera as janelas com `generate_series(piso, agora, '7 days')`. Se os dois pisos
     * não caíssem no MESMO ponto da grade semanal, recuar a tela rebateria toda janela já fechada —
     * e todo número que o report já publicou mudaria de valor sem que ninguém percebesse.
     */
    it('os dois pisos caem na mesma grade: ambos sexta 18:00, a múltiplo de 7 dias um do outro', () => {
        const serie = literalDeData(SQL, 'serie_inicio');
        const historico = literalDeData(SQL_0060, 'historico_inicio');

        // 5 = sexta-feira.
        expect(serie.getUTCDay()).toBe(5);
        expect(historico.getUTCDay()).toBe(5);
        expect([serie.getUTCHours(), serie.getUTCMinutes()]).toEqual([18, 0]);
        expect([historico.getUTCHours(), historico.getUTCMinutes()]).toEqual([18, 0]);

        const distanciaDias = (serie.getTime() - historico.getTime()) / DIA_MS;
        expect(distanciaDias).toBeGreaterThan(0);
        expect(distanciaDias % 7).toBe(0);
    });

    it('recua seis janelas: cinco semanas fechadas a mais, além da em curso', () => {
        const serie = literalDeData(SQL, 'serie_inicio');
        const historico = literalDeData(SQL_0060, 'historico_inicio');

        expect((serie.getTime() - historico.getTime()) / DIA_MS / 7).toBe(5);
    });
});
