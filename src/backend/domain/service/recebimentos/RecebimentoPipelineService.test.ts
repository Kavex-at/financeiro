import 'reflect-metadata';
import { container } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import { RECEBIMENTO_STATUS } from '../../interface/recebimentos/constants.js';
import {
    ERP_RECEIVABLES_GATEWAY_TOKEN,
    METRICS_PORT_TOKEN,
    NDE_EMITTER_TOKEN,
} from '../../interface/recebimentos/ports.js';
import type {
    ErpReceivablesGatewayInterface,
    MetricsPortInterface,
    NdeEmitterInterface,
} from '../../interface/recebimentos/ports.js';
import { registerRecebimentosPorts } from '../../recebimentosContainer.js';
import { buildDocumentoAReceber } from '../../interface/recebimentos/__fixtures__/documentoAReceber.fixture.js';
import { buildRecebimento } from '../../interface/recebimentos/__fixtures__/recebimento.fixture.js';
import { buildTransacaoBancaria } from '../../interface/recebimentos/__fixtures__/transacaoBancaria.fixture.js';
import RecebimentoPipelineService, { type RunPipelineInput } from './RecebimentoPipelineService.js';

/**
 * A DB stub so the real-but-thin repositories resolve without a Postgres. `selectFirst` returns the
 * write-ahead status the ledger expects; `update` is a no-op; `withTransaction` runs the fn against a
 * tx whose `selectMany` echoes a RETURNING-versao row (so the aggregate save's optimistic-concurrency
 * guard sees a persisted root). Registered as `PostgreeDatabaseClient` so the repos'
 * `@inject(PostgreeDatabaseClient)` picks it up.
 */
const buildTxClient = (): jest.Mocked<TransactionClient> =>
    ({
        // INSERT ... RETURNING versao → a non-empty row keeps the optimistic guard from throwing.
        selectMany: jest.fn().mockResolvedValue([{ versao: 1 }]),
        selectFirst: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
    }) as unknown as jest.Mocked<TransactionClient>;

const buildDbStub = (selectFirstImpl?: jest.Mock) =>
    ({
        init: jest.fn().mockResolvedValue(undefined),
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: selectFirstImpl ?? jest.fn().mockResolvedValue({ status: 'reconciling' }),
        withTransaction: jest.fn(async (fn: (tx: TransactionClient) => Promise<unknown>) =>
            fn(buildTxClient()),
        ),
    }) as unknown as PostgreeDatabaseClient;

const buildInput = (overrides: Partial<RunPipelineInput> = {}): RunPipelineInput => ({
    recebimento: buildRecebimento({ status: RECEBIMENTO_STATUS.RASCUNHO }),
    transacao: buildTransacaoBancaria(),
    documentosAbertos: [buildDocumentoAReceber()],
    ingestao: {
        filCod: 4,
        periodo: { de: new Date(), ate: new Date() },
        correlationId: 'corr-0001',
        triggeredBy: 'analista',
    },
    borVldTipo: 2,
    contaDestino: '55795-4',
    dryRun: true,
    ator: 'analista',
    ...overrides,
});

describe('RecebimentoPipelineService — the stubbed coordinator', () => {
    beforeEach(() => {
        container.reset();
        container.registerInstance(PostgreeDatabaseClient, buildDbStub());
        registerRecebimentosPorts();
    });

    afterEach(() => {
        container.reset();
    });

    it('resolves from the container (proves DI wiring — not `new`)', () => {
        const service = container.resolve(RecebimentoPipelineService);
        expect(service).toBeInstanceOf(RecebimentoPipelineService);
    });

    it('runs all 5 stages end-to-end returning an enriched executado Recebimento', async () => {
        const service = container.resolve(RecebimentoPipelineService);
        const result = await service.run(buildInput());

        expect(result.status).toBe(RECEBIMENTO_STATUS.EXECUTADO);
        expect(result.aprovadoPor).toBe('analista');
        expect(result.executadoPor).toBe('analista');
        expect(result.ndeId).toBe(`stub-nde-${result.id}`);
        expect(result.resultadoExecucao).toMatchObject({ borCod: 999000, bxaCodSeq: 999001 });
    });

    it('propagates the correlation id through every metrics stage', async () => {
        const service = container.resolve(RecebimentoPipelineService);
        const result = await service.run(buildInput());
        expect(result.correlationId).toBe('corr-0001');
    });

    it('recomputes valorAlocado / diferencaNaoAlocada from the rateios (rateio stage)', async () => {
        const service = container.resolve(RecebimentoPipelineService);
        const result = await service.run(buildInput());
        // Fixture rateio aloca 15000 e valorRecebido é 15000.
        expect(result.valorAlocado).toBe(15000);
        expect(result.diferencaNaoAlocada).toBe(0);
    });

    it('short-circuits when the ledger reports alreadySettled (idempotency branch)', async () => {
        container.reset();
        const settledDb = buildDbStub(jest.fn().mockResolvedValue({ status: 'settled' }));
        container.registerInstance(PostgreeDatabaseClient, settledDb);
        registerRecebimentosPorts();

        const service = container.resolve(RecebimentoPipelineService);
        const result = await service.run(buildInput());

        // Idempotency: the run returns EXECUTADO without re-issuing baixa/NDe.
        expect(result.status).toBe(RECEBIMENTO_STATUS.EXECUTADO);
        expect(result.ndeId).toBeUndefined();
    });

    it('runs in real (non-dry-run) mode too, exercising the dryRun=false branch', async () => {
        const service = container.resolve(RecebimentoPipelineService);
        const result = await service.run(buildInput({ dryRun: false }));
        expect(result.status).toBe(RECEBIMENTO_STATUS.EXECUTADO);
        expect(result.resultadoExecucao).toMatchObject({ ndeId: `stub-nde-${result.id}` });
    });

    // ───────────────────────── testability-2 — observability + PARAM invariants
    describe('observability + PARAM invariants (testability-2)', () => {
        // A spy-able metrics instance shared with the coordinator (resolve returns transient stubs,
        // so we pin ONE instance on the TOKEN — the coordinator still injects via the token).
        const registerSpyableMetrics = (): MetricsPortInterface => {
            const metrics: MetricsPortInterface = {
                emit: jest.fn(),
                withCorrelationId: <T>(_id: string, fn: () => T): T => fn(),
            };
            container.registerInstance(METRICS_PORT_TOKEN, metrics);
            return metrics;
        };

        it('emits started+ok for every stage under the correlation id (>=10 metric asserts)', async () => {
            const metrics = registerSpyableMetrics();
            const emitSpy = metrics.emit as jest.Mock;
            const service = container.resolve(RecebimentoPipelineService);
            await service.run(buildInput());

            const stages = [
                'importarTransacoes',
                'atribuirBaixa',
                'ratearRecebimento',
                'aplicarRegras',
                'executarRecebimento',
            ];
            for (const stage of stages) {
                for (const outcome of ['started', 'ok'] as const) {
                    expect(emitSpy).toHaveBeenCalledWith(
                        expect.objectContaining({ stage, outcome, correlationId: 'corr-0001' }),
                    );
                }
            }
            // Sanity: no `error` outcome on the happy path.
            expect(emitSpy).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'error' }));
        });

        it('runs the whole pipeline inside withCorrelationId(correlationId, fn) — emits carry the id', async () => {
            const seenIds: string[] = [];
            const scopeCalls: string[] = [];
            const metrics: MetricsPortInterface = {
                emit: jest.fn((event) => {
                    seenIds.push(event.correlationId);
                }),
                withCorrelationId: <T>(id: string, fn: () => T): T => {
                    scopeCalls.push(id);
                    return fn();
                },
            };
            container.registerInstance(METRICS_PORT_TOKEN, metrics);
            const service = container.resolve(RecebimentoPipelineService);
            await service.run(buildInput());

            // The scope is opened once with the correlation id, and every emit carries that id.
            expect(scopeCalls).toEqual(['corr-0001']);
            expect(seenIds.length).toBeGreaterThanOrEqual(10);
            expect(seenIds.every((id) => id === 'corr-0001')).toBe(true);
        });

        it('passes borVldTipo/contaDestino as PARAMS to criarBordero/gravarBaixa (never hardcoded)', async () => {
            const erp: ErpReceivablesGatewayInterface = {
                criarBordero: jest.fn().mockResolvedValue({ borCod: 999000, dryRun: false }),
                gravarBaixa: jest.fn().mockResolvedValue({ bxaCodSeq: 999001, dryRun: false }),
            };
            container.registerInstance(ERP_RECEIVABLES_GATEWAY_TOKEN, erp);
            const borderoSpy = erp.criarBordero as jest.Mock;
            const baixaSpy = erp.gravarBaixa as jest.Mock;
            const service = container.resolve(RecebimentoPipelineService);
            await service.run(buildInput({ borVldTipo: 7, contaDestino: '12345-9' }));

            expect(borderoSpy).toHaveBeenCalledWith(
                expect.objectContaining({ borVldTipo: 7, contaDestino: '12345-9' }),
                expect.objectContaining({ timeoutMs: expect.any(Number) }),
            );
            expect(baixaSpy).toHaveBeenCalledWith(
                expect.objectContaining({ contaDestino: '12345-9' }),
                expect.objectContaining({ timeoutMs: expect.any(Number) }),
            );
        });
    });

    // ───────────────────────── testability-3 — FAILURE scenarios (markError / throw / IllegalTransition)
    describe('failure scenarios (testability-3 / p0-executar-recebimento-safety)', () => {
        const findExecucaoRepoUpdate = (db: PostgreeDatabaseClient): jest.Mock =>
            (db as unknown as { update: jest.Mock }).update;

        it('criarBordero rejects → markError called + metrics outcome error + rethrow', async () => {
            container.reset();
            const db = buildDbStub();
            container.registerInstance(PostgreeDatabaseClient, db);
            registerRecebimentosPorts();
            // Swap the ERP TOKEN for a rejecting mock instance (coordinator injects the same object).
            const erp: ErpReceivablesGatewayInterface = {
                criarBordero: jest
                    .fn()
                    .mockRejectedValue(Object.assign(new Error('ERP 500'), { retryable: false })),
                gravarBaixa: jest.fn(),
            };
            container.registerInstance(ERP_RECEIVABLES_GATEWAY_TOKEN, erp);
            const metrics: MetricsPortInterface = {
                emit: jest.fn(),
                withCorrelationId: <T>(_id: string, fn: () => T): T => fn(),
            };
            container.registerInstance(METRICS_PORT_TOKEN, metrics);
            const emitSpy = metrics.emit as jest.Mock;
            const updateSpy = findExecucaoRepoUpdate(db);

            const service = container.resolve(RecebimentoPipelineService);
            await expect(service.run(buildInput({ dryRun: false }))).rejects.toThrow('ERP 500');

            // markError ran (UPDATE ... status = 'error') with a derived message.
            const errorUpdate = updateSpy.mock.calls.find(([sql]: [string]) =>
                sql.includes("status = 'error'"),
            );
            expect(errorUpdate).toBeDefined();
            expect(errorUpdate?.[1]).toMatchObject({ erroMensagem: 'ERP 500' });
            expect(emitSpy).toHaveBeenCalledWith(
                expect.objectContaining({ stage: 'executarRecebimento', outcome: 'error' }),
            );
        });

        it('ndeEmitter rejects after gravarBaixa → markError preserves the borCod', async () => {
            container.reset();
            const db = buildDbStub();
            container.registerInstance(PostgreeDatabaseClient, db);
            registerRecebimentosPorts();
            const nde: NdeEmitterInterface = {
                emitir: jest
                    .fn()
                    .mockRejectedValue(
                        Object.assign(new Error('NDe timeout'), { retryable: false }),
                    ),
            };
            container.registerInstance(NDE_EMITTER_TOKEN, nde);
            const updateSpy = findExecucaoRepoUpdate(db);

            const service = container.resolve(RecebimentoPipelineService);
            await expect(service.run(buildInput({ dryRun: false }))).rejects.toThrow('NDe timeout');

            // setBorCod ran before the failing NDe (UPDATE SET bor_cod = $borCod).
            const setBorCod = updateSpy.mock.calls.find(([sql]: [string]) =>
                sql.includes('SET bor_cod = $borCod'),
            );
            expect(setBorCod?.[1]).toMatchObject({ borCod: 999000 });
            // markError persisted.
            const errorUpdate = updateSpy.mock.calls.find(([sql]: [string]) =>
                sql.includes("status = 'error'"),
            );
            expect(errorUpdate?.[1]).toMatchObject({ erroMensagem: 'NDe timeout' });
        });

        it('throws IllegalTransitionError before any ERP call when status is already EXECUTADO', async () => {
            const erp: ErpReceivablesGatewayInterface = {
                criarBordero: jest.fn().mockResolvedValue({ borCod: 999000, dryRun: false }),
                gravarBaixa: jest.fn().mockResolvedValue({ bxaCodSeq: 999001, dryRun: false }),
            };
            container.registerInstance(ERP_RECEIVABLES_GATEWAY_TOKEN, erp);
            const borderoSpy = erp.criarBordero as jest.Mock;
            const service = container.resolve(RecebimentoPipelineService);

            await expect(
                service.run(
                    buildInput({
                        recebimento: buildRecebimento({ status: RECEBIMENTO_STATUS.EXECUTADO }),
                    }),
                ),
            ).rejects.toMatchObject({ code: 'RECEBIMENTO_TRANSICAO_INVALIDA', statusCode: 409 });
            expect(borderoSpy).not.toHaveBeenCalled();
        });
    });
});
