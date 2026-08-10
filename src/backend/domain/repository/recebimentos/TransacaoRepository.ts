import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import {
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type {
    TransacaoBancariaStatus,
    TransacaoTipo,
} from '../../interface/recebimentos/constants.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import type { TransacaoRepositoryInterface } from '../../interface/recebimentos/ports.js';

/** Linhas por statement no upsert em lote (espelha o chunk do `TituloAPagarRepository`). */
const UPSERT_CHUNK = 200;

const COLUNAS = `id, correlation_id, fil_cod, data_movimento, tipo, valor, moeda,
                 contraparte, referencia_bancaria, natural_key, raw_payload, normalized,
                 status, import_run_id, importado_em, ger_num, categoria, categoria_desc, canal`;

/**
 * TransacaoRepository — CRUD sobre `transacao_bancaria` (0032 + 0040). SQL 100%
 * parametrizado (Rule #5); `mapRow` privado.
 */
@injectable()
export default class TransacaoRepository implements TransacaoRepositoryInterface {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    public save = async (transacao: TransacaoBancaria): Promise<TransacaoBancaria> => {
        await this.databaseClient.update(
            `INSERT INTO transacao_bancaria (
                id, correlation_id, fil_cod, data_movimento, tipo, valor, moeda,
                contraparte, referencia_bancaria, natural_key, raw_payload, normalized,
                status, import_run_id, importado_em
            ) VALUES (
                $id, $correlationId, $filCod, $dataMovimento, $tipo, $valor, $moeda,
                $contraparte, $referenciaBancaria, $naturalKey, $rawPayload::jsonb, $normalized::jsonb,
                $status, $importRunId, $importadoEm
            )
            ON CONFLICT (natural_key) DO UPDATE SET
                status = EXCLUDED.status,
                normalized = EXCLUDED.normalized`,
            {
                id: transacao.id,
                correlationId: transacao.correlationId,
                filCod: transacao.filCod ?? null,
                dataMovimento: transacao.dataMovimento,
                tipo: transacao.tipo,
                valor: transacao.valor,
                moeda: transacao.moeda,
                contraparte: transacao.contraparte ?? null,
                referenciaBancaria: transacao.referenciaBancaria ?? null,
                naturalKey: transacao.naturalKey,
                rawPayload: JSON.stringify(transacao.rawPayload ?? null),
                normalized: JSON.stringify(transacao.normalized ?? null),
                status: transacao.status,
                importRunId: transacao.importRunId ?? null,
                importadoEm: transacao.importadoEm,
            },
        );
        return transacao;
    };

    /**
     * UPSERT em lote da ingestão (Módulo 1). Uma transação por chamada, chunks de
     * `CHUNK` linhas, multi-row `VALUES` — todos os valores parametrizados.
     *
     * ⚠️ A cláusula `WHERE transacao_bancaria.status = 'importada'` é o ponto mais
     * importante deste método. O `save` unitário faz `status = EXCLUDED.status`, o
     * que significa que a reingestão diária DEVOLVE para `importada` qualquer
     * transação que o analista já tenha movido para `conciliada`/`parcial`/`manual`
     * — perda silenciosa de trabalho, proporcional à frequência do cron. Aqui a
     * atualização só alcança linhas ainda intocadas, e `status`/`id`/`correlation_id`/
     * `import_run_id`/`importado_em` NUNCA são sobrescritos: são propriedades do
     * nascimento da transação.
     *
     * `RETURNING (xmax = 0)` distingue INSERT de UPDATE sem uma query extra
     * (`xmax = 0` só em tupla recém-inserida). Linhas barradas pelo `WHERE` não
     * voltam no `RETURNING` — contam como deduplicadas.
     */
    public upsertMany = async (
        transacoes: TransacaoBancaria[],
        runId: string,
    ): Promise<{ inseridas: number; deduplicadas: number }> => {
        if (transacoes.length === 0) return { inseridas: 0, deduplicadas: 0 };

        let inseridas = 0;
        await this.databaseClient.withTransaction(async (tx) => {
            for (let i = 0; i < transacoes.length; i += UPSERT_CHUNK) {
                const chunk = transacoes.slice(i, i + UPSERT_CHUNK);
                const tuples: string[] = [];
                const params: Record<string, unknown> = { runId };

                chunk.forEach((t, n) => {
                    // `$runId` alimenta DUAS colunas de tipos diferentes:
                    // `import_run_id` é TEXT (0032) e `visto_em_run_id` é UUID (0040).
                    // Sem os casts explícitos o Postgres tenta deduzir um único tipo
                    // para o mesmo parâmetro e falha com
                    // "inconsistent types deduced for parameter".
                    tuples.push(
                        `($id${n}, $co${n}, $fi${n}, $dm${n}, $ti${n}, $va${n}, $mo${n}, ` +
                            `$cp${n}, $rb${n}, $nk${n}, $rp${n}::jsonb, $no${n}::jsonb, ` +
                            `$st${n}, $runId::text, $ie${n}, $gn${n}, $ca${n}, $cd${n}, $cl${n}, ` +
                            `$runId::uuid, now())`,
                    );
                    params[`id${n}`] = t.id;
                    params[`co${n}`] = t.correlationId;
                    // `null` = conta CORPORATIVA (canal fin095, ADR-0032).
                    params[`fi${n}`] = t.filCod ?? null;
                    params[`dm${n}`] = t.dataMovimento;
                    params[`ti${n}`] = t.tipo;
                    params[`va${n}`] = t.valor;
                    params[`mo${n}`] = t.moeda;
                    params[`cp${n}`] = t.contraparte ?? null;
                    params[`rb${n}`] = t.referenciaBancaria ?? null;
                    params[`nk${n}`] = t.naturalKey;
                    params[`rp${n}`] = JSON.stringify(t.rawPayload ?? null);
                    params[`no${n}`] = JSON.stringify(t.normalized ?? null);
                    params[`st${n}`] = t.status;
                    params[`ie${n}`] = t.importadoEm;
                    params[`gn${n}`] = t.gerNum ?? null;
                    params[`ca${n}`] = t.categoria ?? null;
                    params[`cd${n}`] = t.categoriaDesc ?? null;
                    params[`cl${n}`] = t.canal ?? null;
                });

                const rows = (await tx.selectMany(
                    `INSERT INTO transacao_bancaria (
                        id, correlation_id, fil_cod, data_movimento, tipo, valor, moeda,
                        contraparte, referencia_bancaria, natural_key, raw_payload, normalized,
                        status, import_run_id, importado_em, ger_num, categoria, categoria_desc, canal,
                        visto_em_run_id, atualizado_em
                     ) VALUES ${tuples.join(', ')}
                     ON CONFLICT (natural_key) DO UPDATE SET
                        valor = EXCLUDED.valor,
                        contraparte = EXCLUDED.contraparte,
                        referencia_bancaria = EXCLUDED.referencia_bancaria,
                        raw_payload = EXCLUDED.raw_payload,
                        normalized = EXCLUDED.normalized,
                        ger_num = EXCLUDED.ger_num,
                        categoria = EXCLUDED.categoria,
                        categoria_desc = EXCLUDED.categoria_desc,
                        visto_em_run_id = EXCLUDED.visto_em_run_id,
                        atualizado_em = now()
                     WHERE transacao_bancaria.status = $statusIntocado
                     RETURNING (xmax = 0) AS inserida`,
                    { ...params, statusIntocado: TRANSACAO_BANCARIA_STATUS.IMPORTADA },
                )) as Array<{ inserida: boolean }>;

                inseridas += rows.filter((r) => r.inserida).length;
            }
        });

        return { inseridas, deduplicadas: transacoes.length - inseridas };
    };

    /**
     * Lista para o painel. `desde` é opcional; `tipos`/`statuses` filtram quando
     * informados. `categoriasExcluidas` remove o ruído de tesouraria (RESGATE DE
     * APLICAÇÃO, AÇÕES, TRANSFERÊNCIA ENTRE CONTAS) sem apagá-lo do banco — a
     * exclusão é de APRESENTAÇÃO e reversível.
     */
    public listParaPainel = async (input: {
        filCods: number[];
        tipos?: TransacaoTipo[];
        statuses?: TransacaoBancariaStatus[];
        categoriasExcluidas?: string[];
        desde?: Date;
        limit: number;
    }): Promise<TransacaoBancaria[]> => {
        if (input.filCods.length === 0) return [];
        const { where, params } = this.buildFiltro(input);
        const rows = await this.databaseClient.selectMany(
            `SELECT ${COLUNAS}
             FROM transacao_bancaria
             WHERE ${where}
             ORDER BY data_movimento DESC, id
             LIMIT $limit`,
            { ...params, limit: input.limit },
        );
        return rows.map(this.mapRow);
    };

    /**
     * Contagem por status sobre a JANELA INTEIRA — nunca sobre a página. Os KPIs
     * do painel derivados da lista mentiriam assim que a lista fosse capada.
     */
    public contarKpis = async (input: {
        filCods: number[];
        tipos?: TransacaoTipo[];
        categoriasExcluidas?: string[];
        desde?: Date;
    }): Promise<Record<string, number>> => {
        if (input.filCods.length === 0) return {};
        const { where, params } = this.buildFiltro(input);
        const rows = (await this.databaseClient.selectMany(
            `SELECT status, COUNT(*)::int AS total
             FROM transacao_bancaria
             WHERE ${where}
             GROUP BY status`,
            params,
        )) as Array<{ status: string; total: number }>;
        return Object.fromEntries(rows.map((r) => [r.status, r.total]));
    };

    /** Soma do valor ainda não conciliado — alimenta o KPI "valor a distribuir". */
    public somarValorPorStatus = async (input: {
        filCods: number[];
        tipos?: TransacaoTipo[];
        categoriasExcluidas?: string[];
        desde?: Date;
    }): Promise<Record<string, number>> => {
        if (input.filCods.length === 0) return {};
        const { where, params } = this.buildFiltro(input);
        const rows = (await this.databaseClient.selectMany(
            `SELECT status, COALESCE(SUM(valor), 0)::float8 AS total
             FROM transacao_bancaria
             WHERE ${where}
             GROUP BY status`,
            params,
        )) as Array<{ status: string; total: number }>;
        return Object.fromEntries(rows.map((r) => [r.status, r.total]));
    };

    /** Cláusula WHERE compartilhada por list/contar/somar — sempre parametrizada. */
    private buildFiltro = (input: {
        filCods: number[];
        tipos?: TransacaoTipo[];
        statuses?: TransacaoBancariaStatus[];
        categoriasExcluidas?: string[];
        desde?: Date;
    }): { where: string; params: Record<string, unknown> } => {
        // `fil_cod IS NULL` = conta CORPORATIVA (canal fin095, ADR-0032): o crédito
        // ainda não pertence a nenhuma filial e é visível a todo usuário autorizado,
        // qualquer que seja a filial dele. A authz por filial NÃO é enfraquecida —
        // ela vale onde move dinheiro (`pipeline/run`, `alocar`, emissão da NDe),
        // contra a filial do PROCESSO escolhido. Excluir os corporativos aqui deixaria
        // a carteira vazia e o dinheiro a conciliar invisível.
        const clauses = ['(fil_cod IS NULL OR fil_cod = ANY($filCods))'];
        const params: Record<string, unknown> = { filCods: input.filCods };

        if (input.tipos && input.tipos.length > 0) {
            clauses.push('tipo = ANY($tipos)');
            params.tipos = input.tipos;
        }
        if (input.statuses && input.statuses.length > 0) {
            clauses.push('status = ANY($statuses)');
            params.statuses = input.statuses;
        }
        if (input.categoriasExcluidas && input.categoriasExcluidas.length > 0) {
            // `categoria IS NULL` continua entrando: ausência de categoria não é
            // prova de ruído, e esconder o desconhecido é pior que mostrá-lo.
            clauses.push('(categoria IS NULL OR NOT (categoria = ANY($categoriasExcluidas)))');
            params.categoriasExcluidas = input.categoriasExcluidas;
        }
        if (input.desde) {
            clauses.push('data_movimento >= $desde');
            params.desde = input.desde;
        }
        return { where: clauses.join(' AND '), params };
    };

    public findById = async (id: string): Promise<TransacaoBancaria | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT ${COLUNAS}
             FROM transacao_bancaria
             WHERE id = $id`,
            { id },
        );
        return row ? this.mapRow(row) : null;
    };

    private mapRow = (r: Record<string, unknown>): TransacaoBancaria => ({
        id: String(r.id),
        correlationId: String(r.correlation_id),
        ...(r.fil_cod != null ? { filCod: Number(r.fil_cod) } : {}),
        dataMovimento: new Date(r.data_movimento as string | Date),
        tipo: (r.tipo as TransacaoTipo) ?? TRANSACAO_TIPO.CREDITO,
        valor: Number(r.valor),
        moeda: String(r.moeda),
        ...(r.contraparte != null ? { contraparte: String(r.contraparte) } : {}),
        ...(r.referencia_bancaria != null
            ? { referenciaBancaria: String(r.referencia_bancaria) }
            : {}),
        naturalKey: String(r.natural_key),
        rawPayload: r.raw_payload ?? null,
        normalized: r.normalized ?? null,
        status: (r.status as TransacaoBancariaStatus) ?? TRANSACAO_BANCARIA_STATUS.IMPORTADA,
        ...(r.import_run_id != null ? { importRunId: String(r.import_run_id) } : {}),
        importadoEm: new Date(r.importado_em as string | Date),
        ...(r.ger_num != null ? { gerNum: Number(r.ger_num) } : {}),
        ...(r.categoria != null ? { categoria: String(r.categoria) } : {}),
        ...(r.categoria_desc != null ? { categoriaDesc: String(r.categoria_desc) } : {}),
        ...(r.canal != null ? { canal: String(r.canal) } : {}),
    });

    /**
     * Quais das `naturalKeys` já existem na carteira. READ-ONLY — alimenta o PREVIEW do upload
     * manual (novos × já importados) sem escrever nada. Parametrizado via `ANY($naturalKeys)`.
     */
    public existingNaturalKeys = async (naturalKeys: string[]): Promise<Set<string>> => {
        if (naturalKeys.length === 0) return new Set();
        const rows = (await this.databaseClient.selectMany(
            `SELECT natural_key FROM transacao_bancaria WHERE natural_key = ANY($naturalKeys)`,
            { naturalKeys },
        )) as Array<{ natural_key: string }>;
        return new Set(rows.map((r) => String(r.natural_key)));
    };
}
