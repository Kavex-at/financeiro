import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import {
    EXECUCAO_INTERROMPIDA_MINUTOS,
    TRANSACAO_BANCARIA_STATUS,
    TRANSACAO_TIPO,
} from '../../interface/recebimentos/constants.js';
import type {
    TransacaoBancariaStatus,
    TransacaoTipo,
} from '../../interface/recebimentos/constants.js';
import { origensPermitidasPara } from '../../interface/recebimentos/recebimentoTransitions.js';
import type { TransacaoBancaria } from '../../interface/recebimentos/TransacaoBancaria.js';
import type { TransacaoRepositoryInterface } from '../../interface/recebimentos/ports.js';

/** Linhas por statement no upsert em lote (espelha o chunk do `TituloAPagarRepository`). */
const UPSERT_CHUNK = 200;

/**
 * Σ das alocações JÁ EXECUTADAS por crédito — subconsulta compartilhada pela reconciliação e pelo
 * KPI "a distribuir" (ADR-0034).
 *
 * `status = 'settled' AND dry_run = FALSE` porque a chave de idempotência do ledger é
 * `sn-real:{txnId}:{priCod}:{valor}`: somar todos os status contaria duas vezes uma alocação
 * retentada com valor diferente. Comparações derivadas daqui usam `ROUND(x * 100)` sobre `NUMERIC`
 * — dinheiro nunca é comparado em ponto flutuante.
 */
const SETTLED_POR_TXN = `SELECT txn_id, SUM(valor) AS alocado
                           FROM solicitacao_numerario_execucao
                          WHERE status = 'settled' AND dry_run = FALSE AND txn_id IS NOT NULL
                          GROUP BY txn_id
                         HAVING SUM(valor) IS NOT NULL`;

const COLUNAS = `id, correlation_id, fil_cod, data_movimento, tipo, valor, moeda,
                 contraparte, referencia_bancaria, natural_key, raw_payload, normalized,
                 status, import_run_id, importado_em, ger_num, categoria, categoria_desc, canal,
                 arquivada_em, arquivada_por,
                 conta_descricao, transferencia_interna`;

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
     * ⚠️ O LATCH — `status = 'importada'` E nenhuma linha de ledger — é o ponto mais
     * importante deste método. O `save` unitário faz `status = EXCLUDED.status`, o
     * que significa que a reingestão diária DEVOLVE para `importada` qualquer
     * transação que o analista já tenha movido para `conciliada`/`parcial`/`manual`
     * — perda silenciosa de trabalho, proporcional à frequência do cron. Aqui a
     * atualização só alcança linhas ainda intocadas, e `status`/`id`/`correlation_id`/
     * `import_run_id`/`importado_em` NUNCA são sobrescritos: são propriedades do
     * nascimento da transação.
     *
     * O `NOT EXISTS` sobre o ledger (ADR-0034) fecha o furo que sobrava: um crédito cuja marcação de
     * status falhou continuava `importada` e portanto continuava sendo refrescado toda hora — com
     * `valor` incluído, que é justamente o denominador da regra Σ. O cron podia mexer no denominador
     * debaixo de uma alocação em curso. Qualquer linha de ledger, em qualquer status, significa que
     * um humano mirou neste crédito; a guarda é estritamente mais forte, nunca mais fraca.
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
                            `$kd${n}, $tin${n}, $runId::uuid, now())`,
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
                    params[`kd${n}`] = t.contaDescricao ?? null;
                    params[`tin${n}`] = t.transferenciaInterna ?? false;
                });

                const rows = (await tx.selectMany(
                    `INSERT INTO transacao_bancaria (
                        id, correlation_id, fil_cod, data_movimento, tipo, valor, moeda,
                        contraparte, referencia_bancaria, natural_key, raw_payload, normalized,
                        status, import_run_id, importado_em, ger_num, categoria, categoria_desc, canal,
                        conta_descricao, transferencia_interna,
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
                        conta_descricao = EXCLUDED.conta_descricao,
                        transferencia_interna = EXCLUDED.transferencia_interna,
                        visto_em_run_id = EXCLUDED.visto_em_run_id,
                        atualizado_em = now()
                     WHERE transacao_bancaria.status = $statusIntocado
                       AND NOT EXISTS (
                           SELECT 1 FROM solicitacao_numerario_execucao e
                            WHERE e.txn_id = transacao_bancaria.id
                       )
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
        /** Default `false` — transferência entre contas da casa fica fora da carteira. */
        incluirTransferenciasInternas?: boolean;
        desde?: Date;
        /** `true` = a aba de revisão das arquivadas. Ausente = carteira ativa (default). */
        arquivadas?: boolean;
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
        /** Default `false` — transferência entre contas da casa fica fora da carteira. */
        incluirTransferenciasInternas?: boolean;
        desde?: Date;
        /** `true` = a aba de revisão das arquivadas. Ausente = carteira ativa (default). */
        arquivadas?: boolean;
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

    /**
     * Valor de face E valor já alocado, por status, sobre a JANELA INTEIRA — alimenta o KPI
     * "a distribuir".
     *
     * O `alocado` entrou na ADR-0034 junto com o status `parcial`. Sem ele, um crédito de R$ 100 mil
     * com R$ 90 mil já baixados apareceria na tela rotulado `parcial` enquanto o KPI logo acima o
     * contava por R$ 100 mil inteiros — o painel se contradizendo, que num painel financeiro é o
     * pior tipo de erro. Antes da ADR-0034 a distorção existia e era MAIOR (todo crédito já baixado
     * contava integralmente, porque nada saía de `importada`).
     *
     * `emAberto` é somado com `GREATEST(..., 0)` POR LINHA, dentro do SQL, e não subtraindo os dois
     * totais depois. A diferença importa: nada valida Σ alocações ≤ valor do crédito (a regra Σ
     * tolera `>=` de propósito, para pagamento a maior), então um crédito sobre-alocado geraria
     * saldo negativo que CANCELARIA o saldo aberto de outro crédito do mesmo grupo. O corte por
     * grupo esconderia dinheiro real a distribuir; o corte por linha, não.
     */
    public somarValorPorStatus = async (input: {
        filCods: number[];
        tipos?: TransacaoTipo[];
        categoriasExcluidas?: string[];
        /** Default `false` — transferência entre contas da casa fica fora da carteira. */
        incluirTransferenciasInternas?: boolean;
        desde?: Date;
        /** `true` = a aba de revisão das arquivadas. Ausente = carteira ativa (default). */
        arquivadas?: boolean;
    }): Promise<Record<string, { total: number; alocado: number; emAberto: number }>> => {
        if (input.filCods.length === 0) return {};
        const { where, params } = this.buildFiltro(input, 't');
        const rows = (await this.databaseClient.selectMany(
            `SELECT t.status,
                    COALESCE(SUM(t.valor), 0)::float8 AS total,
                    COALESCE(SUM(s.alocado), 0)::float8 AS alocado,
                    COALESCE(SUM(GREATEST(t.valor - COALESCE(s.alocado, 0), 0)), 0)::float8
                        AS em_aberto
             FROM transacao_bancaria t
             LEFT JOIN (${SETTLED_POR_TXN}) s ON s.txn_id = t.id
             WHERE ${where}
             GROUP BY t.status`,
            params,
        )) as Array<{ status: string; total: number; alocado: number; em_aberto: number }>;
        return Object.fromEntries(
            rows.map((r) => [
                r.status,
                { total: r.total, alocado: r.alocado, emAberto: r.em_aberto },
            ]),
        );
    };

    /**
     * Cláusula WHERE compartilhada por list/contar/somar — sempre parametrizada.
     *
     * `alias` qualifica as colunas (`t.fil_cod`) para as consultas que fazem JOIN com o ledger.
     * Ausente = sem prefixo, a forma que as consultas de tabela única sempre usaram.
     */
    private buildFiltro = (
        input: {
            filCods: number[];
            tipos?: TransacaoTipo[];
            statuses?: TransacaoBancariaStatus[];
            categoriasExcluidas?: string[];
            /** Default `false` — transferência entre contas da casa fica fora da carteira. */
            incluirTransferenciasInternas?: boolean;
            desde?: Date;
            /** `false`/ausente = só ATIVAS (default). `true` = só as arquivadas (a aba de revisão). */
            arquivadas?: boolean;
        },
        alias?: string,
    ): { where: string; params: Record<string, unknown> } => {
        const col = (nome: string): string => (alias ? `${alias}.${nome}` : nome);
        // `fil_cod IS NULL` = conta CORPORATIVA (canal fin095, ADR-0032): o crédito
        // ainda não pertence a nenhuma filial e é visível a todo usuário autorizado,
        // qualquer que seja a filial dele. A authz por filial NÃO é enfraquecida —
        // ela vale onde move dinheiro (`pipeline/run`, `alocar`, emissão da NDe),
        // contra a filial do PROCESSO escolhido. Excluir os corporativos aqui deixaria
        // a carteira vazia e o dinheiro a conciliar invisível.
        const clauses = [`(${col('fil_cod')} IS NULL OR ${col('fil_cod')} = ANY($filCods))`];
        const params: Record<string, unknown> = { filCods: input.filCods };

        // Arquivadas ficam de fora por DEFAULT — de toda leitura, incluindo os KPIs (ADR-0033).
        // A cláusula mora aqui, no filtro compartilhado por list/contar/somar, justamente para que
        // ninguém consiga somar no "a distribuir" um crédito que o analista tirou da carteira: um
        // KPI e uma tabela que discordam sobre o que existe é pior que qualquer um dos dois errado.
        clauses.push(
            input.arquivadas === true
                ? `${col('arquivada_em')} IS NOT NULL`
                : `${col('arquivada_em')} IS NULL`,
        );

        if (input.tipos && input.tipos.length > 0) {
            clauses.push(`${col('tipo')} = ANY($tipos)`);
            params.tipos = input.tipos;
        }
        if (input.statuses && input.statuses.length > 0) {
            clauses.push(`${col('status')} = ANY($statuses)`);
            params.statuses = input.statuses;
        }
        if (input.categoriasExcluidas && input.categoriasExcluidas.length > 0) {
            // `categoria IS NULL` continua entrando: ausência de categoria não é
            // prova de ruído, e esconder o desconhecido é pior que mostrá-lo.
            clauses.push(
                `(${col('categoria')} IS NULL OR NOT (${col('categoria')} = ANY($categoriasExcluidas)))`,
            );
            params.categoriasExcluidas = input.categoriasExcluidas;
        }
        if (!input.incluirTransferenciasInternas) {
            // Transferência entre contas da própria casa não é recebível. Escondida,
            // não apagada — mesma política do ruído de tesouraria.
            clauses.push(`${col('transferencia_interna')} = FALSE`);
        }
        if (input.desde) {
            clauses.push(`${col('data_movimento')} >= $desde`);
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
        ...(r.conta_descricao != null ? { contaDescricao: String(r.conta_descricao) } : {}),
        ...(r.categoria != null ? { categoria: String(r.categoria) } : {}),
        ...(r.categoria_desc != null ? { categoriaDesc: String(r.categoria_desc) } : {}),
        ...(r.canal != null ? { canal: String(r.canal) } : {}),
        ...(r.arquivada_em != null
            ? { arquivadaEm: new Date(r.arquivada_em as string | Date) }
            : {}),
        ...(r.arquivada_por != null ? { arquivadaPor: String(r.arquivada_por) } : {}),
        transferenciaInterna: r.transferencia_interna === true,
    });

    /**
     * Escreve o status da transação aplicando a máquina de estados como GUARDA DE ORIGEM em SQL
     * (ADR-0034). Substitui o antigo `marcarProcessada`, que só sabia escrever o terminal.
     *
     * A guarda mora no `WHERE`, e não num `assertTransitionTransacao` antes da chamada, por dois
     * motivos que se somam:
     *
     *  1. **Não pode lançar.** Quando esta linha roda, o dinheiro JÁ se moveu no ERP. Recusar por
     *     causa do estado anterior deixaria a tela mentindo sobre trabalho que o Conexos registrou —
     *     era o argumento correto do docblock antigo. Mas a conclusão de que a máquina precisava ser
     *     BYPASSADA não seguia: não escrever nada é seguro, lançar é que não era.
     *  2. **É atômico.** Ler o status, decidir e escrever em três tempos abriria janela para uma
     *     alocação concorrente rebaixar o terminal. No `WHERE`, o Postgres decide.
     *
     * Como `PROCESSADA` não é origem de nenhuma transição, `origensPermitidasPara` nunca a devolve —
     * então nenhuma escrita tardia consegue rebaixar um crédito já concluído, de graça.
     *
     * `status <> $destino` torna a reescrita um NO-OP silencioso (devolve `mudou: false`), não um
     * bloqueio: o chamador reparador pode chamar à vontade sem poluir o log.
     */
    public marcarStatus = async (
        id: string,
        destino: TransacaoBancariaStatus,
    ): Promise<{ antes?: TransacaoBancariaStatus; mudou: boolean }> => {
        const row = await this.databaseClient.selectFirst<{ antes?: string; depois?: string }>(
            `WITH atual AS (
                SELECT status FROM transacao_bancaria WHERE id = $id
             ), upd AS (
                UPDATE transacao_bancaria SET status = $destino, atualizado_em = now()
                 WHERE id = $id AND status = ANY($origens) AND status <> $destino
                RETURNING status
             )
             SELECT (SELECT status FROM atual) AS antes, (SELECT status FROM upd) AS depois`,
            { id, destino, origens: [...origensPermitidasPara(destino)] },
        );
        return {
            ...(row?.antes != null ? { antes: row.antes as TransacaoBancariaStatus } : {}),
            mudou: row?.depois != null,
        };
    };

    /**
     * Varredura de reconciliação: realinha o status de TODA transação cujo ledger discorda dela
     * (ADR-0034). Idempotente — reexecutar não muda nada quando já está alinhado.
     *
     * Existe porque o reparo pontual (re-POST da alocação) só age se alguém clicar, e ninguém
     * reprocessa uma alocação bem-sucedida. Sem esta varredura, um `marcarStatus` que falhou deixa a
     * carteira mentindo para sempre. É o MESMO SQL do backfill da 0046, mantido aqui para rodar ao
     * fim de cada ingestão.
     *
     * Ordem das três statements importa: `erro` é a última porque quem escreve por último é o último
     * evento do ledger — a mesma regra do caminho vivo.
     */
    public reconciliarStatusPorLedger = async (): Promise<number> => {
        const { PROCESSADA, PARCIAL, ERRO } = TRANSACAO_BANCARIA_STATUS;
        let alteradas = 0;

        await this.databaseClient.withTransaction(async (tx) => {
            // 1) Cobertura total pela Σ das alocações executadas → terminal.
            alteradas += await tx.update(
                `UPDATE transacao_bancaria t
                    SET status = $destino, atualizado_em = now()
                   FROM (${SETTLED_POR_TXN}) s
                  WHERE t.id = s.txn_id
                    AND t.status = ANY($origens)
                    AND t.valor > 0
                    AND ROUND(s.alocado * 100) >= ROUND(t.valor * 100)`,
                { destino: PROCESSADA, origens: [...origensPermitidasPara(PROCESSADA)] },
            );

            // 2) Cobertura parcial → segue na fila, agora rotulada corretamente.
            alteradas += await tx.update(
                `UPDATE transacao_bancaria t
                    SET status = $destino, atualizado_em = now()
                   FROM (${SETTLED_POR_TXN}) s
                  WHERE t.id = s.txn_id
                    AND t.status = ANY($origens)
                    AND t.valor > 0
                    AND ROUND(s.alocado * 100) > 0
                    AND ROUND(s.alocado * 100) < ROUND(t.valor * 100)`,
                { destino: PARCIAL, origens: [...origensPermitidasPara(PARCIAL)] },
            );

            // 3) Último evento do ledger não terminou bem → erro (rebaixa o `parcial` do passo 2).
            //
            // Inclui a execução INTERROMPIDA — presa em `reconciling` além da janela. Sem esta
            // cláusula ela seria invisível: o processo que morreu no meio nunca roda o `catch`, logo
            // nunca chama `registrarFalha`, logo nada escreve `erro`. O crédito ficaria `importada`
            // com documento possivelmente órfão no ERP e não apareceria na aba de falhas — que é o
            // único lugar do sistema que mostra esse estado.
            alteradas += await tx.update(
                `UPDATE transacao_bancaria t
                    SET status = $destino, atualizado_em = now()
                   FROM (
                        SELECT DISTINCT ON (txn_id) txn_id, status, atualizado_em
                          FROM solicitacao_numerario_execucao
                         WHERE txn_id IS NOT NULL AND dry_run = FALSE
                         ORDER BY txn_id, atualizado_em DESC
                   ) u
                  WHERE t.id = u.txn_id
                    AND (
                         u.status = 'error'
                         OR (u.status = 'reconciling'
                             AND u.atualizado_em < now() - make_interval(mins => $minutosParado::int))
                        )
                    AND t.status = ANY($origens)`,
                {
                    destino: ERRO,
                    origens: [...origensPermitidasPara(ERRO)],
                    minutosParado: EXECUCAO_INTERROMPIDA_MINUTOS,
                },
            );
        });

        return alteradas;
    };

    /**
     * Arquiva (ou desarquiva, com `por = null`) um crédito.
     *
     * Arquivar tira da listagem E dos KPIs — é o gesto para o RUÍDO DE TESOURARIA (resgate de
     * aplicação, transferência entre contas) que infla o "a distribuir" com dinheiro que nunca será
     * conciliado contra processo. Guarda quem e quando, não um boolean: quando um crédito arquivado
     * se revela devido, a primeira pergunta é quem o tirou da carteira.
     */
    public arquivar = async (id: string, por: string): Promise<boolean> => {
        const row = await this.databaseClient.selectFirst<{ id: string }>(
            `UPDATE transacao_bancaria
                SET arquivada_em = now(), arquivada_por = $por, atualizado_em = now()
              WHERE id = $id AND arquivada_em IS NULL
              RETURNING id`,
            { id, por },
        );
        return row != null;
    };

    public desarquivar = async (id: string): Promise<boolean> => {
        const row = await this.databaseClient.selectFirst<{ id: string }>(
            `UPDATE transacao_bancaria
                SET arquivada_em = NULL, arquivada_por = NULL, atualizado_em = now()
              WHERE id = $id AND arquivada_em IS NOT NULL
              RETURNING id`,
            { id },
        );
        return row != null;
    };

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
