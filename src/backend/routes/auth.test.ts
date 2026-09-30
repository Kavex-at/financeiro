import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import SupabaseAuthUnavailableError from '../domain/errors/SupabaseAuthUnavailableError.js';
import AuthService from '../domain/service/auth/AuthService.js';
import SupabaseSessionService from '../domain/service/auth/SupabaseSessionService.js';
import type { VerifiedToken } from '../http/auth.js';
import { buildAuthRouter } from './auth.js';

// O bootstrap real importa migrations (usa `import.meta`, incompatível com o transform CJS).
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

interface TestServer {
    server: Server;
    url: string;
}

const listen = (app: express.Express): Promise<TestServer> =>
    new Promise((resolve) => {
        const server: Server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });

let srv: TestServer;
/** Modo de `AUTH_PROVIDER` no teste — mutável por caso. */
let modo: 'local' | 'supabase' = 'local';
const localLogin = jest.fn();
const sessao = { login: jest.fn(), refresh: jest.fn(), logout: jest.fn() };
const verifyAccessToken = jest.fn<Promise<VerifiedToken>, [string]>();

beforeAll(async () => {
    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) => {
        if (token === AuthService) return { login: localLogin };
        if (token === SupabaseSessionService) return sessao;
        if (typeof token === 'function' && token.name === 'EnvironmentProvider') {
            return { getEnvironmentVars: async () => ({ authProvider: modo }) };
        }
        return real(token as never);
    }) as never);

    const app = express();
    app.use(express.json());
    app.use('/auth', buildAuthRouter({ verifyAccessToken }));
    srv = await listen(app);
});

afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((r) => srv.server.close(r));
});

beforeEach(() => {
    modo = 'local';
    localLogin.mockReset();
    sessao.login.mockReset();
    sessao.refresh.mockReset();
    sessao.logout.mockReset().mockResolvedValue(undefined);
    verifyAccessToken.mockReset();
    (bootstrapAppContainer as jest.Mock).mockClear();
});

const post = (caminho: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${srv.url}/auth${caminho}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });

const SESSAO_SUPABASE = {
    token: 'at',
    refreshToken: 'rt',
    expiresAt: 1_790_000_000,
    username: 'fulano',
    role: 'admin',
    email: 'fulano@columbiabr.com',
};

describe('POST /auth/login — modo local (AUTH_PROVIDER ausente/local)', () => {
    it('normaliza o identificador (trim + minúsculas) antes de chegar ao service', async () => {
        localLogin.mockResolvedValue({ token: 't', username: 'fulano@kavex.com', role: 'admin' });
        const res = await post('/login', { username: ' Fulano@Kavex.COM ', password: 'segredo12' });
        expect(res.status).toBe(200);
        expect(localLogin).toHaveBeenCalledWith({
            username: 'fulano@kavex.com',
            password: 'segredo12',
        });
        expect(sessao.login).not.toHaveBeenCalled();
    });

    it('o corpo continua { username, password }: o campo aceita e-mail sem mudar de nome', async () => {
        localLogin.mockResolvedValue({
            token: 't',
            username: 'admin',
            role: 'admin',
            email: 'ti@columbiabr.com',
        });
        const res = await post('/login', { username: 'ti@columbiabr.com', password: 'segredo12' });
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ username: 'admin' });
    });

    it('credencial recusada pelo service: 401 genérico', async () => {
        localLogin.mockResolvedValue(null);
        const res = await post('/login', { username: 'x@kavex.com', password: 'segredo12' });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Credenciais inválidas' });
    });

    it('corpo inválido: 400', async () => {
        const res = await post('/login', { username: '   ' });
        expect(res.status).toBe(400);
        expect(localLogin).not.toHaveBeenCalled();
    });
});

describe('POST /auth/login — modo supabase', () => {
    beforeEach(() => {
        modo = 'supabase';
    });

    it('usa o SupabaseSessionService e devolve token, refreshToken e expiresAt', async () => {
        sessao.login.mockResolvedValue(SESSAO_SUPABASE);
        const res = await post('/login', { username: 'Fulano', password: 'segredo12' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(SESSAO_SUPABASE);
        expect(sessao.login).toHaveBeenCalledWith({ username: 'fulano', password: 'segredo12' });
        expect(localLogin).not.toHaveBeenCalled();
    });

    it('kavex-report-ciclo: { username: "admin", password } por USERNAME devolve token', async () => {
        sessao.login.mockResolvedValue({ ...SESSAO_SUPABASE, username: 'admin' });
        const res = await post('/login', { username: 'admin', password: 'segredo12' });
        expect(res.status).toBe(200);
        expect(((await res.json()) as { token: string }).token).toBe('at');
    });

    it('credencial recusada: o MESMO 401 do modo local', async () => {
        sessao.login.mockResolvedValue(null);
        const res = await post('/login', { username: 'x', password: 'segredo12' });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Credenciais inválidas' });
    });

    it('GoTrue fora (5xx/timeout): 503 em português', async () => {
        sessao.login.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        const res = await post('/login', { username: 'x', password: 'segredo12' });
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({
            error: 'Serviço de autenticação indisponível. Tente novamente em instantes.',
        });
    });

    it('GoTrue 429: o 429 do nosso limitador', async () => {
        sessao.login.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'rate_limited', 429));
        const res = await post('/login', { username: 'x', password: 'segredo12' });
        expect(res.status).toBe(429);
        expect(await res.json()).toEqual({
            error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
        });
    });
});

describe('POST /auth/refresh (pública)', () => {
    it('corpo inválido: 400 "Requisição inválida"', async () => {
        const res = await post('/refresh', { refreshToken: '' });
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: 'Requisição inválida' });
    });

    it('modo local (D1): 401 "Sessão expirada" sem chamar o GoTrue', async () => {
        const res = await post('/refresh', { refreshToken: 'rt' });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Sessão expirada. Entre novamente.' });
        expect(sessao.refresh).not.toHaveBeenCalled();
    });

    it('modo supabase: renova e devolve o formato do login', async () => {
        modo = 'supabase';
        sessao.refresh.mockResolvedValue(SESSAO_SUPABASE);
        const res = await post('/refresh', { refreshToken: 'rt' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(SESSAO_SUPABASE);
        expect(sessao.refresh).toHaveBeenCalledWith('rt');
    });

    it('modo supabase, recusa do GoTrue: 401 "Sessão expirada"', async () => {
        modo = 'supabase';
        sessao.refresh.mockResolvedValue(null);
        const res = await post('/refresh', { refreshToken: 'rt' });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Sessão expirada. Entre novamente.' });
    });

    it('modo supabase, GoTrue indisponível: 503', async () => {
        modo = 'supabase';
        sessao.refresh.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'server_error'));
        const res = await post('/refresh', { refreshToken: 'rt' });
        expect(res.status).toBe(503);
    });
});

describe('POST /auth/logout (D2)', () => {
    it('sem Bearer: 204', async () => {
        const res = await post('/logout', {});
        expect(res.status).toBe(204);
        expect(verifyAccessToken).not.toHaveBeenCalled();
    });

    it('token app válido: 204 sem chamar o GoTrue', async () => {
        verifyAccessToken.mockResolvedValue({ sub: 'fulano', emissor: 'app' });
        const res = await post('/logout', {}, { authorization: 'Bearer app-token' });
        expect(res.status).toBe(204);
        expect(sessao.logout).not.toHaveBeenCalled();
    });

    it('token supabase válido: revoga no GoTrue e 204 (vale mesmo em modo local)', async () => {
        verifyAccessToken.mockResolvedValue({ sub: 'uuid', emissor: 'supabase' });
        const res = await post('/logout', {}, { authorization: 'Bearer supa-token' });
        expect(res.status).toBe(204);
        expect(sessao.logout).toHaveBeenCalledWith('supa-token', 'uuid');
    });

    it('falha do GoTrue no logout: 204 assim mesmo (o service só avisa)', async () => {
        verifyAccessToken.mockResolvedValue({ sub: 'uuid', emissor: 'supabase' });
        sessao.logout.mockResolvedValue(undefined);
        const res = await post('/logout', {}, { authorization: 'Bearer supa-token' });
        expect(res.status).toBe(204);
    });

    it('token inválido: 204 sem chamada nenhuma', async () => {
        verifyAccessToken.mockRejectedValue(new Error('invalid'));
        const res = await post('/logout', {}, { authorization: 'Bearer lixo' });
        expect(res.status).toBe(204);
        expect(sessao.logout).not.toHaveBeenCalled();
    });

    it('não passa pelo banco: sem bootstrapAppContainer quando o token é app', async () => {
        verifyAccessToken.mockResolvedValue({ sub: 'fulano', emissor: 'app' });
        await post('/logout', {}, { authorization: 'Bearer app-token' });
        expect(bootstrapAppContainer).not.toHaveBeenCalled();
    });
});

describe('GET /auth/transicao', () => {
    it('não existe mais: 404 no router', async () => {
        const res = await fetch(`${srv.url}/auth/transicao`);
        expect(res.status).toBe(404);
    });
});
