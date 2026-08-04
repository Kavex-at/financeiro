import { z } from 'zod';

/**
 * DocumentoAReceber (recebível em aberto — read-model Frente IV).
 *
 * Read-through do Conexos (NÃO tem tabela local) — o alvo da baixa de um `Recebimento`. Espelho
 * inbound do `TituloAPagar`. Ver `ontology/entities/documento-a-receber.md`.
 *
 * SKELETON (Fase 0) — shape only; a fonte exata no ERP vem na Fase 2.
 */
export interface DocumentoAReceber {
    docCod: string;
    titCod: string;
    /** Invariante multi-filial — nunca `null`. */
    filCod: number;
    cliente?: string;
    pesCod?: string;
    valor?: number;
    /** Saldo em aberto — base do rateio + anti-super-baixa. */
    valorAberto?: number;
    moeda?: string;
    vencimento?: Date;
    numDocumento?: string;
    /** Nº do processo de importação (chave de matching cross-referência). */
    priCod?: string;
    /** Anti-fantasma: recebível fora da leitura mais recente → `false`. */
    ativo: boolean;
}

/** Boundary validation (Zod at boundaries). */
export const documentoAReceberSchema = z.object({
    docCod: z.string().min(1),
    titCod: z.string().min(1),
    filCod: z.number().int().positive(),
    cliente: z.string().optional(),
    pesCod: z.string().optional(),
    valor: z.number().optional(),
    valorAberto: z.number().optional(),
    moeda: z.string().optional(),
    vencimento: z.date().optional(),
    numDocumento: z.string().optional(),
    priCod: z.string().optional(),
    ativo: z.boolean(),
});
