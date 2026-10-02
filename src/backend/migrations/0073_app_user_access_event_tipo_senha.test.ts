import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 0073 — `app_user_access_event.tipo` ganha `senha` (feature `auth-senha-propria`, ADR-0059).
 *
 * Asserções sobre o FONTE, no padrão de `0071_app_user_auth_user_id.test.ts`: o `MigrationRunner`
 * usa `import.meta` e não roda sob Jest. A execução real (Postgres limpo, INSERT `senha` aceito,
 * `outro` recusado, reaplicação sem erro) é o passo 1 do roteiro de QA.
 */
const SQL = readFileSync(path.join(__dirname, '0073_app_user_access_event_tipo_senha.sql'), 'utf8');

/** O SQL sem comentários de linha — para que um `DELETE` citado num comentário não conte. */
const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

describe('migration 0073 — tipo senha na trilha de acesso', () => {
    it('derruba a CHECK pelo nome automático com IF EXISTS ANTES de recriá-la (idempotente)', () => {
        const drop = CODIGO.search(
            /ALTER TABLE app_user_access_event\s+DROP CONSTRAINT IF EXISTS app_user_access_event_tipo_check\s*;/i,
        );
        const add = CODIGO.search(/ADD CONSTRAINT app_user_access_event_tipo_check/i);
        expect(drop).toBeGreaterThan(-1);
        expect(add).toBeGreaterThan(drop);
    });

    it("a lista nova é exatamente ('papel','excecao','ativo','senha')", () => {
        const match = CODIGO.match(
            /ADD CONSTRAINT app_user_access_event_tipo_check\s+CHECK\s*\(\s*tipo IN\s*\(([^)]*)\)\s*\)/i,
        );
        expect(match).not.toBeNull();
        const tipos = (match?.[1] ?? '').split(',').map((t) => t.trim().replace(/'/g, ''));
        expect(tipos).toEqual(['papel', 'excecao', 'ativo', 'senha']);
    });

    it('é aditiva: sem DROP TABLE, DELETE, UPDATE ou TRUNCATE (trilha append-only)', () => {
        expect(CODIGO).not.toMatch(/\bDROP\s+TABLE\b/i);
        expect(CODIGO).not.toMatch(/\bDELETE\b/i);
        expect(CODIGO).not.toMatch(/\bUPDATE\b/i);
        expect(CODIGO).not.toMatch(/\bTRUNCATE\b/i);
    });

    it('o cabeçalho cita a ADR-0059 e explica por que não há reverse (S1)', () => {
        expect(SQL).toMatch(/ADR-0059/);
        expect(SQL).toMatch(/sem reverse/i);
    });

    it('não tem reverse: estreitar a CHECK exigiria apagar linhas da trilha append-only', () => {
        expect(() =>
            readFileSync(
                path.join(
                    __dirname,
                    'rollbacks',
                    '0073_app_user_access_event_tipo_senha.rollback.sql',
                ),
                'utf8',
            ),
        ).toThrow();
    });
});
