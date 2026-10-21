import { inject, injectable } from 'tsyringe';
import {
    DESFECHO_LIMPEZA,
    type LimpezaBorderoGrupoInterface,
} from '../../interface/sispag/BorderoGrupoBoletoInterface.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import { ALERTA_SEVERIDADE, ALERTA_TIPO } from '../../interface/operacao/Alerta.js';
import EtapaBorderoGrupo, { ETAPA_BORDERO_GRUPO } from '../../libs/boleto/EtapaBorderoGrupo.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import GrupoBoletoExecucaoRepository, {
    type GrupoBoletoExecucao,
} from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import LogService from '../LogService.js';
import NotificacaoService from '../operacao/NotificacaoService.js';
import BorderoGrupoBoletoService from './BorderoGrupoBoletoService.js';

/** Motivo gravado na trilha/log da limpeza disparada pelo cancelamento do lote local (G3). */
export const MOTIVO_LIMPEZA_LOTE_CANCELADO = 'LOTE_CANCELADO';

export interface ResumoLimpezaAposCancelamento {
    execucoes: number;
    limpas: number;
    pendentes: number;
    falhas: number;
}

/**
 * DisparoLimpezaBorderoGrupo — L5 do lote com grupo de boleto (ADR-0077, I21q; G3 de
 * 2026-10-20): o lote local SEMPRE cancela; DEPOIS do commit, cada execução de borderô do lote
 * que ainda admite limpeza é entregue à limpeza (`LimpezaBorderoGrupoInterface`, implementada
 * pelo `BorderoGrupoBoletoService`, que confere ao vivo o lote nativo e a identidade do borderô
 * e respeita o kill-switch). Falha da limpeza nunca desfaz o cancelamento nem sobe para a tela:
 * vira `Alerta` `sispag-bordero-grupo-pendente` e o borderô fica para a analista.
 */
@injectable()
export default class DisparoLimpezaBorderoGrupo {
    public constructor(
        @inject(GrupoBoletoExecucaoRepository)
        private readonly execucoes: GrupoBoletoExecucaoRepository,
        @inject(BorderoGrupoBoletoService) private readonly limpeza: LimpezaBorderoGrupoInterface,
        @inject(NotificacaoService) private readonly notificacao: NotificacaoService,
        @inject(BankingCalendar) private readonly calendar: BankingCalendar,
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /** Chamado depois do commit do cancelamento. Nunca lança. */
    public aposCancelarLote = async (input: {
        loteId: string;
        ator: string;
    }): Promise<ResumoLimpezaAposCancelamento> => {
        const resumo: ResumoLimpezaAposCancelamento = {
            execucoes: 0,
            limpas: 0,
            pendentes: 0,
            falhas: 0,
        };
        let candidatas: GrupoBoletoExecucao[];
        try {
            candidatas = (await this.execucoes.listarPorLote(input.loteId)).filter((e) =>
                EtapaBorderoGrupo.podeTransicionar(e.etapa, ETAPA_BORDERO_GRUPO.LIMPO),
            );
        } catch (erro) {
            resumo.falhas += 1;
            await this.alertar({ loteId: input.loteId, ator: input.ator, erro });
            return resumo;
        }
        resumo.execucoes = candidatas.length;
        for (const execucao of candidatas) {
            try {
                const r = await this.limpeza.limpar({
                    execucao,
                    motivo: MOTIVO_LIMPEZA_LOTE_CANCELADO,
                });
                if (r.desfecho === DESFECHO_LIMPEZA.LIMPO) resumo.limpas += 1;
                if (r.desfecho === DESFECHO_LIMPEZA.PENDENTE) resumo.pendentes += 1;
            } catch (erro) {
                resumo.falhas += 1;
                await this.alertar({ loteId: input.loteId, ator: input.ator, execucao, erro });
            }
        }
        if (candidatas.length > 0) {
            await this.logService.info({
                type: LOG_TYPE.BUSINESS_INFO,
                message: 'limpeza do borderô do grupo após cancelar o lote',
                data: { loteId: input.loteId, ator: input.ator, ...resumo },
            });
        }
        return resumo;
    };

    private alertar = async (p: {
        loteId: string;
        ator: string;
        execucao?: GrupoBoletoExecucao;
        erro: unknown;
    }): Promise<void> => {
        const erro = p.erro instanceof Error ? p.erro.message : String(p.erro);
        const dados = {
            loteId: p.loteId,
            ator: p.ator,
            ...(p.execucao
                ? {
                      execucaoId: p.execucao.id,
                      grupoId: p.execucao.grupoId,
                      filCod: p.execucao.filCod,
                      ...(p.execucao.borCod !== undefined ? { borCod: p.execucao.borCod } : {}),
                      ...(p.execucao.flpCod !== undefined ? { flpCod: p.execucao.flpCod } : {}),
                  }
                : {}),
        };
        try {
            await this.logService.error({
                type: LOG_TYPE.BUSINESS_WARN,
                message: 'limpeza do borderô do grupo falhou após cancelar o lote',
                data: { ...dados, erro },
            });
            await this.notificacao.emitir({
                tipo: ALERTA_TIPO.SISPAG_BORDERO_GRUPO_PENDENTE,
                alvo: p.execucao
                    ? `${p.execucao.filCod}:grupo:${p.execucao.grupoId}`
                    : `lote:${p.loteId}`,
                severidade: ALERTA_SEVERIDADE.ERRO,
                janelaInicio: this.calendar.startOfTodayBrt(),
                detalhe: {
                    ...dados,
                    acao:
                        'o lote foi cancelado, mas o borderô do boleto agrupado não foi limpo no ' +
                        'Conexos: confira o borderô no fin010 e o item no lote nativo (fin015) e ' +
                        'exclua à mão se ainda estiverem lá',
                },
            });
        } catch (falhaDoAlerta) {
            await this.logService
                .error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: 'limpeza do borderô do grupo: alerta do painel não foi emitido',
                    data: {
                        ...dados,
                        erro:
                            falhaDoAlerta instanceof Error
                                ? falhaDoAlerta.message
                                : String(falhaDoAlerta),
                    },
                })
                .catch(() => undefined);
        }
    };
}
