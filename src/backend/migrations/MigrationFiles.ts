import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { injectable } from 'tsyringe';

/**
 * MigrationFiles — a definição ÚNICA de "o que é uma migração": os `NNNN_*.sql` soltos no
 * diretório, em ordem lexicográfica. Usada pelo `MigrationRunner` (para aplicar) e pelo passo de
 * build `copy-to-dist.ts` (para levar os arquivos até `dist/`), para que os dois nunca discordem.
 *
 * ## Por que o build precisa copiar
 *
 * Em produção o servidor roda `node dist/index.js`, e o runner procura os `.sql` ao lado de si
 * mesmo — em `dist/migrations/`. O `tsc` só emite `.js`: sem a cópia, o diretório não tinha um
 * `.sql` sequer, o `BootMigrator` concluía "esquema em dia" e NUNCA migrou no boot. Quem aplicava
 * as migrações de fato eram os crons do GitHub Actions (`npm run migrate`, via tsx, lendo a
 * árvore-fonte) — e o código novo ficava no ar contra o esquema velho até o próximo cron. Foi o
 * que esvaziou as abas de lotes do SISPAG em 2026-09-23 (a `0061` subiu ~25 min depois do deploy).
 *
 * ## Vazio é erro
 *
 * `listOrFail` lança quando não acha nada. Um diretório de migrações vazio nunca é legítimo aqui
 * (há dezenas delas), e aceitá-lo em silêncio foi exatamente como o problema acima ficou invisível.
 *
 * ## Não recursivo, de propósito
 *
 * `migrations/rollbacks/*.rollback.sql` NÃO é migração: aplicado no boot, desfaria a migração que
 * acabou de subir (ver `rollbacks/README.md`). Só entram arquivos do nível de cima.
 */
@injectable()
export default class MigrationFiles {
    /** Nomes dos `.sql` do nível de cima de `dir`, ordenados. Subdiretórios ficam de fora. */
    public list = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
            .map((entry) => entry.name)
            .sort();

    /** Igual a `list`, mas lança quando não há migração nenhuma em `dir`. */
    public listOrFail = (dir: string): string[] => {
        const files = this.list(dir);
        if (files.length === 0) {
            throw new Error(
                `nenhuma migração (*.sql) encontrada em ${dir} — o build copiou os arquivos? ` +
                    '(ver migrations/copy-to-dist.ts)',
            );
        }
        return files;
    };

    /** Copia as migrações de `sourceDir` para `targetDir` (criando-o) e devolve os nomes. */
    public copy = (sourceDir: string, targetDir: string): string[] => {
        const files = this.listOrFail(sourceDir);
        mkdirSync(targetDir, { recursive: true });
        for (const file of files) {
            copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
        }
        return files;
    };
}
