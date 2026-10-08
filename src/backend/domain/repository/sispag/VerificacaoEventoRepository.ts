import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import type { VerificationEvent } from '../../interface/sispag/SispagInterface.js';

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
