import { randomUUID } from 'node:crypto';
import {
    ESTADO_ELEGIBILIDADE,
    type EstadoElegibilidade,
    type MotivoBloqueio,
} from '../../interface/permutas/EstadoElegibilidade.js';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';

/**
 * Valores aceitos pela coluna `permuta_adiantamento.estado_elegibilidade`
 * (CHECK criada na 0003 e estendida por 0005, 0012 e 0054).
 *
 * Tipo NOMEADO de propósito: este union aparecia DUPLICADO — na row e no filtro
 * de `listAdiantamentosAtivos` — e cada estado novo (`casamento-manual` em
 * ADR-0005, `permuta-manual` em ADR-0007, `ja-permutado` em ADR-0043) obrigava a
 * editar os dois lugares. Esquecer o do filtro deixa a tela sem conseguir
 * filtrar o estado novo, sem nenhum erro de compilação. Uma fonte só.
 */
/**
 * Estado como gravado em `permuta_adiantamento.estado_elegibilidade`.
 *
 * **Derivado, não redigitado** (Regis-Review 2026-09-08, cards
 * `assertNever-propagacao` e `taxonomia-fonte-unica`). Era uma união escrita à
 * mão, idêntica ao enum mas desconectada dele — e essa desconexão anulava as
 * guardas de exaustividade rio abaixo: acrescentar um estado ao enum não quebrava
 * nada aqui, nem no `statusDoEstado`, nem na contagem do painel. O alias faz a
 * cadeia voltar a existir. O conjunto é o mesmo do enum porque a coluna aceita os
 * mesmos valores (CHECK da migration 0054 §1), `descoberta` inclusive.
 */
export type EstadoElegibilidadeRow = EstadoElegibilidade;

/** Derivado do enum: um estado novo entra aqui sozinho, sem manutenção manual. */
const ESTADOS_ROW_VALIDOS: ReadonlySet<string> = new Set<string>(
    Object.values(ESTADO_ELEGIBILIDADE),
);

const ehEstadoElegibilidadeRow = (valor: string): valor is EstadoElegibilidadeRow =>
    ESTADOS_ROW_VALIDOS.has(valor);

/**
 * Estreita o valor da coluna `estado_elegibilidade` para o tipo do domínio,
 * FALHANDO ALTO em valor desconhecido em vez de aceitar um `as` cego.
 *
 * O `as` que morava aqui não era inofensivo: quando ADR-0043 promoveu
 * `ja-permutado` a estado, o cast teria feito o valor novo atravessar um union
 * que não o comportava, sem erro de compilação nem de execução. É a mesma classe
 * de defeito que este ciclo corrige do lado do snapshot — informação passando por
 * um tipo que mente sobre ela.
 *
 * O conjunto é fechado pela CHECK `permuta_adiantamento_estado_elegibilidade_check`
 * (0003 + 0005 + 0012 + 0054), então na prática isto nunca dispara; se disparar, o
 * código está mais velho que o banco, e é exatamente aí que ninguém quer um chute.
 */
const parseEstadoElegibilidadeRow = (bruto: unknown, docCod: string): EstadoElegibilidadeRow => {
    const valor = String(bruto);
    if (ehEstadoElegibilidadeRow(valor)) return valor;
    throw new Error(
        `adiantamento com estado_elegibilidade fora do dominio: '${valor}' ` +
            `(documento ${docCod}). A CHECK do banco deveria impedir isto.`,
    );
};

/** Linha de Adiantamento persistida no modelo relacional (Fase B). */
export interface AdiantamentoRow {
    docCod: string;
    priCod: string;
    filCod?: number;
    referencia?: string;
    referenciaExterna?: string;
    exportador?: string;
    dataEmissao?: Date;
    valor?: number;
    valorMoedaNegociada?: number;
    moeda?: string;
    /** Sigla da moeda NEGOCIADA (`com308`), distinta de `moeda` (doc). */
    moedaNegociada?: string;
    pago: boolean;
    valorPermutar?: number;
    estadoElegibilidade: EstadoElegibilidadeRow;
    motivoBloqueio?: string;
    agingDays?: number;
    /** Taxa de câmbio negociada do título (`com308` `titFltTaxaMneg`). */
    taxa?: number;
    /** Valor de FACE do título em BRL (`mnyTitValor`) — progresso de pagamento. */
    valorTotal?: number;
    /** Saldo em aberto do título em BRL (`mnyTitAberto`) — quanto falta pagar. */
    valorAberto?: number;
    /** Importador (cliente) do processo — `pesCod` do `imp021` (cliente-filtro). */
    pesCod?: string;
    /** Nome do importador (`imp021.dpeNomPessoa`) — exibição/auditoria. */
    importador?: string;
}

/** Linha de Invoice persistida no modelo relacional (Fase B). */
export interface InvoiceRow {
    docCod: string;
    priCod: string;
    filCod?: number;
    referencia?: string;
    referenciaExterna?: string;
    exportador?: string;
    dataEmissao?: Date;
    valor?: number;
    valorMoedaNegociada?: number;
    moeda?: string;
    /** Sigla da moeda NEGOCIADA (`com308`), distinta de `moeda` (doc). */
    moedaNegociada?: string;
    pago: boolean;
    /** Taxa de câmbio negociada (`com308` `titFltTaxaMneg`). */
    taxa?: number;
    /** Cliente (importador) do processo via imp021 — `pes_cod` (chave) + `importador` (nome). */
    pesCod?: string;
    importador?: string;
}

/** Linha de Declaração de importação (D.I / DUIMP). */
export interface DeclaracaoRow {
    priCod: string;
    variante: 'DI' | 'DUIMP';
    dataBase?: Date;
}

/** Linha de casamento automático 1:1 (recomputada a cada run). */
export interface CasamentoRow {
    invoiceDocCod: string;
    adiantamentoDocCod: string;
    priCod: string;
    valorASerUsado?: number;
    moeda?: string;
    variacaoClassificacao?: string;
    variacaoResultado?: number;
    variacaoDelta?: number;
    taxaAdiantamento?: number;
    taxaInvoice?: number;
}

/** Cabeçalho da run de ingestão (espelha o de eleição + totais relacionais). */
export interface IngestRunHeader {
    flowId: string;
    startedAt: Date;
    finishedAt: Date;
    status: 'success' | 'partial' | 'error';
    triggeredBy: string;
    totalAdiantamentos: number;
    totalInvoices: number;
    totalCasamentos: number;
    totalStale: number;
    errorMessage?: string;
}

/** Adiantamento ATIVO (não-stale) lido para a tela Gestão. */
export interface AdiantamentoAtivo extends AdiantamentoRow {
    stale: boolean;
}

/** Máx. de rows por INSERT multi-row (teto de placeholders do wire Postgres). */
const UPSERT_CHUNK = 500;

const chunked = <T>(items: readonly T[], size: number): T[][] => {
    if (items.length === 0) return [];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

/**
 * Deduplica linhas pela chave natural do UPSERT (último vence). Necessário
 * porque o mesmo `doc_cod` pode vir repetido no fan-out multi-filial: um
 * `INSERT ... ON CONFLICT` não pode afetar a mesma linha-alvo duas vezes no
 * mesmo comando (Postgres: "ON CONFLICT DO UPDATE command cannot affect row a
 * second time").
 */
const dedupeByKey = <T>(rows: readonly T[], keyFn: (row: T) => string): T[] => {
    const byKey = new Map<string, T>();
    for (const row of rows) byKey.set(keyFn(row), row);
    return [...byKey.values()];
};

/**
 * PermutaRelationalRepository — escreve/lê o modelo relacional da Fase B.
 *
 * SQL 100% parametrizado (`$nome` via SqlBuilder — Rule #5, zero interpolação).
 * UPSERTs por chave natural (`ON CONFLICT (doc_cod) DO UPDATE`) em chunks de 500
 * (espelha `PermutaSnapshotRepository`), carimbando `last_ingest_run_id`,
 * `last_seen_at`, `stale=false`. O casamento automático é recomputado por run
 * (DELETE + INSERT). `markStale` marca tudo que não foi tocado pela run atual.
 * `persistIngestRun` abre a transação + advisory lock para o caller escrever
 * tudo de forma atômica.
 */
@injectable()
export default class PermutaRelationalRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    /**
     * Insere o cabeçalho da run de ingestão (`kind='ingest'`) e devolve o `runId`
     * gerado. Usado DENTRO da transação (sucesso) ou FORA dela (erro), por isso
     * recebe o `tx` opcional — quando ausente, escreve via pool.
     */
    public insertIngestRunHeader = async (
        header: IngestRunHeader,
        tx?: TransactionClient,
    ): Promise<string> => {
        const runId = randomUUID();
        const sink = tx ?? this.databaseClient;
        await sink.insert(
            `INSERT INTO permuta_eleicao_run (
                id, flow_id, started_at, finished_at, status, kind,
                total_candidatas, total_elegiveis, total_bloqueadas,
                total_adiantamentos, total_invoices, total_casamentos, total_stale,
                bloqueadas_by_motivo, triggered_by, error_message
            ) VALUES (
                $id, $flowId, $startedAt, $finishedAt, $status, 'ingest',
                0, 0, 0,
                $totalAdiantamentos, $totalInvoices, $totalCasamentos, $totalStale,
                '{}'::jsonb, $triggeredBy, $errorMessage
            )`,
            {
                id: runId,
                flowId: header.flowId,
                startedAt: header.startedAt.toISOString(),
                finishedAt: header.finishedAt.toISOString(),
                status: header.status,
                totalAdiantamentos: header.totalAdiantamentos,
                totalInvoices: header.totalInvoices,
                totalCasamentos: header.totalCasamentos,
                totalStale: header.totalStale,
                triggeredBy: header.triggeredBy,
                errorMessage: header.errorMessage ?? null,
            },
        );
        return runId;
    };

    /**
     * Executa `write(tx, runId)` numa ÚNICA transação atômica serializada por
     * `withAdvisoryLock(lockKey)`: insere o cabeçalho `kind='ingest'`, chama o
     * `write` (upserts + recompute casamento + sweep), e commita junto. Qualquer
     * falha → ROLLBACK total (os fatos last-good sobrevivem). Retorna o `runId`.
     */
    public persistIngestRun = async (
        header: IngestRunHeader,
        lockKey: number,
        write: (tx: TransactionClient, runId: string) => Promise<void>,
    ): Promise<string> => {
        return this.databaseClient.withAdvisoryLock(
            lockKey,
            async () =>
                this.databaseClient.withTransaction(async (tx) => {
                    const runId = await this.insertIngestRunHeader(header, tx);
                    await write(tx, runId);
                    return runId;
                }),
            async () => {
                throw new IngestLockBusyError();
            },
        );
    };

    public upsertAdiantamentos = async (
        tx: TransactionClient,
        runId: string,
        rows: AdiantamentoRow[],
    ): Promise<void> => {
        const unique = dedupeByKey(rows, (r) => r.docCod);
        for (const chunk of chunked(unique, UPSERT_CHUNK)) {
            await this.upsertAdiantamentoChunk(tx, runId, chunk);
        }
    };

    private upsertAdiantamentoChunk = async (
        tx: TransactionClient,
        runId: string,
        rows: AdiantamentoRow[],
    ): Promise<void> => {
        if (rows.length === 0) return;
        const params: Record<string, unknown> = { runId };
        const tuples = rows.map((r, i) => {
            params[`docCod_${i}`] = r.docCod;
            params[`priCod_${i}`] = r.priCod;
            params[`filCod_${i}`] = r.filCod ?? null;
            params[`referencia_${i}`] = r.referencia ?? null;
            params[`referenciaExterna_${i}`] = r.referenciaExterna ?? null;
            params[`exportador_${i}`] = r.exportador ?? null;
            params[`dataEmissao_${i}`] = r.dataEmissao ? r.dataEmissao.toISOString() : null;
            params[`valor_${i}`] = r.valor ?? null;
            params[`valorMoedaNegociada_${i}`] = r.valorMoedaNegociada ?? null;
            params[`moeda_${i}`] = r.moeda ?? null;
            params[`moedaNegociada_${i}`] = r.moedaNegociada ?? null;
            params[`pago_${i}`] = r.pago;
            params[`valorPermutar_${i}`] = r.valorPermutar ?? null;
            params[`estado_${i}`] = r.estadoElegibilidade;
            params[`motivo_${i}`] = r.motivoBloqueio ?? null;
            params[`aging_${i}`] = r.agingDays ?? null;
            params[`taxa_${i}`] = r.taxa ?? null;
            params[`valorTotal_${i}`] = r.valorTotal ?? null;
            params[`valorAberto_${i}`] = r.valorAberto ?? null;
            params[`pesCod_${i}`] = r.pesCod ?? null;
            params[`importador_${i}`] = r.importador ?? null;
            return (
                `($docCod_${i}, $priCod_${i}, $filCod_${i}, $referencia_${i}, $referenciaExterna_${i}, ` +
                `$exportador_${i}, $dataEmissao_${i}, $valor_${i}, $valorMoedaNegociada_${i}, ` +
                `$moeda_${i}, $moedaNegociada_${i}, $pago_${i}, $valorPermutar_${i}, ` +
                `$estado_${i}, $motivo_${i}, ` +
                `$aging_${i}, $taxa_${i}, $valorTotal_${i}, $valorAberto_${i}, ` +
                `$pesCod_${i}, $importador_${i}, ` +
                `$runId, now(), FALSE, now())`
            );
        });
        await tx.insert(
            `INSERT INTO permuta_adiantamento (
                doc_cod, pri_cod, fil_cod, referencia, referencia_externa, exportador, data_emissao,
                valor, valor_moeda_negociada, moeda, moeda_negociada, pago, valor_permutar,
                estado_elegibilidade, motivo_bloqueio, aging_days, taxa,
                valor_total, valor_aberto, pes_cod, importador,
                last_ingest_run_id, last_seen_at, stale, updated_at
            ) VALUES ${tuples.join(', ')}
            ON CONFLICT (doc_cod) DO UPDATE SET
                pri_cod = EXCLUDED.pri_cod,
                fil_cod = EXCLUDED.fil_cod,
                referencia = EXCLUDED.referencia,
                referencia_externa = EXCLUDED.referencia_externa,
                exportador = EXCLUDED.exportador,
                data_emissao = EXCLUDED.data_emissao,
                valor = EXCLUDED.valor,
                valor_moeda_negociada = EXCLUDED.valor_moeda_negociada,
                moeda = EXCLUDED.moeda,
                moeda_negociada = EXCLUDED.moeda_negociada,
                pago = EXCLUDED.pago,
                valor_permutar = EXCLUDED.valor_permutar,
                estado_elegibilidade = EXCLUDED.estado_elegibilidade,
                motivo_bloqueio = EXCLUDED.motivo_bloqueio,
                aging_days = EXCLUDED.aging_days,
                taxa = EXCLUDED.taxa,
                valor_total = EXCLUDED.valor_total,
                valor_aberto = EXCLUDED.valor_aberto,
                pes_cod = EXCLUDED.pes_cod,
                importador = EXCLUDED.importador,
                last_ingest_run_id = EXCLUDED.last_ingest_run_id,
                last_seen_at = EXCLUDED.last_seen_at,
                stale = FALSE,
                updated_at = now()`,
            params,
        );
    };

    public upsertInvoices = async (
        tx: TransactionClient,
        runId: string,
        rows: InvoiceRow[],
    ): Promise<void> => {
        const unique = dedupeByKey(rows, (r) => r.docCod);
        for (const chunk of chunked(unique, UPSERT_CHUNK)) {
            await this.upsertInvoiceChunk(tx, runId, chunk);
        }
    };

    private upsertInvoiceChunk = async (
        tx: TransactionClient,
        runId: string,
        rows: InvoiceRow[],
    ): Promise<void> => {
        if (rows.length === 0) return;
        const params: Record<string, unknown> = { runId };
        const tuples = rows.map((r, i) => {
            params[`docCod_${i}`] = r.docCod;
            params[`priCod_${i}`] = r.priCod;
            params[`filCod_${i}`] = r.filCod ?? null;
            params[`referencia_${i}`] = r.referencia ?? null;
            params[`referenciaExterna_${i}`] = r.referenciaExterna ?? null;
            params[`exportador_${i}`] = r.exportador ?? null;
            params[`dataEmissao_${i}`] = r.dataEmissao ? r.dataEmissao.toISOString() : null;
            params[`valor_${i}`] = r.valor ?? null;
            params[`valorMoedaNegociada_${i}`] = r.valorMoedaNegociada ?? null;
            params[`moeda_${i}`] = r.moeda ?? null;
            params[`moedaNegociada_${i}`] = r.moedaNegociada ?? null;
            params[`pago_${i}`] = r.pago;
            params[`taxa_${i}`] = r.taxa ?? null;
            params[`pesCod_${i}`] = r.pesCod ?? null;
            params[`importador_${i}`] = r.importador ?? null;
            return (
                `($docCod_${i}, $priCod_${i}, $filCod_${i}, $referencia_${i}, $referenciaExterna_${i}, ` +
                `$exportador_${i}, $dataEmissao_${i}, $valor_${i}, $valorMoedaNegociada_${i}, ` +
                `$moeda_${i}, $moedaNegociada_${i}, $pago_${i}, $taxa_${i}, ` +
                `$pesCod_${i}, $importador_${i}, $runId, now(), FALSE, now())`
            );
        });
        await tx.insert(
            `INSERT INTO permuta_invoice (
                doc_cod, pri_cod, fil_cod, referencia, referencia_externa, exportador, data_emissao,
                valor, valor_moeda_negociada, moeda, moeda_negociada, pago, taxa,
                pes_cod, importador,
                last_ingest_run_id, last_seen_at, stale, updated_at
            ) VALUES ${tuples.join(', ')}
            ON CONFLICT (doc_cod) DO UPDATE SET
                pri_cod = EXCLUDED.pri_cod,
                fil_cod = EXCLUDED.fil_cod,
                referencia = EXCLUDED.referencia,
                referencia_externa = EXCLUDED.referencia_externa,
                exportador = EXCLUDED.exportador,
                data_emissao = EXCLUDED.data_emissao,
                valor = EXCLUDED.valor,
                valor_moeda_negociada = EXCLUDED.valor_moeda_negociada,
                moeda = EXCLUDED.moeda,
                moeda_negociada = EXCLUDED.moeda_negociada,
                pago = EXCLUDED.pago,
                taxa = EXCLUDED.taxa,
                pes_cod = EXCLUDED.pes_cod,
                importador = EXCLUDED.importador,
                last_ingest_run_id = EXCLUDED.last_ingest_run_id,
                last_seen_at = EXCLUDED.last_seen_at,
                stale = FALSE,
                updated_at = now()`,
            params,
        );
    };

    public upsertDeclaracoes = async (
        tx: TransactionClient,
        runId: string,
        rows: DeclaracaoRow[],
    ): Promise<void> => {
        const unique = dedupeByKey(rows, (r) => `${r.priCod}|${r.variante}`);
        for (const chunk of chunked(unique, UPSERT_CHUNK)) {
            await this.upsertDeclaracaoChunk(tx, runId, chunk);
        }
    };

    private upsertDeclaracaoChunk = async (
        tx: TransactionClient,
        runId: string,
        rows: DeclaracaoRow[],
    ): Promise<void> => {
        if (rows.length === 0) return;
        const params: Record<string, unknown> = { runId };
        const tuples = rows.map((r, i) => {
            params[`priCod_${i}`] = r.priCod;
            params[`variante_${i}`] = r.variante;
            params[`dataBase_${i}`] = r.dataBase ? r.dataBase.toISOString() : null;
            return `($priCod_${i}, $variante_${i}, $dataBase_${i}, $runId, now(), FALSE, now())`;
        });
        await tx.insert(
            `INSERT INTO permuta_declaracao_importacao (
                pri_cod, variante, data_base, last_ingest_run_id, last_seen_at, stale, updated_at
            ) VALUES ${tuples.join(', ')}
            ON CONFLICT (pri_cod, variante) DO UPDATE SET
                data_base = EXCLUDED.data_base,
                last_ingest_run_id = EXCLUDED.last_ingest_run_id,
                last_seen_at = EXCLUDED.last_seen_at,
                stale = FALSE,
                updated_at = now()`,
            params,
        );
    };

    /**
     * Recompute do casamento automático 1:1: DELETE total + bulk INSERT dos
     * casamentos do run. Idempotente por run (o estado do casamento é sempre o
     * recomputado pela ingestão atual).
     */
    public replaceAutoCasamentos = async (
        tx: TransactionClient,
        runId: string,
        rows: CasamentoRow[],
    ): Promise<void> => {
        await tx.update('DELETE FROM permuta_casamento', {});
        const unique = dedupeByKey(rows, (r) => `${r.invoiceDocCod}|${r.adiantamentoDocCod}`);
        for (const chunk of chunked(unique, UPSERT_CHUNK)) {
            await this.insertCasamentoChunk(tx, runId, chunk);
        }
    };

    private insertCasamentoChunk = async (
        tx: TransactionClient,
        runId: string,
        rows: CasamentoRow[],
    ): Promise<void> => {
        if (rows.length === 0) return;
        const params: Record<string, unknown> = { runId };
        const tuples = rows.map((r, i) => {
            params[`invoiceDocCod_${i}`] = r.invoiceDocCod;
            params[`adiantamentoDocCod_${i}`] = r.adiantamentoDocCod;
            params[`priCod_${i}`] = r.priCod;
            params[`valorASerUsado_${i}`] = r.valorASerUsado ?? null;
            params[`moeda_${i}`] = r.moeda ?? null;
            params[`varClass_${i}`] = r.variacaoClassificacao ?? null;
            params[`varResultado_${i}`] = r.variacaoResultado ?? null;
            params[`varDelta_${i}`] = r.variacaoDelta ?? null;
            params[`taxaAdto_${i}`] = r.taxaAdiantamento ?? null;
            params[`taxaInvoice_${i}`] = r.taxaInvoice ?? null;
            return (
                `($invoiceDocCod_${i}, $adiantamentoDocCod_${i}, $priCod_${i}, ` +
                `$valorASerUsado_${i}, $moeda_${i}, $varClass_${i}, $varResultado_${i}, ` +
                `$varDelta_${i}, $taxaAdto_${i}, $taxaInvoice_${i}, $runId)`
            );
        });
        await tx.insert(
            `INSERT INTO permuta_casamento (
                invoice_doc_cod, adiantamento_doc_cod, pri_cod, valor_a_ser_usado,
                moeda, variacao_classificacao, variacao_resultado, variacao_delta,
                taxa_adiantamento, taxa_invoice, last_ingest_run_id
            ) VALUES ${tuples.join(', ')}`,
            params,
        );
    };

    /**
     * Staleness sweep: marca como `stale` todo fato cujo `last_ingest_run_id`
     * difere do run atual (não foi visto nesta ingestão). NUNCA deleta — o
     * histórico/estado do analista sobrevive.
     */
    public markStale = async (tx: TransactionClient, runId: string): Promise<number> => {
        // Statements com NOMES DE TABELA LITERAIS (não há interpolação de input
        // externo — Rule #5: os valores `$runId` são parametrizados).
        const staleAdiantamentos = await tx.update(
            `UPDATE permuta_adiantamento SET stale = TRUE, updated_at = now()
             WHERE last_ingest_run_id IS DISTINCT FROM $runId AND NOT stale`,
            { runId },
        );
        const staleInvoices = await tx.update(
            `UPDATE permuta_invoice SET stale = TRUE, updated_at = now()
             WHERE last_ingest_run_id IS DISTINCT FROM $runId AND NOT stale`,
            { runId },
        );
        const staleDeclaracoes = await tx.update(
            `UPDATE permuta_declaracao_importacao SET stale = TRUE, updated_at = now()
             WHERE last_ingest_run_id IS DISTINCT FROM $runId AND NOT stale`,
            { runId },
        );
        return staleAdiantamentos + staleInvoices + staleDeclaracoes;
    };

    // ---- Reads (tela Gestão) ----

    /** Importador distinto presente no backlog ativo — alimenta o seletor do
     * cadastro de cliente-filtro (evita o analista digitar o pesCod). */
    public listImportadores = async (): Promise<
        Array<{ pesCod: string; importador?: string; qtdAdtos: number }>
    > => {
        const rows = await this.databaseClient.selectMany(
            `SELECT pes_cod, importador, count(*) AS qtd
             FROM permuta_adiantamento
             WHERE NOT stale AND pes_cod IS NOT NULL
             GROUP BY pes_cod, importador
             ORDER BY importador ASC NULLS LAST`,
        );
        return rows.map((r) => ({
            pesCod: String(r.pes_cod),
            ...(r.importador != null ? { importador: String(r.importador) } : {}),
            qtdAdtos: Number(r.qtd),
        }));
    };

    public listAdiantamentosAtivos = async (filtro?: {
        estadoElegibilidade?: EstadoElegibilidadeRow;
    }): Promise<AdiantamentoAtivo[]> => {
        const rows = filtro?.estadoElegibilidade
            ? await this.databaseClient.selectMany(
                  `SELECT * FROM permuta_adiantamento
                   WHERE NOT stale AND estado_elegibilidade = $estado
                   ORDER BY (aging_days IS NULL), aging_days DESC, doc_cod ASC`,
                  { estado: filtro.estadoElegibilidade },
              )
            : await this.databaseClient.selectMany(
                  `SELECT * FROM permuta_adiantamento
                   WHERE NOT stale
                   ORDER BY (aging_days IS NULL), aging_days DESC, doc_cod ASC`,
              );
        return rows.map((r) => this.mapAdiantamentoRow(r));
    };

    public listInvoicesEmAberto = async (): Promise<InvoiceRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT * FROM permuta_invoice
             WHERE NOT stale AND NOT pago
             ORDER BY doc_cod ASC`,
        );
        return rows.map((r) => this.mapInvoiceRow(r));
    };

    public listDeclaracoes = async (): Promise<DeclaracaoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT pri_cod, variante, data_base
             FROM permuta_declaracao_importacao
             WHERE NOT stale`,
        );
        return rows.map((r) => this.mapDeclaracaoRow(r));
    };

    public listCasamentos = async (): Promise<CasamentoRow[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT invoice_doc_cod, adiantamento_doc_cod, pri_cod, valor_a_ser_usado,
                    moeda, variacao_classificacao, variacao_resultado, variacao_delta,
                    taxa_adiantamento, taxa_invoice
             FROM permuta_casamento
             ORDER BY invoice_doc_cod ASC, adiantamento_doc_cod ASC`,
        );
        return rows.map((r) => this.mapCasamentoRow(r));
    };

    public findAdiantamento = async (docCod: string): Promise<AdiantamentoAtivo | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            'SELECT * FROM permuta_adiantamento WHERE doc_cod = $docCod',
            { docCod },
        );
        return row ? this.mapAdiantamentoRow(row) : null;
    };

    /**
     * Reclassifica UMA linha de adiantamento de um estado/motivo de ORIGEM para um de destino,
     * dentro da transação do chamador (exceção manual, ADR-0047). O estado de origem no WHERE
     * é a trava otimista: se a ingestão mudou a linha entre a leitura e a gravação, nada é
     * escrito e o rowCount 0 volta para o serviço decidir. Ignora linhas `stale`.
     */
    public reclassificarAdiantamento = async (
        tx: TransactionClient,
        input: {
            docCod: string;
            de: { estado: EstadoElegibilidade; motivo: MotivoBloqueio };
            para: { estado: EstadoElegibilidade; motivo: MotivoBloqueio };
        },
    ): Promise<number> => {
        return tx.update(
            `UPDATE permuta_adiantamento
             SET estado_elegibilidade = $paraEstado, motivo_bloqueio = $paraMotivo
             WHERE doc_cod = $docCod AND NOT stale
               AND estado_elegibilidade = $deEstado AND motivo_bloqueio = $deMotivo`,
            {
                docCod: input.docCod,
                deEstado: input.de.estado,
                deMotivo: input.de.motivo,
                paraEstado: input.para.estado,
                paraMotivo: input.para.motivo,
            },
        );
    };

    private mapAdiantamentoRow = (r: Record<string, unknown>): AdiantamentoAtivo => ({
        docCod: String(r.doc_cod),
        priCod: String(r.pri_cod),
        ...(r.fil_cod != null ? { filCod: Number(r.fil_cod) } : {}),
        ...(r.referencia != null ? { referencia: String(r.referencia) } : {}),
        ...(r.referencia_externa != null
            ? { referenciaExterna: String(r.referencia_externa) }
            : {}),
        ...(r.exportador != null ? { exportador: String(r.exportador) } : {}),
        ...(r.data_emissao != null ? { dataEmissao: new Date(String(r.data_emissao)) } : {}),
        ...(r.valor != null ? { valor: Number(r.valor) } : {}),
        ...(r.valor_moeda_negociada != null
            ? { valorMoedaNegociada: Number(r.valor_moeda_negociada) }
            : {}),
        ...(r.moeda != null ? { moeda: String(r.moeda) } : {}),
        ...(r.moeda_negociada != null ? { moedaNegociada: String(r.moeda_negociada) } : {}),
        pago: Boolean(r.pago),
        ...(r.valor_permutar != null ? { valorPermutar: Number(r.valor_permutar) } : {}),
        estadoElegibilidade: parseEstadoElegibilidadeRow(r.estado_elegibilidade, String(r.doc_cod)),
        ...(r.motivo_bloqueio != null ? { motivoBloqueio: String(r.motivo_bloqueio) } : {}),
        ...(r.aging_days != null ? { agingDays: Number(r.aging_days) } : {}),
        ...(r.taxa != null ? { taxa: Number(r.taxa) } : {}),
        ...(r.valor_total != null ? { valorTotal: Number(r.valor_total) } : {}),
        ...(r.valor_aberto != null ? { valorAberto: Number(r.valor_aberto) } : {}),
        ...(r.pes_cod != null ? { pesCod: String(r.pes_cod) } : {}),
        ...(r.importador != null ? { importador: String(r.importador) } : {}),
        stale: Boolean(r.stale),
    });

    private mapInvoiceRow = (r: Record<string, unknown>): InvoiceRow => ({
        docCod: String(r.doc_cod),
        priCod: String(r.pri_cod),
        ...(r.fil_cod != null ? { filCod: Number(r.fil_cod) } : {}),
        ...(r.referencia != null ? { referencia: String(r.referencia) } : {}),
        ...(r.referencia_externa != null
            ? { referenciaExterna: String(r.referencia_externa) }
            : {}),
        ...(r.exportador != null ? { exportador: String(r.exportador) } : {}),
        ...(r.data_emissao != null ? { dataEmissao: new Date(String(r.data_emissao)) } : {}),
        ...(r.valor != null ? { valor: Number(r.valor) } : {}),
        ...(r.valor_moeda_negociada != null
            ? { valorMoedaNegociada: Number(r.valor_moeda_negociada) }
            : {}),
        ...(r.moeda != null ? { moeda: String(r.moeda) } : {}),
        ...(r.moeda_negociada != null ? { moedaNegociada: String(r.moeda_negociada) } : {}),
        pago: Boolean(r.pago),
        ...(r.taxa != null ? { taxa: Number(r.taxa) } : {}),
        ...(r.pes_cod != null ? { pesCod: String(r.pes_cod) } : {}),
        ...(r.importador != null ? { importador: String(r.importador) } : {}),
    });

    private mapDeclaracaoRow = (r: Record<string, unknown>): DeclaracaoRow => ({
        priCod: String(r.pri_cod),
        // Cast mantido de propósito: `variante` é fechada pela CHECK
        // `permuta_declaracao_importacao_variante_check` ('DI'|'DUIMP'), é
        // ortogonal a este ciclo e não tem histórico de estado novo entrando por
        // ela. Documentado, não hardenizado — endurecer aqui seria escopo alheio.
        variante: String(r.variante) as DeclaracaoRow['variante'],
        ...(r.data_base != null ? { dataBase: new Date(String(r.data_base)) } : {}),
    });

    private mapCasamentoRow = (r: Record<string, unknown>): CasamentoRow => ({
        invoiceDocCod: String(r.invoice_doc_cod),
        adiantamentoDocCod: String(r.adiantamento_doc_cod),
        priCod: String(r.pri_cod),
        ...(r.valor_a_ser_usado != null ? { valorASerUsado: Number(r.valor_a_ser_usado) } : {}),
        ...(r.moeda != null ? { moeda: String(r.moeda) } : {}),
        ...(r.variacao_classificacao != null
            ? { variacaoClassificacao: String(r.variacao_classificacao) }
            : {}),
        ...(r.variacao_resultado != null
            ? { variacaoResultado: Number(r.variacao_resultado) }
            : {}),
        ...(r.variacao_delta != null ? { variacaoDelta: Number(r.variacao_delta) } : {}),
        ...(r.taxa_adiantamento != null ? { taxaAdiantamento: Number(r.taxa_adiantamento) } : {}),
        ...(r.taxa_invoice != null ? { taxaInvoice: Number(r.taxa_invoice) } : {}),
    });
}
