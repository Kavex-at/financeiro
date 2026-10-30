import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 0092 — `boleto_dda_conferencia` (I-DDA6/I-DDA7, v0.53.0). Asserções sobre o FONTE, no padrão das
 * outras migrations (o `MigrationRunner` usa `import.meta` e não roda sob Jest). A aplicação real
 * roda no `BoletoDdaRepository.integration.test.ts` (`npm run test:sql`), que aplica todas.
 */
const SQL = readFileSync(path.join(__dirname, '0092_boleto_dda_conferencia.sql'), 'utf8');
const CODIGO = SQL.split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

describe('0092_boleto_dda_conferencia', () => {
    it('é aditiva e idempotente: só CREATE TABLE IF NOT EXISTS, nada de DROP/ALTER/DELETE', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS boleto_dda_conferencia/);
        expect(CODIGO).not.toMatch(/\b(DROP|ALTER|DELETE|TRUNCATE|UPDATE)\b/i);
    });

    it('tem UMA linha só (id = 1) e conferido_em obrigatório', () => {
        expect(CODIGO).toMatch(/id\s+SMALLINT PRIMARY KEY[^,]*CHECK \(id = 1\)/);
        expect(CODIGO).toMatch(/conferido_em\s+TIMESTAMPTZ NOT NULL/);
    });
});
