import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';

/**
 * Rede de último recurso para erro que ninguém tratou (card `fault-tolerance-3`).
 *
 * Sem isto, uma `unhandledRejection` ou uma `uncaughtException` derruba o processo **sem passar
 * pelo drain**: requisições em voo são cortadas no ato, e uma delas interrompida entre o
 * `createRun` e o `finishRun` deixa execução órfã em `reconciling` — o mesmo defeito que o
 * shutdown gracioso veio eliminar, por uma porta que ele não cobria.
 *
 * **Não engole o erro.** O processo continua morrendo — um estado corrompido não deve seguir
 * servindo. O que muda é COMO: sai com código 1 depois de tentar drenar, e o erro fica registrado
 * de forma redigida em vez de sumir no `process.exit` implícito do Node.
 *
 * Código 1 aqui, e não 0 como no SIGTERM, porque a distinção importa: SIGTERM é o orquestrador
 * pedindo para descer (deploy normal); isto é falha do programa, e o Render precisa marcar o
 * deploy como quebrado.
 */
export interface LastResortDeps {
    /** Libera os recursos do processo. O mesmo do shutdown gracioso. */
    closeResources: () => Promise<void>;
    /** Sai do processo. Injetado para o teste não matar o runner do Jest. */
    onExit: (code: number) => void;
    /** Teto para a liberação de recursos — um `pool.end()` pendurado não pode segurar a saída. */
    closeTimeoutMs?: number;
    log?: (message: string, error: unknown) => void;
}

interface FatalTarget {
    on: (
        evento: 'unhandledRejection' | 'uncaughtException',
        listener: (erro: unknown) => void,
    ) => unknown;
}

export const DEFAULT_CLOSE_TIMEOUT_MS = 3_000;

const asMessage = (error: unknown): string =>
    error instanceof Error ? (error.stack ?? error.message) : String(error);

export const registerLastResortHandlers = (
    deps: LastResortDeps,
    target: FatalTarget = process,
): ((origem: string, erro: unknown) => void) => {
    const closeTimeoutMs = deps.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    const log =
        deps.log ??
        ((message: string, error: unknown) =>
            console.error(message, redactErrorMessage(asMessage(error))));
    let morrendo = false;

    const handler = (origem: string, erro: unknown): void => {
        // O segundo erro fatal durante a saída não pode reiniciar a sequência.
        if (morrendo) return;
        morrendo = true;
        log(`[fatal] ${origem} — encerrando com liberação de recursos:`, erro);

        let saiu = false;
        const exitOnce = (): void => {
            if (saiu) return;
            saiu = true;
            deps.onExit(1);
        };

        // Corrida deliberada: o que vier primeiro entre liberar os recursos e o teto.
        const timer = setTimeout(exitOnce, closeTimeoutMs);
        const handle = timer as unknown as { unref?: () => void };
        if (typeof handle.unref === 'function') handle.unref();

        void deps
            .closeResources()
            .catch(() => undefined)
            .then(() => {
                clearTimeout(timer);
                exitOnce();
            });
    };

    target.on('unhandledRejection', (erro) => handler('unhandledRejection', erro));
    target.on('uncaughtException', (erro) => handler('uncaughtException', erro));
    return handler;
};
