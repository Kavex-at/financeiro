import { z } from 'zod';
import { ESTADO_CONFIRMACAO_EMISSOR, RECONHECIMENTO_TIPO } from './ConfirmacaoEmissorBoleto.js';
import {
    RESULTADO_SUGESTAO,
    SINAL_SUGESTAO,
    SITUACAO_SUGESTAO_TITULO,
    SUGESTAO_TAMANHO_MAXIMO,
    SUGESTAO_TAMANHO_PADRAO,
} from './SugestaoBoleto.js';

/**
 * Zod do boundary HTTP da sugestão de boleto (ADR-0068, I15). Bodies `strict`: campo desconhecido
 * (inclusive um "ator" ou "usuario") é 400 — a identidade vem SEMPRE do token (I15g).
 */

const texto = z.string().trim().min(1);

/** Chave do título (filial, documento, título) + a do boleto do pool `fin124` (arquivo, item). */
export const ChaveSugestaoBodySchema = z
    .object({
        filCod: z.number().int().positive(),
        docCod: texto.max(64),
        titCod: texto.max(64),
        ddcCod: z.number().int().positive(),
        ditCod: z.number().int().min(0),
    })
    .strict();

/**
 * Avisos que o analista pode reconhecer ao confirmar (I15o). Hoje só `VENCE_ANTES_DO_TITULO`; o
 * servidor confere o reconhecimento contra a avaliação recalculada, nunca confia no cliente.
 */
export const AVISOS_RECONHECIVEIS = [SINAL_SUGESTAO.VENCE_ANTES_DO_TITULO] as const;

/**
 * Reconhecimento TIPADO da divergência de data (I15r, ADR-0078). `.strict()`: qualquer campo extra —
 * inclusive `reconhecidoPor`/`reconhecidoEm` — é 400 (o autor vem do JWT, nunca do corpo).
 * `deltaDiasVisto` e `valorBoletoVisto` (centavos) são conferidos no servidor contra a avaliação ao
 * vivo (anti-TOCTOU); o checkbox `aceito` só existe como `true`.
 */
export const ReconhecimentoDivergenciaSchema = z
    .object({
        tipo: z.literal(RECONHECIMENTO_TIPO.DATA_DIVERGENTE),
        aceito: z.literal(true),
        motivo: z.string().trim().min(10).max(500),
        deltaDiasVisto: z.number().int(),
        valorBoletoVisto: z.number().int().min(0),
    })
    .strict();
export type ReconhecimentoDivergenciaBody = z.infer<typeof ReconhecimentoDivergenciaSchema>;

/**
 * Body de confirmar: a chave + os avisos reconhecidos. `reconheceAvisos` só existe aqui — rejeitar
 * e copiar-linha continuam `strict` sem o campo. "ator" e qualquer outro campo continuam 400.
 */
export const ConfirmarSugestaoBodySchema = ChaveSugestaoBodySchema.extend({
    reconheceAvisos: z
        .array(z.enum(AVISOS_RECONHECIVEIS))
        .max(AVISOS_RECONHECIVEIS.length)
        .default([]),
    /** Obrigatório quando o candidato tem `exigeReconhecimento = DATA_DIVERGENTE` (I15r). */
    reconhecimento: ReconhecimentoDivergenciaSchema.optional(),
}).strict();

/** Chave de um título (sem boleto): detalhe de candidatos por título. */
export const TituloSugestaoQuerySchema = z.object({
    filCod: z.coerce.number().int().positive(),
    docCod: texto.max(64),
    titCod: texto.max(64),
});

/** `motivo` ausente é 400; em branco chega ao serviço, que responde 422 nomeado. */
export const RejeitarSugestaoBodySchema = ChaveSugestaoBodySchema.extend({
    motivo: z.string().max(500),
}).strict();

/**
 * Anular a confirmação de UM título (I15l): a decisão é identificada pelo título; o motivo tem de
 * ser explicado (10 a 500 caracteres). O ator vem do token.
 */
export const AnularDecisaoBodySchema = z
    .object({
        filCod: z.number().int().positive(),
        docCod: texto.max(64),
        titCod: texto.max(64),
        motivo: z.string().trim().min(10).max(500),
    })
    .strict();

export const RevogarConfirmacaoBodySchema = z.object({ motivo: z.string().max(500) }).strict();

export const ConfirmacaoEmissorIdSchema = z.object({ id: z.guid() });

export const SugestoesQuerySchema = z.object({
    filCod: z.coerce.number().int().positive().optional(),
    pesCod: texto.optional(),
    tier: z.nativeEnum(RESULTADO_SUGESTAO).optional(),
    situacao: z.nativeEnum(SITUACAO_SUGESTAO_TITULO).optional(),
    pagina: z.coerce.number().int().min(1).default(1),
    tamanho: z.coerce
        .number()
        .int()
        .min(1)
        .max(SUGESTAO_TAMANHO_MAXIMO)
        .default(SUGESTAO_TAMANHO_PADRAO),
});

export const ConfirmacoesEmissorQuerySchema = z.object({
    estado: z
        .enum([ESTADO_CONFIRMACAO_EMISSOR.VIGENTE, ESTADO_CONFIRMACAO_EMISSOR.REVOGADA])
        .optional(),
    pesCod: texto.optional(),
});
