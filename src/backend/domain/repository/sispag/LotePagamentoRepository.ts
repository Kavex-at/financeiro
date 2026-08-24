import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import {
    type ItemLote,
    type LotePagamento,
    type LotePagamentoStatus,
    LOTE_STATUS,
    type ListarLotesFiltro,
    type Modalidade,
} from '../../interface/sispag/SispagInterface.js';

/** Superfície de query comum ao pool e ao cliente transacional (mesmos 4 métodos). */
type QueryRunner = Pick<PostgreeDatabaseClient, 'selectMany' | 'selectFirst' | 'insert' | 'update'>;

interface LoteHeaderRow {
    id: string;
    fil_cod: number;
    banco: string | null;
    conta: string | null;
    status: LotePagamentoStatus;
    criado_por: string;
    finalizado_por: string | null;
    finalizado_em: Date | null;
    versao: number;
    criado_em: Date;
    automatico: boolean;
    native_fil_cod: number | null;
    native_bnc_cod: number | null;
    native_flp_cod: number | null;
    native_gab_cod: number | null;
    remessa_arquivo: string | null;
    remessa_num: number | null;
    remessa_gerada_em: Date | null;
    cco_cod: number | null;
    ger_num: number | null;
}

interface ItemRow {
    lote_id: string;
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    credor: string | null;
    valor: string | null;
    vencimento: Date | null;
    modalidade: string | null;
    incluido_por: string;
    incluido_em: Date | null;
    // ── 0049: chave nativa + resultado da conciliação do retorno ──
    native_its_cod_seq: number | null;
    retorno_evento: string | null;
    retorno_descricao: string | null;
    rejeitado: boolean | null;
    bor_cod: number | null;
    bxa_cod_seq: number | null;
    conciliado_em: Date | null;
}

/**
 * LotePagamentoRepository — persistência do lote candidato SISPAG (Fatia 2).
 * SQL 100% parametrizado (`$name`, Rule #5). Cada método aceita um `tx` opcional
 * (`TransactionClient`) para o serviço compor operações atômicas (`withTransaction`);
 * sem `tx`, roda no pool. NENHUMA escrita no ERP — só o Postgres próprio.
 */
@injectable()
export default class LotePagamentoRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    private db = (tx?: TransactionClient): QueryRunner => tx ?? this.databaseClient;

    private mapItem = (r: ItemRow): ItemLote => ({
        loteId: r.lote_id,
        filCod: r.fil_cod,
        docCod: r.doc_cod,
        titCod: r.tit_cod,
        credor: r.credor ?? undefined,
        valor: r.valor != null ? Number(r.valor) : undefined,
        vencimento: r.vencimento ? r.vencimento.getTime() : undefined,
        modalidade: (r.modalidade as Modalidade | null) ?? undefined,
        incluidoPor: r.incluido_por,
        incluidoEm: r.incluido_em ? r.incluido_em.toISOString() : undefined,
        ...(r.native_its_cod_seq != null ? { nativeItsCodSeq: Number(r.native_its_cod_seq) } : {}),
        ...(r.retorno_evento != null ? { retornoEvento: String(r.retorno_evento) } : {}),
        ...(r.retorno_descricao != null ? { retornoDescricao: String(r.retorno_descricao) } : {}),
        ...(r.rejeitado != null ? { rejeitado: Boolean(r.rejeitado) } : {}),
        ...(r.bor_cod != null ? { borCod: Number(r.bor_cod) } : {}),
        ...(r.bxa_cod_seq != null ? { bxaCodSeq: Number(r.bxa_cod_seq) } : {}),
        ...(r.conciliado_em != null ? { conciliadoEm: String(r.conciliado_em) } : {}),
    });

    private mapLote = (h: LoteHeaderRow, itens: ItemLote[]): LotePagamento => ({
        id: h.id,
        filCod: h.fil_cod,
        banco: h.banco ?? undefined,
        conta: h.conta ?? undefined,
        status: h.status,
        criadoPor: h.criado_por,
        finalizadoPor: h.finalizado_por ?? undefined,
        finalizadoEm: h.finalizado_em ? h.finalizado_em.toISOString() : undefined,
        versao: h.versao,
        criadoEm: h.criado_em ? h.criado_em.toISOString() : undefined,
        automatico: h.automatico,
        itens,
        ...(h.native_fil_cod != null ? { nativeFilCod: Number(h.native_fil_cod) } : {}),
        ...(h.native_bnc_cod != null ? { nativeBncCod: Number(h.native_bnc_cod) } : {}),
        ...(h.native_flp_cod != null ? { nativeFlpCod: Number(h.native_flp_cod) } : {}),
        ...(h.native_gab_cod != null ? { nativeGabCod: Number(h.native_gab_cod) } : {}),
        ...(h.remessa_arquivo != null ? { remessaArquivo: String(h.remessa_arquivo) } : {}),
        ...(h.remessa_num != null ? { remessaNum: Number(h.remessa_num) } : {}),
        ...(h.remessa_gerada_em != null ? { remessaGeradaEm: String(h.remessa_gerada_em) } : {}),
        ...(h.cco_cod != null ? { ccoCod: Number(h.cco_cod) } : {}),
        ...(h.ger_num != null ? { gerNum: Number(h.ger_num) } : {}),
    });

    public criarLote = async (
        input: {
            filCod: number;
            banco?: string;
            conta?: string;
            criadoPor: string;
            automatico?: boolean;
        },
        tx?: TransactionClient,
    ): Promise<LotePagamento> => {
        const id = randomUUID();
        await this.db(tx).insert(
            `INSERT INTO lote_pagamento (id, fil_cod, banco, conta, status, criado_por, automatico)
             VALUES ($id, $filCod, $banco, $conta, 'RASCUNHO', $criadoPor, $automatico)`,
            {
                id,
                filCod: input.filCod,
                banco: input.banco ?? null,
                conta: input.conta ?? null,
                criadoPor: input.criadoPor,
                automatico: input.automatico ?? false,
            },
        );
        const lote = await this.getLoteComItens(id, tx);
        if (!lote) throw new Error('lote_pagamento insert did not persist');
        return lote;
    };

    /**
     * Marca o lote como MANUAL (`automatico=FALSE`) — quando o analista mexe num lote
     * automático (add/remove título), ele "adota" o lote e o cron para de gerenciá-lo
     * (não desfaz nem re-forma). No-op se já for manual.
     */
    public marcarManual = async (loteId: string, tx?: TransactionClient): Promise<void> => {
        await this.db(tx).update(
            `UPDATE lote_pagamento SET automatico = FALSE, atualizado_em = now() WHERE id = $loteId`,
            { loteId },
        );
    };

    /** Chaves (fil,doc,tit) de todos os títulos já num lote RASCUNHO — para o painel bloquear a seleção (I3). */
    public listTitulosEmRascunho = async (
        tx?: TransactionClient,
    ): Promise<Array<{ filCod: number; docCod: string; titCod: string }>> => {
        const rows = (await this.db(tx).selectMany(
            `SELECT i.fil_cod, i.doc_cod, i.tit_cod
             FROM lote_pagamento_item i JOIN lote_pagamento l ON l.id = i.lote_id
             WHERE l.status = 'RASCUNHO'`,
        )) as Array<{ fil_cod: number; doc_cod: string; tit_cod: string }>;
        return rows.map((r) => ({ filCod: r.fil_cod, docCod: r.doc_cod, titCod: r.tit_cod }));
    };

    /**
     * Desfaz (DELETE) os lotes AUTOMÁTICOS em RASCUNHO que já contêm algum título VENCIDO —
     * só títulos a vencer são elegíveis. Os itens caem por CASCATA (títulos voltam a ficar
     * livres). NÃO toca em lotes manuais nem finalizados. Retorna quantos lotes foram desfeitos.
     */
    public desfazerAutomaticosVencidos = async (tx?: TransactionClient): Promise<number> =>
        this.db(tx).update(
            `DELETE FROM lote_pagamento l
             WHERE l.automatico = TRUE AND l.status = 'RASCUNHO'
               AND EXISTS (
                 SELECT 1 FROM lote_pagamento_item i
                 WHERE i.lote_id = l.id AND i.vencimento IS NOT NULL AND i.vencimento < now())`,
        );

    public getLoteComItens = async (
        id: string,
        tx?: TransactionClient,
    ): Promise<LotePagamento | null> => {
        const header = await this.db(tx).selectFirst<LoteHeaderRow>(
            `SELECT id, fil_cod, banco, conta, status, criado_por, finalizado_por,
                    finalizado_em, versao, criado_em, automatico,
                    native_fil_cod, native_bnc_cod, native_flp_cod, native_gab_cod,
                    remessa_arquivo, remessa_num, remessa_gerada_em, cco_cod, ger_num
             FROM lote_pagamento WHERE id = $id`,
            { id },
        );
        if (!header) return null;
        const itens = await this.db(tx).selectMany(
            `SELECT lote_id, fil_cod, doc_cod, tit_cod, credor, valor, vencimento,
                    modalidade, incluido_por, incluido_em, native_its_cod_seq,
                    retorno_evento, retorno_descricao, rejeitado, bor_cod, bxa_cod_seq, conciliado_em
             FROM lote_pagamento_item WHERE lote_id = $id ORDER BY incluido_em ASC, id ASC`,
            { id },
        );
        return this.mapLote(header, (itens as ItemRow[]).map(this.mapItem));
    };

    public listLotes = async (filtro: ListarLotesFiltro): Promise<LotePagamento[]> => {
        const headers = (await this.databaseClient.selectMany(
            `SELECT id, fil_cod, banco, conta, status, criado_por, finalizado_por,
                    finalizado_em, versao, criado_em, automatico
             FROM lote_pagamento
             WHERE ($status::text IS NULL OR status = $status)
               AND ($filCod::int IS NULL OR fil_cod = $filCod)
             ORDER BY criado_em DESC`,
            { status: filtro.status ?? null, filCod: filtro.filCod ?? null },
        )) as LoteHeaderRow[];
        if (headers.length === 0) return [];
        const ids = headers.map((h) => h.id);
        const itens = (await this.databaseClient.selectMany(
            `SELECT lote_id, fil_cod, doc_cod, tit_cod, credor, valor, vencimento,
                    modalidade, incluido_por, incluido_em
             FROM lote_pagamento_item WHERE lote_id = ANY($ids) ORDER BY incluido_em ASC, id ASC`,
            { ids },
        )) as ItemRow[];
        const porLote = new Map<string, ItemLote[]>();
        for (const row of itens) {
            const arr = porLote.get(row.lote_id) ?? [];
            arr.push(this.mapItem(row));
            porLote.set(row.lote_id, arr);
        }
        return headers.map((h) => this.mapLote(h, porLote.get(h.id) ?? []));
    };

    /** Título já presente em ALGUM lote RASCUNHO? (I3). Retorna o loteId ou null. */
    public loteRascunhoComTitulo = async (
        params: { filCod: number; docCod: string; titCod: string },
        tx?: TransactionClient,
    ): Promise<string | null> => {
        const row = await this.db(tx).selectFirst<{ lote_id: string }>(
            `SELECT i.lote_id
             FROM lote_pagamento_item i
             JOIN lote_pagamento l ON l.id = i.lote_id
             WHERE l.status = 'RASCUNHO'
               AND i.fil_cod = $filCod AND i.doc_cod = $docCod AND i.tit_cod = $titCod
             LIMIT 1`,
            params,
        );
        return row?.lote_id ?? null;
    };

    public adicionarItem = async (
        item: {
            loteId: string;
            filCod: number;
            docCod: string;
            titCod: string;
            credor?: string;
            valor?: number;
            vencimento?: number;
            modalidade?: Modalidade;
            incluidoPor: string;
        },
        tx?: TransactionClient,
    ): Promise<void> => {
        await this.db(tx).insert(
            `INSERT INTO lote_pagamento_item
                (lote_id, fil_cod, doc_cod, tit_cod, credor, valor, vencimento, modalidade, incluido_por)
             VALUES ($loteId, $filCod, $docCod, $titCod, $credor, $valor, $vencimento, $modalidade, $incluidoPor)
             ON CONFLICT (lote_id, fil_cod, doc_cod, tit_cod) DO NOTHING`,
            {
                loteId: item.loteId,
                filCod: item.filCod,
                docCod: item.docCod,
                titCod: item.titCod,
                credor: item.credor ?? null,
                valor: item.valor ?? null,
                vencimento: item.vencimento != null ? new Date(item.vencimento) : null,
                modalidade: item.modalidade ?? null,
                incluidoPor: item.incluidoPor,
            },
        );
    };

    /** Insere VÁRIOS itens num único INSERT multi-linha (formação automática — rápido). */
    public adicionarItens = async (
        loteId: string,
        itens: Array<{
            filCod: number;
            docCod: string;
            titCod: string;
            credor?: string;
            valor?: number;
            vencimento?: number;
            modalidade?: Modalidade;
            incluidoPor: string;
        }>,
        tx?: TransactionClient,
    ): Promise<void> => {
        if (itens.length === 0) return;
        const tuples: string[] = [];
        const params: Record<string, unknown> = { loteId };
        itens.forEach((it, i) => {
            tuples.push(
                `($loteId, $f${i}, $d${i}, $t${i}, $cr${i}, $v${i}, $ve${i}, $md${i}, $ip${i})`,
            );
            params[`f${i}`] = it.filCod;
            params[`d${i}`] = it.docCod;
            params[`t${i}`] = it.titCod;
            params[`cr${i}`] = it.credor ?? null;
            params[`v${i}`] = it.valor ?? null;
            params[`ve${i}`] = it.vencimento != null ? new Date(it.vencimento) : null;
            params[`md${i}`] = it.modalidade ?? null;
            params[`ip${i}`] = it.incluidoPor;
        });
        await this.db(tx).insert(
            `INSERT INTO lote_pagamento_item
                (lote_id, fil_cod, doc_cod, tit_cod, credor, valor, vencimento, modalidade, incluido_por)
             VALUES ${tuples.join(', ')}
             ON CONFLICT (lote_id, fil_cod, doc_cod, tit_cod) DO NOTHING`,
            params,
        );
    };

    public removerItem = async (
        params: { loteId: string; filCod: number; docCod: string; titCod: string },
        tx?: TransactionClient,
    ): Promise<number> =>
        this.db(tx).update(
            `DELETE FROM lote_pagamento_item
             WHERE lote_id = $loteId AND fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod`,
            params,
        );

    public contarItens = async (loteId: string, tx?: TransactionClient): Promise<number> => {
        const row = await this.db(tx).selectFirst<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM lote_pagamento_item WHERE lote_id = $loteId`,
            { loteId },
        );
        return row ? Number(row.n) : 0;
    };

    /** A2 — conta itens SEM modalidade ("a definir"); >0 bloqueia a finalização. */
    public contarItensSemModalidade = async (
        loteId: string,
        tx?: TransactionClient,
    ): Promise<number> => {
        const row = await this.db(tx).selectFirst<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM lote_pagamento_item
             WHERE lote_id = $loteId AND modalidade IS NULL`,
            { loteId },
        );
        return row ? Number(row.n) : 0;
    };

    /**
     * A2 — troca a modalidade de UM item, só em lote RASCUNHO e com optimistic lock (I6):
     * a `versaoEsperada` casa a versão do lote pai. Retorna rowCount (0 = conflito de
     * versão / estado ≠ RASCUNHO / item inexistente; o serviço distingue relendo).
     */
    public atualizarModalidadeItem = async (
        params: {
            loteId: string;
            filCod: number;
            docCod: string;
            titCod: string;
            modalidade: Modalidade;
            versaoEsperada: number;
        },
        tx?: TransactionClient,
    ): Promise<number> => {
        return this.db(tx).update(
            `UPDATE lote_pagamento_item i
             SET modalidade = $modalidade
             FROM lote_pagamento l
             WHERE i.lote_id = l.id
               AND l.id = $loteId AND l.status = 'RASCUNHO' AND l.versao = $versaoEsperada
               AND i.fil_cod = $filCod AND i.doc_cod = $docCod AND i.tit_cod = $titCod`,
            {
                loteId: params.loteId,
                filCod: params.filCod,
                docCod: params.docCod,
                titCod: params.titCod,
                modalidade: params.modalidade,
                versaoEsperada: params.versaoEsperada,
            },
        );
    };

    /** Marca o lote como "tocado" (bump de versão) — usado em incluir/remover item. */
    public tocarLote = async (loteId: string, tx?: TransactionClient): Promise<void> => {
        await this.db(tx).update(
            `UPDATE lote_pagamento SET versao = versao + 1, atualizado_em = now() WHERE id = $loteId`,
            { loteId },
        );
    };

    /**
     * A3 — troca a conta pagadora do lote (banco/conta) só em RASCUNHO, com optimistic
     * lock (I6). Retorna rowCount (0 = conflito de versão OU estado ≠ RASCUNHO; o serviço
     * distingue relendo).
     */
    public atualizarContaPagadora = async (
        params: { id: string; banco: string; conta: string; versaoEsperada: number },
        tx?: TransactionClient,
    ): Promise<number> => {
        return this.db(tx).update(
            `UPDATE lote_pagamento
             SET banco = $banco, conta = $conta, versao = versao + 1, atualizado_em = now()
             WHERE id = $id AND versao = $versaoEsperada AND status = 'RASCUNHO'`,
            {
                id: params.id,
                banco: params.banco,
                conta: params.conta,
                versaoEsperada: params.versaoEsperada,
            },
        );
    };

    /**
     * Transição de status com optimistic lock (I6): só aplica se `status` estiver
     * em `de` E `versao = versaoEsperada`. Retorna rowCount (0 = conflito de versão
     * OU estado incompatível — o serviço distingue relendo). `finalizadoPor` só no
     * caminho para FINALIZADO.
     */
    public transicionarStatus = async (
        params: {
            id: string;
            de: LotePagamentoStatus[];
            para: LotePagamentoStatus;
            versaoEsperada: number;
            finalizadoPor?: string;
        },
        tx?: TransactionClient,
    ): Promise<number> => {
        const setFinal = params.para === LOTE_STATUS.FINALIZADO;
        return this.db(tx).update(
            `UPDATE lote_pagamento
             SET status = $para,
                 versao = versao + 1,
                 atualizado_em = now(),
                 finalizado_por = ${setFinal ? '$finalizadoPor' : "CASE WHEN $para = 'RASCUNHO' THEN NULL ELSE finalizado_por END"},
                 finalizado_em  = ${setFinal ? 'now()' : "CASE WHEN $para = 'RASCUNHO' THEN NULL ELSE finalizado_em END"}
             WHERE id = $id AND versao = $versaoEsperada AND status = ANY($de)`,
            {
                id: params.id,
                para: params.para,
                de: params.de,
                versaoEsperada: params.versaoEsperada,
                ...(setFinal ? { finalizadoPor: params.finalizadoPor ?? null } : {}),
            },
        );
    };
    /**
     * Grava as chaves do lote NATIVO do Conexos assim que o ERP as devolve. Chamado ANTES do
     * import — se a sequência morrer no meio, é por aqui que se acha o lote órfão no fin015.
     *
     * ⚠️ A chave é COMPOSTA (fil, bnc, flp). O ERP recicla `flpCod` de lotes que deixaram de
     * existir, então o número sozinho não identifica nada de forma estável.
     */
    public setChavesNativas = async (input: {
        loteId: string;
        nativeFilCod: number;
        nativeBncCod: number;
        nativeFlpCod: number;
        ccoCod?: number;
        gerNum?: number;
    }): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE lote_pagamento
             SET native_fil_cod = $nativeFilCod, native_bnc_cod = $nativeBncCod,
                 native_flp_cod = $nativeFlpCod,
                 cco_cod = COALESCE($ccoCod, cco_cod), ger_num = COALESCE($gerNum, ger_num),
                 atualizado_em = now()
             WHERE id = $loteId`,
            {
                loteId: input.loteId,
                nativeFilCod: input.nativeFilCod,
                nativeBncCod: input.nativeBncCod,
                nativeFlpCod: input.nativeFlpCod,
                ccoCod: input.ccoCod ?? null,
                gerNum: input.gerNum ?? null,
            },
        );
    };

    /** Sequencial nativo de um item (4ª parte da chave que viaja no "uso da empresa" do .REM). */
    public setItsCodSeq = async (input: {
        loteId: string;
        filCod: number;
        docCod: string;
        titCod: string;
        itsCodSeq: number;
    }): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE lote_pagamento_item
             SET native_its_cod_seq = $itsCodSeq
             WHERE lote_id = $loteId AND fil_cod = $filCod
               AND doc_cod = $docCod AND tit_cod = $titCod`,
            input,
        );
    };

    /** Registra o arquivo de remessa gerado no lote. */
    public setRemessaGerada = async (input: {
        loteId: string;
        gabCod: number;
        arquivo: string;
        numRemessa: number;
    }): Promise<void> => {
        await this.databaseClient.update(
            `UPDATE lote_pagamento
             SET native_gab_cod = $gabCod, remessa_arquivo = $arquivo, remessa_num = $numRemessa,
                 remessa_gerada_em = now(), atualizado_em = now()
             WHERE id = $loteId`,
            input,
        );
    };

    /** Acha o lote LOCAL a partir da chave nativa lida do `.RET` (conciliação do retorno). */
    public findByChaveNativa = async (input: {
        nativeFilCod: number;
        nativeBncCod: number;
        nativeFlpCod: number;
    }): Promise<string | null> => {
        const row = await this.databaseClient.selectFirst<{ id: string }>(
            `SELECT id FROM lote_pagamento
             WHERE native_fil_cod = $nativeFilCod AND native_bnc_cod = $nativeBncCod
               AND native_flp_cod = $nativeFlpCod
             ORDER BY criado_em DESC LIMIT 1`,
            input,
        );
        return row?.id ?? null;
    };

    /** Resultado da conciliação de um item, vindo do detalhe do retorno (fin052). */
    public registrarConciliacaoItem = async (input: {
        loteId: string;
        filCod: number;
        docCod: string;
        titCod: string;
        evento: string;
        descricao?: string;
        rejeitado: boolean;
        borCod?: number;
        bxaCodSeq?: number;
    }, tx?: TransactionClient): Promise<void> => {
        await this.db(tx).update(
            `UPDATE lote_pagamento_item
             SET retorno_evento = $evento, retorno_descricao = $descricao, rejeitado = $rejeitado,
                 bor_cod = COALESCE($borCod, bor_cod), bxa_cod_seq = COALESCE($bxaCodSeq, bxa_cod_seq),
                 conciliado_em = now()
             WHERE lote_id = $loteId AND fil_cod = $filCod
               AND doc_cod = $docCod AND tit_cod = $titCod`,
            {
                ...input,
                descricao: input.descricao ?? null,
                borCod: input.borCod ?? null,
                bxaCodSeq: input.bxaCodSeq ?? null,
            },
        );
    };

}
