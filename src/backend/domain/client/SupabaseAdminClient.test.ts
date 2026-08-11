import 'reflect-metadata';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import SupabaseAdminClient, {
    SupabaseAdminError,
    SupabaseEmailAlreadyExistsError,
    SupabaseUserNotFoundError,
} from './SupabaseAdminClient.js';

const admin = {
    inviteUserByEmail: jest.fn(),
    createUser: jest.fn(),
    getUserById: jest.fn(),
    updateUserById: jest.fn(),
    deleteUser: jest.fn(),
};
const resetPasswordForEmail = jest.fn();

jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({ auth: { admin, resetPasswordForEmail } })),
}));

const RAW_USER = {
    id: 'a1b2c3d4-0000-4000-8000-000000000000',
    email: 'novo@kavex.com',
    email_confirmed_at: null,
    invited_at: '2026-08-06T10:00:00.000Z',
    banned_until: null,
    app_metadata: { provider: 'email' },
};

const buildEnv = (over: Record<string, unknown> = {}) =>
    ({
        getEnvironmentVars: jest.fn().mockResolvedValue({
            supabaseUrl: 'https://ref.supabase.co',
            supabaseServiceRoleKey: 'sk-service-role',
            ...over,
        }),
    }) as unknown as jest.Mocked<EnvironmentProvider>;

const buildClient = (over: Record<string, unknown> = {}) => new SupabaseAdminClient(buildEnv(over));

const ok = (user: unknown) => ({ data: { user }, error: null });
const fail = (message: string, status?: number) => ({
    data: { user: null },
    error: { message, ...(status !== undefined ? { status } : {}) },
});

beforeEach(() => {
    jest.clearAllMocks();
    admin.inviteUserByEmail.mockResolvedValue(ok(RAW_USER));
    admin.createUser.mockResolvedValue(ok(RAW_USER));
    admin.getUserById.mockResolvedValue(ok(RAW_USER));
    admin.updateUserById.mockResolvedValue(ok(RAW_USER));
    admin.deleteUser.mockResolvedValue({ data: {}, error: null });
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

describe('SupabaseAdminClient — configuração e boundary', () => {
    it('falha alto e claro sem SUPABASE_URL / SERVICE_ROLE_KEY', async () => {
        // Um cadastro que "não faz nada" em silêncio é pior do que um que recusa.
        await expect(
            buildClient({ supabaseServiceRoleKey: undefined }).inviteByEmail('x@kavex.com'),
        ).rejects.toBeInstanceOf(SupabaseAdminError);
    });

    it('lê a service-role key do EnvironmentProvider — nunca de process.env cru', () => {
        const source = readFileSync(path.join(__dirname, 'SupabaseAdminClient.ts'), 'utf8');
        expect(source).toContain('EnvironmentProvider');
        // Só o CÓDIGO — as doc-comments citam `process.env` justamente para explicar por que
        // ele não aparece aqui.
        const code = source
            .split('\n')
            .filter((l) => {
                const t = l.trimStart();
                return !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('//');
            })
            .join('\n');
        expect(code).not.toContain('process.env');
    });

    it('valida a resposta da Admin API com Zod (input externo) e normaliza para camelCase', async () => {
        const user = await buildClient().inviteByEmail('novo@kavex.com');
        expect(user).toEqual({
            id: RAW_USER.id,
            email: 'novo@kavex.com',
            invitedAt: '2026-08-06T10:00:00.000Z',
        });
    });

    it('rejeita um payload sem `id` em vez de propagar undefined adiante', async () => {
        admin.inviteUserByEmail.mockResolvedValue(ok({ email: 'sem-id@kavex.com' }));
        await expect(buildClient().inviteByEmail('sem-id@kavex.com')).rejects.toThrow();
    });
});

describe('SupabaseAdminClient — erros TIPADOS (a distinção que o service precisa)', () => {
    it('rede/5xx vira SupabaseAdminError — NUNCA "usuário não existe"', async () => {
        // Tratar indisponibilidade como inexistência levaria a compensação a apagar a linha
        // errada, ou a um cadastro que se acha bem-sucedido enquanto o provedor está fora.
        admin.createUser.mockResolvedValue(fail('service unavailable', 503));
        const err = await buildClient()
            .createUser({ email: 'a@kavex.com', password: 'segredo12' })
            .catch((e) => e);
        expect(err).toBeInstanceOf(SupabaseAdminError);
        expect(err).not.toBeInstanceOf(SupabaseUserNotFoundError);
    });

    it('e-mail já registrado vira SupabaseEmailAlreadyExistsError (→ 409, nunca duplicata)', async () => {
        admin.createUser.mockResolvedValue(
            fail('A user with this email address has already been registered'),
        );
        await expect(
            buildClient().createUser({ email: 'dup@kavex.com', password: 'segredo12' }),
        ).rejects.toBeInstanceOf(SupabaseEmailAlreadyExistsError);
    });

    it('getUserById devolve null quando não existe — ausência é resposta, não erro', async () => {
        admin.getUserById.mockResolvedValue(fail('User not found', 404));
        await expect(buildClient().getUserById('nao-existe')).resolves.toBeNull();
    });

    it('getUserById PROPAGA falha de rede — null aqui reativaria convidado por engano', async () => {
        // Se uma indisponibilidade virasse `null`, o fluxo de aceite do convite (U2) leria
        // "não confirmado" e negaria; pior, um `null` interpretado como "confirmado" ativaria
        // alguém sem prova. Propagar é a única leitura honesta.
        admin.getUserById.mockResolvedValue(fail('connect ETIMEDOUT', 500));
        await expect(buildClient().getUserById('id')).rejects.toBeInstanceOf(SupabaseAdminError);
    });
});

describe('SupabaseAdminClient — métodos da superfície', () => {
    it('createUser marca email_confirm — U3 nasce ativo, sem aceite a esperar', async () => {
        await buildClient().createUser({ email: 'a@kavex.com', password: 'segredo12' });
        expect(admin.createUser).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'a@kavex.com', email_confirm: true }),
        );
    });

    it('createUserWithPasswordHash reaproveita o hash bcrypt (evita o lockout geral)', async () => {
        await buildClient().createUserWithPasswordHash({
            email: 'antigo@kavex.com',
            passwordHash: '$2a$12$abcdefghijklmnopqrstuv',
        });
        const arg = admin.createUser.mock.calls[0][0];
        expect(arg.password_hash).toBe('$2a$12$abcdefghijklmnopqrstuv');
        // A senha em claro nunca existe neste caminho — não há o que vazar.
        expect(arg.password).toBeUndefined();
    });

    it('getUserById expõe emailConfirmedAt — a prova do aceite do convite (U2)', async () => {
        admin.getUserById.mockResolvedValue(
            ok({ ...RAW_USER, email_confirmed_at: '2026-08-06T12:00:00.000Z' }),
        );
        const user = await buildClient().getUserById(RAW_USER.id);
        expect(user?.emailConfirmedAt).toBe('2026-08-06T12:00:00.000Z');
    });

    it('setBanned bane e desbane pelo mesmo caminho (idempotente nas duas direções)', async () => {
        const client = buildClient();
        await client.setBanned(RAW_USER.id, true);
        expect(admin.updateUserById).toHaveBeenLastCalledWith(
            RAW_USER.id,
            expect.objectContaining({ ban_duration: expect.not.stringMatching(/^none$/) }),
        );
        await client.setBanned(RAW_USER.id, false);
        expect(admin.updateUserById).toHaveBeenLastCalledWith(RAW_USER.id, {
            ban_duration: 'none',
        });
    });

    it('sendRecoveryLink propaga a falha do provedor (SMTP ausente não pode passar batido)', async () => {
        resetPasswordForEmail.mockResolvedValue({ data: null, error: { message: 'smtp down' } });
        await expect(buildClient().sendRecoveryLink('a@kavex.com')).rejects.toBeInstanceOf(
            SupabaseAdminError,
        );
    });
});

describe('GUARDA — deleteUser é compensação transacional, não superfície HTTP (I-Usuario-3)', () => {
    it('nenhum arquivo de routes/ alcança deleteUser', () => {
        // Hard delete de usuário é PROIBIDO: a saída é `ativo = false`. Como as colunas de
        // auditoria são TEXT sem FK, apagar a linha não quebraria nada SINTATICAMENTE — ela
        // apenas deixaria de ser resolvível. É por isso que a regra precisa de uma guarda
        // executável e não de uma convenção.
        const routesDir = path.join(__dirname, '..', '..', 'routes');
        const offenders = readdirSync(routesDir)
            .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
            .filter((f) => /deleteUser/.test(readFileSync(path.join(routesDir, f), 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('está documentado no código como exclusivo de compensação', () => {
        const source = readFileSync(path.join(__dirname, 'SupabaseAdminClient.ts'), 'utf8');
        expect(source).toMatch(/COMPENSAÇÃO TRANSACIONAL APENAS/);
    });
});

describe('GUARDA — a service-role key nunca cruza para o frontend (ADR-0030 §4)', () => {
    it('nenhum CÓDIGO em src/frontend/ referencia SUPABASE_SERVICE_ROLE_KEY', () => {
        // Ela IGNORA RLS e pode criar usuários. Uma referência no bundle do cliente é
        // equivalente a publicar credencial de administrador do banco.
        //
        // A varredura ignora COMENTÁRIOS de propósito: `lib/supabase/env.ts` documenta
        // exatamente por que a chave não está lá, e apagar essa explicação para satisfazer
        // um grep tornaria a regra invisível justamente no arquivo onde alguém seria tentado
        // a quebrá-la. O que não pode existir é a chave no CÓDIGO.
        const frontendRoot = path.join(__dirname, '..', '..', '..', 'frontend');
        const skip = new Set(['node_modules', '.next', '.git', 'coverage', 'dist']);
        const offenders: string[] = [];

        const stripComments = (source: string): string =>
            source
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .split('\n')
                .map((line) => line.replace(/\/\/.*$/, ''))
                .join('\n');

        const walk = (dir: string): void => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (skip.has(entry.name)) continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
                const code = stripComments(readFileSync(full, 'utf8'));
                if (code.includes('SUPABASE_SERVICE_ROLE_KEY')) {
                    offenders.push(path.relative(frontendRoot, full));
                }
            }
        };
        walk(frontendRoot);

        expect(offenders).toEqual([]);
    });

    it('nenhuma configuração do frontend (.env*, json) DECLARA a chave', () => {
        // Um `.env.example` que declara a chave é um convite para alguém preenchê-la — e a
        // partir daí ela vaza no bundle como `NEXT_PUBLIC_*` sem ninguém perceber.
        //
        // O que se procura é a DECLARAÇÃO (`SUPABASE_SERVICE_ROLE_KEY=` ou `"...":`), não a
        // menção: o `.env.example` avisa explicitamente que ela não entra ali, e esse aviso é
        // exatamente o que impede alguém de adicioná-la.
        const frontendRoot = path.join(__dirname, '..', '..', '..', 'frontend');
        const declaration = /^\s*(?:#\s*)?(?:"?SUPABASE_SERVICE_ROLE_KEY"?\s*[=:])/m;
        const offenders = readdirSync(frontendRoot, { withFileTypes: true })
            .filter((e) => e.isFile() && (/^\.env/.test(e.name) || e.name.endsWith('.json')))
            .filter((e) => declaration.test(readFileSync(path.join(frontendRoot, e.name), 'utf8')))
            .map((e) => e.name);

        expect(offenders).toEqual([]);
    });
});
