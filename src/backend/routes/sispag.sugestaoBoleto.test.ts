import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import BoletoAlreadySuggestedToOtherTitleError from '../domain/errors/BoletoAlreadySuggestedToOtherTitleError.js';
import BoletoSuggestionNotAvailableError from '../domain/errors/BoletoSuggestionNotAvailableError.js';
import IssuerConfirmationNotFoundError from '../domain/errors/IssuerConfirmationNotFoundError.js';
import IssuerConfirmationReasonRequiredError from '../domain/errors/IssuerConfirmationReasonRequiredError.js';
import LineCopyAuditFailedError from '../domain/errors/LineCopyAuditFailedError.js';
import OverdueBoletoNotConfirmableError from '../domain/errors/OverdueBoletoNotConfirmableError.js';
import { PERMISSION, type Permission } from '../domain/interface/auth/Permission.js';
import BoletoSuggestionService from '../domain/service/sispag/BoletoSuggestionService.js';
import { AcessoFixture } from '../http/__fixtures__/acesso.fixture.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import sispagRouter from './sispag.js';

/**
 * Rotas da sugestão de boleto (ADR-0068, I15). O ator vem SEMPRE do token (`req.user.sub = 'bia'`);
 * `sispag:ver` lê e copia a linha digitável (toda cópia auditada, fail-closed); `sispag:executar`
 * confirma, rejeita e revoga.
 */

const ID = '00000000-0000-0000-0000-000000000068';
const CHAVE = { filCod: 2, docCod: '9001', titCod: '1', ddcCod: 10, ditCod: 3 };
const LINHA = '23790265609000000712800927406000148153300000000';

const DECISAO = {
    id: 'dec-1',
    filCod: 2,
    docCod: '9001',
    titCod: '1',
    pesCod: '7001',
    ddcCod: 10,
    ditCod: 3,
    codbarMascarado: '237…1533',
    decisao: 'CONFIRMADA',
    tier: 'FORTE',
    emissorChave: '237:2656:0092740',
    decididoPor: 'bia',
};

const buildApp = (permissoes: Permission[]): express.Express => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.use((req, _res, next) => {
        req.user = { sub: 'bia', email: 'bia@x.com', role: 'admin' };
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

const servico = (over: Record<string, jest.Mock> = {}) => {
    const s = {
        listarSugestoes: jest.fn().mockResolvedValue({
            sugestoes: [{ docCod: '9001', confirmavel: true }],
            total: 1,
            pagina: 1,
            tamanho: 50,
            contagem: {},
        }),
        listarConfirmacoes: jest
            .fn()
            .mockResolvedValue([{ id: ID, emissorMascarado: '237 / 2656 / ***2740' }]),
        confirmar: jest.fn().mockResolvedValue({ criada: true, decisao: DECISAO }),
        rejeitar: jest
            .fn()
            .mockResolvedValue({ criada: true, decisao: { ...DECISAO, decisao: 'REJEITADA' } }),
        revogarPar: jest.fn().mockResolvedValue({ id: ID, estado: 'REVOGADA' }),
        copiarLinha: jest.fn().mockResolvedValue({ linhaDigitavel: LINHA }),
        ...over,
    };
    container.registerInstance(BoletoSuggestionService, s as never);
    return s;
};

afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
});

const VER = [PERMISSION.SISPAG_VER];
const VER_EXECUTAR = [PERMISSION.SISPAG_VER, PERMISSION.SISPAG_EXECUTAR];
const NENHUMA: Permission[] = [PERMISSION.PERMUTAS_VER];

describe('matriz de permissão da sugestão de boleto (ADR-0053/0068)', () => {
    const leituras: Array<[string, string]> = [
        ['GET sugestões', '/sispag/sugestoes-boleto'],
        ['GET confirmações de emissor', '/sispag/confirmacoes-emissor'],
    ];
    const escritas: Array<[string, string, unknown]> = [
        ['POST confirmar', '/sispag/sugestoes-boleto/confirmar', CHAVE],
        [
            'POST rejeitar',
            '/sispag/sugestoes-boleto/rejeitar',
            { ...CHAVE, motivo: 'outro credor' },
        ],
        ['POST revogar', `/sispag/confirmacoes-emissor/${ID}/revogar`, { motivo: 'conta trocada' }],
    ];

    it.each(leituras)('%s: sispag:ver lê (200); sem sispag:* é 403', async (_n, rota) => {
        servico();
        await comApp(VER, async (url) => {
            expect((await fetch(`${url}${rota}`)).status).toBe(200);
        });
        await comApp(NENHUMA, async (url) => {
            expect((await fetch(`${url}${rota}`)).status).toBe(403);
        });
    });

    it.each(
        escritas,
    )('%s: sispag:ver NÃO consegue (403, serviço intocado); sem sispag:* é 403; executar passa', async (_n, rota, body) => {
        const s = servico();
        await comApp(VER, async (url) => {
            expect((await post(`${url}${rota}`, body)).status).toBe(403);
        });
        await comApp(NENHUMA, async (url) => {
            expect((await post(`${url}${rota}`, body)).status).toBe(403);
        });
        expect(s.confirmar).not.toHaveBeenCalled();
        expect(s.rejeitar).not.toHaveBeenCalled();
        expect(s.revogarPar).not.toHaveBeenCalled();
        await comApp(VER_EXECUTAR, async (url) => {
            expect([200, 201]).toContain((await post(`${url}${rota}`, body)).status);
        });
    });

    it('o catálogo não ganhou permissão nova: as rotas usam sispag:ver e sispag:executar', () => {
        expect(PERMISSION.SISPAG_VER).toBe('sispag:ver');
        expect(PERMISSION.SISPAG_EXECUTAR).toBe('sispag:executar');
    });
});

describe('GET /sispag/sugestoes-boleto', () => {
    it('repassa os filtros validados e a paginação; sem linha digitável nem barras na resposta', async () => {
        const s = servico();
        await comApp(VER, async (url) => {
            const res = await fetch(
                `${url}/sispag/sugestoes-boleto?filCod=2&pesCod=7001&tier=FORTE&pagina=2&tamanho=10`,
            );
            expect(res.status).toBe(200);
            const corpo = JSON.stringify(await res.json());
            expect(corpo).not.toMatch(/\d{30,}/);
        });
        expect(s.listarSugestoes).toHaveBeenCalledWith({
            filCod: 2,
            pesCod: '7001',
            tier: 'FORTE',
            pagina: 2,
            tamanho: 10,
        });
    });

    it('defaults de paginação; query inválida → 400', async () => {
        const s = servico();
        await comApp(VER, async (url) => {
            expect((await fetch(`${url}/sispag/sugestoes-boleto`)).status).toBe(200);
            expect((await fetch(`${url}/sispag/sugestoes-boleto?tier=XYZ`)).status).toBe(400);
            expect((await fetch(`${url}/sispag/sugestoes-boleto?tamanho=1000`)).status).toBe(400);
        });
        expect(s.listarSugestoes).toHaveBeenCalledWith({ pagina: 1, tamanho: 50 });
    });
});

describe('POST /sispag/sugestoes-boleto/confirmar', () => {
    it('201 na decisão nova; ator do token (um "ator" no body é 400); chave do emissor não sai', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, CHAVE);
            expect(res.status).toBe(201);
            const corpo = (await res.json()) as {
                criada: boolean;
                decisao: Record<string, unknown>;
            };
            expect(corpo.criada).toBe(true);
            expect(corpo.decisao).not.toHaveProperty('emissorChave');
            expect(JSON.stringify(corpo)).not.toContain('0092740');
            const forjado = await post(`${url}/sispag/sugestoes-boleto/confirmar`, {
                ...CHAVE,
                ator: 'ana',
            });
            expect(forjado.status).toBe(400);
        });
        expect(s.confirmar).toHaveBeenCalledTimes(1);
        expect(s.confirmar).toHaveBeenCalledWith({ ...CHAVE, ator: 'bia' });
    });

    it('200 quando a decisão já existia (idempotente)', async () => {
        servico({
            confirmar: jest.fn().mockResolvedValue({ criada: false, decisao: DECISAO }),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, CHAVE);
            expect(res.status).toBe(200);
            expect(((await res.json()) as { criada: boolean }).criada).toBe(false);
        });
    });

    it('body inválido → 400', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            for (const body of [{}, { ...CHAVE, filCod: 'x' }, { ...CHAVE, docCod: '  ' }]) {
                expect((await post(`${url}/sispag/sugestoes-boleto/confirmar`, body)).status).toBe(
                    400,
                );
            }
        });
        expect(s.confirmar).not.toHaveBeenCalled();
    });

    it.each([
        [new BoletoSuggestionNotAvailableError(CHAVE), 409, 'SUGESTAO_BOLETO_INDISPONIVEL'],
        [
            new BoletoAlreadySuggestedToOtherTitleError(CHAVE),
            409,
            'BOLETO_JA_SUGERIDO_A_OUTRO_TITULO',
        ],
        [new OverdueBoletoNotConfirmableError(CHAVE), 422, 'BOLETO_VENCIDO_NAO_CONFIRMAVEL'],
    ])('erro de domínio %p → %i com o envelope padrão', async (erro, status, code) => {
        servico({ confirmar: jest.fn().mockRejectedValue(erro) });
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, CHAVE);
            expect(res.status).toBe(status);
            const corpo = (await res.json()) as { error: unknown };
            expect(corpo).toMatchObject({ code, retryable: false });
            expect(typeof corpo.error).toBe('string');
        });
    });
});

describe('POST /sispag/sugestoes-boleto/rejeitar', () => {
    it('repassa motivo e ator do token', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/rejeitar`, {
                ...CHAVE,
                motivo: 'outro credor',
            });
            expect(res.status).toBe(201);
        });
        expect(s.rejeitar).toHaveBeenCalledWith({ ...CHAVE, motivo: 'outro credor', ator: 'bia' });
    });

    it('motivo ausente → 400; motivo em branco → 422 nomeado', async () => {
        servico({
            rejeitar: jest
                .fn()
                .mockRejectedValue(
                    new IssuerConfirmationReasonRequiredError({ acao: 'rejeitar a sugestão' }),
                ),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            expect((await post(`${url}/sispag/sugestoes-boleto/rejeitar`, CHAVE)).status).toBe(400);
            const res = await post(`${url}/sispag/sugestoes-boleto/rejeitar`, {
                ...CHAVE,
                motivo: '  ',
            });
            expect(res.status).toBe(422);
            expect(await res.json()).toMatchObject({
                code: 'CONFIRMACAO_EMISSOR_MOTIVO_OBRIGATORIO',
            });
        });
    });
});

describe('POST /sispag/sugestoes-boleto/copiar-linha', () => {
    it('sispag:ver copia (200, auditado pelo serviço); sem sispag:* é 403 e o serviço fica intocado', async () => {
        const s = servico();
        await comApp(NENHUMA, async (url) => {
            expect((await post(`${url}/sispag/sugestoes-boleto/copiar-linha`, CHAVE)).status).toBe(
                403,
            );
        });
        expect(s.copiarLinha).not.toHaveBeenCalled();
        await comApp(VER, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/copiar-linha`, CHAVE);
            expect(res.status).toBe(200);
            expect(res.headers.get('cache-control')).toBe('no-store');
        });
        expect(s.copiarLinha).toHaveBeenCalledWith({ ...CHAVE, ator: 'bia' });
    });

    it('devolve a linha com Cache-Control: no-store e o ator do token', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/copiar-linha`, CHAVE);
            expect(res.status).toBe(200);
            expect(res.headers.get('cache-control')).toBe('no-store');
            expect(await res.json()).toEqual({ linhaDigitavel: LINHA });
        });
        expect(s.copiarLinha).toHaveBeenCalledWith({ ...CHAVE, ator: 'bia' });
    });

    it('trilha indisponível → 503 e NENHUMA linha no corpo (fail-closed)', async () => {
        servico({
            copiarLinha: jest
                .fn()
                .mockRejectedValue(
                    new LineCopyAuditFailedError({ filCod: 2, docCod: '9001', titCod: '1' }),
                ),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/copiar-linha`, CHAVE);
            expect(res.status).toBe(503);
            const texto = await res.text();
            expect(texto).not.toContain(LINHA);
            expect(JSON.parse(texto)).toMatchObject({ code: 'COPIA_LINHA_SEM_TRILHA' });
        });
    });
});

describe('confirmações de emissor', () => {
    it('GET repassa estado/pesCod validados; estado inválido → 400', async () => {
        const s = servico();
        await comApp(VER, async (url) => {
            expect(
                (await fetch(`${url}/sispag/confirmacoes-emissor?estado=VIGENTE&pesCod=7001`))
                    .status,
            ).toBe(200);
            expect((await fetch(`${url}/sispag/confirmacoes-emissor?estado=X`)).status).toBe(400);
        });
        expect(s.listarConfirmacoes).toHaveBeenCalledWith({ estado: 'VIGENTE', pesCod: '7001' });
    });

    it('revogar: qualquer sispag:executar, motivo obrigatório, ator do token', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/confirmacoes-emissor/${ID}/revogar`, {
                motivo: 'conta trocada',
            });
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ confirmacao: { id: ID, estado: 'REVOGADA' } });
            expect(
                (await post(`${url}/sispag/confirmacoes-emissor/${ID}/revogar`, {})).status,
            ).toBe(400);
            expect(
                (await post(`${url}/sispag/confirmacoes-emissor/nao-uuid/revogar`, { motivo: 'x' }))
                    .status,
            ).toBe(400);
        });
        expect(s.revogarPar).toHaveBeenCalledWith({ id: ID, motivo: 'conta trocada', ator: 'bia' });
    });

    it('par inexistente → 404; motivo em branco → 422', async () => {
        servico({
            revogarPar: jest
                .fn()
                .mockRejectedValueOnce(new IssuerConfirmationNotFoundError({ id: ID }))
                .mockRejectedValueOnce(
                    new IssuerConfirmationReasonRequiredError({ acao: 'revogar a confirmação' }),
                ),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const rota = `${url}/sispag/confirmacoes-emissor/${ID}/revogar`;
            expect((await post(rota, { motivo: 'x' })).status).toBe(404);
            expect((await post(rota, { motivo: '' })).status).toBe(422);
        });
    });
});
