import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 0089 — guarda o nome do tipo do documento. Asserções sobre o FONTE (padrão das outras
 * migrations: o `MigrationRunner` não roda sob Jest).
 */
const SQL = readFileSync(path.join(__dirname, '0089_sispag_titulo_tipo.sql'), 'utf8')
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0089 — tipo do documento do título', () => {
    it('adiciona tpd_des_nome como coluna opcional, idempotente', () => {
        expect(SQL).toMatch(/ALTER TABLE titulo_a_pagar/);
        expect(SQL).toMatch(/ADD COLUMN IF NOT EXISTS tpd_des_nome TEXT;/);
        expect(SQL).not.toMatch(/NOT NULL/i);
    });

    it('não toca dado (nenhum UPDATE/DELETE) — por isso não tem reverse', () => {
        expect(SQL).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
    });
});
