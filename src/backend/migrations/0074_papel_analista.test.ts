import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PERMISSION, isPermission } from '../domain/interface/auth/Permission.js';

/**
 * 0074 — papel `Analista`. Asserções sobre o FONTE (o `MigrationRunner` usa `import.meta` e não
 * roda sob Jest), no padrão de `0071_app_user_auth_user_id.test.ts`.
 */
const SQL = readFileSync(path.join(__dirname, '0074_papel_analista.sql'), 'utf8');

const CODIGO = SQL.split('\n')
    .map((linha) => linha.replace(/--.*$/, ''))
    .join('\n');

/** As permissões que o `INSERT` do pacote lista, na ordem do arquivo. */
const pacote = (): string[] => {
    const valores = CODIGO.match(/\(VALUES([\s\S]*?)\) AS p\(permission\)/i)?.[1] ?? '';
    return [...valores.matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
};

describe('migration 0074 — papel Analista', () => {
    it('semeia o papel de forma idempotente', () => {
        expect(CODIGO).toMatch(/INSERT INTO app_role \(nome, descricao\)[\s\S]*'Analista'/i);
        expect(CODIGO).toMatch(/ON CONFLICT \(lower\(nome\)\) DO NOTHING/i);
        expect(CODIGO).toMatch(/INSERT INTO app_role_permission[\s\S]*ON CONFLICT DO NOTHING/i);
    });

    it('o pacote é permutas e recebimentos com escrita, mais SISPAG só em leitura', () => {
        expect(pacote().sort()).toEqual(
            [
                PERMISSION.PERMUTAS_VER,
                PERMISSION.PERMUTAS_EXECUTAR,
                PERMISSION.SISPAG_VER,
                PERMISSION.RECEBIMENTOS_VER,
                PERMISSION.RECEBIMENTOS_EXECUTAR,
            ].sort(),
        );
    });

    it('não dá sispag:executar nem as permissões avulsas e administrativas', () => {
        const dado = pacote();
        for (const fora of [
            PERMISSION.SISPAG_EXECUTAR,
            PERMISSION.SISPAG_APROVAR_DESTINO,
            PERMISSION.OPERACAO_VER,
            PERMISSION.METRICAS_VER,
            PERMISSION.USUARIOS_GERENCIAR,
        ]) {
            expect(dado).not.toContain(fora);
        }
    });

    it('só usa valores do catálogo (o CHECK recusaria o resto)', () => {
        for (const permissao of pacote()) expect(isPermission(permissao)).toBe(true);
    });

    it('é só dado: não mexe em esquema nem em usuários', () => {
        expect(CODIGO).not.toMatch(/\b(ALTER|CREATE|DROP)\b/i);
        expect(CODIGO).not.toMatch(/UPDATE\s+app_user/i);
    });
});
