import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    BeginSolicitacaoNumerarioExecucaoInput,
    BeginSolicitacaoNumerarioExecucaoResult,
    RecebimentoExecucaoStatus,
    SolicitacaoNumerarioEtapa,
    SolicitacaoNumerarioExecucaoErrorData,
    SolicitacaoNumerarioExecucaoRepositoryInterface,
    SolicitacaoNumerarioExecucaoRow,
    SolicitacaoNumerarioExecucaoSettleData,
} from '../../interface/recebimentos/ports.js';

/** Colunas lidas — inclui a leg FISCAL (0042): txn_id/valor/fin014_bor_cod/nd_doc_cod/etapa/flags. */
const SELECT_COLS = `idempotency_key, correlation_id, fil_cod, pri_cod, txn_id, valor, status, dry_run,
                     doc_cod, fin014_bor_cod, nd_doc_cod, etapa, revisao_humana, nde_autorizado,
                     erp_response, erro_mensagem, executado_por, criado_em, atualizado_em`;

/**
 * SolicitacaoNumerarioExecucaoRepository — ledger write-ahead da execução da SN (0041) estendido para
 * o fluxo REAL payment-driven (0042). Espelha `NumerarioExecucaoRepository` (permutas) method-for-method:
 * `beginExecution` upserta a intenção (`reconciling`/`pending`) e PRESERVA `settled` (idempotência —
 * retry nunca regride nem duplica a SN). Cada etapa (SN → fin014 → nota-débito → fiscal → obs →
 * homologar → poll) grava o handle correspondente ASSIM QUE confirmada, ANTES do próximo POST — se a
 * sequência morrer no meio, a trilha aponta o documento órfão e a re-execução RETOMA. SQL 100%
 * parametrizado (Rule #5).
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
            `SELECT ${SELECT_COLS}
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
                idempotency_key, correlation_id, fil_cod, pri_cod, txn_id, valor, status, dry_run,
                executado_por, atualizado_em
            ) VALUES (
                $key, $correlationId, $filCod, $priCod, $txnId, $valor, $newStatus, $dryRun,
                $executadoPor, now()
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
                txnId: input.txnId ?? null,
                valor: input.valor ?? null,
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
             SET doc_cod = $docCod, etapa = 'sn', atualizado_em = now()
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

    /** Tela 2: grava o borderô do recebimento fin014 + avança a etapa (retomada anti-duplicação). */
    public setFin014BorCod = async (key: string, borCod: number): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao
             SET fin014_bor_cod = $borCod, etapa = 'fin014-done', atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, borCod },
        );
    };

    /** Tela 3: grava o docCod da nota de débito com297 (retomada anti-duplicação). */
    public setNdDocCod = async (key: string, docCod: number): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao
             SET nd_doc_cod = $docCod, etapa = 'nota-debito', atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, docCod },
        );
    };

    /** Avança a etapa alcançada (leg fiscal: fiscal-done / obs-done / homologado / concluido). */
    public setEtapa = async (key: string, etapa: SolicitacaoNumerarioEtapa): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao SET etapa = $etapa, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, etapa },
        );
    };

    /** Sinaliza revisão humana (homologou com validações pendentes — com194). */
    public setRevisaoHumana = async (key: string, revisao: boolean): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao
             SET revisao_humana = $revisao, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, revisao },
        );
    };

    /** Sinaliza que a SEFAZ autorizou a NDe (poll `vldAutorizado != 0`). */
    public setNdeAutorizado = async (key: string, autorizado: boolean): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao
             SET nde_autorizado = $autorizado, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, autorizado },
        );
    };

    public markSettled = async (
        key: string,
        data: SolicitacaoNumerarioExecucaoSettleData,
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario_execucao SET
                status = 'settled',
                doc_cod = COALESCE($docCod, doc_cod),
                nd_doc_cod = COALESCE($ndDocCod, nd_doc_cod),
                etapa = 'concluido',
                erp_response = $erpResponse::jsonb,
                erro_mensagem = NULL,
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                docCod: data.docCod ?? null,
                ndDocCod: data.ndDocCod ?? null,
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
                etapa = COALESCE($etapa, etapa),
                erro_mensagem = $erroMensagem,
                erp_response = $erpResponse::jsonb,
                doc_cod = COALESCE($docCod, doc_cod),
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                etapa: data.etapa ?? null,
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
        ...(r.txn_id != null ? { txnId: String(r.txn_id) } : {}),
        ...(r.valor != null ? { valor: Number(r.valor) } : {}),
        ...(r.fin014_bor_cod != null ? { fin014BorCod: Number(r.fin014_bor_cod) } : {}),
        ...(r.nd_doc_cod != null ? { ndDocCod: Number(r.nd_doc_cod) } : {}),
        ...(r.etapa != null ? { etapa: r.etapa as SolicitacaoNumerarioEtapa } : {}),
        ...(r.revisao_humana != null ? { revisaoHumana: Boolean(r.revisao_humana) } : {}),
        ...(r.nde_autorizado != null ? { ndeAutorizado: Boolean(r.nde_autorizado) } : {}),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        criadoEm: new Date(r.criado_em as string | Date),
        atualizadoEm: new Date(r.atualizado_em as string | Date),
    });
}
