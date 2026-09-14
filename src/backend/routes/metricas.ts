import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import MetricasCicloService from '../domain/service/metricas/MetricasCicloService.js';
import { asyncHandler } from '../http/asyncHandler.js';

/** `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` ou `YYYY-MM-DDTHH:MM:SS` — horário de São Paulo, sem fuso. */
const DATA_LOCAL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

/** Zod no boundary. Fuso explícito (`Z`, `-03:00`) é recusado: a janela é hora local por contrato. */
const cicloQuerySchema = z.object({
    inicio: z.string().regex(DATA_LOCAL).optional(),
    fim: z.string().regex(DATA_LOCAL).optional(),
});

/**
 * Métricas do ciclo (ADR-0045) — quanto trabalho o sistema fez pela operação, por semana.
 *
 * Consumida pela tela Métricas e pelo `kavex-report-ciclo` (que faz login na API como qualquer
 * usuário). Leitura aberta a quem está autenticado, como as demais leituras da plataforma: os números
 * são agregados semanais, sem dado de cliente.
 *
 * **Não toca o Conexos.** Tudo vem de `metricas.vw_metricas_ciclo`, com o valor gravado no momento do
 * fato — reconsultar o ERP traria câmbio e reprocessamento para dentro do número.
 */
const router = Router();

// GET /metricas/ciclo?inicio=&fim= — janelas fechadas da série, mais recente primeiro.
router.get(
    '/ciclo',
    asyncHandler(async (req, res) => {
        const parsed = cicloQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({
                error: 'inicio/fim devem ser YYYY-MM-DD ou YYYY-MM-DDTHH:MM[:SS], horário de São Paulo',
                details: parsed.error.flatten(),
            });
            return;
        }

        await bootstrapAppContainer();
        const leitura = await container.resolve(MetricasCicloService).ler(parsed.data);
        res.json(leitura);
    }),
);

export default router;
