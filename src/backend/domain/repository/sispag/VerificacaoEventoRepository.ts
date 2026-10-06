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
}
