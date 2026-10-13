import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import DeadlineExceededError from '../../errors/DeadlineExceededError.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { JOB_RUN_STATUS, PIPELINE } from '../../interface/operacao/JobRun.js';
import EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import TimeoutExecutor from '../../libs/executor/TimeoutExecutor.js';
import { redactErrorMessage } from '../../libs/redact/redactErrorMessage.js';
import JobExecucaoRepository from '../../repository/operacao/JobExecucaoRepository.js';
import LogService from '../LogService.js';
import SincronizacaoLoteService, { type ResumoSincronizacao } from './SincronizacaoLoteService.js';

/** Chave de advisory lock EXCLUSIVA da passada de L11 (≠ das ingestões). */
export const SISPAG_SINCRONIZACAO_LOCK_KEY = 726354820;

const MIN_MS = 60_000;
/**
 * Uma run `running` mais velha que isto é run MORTA (processo derrubado entre o `createRun` e o
 * `finishRun`): não bloqueia uma passada nova. A passada leva ~25 s medidos no cron.
 */
const RUN_PRESA_MS = 10 * MIN_MS;
/** Runs olhadas para achar a última finalizada (uma `running` presa não pode esconder as outras). */
const RUNS_CONSULTADAS = 5;

export const ESTADO_SINCRONIZACAO = {
    /** Passada completa recente (< TTL): nada foi feito. */
    FRESCA: 'fresca',
    /** Uma passada nova rodou agora. */
    ATUALIZADA: 'atualizada',
    /** Já há uma passada rodando (cron, abertura de outra pessoa, botão). */
    EM_ANDAMENTO: 'em_andamento',
    /** A última passada falhou há pouco: não repete até o cooldown passar. */
    FALHA_RECENTE: 'falha_recente',
} as const;
export type EstadoSincronizacao = (typeof ESTADO_SINCRONIZACAO)[keyof typeof ESTADO_SINCRONIZACAO];

export type StatusPassada = Exclude<
    (typeof JOB_RUN_STATUS)[keyof typeof JOB_RUN_STATUS],
    'running'
>;

/** Uma passada completa de L11, já registrada em `job_execucao`. */
export interface PassadaSincronizacao {
    runId: string;
    status: StatusPassada;
    resumo?: ResumoSincronizacao;
    errorMessage?: string;
}

export interface SincronizacaoAtualizacao {
    estado: EstadoSincronizacao;
    /** ISO do fim da última passada finalizada (success/partial), quando existe. */
    ultimaSincronizacaoEm?: string;
    /** Idade dessa passada, em minutos inteiros. */
    idadeMin?: number;
    /** A passada que rodou (só em `atualizada`). */
    passada?: PassadaSincronizacao;
    /** Mensagem da última falha (`falha_recente`, ou `atualizada` com passada em `error`). */
    motivo?: string;
}

/**
 * Passada completa de L11 `sincronizarStatus` com trava e trilha (ADR-0055, ADR-0066).
 *
 * Os três gatilhos — abertura da tela (`sincronizarSeDefasada`), o "Sincronizar agora" da tela
 * (`forcar`) e o cron (`executarPassada`) — passam por aqui: uma passada por vez (advisory lock,
 * vale entre o servidor e o runner do GitHub, que usam o mesmo banco) e uma run em
 * `job_execucao` por passada, que é o relógio do TTL.
 *
 * READ-ONLY no ERP (I11a): só delega a `SincronizacaoLoteService`.
 */
@injectable()
export default class SincronizacaoPassadaService {
    public constructor(
        @inject(SincronizacaoLoteService) private readonly sincronizacao: SincronizacaoLoteService,
        @inject(JobExecucaoRepository) private readonly runRepo: JobExecucaoRepository,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** Uma passada sob a trava. Trava ocupada → `IngestLockBusyError`. */
    public executarPassada = async (input: {
        triggeredBy: string;
    }): Promise<PassadaSincronizacao> =>
        this.db.withAdvisoryLock(
            SISPAG_SINCRONIZACAO_LOCK_KEY,
            () => this.rodar(input.triggeredBy),
            async () => {
                throw new IngestLockBusyError(
                    'sincronização de lotes SISPAG em andamento — outra passada já está rodando',
                );
            },
        );

    /**
     * Abertura da tela (ADR-0066): *stale-while-revalidate*. Roda só se a última passada
     * finalizada for mais velha que o TTL, sem outra rodando e fora do cooldown de falha.
     */
    public sincronizarSeDefasada = async (input: {
        triggeredBy: string;
        /** Relógio injetável (ms epoch) — só para teste. */
        agora?: number;
    }): Promise<SincronizacaoAtualizacao> => {
        const agora = input.agora ?? Date.now();
        const env = await this.environmentProvider.getEnvironmentVars();
        const ttlMs = env.sispagLotesSyncTtlMin * MIN_MS;
        const cooldownMs = env.sispagLotesSyncCooldownMin * MIN_MS;

        const runs = await this.runRepo.listRecentRuns(
            PIPELINE.SISPAG_SINCRONIZACAO,
            RUNS_CONSULTADAS,
        );
        const ultimoSucesso = runs.find(
            (r) =>
                (r.status === JOB_RUN_STATUS.SUCCESS || r.status === JOB_RUN_STATUS.PARTIAL) &&
                r.finishedAt !== undefined,
        )?.finishedAt;
        const referencia = this.referencia(ultimoSucesso, agora);

        if (ultimoSucesso && agora - Date.parse(ultimoSucesso) < ttlMs) {
            return { estado: ESTADO_SINCRONIZACAO.FRESCA, ...referencia };
        }
        const [ultima] = runs;
        if (
            ultima?.status === JOB_RUN_STATUS.RUNNING &&
            agora - Date.parse(ultima.startedAt) < RUN_PRESA_MS
        ) {
            return { estado: ESTADO_SINCRONIZACAO.EM_ANDAMENTO, ...referencia };
        }
        if (
            ultima?.status === JOB_RUN_STATUS.ERROR &&
            ultima.finishedAt !== undefined &&
            agora - Date.parse(ultima.finishedAt) < cooldownMs
        ) {
            return {
                estado: ESTADO_SINCRONIZACAO.FALHA_RECENTE,
                ...referencia,
                ...(ultima.errorMessage ? { motivo: ultima.errorMessage } : {}),
            };
        }
        return this.rodarOuEmAndamento(input.triggeredBy, agora, referencia);
    };

    /** "Sincronizar agora" da tela: ignora TTL e cooldown, respeita "uma por vez". */
    public forcar = async (input: {
        triggeredBy: string;
        agora?: number;
    }): Promise<SincronizacaoAtualizacao> =>
        this.rodarOuEmAndamento(input.triggeredBy, input.agora ?? Date.now(), {});

    // ---------------------------------------------------------------- apoio

    private rodarOuEmAndamento = async (
        triggeredBy: string,
        agora: number,
        referencia: Pick<SincronizacaoAtualizacao, 'ultimaSincronizacaoEm' | 'idadeMin'>,
    ): Promise<SincronizacaoAtualizacao> => {
        try {
            const passada = await this.executarPassada({ triggeredBy });
            return {
                estado: ESTADO_SINCRONIZACAO.ATUALIZADA,
                ultimaSincronizacaoEm: new Date(agora).toISOString(),
                idadeMin: 0,
                passada,
                ...(passada.errorMessage ? { motivo: passada.errorMessage } : {}),
            };
        } catch (error) {
            // Outra passada ganhou a corrida pela trava: é contenção, não falha.
            if (error instanceof IngestLockBusyError) {
                return { estado: ESTADO_SINCRONIZACAO.EM_ANDAMENTO, ...referencia };
            }
            throw error;
        }
    };

    private referencia = (
        ultimoSucesso: string | undefined,
        agora: number,
    ): Pick<SincronizacaoAtualizacao, 'ultimaSincronizacaoEm' | 'idadeMin'> =>
        ultimoSucesso
            ? {
                  ultimaSincronizacaoEm: ultimoSucesso,
                  idadeMin: Math.max(0, Math.floor((agora - Date.parse(ultimoSucesso)) / MIN_MS)),
              }
            : {};

    /**
     * Corpo da passada (antes no job). "Nenhum título lido" é `error`, não resultado vazio: em
     * 23/09 a senha dos crons estava desatualizada e a ingestão fechou `success` com 0 títulos.
     */
    private rodar = async (triggeredBy: string): Promise<PassadaSincronizacao> => {
        const runId = await this.runRepo.createRun({
            pipeline: PIPELINE.SISPAG_SINCRONIZACAO,
            triggeredBy,
        });
        await this.logService.info({
            type: LOG_TYPE.FLOW_START,
            message: 'sincronização de lotes SISPAG: início',
            data: { runId, triggeredBy },
        });
        const { sispagLotesSyncPrazoSeg } = await this.environmentProvider.getEnvironmentVars();
        // Prazo da passada: uma leitura pendurada no Conexos não pode prender a trava (e deixar a
        // abertura em "em andamento" e o cron pulando) até o processo reiniciar.
        const prazo = new TimeoutExecutor({ deadlineMs: sispagLotesSyncPrazoSeg * 1000 });
        try {
            const resumo = await prazo.execute((sinal) =>
                this.sincronizacao.sincronizarTodos(new Date(), sinal),
            );
            return await this.fechar(runId, resumo);
        } catch (error) {
            const errorMessage =
                error instanceof DeadlineExceededError
                    ? `passada excedeu o prazo de ${sispagLotesSyncPrazoSeg} s e foi interrompida — os lotes restantes ficam para a próxima`
                    : redactErrorMessage(error instanceof Error ? error.message : String(error));
            await this.runRepo.finishRun({ runId, status: JOB_RUN_STATUS.ERROR, errorMessage });
            await this.logService.error({
                type: LOG_TYPE.FLOW_ERROR,
                message: 'sincronização de lotes SISPAG falhou',
                data: { runId, errorMessage },
            });
            return { runId, status: JOB_RUN_STATUS.ERROR, errorMessage };
        }
    };

    private fechar = async (
        runId: string,
        resumo: ResumoSincronizacao,
    ): Promise<PassadaSincronizacao> => {
        const todasFalharam = resumo.lotes > 0 && resumo.falhasLeitura === resumo.lotes;
        const parcial =
            resumo.falhasLeitura > 0 || resumo.pulados > 0 || resumo.eventosNaoLidos > 0;
        const status: StatusPassada = todasFalharam
            ? JOB_RUN_STATUS.ERROR
            : parcial
              ? JOB_RUN_STATUS.PARTIAL
              : JOB_RUN_STATUS.SUCCESS;
        const errorMessage = todasFalharam
            ? 'nenhum título pôde ser lido no Conexos (credencial? sessão?) — nada foi sincronizado'
            : undefined;
        const metricas = {
            lotesLidos: resumo.lotes,
            transicionados: resumo.transicionados,
            atualizados: resumo.atualizados,
            semMudanca: resumo.semMudanca,
            pulados: resumo.pulados,
            falhasLeitura: resumo.falhasLeitura,
            eventosNaoLidos: resumo.eventosNaoLidos,
        };
        await this.runRepo.finishRun({
            runId,
            status,
            metricas,
            ...(errorMessage ? { errorMessage } : {}),
        });
        const log = {
            type: todasFalharam ? LOG_TYPE.FLOW_ERROR : LOG_TYPE.FLOW_COMPLETE,
            message: todasFalharam
                ? 'sincronização de lotes SISPAG: todas as leituras falharam'
                : 'sincronização de lotes SISPAG: fim',
            data: {
                runId,
                ...metricas,
                resultados: resumo.resultados.map((r) => ({
                    loteId: r.loteId,
                    filCod: r.filCod,
                    resultado: r.resultado,
                    de: r.statusAntes,
                    para: r.statusDepois,
                    itensIlegiveis: r.itensIlegiveis,
                })),
            },
        };
        if (todasFalharam) await this.logService.error(log);
        else await this.logService.info(log);
        return { runId, status, resumo, ...(errorMessage ? { errorMessage } : {}) };
    };
}
