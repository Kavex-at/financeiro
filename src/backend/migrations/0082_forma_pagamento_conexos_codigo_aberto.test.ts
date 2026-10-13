import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 0082 — abre o domínio de `forma_pagamento_conexos`. Asserções sobre o FONTE (padrão das outras
 * migrations: o `MigrationRunner` não roda sob Jest).
 */
const SQL = readFileSync(
    path.join(__dirname, '0082_forma_pagamento_conexos_codigo_aberto.sql'),
    'utf8',
)
    .split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0082 — forma de pagamento com código aberto', () => {
    it('derruba a CHECK 1..10 da 0081 pelo nome gerado e põe só "> 0"', () => {
        expect(SQL).toMatch(
            /DROP CONSTRAINT IF EXISTS titulo_a_pagar_forma_pagamento_conexos_check/,
        );
        expect(SQL).toMatch(/CHECK \(forma_pagamento_conexos > 0\)/);
        expect(SQL).not.toMatch(/<=\s*10|BETWEEN/);
    });

    it('não toca dado (nenhum UPDATE/DELETE) — por isso não tem reverse', () => {
        expect(SQL).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE)\b/i);
    });
});
