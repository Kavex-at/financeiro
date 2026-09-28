import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 0064 — `app_user.email` (passo 1 de 3 do plano de auth, ADR-0051).
 *
 * Asserções sobre o FONTE, no mesmo padrão de `rollbacks.test.ts`: o `MigrationRunner` usa
 * `import.meta` e não roda sob Jest. O que se quer travar aqui são as decisões do scoping, que
 * são todas visíveis no texto do arquivo.
 */
const SQL = readFileSync(path.join(__dirname, '0064_app_user_email.sql'), 'utf8');

/** O SQL sem comentários de linha — para que um `UPDATE` citado num comentário não conte. */
const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0064 — app_user.email', () => {
    it('adiciona email, email_updated_by e email_updated_at, todos idempotentes e anuláveis', () => {
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS email TEXT NULL/i);
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS email_updated_by TEXT NULL/i);
        expect(CODIGO).toMatch(/ADD COLUMN IF NOT EXISTS email_updated_at TIMESTAMPTZ NULL/i);
    });

    it('cria índice único PARCIAL em lower(email), só para quem tem e-mail', () => {
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON app_user \(lower\(email\)\)\s+WHERE email IS NOT NULL/i,
        );
    });

    it('cria índice único em lower(username) — torna a guarda de caixa permanente', () => {
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON app_user \(lower\(username\)\)/i,
        );
    });

    it('NÃO faz backfill: email nasce NULL para todos (R2 substituída)', () => {
        expect(CODIGO).not.toMatch(/UPDATE\s+app_user/i);
    });

    it('falha ALTO, antes de qualquer índice, quando há username duplicado sem distinção de caixa', () => {
        const guarda = CODIGO.search(/RAISE EXCEPTION/i);
        const primeiroIndice = CODIGO.search(/CREATE UNIQUE INDEX/i);

        expect(CODIGO).toMatch(/GROUP BY lower\(username\)\s+HAVING count\(\*\) > 1/i);
        expect(guarda).toBeGreaterThan(-1);
        expect(guarda).toBeLessThan(primeiroIndice);
    });

    it('a mensagem da guarda é em português (é o operador do deploy quem a lê)', () => {
        const mensagem = CODIGO.match(/RAISE EXCEPTION\s+'([^']+)'/i)?.[1] ?? '';
        expect(mensagem).toMatch(/usu[aá]rio/i);
    });
});
