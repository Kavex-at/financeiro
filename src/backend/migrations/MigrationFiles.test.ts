import 'reflect-metadata';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import MigrationFiles from './MigrationFiles';

/**
 * Incidente 2026-09-23: o `tsc` não leva `.sql` para `dist/`, o `BootMigrator` achava ZERO
 * migrações, dizia "esquema em dia" e o código da `0061` ficou no ar sem a coluna — as abas de
 * lotes do SISPAG vieram vazias até um cron aplicar a migração.
 */
describe('MigrationFiles', () => {
    let tmp: string;
    const files = new MigrationFiles();

    beforeEach(() => {
        tmp = mkdtempSync(path.join(os.tmpdir(), 'migration-files-'));
    });

    afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    const touch = (rel: string, content = '') => {
        const full = path.join(tmp, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, content);
    };

    describe('list', () => {
        it('devolve só os .sql do nível de cima, em ordem lexicográfica', () => {
            touch('0002_b.sql');
            touch('0001_a.sql');
            touch('runMigrations.ts');
            touch('rollbacks/0001_a.rollback.sql');

            expect(files.list(tmp)).toEqual(['0001_a.sql', '0002_b.sql']);
        });

        it('não trata um diretório chamado *.sql como migração', () => {
            mkdirSync(path.join(tmp, 'estranho.sql'));
            touch('0001_a.sql');

            expect(files.list(tmp)).toEqual(['0001_a.sql']);
        });
    });

    describe('listOrFail', () => {
        it('lança quando o diretório não tem migração nenhuma (o dist/ sem os .sql)', () => {
            touch('runMigrations.js');

            expect(() => files.listOrFail(tmp)).toThrow(/nenhuma migração/);
        });
    });

    describe('copy', () => {
        it('copia as migrações para o destino, criando-o, e deixa os rollbacks de fora', () => {
            const src = path.join(tmp, 'src');
            const dist = path.join(tmp, 'dist', 'migrations');
            touch('src/0001_a.sql', 'CREATE TABLE a ();');
            touch('src/0002_b.sql', 'CREATE TABLE b ();');
            touch('src/rollbacks/0002_b.rollback.sql', 'DROP TABLE b;');

            const copied = files.copy(src, dist);

            expect(copied).toEqual(['0001_a.sql', '0002_b.sql']);
            expect(readFileSync(path.join(dist, '0002_b.sql'), 'utf8')).toBe('CREATE TABLE b ();');
            expect(existsSync(path.join(dist, 'rollbacks'))).toBe(false);
            expect(files.list(dist)).toEqual(files.list(src));
        });

        it('falha (e não cria o destino) quando a origem está vazia', () => {
            const dist = path.join(tmp, 'dist');

            expect(() => files.copy(tmp, dist)).toThrow(/nenhuma migração/);
            expect(existsSync(dist)).toBe(false);
        });
    });

    describe('no repositório', () => {
        it('o diretório real de migrações não está vazio', () => {
            expect(files.listOrFail(__dirname).length).toBeGreaterThan(0);
        });

        it('o `npm run build` copia as migrações DEPOIS do tsc', () => {
            // Sem este passo o `dist/` sai sem `.sql` e o BootMigrator volta a não migrar nada.
            const pkg = JSON.parse(
                readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
            );
            expect(pkg.scripts.build).toMatch(/\btsc\b.*&&.*migrations\/copy-to-dist\.ts/);
        });
    });
});
