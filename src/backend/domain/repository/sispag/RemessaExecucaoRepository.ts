import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    BeginRemessaExecucaoInput,
    BeginRemessaExecucaoResult,
    RemessaEtapa,
    RemessaExecucaoRow,
    RemessaExecucaoStatus,
} from '../../interface/sispag/RemessaExecucao.js';

const SELECT_COLS = `idempotency_key, correlation_id, lote_id, fil_cod, bnc_cod, status, dry_run,
                     native_flp_cod, native_gab_cod, etapa, erp_response, erro_mensagem,
                     executado_por, criado_em, atualizado_em`;

/**
 * RemessaExecucaoRepository — ledger write-ahead da geração de remessa SISPAG (0049).
 *
 * Espelha `SolicitacaoNumerarioExecucaoRepository` method-for-method. `beginExecution` upserta a
 * intenção e PRESERVA `settled`: um retry nunca regride nem gera segundo lote. Cada handle nativo
 * (`flpCod`, `gabCod`) é gravado ASSIM QUE o ERP o devolve, ANTES do próximo POST — se a sequência
 * morrer no meio, a trilha aponta o lote órfão a cancelar. SQL 100% parametrizado (Rule #5).
 */
@injectable()
export default class RemessaExecucaoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    public findByIdempotencyKey = async (key: string): Promise<RemessaExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT ${SELECT_COLS} FROM remessa_execucao WHERE idempotency_key = $key`,
            { key },
        );
        return row ? this.mapRow(row) : null;
    };

    /** Auditoria: execuções de um lote, mais recentes primeiro. */
    public listByLote = async (loteId: string): Promise<RemessaExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${SELECT_COLS} FROM remessa_execucao
             WHERE lote_id = $loteId ORDER BY atualizado_em DESC`,
            { loteId },
        );
        return rows.map((r) => this.mapRow(r as Record<string, unknown>));
    };

    /** Auditoria/alerta: execuções num status (ex.: `reconciling` órfão exige olhar humano). */
    public listByStatus = async (
        status: RemessaExecucaoStatus,
        limit: number,
    ): Promise<RemessaExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${SELECT_COLS} FROM remessa_execucao
             WHERE status = $status ORDER BY atualizado_em DESC LIMIT $limit`,
            { status, limit },
        );
        return rows.map((r) => this.mapRow(r as Record<string, unknown>));
    };

    /**
     * Grava a intenção ANTES do primeiro POST. Em dry-run entra como `pending` (não houve
     * escrita a conciliar); com escrita real entra como `reconciling`. Uma linha já `settled`
     * é preservada intacta e sinalizada por `alreadySettled` — é a trava anti-duplicação.
     */
    public beginExecution = async (
        input: BeginRemessaExecucaoInput,
    ): Promise<BeginRemessaExecucaoResult> => {
        const newStatus: RemessaExecucaoStatus = input.dryRun ? 'pending' : 'reconciling';
        const row = await this.databaseClient.selectFirst<{ status: string }>(
            `INSERT INTO remessa_execucao (
                idempotency_key, correlation_id, lote_id, fil_cod, bnc_cod, status, dry_run,
                etapa, executado_por, atualizado_em
            ) VALUES (
                $key, $correlationId, $loteId, $filCod, $bncCod, $newStatus, $dryRun,
                'criar_lote', $executadoPor, now()
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                status = CASE WHEN remessa_execucao.status = 'settled'
                              THEN remessa_execucao.status ELSE EXCLUDED.status END,
                dry_run = CASE WHEN remessa_execucao.status = 'settled'
                               THEN remessa_execucao.dry_run ELSE EXCLUDED.dry_run END,
                executado_por = CASE WHEN remessa_execucao.status = 'settled'
                               THEN remessa_execucao.executado_por
                               ELSE EXCLUDED.executado_por END,
                atualizado_em = now()
            RETURNING status`,
            {
                key: input.idempotencyKey,
                correlationId: input.correlationId ?? null,
                loteId: input.loteId,
                filCod: input.filCod,
                bncCod: input.bncCod,
                newStatus,
                dryRun: input.dryRun,
                executadoPor: input.executadoPor,
            },
        );
        const status = (row?.status ?? newStatus) as RemessaExecucaoStatus;
        return { status, alreadySettled: status === 'settled' };
    };

    /**
     * Execuções presas em `reconciling` há mais de N minutos — o órfão que exige olho humano.
     *
     * Sem isto a única forma de descobrir um órfão era um operador esbarrar num 409 na tela,
     * ou alguém com acesso ao Supabase rodar SQL. O filtro de idade mora no SQL de propósito:
     * o reaper roda a cada poucos minutos e não deve trazer a tabela inteira para filtrar em
     * memória.
     */
    public listReconcilingParadas = async (
        minutos: number,
        limit: number,
    ): Promise<RemessaExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${SELECT_COLS} FROM remessa_execucao
             WHERE status = 'reconciling'
               AND atualizado_em < now() - ($minutos || ' minutes')::interval
             ORDER BY atualizado_em ASC LIMIT $limit`,
            { minutos: String(minutos), limit },
        );
        return rows.map((r) => this.mapRow(r as Record<string, unknown>));
    };

    /**
     * Persiste o `flpCod` ASSIM QUE o ERP cria o lote nativo — ANTES do import. Se o processo
     * morrer aqui, esta linha é a única pista de que existe um lote órfão no Conexos.
     */
    public setNativeFlpCod = async (key: string, flpCod: number): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE remessa_execucao
             SET native_flp_cod = $flpCod, etapa = 'importar', atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, flpCod },
        );
    };

    public setEtapa = async (key: string, etapa: RemessaEtapa): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE remessa_execucao SET etapa = $etapa, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, etapa },
        );
    };

    public setRequestPayload = async (key: string, payload: unknown): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE remessa_execucao SET request_payload = $payload::jsonb, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, payload: JSON.stringify(payload ?? null) },
        );
    };

    /** Conclusão: grava o arquivo gerado e fecha o ledger. */
    public settle = async (
        key: string,
        data: { nativeGabCod?: number; erpResponse?: unknown },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE remessa_execucao
             SET status = 'settled', etapa = 'concluido',
                 native_gab_cod = COALESCE($gabCod, native_gab_cod),
                 erp_response = COALESCE($erpResponse::jsonb, erp_response),
                 atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                gabCod: data.nativeGabCod ?? null,
                erpResponse: data.erpResponse === undefined ? null : JSON.stringify(data.erpResponse),
            },
        );
    };

    public fail = async (
        key: string,
        data: { mensagem: string; erpResponse?: unknown },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE remessa_execucao
             SET status = 'error', erro_mensagem = $mensagem,
                 erp_response = COALESCE($erpResponse::jsonb, erp_response),
                 atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                mensagem: data.mensagem.slice(0, 2000),
                erpResponse: data.erpResponse === undefined ? null : JSON.stringify(data.erpResponse),
            },
        );
    };

    private mapRow = (r: Record<string, unknown>): RemessaExecucaoRow => ({
        idempotencyKey: String(r.idempotency_key),
        ...(r.correlation_id != null ? { correlationId: String(r.correlation_id) } : {}),
        loteId: String(r.lote_id),
        filCod: Number(r.fil_cod),
        bncCod: Number(r.bnc_cod),
        status: String(r.status) as RemessaExecucaoStatus,
        dryRun: Boolean(r.dry_run),
        ...(r.native_flp_cod != null ? { nativeFlpCod: Number(r.native_flp_cod) } : {}),
        ...(r.native_gab_cod != null ? { nativeGabCod: Number(r.native_gab_cod) } : {}),
        ...(r.etapa != null ? { etapa: String(r.etapa) as RemessaEtapa } : {}),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        ...(r.criado_em != null ? { criadoEm: String(r.criado_em) } : {}),
        ...(r.atualizado_em != null ? { atualizadoEm: String(r.atualizado_em) } : {}),
    });
}
