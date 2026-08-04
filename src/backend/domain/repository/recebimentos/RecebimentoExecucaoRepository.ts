import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    BeginRecebimentoExecucaoInput,
    BeginRecebimentoExecucaoResult,
    RecebimentoExecucaoErrorData,
    RecebimentoExecucaoRepositoryInterface,
    RecebimentoExecucaoRow,
    RecebimentoExecucaoSettleData,
    RecebimentoExecucaoStatus,
} from '../../interface/recebimentos/ports.js';

/**
 * RecebimentoExecucaoRepository — ledger write-ahead da execução (0035). Espelha
 * `PermutaExecucaoRepository`: `beginExecution` upserta a intenção (`reconciling`/`pending`) e
 * PRESERVA `settled` (idempotência — retry nunca regride nem duplica quitação/NDe). SQL 100%
 * parametrizado (Rule #5).
 */
@injectable()
export default class RecebimentoExecucaoRepository
    implements RecebimentoExecucaoRepositoryInterface
{
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public findByIdempotencyKey = async (key: string): Promise<RecebimentoExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT idempotency_key, recebimento_id, fil_cod, status, dry_run, bor_cod, nde_id,
                    erp_response, erro_mensagem, executado_por, criado_em, atualizado_em
             FROM recebimento_execucao
             WHERE idempotency_key = $key`,
            { key },
        );
        return row ? this.mapRow(row) : null;
    };

    public beginExecution = async (
        input: BeginRecebimentoExecucaoInput,
    ): Promise<BeginRecebimentoExecucaoResult> => {
        const newStatus: RecebimentoExecucaoStatus = input.dryRun ? 'pending' : 'reconciling';
        const row = await this.databaseClient.selectFirst<{ status: string }>(
            `INSERT INTO recebimento_execucao (
                idempotency_key, recebimento_id, fil_cod, status, dry_run, executado_por, atualizado_em
            ) VALUES (
                $key, $recebimentoId, $filCod, $newStatus, $dryRun, $executadoPor, now()
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                status = CASE WHEN recebimento_execucao.status = 'settled'
                              THEN recebimento_execucao.status ELSE EXCLUDED.status END,
                dry_run = CASE WHEN recebimento_execucao.status = 'settled'
                               THEN recebimento_execucao.dry_run ELSE EXCLUDED.dry_run END,
                executado_por = CASE WHEN recebimento_execucao.status = 'settled'
                               THEN recebimento_execucao.executado_por ELSE EXCLUDED.executado_por END,
                atualizado_em = now()
            RETURNING status`,
            {
                key: input.idempotencyKey,
                recebimentoId: input.recebimentoId,
                filCod: input.filCod,
                newStatus,
                dryRun: input.dryRun,
                executadoPor: input.executadoPor,
            },
        );
        const status = (row?.status ?? newStatus) as RecebimentoExecucaoStatus;
        return { status, alreadySettled: status === 'settled' };
    };

    public setBorCod = async (key: string, borCod: number): Promise<void> => {
        // Persiste o borCod ASSIM QUE o borderô é criado — ANTES do próximo POST (Regis
        // fault-tolerance-2): se o processo morrer no meio, a trilha aponta o borderô órfão a conciliar.
        await this.databaseClient.update(
            `UPDATE recebimento_execucao
             SET bor_cod = $borCod, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, borCod },
        );
    };

    public setRequestPayload = async (key: string, payload: unknown): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE recebimento_execucao
             SET request_payload = $payload::jsonb, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, payload: JSON.stringify(payload ?? null) },
        );
    };

    public markSettled = async (
        key: string,
        data: RecebimentoExecucaoSettleData,
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE recebimento_execucao SET
                status = 'settled',
                bor_cod = $borCod,
                nde_id = $ndeId,
                erp_response = $erpResponse::jsonb,
                erro_mensagem = NULL,
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                borCod: data.borCod ?? null,
                ndeId: data.ndeId ?? null,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
            },
        );
    };

    public markError = async (key: string, data: RecebimentoExecucaoErrorData): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE recebimento_execucao SET
                status = 'error',
                erro_mensagem = $erroMensagem,
                erp_response = $erpResponse::jsonb,
                bor_cod = COALESCE($borCod, bor_cod),
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                erroMensagem: data.erroMensagem,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
                borCod: data.borCod ?? null,
            },
        );
    };

    private mapRow = (r: Record<string, unknown>): RecebimentoExecucaoRow => ({
        idempotencyKey: String(r.idempotency_key),
        recebimentoId: String(r.recebimento_id),
        filCod: Number(r.fil_cod),
        status: r.status as RecebimentoExecucaoStatus,
        dryRun: Boolean(r.dry_run),
        ...(r.bor_cod != null ? { borCod: Number(r.bor_cod) } : {}),
        ...(r.nde_id != null ? { ndeId: String(r.nde_id) } : {}),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        criadoEm: new Date(r.criado_em as string | Date),
        atualizadoEm: new Date(r.atualizado_em as string | Date),
    });
}
