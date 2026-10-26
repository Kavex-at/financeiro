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
import DecisionNotConfirmedError from '../domain/errors/DecisionNotConfirmedError.js';
import InvalidDecisionActorError from '../domain/errors/InvalidDecisionActorError.js';
import IssuerConfirmationVersionConflictError from '../domain/errors/IssuerConfirmationVersionConflictError.js';
import IssuerConfirmationNotFoundError from '../domain/errors/IssuerConfirmationNotFoundError.js';
import IssuerConfirmationReasonRequiredError from '../domain/errors/IssuerConfirmationReasonRequiredError.js';
import LineCopyAuditFailedError from '../domain/errors/LineCopyAuditFailedError.js';
import OverdueBoletoNotConfirmableError from '../domain/errors/OverdueBoletoNotConfirmableError.js';
import TitleSuggestionNotFoundError from '../domain/errors/TitleSuggestionNotFoundError.js';
import DivergenceAcknowledgementRequiredError from '../domain/errors/DivergenceAcknowledgementRequiredError.js';
import DivergenceAcknowledgementStaleError from '../domain/errors/DivergenceAcknowledgementStaleError.js';
import WarningAcknowledgementRequiredError from '../domain/errors/WarningAcknowledgementRequiredError.js';
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
        detalharTitulo: jest.fn().mockResolvedValue({
            docCod: '9001',
            situacao: 'AMBIGUA',
            candidatos: [{ ddcCod: 10, ditCod: 3, confirmavel: false }],
            totalCandidatos: 1,
        }),
        listarConfirmacoes: jest
            .fn()
            .mockResolvedValue([{ id: ID, emissorMascarado: '237 / 2656 / ***2740' }]),
        confirmar: jest.fn().mockResolvedValue({ criada: true, decisao: DECISAO }),
        rejeitar: jest
            .fn()
            .mockResolvedValue({ criada: true, decisao: { ...DECISAO, decisao: 'REJEITADA' } }),
        revogarPar: jest.fn().mockResolvedValue({ id: ID, estado: 'REVOGADA' }),
        anularDecisao: jest.fn().mockResolvedValue({
            anulada: true,
            decisao: { ...DECISAO, decisao: 'ANULADA', anuladaPor: 'bia' },
        }),
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
        ['GET detalhe por título', '/sispag/sugestoes-boleto/titulo?filCod=2&docCod=9001&titCod=1'],
        ['GET confirmações de emissor', '/sispag/confirmacoes-emissor'],
    ];
    const escritas: Array<[string, string, unknown]> = [
        ['POST confirmar', '/sispag/sugestoes-boleto/confirmar', CHAVE],
        [
            'POST rejeitar',
            '/sispag/sugestoes-boleto/rejeitar',
            { ...CHAVE, motivo: 'outro credor' },
        ],
        [
            'POST anular',
            '/sispag/sugestoes-boleto/anular',
            { filCod: 2, docCod: '9001', titCod: '1', motivo: 'confirmação errada' },
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
        expect(s.anularDecisao).not.toHaveBeenCalled();
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
            // O teto é 2000 (a tela busca tudo numa chamada): 2000 passa, 2001 e 0 não.
            expect((await fetch(`${url}/sispag/sugestoes-boleto?tamanho=2000`)).status).toBe(200);
            expect((await fetch(`${url}/sispag/sugestoes-boleto?tamanho=2001`)).status).toBe(400);
            expect((await fetch(`${url}/sispag/sugestoes-boleto?tamanho=0`)).status).toBe(400);
        });
        expect(s.listarSugestoes).toHaveBeenCalledWith({ pagina: 1, tamanho: 50 });
    });
});

describe('GET /sispag/sugestoes-boleto?situacao= e /titulo (ADR-0072)', () => {
    it('repassa o filtro situacao validado; situação inválida → 400', async () => {
        const s = servico();
        await comApp(VER, async (url) => {
            expect((await fetch(`${url}/sispag/sugestoes-boleto?situacao=AMBIGUA`)).status).toBe(
                200,
            );
            expect((await fetch(`${url}/sispag/sugestoes-boleto?situacao=XYZ`)).status).toBe(400);
        });
        expect(s.listarSugestoes).toHaveBeenCalledWith({
            situacao: 'AMBIGUA',
            pagina: 1,
            tamanho: 50,
        });
    });

    it('detalhe por título: sispag:ver, no-store, sem linha digitável nem barras', async () => {
        const s = servico();
        await comApp(VER, async (url) => {
            const res = await fetch(
                `${url}/sispag/sugestoes-boleto/titulo?filCod=2&docCod=9001&titCod=1`,
            );
            expect(res.status).toBe(200);
            expect(res.headers.get('cache-control')).toBe('no-store');
            expect(JSON.stringify(await res.json())).not.toMatch(/\d{30,}/);
        });
        expect(s.detalharTitulo).toHaveBeenCalledWith({ filCod: 2, docCod: '9001', titCod: '1' });
    });

    it('detalhe: chave incompleta → 400; título inelegível → 404 nomeado', async () => {
        const s = servico({
            detalharTitulo: jest
                .fn()
                .mockRejectedValue(
                    new TitleSuggestionNotFoundError({ filCod: 2, docCod: '1', titCod: '1' }),
                ),
        });
        await comApp(VER, async (url) => {
            expect((await fetch(`${url}/sispag/sugestoes-boleto/titulo?filCod=2`)).status).toBe(
                400,
            );
            const res = await fetch(
                `${url}/sispag/sugestoes-boleto/titulo?filCod=2&docCod=1&titCod=1`,
            );
            expect(res.status).toBe(404);
            expect(await res.json()).toMatchObject({ code: 'TITULO_SEM_SUGESTAO' });
        });
        expect(s.detalharTitulo).toHaveBeenCalledTimes(1);
    });

    it('sem sispag:* o detalhe é 403', async () => {
        servico();
        await comApp(NENHUMA, async (url) => {
            const res = await fetch(
                `${url}/sispag/sugestoes-boleto/titulo?filCod=2&docCod=9001&titCod=1`,
            );
            expect(res.status).toBe(403);
        });
    });
});

describe('POST /sispag/sugestoes-boleto/confirmar — reconheceAvisos (I15o)', () => {
    it('repassa reconheceAvisos validado ao serviço', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, {
                ...CHAVE,
                reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
            });
            expect(res.status).toBe(201);
        });
        expect(s.confirmar).toHaveBeenCalledWith({
            ...CHAVE,
            reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
            ator: 'bia',
        });
    });

    it('aviso desconhecido → 400; rejeitar não aceita o campo', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const a = await post(`${url}/sispag/sugestoes-boleto/confirmar`, {
                ...CHAVE,
                reconheceAvisos: ['OUTRO'],
            });
            expect(a.status).toBe(400);
            const b = await post(`${url}/sispag/sugestoes-boleto/rejeitar`, {
                ...CHAVE,
                motivo: 'não é',
                reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
            });
            expect(b.status).toBe(400);
        });
        expect(s.confirmar).not.toHaveBeenCalled();
        expect(s.rejeitar).not.toHaveBeenCalled();
    });

    it('sem o reconhecimento no caso B → 422 com o envelope e a orientação', async () => {
        servico({
            confirmar: jest.fn().mockRejectedValue(
                new WarningAcknowledgementRequiredError({
                    ...CHAVE,
                    avisos: ['VENCE_ANTES_DO_TITULO'],
                    vencimentoTitulo: '2026-10-20',
                    vencimentoBoleto: '2026-10-18',
                    dataDebito: '2026-10-15',
                }),
            ),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, CHAVE);
            expect(res.status).toBe(422);
            const corpo = (await res.json()) as { code: string; error: string };
            expect(corpo.code).toBe('RECONHECIMENTO_DE_AVISO_OBRIGATORIO');
            expect(corpo.error).toContain('portal do banco');
        });
    });
});

describe('POST /sispag/sugestoes-boleto/confirmar — reconhecimento tipado (I15q, ADR-0078)', () => {
    const ACK = {
        tipo: 'DATA_DIVERGENTE',
        aceito: true,
        motivo: 'conferi o vencimento no portal do banco',
        deltaDiasVisto: 7,
        valorBoletoVisto: 10_000,
    };

    it('repassa o reconhecimento validado ao serviço, com o ator do TOKEN', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, {
                ...CHAVE,
                reconhecimento: ACK,
            });
            expect(res.status).toBe(201);
        });
        expect(s.confirmar).toHaveBeenCalledWith({
            ...CHAVE,
            reconheceAvisos: [],
            reconhecimento: ACK,
            ator: 'bia',
        });
    });

    it.each([
        ['aceito: false', { ...ACK, aceito: false }],
        ['motivo curto', { ...ACK, motivo: 'curto' }],
        ['tipo desconhecido', { ...ACK, tipo: 'OUTRO' }],
        ['autor no corpo', { ...ACK, reconhecidoPor: 'maria' }],
    ])('corpo inválido (%s) → 400 e o serviço nem é chamado', async (_n, reconhecimento) => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, {
                ...CHAVE,
                reconhecimento,
            });
            expect(res.status).toBe(400);
        });
        expect(s.confirmar).not.toHaveBeenCalled();
    });

    it('rejeitar e anular não aceitam o campo `reconhecimento`', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const a = await post(`${url}/sispag/sugestoes-boleto/rejeitar`, {
                ...CHAVE,
                motivo: 'não é',
                reconhecimento: ACK,
            });
            expect(a.status).toBe(400);
        });
        expect(s.rejeitar).not.toHaveBeenCalled();
    });

    it('a decisão devolvida traz o reconhecimento e o derivado `reconhecimentoValido`', async () => {
        servico({
            confirmar: jest.fn().mockResolvedValue({
                criada: true,
                reconhecimentoValido: true,
                decisao: {
                    ...DECISAO,
                    reconhecimento: {
                        tipo: 'DATA_DIVERGENTE',
                        motivo: ACK.motivo,
                        deltaDiasVisto: 7,
                        valorBoletoVisto: 10_000,
                        reconhecidoPor: 'bia',
                        reconhecidoEm: '2026-10-26T12:00:00.000Z',
                    },
                },
            }),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, {
                ...CHAVE,
                reconhecimento: ACK,
            });
            const corpo = (await res.json()) as {
                decisao: {
                    reconhecimento: { reconhecidoPor: string };
                    reconhecimentoValido: boolean;
                };
            };
            expect(corpo.decisao.reconhecimento.reconhecidoPor).toBe('bia');
            expect(corpo.decisao.reconhecimentoValido).toBe(true);
        });
    });

    it.each([
        [
            new DivergenceAcknowledgementRequiredError({
                ...CHAVE,
                deltaDias: 7,
                valorBoleto: 10_000,
                vencimentoTitulo: '2026-10-20',
                vencimentoBoleto: '2026-10-27',
                codigoMascarado: '34191…0001',
            }),
            'RECONHECIMENTO_DE_DIVERGENCIA_OBRIGATORIO',
        ],
        [
            new DivergenceAcknowledgementStaleError({
                ...CHAVE,
                deltaDiasVisto: 7,
                deltaDiasAtual: 6,
                valorBoletoVisto: 10_000,
                valorBoletoAtual: 10_000,
            }),
            'RECONHECIMENTO_DE_DIVERGENCIA_DESATUALIZADO',
        ],
    ])('mapeia %s para 422 com código estável e mensagem em português', async (erro, code) => {
        servico({ confirmar: jest.fn().mockRejectedValue(erro) });
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/confirmar`, CHAVE);
            expect(res.status).toBe(422);
            const corpo = (await res.json()) as { code: string; error: string };
            expect(corpo.code).toBe(code);
            expect(corpo.error).toMatch(/boleto/);
            expect(JSON.stringify(corpo)).not.toMatch(/\d{20,}/);
        });
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
        expect(s.confirmar).toHaveBeenCalledWith({ ...CHAVE, reconheceAvisos: [], ator: 'bia' });
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
            for (const body of [
                {},
                { ...CHAVE, filCod: 'x' },
                { ...CHAVE, docCod: '  ' },
                { ...CHAVE, docCod: 'd'.repeat(65) },
                { ...CHAVE, titCod: 't'.repeat(65) },
            ]) {
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

describe('POST /sispag/sugestoes-boleto/anular (I15l)', () => {
    const BODY = { filCod: 2, docCod: '9001', titCod: '1', motivo: 'confirmação errada' };

    it('repassa título, motivo e ator do token; 200 { anulada, decisao } sem emissorChave', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/anular`, BODY);
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toMatchObject({ anulada: true, decisao: { decisao: 'ANULADA' } });
            expect(JSON.stringify(json)).not.toContain('emissorChave');
            expect(JSON.stringify(json)).not.toContain('0092740');
        });
        expect(s.anularDecisao).toHaveBeenCalledWith({ ...BODY, ator: 'bia' });
    });

    it('já anulada continua 200 (idempotente)', async () => {
        servico({
            anularDecisao: jest.fn().mockResolvedValue({
                anulada: false,
                decisao: { ...DECISAO, decisao: 'ANULADA' },
            }),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const res = await post(`${url}/sispag/sugestoes-boleto/anular`, BODY);
            expect(res.status).toBe(200);
            expect(await res.json()).toMatchObject({ anulada: false });
        });
    });

    it('body estrito: ator/ddcCod forjados, motivo ausente ou fora de 10–500 → 400, serviço intocado', async () => {
        const s = servico();
        await comApp(VER_EXECUTAR, async (url) => {
            const invalidos: unknown[] = [
                { ...BODY, ator: 'sistema' },
                { ...BODY, ddcCod: 10 },
                { filCod: 2, docCod: '9001', titCod: '1' },
                { ...BODY, motivo: 'curto' },
                { ...BODY, motivo: '          ' },
                { ...BODY, motivo: 'x'.repeat(501) },
                { ...BODY, filCod: 'dois' },
            ];
            for (const body of invalidos) {
                expect((await post(`${url}/sispag/sugestoes-boleto/anular`, body)).status).toBe(
                    400,
                );
            }
            expect(
                (
                    await post(`${url}/sispag/sugestoes-boleto/anular`, {
                        ...BODY,
                        motivo: 'x'.repeat(500),
                    })
                ).status,
            ).toBe(200);
        });
        expect(s.anularDecisao).toHaveBeenCalledTimes(1);
    });

    it('título sem confirmação → 409 DECISAO_NAO_CONFIRMADA; ator recusado → 403', async () => {
        servico({
            anularDecisao: jest
                .fn()
                .mockRejectedValueOnce(
                    new DecisionNotConfirmedError({ filCod: 2, docCod: '9001', titCod: '1' }),
                )
                .mockRejectedValueOnce(new InvalidDecisionActorError()),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const a = await post(`${url}/sispag/sugestoes-boleto/anular`, BODY);
            expect(a.status).toBe(409);
            expect(await a.json()).toMatchObject({ code: 'DECISAO_NAO_CONFIRMADA' });
            expect((await post(`${url}/sispag/sugestoes-boleto/anular`, BODY)).status).toBe(403);
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

    it('conflito de versão → 409 nomeado; ator inválido → 403 nomeado', async () => {
        servico({
            revogarPar: jest
                .fn()
                .mockRejectedValueOnce(new IssuerConfirmationVersionConflictError({ id: ID }))
                .mockRejectedValueOnce(new InvalidDecisionActorError()),
        });
        await comApp(VER_EXECUTAR, async (url) => {
            const rota = `${url}/sispag/confirmacoes-emissor/${ID}/revogar`;
            const a = await post(rota, { motivo: 'x' });
            expect(a.status).toBe(409);
            expect(await a.json()).toMatchObject({
                code: 'CONFIRMACAO_EMISSOR_CONFLITO_DE_VERSAO',
                retryable: false,
            });
            const b = await post(rota, { motivo: 'x' });
            expect(b.status).toBe(403);
            expect(await b.json()).toMatchObject({ code: 'ATOR_DA_DECISAO_INVALIDO' });
        });
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
