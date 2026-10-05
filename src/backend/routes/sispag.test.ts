import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';

// Neutraliza o bootstrap real (sem Conexos/DB) — os handlers só precisam do
// container para resolver os serviços mockados.
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import DebitDateFrozenError from '../domain/errors/DebitDateFrozenError.js';
import LoteVersaoConflitoError from '../domain/errors/LoteVersaoConflitoError.js';
import ExcecaoAprovacaoProprioCadastranteError from '../domain/errors/ExcecaoAprovacaoProprioCadastranteError.js';
import ExcecaoEstadoInvalidoError from '../domain/errors/ExcecaoEstadoInvalidoError.js';
import ExcecaoTitularidadeError from '../domain/errors/ExcecaoTitularidadeError.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import DebitDateOutsideWindowError from '../domain/errors/DebitDateOutsideWindowError.js';
import ErpPerguntaError from '../domain/errors/ErpPerguntaError.js';
import LoteEstadoInvalidoError from '../domain/errors/LoteEstadoInvalidoError.js';
import RemessaEmDuvidaError from '../domain/errors/RemessaEmDuvidaError.js';
import TituloForaDeLoteError from '../domain/errors/TituloForaDeLoteError.js';
import ConciliacaoExecucaoRepository from '../domain/repository/sispag/ConciliacaoExecucaoRepository.js';
import PagamentoIngestaoRunRepository from '../domain/repository/sispag/PagamentoIngestaoRunRepository.js';
import RemessaExecucaoRepository from '../domain/repository/sispag/RemessaExecucaoRepository.js';
import CarteiraAtualizacaoService from '../domain/service/sispag/CarteiraAtualizacaoService.js';
import ConciliacaoRetornoService from '../domain/service/sispag/ConciliacaoRetornoService.js';
import DebitDateService from '../domain/service/sispag/DebitDateService.js';
import FormacaoLotesService from '../domain/service/sispag/FormacaoLotesService.js';
import IngestaoPagamentosService from '../domain/service/sispag/IngestaoPagamentosService.js';
import ExcecaoDestinoService from '../domain/service/sispag/ExcecaoDestinoService.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';
import SispagPainelService from '../domain/service/sispag/SispagPainelService.js';
import SincronizacaoLoteService from '../domain/service/sispag/SincronizacaoLoteService.js';
import BoletoDdaService from '../domain/service/sispag/BoletoDdaService.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import sispagRouter from './sispag.js';
import { AcessoFixture } from '../http/__fixtures__/acesso.fixture.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const readJson = async (res: Response): Promise<Record<string, any>> =>
    (await res.json()) as Record<string, any>;

/**
 * Auth falsa. `role` é a ponte dos testes anteriores à ADR-0053: `admin` (default) vira o
 * Administrador (as nove permissões); `viewer` vira só leitura, sem `sispag:executar`. O gate real
 * é o guard `exigirPermissao` de cada rota; a tabela completa está em `http/routePermissions.test.ts`.
 */
const buildApp = (opts: { authenticated: boolean; role?: string }): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use((req, res, next) => {
        if (!opts.authenticated) {
            res.status(401).json({ error: 'Missing or malformed Authorization header' });
            return;
        }
        req.user = { sub: 'user-abc', email: 'a@b.com', role: opts.role ?? 'admin' };
        // `admin` = Administrador; `viewer` = só leitura (sem `sispag:executar`), ADR-0053.
        req.acesso = AcessoFixture.porPapelLegado(opts.role);
        next();
    });
    // Sem `sispagGate`: o gate tem teste próprio; aqui o alvo são os handlers.
    app.use('/sispag', sispagRouter);
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

/** Sobe o app, roda o corpo e sempre fecha o servidor. */
const comApp = async (
    opts: { authenticated?: boolean; role?: string },
    fn: (url: string) => Promise<void>,
): Promise<void> => {
    const server = await listen(buildApp({ authenticated: opts.authenticated ?? true, ...opts }));
    try {
        await fn(server.url);
    } finally {
        await server.close();
    }
};

const LOTE = {
    id: 'L1',
    filCod: 2,
    status: 'RASCUNHO',
    criadoPor: 'user-abc',
    versao: 1,
    itens: [],
};

afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────── LEITURAS

describe('GET /sispag/painel', () => {
    it('devolve o painel montado pelo serviço', async () => {
        const montarPainel = jest
            .fn()
            .mockResolvedValue({ titulos: [], titulosTotal: 0, kpis: {} });
        container.registerInstance(SispagPainelService, { montarPainel } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/painel`);
            expect(res.status).toBe(200);
            expect(await readJson(res)).toMatchObject({ titulosTotal: 0 });
        });
    });

    it('exige autenticação', async () => {
        await comApp({ authenticated: false }, async (url) => {
            const res = await fetch(`${url}/sispag/painel`);
            expect(res.status).toBe(401);
        });
    });
});

describe('GET /sispag/retornos', () => {
    it('envelopa a lista em `arquivos`', async () => {
        const listRetornos = jest.fn().mockResolvedValue([{ garCodSeq: 5 }]);
        container.registerInstance(SispagPainelService, { listRetornos } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/retornos`);
            expect(res.status).toBe(200);
            expect(await readJson(res)).toEqual({ arquivos: [{ garCodSeq: 5 }] });
        });
    });

    it('GET /lotes/:id/linhas-digitaveis devolve as linhas do lote', async () => {
        const linhasDigitaveisDoLote = jest.fn().mockResolvedValue({
            itens: [{ docCod: '10400', titCod: '1', linhaDigitavel: '1'.repeat(47) }],
            total: 1,
            dropped: 0,
        });
        container.registerInstance(SispagPainelService, { linhasDigitaveisDoLote } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/lote-1/linhas-digitaveis`);
            expect(res.status).toBe(200);
            expect(await readJson(res)).toEqual({
                itens: [{ docCod: '10400', titCod: '1', linhaDigitavel: '1'.repeat(47) }],
                total: 1,
                dropped: 0,
            });
        });
        expect(linhasDigitaveisDoLote).toHaveBeenCalledWith('lote-1');
    });

    it('GET /lotes/:id/linhas-digitaveis basta sispag:ver (só leitura também confere boleto)', async () => {
        // Decisão do dono do ciclo (ADR-0053): conferir a linha digitável é acompanhar o lote.
        // Sem `sispag:ver` o guard recusa; a tabela completa está em `http/routePermissions.test.ts`.
        const linhasDigitaveisDoLote = jest.fn().mockResolvedValue([]);
        container.registerInstance(SispagPainelService, { linhasDigitaveisDoLote } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/lote-1/linhas-digitaveis`);
            expect(res.status).toBe(200);
        });
        expect(linhasDigitaveisDoLote).toHaveBeenCalledWith('lote-1');
    });

    it('GET /lotes/:id/linhas-digitaveis em rascunho devolve lista vazia, não erro', async () => {
        // Rascunho não tem item no fin015. Vazio é o estágio, não uma falha — e a UI
        // simplesmente não oferece o botão de copiar.
        const linhasDigitaveisDoLote = jest
            .fn()
            .mockResolvedValue({ itens: [], total: 0, dropped: 0 });
        container.registerInstance(SispagPainelService, { linhasDigitaveisDoLote } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/rascunho-1/linhas-digitaveis`);
            expect(res.status).toBe(200);
            expect(await readJson(res)).toEqual({ itens: [], total: 0, dropped: 0 });
        });
    });
});

describe('GET /sispag/lotes', () => {
    it('repassa os filtros validados ao serviço', async () => {
        const listarLotes = jest.fn().mockResolvedValue([LOTE]);
        container.registerInstance(LotePagamentoService, { listarLotes } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes?status=RASCUNHO&filCod=2`);
            expect(res.status).toBe(200);
            expect(listarLotes).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'RASCUNHO', filCod: 2 }),
            );
        });
    });

    it('400 quando a query é inválida', async () => {
        container.registerInstance(LotePagamentoService, { listarLotes: jest.fn() } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes?filCod=abc`);
            expect(res.status).toBe(400);
            expect(await readJson(res)).toMatchObject({ error: 'invalid query' });
        });
    });
});

describe('GET /sispag/lotes/:id', () => {
    it('404 quando o lote não existe — e não 200 com corpo vazio', async () => {
        container.registerInstance(LotePagamentoService, {
            getLote: jest.fn().mockResolvedValue(null),
        } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/nao-existe`);
            expect(res.status).toBe(404);
        });
    });

    it('200 com o lote', async () => {
        container.registerInstance(LotePagamentoService, {
            getLote: jest.fn().mockResolvedValue(LOTE),
        } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1`);
            expect(await readJson(res)).toEqual({ lote: LOTE });
        });
    });
});

describe('GET /sispag/ingestao/runs', () => {
    it('limita o `limit` em 50 — query hostil não vira scan', async () => {
        const listRecentRuns = jest.fn().mockResolvedValue([]);
        container.registerInstance(PagamentoIngestaoRunRepository, { listRecentRuns } as never);

        await comApp({}, async (url) => {
            await fetch(`${url}/sispag/ingestao/runs?limit=9999`);
            expect(listRecentRuns).toHaveBeenCalledWith(50);
        });
    });

    it.each([
        '-5',
        '0',
        '1.5',
    ])('limit %s cai no default 10 — nunca chega ao LIMIT do SQL', async (limit) => {
        const listRecentRuns = jest.fn().mockResolvedValue([]);
        container.registerInstance(PagamentoIngestaoRunRepository, {
            listRecentRuns,
        } as never);

        await comApp({}, async (url) => {
            await fetch(`${url}/sispag/ingestao/runs?limit=${limit}`);
            expect(listRecentRuns).toHaveBeenCalledWith(10);
        });
    });

    it('cai no default 10 quando o limit não é número', async () => {
        const listRecentRuns = jest.fn().mockResolvedValue([]);
        container.registerInstance(PagamentoIngestaoRunRepository, { listRecentRuns } as never);

        await comApp({}, async (url) => {
            await fetch(`${url}/sispag/ingestao/runs?limit=abc`);
            expect(listRecentRuns).toHaveBeenCalledWith(10);
        });
    });
});

// ─────────────────────────────────────────────── DADO BANCÁRIO (role)

describe('GET /sispag/contas-pagadoras', () => {
    it('exige sispag:executar — é conta corrente da empresa', async () => {
        container.registerInstance(ConexosSispagClient, {
            listContasCorrentes: jest.fn(),
        } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/contas-pagadoras?filCod=2`);
            expect(res.status).toBe(403);
        });
    });

    it('400 sem filCod — nunca lista a carteira inteira por omissão', async () => {
        const listContasCorrentes = jest.fn();
        container.registerInstance(ConexosSispagClient, { listContasCorrentes } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/contas-pagadoras`);
            expect(res.status).toBe(400);
            expect(listContasCorrentes).not.toHaveBeenCalled();
        });
    });

    it('200 com as contas da filial', async () => {
        const listContasCorrentes = jest.fn().mockResolvedValue([{ ccoCod: 1 }]);
        container.registerInstance(ConexosSispagClient, { listContasCorrentes } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/contas-pagadoras?filCod=2`);
            expect(await readJson(res)).toEqual({ contas: [{ ccoCod: 1 }] });
            expect(listContasCorrentes).toHaveBeenCalledWith(2);
        });
    });
});

// ─────────────────────────────────────────────────── ESCRITAS LOCAIS

describe('POST /sispag/lotes', () => {
    it('cria e responde 201 com o ator autenticado', async () => {
        const criarLote = jest.fn().mockResolvedValue(LOTE);
        container.registerInstance(LotePagamentoService, { criarLote } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filCod: 2 }),
            });
            expect(res.status).toBe(201);
            // O ator vem da sessão, NUNCA do corpo — é a trilha de auditoria.
            expect(criarLote).toHaveBeenCalledWith(
                expect.objectContaining({ filCod: 2, ator: 'user-abc' }),
            );
        });
    });

    it('exige sispag:executar', async () => {
        container.registerInstance(LotePagamentoService, { criarLote: jest.fn() } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/lotes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filCod: 2 }),
            });
            expect(res.status).toBe(403);
        });
    });

    it('400 com corpo inválido, sem chamar o serviço', async () => {
        const criarLote = jest.fn();
        container.registerInstance(LotePagamentoService, { criarLote } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filCod: -1 }),
            });
            expect(res.status).toBe(400);
            expect(criarLote).not.toHaveBeenCalled();
        });
    });
});

describe('POST /sispag/lotes/:id/itens', () => {
    it('inclui o título e devolve o lote', async () => {
        const incluirTitulo = jest.fn().mockResolvedValue(LOTE);
        container.registerInstance(LotePagamentoService, { incluirTitulo } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/itens`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filCod: 2, docCod: '813', titCod: '1' }),
            });
            expect(res.status).toBe(200);
            expect(incluirTitulo).toHaveBeenCalledWith(
                expect.objectContaining({ loteId: 'L1', docCod: '813', ator: 'user-abc' }),
            );
        });
    });

    it('mapeia HandlerError de domínio para o status dele', async () => {
        const incluirTitulo = jest.fn().mockRejectedValue(
            new ErpPerguntaError({
                chave: 'FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO',
                contexto: 'incluirTitulo',
            }),
        );
        container.registerInstance(LotePagamentoService, { incluirTitulo } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/itens`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filCod: 2, docCod: '813', titCod: '1' }),
            });
            expect(res.status).toBe(409);
            expect(await readJson(res)).toMatchObject({ code: 'ERP_PERGUNTA' });
        });
    });
});

describe('DELETE /sispag/lotes/:id/itens/:filCod/:docCod/:titCod', () => {
    it('remove o título', async () => {
        const removerTitulo = jest.fn().mockResolvedValue(LOTE);
        container.registerInstance(LotePagamentoService, { removerTitulo } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/itens/2/813/1`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            expect(removerTitulo).toHaveBeenCalledWith(
                expect.objectContaining({ loteId: 'L1', filCod: 2, docCod: '813', titCod: '1' }),
            );
        });
    });

    it('400 quando o filCod da URL não é inteiro positivo', async () => {
        const removerTitulo = jest.fn();
        container.registerInstance(LotePagamentoService, { removerTitulo } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/itens/0/813/1`, { method: 'DELETE' });
            expect(res.status).toBe(400);
            expect(removerTitulo).not.toHaveBeenCalled();
        });
    });
});

describe('POST /sispag/titulos/:filCod/:docCod/:titCod/retirar-do-lote', () => {
    const post = (url: string, chave = '2/813/1') =>
        fetch(`${url}/sispag/titulos/${chave}/retirar-do-lote`, { method: 'POST' });

    it('retira o título do lote em que está; autor vem do JWT', async () => {
        const retirarDoLote = jest.fn().mockResolvedValue(LOTE);
        container.registerInstance(LotePagamentoService, { retirarDoLote } as never);

        await comApp({}, async (url) => {
            const res = await post(url);
            expect(res.status).toBe(200);
            expect(await readJson(res)).toMatchObject({ lote: { id: 'L1' } });
            expect(retirarDoLote).toHaveBeenCalledWith({
                filCod: 2,
                docCod: '813',
                titCod: '1',
                ator: 'user-abc',
            });
        });
    });

    it('400 quando o filCod da URL não é inteiro positivo', async () => {
        const retirarDoLote = jest.fn();
        container.registerInstance(LotePagamentoService, { retirarDoLote } as never);

        await comApp({}, async (url) => {
            const res = await post(url, 'abc/813/1');
            expect(res.status).toBe(400);
            expect(retirarDoLote).not.toHaveBeenCalled();
        });
    });

    it('exige sispag:executar', async () => {
        const retirarDoLote = jest.fn();
        container.registerInstance(LotePagamentoService, { retirarDoLote } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await post(url);
            expect(res.status).toBe(403);
            expect(retirarDoLote).not.toHaveBeenCalled();
        });
    });

    it('título fora de lote vira 409 com a mensagem do domínio', async () => {
        const retirarDoLote = jest
            .fn()
            .mockRejectedValue(
                new TituloForaDeLoteError({ filCod: 2, docCod: '813', titCod: '1' }),
            );
        container.registerInstance(LotePagamentoService, { retirarDoLote } as never);

        await comApp({}, async (url) => {
            const res = await post(url);
            expect(res.status).toBe(409);
            expect(await readJson(res)).toMatchObject({ code: 'TITULO_FORA_DE_LOTE' });
        });
    });
});

describe('POST /sispag/ingestao', () => {
    it('honra o header Idempotency-Key', async () => {
        const executar = jest.fn().mockResolvedValue({ runId: 'r1' });
        container.registerInstance(IngestaoPagamentosService, { executar } as never);

        await comApp({}, async (url) => {
            await fetch(`${url}/sispag/ingestao`, {
                method: 'POST',
                headers: { 'Idempotency-Key': 'chave-123' },
            });
            expect(executar).toHaveBeenCalledWith({
                triggeredBy: 'user-abc',
                idempotencyKey: 'chave-123',
            });
        });
    });
});

describe('POST /sispag/carteira/atualizar (ADR-0060)', () => {
    it('quem só tem sispag:ver pode disparar, e o gatilho é marcado `abertura:<ator>`', async () => {
        const atualizarSeDefasada = jest.fn().mockResolvedValue({ estado: 'fresca', idadeMin: 7 });
        container.registerInstance(CarteiraAtualizacaoService, { atualizarSeDefasada } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/carteira/atualizar`, { method: 'POST' });
            expect(res.status).toBe(200);
            expect(await readJson(res)).toMatchObject({ estado: 'fresca', idadeMin: 7 });
            expect(atualizarSeDefasada).toHaveBeenCalledWith({ triggeredBy: 'abertura:user-abc' });
        });
    });

    it('sem login responde 401 e não toca a ingestão', async () => {
        const atualizarSeDefasada = jest.fn();
        container.registerInstance(CarteiraAtualizacaoService, { atualizarSeDefasada } as never);
        await comApp({ authenticated: false }, async (url) => {
            const res = await fetch(`${url}/sispag/carteira/atualizar`, { method: 'POST' });
            expect(res.status).toBe(401);
            expect(atualizarSeDefasada).not.toHaveBeenCalled();
        });
    });
});

describe('POST /sispag/lotes/formar', () => {
    it('dispara a formação automática', async () => {
        const formar = jest.fn().mockResolvedValue({ criados: 3 });
        container.registerInstance(FormacaoLotesService, { formar } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/formar`, { method: 'POST' });
            expect(res.status).toBe(200);
            expect(await readJson(res)).toMatchObject({ criados: 3 });
        });
    });

    it('exige sispag:executar', async () => {
        container.registerInstance(FormacaoLotesService, { formar: jest.fn() } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/formar`, { method: 'POST' });
            expect(res.status).toBe(403);
        });
    });
});

// ────────────────────────────────────── ESCRITAS NO ERP (as caras)

describe('POST /sispag/lotes/:id/remessa', () => {
    it('honra Idempotency-Key e x-request-id', async () => {
        const gerarRemessa = jest.fn().mockResolvedValue({ dryRun: true });
        container.registerInstance(RemessaService, { gerarRemessa } as never);

        await comApp({}, async (url) => {
            await fetch(`${url}/sispag/lotes/L1/remessa`, {
                method: 'POST',
                headers: { 'Idempotency-Key': 'k-1', 'x-request-id': 'req-9' },
            });
            expect(gerarRemessa).toHaveBeenCalledWith(
                expect.objectContaining({
                    loteId: 'L1',
                    ator: 'user-abc',
                    idempotencyKey: 'k-1',
                    correlationId: 'req-9',
                }),
            );
        });
    });

    it('sem Idempotency-Key NÃO inventa chave — o serviço deriva do lote', async () => {
        // Se a rota gerasse um UUID aqui, dois cliques viravam duas remessas: a colisão
        // de chave é justamente o que impede o segundo lote de pagamento.
        const gerarRemessa = jest.fn().mockResolvedValue({ dryRun: true });
        container.registerInstance(RemessaService, { gerarRemessa } as never);

        await comApp({}, async (url) => {
            await fetch(`${url}/sispag/lotes/L1/remessa`, { method: 'POST' });
            const arg = gerarRemessa.mock.calls[0]?.[0] ?? {};
            expect(arg).not.toHaveProperty('idempotencyKey');
        });
    });

    it('RemessaEmDuvidaError vira 409 com a mensagem acionável', async () => {
        const gerarRemessa = jest.fn().mockRejectedValue(
            new RemessaEmDuvidaError({
                loteId: 'L1',
                idempotencyKey: 'remessa:L1',
                filCod: 2,
                bncCod: 4,
                criadoEm: '2026-08-24T12:00:00.000Z',
            }),
        );
        container.registerInstance(RemessaService, { gerarRemessa } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa`, { method: 'POST' });
            expect(res.status).toBe(409);
            const body = await readJson(res);
            expect(body).toMatchObject({ code: 'REMESSA_EM_DUVIDA', retryable: false });
            // Sem flpCod a mensagem TEM que dar coordenadas de busca.
            expect(body.error).toContain('filial 2');
        });
    });

    it('exige sispag:executar', async () => {
        container.registerInstance(RemessaService, { gerarRemessa: jest.fn() } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa`, { method: 'POST' });
            expect(res.status).toBe(403);
        });
    });

    describe('dryRun / confirmarNovoLote — booleanos que decidem escrita real', () => {
        const post = (url: string, body: unknown) =>
            fetch(`${url}/sispag/lotes/L1/remessa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

        it('dryRun false NÃO força escrita: sem override, o serviço usa o default do ambiente', async () => {
            const gerarRemessa = jest.fn().mockResolvedValue({ dryRun: true });
            container.registerInstance(RemessaService, { gerarRemessa } as never);

            await comApp({}, async (url) => {
                const res = await post(url, { dryRun: false });
                expect(res.status).toBe(200);
                const arg = gerarRemessa.mock.calls[0]?.[0] ?? {};
                expect(arg).not.toHaveProperty('dryRunOverride');
                expect(arg).not.toHaveProperty('confirmarNovoLote');
            });
        });

        it.each([
            ['dryRun como string', { dryRun: 'true' }],
            ['dryRun como número', { dryRun: 1 }],
            ['dryRun nulo', { dryRun: null }],
            ['confirmarNovoLote como string', { confirmarNovoLote: 'true' }],
            ['confirmarNovoLote como número', { confirmarNovoLote: 1 }],
            // Antes a chave com erro de digitação era ignorada: a simulação pedida sumia e o
            // serviço caía no default, que pode ser a escrita real.
            ['chave com erro de digitação', { dry_run: true }],
        ])('%s → 400 e o serviço não é chamado', async (_caso, body) => {
            const gerarRemessa = jest.fn();
            container.registerInstance(RemessaService, { gerarRemessa } as never);

            await comApp({}, async (url) => {
                const res = await post(url, body);
                expect(res.status).toBe(400);
                expect(gerarRemessa).not.toHaveBeenCalled();
            });
        });
    });

    describe('dataDebito (I8, ADR-0049)', () => {
        const post = (url: string, body: unknown) =>
            fetch(`${url}/sispag/lotes/L1/remessa`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

        it('repassa a data junto com confirmarNovoLote e dryRun', async () => {
            const gerarRemessa = jest.fn().mockResolvedValue({ status: 'gerada' });
            container.registerInstance(RemessaService, { gerarRemessa } as never);

            await comApp({}, async (url) => {
                const res = await post(url, {
                    dataDebito: '2026-09-23',
                    confirmarNovoLote: true,
                    dryRun: true,
                });
                expect(res.status).toBe(200);
                expect(gerarRemessa).toHaveBeenCalledWith(
                    expect.objectContaining({
                        dataDebito: '2026-09-23',
                        confirmarNovoLote: true,
                        dryRunOverride: true,
                    }),
                );
            });
        });

        it('sem data: não inventa uma (o serviço usa o default da janela)', async () => {
            const gerarRemessa = jest.fn().mockResolvedValue({ status: 'gerada' });
            container.registerInstance(RemessaService, { gerarRemessa } as never);

            await comApp({}, async (url) => {
                await post(url, {});
                expect(gerarRemessa.mock.calls[0]?.[0]).not.toHaveProperty('dataDebito');
            });
        });

        it.each([
            '22/09/2026',
            '2026-02-30',
            '2026-9-22',
            20260922,
        ])('%s → 400 e o serviço não é chamado', async (dataDebito) => {
            const gerarRemessa = jest.fn();
            container.registerInstance(RemessaService, { gerarRemessa } as never);

            await comApp({}, async (url) => {
                const res = await post(url, { dataDebito });
                expect(res.status).toBe(400);
                expect(gerarRemessa).not.toHaveBeenCalled();
            });
        });

        it('fora da janela → 422 DATA_DEBITO_FORA_DA_JANELA com details', async () => {
            const gerarRemessa = jest.fn().mockRejectedValue(
                new DebitDateOutsideWindowError({
                    motivo: 'depois_do_vencimento',
                    dataDebito: '2026-09-30',
                    min: '2026-09-22',
                    max: '2026-09-29',
                }),
            );
            container.registerInstance(RemessaService, { gerarRemessa } as never);

            await comApp({}, async (url) => {
                const res = await post(url, { dataDebito: '2026-09-30' });
                expect(res.status).toBe(422);
                const body = await readJson(res);
                expect(body).toMatchObject({
                    code: 'DATA_DEBITO_FORA_DA_JANELA',
                    details: { motivo: 'depois_do_vencimento', max: '2026-09-29' },
                });
            });
        });

        it('data congelada → 409 DATA_DEBITO_CONGELADA com details', async () => {
            const gerarRemessa = jest.fn().mockRejectedValue(
                new DebitDateFrozenError({
                    motivo: 'diferente',
                    dataCongelada: '2026-09-23',
                    nativeFlpCod: 41,
                }),
            );
            container.registerInstance(RemessaService, { gerarRemessa } as never);

            await comApp({}, async (url) => {
                const res = await post(url, { dataDebito: '2026-09-24' });
                expect(res.status).toBe(409);
                const body = await readJson(res);
                expect(body).toMatchObject({
                    code: 'DATA_DEBITO_CONGELADA',
                    details: { dataCongelada: '2026-09-23', nativeFlpCod: 41 },
                });
            });
        });
    });
});

describe('GET /sispag/lotes/:id/remessa/janela', () => {
    it('200 com a janela calculada pelo DebitDateService', async () => {
        const janela = {
            hoje: '2026-09-22',
            min: '2026-09-22',
            max: '2026-09-25',
            sugerida: '2026-09-22',
            amanha: '2026-09-23',
            naoUteis: [],
        };
        const getWindow = jest.fn().mockResolvedValue(janela);
        container.registerInstance(DebitDateService, { getWindow } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa/janela`);
            expect(res.status).toBe(200);
            expect(await readJson(res)).toEqual(janela);
            expect(getWindow).toHaveBeenCalledWith('L1');
        });
    });

    it('lote fora de FINALIZADO → 409 pelo respondLoteError', async () => {
        const getWindow = jest.fn().mockRejectedValue(
            new LoteEstadoInvalidoError({
                loteId: 'L1',
                statusAtual: 'RASCUNHO',
                acao: 'gerar remessa',
            }),
        );
        container.registerInstance(DebitDateService, { getWindow } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa/janela`);
            expect(res.status).toBe(409);
            expect(await readJson(res)).toMatchObject({ code: 'LOTE_ESTADO_INVALIDO' });
        });
    });

    it('exige autenticação, como as outras leituras de lote', async () => {
        container.registerInstance(DebitDateService, { getWindow: jest.fn() } as never);
        await comApp({ authenticated: false }, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa/janela`);
            expect(res.status).toBe(401);
        });
    });
});

describe('GET /sispag/lotes/:id/remessa/arquivo', () => {
    it('exige sispag:executar — o CNAB traz banco/agência/conta de cada fornecedor', async () => {
        container.registerInstance(RemessaService, { baixarArquivo: jest.fn() } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa/arquivo`);
            expect(res.status).toBe(403);
        });
    });

    it('404 quando o lote não tem remessa gerada', async () => {
        container.registerInstance(RemessaService, {
            baixarArquivo: jest.fn().mockResolvedValue(null),
        } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa/arquivo`);
            expect(res.status).toBe(404);
        });
    });

    it('devolve o CNAB como anexo latin1 — sem recodificar os bytes', async () => {
        // CNAB 240 é POSICIONAL. Servido como string, o Express reescreve o charset para
        // utf-8 e codifica em UTF-8: o "Ç" de um nome de favorecido vira 2 bytes e empurra
        // todas as colunas seguintes. Este teste existe porque foi assim que o bug apareceu.
        const conteudo = 'HEADER SOLUÇÕES LTDA';
        container.registerInstance(RemessaService, {
            baixarArquivo: jest.fn().mockResolvedValue({ nomeArquivo: 'PG240801.REM', conteudo }),
        } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa/arquivo`);
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('latin1');
            expect(res.headers.get('content-disposition')).toContain('PG240801.REM');

            const bytes = Buffer.from(await res.arrayBuffer());
            // 1 byte por caractere: o comprimento em bytes é igual ao da string.
            expect(bytes.length).toBe(conteudo.length);
            expect(bytes.toString('latin1')).toBe(conteudo);
        });
    });
});

describe('POST /sispag/retornos/conciliar', () => {
    it('repassa a chave do arquivo e o Idempotency-Key', async () => {
        const conciliar = jest.fn().mockResolvedValue({ dryRun: true, totalLinhas: 0 });
        container.registerInstance(ConciliacaoRetornoService, { conciliar } as never);

        await comApp({}, async (url) => {
            await fetch(`${url}/sispag/retornos/conciliar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'c-1' },
                body: JSON.stringify({
                    filCod: 2,
                    bncCod: 4,
                    gtbCodSeq: 1,
                    garCodSeq: 5,
                    processar: true,
                }),
            });
            expect(conciliar).toHaveBeenCalledWith(
                expect.objectContaining({
                    filCod: 2,
                    garCodSeq: 5,
                    processar: true,
                    ator: 'user-abc',
                    idempotencyKey: 'c-1',
                }),
            );
        });
    });

    it('400 com corpo inválido, sem chamar o `processar` do ERP', async () => {
        const conciliar = jest.fn();
        container.registerInstance(ConciliacaoRetornoService, { conciliar } as never);

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/retornos/conciliar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filCod: 2 }),
            });
            expect(res.status).toBe(400);
            expect(conciliar).not.toHaveBeenCalled();
        });
    });

    it('exige sispag:executar', async () => {
        container.registerInstance(ConciliacaoRetornoService, { conciliar: jest.fn() } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/retornos/conciliar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filCod: 2, bncCod: 4, gtbCodSeq: 1, garCodSeq: 5 }),
            });
            expect(res.status).toBe(403);
        });
    });
});

describe('GET /sispag/execucoes', () => {
    const registrarLedgers = (over: Record<string, jest.Mock> = {}) => {
        const remessa = {
            listByStatus: jest.fn().mockResolvedValue([{ idempotencyKey: 'remessa:L1' }]),
            listReconcilingParadas: jest.fn().mockResolvedValue([{ idempotencyKey: 'remessa:L9' }]),
            ...over,
        };
        const conciliacao = {
            listByStatus: jest.fn().mockResolvedValue([]),
            listReconcilingParadas: jest.fn().mockResolvedValue([]),
        };
        container.registerInstance(RemessaExecucaoRepository, remessa as never);
        container.registerInstance(ConciliacaoExecucaoRepository, conciliacao as never);
        return { remessa, conciliacao };
    };

    it('lista os DOIS ledgers por status', async () => {
        const { remessa, conciliacao } = registrarLedgers();

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/execucoes?status=reconciling`);
            expect(res.status).toBe(200);
            const body = await readJson(res);
            expect(body).toHaveProperty('remessa');
            expect(body).toHaveProperty('conciliacao');
            expect(remessa.listByStatus).toHaveBeenCalledWith('reconciling', 50);
            expect(conciliacao.listByStatus).toHaveBeenCalledWith('reconciling', 50);
        });
    });

    it('`paradasHaMin` faz a triagem de órfão pelo SQL', async () => {
        const { remessa } = registrarLedgers();

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/execucoes?paradasHaMin=15&limit=10`);
            expect(res.status).toBe(200);
            expect(remessa.listReconcilingParadas).toHaveBeenCalledWith(15, 10);
            // Quando pedem paradas, NÃO cai no caminho por status.
            expect(remessa.listByStatus).not.toHaveBeenCalled();
        });
    });

    it('400 sem status nem paradasHaMin — não devolve a tabela inteira por omissão', async () => {
        const { remessa } = registrarLedgers();

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/execucoes`);
            expect(res.status).toBe(400);
            expect(remessa.listByStatus).not.toHaveBeenCalled();
        });
    });

    it('400 com status fora do enum', async () => {
        registrarLedgers();

        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/execucoes?status=inventado`);
            expect(res.status).toBe(400);
        });
    });

    it('exige sispag:executar — é trilha de execução financeira', async () => {
        registrarLedgers();

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/execucoes?status=error`);
            expect(res.status).toBe(403);
        });
    });
});

// ─────────────────────────────────────────────────────────── BOLETOS DDA

describe('GET /sispag/boletos-dda', () => {
    const registrar = () => {
        const listar = jest.fn().mockResolvedValue({ boletos: [], total: 0 });
        container.registerInstance(BoletoDdaService, { listar } as never);
        return listar;
    };

    it('sem query: "a vencer", página 1 de 20', async () => {
        const listar = registrar();
        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/boletos-dda`);
            expect(res.status).toBe(200);
        });
        expect(listar).toHaveBeenCalledWith({ escopo: 'a-vencer', pagina: 1, tamanho: 20 });
    });

    it('repassa filtros e página, com a busca aparada', async () => {
        const listar = registrar();
        await comApp({}, async (url) => {
            const qs =
                'escopo=todos&situacao=AMBIGUO&busca=%20pedroni%20&filCod=2&pagina=3&tamanho=50';
            const res = await fetch(`${url}/sispag/boletos-dda?${qs}`);
            expect(res.status).toBe(200);
        });
        expect(listar).toHaveBeenCalledWith({
            escopo: 'todos',
            situacao: 'AMBIGUO',
            busca: 'pedroni',
            filCod: 2,
            pagina: 3,
            tamanho: 50,
        });
    });

    it.each([
        ['página maior que o teto (limita o que sai por resposta)', 'tamanho=500'],
        ['situação desconhecida', 'situacao=PAGO'],
        ['página zero', 'pagina=0'],
    ])('400 para %s', async (_caso, qs) => {
        const listar = registrar();
        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/boletos-dda?${qs}`);
            expect(res.status).toBe(400);
        });
        expect(listar).not.toHaveBeenCalled();
    });

    it('basta sispag:ver — só leitura também consulta os boletos DDA (ADR-0053)', async () => {
        const listar = registrar();
        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/boletos-dda`);
            expect(res.status).toBe(200);
        });
        expect(listar).toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────── ADR-0061 — exceção de destino

describe('exceção de destino (ADR-0061)', () => {
    const ID = '3f1c2b9e-4d8a-4c1e-9f7a-2b6d8e0a1c55';
    const DESTINO = {
        tipo: 'CONTA',
        bancoCod: '237',
        agencia: '1234',
        conta: '99887766',
        contaDv: '1',
        titularDocumento: '11144477735',
    };
    const RESUMO = {
        id: ID,
        pesCod: '7001',
        filCod: 1,
        tipo: 'CONTA',
        destinoMascarado: 'banco 237 · ag. 1234 · cc ****7766-1',
        titularDocumentoMascarado: '***.444.777-**',
        estado: 'PENDENTE',
        origem: 'MANUAL',
        justificativa: 'cadastro desatualizado',
        cadastradoPor: 'user-abc',
        cadastradoEm: '2026-10-05T10:00:00.000Z',
        versao: 1,
    };
    const semSensivel = (json: unknown): void => {
        const texto = JSON.stringify(json);
        for (const v of ['99887766', '11144477735']) expect(texto).not.toContain(v);
    };
    const post = (url: string, path: string, body?: unknown): Promise<Response> =>
        fetch(`${url}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body ?? {}),
        });
    const servico = (over: Record<string, jest.Mock>): void => {
        container.registerInstance(ExcecaoDestinoService, over as never);
    };

    describe('GET /sispag/excecoes', () => {
        it('lista com filtros por estado e favorecido; só máscara na resposta', async () => {
            const listar = jest.fn().mockResolvedValue([RESUMO]);
            servico({ listar });
            await comApp({}, async (url) => {
                const res = await fetch(`${url}/sispag/excecoes?estado=PENDENTE&pesCod=7001`);
                expect(res.status).toBe(200);
                const body = await readJson(res);
                expect(body.excecoes[0].destinoMascarado).toContain('****');
                semSensivel(body);
            });
            expect(listar).toHaveBeenCalledWith({ estado: 'PENDENTE', pesCod: '7001' });
        });

        it('estado fora do catálogo → 400', async () => {
            const listar = jest.fn();
            servico({ listar });
            await comApp({}, async (url) => {
                const res = await fetch(`${url}/sispag/excecoes?estado=INVENTADO`);
                expect(res.status).toBe(400);
            });
            expect(listar).not.toHaveBeenCalled();
        });

        it('sem sispag:excecao (só leitura) → 403 com o código da permissão', async () => {
            const listar = jest.fn();
            servico({ listar });
            await comApp({ role: 'viewer' }, async (url) => {
                const res = await fetch(`${url}/sispag/excecoes`);
                expect(res.status).toBe(403);
                expect((await readJson(res)).permissao).toBe('sispag:excecao');
            });
            expect(listar).not.toHaveBeenCalled();
        });

        it('exige autenticação', async () => {
            await comApp({ authenticated: false }, async (url) => {
                expect((await fetch(`${url}/sispag/excecoes`)).status).toBe(401);
            });
        });
    });

    describe('POST /sispag/excecoes', () => {
        const BODY = {
            filCod: 1,
            pesCod: '7001',
            destino: DESTINO,
            justificativa: 'cadastro errado',
        };

        it('cadastra via serviço com o ator do TOKEN (não do body) e as permissões efetivas; 201 mascarado', async () => {
            const registrar = jest.fn().mockResolvedValue(RESUMO);
            servico({ registrar });
            await comApp({}, async (url) => {
                const res = await post(url, '/sispag/excecoes', {
                    ...BODY,
                    ator: 'outra-pessoa',
                });
                // `.strict()`: campo desconhecido (inclusive um "ator" forjado) é 400.
                expect(res.status).toBe(400);
                const ok = await post(url, '/sispag/excecoes', BODY);
                expect(ok.status).toBe(201);
                semSensivel(await readJson(ok));
            });
            expect(registrar).toHaveBeenCalledTimes(1);
            const chamada = registrar.mock.calls[0][0];
            expect(chamada).toMatchObject({
                filCod: 1,
                pesCod: '7001',
                destino: DESTINO,
                justificativa: 'cadastro errado',
                ator: { id: 'user-abc' },
            });
            expect([...chamada.ator.permissoes]).toContain('sispag:excecao');
        });

        it('aceita o favorecido pelo título (docCod + titCod)', async () => {
            const registrar = jest.fn().mockResolvedValue(RESUMO);
            servico({ registrar });
            await comApp({}, async (url) => {
                const res = await post(url, '/sispag/excecoes', {
                    filCod: 2,
                    docCod: '100',
                    titCod: '1',
                    destino: DESTINO,
                    justificativa: 'j',
                });
                expect(res.status).toBe(201);
            });
        });

        it('sem favorecido nem título → 400 sem ecoar o destino', async () => {
            const registrar = jest.fn();
            servico({ registrar });
            await comApp({}, async (url) => {
                const res = await post(url, '/sispag/excecoes', {
                    filCod: 1,
                    destino: DESTINO,
                    justificativa: 'j',
                });
                expect(res.status).toBe(400);
                semSensivel(await readJson(res));
            });
            expect(registrar).not.toHaveBeenCalled();
        });

        it('body inválido → 400 SEM o valor enviado', async () => {
            const registrar = jest.fn();
            servico({ registrar });
            await comApp({}, async (url) => {
                const res = await post(url, '/sispag/excecoes', {
                    filCod: 'x99887766',
                    pesCod: '7001',
                    destino: DESTINO,
                    justificativa: 'j',
                });
                expect(res.status).toBe(400);
                semSensivel(await readJson(res));
            });
            expect(registrar).not.toHaveBeenCalled();
        });

        it('titularidade (422) e flag desligada (403) saem como erro de domínio em português', async () => {
            const registrar = jest
                .fn()
                .mockRejectedValueOnce(
                    new ExcecaoTitularidadeError({ motivo: 'titular-divergente' }),
                )
                .mockRejectedValueOnce(
                    Object.assign(new Error('off'), {
                        code: 'EXCECAO_DESABILITADA',
                        userMessage: 'A exceção de destino de pagamento ainda não está habilitada.',
                        retryable: false,
                        statusCode: 403,
                    }),
                );
            servico({ registrar });
            await comApp({}, async (url) => {
                const r1 = await post(url, '/sispag/excecoes', BODY);
                expect(r1.status).toBe(422);
                expect((await readJson(r1)).code).toBe('EXCECAO_TITULARIDADE');
                const r2 = await post(url, '/sispag/excecoes', BODY);
                expect(r2.status).toBe(403);
                expect((await readJson(r2)).code).toBe('EXCECAO_DESABILITADA');
            });
        });

        it('sem sispag:excecao → 403 e o serviço não é chamado', async () => {
            const registrar = jest.fn();
            servico({ registrar });
            await comApp({ role: 'viewer' }, async (url) => {
                const res = await post(url, '/sispag/excecoes', BODY);
                expect(res.status).toBe(403);
                expect((await readJson(res)).permissao).toBe('sispag:excecao');
            });
            expect(registrar).not.toHaveBeenCalled();
        });
    });

    describe('POST /sispag/excecoes/:id/aprovar', () => {
        it('aprova com o ator do token; resposta mascarada', async () => {
            const aprovar = jest.fn().mockResolvedValue({ ...RESUMO, estado: 'APROVADA' });
            servico({ aprovar });
            await comApp({}, async (url) => {
                const res = await post(url, `/sispag/excecoes/${ID}/aprovar`);
                expect(res.status).toBe(200);
                const body = await readJson(res);
                expect(body.excecao.estado).toBe('APROVADA');
                semSensivel(body);
            });
            expect(aprovar).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: ID,
                    ator: expect.objectContaining({ id: 'user-abc' }),
                }),
            );
        });

        it('aprovar a PRÓPRIA exceção → 403 específico (I12b), vindo do serviço', async () => {
            const aprovar = jest
                .fn()
                .mockRejectedValue(new ExcecaoAprovacaoProprioCadastranteError({ excecaoId: ID }));
            servico({ aprovar });
            await comApp({}, async (url) => {
                const res = await post(url, `/sispag/excecoes/${ID}/aprovar`);
                expect(res.status).toBe(403);
                expect((await readJson(res)).code).toBe('EXCECAO_APROVACAO_PROPRIO_CADASTRANTE');
            });
        });

        it('estado inválido → 409', async () => {
            const aprovar = jest
                .fn()
                .mockRejectedValue(
                    new ExcecaoEstadoInvalidoError({ acao: 'aprovar', estadoAtual: 'REVOGADA' }),
                );
            servico({ aprovar });
            await comApp({}, async (url) => {
                expect((await post(url, `/sispag/excecoes/${ID}/aprovar`)).status).toBe(409);
            });
        });

        it('id que não é UUID → 400', async () => {
            const aprovar = jest.fn();
            servico({ aprovar });
            await comApp({}, async (url) => {
                expect((await post(url, '/sispag/excecoes/nao-e-uuid/aprovar')).status).toBe(400);
            });
            expect(aprovar).not.toHaveBeenCalled();
        });

        it('sem sispag:excecao → 403', async () => {
            const aprovar = jest.fn();
            servico({ aprovar });
            await comApp({ role: 'viewer' }, async (url) => {
                const res = await post(url, `/sispag/excecoes/${ID}/aprovar`);
                expect(res.status).toBe(403);
                expect((await readJson(res)).permissao).toBe('sispag:excecao');
            });
            expect(aprovar).not.toHaveBeenCalled();
        });
    });

    describe('POST /sispag/excecoes/:id/rejeitar e /revogar', () => {
        it.each([
            ['rejeitar', 'REJEITADA'],
            ['revogar', 'REVOGADA'],
        ])('%s exige motivo e leva o ator do token', async (acao, estado) => {
            const fn = jest.fn().mockResolvedValue({ ...RESUMO, estado });
            servico({ [acao]: fn });
            await comApp({}, async (url) => {
                const sem = await post(url, `/sispag/excecoes/${ID}/${acao}`, {});
                expect(sem.status).toBe(400);
                const vazio = await post(url, `/sispag/excecoes/${ID}/${acao}`, { motivo: '' });
                expect(vazio.status).toBe(400);
                const ok = await post(url, `/sispag/excecoes/${ID}/${acao}`, {
                    motivo: 'fornecedor trocou de banco',
                });
                expect(ok.status).toBe(200);
                expect((await readJson(ok)).excecao.estado).toBe(estado);
            });
            expect(fn).toHaveBeenCalledTimes(1);
            expect(fn).toHaveBeenCalledWith(
                expect.objectContaining({
                    id: ID,
                    motivo: 'fornecedor trocou de banco',
                    ator: expect.objectContaining({ id: 'user-abc' }),
                }),
            );
        });

        it.each(['rejeitar', 'revogar'])('%s sem sispag:excecao → 403', async (acao) => {
            const fn = jest.fn();
            servico({ [acao]: fn });
            await comApp({ role: 'viewer' }, async (url) => {
                const res = await post(url, `/sispag/excecoes/${ID}/${acao}`, { motivo: 'x' });
                expect(res.status).toBe(403);
            });
            expect(fn).not.toHaveBeenCalled();
        });
    });

    describe('GET /sispag/excecoes/:id/eventos', () => {
        it('devolve a trilha (sem valores)', async () => {
            const eventos = jest.fn().mockResolvedValue([
                {
                    id: 'A1',
                    excecaoId: ID,
                    evento: 'CADASTRO',
                    ator: 'ana',
                    ocorridoEm: '2026-10-05T10:00:00.000Z',
                },
            ]);
            servico({ eventos });
            await comApp({}, async (url) => {
                const res = await fetch(`${url}/sispag/excecoes/${ID}/eventos`);
                expect(res.status).toBe(200);
                expect((await readJson(res)).eventos[0].evento).toBe('CADASTRO');
            });
        });
    });

    it('o item do lote não carrega mais destino: GET /lotes/:id devolve só a referência da exceção usada', async () => {
        const getLote = jest.fn().mockResolvedValue({
            ...LOTE,
            itens: [
                {
                    loteId: 'L1',
                    filCod: 2,
                    docCod: '100',
                    titCod: '1',
                    modalidade: 'TED',
                    incluidoPor: 'u1',
                    excecaoDestinoId: ID,
                },
            ],
        });
        container.registerInstance(LotePagamentoService, { getLote } as never);
        await comApp({}, async (url) => {
            const body = await readJson(await fetch(`${url}/sispag/lotes/L1`));
            expect(body.lote.itens[0].excecaoDestinoId).toBe(ID);
            expect(body.lote.itens[0]).not.toHaveProperty('destinoManual');
            expect(body.lote.itens[0]).not.toHaveProperty('destinoManualResumo');
        });
    });

    it('as rotas antigas de destino por item foram retiradas (404)', async () => {
        await comApp({}, async (url) => {
            const base = '/sispag/lotes/L1/itens/2/100/1/destino';
            expect((await post(url, base, { versao: 1, destino: DESTINO })).status).toBe(404);
            expect((await fetch(`${url}${base}`, { method: 'DELETE' })).status).toBe(404);
            expect((await post(url, `${base}/aprovar`, { versao: 1 })).status).toBe(404);
        });
    });
});

describe('GET /sispag/recursos', () => {
    it('expõe as flags TED/PIX/exceção de destino só como booleanos', async () => {
        container.registerInstance(EnvironmentProvider, {
            getEnvironmentVars: jest.fn().mockResolvedValue({
                sispagTedEnabled: true,
                sispagExcecaoDestinoEnabled: false,
                sispagPixEnabled: undefined,
                conexosPassword: 'segredo',
            }),
        } as never);
        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/recursos`);
            expect(res.status).toBe(200);
            expect(await readJson(res)).toEqual({
                tedEnabled: true,
                excecaoDestinoEnabled: false,
                pixEnabled: false,
            });
        });
    });
});

// ─────────────────────────────────────────── SINCRONIZAÇÃO PELO TÍTULO (ADR-0055)

describe('POST /sispag/lotes/:id/sincronizar', () => {
    const ID = '3f1c2b9e-4d8a-4c1e-9f7a-2b6d8e0a1c55';
    const LOTE_SINC = {
        id: ID,
        filCod: 2,
        status: 'BAIXADO',
        criadoPor: 'u',
        versao: 6,
        itens: [
            {
                loteId: ID,
                filCod: 2,
                docCod: '38682',
                titCod: '1',
                incluidoPor: 'u',
                situacao: 'PAGO',
                pagoEm: '2026-09-24T15:00:00.000Z',
                valorPago: 275,
                origemBaixa: 'FORA_DO_RETORNO',
                baixaFonte: 'TITULO',
                borCod: 22320,
                divergencia: false,
                sincronizadoEm: '2026-09-29T14:35:00.000Z',
            },
        ],
    };
    const RESULTADO = {
        loteId: ID,
        filCod: 2,
        resultado: 'TRANSICIONOU',
        statusAntes: 'REMESSA_GERADA',
        statusDepois: 'BAIXADO',
        itens: 1,
        itensIlegiveis: 0,
        divergenciasNovas: 0,
    };

    it('devolve o lote atualizado (com os campos novos do item) e o resumo da passada', async () => {
        const sincronizarLote = jest
            .fn()
            .mockResolvedValue({ lote: LOTE_SINC, resultado: RESULTADO });
        container.registerInstance(SincronizacaoLoteService, { sincronizarLote } as never);
        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/${ID}/sincronizar`, { method: 'POST' });
            expect(res.status).toBe(200);
            const body = await readJson(res);
            expect(body.resumo).toEqual(RESULTADO);
            expect(body.lote.itens[0]).toEqual(
                expect.objectContaining({
                    situacao: 'PAGO',
                    pagoEm: '2026-09-24T15:00:00.000Z',
                    valorPago: 275,
                    origemBaixa: 'FORA_DO_RETORNO',
                    borCod: 22320,
                    divergencia: false,
                    sincronizadoEm: '2026-09-29T14:35:00.000Z',
                }),
            );
        });
        expect(sincronizarLote).toHaveBeenCalledWith(ID);
    });

    it('400 quando o :id não é um UUID — sem chamar o serviço', async () => {
        const sincronizarLote = jest.fn();
        container.registerInstance(SincronizacaoLoteService, { sincronizarLote } as never);
        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/nao-e-uuid/sincronizar`, {
                method: 'POST',
            });
            expect(res.status).toBe(400);
        });
        expect(sincronizarLote).not.toHaveBeenCalled();
    });

    it('404 quando o lote não existe', async () => {
        container.registerInstance(SincronizacaoLoteService, {
            sincronizarLote: jest.fn().mockResolvedValue(null),
        } as never);
        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/${ID}/sincronizar`, { method: 'POST' });
            expect(res.status).toBe(404);
        });
    });

    it('409 em conflito de versão e 409 em estado não sincronizável (convenção do lote)', async () => {
        const sincronizarLote = jest
            .fn()
            .mockRejectedValueOnce(new LoteVersaoConflitoError({ loteId: ID, versaoEsperada: 6 }))
            .mockRejectedValueOnce(
                new LoteEstadoInvalidoError({
                    loteId: ID,
                    statusAtual: 'RASCUNHO',
                    acao: 'sincronizar',
                }),
            );
        container.registerInstance(SincronizacaoLoteService, { sincronizarLote } as never);
        await comApp({}, async (url) => {
            const a = await fetch(`${url}/sispag/lotes/${ID}/sincronizar`, { method: 'POST' });
            expect(a.status).toBe(409);
            expect((await readJson(a)).code).toBe('LOTE_VERSAO_CONFLITO');
            const b = await fetch(`${url}/sispag/lotes/${ID}/sincronizar`, { method: 'POST' });
            expect(b.status).toBe(409);
            expect((await readJson(b)).code).toBe('LOTE_ESTADO_INVALIDO');
        });
    });

    it('exige sispag:executar', async () => {
        const sincronizarLote = jest.fn();
        container.registerInstance(SincronizacaoLoteService, { sincronizarLote } as never);
        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/${ID}/sincronizar`, { method: 'POST' });
            expect(res.status).toBe(403);
        });
        expect(sincronizarLote).not.toHaveBeenCalled();
    });
});

describe('POST /sispag/lotes/:id/retorno — L7 aposentada (ADR-0055)', () => {
    it('responde 410 Gone apontando para "Sincronizar agora", sem tocar o lote', async () => {
        const service = { marcarRetorno: jest.fn(), getLote: jest.fn() };
        container.registerInstance(LotePagamentoService, service as never);
        await comApp({}, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/retorno`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ versao: 1 }),
            });
            expect(res.status).toBe(410);
            expect((await readJson(res)).error).toMatch(/Sincronizar agora/);
        });
        expect(service.marcarRetorno).not.toHaveBeenCalled();
    });
});
