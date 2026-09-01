import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';
import AlertaRepository from '../domain/repository/operacao/AlertaRepository.js';
import ConfigDoctor from '../domain/service/operacao/ConfigDoctor.js';
import JobRunReadModel from '../domain/service/operacao/JobRunReadModel.js';
import { PIPELINE, SITUACAO_PIPELINE } from '../domain/interface/operacao/JobRun.js';

// O bootstrap real importa migrations (usa `import.meta`, incompatível com o transform CJS).
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const saudeFake = [
    {
        pipeline: PIPELINE.RECEBIMENTOS_EXTRATOS,
        rotulo: 'Recebimentos — ingestão de extratos',
        cadencia: '20 * * * *',
        limiteStalenessMs: 10_800_000,
        situacao: SITUACAO_PIPELINE.OK,
        distinguePartial: true,
        runsRecentes: [],
    },
    {
        pipeline: PIPELINE.SISPAG_REAPER,
        rotulo: 'SISPAG — reaper',
        cadencia: '10,25,40,55 * * * *',
        situacao: SITUACAO_PIPELINE.SEM_TRILHA,
        distinguePartial: false,
        runsRecentes: [],
    },
];

const alertaFake = {
    id: 3,
    tipo: 'job-parado',
    alvo: 'sispag-pagamentos',
    severidade: 'erro',
    dedupKey: 'k',
    janelaInicio: new Date('2026-09-01T12:00:00.000Z'),
    detalhe: {},
    sinkResultados: [],
    criadoEm: '2026-09-01T12:00:01.000Z',
};

interface TestServer {
    server: Server;
    url: string;
}

const listen = (app: express.Express): Promise<TestServer> =>
    new Promise((resolve) => {
        const server: Server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });

/** `res.json()` devolve `unknown` neste tsconfig — helper tipado para os asserts. */
const getJson = async (url: string, init?: RequestInit): Promise<Record<string, never>> =>
    (await (await fetch(url, init)).json()) as Record<string, never>;

let srv: TestServer;
let reconhecer: jest.Mock;
/** Tudo que a rota resolveu do container — a prova do I4. */
let resolvidos: unknown[];

beforeAll(async () => {
    reconhecer = jest.fn().mockResolvedValue(undefined);
    resolvidos = [];

    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) => {
        resolvidos.push(token);
        if (token === JobRunReadModel) {
            return { exporSaude: jest.fn().mockResolvedValue(saudeFake) };
        }
        if (token === AlertaRepository) {
            return {
                listarAbertos: jest.fn().mockResolvedValue([alertaFake]),
                reconhecer,
            };
        }
        if (token === ConfigDoctor) {
            return {
                diagnosticar: jest.fn().mockReturnValue({
                    geradoEm: '2026-09-01T12:00:00.000Z',
                    vars: [],
                    totalAusentesObrigatorias: 0,
                    totalAusentesSilenciosas: 1,
                }),
            };
        }
        return real(token as never);
    }) as never);

    const { default: operacaoRouter } = await import('./operacao.js');
    const app = express();
    app.use(express.json());
    // Autenticação já resolvida a montante no app real; aqui injetamos o usuário.
    app.use((req, _res, next) => {
        (req as express.Request & { user?: unknown }).user = { sub: 'yuri', role: 'admin' };
        next();
    });
    app.use('/operacao', operacaoRouter);
    srv = await listen(app);
});

afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((r) => srv.server.close(r));
});

describe('GET /operacao', () => {
    it('devolve pipelines, alertas e diagnóstico de configuração', async () => {
        const res = await fetch(`${srv.url}/operacao`);
        expect(res.status).toBe(200);

        const body = await getJson(`${srv.url}/operacao`);
        expect(body.pipelines).toHaveLength(2);
        expect(body.alertas).toHaveLength(1);
        expect(
            (body.configuracao as { totalAusentesSilenciosas: number }).totalAusentesSilenciosas,
        ).toBe(1);
    });

    it('inclui o pipeline sem-trilha — a tela não pode afirmar cobertura que não existe', async () => {
        const body = await getJson(`${srv.url}/operacao`);
        const pipelines = body.pipelines as unknown as { pipeline: string; situacao: string }[];
        const reaper = pipelines.find((p) => p.pipeline === PIPELINE.SISPAG_REAPER);
        expect(reaper?.situacao).toBe(SITUACAO_PIPELINE.SEM_TRILHA);
    });

    it('I4 — NÃO resolve nenhum client do ERP: é a tela que se abre com o Conexos fora', async () => {
        resolvidos.length = 0;
        await fetch(`${srv.url}/operacao`);

        const nomes = resolvidos.map((t) => (typeof t === 'function' ? t.name : String(t)));
        // Qualquer client Conexos aqui significa que a tela de incidente depende do sistema
        // que costuma ser a CAUSA do incidente.
        expect(nomes.filter((n) => n.includes('Conexos'))).toEqual([]);
        expect(nomes).toEqual(
            expect.arrayContaining(['JobRunReadModel', 'AlertaRepository', 'ConfigDoctor']),
        );
    });
});

describe('POST /operacao/alertas/:id/reconhecer', () => {
    it('reconhece com a identidade do usuário autenticado', async () => {
        const res = await fetch(`${srv.url}/operacao/alertas/3/reconhecer`, { method: 'POST' });
        expect(res.status).toBe(200);
        expect(reconhecer).toHaveBeenCalledWith(3, 'yuri');
    });

    it('rejeita id não numérico com 400', async () => {
        const res = await fetch(`${srv.url}/operacao/alertas/abc/reconhecer`, { method: 'POST' });
        expect(res.status).toBe(400);
    });

    it('rejeita id negativo com 400', async () => {
        const res = await fetch(`${srv.url}/operacao/alertas/-1/reconhecer`, { method: 'POST' });
        expect(res.status).toBe(400);
    });
});
