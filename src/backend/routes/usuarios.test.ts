import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { container } from 'tsyringe';
import type SecretCipher from '../domain/libs/crypto/SecretCipher.js';
import type Clock from '../domain/libs/clock/Clock.js';
import EmailAlreadyInUseError from '../domain/errors/EmailAlreadyInUseError.js';
import LastUserManagerError from '../domain/errors/LastUserManagerError.js';
import SelfAccessRemovalError from '../domain/errors/SelfAccessRemovalError.js';
import SelfDeactivationError from '../domain/errors/SelfDeactivationError.js';
import {
    PERMISSION,
    PERMISSION_CATALOG,
    type Permission,
} from '../domain/interface/auth/Permission.js';
import type AccessRepository from '../domain/repository/auth/AccessRepository.js';
import {
    REPLACE_EXCEPTIONS_RESULT,
    SET_ROLE_RESULT,
} from '../domain/repository/auth/AccessRepository.js';
import {
    DEACTIVATE_RESULT,
    REACTIVATE_RESULT,
    SET_EMAIL_RESULT,
} from '../domain/repository/auth/UserRepository.js';
import type UserRepository from '../domain/repository/auth/UserRepository.js';
import type LogService from '../domain/service/LogService.js';
import AccessService from '../domain/service/auth/AccessService.js';
import EffectivePermissionCalculator from '../domain/service/auth/EffectivePermissionCalculator.js';
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
let usuarioAtual: { sub?: string } | undefined;
/** Permissões efetivas do chamador (o `resolverAcesso` real roda a montante). */
let permissoesAtuais: Permission[] = [...PERMISSION_CATALOG];

const repo = {
    listAll: jest.fn(),
    create: jest.fn(),
    reactivate: jest.fn(),
    updatePassword: jest.fn(),
    setVinculoConexos: jest.fn(),
    setEmail: jest.fn(),
    deactivateGuarded: jest.fn(),
};
const accessRepo = {
    listRoles: jest.fn(),
    findRoleById: jest.fn(),
    findRoleByName: jest.fn(),
    listAccessForUsers: jest.fn(),
    findAccessByUserId: jest.fn(),
    findAccessBySub: jest.fn(),
    setRole: jest.fn(),
    replaceExceptions: jest.fn(),
};
const ADMIN_ROLE = { id: 1, nome: 'Administrador', permissoes: [...PERMISSION_CATALOG] };
const CONSULTA_ROLE = { id: 2, nome: 'Consulta', permissoes: ['permutas:ver'] };
/** `AccessService` REAL (cache de verdade) sobre o repositório falso — prova a invalidação. */
let accessService: AccessService;
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
    accessService = new AccessService(
        accessRepo as unknown as AccessRepository,
        new EffectivePermissionCalculator(),
        log as unknown as LogService,
        { now: () => 1_000 } as unknown as Clock,
    );
    const service = new UserAdminService(
        repo as unknown as UserRepository,
        accessRepo as unknown as AccessRepository,
        new EffectivePermissionCalculator(),
        accessService,
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
        req.acesso = {
            userId: 1,
            papel: { id: 1, nome: 'Administrador' },
            permissoes: new Set(permissoesAtuais),
        };
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
    usuarioAtual = { sub: 'simone@kavex.com' };
    permissoesAtuais = [...PERMISSION_CATALOG];
    for (const fn of Object.values(repo)) fn.mockReset();
    for (const fn of Object.values(accessRepo)) fn.mockReset();
    accessRepo.listAccessForUsers.mockResolvedValue(new Map());
    accessRepo.findRoleById.mockImplementation(
        async (id: number) => [ADMIN_ROLE, CONSULTA_ROLE].find((r) => r.id === id) ?? null,
    );
    accessRepo.findRoleByName.mockResolvedValue(ADMIN_ROLE);
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

    it('sem usuarios:gerenciar: 403 com o código da permissão (o guard do router cobre a rota)', async () => {
        permissoesAtuais = PERMISSION_CATALOG.filter((p) => p !== PERMISSION.USUARIOS_GERENCIAR);
        const res = await send('PATCH', '/7/email', { email: 'a@columbiabr.com' });
        expect(res.status).toBe(403);
        expect(await json(res)).toEqual({
            error: 'Você não tem permissão para esta ação.',
            permissao: 'usuarios:gerenciar',
        });
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
        expect(repo.reactivate).not.toHaveBeenCalled();
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
        role: 'admin',
        ativo: true,
        createdAt: '2026-09-28T00:00:00.000Z',
        papel: { id: 2, nome: 'Consulta' },
    });

    it('aceita email e grava username = email = valor normalizado', async () => {
        repo.create.mockImplementation(async (i: { email: string }) => criado(i.email));
        const res = await send('POST', '/', {
            email: ' Nova@ColumbiaBR.com',
            password: 'segredo12',
            papelId: 2,
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
        const res = await send('POST', '/', {
            username: 'nova@kavex.com',
            password: 'segredo12',
            papelId: 1,
        });
        expect(res.status).toBe(201);
        expect(repo.create.mock.calls[0][0]).toMatchObject({ email: 'nova@kavex.com' });
    });

    it('email e username diferentes: 400', async () => {
        const res = await send('POST', '/', {
            email: 'a@columbiabr.com',
            username: 'b@columbiabr.com',
            password: 'segredo12',
            papelId: 1,
        });
        expect(res.status).toBe(400);
        expect(repo.create).not.toHaveBeenCalled();
    });

    it('colisão cruzada: 409 com a mesma mensagem do PATCH', async () => {
        repo.create.mockRejectedValue(new EmailAlreadyInUseError('maria@columbiabr.com'));
        const res = await send('POST', '/', {
            email: 'maria@columbiabr.com',
            password: 'segredo12',
            papelId: 1,
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
        expect(repo.reactivate).not.toHaveBeenCalled();
    });

    it('depois de desativar, a próxima resolução do alvo vai ao banco (cache invalidado)', async () => {
        accessRepo.findAccessBySub.mockResolvedValue({
            userId: 2,
            username: 'b@kavex.com',
            ativo: true,
            papel: { id: 1, nome: 'Administrador' },
            pacote: [...PERMISSION_CATALOG],
            excecoes: [],
        });
        await accessService.resolver('b@kavex.com');
        await accessService.resolver('b@kavex.com');
        expect(accessRepo.findAccessBySub).toHaveBeenCalledTimes(1);

        repo.deactivateGuarded.mockResolvedValue(DEACTIVATE_RESULT.DEACTIVATED);
        expect((await send('PATCH', '/2/ativo', { ativo: false })).status).toBe(200);

        accessRepo.findAccessBySub.mockResolvedValue(null);
        expect(await accessService.resolver('b@kavex.com')).toBeNull();
        expect(accessRepo.findAccessBySub).toHaveBeenCalledTimes(2);
    });

    it('desativar a si mesmo: 409 com mensagem em português', async () => {
        repo.deactivateGuarded.mockRejectedValue(new SelfDeactivationError());
        const res = await send('PATCH', '/1/ativo', { ativo: false });
        expect(res.status).toBe(409);
        expect(await json(res)).toEqual({ error: 'Você não pode desativar o próprio acesso.' });
    });

    it('desativar o último gestor ativo: 409 com a mensagem nova, em português', async () => {
        repo.deactivateGuarded.mockRejectedValue(new LastUserManagerError());
        const res = await send('PATCH', '/1/ativo', { ativo: false });
        expect(res.status).toBe(409);
        expect(await json(res)).toEqual({
            error: 'Não é possível remover o último usuário com permissão de gerenciar usuários.',
        });
    });

    it('sem req.user.sub: recusa, nunca desativa às cegas', async () => {
        usuarioAtual = {};
        const res = await send('PATCH', '/2/ativo', { ativo: false });
        expect(res.status).toBe(401);
        expect(repo.deactivateGuarded).not.toHaveBeenCalled();
        expect(repo.reactivate).not.toHaveBeenCalled();
    });

    it('reativar não passa pela guarda, mas grava com o ator', async () => {
        repo.reactivate.mockResolvedValue(REACTIVATE_RESULT.REACTIVATED);
        const res = await send('PATCH', '/2/ativo', { ativo: true });
        expect(res.status).toBe(200);
        expect(repo.reactivate).toHaveBeenCalledWith(2, 'simone@kavex.com');
        expect(repo.deactivateGuarded).not.toHaveBeenCalled();
    });

    it('erro desconhecido continua indo ao middleware central', async () => {
        repo.deactivateGuarded.mockRejectedValue(new Error('conexão caiu'));
        const res = await send('PATCH', '/2/ativo', { ativo: false });
        expect(res.status).toBe(500);
    });
});

describe('POST /usuarios — papel obrigatório (Q3) e compatibilidade da janela de deploy (D2)', () => {
    const criado = {
        id: 9,
        username: 'n@kavex.com',
        email: 'n@kavex.com',
        role: 'admin',
        ativo: true,
        createdAt: 'x',
        papel: { id: 1, nome: 'Administrador' },
    };

    it('com papelId: grava role_id do papel e o criador; 201', async () => {
        repo.create.mockResolvedValue(criado);
        const res = await send('POST', '/', {
            email: 'n@kavex.com',
            password: 'segredo12',
            papelId: 2,
        });
        expect(res.status).toBe(201);
        expect(repo.create.mock.calls[0][0]).toMatchObject({
            roleId: 2,
            createdBy: 'simone@kavex.com',
        });
    });

    it("sem papelId e com role 'admin' (front antigo): vira Administrador", async () => {
        repo.create.mockResolvedValue(criado);
        const res = await send('POST', '/', {
            username: 'n@kavex.com',
            password: 'segredo12',
            role: 'admin',
        });
        expect(res.status).toBe(201);
        expect(repo.create.mock.calls[0][0]).toMatchObject({ roleId: 1 });
    });

    it("role 'operador' (default do diálogo antigo) ou nada: 400 pedindo para atualizar a página", async () => {
        for (const body of [
            { email: 'n@kavex.com', password: 'segredo12', role: 'operador' },
            { email: 'n@kavex.com', password: 'segredo12' },
        ]) {
            const res = await send('POST', '/', body);
            expect(res.status).toBe(400);
            expect(await json(res)).toEqual({
                error: 'Atualize a página para escolher o papel do usuário.',
            });
        }
        expect(repo.create).not.toHaveBeenCalled();
    });

    it('papelId inexistente: 404 "Papel não encontrado."', async () => {
        const res = await send('POST', '/', {
            email: 'n@kavex.com',
            password: 'segredo12',
            papelId: 99,
        });
        expect(res.status).toBe(404);
        expect(await json(res)).toEqual({ error: 'Papel não encontrado.' });
        expect(repo.create).not.toHaveBeenCalled();
    });

    it('sem req.user.sub: 401, nunca cria sem autor', async () => {
        usuarioAtual = {};
        const res = await send('POST', '/', {
            email: 'n@kavex.com',
            password: 'segredo12',
            papelId: 1,
        });
        expect(res.status).toBe(401);
        expect(repo.create).not.toHaveBeenCalled();
    });
});

describe('GET /usuarios/papeis', () => {
    it('papéis com pacote e o catálogo inteiro', async () => {
        accessRepo.listRoles.mockResolvedValue([ADMIN_ROLE, CONSULTA_ROLE]);
        const res = await send('GET', '/papeis');
        expect(res.status).toBe(200);
        expect(await json(res)).toEqual({
            papeis: [ADMIN_ROLE, CONSULTA_ROLE],
            catalogo: [...PERMISSION_CATALOG],
        });
    });
});

describe('GET /usuarios — papel, exceções e efetivas por usuário (D6)', () => {
    it('acrescenta papel/excecoes/permissoesEfetivas e mantém role', async () => {
        repo.listAll.mockResolvedValue([
            { id: 2, username: 'b@kavex.com', role: 'admin', ativo: true, createdAt: 'x' },
        ]);
        accessRepo.listAccessForUsers.mockResolvedValue(
            new Map([
                [
                    2,
                    {
                        userId: 2,
                        username: 'b@kavex.com',
                        ativo: true,
                        papel: { id: 1, nome: 'Administrador' },
                        pacote: [...PERMISSION_CATALOG],
                        excecoes: [{ permissao: 'usuarios:gerenciar', efeito: 'revogar' }],
                    },
                ],
            ]),
        );
        const res = await send('GET', '/');
        const [u] = (await res.json()) as Record<string, unknown>[];
        expect(u).toMatchObject({
            role: 'admin',
            papel: { id: 1, nome: 'Administrador' },
            excecoes: [{ permissao: 'usuarios:gerenciar', efeito: 'revogar' }],
        });
        expect(u.permissoesEfetivas).toHaveLength(8);
        expect(u.permissoesEfetivas).not.toContain('usuarios:gerenciar');
    });
});

describe('PATCH /usuarios/:id/papel', () => {
    it('200 { id, papel }, com o ator = req.user.sub', async () => {
        accessRepo.setRole.mockResolvedValue({
            result: SET_ROLE_RESULT.UPDATED,
            before: { id: 1, nome: 'Administrador' },
            after: { id: 2, nome: 'Consulta' },
        });
        const res = await send('PATCH', '/7/papel', { papelId: 2 });
        expect(res.status).toBe(200);
        expect(await json(res)).toEqual({ id: 7, papel: { id: 2, nome: 'Consulta' } });
        expect(accessRepo.setRole).toHaveBeenCalledWith(7, 2, 'simone@kavex.com');
    });

    it('mesmo papel: 200 sem log de mudança', async () => {
        accessRepo.setRole.mockResolvedValue({
            result: SET_ROLE_RESULT.UNCHANGED,
            before: { id: 1, nome: 'Administrador' },
            after: { id: 1, nome: 'Administrador' },
        });
        const res = await send('PATCH', '/7/papel', { papelId: 1 });
        expect(res.status).toBe(200);
        expect(log.info).not.toHaveBeenCalled();
    });

    it('400 "Requisição inválida" para papelId ausente ou não inteiro positivo', async () => {
        for (const body of [{}, { papelId: 0 }, { papelId: 'x' }]) {
            const res = await send('PATCH', '/7/papel', body);
            expect(res.status).toBe(400);
            expect(await json(res)).toEqual({ error: 'Requisição inválida' });
        }
        expect(accessRepo.setRole).not.toHaveBeenCalled();
    });

    it('404 para usuário e para papel inexistentes, com mensagens distintas', async () => {
        accessRepo.setRole.mockResolvedValueOnce({ result: SET_ROLE_RESULT.USER_NOT_FOUND });
        const semUsuario = await send('PATCH', '/99/papel', { papelId: 1 });
        expect(semUsuario.status).toBe(404);
        expect(await json(semUsuario)).toEqual({ error: 'Usuário não encontrado.' });

        accessRepo.setRole.mockResolvedValueOnce({ result: SET_ROLE_RESULT.ROLE_NOT_FOUND });
        const semPapel = await send('PATCH', '/7/papel', { papelId: 99 });
        expect(semPapel.status).toBe(404);
        expect(await json(semPapel)).toEqual({ error: 'Papel não encontrado.' });
    });

    it('409 do último gestor', async () => {
        accessRepo.setRole.mockRejectedValue(new LastUserManagerError());
        const res = await send('PATCH', '/7/papel', { papelId: 2 });
        expect(res.status).toBe(409);
        expect(await json(res)).toEqual({
            error: 'Não é possível remover o último usuário com permissão de gerenciar usuários.',
        });
    });

    it('409 da própria permissão', async () => {
        accessRepo.setRole.mockRejectedValue(new SelfAccessRemovalError());
        const res = await send('PATCH', '/7/papel', { papelId: 2 });
        expect(res.status).toBe(409);
        expect(await json(res)).toEqual({
            error: 'Você não pode remover a sua própria permissão de gerenciar usuários.',
        });
    });

    it('sem req.user.sub: 401', async () => {
        usuarioAtual = {};
        expect((await send('PATCH', '/7/papel', { papelId: 2 })).status).toBe(401);
        expect(accessRepo.setRole).not.toHaveBeenCalled();
    });
});

describe('PUT /usuarios/:id/permissoes', () => {
    const efetivoDepois = {
        userId: 7,
        username: 'x',
        ativo: true,
        papel: { id: 1, nome: 'Administrador' },
        pacote: [...PERMISSION_CATALOG],
        excecoes: [{ permissao: 'sispag:executar', efeito: 'revogar' }],
    };

    it('200 { id, excecoes, permissoesEfetivas }', async () => {
        accessRepo.replaceExceptions.mockResolvedValue({
            result: REPLACE_EXCEPTIONS_RESULT.UPDATED,
            before: [],
            after: efetivoDepois.excecoes,
        });
        accessRepo.findAccessByUserId.mockResolvedValue(efetivoDepois);
        const res = await send('PUT', '/7/permissoes', {
            excecoes: [{ permissao: 'sispag:executar', efeito: 'revogar' }],
        });
        expect(res.status).toBe(200);
        const body = await json(res);
        expect(body.id).toBe(7);
        expect(body.excecoes).toEqual([{ permissao: 'sispag:executar', efeito: 'revogar' }]);
        expect(body.permissoesEfetivas).toHaveLength(8);
        expect(accessRepo.replaceExceptions).toHaveBeenCalledWith(
            7,
            [{ permissao: 'sispag:executar', efeito: 'revogar' }],
            'simone@kavex.com',
        );
    });

    it('400 para permissão repetida, fora do catálogo e corpo torto', async () => {
        const repetida = await send('PUT', '/7/permissoes', {
            excecoes: [
                { permissao: 'sispag:ver', efeito: 'conceder' },
                { permissao: 'sispag:ver', efeito: 'revogar' },
            ],
        });
        expect(repetida.status).toBe(400);
        expect(await json(repetida)).toEqual({ error: 'Cada permissão pode aparecer uma vez só.' });

        const desconhecida = await send('PUT', '/7/permissoes', {
            excecoes: [{ permissao: 'fiscal:ver', efeito: 'conceder' }],
        });
        expect(desconhecida.status).toBe(400);
        expect(await json(desconhecida)).toEqual({ error: 'Permissão desconhecida.' });

        const torto = await send('PUT', '/7/permissoes', { excecoes: 'x' });
        expect(torto.status).toBe(400);
        expect(accessRepo.replaceExceptions).not.toHaveBeenCalled();
    });

    it('404 para usuário inexistente', async () => {
        accessRepo.replaceExceptions.mockResolvedValue({
            result: REPLACE_EXCEPTIONS_RESULT.NOT_FOUND,
        });
        const res = await send('PUT', '/99/permissoes', { excecoes: [] });
        expect(res.status).toBe(404);
        expect(await json(res)).toEqual({ error: 'Usuário não encontrado.' });
    });

    it('409 do último gestor', async () => {
        accessRepo.replaceExceptions.mockRejectedValue(new LastUserManagerError());
        const res = await send('PUT', '/7/permissoes', {
            excecoes: [{ permissao: 'usuarios:gerenciar', efeito: 'revogar' }],
        });
        expect(res.status).toBe(409);
        expect((await json(res)).error).toBe(
            'Não é possível remover o último usuário com permissão de gerenciar usuários.',
        );
    });

    it('409 da própria permissão', async () => {
        accessRepo.replaceExceptions.mockRejectedValue(new SelfAccessRemovalError());
        const res = await send('PUT', '/7/permissoes', {
            excecoes: [{ permissao: 'usuarios:gerenciar', efeito: 'revogar' }],
        });
        expect(res.status).toBe(409);
        expect((await json(res)).error).toBe(
            'Você não pode remover a sua própria permissão de gerenciar usuários.',
        );
    });

    it('sem req.user.sub: 401', async () => {
        usuarioAtual = {};
        expect((await send('PUT', '/7/permissoes', { excecoes: [] })).status).toBe(401);
    });
});

describe('PATCH /usuarios/:id/ativo — 409 da guarda nova', () => {
    it('409 da própria permissão também é mapeado na rota de ativo', async () => {
        repo.deactivateGuarded.mockRejectedValue(new SelfAccessRemovalError());
        const res = await send('PATCH', '/2/ativo', { ativo: false });
        expect(res.status).toBe(409);
        expect((await json(res)).error).toBe(
            'Você não pode remover a sua própria permissão de gerenciar usuários.',
        );
    });
});

describe('todas as rotas do router exigem usuarios:gerenciar', () => {
    it.each([
        ['GET', '/meta'],
        ['GET', '/'],
        ['GET', '/papeis'],
        ['POST', '/'],
        ['PATCH', '/7/email'],
        ['PATCH', '/7/ativo'],
        ['POST', '/7/reset-senha'],
        ['PATCH', '/7/vinculo'],
        ['PATCH', '/7/papel'],
        ['PUT', '/7/permissoes'],
    ])('%s %s sem a permissão: 403 com permissao = usuarios:gerenciar', async (method, rota) => {
        permissoesAtuais = PERMISSION_CATALOG.filter((p) => p !== PERMISSION.USUARIOS_GERENCIAR);
        const res = await send(method, rota, method === 'GET' ? undefined : {});
        expect(res.status).toBe(403);
        expect((await json(res)).permissao).toBe('usuarios:gerenciar');
    });
});
