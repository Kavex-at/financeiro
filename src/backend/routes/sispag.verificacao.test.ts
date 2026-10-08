import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));
// O limiter é estado por IP compartilhado entre testes; aqui o alvo é o handler.
jest.mock('../http/rateLimit.js', () => ({
    ...jest.requireActual('../http/rateLimit.js'),
    heavyRouteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import BatchEmptiedByCheckError from '../domain/errors/BatchEmptiedByCheckError.js';
import DuplicateHoldError from '../domain/errors/DuplicateHoldError.js';
import PayeeNotAuthorizedAtRemittanceError from '../domain/errors/PayeeNotAuthorizedAtRemittanceError.js';
import PaymentCheckPendingError from '../domain/errors/PaymentCheckPendingError.js';
import PaymentModalityUnavailableError from '../domain/errors/PaymentModalityUnavailableError.js';
import PendingDuplicateAlertError from '../domain/errors/PendingDuplicateAlertError.js';
import { PERMISSION, type Permission } from '../domain/interface/auth/Permission.js';
import DuplicateResolutionService from '../domain/service/sispag/DuplicateResolutionService.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';
import { AcessoFixture } from '../http/__fixtures__/acesso.fixture.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import sispagRouter from './sispag.js';

/**
 * Rotas da ADR-0063/0065 (verificação TED/PIX, duplicidade, retiradas no finalizar, guarda da
 * remessa). O ator vem SEMPRE do usuário autenticado (`req.user.sub = 'bia'`), nunca do body.
 */

const LOTE_ID = '00000000-0000-0000-0000-000000000063';
const ALERTA_ID = '00000000-0000-0000-0000-0000000000a1';
const LOTE = {
    id: LOTE_ID,
    filCod: 4,
    status: 'FINALIZADO',
    criadoPor: 'cron',
    versao: 4,
    itens: [
        {
            loteId: LOTE_ID,
            filCod: 4,
            docCod: '6173',
            titCod: '1',
            modalidade: 'TED',
            incluidoPor: 'cron',
            divergencia: false,
            destinoMascarado: 'banco 341 · ag. 0641 · cc ****7766-5',
            autorizacaoAviso: 'OK',
            alertas: [{ id: ALERTA_ID, tipo: 'DUPLICIDADE_FORTE', justificativa: 'ok' }],
        },
    ],
};

const buildApp = (permissoes?: Permission[]): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use((req, _res, next) => {
        req.user = { sub: 'bia', email: 'bia@x.com', role: 'admin' };
        req.acesso = permissoes ? AcessoFixture.com(permissoes) : AcessoFixture.administrador();
        next();
    });
    app.use('/sispag', sispagRouter);
    app.use(errorMiddleware);
    return app;
};

const comApp = async (
    permissoes: Permission[] | undefined,
    fn: (url: string) => Promise<void>,
): Promise<void> => {
    const server: Server = await new Promise((resolve) => {
        const s = buildApp(permissoes).listen(0, () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise<void>((r) => server.close(() => r()));
    }
};

const post = (url: string, body: unknown) =>
    fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
});

describe('POST /sispag/lotes/:id/itens/:chave/alertas/:alertaId/resolucao (I13f)', () => {
    const URL = `/sispag/lotes/${LOTE_ID}/itens/4/6173/1/alertas/${ALERTA_ID}/resolucao`;

    it('JUSTIFICAR com texto: ator do token, nunca do body', async () => {
        const resolverAlertaDuplicidade = jest.fn().mockResolvedValue(LOTE);
        container.registerInstance(DuplicateResolutionService, {
            resolverAlertaDuplicidade,
        } as never);
        await comApp(undefined, async (url) => {
            const res = await post(`${url}${URL}`, {
                acao: 'JUSTIFICAR',
                justificativa: 'NF de serviço',
                ator: 'outra-pessoa',
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as { lote: { id: string } };
            expect(body.lote.id).toBe(LOTE_ID);
        });
        expect(resolverAlertaDuplicidade).toHaveBeenCalledWith({
            loteId: LOTE_ID,
            chave: { filCod: 4, docCod: '6173', titCod: '1' },
            alertaId: ALERTA_ID,
            acao: 'JUSTIFICAR',
            justificativa: 'NF de serviço',
            ator: 'bia',
        });
    });

    it.each([
        ['JUSTIFICAR sem texto', { acao: 'JUSTIFICAR', justificativa: '  ' }],
        ['ação desconhecida', { acao: 'APAGAR' }],
    ])('%s → 400', async (_n, body) => {
        const resolverAlertaDuplicidade = jest.fn();
        container.registerInstance(DuplicateResolutionService, {
            resolverAlertaDuplicidade,
        } as never);
        await comApp(undefined, async (url) => {
            expect((await post(`${url}${URL}`, body)).status).toBe(400);
        });
        expect(resolverAlertaDuplicidade).not.toHaveBeenCalled();
    });

    it('exige sispag:executar', async () => {
        await comApp(
            [PERMISSION.SISPAG_VER, PERMISSION.SISPAG_AUTORIZAR_FAVORECIDO],
            async (url) => {
                expect((await post(`${url}${URL}`, { acao: 'RETIRAR' })).status).toBe(403);
            },
        );
    });
});

describe('POST /sispag/titulos/:chave/bloqueio-duplicidade/desfazer (I13g)', () => {
    const URL = '/sispag/titulos/4/6702/1/bloqueio-duplicidade/desfazer';

    it('com motivo → 200; sem motivo → 400', async () => {
        const desfazerBloqueio = jest.fn().mockResolvedValue({ id: 'B1', estado: 'DESFEITO' });
        container.registerInstance(DuplicateResolutionService, { desfazerBloqueio } as never);
        await comApp(undefined, async (url) => {
            expect((await post(`${url}${URL}`, { motivo: 'cancelado o 6173' })).status).toBe(200);
            expect((await post(`${url}${URL}`, { motivo: ' ' })).status).toBe(400);
        });
        expect(desfazerBloqueio).toHaveBeenCalledTimes(1);
        expect(desfazerBloqueio).toHaveBeenCalledWith({
            chave: { filCod: 4, docCod: '6702', titCod: '1' },
            motivo: 'cancelado o 6173',
            ator: 'bia',
        });
    });
});

describe('POST /sispag/lotes/:id/finalizar — retira e finaliza (ADR-0065 L3)', () => {
    it('200 com o lote e a lista de retirados (motivo, sem destino)', async () => {
        const retirados = [
            {
                filCod: 4,
                docCod: '6174',
                titCod: '1',
                credor: 'ACME',
                modalidade: 'TED',
                motivo: 'FAVORECIDO_NAO_AUTORIZADO',
            },
        ];
        const finalizarLote = jest.fn().mockResolvedValue({ lote: LOTE, retirados });
        container.registerInstance(LotePagamentoService, { finalizarLote } as never);
        await comApp(undefined, async (url) => {
            const res = await post(`${url}/sispag/lotes/${LOTE_ID}/finalizar`, {
                versao: 4,
                ator: 'outra',
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as { lote: { id: string }; retirados: unknown };
            expect(body.lote.id).toBe(LOTE_ID);
            expect(body.retirados).toEqual(retirados);
        });
        expect(finalizarLote).toHaveBeenCalledWith({ loteId: LOTE_ID, versao: 4, ator: 'bia' });
    });

    it('as rotas de conferência e de pendências não existem mais', async () => {
        await comApp(undefined, async (url) => {
            for (const rota of ['conferir', 'devolver']) {
                const res = await post(`${url}/sispag/lotes/${LOTE_ID}/${rota}`, { versao: 1 });
                expect(res.status).toBe(404);
            }
            expect((await fetch(`${url}/sispag/pendencias-cadastro`)).status).toBe(404);
            expect((await fetch(`${url}/sispag/excecoes`)).status).toBe(404);
        });
    });
});

describe('GET /sispag/lotes/:id — verificação no lote (I13, I14)', () => {
    it('traz alertas com justificativa, a máscara do destino e o selo do favorecido autorizado', async () => {
        container.registerInstance(LotePagamentoService, {
            getLote: jest.fn().mockResolvedValue(LOTE),
        } as never);
        await comApp(undefined, async (url) => {
            const body = (await (await fetch(`${url}/sispag/lotes/${LOTE_ID}`)).json()) as {
                lote: Record<string, unknown> & { itens: Array<Record<string, unknown>> };
            };
            expect(body.lote.itens[0]).toMatchObject({
                destinoMascarado: 'banco 341 · ag. 0641 · cc ****7766-5',
                autorizacaoAviso: 'OK',
                alertas: [{ justificativa: 'ok' }],
            });
        });
    });
});

describe('erros da ADR-0063/0065 → HTTP', () => {
    it.each([
        [
            'PaymentCheckPendingError',
            new PaymentCheckPendingError({
                loteId: LOTE_ID,
                itens: [{ docCod: '1', titCod: '1' }],
            }),
        ],
        [
            'PendingDuplicateAlertError',
            new PendingDuplicateAlertError({ loteId: LOTE_ID, itens: [] }),
        ],
        [
            'BatchEmptiedByCheckError',
            new BatchEmptiedByCheckError({
                loteId: LOTE_ID,
                itens: [{ docCod: '1', titCod: '1', motivo: 'SEM_DADO_PAGAMENTO' }],
            }),
        ],
    ])('finalizar com %s → 409', async (_n, erro) => {
        container.registerInstance(LotePagamentoService, {
            finalizarLote: jest.fn().mockRejectedValue(erro),
        } as never);
        await comApp(undefined, async (url) => {
            const res = await post(`${url}/sispag/lotes/${LOTE_ID}/finalizar`, { versao: 1 });
            expect(res.status).toBe(409);
            expect(((await res.json()) as { code: string }).code).toBe(erro.code);
        });
    });

    it('incluir título bloqueado (DuplicateHoldError) → 409', async () => {
        container.registerInstance(LotePagamentoService, {
            incluirTitulo: jest
                .fn()
                .mockRejectedValue(
                    new DuplicateHoldError({ filCod: 4, docCod: '6702', titCod: '1' }),
                ),
        } as never);
        await comApp(undefined, async (url) => {
            const res = await post(`${url}/sispag/lotes/${LOTE_ID}/itens`, {
                filCod: 4,
                docCod: '6702',
                titCod: '1',
            });
            expect(res.status).toBe(409);
        });
    });

    it('gerar remessa com favorecido não autorizado → 409 com a lista por item', async () => {
        container.registerInstance(RemessaService, {
            gerarRemessa: jest.fn().mockRejectedValue(
                new PayeeNotAuthorizedAtRemittanceError({
                    loteId: LOTE_ID,
                    itens: [{ docCod: '6173', titCod: '1', motivo: 'DESTINO_ALTERADO' }],
                }),
            ),
        } as never);
        await comApp(undefined, async (url) => {
            const res = await post(`${url}/sispag/lotes/${LOTE_ID}/remessa`, {});
            expect(res.status).toBe(409);
            const body = (await res.json()) as { code: string; details: unknown };
            expect(body.code).toBe('FAVORECIDO_NAO_AUTORIZADO_NA_REMESSA');
            expect(body.details).toEqual({
                loteId: LOTE_ID,
                itens: [{ item: '6173/1', motivo: 'DESTINO_ALTERADO' }],
            });
        });
    });

    it('TED/PIX com a guarda desligada → 422 na troca de modalidade', async () => {
        container.registerInstance(LotePagamentoService, {
            atualizarModalidadeItem: jest
                .fn()
                .mockRejectedValue(
                    new PaymentModalityUnavailableError({ loteId: LOTE_ID, modalidade: 'TED' }),
                ),
        } as never);
        await comApp(undefined, async (url) => {
            const res = await post(`${url}/sispag/lotes/${LOTE_ID}/itens/4/6173/1/modalidade`, {
                versao: 1,
                modalidade: 'TED',
            });
            expect(res.status).toBe(422);
        });
    });
});
