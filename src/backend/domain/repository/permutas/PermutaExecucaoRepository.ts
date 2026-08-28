import { inject, injectable } from 'tsyringe';
import ConexosIdentityProvider from '../../client/ConexosIdentityProvider.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';

export type ExecucaoStatus = 'pending' | 'reconciling' | 'settled' | 'error';

/** Linha de execução da baixa/permuta no ERP (Fase 3 — auditoria/idempotência). */
export interface ExecucaoRow {
    idempotencyKey: string;
    adiantamentoDocCod: string;
    invoiceDocCod: string;
    filCod: number;
    status: ExecucaoStatus;
    dryRun: boolean;
    borCod?: number;
    bxaCodSeq?: number;
    valorBaixado?: number;
    juros?: number;
    contaJuros?: number;
    erpResponse?: unknown;
    erroMensagem?: string;
    executadoPor?: string;
    criadoEm: Date;
    atualizadoEm: Date;
}

/** Linha do cache local de borderô (campos crus do ERP; situação derivada na leitura). */
export interface BorderoCacheRow {
    borCod: number;
    filCod: number;
    borVldFinalizado?: number;
    borCodEstornado?: number | null;
    vlrTotalLiquido?: number;
    borDtaMvto?: number;
    usnDesNomeCad?: string | null;
}

export interface BeginExecutionInput {
    idempotencyKey: string;
    adiantamentoDocCod: string;
    invoiceDocCod: string;
    filCod: number;
    dryRun: boolean;
    executadoPor: string;
}

export interface BeginExecutionResult {
    /** Status APÓS o upsert. `settled` ⇒ já estava executada (idempotência) — pular. */
    status: ExecucaoStatus;
    /** TRUE quando a linha já estava `settled` antes desta chamada. */
    alreadySettled: boolean;
}

/**
 * PermutaExecucaoRepository — trilha de execução da baixa/permuta no `fin010` (Fase 3).
 *
 * Write-ahead: `insertIntent` grava a intenção (status `reconciling`) ANTES do POST; só
 * `markSettled` (após confirmação do ERP) a torna `settled`; `markError` registra a falha
 * com a resposta crua para reconciliação manual. `findByIdempotencyKey` dá a idempotência
 * (re-execução com a mesma chave curto-circuita). SQL 100% parametrizado (Rule #5).
 */
@injectable()
export default class PermutaExecucaoRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
        @inject(ConexosIdentityProvider)
        private identityProvider: ConexosIdentityProvider,
    ) {}

    public findByIdempotencyKey = async (key: string): Promise<ExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, erp_response,
                    erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE idempotency_key = $key`,
            { key },
        );
        return row ? this.mapRow(row) : null;
    };

    public listByAdiantamento = async (adiantamentoDocCod: string): Promise<ExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, erp_response,
                    erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE adiantamento_doc_cod = $adtoDocCod
             ORDER BY criado_em`,
            { adtoDocCod: adiantamentoDocCod },
        );
        return rows.map((r) => this.mapRow(r));
    };

    /**
     * `bor_cod` de uma execução REAL (não dry-run) que abriu um borderô VIVO para o par adto↔invoice —
     * ou `null`. Insumo da trava que IMPEDE remover uma alocação já usada num borderô (integridade
     * trilha × ERP). Inclui baixas `error` num borderô real (o borderô existe).
     *
     * IGNORA borderôs CANCELADOS (`permuta_bordero.bor_vld_finalizado = 2`): cancelar estorna a baixa no
     * ERP → a alocação volta a estar livre → não deve travar. Borderô EXCLUÍDO já some da trilha
     * (`deleteByBorCod`). Em cadastro / finalizado / estornado seguem TRAVANDO (baixa viva).
     */
    public borderoDoPar = async (
        adiantamentoDocCod: string,
        invoiceDocCod: string,
    ): Promise<number | null> => {
        const row = await this.databaseClient.selectFirst<{ bor_cod: number }>(
            `SELECT e.bor_cod
             FROM permuta_alocacao_execucao e
             WHERE e.adiantamento_doc_cod = $adtoDocCod
               AND e.invoice_doc_cod = $invoiceDocCod
               AND e.dry_run = false
               AND e.bor_cod IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM permuta_bordero b
                   WHERE b.fil_cod = e.fil_cod AND b.bor_cod = e.bor_cod
                     AND b.bor_vld_finalizado = 2
               )
             ORDER BY e.criado_em DESC
             LIMIT 1`,
            { adtoDocCod: adiantamentoDocCod, invoiceDocCod },
        );
        return row ? Number(row.bor_cod) : null;
    };

    /** Todas as execuções que geraram borderô (bor_cod não nulo), p/ a tela de gestão de borderôs. */
    public listComBordero = async (): Promise<ExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, erp_response,
                    erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE bor_cod IS NOT NULL
             ORDER BY bor_cod DESC, criado_em`,
        );
        return rows.map((r) => this.mapRow(r));
    };

    /** Busca a execução (baixa) de um borderô por invoice — p/ exclusão da baixa específica. */
    public findByBorCodInvoice = async (
        borCod: number,
        invoiceDocCod: string,
    ): Promise<ExecucaoRow | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, erp_response,
                    erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE bor_cod = $borCod AND invoice_doc_cod = $invoiceDocCod
             LIMIT 1`,
            { borCod, invoiceDocCod },
        );
        return row ? this.mapRow(row) : null;
    };

    /** Remove a linha de execução de uma baixa (após excluí-la no ERP). */
    public deleteByBorCodInvoice = async (
        borCod: number,
        invoiceDocCod: string,
    ): Promise<number> => {
        return this.databaseClient.update(
            `DELETE FROM permuta_alocacao_execucao
             WHERE bor_cod = $borCod AND invoice_doc_cod = $invoiceDocCod`,
            { borCod, invoiceDocCod },
        );
    };

    /** Todas as baixas (linhas) de um borderô — p/ excluir o borderô inteiro. */
    public listByBorCod = async (borCod: number): Promise<ExecucaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                    bor_cod, bxa_cod_seq, valor_baixado, juros, conta_juros, erp_response,
                    erro_mensagem, executado_por, criado_em, atualizado_em
             FROM permuta_alocacao_execucao
             WHERE bor_cod = $borCod
             ORDER BY criado_em`,
            { borCod },
        );
        return rows.map((r) => this.mapRow(r));
    };

    /** Quantas baixas o borderô ainda tem na trilha (0 ⇒ borderô vazio → apagar). */
    public countByBorCod = async (borCod: number): Promise<number> => {
        const row = await this.databaseClient.selectFirst<{ n: string | number }>(
            `SELECT count(*) AS n FROM permuta_alocacao_execucao WHERE bor_cod = $borCod`,
            { borCod },
        );
        return row ? Number(row.n) : 0;
    };

    /** Remove todas as linhas de um borderô (após excluir o borderô no ERP). */
    public deleteByBorCod = async (borCod: number): Promise<number> => {
        return this.databaseClient.update(
            `DELETE FROM permuta_alocacao_execucao WHERE bor_cod = $borCod`,
            { borCod },
        );
    };

    /** Remove a execução por chave de idempotência (libera re-baixa quando o borderô virou nulo). */
    public deleteByKey = async (idempotencyKey: string): Promise<number> => {
        return this.databaseClient.update(
            `DELETE FROM permuta_alocacao_execucao WHERE idempotency_key = $key`,
            { key: idempotencyKey },
        );
    };

    /**
     * Renomeia a chave de idempotência — libera a chave original para um RELANÇAMENTO sem perder a
     * linha antiga (o borderô cancelado/estornado continua na trilha p/ histórico).
     */
    public renameKey = async (oldKey: string, newKey: string): Promise<number> => {
        return this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao SET idempotency_key = $newKey WHERE idempotency_key = $oldKey`,
            { oldKey, newKey },
        );
    };

    /**
     * Write-ahead: abre (ou reabre) a execução de um par adto↔invoice.
     * - Linha nova → status `reconciling` (real) ou `pending` (dry-run).
     * - Linha existente NÃO-settled → reaberta (retry) com o novo status.
     * - Linha `settled` → PRESERVADA (idempotência): não regride. `alreadySettled=true`.
     */
    public beginExecution = async (input: BeginExecutionInput): Promise<BeginExecutionResult> => {
        const newStatus: ExecucaoStatus = input.dryRun ? 'pending' : 'reconciling';
        const row = await this.databaseClient.selectFirst<{ status: string }>(
            `INSERT INTO permuta_alocacao_execucao (
                idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod,
                status, dry_run, executado_por, conexos_username, conexos_usn_cod, atualizado_em
            ) VALUES (
                $key, $adtoDocCod, $invoiceDocCod, $filCod,
                $newStatus, $dryRun, $executadoPor, $conexosUsername, $conexosUsnCod, now()
            )
            ON CONFLICT (idempotency_key) DO UPDATE SET
                status = CASE WHEN permuta_alocacao_execucao.status = 'settled'
                              THEN permuta_alocacao_execucao.status ELSE EXCLUDED.status END,
                dry_run = CASE WHEN permuta_alocacao_execucao.status = 'settled'
                               THEN permuta_alocacao_execucao.dry_run ELSE EXCLUDED.dry_run END,
                executado_por = CASE WHEN permuta_alocacao_execucao.status = 'settled'
                               THEN permuta_alocacao_execucao.executado_por ELSE EXCLUDED.executado_por END,
                -- Identidade do ERP segue a mesma doutrina do executado_por: linha settled
                -- NUNCA reescreve quem assinou a escrita (ADR-0041).
                conexos_username = CASE WHEN permuta_alocacao_execucao.status = 'settled'
                               THEN permuta_alocacao_execucao.conexos_username ELSE EXCLUDED.conexos_username END,
                conexos_usn_cod = CASE WHEN permuta_alocacao_execucao.status = 'settled'
                               THEN permuta_alocacao_execucao.conexos_usn_cod ELSE EXCLUDED.conexos_usn_cod END,
                atualizado_em = now()
            RETURNING status`,
            {
                key: input.idempotencyKey,
                adtoDocCod: input.adiantamentoDocCod,
                invoiceDocCod: input.invoiceDocCod,
                filCod: input.filCod,
                newStatus,
                dryRun: input.dryRun,
                executadoPor: input.executadoPor,
                ...this.identityProvider.currentParams(),
            },
        );
        const status = (row?.status ?? newStatus) as ExecucaoStatus;
        // `newStatus` nunca é 'settled' (só markSettled grava isso). Logo, um status
        // 'settled' retornado = a linha JÁ estava settled e foi preservada (idempotência).
        return { status, alreadySettled: status === 'settled' };
    };

    /** Persiste o borCod assim que o borderô é criado (recuperação de órfão, Regis F-availability-1). */
    public setBorCod = async (key: string, borCod: number): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao
             SET bor_cod = $borCod, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, borCod },
        );
    };

    public setRequestPayload = async (key: string, payload: unknown): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao
             SET request_payload = $payload::jsonb, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key, payload: JSON.stringify(payload ?? null) },
        );
    };

    public markSettled = async (
        key: string,
        data: {
            borCod?: number;
            bxaCodSeq?: number;
            valorBaixado?: number;
            juros?: number;
            contaJuros?: number;
            erpResponse?: unknown;
        },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao SET
                status = 'settled',
                bor_cod = $borCod,
                bxa_cod_seq = $bxaCodSeq,
                valor_baixado = $valorBaixado,
                juros = $juros,
                conta_juros = $contaJuros,
                erp_response = $erpResponse::jsonb,
                erro_mensagem = NULL,
                -- COALESCE: no write-ahead a sessão podia ainda não ter sido resolvida;
                -- aqui já foi. Nunca sobrescreve uma identidade já registrada (ADR-0041).
                conexos_username = COALESCE(conexos_username, $conexosUsername),
                conexos_usn_cod = COALESCE(conexos_usn_cod, $conexosUsnCod),
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                borCod: data.borCod ?? null,
                bxaCodSeq: data.bxaCodSeq ?? null,
                valorBaixado: data.valorBaixado ?? null,
                juros: data.juros ?? null,
                contaJuros: data.contaJuros ?? null,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
                ...this.identityProvider.currentParams(),
            },
        );
    };

    public markError = async (
        key: string,
        data: { erroMensagem: string; erpResponse?: unknown; borCod?: number },
    ): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE permuta_alocacao_execucao SET
                status = 'error',
                erro_mensagem = $erroMensagem,
                erp_response = $erpResponse::jsonb,
                bor_cod = COALESCE($borCod, bor_cod),
                conexos_username = COALESCE(conexos_username, $conexosUsername),
                conexos_usn_cod = COALESCE(conexos_usn_cod, $conexosUsnCod),
                atualizado_em = now()
             WHERE idempotency_key = $key`,
            {
                key,
                erroMensagem: data.erroMensagem,
                erpResponse: JSON.stringify(data.erpResponse ?? null),
                borCod: data.borCod ?? null,
                ...this.identityProvider.currentParams(),
            },
        );
    };

    // ───────────────────────── Cache de borderôs (perf — tabela `permuta_bordero`) ─────────────
    // A tela de Borderôs lê deste cache (rápido) em vez de bater no ERP. Atualizado pela ingestão
    // e pelo "Atualizar". Guarda os campos crus; a situação é derivada na leitura.

    public listBorderoCache = async (limit?: number): Promise<BorderoCacheRow[]> => {
        // LIMIT é inteiro interno (não vem do cliente) → seguro inline. Pega os MAIS RECENTES
        // (por data de movimento) p/ a tela carregar rápido mesmo com milhares de borderôs. PORÉM
        // os borderôs criados por ESTE sistema (presentes na trilha `permuta_alocacao_execucao`)
        // são SEMPRE incluídos, mesmo que caiam fora dos N mais recentes — senão um borderô da
        // plataforma "envelhece para fora da tela" e some da busca/dropdown (o operador não acha
        // mais o que ele mesmo lançou). A trilha é pequena, então o UNION é barato.
        const lim = limit && Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 20000) : null;
        const rows = await this.databaseClient.selectMany(
            `WITH recentes AS (
                 SELECT bor_cod, fil_cod, bor_vld_finalizado, bor_cod_estornado, vlr_total_liquido,
                        bor_dta_mvto, usn_des_nome_cad
                 FROM permuta_bordero
                 ORDER BY bor_dta_mvto DESC NULLS LAST, bor_cod DESC
                 ${lim != null ? `LIMIT ${lim}` : ''}
             ),
             da_trilha AS (
                 SELECT DISTINCT pb.bor_cod, pb.fil_cod, pb.bor_vld_finalizado, pb.bor_cod_estornado,
                        pb.vlr_total_liquido, pb.bor_dta_mvto, pb.usn_des_nome_cad
                 FROM permuta_bordero pb
                 JOIN permuta_alocacao_execucao pae
                   ON pae.bor_cod = pb.bor_cod AND pae.fil_cod = pb.fil_cod
             )
             SELECT * FROM recentes
             UNION
             SELECT * FROM da_trilha
             ORDER BY bor_dta_mvto DESC NULLS LAST, bor_cod DESC`,
        );
        return rows.map((r) => ({
            borCod: Number(r.bor_cod),
            filCod: Number(r.fil_cod),
            ...(r.bor_vld_finalizado != null
                ? { borVldFinalizado: Number(r.bor_vld_finalizado) }
                : {}),
            borCodEstornado: r.bor_cod_estornado != null ? Number(r.bor_cod_estornado) : null,
            ...(r.vlr_total_liquido != null
                ? { vlrTotalLiquido: Number(r.vlr_total_liquido) }
                : {}),
            ...(r.bor_dta_mvto != null ? { borDtaMvto: Number(r.bor_dta_mvto) } : {}),
            usnDesNomeCad: (r.usn_des_nome_cad as string | null) ?? null,
        }));
    };

    /** Substitui o cache pelos itens do ERP (upsert + remove os que sumiram). Fetch vazio = no-op. */
    public replaceBorderoCache = async (items: BorderoCacheRow[]): Promise<void> => {
        if (items.length === 0) return; // não limpa num fetch vazio (ERP indisponível)
        const params: Record<string, unknown> = {};
        const tuples = items.map((b, i) => {
            params[`bor_${i}`] = b.borCod;
            params[`fil_${i}`] = b.filCod;
            params[`fin_${i}`] = b.borVldFinalizado ?? null;
            params[`est_${i}`] = b.borCodEstornado ?? null;
            params[`vlr_${i}`] = b.vlrTotalLiquido ?? null;
            params[`dta_${i}`] = b.borDtaMvto ?? null;
            params[`usn_${i}`] = b.usnDesNomeCad ?? null;
            return `($bor_${i}, $fil_${i}, $fin_${i}, $est_${i}, $vlr_${i}, $dta_${i}, $usn_${i}, now())`;
        });
        await this.databaseClient.update(
            `INSERT INTO permuta_bordero (
                bor_cod, fil_cod, bor_vld_finalizado, bor_cod_estornado, vlr_total_liquido,
                bor_dta_mvto, usn_des_nome_cad, atualizado_em
             ) VALUES ${tuples.join(', ')}
             ON CONFLICT (fil_cod, bor_cod) DO UPDATE SET
                bor_vld_finalizado = EXCLUDED.bor_vld_finalizado,
                bor_cod_estornado = EXCLUDED.bor_cod_estornado,
                vlr_total_liquido = EXCLUDED.vlr_total_liquido,
                bor_dta_mvto = EXCLUDED.bor_dta_mvto,
                usn_des_nome_cad = EXCLUDED.usn_des_nome_cad,
                atualizado_em = now()`,
            params,
        );
        // Remove do cache os que sumiram do ERP — por PAR (fil_cod, bor_cod), pois o nº é por filial.
        const pairList = items.map((_, i) => `($fil_${i}, $bor_${i})`).join(', ');
        await this.databaseClient.update(
            `DELETE FROM permuta_bordero WHERE (fil_cod, bor_cod) NOT IN (${pairList})`,
            params,
        );
    };

    /** Atualiza a situação de UM borderô no cache (após Aprovar/Cancelar). Chave = (filial, borderô). */
    public updateBorderoCacheSituacao = async (
        filCod: number,
        borCod: number,
        fields: { borVldFinalizado?: number; borCodEstornado?: number | null },
    ): Promise<number> => {
        return this.databaseClient.update(
            `UPDATE permuta_bordero
             SET bor_vld_finalizado = $fin, bor_cod_estornado = $est, atualizado_em = now()
             WHERE fil_cod = $fil AND bor_cod = $bor`,
            {
                fil: filCod,
                bor: borCod,
                fin: fields.borVldFinalizado ?? null,
                est: fields.borCodEstornado ?? null,
            },
        );
    };

    /** Remove UM borderô do cache (após Excluir borderô no ERP). Chave = (filial, borderô). */
    public deleteBorderoCache = async (filCod: number, borCod: number): Promise<number> => {
        return this.databaseClient.update(
            `DELETE FROM permuta_bordero WHERE fil_cod = $fil AND bor_cod = $bor`,
            { fil: filCod, bor: borCod },
        );
    };

    private mapRow = (r: Record<string, unknown>): ExecucaoRow => ({
        idempotencyKey: String(r.idempotency_key),
        adiantamentoDocCod: String(r.adiantamento_doc_cod),
        invoiceDocCod: String(r.invoice_doc_cod),
        filCod: Number(r.fil_cod),
        status: r.status as ExecucaoStatus,
        dryRun: Boolean(r.dry_run),
        ...(r.bor_cod != null ? { borCod: Number(r.bor_cod) } : {}),
        ...(r.bxa_cod_seq != null ? { bxaCodSeq: Number(r.bxa_cod_seq) } : {}),
        ...(r.valor_baixado != null ? { valorBaixado: Number(r.valor_baixado) } : {}),
        ...(r.juros != null ? { juros: Number(r.juros) } : {}),
        ...(r.conta_juros != null ? { contaJuros: Number(r.conta_juros) } : {}),
        ...(r.erp_response != null ? { erpResponse: r.erp_response } : {}),
        ...(r.erro_mensagem != null ? { erroMensagem: String(r.erro_mensagem) } : {}),
        ...(r.executado_por != null ? { executadoPor: String(r.executado_por) } : {}),
        criadoEm: new Date(r.criado_em as string | Date),
        atualizadoEm: new Date(r.atualizado_em as string | Date),
    });
}
