import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { container } from 'tsyringe';
import type SecretCipher from '../domain/libs/crypto/SecretCipher.js';
import {
    DEACTIVATE_RESULT,
    EmailAlreadyInUseError,
    LastActiveAdminError,
    SET_EMAIL_RESULT,
    SelfDeactivationError,
} from '../domain/repository/auth/UserRepository.js';
import type UserRepository from '../domain/repository/auth/UserRepository.js';
import type LogService from '../domain/service/LogService.js';
import UserAdminService from '../domain/service/auth/UserAdminService.js';

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

/** Usuário autenticado da requisição — o auth real roda a montante; aqui é injetado. */
let usuarioAtual: { sub?: string; role?: string } | undefined;

const repo = {
    listAll: jest.fn(),
    create: jest.fn(),
    setAtivo: jest.fn(),
    updatePassword: jest.fn(),
    setVinculoConexos: jest.fn(),
    setEmail: jest.fn(),
    deactivateGuarded: jest.fn(),
};
const log = {
    info: jest.fn().mockResolvedValue(undefined),
    error: jest.fn().mockResolvedValue(undefined),
    warn: jest.fn().mockResolvedValue(undefined),
};
const cipher = {
    encrypt: jest.fn(),
    isEnabled: jest.fn().mockResolvedValue(true),
};

let srv: TestServer;

beforeAll(async () => {
    // Service REAL sobre o repositório falso: exercita Zod → service → mapeamento de erro.
    const service = new UserAdminService(
        repo as unknown as UserRepository,
        cipher as unknown as SecretCipher,
        log as unknown as LogService,
    );
    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) => {
        if (token === UserAdminService) return service;
        return real(token as never);
    }) as never);

    const { default: usuariosRouter } = await import('./usuarios.js');
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
        if (usuarioAtual) (req as unknown as { user?: unknown }).user = usuarioAtual;
        next();
    });
    app.use('/usuarios', usuariosRouter);
    // Erro não mapeado cai no middleware central (aqui, um 500 simples).
    app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: 'erro interno' });
    });
    srv = await listen(app);
});

afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((r) => srv.server.close(r));
});

beforeEach(() => {
    usuarioAtual = { sub: 'simone@kavex.com', role: 'admin' };
    for (const fn of Object.values(repo)) fn.mockReset();
    log.info.mockClear();
});

const send = (method: string, path: string, body?: unknown) =>
    fetch(`${srv.url}/usuarios${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

const json = async (res: globalThis.Response): Promise<Record<string, unknown>> =>
    (await res.json()) as Record<string, unknown>;

describe('GET /usuarios', () => {
    it('devolve email quando preenchido e omite a chave quando é NULL', async () => {
        repo.listAll.mockResolvedValue([
            {
                id: 1,
                username: 'admin',
                role: 'admin',
                ativo: true,
                createdAt: 'x',
                email: 'ti@columbiabr.com',
            },
            { id: 2, username: 'b@kavex.com', role: 'admin', ativo: true, createdAt: 'x' },
        ]);
        const res = await send('GET', '/');
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>[];
        expect(body[0]).toMatchObject({ email: 'ti@columbiabr.com' });
        expect(body[1]).not.toHaveProperty('email');
    });
});

describe('PATCH /usuarios/:id/email', () => {
    it('200 { id, email } com o e-mail normalizado e o ator = req.user.sub', async () => {
        repo.setEmail.mockResolvedValue(SET_EMAIL_RESULT.UPDATED);
        const res = await send('PATCH', '/7/email', { email: ' Maria@ColumbiaBR.com ' });
        expect(res.status).toBe(200);
        expect(await json(res)).toEqual({ id: 7, email: 'maria@columbiabr.com' });
        expect(repo.setEmail).toHaveBeenCalledWith(7, 'maria@columbiabr.com', 'simone@kavex.com');
    });

    it('loga a edição em português com o id e o ator, sem senha', async () => {
        repo.setEmail.mockResolvedValue(SET_EMAIL_RESULT.UPDATED);
        await send('PATCH', '/7/email', { email: 'maria@columbiabr.com', password: 'x12345678' });
        expect(log.info).toHaveBeenCalledTimes(1);
        const params = log.info.mock.calls[0][0];
        expect(params.data).toMatchObject({ id: 7, ator: 'simone@kavex.com' });
        expect(JSON.stringify(params)).not.toContain('x12345678');
    });

    it('400 "E-mail inválido." para e-mail inválido', async () => {
        const res = await send('PATCH', '/7/email', { email: 'nao-e-email' });
        expect(res.status).toBe(400);
        expect(await json(res)).toEqual({ error: 'E-mail inválido.' });
        expect(repo.setEmail).not.toHaveBeenCalled();
    });

    it('404 "Usuário não encontrado." para id inexistente', async () => {
        repo.setEmail.mockResolvedValue(SET_EMAIL_RESULT.NOT_FOUND);
        const res = await send('PATCH', '/999/email', { email: 'a@columbiabr.com' });
        expect(res.status).toBe(404);
        expect(await json(res)).toEqual({ error: 'Usuário não encontrado.' });
    });

    it('409 quando colide com o email ou o username de outro usuário', async () => {
        repo.setEmail.mockRejectedValue(new EmailAlreadyInUseError('b@kavex.com'));
        const res = await send('PATCH', '/7/email', { email: 'b@kavex.com' });
        expect(res.status).toBe(409);
        expect(await json(res)).toEqual({ error: 'Este e-mail já identifica outro usuário.' });
    });

    it('409 também na colisão só de caixa: Maria@X.com chega normalizado a maria@x.com', async () => {
        repo.setEmail.mockRejectedValue(new EmailAlreadyInUseError('maria@x.com'));
        const res = await send('PATCH', '/7/email', { email: 'Maria@X.com' });
        expect(res.status).toBe(409);
        expect(repo.setEmail).toHaveBeenCalledWith(7, 'maria@x.com', 'simone@kavex.com');
    });

    it('operador recebe 403 (o guard de admin cobre a rota nova)', async () => {
        usuarioAtual = { sub: 'op@kavex.com', role: 'operador' };
        const res = await send('PATCH', '/7/email', { email: 'a@columbiabr.com' });
        expect(res.status).toBe(403);
        expect(repo.setEmail).not.toHaveBeenCalled();
    });

    it('ignora username no body: nenhuma rota edita username (I1)', async () => {
        repo.setEmail.mockResolvedValue(SET_EMAIL_RESULT.UPDATED);
        const res = await send('PATCH', '/7/email', {
            email: 'a@columbiabr.com',
            username: 'outro',
        });
        expect(res.status).toBe(200);
        expect(repo.setEmail).toHaveBeenCalledWith(7, 'a@columbiabr.com', 'simone@kavex.com');
        expect(repo.setAtivo).not.toHaveBeenCalled();
        expect(repo.create).not.toHaveBeenCalled();
    });

    it('id inválido: 400', async () => {
        const res = await send('PATCH', '/abc/email', { email: 'a@columbiabr.com' });
        expect(res.status).toBe(400);
    });
});

describe('POST /usuarios', () => {
    const criado = (email: string) => ({
        id: 9,
        username: email,
        email,
        role: 'operador',
        ativo: true,
        createdAt: '2026-09-28T00:00:00.000Z',
    });

    it('aceita email e grava username = email = valor normalizado', async () => {
        repo.create.mockImplementation(async (i: { email: string }) => criado(i.email));
        const res = await send('POST', '/', {
            email: ' Nova@ColumbiaBR.com',
            password: 'segredo12',
        });
        expect(res.status).toBe(201);
        expect(repo.create.mock.calls[0][0]).toMatchObject({ email: 'nova@columbiabr.com' });
        expect(await json(res)).toMatchObject({
            username: 'nova@columbiabr.com',
            email: 'nova@columbiabr.com',
        });
    });

    it('aceita username como alias (front antigo durante o deploy)', async () => {
        repo.create.mockImplementation(async (i: { email: string }) => criado(i.email));
        const res = await send('POST', '/', { username: 'nova@kavex.com', password: 'segredo12' });
        expect(res.status).toBe(201);
        expect(repo.create.mock.calls[0][0]).toMatchObject({ email: 'nova@kavex.com' });
    });

    it('email e username diferentes: 400', async () => {
        const res = await send('POST', '/', {
            email: 'a@columbiabr.com',
            username: 'b@columbiabr.com',
            password: 'segredo12',
        });
        expect(res.status).toBe(400);
        expect(repo.create).not.toHaveBeenCalled();
    });

    it('colisão cruzada: 409 com a mesma mensagem do PATCH', async () => {
        repo.create.mockRejectedValue(new EmailAlreadyInUseError('maria@columbiabr.com'));
        const res = await send('POST', '/', {
            email: 'maria@columbiabr.com',
            password: 'segredo12',
        });
        expect(res.status).toBe(409);
        expect(await json(res)).toEqual({ error: 'Este e-mail já identifica outro usuário.' });
    });
});

describe('PATCH /usuarios/:id/ativo', () => {
    it('desativar passa pela guarda com o ator = req.user.sub', async () => {
        repo.deactivateGuarded.mockResolvedValue(DEACTIVATE_RESULT.DEACTIVATED);
        const res = await send('PATCH', '/2/ativo', { ativo: false });
        expect(res.status).toBe(200);
        expect(repo.deactivateGuarded).toHaveBeenCalledWith(2, 'simone@kavex.com');
        expect(repo.setAtivo).not.toHaveBeenCalled();
    });

    it('desativar a si mesmo: 409 com mensagem em português', async () => {
        repo.deactivateGuarded.mockRejectedValue(new SelfDeactivationError());
        const res = await send('PATCH', '/1/ativo', { ativo: false });
        expect(res.status).toBe(409);
        expect(await json(res)).toEqual({ error: 'Você não pode desativar o próprio acesso.' });
    });

    it('desativar o último admin ativo: 409 com mensagem em português', async () => {
        repo.deactivateGuarded.mockRejectedValue(new LastActiveAdminError());
        const res = await send('PATCH', '/1/ativo', { ativo: false });
        expect(res.status).toBe(409);
        expect(await json(res)).toEqual({
            error: 'Não é possível desativar o último administrador ativo.',
        });
    });

    it('sem req.user.sub: recusa, nunca desativa às cegas', async () => {
        usuarioAtual = { role: 'admin' };
        const res = await send('PATCH', '/2/ativo', { ativo: false });
        expect(res.status).toBe(401);
        expect(repo.deactivateGuarded).not.toHaveBeenCalled();
        expect(repo.setAtivo).not.toHaveBeenCalled();
    });

    it('reativar não passa pela guarda', async () => {
        repo.setAtivo.mockResolvedValue(true);
        const res = await send('PATCH', '/2/ativo', { ativo: true });
        expect(res.status).toBe(200);
        expect(repo.setAtivo).toHaveBeenCalledWith(2, true);
        expect(repo.deactivateGuarded).not.toHaveBeenCalled();
    });

    it('erro desconhecido continua indo ao middleware central', async () => {
        repo.deactivateGuarded.mockRejectedValue(new Error('conexão caiu'));
        const res = await send('PATCH', '/2/ativo', { ativo: false });
        expect(res.status).toBe(500);
    });
});
