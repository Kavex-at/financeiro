import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0085 — origem e campos de retenção do BloqueioDuplicidade (ADR-0069 emenda 1, I16d–I16h).
 * Asserções sobre o FONTE (padrão da 0080/0083/0084: o `MigrationRunner` usa `import.meta` e não
 * roda sob Jest). O comportamento contra um Postgres de verdade está em
 * `0085_sispag_bloqueio_origem_codigo_barras.integration.test.ts`.
 */
const NOME = '0085_sispag_bloqueio_origem_codigo_barras.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');

const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0085 — origem do bloqueio por código de barras (ADR-0069 emenda 1)', () => {
    it('só adiciona colunas e é idempotente', () => {
        expect(CODIGO).toMatch(/ALTER TABLE titulo_bloqueio_duplicidade/i);
        for (const coluna of [
            "origem TEXT NOT NULL DEFAULT 'DUPLICIDADE_TITULO'",
            'titulo_mantido_fil_cod INTEGER NULL',
            'titulo_mantido_doc_cod TEXT NULL',
            'titulo_mantido_tit_cod TEXT NULL',
            'codigo_mascarado TEXT NULL',
        ]) {
            expect(CODIGO).toContain(`ADD COLUMN IF NOT EXISTS ${coluna}`);
        }
        expect(CODIGO).not.toMatch(
            /\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bTRUNCATE\b|\bDROP\b/i,
        );
        // Cada CHECK é guardado por pg_constraint — reaplicar é no-op.
        const checks = CODIGO.match(/ADD CONSTRAINT/gi) ?? [];
        const guardas = CODIGO.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/gi) ?? [];
        expect(checks.length).toBeGreaterThanOrEqual(3);
        expect(guardas.length).toBe(checks.length);
    });

    it('o CHECK de origem tem exatamente os três valores da ontologia', () => {
        const m = CODIGO.match(/origem_check CHECK \(\s*origem IN \(([^)]*)\)/i);
        expect(m).not.toBeNull();
        const valores = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
        expect(valores).toEqual(
            ['CODIGO_BARRAS_ILEGIVEL', 'CODIGO_BARRAS_REPETIDO', 'DUPLICIDADE_TITULO'].sort(),
        );
    });

    it('o esquema recusa código longo: só a máscara 5+4 passa (I16e)', () => {
        expect(CODIGO).toMatch(
            /codigo_mascarado IS NULL OR codigo_mascarado ~ '\^\[0-9\]\{5\}…\[0-9\]\{4\}\$'/,
        );
    });

    it('DUPLICIDADE_TITULO nunca carrega máscara nem título mantido', () => {
        expect(CODIGO).toMatch(
            /origem <> 'DUPLICIDADE_TITULO'\s+OR \(codigo_mascarado IS NULL\s+AND titulo_mantido_fil_cod IS NULL\s+AND titulo_mantido_doc_cod IS NULL\s+AND titulo_mantido_tit_cod IS NULL\)/i,
        );
    });

    it('o título mantido é tudo-ou-nada', () => {
        expect(CODIGO).toMatch(/titulo_mantido_check/i);
    });

    it('não toca o índice único ATIVO nem o CHECK de eventos da trilha', () => {
        expect(CODIGO).not.toMatch(/ux_titulo_bloqueio_duplicidade_ativo/);
        expect(CODIGO).not.toMatch(/sispag_verificacao_evento/);
    });

    it('o .sql é copiado para dist/ pela mesma definição de migração do runner', () => {
        const listadas = new MigrationFiles().listOrFail(__dirname);
        expect(listadas).toContain(NOME);
        expect(listadas.filter((f) => f.startsWith('0085_'))).toEqual([NOME]);
    });

    it('tem reverse fora do alcance do runner', () => {
        const reverses = readdirSync(path.join(__dirname, 'rollbacks'));
        expect(reverses).toContain('0085_sispag_bloqueio_origem_codigo_barras.rollback.sql');
        expect(readdirSync(__dirname).filter((f) => f.endsWith('.rollback.sql'))).toEqual([]);
    });
});
