import { container } from 'tsyringe';
import { ALERT_SINKS_TOKEN } from './interface/operacao/AlertSink.js';
import DbAlertSink from './service/operacao/DbAlertSink.js';

let registered = false;

/**
 * Registra os `AlertSink` do Painel de Operação (ADR-0042).
 *
 * Hoje só o `DbAlertSink` — o painel é o próprio canal, e é isso que faz o alerting funcionar sem
 * credencial nenhuma. `EmailAlertSink` entra AQUI, numa linha, quando o acesso existir: é o ponto
 * que torna "ligar e-mail" um flip de configuração em vez de uma reescrita.
 *
 * Idempotente: `registerMany` acumula, então registrar duas vezes duplicaria as entregas.
 */
export const registerOperacaoSinks = (): void => {
    if (registered) return;
    container.registerSingleton(ALERT_SINKS_TOKEN, DbAlertSink);
    registered = true;
};
