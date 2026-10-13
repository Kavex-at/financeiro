import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 0083 — número do documento do fornecedor no título. Asserções sobre o FONTE (padrão das outras
 * migrations: o `MigrationRunner` não roda sob Jest).
 */
const SQL = readFileSync(path.join(__dirname, '0083_titulo_doc_esp_numero.sql'), 'utf8')
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0083 — doc_esp_numero em titulo_a_pagar', () => {
    it('adiciona uma coluna TEXT nullable, idempotente', () => {
        expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS doc_esp_numero TEXT\s*;/);
        expect(SQL).not.toMatch(/NOT NULL|DEFAULT/i);
    });

    it('não toca dado (nenhum UPDATE/DELETE) — por isso não tem reverse', () => {
        expect(SQL).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
    });
});
