import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import MigrationFiles from './MigrationFiles.js';

/**
 * Diretório do próprio módulo: a árvore-fonte sob `tsx` (`npm run migrate`), `dist/migrations/`
 * sob `node dist/index.js` (o boot em produção). O segundo só tem os `.sql` porque o
 * `npm run build` os copia para lá (`copy-to-dist.ts`).
 */
const MIGRATIONS_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Limites de execução prefixados a TODA migration (Regis-Review 2026-09-08,
 * card `lock-timeout-not-valid`, P1 convergente de Availability + Performance).
 *
 * `SET LOCAL` só vale dentro de uma transação, e é por isso que os limites são
 * concatenados ao texto da migration em vez de virem numa chamada separada: o
 * simple-query protocol envolve o multi-statement inteiro numa transação
 * implícita, então prefixar aqui é o que os faz valer para o DDL que vem a
 * seguir. Numa chamada à parte eles seriam descartados antes de servirem para
 * alguma coisa.
 *
 * Sem eles, um `ALTER TABLE` que precise de ACCESS EXCLUSIVE espera
 * INDEFINIDAMENTE por uma sessão concorrente — e como o `BootMigrator` roda
 * antes do `app.listen()` (ver `index.ts`), a instância nova fica sem responder
 * `/health` durante toda a espera. Com o limite, a espera vira uma falha alta e
 * o Render mantém a versão anterior no ar, que é o desfecho certo.
 */
const LIMITES_DE_EXECUCAO = [
    "SET LOCAL lock_timeout = '30s';",
    "SET LOCAL statement_timeout = '10min';",
].join('\n');

/**
 * MigrationRunner — runner simples (convenção inaugurada pela Fatia 1 de
 * Permutas). Aplica os arquivos `migrations/NNNN_*.sql` em ordem lexicográfica,
 * registrando os já aplicados em `schema_migrations` (idempotente).
 *
 * Sem framework de migration externo nesta fatia — só `fs` + o
 * `PostgreeDatabaseClient` existente. SQL DDL é estático (não há input externo),
 * por isso roda como statement cru (não passa pelo SqlBuilder de `$nome`).
 *
 * **A listagem NÃO é recursiva, e isso é load-bearing.** Scripts de reverse
 * vivem em `migrations/rollbacks/*.rollback.sql` justamente porque um arquivo
 * `.sql` solto neste diretório seria aplicado no boot seguinte — um rollback
 * auto-aplicável desfaria a própria migration que acabou de subir. Ver
 * `rollbacks/README.md` e a Regis-Review 2026-09-08 (card `rollback-0054`).
 * A regra mora em `MigrationFiles`, compartilhada com a cópia do build.
 *
 * **Diretório sem migração é erro, não "esquema em dia".** Foi assim que o boot
 * passou semanas sem migrar nada em produção (incidente 2026-09-23).
 */
@injectable()
export default class MigrationRunner {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
        @inject(MigrationFiles)
        private migrationFiles: MigrationFiles,
    ) {}

    public run = async (): Promise<string[]> => {
        await this.databaseClient.insert(
            `CREATE TABLE IF NOT EXISTS schema_migrations (
                name TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )`,
        );

        const appliedRows = await this.databaseClient.selectMany(
            'SELECT name FROM schema_migrations',
        );
        const applied = new Set(appliedRows.map((r) => String(r.name)));

        const files = this.migrationFiles.listOrFail(MIGRATIONS_DIR);

        const newlyApplied: string[] = [];
        for (const file of files) {
            if (applied.has(file)) continue;
            const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            await this.databaseClient.insert(`${LIMITES_DE_EXECUCAO}\n${sql}`);
            await this.databaseClient.insert(
                'INSERT INTO schema_migrations (name) VALUES ($name)',
                { name: file },
            );
            newlyApplied.push(file);
        }
        return newlyApplied;
    };
}
