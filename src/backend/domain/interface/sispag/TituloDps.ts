import { z } from 'zod';
import type { DpsConhecido } from './SugestaoBoleto.js';

/**
 * Resultado da leitura do PDF da NFS-e de um título (`titulo_dps`, ADR-0073, I15p). Só `LIDO`
 * carrega DPS; os demais registram a tentativa e o motivo.
 */
export const STATUS_TITULO_DPS = {
    LIDO: 'LIDO',
    SEM_PDF: 'SEM_PDF',
    SEM_DPS_NO_PDF: 'SEM_DPS_NO_PDF',
    ERRO: 'ERRO',
} as const;
export type StatusTituloDps = (typeof STATUS_TITULO_DPS)[keyof typeof STATUS_TITULO_DPS];

export const FONTE_TITULO_DPS = {
    PDF_GED: 'PDF_GED',
} as const;
export type FonteTituloDps = (typeof FONTE_TITULO_DPS)[keyof typeof FONTE_TITULO_DPS];

/** Uma leitura (ou tentativa) do DPS de um título. */
export interface TituloDps {
    filCod: number;
    docCod: string;
    titCod: string;
    pesCod?: string;
    nfse?: string;
    /** Presente só quando `status = LIDO`. */
    dps?: string;
    status: StatusTituloDps;
    fonte: FonteTituloDps;
    /** Nome do arquivo lido no GED (ex.: `NF_86666.PDF`). */
    arquivo?: string;
    motivo?: string;
}

/** Última tentativa de leitura de um título (para limitar a releitura). */
export interface TentativaDps {
    filCod: number;
    docCod: string;
    titCod: string;
    status: StatusTituloDps;
    tentativas: number;
    /** ISO da última leitura. */
    lidoEm: string;
}

export const tentativaDpsRowSchema = z
    .object({
        fil_cod: z.coerce.number().int(),
        doc_cod: z.string(),
        tit_cod: z.string(),
        status: z.enum([
            STATUS_TITULO_DPS.LIDO,
            STATUS_TITULO_DPS.SEM_PDF,
            STATUS_TITULO_DPS.SEM_DPS_NO_PDF,
            STATUS_TITULO_DPS.ERRO,
        ]),
        tentativas: z.coerce.number().int(),
        lido_em: z.coerce.date(),
    })
    .transform(
        (r): TentativaDps => ({
            filCod: r.fil_cod,
            docCod: r.doc_cod,
            titCod: r.tit_cod,
            status: r.status,
            tentativas: r.tentativas,
            lidoEm: r.lido_em.toISOString(),
        }),
    );

const textoOpcional = z
    .string()
    .nullable()
    .optional()
    .transform((v) => (v == null || v === '' ? undefined : v));

/** Linha `LIDO` de `titulo_dps` → `DpsConhecido` (entrada do motor). DPS só dígitos (CHECK 0087). */
export const dpsLidoRowSchema = z
    .object({
        fil_cod: z.coerce.number().int(),
        doc_cod: z.string(),
        tit_cod: z.string(),
        pes_cod: textoOpcional,
        nfse: textoOpcional,
        dps: z.string().regex(/^\d{1,15}$/),
    })
    .transform(
        (r): DpsConhecido => ({
            filCod: r.fil_cod,
            docCod: r.doc_cod,
            titCod: r.tit_cod,
            ...(r.pes_cod ? { pesCod: r.pes_cod } : {}),
            ...(r.nfse ? { nfse: r.nfse } : {}),
            dps: r.dps,
        }),
    );
