import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 0070 — `app_user.auth_user_id` + limpeza de grants do `public` (passo 3 de 3 do plano de auth,
 * ADR-0054).
 *
 * Asserções sobre o FONTE, no padrão de `0064_app_user_email.test.ts`: o `MigrationRunner` usa
 * `import.meta` e não roda sob Jest. A execução real (Postgres puro sem os roles e o Postgres do
 * `supabase start` com os roles) é o passo 1 do roteiro de QA.
 */
const SQL = readFileSync(path.join(__dirname, '0070_app_user_auth_user_id.sql'), 'utf8');

/** O SQL sem comentários de linha — para que um `UPDATE` citado num comentário não conte. */
const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0070 — app_user.auth_user_id e grants do public', () => {
    it('adiciona auth_user_id UUID anulável, idempotente, sem NOT NULL e sem DEFAULT', () => {
        expect(CODIGO).toMatch(
            /ALTER TABLE app_user\s+ADD COLUMN IF NOT EXISTS auth_user_id UUID NULL\s*;/i,
        );
        expect(CODIGO).not.toMatch(/auth_user_id UUID[^;]*NOT NULL/i);
        expect(CODIGO).not.toMatch(/auth_user_id UUID[^;]*DEFAULT/i);
    });

    it('cria índice único PARCIAL em auth_user_id, só para quem tem vínculo', () => {
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON app_user \(auth_user_id\)\s+WHERE auth_user_id IS NOT NULL/i,
        );
    });

    it('NÃO faz backfill (segura para o backend antigo, que ignora a coluna)', () => {
        expect(CODIGO).not.toMatch(/UPDATE\s+app_user/i);
    });

    it('revoga TRUNCATE, REFERENCES, TRIGGER de anon/authenticated em cada tabela do public', () => {
        expect(CODIGO).toMatch(/FROM pg_tables\s+WHERE schemaname = 'public'/i);
        expect(CODIGO).toMatch(
            /format\(\s*'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.%I FROM anon, authenticated'/i,
        );
    });

    it('ajusta o default privilege do postgres para tabelas novas', () => {
        expect(CODIGO).toMatch(
            /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\s+REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated/i,
        );
    });

    it('o bloco de grants só roda quando anon, authenticated e postgres existem (D8)', () => {
        expect(CODIGO).toMatch(/DO \$\$/);
        for (const role of ['anon', 'authenticated', 'postgres']) {
            expect(CODIGO).toMatch(
                new RegExp(`EXISTS \\(SELECT 1 FROM pg_roles WHERE rolname = '${role}'\\)`, 'i'),
            );
        }
        const condicao = CODIGO.search(/pg_roles/i);
        const primeiroRevoke = CODIGO.search(/REVOKE/i);
        expect(condicao).toBeGreaterThan(-1);
        expect(condicao).toBeLessThan(primeiroRevoke);
    });

    it('não concede nada a ninguém e não toca o schema auth (I7)', () => {
        expect(CODIGO).not.toMatch(/\bGRANT\b/i);
        expect(CODIGO).not.toMatch(/\bauth\./i);
    });

    it('não tem reverse: a coluna é aditiva e os grants revogados não devem voltar (D9)', () => {
        expect(() =>
            readFileSync(
                path.join(__dirname, 'rollbacks', '0070_app_user_auth_user_id.rollback.sql'),
                'utf8',
            ),
        ).toThrow();
    });
});
