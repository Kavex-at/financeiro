import type { Alerta } from './Alerta.js';

/**
 * Port de saída de alerta (ADR-0042).
 *
 * Existe para que ligar e-mail seja um **flip de configuração e não uma reescrita**. O canal
 * preferido é e-mail, mas o acesso é mais difícil de obter e foi decidido que isso não pode
 * bloquear o slice — então `DbAlertSink` entra agora e `EmailAlertSink` entra atrás de config,
 * quando houver credencial. O vendor NÃO é escolhido aqui: escolher sem ter o acesso seria decidir
 * sem informação.
 *
 * **I5 — um sink nunca derruba quem o chamou.** `NotificacaoService` isola cada `entregar`; a falha
 * vira `SinkResultado.ok=false`, não uma exceção que sobe. Alerting que causa o incidente que ele
 * existe para vigiar seria o pior desfecho possível.
 */
export interface AlertSink {
    /** Nome curto, gravado em `sink_resultados` para diagnóstico. */
    readonly nome: string;
    entregar(alerta: Alerta): Promise<void>;
}

/** Token tsyringe do array de sinks registrados. */
export const ALERT_SINKS_TOKEN = Symbol.for('AlertSinks');
