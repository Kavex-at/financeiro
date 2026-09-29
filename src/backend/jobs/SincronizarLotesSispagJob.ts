import { inject, injectable } from 'tsyringe';
import { LOG_TYPE } from '../domain/interface/log/LogInterface.js';
import { JOB_RUN_STATUS, PIPELINE } from '../domain/interface/operacao/JobRun.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import JobExecucaoRepository from '../domain/repository/operacao/JobExecucaoRepository.js';
import LogService from '../domain/service/LogService.js';
import SincronizacaoLoteService, {
    type ResumoSincronizacao,
} from '../domain/service/sispag/SincronizacaoLoteService.js';

/**
 * Corpo do job `sincronizar-lotes-sispag` (L11, ADR-0055) — separado do ponto de entrada para
 * ser testável sem subir container, banco nem Conexos.
 *
 * Exit code ≠ 0 quando TODAS as leituras falham. Em 23/09 a senha do Conexos dos crons estava
 * desatualizada e a ingestão fechou `success` com 0 títulos: o workflow ficou verde e ninguém
 * soube. Aqui, "nenhum título pôde ser lido" é falha do job, não um resultado vazio.
 */
@injectable()
export default class SincronizarLotesSispagJob {
    public constructor(
        @inject(SincronizacaoLoteService) private readonly sincronizacao: SincronizacaoLoteService,
        @inject(JobExecucaoRepository) private readonly runRepo: JobExecucaoRepository,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** Roda uma passada e devolve o exit code do processo. */
    public executar = async (triggeredBy: string): Promise<number> => {
        const runId = await this.runRepo.createRun({
            pipeline: PIPELINE.SISPAG_SINCRONIZACAO,
            triggeredBy,
        });
        await this.logService.info({
            type: LOG_TYPE.FLOW_START,
            message: 'sincronização de lotes SISPAG: início',
            data: { runId, triggeredBy },
        });
        try {
            const resumo = await this.sincronizacao.sincronizarTodos();
            return await this.fechar(runId, resumo);
        } catch (error) {
            const errorMessage = redactErrorMessage(
                error instanceof Error ? error.message : String(error),
            );
            await this.runRepo.finishRun({ runId, status: JOB_RUN_STATUS.ERROR, errorMessage });
            await this.logService.error({
                type: LOG_TYPE.FLOW_ERROR,
                message: 'sincronização de lotes SISPAG falhou',
                data: { runId, errorMessage },
            });
            return 1;
        }
    };

    private fechar = async (runId: string, resumo: ResumoSincronizacao): Promise<number> => {
        const todasFalharam = resumo.lotes > 0 && resumo.falhasLeitura === resumo.lotes;
        const parcial =
            resumo.falhasLeitura > 0 || resumo.pulados > 0 || resumo.eventosNaoLidos > 0;
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
            status: todasFalharam
                ? JOB_RUN_STATUS.ERROR
                : parcial
                  ? JOB_RUN_STATUS.PARTIAL
                  : JOB_RUN_STATUS.SUCCESS,
            metricas,
            ...(todasFalharam
                ? {
                      errorMessage:
                          'nenhum título pôde ser lido no Conexos (credencial? sessão?) — nada foi sincronizado',
                  }
                : {}),
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
        console.log(
            `[sincronizar-lotes-sispag] lotes lidos=${resumo.lotes} transicionados=${resumo.transicionados} ` +
                `atualizados=${resumo.atualizados} sem mudança=${resumo.semMudanca} pulados=${resumo.pulados} ` +
                `falhas de leitura=${resumo.falhasLeitura} eventos não lidos=${resumo.eventosNaoLidos}`,
        );
        return todasFalharam ? 1 : 0;
    };
}
