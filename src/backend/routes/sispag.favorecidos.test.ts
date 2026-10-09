import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import AuthorizedPayeeNotFoundError from '../domain/errors/AuthorizedPayeeNotFoundError.js';
import PayeeApprovalBySolicitorError from '../domain/errors/PayeeApprovalBySolicitorError.js';
import PayeeDestinationChangedSinceShownError from '../domain/errors/PayeeDestinationChangedSinceShownError.js';
import PayeeReapprovalNotConfirmedError from '../domain/errors/PayeeReapprovalNotConfirmedError.js';
import PayeeWithoutPaymentDataError from '../domain/errors/PayeeWithoutPaymentDataError.js';
import { PERMISSION, type Permission } from '../domain/interface/auth/Permission.js';
import AuthorizationCandidatesService from '../domain/service/sispag/AuthorizationCandidatesService.js';
import AuthorizedPayeeService from '../domain/service/sispag/AuthorizedPayeeService.js';
import PayeeSearchService from '../domain/service/sispag/PayeeSearchService.js';
import { AcessoFixture } from '../http/__fixtures__/acesso.fixture.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import { requestIdMiddleware } from '../middleware/requestId.js';
import sispagRouter from './sispag.js';

/**
 * Rotas do favorecido autorizado (ADR-0065). O ator vem SEMPRE do usuário autenticado
 * (`req.user.sub = 'bia'`): um "ator" no body é ignorado.
 */

const ID = '00000000-0000-0000-0000-000000000065';
const FP = 'a'.repeat(64);
const AUTORIZACAO = {
    id: ID,
    pesCod: '7001',
    modalidade: 'TED',
    estado: 'PENDENTE',
    avisos: [],
    origemSolicitacao: 'ITEM',
    filCodLeitura: 4,
    solicitadoPor: 'ana',
    versao: 1,
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

const servico = (over: Record<string, jest.Mock>) => {
    const s = {
        listar: jest.fn().mockResolvedValue([AUTORIZACAO]),
        solicitar: jest.fn().mockResolvedValue(AUTORIZACAO),
        aprovar: jest.fn().mockResolvedValue({ ...AUTORIZACAO, estado: 'AUTORIZADO' }),
        rejeitar: jest.fn().mockResolvedValue({ ...AUTORIZACAO, estado: 'REJEITADO' }),
        revogar: jest.fn().mockResolvedValue({ ...AUTORIZACAO, estado: 'REVOGADO' }),
        reconferir: jest.fn().mockResolvedValue({ autorizacao: AUTORIZACAO, atual: {} }),
        revelar: jest.fn().mockResolvedValue({
            destino: { tipo: 'TED', banco: '237', conta: '87654321' },
            destinoMascarado: 'banco 237 · cc ****4321',
        }),
        eventos: jest.fn().mockResolvedValue([]),
        ...over,
    };
    container.registerInstance(AuthorizedPayeeService, s as never);
    return s;
};

afterEach(() => {
    container.clearInstances();
    jest.clearAllMocks();
});

describe('POST /sispag/favorecidos-autorizados — pedir (F1/F5)', () => {
    it('201; o solicitante é o usuário autenticado, o "ator" do body é ignorado', async () => {
        const s = servico({});
        await comApp([PERMISSION.SISPAG_EXECUTAR], async (url) => {
            const res = await post(`${url}/sispag/favorecidos-autorizados`, {
                pesCod: '7001',
                credor: 'ACME',
                modalidade: 'TED',
                origem: 'ITEM',
                filCod: 4,
                ator: 'outra-pessoa',
                solicitadoPor: 'outra-pessoa',
            });
            expect(res.status).toBe(201);
        });
        expect(s.solicitar).toHaveBeenCalledWith({
            pesCod: '7001',
            credor: 'ACME',
            modalidade: 'TED',
            origem: 'ITEM',
            filCod: 4,
            ator: 'bia',
        });
    });

    it('sem filCod no body (relatório/manual) → o serviço recebe o pedido sem filial', async () => {
        const s = servico({});
        await comApp([PERMISSION.SISPAG_EXECUTAR], async (url) => {
            const res = await post(`${url}/sispag/favorecidos-autorizados`, {
                pesCod: '7001',
                modalidade: 'PIX',
                origem: 'RELATORIO',
            });
            expect(res.status).toBe(201);
        });
        expect(s.solicitar).toHaveBeenCalledWith({
            pesCod: '7001',
            modalidade: 'PIX',
            origem: 'RELATORIO',
            ator: 'bia',
        });
    });

    it('modalidade inválida → 400; sem sispag:executar → 403', async () => {
        const s = servico({});
        await comApp([PERMISSION.SISPAG_EXECUTAR], async (url) => {
            const res = await post(`${url}/sispag/favorecidos-autorizados`, {
                pesCod: '7001',
                modalidade: 'BOLETO',
                origem: 'ITEM',
                filCod: 4,
            });
            expect(res.status).toBe(400);
        });
        await comApp(
            [PERMISSION.SISPAG_VER, PERMISSION.SISPAG_AUTORIZAR_FAVORECIDO],
            async (url) => {
                const res = await post(`${url}/sispag/favorecidos-autorizados`, {
                    pesCod: '7001',
                    modalidade: 'TED',
                    origem: 'ITEM',
                    filCod: 4,
                });
                expect(res.status).toBe(403);
            },
        );
        expect(s.solicitar).not.toHaveBeenCalled();
    });
});

describe('POST /sispag/favorecidos-autorizados/:id/aprovar (F2/F6)', () => {
    it('exige sispag:autorizar_favorecido; envia a impressão mostrada e o ator do token', async () => {
        const s = servico({});
        await comApp([PERMISSION.SISPAG_VER, PERMISSION.SISPAG_EXECUTAR], async (url) => {
            expect(
                (
                    await post(`${url}/sispag/favorecidos-autorizados/${ID}/aprovar`, {
                        versao: 1,
                        fingerprintMostrado: FP,
                    })
                ).status,
            ).toBe(403);
        });
        await comApp([PERMISSION.SISPAG_AUTORIZAR_FAVORECIDO], async (url) => {
            const res = await post(`${url}/sispag/favorecidos-autorizados/${ID}/aprovar`, {
                versao: 1,
                fingerprintMostrado: FP,
                ator: 'ana',
            });
            expect(res.status).toBe(200);
        });
        expect(s.aprovar).toHaveBeenCalledTimes(1);
        expect(s.aprovar).toHaveBeenCalledWith({
            id: ID,
            versao: 1,
            fingerprintMostrado: FP,
            ator: 'bia',
        });
    });

    it('sem impressão (ou malformada) → 400', async () => {
        servico({});
        await comApp(undefined, async (url) => {
            for (const body of [{ versao: 1 }, { versao: 1, fingerprintMostrado: 'x' }]) {
                const res = await post(`${url}/sispag/favorecidos-autorizados/${ID}/aprovar`, body);
                expect(res.status).toBe(400);
            }
        });
    });

    it.each([
        ['aprovador = solicitante', new PayeeApprovalBySolicitorError({ id: ID }), 403],
        ['reaprovação não confirmada', new PayeeReapprovalNotConfirmedError({ id: ID }), 409],
        ['destino mudou', new PayeeDestinationChangedSinceShownError({ id: ID }), 409],
        ['cadastro sem dado', new PayeeWithoutPaymentDataError({ id: ID, modalidade: 'TED' }), 422],
        ['inexistente', new AuthorizedPayeeNotFoundError({ id: ID }), 404],
    ])('%s → HTTP do erro, mensagem em português', async (_n, erro, status) => {
        servico({ aprovar: jest.fn().mockRejectedValue(erro) });
        await comApp(undefined, async (url) => {
            const res = await post(`${url}/sispag/favorecidos-autorizados/${ID}/aprovar`, {
                versao: 1,
                fingerprintMostrado: FP,
            });
            expect(res.status).toBe(status);
            const body = (await res.json()) as { code: string; error: string };
            expect(body.code).toBe(erro.code);
            expect(body.error).toBe(erro.userMessage);
        });
    });
});

describe('POST /sispag/favorecidos-autorizados/:id/{rejeitar,revogar} (F3/F7)', () => {
    it.each([
        'rejeitar',
        'revogar',
    ] as const)('%s exige motivo (400) e passa o ator do token', async (acao) => {
        const s = servico({});
        await comApp(undefined, async (url) => {
            const URL = `${url}/sispag/favorecidos-autorizados/${ID}/${acao}`;
            expect((await post(URL, { versao: 1, motivo: '  ' })).status).toBe(400);
            expect(
                (await post(URL, { versao: 1, motivo: 'conta de terceiro', ator: 'x' })).status,
            ).toBe(200);
        });
        expect(s[acao]).toHaveBeenCalledWith({
            id: ID,
            versao: 1,
            motivo: 'conta de terceiro',
            ator: 'bia',
        });
    });
});

describe('leitura, reconferência, revelar e trilha', () => {
    it('as respostas nunca trazem as impressões (HMAC) aprovada e observada', async () => {
        servico({
            listar: jest
                .fn()
                .mockResolvedValue([{ ...AUTORIZACAO, fingerprint: FP, fingerprintObservado: FP }]),
        });
        await comApp([PERMISSION.SISPAG_VER], async (url) => {
            const texto = await (await fetch(`${url}/sispag/favorecidos-autorizados`)).text();
            expect(texto).not.toContain(FP);
        });
    });

    it('GET lista com filtro validado; estado desconhecido → 400', async () => {
        const s = servico({});
        await comApp([PERMISSION.SISPAG_VER], async (url) => {
            expect(
                (await fetch(`${url}/sispag/favorecidos-autorizados?estado=PENDENTE`)).status,
            ).toBe(200);
            expect((await fetch(`${url}/sispag/favorecidos-autorizados?estado=XYZ`)).status).toBe(
                400,
            );
        });
        expect(s.listar).toHaveBeenCalledWith({ estado: 'PENDENTE' });
    });

    it('reconferir é sispag:ver; revelar exige sispag:autorizar_favorecido e não é cacheável', async () => {
        const s = servico({});
        await comApp([PERMISSION.SISPAG_VER], async (url) => {
            expect(
                (await post(`${url}/sispag/favorecidos-autorizados/${ID}/reconferir`, {})).status,
            ).toBe(200);
            expect(
                (await post(`${url}/sispag/favorecidos-autorizados/${ID}/revelar`, {})).status,
            ).toBe(403);
        });
        await comApp([PERMISSION.SISPAG_AUTORIZAR_FAVORECIDO], async (url) => {
            const res = await post(`${url}/sispag/favorecidos-autorizados/${ID}/revelar`, {});
            expect(res.status).toBe(200);
            expect(res.headers.get('cache-control')).toBe('no-store');
        });
        expect(s.reconferir).toHaveBeenCalledWith(ID, 'bia');
        expect(s.revelar).toHaveBeenCalledWith(ID, 'bia');
    });

    it('id que não é uuid → 400', async () => {
        servico({});
        await comApp(undefined, async (url) => {
            expect((await fetch(`${url}/sispag/favorecidos-autorizados/abc/eventos`)).status).toBe(
                400,
            );
        });
    });
});

describe('GET /sispag/favorecidos-autorizados/candidatos (relatório read-only)', () => {
    it('sispag:ver; paginação com default e teto validados', async () => {
        const listar = jest.fn().mockResolvedValue({ candidatos: [], total: 0 });
        container.registerInstance(AuthorizationCandidatesService, { listar } as never);
        await comApp([PERMISSION.SISPAG_VER], async (url) => {
            expect((await fetch(`${url}/sispag/favorecidos-autorizados/candidatos`)).status).toBe(
                200,
            );
            expect(
                (await fetch(`${url}/sispag/favorecidos-autorizados/candidatos?limite=26`)).status,
            ).toBe(400);
        });
        expect(listar).toHaveBeenCalledWith({ pagina: 1, limite: 20 });
    });
});

describe('busca de favorecido no Conexos e prévia do destino (pedido sem abrir o Conexos)', () => {
    it('POST /busca (termo no body, nunca na URL) é sispag:executar; termo obrigatório e limitado', async () => {
        const buscar = jest.fn().mockResolvedValue({ favorecidos: [], truncado: false });
        container.registerInstance(PayeeSearchService, { buscar } as never);
        const rota = '/sispag/favorecidos-autorizados/busca';
        await comApp([PERMISSION.SISPAG_EXECUTAR], async (url) => {
            const ok = await post(`${url}${rota}`, { termo: '12.345.678/0001-95' });
            expect(ok.status).toBe(200);
            expect(ok.headers.get('cache-control')).toBe('no-store');
            expect((await post(`${url}${rota}`, {})).status).toBe(400);
            expect((await post(`${url}${rota}`, { termo: 'a'.repeat(101) })).status).toBe(400);
            // GET com o termo na query não existe: CPF/CNPJ em URL vai para log de erro/acesso.
            expect((await fetch(`${url}${rota}?termo=acme`)).status).toBe(404);
        });
        expect(buscar).toHaveBeenCalledWith('12.345.678/0001-95');
        await comApp([PERMISSION.SISPAG_VER], async (url) => {
            expect((await post(`${url}${rota}`, { termo: 'acme' })).status).toBe(403);
        });
    });

    it('POST /busca está atrás do limitador por usuário: a 31ª no minuto é 429 e não chega ao serviço', async () => {
        // Os limitadores são desligados sob NODE_ENV=test; aqui ligamos para provar a montagem.
        const ambiente = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const buscar = jest.fn().mockResolvedValue({ favorecidos: [], truncado: false });
        container.registerInstance(PayeeSearchService, { buscar } as never);
        try {
            await comApp([PERMISSION.SISPAG_EXECUTAR], async (url) => {
                const rota = `${url}/sispag/favorecidos-autorizados/busca`;
                for (let i = 0; i < 30; i++) {
                    expect((await post(rota, { termo: 'acme' })).status).toBe(200);
                }
                const r = await post(rota, { termo: 'acme' });
                expect(r.status).toBe(429);
                expect(await r.json()).toMatchObject({ codigo: 'MUITAS_BUSCAS' });
            });
        } finally {
            process.env.NODE_ENV = ambiente;
        }
        expect(buscar).toHaveBeenCalledTimes(30);
    });

    it('GET /destino-atual está atrás do limitador por usuário: a 31ª no minuto é 429 e não lê o cadastro', async () => {
        const ambiente = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const destinoAtual = jest.fn().mockResolvedValue({ resultado: 'SEM_DADO', avisos: [] });
        servico({ destinoAtual });
        try {
            await comApp([PERMISSION.SISPAG_EXECUTAR], async (url) => {
                const rota = `${url}/sispag/favorecidos-autorizados/destino-atual?pesCod=7001&modalidade=TED`;
                for (let i = 0; i < 30; i++) expect((await fetch(rota)).status).toBe(200);
                const r = await fetch(rota);
                expect(r.status).toBe(429);
                expect(await r.json()).toMatchObject({ codigo: 'MUITAS_BUSCAS' });
            });
        } finally {
            process.env.NODE_ENV = ambiente;
        }
        expect(destinoAtual).toHaveBeenCalledTimes(30);
    });

    it('GET /destino-atual é sispag:executar; devolve só a máscara, valida modalidade', async () => {
        const destinoAtual = jest.fn().mockResolvedValue({
            resultado: 'OK',
            destinoMascarado: 'banco 237 · cc ****4321',
            avisos: [],
        });
        servico({ destinoAtual });
        await comApp([PERMISSION.SISPAG_EXECUTAR], async (url) => {
            const r = await fetch(
                `${url}/sispag/favorecidos-autorizados/destino-atual?pesCod=7001&modalidade=PIX`,
            );
            expect(r.status).toBe(200);
            expect(r.headers.get('cache-control')).toBe('no-store');
            expect(await r.json()).toEqual({
                resultado: 'OK',
                destinoMascarado: 'banco 237 · cc ****4321',
                avisos: [],
            });
            expect(
                (
                    await fetch(
                        `${url}/sispag/favorecidos-autorizados/destino-atual?pesCod=7001&modalidade=BOLETO`,
                    )
                ).status,
            ).toBe(400);
            expect(
                (await fetch(`${url}/sispag/favorecidos-autorizados/destino-atual?modalidade=TED`))
                    .status,
            ).toBe(400);
        });
        expect(destinoAtual).toHaveBeenCalledWith('7001', 'PIX');
        await comApp([PERMISSION.SISPAG_VER], async (url) => {
            expect(
                (
                    await fetch(
                        `${url}/sispag/favorecidos-autorizados/destino-atual?pesCod=7001&modalidade=TED`,
                    )
                ).status,
            ).toBe(403);
        });
    });
});
