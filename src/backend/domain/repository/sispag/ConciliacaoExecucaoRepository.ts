import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    BeginConciliacaoExecucaoInput,
    BeginConciliacaoExecucaoResult,
    ConciliacaoExecucaoRow,
    ConciliacaoExecucaoSettleData,
    ConciliacaoExecucaoStatus,
} from '../../interface/sispag/ConciliacaoExecucao.js';

const SELECT_COLS = `idempotency_key, correlation_id, fil_cod, bnc_cod, gtb_cod_seq, gar_cod_seq,
                     status, dry_run, processou, total_linhas, pagos, rejeitados,
                     varredura_incompleta, erro_mensagem, executado_por, criado_em, atualizado_em`;

/**
 * ConciliacaoExecucaoRepository — ledger write-ahead da conciliação do retorno (0050).
 *
 * Espelha `RemessaExecucaoRepository` method-for-method. `beginExecution` upserta a intenção e
 * PRESERVA `settled`: um segundo clique nunca regride o estado nem dispara um segundo
 * `processar`. SQL 100% parametrizado (Rule #5).
 */
@injectable()
export default class ConciliacaoExecucaoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    public findByIdempotencyKey = async (key: string): Promise<ConciliacaoExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT ${SELECT_COLS} FROM conciliacao_execucao WHERE idempotency_key = $key`,
            { key },
        );
        return row ? this.mapRow(row) : null;
    };

    /** Auditoria/alerta: execuções num status (`reconciling` órfão exige olhar humano). */
    public listByStatus = async (
        status: ConciliacaoExecucaoStatus,
        limit: number,
    ): Promise<ConciliacaoExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${SELECT_COLS} FROM conciliacao_execucao
             WHERE status = $status ORDER BY atualizado_em DESC LIMIT $limit`,
            { status, limit },
        );
        return rows.map((r) => this.mapRow(r as Record<string, unknown>));
    };

    /** Execuções presas em `reconciling` há mais de N minutos — ver o gêmeo da remessa. */
    public listReconcilingParadas = async (
        minutos: number,
        limit: number,
    ): Promise<ConciliacaoExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${SELECT_COLS} FROM conciliacao_execucao
             WHERE status = 'reconciling'
               AND atualizado_em < now() - ($minutos || ' minutes')::interval
             ORDER BY atualizado_em ASC LIMIT $limit`,
            { minutos: String(minutos), limit },
        );
        return rows.map((r) => this.mapRow(r as Record<string, unknown>));
    };

    /**
     * Grava a intenção ANTES do `processar`. Em dry-run entra como `pending` (não houve
     * escrita a conciliar); com escrita real entra como `reconciling`. Uma linha já `settled`
     * é preservada intacta e sinalizada por `alreadySettled` — é a trava anti-duplicação.
     */
    public beginExecution = async (
        input: BeginConciliacaoExecucaoInput,
    ): Promise<BeginConciliacaoExecucaoResult> => {
        const newStatus: ConciliacaoExecucaoStatus = input.dryRun ? 'pending' : 'reconciling';
        const row = await this.databaseClient.selectFirst<{ status: string }>(
            `INSERT INTO conciliacao_execucao (
                idempotency_key, correlation_id, fil_cod, bnc_cod, gtb_cod_seq, gar_cod_seq,
                status, dry_run, executado_por, atualizado_em
            ) VALUES (
                $key, $correlationId, $filCod, $bncCod, $gtbCodSeq, $garCodSeq,
                $newStatus, $dryRun, $executadoPor, now()
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                status = CASE WHEN conciliacao_execucao.status = 'settled'
                              THEN conciliacao_execucao.status ELSE EXCLUDED.status END,
                dry_run = CASE WHEN conciliacao_execucao.status = 'settled'
                               THEN conciliacao_execucao.dry_run ELSE EXCLUDED.dry_run END,
                executado_por = CASE WHEN conciliacao_execucao.status = 'settled'
                               THEN conciliacao_execucao.executado_por
                               ELSE EXCLUDED.executado_por END,
                atualizado_em = now()
            RETURNING status`,
            {
                key: input.idempotencyKey,
                correlationId: input.correlationId ?? null,
                filCod: input.filCod,
                bncCod: input.bncCod,
                gtbCodSeq: input.gtbCodSeq,
                garCodSeq: input.garCodSeq,
                newStatus,
                dryRun: input.dryRun,
                executadoPor: input.executadoPor,
            },
        );
        const status = (row?.status ?? newStatus) as ConciliacaoExecucaoStatus;
        return { status, alreadySettled: status === 'settled' };
    };

    /** Marca que o `processar` (irreversível) chegou a ser chamado. */
    public marcarProcessado = async (key: string): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE conciliacao_execucao SET processou = TRUE, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key },
        );
    };

    public settle = async (key: string, data: ConciliacaoExecucaoSettleData): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE conciliacao_execucao
             SET status = 'settled', processou = $processou, total_linhas = $totalLinhas,
                 pagos = $pagos, rejeitados = $rejeitados,
                 varredura_incompleta = $varreduraIncompleta, atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                processou: data.processou,
                totalLinhas: data.totalLinhas,
                pagos: data.pagos,
                rejeitados: data.rejeitados,
                varreduraIncompleta: data.varreduraIncompleta,
            },
        );
    };

    public fail = async (key: string, mensagem: string): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE conciliacao_execucao
             SET status = 'error', erro_mensagem = $mensagem, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, mensagem },
        );
    };

    private mapRow = (r: Record<string, unknown>): ConciliacaoExecucaoRow => ({
        idempotencyKey: String(r.idempotency_key),
        ...(r.correlation_id != null ? { correlationId: String(r.correlation_id) } : {}),
        filCod: Number(r.fil_cod),
        bncCod: Number(r.bnc_cod),
        gtbCodSeq: Number(r.gtb_cod_seq),
        garCodSeq: Number(r.gar_cod_seq),
        status: String(r.status) as ConciliacaoExecucaoStatus,
        dryRun: Boolean(r.dry_run),
        processou: Boolean(r.processou),
        ...(r.total_linhas != null ? { totalLinhas: Number(r.total_linhas) } : {}),
        ...(r.pagos != null ? { pagos: Number(r.pagos) } : {}),
        ...(r.rejeitados != null ? { rejeitados: Number(r.rejeitados) } : {}),
        varreduraIncompleta: Boolean(r.varredura_incompleta),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        ...(r.criado_em != null ? { criadoEm: String(r.criado_em) } : {}),
        ...(r.atualizado_em != null ? { atualizadoEm: String(r.atualizado_em) } : {}),
    });
}
