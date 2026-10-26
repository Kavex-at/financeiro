import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import GroupedBoletoCrossBranchError from '../domain/errors/GroupedBoletoCrossBranchError.js';
import GroupedBoletoDueWindowError from '../domain/errors/GroupedBoletoDueWindowError.js';
import GroupedBoletoIndivisibleError from '../domain/errors/GroupedBoletoIndivisibleError.js';
import GroupedBoletoNotConfirmableError from '../domain/errors/GroupedBoletoNotConfirmableError.js';
import GroupedBoletoNotFoundError from '../domain/errors/GroupedBoletoNotFoundError.js';
import GroupedBoletoStateConflictError from '../domain/errors/GroupedBoletoStateConflictError.js';
import GroupedBoletoSumMismatchError from '../domain/errors/GroupedBoletoSumMismatchError.js';
import GroupedBoletoTitleIneligibleError from '../domain/errors/GroupedBoletoTitleIneligibleError.js';
import { PERMISSION, type Permission } from '../domain/interface/auth/Permission.js';
import { MOTIVO_GRUPO_INELEGIVEL } from '../domain/interface/sispag/GrupoBoletoInterface.js';
import CodigoBarrasSintetico from '../domain/libs/boleto/CodigoBarrasSintetico.js';
import GrupoBoletoService from '../domain/service/sispag/GrupoBoletoService.js';
import LotePagamentoApiView from '../domain/service/sispag/LotePagamentoApiView.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import { AcessoFixture } from '../http/__fixtures__/acesso.fixture.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import sispagRouter from './sispag.js';

/**
 * Rotas do boleto agrupado (ADR-0077, Task 19). O ator vem SEMPRE do token (`req.user.sub = 'bia'`;
 * `ator` no body é 400); `sispag:ver` lê, `sispag:executar` confirma, anula e mexe no lote.
 * Zod em body, params e query; `filCod` passa pela allow-list de filiais; os erros nomeados
 * chegam com o status e a `userMessage` da própria classe, sem o código de barras completo.
 */

const GRUPO_ID = '00000000-0000-0000-0000-0000000000a1';
const LOTE_ID = '00000000-0000-0000-0000-0000000000b1';
const BARRAS = CodigoBarrasSintetico.barras({ valor: 1575, vencimento: '2026-10-21' });
const TITULOS = ['38883', '38884', '38885'].map((docCod) => ({
    filCod: 2,
    docCod,
    titCod: '1',
}));
const CONFIRMAR = { origem: 'SUGERIDO', ddcCod: 900, ditCod: 332841, titulos: TITULOS };
const GRUPO = {
    id: GRUPO_ID,
    filCod: 2,
    pesCod: '9001',
    ddcCod: 900,
    ditCod: 332841,
    codbarMascarado: `${BARRAS.slice(0, 5)}…${BARRAS.slice(-4)}`,
    estado: 'CONFIRMADO',
    titulos: TITULOS,
};

const buildApp = (permissoes: Permission[], filiais?: number[]): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use((req, _res, next) => {
        req.user = {
            sub: 'bia',
            email: 'bia@x.com',
            role: 'admin',
            ...(filiais !== undefined ? { filiais } : {}),
        } as typeof req.user;
        req.acesso = AcessoFixture.com(permissoes);
        next();
    });
    app.use('/sispag', sispagRouter);
    app.use(errorMiddleware);
    return app;
};

const comApp = async (
    permissoes: Permission[],
    fn: (url: string) => Promise<void>,
    filiais?: number[],
): Promise<void> => {
    const server: Server = await new Promise((resolve) => {
        const s = buildApp(permissoes, filiais).listen(0, () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise<void>((r) => server.close(() => r()));
    }
};

const enviar = (metodo: string, url: string, body?: unknown) =>
    fetch(url, {
        method: metodo,
        ...(body !== undefined
            ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
    });

const servicos = (
    over: { grupos?: Record<string, jest.Mock>; lotes?: Record<string, jest.Mock> } = {},
) => {
    const grupos = {
        sugerir: jest
            .fn()
            .mockResolvedValue([{ filCod: 2, ddcCod: 900, ditCod: 332841, confirmavel: true }]),
        listar: jest
            .fn()
            .mockResolvedValue([{ ...GRUPO, situacao: 'DISPONIVEL', orfao: { orfao: false } }]),
        confirmar: jest.fn().mockResolvedValue({ criado: true, grupo: GRUPO }),
        anular: jest.fn().mockResolvedValue({
            anulado: true,
            grupo: { ...GRUPO, estado: 'ANULADO' },
            retiradoDoLoteId: LOTE_ID,
        }),
        ...over.grupos,
    };
    const lotes = {
        incluirGrupo: jest.fn().mockResolvedValue({ lote: { id: LOTE_ID }, avisos: [] }),
        removerGrupo: jest.fn().mockResolvedValue({ id: LOTE_ID }),
        ...over.lotes,
    };
    container.registerInstance(GrupoBoletoService, grupos as never);
    container.registerInstance(LotePagamentoService, lotes as never);
    container.registerInstance(LotePagamentoApiView, { lote: (l: unknown) => l } as never);
    return { grupos, lotes };
};

afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
});

const VER = [PERMISSION.SISPAG_VER];
const VER_EXECUTAR = [PERMISSION.SISPAG_VER, PERMISSION.SISPAG_EXECUTAR];
const NENHUMA: Permission[] = [PERMISSION.PERMUTAS_VER];

describe('matriz de permissão do boleto agrupado', () => {
    const leituras: Array<[string, string]> = [
        ['GET sugestões de grupo', '/sispag/grupos-boleto/sugestoes?filCod=2'],
        ['GET grupos', '/sispag/grupos-boleto?filCod=2'],
    ];
    const escritas: Array<[string, string, string, unknown]> = [
        ['POST confirmar', 'POST', '/sispag/grupos-boleto/confirmar', CONFIRMAR],
        [
            'POST anular',
            'POST',
            `/sispag/grupos-boleto/${GRUPO_ID}/anular`,
            { motivo: 'boleto pago por fora' },
        ],
        ['POST incluir no lote', 'POST', `/sispag/lotes/${LOTE_ID}/grupos`, { grupoId: GRUPO_ID }],
        [
            'DELETE retirar do lote',
            'DELETE',
            `/sispag/lotes/${LOTE_ID}/grupos/${GRUPO_ID}`,
            undefined,
        ],
    ];

    it.each(leituras)('%s: sispag:ver lê (200); sem sispag:* é 403', async (_n, rota) => {
        servicos();
        await comApp(VER, async (url) => {
            expect((await fetch(`${url}${rota}`)).status).toBe(200);
        });
        await comApp(NENHUMA, async (url) => {
            expect((await fetch(`${url}${rota}`)).status).toBe(403);
        });
    });

    it.each(
        escritas,
    )('%s: sispag:ver NÃO consegue (403, serviço intocado); sem sispag:* é 403; executar passa', async (_n, metodo, rota, body) => {
        const s = servicos();
        await comApp(VER, async (url) => {
            expect((await enviar(metodo, `${url}${rota}`, body)).status).toBe(403);
        });
        await comApp(NENHUMA, async (url) => {
            expect((await enviar(metodo, `${url}${rota}`, body)).status).toBe(403);
        });
        for (const fn of [
            s.grupos.confirmar,
            s.grupos.anular,
            s.lotes.incluirGrupo,
            s.lotes.removerGrupo,
        ]) {
            expect(fn).not.toHaveBeenCalled();
        }
        await comApp(VER_EXECUTAR, async (url) => {
            expect([200, 201]).toContain((await enviar(metodo, `${url}${rota}`, body)).status);
        });
    });
});

describe('GET /sispag/grupos-boleto/sugestoes e GET /sispag/grupos-boleto', () => {
    it('repassa o filCod validado; sem filCod lista tudo; filCod inválido é 400 e o serviço fica intocado', async () => {
        const s = servicos();
        await comApp(VER, async (url) => {
            const res = await fetch(`${url}/sispag/grupos-boleto/sugestoes?filCod=2`);
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ sugestoes: [{ ddcCod: 900 }] });
            expect((await fetch(`${url}/sispag/grupos-boleto/sugestoes`)).status).toBe(200);
            expect((await fetch(`${url}/sispag/grupos-boleto/sugestoes?filCod=abc`)).status).toBe(
                400,
            );
            expect((await fetch(`${url}/sispag/grupos-boleto?filCod=-1`)).status).toBe(400);
        });
        expect(s.grupos.sugerir).toHaveBeenNthCalledWith(1, { filCod: 2 });
        expect(s.grupos.sugerir).toHaveBeenNthCalledWith(2, {});
        expect(s.grupos.sugerir).toHaveBeenCalledTimes(2);
        expect(s.grupos.listar).not.toHaveBeenCalled();
    });

    it('a listagem devolve a situação derivada e o órfão de cada grupo, sem código completo', async () => {
        const s = servicos();
        await comApp(VER, async (url) => {
            const res = await fetch(`${url}/sispag/grupos-boleto?filCod=2`);
            const corpo = (await res.json()) as { grupos: unknown[] };
            expect(corpo.grupos[0]).toMatchObject({
                situacao: 'DISPONIVEL',
                orfao: { orfao: false },
            });
            expect(JSON.stringify(corpo)).not.toMatch(/\d{44}|\d{47}/);
        });
        expect(s.grupos.listar).toHaveBeenCalledWith({ filCod: 2 });
    });
});

describe('allow-list de filiais (filialAuthz)', () => {
    it('GET: filial fora da allow-list do usuário é 403 e o serviço fica intocado; dentro passa', async () => {
        const s = servicos();
        await comApp(
            VER,
            async (url) => {
                const fora = await fetch(`${url}/sispag/grupos-boleto/sugestoes?filCod=2`);
                expect(fora.status).toBe(403);
                expect(await fora.json()).toMatchObject({ code: 'FILIAL_NAO_AUTORIZADA' });
                expect((await fetch(`${url}/sispag/grupos-boleto?filCod=2`)).status).toBe(403);
                expect((await fetch(`${url}/sispag/grupos-boleto/sugestoes?filCod=3`)).status).toBe(
                    200,
                );
            },
            [3],
        );
        expect(s.grupos.sugerir).toHaveBeenCalledTimes(1);
        expect(s.grupos.listar).not.toHaveBeenCalled();
    });

    it('POST confirmar: título de filial fora da allow-list é 403 e nada é confirmado', async () => {
        const s = servicos();
        await comApp(
            VER_EXECUTAR,
            async (url) => {
                const r = await enviar('POST', `${url}/sispag/grupos-boleto/confirmar`, CONFIRMAR);
                expect(r.status).toBe(403);
            },
            [3],
        );
        expect(s.grupos.confirmar).not.toHaveBeenCalled();
    });

    it('sem allow-list provisionada o comportamento é o de hoje (permitido)', async () => {
        servicos();
        await comApp(VER, async (url) => {
            expect((await fetch(`${url}/sispag/grupos-boleto?filCod=2`)).status).toBe(200);
        });
    });
});

describe('POST /sispag/grupos-boleto/confirmar', () => {
    it('201 grupo novo · 200 já confirmado (idempotente); o ator é o do token; avisos reconhecidos seguem', async () => {
        const s = servicos();
        await comApp(VER_EXECUTAR, async (url) => {
            const novo = await enviar('POST', `${url}/sispag/grupos-boleto/confirmar`, {
                ...CONFIRMAR,
                reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
            });
            expect(novo.status).toBe(201);
            expect(await novo.json()).toMatchObject({ criado: true, grupo: { id: GRUPO_ID } });
            s.grupos.confirmar.mockResolvedValueOnce({ criado: false, grupo: GRUPO });
            const igual = await enviar('POST', `${url}/sispag/grupos-boleto/confirmar`, CONFIRMAR);
            expect(igual.status).toBe(200);
        });
        expect(s.grupos.confirmar).toHaveBeenNthCalledWith(1, {
            ...CONFIRMAR,
            reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
            ator: 'bia',
        });
    });

    it.each([
        ['"ator" no body (o ator é sempre o do token)', { ...CONFIRMAR, ator: 'eve' }],
        ['um título só', { ...CONFIRMAR, titulos: [TITULOS[0]] }],
        ['origem desconhecida', { ...CONFIRMAR, origem: 'ROBO' }],
        ['campo desconhecido', { ...CONFIRMAR, confiavel: true }],
        ['título sem docCod', { ...CONFIRMAR, titulos: [{ filCod: 2, titCod: '1' }, TITULOS[1]] }],
        ['ddcCod não numérico', { ...CONFIRMAR, ddcCod: 'x' }],
    ])('body inválido (%s) ⇒ 400 e o serviço fica intocado', async (_n, body) => {
        const s = servicos();
        await comApp(VER_EXECUTAR, async (url) => {
            const r = await enviar('POST', `${url}/sispag/grupos-boleto/confirmar`, body);
            expect(r.status).toBe(400);
        });
        expect(s.grupos.confirmar).not.toHaveBeenCalled();
    });
});

describe('POST /sispag/grupos-boleto/:id/anular', () => {
    it('200 com o grupo anulado, o lote de onde saiu e o ator do token', async () => {
        const s = servicos();
        await comApp(VER_EXECUTAR, async (url) => {
            const r = await enviar('POST', `${url}/sispag/grupos-boleto/${GRUPO_ID}/anular`, {
                motivo: 'boleto pago por fora do sistema',
            });
            expect(r.status).toBe(200);
            expect(await r.json()).toMatchObject({ anulado: true, retiradoDoLoteId: LOTE_ID });
        });
        expect(s.grupos.anular).toHaveBeenCalledWith({
            grupoId: GRUPO_ID,
            motivo: 'boleto pago por fora do sistema',
            ator: 'bia',
        });
    });

    it.each([
        ['motivo com menos de 10 caracteres', GRUPO_ID, { motivo: 'curto' }],
        ['motivo com mais de 500 caracteres', GRUPO_ID, { motivo: 'x'.repeat(501) }],
        ['motivo ausente', GRUPO_ID, {}],
        ['id que não é UUID', 'nao-e-uuid', { motivo: 'motivo suficientemente longo' }],
        ['"ator" no body', GRUPO_ID, { motivo: 'motivo suficientemente longo', ator: 'eve' }],
    ])('%s ⇒ 400 e o serviço fica intocado', async (_n, id, body) => {
        const s = servicos();
        await comApp(VER_EXECUTAR, async (url) => {
            const r = await enviar('POST', `${url}/sispag/grupos-boleto/${id}/anular`, body);
            expect(r.status).toBe(400);
        });
        expect(s.grupos.anular).not.toHaveBeenCalled();
    });
});

describe('POST /sispag/lotes/:id/grupos e DELETE /sispag/lotes/:id/grupos/:grupoId', () => {
    it('incluir: repassa grupo, mover, versão e o ator do token; devolve o lote e os avisos', async () => {
        const s = servicos({
            lotes: {
                incluirGrupo: jest.fn().mockResolvedValue({
                    lote: { id: LOTE_ID },
                    avisos: [{ tipo: 'BORDERO_ANTERIOR', mensagem: 'resolva o borderô antigo' }],
                }),
            },
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const r = await enviar('POST', `${url}/sispag/lotes/${LOTE_ID}/grupos`, {
                grupoId: GRUPO_ID,
                mover: true,
                versaoEsperada: 4,
            });
            expect(r.status).toBe(200);
            expect(await r.json()).toMatchObject({
                lote: { id: LOTE_ID },
                avisos: [{ tipo: 'BORDERO_ANTERIOR' }],
            });
        });
        expect(s.lotes.incluirGrupo).toHaveBeenCalledWith({
            loteId: LOTE_ID,
            grupoId: GRUPO_ID,
            mover: true,
            versaoEsperada: 4,
            ator: 'bia',
        });
    });

    it('incluir sem mover nem versão: só grupo, lote e ator', async () => {
        const s = servicos();
        await comApp(VER_EXECUTAR, async (url) => {
            await enviar('POST', `${url}/sispag/lotes/${LOTE_ID}/grupos`, { grupoId: GRUPO_ID });
        });
        expect(s.lotes.incluirGrupo).toHaveBeenCalledWith({
            loteId: LOTE_ID,
            grupoId: GRUPO_ID,
            ator: 'bia',
        });
    });

    it.each([
        ['grupoId que não é UUID', { grupoId: 'x' }],
        ['grupoId ausente', {}],
        ['"ator" no body', { grupoId: GRUPO_ID, ator: 'eve' }],
        ['mover que não é booleano', { grupoId: GRUPO_ID, mover: 'sim' }],
    ])('incluir com %s ⇒ 400 e o serviço fica intocado', async (_n, body) => {
        const s = servicos();
        await comApp(VER_EXECUTAR, async (url) => {
            const r = await enviar('POST', `${url}/sispag/lotes/${LOTE_ID}/grupos`, body);
            expect(r.status).toBe(400);
        });
        expect(s.lotes.incluirGrupo).not.toHaveBeenCalled();
    });

    it('retirar: repassa lote, grupo, versão (query) e o ator do token', async () => {
        const s = servicos();
        await comApp(VER_EXECUTAR, async (url) => {
            const r = await enviar(
                'DELETE',
                `${url}/sispag/lotes/${LOTE_ID}/grupos/${GRUPO_ID}?versaoEsperada=3`,
            );
            expect(r.status).toBe(200);
            expect(await r.json()).toMatchObject({ lote: { id: LOTE_ID } });
        });
        expect(s.lotes.removerGrupo).toHaveBeenCalledWith({
            loteId: LOTE_ID,
            grupoId: GRUPO_ID,
            versaoEsperada: 3,
            ator: 'bia',
        });
    });

    it('retirar com grupoId inválido ou versão inválida ⇒ 400', async () => {
        const s = servicos();
        await comApp(VER_EXECUTAR, async (url) => {
            expect((await enviar('DELETE', `${url}/sispag/lotes/${LOTE_ID}/grupos/x`)).status).toBe(
                400,
            );
            expect(
                (
                    await enviar(
                        'DELETE',
                        `${url}/sispag/lotes/${LOTE_ID}/grupos/${GRUPO_ID}?versaoEsperada=abc`,
                    )
                ).status,
            ).toBe(400);
        });
        expect(s.lotes.removerGrupo).not.toHaveBeenCalled();
    });
});

describe('erros nomeados chegam com o status e a userMessage da classe', () => {
    const erros = {
        soma: () =>
            new GroupedBoletoSumMismatchError({
                filCod: 2,
                ddcCod: 900,
                ditCod: 332841,
                codigoMascarado: BARRAS,
                valorBoletoCentavos: 157501,
                somaTitulosCentavos: 157500,
            }),
        titulo: () =>
            new GroupedBoletoTitleIneligibleError({
                titulos: [
                    {
                        filCod: 2,
                        docCod: '38884',
                        titCod: '1',
                        motivo: MOTIVO_GRUPO_INELEGIVEL.NAO_LIBERADO,
                    },
                ],
            }),
        filial: () =>
            new GroupedBoletoCrossBranchError({ filiais: [4, 2], ddcCod: 900, ditCod: 332841 }),
        janela: () =>
            new GroupedBoletoDueWindowError({
                vencimentoBoleto: '2026-10-26',
                titulos: [
                    {
                        filCod: 2,
                        docCod: '501',
                        titCod: '1',
                        vencimento: '2026-10-15',
                        deltaDias: 11,
                    },
                ],
            }),
        naoConfirmavel: () =>
            new GroupedBoletoNotConfirmableError({
                ddcCod: 900,
                ditCod: 332841,
                codigoMascarado: BARRAS,
                motivos: [MOTIVO_GRUPO_INELEGIVEL.CREDORES_DIFERENTES],
            }),
        ausente: () => new GroupedBoletoNotFoundError({ grupoId: GRUPO_ID }),
        estado: () =>
            new GroupedBoletoStateConflictError({
                grupoId: GRUPO_ID,
                estado: 'PAGO',
                acao: 'anular',
            }),
        indivisivel: () =>
            new GroupedBoletoIndivisibleError({
                grupoId: GRUPO_ID,
                codigoMascarado: BARRAS,
                titulos: TITULOS,
            }),
    };

    const chamadas: Array<[string, keyof typeof erros, string, string, unknown]> = [
        ['confirmar / soma', 'soma', 'POST', '/sispag/grupos-boleto/confirmar', CONFIRMAR],
        ['confirmar / título', 'titulo', 'POST', '/sispag/grupos-boleto/confirmar', CONFIRMAR],
        ['confirmar / filial', 'filial', 'POST', '/sispag/grupos-boleto/confirmar', CONFIRMAR],
        ['confirmar / janela', 'janela', 'POST', '/sispag/grupos-boleto/confirmar', CONFIRMAR],
        [
            'confirmar / não confirmável',
            'naoConfirmavel',
            'POST',
            '/sispag/grupos-boleto/confirmar',
            CONFIRMAR,
        ],
        [
            'anular / ausente',
            'ausente',
            'POST',
            `/sispag/grupos-boleto/${GRUPO_ID}/anular`,
            { motivo: 'motivo suficientemente longo' },
        ],
        [
            'anular / estado',
            'estado',
            'POST',
            `/sispag/grupos-boleto/${GRUPO_ID}/anular`,
            { motivo: 'motivo suficientemente longo' },
        ],
        [
            'incluir / indivisível',
            'indivisivel',
            'POST',
            `/sispag/lotes/${LOTE_ID}/grupos`,
            { grupoId: GRUPO_ID },
        ],
        [
            'retirar / indivisível',
            'indivisivel',
            'DELETE',
            `/sispag/lotes/${LOTE_ID}/grupos/${GRUPO_ID}`,
            undefined,
        ],
    ];

    it.each(chamadas)('%s', async (_n, qual, metodo, rota, body) => {
        const erro = erros[qual]();
        servicos({
            grupos: {
                confirmar: jest.fn().mockRejectedValue(erro),
                anular: jest.fn().mockRejectedValue(erro),
            },
            lotes: {
                incluirGrupo: jest.fn().mockRejectedValue(erro),
                removerGrupo: jest.fn().mockRejectedValue(erro),
            },
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await enviar(metodo, `${url}${rota}`, body);
            expect(res.status).toBe(erro.statusCode);
            const corpo = await res.json();
            expect(corpo).toMatchObject({ code: erro.code, error: erro.userMessage });
            expect(JSON.stringify(corpo)).not.toMatch(/\d{44}|\d{47}/);
        });
    });
});
