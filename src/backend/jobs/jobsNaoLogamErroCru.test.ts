import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regis-Review 2026-09-29 (`security-1`): nenhum job/sonda loga o erro INTEIRO.
 *
 * Um AxiosError cru carrega `config.data` — numa falha de login do Conexos, é o corpo do login com
 * a SENHA. `console.error(e)` imprime isso no log do GitHub Actions ou do terminal. O padrão certo é
 * logar só a mensagem, redigida (`redactErrorMessage((e as Error).message)`).
 *
 * Checagem sobre o FONTE: `console.error(<identificador>)` sozinho, ou com o erro como argumento
 * solto depois de um texto, reprova.
 */
const DIR = __dirname;
const ERRO_CRU = /console\.(?:error|log|warn)\(\s*(?:[^()]*,\s*)?(?:e|err|error|erro)\s*\)/;

describe('jobs não logam o erro cru', () => {
    const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    it('existe o que checar', () => {
        expect(arquivos.length).toBeGreaterThan(10);
    });

    it('nenhum job faz console.error(e) — o AxiosError de login carrega a senha', () => {
        const infratores = arquivos.flatMap((f) =>
            readFileSync(join(DIR, f), 'utf8')
                .split('\n')
                .map((linha, i) => ({ linha, n: i + 1 }))
                .filter(({ linha }) => ERRO_CRU.test(linha))
                .map(({ n }) => `${f}:${n}`),
        );
        expect(infratores).toEqual([]);
    });
});
