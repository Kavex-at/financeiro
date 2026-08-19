import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { container } from 'tsyringe';
import { ETAPA_STATUS, STATUS_WORKFLOW } from '../domain/interface/aprovacoes/constants.js';
import type { EtapaAprovacao } from '../domain/interface/aprovacoes/EtapaAprovacao.js';
import type { TituloAprovacao } from '../domain/interface/aprovacoes/TituloAprovacao.js';

/**
 * E2E da ingestão da Frente V — varredura completa contra um **ERP fake HTTP**, sem Docker e sem
 * Conexos real. Espelha a doutrina do e2e da Frente IV (`routes/recebimentos.e2e.test.ts`).
 *
 * ## Por que este teste existe
 *
 * Os testes unitários da ingestão trocam o gateway por um dublê — o que valida a lógica de domínio
 * e **nada** do contrato de fio. A revisão de arquitetura apontou isso como lacuna estrutural: o
 * formato exigente do Conexos (epoch ms, envelope `{count, rows}`, path literal com a chave inteira,
 * header `filCod`) estava defendido apenas por um fake que concordava com a nossa própria suposição.
 *
 * Aqui o que é REAL: `ConexosAprovacoesClient` (com o adapter legado, login/sid/cookies por HTTP de
 * verdade), `IngestaoAprovacoesService` e os três resolvers. O que é FAKE: o ERP (servidor Express
 * local que responde `psq014/list` e `fin026/infoTitulo/list`) e a persistência (repos in-memory).
 *
 * O cenário é o caso canônico observado em produção: doc 4156/1 da **filial 1**, etapa
 * `CONTROLLER · COMPRAS · LIBERAR · DANILO_LARA`, recebida em 14/05 e liberada em 15/05 — 23h29m.
 */

jest.setTimeout(60_000);

// O bootstrap real importa `migrations/runMigrations.ts` (usa `import.meta`, incompatível com o
// transform CJS do ts-jest). Mockamos só o bootstrap e refazemos o wiring real no beforeAll.
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const FIL_COD = 1;
const DOC_COD = 4156;
const TIT_COD = 1;
/** 2026-05-14 07:12:46 BRT — quando a etapa entrou na fila. */
const RECEBIDO_EM = 1778753566000;
/** 2026-05-15 06:41:40 BRT — quando DANILO_LARA liberou. */
const AGIDO_EM = 1778838100000;
/** 23h 28m 54s. */
const DURACAO_ESPERADA = 84534;

interface ErpRequest {
    method: string;
    path: string;
    body: Record<string, unknown>;
    filCodHeader?: string;
}

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const listen = (app: express.Express): Promise<TestServer> =>
    new Promise((resolve) => {
        const server: Server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });

/**
 * ERP fake. Responde no formato do fio REAL — inclusive as armadilhas:
 * datas como epoch ms, envelope `{count, rows}` e o path da trilha com a chave completa.
 */
const buildErp = (): { app: express.Express; requests: ErpRequest[] } => {
    const requests: ErpRequest[] = [];
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use((req, _res, next) => {
        requests.push({
            method: req.method,
            path: req.path,
            body: (req.body ?? {}) as Record<string, unknown>,
            filCodHeader: req.header('Cnx-filCod') ?? undefined,
        });
        next();
    });

    app.post('/api/login', (_req, res) => {
        res.setHeader('Set-Cookie', 'sid=FVFAKESID; Path=/; HttpOnly');
        res.json({
            usnCod: 97,
            filCodDefault: FIL_COD,
            filiais: [
                {
                    filCod: FIL_COD,
                    filDesNome: 'COLUMBIA FV',
                    filDocFederalFmt: '00.000.000/0001-00',
                },
            ],
        });
    });

    // Universo: a tela de PESQUISA. Uma página só, com o título canônico.
    app.post('/api/psq014/list', (req, res) => {
        const pagina = Number((req.body as { pageNumber?: number }).pageNumber ?? 1);
        if (pagina > 1) {
            res.json({ count: 1, pageNumber: pagina, rows: [] });
            return;
        }
        res.json({
            count: 1,
            pageNumber: 1,
            rows: [
                {
                    filCod: FIL_COD,
                    docTip: 2,
                    docCod: DOC_COD,
                    titCod: TIT_COD,
                    docEspNumero: '17',
                    titEspNumero: '171',
                    pesCod: 5129,
                    dpeNomPessoa: 'CLONEX TECNOLOGIA LTDA',
                    titMnyValor: 11125,
                    docDtaEmissao: 1776211200000,
                    titDtaVencimento: 1777939200000,
                },
            ],
        });
    });

    // Trilha do título — o path carrega a chave inteira.
    app.post('/api/fin026/infoTitulo/list/:filCod/:docTip/:docCod/:titCod', (req, res) => {
        // O ERP real devolve vazio (sem erro) quando a filial não bate — invariante I5.
        if (Number(req.params.filCod) !== FIL_COD) {
            res.json({ count: 0, pageNumber: 1, rows: [] });
            return;
        }
        res.json({
            count: 1,
            pageNumber: 1,
            rows: [
                {
                    filCod: FIL_COD,
                    docTip: 2,
                    docCod: DOC_COD,
                    titCod: TIT_COD,
                    fblCod: 6,
                    ftbCod: 1,
                    fblDesNome: 'CONTROLLER',
                    aprovador: 'COMPRAS',
                    fbaDesNome: 'LIBERAR',
                    usnDesNomeCmd: 'DANILO_LARA',
                    ftbVldStatus: 2,
                    ftbTimBloq: RECEBIDO_EM,
                    ftbTimCmd: AGIDO_EM,
                },
            ],
        });
    });

    return { app, requests };
};

describe('E2E ingestão de aprovações — varredura contra ERP fake', () => {
    let erp: { app: express.Express; requests: ErpRequest[] };
    let erpServer: TestServer;
    let titulosSalvos: TituloAprovacao[];
    let trilhasSalvas: EtapaAprovacao[][];

    // O worker do Jest reusa o processo entre arquivos — restaurar o env impede vazamento.
    const envSnapshot = new Map<string, string | undefined>();
    const setEnv = (key: string, value: string | undefined): void => {
        if (!envSnapshot.has(key)) envSnapshot.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };

    beforeAll(async () => {
        erp = buildErp();
        erpServer = await listen(erp.app);

        setEnv('CONEXOS_BASE_URL', `${erpServer.url}/api`);
        setEnv('CONEXOS_USERNAME', 'fv-service-account');
        setEnv('CONEXOS_PASSWORD', 'fv-secret');
        setEnv('CONEXOS_FIL_COD', String(FIL_COD));
        setEnv('environment', 'local');
        setEnv('client_name', 'local');

        container.reset();

        // Wiring REAL do adapter Conexos (login/sid por HTTP contra o ERP fake).
        const { buildLegacyConexosAdapter } = await import(
            '../domain/client/legacyConexosAdapter.js'
        );
        const { default: ConexosBaseClient, LEGACY_CONEXOS_TOKEN } = await import(
            '../domain/client/ConexosBaseClient.js'
        );
        const { default: ConexosSessionResolver } = await import(
            '../domain/client/ConexosSessionResolver.js'
        );
        const resolver = container.resolve(ConexosSessionResolver);
        container.register(LEGACY_CONEXOS_TOKEN, {
            useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
        });
        container.resolve(ConexosBaseClient);

        // Gateway REAL; persistência in-memory.
        const { registerAprovacoesPorts } = await import('../domain/aprovacoesContainer.js');
        registerAprovacoesPorts();

        titulosSalvos = [];
        trilhasSalvas = [];
        const {
            TITULO_APROVACAO_REPOSITORY_TOKEN,
            ETAPA_APROVACAO_REPOSITORY_TOKEN,
            APROVACAO_INGESTAO_RUN_REPOSITORY_TOKEN,
        } = await import('../domain/interface/aprovacoes/ports.js');

        container.register(TITULO_APROVACAO_REPOSITORY_TOKEN, {
            useValue: {
                upsert: async (t: TituloAprovacao) => {
                    titulosSalvos.push(t);
                },
                findById: async () => null,
                list: async () => ({ items: [], total: 0 }),
                ultimoSnapshot: async () => null,
            },
        });
        container.register(ETAPA_APROVACAO_REPOSITORY_TOKEN, {
            useValue: {
                sincronizarTrilha: async (_c: unknown, etapas: EtapaAprovacao[]) => {
                    trilhasSalvas.push(etapas);
                },
                listByTitulo: async () => [],
                listByTitulos: async () => new Map(),
            },
        });
        container.register(APROVACAO_INGESTAO_RUN_REPOSITORY_TOKEN, {
            useValue: {
                iniciar: async () => undefined,
                salvarCursor: async () => undefined,
                finalizar: async () => undefined,
                ultimaRunRetomavel: async () => null,
            },
        });
    });

    afterAll(async () => {
        for (const [k, v] of envSnapshot) setEnv(k, v);
        await erpServer.close();
        container.reset();
    });

    it('materializa o caso canônico do doc 4156 ponta a ponta', async () => {
        const { default: IngestaoAprovacoesService } = await import(
            '../domain/service/aprovacoes/IngestaoAprovacoesService.js'
        );
        const service = container.resolve(IngestaoAprovacoesService);

        const r = await service.executar({
            filCods: [FIL_COD],
            emissaoDesde: Date.UTC(2025, 7, 1),
            triggeredBy: 'e2e',
        });

        expect(r.titulos).toBe(1);
        expect(r.etapas).toBe(1);
        expect(r.falhas).toBe(0);

        const titulo = titulosSalvos[0];
        expect(titulo?.statusWorkflow).toBe(STATUS_WORKFLOW.APROVADO);
        expect(titulo?.fornecedorNome).toBe('CLONEX TECNOLOGIA LTDA');

        const etapa = trilhasSalvas[0]?.[0];
        expect(etapa?.nome).toBe('CONTROLLER');
        expect(etapa?.alcada).toBe('COMPRAS');
        expect(etapa?.acao).toBe('LIBERAR');
        expect(etapa?.responsavelNome).toBe('DANILO_LARA');
        expect(etapa?.status).toBe(ETAPA_STATUS.CONCLUIDA);
        // A prova de que o epoch ms atravessou o fio sem perder a hora.
        expect(etapa?.duracaoSegundos).toBe(DURACAO_ESPERADA);
        expect(etapa?.recebidoEm?.getTime()).toBe(RECEBIDO_EM);
    });

    it('manda a janela de emissão como número, no formato que o ERP aceita', async () => {
        // String ISO seria recusada com 500 pelo Conexos real. Este assert é o que impede alguém
        // de "melhorar" o código trocando epoch por data legível.
        const universo = erp.requests.find((r) => r.path === '/api/psq014/list');
        const filtros = (universo?.body.filterList ?? {}) as Record<string, unknown>;

        expect(typeof filtros['docDtaEmissao#GE']).toBe('number');
        expect(filtros['docTip#EQ']).toBe(2);
    });

    it('pede a trilha com a chave completa no path e a filial no header', async () => {
        const trilha = erp.requests.find((r) => r.path.startsWith('/api/fin026/infoTitulo/list/'));

        expect(trilha?.path).toBe(`/api/fin026/infoTitulo/list/${FIL_COD}/2/${DOC_COD}/${TIT_COD}`);
        // Invariante I5: a filial vem do registro. Com a errada, o ERP devolveria vazio SEM erro.
        expect(trilha?.filCodHeader).toBe(String(FIL_COD));
    });

    it('faz login uma vez e reusa a sessão nas leituras seguintes', async () => {
        const logins = erp.requests.filter((r) => r.path === '/api/login');
        expect(logins.length).toBeLessThanOrEqual(1);
    });
});
