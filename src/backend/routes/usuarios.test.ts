import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';

// Neutraliza o bootstrap real (sem Conexos/DB).
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import { SupabaseEmailAlreadyExistsError } from '../domain/client/SupabaseAdminClient.js';
import { UsernameAlreadyExistsError } from '../domain/repository/auth/UserRepository.js';
import UserAdminService, {
    SelfDeactivationError,
} from '../domain/service/auth/UserAdminService.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import type { AuthUser } from '../http/auth.js';
import usuariosRouter from './usuarios.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const ADMIN: AuthUser = { sub: 'uuid-admin', username: 'simone@kavex.com', role: 'admin' };

const readJson = async (res: Response): Promise<Record<string, any>> =>
    (await res.json()) as Record<string, any>;

const buildApp = (user: AuthUser = ADMIN): express.Express => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        // Simula `buildAuthMiddleware` + `appUserContext`: `role` e `username` já vêm
        // RESOLVIDOS DO BANCO quando o router é alcançado.
        req.user = user;
        next();
    });
    app.use('/usuarios', usuariosRouter);
    app.use(errorMiddleware);
    return app;
};

const listen = (app: express.Express): Promise<TestServer> =>
    new Promise((resolve) => {
        const server: Server = app.listen(0, () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });

const send = (url: string, method: string, body?: unknown) =>
    fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

const buildService = (over: Record<string, unknown> = {}) => {
    const service = {
        list: jest.fn().mockResolvedValue([]),
        convidarUsuario: jest.fn().mockResolvedValue({
            id: 9,
            username: 'novo@kavex.com',
            role: 'operador',
            ativo: false,
            convitePendente: true,
            createdAt: '2026-08-06T00:00:00.000Z',
        }),
        cadastrarUsuarioComSenha: jest.fn().mockResolvedValue({
            id: 10,
            username: 'novo2@kavex.com',
            role: 'operador',
            ativo: true,
            convitePendente: false,
            createdAt: '2026-08-06T00:00:00.000Z',
        }),
        setAtivo: jest.fn().mockResolvedValue({ id: 6, ativo: false, banGoTrue: 'ok' }),
        redefinirSenhaDeTerceiro: jest.fn().mockResolvedValue(undefined),
        setVinculo: jest.fn().mockResolvedValue(undefined),
        vinculoDisponivel: jest.fn().mockResolvedValue(true),
        ...over,
    };
    container.registerInstance(UserAdminService, service as never);
    return service;
};

afterEach(() => {
    container.clearInstances();
    jest.restoreAllMocks();
});

describe('requireRole cobre o router inteiro', () => {
    it('operador autenticado recebe 403 em toda a gestão', async () => {
        buildService();
        const server = await listen(buildApp({ ...ADMIN, role: 'operador' }));
        try {
            expect((await send(`${server.url}/usuarios`, 'GET')).status).toBe(403);
            expect(
                (await send(`${server.url}/usuarios/convite`, 'POST', { username: 'x@kavex.com' }))
                    .status,
            ).toBe(403);
        } finally {
            await server.close();
        }
    });
});

describe('GET /usuarios — o status derivado', () => {
    it('distingue convidado de inativo (os dois são ativo=false no banco)', async () => {
        buildService({
            list: jest.fn().mockResolvedValue([
                { id: 1, username: 'a@k.com', role: 'admin', ativo: true, convitePendente: false },
                {
                    id: 2,
                    username: 'b@k.com',
                    role: 'operador',
                    ativo: false,
                    convitePendente: true,
                },
                {
                    id: 3,
                    username: 'c@k.com',
                    role: 'operador',
                    ativo: false,
                    convitePendente: false,
                },
            ]),
        });
        const server = await listen(buildApp());
        try {
            const body = (await (await send(`${server.url}/usuarios`, 'GET')).json()) as Array<{
                status: string;
            }>;
            // Sem esta distinção a UI ofereceria "reenviar convite" para quem foi desligado.
            expect(body.map((u) => u.status)).toEqual(['ativo', 'convidado', 'inativo']);
        } finally {
            await server.close();
        }
    });
});

describe('POST /usuarios/convite (U1) e POST /usuarios (U3)', () => {
    it('convite: 201 e o ATOR é o username (I-Usuario-1), nunca o sub', async () => {
        const service = buildService();
        const server = await listen(buildApp());
        try {
            const res = await send(`${server.url}/usuarios/convite`, 'POST', {
                username: 'NOVO@Kavex.com ',
            });
            expect(res.status).toBe(201);
            expect(service.convidarUsuario).toHaveBeenCalledWith(
                { username: 'novo@kavex.com', role: 'operador' },
                'simone@kavex.com',
            );
        } finally {
            await server.close();
        }
    });

    it('fallback com senha: 201 e nasce ativo', async () => {
        const service = buildService();
        const server = await listen(buildApp());
        try {
            const res = await send(`${server.url}/usuarios`, 'POST', {
                username: 'novo2@kavex.com',
                password: 'segredo12',
            });
            expect(res.status).toBe(201);
            expect((await readJson(res)).ativo).toBe(true);
            expect(service.cadastrarUsuarioComSenha).toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });

    it('409 em e-mail duplicado — nas DUAS origens, com a mesma mensagem PT-BR', async () => {
        const server = await listen(buildApp());
        try {
            buildService({
                convidarUsuario: jest
                    .fn()
                    .mockRejectedValue(new UsernameAlreadyExistsError('dup@kavex.com')),
            });
            const local = await send(`${server.url}/usuarios/convite`, 'POST', {
                username: 'dup@kavex.com',
            });
            expect(local.status).toBe(409);
            expect((await readJson(local)).error).toBe('Já existe um usuário com este email.');

            container.clearInstances();
            buildService({
                convidarUsuario: jest
                    .fn()
                    .mockRejectedValue(new SupabaseEmailAlreadyExistsError('dup@kavex.com')),
            });
            const provider = await send(`${server.url}/usuarios/convite`, 'POST', {
                username: 'dup@kavex.com',
            });
            expect(provider.status).toBe(409);
            expect((await readJson(provider)).error).toBe('Já existe um usuário com este email.');
        } finally {
            await server.close();
        }
    });
});

describe('PATCH /:id/ativo', () => {
    it('propaga o SUCESSO PARCIAL para a UI com HTTP 200', async () => {
        // Devolver erro faria o admin crer que não desativou ninguém quando na prática
        // desativou — e ele agiria por fora, ou assumiria que a pessoa ainda tem acesso.
        buildService({
            setAtivo: jest.fn().mockResolvedValue({ id: 6, ativo: false, banGoTrue: 'falhou' }),
        });
        const server = await listen(buildApp());
        try {
            const res = await send(`${server.url}/usuarios/6/ativo`, 'PATCH', { ativo: false });
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ id: 6, ativo: false, banGoTrue: 'falhou' });
        } finally {
            await server.close();
        }
    });

    it('autodesativação: 403 com mensagem DISTINTA do 403 genérico de papel', async () => {
        buildService({
            setAtivo: jest.fn().mockRejectedValue(new SelfDeactivationError('simone@kavex.com')),
        });
        const server = await listen(buildApp());
        try {
            const res = await send(`${server.url}/usuarios/6/ativo`, 'PATCH', { ativo: false });
            expect(res.status).toBe(403);
            const { error } = (await res.json()) as { error: string };
            // Quem cai aqui É admin: "permissão insuficiente" mandaria a pessoa investigar a
            // coisa errada.
            expect(error).toMatch(/seu próprio acesso/i);
            expect(error).not.toMatch(/insufficient role/i);
        } finally {
            await server.close();
        }
    });

    it('passa o ATOR (username) para o service — é o que I-Usuario-6 compara', async () => {
        const service = buildService();
        const server = await listen(buildApp());
        try {
            await send(`${server.url}/usuarios/6/ativo`, 'PATCH', { ativo: false });
            expect(service.setAtivo).toHaveBeenCalledWith(6, false, 'simone@kavex.com');
        } finally {
            await server.close();
        }
    });
});

describe('POST /:id/reset-senha — a senha saiu do contrato', () => {
    it('dispara o link e NÃO aceita mais uma senha no corpo (400)', async () => {
        const service = buildService();
        const server = await listen(buildApp());
        try {
            const ok = await send(`${server.url}/usuarios/6/reset-senha`, 'POST', {});
            expect(ok.status).toBe(200);
            expect(service.redefinirSenhaDeTerceiro).toHaveBeenCalledWith(6);

            // Um cliente desatualizado mandando `password` precisa ver o erro. Aceitar e
            // ignorar em silêncio deixaria o admin achando que definiu uma senha.
            const comSenha = await send(`${server.url}/usuarios/6/reset-senha`, 'POST', {
                password: 'segredo12',
            });
            expect(comSenha.status).toBe(400);
            expect((await readJson(comSenha)).error).toMatch(/link de redefinição/i);
            expect(service.redefinirSenhaDeTerceiro).toHaveBeenCalledTimes(1);
        } finally {
            await server.close();
        }
    });
});

describe('GUARDA — a resposta nunca carrega segredo', () => {
    it('GET /usuarios não expõe password_hash nem conexos_password_enc', async () => {
        buildService({
            list: jest.fn().mockResolvedValue([
                {
                    id: 1,
                    username: 'a@k.com',
                    role: 'admin',
                    ativo: true,
                    convitePendente: false,
                },
            ]),
        });
        const server = await listen(buildApp());
        try {
            const raw = await (await send(`${server.url}/usuarios`, 'GET')).text();
            expect(raw).not.toContain('password');
            expect(raw).not.toContain('conexos_password_enc');
        } finally {
            await server.close();
        }
    });
});
