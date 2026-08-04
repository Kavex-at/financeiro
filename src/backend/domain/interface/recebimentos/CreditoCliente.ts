import { z } from 'zod';
import { CREDITO_CLIENTE_STATUS } from './constants.js';
import type { CreditoClienteStatus } from './constants.js';

/**
 * CreditoCliente (adiantamento DE cliente — Frente IV, entidade nova).
 *
 * O cliente paga antes de o `DocumentoAReceber` maturar → crédito a aplicar em recebíveis futuros.
 * Oposto direcional do `Adiantamento` (Frente I). Ver `ontology/entities/credito-cliente.md`.
 *
 * SKELETON (Fase 0) — shape only; critério de identificação/consumo vem na Fase 4.
 */
export interface CreditoCliente {
    id: string;
    /** Invariante multi-filial — nunca `null`. */
    filCod: number;
    cliente?: string;
    pesCod?: string;
    valorOriginal: number;
    /** Saldo ainda não aplicado (decresce ao consumir em rateios). */
    valorDisponivel: number;
    moeda: string;
    /** O recebimento que originou o crédito (adiantamento ou diferença não alocada). */
    origemRecebimentoId?: string;
    status: CreditoClienteStatus;
    criadoEm: Date;
}

/** Boundary validation (Zod at boundaries). */
export const creditoClienteSchema = z.object({
    id: z.string().min(1),
    filCod: z.number().int().positive(),
    cliente: z.string().optional(),
    pesCod: z.string().optional(),
    valorOriginal: z.number(),
    valorDisponivel: z.number(),
    moeda: z.string().min(1),
    origemRecebimentoId: z.string().optional(),
    status: z.enum([
        CREDITO_CLIENTE_STATUS.DISPONIVEL,
        CREDITO_CLIENTE_STATUS.PARCIAL,
        CREDITO_CLIENTE_STATUS.CONSUMIDO,
    ]),
    criadoEm: z.date(),
});
