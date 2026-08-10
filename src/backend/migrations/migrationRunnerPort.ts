/**
 * Port do runner de migrações — token + interface, DELIBERADAMENTE num módulo à parte.
 *
 * `runMigrations.ts` usa `import.meta.url` para achar o diretório dos `.sql`, e `import.meta` é
 * incompatível com a transformação CJS do Jest (o mesmo motivo pelo qual o harness e2e não importa o
 * bootstrap real). Injetar a CLASSE arrastaria esse `import.meta` para dentro de qualquer teste que
 * tocasse o `BootMigrator`, deixando o boot — um caminho crítico — sem cobertura.
 *
 * Com o token, o `BootMigrator` depende só desta interface e o amarramento
 * token → `MigrationRunner` vive no `index.ts`, que os testes não importam.
 */
export const MIGRATION_RUNNER_TOKEN = Symbol('MigrationRunnerInterface');

export interface MigrationRunnerInterface {
    /** Aplica as migrações pendentes em ordem lexicográfica; devolve os nomes aplicados. */
    run: () => Promise<string[]>;
}
