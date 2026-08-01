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
import { PROCESSO_PROVIDER_TOKEN } from '../domain/interface/recebimentos/ports.js';
import type { Processo } from '../domain/interface/recebimentos/GerDocProcesso.js';
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

const get = (url: string) => fetch(url, { method: 'GET' });

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

const snPayload = (over: Record<string, unknown> = {}) => ({
    filCod: 4,
    priCod: 90001,
    priEspRefcliente: 'REF-CLI-0001',
    pesCod: 555,
    dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
    moeCod: 790,
    valorTransacao: 15000,
    ...over,
});

describe('GET /recebimentos/transacoes/:txnId/processos — candidate processos (filial authz)', () => {
    afterEach(() => {
        container.clearInstances();
        jest.restoreAllMocks();
    });

    const registerProviderStub = (processos: Processo[]): jest.Mock => {
        const listCandidatosParaTransacao = jest.fn(async () => processos);
        container.registerInstance(PROCESSO_PROVIDER_TOKEN, {
            listCandidatosParaTransacao,
        } as never);
        return listCandidatosParaTransacao;
    };

    it('200 returns the processos list for an authorized filial', async () => {
        const fn = registerProviderStub([
            {
                priCod: 90001,
                priEspRefcliente: 'R',
                filCod: 4,
                pesCod: 555,
                dpeNomPessoa: 'X',
                moeCod: 790,
            },
        ]);
        const server = await listen(buildApp({ sub: 'u', role: 'user', filiais: [4] }));
        try {
            const res = await get(`${server.url}/recebimentos/transacoes/txn-1/processos?filCod=4`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.transacaoId).toBe('txn-1');
            expect(body.processos).toHaveLength(1);
            expect(fn).toHaveBeenCalledTimes(1);
        } finally {
            await server.close();
        }
    });

    it('403 when the user may NOT act on the query filCod (cross-filial)', async () => {
        registerProviderStub([]);
        const server = await listen(buildApp({ sub: 'u', role: 'user', filiais: [1, 2] }));
        try {
            const res = await get(`${server.url}/recebimentos/transacoes/txn-1/processos?filCod=9`);
            const body = await readJson(res);
            expect(res.status).toBe(403);
            expect(body.code).toBe('FILIAL_NAO_AUTORIZADA');
        } finally {
            await server.close();
        }
    });

    it('sem filCod varre as filiais acessíveis do usuário (multi-filial)', async () => {
        const fn = registerProviderStub([
            {
                priCod: 90001,
                priEspRefcliente: 'R',
                filCod: 4,
                pesCod: 555,
                dpeNomPessoa: 'X',
                moeCod: 790,
            },
        ]);
        const server = await listen(buildApp({ sub: 'u', role: 'user', filiais: [4] }));
        try {
            const res = await get(`${server.url}/recebimentos/transacoes/txn-1/processos`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.processos).toHaveLength(1);
            // Uma varredura por filial acessível (aqui só a 4).
            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenCalledWith(expect.objectContaining({ filCod: 4 }));
        } finally {
            await server.close();
        }
    });

    it('400 when filCod is invalid (não-positivo)', async () => {
        registerProviderStub([]);
        const server = await listen(buildApp({ sub: 'u', role: 'user', filiais: [4] }));
        try {
            const res = await get(
                `${server.url}/recebimentos/transacoes/txn-1/processos?filCod=-1`,
            );
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });
});

describe('POST /recebimentos/transacoes/:txnId/solicitacao-numerario — dry-run SN (no ERP write)', () => {
    afterEach(() => {
        container.clearInstances();
        jest.restoreAllMocks();
    });

    it('200 returns dryRun payload with the encomenda gcd config', async () => {
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload(),
            );
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.dryRun).toBe(true);
            expect(body.transacaoId).toBe('txn-1');
            expect(body.docConfig.gcdDesNome).toBe('Solicitação de Numerário - Encomenda');
            expect(body.payload.filCod).toBe(4);
            expect(body.payload.priCod).toBe(90001);
            expect(body.payload.valor).toBe(15000);
        } finally {
            await server.close();
        }
    });

    it('403 when the user may NOT act on the body filCod (cross-filial)', async () => {
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [1, 2] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload({ filCod: 9 }),
            );
            const body = await readJson(res);
            expect(res.status).toBe(403);
            expect(body.code).toBe('FILIAL_NAO_AUTORIZADA');
        } finally {
            await server.close();
        }
    });

    it('400 on a malformed payload (Zod boundary)', async () => {
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload({ priCod: 'nope', valorTransacao: undefined }),
            );
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });
});
