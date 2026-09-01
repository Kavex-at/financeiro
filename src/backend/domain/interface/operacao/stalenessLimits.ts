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

/** Pipelines que de fato têm fonte para ler. */
export type MonitoravelPipeline = Exclude<Pipeline, typeof PIPELINE.SISPAG_REAPER>;

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

export const PIPELINES_SEM_TRILHA: readonly PipelineSemTrilha[] = [
    {
        pipeline: PIPELINE.SISPAG_REAPER,
        rotulo: 'SISPAG — reaper de reconciliação',
        cadencia: '10,25,40,55 * * * * (a cada 15min)',
        motivo: 'O job não escreve linha de run; dar-lhe uma trilha é follow-up da ADR-0042.',
    },
] as const;

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
    [PIPELINE.SISPAG_PAGAMENTOS]: {
        pipeline: PIPELINE.SISPAG_PAGAMENTOS,
        rotulo: 'SISPAG — ingestão de pagamentos',
        cadencia: '0 10 * * * (diário)',
        limiteMs: 30 * HORA_MS,
        distinguePartial: false,
    },
} as const;
