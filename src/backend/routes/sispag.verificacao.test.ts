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

import ConferenceRequiredError from '../domain/errors/ConferenceRequiredError.js';
import DuplicateHoldError from '../domain/errors/DuplicateHoldError.js';
import ItemsRemovedByCheckError from '../domain/errors/ItemsRemovedByCheckError.js';
import PaymentCheckPendingError from '../domain/errors/PaymentCheckPendingError.js';
import PendingDuplicateAlertError from '../domain/errors/PendingDuplicateAlertError.js';
import SelfConferenceError from '../domain/errors/SelfConferenceError.js';
import { PERMISSION, type Permission } from '../domain/interface/auth/Permission.js';
import ConferenciaLoteService from '../domain/service/sispag/ConferenciaLoteService.js';
import DuplicateResolutionService from '../domain/service/sispag/DuplicateResolutionService.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import PendenciaCadastroService from '../domain/service/sispag/PendenciaCadastroService.js';
import RemessaService from '../domain/service/sispag/RemessaService.js';
import { AcessoFixture } from '../http/__fixtures__/acesso.fixture.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import sispagRouter from './sispag.js';

/**
 * Rotas da ADR-0063 (verificação TED/PIX, duplicidade, conferência, pendências de cadastro). O ator
 * vem SEMPRE do usuário autenticado (`req.user.sub = 'bia'`), nunca do body.
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
            destinoOrigem: 'CADASTRO',
            destinoMascarado: '341 / ****-5',
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
            const body = (await res.json()) as { lote: Record<string, unknown> };
            expect(body.lote.exigeConferencia).toBe(true);
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
        await comApp([PERMISSION.SISPAG_VER, PERMISSION.SISPAG_CONFERIR], async (url) => {
            expect((await post(`${url}${URL}`, { acao: 'RETIRAR' })).status).toBe(403);
        });
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

describe('POST /sispag/lotes/:id/conferir e /devolver (L12/L13)', () => {
    it('conferir: sispag:conferir, ator do token (body ignorado)', async () => {
        const conferirLote = jest.fn().mockResolvedValue({ ...LOTE, conferidoPor: 'bia' });
        container.registerInstance(ConferenciaLoteService, { conferirLote } as never);
        await comApp([PERMISSION.SISPAG_VER, PERMISSION.SISPAG_CONFERIR], async (url) => {
            const res = await post(`${url}/sispag/lotes/${LOTE_ID}/conferir`, {
                versao: 4,
                ator: 'ana',
            });
            expect(res.status).toBe(200);
        });
        expect(conferirLote).toHaveBeenCalledWith({ loteId: LOTE_ID, versao: 4, ator: 'bia' });
    });

    it('sem sispag:conferir → 403 (mesmo com executar)', async () => {
        const conferirLote = jest.fn();
        container.registerInstance(ConferenciaLoteService, { conferirLote } as never);
        await comApp([PERMISSION.SISPAG_VER, PERMISSION.SISPAG_EXECUTAR], async (url) => {
            expect(
                (await post(`${url}/sispag/lotes/${LOTE_ID}/conferir`, { versao: 4 })).status,
            ).toBe(403);
        });
        expect(conferirLote).not.toHaveBeenCalled();
    });

    it('SelfConferenceError → 403 com mensagem em português', async () => {
        container.registerInstance(ConferenciaLoteService, {
            conferirLote: jest
                .fn()
                .mockRejectedValue(
                    new SelfConferenceError({ loteId: LOTE_ID, impedimento: 'FINALIZOU' }),
                ),
        } as never);
        await comApp(undefined, async (url) => {
            const res = await post(`${url}/sispag/lotes/${LOTE_ID}/conferir`, { versao: 4 });
            expect(res.status).toBe(403);
            expect(((await res.json()) as { error: string }).error).toMatch(/outra pessoa/);
        });
    });

    it('devolver exige motivo (400) e passa o ator do token', async () => {
        const devolverLote = jest.fn().mockResolvedValue({ ...LOTE, status: 'RASCUNHO' });
        container.registerInstance(ConferenciaLoteService, { devolverLote } as never);
        await comApp(undefined, async (url) => {
            expect(
                (await post(`${url}/sispag/lotes/${LOTE_ID}/devolver`, { versao: 4 })).status,
            ).toBe(400);
            const ok = await post(`${url}/sispag/lotes/${LOTE_ID}/devolver`, {
                versao: 4,
                motivo: 'conta diverge',
                ator: 'ana',
            });
            expect(ok.status).toBe(200);
        });
        expect(devolverLote).toHaveBeenCalledWith({
            loteId: LOTE_ID,
            versao: 4,
            motivo: 'conta diverge',
            ator: 'bia',
        });
    });
});

describe('GET /sispag/pendencias-cadastro (I13k)', () => {
    it('com sispag:cadastro → 200; sem → 403', async () => {
        const listarAbertas = jest.fn().mockResolvedValue([{ id: 'P1', pesCod: '90001' }]);
        container.registerInstance(PendenciaCadastroService, { listarAbertas } as never);
        await comApp([PERMISSION.SISPAG_CADASTRO], async (url) => {
            const res = await fetch(`${url}/sispag/pendencias-cadastro`);
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ pendencias: [{ id: 'P1', pesCod: '90001' }] });
        });
        await comApp([PERMISSION.SISPAG_VER, PERMISSION.SISPAG_EXECUTAR], async (url) => {
            expect((await fetch(`${url}/sispag/pendencias-cadastro`)).status).toBe(403);
        });
    });
});

describe('GET /sispag/lotes/:id — verificação no lote (I13l)', () => {
    it('traz alertas com justificativa, verificação, origem e máscara do destino, exigeConferencia', async () => {
        container.registerInstance(LotePagamentoService, {
            getLote: jest.fn().mockResolvedValue(LOTE),
        } as never);
        await comApp(undefined, async (url) => {
            const body = (await (await fetch(`${url}/sispag/lotes/${LOTE_ID}`)).json()) as {
                lote: { exigeConferencia: boolean; itens: Array<Record<string, unknown>> };
            };
            expect(body.lote.exigeConferencia).toBe(true);
            expect(body.lote.itens[0]).toMatchObject({
                destinoOrigem: 'CADASTRO',
                destinoMascarado: '341 / ****-5',
                alertas: [{ justificativa: 'ok' }],
            });
        });
    });
});

describe('erros da ADR-0063 → HTTP', () => {
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
            'ItemsRemovedByCheckError',
            new ItemsRemovedByCheckError({
                loteId: LOTE_ID,
                itens: [{ docCod: '1', titCod: '1' }],
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

    it('gerar remessa sem conferência (ConferenceRequiredError) → 409', async () => {
        container.registerInstance(RemessaService, {
            gerarRemessa: jest
                .fn()
                .mockRejectedValue(new ConferenceRequiredError({ loteId: LOTE_ID })),
        } as never);
        await comApp(undefined, async (url) => {
            const res = await post(`${url}/sispag/lotes/${LOTE_ID}/remessa`, {});
            expect(res.status).toBe(409);
            expect(((await res.json()) as { code: string }).code).toBe('CONFERENCIA_OBRIGATORIA');
        });
    });
});
