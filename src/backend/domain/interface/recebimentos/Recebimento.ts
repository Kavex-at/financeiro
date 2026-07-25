import { z } from 'zod';
import { MATCH_CLASSIFICACAO, RECEBIMENTO_STATUS } from './constants.js';
import type { MatchClassificacao, RecebimentoStatus } from './constants.js';
import { rateioRecebimentoSchema } from './RateioRecebimento.js';
import type { RateioRecebimento } from './RateioRecebimento.js';
import { regraRecebimentoSchema } from './RegraRecebimento.js';
import type { RegraRecebimento } from './RegraRecebimento.js';

/**
 * Recebimento (agregado de conciliação — Frente IV) — a SPINE do pipeline.
 *
 * Liga um crédito (`TransacaoBancaria`) a `DocumentoAReceber`, carrega a classificação do match, o
 * rateio (`RateioRecebimento`), as regras aplicadas (`RegraRecebimento`) e o resultado da execução.
 * Espelho inbound do `LotePagamento`. Ciclo: rascunho → aprovado → executado → estornado. Ver
 * `ontology/entities/recebimento.md` e `state-machines/recebimento.md`.
 *
 * SKELETON (Fase 0) — shape only; motores (match/rateio/regras/execução) nas Fases 2–5.
 */
export interface Recebimento {
    id: string;
    correlationId: string;
    transacaoBancariaId: string;
    /** Invariante multi-filial — nunca `null`. */
    filCod: number;
    classificacaoMatch: MatchClassificacao;
    status: RecebimentoStatus;
    /** Valor do crédito (teto do rateio). */
    valorRecebido: number;
    /** Derivado (Σ rateios) — invariante `≤ valorRecebido`. */
    valorAlocado: number;
    /** Derivado — `valorRecebido − valorAlocado`; registrado explicitamente. */
    diferencaNaoAlocada: number;
    /** As regras versionadas aplicadas + rationale (Fase 4). */
    regrasAplicadas: RegraRecebimento[];
    /** As parcelas de alocação (agregado). */
    rateios: RateioRecebimento[];
    /** Confirmação do ERP (borderô/quitação) + NDe — `null` enquanto não executado. */
    resultadoExecucao?: unknown;
    /** A NDe emitida na execução (quando aplicável) — `null` até executar. */
    ndeId?: string;
    /** Controle otimista de concorrência (espelha o I6 do lote). */
    versao: number;
    criadoPor: string;
    aprovadoPor?: string;
    executadoPor?: string;
    estornadoPor?: string;
    criadoEm: Date;
}

/** Boundary validation (Zod at boundaries) — the aggregate root. */
export const recebimentoSchema = z.object({
    id: z.string().min(1),
    correlationId: z.string().min(1),
    transacaoBancariaId: z.string().min(1),
    filCod: z.number().int().positive(),
    classificacaoMatch: z.enum([
        MATCH_CLASSIFICACAO.UNICA,
        MATCH_CLASSIFICACAO.MULTIPLAS,
        MATCH_CLASSIFICACAO.PARCIAL,
        MATCH_CLASSIFICACAO.NENHUMA,
    ]),
    status: z.enum([
        RECEBIMENTO_STATUS.RASCUNHO,
        RECEBIMENTO_STATUS.APROVADO,
        RECEBIMENTO_STATUS.EXECUTADO,
        RECEBIMENTO_STATUS.ESTORNADO,
    ]),
    valorRecebido: z.number(),
    valorAlocado: z.number(),
    diferencaNaoAlocada: z.number(),
    regrasAplicadas: z.array(regraRecebimentoSchema),
    rateios: z.array(rateioRecebimentoSchema),
    resultadoExecucao: z.unknown(),
    ndeId: z.string().optional(),
    versao: z.number().int().nonnegative(),
    criadoPor: z.string().min(1),
    aprovadoPor: z.string().optional(),
    executadoPor: z.string().optional(),
    estornadoPor: z.string().optional(),
    criadoEm: z.date(),
});
