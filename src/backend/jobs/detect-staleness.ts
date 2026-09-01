import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { PIPELINE } from '../domain/interface/operacao/JobRun.js';
import JobExecucaoRepository from '../domain/repository/operacao/JobExecucaoRepository.js';
import StalenessDetector from '../domain/service/operacao/StalenessDetector.js';

/**
 * Job detector de staleness (ADR-0042).
 *
 * Compara a idade da última run `success` de cada pipeline com o limite daquele pipeline
 * (`ontology/business-rules/staleness-por-pipeline.md`) e emite `job-parado` / `job-falhou` /
 * `job-parcial`, com deduplicação por janela.
 *
 * **NÃO toca o Conexos.** Só lê Postgres — não precisa de credencial do ERP e, o que importa mais,
 * não disputa os ~3 slots de `LOGIN_ERROR_MAX_SESSIONS` com os crons que ele vigia. Um detector
 * que causasse o incidente que existe para detectar seria absurdo.
 *
 * CRON: de hora em hora no minuto :45 (`.github/workflows/detect-staleness.yml`). Hora em hora
 * cobre o limite mais apertado (extratos, 3h) com folga de sobra; a janela de dedup do detector
 * garante 1 alerta por limite decorrido em vez de 1 por rodada.
 *
 * **Ponto cego conhecido:** hospedado no próprio GitHub Actions, este job não enxerga o GH Actions
 * parar de disparar. Mitigação parcial é o I6 — o painel computa staleness na leitura, então quem
 * abrir a tela vê a verdade mesmo sem este job ter rodado. Cobertura completa pede um dead-man's
 * switch externo (follow-up da ADR-0042).
 *
 * Exit 0 mesmo tendo emitido alertas: alerta emitido é o job FUNCIONANDO. Exit non-zero só quando
 * a própria detecção falha.
 */
const main = async (): Promise<void> => {
    await bootstrapAppContainer();

    // O vigia registra a PRÓPRIA execução. Sem isto ele seria o job menos observado da frota, e
    // uma lista de alertas vazia na tela ficaria ambígua entre "nada a reportar" e "o detector
    // morreu na execução" — que é a leitura mais perigosa de um painel de operação.
    const runRepo = container.resolve(JobExecucaoRepository);
    const runId = await runRepo.createRun({
        pipeline: PIPELINE.OPERACAO_DETECTOR,
        triggeredBy: process.env.TRIGGERED_BY ?? 'cron',
    });

    try {
        const resultado = await container.resolve(StalenessDetector).detectar();

        for (const i of resultado.inspecionados) {
            console.log(`[detect-staleness] ${i.pipeline}: ${i.situacao}`);
        }

        if (resultado.emitidos.length === 0) {
            console.log('[detect-staleness] nenhum alerta novo.');
        } else {
            for (const a of resultado.emitidos) {
                console.log(`[detect-staleness] ALERTA ${a.tipo} · ${a.alvo} · ${a.severidade}`);
            }
            console.log(`[detect-staleness] ${resultado.emitidos.length} alerta(s) emitido(s).`);
        }

        await runRepo.finishRun({
            runId,
            status: 'success',
            metricas: {
                inspecionados: resultado.inspecionados.length,
                alertasEmitidos: resultado.emitidos.length,
            },
        });

        // SÓ no caminho de sucesso: um ping enviado depois de uma detecção que falhou diria ao
        // observador externo que está tudo bem justamente quando não está.
        await pingDeadManSwitch();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await runRepo.finishRun({ runId, status: 'error', errorMessage });
        throw error;
    }
};

/**
 * Metade PUSH do dead-man's switch (ADR-0042, follow-up 1).
 *
 * Fecha o ponto cego que nenhuma sonda nossa alcança: um detector hospedado no próprio GitHub
 * Actions não vê o Actions **deixar de disparar**. Nada roda, logo nada reclama — o silêncio é
 * indistinguível de saúde.
 *
 * A inversão resolve: em vez de nós avisarmos que algo quebrou, um serviço externo espera o nosso
 * ping e alerta quando ele NÃO chega. Falha de rede, runner morto, cron cancelado, repositório
 * arquivado — tudo vira ausência de ping, que é justamente o que o observador externo detecta.
 *
 * Best-effort e sem `await` bloqueante do desfecho: um pinger fora do ar não pode derrubar a
 * detecção, que é o trabalho de verdade (I5). Ausente a env, vira no-op silencioso — dev e teste
 * não precisam de conta em serviço nenhum.
 */
const pingDeadManSwitch = async (): Promise<void> => {
    const url = process.env.HEALTHCHECK_PING_URL;
    if (url === undefined || url.trim() === '') return;
    try {
        const resposta = await fetch(url.trim(), {
            method: 'GET',
            signal: AbortSignal.timeout(10_000),
        });
        console.log(`[detect-staleness] dead-man ping: HTTP ${resposta.status}`);
    } catch (error) {
        // Não relança: o ping é a rede de segurança, não a tarefa. Falhar aqui e derrubar o job
        // faria a rede de segurança virar a causa da queda.
        console.warn(
            '[detect-staleness] dead-man ping falhou (a detecção em si concluiu):',
            error instanceof Error ? error.message : String(error),
        );
    }
};

main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        console.error('[detect-staleness] falhou:', error);
        process.exit(1);
    });
