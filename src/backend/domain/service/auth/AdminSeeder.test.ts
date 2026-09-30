import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import SupabaseAuthNotConfiguredError from '../../errors/SupabaseAuthNotConfiguredError.js';
import SupabaseAuthUnavailableError from '../../errors/SupabaseAuthUnavailableError.js';
import type { AppUser } from '../../repository/auth/UserRepository.js';
import AdminSeeder from './AdminSeeder.js';

const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';
const EMAIL = 'adm@qa.local';
const SENHA = 'Qa-senha-123';

const build = (opts: { admin?: boolean; provider?: 'local' | 'supabase' } = {}) => {
    const linha: AppUser = {
        id: 1,
        username: EMAIL,
        passwordHash: 'h',
        role: 'admin',
        ativo: true,
        email: EMAIL,
    };
    const repo = {
        upsertAdmin: jest.fn().mockResolvedValue(undefined),
        findByUsername: jest.fn(async () => ({ ...linha })),
        findByAuthUserId: jest.fn().mockResolvedValue(null),
        linkAuthUser: jest.fn(async (_id: number, uuid: string) => {
            linha.authUserId = uuid;
        }),
    };
    const usuariosGoTrue = new Map<string, { id: string; email: string; banned: boolean }>();
    const client = {
        isAdminConfigured: jest.fn().mockResolvedValue(opts.admin ?? true),
        adminGetUser: jest.fn(async (id: string) => usuariosGoTrue.get(id) ?? null),
        adminFindUserByEmail: jest.fn(
            async (email: string) =>
                [...usuariosGoTrue.values()].find((u) => u.email === email) ?? null,
        ),
        adminCreateUser: jest.fn(async ({ email }: { email: string }) => {
            const u = { id: UUID, email, banned: false };
            usuariosGoTrue.set(UUID, u);
            return u;
        }),
        adminUpdateUser: jest.fn(async (id: string) => usuariosGoTrue.get(id)),
    };
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({ authProvider: opts.provider ?? 'local' }),
    };
    const seeder = new AdminSeeder(repo as never, client as never, env as never);
    return { seeder, repo, client, usuariosGoTrue };
};

describe('AdminSeeder', () => {
    it('com a API admin: upsert local, cria no GoTrue com o MESMO hash e e-mail confirmado, vincula', async () => {
        const { seeder, repo, client } = build();
        const out = await seeder.semear(EMAIL, SENHA, '$2a$12$hash');
        expect(repo.upsertAdmin).toHaveBeenCalledWith(EMAIL, '$2a$12$hash');
        expect(client.adminCreateUser).toHaveBeenCalledWith({
            email: EMAIL,
            passwordHash: '$2a$12$hash',
        });
        expect(repo.linkAuthUser).toHaveBeenCalledWith(1, UUID);
        expect(out).toEqual({ supabase: 'criado', authUserId: UUID });
    });

    it('rodar duas vezes não duplica: a segunda atualiza senha, e-mail e desbane pelo vínculo', async () => {
        const { seeder, client } = build();
        await seeder.semear(EMAIL, SENHA, 'h1');
        const out = await seeder.semear(EMAIL, 'Outra-senha-9', 'h2');
        expect(client.adminCreateUser).toHaveBeenCalledTimes(1);
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, {
            email: EMAIL,
            password: 'Outra-senha-9',
            banned: false,
        });
        expect(out).toEqual({ supabase: 'atualizado', authUserId: UUID });
    });

    it('sem vínculo, mas o e-mail já existe no GoTrue (execução interrompida): vincula, não duplica', async () => {
        const { seeder, client, repo, usuariosGoTrue } = build();
        usuariosGoTrue.set(UUID, { id: UUID, email: EMAIL, banned: true });
        const out = await seeder.semear(EMAIL, SENHA, 'h');
        expect(client.adminCreateUser).not.toHaveBeenCalled();
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, {
            email: EMAIL,
            password: SENHA,
            banned: false,
        });
        expect(repo.linkAuthUser).toHaveBeenCalledWith(1, UUID);
        expect(out.supabase).toBe('atualizado');
    });

    it('sem a API admin e AUTH_PROVIDER=local: só local, com aviso em português', async () => {
        const { seeder, client } = build({ admin: false });
        const out = await seeder.semear(EMAIL, SENHA, 'h');
        expect(out).toEqual({
            supabase: 'nao-configurado',
            aviso: 'Supabase não configurado: admin criado só no banco',
        });
        expect(client.adminCreateUser).not.toHaveBeenCalled();
    });

    it('sem a API admin e AUTH_PROVIDER=supabase: erro que nomeia as variáveis, antes de gravar', async () => {
        const { seeder, repo } = build({ admin: false, provider: 'supabase' });
        const erro = (await seeder.semear(EMAIL, SENHA, 'h').catch((e: unknown) => e)) as Error;
        expect(erro).toBeInstanceOf(SupabaseAuthNotConfiguredError);
        expect(erro.message).toMatch(/SUPABASE_URL/);
        expect(erro.message).toMatch(/SUPABASE_SECRET_KEY/);
        expect(repo.upsertAdmin).not.toHaveBeenCalled();
    });

    it('GoTrue fora: o erro sobe e a linha local fica (o seed é reexecutável)', async () => {
        const { seeder, repo, client } = build();
        client.adminFindUserByEmail.mockRejectedValue(
            new SupabaseAuthUnavailableError('x', 'unreachable'),
        );
        await expect(seeder.semear(EMAIL, SENHA, 'h')).rejects.toBeInstanceOf(
            SupabaseAuthUnavailableError,
        );
        expect(repo.upsertAdmin).toHaveBeenCalled();
    });

    it('o seed-admin não põe nada no bootstrapAppContainer (o client é resolvido sob demanda)', () => {
        const container = readFileSync(path.join(__dirname, '..', '..', 'appContainer.ts'), 'utf8');
        expect(container).not.toMatch(/AdminSeeder|SupabaseAuth/);
    });
});
