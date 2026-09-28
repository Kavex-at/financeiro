import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type NextFunction, type Request, type Response } from 'express';
import { container } from 'tsyringe';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { PERMISSION_CATALOG, type Permission } from '../domain/interface/auth/Permission.js';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

let acessoAtual: Request['acesso'];
let srv: { server: Server; url: string };
const testarVinculo = jest.fn();

beforeAll(async () => {
    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) =>
        token === ConexosSessionResolver ? { testarVinculo } : real(token as never)) as never);

    const { default: meRouter } = await import('./me.js');
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
        req.user = { sub: 'maria@columbiabr.com' };
        if (acessoAtual) req.acesso = acessoAtual;
        next();
    });
    app.use('/me', meRouter);
    app.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: 'erro interno' });
    });
    srv = await new Promise((resolve) => {
        const server: Server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
});

afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((r) => srv.server.close(r));
});

const acesso = (permissoes: Permission[], papel = { id: 1, nome: 'Administrador' }) => ({
    userId: 7,
    papel,
    permissoes: new Set<Permission>(permissoes),
});

describe('GET /me/permissoes', () => {
    it('Administrador: as nove, ordenadas, papel e operacao = true', async () => {
        acessoAtual = acesso([...PERMISSION_CATALOG].reverse());
        const res = await fetch(`${srv.url}/me/permissoes`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            permissoes: [...PERMISSION_CATALOG].sort(),
            papel: { id: 1, nome: 'Administrador' },
            operacao: true,
        });
    });

    it('só permutas:ver: exatamente isso, e operacao = false (deriva de operacao:ver, R10)', async () => {
        acessoAtual = acesso(['permutas:ver'], { id: 2, nome: 'Consulta' });
        const res = await fetch(`${srv.url}/me/permissoes`);
        expect(await res.json()).toEqual({
            permissoes: ['permutas:ver'],
            papel: { id: 2, nome: 'Consulta' },
            operacao: false,
        });
    });

    it('responde com Cache-Control: no-store (permissão muda sem o token mudar)', async () => {
        acessoAtual = acesso(['permutas:ver']);
        const res = await fetch(`${srv.url}/me/permissoes`);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('sem req.acesso (fora da cadeia de acesso): 500, nunca uma lista vazia inventada', async () => {
        acessoAtual = undefined;
        const res = await fetch(`${srv.url}/me/permissoes`);
        expect(res.status).toBe(500);
    });
});

describe('GET /me/conexos-status', () => {
    it('basta estar autenticado e ativo: responde o status do vínculo', async () => {
        acessoAtual = acesso([]);
        testarVinculo.mockResolvedValue('ausente');
        const res = await fetch(`${srv.url}/me/conexos-status`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ausente' });
    });
});
