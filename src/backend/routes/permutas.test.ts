import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { container } from 'tsyringe';

// Neutralize the real bootstrap (no Conexos/DB) — handlers only need the
// container to resolve our mocked services.
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import AlocacaoSaldoError from '../domain/errors/AlocacaoSaldoError.js';
import AlocacaoSemCoberturaError from '../domain/errors/AlocacaoSemCoberturaError.js';
import ReconciliacaoEmAndamentoError from '../domain/errors/ReconciliacaoEmAndamentoError.js';
import ExcecaoPermutaRecusadaError from '../domain/errors/ExcecaoPermutaRecusadaError.js';
import ExcecaoPermutaService from '../domain/service/permutas/ExcecaoPermutaService.js';
import IngestLockBusyError from '../domain/errors/IngestLockBusyError.js';
import BorderoAmbiguousError from '../domain/errors/BorderoAmbiguousError.js';
import BorderoNotOwnedError from '../domain/errors/BorderoNotOwnedError.js';
import BorderoStateConflictError from '../domain/errors/BorderoStateConflictError.js';
import ConexosError from '../domain/errors/ConexosError.js';
import ConexosWriteDisabledError from '../domain/errors/ConexosWriteDisabledError.js';
import InvalidAllocationError from '../domain/errors/InvalidAllocationError.js';
import PermutaDataIncompleteError from '../domain/errors/PermutaDataIncompleteError.js';
import PermutaNotFoundError from '../domain/errors/PermutaNotFoundError.js';
import AlocacaoEmBorderoError from '../domain/errors/AlocacaoEmBorderoError.js';
import GerarSolicitacaoNumerarioService from '../domain/service/permutas/GerarSolicitacaoNumerarioService.js';
import AlocacaoPermutasService from '../domain/service/permutas/AlocacaoPermutasService.js';
import EleicaoPermutasService from '../domain/service/permutas/EleicaoPermutasService.js';
import GestaoPermutasService from '../domain/service/permutas/GestaoPermutasService.js';
import RelatorioExportService from '../domain/service/permutas/RelatorioExportService.js';
import ReconciliacaoLotePermutaService from '../domain/service/permutas/ReconciliacaoLotePermutaService.js';
import ReconciliacaoPermutaService from '../domain/service/permutas/ReconciliacaoPermutaService.js';
import BorderoGestaoService from '../domain/service/permutas/BorderoGestaoService.js';
import LogService from '../domain/service/LogService.js';
import IngestaoCoalescerService from '../domain/service/permutas/IngestaoCoalescerService.js';
import ClienteFiltroRepository from '../domain/repository/permutas/ClienteFiltroRepository.js';
import PermutaProcessamentoRepository from '../domain/repository/permutas/PermutaProcessamentoRepository.js';
import PermutaRelationalRepository from '../domain/repository/permutas/PermutaRelationalRepository.js';
import PermutaSnapshotRepository from '../domain/repository/permutas/PermutaSnapshotRepository.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import permutasRouter from './permutas.js';
import { AcessoFixture } from '../http/__fixtures__/acesso.fixture.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const readJson = async (res: Response): Promise<Record<string, any>> =>
    (await res.json()) as Record<string, any>;

// Mimics auth: attaches a fake user. Toggled per-test to simulate 401.
const buildApp = (opts: {
    authenticated: boolean;
    role?: string;
    /** Sobrescreve a identidade do token (ex.: sem `sub` nem `email`). */
    identidade?: { sub: string; email?: string };
}): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use((req, res, next) => {
        if (!opts.authenticated) {
            res.status(401).json({ error: 'Missing or malformed Authorization header' });
            return;
        }
        // Administrador por padrão (as nove permissões); outro `role` = só leitura (ADR-0053).
        req.user = {
            ...(opts.identidade ?? { sub: 'user-abc', email: 'a@b.com' }),
            role: opts.role ?? 'admin',
        };
        req.acesso = AcessoFixture.porPapelLegado(opts.role);
        next();
    });
    app.use('/permutas', permutasRouter);
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

describe('POST /permutas/eleicao', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('triggers the eleicao via container service and returns the run summary', async () => {
        const executar = jest.fn().mockResolvedValue({
            runId: 'run-1',
            flowId: 'flow-1',
            totalCandidatas: 3,
            totalElegiveis: 1,
            totalBloqueadas: 2,
            bloqueadasByMotivo: { 'sem-invoice': 2 },
            status: 'success',
            candidatas: [],
        });
        container.registerInstance(EleicaoPermutasService, { executar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/eleicao`, { method: 'POST' });
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body).toMatchObject({
                runId: 'run-1',
                totalCandidatas: 3,
                totalElegiveis: 1,
                totalBloqueadas: 2,
                status: 'success',
            });
            // triggered_by = authenticated user identity (audit O6).
            expect(executar).toHaveBeenCalledWith({ triggeredBy: 'user-abc' });
        } finally {
            await server.close();
        }
    });

    it('requires authentication (401 when unauthenticated)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await fetch(`${server.url}/permutas/eleicao`, { method: 'POST' });
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('POST /permutas/ingestao', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('triggers the manual ingestion with the authenticated user identity and returns totals', async () => {
        const executar = jest.fn().mockResolvedValue({
            runId: 'run-i1',
            flowId: 'flow-i1',
            status: 'success',
            totalAdiantamentos: 509,
            totalInvoices: 126,
            totalCasamentos: 27,
            totalStale: 4,
        });
        container.registerInstance(IngestaoCoalescerService, { request: executar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/ingestao`, { method: 'POST' });
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body).toMatchObject({
                runId: 'run-i1',
                status: 'success',
                totalAdiantamentos: 509,
                totalCasamentos: 27,
            });
            // triggered_by = username autenticado (auditoria O6) — fonte server-side.
            expect(executar).toHaveBeenCalledWith({ triggeredBy: 'user-abc' });
        } finally {
            await server.close();
        }
    });

    it('returns 409 (ingestion_in_progress) when the advisory lock is busy', async () => {
        const executar = jest.fn().mockRejectedValue(new IngestLockBusyError());
        container.registerInstance(IngestaoCoalescerService, { request: executar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/ingestao`, { method: 'POST' });
            const body = await readJson(res);
            expect(res.status).toBe(409);
            expect(body.error).toBe('INGESTION_IN_PROGRESS');
            expect(typeof body.message).toBe('string');
        } finally {
            await server.close();
        }
    });

    it('lets unexpected errors fall through to the error middleware (500, not 409)', async () => {
        const executar = jest.fn().mockRejectedValue(new Error('boom'));
        container.registerInstance(IngestaoCoalescerService, { request: executar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/ingestao`, { method: 'POST' });
            expect(res.status).toBe(500);
        } finally {
            await server.close();
        }
    });

    it('requires authentication (401 when unauthenticated)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await fetch(`${server.url}/permutas/ingestao`, { method: 'POST' });
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('GET /permutas/runs', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('returns the recent runs (default limit) for the audit modal', async () => {
        const listRecentRuns = jest.fn().mockResolvedValue([
            {
                runId: 'run-2',
                triggeredBy: 'simone',
                startedAt: new Date('2026-06-21T13:52:00Z'),
                finishedAt: new Date('2026-06-21T13:52:30Z'),
                status: 'success',
                totalCandidatas: 509,
                totalElegiveis: 27,
                totalBloqueadas: 413,
            },
            {
                runId: 'run-1',
                triggeredBy: 'cron',
                startedAt: new Date('2026-06-21T09:00:00Z'),
                finishedAt: new Date('2026-06-21T09:00:25Z'),
                status: 'success',
                totalCandidatas: 508,
                totalElegiveis: 26,
                totalBloqueadas: 412,
            },
        ]);
        container.registerInstance(PermutaSnapshotRepository, { listRecentRuns } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/runs`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.runs).toHaveLength(2);
            expect(body.runs[0]).toMatchObject({ triggeredBy: 'simone', totalElegiveis: 27 });
            expect(body.runs[1].triggeredBy).toBe('cron');
            // Default limit applied when ?limit absent.
            expect(listRecentRuns).toHaveBeenCalledWith(10);
        } finally {
            await server.close();
        }
    });

    it('honors a valid ?limit and rejects an out-of-range one (400)', async () => {
        const listRecentRuns = jest.fn().mockResolvedValue([]);
        container.registerInstance(PermutaSnapshotRepository, { listRecentRuns } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const ok = await fetch(`${server.url}/permutas/runs?limit=5`);
            expect(ok.status).toBe(200);
            expect(listRecentRuns).toHaveBeenCalledWith(5);

            const bad = await fetch(`${server.url}/permutas/runs?limit=999`);
            expect(bad.status).toBe(400);
        } finally {
            await server.close();
        }
    });

    it('requires authentication (401 when unauthenticated)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await fetch(`${server.url}/permutas/runs`);
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('cliente-filtro CRUD', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('GET lista os clientes-filtro ativos', async () => {
        const listAtivos = jest
            .fn()
            .mockResolvedValue([{ pesCod: '191', importador: 'INOX-TECH', criadoEm: new Date() }]);
        container.registerInstance(ClienteFiltroRepository, { listAtivos } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/cliente-filtro`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.clientes[0]).toMatchObject({ pesCod: '191', importador: 'INOX-TECH' });
        } finally {
            await server.close();
        }
    });

    it('POST faz upsert com o usuário autenticado em criadoPor', async () => {
        const upsertClienteFiltro = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(ClienteFiltroRepository, { upsertClienteFiltro } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/cliente-filtro`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ pesCod: '191', importador: 'INOX-TECH' }),
            });
            expect(res.status).toBe(200);
            expect(upsertClienteFiltro).toHaveBeenCalledWith({
                pesCod: '191',
                importador: 'INOX-TECH',
                criadoPor: 'user-abc',
            });
        } finally {
            await server.close();
        }
    });

    it('POST rejeita corpo sem pesCod (400)', async () => {
        container.registerInstance(ClienteFiltroRepository, {
            upsertClienteFiltro: jest.fn(),
        } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/cliente-filtro`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ importador: 'sem pesCod' }),
            });
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });

    it('DELETE remove pelo pesCod', async () => {
        const deleteByPesCod = jest.fn().mockResolvedValue(1);
        container.registerInstance(ClienteFiltroRepository, { deleteByPesCod } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/cliente-filtro/191`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(200);
            expect(deleteByPesCod).toHaveBeenCalledWith('191');
        } finally {
            await server.close();
        }
    });

    it('requer autenticação (401)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await fetch(`${server.url}/permutas/cliente-filtro`);
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('alocação manual (Fase 2)', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('GET /invoices/buscar exige priCod + filCod e devolve as invoices', async () => {
        const buscarInvoices = jest
            .fn()
            .mockResolvedValue([{ docCod: 'I7', priCod: '510', filCod: 2, temDi: true }]);
        container.registerInstance(AlocacaoPermutasService, { buscarInvoices } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const ok = await fetch(`${server.url}/permutas/invoices/buscar?priCod=510&filCod=2`);
            const body = await readJson(ok);
            expect(ok.status).toBe(200);
            expect(body.invoices[0]).toMatchObject({ docCod: 'I7', temDi: true });
            expect(buscarInvoices).toHaveBeenCalledWith('510', 2, undefined);

            // adtoDocCod (opcional) é repassado → exclui o próprio adto do jaAlocado.
            await fetch(`${server.url}/permutas/invoices/buscar?priCod=510&filCod=2&adtoDocCod=A9`);
            expect(buscarInvoices).toHaveBeenCalledWith('510', 2, 'A9');

            // sem filCod → 400 (priCod sozinho é insuficiente).
            const bad = await fetch(`${server.url}/permutas/invoices/buscar?priCod=510`);
            expect(bad.status).toBe(400);
        } finally {
            await server.close();
        }
    });

    it('POST /alocacoes grava com o usuário autenticado', async () => {
        const alocar = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(AlocacaoPermutasService, { alocar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/A9/alocacoes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    invoiceDocCod: 'I7',
                    invoicePriCod: '510',
                    valorAlocado: 600,
                }),
            });
            expect(res.status).toBe(200);
            expect(alocar).toHaveBeenCalledWith(
                expect.objectContaining({
                    adiantamentoDocCod: 'A9',
                    invoiceDocCod: 'I7',
                    invoicePriCod: '510',
                    valorAlocado: 600,
                    criadoPor: 'user-abc',
                }),
            );
        } finally {
            await server.close();
        }
    });

    it('POST /alocacoes → 422 quando excede saldo', async () => {
        const alocar = jest
            .fn()
            .mockRejectedValue(
                new AlocacaoSaldoError({ lado: 'invoice', disponivel: 800, pedido: 900 }),
            );
        container.registerInstance(AlocacaoPermutasService, { alocar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/A9/alocacoes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    invoiceDocCod: 'I7',
                    invoicePriCod: '510',
                    valorAlocado: 900,
                }),
            });
            const body = await readJson(res);
            expect(res.status).toBe(422);
            expect(body.error).toBe('ALOCACAO_EXCEDE_SALDO');
        } finally {
            await server.close();
        }
    });

    it('POST /alocacoes rejeita valor não-positivo (400)', async () => {
        container.registerInstance(AlocacaoPermutasService, { alocar: jest.fn() } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/A9/alocacoes`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    invoiceDocCod: 'I7',
                    invoicePriCod: '510',
                    valorAlocado: 0,
                }),
            });
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });

    it('DELETE /alocacoes remove pelo par', async () => {
        const remover = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(AlocacaoPermutasService, { remover } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/A9/alocacoes/I7`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(200);
            expect(remover).toHaveBeenCalledWith('A9', 'I7');
        } finally {
            await server.close();
        }
    });

    it('requer autenticação (401)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await fetch(`${server.url}/permutas/invoices/buscar?priCod=510`);
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('GET /permutas/importadores', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('lista importadores distintos do backlog', async () => {
        const listImportadores = jest
            .fn()
            .mockResolvedValue([{ pesCod: '191', importador: 'INOX-TECH', qtdAdtos: 290 }]);
        container.registerInstance(PermutaRelationalRepository, { listImportadores } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/importadores`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.importadores[0]).toMatchObject({ pesCod: '191', qtdAdtos: 290 });
        } finally {
            await server.close();
        }
    });
});

describe('GET /permutas/gestao', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('returns the relational gestao payload (fonte=banco)', async () => {
        const exporGestao = jest.fn().mockResolvedValue({
            fonte: 'banco',
            geradoEm: '2026-06-18T12:00:00.000Z',
            pendentes: [{ docCod: 'A1', status: 'elegivel' }],
            invoicesEmAberto: [],
            casamentos: [],
            totais: { pendentes: 1, invoicesEmAberto: 0, elegiveis: 1, bloqueadas: 0 },
        });
        container.registerInstance(GestaoPermutasService, { exporGestao } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/gestao`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.fonte).toBe('banco');
            expect(body.totais.elegiveis).toBe(1);
        } finally {
            await server.close();
        }
    });
});

describe('POST /permutas/adiantamentos/:docCod/processar', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('upserts status=processado with the authenticated user identity', async () => {
        const upsertProcessamento = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(PermutaProcessamentoRepository, {
            upsertProcessamento,
        } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/A1/processar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ invoiceDocCod: 'I1', observacao: 'casado' }),
            });
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body).toMatchObject({ adiantamentoDocCod: 'A1', status: 'processado' });
            expect(upsertProcessamento).toHaveBeenCalledWith({
                adiantamentoDocCod: 'A1',
                status: 'processado',
                processadoPor: 'user-abc',
                invoiceDocCod: 'I1',
                observacao: 'casado',
            });
        } finally {
            await server.close();
        }
    });

    it('accepts an empty body (invoiceDocCod/observacao optional)', async () => {
        const upsertProcessamento = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(PermutaProcessamentoRepository, {
            upsertProcessamento,
        } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/A1/processar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(200);
            expect(upsertProcessamento).toHaveBeenCalledWith({
                adiantamentoDocCod: 'A1',
                status: 'processado',
                processadoPor: 'user-abc',
            });
        } finally {
            await server.close();
        }
    });

    it('requires authentication (401 when unauthenticated)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/A1/processar`, {
                method: 'POST',
            });
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('exceção manual de permuta (ADR-0047)', () => {
    afterEach(() => {
        container.clearInstances();
    });

    const JUSTIFICATIVA = 'Baixas cruzadas 21 x 198 em 30/04 com a invoice 7329';
    const URL_8721 = '/permutas/adiantamentos/8721/excecao-manual';

    const post = (url: string, body: unknown) =>
        fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });

    it.each([
        ['curta', { justificativa: 'ab' }],
        ['vazia', { justificativa: '' }],
        ['só espaços', { justificativa: '            ' }],
        ['501 caracteres', { justificativa: 'x'.repeat(501) }],
        ['ausente', {}],
    ])('POST com justificativa %s → 400 sem chamar o serviço', async (_caso, body) => {
        const marcar = jest.fn();
        container.registerInstance(ExcecaoPermutaService, { marcar } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await post(`${server.url}${URL_8721}`, body);
            const json = await readJson(res);
            expect(res.status).toBe(400);
            expect(json.error).toBe('invalid body');
            expect(marcar).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });

    it('POST válido → 200, autor do token (criadoPor do body é ignorado) e justificativa com trim', async () => {
        const marcar = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(ExcecaoPermutaService, { marcar } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await post(`${server.url}${URL_8721}`, {
                justificativa: `  ${JUSTIFICATIVA}  `,
                criadoPor: 'forjado',
            });
            const json = await readJson(res);
            expect(res.status).toBe(200);
            expect(json).toEqual({ adiantamentoDocCod: '8721' });
            expect(marcar).toHaveBeenCalledWith({
                docCod: '8721',
                justificativa: JUSTIFICATIVA,
                criadoPor: 'user-abc',
            });
        } finally {
            await server.close();
        }
    });

    it('POST usa o email do token quando não há sub', async () => {
        const marcar = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(ExcecaoPermutaService, { marcar } as never);
        const server = await listen(
            buildApp({ authenticated: true, identidade: { sub: '', email: 'ana@columbia.com' } }),
        );
        try {
            const res = await post(`${server.url}${URL_8721}`, { justificativa: JUSTIFICATIVA });
            expect(res.status).toBe(200);
            expect(marcar).toHaveBeenCalledWith(
                expect.objectContaining({ criadoPor: 'ana@columbia.com' }),
            );
        } finally {
            await server.close();
        }
    });

    it('sem identidade no token (nem sub nem email) → 401 nas duas rotas, nunca grava "unknown"', async () => {
        const marcar = jest.fn();
        const desfazer = jest.fn();
        container.registerInstance(ExcecaoPermutaService, { marcar, desfazer } as never);
        const server = await listen(buildApp({ authenticated: true, identidade: { sub: '   ' } }));
        try {
            const resPost = await post(`${server.url}${URL_8721}`, {
                justificativa: JUSTIFICATIVA,
            });
            const resDelete = await fetch(`${server.url}${URL_8721}`, { method: 'DELETE' });
            expect(resPost.status).toBe(401);
            expect(resDelete.status).toBe(401);
            expect(marcar).not.toHaveBeenCalled();
            expect(desfazer).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });

    it.each([
        [
            422,
            new ExcecaoPermutaRecusadaError({
                tipo: 'guarda',
                docCod: '8721',
                estado: 'bloqueada',
                motivo: 'nao-pago',
            }),
        ],
        [
            404,
            new ExcecaoPermutaRecusadaError({
                tipo: 'adiantamento-nao-encontrado',
                docCod: '8721',
            }),
        ],
        [409, new ExcecaoPermutaRecusadaError({ tipo: 'ja-ativa', docCod: '8721' })],
    ])('POST: serviço lança %i → mesma resposta { error: code, message: userMessage }', async (status, erro) => {
        const marcar = jest.fn().mockRejectedValue(erro);
        container.registerInstance(ExcecaoPermutaService, { marcar } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await post(`${server.url}${URL_8721}`, { justificativa: JUSTIFICATIVA });
            const json = await readJson(res);
            expect(res.status).toBe(status);
            expect(json).toEqual({ error: erro.code, message: erro.userMessage });
        } finally {
            await server.close();
        }
    });

    it('DELETE → 200 com removidoPor do token', async () => {
        const desfazer = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(ExcecaoPermutaService, { desfazer } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}${URL_8721}`, { method: 'DELETE' });
            const json = await readJson(res);
            expect(res.status).toBe(200);
            expect(json).toEqual({ adiantamentoDocCod: '8721' });
            expect(desfazer).toHaveBeenCalledWith({ docCod: '8721', removidoPor: 'user-abc' });
        } finally {
            await server.close();
        }
    });

    it('DELETE sem exceção ativa → 404 com o contrato de erro', async () => {
        const erro = new ExcecaoPermutaRecusadaError({
            tipo: 'excecao-nao-encontrada',
            docCod: '8721',
        });
        container.registerInstance(ExcecaoPermutaService, {
            desfazer: jest.fn().mockRejectedValue(erro),
        } as never);
        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}${URL_8721}`, { method: 'DELETE' });
            const json = await readJson(res);
            expect(res.status).toBe(404);
            expect(json).toEqual({ error: 'EXCECAO_NAO_ENCONTRADA', message: erro.userMessage });
        } finally {
            await server.close();
        }
    });

    it('requer autenticação (401)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await post(`${server.url}${URL_8721}`, { justificativa: JUSTIFICATIVA });
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('RBAC — permissão nas rotas de mutação (security-1, ADR-0053)', () => {
    it('só permutas:ver → 403 nas mutações; as leituras passam', async () => {
        // Usuário autenticado só com leitura (`role` não-admin vira `AcessoFixture.somenteLeitura`).
        const server = await listen(buildApp({ authenticated: true, role: 'authenticated' }));
        try {
            const mutacoes: Array<[string, string]> = [
                ['POST', '/permutas/eleicao'],
                ['POST', '/permutas/ingestao'],
                ['POST', '/permutas/cliente-filtro'],
                ['DELETE', '/permutas/cliente-filtro/191'],
                ['POST', '/permutas/adiantamentos/A1/alocacoes'],
                ['DELETE', '/permutas/adiantamentos/A1/alocacoes/I1'],
                ['POST', '/permutas/adiantamentos/A1/processar'],
                ['POST', '/permutas/adiantamentos/A1/excecao-manual'],
                ['DELETE', '/permutas/adiantamentos/A1/excecao-manual'],
            ];
            for (const [method, path] of mutacoes) {
                const res = await fetch(`${server.url}${path}`, {
                    method,
                    headers: { 'content-type': 'application/json' },
                    body: method === 'DELETE' ? undefined : JSON.stringify({}),
                });
                expect(res.status).toBe(403);
            }
            // Leitura exige só `permutas:ver`. A sonda anterior era `GET /painel`
            // (removida em ADR-0043 §5) e registrava um mock com o método ERRADO
            // (`montarPainel` em vez de `exporNoPainel`), então a rota estourava
            // 500 e o `not.toBe(403)` passava POR ACIDENTE, sem exercitar o
            // caminho não-gateado. Aqui a leitura é real e responde 200.
            const exporGestao = jest.fn().mockResolvedValue({
                fonte: 'banco',
                pendentes: [],
                invoicesEmAberto: [],
                casamentos: [],
                totais: {
                    pendentes: 0,
                    invoicesEmAberto: 0,
                    elegiveis: 0,
                    bloqueadas: 0,
                    casamentoManual: 0,
                    permutaManual: 0,
                    jaPermutado: 0,
                },
            });
            container.registerInstance(GestaoPermutasService, { exporGestao } as never);
            const leitura = await fetch(`${server.url}/permutas/gestao`);
            expect(leitura.status).toBe(200);
            expect(exporGestao).toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });
});

describe('GET /permutas/relatorios/:tipo', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('exports a known report as xlsx with attachment filename', async () => {
        const exportar = jest.fn().mockResolvedValue({
            filename: 'permutas-adiantamentos-2026-06-24.xlsx',
            buffer: Buffer.from('PK-fake-xlsx'),
        });
        container.registerInstance(RelatorioExportService, { exportar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/relatorios/adiantamentos`);
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            );
            expect(res.headers.get('content-disposition')).toBe(
                'attachment; filename="permutas-adiantamentos-2026-06-24.xlsx"',
            );
            expect(exportar).toHaveBeenCalledWith('adiantamentos', expect.any(String));
        } finally {
            await server.close();
        }
    });

    it('returns 400 for an unknown report type (and does not resolve the service)', async () => {
        const exportar = jest.fn();
        container.registerInstance(RelatorioExportService, { exportar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/relatorios/inexistente`);
            const body = await readJson(res);
            expect(res.status).toBe(400);
            expect(body.error).toMatch(/invalid report type/);
            expect(exportar).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });

    it('requires authentication (401 when unauthenticated)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await fetch(`${server.url}/permutas/relatorios/invoices`);
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('POST /permutas/reconciliar-lote', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('executa o lote das automáticas via service e devolve o agregado', async () => {
        const reconciliarLote = jest.fn().mockResolvedValue({
            dryRun: false,
            writeEnabled: true,
            totalCasos: 3,
            totalSettled: 2,
            totalErros: 1,
            borderos: [100, 101],
            resultados: [],
        });
        container.registerInstance(ReconciliacaoLotePermutaService, { reconciliarLote } as never);

        const server = await listen(buildApp({ authenticated: true, role: 'admin' }));
        try {
            const res = await fetch(`${server.url}/permutas/reconciliar-lote`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ dryRun: true, adiantamentoDocCods: ['9026', '11821'] }),
            });
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body).toMatchObject({ totalCasos: 3, totalSettled: 2, borderos: [100, 101] });
            // executadoPor = identidade autenticada; dryRun + subconjunto passados adiante.
            expect(reconciliarLote).toHaveBeenCalledWith(
                expect.objectContaining({
                    executadoPor: 'user-abc',
                    dryRunOverride: true,
                    adiantamentoDocCods: ['9026', '11821'],
                }),
            );
        } finally {
            await server.close();
        }
    });

    it('exige role admin (403 para não-admin)', async () => {
        const reconciliarLote = jest.fn();
        container.registerInstance(ReconciliacaoLotePermutaService, { reconciliarLote } as never);

        const server = await listen(buildApp({ authenticated: true, role: 'viewer' }));
        try {
            const res = await fetch(`${server.url}/permutas/reconciliar-lote`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(403);
            expect(reconciliarLote).not.toHaveBeenCalled();
        } finally {
            await server.close();
        }
    });

    it('exige autenticação (401)', async () => {
        const server = await listen(buildApp({ authenticated: false }));
        try {
            const res = await fetch(`${server.url}/permutas/reconciliar-lote`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(401);
        } finally {
            await server.close();
        }
    });
});

describe('POST /permutas/borderos/:borCod/finalizar (erro do ERP — observabilidade)', () => {
    afterEach(() => {
        container.clearInstances();
    });

    const erpError = (key: string, vars?: Record<string, unknown>) =>
        Object.assign(new Error('conexos'), {
            cause: {
                response: {
                    status: 400,
                    data: { messages: [{ message: key, ...(vars ? { vars } : {}) }] },
                },
            },
        });

    it('surface a razão REAL do ERP (vars.msg) no Generic.ERROR_MESSAGE + loga a resposta crua', async () => {
        const finalizarBordero = jest
            .fn()
            .mockRejectedValue(
                erpError('Generic.ERROR_MESSAGE', { msg: 'CONTA DE DESCONTO NÃO INFORMADA!!!' }),
            );
        const logError = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(BorderoGestaoService, { finalizarBordero } as never);
        container.registerInstance(LogService, { error: logError } as never);

        const server = await listen(buildApp({ authenticated: true, role: 'admin' }));
        try {
            const res = await fetch(`${server.url}/permutas/borderos/14918/finalizar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ filCod: 2 }),
            });
            const body = await readJson(res);
            expect(res.status).toBe(400);
            // A razão real (antes escondida no vars.msg) agora vai no corpo — não mais o genérico.
            expect(body.error).toBe('CONTA DE DESCONTO NÃO INFORMADA!!!');
            expect(body.erpDetail).toBe('CONTA DE DESCONTO NÃO INFORMADA!!!');
            expect(typeof body.requestId).toBe('string');
            // A resposta crua do ERP (status + key + data) continua logada.
            expect(logError).toHaveBeenCalledTimes(1);
            const logArg = logError.mock.calls[0][0];
            expect(logArg.data).toMatchObject({
                acao: 'finalizar',
                borCod: 14918,
                erpStatus: 400,
                erpKey: 'Generic.ERROR_MESSAGE',
            });
            expect(logArg.data.erpData).toMatchObject({
                messages: [
                    {
                        message: 'Generic.ERROR_MESSAGE',
                        vars: { msg: 'CONTA DE DESCONTO NÃO INFORMADA!!!' },
                    },
                ],
            });
        } finally {
            await server.close();
        }
    });

    it('Generic.ERROR_MESSAGE SEM vars → mensagem genérica de fallback', async () => {
        container.registerInstance(BorderoGestaoService, {
            finalizarBordero: jest.fn().mockRejectedValue(erpError('Generic.ERROR_MESSAGE')),
        } as never);
        container.registerInstance(LogService, {
            error: jest.fn().mockResolvedValue(undefined),
        } as never);

        const server = await listen(buildApp({ authenticated: true, role: 'admin' }));
        try {
            const res = await fetch(`${server.url}/permutas/borderos/14918/finalizar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            const body = await readJson(res);
            expect(res.status).toBe(400);
            expect(body.error).toMatch(/ERP recusou/);
        } finally {
            await server.close();
        }
    });

    it('inclui erpDetail (key crua) quando o código do ERP não é mapeado', async () => {
        container.registerInstance(BorderoGestaoService, {
            finalizarBordero: jest.fn().mockRejectedValue(erpError('FIN_010.ALGO_NAO_MAPEADO')),
        } as never);
        container.registerInstance(LogService, {
            error: jest.fn().mockResolvedValue(undefined),
        } as never);

        const server = await listen(buildApp({ authenticated: true, role: 'admin' }));
        try {
            const res = await fetch(`${server.url}/permutas/borderos/14918/finalizar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            const body = await readJson(res);
            expect(res.status).toBe(400);
            expect(body.erpDetail).toBe('FIN_010.ALGO_NAO_MAPEADO');
        } finally {
            await server.close();
        }
    });

    it('FORBIDDEN (borderô fora da trilha) → 403 com requestId', async () => {
        const forbidden = new Error(
            'FORBIDDEN: borderô 14918 não foi criado por este sistema — ação não permitida',
        );
        container.registerInstance(BorderoGestaoService, {
            finalizarBordero: jest.fn().mockRejectedValue(forbidden),
        } as never);
        container.registerInstance(LogService, {
            error: jest.fn().mockResolvedValue(undefined),
        } as never);

        const server = await listen(buildApp({ authenticated: true, role: 'admin' }));
        try {
            const res = await fetch(`${server.url}/permutas/borderos/14918/finalizar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            const body = await readJson(res);
            expect(res.status).toBe(403);
            expect(body.error).toMatch(/não foi criado por este sistema/);
            expect(typeof body.requestId).toBe('string');
        } finally {
            await server.close();
        }
    });
});

/**
 * C-4 — a rota `/reconciliar` transformava QUALQUER `HandlerError` em HTTP 500 (o
 * `errorMiddleware` global achata tudo e descarta `statusCode`/`code`/`userMessage`/`retryable`).
 * Implementar o 409 e o 422 no serviço não bastava: os dois chegavam à analista como "erro
 * interno", e a mensagem em PT — a razão de existir das duas classes de erro — morria no caminho.
 */
describe('POST /permutas/adiantamentos/:docCod/reconciliar — contrato de erro', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('ReconciliacaoEmAndamentoError ⇒ 409 com code, userMessage e retryable (não 500)', async () => {
        const reconciliar = jest
            .fn()
            .mockRejectedValue(new ReconciliacaoEmAndamentoError({ adiantamentoDocCod: '2767' }));
        container.registerInstance(ReconciliacaoPermutaService, { reconciliar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/2767/reconciliar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            expect(res.status).toBe(409);
            const body = await readJson(res as never);
            expect(body.code).toBe('RECONCILIACAO_EM_ANDAMENTO');
            expect(body.retryable).toBe(true);
            expect(body.error).toMatch(/Aguarde/i);
        } finally {
            await server.close();
        }
    });

    it('AlocacaoSemCoberturaError ⇒ 422 com userMessage acionável', async () => {
        const reconciliar = jest.fn().mockRejectedValue(
            new AlocacaoSemCoberturaError({
                adiantamentoDocCod: '2767',
                invoiceDocCod: '5078',
                cobertura: 900,
                valorAlocado: 1000,
            }),
        );
        container.registerInstance(ReconciliacaoPermutaService, { reconciliar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/2767/reconciliar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            expect(res.status).toBe(422);
            const body = await readJson(res as never);
            expect(body.code).toBe('ALOCACAO_SEM_COBERTURA');
            expect(body.retryable).toBe(false);
            expect(body.error).toMatch(/não cobrem|re-alocar/i);
        } finally {
            await server.close();
        }
    });

    it('Error cru continua virando 500 genérico (nada de err.message vazando ao cliente)', async () => {
        const reconciliar = jest
            .fn()
            .mockRejectedValue(new Error('conexão recusada em 10.0.0.7:5432 (senha do pool)'));
        container.registerInstance(ReconciliacaoPermutaService, { reconciliar } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/adiantamentos/2767/reconciliar`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
            });
            expect(res.status).toBe(500);
            const body = await readJson(res as never);
            expect(JSON.stringify(body)).not.toContain('10.0.0.7');
            expect(body.code).toBeUndefined();
        } finally {
            await server.close();
        }
    });
});

/** Sobe o app, roda o corpo e sempre fecha o servidor. */
const comServidor = async (fn: (url: string) => Promise<void>): Promise<void> => {
    const server = await listen(buildApp({ authenticated: true, role: 'admin' }));
    try {
        await fn(server.url);
    } finally {
        await server.close();
    }
};

/**
 * `:borCod` e `?filCod=` das ações de borderô chegam ao serviço que ESCREVE no ERP. Antes, `Number()`
 * + `isFinite` aceitava `1.5`, `-3` e `?filCod=` vazio virando 0; e um `?filCod=abc` era descartado em
 * silêncio, deixando a escrita seguir na filial que a trilha resolvesse.
 */
describe('ações de borderô — borCod/filCod validados no boundary', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it.each([
        ['borCod não numérico', 'abc', ''],
        ['borCod fracionário', '1.5', ''],
        ['borCod negativo', '-3', ''],
        ['filCod não numérico', '14918', '?filCod=abc'],
        ['filCod fracionário', '14918', '?filCod=2.5'],
        ['filCod zero', '14918', '?filCod=0'],
    ])('%s → 400 e o serviço não é chamado', async (_caso, borCod, qs) => {
        const finalizarBordero = jest.fn();
        container.registerInstance(BorderoGestaoService, { finalizarBordero } as never);

        await comServidor(async (url) => {
            const res = await fetch(`${url}/permutas/borderos/${borCod}/finalizar${qs}`, {
                method: 'POST',
            });
            expect(res.status).toBe(400);
            expect(finalizarBordero).not.toHaveBeenCalled();
        });
    });

    it('filCod válido é repassado; vazio conta como ausente', async () => {
        const cancelarBordero = jest.fn().mockResolvedValue({ ok: true });
        container.registerInstance(BorderoGestaoService, { cancelarBordero } as never);

        await comServidor(async (url) => {
            await fetch(`${url}/permutas/borderos/14918/cancelar?filCod=2`, { method: 'POST' });
            expect(cancelarBordero).toHaveBeenLastCalledWith(
                expect.objectContaining({ borCod: 14918, filCod: 2 }),
            );

            await fetch(`${url}/permutas/borderos/14918/cancelar?filCod=`, { method: 'POST' });
            expect(cancelarBordero.mock.calls[1]?.[0]).not.toHaveProperty('filCod');
        });
    });

    it('vale para todas as ações de escrita (excluir borderô e excluir baixa)', async () => {
        const excluirBordero = jest.fn();
        const excluirBaixa = jest.fn();
        container.registerInstance(BorderoGestaoService, {
            excluirBordero,
            excluirBaixa,
        } as never);

        await comServidor(async (url) => {
            const a = await fetch(`${url}/permutas/borderos/14918?filCod=x`, { method: 'DELETE' });
            const b = await fetch(`${url}/permutas/borderos/0/baixas/777`, { method: 'DELETE' });
            expect([a.status, b.status]).toEqual([400, 400]);
            expect(excluirBordero).not.toHaveBeenCalled();
            expect(excluirBaixa).not.toHaveBeenCalled();
        });
    });

    it('GET /borderos/:borCod/baixas exige filCod inteiro positivo', async () => {
        const listarBaixasErp = jest.fn().mockResolvedValue([]);
        container.registerInstance(BorderoGestaoService, { listarBaixasErp } as never);

        await comServidor(async (url) => {
            const bad = await fetch(`${url}/permutas/borderos/14918/baixas?filCod=-2`);
            expect(bad.status).toBe(400);
            const ok = await fetch(`${url}/permutas/borderos/14918/baixas?filCod=2`);
            expect(ok.status).toBe(200);
            expect(listarBaixasErp).toHaveBeenCalledWith({ borCod: 14918, filCod: 2 });
        });
    });
});

describe('ações de borderô — recusa tipada do serviço sai com o status dela', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it.each([
        ['borderô fora da trilha', new BorderoNotOwnedError({ borCod: 14918 }), 403],
        [
            'borderô em duas filiais',
            new BorderoAmbiguousError({ borCod: 14918, filiais: [2, 7] }),
            400,
        ],
        [
            'borderô sem baixas',
            new BorderoStateConflictError({ motivo: 'sem-baixas', borCod: 14918 }),
            409,
        ],
        ['escrita desligada', new ConexosWriteDisabledError(), 503],
    ])('%s → status do erro, texto curado em `error`', async (_caso, err, status) => {
        const finalizarBordero = jest.fn().mockRejectedValue(err);
        const logError = jest.fn().mockResolvedValue(undefined);
        container.registerInstance(BorderoGestaoService, { finalizarBordero } as never);
        container.registerInstance(LogService, { error: logError } as never);

        await comServidor(async (url) => {
            const res = await fetch(`${url}/permutas/borderos/14918/finalizar`, {
                method: 'POST',
            });
            expect(res.status).toBe(status);
            const body = await readJson(res);
            // `error` segue sendo o texto que a tela mostra (é dele que o front lê).
            expect(body.error).toBe(err.userMessage);
            expect(body.code).toBe(err.code);
            expect(typeof body.requestId).toBe('string');
            // Recusa NOSSA não é "borderô recusado pelo ERP": não polui o log de erro do ERP.
            expect(logError).not.toHaveBeenCalled();
        });
    });

    it('baixa fora da trilha → 404', async () => {
        const excluirBaixa = jest
            .fn()
            .mockRejectedValue(
                new PermutaNotFoundError({ recurso: 'baixa', borCod: 14918, invoiceDocCod: '777' }),
            );
        container.registerInstance(BorderoGestaoService, { excluirBaixa } as never);

        await comServidor(async (url) => {
            const res = await fetch(`${url}/permutas/borderos/14918/baixas/777`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(404);
            expect((await readJson(res)).code).toBe('BAIXA_NAO_ENCONTRADA');
        });
    });

    it('recusa do ERP (ConexosError, também HandlerError) continua 400 + razão real, não 502', async () => {
        const erroDoErp = new ConexosError({
            endpoint: 'fin014/finalizar',
            cause: {
                response: {
                    status: 400,
                    data: {
                        messages: [
                            {
                                message: 'Generic.ERROR_MESSAGE',
                                vars: { msg: 'CONTA DE DESCONTO NÃO INFORMADA!!!' },
                            },
                        ],
                    },
                },
            },
        });
        container.registerInstance(BorderoGestaoService, {
            finalizarBordero: jest.fn().mockRejectedValue(erroDoErp),
        } as never);
        container.registerInstance(LogService, {
            error: jest.fn().mockResolvedValue(undefined),
        } as never);

        await comServidor(async (url) => {
            const res = await fetch(`${url}/permutas/borderos/14918/finalizar`, {
                method: 'POST',
            });
            expect(res.status).toBe(400);
            const body = await readJson(res);
            expect(body.error).toBe('CONTA DE DESCONTO NÃO INFORMADA!!!');
        });
    });
});

describe('alocação manual — recusas tipadas no formato que o front lê', () => {
    afterEach(() => {
        container.clearInstances();
    });

    const postAlocacao = (url: string) =>
        fetch(`${url}/permutas/adiantamentos/A9/alocacoes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ invoiceDocCod: 'I7', invoicePriCod: '510', valorAlocado: 600 }),
        });

    it.each([
        [
            'moeda diferente',
            new InvalidAllocationError({
                motivo: 'moeda-diferente',
                moedaAdiantamento: 'USD',
                moedaInvoice: 'EUR',
            }),
            422,
        ],
        [
            'adiantamento sem filial',
            new PermutaDataIncompleteError({ campo: 'filial', adiantamentoDocCod: 'A9' }),
            422,
        ],
        [
            'invoice fora do processo',
            new PermutaNotFoundError({
                recurso: 'invoice',
                invoiceDocCod: 'I7',
                invoicePriCod: '510',
            }),
            404,
        ],
    ])('%s → status do erro, no formato { error: code, message }', async (_caso, err, status) => {
        container.registerInstance(AlocacaoPermutasService, {
            alocar: jest.fn().mockRejectedValue(err),
        } as never);

        await comServidor(async (url) => {
            const res = await postAlocacao(url);
            expect(res.status).toBe(status);
            const body = await readJson(res);
            // `{ error: code, message: userMessage }` — o front mostra `message` no toast do 422.
            expect(body).toMatchObject({ error: err.code, message: err.userMessage });
        });
    });

    it('DELETE mantém o 409 de alocação usada em borderô (mesmo formato)', async () => {
        container.registerInstance(AlocacaoPermutasService, {
            remover: jest.fn().mockRejectedValue(
                new AlocacaoEmBorderoError({
                    adiantamentoDocCod: 'A9',
                    invoiceDocCod: 'I7',
                    borCod: 14918,
                }),
            ),
        } as never);

        await comServidor(async (url) => {
            const res = await fetch(`${url}/permutas/adiantamentos/A9/alocacoes/I7`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(409);
            const body = await readJson(res);
            expect(body.error).toBe('ALOCACAO_EM_BORDERO');
            expect(body.message).toMatch(/borderô 14918/);
        });
    });
});

describe('POST /permutas/adiantamentos/:docCod/gerar-numerario — contrato de erro', () => {
    afterEach(() => {
        container.clearInstances();
    });

    const postNumerario = (url: string) =>
        fetch(`${url}/permutas/adiantamentos/A9/gerar-numerario`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ valor: 100 }),
        });

    it('adiantamento ausente → 404 com userMessage em `error` (não 500)', async () => {
        container.registerInstance(GerarSolicitacaoNumerarioService, {
            gerarNumerario: jest
                .fn()
                .mockRejectedValue(
                    new PermutaNotFoundError({ recurso: 'adiantamento', adiantamentoDocCod: 'A9' }),
                ),
        } as never);

        await comServidor(async (url) => {
            const res = await postNumerario(url);
            expect(res.status).toBe(404);
            const body = await readJson(res);
            expect(body.code).toBe('ADIANTAMENTO_NAO_ENCONTRADO');
            expect(body.error).toMatch(/Adiantamento A9 não encontrado/);
        });
    });

    it('Error cru continua 500 genérico, sem vazar a mensagem', async () => {
        container.registerInstance(GerarSolicitacaoNumerarioService, {
            gerarNumerario: jest.fn().mockRejectedValue(new Error('pool exausto em 10.0.0.7')),
        } as never);

        await comServidor(async (url) => {
            const res = await postNumerario(url);
            expect(res.status).toBe(500);
            expect(JSON.stringify(await readJson(res))).not.toContain('10.0.0.7');
        });
    });
});
