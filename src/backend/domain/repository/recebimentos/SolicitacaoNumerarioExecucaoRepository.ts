import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { EXECUCAO_INTERROMPIDA_MINUTOS } from '../../interface/recebimentos/constants.js';
import type {
    BeginSolicitacaoNumerarioExecucaoInput,
    BeginSolicitacaoNumerarioExecucaoResult,
    RecebimentoExecucaoStatus,
    SolicitacaoNumerarioEtapa,
    SolicitacaoNumerarioExecucaoErrorData,
    SolicitacaoNumerarioExecucaoRepositoryInterface,
    SolicitacaoNumerarioExecucaoRow,
    SolicitacaoNumerarioExecucaoSettleData,
    UltimaFalhaExecucao,
} from '../../interface/recebimentos/ports.js';

/** Colunas lidas — inclui a leg FISCAL (0042): txn_id/valor/fin014_bor_cod/nd_doc_cod/etapa/flags. */
const SELECT_COLS = `idempotency_key, correlation_id, fil_cod, pri_cod, txn_id, valor, status, dry_run,
                     doc_cod, fin014_bor_cod, nd_doc_cod, etapa, revisao_humana, nde_autorizado,
                     pri_vld_tipo, nde_dispensada,
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

    /** Auditoria: todas as execuções (alocações) de uma transação bancária, mais recentes primeiro. */
    public listByTxnId = async (txnId: string): Promise<SolicitacaoNumerarioExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${SELECT_COLS}
             FROM solicitacao_numerario_execucao
             WHERE txn_id = $txnId
             ORDER BY atualizado_em DESC`,
            { txnId },
        );
        return rows.map((r) => this.mapRow(r as Record<string, unknown>));
    };

    /** Auditoria: execuções por status (ex.: `error`, `reconciling`), mais recentes primeiro, com teto. */
    public listByStatus = async (
        status: string,
        limit: number,
    ): Promise<SolicitacaoNumerarioExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${SELECT_COLS}
             FROM solicitacao_numerario_execucao
             WHERE status = $status
             ORDER BY atualizado_em DESC
             LIMIT $limit`,
            { status, limit },
        );
        return rows.map((r) => this.mapRow(r as Record<string, unknown>));
    };

    public beginExecution = async (
        input: BeginSolicitacaoNumerarioExecucaoInput,
    ): Promise<BeginSolicitacaoNumerarioExecucaoResult> => {
        const newStatus: RecebimentoExecucaoStatus = input.dryRun ? 'pending' : 'reconciling';
        const row = await this.databaseClient.selectFirst<{ status: string }>(
            `INSERT INTO solicitacao_numerario_execucao (
                idempotency_key, correlation_id, fil_cod, pri_cod, txn_id, valor, status, dry_run,
                pri_vld_tipo, nde_dispensada, executado_por, atualizado_em
            ) VALUES (
                $key, $correlationId, $filCod, $priCod, $txnId, $valor, $newStatus, $dryRun,
                $priVldTipo, $ndeDispensada, $executadoPor, now()
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                status = CASE WHEN solicitacao_numerario_execucao.status = 'settled'
                              THEN solicitacao_numerario_execucao.status ELSE EXCLUDED.status END,
                dry_run = CASE WHEN solicitacao_numerario_execucao.status = 'settled'
                               THEN solicitacao_numerario_execucao.dry_run ELSE EXCLUDED.dry_run END,
                executado_por = CASE WHEN solicitacao_numerario_execucao.status = 'settled'
                               THEN solicitacao_numerario_execucao.executado_por
                               ELSE EXCLUDED.executado_por END,
                -- A modalidade é fato da execução: uma linha já settled NUNCA a reescreve (mesma
                -- guarda de status/dry_run/executado_por). Um retry só a preenche se faltava.
                pri_vld_tipo = CASE WHEN solicitacao_numerario_execucao.status = 'settled'
                               THEN solicitacao_numerario_execucao.pri_vld_tipo
                               ELSE COALESCE(EXCLUDED.pri_vld_tipo, solicitacao_numerario_execucao.pri_vld_tipo) END,
                nde_dispensada = CASE WHEN solicitacao_numerario_execucao.status = 'settled'
                               THEN solicitacao_numerario_execucao.nde_dispensada
                               ELSE COALESCE(EXCLUDED.nde_dispensada, solicitacao_numerario_execucao.nde_dispensada) END,
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
                priVldTipo: input.priVldTipo ?? null,
                ndeDispensada: input.ndeDispensada ?? null,
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

    /**
     * Modalidade REAL por transação, em lote (ADR-0033).
     *
     * `DISTINCT ON (txn_id) ... ORDER BY atualizado_em DESC` devolve a alocação MAIS RECENTE de cada
     * crédito. Um crédito rateado pode ter várias, potencialmente de modalidades diferentes; a mais
     * recente é a que o analista acabou de ver na tela. Só linhas com `pri_vld_tipo` preenchido
     * entram — execução anterior à coluna não deve virar um rótulo inventado.
     */
    public listModalidadePorTxnIds = async (
        txnIds: string[],
    ): Promise<Map<string, { priVldTipo?: number; ndeDispensada?: boolean }>> => {
        if (txnIds.length === 0) return new Map();
        const rows = await this.databaseClient.selectMany(
            `SELECT DISTINCT ON (txn_id) txn_id, pri_vld_tipo, nde_dispensada
               FROM solicitacao_numerario_execucao
              WHERE txn_id = ANY($txnIds) AND pri_vld_tipo IS NOT NULL
              ORDER BY txn_id, atualizado_em DESC`,
            { txnIds },
        );
        const out = new Map<string, { priVldTipo?: number; ndeDispensada?: boolean }>();
        for (const raw of rows) {
            const r = raw as Record<string, unknown>;
            out.set(String(r.txn_id), {
                ...(r.pri_vld_tipo != null ? { priVldTipo: Number(r.pri_vld_tipo) } : {}),
                ...(r.nde_dispensada != null ? { ndeDispensada: Boolean(r.nde_dispensada) } : {}),
            });
        }
        return out;
    };

    /**
     * Σ das alocações JÁ EXECUTADAS de um crédito (ADR-0034) — decide `parcial` × `processada`.
     *
     * `status = 'settled' AND dry_run = FALSE`: a chave de idempotência é
     * `sn-real:{txnId}:{priCod}:{valor}`, então somar todos os status contaria duas vezes uma
     * alocação que foi tentada com valores diferentes. Só o que settlou de verdade é dinheiro movido.
     *
     * Zero linhas → `undefined` (indeterminado). Linhas com `valor` nulo (anteriores à 0042) são
     * puladas pelo `SUM`, o que só pode SUBESTIMAR a Σ — direção segura, nunca esconde dinheiro.
     */
    public somarSettledPorTxnId = async (txnId: string): Promise<number | undefined> => {
        const row = await this.databaseClient.selectFirst<{ total: unknown; linhas: unknown }>(
            `SELECT SUM(valor) AS total, COUNT(*) AS linhas
               FROM solicitacao_numerario_execucao
              WHERE txn_id = $txnId AND status = 'settled' AND dry_run = FALSE`,
            { txnId },
        );
        if (!row || Number(row.linhas ?? 0) === 0) return undefined;
        return row.total == null ? 0 : Number(row.total);
    };

    /**
     * Última falha de cada crédito, em lote (ADR-0034) — a aba Falhas do painel.
     *
     * Inclui execuções presas em `reconciling` além da janela: o processo morreu entre o
     * `beginExecution` e o fecho, e nada no sistema mostrava isso até agora. Vêm marcadas
     * `interrompida` para a tela rotulá-las à parte — o risco ali é documento órfão no ERP, não uma
     * falha que o analista possa simplesmente reprocessar às cegas.
     *
     * `erp_response`/`request_payload` NÃO são selecionados de propósito: esta leitura alimenta o
     * `/painel`, que não é admin-only. Ver `UltimaFalhaExecucao` no port.
     */
    public listUltimaFalhaPorTxnIds = async (
        txnIds: string[],
    ): Promise<Map<string, UltimaFalhaExecucao>> => {
        if (txnIds.length === 0) return new Map();
        const rows = await this.databaseClient.selectMany(
            `SELECT DISTINCT ON (txn_id)
                    txn_id, pri_cod, valor, etapa, erro_mensagem, doc_cod, nd_doc_cod,
                    executado_por, status, atualizado_em
               FROM solicitacao_numerario_execucao
              WHERE txn_id = ANY($txnIds)
                AND (
                     status = 'error'
                     OR (status = 'reconciling'
                         AND atualizado_em < now() - make_interval(mins => $minutosParado::int))
                    )
              ORDER BY txn_id, atualizado_em DESC`,
            { txnIds, minutosParado: EXECUCAO_INTERROMPIDA_MINUTOS },
        );
        const out = new Map<string, UltimaFalhaExecucao>();
        for (const raw of rows) {
            const r = raw as Record<string, unknown>;
            out.set(String(r.txn_id), {
                priCod: Number(r.pri_cod),
                ...(r.valor != null ? { valor: Number(r.valor) } : {}),
                ...(r.etapa != null ? { etapa: r.etapa as SolicitacaoNumerarioEtapa } : {}),
                ...(r.erro_mensagem != null ? { mensagem: String(r.erro_mensagem) } : {}),
                ...(r.doc_cod != null ? { docCod: Number(r.doc_cod) } : {}),
                ...(r.nd_doc_cod != null ? { ndDocCod: Number(r.nd_doc_cod) } : {}),
                ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
                ocorridaEm: new Date(r.atualizado_em as string | Date),
                interrompida: r.status === 'reconciling',
            });
        }
        return out;
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
                etapa = COALESCE($etapa, 'concluido'),
                erp_response = $erpResponse::jsonb,
                erro_mensagem = NULL,
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                docCod: data.docCod ?? null,
                ndDocCod: data.ndDocCod ?? null,
                // Default histórico preservado: sem override, o settle continua gravando `concluido`.
                etapa: data.etapa ?? null,
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
        ...(r.pri_vld_tipo != null ? { priVldTipo: Number(r.pri_vld_tipo) } : {}),
        ...(r.nde_dispensada != null ? { ndeDispensada: Boolean(r.nde_dispensada) } : {}),
        ...(r.revisao_humana != null ? { revisaoHumana: Boolean(r.revisao_humana) } : {}),
        ...(r.nde_autorizado != null ? { ndeAutorizado: Boolean(r.nde_autorizado) } : {}),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        criadoEm: new Date(r.criado_em as string | Date),
        atualizadoEm: new Date(r.atualizado_em as string | Date),
    });
}
