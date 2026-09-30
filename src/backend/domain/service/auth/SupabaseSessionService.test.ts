import 'reflect-metadata';
import SupabaseAuthRejectedError from '../../errors/SupabaseAuthRejectedError.js';
import SupabaseAuthUnavailableError from '../../errors/SupabaseAuthUnavailableError.js';
import type { SupabaseSession } from '../../interface/auth/SupabaseAuth.js';
import type { AppUser } from '../../repository/auth/UserRepository.js';
import SupabaseSessionService from './SupabaseSessionService.js';

const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';
const SENHA = 'senha-que-nao-pode-vazar';

const usuario = (over: Partial<AppUser> = {}): AppUser => ({
    id: 5,
    username: 'fulano',
    passwordHash: '$2a$12$hash-que-nao-pode-vazar',
    role: 'admin',
    ativo: true,
    email: 'fulano@columbiabr.com',
    authUserId: UUID,
    ...over,
});

const sessao = (over: Partial<SupabaseSession> = {}): SupabaseSession => ({
    accessToken: 'access-que-nao-pode-vazar',
    refreshToken: 'refresh-que-nao-pode-vazar',
    expiresAt: 1_790_000_000,
    userId: UUID,
    email: 'fulano@columbiabr.com',
    ...over,
});

const build = (linhas: AppUser[] = [usuario()]) => {
    const repo = {
        findByLoginIdentifier: jest.fn().mockResolvedValue(linhas),
        findByAuthUserId: jest.fn().mockResolvedValue(linhas[0] ?? null),
    };
    const client = {
        signInWithPassword: jest.fn().mockResolvedValue(sessao()),
        refresh: jest.fn().mockResolvedValue(sessao()),
        logout: jest.fn().mockResolvedValue(undefined),
    };
    const log = {
        error: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        info: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SupabaseSessionService(repo as never, client as never, log as never);
    return { service, repo, client, log };
};

/** Tudo que foi logado, serializado — para provar que senha, token e hash nunca aparecem. */
const logado = (log: ReturnType<typeof build>['log']): string =>
    JSON.stringify([log.error.mock.calls, log.warn.mock.calls, log.info.mock.calls]);

const semSegredos = (texto: string) => {
    for (const segredo of [
        SENHA,
        'access-que-nao-pode-vazar',
        'refresh-que-nao-pode-vazar',
        'hash-que-nao-pode-vazar',
    ]) {
        expect(texto).not.toContain(segredo);
    }
};

describe('SupabaseSessionService.login', () => {
    it('sucesso: chama o GoTrue com o E-MAIL do usuário e devolve o formato do D10', async () => {
        const { service, client, log } = build();
        const out = await service.login({ username: 'fulano', password: SENHA });
        expect(client.signInWithPassword).toHaveBeenCalledWith('fulano@columbiabr.com', SENHA);
        expect(out).toEqual({
            token: 'access-que-nao-pode-vazar',
            refreshToken: 'refresh-que-nao-pode-vazar',
            expiresAt: 1_790_000_000,
            username: 'fulano',
            role: 'admin',
            email: 'fulano@columbiabr.com',
        });
        expect(log.info).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'AUTH_SESSAO',
                message: expect.stringMatching(/login/),
                data: expect.objectContaining({ usuario: 'fulano' }),
            }),
        );
        semSegredos(logado(log));
    });

    const recusasSemGoTrue: Array<[string, AppUser[]]> = [
        ['nenhum usuário', []],
        ['inativo', [usuario({ ativo: false })]],
        ['sem vínculo (auth_user_id)', [usuario({ authUserId: undefined })]],
        ['sem e-mail', [usuario({ email: undefined })]],
    ];
    for (const [caso, linhas] of recusasSemGoTrue) {
        it(`${caso}: null (401 genérico) SEM chamar o GoTrue`, async () => {
            const { service, client } = build(linhas);
            expect(await service.login({ username: 'fulano', password: SENHA })).toBeNull();
            expect(client.signInWithPassword).not.toHaveBeenCalled();
        });
    }

    it('ambíguo (duas linhas): null, loga os ids, sem chamar o GoTrue', async () => {
        const { service, client, log } = build([usuario(), usuario({ id: 6 })]);
        expect(await service.login({ username: 'fulano', password: SENHA })).toBeNull();
        expect(client.signInWithPassword).not.toHaveBeenCalled();
        expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ data: { ids: [5, 6] } }));
    });

    it('senha errada (invalid_credentials): null', async () => {
        const { service, client } = build();
        client.signInWithPassword.mockRejectedValue(
            new SupabaseAuthRejectedError('invalid_credentials', 400),
        );
        expect(await service.login({ username: 'fulano', password: SENHA })).toBeNull();
    });

    it('banido no GoTrue com ativo = true: null + LogService.error de divergência', async () => {
        const { service, client, log } = build();
        client.signInWithPassword.mockRejectedValue(
            new SupabaseAuthRejectedError('user_banned', 400),
        );
        expect(await service.login({ username: 'fulano', password: SENHA })).toBeNull();
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'AUTH_DIVERGENCIA',
                message: expect.stringMatching(/sync-supabase-auth/),
                data: expect.objectContaining({ userId: 5, authUserId: UUID }),
            }),
        );
    });

    it('GoTrue indisponível (5xx/timeout): propaga SupabaseAuthUnavailableError (a rota dá 503)', async () => {
        const { service, client } = build();
        client.signInWithPassword.mockRejectedValue(
            new SupabaseAuthUnavailableError('fora', 'timeout'),
        );
        await expect(service.login({ username: 'fulano', password: SENHA })).rejects.toBeInstanceOf(
            SupabaseAuthUnavailableError,
        );
    });

    it('checagem cruzada: sub da sessão ≠ auth_user_id do usuário → null + divergência', async () => {
        const { service, client, log } = build();
        client.signInWithPassword.mockResolvedValue(
            sessao({ userId: '11111111-2222-4333-8444-555555555555' }),
        );
        expect(await service.login({ username: 'fulano', password: SENHA })).toBeNull();
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'AUTH_DIVERGENCIA' }),
        );
        semSegredos(logado(log));
    });
});

describe('SupabaseSessionService.refresh', () => {
    it('renova e resolve username/e-mail pelo auth_user_id da sessão nova; não checa ativo', async () => {
        const { service, client, repo } = build([usuario({ ativo: false })]);
        const out = await service.refresh('rt-velho');
        expect(client.refresh).toHaveBeenCalledWith('rt-velho');
        expect(repo.findByAuthUserId).toHaveBeenCalledWith(UUID);
        expect(out).toMatchObject({ token: 'access-que-nao-pode-vazar', username: 'fulano' });
    });

    it('recusa do GoTrue: null (401 "Sessão expirada")', async () => {
        const { service, client } = build();
        client.refresh.mockRejectedValue(
            new SupabaseAuthRejectedError('refresh_token_already_used', 400),
        );
        expect(await service.refresh('rt')).toBeNull();
    });

    it('indisponível: propaga', async () => {
        const { service, client } = build();
        client.refresh.mockRejectedValue(
            new SupabaseAuthUnavailableError('x', 'server_error', 503),
        );
        await expect(service.refresh('rt')).rejects.toBeInstanceOf(SupabaseAuthUnavailableError);
    });

    it('sessão sem app_user: null + divergência', async () => {
        const { service, repo, log } = build();
        repo.findByAuthUserId.mockResolvedValue(null);
        expect(await service.refresh('rt')).toBeNull();
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'AUTH_DIVERGENCIA' }),
        );
        semSegredos(logado(log));
    });
});

describe('SupabaseSessionService.logout', () => {
    it('revoga no GoTrue com o token do próprio usuário', async () => {
        const { service, client } = build();
        await service.logout('access-que-nao-pode-vazar', 'fulano');
        expect(client.logout).toHaveBeenCalledWith('access-que-nao-pode-vazar');
    });

    it('falha do GoTrue vira warn e não lança', async () => {
        const { service, client, log } = build();
        client.logout.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'unreachable'));
        await expect(service.logout('access-que-nao-pode-vazar')).resolves.toBeUndefined();
        expect(log.warn).toHaveBeenCalled();
        semSegredos(logado(log));
    });
});
