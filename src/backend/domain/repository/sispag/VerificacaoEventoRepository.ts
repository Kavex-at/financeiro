import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import type { RetiradaDoLoteNaTrilha } from '../../interface/sispag/RetiradaCodigoBarras.js';
import {
    MOTIVOS_RETIRADA_CODIGO_BARRAS,
    type VerificationEvent,
} from '../../interface/sispag/SispagInterface.js';

/** Uma linha da trilha da verificação TED/PIX (I13m). `dados` nunca carrega conta/chave (I10h). */
export interface VerificacaoEventoInput {
    evento: VerificationEvent;
    ator: string;
    loteId?: string;
    filCod?: number;
    docCod?: string;
    titCod?: string;
    alertaId?: string;
    bloqueioId?: string;
    pendenciaId?: string;
    dados?: Record<string, unknown>;
}

/** Item TED/PIX retirado pelo sistema por falta de dado no cadastro (seção do relatório). */
export interface RetiradoSemDado {
    loteId?: string;
    filCod?: number;
    docCod?: string;
    titCod?: string;
    pesCod?: string;
    credor?: string;
    ocorridoEm: string;
}

/**
 * VerificacaoEventoRepository — trilha SÓ-INCLUSÃO da verificação TED/PIX (ADR-0063, I13m). Só
 * `INSERT`: o trigger da 0078 recusa UPDATE/DELETE/TRUNCATE. Recebe o `tx` de quem muta o estado,
 * para o evento e a mudança irem juntos (ou nenhum dos dois).
 */
@injectable()
export default class VerificacaoEventoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    public registrar = async (
        input: VerificacaoEventoInput,
        tx?: TransactionClient,
    ): Promise<string> => {
        const id = randomUUID();
        await (tx ?? this.databaseClient).insert(
            `INSERT INTO sispag_verificacao_evento
                (id, evento, ator, lote_id, fil_cod, doc_cod, tit_cod, alerta_id, bloqueio_id,
                 pendencia_id, dados)
             VALUES ($id, $evento, $ator, $loteId, $filCod, $docCod, $titCod, $alertaId,
                     $bloqueioId, $pendenciaId, $dados::jsonb)`,
            {
                id,
                evento: input.evento,
                ator: input.ator,
                loteId: input.loteId ?? null,
                filCod: input.filCod ?? null,
                docCod: input.docCod ?? null,
                titCod: input.titCod ?? null,
                alertaId: input.alertaId ?? null,
                bloqueioId: input.bloqueioId ?? null,
                pendenciaId: input.pendenciaId ?? null,
                dados: input.dados ? JSON.stringify(input.dados) : null,
            },
        );
        return id;
    };

    /**
     * Itens que a guarda de código de barras retirou DESTE lote, lidos da trilha (persistente:
     * sobrevive a recarregar a tela, I16f(3)). Mais recentes primeiro, com o credor da carteira.
     * Só a máscara 5+4 e a identidade do título mantido — o evento nunca teve o código completo.
     */
    public listarRetiradasPorCodigoBarras = async (
        loteId: string,
    ): Promise<RetiradaDoLoteNaTrilha[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT e.fil_cod, e.doc_cod, e.tit_cod, e.dados, e.ocorrido_em, t.credor
               FROM sispag_verificacao_evento e
               LEFT JOIN titulo_a_pagar t
                 ON t.fil_cod = e.fil_cod AND t.doc_cod = e.doc_cod AND t.tit_cod = e.tit_cod
              WHERE e.evento = $evento AND e.lote_id = $loteId AND e.ator = $ator
                AND e.dados->>'motivo' = ANY($motivos)
              ORDER BY e.ocorrido_em DESC`,
            {
                evento: 'ITEM_REMOVIDO_SISTEMA',
                loteId,
                ator: 'sistema',
                motivos: [...MOTIVOS_RETIRADA_CODIGO_BARRAS],
            },
        )) as Array<Record<string, unknown>>;
        return rows.flatMap((r) => {
            const dados = (r.dados ?? {}) as Record<string, unknown>;
            if (r.fil_cod == null || r.doc_cod == null || r.tit_cod == null) return [];
            const mantido = dados.tituloMantido as
                | { filCod?: number; docCod?: string; titCod?: string }
                | undefined;
            return [
                {
                    titulo: {
                        filCod: Number(r.fil_cod),
                        docCod: String(r.doc_cod),
                        titCod: String(r.tit_cod),
                    },
                    motivo: dados.motivo as RetiradaDoLoteNaTrilha['motivo'],
                    ...(typeof dados.codigoMascarado === 'string'
                        ? { codigoMascarado: dados.codigoMascarado }
                        : {}),
                    ...(mantido?.filCod != null && mantido.docCod && mantido.titCod
                        ? {
                              tituloMantido: {
                                  filCod: Number(mantido.filCod),
                                  docCod: String(mantido.docCod),
                                  titCod: String(mantido.titCod),
                              },
                          }
                        : {}),
                    ...(typeof dados.valor === 'number' ? { valor: dados.valor } : {}),
                    ...(typeof dados.vencimento === 'string'
                        ? { vencimento: dados.vencimento }
                        : {}),
                    ...(r.credor != null ? { credor: String(r.credor) } : {}),
                    ocorridoEm: new Date(r.ocorrido_em as string).toISOString(),
                },
            ];
        });
    };

    /**
     * Chaves `filCod:docCod:titCod` dos itens que o SISTEMA retirou DESTE lote com um dos
     * `motivos` (evento `ITEM_REMOVIDO_SISTEMA`). É a metade "evento" do par que reconhece um
     * resíduo no rascunho nativo (I16h(c)); a outra metade é a marca ATIVA de origem
     * `CODIGO_BARRAS_*`. Só leitura.
     */
    public listarChavesRetiradasPeloSistema = async (
        loteId: string,
        motivos: string[],
    ): Promise<Set<string>> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT DISTINCT fil_cod, doc_cod, tit_cod
               FROM sispag_verificacao_evento
              WHERE evento = $evento AND lote_id = $loteId AND ator = $ator
                AND dados->>'motivo' = ANY($motivos)`,
            { evento: 'ITEM_REMOVIDO_SISTEMA', loteId, ator: 'sistema', motivos },
        )) as Array<{ fil_cod: number | null; doc_cod: string | null; tit_cod: string | null }>;
        return new Set(
            rows
                .filter((r) => r.fil_cod != null && r.doc_cod != null && r.tit_cod != null)
                .map((r) => `${r.fil_cod}:${r.doc_cod}:${r.tit_cod}`),
        );
    };

    /**
     * Seção "TED/PIX retirados por falta de dado" do relatório (ADR-0065): os eventos
     * `ITEM_REMOVIDO_SISTEMA` com motivo `SEM_DADO_PAGAMENTO`, com o favorecido da carteira
     * persistida. Só leitura. Os mais recentes primeiro.
     */
    public listarRetiradosSemDado = async (limite: number): Promise<RetiradoSemDado[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT e.lote_id, e.fil_cod, e.doc_cod, e.tit_cod, e.ocorrido_em, t.pes_cod, t.credor
               FROM sispag_verificacao_evento e
               LEFT JOIN titulo_a_pagar t
                 ON t.fil_cod = e.fil_cod AND t.doc_cod = e.doc_cod AND t.tit_cod = e.tit_cod
              WHERE e.evento = $evento AND e.dados->>'motivo' = $motivo
              ORDER BY e.ocorrido_em DESC
              LIMIT $limite`,
            { evento: 'ITEM_REMOVIDO_SISTEMA', motivo: 'SEM_DADO_PAGAMENTO', limite },
        )) as Array<Record<string, unknown>>;
        return rows.map((r) => ({
            ...(r.lote_id != null ? { loteId: String(r.lote_id) } : {}),
            ...(r.fil_cod != null ? { filCod: Number(r.fil_cod) } : {}),
            ...(r.doc_cod != null ? { docCod: String(r.doc_cod) } : {}),
            ...(r.tit_cod != null ? { titCod: String(r.tit_cod) } : {}),
            ...(r.pes_cod != null ? { pesCod: String(r.pes_cod) } : {}),
            ...(r.credor != null ? { credor: String(r.credor) } : {}),
            ocorridoEm: new Date(r.ocorrido_em as string).toISOString(),
        }));
    };
}
