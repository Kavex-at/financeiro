import 'reflect-metadata';
import { container } from 'tsyringe';
import { ALERT_SINKS_TOKEN, type AlertSink } from './interface/operacao/AlertSink.js';
import { registerOperacaoSinks } from './operacaoContainer.js';

describe('registerOperacaoSinks', () => {
    it('registra o DbAlertSink de forma resolvível por @injectAll', () => {
        registerOperacaoSinks();
        const sinks = container.resolveAll<AlertSink>(ALERT_SINKS_TOKEN);

        // Um array vazio aqui significaria alerting silenciosamente morto — o modo de falha
        // mais perigoso desta feature, porque a tela pareceria saudável.
        expect(sinks.length).toBeGreaterThan(0);
        expect(sinks.map((s) => s.nome)).toContain('painel');
    });

    it('é idempotente — registrar duas vezes não duplica a entrega', () => {
        registerOperacaoSinks();
        registerOperacaoSinks();
        const nomes = container.resolveAll<AlertSink>(ALERT_SINKS_TOKEN).map((s) => s.nome);
        expect(nomes.filter((n) => n === 'painel')).toHaveLength(1);
    });
});
