import { z } from 'zod';
import { TRANSACAO_BANCARIA_STATUS, TRANSACAO_TIPO } from './constants.js';
import type { TransacaoBancariaStatus, TransacaoTipo } from './constants.js';

/**
 * TransacaoBancaria (movimento bancário importado — Frente IV, Módulo 1).
 *
 * Espelho inbound do `TituloAPagar` do SISPAG. Guarda o payload cru (`rawPayload`) + a forma
 * normalizada interna (`normalized`), carrega um `correlationId` desde o nascimento e é deduplicado
 * por `naturalKey`. Ver `ontology/entities/transacao-bancaria.md`.
 *
 * SKELETON (Fase 0) — shape only; o wire real vem na Fase 1 (spike O7).
 */
export interface TransacaoBancaria {
    id: string;
    /** Nasce aqui — rastreia Nexxera → baixa → quitação → NDe (Módulo 6). */
    correlationId: string;
    /** Invariante multi-filial — nunca `null`. */
    filCod: number;
    dataMovimento: Date;
    tipo: TransacaoTipo;
    valor: number;
    moeda: string;
    /** Quem pagou (insumo do matching por cliente/CNPJ). */
    contraparte?: string;
    referenciaBancaria?: string;
    /** Chave natural de deduplicação (fórmula exata na Fase 1). */
    naturalKey: string;
    /** Payload cru original do Nexxera (auditoria + reprocessamento). */
    rawPayload: unknown;
    /** Forma normalizada interna (channel-agnostic — O7). */
    normalized: unknown;
    status: TransacaoBancariaStatus;
    importRunId?: string;
    importadoEm: Date;
    /**
     * Conta financeira de origem (`gerNum` do `fin133`). É a **"Conta Financeira de
     * Baixa"** que o `fin014` exige ao registrar a quitação (Fase 5) — por isso é
     * coluna própria e não um campo dentro de `normalized`.
     */
    gerNum?: number;
    /**
     * Categoria do lançamento no extrato (`exiEspCategoria` do `fin095`).
     * Discriminador do RUÍDO DE TESOURARIA: em produção, ~15% dos créditos são
     * RESGATE DE APLICAÇÃO / AÇÕES / TRANSFERÊNCIA ENTRE CONTAS, que não são
     * recebimento de cliente. O painel filtra por aqui; a ingestão não descarta.
     */
    categoria?: string;
    categoriaDesc?: string;
}

/** Boundary validation (Zod at boundaries) — one schema per entity. */
export const transacaoBancariaSchema = z.object({
    id: z.string().min(1),
    correlationId: z.string().min(1),
    filCod: z.number().int().positive(),
    dataMovimento: z.date(),
    tipo: z.enum([
        TRANSACAO_TIPO.CREDITO,
        TRANSACAO_TIPO.DEBITO,
        TRANSACAO_TIPO.ESTORNO,
        TRANSACAO_TIPO.TARIFA,
        TRANSACAO_TIPO.JUROS,
    ]),
    valor: z.number(),
    moeda: z.string().min(1),
    contraparte: z.string().optional(),
    referenciaBancaria: z.string().optional(),
    naturalKey: z.string().min(1),
    rawPayload: z.unknown(),
    normalized: z.unknown(),
    status: z.enum([
        TRANSACAO_BANCARIA_STATUS.IMPORTADA,
        TRANSACAO_BANCARIA_STATUS.CONCILIADA,
        TRANSACAO_BANCARIA_STATUS.PARCIAL,
        TRANSACAO_BANCARIA_STATUS.MANUAL,
        TRANSACAO_BANCARIA_STATUS.ERRO,
    ]),
    importRunId: z.string().optional(),
    importadoEm: z.date(),
    gerNum: z.number().int().positive().optional(),
    categoria: z.string().optional(),
    categoriaDesc: z.string().optional(),
});
