import { container } from 'tsyringe';
import { ALERT_SINKS_TOKEN } from './interface/operacao/AlertSink.js';
import DbAlertSink from './service/operacao/DbAlertSink.js';

/**
 * Registra os `AlertSink` do Painel de Operação (ADR-0042).
 *
 * Hoje só o `DbAlertSink` — o painel é o próprio canal, e é isso que faz o alerting funcionar sem
 * credencial nenhuma. `EmailAlertSink` entra AQUI, numa linha, quando o acesso existir: é o ponto
 * que torna "ligar e-mail" um flip de configuração em vez de uma reescrita.
 *
 * Idempotente, e a idempotência pergunta ao CONTAINER, não a um booleano de módulo. Registrar duas
 * vezes duplicaria a entrega de todo alerta; mas um flag de módulo sobreviveria a um
 * `container.reset()` e faria a função recusar-se a registrar num container já limpo — que é
 * exatamente o estado em que ela mais precisa agir.
 */
export const registerOperacaoSinks = (): void => {
    if (container.isRegistered(ALERT_SINKS_TOKEN)) return;
    container.registerSingleton(ALERT_SINKS_TOKEN, DbAlertSink);
};
