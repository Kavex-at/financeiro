import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { container } from 'tsyringe';

// Neutralize the real bootstrap (no Conexos/DB).
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import { RECEBIMENTO_STATUS } from '../domain/interface/recebimentos/constants.js';
import RecebimentoPipelineService from '../domain/service/recebimentos/RecebimentoPipelineService.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import type { FilialScopedUser } from '../http/filialAuthz.js';
import recebimentosRouter from './recebimentos.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const readJson = async (res: Response): Promise<Record<string, any>> =>
    (await res.json()) as Record<string, any>;

const CORR = '11111111-1111-4111-8111-111111111111';

const buildApp = (user: FilialScopedUser): express.Express => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use('/recebimentos', recebimentosRouter);
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

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });

const basePayload = (over: Record<string, unknown> = {}) => ({
    correlationId: CORR,
    filCod: 4,
    valorRecebido: 15000,
    borVldTipo: 2,
    contaDestino: '55795-4',
    dryRun: true,
    ...over,
});

describe('POST /recebimentos/pipeline/run — authz por-filial + idempotency namespacing', () => {
    afterEach(() => {
        container.clearInstances();
        jest.restoreAllMocks();
    });

    const registerServiceSpy = (): jest.Mock => {
        const run = jest.fn(async (input) => ({
            ...input.recebimento,
            status: RECEBIMENTO_STATUS.EXECUTADO,
        }));
        container.registerInstance(RecebimentoPipelineService, { run } as never);
        return run;
    };

    it('403 when the user may NOT act on the body filCod (security-1 cross-filial)', async () => {
        registerServiceSpy();
        const server = await listen(
            buildApp({ sub: 'sp-analyst', role: 'admin', filiais: [1, 2] }),
        );
        try {
            const res = await post(
                `${server.url}/recebimentos/pipeline/run`,
                basePayload({ filCod: 9 }),
            );
            const body = await readJson(res);
            expect(res.status).toBe(403);
            expect(body.code).toBe('FILIAL_NAO_AUTORIZADA');
        } finally {
            await server.close();
        }
    });

    it('runs when the user is authorized for the body filCod', async () => {
        const run = registerServiceSpy();
        const server = await listen(buildApp({ sub: 'mg-analyst', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/pipeline/run`,
                basePayload({ filCod: 4 }),
            );
            expect(res.status).toBe(200);
            expect(run).toHaveBeenCalledTimes(1);
        } finally {
            await server.close();
        }
    });

    it('runs when the user has NO filiais list (claim not provisioned) — role gate still applies', async () => {
        const run = registerServiceSpy();
        const server = await listen(buildApp({ sub: 'legacy', role: 'admin' }));
        try {
            const res = await post(`${server.url}/recebimentos/pipeline/run`, basePayload());
            expect(res.status).toBe(200);
            expect(run).toHaveBeenCalledTimes(1);
        } finally {
            await server.close();
        }
    });

    it('400 when correlationId is not a UUID (security-2 guard)', async () => {
        registerServiceSpy();
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/pipeline/run`,
                basePayload({ correlationId: 'not-a-uuid' }),
            );
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });

    it('namespaces the idempotency-key by the acting user sub (security-2)', async () => {
        const run = registerServiceSpy();
        const server = await listen(buildApp({ sub: 'user-xyz', role: 'admin', filiais: [4] }));
        try {
            await post(`${server.url}/recebimentos/pipeline/run`, basePayload());
            const input = run.mock.calls[0][0];
            // The recebimento id (= idempotency key) is prefixed with the acting user's sub.
            expect(String(input.recebimento.id)).toContain('receb:user-xyz:');
        } finally {
            await server.close();
        }
    });
});
