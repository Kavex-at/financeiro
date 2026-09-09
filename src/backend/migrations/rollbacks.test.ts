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

    it('todo reverse tem a migration correspondente, e vice-versa', () => {
        // Um reverse órfão é pior que nenhum: promete um caminho de volta que não
        // corresponde a nada. E uma migration destrutiva sem reverse é a dívida
        // que a Regis-Review cobrou (card `rollback-0054`).
        const reverses = readdirSync(ROLLBACKS_DIR)
            .filter((f) => f.endsWith('.rollback.sql'))
            .map((f) => f.replace('.rollback.sql', '.sql'));
        const aplicaveis = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

        expect(reverses.sort()).toEqual(
            ['0054_estado_ja_permutado.sql', '0055_guarda_estado_colapsado.sql'].sort(),
        );
        for (const alvo of reverses) {
            expect(aplicaveis).toContain(alvo);
        }
    });

    /**
     * A 0055 proíbe exatamente as combinações que o reverse da 0054 precisa
     * escrever para recolapsar. Se o §0 do reverse deixar de derrubar essas
     * travas, o rollback passa a falhar no meio — e falharia justamente na hora
     * em que alguém depende dele.
     */
    it('o reverse da 0054 derruba as travas da 0055 antes de recolapsar', () => {
        const reverse = readFileSync(
            path.join(ROLLBACKS_DIR, '0054_estado_ja_permutado.rollback.sql'),
            'utf8',
        );

        const posGuardaAdto = reverse.indexOf('permuta_adiantamento_sem_estado_colapsado');
        const posGuardaSnapshot = reverse.indexOf(
            'permuta_candidata_snapshot_sem_status_colapsado',
        );
        const posRecolapso = reverse.indexOf("SET status = 'bloqueada'");

        expect(posGuardaAdto).toBeGreaterThan(-1);
        expect(posGuardaSnapshot).toBeGreaterThan(-1);
        expect(posGuardaAdto).toBeLessThan(posRecolapso);
        expect(posGuardaSnapshot).toBeLessThan(posRecolapso);
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
