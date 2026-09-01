import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { redactErrorMessage } from '../../../http/redact.js';
import type { JobRunStatus } from '../../interface/operacao/JobRun.js';

export interface JobExecucao {
    id: string;
    pipeline: string;
    triggeredBy: string;
    status: JobRunStatus;
    metricas: Record<string, number>;
    errorMessage?: string;
    startedAt: string;
    finishedAt?: string;
}

interface Row {
    id: string;
    pipeline: string;
    triggered_by: string;
    status: JobRunStatus;
    metricas: Record<string, number> | null;
    error_message: string | null;
    started_at: Date;
    finished_at: Date | null;
}

const COLUNAS = `id, pipeline, triggered_by, status, metricas, error_message, started_at, finished_at`;

/**
 * JobExecucaoRepository — trilha dos jobs NOVOS (ADR-0042, migration 0053).
 *
 * Espelha `RecebimentoIngestaoRunRepository`, mas com `partial` desde o nascimento: um job novo não
 * herda a cegueira do SISPAG, que fecha `success` mesmo com filial falhada.
 *
 * SQL parametrizado. NÃO toca o ERP.
 */
@injectable()
export default class JobExecucaoRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    private map = (r: Row): JobExecucao => ({
        id: r.id,
        pipeline: r.pipeline,
        triggeredBy: r.triggered_by,
        status: r.status,
        metricas: r.metricas ?? {},
        ...(r.error_message !== null ? { errorMessage: r.error_message } : {}),
        startedAt: r.started_at.toISOString(),
        ...(r.finished_at ? { finishedAt: r.finished_at.toISOString() } : {}),
    });

    public createRun = async (input: {
        pipeline: string;
        triggeredBy: string;
    }): Promise<string> => {
        const id = randomUUID();
        await this.databaseClient.insert(
            `INSERT INTO job_execucao (id, pipeline, triggered_by, status)
             VALUES ($id, $pipeline, $triggeredBy, 'running')`,
            { id, pipeline: input.pipeline, triggeredBy: input.triggeredBy },
        );
        return id;
    };

    public finishRun = async (input: {
        runId: string;
        status: Exclude<JobRunStatus, 'running'>;
        metricas?: Record<string, number>;
        errorMessage?: string;
    }): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE job_execucao
                SET status = $status, metricas = $metricas,
                    error_message = $errorMessage, finished_at = now()
              WHERE id = $runId`,
            {
                runId: input.runId,
                status: input.status,
                metricas: JSON.stringify(input.metricas ?? {}),
                // Redigido NA FRONTEIRA DE ESCRITA, não no chamador: assim vale para todo job
                // presente e futuro sem depender de cada autor lembrar. Mensagem de erro de infra
                // carrega credencial no corpo (`password authentication failed for user "…"`,
                // connection string inteira), e isto aqui é PERSISTIDO e renderizado no painel.
                errorMessage:
                    input.errorMessage === undefined
                        ? null
                        : redactErrorMessage(input.errorMessage),
            },
        );
    };

    public listRecentRuns = async (pipeline: string, limit: number): Promise<JobExecucao[]> => {
        const rows: Row[] = await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM job_execucao
              WHERE pipeline = $pipeline
              ORDER BY started_at DESC
              LIMIT $limit`,
            { pipeline, limit },
        );
        return rows.map((r) => this.map(r));
    };
}
