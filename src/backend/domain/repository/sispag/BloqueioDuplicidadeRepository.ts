import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import {
    type BloqueioDuplicidade,
    type ChaveTitulo,
    DUPLICATE_HOLD_ORIGIN,
    DUPLICATE_HOLD_STATE,
    type DuplicateHoldOrigin,
    type DuplicateHoldState,
    isCodigoMascarado,
    ORIGENS_RETENCAO_CODIGO_BARRAS,
    SISPAG_SYSTEM_ACTOR,
    VERIFICATION_EVENT,
} from '../../interface/sispag/SispagInterface.js';
import type { TituloRetidoPorCodigoBarras } from '../../interface/sispag/RetiradaCodigoBarras.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

interface BloqueioRow {
    id: string;
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    pes_cod: string | null;
    alerta_id: string | null;
    lote_id_origem: string | null;
    motivo: string;
    estado: string;
    marcado_por: string;
    marcado_em: Date;
    encerrado_em: Date | null;
    desfeito_por: string | null;
    desfeito_em: Date | null;
    motivo_desfazer: string | null;
    // ── 0085: origem e retenção por código de barras (ADR-0069 emenda 1) ──
    origem?: string | null;
    titulo_mantido_fil_cod?: number | null;
    titulo_mantido_doc_cod?: string | null;
    titulo_mantido_tit_cod?: string | null;
    codigo_mascarado?: string | null;
}

const COLUNAS = `id, fil_cod, doc_cod, tit_cod, pes_cod, alerta_id, lote_id_origem, motivo, estado,
    marcado_por, marcado_em, encerrado_em, desfeito_por, desfeito_em, motivo_desfazer,
    origem, titulo_mantido_fil_cod, titulo_mantido_doc_cod, titulo_mantido_tit_cod,
    codigo_mascarado`;

const iso = (d: Date | null): string | undefined => (d ? new Date(d).toISOString() : undefined);

/**
 * BloqueioDuplicidadeRepository — `titulo_bloqueio_duplicidade` (ADR-0063, I13g). Marca LOCAL; nada
 * é escrito no Conexos. Toda mutação grava o evento na trilha na MESMA transação (I13m).
 */
@injectable()
export default class BloqueioDuplicidadeRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
        @inject(VerificacaoEventoRepository) private readonly eventos: VerificacaoEventoRepository,
    ) {}

    private naTransacao = <T>(
        tx: TransactionClient | undefined,
        fn: (t: TransactionClient) => Promise<T>,
    ): Promise<T> => (tx ? fn(tx) : this.databaseClient.withTransaction(fn));

    private map = (r: BloqueioRow): BloqueioDuplicidade => ({
        id: r.id,
        filCod: r.fil_cod,
        docCod: r.doc_cod,
        titCod: r.tit_cod,
        ...(r.pes_cod != null ? { pesCod: r.pes_cod } : {}),
        ...(r.alerta_id != null ? { alertaId: r.alerta_id } : {}),
        ...(r.lote_id_origem != null ? { loteIdOrigem: r.lote_id_origem } : {}),
        motivo: r.motivo,
        origem: (r.origem ?? DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO) as DuplicateHoldOrigin,
        ...(r.titulo_mantido_fil_cod != null &&
        r.titulo_mantido_doc_cod != null &&
        r.titulo_mantido_tit_cod != null
            ? {
                  tituloMantido: {
                      filCod: r.titulo_mantido_fil_cod,
                      docCod: r.titulo_mantido_doc_cod,
                      titCod: r.titulo_mantido_tit_cod,
                  },
              }
            : {}),
        ...(r.codigo_mascarado != null ? { codigoMascarado: r.codigo_mascarado } : {}),
        estado: r.estado as DuplicateHoldState,
        marcadoPor: r.marcado_por,
        marcadoEm: new Date(r.marcado_em).toISOString(),
        ...(r.encerrado_em != null ? { encerradoEm: iso(r.encerrado_em) } : {}),
        ...(r.desfeito_por != null ? { desfeitoPor: r.desfeito_por } : {}),
        ...(r.desfeito_em != null ? { desfeitoEm: iso(r.desfeito_em) } : {}),
        ...(r.motivo_desfazer != null ? { motivoDesfazer: r.motivo_desfazer } : {}),
    });

    /** O bloqueio ATIVO do título, se houver (I13g: no máximo um). */
    public findAtivo = async (
        chave: ChaveTitulo,
        tx?: TransactionClient,
    ): Promise<BloqueioDuplicidade | null> => {
        const row = await (tx ?? this.databaseClient).selectFirst<BloqueioRow>(
            `SELECT ${COLUNAS} FROM titulo_bloqueio_duplicidade
             WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
               AND estado = $ativo`,
            { ...chave, ativo: DUPLICATE_HOLD_STATE.ATIVO },
        );
        return row ? this.map(row) : null;
    };

    /** Bloqueios ATIVOS (para a tela marcar os títulos). */
    public listAtivos = async (): Promise<BloqueioDuplicidade[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM titulo_bloqueio_duplicidade WHERE estado = $ativo
             ORDER BY marcado_em DESC`,
            { ativo: DUPLICATE_HOLD_STATE.ATIVO },
        )) as BloqueioRow[];
        return rows.map(this.map);
    };

    /** Bloqueios ATIVOS de uma ou mais origens (retidos por código de barras, I16g). */
    public listAtivosPorOrigem = async (
        origens: DuplicateHoldOrigin[],
    ): Promise<BloqueioDuplicidade[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM titulo_bloqueio_duplicidade
             WHERE estado = $ativo AND origem = ANY($origens)
             ORDER BY marcado_em DESC`,
            { ativo: DUPLICATE_HOLD_STATE.ATIVO, origens },
        )) as BloqueioRow[];
        return rows.map(this.map);
    };

    /**
     * Retidos por código de barras (I16g) com credor/valor/vencimento do título da carteira, para
     * a aba de títulos. Só leitura; nada de código completo (a marca só tem a máscara).
     */
    public listAtivosPorOrigemComTitulo = async (
        origens: DuplicateHoldOrigin[],
    ): Promise<TituloRetidoPorCodigoBarras[]> => {
        const colunas = COLUNAS.split(',')
            .map((c) => `b.${c.trim()}`)
            .join(', ');
        const rows = (await this.databaseClient.selectMany(
            `SELECT ${colunas}, t.credor AS t_credor, t.valor AS t_valor,
                    t.vencimento AS t_vencimento
               FROM titulo_bloqueio_duplicidade b
               LEFT JOIN titulo_a_pagar t
                 ON t.fil_cod = b.fil_cod AND t.doc_cod = b.doc_cod AND t.tit_cod = b.tit_cod
              WHERE b.estado = $ativo AND b.origem = ANY($origens)
              ORDER BY b.marcado_em DESC`,
            { ativo: DUPLICATE_HOLD_STATE.ATIVO, origens },
        )) as Array<
            BloqueioRow & {
                t_credor: string | null;
                t_valor: string | number | null;
                t_vencimento: Date | null;
            }
        >;
        return rows.map((r) => ({
            ...this.map(r),
            ...(r.t_credor ? { credor: r.t_credor } : {}),
            ...(r.t_valor != null ? { valor: Number(r.t_valor) } : {}),
            ...(r.t_vencimento != null
                ? { vencimento: new Date(r.t_vencimento).toISOString().slice(0, 10) }
                : {}),
        }));
    };

    /**
     * I16g — encerra, só pelos sinais BARATOS, as marcas por código de barras que não fazem mais
     * sentido: (a) o item que FICOU saiu do fin064 ou foi pago (o boleto está coberto); (b) o lote
     * de origem foi CANCELADO sem remessa gerada. O sinal "o boleto do título retido mudou" fica
     * de fora (depende do fin124): sem ele, o desfazer manual cobre. Um evento por marca, na
     * mesma transação. Devolve quantas encerrou.
     */
    public encerrarPorSinaisDeCodigoDeBarras = async (): Promise<number> =>
        this.databaseClient.withTransaction(async (tx) => {
            const encerrados = (await tx.selectMany(
                `UPDATE titulo_bloqueio_duplicidade b
                 SET estado = $encerrado, encerrado_em = now()
                 WHERE b.estado = $ativo
                   AND b.origem = ANY($origens)
                   AND (
                     EXISTS (
                       SELECT 1 FROM titulo_a_pagar k
                       WHERE k.fil_cod = b.titulo_mantido_fil_cod
                         AND k.doc_cod = b.titulo_mantido_doc_cod
                         AND k.tit_cod = b.titulo_mantido_tit_cod
                         AND (k.ativo = FALSE OR k.pago = TRUE))
                     OR EXISTS (
                       SELECT 1 FROM lote_pagamento l
                       WHERE l.id = b.lote_id_origem AND l.status = 'CANCELADO'
                         AND l.remessa_gerada_em IS NULL)
                   )
                 RETURNING b.id, b.fil_cod, b.doc_cod, b.tit_cod, b.lote_id_origem`,
                {
                    encerrado: DUPLICATE_HOLD_STATE.ENCERRADO,
                    ativo: DUPLICATE_HOLD_STATE.ATIVO,
                    // A marca do GRUPO de boleto (ADR-0076) não se encerra por estes sinais: só
                    // pela anulação/pagamento do grupo (`encerrarDoGrupo`) ou pelo desfazer da
                    // analista. Um lote cancelado não diz que o borderô do grupo saiu do ERP.
                    origens: ORIGENS_RETENCAO_CODIGO_BARRAS.filter(
                        (o) => o !== DUPLICATE_HOLD_ORIGIN.GRUPO_BOLETO,
                    ),
                },
            )) as Array<{
                id: string;
                fil_cod: number;
                doc_cod: string;
                tit_cod: string;
                lote_id_origem: string | null;
            }>;
            for (const b of encerrados) {
                await this.eventos.registrar(
                    {
                        evento: VERIFICATION_EVENT.BLOQUEIO_ENCERRADO,
                        ator: SISPAG_SYSTEM_ACTOR,
                        ...(b.lote_id_origem ? { loteId: b.lote_id_origem } : {}),
                        filCod: b.fil_cod,
                        docCod: b.doc_cod,
                        titCod: b.tit_cod,
                        bloqueioId: b.id,
                        dados: {
                            motivo: 'item mantido pago/inativo ou lote de origem cancelado sem remessa',
                        },
                    },
                    tx,
                );
            }
            return encerrados.length;
        });

    /**
     * Cria o bloqueio ATIVO + evento BLOQUEIO_CRIADO, na transação dada.
     *
     * Sem `origem` é a marca histórica da analista (`DUPLICIDADE_TITULO`, I13g) e `alertaId` é
     * obrigatório. As origens de código de barras (I16g) nascem sem alerta e carregam a máscara
     * 5+4 e o título mantido; o esquema (0085) recusa código longo, e aqui o guard recusa antes.
     * Idempotente pelo índice ATIVO: título já retido (qualquer origem) mantém a marca existente.
     */
    public criar = async (
        input: {
            chave: ChaveTitulo;
            pesCod?: string;
            alertaId?: string;
            loteIdOrigem: string;
            motivo: string;
            ator: string;
            origem?: DuplicateHoldOrigin;
            codigoMascarado?: string;
            tituloMantido?: ChaveTitulo;
        },
        tx: TransactionClient,
    ): Promise<string> => {
        const origem = input.origem ?? DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO;
        if (origem === DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO && !input.alertaId) {
            throw new Error('alertaId é obrigatório no bloqueio por duplicidade de título');
        }
        if (input.codigoMascarado !== undefined && !isCodigoMascarado(input.codigoMascarado)) {
            throw new Error('codigoMascarado precisa estar mascarado (5 primeiros + 4 últimos)');
        }
        const id = randomUUID();
        const inseridas = await tx.insert(
            `INSERT INTO titulo_bloqueio_duplicidade
                (id, fil_cod, doc_cod, tit_cod, pes_cod, alerta_id, lote_id_origem, motivo, estado,
                 marcado_por, origem, codigo_mascarado, titulo_mantido_fil_cod,
                 titulo_mantido_doc_cod, titulo_mantido_tit_cod)
             VALUES ($id, $filCod, $docCod, $titCod, $pesCod, $alertaId, $loteIdOrigem, $motivo,
                     $ativo, $ator, $origem, $codigoMascarado, $mantidoFilCod, $mantidoDocCod,
                     $mantidoTitCod)
             ON CONFLICT (fil_cod, doc_cod, tit_cod) WHERE estado = 'ATIVO' DO NOTHING`,
            {
                id,
                ...input.chave,
                pesCod: input.pesCod ?? null,
                alertaId: input.alertaId ?? null,
                loteIdOrigem: input.loteIdOrigem,
                motivo: input.motivo,
                ativo: DUPLICATE_HOLD_STATE.ATIVO,
                ator: input.ator,
                origem,
                codigoMascarado: input.codigoMascarado ?? null,
                mantidoFilCod: input.tituloMantido?.filCod ?? null,
                mantidoDocCod: input.tituloMantido?.docCod ?? null,
                mantidoTitCod: input.tituloMantido?.titCod ?? null,
            },
        );
        // Título já bloqueado (outra alerta, mesmo título): o bloqueio ATIVO existente vale.
        if (inseridas === 0) return (await this.findAtivo(input.chave, tx))?.id ?? id;
        await this.eventos.registrar(
            {
                evento: VERIFICATION_EVENT.BLOQUEIO_CRIADO,
                ator: input.ator,
                loteId: input.loteIdOrigem,
                ...input.chave,
                ...(input.alertaId !== undefined ? { alertaId: input.alertaId } : {}),
                bloqueioId: id,
                dados: this.dadosDoEvento(origem, input),
            },
            tx,
        );
        return id;
    };

    /** `dados` do BLOQUEIO_CRIADO: a origem histórica não ganha campo novo (paridade I13m). */
    private dadosDoEvento = (
        origem: DuplicateHoldOrigin,
        input: { motivo: string; codigoMascarado?: string; tituloMantido?: ChaveTitulo },
    ): Record<string, unknown> => {
        if (origem === DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO) return { motivo: input.motivo };
        return {
            motivo: input.motivo,
            origem,
            ...(input.codigoMascarado !== undefined
                ? { codigoMascarado: input.codigoMascarado }
                : {}),
            ...(input.tituloMantido ? { tituloMantido: input.tituloMantido } : {}),
        };
    };

    /**
     * ADR-0076 (I19p(3)): a remessa retirou o grupo de boleto ⇒ UMA marca `GRUPO_BOLETO` por
     * título, todas na transação do chamador (a da retirada). Título já com marca ATIVA mantém a
     * existente (I13g: no máximo uma). Devolve os ids das marcas (novas ou existentes).
     */
    public criarDoGrupo = async (
        input: {
            grupoId: string;
            titulos: readonly ChaveTitulo[];
            pesCod?: string;
            loteIdOrigem: string;
            motivo: string;
            ator: string;
            codigoMascarado?: string;
        },
        tx: TransactionClient,
    ): Promise<string[]> => {
        if (input.titulos.length === 0) throw new Error('grupo sem títulos para reter');
        const ids: string[] = [];
        for (const chave of input.titulos) {
            ids.push(
                await this.criar(
                    {
                        chave,
                        ...(input.pesCod !== undefined ? { pesCod: input.pesCod } : {}),
                        loteIdOrigem: input.loteIdOrigem,
                        motivo: `${input.motivo} (grupo ${input.grupoId})`,
                        ator: input.ator,
                        origem: DUPLICATE_HOLD_ORIGIN.GRUPO_BOLETO,
                        ...(input.codigoMascarado !== undefined
                            ? { codigoMascarado: input.codigoMascarado }
                            : {}),
                    },
                    tx,
                ),
            );
        }
        return ids;
    };

    /**
     * ADR-0076 (I19t/I19r): encerra as marcas ATIVAS de origem `GRUPO_BOLETO` dos títulos do
     * grupo (ao anular ou pagar), um evento `BLOQUEIO_ENCERRADO` por marca, na transação dada (ou
     * numa própria). Marcas de OUTRA origem não são tocadas. Devolve quantas encerrou.
     */
    public encerrarDoGrupo = async (
        input: { grupoId: string; motivo: string; ator: string },
        tx?: TransactionClient,
    ): Promise<number> =>
        this.naTransacao(tx, async (t) => {
            const encerrados = (await t.selectMany(
                `UPDATE titulo_bloqueio_duplicidade b
                 SET estado = $encerrado, encerrado_em = now()
                 FROM sispag_grupo_boleto_titulo gt
                 WHERE gt.grupo_id = $grupoId::uuid
                   AND b.estado = $ativo AND b.origem = $origem
                   AND b.fil_cod = gt.fil_cod AND b.doc_cod = gt.doc_cod AND b.tit_cod = gt.tit_cod
                 RETURNING b.id, b.fil_cod, b.doc_cod, b.tit_cod`,
                {
                    grupoId: input.grupoId,
                    encerrado: DUPLICATE_HOLD_STATE.ENCERRADO,
                    ativo: DUPLICATE_HOLD_STATE.ATIVO,
                    origem: DUPLICATE_HOLD_ORIGIN.GRUPO_BOLETO,
                },
            )) as Array<{ id: string; fil_cod: number; doc_cod: string; tit_cod: string }>;
            for (const b of encerrados) {
                await this.eventos.registrar(
                    {
                        evento: VERIFICATION_EVENT.BLOQUEIO_ENCERRADO,
                        ator: input.ator,
                        filCod: b.fil_cod,
                        docCod: b.doc_cod,
                        titCod: b.tit_cod,
                        bloqueioId: b.id,
                        dados: { motivo: input.motivo, grupoId: input.grupoId },
                    },
                    t,
                );
            }
            return encerrados.length;
        });

    /**
     * I13g — encerra os bloqueios ATIVOS cujo título a ingestão marcou inativo (sumiu do fin064:
     * pago, cancelado ou fora da carteira). Ator `sistema`, um evento por bloqueio, tudo numa
     * transação. Devolve quantos encerrou.
     */
    public encerrarDeTitulosInativos = async (): Promise<number> =>
        this.databaseClient.withTransaction(async (tx) => {
            const encerrados = (await tx.selectMany(
                `UPDATE titulo_bloqueio_duplicidade b
                 SET estado = $encerrado, encerrado_em = now()
                 FROM titulo_a_pagar t
                 WHERE b.estado = $ativo
                   AND t.fil_cod = b.fil_cod AND t.doc_cod = b.doc_cod AND t.tit_cod = b.tit_cod
                   AND t.ativo = FALSE
                 RETURNING b.id, b.fil_cod, b.doc_cod, b.tit_cod`,
                { encerrado: DUPLICATE_HOLD_STATE.ENCERRADO, ativo: DUPLICATE_HOLD_STATE.ATIVO },
            )) as Array<{ id: string; fil_cod: number; doc_cod: string; tit_cod: string }>;
            for (const b of encerrados) {
                await this.eventos.registrar(
                    {
                        evento: VERIFICATION_EVENT.BLOQUEIO_ENCERRADO,
                        ator: SISPAG_SYSTEM_ACTOR,
                        filCod: b.fil_cod,
                        docCod: b.doc_cod,
                        titCod: b.tit_cod,
                        bloqueioId: b.id,
                        dados: { motivo: 'título inativo na ingestão' },
                    },
                    tx,
                );
            }
            return encerrados.length;
        });

    /**
     * A analista desfaz o bloqueio ATIVO do título, com motivo (I13g). Evento BLOQUEIO_DESFEITO na
     * mesma transação. `null` = não havia bloqueio ATIVO (nada gravado).
     */
    public desfazer = async (input: {
        chave: ChaveTitulo;
        motivo: string;
        ator: string;
    }): Promise<BloqueioDuplicidade | null> =>
        this.databaseClient.withTransaction(async (tx) => {
            const row = await tx.selectFirst<BloqueioRow>(
                `UPDATE titulo_bloqueio_duplicidade
                 SET estado = $desfeito, desfeito_por = $ator, desfeito_em = now(),
                     motivo_desfazer = $motivo
                 WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
                   AND estado = $ativo
                 RETURNING ${COLUNAS}`,
                {
                    ...input.chave,
                    desfeito: DUPLICATE_HOLD_STATE.DESFEITO,
                    ativo: DUPLICATE_HOLD_STATE.ATIVO,
                    ator: input.ator,
                    motivo: input.motivo,
                },
            );
            if (!row) return null;
            await this.eventos.registrar(
                {
                    evento: VERIFICATION_EVENT.BLOQUEIO_DESFEITO,
                    ator: input.ator,
                    ...input.chave,
                    bloqueioId: row.id,
                    dados: { motivo: input.motivo },
                },
                tx,
            );
            return this.map(row);
        });
}
