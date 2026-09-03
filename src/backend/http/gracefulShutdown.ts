/**
 * Shutdown gracioso (BE-06).
 *
 * Todo deploy no Render manda SIGTERM. Sem handler, o Node morre no ato e corta
 * o que estiver em voo. Aqui isso não é abstrato: uma requisição interrompida
 * entre o `createRun` e o `finishRun` deixa a execução parada em `reconciling` —
 * exatamente o órfão que o `.github/workflows/reaper-sispag.yml` varre de 15 em
 * 15 minutos. O detector do sintoma já existia; isto remove a causa mais
 * frequente.
 *
 * Vive em módulo próprio, e não inline no `index.ts`, porque `index.ts` dispara
 * `start()` no import — importá-lo num teste subiria o servidor. Todas as
 * dependências entram por parâmetro (server, closePool, onExit), então a máquina
 * de estados é testável sem processo, sem porta e sem banco.
 */

/** Sinais que devem virar drenagem, não corte. */
export const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Teto da drenagem. 10s cabe folgado nos ~30s que o Render espera entre o
 * SIGTERM e o SIGKILL — se estourar, saímos por conta própria em vez de ser
 * mortos no meio.
 */
export const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

export interface GracefulShutdownDeps {
    /** Retorno de `app.listen`. Só precisamos de `close`. */
    server: { close: (callback?: (err?: Error) => void) => unknown };
    /** Encerra o pool do Postgres (`PostgreeDatabaseClient.close`). */
    closePool: () => Promise<void>;
    /** Sai do processo. Injetado para o teste não matar o runner do Jest. */
    onExit: (code: number) => void;
    drainTimeoutMs?: number;
    log?: (message: string) => void;
}

interface SignalTarget {
    on: (signal: NodeJS.Signals, listener: () => void) => unknown;
}

const asMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/**
 * Monta o handler de sinal. Sequência: para de aceitar conexões novas
 * (`server.close`) → aguarda as em voo → encerra o pool → sai com 0.
 */
export const createShutdownHandler = (deps: GracefulShutdownDeps): ((signal: string) => void) => {
    const drainTimeoutMs = deps.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    const log = deps.log ?? ((message: string) => console.log(message));
    let shuttingDown = false;

    return (signal: string): void => {
        // Idempotente: o orquestrador pode repetir o sinal, e o operador
        // impaciente pode mandar um segundo Ctrl-C.
        if (shuttingDown) {
            log(`[shutdown] ${signal} ignorado — encerramento já em andamento`);
            return;
        }
        shuttingDown = true;
        log(`[shutdown] ${signal} recebido — parando de aceitar novas conexões`);

        let exited = false;
        let forceExitTimer: ReturnType<typeof setTimeout> | undefined;

        const exitOnce = (reason: string): void => {
            if (exited) return;
            exited = true;
            if (forceExitTimer) clearTimeout(forceExitTimer);
            log(`[shutdown] ${reason}`);
            // Sempre 0: o processo está descendo por ordem do orquestrador, não
            // por falha. Sair com ≠0 marcaria o deploy como quebrado.
            deps.onExit(0);
        };

        // Armado em paralelo à drenagem: uma requisição pendurada não pode
        // impedir a saída até o SIGKILL.
        forceExitTimer = setTimeout(() => {
            exitOnce(`drenagem excedeu ${drainTimeoutMs}ms — saindo com requisições ainda em voo`);
        }, drainTimeoutMs);
        // Não segurar o event loop: se tudo drenar antes, este timer não deve
        // manter o processo vivo esperando o próprio timeout.
        const timerHandle = forceExitTimer as unknown as { unref?: () => void };
        if (typeof timerHandle.unref === 'function') timerHandle.unref();

        const drain = async (): Promise<void> => {
            try {
                await deps.closePool();
                log('[shutdown] pool de conexões encerrado');
            } catch (error) {
                // Falhar ao fechar o pool não pode virar processo zumbi que o
                // orquestrador precise matar com SIGKILL.
                log(`[shutdown] falha ao encerrar o pool: ${asMessage(error)}`);
            }
            exitOnce('requisições em voo concluídas');
        };

        deps.server.close((err?: Error) => {
            if (err) log(`[shutdown] server.close reportou: ${err.message}`);
            void drain();
        });
    };
};

/**
 * Registra o handler em SIGTERM e SIGINT. Devolve o handler para que o chamador
 * (ou o teste) possa dispará-lo diretamente.
 */
export const registerGracefulShutdown = (
    deps: GracefulShutdownDeps,
    target: SignalTarget = process,
): ((signal: string) => void) => {
    const handler = createShutdownHandler(deps);
    for (const signal of SHUTDOWN_SIGNALS) {
        target.on(signal, () => handler(signal));
    }
    return handler;
};
