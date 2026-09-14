import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';
import MetricasCicloService from '../domain/service/metricas/MetricasCicloService.js';

// O bootstrap real importa migrations (usa `import.meta`, incompatível com o transform CJS).
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const leituraFake = {
    serieInicio: '2026-09-11T20:00:00',
    metricas: [
        {
            frente: 'Permutas (Frente I)',
            metrica: 'permutas_baixas_concluidas_pct',
            rotulo: 'baixas de adiantamento concluídas, com borderô finalizado — 12 de 13 tentativas',
            valor: 92.3,
            unidade: '%',
            janela_inicio: '2026-09-11T20:00:00',
            janela_fim: '2026-09-18T20:00:00',
            baseline: null,
            baseline_desc: 'sem medição do processo manual',
            parcial: true,
            apurado_ate: '2026-09-18T15:02:00',
        },
    ],
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

let srv: TestServer;
let ler: jest.Mock;
/** Tudo que a rota resolveu do container — a prova de que não toca o ERP. */
let resolvidos: unknown[];

beforeAll(async () => {
    ler = jest.fn().mockResolvedValue(leituraFake);
    resolvidos = [];

    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) => {
        resolvidos.push(token);
        if (token === MetricasCicloService) return { ler };
        return real(token as never);
    }) as never);

    const { default: metricasRouter } = await import('./metricas.js');
    const app = express();
    app.use(express.json());
    app.use('/metricas', metricasRouter);
    srv = await listen(app);
});

afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise((r) => srv.server.close(r));
});

beforeEach(() => {
    ler.mockClear();
});

describe('GET /metricas/ciclo', () => {
    it('devolve a série e as linhas: os 9 campos do contrato, depois parcial e apurado_ate', async () => {
        const res = await fetch(`${srv.url}/metricas/ciclo`);

        expect(res.status).toBe(200);
        const body = (await res.json()) as typeof leituraFake;
        expect(body).toEqual(leituraFake);
        expect(Object.keys(body.metricas[0])).toEqual([
            'frente',
            'metrica',
            'rotulo',
            'valor',
            'unidade',
            'janela_inicio',
            'janela_fim',
            'baseline',
            'baseline_desc',
            'parcial',
            'apurado_ate',
        ]);
    });

    it('repassa inicio/fim ao serviço', async () => {
        await fetch(`${srv.url}/metricas/ciclo?inicio=2026-09-11&fim=2026-09-18T20:00:00`);

        expect(ler).toHaveBeenCalledWith({ inicio: '2026-09-11', fim: '2026-09-18T20:00:00' });
    });

    it('recusa data com fuso ou formato livre — a janela é hora de São Paulo', async () => {
        for (const fim of ['2026-09-18T20:00:00Z', '18/09/2026', 'semana-passada']) {
            const res = await fetch(`${srv.url}/metricas/ciclo?fim=${encodeURIComponent(fim)}`);
            expect(res.status).toBe(400);
        }
        expect(ler).not.toHaveBeenCalled();
    });

    it('não resolve nenhum client do ERP', async () => {
        resolvidos.length = 0;
        await fetch(`${srv.url}/metricas/ciclo`);

        const nomes = resolvidos.map((t) => (typeof t === 'function' ? t.name : String(t)));
        expect(nomes.some((n) => /Conexos/i.test(n))).toBe(false);
    });
});
