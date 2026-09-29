import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 0066 — destino de pagamento digitado no item do lote (ADR-0054 D1) + trilha só-inclusão (I10g).
 *
 * Asserções sobre o FONTE (mesmo padrão da 0064: o `MigrationRunner` usa `import.meta` e não roda
 * sob Jest). O comportamento contra um Postgres de verdade (UPDATE/DELETE recusados) está em
 * `0066_sispag_destino_manual.integration.test.ts`, que roda no `npm run test:sql`.
 */
const SQL = readFileSync(path.join(__dirname, '0066_sispag_destino_manual.sql'), 'utf8');

const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0066 — destino manual do item SISPAG', () => {
    it('adiciona destino_manual jsonb anulável em lote_pagamento_item, idempotente', () => {
        expect(CODIGO).toMatch(
            /ALTER TABLE lote_pagamento_item\s+ADD COLUMN IF NOT EXISTS destino_manual JSONB NULL/i,
        );
    });

    it('cria a trilha com as colunas do I10g, idempotente', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS lote_pagamento_item_destino_audit/i);
        for (const coluna of [
            /\bid\s+UUID PRIMARY KEY/i,
            /\blote_id\s+UUID NOT NULL/i,
            /\bfil_cod\s+INTEGER NOT NULL/i,
            /\bdoc_cod\s+TEXT NOT NULL/i,
            /\btit_cod\s+TEXT NOT NULL/i,
            /\balterado_por\s+TEXT NOT NULL/i,
            /\balterado_em\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/i,
            /\bantes\s+JSONB/i,
            /\bdepois\s+JSONB/i,
        ]) {
            expect(CODIGO).toMatch(coluna);
        }
    });

    it('a trilha NÃO tem FK em cascata para o lote (o DELETE do lote não pode apagá-la)', () => {
        const tabela = CODIGO.slice(
            CODIGO.search(/CREATE TABLE IF NOT EXISTS lote_pagamento_item_destino_audit/i),
        );
        const corpo = tabela.slice(0, tabela.indexOf(');'));
        expect(corpo).not.toMatch(/REFERENCES/i);
    });

    it('recusa UPDATE, DELETE e TRUNCATE na trilha por trigger', () => {
        expect(CODIGO).toMatch(/RAISE EXCEPTION/i);
        expect(CODIGO).toMatch(
            /BEFORE UPDATE OR DELETE ON lote_pagamento_item_destino_audit\s+FOR EACH ROW/i,
        );
        expect(CODIGO).toMatch(/BEFORE TRUNCATE ON lote_pagamento_item_destino_audit/i);
        expect(CODIGO).toMatch(/DROP TRIGGER IF EXISTS/i);
        expect(CODIGO).toMatch(/CREATE OR REPLACE FUNCTION/i);
    });

    it('não faz backfill nem toca itens existentes', () => {
        expect(CODIGO).not.toMatch(/UPDATE\s+lote_pagamento_item\b/i);
        expect(CODIGO).not.toMatch(/INSERT\s+INTO/i);
    });
});
