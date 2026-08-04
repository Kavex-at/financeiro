import { inject, injectable } from 'tsyringe';
import BoundedConcurrency from '../../../libs/concurrency/BoundedConcurrency.js';
import {
    FANOUT_LIMIT_RECEBIMENTOS,
    RECEBIMENTO_INGEST_LOCK_KEY,
} from '../../../interface/recebimentos/constants.js';
import type {
    IngestaoTransacoesInput,
    IngestaoTransacoesInterface,
    IngestaoTransacoesResult,
    RunManyIngestaoInput,
} from '../../../interface/recebimentos/ports.js';

/**
 * SKELETON stub — IngestaoTransacoesInterface. Deterministic, no DB/network. `run` returns an empty
 * run; `runMany` fans out over N filiais through the injected `BoundedConcurrency` (bound
 * `FANOUT_LIMIT_RECEBIMENTOS`) so the Fase-1 consumer inherits the SISPAG anti-burst pattern by
 * construction (Regis performance-1). Módulo 1 swaps this token for the real ingest service
 * (advisory-lock via `advisoryLockKey`/idempotency, Fase 1).
 */
@injectable()
export default class IngestaoTransacoesStub implements IngestaoTransacoesInterface {
    public readonly advisoryLockKey: number = RECEBIMENTO_INGEST_LOCK_KEY;

    constructor(
        @inject(BoundedConcurrency)
        private bounded: BoundedConcurrency,
    ) {}

    public run = async (input: IngestaoTransacoesInput): Promise<IngestaoTransacoesResult> => {
        return {
            runId: `stub-run-${input.correlationId}`,
            importadas: [],
            total: 0,
            deduplicadas: 0,
            inseridas: 0,
        };
    };

    public runMany = async (input: RunManyIngestaoInput): Promise<IngestaoTransacoesResult> => {
        // Bounded fan-out — NEVER `Promise.all` over all filiais (SISPAG LOGIN_ERROR_MAX_SESSIONS).
        const settled = await this.bounded.run(
            input.filCods,
            async (filCod) =>
                this.run({
                    filCod,
                    periodo: input.periodo,
                    correlationId: input.correlationId,
                    triggeredBy: input.triggeredBy,
                }),
            FANOUT_LIMIT_RECEBIMENTOS,
        );
        const importadas = settled.flatMap((s) =>
            s.status === 'fulfilled' ? (s.value.importadas ?? []) : [],
        );
        const total = settled.reduce(
            (n, s) => n + (s.status === 'fulfilled' ? s.value.total : 0),
            0,
        );
        const deduplicadas = settled.reduce(
            (n, s) => n + (s.status === 'fulfilled' ? s.value.deduplicadas : 0),
            0,
        );
        const inseridas = settled.reduce(
            (n, s) => n + (s.status === 'fulfilled' ? s.value.inseridas : 0),
            0,
        );
        return {
            runId: `stub-run-many-${input.correlationId}`,
            importadas,
            total,
            deduplicadas,
            inseridas,
        };
    };
}
