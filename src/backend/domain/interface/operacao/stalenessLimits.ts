import { PIPELINE, type Pipeline } from './JobRun.js';

/**
 * Limites de staleness POR pipeline — `ontology/business-rules/staleness-por-pipeline.md`.
 *
 * Um limite global estaria errado para todos ao mesmo tempo: as cadências vão de 15 minutos
 * (reaper) a 24 horas (SISPAG). Cada limite é o maior gap normal MAIS folga para ao menos uma
 * execução perdida — schedules do GitHub Actions são best-effort, e uma execução atrasada é
 * comportamento esperado, não incidente.
 *
 * Alertar na primeira perdida treinaria o time a ignorar o canal, que é o modo de falha mais caro
 * de um sistema de alerta: ele desativa todos os outros alertas junto.
 */

const HORA_MS = 60 * 60 * 1000;

/**
 * Pipelines que têm fonte para ler.
 *
 * Hoje é `Pipeline` inteiro: desde que o reaper ganhou trilha, não há mais pipeline cego. O alias
 * permanece porque a distinção é real e volta assim que um job novo nascer sem trilha.
 */
export type MonitoravelPipeline = Pipeline;

export interface LimiteStaleness {
    pipeline: MonitoravelPipeline;
    rotulo: string;
    /** Expressão do cron, exibida na tela para justificar o limite. */
    cadencia: string;
    limiteMs: number;
    /**
     * A fonte distingue `partial`? `permuta_eleicao_run` e `recebimento_ingestao_run` sim;
     * `pagamento_ingestao_run` NÃO — ele fecha `success` mesmo com filial falhada.
     */
    distinguePartial: boolean;
}

/**
 * Pipelines que rodam mas NÃO escrevem linha de run — sem fonte, sem adapter, sem limite.
 *
 * Declarados aqui para que o painel os LISTE como cegos. Omiti-los faria a tela afirmar cobertura
 * completa sobre 3 de 4 jobs, e este em particular é aquele cuja cegueira já estava registrada por
 * escrito no comentário de `.github/workflows/reaper-sispag.yml`.
 */
export interface PipelineSemTrilha {
    pipeline: Pipeline;
    rotulo: string;
    cadencia: string;
    motivo: string;
}

/**
 * Vazio hoje — e é bom que esteja.
 *
 * O `sispag-reaper` morava aqui até 2026-09-01, quando ganhou trilha em `job_execucao`
 * (ADR-0042, follow-up 2). A lista continua existindo porque o problema volta: todo job novo que
 * nascer sem escrever linha de run entra aqui, para ser LISTADO como cego em vez de sumir da tela.
 */
export const PIPELINES_SEM_TRILHA: readonly PipelineSemTrilha[] = [] as const;

export const LIMITES_STALENESS: Readonly<Record<MonitoravelPipeline, LimiteStaleness>> = {
    [PIPELINE.RECEBIMENTOS_EXTRATOS]: {
        pipeline: PIPELINE.RECEBIMENTOS_EXTRATOS,
        rotulo: 'Recebimentos — ingestão de extratos',
        cadencia: '20 * * * * (de hora em hora)',
        limiteMs: 3 * HORA_MS,
        distinguePartial: true,
    },
    [PIPELINE.PERMUTAS_ELEICAO]: {
        pipeline: PIPELINE.PERMUTAS_ELEICAO,
        rotulo: 'Permutas — eleição/ingestão',
        cadencia: '0 9,15,21 * * * (3× ao dia)',
        limiteMs: 18 * HORA_MS,
        distinguePartial: true,
    },
    [PIPELINE.RECEBIMENTOS_NDE_SEFAZ]: {
        pipeline: PIPELINE.RECEBIMENTOS_NDE_SEFAZ,
        rotulo: 'Recebimentos — reconciliação da NDe com o SEFAZ',
        cadencia: '35 * * * * (de hora em hora)',
        limiteMs: 3 * HORA_MS,
        distinguePartial: true,
    },
    [PIPELINE.OPERACAO_DETECTOR]: {
        pipeline: PIPELINE.OPERACAO_DETECTOR,
        rotulo: 'Operação — detector de staleness',
        cadencia: '45 * * * * (de hora em hora)',
        limiteMs: 3 * HORA_MS,
        distinguePartial: true,
    },
    [PIPELINE.SISPAG_REAPER]: {
        pipeline: PIPELINE.SISPAG_REAPER,
        rotulo: 'SISPAG — reaper de reconciliação',
        cadencia: '10,25,40,55 * * * * (a cada 15min, todos os dias)',
        // O cron pede 15min, mas o GitHub dispara este schedule 5–7× por dia: medido de 15 a
        // 29/09/2026, 90 runs, gap mediano de 4h e máximo de 8,4h. O limite antigo de 1h fazia o
        // painel mostrar "Parado" e emitir `job-parado` quase o dia todo por puro throttling.
        // 12h cobre o pior gap observado com folga e ainda pega um reaper morto em meio dia.
        limiteMs: 12 * HORA_MS,
        distinguePartial: true,
    },
    [PIPELINE.SISPAG_SINCRONIZACAO]: {
        pipeline: PIPELINE.SISPAG_SINCRONIZACAO,
        rotulo: 'SISPAG — sincronização do status dos lotes',
        cadencia: '35 11-22 * * 1-5 (de hora em hora, dias úteis)',
        // O maior gap NORMAL é o fim de semana: sexta 22:35 UTC → segunda 11:35 UTC = 61h. Um
        // limite menor alertaria todo domingo — e canal que alerta toda semana à toa é canal
        // ignorado. O custo é que uma parada numa terça só aparece na quinta; a falha TOTAL de
        // leitura (credencial) já fecha a run em `error` e alerta por `job-falhou` na hora.
        limiteMs: 64 * HORA_MS,
        distinguePartial: true,
    },
    [PIPELINE.SISPAG_PERFIL_CANAL]: {
        pipeline: PIPELINE.SISPAG_PERFIL_CANAL,
        rotulo: 'SISPAG — perfil de canal dos favorecidos',
        cadencia: '17 6 * * 0 (semanal, domingo)',
        // Semanal: o maior gap normal é 7 dias. 9 dias tolera uma execução atrasada pelo GitHub sem
        // tolerar uma semana perdida. O perfil muda devagar; a falha de leitura já fecha a run em
        // `error` e alerta por `job-falhou` na hora.
        limiteMs: 9 * 24 * HORA_MS,
        distinguePartial: true,
    },
    [PIPELINE.SISPAG_PAGAMENTOS]: {
        pipeline: PIPELINE.SISPAG_PAGAMENTOS,
        rotulo: 'SISPAG — ingestão de pagamentos',
        cadencia: '0 10 * * * (diário)',
        limiteMs: 30 * HORA_MS,
        distinguePartial: false,
    },
} as const;
