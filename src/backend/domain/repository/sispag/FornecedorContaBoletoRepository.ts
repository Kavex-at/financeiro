import { inject, injectable } from 'tsyringe';
import { chunked } from '../../client/ConexosBaseClient.js';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type {
    FornecedorOrigem,
    MapeamentoConta,
} from '../../interface/sispag/FornecedorContaBoleto.js';

const INSERT_CHUNK = 200;

/** Um boleto e o fornecedor que alguma fonte lhe atribui (a chave da conta sai das barras, no serviço). */
export interface EvidenciaBruta {
    codbar: string;
    pesCod: string;
    credor?: string;
    origem: FornecedorOrigem;
    vistoEm: Date;
}

interface EvidenciaRow {
    codbar: string;
    pes_cod: string;
    credor: string | null;
    origem: FornecedorOrigem;
    visto_em: Date;
}

interface MapeamentoRow {
    chave: string;
    pes_cod: string | null;
    credor: string | null;
    origem: FornecedorOrigem;
    ambiguo: boolean;
    evidencias: number;
    ultima_evidencia_em: Date;
}

/**
 * FornecedorContaBoletoRepository — mapeamento conta do beneficiário → fornecedor (migration 0092).
 * SQL 100% parametrizado. Só LÊ o Conexos-espelho (`boleto_dda`, `titulo_a_pagar`, decisões); a
 * única escrita é `substituir`, chamada pelo aprendizado ao fim da sincronização DDA.
 */
@injectable()
export default class FornecedorContaBoletoRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    /**
     * As três fontes, num só SELECT (arquivos NÃO cancelados; boleto sem barras não entra):
     *  - VINCULADO: o Conexos ligou o boleto a um título (a carteira diz de quem é, pago ou não);
     *  - CONFIRMADO: decisão `CONFIRMADA` da analista (anulada/rejeitada não conta);
     *  - INFERIDO: boleto ainda sem vínculo cujo valor + dia civil de vencimento batem com UM único
     *    título ativo e não pago da carteira, que tenha `pes_cod`. Vencimento do ERP é dia civil
     *    gravado como instante (00:00Z/15:00Z): o dia se lê em UTC, nunca por `now()`.
     */
    public listEvidencias = async (): Promise<EvidenciaBruta[]> => {
        const rows = (await this.databaseClient.selectMany(
            `WITH pool AS (
                 SELECT b.ddc_cod, b.dit_cod, b.codbar, b.valor, b.vencimento, b.fil_cod, b.doc_cod,
                        b.tit_cod, b.sincronizado_em
                 FROM boleto_dda b JOIN boleto_dda_arquivo a ON a.ddc_cod = b.ddc_cod
                 WHERE a.cancelado_em IS NULL AND b.codbar IS NOT NULL
             ),
             unico_por_dia AS (
                 SELECT valor, (vencimento AT TIME ZONE 'UTC')::date AS dia,
                        min(pes_cod) AS pes_cod, min(credor) AS credor, count(*) AS n
                 FROM titulo_a_pagar
                 WHERE vencimento IS NOT NULL
                 GROUP BY valor, (vencimento AT TIME ZONE 'UTC')::date
             )
             SELECT p.codbar, t.pes_cod, t.credor, 'VINCULADO' AS origem,
                    p.sincronizado_em AS visto_em
             FROM pool p
             JOIN titulo_a_pagar t
               ON t.fil_cod = p.fil_cod AND t.doc_cod = p.doc_cod AND t.tit_cod = p.tit_cod
             WHERE t.pes_cod IS NOT NULL AND btrim(t.pes_cod) <> ''
             UNION ALL
             SELECT p.codbar, d.pes_cod, d.credor, 'CONFIRMADO' AS origem,
                    d.decidido_em AS visto_em
             FROM pool p
             JOIN sispag_decisao_sugestao_boleto d
               ON d.ddc_cod = p.ddc_cod AND d.dit_cod = p.dit_cod
             WHERE d.decisao = 'CONFIRMADA' AND btrim(d.pes_cod) <> ''
             UNION ALL
             SELECT p.codbar, u.pes_cod, u.credor, 'INFERIDO' AS origem,
                    p.sincronizado_em AS visto_em
             FROM pool p
             JOIN unico_por_dia u ON u.valor = p.valor AND u.dia = p.vencimento
             WHERE p.tit_cod IS NULL AND u.n = 1
               AND u.pes_cod IS NOT NULL AND btrim(u.pes_cod) <> ''`,
        )) as EvidenciaRow[];
        return rows.map((r) => ({
            codbar: r.codbar,
            pesCod: r.pes_cod,
            ...(r.credor ? { credor: r.credor } : {}),
            origem: r.origem,
            vistoEm: r.visto_em,
        }));
    };

    /** Troca o mapeamento inteiro numa transação: quem lê vê o anterior até o commit. */
    public substituir = async (mapeamentos: MapeamentoConta[]): Promise<void> => {
        await this.databaseClient.withTransaction(async (tx) => {
            await tx.update('DELETE FROM sispag_fornecedor_conta_boleto', {});
            for (const chunk of chunked(mapeamentos, INSERT_CHUNK)) {
                const tuples: string[] = [];
                const params: Record<string, unknown> = {};
                chunk.forEach((m, i) => {
                    tuples.push(`($c${i}, $p${i}, $n${i}, $o${i}, $a${i}, $e${i}, $u${i})`);
                    params[`c${i}`] = m.chave;
                    params[`p${i}`] = m.pesCod ?? null;
                    params[`n${i}`] = m.credor ?? null;
                    params[`o${i}`] = m.origem;
                    params[`a${i}`] = m.ambiguo;
                    params[`e${i}`] = m.evidencias;
                    params[`u${i}`] = m.ultimaEvidenciaEm;
                });
                await tx.insert(
                    `INSERT INTO sispag_fornecedor_conta_boleto (
                        chave, pes_cod, credor, origem, ambiguo, evidencias, ultima_evidencia_em
                     ) VALUES ${tuples.join(', ')}`,
                    params,
                );
            }
        });
    };

    /** O mapeamento por chave de conta (poucas centenas de linhas). */
    public listMapeamentos = async (): Promise<Map<string, MapeamentoConta>> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT chave, pes_cod, credor, origem, ambiguo, evidencias, ultima_evidencia_em
             FROM sispag_fornecedor_conta_boleto`,
        )) as MapeamentoRow[];
        return new Map(
            rows.map((r) => [
                r.chave,
                {
                    chave: r.chave,
                    ...(r.pes_cod ? { pesCod: r.pes_cod } : {}),
                    ...(r.credor ? { credor: r.credor } : {}),
                    origem: r.origem,
                    ambiguo: r.ambiguo,
                    evidencias: r.evidencias,
                    ultimaEvidenciaEm: r.ultima_evidencia_em,
                },
            ]),
        );
    };
}
