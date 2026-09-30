import 'reflect-metadata';
import AuthEmailInUseError from '../../errors/AuthEmailInUseError.js';
import ReactivationRequiresEmailError from '../../errors/ReactivationRequiresEmailError.js';
import SupabaseAuthUnavailableError from '../../errors/SupabaseAuthUnavailableError.js';
import SupabaseEmailConflictError from '../../errors/SupabaseEmailConflictError.js';
import type { CredencialLinha } from '../../repository/auth/UserRepository.js';
import CredentialMirror from './CredentialMirror.js';

const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';
const OUTRO_UUID = '11111111-2222-4333-8444-555555555555';
const TX = { tx: true } as never;

const linha = (over: Partial<CredencialLinha> = {}): CredencialLinha => ({
    id: 4,
    username: 'beto',
    email: 'beto@qa.local',
    authUserId: UUID,
    ativo: true,
    passwordHash: '$2a$12$hash',
    ...over,
});

const build = (adminConfigurado = true) => {
    const client = {
        isAdminConfigured: jest.fn().mockResolvedValue(adminConfigurado),
        adminCreateUser: jest.fn().mockResolvedValue({ id: UUID, banned: false }),
        adminUpdateUser: jest.fn().mockResolvedValue({ id: UUID, banned: false }),
        adminFindUserByEmail: jest.fn().mockResolvedValue(null),
    };
    const repo = {
        setAuthUserId: jest.fn().mockResolvedValue(undefined),
        findIdByAuthUserId: jest.fn().mockResolvedValue(undefined),
    };
    const log = {
        error: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        info: jest.fn().mockResolvedValue(undefined),
    };
    const mirror = new CredentialMirror(client as never, repo as never, log as never);
    return { mirror, client, repo, log };
};

const passo = async (
    mirror: CredentialMirror,
    operacao: Parameters<CredentialMirror['preparar']>[0],
) => {
    const p = await mirror.preparar(operacao);
    if (!p.antesDoCommit) throw new Error('deveria espelhar');
    return p;
};

describe('CredentialMirror — D3: espelha só com a API admin configurada', () => {
    it('sem SUPABASE_URL/SUPABASE_SECRET_KEY: nenhum passo (escrita só local)', async () => {
        const { mirror, client } = build(false);
        for (const op of [
            { tipo: 'criar', senha: 's' },
            { tipo: 'senha', senha: 's' },
            { tipo: 'email' },
            { tipo: 'desativar' },
            { tipo: 'reativar' },
        ] as const) {
            expect((await mirror.preparar(op)).antesDoCommit).toBeUndefined();
        }
        expect(client.adminCreateUser).not.toHaveBeenCalled();
    });

    it('usuário sem vínculo: senha, e-mail e desativar são só locais', async () => {
        const { mirror, client } = build();
        for (const op of [
            { tipo: 'senha', senha: 's' },
            { tipo: 'email' },
            { tipo: 'desativar' },
        ] as const) {
            const p = await passo(mirror, op);
            await p.antesDoCommit?.(TX, linha({ authUserId: undefined }));
        }
        expect(client.adminUpdateUser).not.toHaveBeenCalled();
    });
});

describe('CredentialMirror — criar', () => {
    it('cria no GoTrue com o MESMO hash e e-mail confirmado, e vincula na transação', async () => {
        const { mirror, client, repo } = build();
        const p = await passo(mirror, { tipo: 'criar', senha: 'segredo12' });
        await p.antesDoCommit?.(TX, linha({ authUserId: undefined }));
        expect(client.adminCreateUser).toHaveBeenCalledWith({
            email: 'beto@qa.local',
            passwordHash: '$2a$12$hash',
        });
        expect(repo.setAuthUserId).toHaveBeenCalledWith(TX, 4, UUID);
        expect(p.estado).toEqual({ supabaseAlterado: true, authUserId: UUID });
    });

    it('e-mail já existe no GoTrue sem app_user: vincula e grava a senha (password, T-1)', async () => {
        const { mirror, client, repo } = build();
        client.adminCreateUser.mockRejectedValue(new SupabaseEmailConflictError());
        client.adminFindUserByEmail.mockResolvedValue({ id: OUTRO_UUID, banned: false });
        const p = await passo(mirror, { tipo: 'criar', senha: 'segredo12' });
        await p.antesDoCommit?.(TX, linha({ authUserId: undefined }));
        expect(client.adminUpdateUser).toHaveBeenCalledWith(OUTRO_UUID, {
            password: 'segredo12',
            banned: false,
        });
        expect(repo.setAuthUserId).toHaveBeenCalledWith(TX, 4, OUTRO_UUID);
    });

    it('e-mail já existe no GoTrue vinculado a OUTRO app_user: AuthEmailInUseError (409)', async () => {
        const { mirror, client, repo } = build();
        client.adminCreateUser.mockRejectedValue(new SupabaseEmailConflictError());
        client.adminFindUserByEmail.mockResolvedValue({ id: OUTRO_UUID, banned: false });
        repo.findIdByAuthUserId.mockResolvedValue(77);
        const p = await passo(mirror, { tipo: 'criar', senha: 'segredo12' });
        await expect(
            p.antesDoCommit?.(TX, linha({ authUserId: undefined })),
        ).rejects.toBeInstanceOf(AuthEmailInUseError);
        expect(repo.setAuthUserId).not.toHaveBeenCalled();
    });

    it('GoTrue indisponível: o erro sobe (a transação desfaz) e nada é marcado como alterado', async () => {
        const { mirror, client } = build();
        client.adminCreateUser.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        const p = await passo(mirror, { tipo: 'criar', senha: 's' });
        await expect(
            p.antesDoCommit?.(TX, linha({ authUserId: undefined })),
        ).rejects.toBeInstanceOf(SupabaseAuthUnavailableError);
        expect(p.estado.supabaseAlterado).toBe(false);
    });
});

describe('CredentialMirror — senha, e-mail, ativo', () => {
    it('senha: password em claro para o GoTrue (o update ignora password_hash, T-1)', async () => {
        const { mirror, client } = build();
        const p = await passo(mirror, { tipo: 'senha', senha: 'nova-senha-1' });
        await p.antesDoCommit?.(TX, linha());
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, { password: 'nova-senha-1' });
        expect(p.estado.supabaseAlterado).toBe(true);
    });

    it('e-mail: troca confirmada; conflito no GoTrue vira AuthEmailInUseError', async () => {
        const { mirror, client } = build();
        const p = await passo(mirror, { tipo: 'email' });
        await p.antesDoCommit?.(TX, linha({ email: 'novo@qa.local' }));
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, { email: 'novo@qa.local' });

        client.adminUpdateUser.mockRejectedValue(new SupabaseEmailConflictError());
        const p2 = await passo(mirror, { tipo: 'email' });
        await expect(p2.antesDoCommit?.(TX, linha())).rejects.toBeInstanceOf(AuthEmailInUseError);
    });

    it('desativar: bane (D15)', async () => {
        const { mirror, client } = build();
        const p = await passo(mirror, { tipo: 'desativar' });
        await p.antesDoCommit?.(TX, linha({ ativo: false }));
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, { banned: true });
    });

    it('desativar com o GoTrue fora: NÃO lança (o ativo = false é comitado) e loga AUTH_DIVERGENCIA', async () => {
        const { mirror, client, log } = build();
        client.adminUpdateUser.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        const p = await passo(mirror, { tipo: 'desativar' });
        await expect(p.antesDoCommit?.(TX, linha({ ativo: false }))).resolves.toBeUndefined();
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'AUTH_DIVERGENCIA',
                message: expect.stringMatching(/desativado sem ban.*sync/),
                data: expect.objectContaining({ userId: 4, authUserId: UUID }),
            }),
        );
    });

    it('reativar com vínculo: desbane', async () => {
        const { mirror, client } = build();
        const p = await passo(mirror, { tipo: 'reativar' });
        await p.antesDoCommit?.(TX, linha());
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, { banned: false });
    });

    it('reativar sem vínculo e com e-mail: cria com o hash atual e vincula', async () => {
        const { mirror, client, repo } = build();
        const p = await passo(mirror, { tipo: 'reativar' });
        await p.antesDoCommit?.(TX, linha({ authUserId: undefined }));
        expect(client.adminCreateUser).toHaveBeenCalledWith({
            email: 'beto@qa.local',
            passwordHash: '$2a$12$hash',
        });
        expect(repo.setAuthUserId).toHaveBeenCalledWith(TX, 4, UUID);
    });

    it('reativar sem vínculo e com e-mail já no GoTrue: vincula, desbane e avisa que a senha foi mantida', async () => {
        const { mirror, client, repo, log } = build();
        client.adminCreateUser.mockRejectedValue(new SupabaseEmailConflictError());
        client.adminFindUserByEmail.mockResolvedValue({ id: OUTRO_UUID, banned: true });
        const p = await passo(mirror, { tipo: 'reativar' });
        await p.antesDoCommit?.(TX, linha({ authUserId: undefined }));
        expect(client.adminUpdateUser).toHaveBeenCalledWith(OUTRO_UUID, { banned: false });
        expect(repo.setAuthUserId).toHaveBeenCalledWith(TX, 4, OUTRO_UUID);
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringMatching(/senha do Supabase Auth mantida/),
            }),
        );
    });

    it('reativar sem vínculo e sem e-mail: ReactivationRequiresEmailError (400), nada chamado', async () => {
        const { mirror, client } = build();
        const p = await passo(mirror, { tipo: 'reativar' });
        await expect(
            p.antesDoCommit?.(TX, linha({ authUserId: undefined, email: undefined })),
        ).rejects.toBeInstanceOf(ReactivationRequiresEmailError);
        expect(client.adminCreateUser).not.toHaveBeenCalled();
    });
});

describe('CredentialMirror.aposFalha — sucesso no GoTrue e falha no commit', () => {
    it('loga AUTH_DIVERGENCIA com userId, authUserId e a operação, e o texto do reparo', async () => {
        const { mirror, log } = build();
        const p = await passo(mirror, { tipo: 'senha', senha: 'nova-senha-1' });
        await p.antesDoCommit?.(TX, linha());
        await mirror.aposFalha(p, 4, new Error('commit falhou'));
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'AUTH_DIVERGENCIA',
                message: expect.stringMatching(/o sync-supabase-auth repara/),
                data: expect.objectContaining({ userId: 4, authUserId: UUID, operacao: 'senha' }),
            }),
        );
        expect(JSON.stringify(log.error.mock.calls)).not.toContain('nova-senha-1');
    });

    it('GoTrue não chegou a mudar: não loga divergência', async () => {
        const { mirror, log } = build();
        const p = await passo(mirror, { tipo: 'senha', senha: 's' });
        await mirror.aposFalha(p, 4, new Error('x'));
        expect(log.error).not.toHaveBeenCalled();
    });
});
