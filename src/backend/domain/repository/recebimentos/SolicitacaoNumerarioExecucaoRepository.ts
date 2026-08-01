import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    BeginSolicitacaoNumerarioExecucaoInput,
    BeginSolicitacaoNumerarioExecucaoResult,
    RecebimentoExecucaoStatus,
    SolicitacaoNumerarioExecucaoErrorData,
    SolicitacaoNumerarioExecucaoRepositoryInterface,
    SolicitacaoNumerarioExecucaoRow,
    SolicitacaoNumerarioExecucaoSettleData,
} from '../../interface/recebimentos/ports.js';

/**
 * SolicitacaoNumerarioExecucaoRepository — ledger write-ahead da execução da SN (0041). Espelha
 * `RecebimentoExecucaoRepository`: `beginExecution` upserta a intenção (`reconciling`/`pending`) e
 * PRESERVA `settled` (idempotência — retry nunca regride nem duplica a SN). O handle de reconciliação é
 * o `docCod` (o com299 é multi-call). SQL 100% parametrizado (Rule #5).
 */
@injectable()
export default class SolicitacaoNumerarioExecucaoRepository
    implements SolicitacaoNumerarioExecucaoRepositoryInterface
{
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public findByIdempotencyKey = async (
        key: string,
    ): Promise<SolicitacaoNumerarioExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT idempotency_key, correlation_id, fil_cod, pri_cod, status, dry_run, doc_cod,
                    erp_response, erro_mensagem, executado_por, criado_em, atualizado_em
             FROM solicitacao_numerario_execucao
             WHERE idempotency_key = $key`,
            { key },
        );
        return row ? this.mapRow(row) : null;
    };

    public beginExecution = async (
        input: BeginSolicitacaoNumerarioExecucaoInput,
    ): Promise<BeginSolicitacaoNumerarioExecucaoResult> => {
        const newStatus: RecebimentoExecucaoStatus = input.dryRun ? 'pending' : 'reconciling';
        const row = await this.databaseClient.selectFirst<{ status: string }>(
            `INSERT INTO solicitacao_numerario_execucao (
                idempotency_key, correlation_id, fil_cod, pri_cod, status, dry_run, executado_por,
                atualizado_em
            ) VALUES (
                $key, $correlationId, $filCod, $priCod, $newStatus, $dryRun, $executadoPor, now()
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                status = CASE WHEN solicitacao_numerario_execucao.status = 'settled'
                              THEN solicitacao_numerario_execucao.status ELSE EXCLUDED.status END,
                dry_run = CASE WHEN solicitacao_numerario_execucao.status = 'settled'
                               THEN solicitacao_numerario_execucao.dry_run ELSE EXCLUDED.dry_run END,
                executado_por = CASE WHEN solicitacao_numerario_execucao.status = 'settled'
                               THEN solicitacao_numerario_execucao.executado_por
                               ELSE EXCLUDED.executado_por END,
                atualizado_em = now()
            RETURNING status`,
            {
                key: input.idempotencyKey,
                correlationId: input.correlationId ?? null,
                filCod: input.filCod,
                priCod: input.priCod,
                newStatus,
                dryRun: input.dryRun,
                executadoPor: input.executadoPor,
            },
        );
        const status = (row?.status ?? newStatus) as RecebimentoExecucaoStatus;
        return { status, alreadySettled: status === 'settled' };
    };

    public setDocCod = async (key: string, docCod: number): Promise<void> => {
        // Persiste o docCod ASSIM QUE o cabeçalho é criado — ANTES do próximo POST (Regis
        // fault-tolerance-2): se a sequência morrer no meio, a trilha aponta o documento órfão.
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao
             SET doc_cod = $docCod, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, docCod },
        );
    };

    public setRequestPayload = async (key: string, payload: unknown): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao
             SET request_payload = $payload::jsonb, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, payload: JSON.stringify(payload ?? null) },
        );
    };

    public markSettled = async (
        key: string,
        data: SolicitacaoNumerarioExecucaoSettleData,
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao SET
                status = 'settled',
                doc_cod = $docCod,
                erp_response = $erpResponse::jsonb,
                erro_mensagem = NULL,
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                docCod: data.docCod ?? null,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
            },
        );
    };

    public markError = async (
        key: string,
        data: SolicitacaoNumerarioExecucaoErrorData,
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao SET
                status = 'error',
                erro_mensagem = $erroMensagem,
                erp_response = $erpResponse::jsonb,
                doc_cod = COALESCE($docCod, doc_cod),
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                erroMensagem: data.erroMensagem,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
                docCod: data.docCod ?? null,
            },
        );
    };

    private mapRow = (r: Record<string, unknown>): SolicitacaoNumerarioExecucaoRow => ({
        idempotencyKey: String(r.idempotency_key),
        ...(r.correlation_id != null ? { correlationId: String(r.correlation_id) } : {}),
        filCod: Number(r.fil_cod),
        priCod: Number(r.pri_cod),
        status: r.status as RecebimentoExecucaoStatus,
        dryRun: Boolean(r.dry_run),
        ...(r.doc_cod != null ? { docCod: Number(r.doc_cod) } : {}),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        criadoEm: new Date(r.criado_em as string | Date),
        atualizadoEm: new Date(r.atualizado_em as string | Date),
    });
}
