/**
 * `JobRun` — read-model sobre as tabelas de run que JÁ existem (ADR-0042).
 *
 * NÃO há tabela `job_run` e NÃO há migration: um adapter por fonte normaliza
 * `permuta_eleicao_run`, `recebimento_ingestao_run` e `pagamento_ingestao_run`.
 * Ver `ontology/entities/job-run.md`.
 */

/** Pipelines conhecidos pelo painel. Pipeline sem adapter é invisível — dívida aceita na ADR-0042. */
export const PIPELINE = {
    PERMUTAS_ELEICAO: 'permutas-eleicao',
    RECEBIMENTOS_EXTRATOS: 'recebimentos-extratos',
    SISPAG_PAGAMENTOS: 'sispag-pagamentos',
    /** Sem trilha de execução — declarado para ser LISTADO como cego, nunca omitido. */
    SISPAG_REAPER: 'sispag-reaper',
} as const;

export type Pipeline = (typeof PIPELINE)[keyof typeof PIPELINE];

/**
 * Status normalizado.
 *
 * `partial` é preservado onde a fonte o distingue e NUNCA sintetizado onde ela não o faz —
 * ver `distinguePartial` em `PipelineSaude`.
 */
export const JOB_RUN_STATUS = {
    RUNNING: 'running',
    SUCCESS: 'success',
    PARTIAL: 'partial',
    ERROR: 'error',
} as const;

export type JobRunStatus = (typeof JOB_RUN_STATUS)[keyof typeof JOB_RUN_STATUS];

/** Uma execução, já normalizada a partir da sua fonte. */
export interface JobRun {
    runId: string;
    pipeline: Pipeline;
    status: JobRunStatus;
    triggeredBy: string;
    /** ISO-8601. */
    startedAt: string;
    /** ISO-8601. Ausente enquanto a run está `running`. */
    finishedAt?: string;
    duracaoMs?: number;
    /**
     * Métricas próprias da fonte. Deliberadamente um saco aberto: forçar um denominador comum
     * faria a tela mentir sobre pipelines cujo trabalho não é comparável (eleger candidatas ×
     * inserir lançamentos × inativar títulos).
     */
    metricas: Record<string, number>;
    errorMessage?: string;
}

/**
 * Situação de staleness de um pipeline.
 *
 * `nunca-executou` é um estado PRÓPRIO, não um `ok` disfarçado: um pipeline que jamais teve
 * sucesso não é saudável, ele é desconhecido. A decisão (Yuri, 2026-09-01) é suprimir o ALERTA
 * de staleness nesse caso — mas a tela continua dizendo a verdade, e uma run que roda e falha
 * ainda alerta por `job-falhou`.
 */
export const SITUACAO_PIPELINE = {
    OK: 'ok',
    PARADO: 'parado',
    NUNCA_EXECUTOU: 'nunca-executou',
    /**
     * O job existe e roda, mas não escreve linha de run — não há o que ler.
     * Hoje: `sispag-reaper`. Listado de propósito: omitir faria a tela afirmar cobertura
     * completa sobre 3 de 4 jobs, e o reaper é justamente aquele cuja cegueira já estava
     * documentada no comentário do próprio workflow.
     */
    SEM_TRILHA: 'sem-trilha',
} as const;

export type SituacaoPipeline = (typeof SITUACAO_PIPELINE)[keyof typeof SITUACAO_PIPELINE];

/** Saúde de um pipeline, computada NA LEITURA (invariante I6). */
export interface PipelineSaude {
    pipeline: Pipeline;
    rotulo: string;
    /** Cadência declarada do cron, para a tela explicar de onde vem o limite. */
    cadencia: string;
    ultimaRun?: JobRun;
    /** ISO-8601 da última run `success`. */
    ultimoSucessoEm?: string;
    idadeDesdeUltimoSucessoMs?: number;
    /** Ausente quando `situacao === 'sem-trilha'` — não há limite aplicável sem fonte. */
    limiteStalenessMs?: number;
    situacao: SituacaoPipeline;
    /**
     * `false` quando a FONTE não distingue `partial` (hoje: SISPAG, que fecha `success` mesmo com
     * filial falhada). Cegueira HERDADA, não sinal de saúde — a tela precisa poder dizer isso em
     * vez de deixar o analista ler ausência de `partial` como ausência de problema.
     */
    distinguePartial: boolean;
    runsRecentes: JobRun[];
}
