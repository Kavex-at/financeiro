import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Trava a classe de defeito do BE-09 em zero (card `testability-3`).
 *
 * `npm run lint` era `npx biome check .` e saía **0 em silêncio** quando `node_modules` não
 * existia — o gate reportava verde sem examinar uma linha. Em CI não mordia (o `npm ci` vem
 * antes), mas mordia em todo worktree novo, que é o fluxo obrigatório do pipe.
 *
 * A correção foi trocar para o binário local. Este teste existe para que ela não seja desfeita:
 * `npx` num script de gate transforma "ferramenta ausente" em sucesso silencioso, que é o pior
 * modo de falha possível para um gate.
 */
const raiz = join(__dirname, '..', '..');

const lerScripts = (caminho: string): Record<string, string> => {
    const pkg = JSON.parse(readFileSync(join(raiz, caminho), 'utf8')) as {
        scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
};

/** Scripts que compõem os green criteria do AutoLoopRunner, mais o build. */
const SCRIPTS_DE_GATE = ['lint', 'lint:fix', 'typecheck', 'test', 'build'];

describe('scripts de gate não podem resolver binário por npx (BE-09)', () => {
    for (const caminho of ['src/backend/package.json', 'src/frontend/package.json']) {
        describe(caminho, () => {
            const scripts = lerScripts(caminho);

            it('nenhum script de gate começa com npx', () => {
                const infratores = SCRIPTS_DE_GATE.filter((nome) =>
                    /(^|&&\s*)npx\s/.test(scripts[nome] ?? ''),
                ).map((nome) => `${nome}: ${scripts[nome]}`);

                expect(infratores).toEqual([]);
            });

            it('nenhum script do pacote usa npx em lugar nenhum', () => {
                const infratores = Object.entries(scripts)
                    .filter(([, comando]) => /(^|&&\s*|\|\|\s*)npx\s/.test(comando))
                    .map(([nome, comando]) => `${nome}: ${comando}`);

                expect(infratores).toEqual([]);
            });
        });
    }
});
