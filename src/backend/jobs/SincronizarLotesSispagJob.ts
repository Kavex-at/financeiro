import { inject, injectable } from 'tsyringe';
import IngestLockBusyError from '../domain/errors/IngestLockBusyError.js';
import { JOB_RUN_STATUS } from '../domain/interface/operacao/JobRun.js';
import { LOG_TYPE } from '../domain/interface/log/LogInterface.js';
import LogService from '../domain/service/LogService.js';
import SincronizacaoPassadaService from '../domain/service/sispag/SincronizacaoPassadaService.js';

/**
 * Corpo do job `sincronizar-lotes-sispag` (L11, ADR-0055) — separado do ponto de entrada para
 * ser testável sem subir container, banco nem Conexos. A passada (trava + trilha em
 * `job_execucao`) é a mesma da abertura da tela e do "Sincronizar agora" (ADR-0066).
 *
 * Exit code ≠ 0 quando a passada fecha em `error` — inclusive "nenhum título pôde ser lido", que
 * em 23/09 teria ficado verde. Outra passada rodando (a tela de alguém) não é falha: exit 0.
 */
@injectable()
export default class SincronizarLotesSispagJob {
    public constructor(
        @inject(SincronizacaoPassadaService) private readonly passada: SincronizacaoPassadaService,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** Roda uma passada e devolve o exit code do processo. */
    public executar = async (triggeredBy: string): Promise<number> => {
        try {
            const { status, resumo } = await this.passada.executarPassada({ triggeredBy });
            if (resumo) {
                console.log(
                    `[sincronizar-lotes-sispag] lotes lidos=${resumo.lotes} transicionados=${resumo.transicionados} ` +
                        `atualizados=${resumo.atualizados} sem mudança=${resumo.semMudanca} pulados=${resumo.pulados} ` +
                        `falhas de leitura=${resumo.falhasLeitura} eventos não lidos=${resumo.eventosNaoLidos}`,
                );
            }
            return status === JOB_RUN_STATUS.ERROR ? 1 : 0;
        } catch (error) {
            if (error instanceof IngestLockBusyError) {
                await this.logService.info({
                    type: LOG_TYPE.BUSINESS_INFO,
                    message:
                        'sincronização de lotes SISPAG já em andamento — passada do cron pulada',
                    data: { triggeredBy },
                });
                console.log('[sincronizar-lotes-sispag] outra passada em andamento — nada a fazer');
                return 0;
            }
            throw error;
        }
    };
}
