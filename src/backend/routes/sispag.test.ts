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
import ErpPerguntaError from '../domain/errors/ErpPerguntaError.js';
import RemessaEmDuvidaError from '../domain/errors/RemessaEmDuvidaError.js';
import PagamentoIngestaoRunRepository from '../domain/repository/sispag/PagamentoIngestaoRunRepository.js';
import ConciliacaoRetornoService from '../domain/service/sispag/ConciliacaoRetornoService.js';
import FormacaoLotesService from '../domain/service/sispag/FormacaoLotesService.js';
import IngestaoPagamentosService from '../domain/service/sispag/IngestaoPagamentosService.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';
import SispagPainelService from '../domain/service/sispag/SispagPainelService.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import sispagRouter from './sispag.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const readJson = async (res: Response): Promise<Record<string, any>> =>
    (await res.json()) as Record<string, any>;

/**
 * Auth falsa. NOTA: hoje todo usuário nasce `admin` (`app_user.role DEFAULT 'admin'`,
 * decisão explícita do produto), então na prática o `requireRole('admin')` não separa
 * ninguém em produção. Estes testes exercitam o gate mesmo assim — ele é o que vai valer
 * no dia em que existir um papel `viewer`, e uma remoção acidental precisa quebrar algo.
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
        const montarPainel = jest.fn().mockResolvedValue({ titulos: [], titulosTotal: 0, kpis: {} });
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
    it('exige role admin — é conta corrente da empresa', async () => {
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

    it('exige role admin', async () => {
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

    it('exige role admin', async () => {
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

    it('exige role admin', async () => {
        container.registerInstance(RemessaService, { gerarRemessa: jest.fn() } as never);

        await comApp({ role: 'viewer' }, async (url) => {
            const res = await fetch(`${url}/sispag/lotes/L1/remessa`, { method: 'POST' });
            expect(res.status).toBe(403);
        });
    });
});

describe('GET /sispag/lotes/:id/remessa/arquivo', () => {
    it('exige role admin — o CNAB traz banco/agência/conta de cada fornecedor', async () => {
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

    it('exige role admin', async () => {
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
