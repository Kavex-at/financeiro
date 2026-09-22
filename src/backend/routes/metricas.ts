import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import MetricasCicloService from '../domain/service/metricas/MetricasCicloService.js';
import { asyncHandler } from '../http/asyncHandler.js';

/** `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM` ou `YYYY-MM-DDTHH:MM:SS` — horário de São Paulo, sem fuso. */
const DATA_LOCAL = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

/**
 * Zod no boundary. Fuso explícito (`Z`, `-03:00`) é recusado: a janela é hora local por contrato.
 *
 * `historico` é `z.enum(['true','false'])`, NÃO `z.coerce.boolean()`: a coerção do Zod passa por
 * `Boolean(string)`, e `'false'` — uma string não-vazia — viraria `true`. Quem escrevesse
 * `?historico=false` para desligar o recuo ligaria o recuo.
 */
const cicloQuerySchema = z.object({
    inicio: z.string().regex(DATA_LOCAL).optional(),
    fim: z.string().regex(DATA_LOCAL).optional(),
    historico: z.enum(['true', 'false']).optional(),
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
 *
 * `?historico=true` (ADR-0048) recua o piso da série de 2026-09-11 para 2026-08-07, seis semanas.
 * É **opt-in**: sem o parâmetro, a resposta é byte a byte a de antes da ADR-0048 — piso
 * `metricas.serie_inicio()` e `serieInicio = 2026-09-11T18:00:00`. O `kavex-report-ciclo` não o
 * passa e por isso não vê diferença; quem recua é a tela Métricas.
 */
const router = Router();

// GET /metricas/ciclo?inicio=&fim= — janelas fechadas da série, mais recente primeiro.
router.get(
    '/ciclo',
    asyncHandler(async (req, res) => {
        const parsed = cicloQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({
                error: 'inicio/fim devem ser YYYY-MM-DD ou YYYY-MM-DDTHH:MM[:SS], horário de São Paulo; historico deve ser true ou false',
                details: parsed.error.flatten(),
            });
            return;
        }

        const { historico, ...janela } = parsed.data;

        await bootstrapAppContainer();
        const leitura = await container.resolve(MetricasCicloService).ler({
            ...janela,
            // Ausente e `'false'` são a MESMA coisa: a leitura de antes da ADR-0048, que é o que o
            // `kavex-report-ciclo` continua recebendo sem mudar uma linha.
            ...(historico === 'true' ? { historico: true } : {}),
        });
        res.json(leitura);
    }),
);

export default router;
