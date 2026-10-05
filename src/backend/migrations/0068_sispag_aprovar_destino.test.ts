import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION_CATALOG } from '../domain/interface/auth/Permission.js';

/**
 * O catálogo no dia da 0068: o de hoje, com `sispag:excecao` (0075, ADR-0060) de volta como
 * `sispag:aprovar_destino`. A 0068 é histórico; a paridade vigente é checada pelo teste da 0075.
 */
const CATALOGO_DA_0068: readonly string[] = PERMISSION_CATALOG.map((p) =>
    p === 'sispag:excecao' ? 'sispag:aprovar_destino' : p,
);

/**
 * 0068 — permissão `sispag:aprovar_destino` e aprovação na trilha (ADR-0054 D10).
 *
 * Asserções sobre o FONTE (padrão da 0064/0066/0067: o `MigrationRunner` usa `import.meta` e não
 * roda sob Jest).
 */
const SQL = readFileSync(path.join(__dirname, '0068_sispag_aprovar_destino.sql'), 'utf8');

const semComentarios = (texto: string): string =>
    texto
        .split('\n')
        .map((linha) => linha.replace(/--.*$/, ''))
        .join('\n');

const CODIGO = semComentarios(SQL);

const REGEX_CHECK = /CHECK\s*\(\s*permission\s+IN\s*\(([^)]*)\)\s*\)/gi;

const listasDoCheck = (codigo: string): string[][] =>
    [...codigo.matchAll(REGEX_CHECK)].map((m) =>
        [...m[1].matchAll(/'([^']+)'/g)].map((v) => v[1]).sort(),
    );

describe('migration 0068 — sispag:aprovar_destino (ADR-0054 D10)', () => {
    it('troca os DOIS CHECK de permission pelo catálogo atual do código (R4, paridade)', () => {
        const listas = listasDoCheck(CODIGO);
        expect(listas).toHaveLength(2);
        for (const lista of listas) expect(lista).toEqual([...CATALOGO_DA_0068].sort());
        for (const tabela of ['app_role_permission', 'user_permission']) {
            const nome = `${tabela}_permission_check`;
            const drop = CODIGO.search(
                new RegExp(`ALTER TABLE ${tabela}\\s+DROP CONSTRAINT IF EXISTS ${nome}`, 'i'),
            );
            const add = CODIGO.search(
                new RegExp(`ALTER TABLE ${tabela}\\s+ADD CONSTRAINT ${nome} CHECK`, 'i'),
            );
            expect(drop).toBeGreaterThan(-1);
            expect(add).toBeGreaterThan(drop);
        }
    });

    it('a lista mais recente do diretório é o catálogo do código (permissão nova sem migration falha)', () => {
        const comCheck = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort()
            .filter((f) =>
                /CHECK\s*\(\s*permission\s+IN/i.test(
                    semComentarios(readFileSync(path.join(__dirname, f), 'utf8')),
                ),
            );
        const ultima = comCheck[comCheck.length - 1];
        expect(ultima).toBeDefined();
        const listas = listasDoCheck(
            semComentarios(readFileSync(path.join(__dirname, ultima ?? ''), 'utf8')),
        );
        expect(listas.length).toBeGreaterThan(0);
        for (const lista of listas) expect(lista).toEqual([...PERMISSION_CATALOG].sort());
    });

    it('só o Administrador ganha a permissão nova, idempotente', () => {
        const seeds = [...CODIGO.matchAll(/INSERT INTO app_role_permission[\s\S]*?;/gi)].map(
            (m) => m[0],
        );
        expect(seeds).toHaveLength(1);
        const seed = seeds[0] ?? '';
        expect(seed).toContain("'sispag:aprovar_destino'");
        expect(seed).toMatch(/lower\(r\.nome\)\s*=\s*'administrador'/i);
        expect(seed).toMatch(/ON CONFLICT DO NOTHING/i);
        expect(CODIGO).not.toMatch(/INSERT INTO user_permission/i);
    });

    it('a trilha ganha evento GRAVACAO|APROVACAO (default GRAVACAO) e a referência da gravação aprovada', () => {
        expect(CODIGO).toMatch(
            /ALTER TABLE lote_pagamento_item_destino_audit\s+ADD COLUMN IF NOT EXISTS evento TEXT NOT NULL DEFAULT 'GRAVACAO'/i,
        );
        expect(CODIGO).toMatch(
            /ALTER TABLE lote_pagamento_item_destino_audit\s+ADD COLUMN IF NOT EXISTS aprova_audit_id UUID NULL/i,
        );
        expect(CODIGO).toMatch(/evento IN \('GRAVACAO', 'APROVACAO'\)/i);
        expect(CODIGO).toMatch(/evento <> 'APROVACAO' OR aprova_audit_id IS NOT NULL/i);
    });

    it('não toca linhas da trilha nem dos itens (a trilha é só-inclusão)', () => {
        expect(CODIGO).not.toMatch(/UPDATE\s+lote_pagamento_item_destino_audit/i);
        expect(CODIGO).not.toMatch(/DELETE\s+FROM/i);
        expect(CODIGO).not.toMatch(/UPDATE\s+lote_pagamento_item\b/i);
        expect(CODIGO).not.toMatch(/DROP TABLE/i);
    });

    it('todo CREATE é IF NOT EXISTS (rodar duas vezes não falha)', () => {
        const creates = CODIGO.match(/CREATE (UNIQUE )?(TABLE|INDEX)[^\n]*/gi) ?? [];
        for (const create of creates) expect(create).toMatch(/IF NOT EXISTS/i);
    });
});
