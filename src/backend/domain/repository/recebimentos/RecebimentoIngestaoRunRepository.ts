import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';

/** Status de uma run de ingestão de extratos. */
export type RecebimentoIngestaoStatus = 'running' | 'success' | 'partial' | 'error';

/** Trilha de auditoria de uma ingestão (`recebimento_ingestao_run`). */
export interface RecebimentoIngestaoRun {
    id: string;
    correlationId: string;
    triggeredBy: string;
    status: RecebimentoIngestaoStatus;
    filCods: number[];
    periodoDe?: string;
    periodoAte?: string;
    totalLidas: number;
    totalInseridas: number;
    totalDeduplicadas: number;
    totalContas: number;
    totalContasFalhas: number;
    errorMessage?: string;
    startedAt: string;
    finishedAt?: string;
}

interface RunRow {
    id: string;
    correlation_id: string;
    triggered_by: string;
    status: RecebimentoIngestaoStatus;
    fil_cods: number[] | null;
    periodo_de: Date | null;
    periodo_ate: Date | null;
    total_lidas: number;
    total_inseridas: number;
    total_deduplicadas: number;
    total_contas: number;
    total_contas_falhas: number;
    error_message: string | null;
    started_at: Date;
    finished_at: Date | null;
}

const COLUNAS = `id, correlation_id, triggered_by, status, fil_cods, periodo_de, periodo_ate,
                 total_lidas, total_inseridas, total_deduplicadas, total_contas,
                 total_contas_falhas, error_message, started_at, finished_at`;

/**
 * RecebimentoIngestaoRunRepository — trilha de auditoria da ingestão de extratos
 * (Frente IV, Módulo 1). Espelha `PagamentoIngestaoRunRepository`. SQL sempre
 * parametrizado. NÃO toca o ERP.
 */
@injectable()
export default class RecebimentoIngestaoRunRepository {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    private map = (r: RunRow): RecebimentoIngestaoRun => ({
        id: r.id,
        correlationId: r.correlation_id,
        triggeredBy: r.triggered_by,
        status: r.status,
        filCods: r.fil_cods ?? [],
        periodoDe: r.periodo_de ? r.periodo_de.toISOString() : undefined,
        periodoAte: r.periodo_ate ? r.periodo_ate.toISOString() : undefined,
        totalLidas: r.total_lidas,
        totalInseridas: r.total_inseridas,
        totalDeduplicadas: r.total_deduplicadas,
        totalContas: r.total_contas,
        totalContasFalhas: r.total_contas_falhas,
        errorMessage: r.error_message ?? undefined,
        startedAt: r.started_at.toISOString(),
        finishedAt: r.finished_at ? r.finished_at.toISOString() : undefined,
    });

    /** Abre uma run (`running`); devolve o `runId`. */
    public createRun = async (input: {
        correlationId: string;
        triggeredBy: string;
        filCods: number[];
        periodoDe: Date;
        periodoAte: Date;
    }): Promise<string> => {
        const id = randomUUID();
        await this.databaseClient.insert(
            `INSERT INTO recebimento_ingestao_run
                (id, correlation_id, triggered_by, status, fil_cods, periodo_de, periodo_ate)
             VALUES ($id, $correlationId, $triggeredBy, 'running', $filCods, $periodoDe, $periodoAte)`,
            {
                id,
                correlationId: input.correlationId,
                triggeredBy: input.triggeredBy,
                filCods: input.filCods,
                periodoDe: input.periodoDe,
                periodoAte: input.periodoAte,
            },
        );
        return id;
    };

    /**
     * Fecha a run. `partial` quando ao menos uma conta falhou — o painel só
     * considera `success` para dizer "carteira de HH:mm".
     */
    public finishRun = async (input: {
        runId: string;
        status: Exclude<RecebimentoIngestaoStatus, 'running'>;
        totalLidas: number;
        totalInseridas: number;
        totalDeduplicadas: number;
        totalContas: number;
        totalContasFalhas: number;
        errorMessage?: string;
    }): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE recebimento_ingestao_run
             SET status = $status, total_lidas = $totalLidas, total_inseridas = $totalInseridas,
                 total_deduplicadas = $totalDeduplicadas, total_contas = $totalContas,
                 total_contas_falhas = $totalContasFalhas, error_message = $errorMessage,
                 finished_at = now()
             WHERE id = $runId`,
            {
                runId: input.runId,
                status: input.status,
                totalLidas: input.totalLidas,
                totalInseridas: input.totalInseridas,
                totalDeduplicadas: input.totalDeduplicadas,
                totalContas: input.totalContas,
                totalContasFalhas: input.totalContasFalhas,
                errorMessage: input.errorMessage ?? null,
            },
        );
    };

    public listRecentRuns = async (limit: number): Promise<RecebimentoIngestaoRun[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT ${COLUNAS}
             FROM recebimento_ingestao_run
             ORDER BY started_at DESC
             LIMIT $limit`,
            { limit },
        )) as RunRow[];
        return rows.map(this.map);
    };

    /**
     * Fim da última run BEM-SUCEDIDA — é o que o painel exibe como "carteira de".
     * Uma run `partial` não conta: a carteira estaria incompleta e o rótulo mentiria.
     */
    public findLatestSuccessFinishedAt = async (): Promise<string | undefined> => {
        const row = await this.databaseClient.selectFirst<{ finished_at: Date }>(
            `SELECT finished_at
             FROM recebimento_ingestao_run
             WHERE status = 'success' AND finished_at IS NOT NULL
             ORDER BY finished_at DESC
             LIMIT 1`,
        );
        return row?.finished_at ? new Date(row.finished_at).toISOString() : undefined;
    };

    public findRunIdByIdempotencyKey = async (key: string): Promise<string | null> => {
        const row = await this.databaseClient.selectFirst<{ run_id: string }>(
            `SELECT run_id FROM recebimento_ingestao_idempotency WHERE idempotency_key = $key`,
            { key },
        );
        return row?.run_id ?? null;
    };

    public recordIdempotencyKey = async (key: string, runId: string): Promise<void> => {
        await this.databaseClient.insert(
            `INSERT INTO recebimento_ingestao_idempotency (idempotency_key, run_id)
             VALUES ($key, $runId)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            { key, runId },
        );
    };
}
