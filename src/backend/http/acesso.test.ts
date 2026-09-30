import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
    PERMISSION,
    PERMISSION_CATALOG,
    type Permission,
} from '../domain/interface/auth/Permission.js';
import type { ResolvedAccess } from '../domain/service/auth/AccessService.js';
import {
    DEV_BYPASS_SUB,
    GUARD_AUTENTICADO,
    exigirPermissao,
    guardDe,
    resolverAcesso,
    somenteAutenticado,
} from './acesso.js';
import type { AuthUser } from './auth.js';
import { loadAuthEnv } from './authEnv.js';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const resolvido = (over: Partial<ResolvedAccess> = {}): ResolvedAccess => ({
    userId: 7,
    username: 'maria@columbiabr.com',
    ativo: true,
    papel: { id: 1, nome: 'Administrador' },
    permissoes: new Set<Permission>(PERMISSION_CATALOG),
    ...over,
});

interface Montagem {
    devBypass?: boolean;
    user?: AuthUser;
    resolver?: jest.Mock;
    rota?: express.RequestHandler[];
}

/** App mínimo: [auth falso] → resolverAcesso → [guards] → handler que ecoa `req.acesso`. */
const subir = async (m: Montagem) => {
    const resolver = m.resolver ?? jest.fn().mockResolvedValue(resolvido());
    const log = {
        error: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    };
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
        if (m.user) req.user = m.user;
        (req as Request & { requestId?: string }).requestId = 'req-123';
        next();
    });
    app.use(
        resolverAcesso({
            devBypass: m.devBypass ?? false,
            obterServico: async () => ({ resolver }),
            obterLog: () => log,
        }),
    );
    app.get('/x', ...(m.rota ?? []), (req: Request, res: Response) => {
        res.json({
            user: req.user,
            userId: req.acesso?.userId,
            papel: req.acesso?.papel,
            permissoes: [...(req.acesso?.permissoes ?? [])].sort(),
        });
    });
    app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: 'erro interno' });
    });
    const server: Server = await new Promise((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    const { port } = server.address() as AddressInfo;
    const get = async () => {
        const res = await fetch(`http://127.0.0.1:${port}/x`);
        return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    return { server, get, resolver, log };
};

describe('resolverAcesso', () => {
    it('sucesso: preenche req.acesso com userId, papel e permissões e segue', async () => {
        const { server, get, resolver } = await subir({ user: { sub: 'maria@columbiabr.com' } });
        const out = await get();
        server.close();
        expect(out.status).toBe(200);
        expect(resolver).toHaveBeenCalledWith({ tipo: 'username', valor: 'maria@columbiabr.com' });
        expect(out.body).toMatchObject({
            userId: 7,
            papel: { id: 1, nome: 'Administrador' },
            permissoes: [...PERMISSION_CATALOG].sort(),
        });
    });

    it('sem req.user (e sem bypass): 401 "Não autenticado."; o usuário fictício NUNCA aparece', async () => {
        const { server, get, resolver } = await subir({});
        const out = await get();
        server.close();
        expect(out.status).toBe(401);
        expect(out.body).toEqual({ error: 'Não autenticado.' });
        expect(resolver).not.toHaveBeenCalled();
        expect(JSON.stringify(out.body)).not.toContain(DEV_BYPASS_SUB);
    });

    it('usuário inexistente: 401 de sessão encerrada', async () => {
        const { server, get } = await subir({
            user: { sub: 'sumiu' },
            resolver: jest.fn().mockResolvedValue(null),
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(401);
        expect(out.body).toEqual({
            error: 'Sessão encerrada: seu acesso foi desativado ou não existe mais.',
        });
    });

    it('usuário inativo: 401 de sessão encerrada (fecha a lacuna das 12 h)', async () => {
        const { server, get } = await subir({
            user: { sub: 'maria@columbiabr.com' },
            resolver: jest.fn().mockResolvedValue(resolvido({ ativo: false })),
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(401);
        expect(out.body.error).toMatch(/Sessão encerrada/);
    });

    it('banco fora: 503 em português, LogService.error com requestId, NUNCA segue (fail-closed)', async () => {
        const { server, get, log } = await subir({
            user: { sub: 'maria@columbiabr.com' },
            resolver: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(503);
        expect(out.body).toEqual({
            error: 'Não foi possível verificar suas permissões agora. Tente novamente em instantes.',
        });
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringMatching(/permiss/),
                data: expect.objectContaining({ requestId: 'req-123' }),
            }),
        );
    });

    it('DEV_AUTH_BYPASS: usuário fictício constante com as nove, sem consultar o banco (D1)', async () => {
        const { server, get, resolver } = await subir({ devBypass: true });
        const out = await get();
        server.close();
        expect(out.status).toBe(200);
        expect(resolver).not.toHaveBeenCalled();
        expect(out.body).toMatchObject({
            user: { sub: DEV_BYPASS_SUB },
            papel: { nome: 'Administrador' },
            permissoes: [...PERMISSION_CATALOG].sort(),
        });
        expect(DEV_BYPASS_SUB).toBe('dev-bypass');
    });

    it('o bypass continua impossível fora de local/dev: o boot falha antes de montar o app', () => {
        expect(() =>
            loadAuthEnv({
                DEV_AUTH_BYPASS: 'true',
                environment: 'production',
            } as NodeJS.ProcessEnv),
        ).toThrow(/DEV_AUTH_BYPASS/);
        expect(() =>
            loadAuthEnv({ DEV_AUTH_BYPASS: 'true', environment: 'prd' } as NodeJS.ProcessEnv),
        ).toThrow(/DEV_AUTH_BYPASS/);
    });
});

describe('resolverAcesso — identidade por emissor (ADR-0054, I2/I3)', () => {
    const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';

    it('emissor app: busca por username e reescreve req.user = { sub: username }', async () => {
        const { server, get, resolver } = await subir({
            user: { sub: 'Maria@Columbiabr.com', emissor: 'app', role: 'admin', email: 'x@y' },
            resolver: jest.fn().mockResolvedValue(resolvido({ username: 'maria@columbiabr.com' })),
        });
        const out = await get();
        server.close();
        expect(resolver).toHaveBeenCalledWith({ tipo: 'username', valor: 'Maria@Columbiabr.com' });
        expect(out.body.user).toEqual({ sub: 'maria@columbiabr.com' });
    });

    it('emissor supabase: busca por auth_user_id; sub vira o username, sem email/role/UUID no sub', async () => {
        const { server, get, resolver } = await subir({
            user: { sub: UUID, emissor: 'supabase', filiais: [1, 3] },
            resolver: jest
                .fn()
                .mockResolvedValue(resolvido({ username: 'fulano', authUserId: UUID })),
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(200);
        expect(resolver).toHaveBeenCalledWith({ tipo: 'authUserId', valor: UUID });
        expect(out.body.user).toEqual({ sub: 'fulano', authUserId: UUID, filiais: [1, 3] });
    });

    it('token supabase sem app_user vinculado: 401 + LogService.error de divergência (nunca cria)', async () => {
        const { server, get, log } = await subir({
            user: { sub: UUID, emissor: 'supabase' },
            resolver: jest.fn().mockResolvedValue(null),
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(401);
        expect(out.body.error).toMatch(/Sessão encerrada/);
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'AUTH_DIVERGENCIA',
                message: expect.stringMatching(/diverg[êe]ncia de v[íi]nculo.*sync-supabase-auth/),
                data: expect.objectContaining({ authUserId: UUID }),
            }),
        );
    });

    it('token supabase com sub que não é UUID: 401 sem consultar o banco', async () => {
        const { server, get, resolver } = await subir({
            user: { sub: 'nao-e-uuid', emissor: 'supabase' },
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(401);
        expect(resolver).not.toHaveBeenCalled();
    });

    it('inativo pelo caminho supabase: 401', async () => {
        const { server, get } = await subir({
            user: { sub: UUID, emissor: 'supabase' },
            resolver: jest.fn().mockResolvedValue(resolvido({ ativo: false, authUserId: UUID })),
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(401);
    });

    it('banco fora pelo caminho supabase: 503 fail-closed', async () => {
        const { server, get } = await subir({
            user: { sub: UUID, emissor: 'supabase' },
            resolver: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(503);
    });
});

describe('exigirPermissao', () => {
    it('com a permissão: segue ao handler', async () => {
        const { server, get } = await subir({
            user: { sub: 'u' },
            rota: [exigirPermissao(PERMISSION.SISPAG_EXECUTAR)],
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(200);
    });

    it('sem a permissão: 403 em português com o código da permissão', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { server, get } = await subir({
            user: { sub: 'u' },
            resolver: jest
                .fn()
                .mockResolvedValue(resolvido({ permissoes: new Set<Permission>(['sispag:ver']) })),
            rota: [exigirPermissao(PERMISSION.SISPAG_EXECUTAR)],
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(403);
        expect(out.body).toEqual({
            error: 'Você não tem permissão para esta ação.',
            permissao: 'sispag:executar',
        });
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/sispag:executar/));
        warn.mockRestore();
    });

    it('operacao:ver ausente: 404 { error: "Not found" }, sem falar de permissão (ADR-0042)', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { server, get } = await subir({
            user: { sub: 'u' },
            resolver: jest.fn().mockResolvedValue(resolvido({ permissoes: new Set<Permission>() })),
            rota: [exigirPermissao(PERMISSION.OPERACAO_VER)],
        });
        const out = await get();
        server.close();
        expect(out.status).toBe(404);
        expect(out.body).toEqual({ error: 'Not found' });
        warn.mockRestore();
    });

    it('sem req.acesso (middleware fora de ordem): erro → 500, nunca segue', async () => {
        const app = express();
        const handler = jest.fn((_req: Request, res: Response) => res.json({ ok: true }));
        app.get('/x', exigirPermissao(PERMISSION.METRICAS_VER), handler);
        app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
            res.status(500).json({ error: 'erro interno' });
        });
        const server: Server = await new Promise((r) => {
            const s = app.listen(0, '127.0.0.1', () => r(s));
        });
        const { port } = server.address() as AddressInfo;
        const res = await fetch(`http://127.0.0.1:${port}/x`);
        server.close();
        expect(res.status).toBe(500);
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('marcas de guard (para o teste de cobertura por rota)', () => {
    it('exigirPermissao marca a permissão; somenteAutenticado marca "autenticado"', () => {
        expect(guardDe(exigirPermissao(PERMISSION.PERMUTAS_VER))).toBe('permutas:ver');
        expect(guardDe(somenteAutenticado())).toBe(GUARD_AUTENTICADO);
        expect(guardDe((_req: Request, _res: Response, next: NextFunction) => next())).toBe(
            undefined,
        );
    });

    it('somenteAutenticado só segue quando resolverAcesso já rodou', async () => {
        const { server, get } = await subir({ user: { sub: 'u' }, rota: [somenteAutenticado()] });
        const out = await get();
        server.close();
        expect(out.status).toBe(200);
    });
});
