import { inject, injectable } from 'tsyringe';
import { chunked } from '../../client/ConexosBaseClient.js';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type { TituloNumeroDocumento } from '../../interface/sispag/SugestaoBoleto.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const UPSERT_CHUNK = 200;

interface TituloRow {
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    credor: string | null;
    pes_cod: string | null;
    valor: string | null;
    moeda: string | null;
    vencimento: Date | null;
    aprovado: boolean;
    pago: boolean;
    banco: string | null;
    num_remessa: string | null;
    tpd_cod: string | null;
    /** `tpdDesNome` do com298/list (migration 0089). NULL = tipo nunca lido. */
    tpd_des_nome: string | null;
    /** NULL = o read da carteira não soube dizer (ver migration 0063). */
    pronto_para_remessa: boolean | null;
    tem_boleto: boolean;
    /** `titVldPagopor` cru do Conexos (migration 0081). NULL = nunca lido. */
    forma_pagamento_conexos: number | null;
    /** `docEspNumero` do fin064 (migration 0083). NULL = nunca lido. */
    doc_esp_numero: string | null;
}

/** Grupo de boleto candidato à formação automática (ADR-0077, I21j/PI-8). */
export interface GrupoParaFormacao {
    grupoId: string;
    filCod: number;
    pesCod: string;
    credor?: string;
    /** Vencimento do BOLETO (epoch ms, meia-noite UTC): define o lote e a janela. */
    vencimentoBoleto: number;
    valorBoletoCentavos: number;
    /** Os N títulos, da carteira (snapshot do item local). */
    titulos: TituloAPagar[];
}

/**
 * TituloAPagarRepository — carteira PERSISTIDA de títulos a pagar (ingestão).
 * UPSERT por chave natural (fil_cod, doc_cod, tit_cod); anti-fantasma via `ativo`.
 * SQL 100% parametrizado (`$name`). NÃO toca o ERP — só o Postgres próprio.
 */
@injectable()
export default class TituloAPagarRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    private map = (r: TituloRow): TituloAPagar => ({
        docCod: r.doc_cod,
        titCod: r.tit_cod,
        filCod: r.fil_cod,
        credor: r.credor ?? undefined,
        pesCod: r.pes_cod ?? undefined,
        valor: r.valor != null ? Number(r.valor) : 0,
        moeda: r.moeda ?? undefined,
        vencimento: r.vencimento ? r.vencimento.getTime() : undefined,
        liberado: r.aprovado,
        pago: r.pago,
        banco: r.banco ?? undefined,
        numRemessa: r.num_remessa ?? undefined,
        tpdCod: r.tpd_cod ?? undefined,
        tpdDesNome: r.tpd_des_nome ?? undefined,
        prontoParaRemessa: r.pronto_para_remessa ?? undefined,
        temBoleto: r.tem_boleto,
        formaPagamentoConexos: r.forma_pagamento_conexos ?? undefined,
        numeroDocumento: r.doc_esp_numero ?? undefined,
        ativo: true,
    });

    /** UPSERT em chunks: marca os títulos vistos como ativos, com o run atual. */
    public upsertMany = async (titulos: TituloAPagar[], runId: string): Promise<void> => {
        if (titulos.length === 0) return;
        // `temBoleto` indefinido = o flag não pôde ser lido nesta rodada: o UPSERT desses
        // títulos NÃO toca `tem_boleto` (preserva o que a última leitura boa gravou).
        const comFlag = titulos.filter((t) => t.temBoleto !== undefined);
        const semFlag = titulos.filter((t) => t.temBoleto === undefined);
        await this.databaseClient.withTransaction(async (tx) => {
            for (const chunk of chunked(comFlag, UPSERT_CHUNK)) {
                await this.upsertChunk(tx, runId, chunk, true);
            }
            for (const chunk of chunked(semFlag, UPSERT_CHUNK)) {
                await this.upsertChunk(tx, runId, chunk, false);
            }
        });
    };

    private upsertChunk = async (
        tx: TransactionClient,
        runId: string,
        chunk: TituloAPagar[],
        gravarFlagBoleto: boolean,
    ): Promise<void> => {
        const tuples: string[] = [];
        const params: Record<string, unknown> = { runId };
        chunk.forEach((t, i) => {
            tuples.push(
                `($f${i}, $d${i}, $t${i}, $cr${i}, $pe${i}, $v${i}, $mo${i}, $ve${i}, ` +
                    `$ap${i}, $pa${i}, $ba${i}, $nr${i}, $tp${i}, $tn${i}, $pr${i}, $tb${i}, $fp${i}, $dn${i}, TRUE, $runId, now())`,
            );
            params[`f${i}`] = t.filCod;
            params[`d${i}`] = t.docCod;
            params[`t${i}`] = t.titCod;
            params[`cr${i}`] = t.credor ?? null;
            params[`pe${i}`] = t.pesCod ?? null;
            params[`v${i}`] = t.valor ?? null;
            params[`mo${i}`] = t.moeda ?? null;
            params[`ve${i}`] = t.vencimento != null ? new Date(t.vencimento) : null;
            params[`ap${i}`] = t.liberado;
            params[`pa${i}`] = t.pago;
            params[`ba${i}`] = t.banco ?? null;
            params[`nr${i}`] = t.numRemessa ?? null;
            params[`tp${i}`] = t.tpdCod ?? null;
            params[`tn${i}`] = t.tpdDesNome ?? null;
            // `?? null` e não `?? false`: o `fin064` quase nunca SABE, e NULL é esse
            // "não sei". Um FALSE aqui acenderia "falta cadastro?" na carteira inteira.
            params[`pr${i}`] = t.prontoParaRemessa ?? null;
            params[`tb${i}`] = t.temBoleto ?? false;
            params[`fp${i}`] = t.formaPagamentoConexos ?? null;
            params[`dn${i}`] = t.numeroDocumento ?? null;
        });
        await tx.insert(
            `INSERT INTO titulo_a_pagar (
                fil_cod, doc_cod, tit_cod, credor, pes_cod, valor, moeda, vencimento,
                aprovado, pago, banco, num_remessa, tpd_cod, tpd_des_nome, pronto_para_remessa, tem_boleto,
                forma_pagamento_conexos, doc_esp_numero, ativo, ingestao_run_id, atualizado_em
             ) VALUES ${tuples.join(', ')}
             ON CONFLICT (fil_cod, doc_cod, tit_cod) DO UPDATE SET
                credor = EXCLUDED.credor, pes_cod = EXCLUDED.pes_cod, valor = EXCLUDED.valor,
                moeda = EXCLUDED.moeda, vencimento = EXCLUDED.vencimento, aprovado = EXCLUDED.aprovado,
                pago = EXCLUDED.pago, banco = EXCLUDED.banco, num_remessa = EXCLUDED.num_remessa,
                pronto_para_remessa = EXCLUDED.pronto_para_remessa,
                -- Tipo (com298/list): NULL = a rodada não o leu (documento fora do com298 ou
                -- leitura falhou). Preserva o último conhecido: o fin064 nunca o traz, então
                -- sobrescrever com NULL apagaria o dado a cada ingestão.
                tpd_cod = COALESCE(EXCLUDED.tpd_cod, titulo_a_pagar.tpd_cod),
                tpd_des_nome = COALESCE(EXCLUDED.tpd_des_nome, titulo_a_pagar.tpd_des_nome),
                ${gravarFlagBoleto ? 'tem_boleto = EXCLUDED.tem_boleto,' : ''}
                -- NULL = esta rodada não viu o título no grid de pendentes (ou a leitura
                -- falhou): preserva a última forma conhecida em vez de apagá-la.
                forma_pagamento_conexos = COALESCE(
                    EXCLUDED.forma_pagamento_conexos, titulo_a_pagar.forma_pagamento_conexos
                ),
                doc_esp_numero = COALESCE(EXCLUDED.doc_esp_numero, titulo_a_pagar.doc_esp_numero),
                ativo = TRUE, ingestao_run_id = EXCLUDED.ingestao_run_id, atualizado_em = now()`,
            params,
        );
    };

    /**
     * Anti-fantasma: inativa os títulos que NÃO vieram na run atual — restrito às
     * filiais LIDAS com sucesso (`filCodsLidas`). Assim, se a leitura de uma filial
     * falhou, seus títulos NÃO são inativados por engano (fault-tolerance). Retorna a contagem.
     */
    public marcarInativosForaDaRun = async (
        runId: string,
        filCodsLidas: number[],
    ): Promise<number> => {
        if (filCodsLidas.length === 0) return 0;
        return this.databaseClient.update(
            `UPDATE titulo_a_pagar SET ativo = FALSE, atualizado_em = now()
             WHERE ativo = TRUE AND ingestao_run_id IS DISTINCT FROM $runId
               AND fil_cod = ANY($filCodsLidas)`,
            { runId, filCodsLidas },
        );
    };

    /**
     * I18j(4) (ADR-0074): o título NOVO da renegociação entra na carteira já, sem esperar o cron.
     * Copia do título antigo o que o `fin064` não mudou (credor, favorecido, banco, forma, número)
     * e grava o que foi lido AO VIVO (valor base, vencimento, aprovação). `0` = o título antigo não
     * estava na carteira (nada a copiar; o cron o trará).
     */
    public upsertTituloRenegociado = async (
        input: {
            filCod: number;
            docCod: string;
            titCodAntigo: string;
            titCodNovo: string;
            valor: number;
            vencimentoEpoch: number;
            aprovado: boolean;
        },
        tx?: TransactionClient,
    ): Promise<number> =>
        (tx ?? this.databaseClient).insert(
            `INSERT INTO titulo_a_pagar (
                fil_cod, doc_cod, tit_cod, credor, pes_cod, valor, moeda, vencimento,
                aprovado, pago, banco, num_remessa, tpd_cod, tpd_des_nome, pronto_para_remessa, tem_boleto,
                forma_pagamento_conexos, doc_esp_numero, ativo, ingestao_run_id, atualizado_em
             )
             SELECT fil_cod, doc_cod, $titCodNovo, credor, pes_cod, $valor, moeda, $vencimento,
                    $aprovado, FALSE, banco, NULL, tpd_cod, tpd_des_nome, pronto_para_remessa, tem_boleto,
                    forma_pagamento_conexos, doc_esp_numero, TRUE, ingestao_run_id, now()
               FROM titulo_a_pagar
              WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCodAntigo
             ON CONFLICT (fil_cod, doc_cod, tit_cod) DO UPDATE SET
                valor = EXCLUDED.valor, vencimento = EXCLUDED.vencimento,
                aprovado = EXCLUDED.aprovado, pago = FALSE, ativo = TRUE, atualizado_em = now()`,
            {
                filCod: input.filCod,
                docCod: input.docCod,
                titCodAntigo: input.titCodAntigo,
                titCodNovo: input.titCodNovo,
                valor: input.valor,
                vencimento: new Date(input.vencimentoEpoch),
                aprovado: input.aprovado,
            },
        );

    /** I18j(4): o título consumido pela renegociação sai da carteira já (`ativo = false`). */
    public inativar = async (
        chave: { filCod: number; docCod: string; titCod: string },
        tx?: TransactionClient,
    ): Promise<number> =>
        (tx ?? this.databaseClient).update(
            `UPDATE titulo_a_pagar SET ativo = FALSE, atualizado_em = now()
              WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod`,
            chave,
        );

    /** Carteira ativa para o painel (não-pagos ficam por conta do filtro de ingestão). */
    public listAtivos = async (): Promise<TituloAPagar[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT fil_cod, doc_cod, tit_cod, credor, pes_cod, valor, moeda, vencimento,
                    aprovado, pago, banco, num_remessa, tpd_cod, tpd_des_nome, pronto_para_remessa,
                    tem_boleto, forma_pagamento_conexos, doc_esp_numero
             FROM titulo_a_pagar
             WHERE ativo = TRUE
             ORDER BY vencimento ASC NULLS LAST`,
        )) as TituloRow[];
        return rows.map(this.map);
    };

    /**
     * Títulos INATIVOS (`ativo = FALSE`: saíram do fin064) com vencimento no intervalo civil
     * `[de, ate]` (`YYYY-MM-DD`, inclusivo). Só leitura; serve ao `TITULO_SAIU_CARTEIRA` da aba
     * "Boletos DDA". O vencimento do ERP é dia civil gravado como 00:00Z/15:00Z: compara-se em UTC.
     */
    public listInativosRecentes = async (intervalo: {
        de: string;
        ate: string;
    }): Promise<TituloAPagar[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT fil_cod, doc_cod, tit_cod, credor, pes_cod, valor, moeda, vencimento,
                    aprovado, pago, banco, num_remessa, tpd_cod, tpd_des_nome, pronto_para_remessa,
                    tem_boleto, forma_pagamento_conexos, doc_esp_numero
             FROM titulo_a_pagar
             WHERE ativo = FALSE
               AND vencimento IS NOT NULL
               AND (vencimento AT TIME ZONE 'UTC')::date BETWEEN $de::date AND $ate::date
             ORDER BY vencimento ASC`,
            intervalo,
        )) as TituloRow[];
        return rows.map((r) => ({ ...this.map(r), ativo: false }));
    };

    /**
     * Número do documento de TODOS os títulos com credor e número — ativos ou não, pagos ou não
     * (SEM filtro `ativo`). Serve à guarda de duplicata da âncora de número (I15s): o mesmo número
     * em outro documento do credor, mesmo que já fora da carteira, torna o número ambíguo.
     */
    public listNumerosDocumento = async (): Promise<TituloNumeroDocumento[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT fil_cod, doc_cod, tit_cod, pes_cod, doc_esp_numero
             FROM titulo_a_pagar
             WHERE pes_cod IS NOT NULL AND doc_esp_numero IS NOT NULL AND doc_esp_numero <> ''`,
        )) as Array<{
            fil_cod: number;
            doc_cod: string;
            tit_cod: string;
            pes_cod: string;
            doc_esp_numero: string;
        }>;
        return rows.map((r) => ({
            filCod: Number(r.fil_cod),
            docCod: String(r.doc_cod),
            titCod: String(r.tit_cod),
            pesCod: String(r.pes_cod),
            numeroDocumento: String(r.doc_esp_numero),
        }));
    };

    /**
     * Um título pela chave natural (ativo ou não) — releitura pontual do passo de confirmação do
     * boleto sugerido (ADR-0068, anti-TOCTOU). `ativo = false` volta mapeado com `ativo: false`.
     * Com `tx`, lê na transação do chamador (confirmação do grupo de boleto sob lock, ADR-0077).
     */
    public buscarPorChave = async (
        chave: {
            filCod: number;
            docCod: string;
            titCod: string;
        },
        tx?: TransactionClient,
    ): Promise<TituloAPagar | null> => {
        const row = await (tx ?? this.databaseClient).selectFirst<TituloRow & { ativo: boolean }>(
            `SELECT fil_cod, doc_cod, tit_cod, credor, pes_cod, valor, moeda, vencimento,
                    aprovado, pago, banco, num_remessa, tpd_cod, tpd_des_nome, pronto_para_remessa,
                    tem_boleto, forma_pagamento_conexos, doc_esp_numero, ativo
             FROM titulo_a_pagar
             WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod`,
            chave,
        );
        return row ? { ...this.map(row), ativo: row.ativo } : null;
    };

    /**
     * Vários títulos pela chave natural (ativos ou não), numa consulta: a prontidão dos lotes
     * (ADR-0076) avalia a situação de todos os itens de uma vez. Chave ausente = fora da carteira.
     */
    public buscarPorChaves = async (
        chaves: ReadonlyArray<{ filCod: number; docCod: string; titCod: string }>,
    ): Promise<TituloAPagar[]> => {
        if (chaves.length === 0) return [];
        const rows = (await this.databaseClient.selectMany(
            `SELECT t.fil_cod, t.doc_cod, t.tit_cod, t.credor, t.pes_cod, t.valor, t.moeda,
                    t.vencimento, t.aprovado, t.pago, t.banco, t.num_remessa, t.tpd_cod,
                    t.tpd_des_nome, t.pronto_para_remessa, t.tem_boleto,
                    t.forma_pagamento_conexos, t.doc_esp_numero, t.ativo
               FROM titulo_a_pagar t
               JOIN unnest($filCods::int[], $docCods::text[], $titCods::text[])
                    AS k(fil_cod, doc_cod, tit_cod)
                 ON k.fil_cod = t.fil_cod AND k.doc_cod = t.doc_cod AND k.tit_cod = t.tit_cod`,
            {
                filCods: chaves.map((c) => c.filCod),
                docCods: chaves.map((c) => c.docCod),
                titCods: chaves.map((c) => c.titCod),
            },
        )) as Array<TituloRow & { ativo: boolean }>;
        return rows.map((r) => ({ ...this.map(r), ativo: r.ativo }));
    };

    /**
     * Chaves `filCod:docCod:titCod` dos títulos ATIVOS que têm boleto DDA associado.
     *
     * Serve o painel sem ir ao ERP: a ingestão já resolveu isso na última rodada (≤ 24 h) e
     * gravou em `tem_boleto`. Refazer a leitura ao vivo custava +7 requisições Conexos por
     * abertura de lote na filial 2 (5 páginas do grid de pendentes + lotes + contas) para
     * chegar à mesma resposta.
     *
     * O dado servido aqui é do último ingest, e isso é seguro por construção: a decisão que
     * move dinheiro é validada AO VIVO no envio (`RemessaService.montarItensImport` →
     * `BoletoSemCodigoBarrasError`). Um `tem_boleto` stale só pode desatualizar um dropdown,
     * nunca deixar sair remessa com barras vazia.
     */
    public listChavesComBoleto = async (filCod: number): Promise<Set<string>> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT fil_cod, doc_cod, tit_cod
             FROM titulo_a_pagar
             WHERE ativo = TRUE AND tem_boleto = TRUE AND fil_cod = $filCod`,
            { filCod },
        )) as Array<{ fil_cod: number; doc_cod: string; tit_cod: string }>;
        return new Set(rows.map((r) => `${r.fil_cod}:${r.doc_cod}:${r.tit_cod}`));
    };

    /**
     * O título tem boleto DDA associado? Consulta pontual, para a inclusão manual no lote.
     *
     * A inclusão relê o título AO VIVO no `fin064` para decidir elegibilidade (I2 — pago /
     * liberado), mas o `fin064` **não sabe de boleto**: `temBoleto` vem sempre `false` de lá,
     * por construção. Quem sabe é a carteira persistida, que a ingestão preencheu a partir do
     * flag de DDA. Sem esta consulta, a modalidade BOLETO nunca era pré-selecionada e a analista
     * tinha de escolher à mão item por item — mesmo o boleto sendo o único destino possível.
     */
    public temBoletoPersistido = async (chave: {
        filCod: number;
        docCod: string;
        titCod: string;
    }): Promise<boolean> => {
        const row = await this.databaseClient.selectFirst<{ tem_boleto?: boolean }>(
            `SELECT tem_boleto FROM titulo_a_pagar
             WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod`,
            chave,
        );
        return row?.tem_boleto === true;
    };

    /**
     * Elegíveis para FORMAÇÃO AUTOMÁTICA de lote: ativos, aprovados, não-pagos, A VENCER
     * dentro de `maxDias` (vencidos NÃO entram), e que ainda NÃO estão em nenhum lote VIVO
     * (anti-join — não duplica o que já está em montagem, finalizado, com remessa gerada ou
     * com rejeição à espera de tratamento humano; `CANCELADO` libera o título e `BAIXADO` já
     * sai por `pago = FALSE`).
     *
     * ADR-0063 I13g: título com `BloqueioDuplicidade` ATIVO (retirado por duplicidade, cancelamento
     * pendente no Conexos) também fica de fora — voltar a um lote é o risco que a marca existe para
     * impedir.
     *
     * Janela por DIA CIVIL: `hoje` (dia de Brasília codificado como o ERP, 00:00Z) até
     * `hoje + maxDias`, inclusive. Nunca `now()`: o título que vence hoje (00:00Z) ficava de fora.
     */
    public listElegiveisParaFormacao = async (
        maxDias: number,
        hoje: Date,
    ): Promise<TituloAPagar[]> => {
        const ate = new Date(hoje.getTime() + (maxDias + 1) * DAY_MS);
        const rows = (await this.databaseClient.selectMany(
            `SELECT t.fil_cod, t.doc_cod, t.tit_cod, t.credor, t.pes_cod, t.valor, t.moeda,
                    t.vencimento, t.aprovado, t.pago, t.banco, t.num_remessa, t.tpd_cod, t.tpd_des_nome,
                    t.pronto_para_remessa, t.tem_boleto, t.forma_pagamento_conexos
             FROM titulo_a_pagar t
             WHERE t.ativo = TRUE AND t.aprovado = TRUE AND t.pago = FALSE
               AND t.vencimento IS NOT NULL
               AND t.vencimento >= $hoje
               AND t.vencimento < $ate
               AND NOT EXISTS (
                 SELECT 1 FROM lote_pagamento_item i
                 JOIN lote_pagamento l ON l.id = i.lote_id
                 WHERE l.status IN ('RASCUNHO', 'FINALIZADO', 'REMESSA_GERADA', 'RETORNADO')
                   AND i.fil_cod = t.fil_cod AND i.doc_cod = t.doc_cod AND i.tit_cod = t.tit_cod)
               AND NOT EXISTS (
                 SELECT 1 FROM titulo_bloqueio_duplicidade b
                 WHERE b.estado = 'ATIVO'
                   AND b.fil_cod = t.fil_cod AND b.doc_cod = t.doc_cod AND b.tit_cod = t.tit_cod)
               AND NOT EXISTS (
                 SELECT 1 FROM sispag_grupo_boleto_titulo gt
                 WHERE gt.estado = 'CONFIRMADO'
                   AND gt.fil_cod = t.fil_cod AND gt.doc_cod = t.doc_cod AND gt.tit_cod = t.tit_cod)
             ORDER BY t.fil_cod, t.banco, t.vencimento ASC`,
            { hoje, ate },
        )) as TituloRow[];
        return rows.map(this.map);
    };

    /**
     * Grupos de boleto `CONFIRMADO` candidatos à formação automática (ADR-0077, I21j/PI-8): o
     * grupo é UMA unidade, medida pelo vencimento do BOLETO na mesma janela por dia civil dos
     * títulos avulsos. Fica de fora o grupo com algum título em lote vivo, com marca de retenção
     * ATIVA (inclusive `GRUPO_BOLETO`) ou fora da carteira ativa/aprovada/não paga (órfão, I21u).
     * Rejeição não resolvida (I21r) é situação derivada: quem decide é o serviço (Task 12).
     */
    public listGruposParaFormacao = async (
        maxDias: number,
        hoje: Date,
    ): Promise<GrupoParaFormacao[]> => {
        const ate = new Date(hoje.getTime() + (maxDias + 1) * DAY_MS);
        const grupos = (await this.databaseClient.selectMany(
            `SELECT g.id, g.fil_cod, g.pes_cod, g.credor, g.valor_boleto_centavos,
                    (g.vencimento_boleto::timestamp AT TIME ZONE 'UTC') AS vencimento_boleto
             FROM sispag_grupo_boleto g
             WHERE g.estado = 'CONFIRMADO'
               AND (g.vencimento_boleto::timestamp AT TIME ZONE 'UTC') >= $hoje
               AND (g.vencimento_boleto::timestamp AT TIME ZONE 'UTC') < $ate
               AND NOT EXISTS (
                 SELECT 1 FROM sispag_grupo_boleto_titulo gt
                 JOIN lote_pagamento_item i
                   ON i.fil_cod = gt.fil_cod AND i.doc_cod = gt.doc_cod AND i.tit_cod = gt.tit_cod
                 JOIN lote_pagamento l ON l.id = i.lote_id
                 WHERE gt.grupo_id = g.id
                   AND l.status IN ('RASCUNHO', 'FINALIZADO', 'REMESSA_GERADA', 'RETORNADO'))
               AND NOT EXISTS (
                 SELECT 1 FROM sispag_grupo_boleto_titulo gt
                 JOIN titulo_bloqueio_duplicidade b
                   ON b.fil_cod = gt.fil_cod AND b.doc_cod = gt.doc_cod AND b.tit_cod = gt.tit_cod
                 WHERE gt.grupo_id = g.id AND b.estado = 'ATIVO')
               AND NOT EXISTS (
                 SELECT 1 FROM sispag_grupo_boleto_titulo gt
                 WHERE gt.grupo_id = g.id
                   AND NOT EXISTS (
                     SELECT 1 FROM titulo_a_pagar t
                     WHERE t.fil_cod = gt.fil_cod AND t.doc_cod = gt.doc_cod
                       AND t.tit_cod = gt.tit_cod
                       AND t.ativo = TRUE AND t.aprovado = TRUE AND t.pago = FALSE))
             ORDER BY g.fil_cod, g.vencimento_boleto, g.id`,
            { hoje, ate },
        )) as Array<{
            id: string;
            fil_cod: number;
            pes_cod: string;
            credor: string | null;
            valor_boleto_centavos: string | number;
            vencimento_boleto: Date;
        }>;
        if (grupos.length === 0) return [];
        const params: Record<string, unknown> = {};
        const ids = grupos.map((g, i) => {
            params[`g${i}`] = g.id;
            return `$g${i}::uuid`;
        });
        const titulos = (await this.databaseClient.selectMany(
            `SELECT gt.grupo_id, t.fil_cod, t.doc_cod, t.tit_cod, t.credor, t.pes_cod, t.valor,
                    t.moeda, t.vencimento, t.aprovado, t.pago, t.banco, t.num_remessa, t.tpd_cod,
                    t.pronto_para_remessa, t.tem_boleto, t.forma_pagamento_conexos,
                    t.doc_esp_numero
             FROM sispag_grupo_boleto_titulo gt
             JOIN titulo_a_pagar t
               ON t.fil_cod = gt.fil_cod AND t.doc_cod = gt.doc_cod AND t.tit_cod = gt.tit_cod
             WHERE gt.grupo_id IN (${ids.join(', ')})
             ORDER BY t.vencimento, t.doc_cod, t.tit_cod`,
            params,
        )) as Array<TituloRow & { grupo_id: string }>;
        const porGrupo = new Map<string, TituloAPagar[]>();
        for (const t of titulos) {
            const lista = porGrupo.get(t.grupo_id) ?? [];
            lista.push(this.map(t));
            porGrupo.set(t.grupo_id, lista);
        }
        return grupos.map((g) => ({
            grupoId: g.id,
            filCod: Number(g.fil_cod),
            pesCod: g.pes_cod,
            ...(g.credor != null ? { credor: g.credor } : {}),
            vencimentoBoleto: new Date(g.vencimento_boleto).getTime(),
            valorBoletoCentavos: Number(g.valor_boleto_centavos),
            titulos: porGrupo.get(g.id) ?? [],
        }));
    };
}
