import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { DpsConhecido } from '../../interface/sispag/SugestaoBoleto.js';
import {
    dpsLidoRowSchema,
    type TentativaDps,
    type TituloDps,
    tentativaDpsRowSchema,
} from '../../interface/sispag/TituloDps.js';

/**
 * TituloDpsRepository — `titulo_dps` (0087, ADR-0073, I15p). Uma linha por título: o DPS lido do
 * PDF da NFS-e no GED, ou a tentativa que falhou, com o motivo.
 */
@injectable()
export default class TituloDpsRepository {
    public constructor(
        @inject(PostgreeDatabaseClient) private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    /**
     * DPS lidos, para o motor de sugestão. Inclui títulos que já saíram da carteira: o DPS deles
     * continua provando o escopo (credor, emissor) da ordem.
     */
    public listarLidos = async (): Promise<DpsConhecido[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT fil_cod, doc_cod, tit_cod, pes_cod, nfse, dps
             FROM titulo_dps
             WHERE status = 'LIDO'
             ORDER BY fil_cod, doc_cod, tit_cod`,
        );
        // Linha inválida (impossível pelo CHECK da 0087) é ignorada: não derruba a sugestão inteira.
        return rows.flatMap((r) => {
            const lido = dpsLidoRowSchema.safeParse(r);
            return lido.success ? [lido.data] : [];
        });
    };

    /** Todas as tentativas (inclusive `LIDO`), para a seleção do leitor não reler à toa. */
    public listarTentativas = async (): Promise<TentativaDps[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT fil_cod, doc_cod, tit_cod, status, tentativas, lido_em FROM titulo_dps`,
        );
        return rows.flatMap((r) => {
            const t = tentativaDpsRowSchema.safeParse(r);
            return t.success ? [t.data] : [];
        });
    };

    /**
     * Grava a leitura (ou a tentativa) do título. Reler substitui o resultado anterior e soma uma
     * tentativa — é o que limita a nova tentativa de quem falhou.
     */
    public registrar = async (leitura: TituloDps): Promise<void> => {
        await this.databaseClient.insert(
            `INSERT INTO titulo_dps
                 (fil_cod, doc_cod, tit_cod, pes_cod, nfse, dps, status, fonte, arquivo, motivo,
                  tentativas, lido_em)
             VALUES ($filCod, $docCod, $titCod, $pesCod, $nfse, $dps, $status, $fonte, $arquivo,
                     $motivo, 1, now())
             ON CONFLICT (fil_cod, doc_cod, tit_cod) DO UPDATE SET
                 pes_cod = EXCLUDED.pes_cod,
                 nfse = EXCLUDED.nfse,
                 dps = EXCLUDED.dps,
                 status = EXCLUDED.status,
                 fonte = EXCLUDED.fonte,
                 arquivo = EXCLUDED.arquivo,
                 motivo = EXCLUDED.motivo,
                 tentativas = titulo_dps.tentativas + 1,
                 lido_em = now()`,
            {
                filCod: leitura.filCod,
                docCod: leitura.docCod,
                titCod: leitura.titCod,
                pesCod: leitura.pesCod ?? null,
                nfse: leitura.nfse ?? null,
                dps: leitura.dps ?? null,
                status: leitura.status,
                fonte: leitura.fonte,
                arquivo: leitura.arquivo ?? null,
                motivo: leitura.motivo ?? null,
            },
        );
    };
}
