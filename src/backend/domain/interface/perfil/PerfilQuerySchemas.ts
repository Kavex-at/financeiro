import { z } from 'zod';
import {
    ACOES_ATIVIDADE,
    FRENTES_ATIVIDADE,
    STATUS_ATIVIDADE_VALORES,
    TIPOS_PERIODO,
    TIPO_PERIODO,
} from './AtividadeUsuarioInterface.js';

/** Data local de São Paulo, só o dia. Fuso explícito é recusado: o período é hora local. */
const DIA_LOCAL = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Queries das rotas do perfil (ADR-0058). TODAS `.strict()`: parâmetro desconhecido — `userId`,
 * `username`, qualquer outro — é recusado com 400, não ignorado (I1). Valor repetido
 * (`?frente=a&frente=b`) chega como array e também é recusado.
 */
export const perfilQuerySchema = z.object({}).strict();

export const atividadeQuerySchema = z
    .object({
        periodo: z.enum(TIPOS_PERIODO).default(TIPO_PERIODO.SEMANA),
        inicio: DIA_LOCAL.optional(),
        fim: DIA_LOCAL.optional(),
    })
    .strict()
    .refine((q) => q.periodo !== TIPO_PERIODO.PERSONALIZADO || (q.inicio && q.fim), {
        message: 'periodo=personalizado exige inicio e fim (AAAA-MM-DD)',
        path: ['inicio'],
    });

export const historicoQuerySchema = z
    .object({
        cursor: z.string().min(1).max(512).optional(),
        frente: z.enum(FRENTES_ATIVIDADE).optional(),
        tipo: z.enum(ACOES_ATIVIDADE).optional(),
        status: z.enum(STATUS_ATIVIDADE_VALORES).optional(),
        inicio: DIA_LOCAL.optional(),
        fim: DIA_LOCAL.optional(),
    })
    .strict();

export type AtividadeQuery = z.infer<typeof atividadeQuerySchema>;
export type HistoricoQuery = z.infer<typeof historicoQuerySchema>;
