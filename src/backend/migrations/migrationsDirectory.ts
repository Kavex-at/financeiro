import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Diretório onde vivem os arquivos `NNNN_*.sql`, resolvido a partir do módulo.
 *
 * Isolado num módulo só para isto porque `import.meta` não compila sob o ts-jest
 * do projeto (`module: 'CommonJS'`, ver `jest.config.cjs`): esta única linha
 * mantinha o `MigrationRunner` INTEIRO fora do alcance dos testes — era o motivo
 * de o `BootMigrator` falar com ele por um token em vez de importá-lo. Com a
 * dependência num módulo à parte, o teste a substitui por `jest.mock` e o que
 * importa no runner (lock, transação, ordem de aplicação) passa a ser testável.
 *
 * Aponta para a árvore-fonte sob `tsx` (`npm run migrate`) e para `dist/migrations/` sob
 * `node dist/index.js` (o boot em produção). O segundo só tem os `.sql` porque o
 * `npm run build` os copia para lá (`copy-to-dist.ts`).
 */
export const MIGRATIONS_DIR = path.dirname(fileURLToPath(import.meta.url));
