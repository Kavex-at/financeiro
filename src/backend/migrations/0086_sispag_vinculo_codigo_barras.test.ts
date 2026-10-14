import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0086 — vínculo do código de barras ao item do lote (ADR-0071, I17). Asserções sobre o FONTE
 * (padrão 0080/0083/0084/0085: o `MigrationRunner` usa `import.meta` e não roda sob Jest). O
 * comportamento contra um Postgres de verdade está em
 * `0086_sispag_vinculo_codigo_barras.integration.test.ts`.
 */
const NOME = '0086_sispag_vinculo_codigo_barras.sql';
const SQL = readFileSync(path.join(__dirname, NOME), 'utf8');

const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0086 — vínculo do código de barras ao item (ADR-0071)', () => {
    it('só adiciona: as cinco colunas nullable do ItemLote, idempotente', () => {
        for (const coluna of [
            'vinculo_origem TEXT NULL',
            'vinculo_decisao_id UUID NULL',
            'vinculo_codigo_mascarado TEXT NULL',
            'vinculo_aplicado_em TIMESTAMPTZ NULL',
            'vinculo_flp_cod INTEGER NULL',
        ]) {
            expect(CODIGO).toContain(`ADD COLUMN IF NOT EXISTS ${coluna}`);
        }
        expect(CODIGO).not.toMatch(
            /\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\bINSERT\s+INTO\b|\bTRUNCATE\b|\bDROP\s+(TABLE|COLUMN)\b/i,
        );
    });

    it('o CHECK de origem tem exatamente os dois valores da ontologia', () => {
        const m = CODIGO.match(
            /vinculo_origem_check CHECK \(\s*vinculo_origem IS NULL OR vinculo_origem IN \(([^)]*)\)/i,
        );
        expect(m).not.toBeNull();
        const valores = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
        expect(valores).toEqual(['DECISAO_HUMANA', 'ERP_DDA']);
    });

    it('é tudo-ou-nada, e DECISAO_HUMANA exige a decisão', () => {
        expect(CODIGO).toMatch(/vinculo_tudo_ou_nada_check/);
        expect(CODIGO).toMatch(
            /vinculo_origem <> 'DECISAO_HUMANA' OR vinculo_decisao_id IS NOT NULL/,
        );
    });

    it('o esquema recusa código longo: só a máscara 5+4 passa (I17j)', () => {
        expect(CODIGO).toMatch(
            /vinculo_codigo_mascarado IS NULL\s+OR vinculo_codigo_mascarado ~ '\^\[0-9\]\{5\}…\[0-9\]\{4\}\$'/,
        );
    });

    it('a trilha aceita os 3 tipos novos, mantém os 6 atuais e ganha o índice de idempotência', () => {
        const m = CODIGO.match(/evento_tipo_check CHECK \(tipo IN \(([^)]*)\)/i);
        expect(m).not.toBeNull();
        const valores = [...(m?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
        expect(valores).toEqual(
            [
                'DECISAO_ANULADA',
                'DECISAO_CONFIRMADA',
                'DECISAO_REJEITADA',
                'LINHA_COPIADA',
                'PAR_CONFIRMADO',
                'PAR_REVOGADO',
                'VINCULO_APLICADO',
                'VINCULO_FALHOU',
                'VINCULO_SIMULADO',
            ].sort(),
        );
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS lote_id UUID NULL/);
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS decisao_id UUID NULL/);
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS ux_sispag_sugestao_boleto_evento_vinculo/,
        );
        // A trilha continua só-inclusão: o trigger da 0084 não é tocado.
        expect(CODIGO).not.toMatch(/TRIGGER|so_inclusao/i);
    });

    it('a marca de retenção ganha a origem nova, guardada por pg_constraint', () => {
        expect(CODIGO).toMatch(/'VINCULO_CODIGO_BARRAS_FALHOU'/);
        expect(CODIGO).toMatch(/pg_get_constraintdef\(oid\) LIKE '%VINCULO_CODIGO_BARRAS_FALHOU%'/);
    });

    it('não toca o CHECK do ledger de remessa (a etapa vincular_codbar é de memória)', () => {
        expect(CODIGO).not.toMatch(/remessa_execucao/i);
    });

    it('o .sql é copiado para dist/ pela mesma definição de migração do runner (incidente 2026-09-23)', () => {
        const listadas = new MigrationFiles().listOrFail(__dirname);
        expect(listadas).toContain(NOME);
        expect(listadas.filter((f) => f.startsWith('0086_'))).toEqual([NOME]);
    });

    it('tem reverse fora do alcance do runner', () => {
        const reverses = readdirSync(path.join(__dirname, 'rollbacks'));
        expect(reverses).toContain('0086_sispag_vinculo_codigo_barras.rollback.sql');
        expect(readdirSync(__dirname).filter((f) => f.endsWith('.rollback.sql'))).toEqual([]);
    });
});
