import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import {
    MATCH_CLASSIFICACAO,
    RECEBIMENTO_STATUS,
} from '../domain/interface/recebimentos/constants.js';
import type { Recebimento } from '../domain/interface/recebimentos/Recebimento.js';
import type { TransacaoBancaria } from '../domain/interface/recebimentos/TransacaoBancaria.js';
import { TRANSACAO_TIPO } from '../domain/interface/recebimentos/constants.js';
import RecebimentoPipelineService from '../domain/service/recebimentos/RecebimentoPipelineService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireRole } from '../http/auth.js';
import { FilialForbiddenError, assertUserCanActOnFilial } from '../http/filialAuthz.js';
import { heavyRouteLimiter } from '../http/rateLimit.js';

/**
 * Rotas Frente IV (Recebimentos) — SKELETON (base scaffold). Superfície fina: read (painel) + trigger
 * (pipeline run) que delega ao `RecebimentoPipelineService` (coordinator stubbed). NENHUMA lógica de
 * negócio na rota — Zod valida no boundary, o service coordena. Montada atrás do `recebimentosGate`
 * (403 quando desabilitado). Espelha `routes/sispag.ts`.
 */
const router = Router();

// GET /recebimentos/painel — painel read-only (echo/empty no scaffold; reads reais nas fases).
router.get(
    '/painel',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        res.json({ geradoEm: new Date().toISOString(), recebimentos: [], kpis: {} });
    }),
);

const runPipelineSchema = z.object({
    // UUID guard (Regis security-2): impede um ator envenenar uma chave `receb:X` sequencial/curta de
    // outro ator. A idempotency-key é namespaced pelo `sub` do usuário abaixo.
    correlationId: z.string().uuid(),
    filCod: z.coerce.number().int().positive(),
    valorRecebido: z.number(),
    dryRun: z.boolean().optional(),
    borVldTipo: z.coerce.number().int().positive(),
    contaDestino: z.string().min(1),
});

// POST /recebimentos/pipeline/run — dispara o coordinator stubbed. `Idempotency-Key` honrado
// downstream pelo ledger (recebimento_execucao). Write-ish → requireRole('admin') + heavyRouteLimiter.
router.post(
    '/pipeline/run',
    heavyRouteLimiter,
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = runPipelineSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'Payload inválido', details: parsed.error.flatten() });
            return;
        }
        // Authz por-filial (Regis security-1): valida o `filCod` do body contra a filial-permitida do
        // usuário ANTES de agir (borderô/baixa/NDe). Sem isso, `requireRole('admin')` sozinho deixa um
        // analista mover dinheiro de outra filial só mudando o número.
        try {
            assertUserCanActOnFilial(req.user, parsed.data.filCod);
        } catch (err) {
            if (err instanceof FilialForbiddenError) {
                res.status(403).json({
                    error: 'Forbidden: filial não autorizada',
                    code: err.code,
                });
                return;
            }
            throw err;
        }
        const ator = req.user?.sub ?? req.user?.email ?? 'unknown';
        // Idempotency-key namespaced pelo ator (Regis security-2): a colisão exige colisão de `sub`
        // também — impede denial-of-execution / carona no ledger money-moving de outro ator. Um
        // `Idempotency-Key` de header explícito também é namespaced pelo sub.
        const headerKey = req.header('Idempotency-Key');
        const idempotencyKey = `receb:${ator}:${headerKey ?? parsed.data.correlationId}`;
        const now = new Date();

        const transacao: TransacaoBancaria = {
            id: idempotencyKey,
            correlationId: parsed.data.correlationId,
            filCod: parsed.data.filCod,
            dataMovimento: now,
            tipo: TRANSACAO_TIPO.CREDITO,
            valor: parsed.data.valorRecebido,
            moeda: 'BRL',
            naturalKey: idempotencyKey,
            rawPayload: null,
            normalized: null,
            status: 'importada',
            importadoEm: now,
        };
        const recebimento: Recebimento = {
            id: idempotencyKey,
            correlationId: parsed.data.correlationId,
            transacaoBancariaId: transacao.id,
            filCod: parsed.data.filCod,
            classificacaoMatch: MATCH_CLASSIFICACAO.NENHUMA,
            status: RECEBIMENTO_STATUS.RASCUNHO,
            valorRecebido: parsed.data.valorRecebido,
            valorAlocado: 0,
            diferencaNaoAlocada: parsed.data.valorRecebido,
            regrasAplicadas: [],
            rateios: [],
            versao: 0,
            criadoPor: ator,
            criadoEm: now,
        };

        const service = container.resolve(RecebimentoPipelineService);
        const result = await service.run({
            recebimento,
            transacao,
            documentosAbertos: [],
            ingestao: {
                filCod: parsed.data.filCod,
                periodo: { de: now, ate: now },
                correlationId: parsed.data.correlationId,
                triggeredBy: ator,
            },
            borVldTipo: parsed.data.borVldTipo,
            contaDestino: parsed.data.contaDestino,
            dryRun: parsed.data.dryRun ?? true,
            ator,
        });
        res.json({ recebimento: result });
    }),
);

export default router;
