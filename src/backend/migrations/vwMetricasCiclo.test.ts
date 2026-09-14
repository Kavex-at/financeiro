import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardas estáticas da `0058_vw_metricas_ciclo.sql` (ADR-0045) — rodam sem banco.
 *
 * O comportamento (janelas, taxas, borderô desfeito, acesso do leitor) é provado em
 * `vwMetricasCiclo.integration.test.ts` contra um Postgres de verdade. Aqui fica o que tem que
 * valer mesmo onde não há banco: a forma do contrato que o `metrics.py` lê, o somente-leitura e o
 * alcance do role. São exatamente as três coisas que, se quebradas, falham em silêncio — o report
 * mostra "sem instrumentação" e ninguém liga a causa a esta migration.
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

    it('as duas funções devolvem as nove colunas do contrato, nesta ordem', () => {
        const retornos = [...SQL.matchAll(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/g)];

        expect(retornos).toHaveLength(2);
        for (const retorno of retornos) {
            const colunas = retorno[1]
                .split(',')
                .map((c) => c.trim().split(/\s+/)[0])
                .filter((c) => c !== '');

            expect(colunas).toEqual(COLUNAS_DO_CONTRATO);
        }
    });

    it('a view projeta as mesmas nove colunas, nesta ordem', () => {
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

    it('só a função SEM parâmetro é DEFINER; as duas têm EXECUTE revogado de PUBLIC', () => {
        const definers = SQL.match(/SECURITY DEFINER\s+SET search_path = ''/g) ?? [];
        const vigente = SQL.slice(SQL.indexOf('FUNCTION metricas.metricas_ciclo_vigente()'));

        expect(definers).toHaveLength(1);
        expect(vigente).toMatch(/^[^$]*SECURITY DEFINER\s+SET search_path = ''/);
        expect(SQL).toMatch(
            /REVOKE ALL ON FUNCTION metricas\.metricas_ciclo\(timestamp, timestamp\) FROM PUBLIC;/,
        );
        expect(SQL).toMatch(
            /REVOKE ALL ON FUNCTION metricas\.metricas_ciclo_vigente\(\) FROM PUBLIC;/,
        );
    });

    it('o leitor recebe USAGE, EXECUTE só na vigente e SELECT na view — nada nas tabelas', () => {
        const grants = SQL.match(/GRANT [^;]+;/g) ?? [];

        expect(grants).toEqual([
            'GRANT USAGE ON SCHEMA metricas TO metricas_ciclo_leitor;',
            'GRANT EXECUTE ON FUNCTION metricas.metricas_ciclo_vigente() TO metricas_ciclo_leitor;',
            'GRANT SELECT ON metricas.vw_metricas_ciclo TO metricas_ciclo_leitor;',
        ]);
    });

    it('o leitor conecta read-only, e o role nasce sem LOGIN (senha não entra em migration)', () => {
        expect(SQL).toMatch(
            /ALTER ROLE metricas_ciclo_leitor SET default_transaction_read_only = on;/,
        );
        expect(SQL).toMatch(/CREATE ROLE metricas_ciclo_leitor NOLOGIN;/);
        expect(SQL).not.toMatch(/PASSWORD/i);
    });

    it('a Frente IV não lê a spine `recebimento*`, vazia em produção (ADR-0045, D1)', () => {
        expect(SQL).not.toMatch(/public\.(recebimento|recebimento_execucao|rateio_recebimento)\b/);
        expect(SQL).toMatch(/public\.solicitacao_numerario_execucao/);
    });

    it('a série começa no ciclo 6 — sem backfill', () => {
        expect(SQL).toMatch(/TIMESTAMP '2026-09-11 20:00:00'/);
    });
});
