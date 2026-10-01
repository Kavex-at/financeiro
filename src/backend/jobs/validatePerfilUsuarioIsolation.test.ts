import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * O script de equivalência do perfil (`validate-perfil-usuario-v1.ts`) roda contra o banco de
 * PRODUÇÃO. Estas asserções sobre o FONTE garantem que ele continua só leitura e longe do Conexos:
 * um `bootstrapAppContainer()` ali rodaria migrations, e qualquer client do Conexos pode gravar a
 * sessão de outro usuário no slot do robô (`columbia-default`).
 */
const FONTE = readFileSync(join(__dirname, 'validate-perfil-usuario-v1.ts'), 'utf8');
const IMPORTS = FONTE.split('\n').filter((l) => /^\s*import\b/.test(l));
/** O código sem comentários: a docstring cita `bootstrapAppContainer()` justamente para proibi-lo. */
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

describe('validate-perfil-usuario-v1 — isolamento', () => {
    it('não importa ConexosClient, ConexosSessionResolver nem bootstrapAppContainer', () => {
        for (const proibido of [
            /ConexosClient/,
            /ConexosSessionResolver/,
            /appContainer/,
            /bootstrapAppContainer/,
            /client\/Conexos/,
        ]) {
            expect(IMPORTS.filter((l) => proibido.test(l))).toEqual([]);
        }
        expect(CODIGO).not.toMatch(/bootstrapAppContainer\(/);
        expect(CODIGO).not.toMatch(/container\.resolve\(/);
    });

    it('conecta com pg.Pool direto e roda tudo em BEGIN TRANSACTION READ ONLY, terminando em ROLLBACK', () => {
        expect(FONTE).toMatch(/from 'pg'/);
        expect(FONTE).toMatch(/new Pool\(/);
        expect(FONTE).toMatch(/BEGIN TRANSACTION READ ONLY/);
        expect(FONTE).toMatch(/ROLLBACK/);
        expect(CODIGO).not.toMatch(/\bCOMMIT\b/);
    });

    it('não escreve: nenhum INSERT/UPDATE/DELETE no texto do script', () => {
        expect(CODIGO).not.toMatch(
            /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE)\b/i,
        );
    });

    it('nunca imprime a string de conexão', () => {
        expect(FONTE).not.toMatch(/console\.\w+\([^)]*(lerConexao|connectionString)/);
    });
});
