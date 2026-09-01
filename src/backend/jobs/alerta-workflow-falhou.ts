import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { ALERTA_SEVERIDADE, ALERTA_TIPO } from '../domain/interface/operacao/Alerta.js';
import NotificacaoService from '../domain/service/operacao/NotificacaoService.js';

/**
 * Emite `job-falhou` a partir do `if: failure()` de um workflow (ADR-0042).
 *
 * **Por que isto existe se o `StalenessDetector` já alerta falha.** Os dois cobrem lacunas
 * diferentes, e é a diferença que justifica ter ambos:
 *
 * - O detector lê a tabela de runs. Ele enxerga a run que foi ABERTA e FECHADA com `error`.
 * - Este script cobre o workflow que morreu **antes de existir linha de run** — `npm ci` que
 *   falhou, migration que não aplicou, runner que evaporou, ou o processo derrubado entre o
 *   `createRun` e o `finishRun` (que deixa a linha presa em `running`, e `running` não é `error`).
 *
 * Sem ele, a falha mais bruta — a que nem chegou a começar — seria justamente a invisível, até o
 * limite de staleness estourar horas depois.
 *
 * Entrada por env (o workflow passa): `PIPELINE_ALVO`, `WORKFLOW_NOME`, `WORKFLOW_RUN_URL`.
 *
 * **Nunca falha o workflow.** Ele já está falhando — é esse o ponto. Um alerta que não consegue
 * ser gravado não pode transformar uma falha em duas.
 */
const main = async (): Promise<void> => {
    const alvo = process.env.PIPELINE_ALVO;
    if (alvo === undefined || alvo.trim() === '') {
        console.warn('[alerta-workflow-falhou] PIPELINE_ALVO ausente — nada a fazer.');
        return;
    }

    await bootstrapAppContainer();

    const emitido = await container.resolve(NotificacaoService).emitir({
        tipo: ALERTA_TIPO.JOB_FALHOU,
        alvo: alvo.trim(),
        severidade: ALERTA_SEVERIDADE.ERRO,
        // Janela = a execução do workflow: uma falha nova alerta, retentativa do mesmo run não.
        janelaInicio: new Date(),
        detalhe: {
            origem: 'workflow',
            workflow: process.env.WORKFLOW_NOME ?? 'desconhecido',
            runUrl: process.env.WORKFLOW_RUN_URL ?? undefined,
            // NUNCA valor de secret (I3) — só a identificação do workflow.
        },
    });

    console.log(
        emitido === null
            ? '[alerta-workflow-falhou] alerta suprimido pela dedup (já existe nesta janela).'
            : `[alerta-workflow-falhou] alerta ${emitido.id} emitido para ${alvo}.`,
    );
};

main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
        // Sai 0 DE PROPÓSITO: o workflow já está falhando, e o passo de alerta não pode
        // mascarar nem duplicar essa falha (I5 no nível do CI).
        console.error('[alerta-workflow-falhou] não foi possível emitir o alerta:', error);
        process.exit(0);
    });
