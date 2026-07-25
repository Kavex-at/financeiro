import { z } from 'zod';
import { NDE_STATUS_EMISSAO } from './constants.js';
import type { NdeStatusEmissao } from './constants.js';

/**
 * NotaDebitoEletronica (NDe — artefato terminal da conciliação).
 *
 * Emitida pelo Conexos ERP (não sistema fiscal separado). Registro local só para idempotência +
 * auditoria (a fonte da verdade é o ERP). Ver `ontology/entities/nota-debito-eletronica.md`.
 *
 * SKELETON (Fase 0) — shape only; o contrato de emissão vem na Fase 5.
 */
export interface NotaDebitoEletronica {
    id: string;
    recebimentoId: string;
    /** Invariante multi-filial — nunca `null`. */
    filCod: number;
    correlationId: string;
    /** Número atribuído pelo Conexos — `null` até emitir. */
    numeroNde?: string;
    valor: number;
    moeda: string;
    statusEmissao: NdeStatusEmissao;
    /** UNIQUE — garante uma NDe por `Recebimento`. */
    idempotencyKey: string;
    erpResponse?: unknown;
    emitidaEm?: Date;
    emitidaPor?: string;
}

/** Boundary validation (Zod at boundaries). */
export const notaDebitoEletronicaSchema = z.object({
    id: z.string().min(1),
    recebimentoId: z.string().min(1),
    filCod: z.number().int().positive(),
    correlationId: z.string().min(1),
    numeroNde: z.string().optional(),
    valor: z.number(),
    moeda: z.string().min(1),
    statusEmissao: z.enum([
        NDE_STATUS_EMISSAO.PENDENTE,
        NDE_STATUS_EMISSAO.EMITIDA,
        NDE_STATUS_EMISSAO.ERRO,
    ]),
    idempotencyKey: z.string().min(1),
    erpResponse: z.unknown(),
    emitidaEm: z.date().optional(),
    emitidaPor: z.string().optional(),
});
