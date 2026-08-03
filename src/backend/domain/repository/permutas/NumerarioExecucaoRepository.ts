import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { NumerarioEtapa } from '../../interface/permutas/SolicitacaoNumerario.js';

export type NumerarioStatus = 'pending' | 'reconciling' | 'settled' | 'error';

/** Linha da trilha de geração de SN no ERP (auditoria/idempotência por adiantamento, 3 telas). */
export interface NumerarioExecucaoRow {
    idempotencyKey: string;
    adiantamentoDocCod: string;
    filCod: number;
    priCod?: string;
    pesCod?: string;
    gcdCod?: number;
    valor?: number;
    status: NumerarioStatus;
    dryRun: boolean;
    /** docCod da SN (Tela 1, com299). */
    docCod?: number;
    /** Borderô do recebimento fin014 (Tela 2). */
    fin014BorCod?: number;
    /** docCod da nota de débito (Tela 3, com297). */
    ndDocCod?: number;
    etapa?: NumerarioEtapa;
    erpResponse?: unknown;
    erroMensagem?: string;
    executadoPor?: string;
    criadoEm: Date;
    atualizadoEm: Date;
}

export interface BeginNumerarioInput {
    idempotencyKey: string;
    adiantamentoDocCod: string;
    filCod: number;
    priCod?: string;
    pesCod?: string;
    gcdCod: number;
    valor: number;
    dryRun: boolean;
    executadoPor: string;
}

export interface BeginNumerarioResult {
    status: NumerarioStatus;
    /** TRUE quando a linha já estava `settled` (idempotência — pular). */
    alreadySettled: boolean;
}

const SELECT_COLS = `idempotency_key, adiantamento_doc_cod, fil_cod, pri_cod, pes_cod, gcd_cod, valor,
                     status, dry_run, doc_cod, fin014_bor_cod, nd_doc_cod, etapa, erp_response,
                     erro_mensagem, executado_por, criado_em, atualizado_em`;

/**
 * NumerarioExecucaoRepository — trilha de execução do fluxo de 3 telas (SN com299 → recebimento
 * fin014 → nota de débito com297). Write-ahead: `beginExecution` grava a intenção (`reconciling`)
 * ANTES do POST; cada etapa avança `etapa` + grava o docCod correspondente; `markSettled` (após a
 * última tela) torna `settled`; `markError` registra a falha. A retomada é ANTI-DUPLICAÇÃO: com a SN
 * já gerada (`doc_cod` preenchido), uma re-execução NÃO recria a SN. SQL 100% parametrizado (Rule #5).
 */
@injectable()
export default class NumerarioExecucaoRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public findByIdempotencyKey = async (key: string): Promise<NumerarioExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT ${SELECT_COLS} FROM solicitacao_numerario WHERE idempotency_key = $key`,
            { key },
        );
        return row ? this.mapRow(row) : null;
    };

    public listByAdiantamento = async (
        adiantamentoDocCod: string,
    ): Promise<NumerarioExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT ${SELECT_COLS} FROM solicitacao_numerario
             WHERE adiantamento_doc_cod = $adtoDocCod ORDER BY criado_em`,
            { adtoDocCod: adiantamentoDocCod },
        );
        return rows.map((r) => this.mapRow(r));
    };

    /**
     * Write-ahead: abre (ou reabre) a execução por adiantamento.
     * - Linha nova → `reconciling` (real) ou `pending` (dry-run).
     * - Linha existente NÃO-settled → reaberta (retry) com o novo status (doc_cod/nd_doc_cod PRESERVADOS
     *   → retomada anti-duplicação).
     * - Linha `settled` → PRESERVADA (idempotência): não regride. `alreadySettled=true`.
     */
    public beginExecution = async (input: BeginNumerarioInput): Promise<BeginNumerarioResult> => {
        const newStatus: NumerarioStatus = input.dryRun ? 'pending' : 'reconciling';
        const row = await this.databaseClient.selectFirst<{ status: string }>(
            `INSERT INTO solicitacao_numerario (
                idempotency_key, adiantamento_doc_cod, fil_cod, pri_cod, pes_cod, gcd_cod, valor,
                status, dry_run, executado_por, atualizado_em
            ) VALUES (
                $key, $adtoDocCod, $filCod, $priCod, $pesCod, $gcdCod, $valor,
                $newStatus, $dryRun, $executadoPor, now()
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                status = CASE WHEN solicitacao_numerario.status = 'settled'
                              THEN solicitacao_numerario.status ELSE EXCLUDED.status END,
                dry_run = CASE WHEN solicitacao_numerario.status = 'settled'
                               THEN solicitacao_numerario.dry_run ELSE EXCLUDED.dry_run END,
                executado_por = CASE WHEN solicitacao_numerario.status = 'settled'
                               THEN solicitacao_numerario.executado_por ELSE EXCLUDED.executado_por END,
                atualizado_em = now()
            RETURNING status`,
            {
                key: input.idempotencyKey,
                adtoDocCod: input.adiantamentoDocCod,
                filCod: input.filCod,
                priCod: input.priCod ?? null,
                pesCod: input.pesCod ?? null,
                gcdCod: input.gcdCod,
                valor: input.valor,
                newStatus,
                dryRun: input.dryRun,
                executadoPor: input.executadoPor,
            },
        );
        const status = (row?.status ?? newStatus) as NumerarioStatus;
        return { status, alreadySettled: status === 'settled' };
    };

    public setRequestPayload = async (key: string, payload: unknown): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario
             SET request_payload = $payload::jsonb, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, payload: JSON.stringify(payload ?? null) },
        );
    };

    /** Tela 1: grava o docCod da SN + avança a etapa (retomada anti-duplicação). */
    public setSnDocCod = async (key: string, docCod: number): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario
             SET doc_cod = $docCod, etapa = 'sn', atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, docCod },
        );
    };

    /** Avança a etapa alcançada. */
    public setEtapa = async (key: string, etapa: NumerarioEtapa): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario SET etapa = $etapa, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, etapa },
        );
    };

    /** Tela 2: grava o borderô do recebimento fin014 (retomada anti-duplicação). */
    public setFin014BorCod = async (key: string, borCod: number): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario
             SET fin014_bor_cod = $borCod, etapa = 'fin014-done', atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, borCod },
        );
    };

    /** Tela 3: grava o docCod da nota de débito (retomada anti-duplicação). */
    public setNdDocCod = async (key: string, docCod: number): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario
             SET nd_doc_cod = $docCod, etapa = 'nota-debito', atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, docCod },
        );
    };

    /** Conclui o fluxo (todas as telas): status settled + nd_doc_cod + etapa concluido. */
    public markSettled = async (
        key: string,
        data: { ndDocCod?: number; erpResponse?: unknown },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario SET
                status = 'settled',
                nd_doc_cod = COALESCE($ndDocCod, nd_doc_cod),
                etapa = 'concluido',
                erp_response = $erpResponse::jsonb,
                erro_mensagem = NULL,
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                ndDocCod: data.ndDocCod ?? null,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
            },
        );
    };

    public markError = async (
        key: string,
        data: { etapa: NumerarioEtapa; erroMensagem: string; erpResponse?: unknown },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE solicitacao_numerario SET
                status = 'error',
                etapa = $etapa,
                erro_mensagem = $erroMensagem,
                erp_response = $erpResponse::jsonb,
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                etapa: data.etapa,
                erroMensagem: data.erroMensagem,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
            },
        );
    };

    private mapRow = (r: Record<string, unknown>): NumerarioExecucaoRow => ({
        idempotencyKey: String(r.idempotency_key),
        adiantamentoDocCod: String(r.adiantamento_doc_cod),
        filCod: Number(r.fil_cod),
        ...(r.pri_cod != null ? { priCod: String(r.pri_cod) } : {}),
        ...(r.pes_cod != null ? { pesCod: String(r.pes_cod) } : {}),
        ...(r.gcd_cod != null ? { gcdCod: Number(r.gcd_cod) } : {}),
        ...(r.valor != null ? { valor: Number(r.valor) } : {}),
        status: r.status as NumerarioStatus,
        dryRun: Boolean(r.dry_run),
        ...(r.doc_cod != null ? { docCod: Number(r.doc_cod) } : {}),
        ...(r.fin014_bor_cod != null ? { fin014BorCod: Number(r.fin014_bor_cod) } : {}),
        ...(r.nd_doc_cod != null ? { ndDocCod: Number(r.nd_doc_cod) } : {}),
        ...(r.etapa != null ? { etapa: r.etapa as NumerarioEtapa } : {}),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        criadoEm: new Date(r.criado_em as string | Date),
        atualizadoEm: new Date(r.atualizado_em as string | Date),
    });
}
