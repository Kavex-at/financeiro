import 'reflect-metadata';
import { Router } from 'express';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { SITUACAO_PIPELINE } from '../domain/interface/operacao/JobRun.js';
import JobRunReadModel from '../domain/service/operacao/JobRunReadModel.js';
import { asyncHandler } from '../http/asyncHandler.js';

/**
 * Sonda de saúde dos pipelines — a metade PULL do dead-man's switch (ADR-0042, follow-up 1).
 *
 * Fecha o ponto cego que o `DbAlertSink` não alcança: se o processo não sobe, ninguém escreve
 * linha de alerta nenhuma, e o painel — que É o canal — some junto. Um observador EXTERNO
 * (healthchecks.io, cronitor, UptimeRobot) resolve isso por construção, porque ele não depende de
 * nada nosso estar de pé.
 *
 * **PÚBLICA e deliberadamente pobre.** Precisa ser alcançável sem JWT (o pinger não tem um), então
 * a resposta carrega o MÍNIMO: um status e contagens. Sem nome de pipeline, sem idade, sem
 * mensagem de erro — nada que descreva a operação para quem não deveria vê-la. Quem quer detalhe
 * usa `GET /operacao`, que exige `admin`. É a mesma escolha do `/health`, que devolve versão e
 * nada mais.
 *
 * **O status HTTP é o produto.** 200 = tudo em dia; 503 = há pipeline parado ou run abandonada.
 * Uptime checker nenhum sabe ler o nosso JSON, mas todos sabem ler um 503 — e é isso que faz um
 * serviço gratuito virar alerta sem escrever integração.
 */
const router = Router();

router.get(
    '/pipelines',
    asyncHandler(async (_req, res) => {
        await bootstrapAppContainer();
        const saude = await container.resolve(JobRunReadModel).exporSaude();

        const parados = saude.filter((p) => p.situacao === SITUACAO_PIPELINE.PARADO).length;
        // Run aberta e nunca fechada: o runner morreu no meio. Conta como degradação.
        const abandonadas = saude.filter(
            (p) =>
                p.ultimaRun?.status === 'running' &&
                p.limiteStalenessMs !== undefined &&
                Date.now() - Date.parse(p.ultimaRun.startedAt) > p.limiteStalenessMs,
        ).length;

        // `nunca-executou` e `sem-trilha` NÃO derrubam o status: são estados conhecidos e
        // declarados, não incidentes. Deixá-los degradar o health faria a sonda nascer vermelha e
        // ensinaria o time a ignorá-la — o mesmo erro que a dedup de alerta existe para evitar.
        const degradado = parados > 0 || abandonadas > 0;

        res.status(degradado ? 503 : 200).json({
            status: degradado ? 'degraded' : 'ok',
            pipelinesParados: parados,
            runsAbandonadas: abandonadas,
            pipelinesMonitorados: saude.filter((p) => p.situacao !== SITUACAO_PIPELINE.SEM_TRILHA)
                .length,
            verificadoEm: new Date().toISOString(),
        });
    }),
);

export default router;
