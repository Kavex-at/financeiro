import { readFileSync } from 'node:fs';
import path from 'node:path';
import SeedAdminConfig, { MissingSeedAdminEnvError } from './SeedAdminConfig.js';

const SENHA = 'uma-senha-forte';

describe('SeedAdminConfig', () => {
    const config = new SeedAdminConfig();

    it('lê ADMIN_EMAIL normalizado (trim + minúsculas) e ADMIN_PASSWORD', () => {
        expect(
            config.parse({ ADMIN_EMAIL: '  TI@ColumbiaBR.com ', ADMIN_PASSWORD: SENHA }),
        ).toEqual({ email: 'ti@columbiabr.com', password: SENHA });
    });

    it('sem ADMIN_EMAIL: erro que nomeia a var', () => {
        expect(() => config.parse({ ADMIN_PASSWORD: SENHA })).toThrow(MissingSeedAdminEnvError);
        expect(() => config.parse({ ADMIN_PASSWORD: SENHA })).toThrow(/ADMIN_EMAIL/);
    });

    it('ADMIN_EMAIL que não é e-mail: erro que nomeia a var', () => {
        expect(() => config.parse({ ADMIN_EMAIL: 'admin', ADMIN_PASSWORD: SENHA })).toThrow(
            /ADMIN_EMAIL/,
        );
    });

    it('sem ADMIN_PASSWORD, ou com menos de 8 caracteres: erro que nomeia a var', () => {
        expect(() => config.parse({ ADMIN_EMAIL: 'ti@columbiabr.com' })).toThrow(/ADMIN_PASSWORD/);
        expect(() =>
            config.parse({ ADMIN_EMAIL: 'ti@columbiabr.com', ADMIN_PASSWORD: 'curta' }),
        ).toThrow(/ADMIN_PASSWORD/);
    });

    it('a mensagem de erro é em português e nunca carrega o valor da senha', () => {
        let mensagem = '';
        try {
            config.parse({ ADMIN_EMAIL: 'invalido', ADMIN_PASSWORD: 'curta77' });
        } catch (error) {
            mensagem = error instanceof Error ? error.message : String(error);
        }
        expect(mensagem).toMatch(/obrigat|inválid/i);
        expect(mensagem).not.toContain('curta77');
    });

    it('as duas faltando: nomeia as duas', () => {
        expect(() => config.parse({})).toThrow(/ADMIN_EMAIL.*ADMIN_PASSWORD/);
    });
});

describe('seed-admin — sem credencial default no código (I6)', () => {
    const fontes = ['seed-admin.ts', 'SeedAdminConfig.ts'].map((f) =>
        readFileSync(path.join(__dirname, f), 'utf8'),
    );

    // Montado por partes para que este próprio arquivo não apareça no `grep` da var aposentada.
    const varAposentada = ['ADMIN', 'USERNAME'].join('_');

    it.each([
        ["'columbia2026'", 'columbia2026'],
        ["?? 'admin'", "?? 'admin'"],
        [varAposentada, varAposentada],
    ])('não contém %s', (_rotulo, trecho) => {
        for (const fonte of fontes) expect(fonte).not.toContain(trecho);
    });
});
