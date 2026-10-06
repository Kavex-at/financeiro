import { inject, injectable } from 'tsyringe';
import { LOG_TYPE } from '../domain/interface/log/LogInterface.js';
import { JOB_RUN_STATUS, PIPELINE } from '../domain/interface/operacao/JobRun.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import JobExecucaoRepository from '../domain/repository/operacao/JobExecucaoRepository.js';
import LogService from '../domain/service/LogService.js';
import PerfilCanalService, {
    type ResumoPerfilCanal,
} from '../domain/service/sispag/PerfilCanalService.js';

/**
 * Corpo do job `calcular-perfil-canal` (ADR-0063, I13i) — separado do ponto de entrada para ser
 * testável sem subir container, banco nem Conexos.
 *
 * Exit code ≠ 0 (e run `error`) quando:
 *   - alguma leitura do Conexos falhou: a rodada NÃO grava e os perfis anteriores valem;
 *   - a rodada não produziu perfil nenhum: zero perfis é sinal de leitura vazia (credencial,
 *     sessão, filtro), não um resultado — em 23/09 uma ingestão fechou `success` com 0 títulos e
 *     ninguém viu. Aqui o mesmo cenário fica VERMELHO.
 */
@injectable()
export default class CalcularPerfilCanalJob {
    public constructor(
        @inject(PerfilCanalService) private readonly perfil: PerfilCanalService,
        @inject(JobExecucaoRepository) private readonly runRepo: JobExecucaoRepository,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    public executar = async (triggeredBy: string): Promise<number> => {
        const runId = await this.runRepo.createRun({
            pipeline: PIPELINE.SISPAG_PERFIL_CANAL,
            triggeredBy,
        });
        await this.logService.info({
            type: LOG_TYPE.FLOW_START,
            message: 'perfil de canal: início',
            data: { runId, triggeredBy },
        });
        try {
            const resumo = await this.perfil.calcular({ jobRunId: runId });
            return await this.fechar(runId, resumo);
        } catch (error) {
            const errorMessage = redactErrorMessage(
                error instanceof Error ? error.message : String(error),
            );
            try {
                await this.runRepo.finishRun({ runId, status: JOB_RUN_STATUS.ERROR, errorMessage });
            } catch {
                // O log abaixo sai mesmo assim; a run presa em `running` é vista pela staleness.
            }
            await this.logService.error({
                type: LOG_TYPE.FLOW_ERROR,
                message: 'perfil de canal falhou',
                data: { runId, errorMessage },
            });
            return 1;
        }
    };

    private fechar = async (runId: string, resumo: ResumoPerfilCanal): Promise<number> => {
        const metricas = {
            filiais: resumo.filiais,
            contas: resumo.contas,
            debitos: resumo.debitos,
            borderos: resumo.borderos,
            baixas: resumo.baixas,
            fornecedoresLidos: resumo.perfis,
            perfisAlta: resumo.porConfianca.ALTA,
            perfisMedia: resumo.porConfianca.MEDIA,
            perfisBaixa: resumo.porConfianca.BAIXA,
            ambiguosDescartados: resumo.ambiguos,
            semDebitoCasado: resumo.semDebito,
            semFavorecido: resumo.semFavorecido,
            falhasLeitura: resumo.falhasLeitura,
        };
        const motivoErro =
            resumo.falhasLeitura > 0
                ? `${resumo.falhasLeitura} leitura(s) do Conexos falharam — rodada não gravada, perfis anteriores mantidos`
                : resumo.perfis === 0
                  ? 'nenhum perfil calculado (leitura vazia? credencial? sessão?) — nada gravado'
                  : undefined;
        await this.runRepo.finishRun({
            runId,
            status: motivoErro ? JOB_RUN_STATUS.ERROR : JOB_RUN_STATUS.SUCCESS,
            metricas,
            ...(motivoErro ? { errorMessage: motivoErro } : {}),
        });
        const log = {
            type: motivoErro ? LOG_TYPE.FLOW_ERROR : LOG_TYPE.FLOW_COMPLETE,
            message: motivoErro ? `perfil de canal: ${motivoErro}` : 'perfil de canal: fim',
            data: {
                runId,
                ...metricas,
                gravado: resumo.gravado,
                janelaInicio: new Date(resumo.janelaInicio).toISOString(),
                janelaFim: new Date(resumo.janelaFim).toISOString(),
            },
        };
        if (motivoErro) await this.logService.error(log);
        else await this.logService.info(log);
        console.log(
            `[calcular-perfil-canal] fornecedores=${resumo.perfis} ALTA=${resumo.porConfianca.ALTA} ` +
                `MEDIA=${resumo.porConfianca.MEDIA} BAIXA=${resumo.porConfianca.BAIXA} ` +
                `ambíguos descartados=${resumo.ambiguos} baixas=${resumo.baixas} débitos=${resumo.debitos} ` +
                `falhas de leitura=${resumo.falhasLeitura} gravado=${resumo.gravado ? 'sim' : 'não'}`,
        );
        return motivoErro ? 1 : 0;
    };
}
