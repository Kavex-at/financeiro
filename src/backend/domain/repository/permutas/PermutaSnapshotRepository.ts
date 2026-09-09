import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import {
    ESTADO_ELEGIBILIDADE,
    type EstadoElegibilidade,
    type MotivoBloqueio,
} from '../../interface/permutas/EstadoElegibilidade.js';
import type PermutaCandidata from '../../interface/permutas/PermutaCandidata.js';

export type RunStatus = 'success' | 'partial' | 'error';

/** Cabeçalho da run de eleição (auditoria O6 + correlação flowId). */
export interface PermutaEleicaoRunInput {
    flowId: string;
    startedAt: Date;
    finishedAt: Date;
    status: RunStatus;
    triggeredBy: string;
    totalCandidatas: number;
    totalElegiveis: number;
    /** Contagem ESTRITA de `BLOQUEADA` — passivo de terceiro/leitura (ADR-0043). */
    totalBloqueadas: number;
    /**
     * Os 3 buckets abaixo são OBRIGATÓRIOS de propósito: opcionais fariam a
     * convergência header ↔ snapshot (invariante I5, cláusula 2) depender de o
     * caller lembrar de preenchê-los — e um caller esquecido gravaria zeros
     * mudos, que é exatamente a classe de defeito que este ciclo corrige.
     */
    totalCasamentoManual: number;
    totalPermutaManual: number;
    totalJaPermutado: number;
    bloqueadasByMotivo: Record<string, number>;
    errorMessage?: string;
}

/**
 * Resumo de uma run de ingestão/eleição para a trilha de auditoria do modal
 * (ADR-0006): quem disparou (`triggeredBy` = username do analista, ou `'cron'`),
 * quando, status e totais. Lido pelo `GET /permutas/runs`.
 */
export interface PermutaRunSummary {
    runId: string;
    triggeredBy: string;
    startedAt: Date;
    finishedAt: Date;
    status: RunStatus;
    totalCandidatas: number;
    totalElegiveis: number;
    totalBloqueadas: number;
    totalCasamentoManual: number;
    totalPermutaManual: number;
    totalJaPermutado: number;
    errorMessage?: string;
}

/** Linha do snapshot de uma candidata, como persistida para leitura no painel. */
export interface PermutaCandidataSnapshotRow {
    runId: string;
    docCod: string;
    filCod?: number;
    priCod: string;
    /**
     * O ESTADO INTEIRO da máquina, não uma projeção binária (ADR-0043 / I5).
     * Até a migration 0054 esta coluna aceitava só `elegivel|bloqueada` e três
     * estados eram achatados na gravação.
     */
    status: EstadoElegibilidade;
    motivoBloqueio?: MotivoBloqueio;
    agingDays?: number;
    invoiceDocCod?: string;
    variacaoClassificacao?: string;
    variacaoResultado?: number;
}

/**
 * PermutaSnapshotRepository — fecha O5 (Postgres sem uso) e O6 (auditoria).
 * Persiste a run + o snapshot de candidatas por execução, com SQL PARAMETRIZADO
 * (`$nome` via SqlBuilder — Rule #5, zero interpolação) e atomicidade.
 *
 * Atomicidade (Task 9 AC): run completa ⇒ 1 row em `permuta_eleicao_run` + 1
 * row por candidata; run abortada ⇒ status='error' + 0 snapshot rows.
 */
/** Máx. de candidatas por INSERT multi-row (mantém o nº de placeholders sob o
 * teto do protocolo wire do Postgres; 500 × 10 cols ≈ 5k placeholders). */
const SNAPSHOT_INSERT_CHUNK = 500;

/** Valores aceitos na coluna `permuta_candidata_snapshot.status` (CHECK da 0054). */
const ESTADOS_VALIDOS: ReadonlySet<string> = new Set<string>(Object.values(ESTADO_ELEGIBILIDADE));

const ehEstadoElegibilidade = (valor: string): valor is EstadoElegibilidade =>
    ESTADOS_VALIDOS.has(valor);

/**
 * Estreita o valor lido da coluna para o estado do domínio. FALHA ALTO em vez de
 * cair num fallback: o fallback silencioso `!== 'elegivel' ? 'bloqueada'` era
 * metade do bug que a ADR-0043 corrige — informação perdida na leitura, sem
 * nenhum sinal. Se a CHECK da 0054 deixou passar um valor desconhecido, quem lê
 * precisa saber disso, não receber um palpite.
 */
const parseStatusSnapshot = (bruto: unknown, docCod: string): EstadoElegibilidade => {
    const valor = String(bruto);
    if (ehEstadoElegibilidade(valor)) return valor;
    throw new Error(
        `snapshot de permuta com status fora da máquina de estados: '${valor}' ` +
            `(documento ${docCod}). A CHECK da migration 0054 deveria impedir isto.`,
    );
};

const chunked = <T>(items: readonly T[], size: number): T[][] => {
    if (items.length === 0) return [];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

@injectable()
export default class PermutaSnapshotRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    /**
     * Persiste a run e o snapshot das candidatas numa ÚNICA transação atômica
     * (P0-5): cabeçalho + INSERT multi-row das candidatas (chunks de 500) commit
     * juntos, ou ROLLBACK total em qualquer falha — nunca um cabeçalho
     * `status='success'` com snapshot truncado. `candidatas` vazio (abort) → só
     * o cabeçalho. Retorna o `runId` (uuid). SQL 100% parametrizado (Rule #5).
     */
    public persistRun = async (
        run: PermutaEleicaoRunInput,
        candidatas: PermutaCandidata[],
    ): Promise<string> => {
        const runId = randomUUID();

        await this.databaseClient.withTransaction(async (tx) => {
            await this.insertRunHeader(tx, runId, run);
            for (const chunk of chunked(candidatas, SNAPSHOT_INSERT_CHUNK)) {
                await this.insertCandidataChunk(tx, runId, chunk);
            }
        });

        return runId;
    };

    private insertRunHeader = async (
        tx: TransactionClient,
        runId: string,
        run: PermutaEleicaoRunInput,
    ): Promise<void> => {
        await tx.insert(
            `INSERT INTO permuta_eleicao_run (
                id, flow_id, started_at, finished_at, status,
                total_candidatas, total_elegiveis, total_bloqueadas,
                total_casamento_manual, total_permuta_manual, total_ja_permutado,
                bloqueadas_by_motivo, triggered_by, error_message
            ) VALUES (
                $id, $flowId, $startedAt, $finishedAt, $status,
                $totalCandidatas, $totalElegiveis, $totalBloqueadas,
                $totalCasamentoManual, $totalPermutaManual, $totalJaPermutado,
                $bloqueadasByMotivo, $triggeredBy, $errorMessage
            )`,
            {
                id: runId,
                flowId: run.flowId,
                startedAt: run.startedAt.toISOString(),
                finishedAt: run.finishedAt.toISOString(),
                status: run.status,
                totalCandidatas: run.totalCandidatas,
                totalElegiveis: run.totalElegiveis,
                totalBloqueadas: run.totalBloqueadas,
                totalCasamentoManual: run.totalCasamentoManual,
                totalPermutaManual: run.totalPermutaManual,
                totalJaPermutado: run.totalJaPermutado,
                bloqueadasByMotivo: JSON.stringify(run.bloqueadasByMotivo),
                triggeredBy: run.triggeredBy,
                errorMessage: run.errorMessage ?? null,
            },
        );
    };

    /**
     * Idempotência (P0-6): resolve o `runId` já produzido por uma
     * `Idempotency-Key`, se existir e estiver dentro do TTL de 24h. `null` se a
     * key é nova/expirada → o caller pode disparar uma nova run. SQL parametrizado.
     */
    public findRunIdByIdempotencyKey = async (key: string): Promise<string | null> => {
        const row = await this.databaseClient.selectFirst<{ run_id: string }>(
            `SELECT run_id FROM permuta_eleicao_idempotency
             WHERE idempotency_key = $key
               AND created_at > now() - INTERVAL '24 hours'`,
            { key },
        );
        return row ? row.run_id : null;
    };

    /**
     * Registra o mapeamento `Idempotency-Key → runId` após uma run bem-sucedida
     * (P0-6). `ON CONFLICT DO NOTHING` — a primeira run a gravar vence; um retry
     * concorrente que perdeu a corrida não sobrescreve. SQL parametrizado.
     */
    public recordIdempotencyKey = async (key: string, runId: string): Promise<void> => {
        await this.databaseClient.insert(
            `INSERT INTO permuta_eleicao_idempotency (idempotency_key, run_id)
             VALUES ($key, $runId)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            { key, runId },
        );
    };

    /**
     * Lê o resumo (cabeçalho) de uma run pelo `id`. Usado pelo retorno
     * idempotente (P0-6) — devolve os totais da run já existente sem re-executar
     * o fan-out. `null` se a run não existe. SQL parametrizado.
     */
    public findRunSummaryById = async (
        runId: string,
    ): Promise<{
        runId: string;
        flowId: string;
        status: RunStatus;
        totalCandidatas: number;
        totalElegiveis: number;
        totalBloqueadas: number;
        totalCasamentoManual: number;
        totalPermutaManual: number;
        totalJaPermutado: number;
        bloqueadasByMotivo: Record<string, number>;
    } | null> => {
        const row = await this.databaseClient.selectFirst<{
            id: string;
            flow_id: string;
            status: RunStatus;
            total_candidatas: number;
            total_elegiveis: number;
            total_bloqueadas: number;
            total_casamento_manual: number;
            total_permuta_manual: number;
            total_ja_permutado: number;
            bloqueadas_by_motivo: Record<string, number> | string;
        }>(
            `SELECT id, flow_id, status, total_candidatas, total_elegiveis,
                    total_bloqueadas, total_casamento_manual, total_permuta_manual,
                    total_ja_permutado, bloqueadas_by_motivo
             FROM permuta_eleicao_run
             WHERE id = $runId`,
            { runId },
        );
        if (!row) return null;
        const bloqueadasByMotivo =
            typeof row.bloqueadas_by_motivo === 'string'
                ? (JSON.parse(row.bloqueadas_by_motivo) as Record<string, number>)
                : row.bloqueadas_by_motivo;
        return {
            runId: row.id,
            flowId: row.flow_id,
            status: row.status,
            totalCandidatas: Number(row.total_candidatas),
            totalElegiveis: Number(row.total_elegiveis),
            totalBloqueadas: Number(row.total_bloqueadas),
            totalCasamentoManual: Number(row.total_casamento_manual),
            totalPermutaManual: Number(row.total_permuta_manual),
            totalJaPermutado: Number(row.total_ja_permutado),
            bloqueadasByMotivo: bloqueadasByMotivo ?? {},
        };
    };

    /**
     * Últimas `limit` runs (cron + manuais), mais recentes primeiro, para a
     * trilha de auditoria do modal de ingestão manual (ADR-0006). `limit` é
     * saneado pelo caller (1..50). SQL parametrizado (Rule #5).
     *
     * Dedup: cada ingestão BEM-SUCEDIDA grava DUAS linhas em `permuta_eleicao_run`
     * — o header `kind='ingest'` (totais relacionais, `total_elegiveis=0`) e o
     * snapshot `kind='eleicao'` (com a elegibilidade real). O modal mostra os
     * elegíveis, então filtramos o header de ingest bem-sucedido (o duplicado).
     * Uma ingestão que FALHOU só tem o header `kind='ingest'` (status `error`),
     * sem par — esse NÃO é filtrado, para a falha aparecer na trilha.
     */
    public listRecentRuns = async (limit: number): Promise<PermutaRunSummary[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT id, triggered_by, started_at, finished_at, status,
                    total_candidatas, total_elegiveis, total_bloqueadas,
                    total_casamento_manual, total_permuta_manual, total_ja_permutado,
                    error_message
             FROM permuta_eleicao_run
             WHERE NOT (kind = 'ingest' AND status = 'success')
             ORDER BY finished_at DESC
             LIMIT $limit`,
            { limit },
        );
        return rows.map((r) => this.mapRunSummary(r));
    };

    private mapRunSummary = (r: Record<string, unknown>): PermutaRunSummary => ({
        runId: String(r.id),
        triggeredBy: String(r.triggered_by),
        startedAt: new Date(r.started_at as string | Date),
        finishedAt: new Date(r.finished_at as string | Date),
        status: r.status as RunStatus,
        totalCandidatas: Number(r.total_candidatas),
        totalElegiveis: Number(r.total_elegiveis),
        totalBloqueadas: Number(r.total_bloqueadas),
        totalCasamentoManual: Number(r.total_casamento_manual),
        totalPermutaManual: Number(r.total_permuta_manual),
        totalJaPermutado: Number(r.total_ja_permutado),
        ...(r.error_message != null ? { errorMessage: String(r.error_message) } : {}),
    });

    /**
     * `finished_at` da última INGESTÃO bem-sucedida (`kind='ingest'`) — carimbo da
     * "última ingestão" do painel. Escopa a `kind='ingest'` de propósito: só a
     * ingestão atualiza o modelo relacional que o `/gestao` lê (uma eleição manual
     * grava `kind='eleicao'` e NÃO mexe nesses dados — incluí-la faria o carimbo
     * pular para um horário que não corresponde aos números exibidos). Leve (só o
     * timestamp, sem snapshot rows).
     */
    public findLatestIngestFinishedAt = async (): Promise<Date | null> => {
        const run = await this.databaseClient.selectFirst<{ finished_at: string | Date }>(
            `SELECT finished_at FROM permuta_eleicao_run
             WHERE kind = 'ingest' AND status = $status
             ORDER BY finished_at DESC
             LIMIT 1`,
            { status: 'success' },
        );
        return run ? new Date(run.finished_at) : null;
    };

    /** Lê o snapshot de candidatas do último run com status 'success'. */
    public findLatestSnapshot = async (): Promise<{
        runId: string;
        finishedAt: Date;
        rows: PermutaCandidataSnapshotRow[];
    } | null> => {
        const run = await this.databaseClient.selectFirst<{
            id: string;
            finished_at: string | Date;
        }>(
            `SELECT id, finished_at FROM permuta_eleicao_run
             WHERE status = $status
             ORDER BY finished_at DESC
             LIMIT 1`,
            { status: 'success' },
        );
        if (!run) return null;

        const rows = await this.databaseClient.selectMany(
            `SELECT run_id, doc_cod, fil_cod, pri_cod, status, motivo_bloqueio,
                    aging_days, invoice_doc_cod, variacao_classificacao, variacao_resultado
             FROM permuta_candidata_snapshot
             WHERE run_id = $runId
             ORDER BY (aging_days IS NULL), aging_days DESC, doc_cod ASC`,
            { runId: run.id },
        );

        return {
            runId: run.id,
            finishedAt: new Date(run.finished_at),
            rows: rows.map((r) => this.mapSnapshotRow(r)),
        };
    };

    /**
     * INSERT multi-row de um chunk de candidatas — 1 round-trip por chunk em vez
     * de 1 por candidata (P0-5: round-trips N=200 de 201→2). SQL parametrizado
     * (`$nome_i` via SqlBuilder, Rule #5 — zero interpolação de valores). Inclui
     * `fil_cod` (P0-2 — invariante multi-filial I6, antes sempre NULL).
     */
    private insertCandidataChunk = async (
        tx: TransactionClient,
        runId: string,
        candidatas: PermutaCandidata[],
    ): Promise<void> => {
        if (candidatas.length === 0) return;

        const params: Record<string, unknown> = { runId };
        const valuesTuples = candidatas.map((candidata, i) => {
            params[`docCod_${i}`] = candidata.adiantamento.docCod;
            params[`filCod_${i}`] = candidata.adiantamento.filCod ?? null;
            params[`priCod_${i}`] = candidata.priCod;
            // O estado ÍNTEGRO da máquina — zero ramo catch-all (ADR-0043 / I5
            // cláusula 1). O ternário que morava aqui achatava casamento-manual,
            // permuta-manual e ja-permutado em 'bloqueada'.
            //
            // A CHECK da 0054 aceita os 5 estados que a eleição produz, e NÃO
            // `descoberta`: toda candidata passa por `avaliarElegibilidade` antes
            // de chegar aqui, então `descoberta` é inalcançável neste caminho. Se
            // algum dia deixar de ser, a transação falha alto na constraint em vez
            // de gravar um estado que ninguém sabe ler — que é o comportamento
            // desejado, e o oposto do que esta linha fazia antes.
            //
            // Verificado contra Postgres 16 em 2026-09-08: os 5 valores passam e
            // 'descoberta' é rejeitado pela constraint.
            params[`status_${i}`] = candidata.estadoElegibilidade;
            params[`motivoBloqueio_${i}`] = candidata.motivoBloqueio ?? null;
            params[`agingDays_${i}`] = candidata.aging ?? null;
            params[`invoiceDocCod_${i}`] = candidata.invoiceCasada?.docCod ?? null;
            params[`variacaoClassificacao_${i}`] = candidata.variacaoCambial?.classificacao ?? null;
            params[`variacaoResultado_${i}`] = candidata.variacaoCambial?.resultado ?? null;
            return (
                `($runId, $docCod_${i}, $filCod_${i}, $priCod_${i}, $status_${i}, ` +
                `$motivoBloqueio_${i}, $agingDays_${i}, $invoiceDocCod_${i}, ` +
                `$variacaoClassificacao_${i}, $variacaoResultado_${i})`
            );
        });

        await tx.insert(
            `INSERT INTO permuta_candidata_snapshot (
                run_id, doc_cod, fil_cod, pri_cod, status, motivo_bloqueio,
                aging_days, invoice_doc_cod, variacao_classificacao, variacao_resultado
            ) VALUES ${valuesTuples.join(', ')}`,
            params,
        );
    };

    private mapSnapshotRow = (r: Record<string, unknown>): PermutaCandidataSnapshotRow => ({
        runId: String(r.run_id),
        docCod: String(r.doc_cod),
        ...(r.fil_cod != null ? { filCod: Number(r.fil_cod) } : {}),
        priCod: String(r.pri_cod),
        status: parseStatusSnapshot(r.status, String(r.doc_cod)),
        // `status` é validado acima porque tem CHECK e conjunto fechado; o MOTIVO
        // NÃO tem constraint nenhuma no banco (coluna TEXT livre) e sua taxonomia
        // é aberta e explicitamente fora do escopo da ADR-0043 (§8). Fazer este
        // cast falhar alto derrubaria a leitura inteira do snapshot no primeiro
        // motivo antigo ou novo — trocaria uma perda de informação por uma perda
        // de disponibilidade. Fica documentado, não endurecido.
        ...(r.motivo_bloqueio != null
            ? { motivoBloqueio: String(r.motivo_bloqueio) as MotivoBloqueio }
            : {}),
        ...(r.aging_days != null ? { agingDays: Number(r.aging_days) } : {}),
        ...(r.invoice_doc_cod != null ? { invoiceDocCod: String(r.invoice_doc_cod) } : {}),
        ...(r.variacao_classificacao != null
            ? { variacaoClassificacao: String(r.variacao_classificacao) }
            : {}),
        ...(r.variacao_resultado != null
            ? { variacaoResultado: Number(r.variacao_resultado) }
            : {}),
    });
}
