import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import type {
    ChaveTitulo,
    MotivoRemocaoRetencao,
    RetencaoFormacao,
} from '../../interface/sispag/SispagInterface.js';

interface RetencaoRow {
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    motivo: string | null;
    marcado_por: string;
    marcado_em: Date | string;
}

/** Retenção ativa com a chave do título a que pertence. */
export interface RetencaoAtiva extends ChaveTitulo {
    retencao: RetencaoFormacao;
}

/**
 * RetencaoFormacaoRepository — retenção de um título da formação automática de lotes
 * (ADR-0050, I8), tabela `titulo_retencao_formacao` (migration 0062).
 *
 * Soft delete: a retenção é ativa enquanto `removido_em IS NULL`, e o índice parcial
 * `uq_titulo_retencao_formacao_ativa` garante no máximo uma ativa por título. As escritas
 * recebem a transação do serviço, que remove ou inclui o item do lote na MESMA transação.
 * SQL 100% parametrizado (Rule #5).
 */
@injectable()
export default class RetencaoFormacaoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    /** Retenções ativas. O painel chama uma vez por leitura. */
    public listAtivas = async (): Promise<RetencaoAtiva[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT fil_cod, doc_cod, tit_cod, motivo, marcado_por, marcado_em
             FROM titulo_retencao_formacao
             WHERE removido_em IS NULL`,
        )) as RetencaoRow[];
        return rows.map(this.mapRow);
    };

    /**
     * Grava a retenção ativa. Idempotente: se o título já tem uma ativa, não faz nada (o índice
     * parcial é o árbitro, então duas remoções concorrentes não viram erro 500).
     */
    public insertAtiva = async (
        tx: TransactionClient,
        input: ChaveTitulo & { motivo?: string; marcadoPor: string },
    ): Promise<void> => {
        await tx.insert(
            `INSERT INTO titulo_retencao_formacao (fil_cod, doc_cod, tit_cod, motivo, marcado_por)
             VALUES ($filCod, $docCod, $titCod, $motivo, $marcadoPor)
             ON CONFLICT (fil_cod, doc_cod, tit_cod) WHERE removido_em IS NULL DO NOTHING`,
            {
                filCod: input.filCod,
                docCod: input.docCod,
                titCod: input.titCod,
                motivo: input.motivo ?? null,
                marcadoPor: input.marcadoPor,
            },
        );
    };

    /** Soft delete da retenção ativa. Devolve quantas foram liberadas (0 ou 1). */
    public liberarAtiva = async (
        tx: TransactionClient,
        input: ChaveTitulo & { removidoPor: string; motivoRemocao: MotivoRemocaoRetencao },
    ): Promise<number> =>
        tx.update(
            `UPDATE titulo_retencao_formacao
             SET removido_por = $removidoPor, removido_em = now(), motivo_remocao = $motivoRemocao
             WHERE fil_cod = $filCod AND doc_cod = $docCod AND tit_cod = $titCod
               AND removido_em IS NULL`,
            {
                filCod: input.filCod,
                docCod: input.docCod,
                titCod: input.titCod,
                removidoPor: input.removidoPor,
                motivoRemocao: input.motivoRemocao,
            },
        );

    private mapRow = (r: RetencaoRow): RetencaoAtiva => ({
        filCod: Number(r.fil_cod),
        docCod: String(r.doc_cod),
        titCod: String(r.tit_cod),
        retencao: {
            marcadoPor: r.marcado_por,
            marcadoEm: (r.marcado_em instanceof Date
                ? r.marcado_em
                : new Date(String(r.marcado_em))
            ).toISOString(),
            ...(r.motivo != null ? { motivo: r.motivo } : {}),
        },
    });
}
