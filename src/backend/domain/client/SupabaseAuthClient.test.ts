import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import SupabaseAuthRejectedError from '../errors/SupabaseAuthRejectedError.js';
import SupabaseAuthUnavailableError from '../errors/SupabaseAuthUnavailableError.js';
import SupabaseEmailConflictError from '../errors/SupabaseEmailConflictError.js';
import SupabaseAuthClient from './SupabaseAuthClient.js';

const URL_LOCAL = 'http://127.0.0.1:54321';
const PUBLISHABLE = 'sb_publishable_teste';
const SECRET = 'sb_secret_nao_pode_vazar';
const LEGACY_SECRET = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.assinatura';
const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';

interface EnvFake {
    supabaseUrl?: string;
    supabasePublishableKey?: string;
    supabaseSecretKey?: string;
}

const envProvider = (env: EnvFake) => ({
    getEnvironmentVars: jest.fn().mockResolvedValue(env),
});

const logFake = () => ({
    error: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
    info: jest.fn().mockResolvedValue(undefined),
});

const completo: EnvFake = {
    supabaseUrl: URL_LOCAL,
    supabasePublishableKey: PUBLISHABLE,
    supabaseSecretKey: SECRET,
};

const criar = (env: EnvFake = completo) => {
    const log = logFake();
    const provider = envProvider(env);
    const client = new SupabaseAuthClient(provider as never, log as never);
    return { client, log, provider };
};

const resposta = (status: number, corpo?: unknown): Response =>
    new Response(corpo === undefined ? null : JSON.stringify(corpo), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const SESSAO = {
    access_token: 'at',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1_790_000_000,
    refresh_token: 'rt',
    user: { id: UUID, email: 'fulano@columbiabr.com' },
};

const USUARIO = {
    id: UUID,
    email: 'fulano@columbiabr.com',
    email_confirmed_at: '2026-09-30T00:00:00Z',
    banned_until: null,
};

let fetchMock: jest.Mock;

beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
});

const chamada = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
    return {
        url,
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        signal: init.signal,
    };
};

describe('SupabaseAuthClient — endpoints públicos', () => {
    it('signInWithPassword: POST /token?grant_type=password com apikey publicável; sessão validada', async () => {
        fetchMock.mockImplementation(async () => resposta(200, SESSAO));
        const { client } = criar();

        const sessao = await client.signInWithPassword('fulano@columbiabr.com', 'segredo12');

        expect(sessao).toEqual({
            accessToken: 'at',
            refreshToken: 'rt',
            expiresAt: 1_790_000_000,
            userId: UUID,
            email: 'fulano@columbiabr.com',
        });
        const c = chamada();
        expect(c.url).toBe(`${URL_LOCAL}/auth/v1/token?grant_type=password`);
        expect(c.method).toBe('POST');
        expect(c.headers.apikey).toBe(PUBLISHABLE);
        expect(c.headers.authorization).toBeUndefined();
        expect(c.body).toEqual({ email: 'fulano@columbiabr.com', password: 'segredo12' });
        expect(c.signal).toBeInstanceOf(AbortSignal);
    });

    it('refresh: POST /token?grant_type=refresh_token', async () => {
        fetchMock.mockImplementation(async () => resposta(200, SESSAO));
        const { client } = criar();
        await client.refresh('rt-velho');
        expect(chamada().url).toBe(`${URL_LOCAL}/auth/v1/token?grant_type=refresh_token`);
        expect(chamada().body).toEqual({ refresh_token: 'rt-velho' });
    });

    it('sem expires_at, calcula pelo expires_in', async () => {
        const { expires_at: _omitido, ...semExpiresAt } = SESSAO;
        fetchMock.mockImplementation(async () => resposta(200, semExpiresAt));
        const { client } = criar();
        const antes = Math.floor(Date.now() / 1000);
        const sessao = await client.refresh('rt');
        expect(sessao.expiresAt).toBeGreaterThanOrEqual(antes + 3600);
        expect(sessao.expiresAt).toBeLessThanOrEqual(antes + 3601);
    });

    it('logout: POST /logout?scope=local com o access token do próprio usuário', async () => {
        fetchMock.mockImplementation(async () => resposta(204));
        const { client } = criar();
        await client.logout('access-do-usuario');
        const c = chamada();
        expect(c.url).toBe(`${URL_LOCAL}/auth/v1/logout?scope=local`);
        expect(c.headers.apikey).toBe(PUBLISHABLE);
        expect(c.headers.authorization).toBe('Bearer access-do-usuario');
    });

    it('2xx fora do formato = indisponível (nunca "sucesso parcial"), mensagem em português', async () => {
        fetchMock.mockImplementation(async () => resposta(200, { access_token: 'at' }));
        const { client } = criar();
        const erro = await client.signInWithPassword('a@b.com', 'x').catch((e) => e);
        expect(erro).toBeInstanceOf(SupabaseAuthUnavailableError);
        expect(erro.message).toMatch(/resposta inesperada/i);
    });
});

describe('SupabaseAuthClient — mapeamento de erros', () => {
    const casos: Array<[number, Record<string, unknown>, string]> = [
        [400, { code: 400, error_code: 'invalid_credentials', msg: 'x' }, 'invalid_credentials'],
        [400, { code: 400, error_code: 'user_banned', msg: 'x' }, 'user_banned'],
        [400, { error: 'invalid_grant', error_description: 'x' }, 'invalid_grant'],
        [401, { code: 401, error_code: 'bad_jwt', msg: 'x' }, 'bad_jwt'],
        [403, { code: 403, error_code: 'not_admin', msg: 'x' }, 'not_admin'],
    ];
    for (const [status, corpo, code] of casos) {
        it(`${status} ${code} → SupabaseAuthRejectedError com o code do GoTrue`, async () => {
            fetchMock.mockImplementation(async () => resposta(status, corpo));
            const { client } = criar();
            const erro = await client.signInWithPassword('a@b.com', 'x').catch((e) => e);
            expect(erro).toBeInstanceOf(SupabaseAuthRejectedError);
            expect(erro.code).toBe(code);
            expect(erro.status).toBe(status);
        });
    }

    it('422 email_exists → SupabaseEmailConflictError', async () => {
        fetchMock.mockResolvedValue(
            resposta(422, { code: 422, error_code: 'email_exists', msg: 'already registered' }),
        );
        const { client } = criar();
        await expect(
            client.adminCreateUser({ email: 'a@b.com', passwordHash: '$2a$12$x' }),
        ).rejects.toBeInstanceOf(SupabaseEmailConflictError);
    });

    it('429 → indisponível com marca de limite e retryable=false', async () => {
        fetchMock.mockResolvedValue(
            resposta(429, { code: 429, error_code: 'over_request_rate_limit' }),
        );
        const { client } = criar();
        const erro = await client.signInWithPassword('a@b.com', 'x').catch((e) => e);
        expect(erro).toBeInstanceOf(SupabaseAuthUnavailableError);
        expect(erro.rateLimited).toBe(true);
        expect(erro.retryable).toBe(false);
    });

    it('5xx → indisponível (retryable)', async () => {
        fetchMock.mockImplementation(async () => resposta(503, { message: 'x' }));
        const { client } = criar();
        const erro = await client.signInWithPassword('a@b.com', 'x').catch((e) => e);
        expect(erro).toBeInstanceOf(SupabaseAuthUnavailableError);
        expect(erro.rateLimited).toBe(false);
        expect(erro.retryable).toBe(true);
        expect(erro.status).toBe(503);
    });

    it('rede fora → indisponível; o log não leva status (não houve resposta)', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));
        const { client, log } = criar();
        await expect(client.refresh('rt')).rejects.toBeInstanceOf(SupabaseAuthUnavailableError);
        expect(log.warn.mock.calls[0][0].data).not.toHaveProperty('status');
    });

    it('timeout (AbortSignal) → indisponível, com o limite nomeado', async () => {
        const timeout = new DOMException(
            'The operation was aborted due to timeout',
            'TimeoutError',
        );
        fetchMock.mockRejectedValue(timeout);
        const { client } = criar();
        const erro = await client.refresh('rt').catch((e) => e);
        expect(erro).toBeInstanceOf(SupabaseAuthUnavailableError);
        expect(erro.message).toMatch(/tempo/i);
        expect(SupabaseAuthClient.REQUEST_TIMEOUT_MS).toBe(10_000);
    });

    it('falha do GoTrue é logada com operação, status e duração, sem corpo e sem chave', async () => {
        fetchMock.mockImplementation(async () => resposta(503, { segredo: 'corpo-com-token' }));
        const { client, log } = criar();
        await client.signInWithPassword('a@b.com', 'senha-nao-pode-vazar').catch(() => undefined);
        expect(log.warn).toHaveBeenCalledTimes(1);
        const [{ data, message }] = log.warn.mock.calls[0];
        expect(message).toMatch(/Supabase Auth/);
        expect(data).toMatchObject({ operacao: 'signInWithPassword', status: 503 });
        expect(typeof data.duracaoMs).toBe('number');
        const serializado = JSON.stringify(log.warn.mock.calls);
        expect(serializado).not.toContain('corpo-com-token');
        expect(serializado).not.toContain('senha-nao-pode-vazar');
        expect(serializado).not.toContain(SECRET);
    });
});

describe('SupabaseAuthClient — API admin', () => {
    it('com chave sb_secret_: só apikey (o gateway recusa sb_secret_ no Authorization)', async () => {
        fetchMock.mockImplementation(async () => resposta(200, USUARIO));
        const { client } = criar();
        await client.adminGetUser(UUID);
        expect(chamada().headers.apikey).toBe(SECRET);
        expect(chamada().headers.authorization).toBeUndefined();
    });

    it('com chave legada (JWT service_role): apikey e Authorization Bearer', async () => {
        fetchMock.mockImplementation(async () => resposta(200, USUARIO));
        const { client } = criar({ ...completo, supabaseSecretKey: LEGACY_SECRET });
        await client.adminGetUser(UUID);
        expect(chamada().headers.apikey).toBe(LEGACY_SECRET);
        expect(chamada().headers.authorization).toBe(`Bearer ${LEGACY_SECRET}`);
    });

    it('adminCreateUser: password_hash + email confirmado; banido quando pedido', async () => {
        fetchMock.mockImplementation(async () => resposta(200, USUARIO));
        const { client } = criar();
        const user = await client.adminCreateUser({
            email: 'fulano@columbiabr.com',
            passwordHash: '$2a$12$hash',
        });
        expect(user).toEqual({ id: UUID, email: 'fulano@columbiabr.com', banned: false });
        expect(chamada().url).toBe(`${URL_LOCAL}/auth/v1/admin/users`);
        expect(chamada().body).toEqual({
            email: 'fulano@columbiabr.com',
            password_hash: '$2a$12$hash',
            email_confirm: true,
        });

        fetchMock.mockImplementation(async () => resposta(200, USUARIO));
        await client.adminCreateUser({ email: 'b@c.com', passwordHash: 'h', banned: true });
        expect(chamada(1).body.ban_duration).toBe(SupabaseAuthClient.BAN_DURATION);
        expect(SupabaseAuthClient.BAN_DURATION).toBe('876000h');
    });

    it('adminUpdateUser: e-mail confirmado, senha em claro (T-1), ban e desban', async () => {
        fetchMock.mockImplementation(async () => resposta(200, USUARIO));
        const { client } = criar();
        await client.adminUpdateUser(UUID, { email: 'novo@columbiabr.com' });
        expect(chamada().method).toBe('PUT');
        expect(chamada().url).toBe(`${URL_LOCAL}/auth/v1/admin/users/${UUID}`);
        expect(chamada().body).toEqual({ email: 'novo@columbiabr.com', email_confirm: true });

        await client.adminUpdateUser(UUID, { password: 'nova-senha-123' });
        expect(chamada(1).body).toEqual({ password: 'nova-senha-123' });

        await client.adminUpdateUser(UUID, { banned: true });
        expect(chamada(2).body).toEqual({ ban_duration: '876000h' });
        await client.adminUpdateUser(UUID, { banned: false });
        expect(chamada(3).body).toEqual({ ban_duration: 'none' });
    });

    it('nenhum retry em escrita admin (create não é idempotente)', async () => {
        fetchMock.mockImplementation(async () => resposta(503, {}));
        const { client } = criar();
        await expect(
            client.adminCreateUser({ email: 'a@b.com', passwordHash: 'h' }),
        ).rejects.toBeInstanceOf(SupabaseAuthUnavailableError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('leitura admin pode repetir em indisponibilidade', async () => {
        fetchMock
            .mockResolvedValueOnce(resposta(503, {}))
            .mockResolvedValueOnce(resposta(200, USUARIO));
        const { client } = criar();
        await expect(client.adminGetUser(UUID)).resolves.toMatchObject({ id: UUID });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('adminGetUser: 404 → null; banned_until no futuro → banned', async () => {
        fetchMock.mockResolvedValueOnce(resposta(404, { code: 404, error_code: 'user_not_found' }));
        const { client } = criar();
        await expect(client.adminGetUser(UUID)).resolves.toBeNull();

        fetchMock.mockResolvedValueOnce(
            resposta(200, { ...USUARIO, banned_until: '2126-09-06T14:42:07Z' }),
        );
        await expect(client.adminGetUser(UUID)).resolves.toMatchObject({ banned: true });
    });

    it('adminFindUserByEmail: pagina GET /admin/users e casa sem distinção de caixa', async () => {
        const outros = Array.from({ length: SupabaseAuthClient.ADMIN_PAGE_SIZE }, (_, i) => ({
            ...USUARIO,
            id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            email: `u${i}@x.com`,
        }));
        fetchMock
            .mockResolvedValueOnce(resposta(200, { users: outros, aud: 'authenticated' }))
            .mockResolvedValueOnce(
                resposta(200, {
                    users: [{ ...USUARIO, email: 'Fulano@ColumbiaBR.com' }],
                    aud: 'authenticated',
                }),
            );
        const { client } = criar();
        const achado = await client.adminFindUserByEmail('fulano@columbiabr.com');
        expect(achado?.id).toBe(UUID);
        expect(chamada(0).url).toBe(
            `${URL_LOCAL}/auth/v1/admin/users?page=1&per_page=${SupabaseAuthClient.ADMIN_PAGE_SIZE}`,
        );
        expect(chamada(1).url).toContain('page=2');
    });

    it('adminFindUserByEmail: não achou → null', async () => {
        fetchMock.mockImplementation(async () =>
            resposta(200, { users: [USUARIO], aud: 'authenticated' }),
        );
        const { client } = criar();
        await expect(client.adminFindUserByEmail('outro@x.com')).resolves.toBeNull();
    });
});

describe('SupabaseAuthClient — configuração', () => {
    it('lê o env na primeira chamada, não no construtor', async () => {
        const { provider } = criar();
        expect(provider.getEnvironmentVars).not.toHaveBeenCalled();
    });

    it('isAdminConfigured: exige URL e chave secreta', async () => {
        await expect(criar().client.isAdminConfigured()).resolves.toBe(true);
        await expect(
            criar({
                supabaseUrl: URL_LOCAL,
                supabasePublishableKey: PUBLISHABLE,
            }).client.isAdminConfigured(),
        ).resolves.toBe(false);
        await expect(criar({}).client.isAdminConfigured()).resolves.toBe(false);
    });

    it('sem configuração: erro em português "Supabase Auth não configurado", sem chamar a rede', async () => {
        const { client } = criar({ supabaseUrl: URL_LOCAL });
        await expect(client.adminGetUser(UUID)).rejects.toThrow(/Supabase Auth não configurado/);
        await expect(client.signInWithPassword('a@b.com', 'x')).rejects.toThrow(
            /Supabase Auth não configurado/,
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a chave secreta nunca aparece no erro serializado', async () => {
        fetchMock.mockImplementation(async () =>
            resposta(403, { code: 403, error_code: 'not_admin' }),
        );
        const { client } = criar();
        const erro = await client.adminGetUser(UUID).catch((e) => e);
        const serializado = `${erro.message} ${JSON.stringify(erro)} ${String(erro.stack)}`;
        expect(serializado).not.toContain(SECRET);
    });
});

describe('SupabaseAuthClient — fonte (I7, sem SDK, fora do bootstrap)', () => {
    const fonte = readFileSync(path.join(__dirname, 'SupabaseAuthClient.ts'), 'utf8');

    it('não usa @supabase/* nem SQL no schema auth', () => {
        expect(fonte).not.toMatch(/from '@supabase\//);
        expect(fonte).not.toMatch(/\bauth\.(users|identities)\b/);
    });

    it('nenhum package.json declara @supabase/*', () => {
        for (const pkg of ['../../package.json', '../../../frontend/package.json']) {
            const conteudo = readFileSync(path.join(__dirname, pkg), 'utf8');
            expect(conteudo).not.toMatch(/"@supabase\//);
        }
    });

    it('o appContainer não referencia o SupabaseAuthClient (gotcha dos ~58 jobs)', () => {
        const container = readFileSync(path.join(__dirname, '..', 'appContainer.ts'), 'utf8');
        expect(container).not.toMatch(/SupabaseAuth/);
    });
});
