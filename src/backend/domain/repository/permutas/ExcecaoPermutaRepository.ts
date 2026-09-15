import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import type ExcecaoPermuta from '../../interface/permutas/ExcecaoPermuta.js';
import type {
    InsertExcecaoPermutaInput,
    SoftDeleteExcecaoPermutaInput,
} from '../../interface/permutas/ExcecaoPermuta.js';

/**
 * ExcecaoPermutaRepository — exceções manuais "permutado fora do painel" (ADR-0047),
 * tabela `permuta_excecao_manual` (migration 0059).
 *
 * Soft delete: uma exceção é ativa enquanto `removido_em IS NULL`, e o índice parcial
 * `uq_permuta_excecao_manual_ativa` garante no máximo uma ativa por adiantamento.
 * As escritas recebem a transação do serviço, que reclassifica a linha do adto na
 * MESMA transação. SQL 100% parametrizado (`$nome` via SqlBuilder, Rule #5).
 */
@injectable()
export default class ExcecaoPermutaRepository {
    constructor(
        @inject(PostgreeDatabaseClient)
        private databaseClient: PostgreeDatabaseClient,
    ) {}

    /** Exceções ativas. A eleição chama UMA vez por run; o painel, uma vez por leitura. */
    public listAtivas = async (): Promise<ExcecaoPermuta[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT id, adiantamento_doc_cod, justificativa, criado_por, criado_em,
                    removido_por, removido_em
             FROM permuta_excecao_manual
             WHERE removido_em IS NULL
             ORDER BY criado_em DESC`,
        );
        return rows.map((r) => this.mapRow(r));
    };

    /** A exceção ativa de um adiantamento, ou `null`. */
    public findAtiva = async (adiantamentoDocCod: string): Promise<ExcecaoPermuta | null> => {
        const row = await this.databaseClient.selectFirst<Record<string, unknown>>(
            `SELECT id, adiantamento_doc_cod, justificativa, criado_por, criado_em,
                    removido_por, removido_em
             FROM permuta_excecao_manual
             WHERE adiantamento_doc_cod = $adiantamentoDocCod AND removido_em IS NULL`,
            { adiantamentoDocCod },
        );
        return row ? this.mapRow(row) : null;
    };

    /**
     * Grava a exceção ativa. Uma segunda ativa para o mesmo adto viola o índice parcial
     * (`23505`), que o serviço traduz em 409.
     */
    public insertAtiva = async (
        tx: TransactionClient,
        input: InsertExcecaoPermutaInput,
    ): Promise<void> => {
        await tx.insert(
            `INSERT INTO permuta_excecao_manual (adiantamento_doc_cod, justificativa, criado_por)
             VALUES ($adiantamentoDocCod, $justificativa, $criadoPor)`,
            {
                adiantamentoDocCod: input.adiantamentoDocCod,
                justificativa: input.justificativa,
                criadoPor: input.criadoPor,
            },
        );
    };

    /** Soft delete da exceção ativa. Devolve quantas linhas foram removidas (0 ou 1). */
    public softDeleteAtiva = async (
        tx: TransactionClient,
        input: SoftDeleteExcecaoPermutaInput,
    ): Promise<number> => {
        return tx.update(
            `UPDATE permuta_excecao_manual
             SET removido_por = $removidoPor, removido_em = now()
             WHERE adiantamento_doc_cod = $adiantamentoDocCod AND removido_em IS NULL`,
            {
                adiantamentoDocCod: input.adiantamentoDocCod,
                removidoPor: input.removidoPor,
            },
        );
    };

    private mapRow = (r: Record<string, unknown>): ExcecaoPermuta => ({
        id: String(r.id),
        adiantamentoDocCod: String(r.adiantamento_doc_cod),
        justificativa: String(r.justificativa),
        criadoPor: String(r.criado_por),
        criadoEm: this.toDate(r.criado_em),
        ...(r.removido_por != null ? { removidoPor: String(r.removido_por) } : {}),
        ...(r.removido_em != null ? { removidoEm: this.toDate(r.removido_em) } : {}),
    });

    /** `pg` devolve TIMESTAMPTZ como `Date`; fixtures e drivers alternativos, como texto. */
    private toDate = (valor: unknown): Date =>
        valor instanceof Date ? valor : new Date(String(valor));
}
