import { z } from 'zod';

/**
 * Zod schemas for Express route inputs (arch-review card security-4 /
 * F-security-6). Every Express handler validates `req.params` / `req.query` /
 * `req.body` against one of these before touching a service or client.
 *
 * The skeleton ships one generic example (`PaginationQuerySchema`). Domain
 * feature routers (financeiro) add their own schemas alongside it.
 */

/** Generic list/pagination query string (`?search=&page=`). */
export const PaginationQuerySchema = z.object({
    search: z.string().trim().min(1).max(200).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// ===================================================== SISPAG — favorecido autorizado (ADR-0065)
// O ator NUNCA vem do body: o Zod descarta campo desconhecido, então um "ator" no body é ignorado.

/** `POST /sispag/favorecidos-autorizados` — pedir (F1) ou confirmar a reaprovação (F5). */
export const SolicitarAutorizacaoSchema = z.object({
    pesCod: z.string().trim().min(1).max(40),
    credor: z.string().trim().min(1).max(200).optional(),
    modalidade: z.enum(['TED', 'PIX']),
    origem: z.enum(['ITEM', 'RELATORIO', 'MANUAL']),
    /** Filial usada para LER o cadastro (o cmn025 é global). */
    filCod: z.coerce.number().int().positive(),
});

/** `POST /sispag/favorecidos-autorizados/:id/aprovar` — a impressão que a tela mostrou (I14c). */
export const AprovarAutorizacaoSchema = z.object({
    versao: z.coerce.number().int().min(1),
    fingerprintMostrado: z.string().regex(/^[0-9a-f]{64}$/),
});

/** `POST /:id/rejeitar` e `/:id/revogar` — motivo obrigatório (F3/F7). */
export const DecidirAutorizacaoSchema = z.object({
    versao: z.coerce.number().int().min(1),
    motivo: z.string().trim().min(1).max(2000),
});

export const AutorizacaoIdSchema = z.object({ id: z.string().uuid() });

export const FiltroAutorizacoesSchema = z.object({
    estado: z
        .enum(['PENDENTE', 'AUTORIZADO', 'REJEITADO', 'REAPROVACAO_PENDENTE', 'REVOGADO'])
        .optional(),
    pesCod: z.string().trim().min(1).max(40).optional(),
});

/** `GET /sispag/favorecidos-autorizados/candidatos` — paginado: o cmn025 é lido só da página, em série (teto de sessões do Conexos), por isso a página é pequena (até 25: ~50 leituras). */
export const CandidatosQuerySchema = z.object({
    pagina: z.coerce.number().int().min(1).max(1000).default(1),
    limite: z.coerce.number().int().min(1).max(25).default(20),
});
