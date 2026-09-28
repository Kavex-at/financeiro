import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION_CATALOG } from '../domain/interface/auth/Permission.js';

/**
 * 0066 — permissões por módulo lidas do banco (passo 2 de 3 do plano de auth, ADR-0053).
 *
 * Asserções sobre o FONTE, no padrão de `0064_app_user_email.test.ts`: o `MigrationRunner` usa
 * `import.meta` e não roda sob Jest. A execução real (do zero, duas vezes, guarda e reverse) foi
 * feita num Postgres 16 descartável; aqui ficam travadas as decisões do scoping.
 */
const SQL = readFileSync(path.join(__dirname, '0066_auth_permissoes_modulo.sql'), 'utf8');
const REVERSE = readFileSync(
    path.join(__dirname, 'rollbacks', '0066_auth_permissoes_modulo.rollback.sql'),
    'utf8',
);

/** Sem comentários de linha — um `DROP` citado num comentário não conta. */
const semComentarios = (texto: string): string =>
    texto
        .split('\n')
        .map((linha) => linha.replace(/--.*$/, ''))
        .join('\n');

const CODIGO = semComentarios(SQL);
const CODIGO_REVERSE = semComentarios(REVERSE);

/** Os valores de TODO `CHECK (permission IN (...))` da migration. */
const listasDoCheck = (): string[][] =>
    [...CODIGO.matchAll(/CHECK\s*\(\s*permission\s+IN\s*\(([^)]*)\)\s*\)/gi)].map((m) =>
        [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]).sort(),
    );

describe('migration 0066 — papéis, exceções e trilha de acesso', () => {
    it('aborta, ANTES de qualquer DDL, quando existe app_user.role diferente de admin (Q3)', () => {
        const guarda = CODIGO.search(/RAISE EXCEPTION/i);
        const primeiraTabela = CODIGO.search(/CREATE TABLE/i);
        const primeiroAlter = CODIGO.search(/ALTER TABLE/i);

        expect(guarda).toBeGreaterThan(-1);
        expect(guarda).toBeLessThan(primeiraTabela);
        expect(guarda).toBeLessThan(primeiroAlter);
        expect(CODIGO).toMatch(/role\s*<>\s*'admin'|role\s+IS\s+DISTINCT\s+FROM\s+'admin'/i);
    });

    it('a mensagem da guarda é em português (quem lê é o operador do deploy)', () => {
        const mensagem = CODIGO.match(/RAISE EXCEPTION\s+'([^']+)'/i)?.[1] ?? '';
        expect(mensagem).toMatch(/papel|usu[aá]rio/i);
    });

    it('cria app_role com índice único em lower(nome)', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS app_role\s*\(/i);
        expect(CODIGO).toMatch(/id SERIAL PRIMARY KEY/i);
        expect(CODIGO).toMatch(/nome TEXT NOT NULL/i);
        expect(CODIGO).toMatch(/descricao TEXT/i);
        expect(CODIGO).toMatch(
            /CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON app_role \(lower\(nome\)\)/i,
        );
    });

    it('cria app_role_permission com PK (role_id, permission) e FK em cascata', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS app_role_permission/i);
        expect(CODIGO).toMatch(/role_id INT NOT NULL REFERENCES app_role\(id\) ON DELETE CASCADE/i);
        expect(CODIGO).toMatch(/PRIMARY KEY \(role_id, permission\)/i);
    });

    it('cria user_permission com efeito conceder|revogar, autor e PK (user_id, permission)', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS user_permission/i);
        expect(CODIGO).toMatch(/user_id INT NOT NULL REFERENCES app_user\(id\)/i);
        expect(CODIGO).toMatch(
            /efeito TEXT NOT NULL CHECK \(efeito IN \('conceder', 'revogar'\)\)/i,
        );
        expect(CODIGO).toMatch(/concedido_por TEXT NOT NULL/i);
        expect(CODIGO).toMatch(/concedido_em TIMESTAMPTZ NOT NULL DEFAULT now\(\)/i);
        expect(CODIGO).toMatch(/PRIMARY KEY \(user_id, permission\)/i);
    });

    it('as DUAS colunas permission têm CHECK igual ao catálogo do código (R4, paridade)', () => {
        const listas = listasDoCheck();
        expect(listas).toHaveLength(2);
        for (const lista of listas) {
            expect(lista).toEqual([...PERMISSION_CATALOG].sort());
        }
    });

    it('cria a trilha app_user_access_event com tipo papel|excecao|ativo e índice (alvo, em)', () => {
        expect(CODIGO).toMatch(/CREATE TABLE IF NOT EXISTS app_user_access_event/i);
        expect(CODIGO).toMatch(/id BIGSERIAL PRIMARY KEY/i);
        expect(CODIGO).toMatch(/ator TEXT NOT NULL/i);
        expect(CODIGO).toMatch(/alvo_user_id INT NOT NULL REFERENCES app_user\(id\)/i);
        expect(CODIGO).toMatch(
            /tipo TEXT NOT NULL CHECK \(tipo IN \('papel', 'excecao', 'ativo'\)\)/i,
        );
        expect(CODIGO).toMatch(/antes JSONB/i);
        expect(CODIGO).toMatch(/depois JSONB/i);
        expect(CODIGO).toMatch(/em TIMESTAMPTZ NOT NULL DEFAULT now\(\)/i);
        expect(CODIGO).toMatch(
            /CREATE INDEX IF NOT EXISTS \w+\s+ON app_user_access_event \(alvo_user_id, em\)/i,
        );
    });

    it('semeia Administrador com as NOVE permissões, idempotente', () => {
        expect(CODIGO).toMatch(/INSERT INTO app_role[\s\S]*'Administrador'/i);
        const seedPermissoes = CODIGO.match(
            /INSERT INTO app_role_permission[\s\S]*?ON CONFLICT DO NOTHING/i,
        )?.[0];
        expect(seedPermissoes).toBeDefined();
        const valores = [...(seedPermissoes ?? '').matchAll(/'([a-z]+:[a-z]+)'/g)].map((m) => m[1]);
        expect(valores.sort()).toEqual([...PERMISSION_CATALOG].sort());
        expect((CODIGO.match(/ON CONFLICT/gi) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it('role_id: adiciona IF NOT EXISTS, backfill só onde é NULL e SÓ ENTÃO SET NOT NULL', () => {
        const add = CODIGO.search(
            /ADD COLUMN IF NOT EXISTS role_id INT REFERENCES app_role\(id\)/i,
        );
        const backfill = CODIGO.search(
            /UPDATE app_user[\s\S]*SET role_id[\s\S]*WHERE role_id IS NULL/i,
        );
        const notNull = CODIGO.search(/ALTER COLUMN role_id SET NOT NULL/i);

        expect(add).toBeGreaterThan(-1);
        expect(backfill).toBeGreaterThan(add);
        expect(notNull).toBeGreaterThan(backfill);
    });

    it('não apaga nem altera a coluna role (R8)', () => {
        expect(CODIGO).not.toMatch(/DROP COLUMN[^;]*\brole\b(?!_)/i);
        expect(CODIGO).not.toMatch(/ALTER COLUMN role\b(?!_)/i);
        expect(CODIGO).not.toMatch(/SET role\s*=/i);
    });

    it('todo CREATE é IF NOT EXISTS (rodar duas vezes não falha)', () => {
        const creates = CODIGO.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/gi) ?? [];
        expect(creates.length).toBeGreaterThan(0);
        for (const create of creates) expect(create).toMatch(/IF NOT EXISTS/i);
    });
});

describe('reverse da 0066 (D7)', () => {
    it('derruba role_id, a trilha, as exceções, os pacotes e os papéis, NESSA ordem', () => {
        const ordem = [
            /DROP COLUMN IF EXISTS role_id/i,
            /DROP TABLE IF EXISTS app_user_access_event/i,
            /DROP TABLE IF EXISTS user_permission/i,
            /DROP TABLE IF EXISTS app_role_permission/i,
            /DROP TABLE IF EXISTS app_role\b(?!_)/i,
        ].map((re) => CODIGO_REVERSE.search(re));

        for (const pos of ordem) expect(pos).toBeGreaterThan(-1);
        expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    });

    it('avisa, no próprio script, que a trilha de acesso se perde', () => {
        expect(REVERSE).toMatch(/trilha[\s\S]{0,80}(perde|perdida)/i);
    });

    it('não toca a coluna role', () => {
        expect(CODIGO_REVERSE).not.toMatch(/DROP COLUMN[^;]*\brole\b(?!_)/i);
    });
});
