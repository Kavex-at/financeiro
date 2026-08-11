import { readFileSync } from 'node:fs';
import path from 'node:path';

const BACKEND_ROOT = path.join(__dirname, '..');
const indexSource = (): string => readFileSync(path.join(BACKEND_ROOT, 'index.ts'), 'utf8');

/** Índice da primeira ocorrência; -1 quando ausente. */
const at = (source: string, needle: string): number => source.indexOf(needle);

describe('index.ts — a ORDEM dos middlewares é o contrato (ADR-0030)', () => {
    it('identidade → autorização → identidade-no-ERP, nessa ordem', () => {
        // Inverter dois destes não produz erro: produz `sub` (UUID) no ALS, `getVinculoConexos`
        // devolvendo null, e TODA baixa fin010 saindo no nome do usuário-robô — sem exceção,
        // sem log e sem alarme (integrations/supabase-auth.md).
        const source = indexSource();

        const auth = at(source, 'app.use(buildAuthMiddleware(');
        const appUser = at(source, 'app.use(buildAppUserContextMiddleware(');
        const conexos = at(source, 'app.use(conexosIdentityMiddleware)');

        expect(auth).toBeGreaterThan(-1);
        expect(appUser).toBeGreaterThan(-1);
        expect(conexos).toBeGreaterThan(-1);
        expect(auth).toBeLessThan(appUser);
        expect(appUser).toBeLessThan(conexos);
    });

    it('/health e /auth/* continuam PÚBLICOS — montados ANTES do middleware de auth', () => {
        // `/auth` hospeda o login E o `forgot-password`. Gateá-los por engano tornaria a
        // recuperação de senha inalcançável exatamente para quem precisa dela.
        const source = indexSource();

        const health = at(source, "app.get('/health'");
        const authRouter = at(source, "app.use('/auth', authRouter)");
        const authMiddleware = at(source, 'app.use(buildAuthMiddleware(');

        expect(health).toBeGreaterThan(-1);
        expect(authRouter).toBeGreaterThan(-1);
        expect(health).toBeLessThan(authMiddleware);
        expect(authRouter).toBeLessThan(authMiddleware);
    });

    it('os routers de domínio ficam DEPOIS da autorização', () => {
        const source = indexSource();
        const appUser = at(source, 'app.use(buildAppUserContextMiddleware(');
        for (const mount of [
            "app.use('/permutas'",
            "app.use('/sispag'",
            "app.use('/recebimentos'",
            "app.use('/usuarios'",
            "app.use('/me'",
        ]) {
            expect(at(source, mount)).toBeGreaterThan(appUser);
        }
    });

    it('o authEnv é carregado UMA vez e compartilhado pelos dois middlewares', () => {
        // Duas leituras independentes do ambiente podem divergir — e a divergência entre
        // "identidade ligada" e "autorização ligada" é indetectável em runtime.
        const source = indexSource();
        expect((source.match(/loadAuthEnv\(\)/g) ?? []).length).toBe(1);
        expect(source).toContain('buildAuthMiddleware(authEnv)');
        expect(source).toContain('buildAppUserContextMiddleware(authEnv)');
    });
});

describe('migrations 0044 / 0045 — idempotência e não-destrutividade', () => {
    const migration = (file: string): string =>
        readFileSync(path.join(BACKEND_ROOT, 'migrations', file), 'utf8');

    it('0044: auth_user_id + índice ÚNICO + convite_pendente, tudo com guarda IF NOT EXISTS', () => {
        const sql = migration('0044_app_user_auth_link.sql');
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS auth_user_id UUID/);
        // UNIQUE: 1:1 com `auth.users`. No Postgres um índice único TOLERA múltiplos NULL —
        // o que importa porque HOJE todas as linhas de produção são NULL.
        expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS app_user_auth_user_id_key/);
        expect(sql).toMatch(
            /ADD COLUMN IF NOT EXISTS convite_pendente BOOLEAN NOT NULL DEFAULT false/,
        );
    });

    it('0044: password_hash PERMANECE na tabela — é a fonte do import bcrypt até a Fase 4', () => {
        const sql = migration('0044_app_user_auth_link.sql');
        expect(sql).not.toMatch(/DROP COLUMN[\s\S]*password_hash/);
        // Só a obrigatoriedade sai: a custódia da credencial passou para o GoTrue.
        expect(sql).toMatch(/ALTER COLUMN password_hash DROP NOT NULL/);
    });

    it('0045: muda SÓ o default de role — nenhuma linha existente é tocada', () => {
        // Rebaixar um admin em produção é ato administrativo explícito, não efeito colateral
        // de migration.
        const sql = migration('0045_app_user_role_default.sql');
        expect(sql).toMatch(/ALTER COLUMN role SET DEFAULT 'operador'/);
        // O `not.toMatch(/UPDATE/)` só sobre o SQL executável vive no caso abaixo — aqui os
        // comentários explicam justamente por que não há UPDATE nenhum.
    });

    it('nenhuma das duas faz UPDATE, DELETE ou DROP TABLE', () => {
        for (const file of ['0044_app_user_auth_link.sql', '0045_app_user_role_default.sql']) {
            const statements = migration(file)
                .split('\n')
                .filter((line) => !line.trimStart().startsWith('--'))
                .join('\n');
            expect(statements).not.toMatch(/\bUPDATE\b/);
            expect(statements).not.toMatch(/\bDELETE\b/);
            expect(statements).not.toMatch(/DROP TABLE/);
        }
    });
});
