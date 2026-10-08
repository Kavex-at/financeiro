import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import type { EstadoSincronizacaoItem } from '../../interface/sispag/SincronizacaoLote.js';
import {
    type BaixaFonte,
    type ItemLote,
    type ItemSituacao,
    type LoteComprometidoRef,
    type LotePagamento,
    type LotePagamentoStatus,
    LOTE_STATUS,
    LOTE_STATUS_COMPROMETIDO,
    type ListarLotesFiltro,
    type Modalidade,
    type OrigemBaixa,
    type PaymentCheckState,
    SISPAG_SYSTEM_ACTOR,
    type SystemRemovalReason,
    VERIFICATION_EVENT,
} from '../../interface/sispag/SispagInterface.js';
import type { PayeeItemWarning } from '../../interface/sispag/AuthorizedPayeeInterface.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/** Superfície de query comum ao pool e ao cliente transacional (mesmos 4 métodos). */
type QueryRunner = Pick<PostgreeDatabaseClient, 'selectMany' | 'selectFirst' | 'insert' | 'update'>;

/**
 * Projeção ÚNICA do cabeçalho do lote — `getLoteComItens`, `listLotes` e `listLotesPorIds` leem a
 * mesma lista. Constante sem entrada do usuário (interpolá-la não abre injeção). Divergir aqui foi
 * o que escondeu o botão "Baixar remessa" da aba Finalizados.
 */
const LOTE_HEADER_COLUMNS = `id, fil_cod, banco, conta, status, criado_por, finalizado_por,
                    finalizado_em, versao, criado_em, automatico,
                    native_fil_cod, native_bnc_cod, native_flp_cod, native_gab_cod,
                    remessa_arquivo, remessa_num, remessa_gerada_em, cco_cod, ger_num,
                    to_char(data_debito, 'YYYY-MM-DD') AS data_debito`;

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
    /** `to_char(data_debito, 'YYYY-MM-DD')` — nunca o DATE cru (o node-pg o leria em hora local). */
    data_debito?: string | null;
    // ── 0078: conferência por 2ª pessoa (ADR-0063) ──
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
    // ── 0069: sincronização pelo título (ADR-0055) ──
    situacao?: string | null;
    pago_em?: Date | null;
    pago_observado_em?: Date | null;
    valor_pago?: string | null;
    origem_baixa?: string | null;
    baixa_fonte?: string | null;
    divergencia?: boolean | null;
    divergencia_detalhe?: string | null;
    sincronizado_em?: Date | null;
    // ── 0080: autorização do favorecido usada quando o destino congelou (ADR-0065, I10f) ──
    favorecido_autorizado_id?: string | null;
    // ── 0076/0080: verificação TED/PIX (ADR-0063, ADR-0065) ──
    verificacao_estado?: string | null;
    verificado_em?: Date | null;
    destino_mascarado?: string | null;
    autorizacao_aviso?: string | null;
}

export const RESULTADO_APLICAR_SINCRONIZACAO = {
    APLICADO: 'APLICADO',
    /** `versao` ou `status` mudaram desde a leitura: nada gravado (I6). */
    CONFLITO: 'CONFLITO',
} as const;

export type ResultadoAplicarSincronizacao =
    (typeof RESULTADO_APLICAR_SINCRONIZACAO)[keyof typeof RESULTADO_APLICAR_SINCRONIZACAO];

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
        @inject(VerificacaoEventoRepository)
        private eventos: VerificacaoEventoRepository,
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
        ...this.mapSincronizacao(r),
        ...(r.favorecido_autorizado_id != null
            ? { favorecidoAutorizadoId: r.favorecido_autorizado_id }
            : {}),
        ...this.mapVerificacao(r),
    });

    /**
     * Campos da sincronização pelo título (0069, ADR-0055). `divergencia` é sempre definido: a
     * coluna é NOT NULL, e uma leitura que não a trouxe (listagem antiga) vale `false`.
     */
    private mapSincronizacao = (
        r: ItemRow,
    ): Pick<
        ItemLote,
        | 'situacao'
        | 'pagoEm'
        | 'pagoObservadoEm'
        | 'valorPago'
        | 'origemBaixa'
        | 'baixaFonte'
        | 'divergencia'
        | 'divergenciaDetalhe'
        | 'sincronizadoEm'
    > => ({
        ...(r.situacao != null ? { situacao: r.situacao as ItemSituacao } : {}),
        ...(r.pago_em != null ? { pagoEm: new Date(r.pago_em).toISOString() } : {}),
        ...(r.pago_observado_em != null
            ? { pagoObservadoEm: new Date(r.pago_observado_em).toISOString() }
            : {}),
        ...(r.valor_pago != null ? { valorPago: Number(r.valor_pago) } : {}),
        ...(r.origem_baixa != null ? { origemBaixa: r.origem_baixa as OrigemBaixa } : {}),
        ...(r.baixa_fonte != null ? { baixaFonte: r.baixa_fonte as BaixaFonte } : {}),
        divergencia: r.divergencia === true,
        ...(r.divergencia_detalhe != null ? { divergenciaDetalhe: r.divergencia_detalhe } : {}),
        ...(r.sincronizado_em != null
            ? { sincronizadoEm: new Date(r.sincronizado_em).toISOString() }
            : {}),
    });

    /** Campos da verificação TED/PIX (0076, ADR-0063). O destino só sai mascarado (I10h). */
    private mapVerificacao = (
        r: ItemRow,
    ): Pick<
        ItemLote,
        'verificacaoEstado' | 'verificadoEm' | 'destinoMascarado' | 'autorizacaoAviso'
    > => ({
        ...(r.verificacao_estado != null
            ? { verificacaoEstado: r.verificacao_estado as PaymentCheckState }
            : {}),
        ...(r.verificado_em != null
            ? { verificadoEm: new Date(r.verificado_em).toISOString() }
            : {}),
        ...(r.destino_mascarado != null ? { destinoMascarado: r.destino_mascarado } : {}),
        ...(r.autorizacao_aviso != null
            ? { autorizacaoAviso: r.autorizacao_aviso as PayeeItemWarning }
            : {}),
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
        ...(h.remessa_gerada_em != null
            ? { remessaGeradaEm: new Date(h.remessa_gerada_em).toISOString() }
            : {}),
        ...(h.cco_cod != null ? { ccoCod: Number(h.cco_cod) } : {}),
        ...(h.ger_num != null ? { gerNum: Number(h.ger_num) } : {}),
        ...(h.data_debito != null ? { dataDebito: String(h.data_debito) } : {}),
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

    /**
     * Títulos já num lote RASCUNHO, com o lote e se ele é automático — o painel bloqueia a
     * seleção (I3) e mostra/linka o lote na linha do título (ADR-0050).
     */
    public listTitulosEmRascunho = async (
        tx?: TransactionClient,
    ): Promise<
        Array<{
            filCod: number;
            docCod: string;
            titCod: string;
            loteId: string;
            automatico: boolean;
        }>
    > => {
        const rows = (await this.db(tx).selectMany(
            `SELECT i.fil_cod, i.doc_cod, i.tit_cod, l.id AS lote_id, l.automatico
             FROM lote_pagamento_item i JOIN lote_pagamento l ON l.id = i.lote_id
             WHERE l.status = 'RASCUNHO'`,
        )) as Array<{
            fil_cod: number;
            doc_cod: string;
            tit_cod: string;
            lote_id: string;
            automatico: boolean;
        }>;
        return rows.map((r) => ({
            filCod: r.fil_cod,
            docCod: r.doc_cod,
            titCod: r.tit_cod,
            loteId: r.lote_id,
            automatico: r.automatico === true,
        }));
    };

    /**
     * Títulos em lotes NÃO cancelados, com o lote e o status — para a aba de boletos DDA dizer
     * em que lote o título do boleto está. Lote mais recente primeiro (um título pode ter ficado
     * num lote antigo que nunca gerou remessa).
     */
    public listTitulosEmLotesAbertos = async (): Promise<
        Array<{ filCod: number; docCod: string; titCod: string; loteId: string; status: string }>
    > => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT i.fil_cod, i.doc_cod, i.tit_cod, l.id AS lote_id, l.status
             FROM lote_pagamento_item i JOIN lote_pagamento l ON l.id = i.lote_id
             WHERE l.status <> 'CANCELADO'
             ORDER BY l.criado_em DESC`,
        )) as Array<{
            fil_cod: number;
            doc_cod: string;
            tit_cod: string;
            lote_id: string;
            status: string;
        }>;
        return rows.map((r) => ({
            filCod: r.fil_cod,
            docCod: r.doc_cod,
            titCod: r.tit_cod,
            loteId: r.lote_id,
            status: r.status,
        }));
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
            `SELECT ${LOTE_HEADER_COLUMNS}
             FROM lote_pagamento WHERE id = $id`,
            { id },
        );
        if (!header) return null;
        const itens = await this.db(tx).selectMany(
            `SELECT i.lote_id, i.fil_cod, i.doc_cod, i.tit_cod, i.credor, i.valor, i.vencimento,
                    i.modalidade, i.incluido_por, i.incluido_em, i.native_its_cod_seq,
                    i.retorno_evento, i.retorno_descricao, i.rejeitado, i.bor_cod, i.bxa_cod_seq,
                    i.conciliado_em, i.favorecido_autorizado_id,
                    i.situacao, i.pago_em, i.pago_observado_em, i.valor_pago, i.origem_baixa,
                    i.baixa_fonte, i.divergencia, i.divergencia_detalhe, i.sincronizado_em,
                    i.verificacao_estado, i.verificado_em, i.destino_mascarado, i.autorizacao_aviso
             FROM lote_pagamento_item i
             WHERE i.lote_id = $id ORDER BY i.incluido_em ASC, i.id ASC`,
            { id },
        );
        return this.mapLote(header, (itens as ItemRow[]).map(this.mapItem));
    };

    public listLotes = async (filtro: ListarLotesFiltro): Promise<LotePagamento[]> => {
        // Mesma projeção de cabeçalho do `getLoteComItens`. Sem `remessa_arquivo` e as chaves
        // nativas aqui, a aba Finalizados recebia todo lote sem remessa e escondia o botão
        // "Baixar remessa" em toda carga de página (sispag-remessa-download-export).
        const headers = (await this.databaseClient.selectMany(
            `SELECT ${LOTE_HEADER_COLUMNS}
             FROM lote_pagamento
             WHERE ($status::text IS NULL OR status = $status)
               AND ($filCod::int IS NULL OR fil_cod = $filCod)
             ORDER BY criado_em DESC`,
            { status: filtro.status ?? null, filCod: filtro.filCod ?? null },
        )) as LoteHeaderRow[];
        return this.comItens(headers);
    };

    /** Lotes pelos ids (export de títulos das remessas). Ids ausentes simplesmente não voltam. */
    public listLotesPorIds = async (ids: string[]): Promise<LotePagamento[]> => {
        if (ids.length === 0) return [];
        const headers = (await this.databaseClient.selectMany(
            `SELECT ${LOTE_HEADER_COLUMNS}
             FROM lote_pagamento
             WHERE id = ANY($ids)
             ORDER BY remessa_gerada_em ASC NULLS LAST, criado_em ASC`,
            { ids },
        )) as LoteHeaderRow[];
        return this.comItens(headers);
    };

    /** Carrega os itens de vários lotes numa query e monta os agregados. */
    private comItens = async (headers: LoteHeaderRow[]): Promise<LotePagamento[]> => {
        if (headers.length === 0) return [];
        const ids = headers.map((h) => h.id);
        const itens = (await this.databaseClient.selectMany(
            `SELECT lote_id, fil_cod, doc_cod, tit_cod, credor, valor, vencimento,
                    modalidade, incluido_por, incluido_em,
                    retorno_evento, retorno_descricao, rejeitado, bor_cod, bxa_cod_seq,
                    situacao, pago_em, valor_pago, origem_baixa, baixa_fonte,
                    divergencia, divergencia_detalhe, sincronizado_em,
                    verificacao_estado, verificado_em, destino_mascarado, autorizacao_aviso
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

    /**
     * Título num lote COMPROMETIDO (`FINALIZADO` | `REMESSA_GERADA`)? ADR-0064 — não entra em
     * outro lote nem se move. Lote mais recente primeiro.
     */
    public loteComprometidoComTitulo = async (
        params: { filCod: number; docCod: string; titCod: string },
        tx?: TransactionClient,
    ): Promise<{ loteId: string; status: LoteComprometidoRef['status'] } | null> => {
        const row = await this.db(tx).selectFirst<{
            lote_id: string;
            status: LoteComprometidoRef['status'];
        }>(
            `SELECT i.lote_id, l.status
             FROM lote_pagamento_item i
             JOIN lote_pagamento l ON l.id = i.lote_id
             WHERE l.status = ANY($status)
               AND i.fil_cod = $filCod AND i.doc_cod = $docCod AND i.tit_cod = $titCod
             ORDER BY l.criado_em DESC
             LIMIT 1`,
            { ...params, status: [...LOTE_STATUS_COMPROMETIDO] },
        );
        return row ? { loteId: row.lote_id, status: row.status } : null;
    };

    /** Títulos em lotes COMPROMETIDOS, para o painel bloquear a seleção (ADR-0064). */
    public listTitulosEmLotesComprometidos = async (
        tx?: TransactionClient,
    ): Promise<Array<{ filCod: number; docCod: string; titCod: string } & LoteComprometidoRef>> => {
        const rows = (await this.db(tx).selectMany(
            `SELECT i.fil_cod, i.doc_cod, i.tit_cod, l.id AS lote_id, l.status
             FROM lote_pagamento_item i JOIN lote_pagamento l ON l.id = i.lote_id
             WHERE l.status = ANY($status)
             ORDER BY l.criado_em ASC`,
            { status: [...LOTE_STATUS_COMPROMETIDO] },
        )) as Array<{
            fil_cod: number;
            doc_cod: string;
            tit_cod: string;
            lote_id: string;
            status: LoteComprometidoRef['status'];
        }>;
        return rows.map((r) => ({
            filCod: r.fil_cod,
            docCod: r.doc_cod,
            titCod: r.tit_cod,
            id: r.lote_id,
            status: r.status,
        }));
    };

    /**
     * Remove o item SÓ se o lote ainda é RASCUNHO (ADR-0064, mover). Retorna rowCount: 0 = o lote
     * saiu de RASCUNHO (ou o item já não estava lá) e o serviço aborta o movimento inteiro.
     */
    public removerItemDeRascunho = async (
        params: { loteId: string; filCod: number; docCod: string; titCod: string },
        tx?: TransactionClient,
    ): Promise<number> =>
        this.db(tx).update(
            `DELETE FROM lote_pagamento_item i
             USING lote_pagamento l
             WHERE l.id = i.lote_id AND l.status = 'RASCUNHO'
               AND i.lote_id = $loteId AND i.fil_cod = $filCod
               AND i.doc_cod = $docCod AND i.tit_cod = $titCod`,
            params,
        );

    /**
     * Cancela o lote RASCUNHO que ficou sem itens (ADR-0064: a origem de um movimento que perdeu o
     * último título). Bumpa a versão. Retorna se cancelou.
     */
    public cancelarSeVazio = async (loteId: string, tx?: TransactionClient): Promise<boolean> => {
        const n = await this.db(tx).update(
            `UPDATE lote_pagamento l
             SET status = 'CANCELADO', versao = versao + 1, atualizado_em = now()
             WHERE l.id = $loteId AND l.status = 'RASCUNHO'
               AND NOT EXISTS (SELECT 1 FROM lote_pagamento_item i WHERE i.lote_id = l.id)`,
            { loteId },
        );
        return n > 0;
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

    /**
     * Congelamento (ADR-0065 I10f): grava no item a autorização do favorecido vigente quando o
     * destino foi enviado ao `fin015`. Só a REFERÊNCIA (id), nunca o valor. Não bumpa a versão.
     */
    public setFavorecidoAutorizadoItem = async (
        params: {
            loteId: string;
            filCod: number;
            docCod: string;
            titCod: string;
            autorizacaoId: string;
        },
        tx?: TransactionClient,
    ): Promise<number> =>
        this.db(tx).update(
            `UPDATE lote_pagamento_item SET favorecido_autorizado_id = $autorizacaoId
             WHERE lote_id = $loteId AND fil_cod = $filCod
               AND doc_cod = $docCod AND tit_cod = $titCod`,
            params,
        );

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
    // ============================================== ADR-0063/0065 — verificação TED/PIX

    /**
     * Resultado da verificação de UM item TED/PIX (I13b, I14e). Não bumpa a versão: é o sistema
     * registrando o que leu, não edição do agregado pela analista. `PENDENTE` (leitura falhou) não
     * apaga o destino nem o selo vistos antes: nada novo se sabe.
     */
    public marcarVerificacaoItem = async (
        params: {
            loteId: string;
            filCod: number;
            docCod: string;
            titCod: string;
            estado: PaymentCheckState;
            destinoMascarado?: string;
            autorizacaoAviso?: PayeeItemWarning;
        },
        tx?: TransactionClient,
    ): Promise<number> =>
        this.db(tx).update(
            `UPDATE lote_pagamento_item
             SET verificacao_estado = $estado,
                 verificado_em = CASE WHEN $estado = 'OK' THEN now() ELSE verificado_em END,
                 destino_mascarado = CASE WHEN $estado = 'OK' THEN $destinoMascarado
                                          ELSE destino_mascarado END,
                 autorizacao_aviso = CASE WHEN $estado = 'OK' THEN $autorizacaoAviso
                                          ELSE autorizacao_aviso END
             WHERE lote_id = $loteId AND fil_cod = $filCod AND doc_cod = $docCod
               AND tit_cod = $titCod`,
            {
                loteId: params.loteId,
                filCod: params.filCod,
                docCod: params.docCod,
                titCod: params.titCod,
                estado: params.estado,
                destinoMascarado: params.destinoMascarado ?? null,
                autorizacaoAviso: params.autorizacaoAviso ?? null,
            },
        );

    /** O item deixou de ser TED/PIX: some o estado da verificação, o destino visto e o selo. */
    public limparVerificacaoItem = async (
        params: { loteId: string; filCod: number; docCod: string; titCod: string },
        tx?: TransactionClient,
    ): Promise<number> =>
        this.db(tx).update(
            `UPDATE lote_pagamento_item
             SET verificacao_estado = NULL, verificado_em = NULL, destino_mascarado = NULL,
                 autorizacao_aviso = NULL
             WHERE lote_id = $loteId AND fil_cod = $filCod AND doc_cod = $docCod
               AND tit_cod = $titCod`,
            params,
        );

    /**
     * I13j (ADR-0065) — remoção do item PELO SISTEMA no `finalizarLote`, só em RASCUNHO. Ator
     * `sistema`, evento `ITEM_REMOVIDO_SISTEMA` com o motivo (`SEM_DADO_PAGAMENTO` |
     * `FAVORECIDO_NAO_AUTORIZADO` | `DESTINO_ALTERADO`) e bump de versão na mesma transação. NÃO
     * marca o lote como manual (gap Q11). `false` = o item não estava no lote RASCUNHO.
     */
    public removerItemPeloSistema = async (
        params: {
            loteId: string;
            filCod: number;
            docCod: string;
            titCod: string;
            motivo: SystemRemovalReason;
        },
        tx: TransactionClient,
    ): Promise<boolean> => {
        const { motivo, ...chave } = params;
        const n = await tx.update(
            `DELETE FROM lote_pagamento_item i
             USING lote_pagamento l
             WHERE i.lote_id = l.id AND l.id = $loteId AND l.status = 'RASCUNHO'
               AND i.fil_cod = $filCod AND i.doc_cod = $docCod AND i.tit_cod = $titCod`,
            chave,
        );
        if (n === 0) return false;
        await this.tocarLote(params.loteId, tx);
        await this.eventos.registrar(
            {
                evento: VERIFICATION_EVENT.ITEM_REMOVIDO_SISTEMA,
                ator: SISPAG_SYSTEM_ACTOR,
                loteId: params.loteId,
                filCod: params.filCod,
                docCod: params.docCod,
                titCod: params.titCod,
                dados: { motivo },
            },
            tx,
        );
        return true;
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

    /**
     * Grava a data de débito da remessa (I8, ADR-0049). Chamado ANTES do `criarLote` do fin015:
     * a partir dali a data está no lote nativo e fica congelada (I8b).
     */
    public setDataDebito = async (
        input: { loteId: string; dataDebito: string },
        tx?: TransactionClient,
    ): Promise<void> => {
        await this.db(tx).update(
            `UPDATE lote_pagamento
             SET data_debito = $dataDebito::date, atualizado_em = now()
             WHERE id = $loteId`,
            { loteId: input.loteId, dataDebito: input.dataDebito },
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
    public registrarConciliacaoItem = async (
        input: {
            loteId: string;
            filCod: number;
            docCod: string;
            titCod: string;
            evento: string;
            descricao?: string;
            rejeitado: boolean;
            borCod?: number;
            bxaCodSeq?: number;
        },
        tx?: TransactionClient,
    ): Promise<void> => {
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

    /**
     * Lotes que a sincronização (L11, ADR-0055) visita: `REMESSA_GERADA` e `RETORNADO` sempre;
     * `BAIXADO` só dentro da janela de checagem de estorno (I11f) — um lote baixado há meses não
     * precisa custar uma leitura do fin064 por item a cada hora. Só lotes com chave nativa: sem
     * ela não há o que ler no ERP.
     */
    public listLotesSincronizaveis = async (janelaBaixadoDias: number): Promise<string[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT id FROM lote_pagamento
             WHERE native_fil_cod IS NOT NULL AND native_bnc_cod IS NOT NULL
               AND native_flp_cod IS NOT NULL
               AND (status = ANY($ativos)
                    OR (status = $baixado
                        AND remessa_gerada_em > now() - make_interval(days => $dias::int)))
             ORDER BY remessa_gerada_em ASC NULLS LAST, id ASC`,
            {
                ativos: [LOTE_STATUS.REMESSA_GERADA, LOTE_STATUS.RETORNADO],
                baixado: LOTE_STATUS.BAIXADO,
                dias: janelaBaixadoDias,
            },
        )) as Array<{ id: string }>;
        return rows.map((r) => r.id);
    };

    /**
     * Grava o resultado de uma passada de sincronização que MUDOU algo (I11h): os campos dos
     * itens e, se houver, a transição do lote — numa ÚNICA transação, sob optimistic lock (I6).
     *
     * A trava é a primeira escrita: se `versao`/`status` não batem, nada é gravado e devolve
     * `CONFLITO` (o chamador pula o lote nesta passada). Não lança erro genérico por conflito.
     *
     * Os itens chegam com o estado COMPLETO decidido por `DecisaoStatusLote` — campo ausente é
     * gravado como NULL de propósito, não preservado.
     */
    public aplicarSincronizacao = async (input: {
        loteId: string;
        versaoEsperada: number;
        statusAtual: LotePagamentoStatus;
        para?: LotePagamentoStatus;
        itens: EstadoSincronizacaoItem[];
    }): Promise<ResultadoAplicarSincronizacao> =>
        this.databaseClient.withTransaction(async (tx) => {
            const afetadas = await tx.update(
                `UPDATE lote_pagamento
                 SET status = COALESCE($para, status), versao = versao + 1, atualizado_em = now()
                 WHERE id = $loteId AND versao = $versaoEsperada AND status = $statusAtual`,
                {
                    loteId: input.loteId,
                    versaoEsperada: input.versaoEsperada,
                    statusAtual: input.statusAtual,
                    para: input.para ?? null,
                },
            );
            if (afetadas === 0) return RESULTADO_APLICAR_SINCRONIZACAO.CONFLITO;
            for (const item of input.itens) {
                await tx.update(
                    `UPDATE lote_pagamento_item
                     SET situacao = $situacao,
                         conciliado_em = CASE
                             WHEN $retornoEvento::text IS DISTINCT FROM retorno_evento THEN now()
                             ELSE conciliado_em END,
                         retorno_evento = $retornoEvento, retorno_descricao = $retornoDescricao,
                         rejeitado = $rejeitado, bor_cod = $borCod, bxa_cod_seq = $bxaCodSeq,
                         baixa_fonte = $baixaFonte, origem_baixa = $origemBaixa,
                         pago_em = $pagoEm, valor_pago = $valorPago,
                         pago_observado_em = $pagoObservadoEm,
                         divergencia = $divergencia, divergencia_detalhe = $divergenciaDetalhe,
                         sincronizado_em = $sincronizadoEm
                     WHERE lote_id = $loteId AND fil_cod = $filCod
                       AND doc_cod = $docCod AND tit_cod = $titCod`,
                    this.paramsItemSincronizado(input.loteId, item),
                );
            }
            return RESULTADO_APLICAR_SINCRONIZACAO.APLICADO;
        });

    /** Parâmetros nomeados do UPDATE de um item sincronizado — ausente vira NULL. */
    private paramsItemSincronizado = (
        loteId: string,
        item: EstadoSincronizacaoItem,
    ): Record<string, unknown> => ({
        loteId,
        filCod: item.filCod,
        docCod: item.docCod,
        titCod: item.titCod,
        situacao: item.situacao ?? null,
        retornoEvento: item.retornoEvento ?? null,
        retornoDescricao: item.retornoDescricao ?? null,
        rejeitado: item.rejeitado,
        borCod: item.borCod ?? null,
        bxaCodSeq: item.bxaCodSeq ?? null,
        baixaFonte: item.baixaFonte ?? null,
        origemBaixa: item.origemBaixa ?? null,
        pagoEm: item.pagoEm ?? null,
        valorPago: item.valorPago ?? null,
        pagoObservadoEm: item.pagoObservadoEm ?? null,
        divergencia: item.divergencia,
        divergenciaDetalhe: item.divergenciaDetalhe ?? null,
        sincronizadoEm: item.sincronizadoEm ?? null,
    });

    /**
     * Passada sem mudança (I11h): só `sincronizado_em` dos itens lidos com sucesso. NÃO toca
     * `versao` nem `lote_pagamento` — sem isso a tela veria o lote "alterado por outra pessoa" a
     * cada hora, e o optimistic lock de quem estivesse editando falharia à toa.
     */
    public tocarSincronizacao = async (input: {
        loteId: string;
        itens: Array<{ filCod: number; docCod: string; titCod: string }>;
        em: string;
    }): Promise<void> => {
        if (input.itens.length === 0) return;
        await this.databaseClient.update(
            `UPDATE lote_pagamento_item
             SET sincronizado_em = $em
             WHERE lote_id = $loteId
               AND (fil_cod::text || ':' || doc_cod || ':' || tit_cod) = ANY($chaves)`,
            {
                loteId: input.loteId,
                em: input.em,
                chaves: input.itens.map((i) => `${i.filCod}:${i.docCod}:${i.titCod}`),
            },
        );
    };
}
