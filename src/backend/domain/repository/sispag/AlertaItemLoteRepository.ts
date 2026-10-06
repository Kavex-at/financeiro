import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import {
    type AlertaItemLote,
    type ChaveTitulo,
    type CounterpartTitle,
    ITEM_ALERT_RESOLUTION,
    ITEM_ALERT_STATE,
    type ItemAlertResolution,
    type ItemAlertState,
    type ItemAlertType,
    VERIFICATION_EVENT,
} from '../../interface/sispag/SispagInterface.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

interface AlertaRow {
    id: string;
    lote_id: string;
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    tipo: string;
    contraparte_fil_cod: number | null;
    contraparte_doc_cod: string | null;
    contraparte_titulos: CounterpartTitle[] | null;
    evidencia: Record<string, unknown> | null;
    estado: string;
    resolucao: string | null;
    justificativa: string | null;
    resolvido_por: string | null;
    resolvido_em: Date | null;
    criado_em: Date;
    verificado_em: Date;
}

const COLUNAS = `id, lote_id, fil_cod, doc_cod, tit_cod, tipo, contraparte_fil_cod,
    contraparte_doc_cod, contraparte_titulos, evidencia, estado, resolucao, justificativa,
    resolvido_por, resolvido_em, criado_em, verificado_em`;

/** Estados "vivos": os que a tela mostra e a re-verificação compara (OBSOLETA/DESCARTADA só na trilha). */
const VIVAS: readonly ItemAlertState[] = [ITEM_ALERT_STATE.ABERTA, ITEM_ALERT_STATE.RESOLVIDA];

export interface NovaAlerta {
    loteId: string;
    chave: ChaveTitulo;
    tipo: ItemAlertType;
    contraparteFilCod?: number;
    contraparteDocCod?: string;
    contraparteTitulos?: CounterpartTitle[];
    evidencia: Record<string, unknown>;
}

/**
 * AlertaItemLoteRepository — `lote_pagamento_item_alerta` (ADR-0063, I13c–i). SQL parametrizado
 * (`$nome`). Toda MUTAÇÃO grava o evento na trilha na MESMA transação (I13m): recebe o `tx` de quem
 * chama ou abre uma.
 */
@injectable()
export default class AlertaItemLoteRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
        @inject(VerificacaoEventoRepository) private readonly eventos: VerificacaoEventoRepository,
    ) {}

    private naTransacao = <T>(
        tx: TransactionClient | undefined,
        fn: (t: TransactionClient) => Promise<T>,
    ): Promise<T> => (tx ? fn(tx) : this.databaseClient.withTransaction(fn));

    private map = (r: AlertaRow): AlertaItemLote => ({
        id: r.id,
        loteId: r.lote_id,
        filCod: r.fil_cod,
        docCod: r.doc_cod,
        titCod: r.tit_cod,
        tipo: r.tipo as ItemAlertType,
        ...(r.contraparte_fil_cod != null ? { contraparteFilCod: r.contraparte_fil_cod } : {}),
        ...(r.contraparte_doc_cod != null ? { contraparteDocCod: r.contraparte_doc_cod } : {}),
        ...(r.contraparte_titulos != null ? { contraparteTitulos: r.contraparte_titulos } : {}),
        evidencia: r.evidencia ?? {},
        estado: r.estado as ItemAlertState,
        ...(r.resolucao != null ? { resolucao: r.resolucao as ItemAlertResolution } : {}),
        ...(r.justificativa != null ? { justificativa: r.justificativa } : {}),
        ...(r.resolvido_por != null ? { resolvidoPor: r.resolvido_por } : {}),
        ...(r.resolvido_em != null ? { resolvidoEm: new Date(r.resolvido_em).toISOString() } : {}),
        criadoEm: new Date(r.criado_em).toISOString(),
        verificadoEm: new Date(r.verificado_em).toISOString(),
    });

    /** Alertas vivas (ABERTA | RESOLVIDA) de vários lotes — a tela do lote e a da listagem. */
    public listVivasDosLotes = async (loteIds: string[]): Promise<AlertaItemLote[]> => {
        if (loteIds.length === 0) return [];
        const rows = (await this.databaseClient.selectMany(
            `SELECT ${COLUNAS} FROM lote_pagamento_item_alerta
             WHERE lote_id = ANY($loteIds) AND estado = ANY($vivas)
             ORDER BY criado_em ASC, id ASC`,
            { loteIds, vivas: [...VIVAS] },
        )) as AlertaRow[];
        return rows.map(this.map);
    };

    /** Alertas vivas de UM item no lote — base da re-verificação (I13h). */
    public listVivasDoItem = async (
        loteId: string,
        chave: ChaveTitulo,
        tx?: TransactionClient,
    ): Promise<AlertaItemLote[]> => {
        const rows = (await (tx ?? this.databaseClient).selectMany(
            `SELECT ${COLUNAS} FROM lote_pagamento_item_alerta
             WHERE lote_id = $loteId AND fil_cod = $filCod AND doc_cod = $docCod
               AND tit_cod = $titCod AND estado = ANY($vivas)
             ORDER BY criado_em ASC, id ASC`,
            { loteId, ...chave, vivas: [...VIVAS] },
        )) as AlertaRow[];
        return rows.map(this.map);
    };

    public getById = async (id: string, tx?: TransactionClient): Promise<AlertaItemLote | null> => {
        const row = await (tx ?? this.databaseClient).selectFirst<AlertaRow>(
            `SELECT ${COLUNAS} FROM lote_pagamento_item_alerta WHERE id = $id`,
            { id },
        );
        return row ? this.map(row) : null;
    };

    /** Cria uma alerta ABERTA + evento ALERTA_CRIADA, na mesma transação. */
    public criar = async (
        nova: NovaAlerta,
        ator: string,
        tx?: TransactionClient,
    ): Promise<string> =>
        this.naTransacao(tx, async (t) => {
            const id = randomUUID();
            await t.insert(
                `INSERT INTO lote_pagamento_item_alerta
                    (id, lote_id, fil_cod, doc_cod, tit_cod, tipo, contraparte_fil_cod,
                     contraparte_doc_cod, contraparte_titulos, evidencia, estado)
                 VALUES ($id, $loteId, $filCod, $docCod, $titCod, $tipo, $contraparteFilCod,
                         $contraparteDocCod, $contraparteTitulos::jsonb, $evidencia::jsonb,
                         $estado)`,
                {
                    id,
                    loteId: nova.loteId,
                    filCod: nova.chave.filCod,
                    docCod: nova.chave.docCod,
                    titCod: nova.chave.titCod,
                    tipo: nova.tipo,
                    contraparteFilCod: nova.contraparteFilCod ?? null,
                    contraparteDocCod: nova.contraparteDocCod ?? null,
                    contraparteTitulos: nova.contraparteTitulos
                        ? JSON.stringify(nova.contraparteTitulos)
                        : null,
                    evidencia: JSON.stringify(nova.evidencia),
                    estado: ITEM_ALERT_STATE.ABERTA,
                },
            );
            await this.eventos.registrar(
                {
                    evento: VERIFICATION_EVENT.ALERTA_CRIADA,
                    ator,
                    loteId: nova.loteId,
                    ...nova.chave,
                    alertaId: id,
                    dados: {
                        tipo: nova.tipo,
                        ...(nova.contraparteDocCod
                            ? {
                                  contraparteFilCod: nova.contraparteFilCod,
                                  contraparteDocCod: nova.contraparteDocCod,
                              }
                            : {}),
                    },
                },
                t,
            );
            return id;
        });

    /**
     * A re-verificação confirmou a alerta (mesma contraparte, mesmo tipo, I13h): só atualiza o
     * instante e o snapshot. Não muda estado nem resolução — não é evento de trilha.
     */
    public confirmar = async (
        id: string,
        snapshot: { contraparteTitulos?: CounterpartTitle[]; evidencia: Record<string, unknown> },
        tx?: TransactionClient,
    ): Promise<void> => {
        await (tx ?? this.databaseClient).update(
            `UPDATE lote_pagamento_item_alerta
             SET verificado_em = now(),
                 contraparte_titulos = COALESCE($contraparteTitulos::jsonb, contraparte_titulos),
                 evidencia = $evidencia::jsonb
             WHERE id = $id`,
            {
                id,
                contraparteTitulos: snapshot.contraparteTitulos
                    ? JSON.stringify(snapshot.contraparteTitulos)
                    : null,
                evidencia: JSON.stringify(snapshot.evidencia),
            },
        );
    };

    /**
     * Fecha uma alerta viva como OBSOLETA (a contraparte sumiu / o perfil deixou de divergir) ou
     * DESCARTADA (o item deixou de ser TED/PIX ou saiu do lote). Com o evento, na mesma transação.
     * Devolve `false` quando a alerta já não estava viva (nada gravado).
     */
    public fechar = async (
        alerta: Pick<AlertaItemLote, 'id' | 'loteId' | 'filCod' | 'docCod' | 'titCod' | 'tipo'>,
        para: typeof ITEM_ALERT_STATE.OBSOLETA | typeof ITEM_ALERT_STATE.DESCARTADA,
        ator: string,
        tx?: TransactionClient,
    ): Promise<boolean> =>
        this.naTransacao(tx, async (t) => {
            const n = await t.update(
                `UPDATE lote_pagamento_item_alerta SET estado = $para
                 WHERE id = $id AND estado = ANY($vivas)`,
                { id: alerta.id, para, vivas: [...VIVAS] },
            );
            if (n === 0) return false;
            await this.eventos.registrar(
                {
                    evento:
                        para === ITEM_ALERT_STATE.OBSOLETA
                            ? VERIFICATION_EVENT.ALERTA_OBSOLETA
                            : VERIFICATION_EVENT.ALERTA_DESCARTADA,
                    ator,
                    loteId: alerta.loteId,
                    filCod: alerta.filCod,
                    docCod: alerta.docCod,
                    titCod: alerta.titCod,
                    alertaId: alerta.id,
                    dados: { tipo: alerta.tipo },
                },
                t,
            );
            return true;
        });

    /** Descarta TODAS as alertas vivas de um item (saiu do lote ou deixou de ser TED/PIX). */
    public descartarDoItem = async (
        loteId: string,
        chave: ChaveTitulo,
        ator: string,
        tx?: TransactionClient,
    ): Promise<number> =>
        this.naTransacao(tx, async (t) => {
            let n = 0;
            for (const a of await this.listVivasDoItem(loteId, chave, t)) {
                if (await this.fechar(a, ITEM_ALERT_STATE.DESCARTADA, ator, t)) n += 1;
            }
            return n;
        });

    /**
     * Resolução da analista (I13f): ABERTA → RESOLVIDA com JUSTIFICADA (texto) ou RETIRADA, e o
     * evento — na transação de quem chama (a retirada também remove o item e cria o bloqueio).
     * `false` = a alerta não estava ABERTA (nada gravado).
     */
    public resolver = async (
        input: {
            alerta: AlertaItemLote;
            resolucao: ItemAlertResolution;
            justificativa?: string;
            ator: string;
        },
        tx: TransactionClient,
    ): Promise<boolean> => {
        const n = await tx.update(
            `UPDATE lote_pagamento_item_alerta
             SET estado = $resolvida, resolucao = $resolucao, justificativa = $justificativa,
                 resolvido_por = $ator, resolvido_em = now()
             WHERE id = $id AND estado = $aberta`,
            {
                id: input.alerta.id,
                resolvida: ITEM_ALERT_STATE.RESOLVIDA,
                aberta: ITEM_ALERT_STATE.ABERTA,
                resolucao: input.resolucao,
                justificativa: input.justificativa ?? null,
                ator: input.ator,
            },
        );
        if (n === 0) return false;
        await this.eventos.registrar(
            {
                evento:
                    input.resolucao === ITEM_ALERT_RESOLUTION.JUSTIFICADA
                        ? VERIFICATION_EVENT.ALERTA_JUSTIFICADA
                        : VERIFICATION_EVENT.ALERTA_RETIRADA,
                ator: input.ator,
                loteId: input.alerta.loteId,
                filCod: input.alerta.filCod,
                docCod: input.alerta.docCod,
                titCod: input.alerta.titCod,
                alertaId: input.alerta.id,
                dados: {
                    tipo: input.alerta.tipo,
                    ...(input.justificativa ? { justificativa: input.justificativa } : {}),
                },
            },
            tx,
        );
        return true;
    };
}
