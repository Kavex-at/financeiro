import { inject, injectable } from 'tsyringe';
import {
    JOB_RUN_STATUS,
    type JobRun,
    type JobRunStatus,
    PIPELINE,
    type Pipeline,
    type PipelineSaude,
    SITUACAO_PIPELINE,
    type SituacaoPipeline,
} from '../../interface/operacao/JobRun.js';
import {
    LIMITES_STALENESS,
    type MonitoravelPipeline,
    PIPELINES_SEM_TRILHA,
} from '../../interface/operacao/stalenessLimits.js';
import JobExecucaoRepository from '../../repository/operacao/JobExecucaoRepository.js';
import PermutaSnapshotRepository from '../../repository/permutas/PermutaSnapshotRepository.js';
import RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';

/** Quantas runs recentes o painel mostra por pipeline. */
export const RUNS_POR_PIPELINE = 10;

/** Normaliza `string | Date | null | undefined` para ISO-8601 — as três fontes divergem. */
const iso = (v: string | Date | null | undefined): string | undefined => {
    if (v === null || v === undefined) return undefined;
    return typeof v === 'string' ? v : v.toISOString();
};

const duracao = (startedAt: string, finishedAt?: string): number | undefined => {
    if (finishedAt === undefined) return undefined;
    const ms = Date.parse(finishedAt) - Date.parse(startedAt);
    return Number.isFinite(ms) ? ms : undefined;
};

/**
 * JobRunReadModel — projeção de leitura sobre as três tabelas de run existentes (ADR-0042).
 *
 * NÃO cria tabela e NÃO toca nenhum writer. Cada fonte tem o seu adapter; o que elas divergem
 * (vocabulário de status, tipo de retorno das datas, métricas próprias) é conciliado aqui e em
 * lugar nenhum mais.
 *
 * **Não toca o ERP** (invariante I4): tudo vem do Postgres. Esta é a leitura que sustenta a tela
 * que se abre justamente quando o Conexos está fora.
 */
@injectable()
export default class JobRunReadModel {
    constructor(
        @inject(PermutaSnapshotRepository)
        private readonly permutaRepository: PermutaSnapshotRepository,
        @inject(RecebimentoIngestaoRunRepository)
        private readonly recebimentoRepository: RecebimentoIngestaoRunRepository,
        @inject(PagamentoIngestaoRunRepository)
        private readonly pagamentoRepository: PagamentoIngestaoRunRepository,
        @inject(JobExecucaoRepository)
        private readonly jobExecucaoRepository: JobExecucaoRepository,
    ) {}

    /**
     * Saúde de todos os pipelines. `agora` é injetável para o detector e para os testes exercitarem
     * a fronteira do limite sem depender do relógio real.
     */
    public exporSaude = async (agora: Date = new Date()): Promise<PipelineSaude[]> => {
        const [permutas, recebimentos, sispag, ndeSefaz] = await Promise.all([
            this.lerPermutas(),
            this.lerRecebimentos(),
            this.lerSispag(),
            this.lerJobExecucao(PIPELINE.RECEBIMENTOS_NDE_SEFAZ),
        ]);

        const monitoraveis = [
            this.montarSaude(PIPELINE.PERMUTAS_ELEICAO, permutas, agora),
            this.montarSaude(PIPELINE.RECEBIMENTOS_EXTRATOS, recebimentos, agora),
            this.montarSaude(PIPELINE.RECEBIMENTOS_NDE_SEFAZ, ndeSefaz, agora),
            this.montarSaude(PIPELINE.SISPAG_PAGAMENTOS, sispag, agora),
        ];

        // Os cegos entram na lista de propósito — omiti-los afirmaria cobertura que não existe.
        const semTrilha: PipelineSaude[] = PIPELINES_SEM_TRILHA.map((p) => ({
            pipeline: p.pipeline,
            rotulo: p.rotulo,
            cadencia: p.cadencia,
            situacao: SITUACAO_PIPELINE.SEM_TRILHA,
            distinguePartial: false,
            runsRecentes: [],
        }));

        return [...monitoraveis, ...semTrilha];
    };

    private montarSaude = (
        pipeline: MonitoravelPipeline,
        runs: JobRun[],
        agora: Date,
    ): PipelineSaude => {
        const limite = LIMITES_STALENESS[pipeline];
        const ultimoSucesso = runs.find((r) => r.status === JOB_RUN_STATUS.SUCCESS);
        const ultimoSucessoEm = ultimoSucesso?.finishedAt ?? ultimoSucesso?.startedAt;

        const idadeDesdeUltimoSucessoMs =
            ultimoSucessoEm === undefined
                ? undefined
                : agora.getTime() - Date.parse(ultimoSucessoEm);

        return {
            pipeline,
            rotulo: limite.rotulo,
            cadencia: limite.cadencia,
            ...(runs[0] !== undefined ? { ultimaRun: runs[0] } : {}),
            ...(ultimoSucessoEm !== undefined ? { ultimoSucessoEm } : {}),
            ...(idadeDesdeUltimoSucessoMs !== undefined ? { idadeDesdeUltimoSucessoMs } : {}),
            limiteStalenessMs: limite.limiteMs,
            situacao: this.situacao(idadeDesdeUltimoSucessoMs, limite.limiteMs),
            distinguePartial: limite.distinguePartial,
            runsRecentes: runs,
        };
    };

    /**
     * `nunca-executou` é estado próprio, não um `ok` disfarçado.
     *
     * Decisão (Yuri, 2026-09-01): o ALERTA de staleness é suprimido enquanto não houver um primeiro
     * sucesso — um pipeline recém-implantado não deve alertar para sempre. A tela, porém, continua
     * dizendo a verdade, e uma run que roda e FALHA segue alertando por `job-falhou`. O único caso
     * que fica em silêncio é o pipeline que nunca rodou de fato, e esse a tela mostra.
     */
    private situacao = (idadeMs: number | undefined, limiteMs: number): SituacaoPipeline => {
        if (idadeMs === undefined) return SITUACAO_PIPELINE.NUNCA_EXECUTOU;
        return idadeMs > limiteMs ? SITUACAO_PIPELINE.PARADO : SITUACAO_PIPELINE.OK;
    };

    // --- Adapters (um por fonte) ---

    /**
     * Adapter dos jobs NOVOS (`job_execucao`, migration 0053). Genérico de propósito: qualquer job
     * que nasça daqui em diante ganha visibilidade sem código novo — inclusive o reaper, quando o
     * follow-up lhe der uma trilha.
     */
    private lerJobExecucao = async (pipeline: Pipeline): Promise<JobRun[]> => {
        const runs = await this.jobExecucaoRepository.listRecentRuns(pipeline, RUNS_POR_PIPELINE);
        return runs.map((r) => {
            const finishedAt = iso(r.finishedAt);
            return {
                runId: r.id,
                pipeline,
                status: r.status,
                triggeredBy: r.triggeredBy,
                startedAt: r.startedAt,
                ...(finishedAt !== undefined ? { finishedAt } : {}),
                ...(duracao(r.startedAt, finishedAt) !== undefined
                    ? { duracaoMs: duracao(r.startedAt, finishedAt) }
                    : {}),
                metricas: r.metricas,
                ...(r.errorMessage !== undefined ? { errorMessage: r.errorMessage } : {}),
            } satisfies JobRun;
        });
    };

    private lerPermutas = async (): Promise<JobRun[]> => {
        const runs = await this.permutaRepository.listRecentRuns(RUNS_POR_PIPELINE);
        return runs.map((r) => {
            const startedAt = r.startedAt.toISOString();
            const finishedAt = iso(r.finishedAt);
            return {
                runId: r.runId,
                pipeline: PIPELINE.PERMUTAS_ELEICAO,
                status: r.status as JobRunStatus,
                triggeredBy: r.triggeredBy,
                startedAt,
                ...(finishedAt !== undefined ? { finishedAt } : {}),
                ...(duracao(startedAt, finishedAt) !== undefined
                    ? { duracaoMs: duracao(startedAt, finishedAt) }
                    : {}),
                metricas: {
                    candidatas: r.totalCandidatas,
                    elegiveis: r.totalElegiveis,
                    bloqueadas: r.totalBloqueadas,
                },
                ...(r.errorMessage !== undefined ? { errorMessage: r.errorMessage } : {}),
            } satisfies JobRun;
        });
    };

    private lerRecebimentos = async (): Promise<JobRun[]> => {
        const runs = await this.recebimentoRepository.listRecentRuns(RUNS_POR_PIPELINE);
        return runs.map((r) => {
            const finishedAt = iso(r.finishedAt);
            return {
                runId: r.id,
                pipeline: PIPELINE.RECEBIMENTOS_EXTRATOS,
                status: r.status,
                triggeredBy: r.triggeredBy,
                startedAt: r.startedAt,
                ...(finishedAt !== undefined ? { finishedAt } : {}),
                ...(duracao(r.startedAt, finishedAt) !== undefined
                    ? { duracaoMs: duracao(r.startedAt, finishedAt) }
                    : {}),
                metricas: {
                    lidas: r.totalLidas,
                    inseridas: r.totalInseridas,
                    deduplicadas: r.totalDeduplicadas,
                    contas: r.totalContas,
                    contasFalhas: r.totalContasFalhas,
                },
                ...(r.errorMessage !== undefined ? { errorMessage: r.errorMessage } : {}),
            } satisfies JobRun;
        });
    };

    /**
     * SISPAG nunca produz `partial` — a fonte não distingue o estado (fecha `success` mesmo com
     * filial falhada). O adapter NÃO inventa: repassa o que a fonte diz, e `distinguePartial:false`
     * carrega a ressalva até a tela.
     */
    private lerSispag = async (): Promise<JobRun[]> => {
        const runs = await this.pagamentoRepository.listRecentRuns(RUNS_POR_PIPELINE);
        return runs.map((r) => {
            const finishedAt = iso(r.finishedAt);
            return {
                runId: r.id,
                pipeline: PIPELINE.SISPAG_PAGAMENTOS,
                status: r.status as JobRunStatus,
                triggeredBy: r.triggeredBy,
                startedAt: r.startedAt,
                ...(finishedAt !== undefined ? { finishedAt } : {}),
                ...(duracao(r.startedAt, finishedAt) !== undefined
                    ? { duracaoMs: duracao(r.startedAt, finishedAt) }
                    : {}),
                metricas: { titulos: r.totalTitulos, inativados: r.totalInativados },
                ...(r.errorMessage !== undefined ? { errorMessage: r.errorMessage } : {}),
            } satisfies JobRun;
        });
    };
}
