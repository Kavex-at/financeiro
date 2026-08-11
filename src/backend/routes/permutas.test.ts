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
import IngestLockBusyError from '../domain/errors/IngestLockBusyError.js';
import AlocacaoPermutasService from '../domain/service/permutas/AlocacaoPermutasService.js';
import EleicaoPermutasService from '../domain/service/permutas/EleicaoPermutasService.js';
import GestaoPermutasService from '../domain/service/permutas/GestaoPermutasService.js';
import RelatorioExportService from '../domain/service/permutas/RelatorioExportService.js';
import ReconciliacaoLotePermutaService from '../domain/service/permutas/ReconciliacaoLotePermutaService.js';
import BorderoGestaoService from '../domain/service/permutas/BorderoGestaoService.js';
import LogService from '../domain/service/LogService.js';
import IngestaoCoalescerService from '../domain/service/permutas/IngestaoCoalescerService.js';
import PainelService from '../domain/service/permutas/PainelService.js';
import ClienteFiltroRepository from '../domain/repository/permutas/ClienteFiltroRepository.js';
import PermutaProcessamentoRepository from '../domain/repository/permutas/PermutaProcessamentoRepository.js';
import PermutaRelationalRepository from '../domain/repository/permutas/PermutaRelationalRepository.js';
import PermutaSnapshotRepository from '../domain/repository/permutas/PermutaSnapshotRepository.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import permutasRouter from './permutas.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const readJson = async (res: Response): Promise<Record<string, any>> =>
    (await res.json()) as Record<string, any>;

// Mimics auth: attaches a fake user. Toggled per-test to simulate 401.
const buildApp = (opts: { authenticated: boolean; role?: string }): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use((req, res, next) => {
        if (!opts.authenticated) {
            res.status(401).json({ error: 'Missing or malformed Authorization header' });
            return;
        }
        // role 'admin' por padrão (rotas de mutação exigem requireRole('admin')).
        //
        // `sub` e `username` são DIFERENTES de propósito: é isso que faz as asserções de
        // `criadoPor` / `processadoPor` / `executadoPor` / `triggeredBy` abaixo PROVAREM que
        // o ator gravado é o username (I-Usuario-1), e não o sub. Se alguém reintroduzir
        // `req.user?.sub` num site de auditoria, estes testes ficam vermelhos.
        req.user = {
            sub: 'user-abc',
            email: 'a@b.com',
            username: 'a@b.com',
            role: opts.role ?? 'admin',
        };
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
            expect(executar).toHaveBeenCalledWith({ triggeredBy: 'a@b.com' });
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
            expect(executar).toHaveBeenCalledWith({ triggeredBy: 'a@b.com' });
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

describe('GET /permutas/painel', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('returns the latest snapshot payload', async () => {
        const exporNoPainel = jest.fn().mockResolvedValue({
            runId: 'run-9',
            snapshotAge: 1000,
            totalElegiveis: 1,
            totalBloqueadas: 1,
            items: [
                { docCod: 'A1', priCod: '2048', status: 'elegivel', aging: 10 },
                {
                    docCod: 'A2',
                    priCod: '3000',
                    status: 'bloqueada',
                    motivoBloqueio: 'sem-invoice',
                    aging: null,
                },
            ],
        });
        container.registerInstance(PainelService, { exporNoPainel } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/painel`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.totalElegiveis).toBe(1);
            expect(body.items).toHaveLength(2);
            // Blocked candidate is visible with its motivo (bloqueada ≠ falha).
            expect(body.items[1].motivoBloqueio).toBe('sem-invoice');
            // ⏸ GATED-P0-4 — aging null is preserved, not dropped.
            expect(body.items[1].aging).toBeNull();
        } finally {
            await server.close();
        }
    });

    it('returns an empty payload when no snapshot exists (not 500)', async () => {
        const exporNoPainel = jest
            .fn()
            .mockResolvedValue({ totalElegiveis: 0, totalBloqueadas: 0, items: [] });
        container.registerInstance(PainelService, { exporNoPainel } as never);

        const server = await listen(buildApp({ authenticated: true }));
        try {
            const res = await fetch(`${server.url}/permutas/painel`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.items).toEqual([]);
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
                criadoPor: 'a@b.com',
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
                    criadoPor: 'a@b.com',
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
                processadoPor: 'a@b.com',
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
                processadoPor: 'a@b.com',
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

describe('RBAC — requireRole nas rotas de mutação (security-1)', () => {
    it('role não-admin → 403 nas mutações; leituras seguem abertas', async () => {
        // Usuário autenticado mas role 'authenticated' (não admin).
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
            ];
            for (const [method, path] of mutacoes) {
                const res = await fetch(`${server.url}${path}`, {
                    method,
                    headers: { 'content-type': 'application/json' },
                    body: method === 'DELETE' ? undefined : JSON.stringify({}),
                });
                expect(res.status).toBe(403);
            }
            // Leitura (GET /painel) NÃO é gateada por role.
            container.registerInstance(PainelService, {
                montarPainel: jest.fn().mockResolvedValue({ pendencias: [], totais: {} }),
            } as never);
            const leitura = await fetch(`${server.url}/permutas/painel`);
            expect(leitura.status).not.toBe(403);
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
                    executadoPor: 'a@b.com',
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
