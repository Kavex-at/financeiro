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
