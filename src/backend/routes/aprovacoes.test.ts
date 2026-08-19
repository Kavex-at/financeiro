import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';

// Neutraliza o bootstrap real (sem Conexos/DB).
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import { ETAPA_STATUS, STATUS_WORKFLOW } from '../domain/interface/aprovacoes/constants.js';
import {
    ETAPA_APROVACAO_REPOSITORY_TOKEN,
    TITULO_APROVACAO_REPOSITORY_TOKEN,
} from '../domain/interface/aprovacoes/ports.js';
import type {
    EtapaAprovacaoRepositoryInterface,
    ListaAprovacoesFiltro,
    TituloAprovacaoRepositoryInterface,
} from '../domain/interface/aprovacoes/ports.js';
import { chaveTitulo } from '../domain/interface/aprovacoes/ports.js';
import type { EtapaAprovacao } from '../domain/interface/aprovacoes/EtapaAprovacao.js';
import type {
    TituloAprovacao,
    TituloAprovacaoComTrilha,
} from '../domain/interface/aprovacoes/TituloAprovacao.js';
import { errorMiddleware } from '../http/errorMiddleware.js';
import type { FilialScopedUser } from '../http/filialAuthz.js';
import aprovacoesRouter from './aprovacoes.js';

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const buildApp = (user: FilialScopedUser): express.Express => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = user;
        next();
    });
    app.use('/aprovacoes', aprovacoesRouter);
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

const titulo: TituloAprovacao = {
    filCod: 1,
    docCod: 4156,
    titCod: 1,
    documentoNumero: '17',
    statusWorkflow: STATUS_WORKFLOW.AGUARDANDO,
    etapasConcluidas: 0,
    etapasTotais: 1,
    primeiraEtapaEm: new Date('2026-05-14T07:12:46.000Z'),
    lacunas: [],
    ativo: true,
    observadoEm: new Date('2026-05-16T00:00:00.000Z'),
};

const etapa: EtapaAprovacao = {
    filCod: 1,
    docCod: 4156,
    titCod: 1,
    fblCod: 6,
    ftbCod: 1,
    nome: 'CONTROLLER',
    status: ETAPA_STATUS.PENDENTE,
    statusErp: 1,
    recebidoEm: new Date('2026-05-14T07:12:46.000Z'),
    ativo: true,
    observadoEm: new Date('2026-05-16T00:00:00.000Z'),
};

/** Registra fakes nos tokens dos ports — o serviço real roda, os repositories não tocam o banco. */
const registerFakes = (opts: { detalhe?: TituloAprovacaoComTrilha | null } = {}) => {
    const filtros: ListaAprovacoesFiltro[] = [];
    const tituloRepository: TituloAprovacaoRepositoryInterface = {
        upsert: async () => undefined,
        findById: async () => opts.detalhe ?? null,
        list: async (filtro) => {
            filtros.push(filtro);
            return { items: [titulo], total: 1 };
        },
        ultimoSnapshot: async () => new Date('2026-05-16T00:00:00.000Z'),
    };
    const etapaRepository: EtapaAprovacaoRepositoryInterface = {
        sincronizarTrilha: async () => undefined,
        listByTitulo: async () => [etapa],
        listByTitulos: async (chaves) =>
            new Map(chaves.map((c) => [chaveTitulo(c.filCod, c.docCod, c.titCod), [etapa]])),
    };
    container.registerInstance(TITULO_APROVACAO_REPOSITORY_TOKEN, tituloRepository);
    container.registerInstance(ETAPA_APROVACAO_REPOSITORY_TOKEN, etapaRepository);
    return filtros;
};

const get = (url: string) => fetch(url, { method: 'GET' });
const readJson = async (res: Response): Promise<Record<string, any>> =>
    (await res.json()) as Record<string, any>;

const USER: FilialScopedUser = { sub: 'analista', role: 'admin', filiais: [1, 2] };

describe('GET /aprovacoes', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('devolve a página no shape do contrato, com snapshotEm', async () => {
        registerFakes();
        const server = await listen(buildApp(USER));
        try {
            const res = await get(`${server.url}/aprovacoes?page=1&pageSize=10`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.page).toBe(1);
            expect(body.pageSize).toBe(10);
            expect(body.total).toBe(1);
            expect(body.snapshotEm).toBe('2026-05-16T00:00:00.000Z');
            expect(body.items[0].id).toBe('1:4156:1');
            expect(body.items[0].etapaAtual.nome).toBe('CONTROLLER');
            expect(body.items[0].etapasAbertas).toBe(1);
        } finally {
            await server.close();
        }
    });

    // A allow-list do token chega ao SQL — a rota nunca deixa o filtro de filial em aberto.
    it('restringe a varredura às filiais permitidas', async () => {
        const filtros = registerFakes();
        const server = await listen(buildApp(USER));
        try {
            await get(`${server.url}/aprovacoes`);
            expect(filtros[0]?.filCods).toEqual([1, 2]);
        } finally {
            await server.close();
        }
    });

    it('403 quando o filCod pedido está fora da allow-list', async () => {
        registerFakes();
        const server = await listen(buildApp(USER));
        try {
            const res = await get(`${server.url}/aprovacoes?filCod=9`);
            const body = await readJson(res);
            expect(res.status).toBe(403);
            expect(body.code).toBe('FILIAL_NAO_AUTORIZADA');
        } finally {
            await server.close();
        }
    });

    it('400 em query inválida (Zod no boundary)', async () => {
        registerFakes();
        const server = await listen(buildApp(USER));
        try {
            const res = await get(`${server.url}/aprovacoes?page=0`);
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });
});

describe('GET /aprovacoes/:id/trilha', () => {
    afterEach(() => {
        container.clearInstances();
    });

    it('devolve cabeçalho + etapas + lacunas', async () => {
        registerFakes({ detalhe: { ...titulo, etapas: [etapa] } });
        const server = await listen(buildApp(USER));
        try {
            const res = await get(`${server.url}/aprovacoes/1:4156:1/trilha`);
            const body = await readJson(res);
            expect(res.status).toBe(200);
            expect(body.cabecalho.id).toBe('1:4156:1');
            expect(body.etapas).toHaveLength(1);
            expect(body.etapas[0].statusErp).toBe(1);
            expect(body.lacunas).toEqual([]);
            expect(body.snapshotEm).toBe('2026-05-16T00:00:00.000Z');
        } finally {
            await server.close();
        }
    });

    it('400 quando o id não é filCod:docCod:titCod', async () => {
        registerFakes({ detalhe: { ...titulo, etapas: [etapa] } });
        const server = await listen(buildApp(USER));
        try {
            const res = await get(`${server.url}/aprovacoes/1:abc:1/trilha`);
            expect(res.status).toBe(400);
        } finally {
            await server.close();
        }
    });

    it('404 quando o título não existe', async () => {
        registerFakes({ detalhe: null });
        const server = await listen(buildApp(USER));
        try {
            const res = await get(`${server.url}/aprovacoes/1:4156:1/trilha`);
            expect(res.status).toBe(404);
        } finally {
            await server.close();
        }
    });

    // Filial alheia responde 404, não 403: distinguir confirmaria que o título existe.
    it('404 quando o título é de filial fora da allow-list', async () => {
        registerFakes({ detalhe: { ...titulo, filCod: 9, etapas: [etapa] } });
        const server = await listen(buildApp(USER));
        try {
            const res = await get(`${server.url}/aprovacoes/9:4156:1/trilha`);
            expect(res.status).toBe(404);
        } finally {
            await server.close();
        }
    });
});
