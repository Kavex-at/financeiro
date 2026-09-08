/**
 * Sequência de boot do servidor (card `testability-2`).
 *
 * **A ordem é o produto deste módulo.** MIGRA e só então aceita tráfego: o
 * `preDeployCommand` do `render.yaml` nunca rodou (serviço criado pelo dashboard;
 * pre-deploy é de plano pago), e em 2026-08-10 o código da ADR-0032 chegou a
 * produção antes da `0044` — chave natural nova contra banco velho. O `listen` é
 * inalcançável enquanto houver migração pendente.
 *
 * Vivia inline no `index.ts`, que dispara o boot no import: importá-lo num teste
 * subiria o servidor, então a sequência era invariante **documentada e não
 * testada** — exatamente a forma do incidente de 2026-08-10. Aqui cada passo
 * entra por parâmetro e a ordem vira asserção executável.
 */

export interface ServerHandle {
    close: (callback?: (err?: Error) => void) => unknown;
    closeIdleConnections?: () => void;
}

export interface BootstrapDeps {
    /** Aplica as migrações pendentes. Falhar aqui aborta o boot. */
    runMigrations: () => Promise<void>;
    /** Diagnóstico de configuração (ADR-0042). Depende das migrations. */
    diagnose: () => Promise<void>;
    /** Sobe o listener HTTP e devolve o handle do servidor. */
    listen: () => ServerHandle;
    /** Registra o shutdown gracioso sobre o servidor já no ar. */
    registerShutdown: (server: ServerHandle) => void;
}

/**
 * Executa o boot na ordem correta e devolve o servidor no ar.
 *
 * Não captura erro: quem chama decide o que fazer. Em produção, falhar ao migrar
 * derruba o processo com código 1 — o Render marca o deploy como falho e MANTÉM a
 * versão anterior no ar, que é o desfecho certo: melhor a release não subir do
 * que subir servindo contra um esquema que ninguém sabe qual é.
 */
export const startServer = async (deps: BootstrapDeps): Promise<ServerHandle> => {
    await deps.runMigrations();

    // DEPOIS das migrations, porque o alerta de `config-ausente` precisa da
    // tabela `alerta`.
    await deps.diagnose();

    const server = deps.listen();

    // DEPOIS do listen: registrar o shutdown sobre um servidor que ainda não
    // existe não teria o que drenar.
    deps.registerShutdown(server);

    return server;
};
