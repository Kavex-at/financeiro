import 'reflect-metadata';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { container } from 'tsyringe';
import { PIPELINE, SITUACAO_PIPELINE } from '../domain/interface/operacao/JobRun.js';
import JobRunReadModel from '../domain/service/operacao/JobRunReadModel.js';

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const pipeline = (over: Record<string, unknown> = {}) => ({
    pipeline: PIPELINE.RECEBIMENTOS_EXTRATOS,
    rotulo: 'Extratos',
    cadencia: '20 * * * *',
    limiteStalenessMs: 10_800_000,
    situacao: SITUACAO_PIPELINE.OK,
    distinguePartial: true,
    runsRecentes: [],
    ...over,
});

const subirCom = async (saude: unknown[]) => {
    const real = container.resolve.bind(container);
    jest.spyOn(container, 'resolve').mockImplementation(((token: unknown) =>
        token === JobRunReadModel
            ? { exporSaude: jest.fn().mockResolvedValue(saude) }
            : real(token as never)) as never);

    const { default: healthRouter } = await import('./health.js');
    const app = express();
    app.use('/health', healthRouter);
    const server: Server = await new Promise((r) => {
        const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    const { port } = server.address() as AddressInfo;
    return { server, url: `http://127.0.0.1:${port}/health/pipelines` };
};

afterEach(() => jest.restoreAllMocks());

describe("GET /health/pipelines — sonda pública do dead-man's switch", () => {
    it('200 quando tudo está em dia', async () => {
        const { server, url } = await subirCom([pipeline()]);
        const res = await fetch(url);
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ status: 'ok', pipelinesParados: 0 });
        server.close();
    });

    it('503 quando há pipeline parado — é o 503 que vira alerta no uptime checker', async () => {
        const { server, url } = await subirCom([pipeline({ situacao: SITUACAO_PIPELINE.PARADO })]);
        const res = await fetch(url);
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ status: 'degraded', pipelinesParados: 1 });
        server.close();
    });

    it('503 quando há run ABANDONADA, mesmo com a situação ainda ok', async () => {
        const { server, url } = await subirCom([
            pipeline({
                ultimaRun: {
                    runId: 'r1',
                    status: 'running',
                    startedAt: new Date(Date.now() - 20_000_000).toISOString(),
                    triggeredBy: 'cron',
                    metricas: {},
                },
            }),
        ]);
        const res = await fetch(url);
        expect(res.status).toBe(503);
        expect(await res.json()).toMatchObject({ runsAbandonadas: 1 });
        server.close();
    });

    it('`nunca-executou` e `sem-trilha` NÃO derrubam a sonda — nascer vermelha ensina a ignorar', async () => {
        const { server, url } = await subirCom([
            pipeline({ situacao: SITUACAO_PIPELINE.NUNCA_EXECUTOU }),
            pipeline({ pipeline: PIPELINE.SISPAG_REAPER, situacao: SITUACAO_PIPELINE.SEM_TRILHA }),
        ]);
        expect((await fetch(url)).status).toBe(200);
        server.close();
    });

    it('não vaza nome de pipeline, idade nem erro — é pública', async () => {
        const { server, url } = await subirCom([
            pipeline({
                situacao: SITUACAO_PIPELINE.PARADO,
                idadeDesdeUltimoSucessoMs: 99_999,
                ultimaRun: {
                    runId: 'r1',
                    status: 'error',
                    startedAt: new Date().toISOString(),
                    triggeredBy: 'cron',
                    metricas: {},
                    errorMessage: 'senha do banco invalida',
                },
            }),
        ]);
        const corpo = await (await fetch(url)).text();
        expect(corpo).not.toContain('recebimentos-extratos');
        expect(corpo).not.toContain('senha do banco invalida');
        expect(corpo).not.toContain('99999');
        server.close();
    });
});
