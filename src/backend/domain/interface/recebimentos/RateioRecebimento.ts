import { z } from 'zod';
import { PARCELA_FINALIDADE } from './constants.js';
import type { ParcelaFinalidade } from './constants.js';

/**
 * RateioRecebimento (parcela de alocação — Frente IV, Módulo 3).
 *
 * Distribui parte do valor recebido sobre um `DocumentoAReceber`/processo/componente. Rascunho
 * revisável (espelha `permuta_alocacao`); membro do agregado `Recebimento`. Ver
 * `ontology/entities/rateio-recebimento.md`.
 *
 * SKELETON (Fase 0) — shape only.
 */
export interface RateioRecebimento {
    id: string;
    recebimentoId: string;
    documentoDocCod: string;
    documentoTitCod: string;
    filCod: number;
    priCod?: string;
    /** Componente do valor (enum detalhado na Fase 4). */
    componente?: ParcelaFinalidade;
    /** Toda parcela tem finalidade (invariante do rateio). */
    finalidade: string;
    valorAlocado: number;
    moeda: string;
    incluidoPor: string;
}

/** Boundary validation (Zod at boundaries). */
export const rateioRecebimentoSchema = z.object({
    id: z.string().min(1),
    recebimentoId: z.string().min(1),
    documentoDocCod: z.string().min(1),
    documentoTitCod: z.string().min(1),
    filCod: z.number().int().positive(),
    priCod: z.string().optional(),
    componente: z
        .enum([
            PARCELA_FINALIDADE.PRINCIPAL,
            PARCELA_FINALIDADE.MULTA,
            PARCELA_FINALIDADE.JUROS,
            PARCELA_FINALIDADE.ENCOMENDA,
        ])
        .optional(),
    finalidade: z.string().min(1),
    valorAlocado: z.number(),
    moeda: z.string().min(1),
    incluidoPor: z.string().min(1),
});
