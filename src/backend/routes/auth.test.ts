import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import UserRepository from '../domain/repository/auth/UserRepository.js';
import AuthService from '../domain/service/auth/AuthService.js';

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
let login: jest.Mock;
/** Valor da chave do banner no teste — mutável por caso. */
let bannerAtivo = false;
/** Tudo que a rota resolveu do container. */
let resolvidos: unknown[];

beforeAll(async () => {
    login = jest.fn();
    resolvidos = [];
    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) => {
        resolvidos.push(token);
        if (token === AuthService) return { login };
        if (token === UserRepository) throw new Error('a rota não deveria tocar o banco');
        if (typeof token === 'function' && token.name === 'EnvironmentProvider') {
            return {
                getEnvironmentVars: jest.fn().mockImplementation(async () => ({
                    authTransicaoEmailBanner: bannerAtivo,
                })),
            };
        }
        return real(token as never);
    }) as never);

    const { default: authRouter } = await import('./auth.js');
    const app = express();
    app.use(express.json());
    app.use('/auth', authRouter);
    srv = await listen(app);
});

afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((r) => srv.server.close(r));
});

beforeEach(() => {
    login.mockReset();
    resolvidos.length = 0;
    (bootstrapAppContainer as jest.Mock).mockClear();
});

const postLogin = (body: unknown) =>
    fetch(`${srv.url}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

describe('POST /auth/login', () => {
    it('normaliza o identificador (trim + minúsculas) antes de chegar ao service', async () => {
        login.mockResolvedValue({ token: 't', username: 'fulano@kavex.com', role: 'admin' });
        const res = await postLogin({ username: ' Fulano@Kavex.COM ', password: 'segredo12' });
        expect(res.status).toBe(200);
        expect(login).toHaveBeenCalledWith({
            username: 'fulano@kavex.com',
            password: 'segredo12',
        });
    });

    it('o corpo continua { username, password }: o campo aceita e-mail sem mudar de nome', async () => {
        login.mockResolvedValue({
            token: 't',
            username: 'admin',
            role: 'admin',
            email: 'ti@columbiabr.com',
        });
        const res = await postLogin({ username: 'ti@columbiabr.com', password: 'segredo12' });
        expect(res.status).toBe(200);
        // Login por e-mail responde o username CANÔNICO (é o que o AuthProvider guarda).
        expect(await res.json()).toMatchObject({ username: 'admin' });
    });

    it('credencial recusada pelo service: 401 genérico', async () => {
        login.mockResolvedValue(null);
        const res = await postLogin({ username: 'x@kavex.com', password: 'segredo12' });
        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'Credenciais inválidas' });
    });

    it('corpo inválido: 400', async () => {
        const res = await postLogin({ username: '   ' });
        expect(res.status).toBe(400);
        expect(login).not.toHaveBeenCalled();
    });
});

describe('GET /auth/transicao', () => {
    it('chave ligada: 200 com exatamente { ativo: true }', async () => {
        bannerAtivo = true;
        const res = await fetch(`${srv.url}/auth/transicao`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ativo: true });
    });

    it('chave desligada: 200 com exatamente { ativo: false } (I5: sem contagem, nomes ou e-mails)', async () => {
        bannerAtivo = false;
        const res = await fetch(`${srv.url}/auth/transicao`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ativo: false });
    });

    it('não toca o banco: sem bootstrapAppContainer e sem UserRepository', async () => {
        await fetch(`${srv.url}/auth/transicao`);
        expect(bootstrapAppContainer).not.toHaveBeenCalled();
        expect(resolvidos).not.toContain(UserRepository);
        const nomes = resolvidos.map((t) => (typeof t === 'function' ? t.name : String(t)));
        expect(nomes).toEqual(['EnvironmentProvider']);
    });

    it('responde com Cache-Control: no-store (desligar a chave vale no próximo carregamento)', async () => {
        const res = await fetch(`${srv.url}/auth/transicao`);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });
});
