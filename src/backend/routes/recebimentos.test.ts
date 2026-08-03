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
import RecebimentoNumerarioService from '../domain/service/recebimentos/RecebimentoNumerarioService.js';
import NumerarioAclChecker from '../domain/service/recebimentos/NumerarioAclChecker.js';
import ConexosGerDocProcessoClient from '../domain/client/ConexosGerDocProcessoClient.js';
import TransacaoRepository from '../domain/repository/recebimentos/TransacaoRepository.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
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
    priCod: 90001,
    valor: 15000,
    // Filial DO PROCESSO (não a do pagamento). O pagamento é filial 4 no fixture; o processo
    // escolhido vive na 4 aqui, mas o teste cross-filial abaixo prova que é o body que manda.
    filCod: 4,
    priEspRefcliente: 'REF-CLI-0001',
    pesCod: 555,
    dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
    moeCod: 790,
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

describe('GET /recebimentos/processos/:priCod/sns — existing SNs of a process (filial authz)', () => {
    afterEach(() => {
        container.clearInstances();
        jest.restoreAllMocks();
    });

    const registerClientStub = (sns: unknown[]): jest.Mock => {
        const listSNsByProcesso = jest.fn(async () => sns);
        container.registerInstance(ConexosGerDocProcessoClient, { listSNsByProcesso } as never);
        return listSNsByProcesso;
    };

    it('200 returns { priCod, sns } for an authorized filial', async () => {
        const fn = registerClientStub([
            {
                docCod: 18342,
                numero: '731',
                data: '2026-08-03T00:00:00.000Z',
                descricao: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA',
                status: 3,
                statusLabel: 'Finalizada',
                solicitado: 15000,
                valor: 15000,
            },
        ]);
        const server = await listen(buildApp({ sub: 'u', role: 'user', filiais: [4] }));
        try {
            const res = await get(`${server.url}/recebimentos/processos/3254/sns?filCod=4`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.priCod).toBe(3254);
            expect(body.sns).toHaveLength(1);
            expect(body.sns[0]).toMatchObject({ docCod: 18342, statusLabel: 'Finalizada' });
            expect(fn).toHaveBeenCalledWith(expect.objectContaining({ filCod: 4, priCod: 3254 }));
        } finally {
            await server.close();
        }
    });

    it('403 when the user may NOT act on the query filCod (cross-filial)', async () => {
        registerClientStub([]);
        const server = await listen(buildApp({ sub: 'u', role: 'user', filiais: [1, 2] }));
        try {
            const res = await get(`${server.url}/recebimentos/processos/3254/sns?filCod=9`);
            const body = await readJson(res);
            expect(res.status).toBe(403);
            expect(body.code).toBe('FILIAL_NAO_AUTORIZADA');
        } finally {
            await server.close();
        }
    });

    it('400 when filCod is missing (query obrigatória)', async () => {
        registerClientStub([]);
        const server = await listen(buildApp({ sub: 'u', role: 'user', filiais: [4] }));
        try {
            const res = await get(`${server.url}/recebimentos/processos/3254/sns`);
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });

    it('400 when priCod is invalid (não-positivo)', async () => {
        registerClientStub([]);
        const server = await listen(buildApp({ sub: 'u', role: 'user', filiais: [4] }));
        try {
            const res = await get(`${server.url}/recebimentos/processos/-1/sns?filCod=4`);
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });
});

describe('POST /recebimentos/transacoes/:txnId/solicitacao-numerario — real allocation orchestration', () => {
    afterEach(() => {
        container.clearInstances();
        container.reset();
        jest.restoreAllMocks();
    });

    /** Registra os stubs que a rota resolve: transação, env (dry-run), orquestrador, ACL. */
    const registerStubs = (
        over: {
            transacao?: unknown;
            envOver?: Record<string, unknown>;
            processarResult?: Record<string, unknown>;
            aclOk?: boolean;
        } = {},
    ): { processar: jest.Mock; aclVerificar: jest.Mock } => {
        const transacao =
            over.transacao === undefined
                ? { id: 'txn-1', filCod: 4, valor: 15000, gerNum: 55795 }
                : over.transacao;
        container.registerInstance(TransacaoRepository, {
            findById: jest.fn(async () => transacao),
        } as never);
        container.registerInstance(EnvironmentProvider, {
            getEnvironmentVars: jest.fn(async () => ({
                conexosWriteEnabled: false,
                conexosDryRun: true,
                ndeAclPreflight: true,
                ...over.envOver,
            })),
        } as never);
        const processar = jest.fn(
            async () => over.processarResult ?? { status: 'dry-run', dryRun: true },
        );
        container.registerInstance(RecebimentoNumerarioService, {
            processarAlocacao: processar,
        } as never);
        const aclVerificar = jest.fn(async () => ({ ok: over.aclOk ?? true }));
        container.registerInstance(NumerarioAclChecker, { verificar: aclVerificar } as never);
        return { processar, aclVerificar };
    };

    it('200 delega ao orquestrador e ecoa o resultado (dry-run gate fechado)', async () => {
        const { processar } = registerStubs();
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload(),
            );
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.transacaoId).toBe('txn-1');
            expect(body.dryRun).toBe(true);
            expect(processar).toHaveBeenCalledWith(
                expect.objectContaining({
                    txnId: 'txn-1',
                    priCod: 90001,
                    valor: 15000,
                    transacao: expect.objectContaining({ gerNum: 55795 }),
                }),
            );
        } finally {
            await server.close();
        }
    });

    it('encaminha snDocCod do body como snSelecionadaDocCod ao orquestrador (SN existente)', async () => {
        const { processar } = registerStubs();
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload({ snDocCod: 18202 }),
            );
            expect(res.status).toBe(200);
            expect(processar).toHaveBeenCalledWith(
                expect.objectContaining({ snSelecionadaDocCod: 18202 }),
            );
        } finally {
            await server.close();
        }
    });

    it('omite snSelecionadaDocCod quando o body não traz snDocCod ("Criar novo SN")', async () => {
        const { processar } = registerStubs();
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload(),
            );
            const arg = processar.mock.calls[0][0] as Record<string, unknown>;
            expect('snSelecionadaDocCod' in arg).toBe(false);
        } finally {
            await server.close();
        }
    });

    it('200 mesmo em erro de etapa (status carrega o desfecho)', async () => {
        registerStubs({
            envOver: { conexosWriteEnabled: true, conexosDryRun: false, ndeAclPreflight: false },
            processarResult: { status: 'error', etapa: 'fin014', erro: 'ERP 500', dryRun: false },
        });
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload(),
            );
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.status).toBe('error');
            expect(body.etapa).toBe('fin014');
        } finally {
            await server.close();
        }
    });

    it('404 quando a transação não existe', async () => {
        registerStubs({ transacao: null });
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-x/solicitacao-numerario`,
                snPayload(),
            );
            expect(res.status).toBe(404);
        } finally {
            await server.close();
        }
    });

    it('422 quando a transação não tem gerNum (conta financeira ausente)', async () => {
        registerStubs({ transacao: { id: 'txn-1', filCod: 4, valor: 15000 } });
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload(),
            );
            expect(res.status).toBe(422);
        } finally {
            await server.close();
        }
    });

    it('403 when the user may NOT act on the PROCESS filial (cross-filial, body-driven)', async () => {
        // Pagamento na filial 1 (autorizada), mas o processo escolhido está na filial 9 (proibida).
        // A authz roda contra a filial DO PROCESSO (body.filCod), não a do pagamento.
        registerStubs({ transacao: { id: 'txn-1', filCod: 1, valor: 15000, gerNum: 55795 } });
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

    it('roda o fluxo na filial DO PROCESSO (body.filCod), não na do pagamento', async () => {
        // Pagamento na filial 1; processo escolhido na filial 2. O orquestrador (e o pré-flight de
        // ACL) devem receber a filial 2 — mas a conta financeira segue sendo a gerNum do pagamento.
        const { processar, aclVerificar } = registerStubs({
            transacao: { id: 'txn-1', filCod: 1, valor: 15000, gerNum: 55795 },
            envOver: { conexosWriteEnabled: true, conexosDryRun: false, ndeAclPreflight: true },
            processarResult: { status: 'settled', dryRun: false },
        });
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [1, 2] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload({ filCod: 2 }),
            );
            expect(res.status).toBe(200);
            // Pré-flight de ACL na filial DO PROCESSO.
            expect(aclVerificar).toHaveBeenCalledWith(expect.objectContaining({ filCod: 2 }));
            // Orquestrador recebe a filial do processo em processoFields; gerNum é o do pagamento.
            expect(processar).toHaveBeenCalledWith(
                expect.objectContaining({
                    processoFields: expect.objectContaining({ filCod: 2 }),
                    transacao: expect.objectContaining({ gerNum: 55795 }),
                }),
            );
        } finally {
            await server.close();
        }
    });

    it('403 quando o pré-flight de ACL nega (escrita real, fail-closed)', async () => {
        const { processar } = registerStubs({
            envOver: { conexosWriteEnabled: true, conexosDryRun: false, ndeAclPreflight: true },
            aclOk: false,
        });
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload(),
            );
            const body = await readJson(res);
            expect(res.status).toBe(403);
            expect(body.code).toBe('NDE_ACL_INSUFICIENTE');
            // Bloqueou ANTES de qualquer escrita.
            expect(processar).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });

    it('400 on a malformed payload (Zod boundary)', async () => {
        registerStubs();
        const server = await listen(buildApp({ sub: 'u', role: 'admin', filiais: [4] }));
        try {
            const res = await post(
                `${server.url}/recebimentos/transacoes/txn-1/solicitacao-numerario`,
                snPayload({ priCod: 'nope', valor: undefined }),
            );
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });
});
