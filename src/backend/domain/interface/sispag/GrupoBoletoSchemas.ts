import { z } from 'zod';
import { GRUPO_BOLETO_ORIGEM } from './GrupoBoletoInterface.js';

/**
 * Zod do boundary HTTP do boleto agrupado (ADR-0077, Task 19). Bodies `strict`: campo desconhecido
 * (inclusive um "ator" ou "usuario") é 400 — a identidade vem SEMPRE do token.
 */

const texto = z.string().trim().min(1);

/** Um título do grupo: chave natural (filial, documento, título). */
const ChaveTituloGrupoSchema = z
    .object({
        filCod: z.number().int().positive(),
        docCod: texto.max(64),
        titCod: texto.max(64),
    })
    .strict();

/**
 * Confirmar um grupo: o boleto do pool (`fin124`: arquivo + item) e os N ≥ 2 títulos. Os avisos que
 * a pessoa reconheceu na tela seguem como TEXTO: o servidor os confere contra a avaliação
 * recalculada e nunca confia no cliente (I21g).
 */
export const ConfirmarGrupoBodySchema = z
    .object({
        origem: z.nativeEnum(GRUPO_BOLETO_ORIGEM),
        ddcCod: z.number().int().positive(),
        ditCod: z.number().int().min(0),
        titulos: z.array(ChaveTituloGrupoSchema).min(2).max(50),
        reconheceAvisos: z.array(texto.max(64)).max(10).default([]),
    })
    .strict();

export const GrupoBoletoIdSchema = z.object({ id: z.guid() });

/** O motivo da anulação é explicado: 10 a 500 caracteres (I21t). */
export const AnularGrupoBodySchema = z
    .object({ motivo: z.string().trim().min(10).max(500) })
    .strict();

export const GruposQuerySchema = z.object({
    filCod: z.coerce.number().int().positive().optional(),
});

export const LoteIdSchema = z.object({ id: z.guid() });

/** Incluir o grupo inteiro num lote RASCUNHO (`mover` o tira do outro rascunho em que está). */
export const IncluirGrupoNoLoteBodySchema = z
    .object({
        grupoId: z.guid(),
        mover: z.boolean().optional(),
        versaoEsperada: z.number().int().min(1).optional(),
    })
    .strict();

export const LoteGrupoParamsSchema = z.object({
    id: z.guid(),
    grupoId: z.guid(),
});

export const RetirarGrupoQuerySchema = z.object({
    versaoEsperada: z.coerce.number().int().min(1).optional(),
});
