import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION } from '../domain/interface/auth/Permission.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * 0079 — `sispag:conferir` e `sispag:cadastro` (ADR-0063). Asserções sobre o FONTE (padrão da
 * 0068/0075). O comportamento contra um Postgres de verdade está na integração da 0078.
 */
const NOME = '0079_permissoes_sispag_conferir_cadastro.sql';

/** O catálogo no dia da 0079, CONGELADO (a 0080 trocou as três avulsas por uma). */
const CATALOGO_DA_0079: readonly string[] = [
    'permutas:ver',
    'permutas:executar',
    'sispag:ver',
    'sispag:executar',
    'sispag:excecao',
    'sispag:conferir',
    'sispag:cadastro',
    'recebimentos:ver',
    'recebimentos:executar',
    'operacao:ver',
    'metricas:ver',
    'usuarios:gerenciar',
];

const semComentarios = (texto: string): string =>
    texto
        .split('\n')
        .map((linha) => linha.replace(/--.*$/, ''))
        .join('\n');

const CODIGO = semComentarios(readFileSync(path.join(__dirname, NOME), 'utf8'));

const listasDoCheck = (codigo: string): string[][] =>
    [...codigo.matchAll(/CHECK\s*\(\s*permission\s+IN\s*\(([^)]*)\)\s*\)/gi)].map((m) =>
        [...(m[1] ?? '').matchAll(/'([^']+)'/g)].map((v) => v[1] ?? '').sort(),
    );

describe('migration 0079 — permissões sispag:conferir e sispag:cadastro (ADR-0063)', () => {
    it('troca os DOIS CHECK de permission pelo catálogo atual do código', () => {
        const listas = listasDoCheck(CODIGO);
        expect(listas).toHaveLength(2);
        for (const lista of listas) {
            expect(lista).toEqual([...CATALOGO_DA_0079].sort());
            expect(lista).toContain('sispag:conferir');
            expect(lista).toContain('sispag:cadastro');
            // Todas as antigas continuam aceitas.
            expect(lista).toContain('sispag:excecao');
            expect(lista).toContain(PERMISSION.USUARIOS_GERENCIAR);
        }
    });

    it('DROP antes do ADD em cada tabela (idempotente)', () => {
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

    it('nenhuma concessão (gap Q8): sem INSERT, UPDATE ou DELETE', () => {
        expect(CODIGO).not.toMatch(/INSERT INTO/i);
        expect(CODIGO).not.toMatch(/DELETE FROM/i);
        expect(CODIGO).not.toMatch(/UPDATE\s+\w+\s+SET/i);
    });

    it('a 0080 (ADR-0065) é quem traz a lista vigente depois desta', () => {
        const comCheck = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort()
            .filter((f) =>
                /CHECK\s*\(\s*permission\s+IN/i.test(
                    semComentarios(readFileSync(path.join(__dirname, f), 'utf8')),
                ),
            );
        expect(comCheck[comCheck.length - 1] >= NOME).toBe(true);
    });

    it('é migração de verdade (copiada ao dist/) e única com o número 0079', () => {
        expect(new MigrationFiles().list(__dirname)).toContain(NOME);
        expect(readdirSync(__dirname).filter((f) => /^0079_.*\.sql$/.test(f))).toEqual([NOME]);
    });
});
