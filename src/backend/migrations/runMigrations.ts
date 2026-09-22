import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../domain/client/database/PostgreeDatabaseClient.js';
import MigrationFiles from './MigrationFiles.js';
import { MIGRATIONS_DIR } from './migrationsDirectory.js';

/**
 * Chave de advisory lock que serializa a APLICAÇÃO de migrações entre processos.
 *
 * Distinta de todas as outras em uso — ingestão (`726354819`/`726354820`),
 * permutas (`918273645`), formação de lotes (`615243789`), poller de retorno
 * (`528417963`) e a do `BootMigrator` (`314159265`). Ser distinta da do
 * `BootMigrator` é OBRIGATÓRIO: ele já segura a dele numa sessão e chama este
 * runner, que pega a sua em OUTRA sessão — a mesma chave seria auto-deadlock.
 * Com chaves diferentes e ordem de aquisição sempre igual (boot → runner) não
 * há ciclo possível.
 */
export const MIGRATION_ADVISORY_LOCK_KEY = 271828182;

/**
 * Espera máxima pelo lock antes de desistir. `lock_timeout` vale para advisory
 * locks, então a espera é limitada pelo próprio Postgres — sem laço de
 * `setTimeout` no processo.
 *
 * 5min cobre uma migração longa de outra instância sem esconder uma travada:
 * estourado o prazo, o Postgres aborta com `canceling statement due to lock
 * timeout` e o boot/cron falha ALTO, que é o desfecho certo.
 */
const ESPERA_MAXIMA_PELO_LOCK = "SET LOCAL lock_timeout = '5min'";

/**
 * Limites de execução aplicados a TODA migration (Regis-Review 2026-09-08,
 * card `lock-timeout-not-valid`, P1 convergente de Availability + Performance).
 *
 * Sem eles, um `ALTER TABLE` que precise de ACCESS EXCLUSIVE espera
 * INDEFINIDAMENTE por uma sessão concorrente — e como o `BootMigrator` roda
 * antes do `app.listen()` (ver `index.ts`), a instância nova fica sem responder
 * `/health` durante toda a espera. Com o limite, a espera vira uma falha alta e
 * o Render mantém a versão anterior no ar.
 *
 * `SET LOCAL` só vale dentro de uma transação. Antes eram CONCATENADOS ao texto
 * da migration para pegar carona na transação implícita do multi-statement;
 * agora a transação é EXPLÍCITA (`withTransaction`), então podem ir como
 * statements próprios — e valem igualmente para o `INSERT` em
 * `schema_migrations` que fecha a transação.
 */
const LIMITES_DE_EXECUCAO = "SET LOCAL lock_timeout = '30s'; SET LOCAL statement_timeout = '10min'";

/**
 * MigrationRunner — runner simples (convenção inaugurada pela Fatia 1 de
 * Permutas). Aplica os arquivos `migrations/NNNN_*.sql` em ordem lexicográfica,
 * registrando os já aplicados em `schema_migrations` (idempotente).
 *
 * Sem framework de migration externo nesta fatia — só `fs` + o
 * `PostgreeDatabaseClient` existente. SQL DDL é estático (não há input externo),
 * por isso roda como statement cru (não passa pelo SqlBuilder de `$nome`).
 *
 * ## Por que lock + transação (e não dois statements soltos)
 *
 * Este runner tem TRÊS gatilhos independentes: o `bootstrapAppContainer`, o
 * `BootMigrator` do `index.ts` e o passo explícito `npm run migrate` de 6 crons
 * em `.github/workflows/`. O reaper roda de 15 em 15 minutos, então um deploy
 * caindo junto de um cron é rotina, não hipótese. Sem serialização, os dois
 * leem `schema_migrations` sem a migração nova e aplicam o MESMO arquivo duas
 * vezes — e migração aplicada duas vezes só é inofensiva quando é idempotente,
 * o que ninguém garante arquivo a arquivo.
 *
 * E o DDL e o `INSERT` de registro eram dois statements sem transação: um crash
 * entre eles deixava a migração APLICADA e NÃO REGISTRADA, para ser reaplicada
 * no boot seguinte. Agora os dois commitam juntos ou nenhum dos dois acontece.
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
        await this.ensureControlTable();

        const appliedRows = await this.databaseClient.selectMany(
            'SELECT name FROM schema_migrations',
        );
        const applied = new Set(appliedRows.map((r) => String(r.name)));

        const files = this.migrationFiles.listOrFail(MIGRATIONS_DIR);

        const newlyApplied: string[] = [];
        for (const file of files) {
            if (applied.has(file)) continue;
            const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            if (await this.applyOne(file, sql)) newlyApplied.push(file);
        }
        return newlyApplied;
    };

    /**
     * Cria `schema_migrations` sob o lock. `CREATE TABLE IF NOT EXISTS` é
     * idempotente mas NÃO é livre de corrida: dois processos criando a mesma
     * tabela ao mesmo tempo colidem no catálogo (`duplicate key value violates
     * unique constraint "pg_type_typname_nsp_index"`). Serializado, some.
     */
    private ensureControlTable = async (): Promise<void> => {
        await this.databaseClient.withTransaction(async (tx) => {
            await this.acquireLock(tx);
            await tx.insert(
                `CREATE TABLE IF NOT EXISTS schema_migrations (
                    name TEXT PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`,
            );
        });
    };

    /**
     * Aplica UMA migração: DDL e registro na MESMA transação, sob o lock.
     * Devolve `false` quando outro processo aplicou o arquivo enquanto este
     * esperava o lock — daí a releitura de `schema_migrations` JÁ DENTRO da
     * transação, e não só no `run`.
     *
     * Uma transação por arquivo (e não uma para o lote inteiro): assim uma
     * migração que falha não desfaz as que já passaram, e a ordem lexicográfica
     * continua garantida porque o lock é segurado durante todo o arquivo.
     */
    private applyOne = async (file: string, sql: string): Promise<boolean> => {
        return this.databaseClient.withTransaction(async (tx) => {
            await this.acquireLock(tx);

            const jaAplicada = await tx.selectFirst<{ name: string }>(
                'SELECT name FROM schema_migrations WHERE name = $name',
                { name: file },
            );
            if (jaAplicada) return false;

            await tx.insert(LIMITES_DE_EXECUCAO);
            await tx.insert(sql);
            await tx.insert('INSERT INTO schema_migrations (name) VALUES ($name)', { name: file });
            return true;
        });
    };

    /**
     * `pg_advisory_xact_lock` (transacional) e não a variante de sessão: o
     * Postgres o libera sozinho no COMMIT/ROLLBACK, então nem crash nem exceção
     * deixam o lock preso — e o pooler não corre o risco de rotear um
     * `pg_advisory_unlock` para outro backend.
     */
    private acquireLock = async (tx: TransactionClient): Promise<void> => {
        await tx.insert(ESPERA_MAXIMA_PELO_LOCK);
        // Cast explícito: `pg_advisory_xact_lock` tem sobrecarga `(bigint)` e
        // `(int, int)`; com o parâmetro sem tipo a resolução fica ambígua.
        await tx.selectMany('SELECT pg_advisory_xact_lock($lockKey::bigint)', {
            lockKey: MIGRATION_ADVISORY_LOCK_KEY,
        });
    };
}
