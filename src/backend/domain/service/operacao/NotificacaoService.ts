import { inject, injectable, injectAll } from 'tsyringe';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import type { Alerta, AlertaNovo, SinkResultado } from '../../interface/operacao/Alerta.js';
import { ALERT_SINKS_TOKEN, type AlertSink } from '../../interface/operacao/AlertSink.js';
import AlertaRepository from '../../repository/operacao/AlertaRepository.js';
import LogService from '../LogService.js';

/**
 * NotificacaoService — dedup + fan-out para os sinks (ADR-0042).
 *
 * Duas garantias, e elas são o ponto inteiro deste serviço:
 *
 * **Dedup.** O mesmo incidente na mesma janela não gera segundo alerta. Um staleness que dispara a
 * cada rodada do detector vira ruído, e um canal ruidoso é um canal que o time aprende a ignorar —
 * o modo de falha mais caro de um sistema de alerta, porque desativa todos os outros junto. A trava
 * é do banco (`ux_alerta_dedup`), não daqui: dois detectores concorrentes não podem escapar dela.
 *
 * **I5 — sink nunca derruba quem chamou.** Cada `entregar` é isolado. Alerting que causa o
 * incidente que ele existe para vigiar seria o pior desfecho possível. Mas a falha também não passa
 * em silêncio: vira `SinkResultado.ok=false` gravado no próprio alerta, para que "o alerta não
 * chegou" seja distinguível de "não houve alerta".
 */
@injectable()
export default class NotificacaoService {
    constructor(
        @inject(AlertaRepository) private readonly alertaRepository: AlertaRepository,
        @injectAll(ALERT_SINKS_TOKEN) private readonly sinks: AlertSink[],
        @inject(LogService) private readonly logService: LogService,
    ) {}

    /**
     * Emite um alerta. Devolve o `Alerta` criado, ou `null` quando a dedup o suprimiu —
     * supressão é desfecho normal, não erro.
     */
    public emitir = async (novo: AlertaNovo): Promise<Alerta | null> => {
        const alerta = await this.alertaRepository.criarSeNovo(novo);
        if (alerta === null) return null;

        const resultados = await this.entregarATodos(alerta);
        await this.registrarEntrega(alerta.id, resultados);
        return { ...alerta, sinkResultados: resultados };
    };

    private entregarATodos = async (alerta: Alerta): Promise<SinkResultado[]> =>
        Promise.all(this.sinks.map((sink) => this.entregarSeguro(sink, alerta)));

    /** Isola UM sink. Nunca relança — ver I5 na docstring da classe. */
    private entregarSeguro = async (sink: AlertSink, alerta: Alerta): Promise<SinkResultado> => {
        try {
            await sink.entregar(alerta);
            return { sink: sink.nome, ok: true };
        } catch (error) {
            const erro = error instanceof Error ? error.message : String(error);
            await this.logService
                .error({
                    type: LOG_TYPE.BUSINESS_WARN,
                    message: `alert sink '${sink.nome}' falhou`,
                    data: { alertaId: alerta.id, tipo: alerta.tipo, alvo: alerta.alvo, erro },
                })
                .catch(() => undefined); // log é best-effort; não pode derrubar a entrega tampouco.
            return { sink: sink.nome, ok: false, erro };
        }
    };

    /**
     * Gravar o desfecho é best-effort: o alerta já existe, e perdê-lo agora seria pior.
     *
     * Best-effort, porém, NÃO é silencioso. A promessa desta classe é que "o alerta não chegou"
     * seja distinguível de "não houve alerta" — e ela mora justamente em `sinkResultados`. Se a
     * gravação falha, é exatamente essa distinção que se perde, e engolir a falha sem registro
     * quebraria a garantia no único momento em que ela importa.
     */
    private registrarEntrega = async (id: number, resultados: SinkResultado[]): Promise<void> => {
        try {
            await this.alertaRepository.registrarEntrega(id, resultados);
        } catch (error) {
            console.error(
                `[notificacao] alerta ${id} emitido, mas o desfecho dos sinks NÃO foi gravado:`,
                error instanceof Error ? error.message : String(error),
            );
        }
    };
}
