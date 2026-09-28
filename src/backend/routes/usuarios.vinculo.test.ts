import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';

// Neutraliza o bootstrap real (sem DB) — o handler só precisa do container.
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import UserAdminService from '../domain/service/auth/UserAdminService.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import usuariosRouter from './usuarios.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const buildApp = (): express.Express => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { sub: 'admin-1', email: 'a@b.com', role: 'admin' };
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

const patchVinculo = (url: string, body: unknown): Promise<Response> =>
    fetch(`${url}/usuarios/7/vinculo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

describe('PATCH /usuarios/:id/vinculo — `remover` validado no boundary', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('remover: true apaga o vínculo', async () => {
        const setVinculo = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(UserAdminService, { setVinculo } as never);

        const server = await listen(buildApp());
        try {
            const res = await patchVinculo(server.url, { remover: true });
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ id: 7, vinculo: null });
            expect(setVinculo).toHaveBeenCalledWith(7, null);
        } finally {
            await server.close();
        }
    });

    it.each([
        ['string', 'true'],
        ['número', 1],
        ['nulo', null],
    ])('remover como %s → 400 e nada é gravado nem apagado', async (_caso, remover) => {
        const setVinculo = jest.fn();
        container.registerInstance(UserAdminService, { setVinculo } as never);

        const server = await listen(buildApp());
        try {
            const res = await patchVinculo(server.url, { remover });
            expect(res.status).toBe(400);
            expect(((await res.json()) as { error: string }).error).toMatch(/remover/);
            expect(setVinculo).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });

    it('remover: false segue para o ramo de gravar — e sem login/senha é 400', async () => {
        const setVinculo = jest.fn();
        container.registerInstance(UserAdminService, { setVinculo } as never);

        const server = await listen(buildApp());
        try {
            const res = await patchVinculo(server.url, { remover: false });
            expect(res.status).toBe(400);
            expect(((await res.json()) as { error: string }).error).toMatch(/login e a senha/);
            expect(setVinculo).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });
});
