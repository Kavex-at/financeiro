import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardas do diretório de migrations — Regis-Review 2026-09-08, cards
 * `rollback-0054` e `lock-timeout-not-valid`.
 *
 * Estes testes NÃO importam o `MigrationRunner`: ele usa `import.meta`, que é
 * incompatível com o Jest, e é por isso que o amarramento do token vive no
 * `index.ts` (ver a docstring de `start`). Então a verificação é feita sobre o
 * conteúdo do diretório e do fonte — que é exatamente onde moram os dois
 * defeitos que se quer impedir.
 */

const MIGRATIONS_DIR = path.join(__dirname);
const ROLLBACKS_DIR = path.join(__dirname, 'rollbacks');

describe('migrations — segurança do diretório', () => {
    /**
     * O defeito que este teste impede é silencioso e caro: o runner faz
     * `readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'))`. Um script
     * de reverse salvo aqui como `.sql` seria aplicado no boot seguinte,
     * desfazendo a migration que acabou de subir E registrando-se em
     * `schema_migrations` como se fosse mais um passo para a frente — de modo
     * que nem uma segunda tentativa consertaria.
     */
    it('nenhum script de reverse mora entre as migrations aplicáveis', () => {
        const aplicaveis = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

        const suspeitos = aplicaveis.filter((f) => /rollback|reverse|down|revert/i.test(f));

        expect(suspeitos).toEqual([]);
    });

    it('o reverse da 0054 existe, fora do alcance do runner', () => {
        const noSubdiretorio = readdirSync(ROLLBACKS_DIR);
        expect(noSubdiretorio).toContain('0054_estado_ja_permutado.rollback.sql');

        // `readdirSync` não é recursivo: o runner enxerga a pasta, não o conteúdo.
        const vistoPeloRunner = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
        expect(vistoPeloRunner).not.toContain('0054_estado_ja_permutado.rollback.sql');
    });

    /**
     * O reverse só é possível porque o `motivo_bloqueio` sobrevive à 0054. Se
     * alguém um dia acrescentar um `UPDATE ... SET motivo_bloqueio` à migration,
     * o reverse deixa de ser reconstruível e este teste tem de falhar antes que
     * a migration chegue a produção.
     */
    it('a 0054 não altera motivo_bloqueio — é o que torna o reverse determinístico', () => {
        const sql = readFileSync(path.join(MIGRATIONS_DIR, '0054_estado_ja_permutado.sql'), 'utf8');

        expect(sql).not.toMatch(/SET\s+motivo_bloqueio/i);
    });
});

describe('MigrationRunner — limites de execução', () => {
    /**
     * Asserção sobre o FONTE, não sobre o comportamento, porque o módulo não é
     * importável sob Jest (`import.meta`). É uma guarda de regressão barata para
     * uma linha que, se sumir, só se manifesta num deploy travado às 2h da
     * manhã: sem `lock_timeout`, um `ALTER TABLE` esperando lock trava o boot
     * indefinidamente, e o `/health` não responde porque o `app.listen()` vem
     * depois do `BootMigrator`.
     */
    it('prefixa lock_timeout e statement_timeout a toda migration', () => {
        const fonte = readFileSync(path.join(MIGRATIONS_DIR, 'runMigrations.ts'), 'utf8');

        expect(fonte).toMatch(/SET LOCAL lock_timeout/);
        expect(fonte).toMatch(/SET LOCAL statement_timeout/);
        expect(fonte).toMatch(/LIMITES_DE_EXECUCAO/);
    });
});
