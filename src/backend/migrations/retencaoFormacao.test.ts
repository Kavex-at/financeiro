import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardas estáticas da `0062_titulo_retencao_formacao.sql` (ADR-0050) — rodam sem banco.
 *
 * A retenção é decisão da analista, não dado do ERP: vive fora de `titulo_a_pagar` (espelho da
 * ingestão, já purgado uma vez pela 0030) e sem FK para ela, para sobreviver a um rebuild da
 * carteira. Estes testes travam a forma que o repositório e o `NOT EXISTS` da formação assumem.
 */

const MIGRATION = readFileSync(path.join(__dirname, '0062_titulo_retencao_formacao.sql'), 'utf8');
const SQL = MIGRATION.replace(/--.*$/gm, '');

describe('0062_titulo_retencao_formacao — guardas estáticas', () => {
    it('cria a tabela própria com a chave natural do título', () => {
        expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS titulo_retencao_formacao/);
        expect(SQL).toMatch(/fil_cod\s+INTEGER\s+NOT NULL/);
        expect(SQL).toMatch(/doc_cod\s+TEXT\s+NOT NULL/);
        expect(SQL).toMatch(/tit_cod\s+TEXT\s+NOT NULL/);
        expect(SQL).toMatch(/marcado_por\s+TEXT\s+NOT NULL/);
        expect(SQL).toMatch(/motivo_remocao\s+TEXT/);
    });

    it('não referencia titulo_a_pagar (sem FK: a retenção sobrevive a um rebuild da carteira)', () => {
        expect(SQL).not.toMatch(/REFERENCES/i);
        expect(SQL).not.toMatch(/titulo_a_pagar\b/);
    });

    it('no máximo UMA retenção ativa por título (índice único parcial)', () => {
        expect(SQL).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS uq_titulo_retencao_formacao_ativa\s+ON titulo_retencao_formacao \(fil_cod, doc_cod, tit_cod\)\s+WHERE removido_em IS NULL/,
        );
    });

    it('remoção pareada: data, autor e motivo de remoção nulos juntos', () => {
        expect(SQL).toMatch(/\(removido_em IS NULL\) = \(removido_por IS NULL\)/);
        expect(SQL).toMatch(/\(removido_em IS NULL\) = \(motivo_remocao IS NULL\)/);
    });

    it('motivo_remocao só aceita os dois encerramentos previstos', () => {
        expect(SQL).toMatch(/motivo_remocao IN \('liberado', 'incluido-no-lote'\)/);
    });

    it('motivo da analista é opcional e limitado a 500 caracteres', () => {
        expect(SQL).toMatch(/motivo IS NULL OR char_length\(motivo\) <= 500/);
    });

    it('é idempotente e não mexe em dado (sem DML)', () => {
        expect(SQL).not.toMatch(
            /\b(INSERT\s+INTO|UPDATE\s+[a-z_.]+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i,
        );
        const adds = SQL.match(/ADD CONSTRAINT/g) ?? [];
        const drops = SQL.match(/DROP CONSTRAINT IF EXISTS/g) ?? [];
        expect(adds.length).toBeGreaterThan(0);
        expect(drops.length).toBe(adds.length);
    });
});
