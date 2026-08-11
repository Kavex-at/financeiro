import 'reflect-metadata';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { isHandlerError } from '../domain/libs/handler/HandlerError.js';
import PagamentoIngestaoRunRepository from '../domain/repository/sispag/PagamentoIngestaoRunRepository.js';
import FormacaoLotesService from '../domain/service/sispag/FormacaoLotesService.js';
import IngestaoPagamentosService from '../domain/service/sispag/IngestaoPagamentosService.js';
import LotePagamentoService from '../domain/service/sispag/LotePagamentoService.js';
import SispagPainelService from '../domain/service/sispag/SispagPainelService.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { auditActor, requireRole } from '../http/auth.js';
import { heavyRouteLimiter } from '../http/rateLimit.js';

/**
 * Rotas SISPAG (Escopo II) — SPIKE READ-ONLY (semente da Fatia 1).
 *
 * Só leitura: monta o painel de pagamentos (títulos a pagar, lotes SISPAG
 * nativos, borderôs) a partir do Conexos. NENHUMA rota de escrita/execução —
 * o fluxo (montar/finalizar/enviar/baixar) é SIMULADO no frontend. Quando a
 * Fatia 3 chegar, a escrita entra gated (`CONEXOS_WRITE_ENABLED`), como em
 * Permutas. Ver `ontology/_inbox/sispag-*.md`.
 */
const router = Router();

// GET /sispag/painel — painel diário read-only (dados ao vivo do Conexos).
router.get(
    '/painel',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const painel = await service.montarPainel();
        res.json(painel);
    }),
);

// GET /sispag/retornos — arquivos de retorno (.RET) do fin052, ao vivo. READ-ONLY.
router.get(
    '/retornos',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const arquivos = await service.listRetornos();
        res.json({ arquivos });
    }),
);

// GET /sispag/lotes/:id/modalidades-disponiveis — formas de pgto. do favorecido por título
// (A2 opção B), lidas ao vivo do Conexos. READ-ONLY.
router.get(
    '/lotes/:id/modalidades-disponiveis',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(SispagPainelService);
        const itens = await service.modalidadesDisponiveisDoLote(String(req.params.id));
        res.json({ itens });
    }),
);

// ===================================================== Fatia 2 — Lotes candidatos
// Montagem assistida + gate. Estado LOCAL — NENHUMA escrita no Conexos (I1).

/** Mapeia um erro de domínio (HandlerError) para a resposta HTTP; senão devolve false. */
const respondLoteError = (req: Request, res: Response, err: unknown): boolean => {
    if (!isHandlerError(err)) return false;
    res.status(err.statusCode).json({
        error: err.userMessage,
        code: err.code,
        retryable: err.retryable,
        ...(err.details !== undefined ? { details: err.details } : {}),
        ...(req.header('x-request-id') ? { requestId: req.header('x-request-id') } : {}),
    });
    return true;
};

const criarLoteSchema = z.object({
    filCod: z.coerce.number().int().positive(),
    banco: z.string().trim().min(1).optional(),
    conta: z.string().trim().min(1).optional(),
});
const listLotesSchema = z.object({
    status: z.enum(['RASCUNHO', 'FINALIZADO', 'CANCELADO']).optional(),
    filCod: z.coerce.number().int().positive().optional(),
});
const incluirTituloSchema = z.object({
    filCod: z.coerce.number().int().positive(),
    docCod: z.string().trim().min(1),
    titCod: z.string().trim().min(1),
});
const versaoSchema = z.object({ versao: z.coerce.number().int().min(1) });
const contaPagadoraSchema = z.object({
    versao: z.coerce.number().int().min(1),
    banco: z.string().trim().min(1),
    conta: z.string().trim().min(1),
});
const modalidadeSchema = z.object({
    versao: z.coerce.number().int().min(1),
    modalidade: z.enum(['BOLETO', 'TED', 'PIX', 'CREDITO_CONTA']),
});

// GET /sispag/lotes — lista lotes candidatos (?status=&filCod=). Leitura.
router.get(
    '/lotes',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = listLotesSchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid query', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        res.json({ lotes: await service.listarLotes(parsed.data) });
    }),
);

// GET /sispag/lotes/:id — um lote com itens.
router.get(
    '/lotes/:id',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(LotePagamentoService);
        const lote = await service.getLote(String(req.params.id));
        if (!lote) {
            res.status(404).json({ error: 'lote not found' });
            return;
        }
        res.json({ lote });
    }),
);

// POST /sispag/lotes — cria um lote candidato (RASCUNHO). admin.
router.post(
    '/lotes',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = criarLoteSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        const lote = await service.criarLote({ ...parsed.data, ator: auditActor(req) });
        res.status(201).json({ lote });
    }),
);

// POST /sispag/lotes/:id/itens — inclui um título no lote. admin.
router.post(
    '/lotes/:id/itens',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = incluirTituloSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid body', details: parsed.error.flatten() });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.incluirTitulo({
                loteId: String(req.params.id),
                ...parsed.data,
                ator: auditActor(req),
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// DELETE /sispag/lotes/:id/itens/:filCod/:docCod/:titCod — remove um título. admin.
router.delete(
    '/lotes/:id/itens/:filCod/:docCod/:titCod',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const filCod = Number(req.params.filCod);
        if (!Number.isInteger(filCod) || filCod <= 0) {
            res.status(400).json({ error: 'invalid filCod' });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.removerTitulo({
                loteId: String(req.params.id),
                filCod,
                docCod: String(req.params.docCod),
                titCod: String(req.params.titCod),
                ator: auditActor(req),
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/:id/{finalizar|reabrir|cancelar} — transições (gate). admin.
for (const acao of ['finalizar', 'reabrir', 'cancelar', 'retorno'] as const) {
    router.post(
        `/lotes/:id/${acao}`,
        requireRole('admin'),
        asyncHandler(async (req, res) => {
            await bootstrapAppContainer();
            const parsed = versaoSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({
                    error: 'invalid body (versao)',
                    details: parsed.error.flatten(),
                });
                return;
            }
            const service = container.resolve(LotePagamentoService);
            const input = {
                loteId: String(req.params.id),
                versao: parsed.data.versao,
                ator: auditActor(req),
            };
            try {
                const lote =
                    acao === 'finalizar'
                        ? await service.finalizarLote(input)
                        : acao === 'reabrir'
                          ? await service.reabrirLote(input)
                          : acao === 'retorno'
                            ? await service.marcarRetorno(input)
                            : await service.cancelarLote(input);
                res.json({ lote });
            } catch (err) {
                if (!respondLoteError(req, res, err)) throw err;
            }
        }),
    );
}

// POST /sispag/lotes/:id/itens/:filCod/:docCod/:titCod/modalidade — define a forma de
// pagamento de um item (A2, só RASCUNHO; optimistic lock). admin.
router.post(
    '/lotes/:id/itens/:filCod/:docCod/:titCod/modalidade',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const filCod = Number(req.params.filCod);
        if (!Number.isInteger(filCod) || filCod <= 0) {
            res.status(400).json({ error: 'invalid filCod' });
            return;
        }
        const parsed = modalidadeSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'invalid body (versao, modalidade)',
                details: parsed.error.flatten(),
            });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.atualizarModalidadeItem({
                loteId: String(req.params.id),
                filCod,
                docCod: String(req.params.docCod),
                titCod: String(req.params.titCod),
                modalidade: parsed.data.modalidade,
                versao: parsed.data.versao,
                ator: auditActor(req),
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/:id/conta — troca a conta pagadora do lote (A3, só RASCUNHO). admin.
router.post(
    '/lotes/:id/conta',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = contaPagadoraSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({
                error: 'invalid body (versao, banco, conta)',
                details: parsed.error.flatten(),
            });
            return;
        }
        const service = container.resolve(LotePagamentoService);
        try {
            const lote = await service.atualizarContaPagadora({
                loteId: String(req.params.id),
                versao: parsed.data.versao,
                banco: parsed.data.banco,
                conta: parsed.data.conta,
                ator: auditActor(req),
            });
            res.json({ lote });
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// ===================================================== Ingestão de Pagamentos
// Cadência da carteira (cron + manual). Só LEITURA do ERP; escreve só no Postgres.

// POST /sispag/ingestao — dispara a ingestão manual (grava run + idempotência).
// Honra o header `Idempotency-Key`; `IngestLockBusyError` → 409 (já rodando).
router.post(
    '/ingestao',
    requireRole('admin'),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(IngestaoPagamentosService);
        const idempotencyKey = req.header('Idempotency-Key') ?? undefined;
        try {
            const result = await service.executar({ triggeredBy: auditActor(req), idempotencyKey });
            res.json(result);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// POST /sispag/lotes/formar — forma lotes candidatos automaticamente (cron/manual).
// Mesmas regras da montagem (I4, só a vencer ≤7d). `IngestLockBusyError` → 409.
router.post(
    '/lotes/formar',
    requireRole('admin'),
    heavyRouteLimiter,
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const service = container.resolve(FormacaoLotesService);
        try {
            const result = await service.formar({ triggeredBy: auditActor(req) });
            res.json(result);
        } catch (err) {
            if (!respondLoteError(req, res, err)) throw err;
        }
    }),
);

// GET /sispag/ingestao/runs — trilha de auditoria das ingestões (?limit=).
router.get(
    '/ingestao/runs',
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const limit = Math.min(Number(req.query.limit) || 10, 50);
        const repo = container.resolve(PagamentoIngestaoRunRepository);
        res.json({ runs: await repo.listRecentRuns(limit) });
    }),
);

export default router;
