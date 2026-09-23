import 'reflect-metadata';
import path from 'node:path';
import { container } from 'tsyringe';
import MigrationFiles from './MigrationFiles.js';

/**
 * Passo final do `npm run build`: copia `migrations/*.sql` para `dist/migrations/`, onde o
 * `MigrationRunner` compilado os procura no boot. O `tsc` não copia `.sql` — sem este passo o
 * `BootMigrator` não acha nada e não migra (ver `MigrationFiles`).
 *
 * Caminhos relativos ao diretório do pacote (`src/backend`), que é o cwd de todo script do npm.
 * Falhar aqui falha o build — e o Render mantém a versão anterior no ar.
 */
const source = path.resolve('migrations');
const target = path.resolve('dist', 'migrations');

try {
    const copied = container.resolve(MigrationFiles).copy(source, target);
    console.log(`[build] ${copied.length} migração(ões) copiada(s) para ${target}`);
} catch (error) {
    console.error(
        '[build] falha ao copiar as migrações:',
        error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
}
