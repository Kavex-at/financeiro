import { z } from 'zod';
import { REGRA_TIPO } from './constants.js';
import type { RegraTipo } from './constants.js';

/**
 * RegraRecebimento (regra de conciliação configurável e versionada — Frente IV, Módulo 4).
 *
 * Estrutura no domínio; valores (percentuais, contas, critérios) são config do cliente. Cada regra
 * aplicada carrega um rationale registrado. Ver `ontology/entities/regra-recebimento.md`.
 *
 * SKELETON (Fase 0) — só a forma; toda a semântica das 3 regras vem na Fase 4.
 */
export interface RegraRecebimento {
    id: string;
    tipo: RegraTipo;
    versao: number;
    vigenteDe: Date;
    vigenteAte?: Date;
    /** Valores configuráveis (percentuais, contas, critérios) — config do cliente. */
    parametros: Record<string, unknown>;
    /** Texto explicável do que a regra faz (base do rationale). */
    explicacao: string;
    ativo: boolean;
}

/** Boundary validation (Zod at boundaries). */
export const regraRecebimentoSchema = z.object({
    id: z.string().min(1),
    tipo: z.enum([REGRA_TIPO.ENCOMENDA, REGRA_TIPO.ADIANTAMENTO_CLIENTE, REGRA_TIPO.MULTA_JUROS]),
    versao: z.number().int().nonnegative(),
    vigenteDe: z.date(),
    vigenteAte: z.date().optional(),
    parametros: z.record(z.string(), z.unknown()),
    explicacao: z.string().min(1),
    ativo: z.boolean(),
});
