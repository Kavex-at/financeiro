import { inject, injectable } from 'tsyringe';
import { chunked } from '../../client/ConexosBaseClient.js';
import PostgreeDatabaseClient, {
    type TransactionClient,
} from '../../client/database/PostgreeDatabaseClient.js';
import type { ArquivoDda, BoletoDda, ItemDda } from '../../interface/sispag/BoletoDda.js';

const UPSERT_CHUNK = 200;

interface BoletoRow {
    ddc_cod: number;
    dit_cod: number;
    numero: string | null;
    valor: string;
    vencimento: string | null;
    codbar: string | null;
    fil_cod: number | null;
    doc_cod: string | null;
    tit_cod: string | null;
    flp_cod: number | null;
    bnc_cod: number | null;
    arquivo: string | null;
    importado_em: Date | null;
}

/**
 * BoletoDdaRepository — snapshot local do pool `fin124` (migration 0062).
 * SQL 100% parametrizado (`$name`). NÃO toca o ERP.
 */
@injectable()
export default class BoletoDdaRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    /** `ddcCod` → data de importação (epoch ms) dos arquivos já sincronizados. */
    public listArquivosSincronizados = async (): Promise<Map<number, number | undefined>> => {
        const rows = (await this.databaseClient.selectMany(
            'SELECT ddc_cod, importado_em FROM boleto_dda_arquivo',
        )) as Array<{ ddc_cod: number; importado_em: Date | null }>;
        return new Map(rows.map((r) => [r.ddc_cod, r.importado_em?.getTime()]));
    };

    /**
     * Grava um arquivo e TODOS os seus itens numa transação: o arquivo só aparece como
     * sincronizado se os itens entraram junto. Itens que sumiram do arquivo no Conexos saem daqui.
     */
    public salvarArquivo = async (arquivo: ArquivoDda, itens: ItemDda[]): Promise<void> => {
        await this.databaseClient.withTransaction(async (tx) => {
            await tx.insert(
                `INSERT INTO boleto_dda_arquivo (
                    ddc_cod, nome, importado_em, cancelado_em, status, total_itens, sincronizado_em
                 ) VALUES ($ddcCod, $nome, $importadoEm, $canceladoEm, $status, $totalItens, now())
                 ON CONFLICT (ddc_cod) DO UPDATE SET
                    nome = EXCLUDED.nome, importado_em = EXCLUDED.importado_em,
                    cancelado_em = EXCLUDED.cancelado_em, status = EXCLUDED.status,
                    total_itens = EXCLUDED.total_itens, sincronizado_em = now()`,
                {
                    ddcCod: arquivo.ddcCod,
                    nome: arquivo.nome ?? null,
                    importadoEm: arquivo.importadoEm != null ? new Date(arquivo.importadoEm) : null,
                    canceladoEm: arquivo.canceladoEm != null ? new Date(arquivo.canceladoEm) : null,
                    status: arquivo.status ?? null,
                    totalItens: itens.length,
                },
            );
            await tx.update(
                'DELETE FROM boleto_dda WHERE ddc_cod = $ddcCod AND NOT (dit_cod = ANY($ditCods))',
                { ddcCod: arquivo.ddcCod, ditCods: itens.map((i) => i.ditCod) },
            );
            for (const chunk of chunked(itens, UPSERT_CHUNK)) {
                await this.upsertChunk(tx, chunk);
            }
        });
    };

    private upsertChunk = async (tx: TransactionClient, chunk: ItemDda[]): Promise<void> => {
        const tuples: string[] = [];
        const params: Record<string, unknown> = {};
        chunk.forEach((b, i) => {
            tuples.push(
                `($a${i}, $i${i}, $n${i}, $v${i}, $ve${i}::date, $c${i}, ` +
                    `$f${i}, $d${i}, $t${i}, $fl${i}, $b${i}, now())`,
            );
            params[`a${i}`] = b.ddcCod;
            params[`i${i}`] = b.ditCod;
            params[`n${i}`] = b.numero ?? null;
            params[`v${i}`] = b.valor;
            params[`ve${i}`] = b.vencimento ?? null;
            params[`c${i}`] = b.codbar ?? null;
            params[`f${i}`] = b.filCod ?? null;
            params[`d${i}`] = b.docCod ?? null;
            params[`t${i}`] = b.titCod ?? null;
            params[`fl${i}`] = b.flpCod ?? null;
            params[`b${i}`] = b.bncCod ?? null;
        });
        await tx.insert(
            `INSERT INTO boleto_dda (
                ddc_cod, dit_cod, numero, valor, vencimento, codbar,
                fil_cod, doc_cod, tit_cod, flp_cod, bnc_cod, sincronizado_em
             ) VALUES ${tuples.join(', ')}
             ON CONFLICT (ddc_cod, dit_cod) DO UPDATE SET
                numero = EXCLUDED.numero, valor = EXCLUDED.valor, vencimento = EXCLUDED.vencimento,
                codbar = EXCLUDED.codbar, fil_cod = EXCLUDED.fil_cod, doc_cod = EXCLUDED.doc_cod,
                tit_cod = EXCLUDED.tit_cod, flp_cod = EXCLUDED.flp_cod, bnc_cod = EXCLUDED.bnc_cod,
                sincronizado_em = now()`,
            params,
        );
    };

    /**
     * Boletos de arquivos NÃO cancelados. Com `vencimentoDesde` (`YYYY-MM-DD`), só os que vencem
     * nesse dia ou depois; sem ele, o pool inteiro.
     */
    public listBoletos = async (filtro: { vencimentoDesde?: string }): Promise<BoletoDda[]> => {
        const rows = (await this.databaseClient.selectMany(
            `SELECT b.ddc_cod, b.dit_cod, b.numero, b.valor,
                    to_char(b.vencimento, 'YYYY-MM-DD') AS vencimento, b.codbar,
                    b.fil_cod, b.doc_cod, b.tit_cod, b.flp_cod, b.bnc_cod,
                    a.nome AS arquivo, a.importado_em
             FROM boleto_dda b JOIN boleto_dda_arquivo a ON a.ddc_cod = b.ddc_cod
             WHERE a.cancelado_em IS NULL
               AND ($desde::date IS NULL OR b.vencimento >= $desde::date)
             ORDER BY b.vencimento ASC NULLS LAST, b.ddc_cod DESC, b.dit_cod ASC`,
            { desde: filtro.vencimentoDesde ?? null },
        )) as BoletoRow[];
        return rows.map(this.map);
    };

    /** epoch ms da sincronização mais recente; `undefined` = nunca sincronizado. */
    public ultimaSincronizacao = async (): Promise<number | undefined> => {
        const row = await this.databaseClient.selectFirst<{ em: Date | null }>(
            'SELECT max(sincronizado_em) AS em FROM boleto_dda_arquivo',
        );
        return row?.em?.getTime();
    };

    private map = (r: BoletoRow): BoletoDda => ({
        ddcCod: r.ddc_cod,
        ditCod: r.dit_cod,
        valor: Number(r.valor),
        ...(r.numero ? { numero: r.numero } : {}),
        ...(r.vencimento ? { vencimento: r.vencimento } : {}),
        ...(r.codbar ? { codbar: r.codbar } : {}),
        ...(r.fil_cod != null ? { filCod: r.fil_cod } : {}),
        ...(r.doc_cod ? { docCod: r.doc_cod } : {}),
        ...(r.tit_cod ? { titCod: r.tit_cod } : {}),
        ...(r.flp_cod != null ? { flpCod: r.flp_cod } : {}),
        ...(r.bnc_cod != null ? { bncCod: r.bnc_cod } : {}),
        ...(r.arquivo ? { arquivo: r.arquivo } : {}),
        ...(r.importado_em ? { importadoEm: r.importado_em.getTime() } : {}),
    });
}
