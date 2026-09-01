import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import AlertaRepository from '../domain/repository/operacao/AlertaRepository.js';
import ConfigDoctor from '../domain/service/operacao/ConfigDoctor.js';
import JobRunReadModel from '../domain/service/operacao/JobRunReadModel.js';
import { asyncHandler } from '../http/asyncHandler.js';
import { requireRole } from '../http/auth.js';
import { requireOperacaoAcesso } from '../http/operacaoAcesso.js';

/** Quantos alertas abertos a tela lista. */
const ALERTAS_LIMIT = 50;

/** Zod no boundary — `:id` do reconhecimento. */
const reconhecerParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Painel de Operação (ADR-0042) — saúde dos pipelines, alertas abertos e diagnóstico de
 * configuração.
 *
 * **Invariante I4 — esta rota NÃO toca o Conexos.** É a tela que se abre justamente quando o ERP
 * está fora; se ela dependesse dele, falharia exatamente no momento em que é necessária. Tudo vem
 * do Postgres (`JobRunReadModel`, `AlertaRepository`) e do ambiente do processo (`ConfigDoctor`).
 * Isto a distingue do painel de Recebimentos, que legitimamente enriquece contra o ERP (ADR-0038):
 * lá o ERP acrescenta informação a uma tela já útil sem ele; aqui o ERP não tem nada a dizer.
 */
const router = Router();

// GET /operacao — a leitura completa do painel.
router.get(
    '/',
    requireRole('admin'),
    requireOperacaoAcesso(),
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();

        const [pipelines, alertas] = await Promise.all([
            container.resolve(JobRunReadModel).exporSaude(),
            container.resolve(AlertaRepository).listarAbertos(ALERTAS_LIMIT),
        ]);
        // Síncrono e barato: lê o manifesto contra o ambiente do processo.
        const configuracao = container.resolve(ConfigDoctor).diagnosticar();

        res.json({ geradoEm: new Date().toISOString(), pipelines, alertas, configuracao });
    }),
);

// POST /operacao/alertas/:id/reconhecer — tira o alerta da lista de abertos.
router.post(
    '/alertas/:id/reconhecer',
    requireRole('admin'),
    requireOperacaoAcesso(),
    asyncHandler(async (req, res) => {
        await bootstrapAppContainer();
        const parsed = reconhecerParamsSchema.safeParse(req.params);
        if (!parsed.success) {
            res.status(400).json({ error: 'invalid id', details: parsed.error.flatten() });
            return;
        }
        const por = req.user?.sub ?? req.user?.email ?? 'unknown';
        await container.resolve(AlertaRepository).reconhecer(parsed.data.id, por);
        res.json({ ok: true });
    }),
);

export default router;
