import { markDraining } from './readinessState.js';
import { redactErrorMessage } from './redact.js';

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
 * dependências entram por parâmetro, então a máquina de estados é testável sem
 * processo, sem porta e sem banco.
 *
 * Sequência: marca o processo como não-pronto → libera keep-alive ociosas → para
 * de aceitar conexões → aguarda as em voo → libera recursos → sai com 0.
 */

/** Sinais que devem virar drenagem, não corte. */
export const SHUTDOWN_SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

/**
 * Teto da drenagem.
 *
 * O Render dá ~30s entre SIGTERM e SIGKILL. Os 10s originais usavam só 1/3 do
 * envelope e força-cortavam qualquer requisição entre 10s e ~28s — reproduzindo o
 * mesmo órfão `reconciling` que este módulo existe para eliminar, apenas com log.
 * 25s aproveita ~83% do envelope e deixa ~5s de folga para encerrar recursos e
 * sair limpo antes do SIGKILL (card `fault-tolerance-1`).
 *
 * NOTA: a instância axios do Conexos (`services/conexos.ts`) tem `timeout: 40000`,
 * acima deste teto — uma chamada ao ERP que passe de 25s ainda é cortada aqui.
 * Alinhar os dois exige medir a latência real do Conexos; ficou como follow-up,
 * porque baixar o timeout do ERP é mudança de comportamento de negócio, não de
 * infra, e não se faz às cegas.
 */
export const DEFAULT_DRAIN_TIMEOUT_MS = 25_000;

/**
 * Lê o teto da drenagem do ambiente (card `modifiability-2`).
 *
 * O número certo depende do orquestrador, não do código: o Render dá ~30s, outro alvo pode dar 10s
 * ou 120s. Amarrado em constante, descobrir isso em produção exige redeploy. Valor inválido
 * (não-numérico, zero, negativo) cai no default em vez de desligar o teto — um drain sem limite é
 * exatamente o modo de falha que o timer existe para impedir.
 */
export const resolveDrainTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
    const bruto = Number(env.SHUTDOWN_DRAIN_TIMEOUT_MS);
    return Number.isFinite(bruto) && bruto > 0 ? bruto : DEFAULT_DRAIN_TIMEOUT_MS;
};

export interface GracefulShutdownDeps {
    /** Retorno de `app.listen`. */
    server: {
        close: (callback?: (err?: Error) => void) => unknown;
        /** Node ≥18.2. Opcional: fakes de teste e runtimes antigos não têm. */
        closeIdleConnections?: () => void;
    };
    /** Libera os recursos do processo (pools, sockets) — ver `http/lifecycle.ts`. */
    closeResources: () => Promise<void>;
    /** Sai do processo. Injetado para o teste não matar o runner do Jest. */
    onExit: (code: number) => void;
    /**
     * Publica o force-exit num canal estruturado (painel `/operacao`). Sem isto o
     * estouro de drenagem só existia em `console.log`: uma rota que SEMPRE estoura
     * truncaria requisições a cada restart sem ninguém ver — a categoria de falha
     * invisível que a ADR-0042 gastou um workflow inteiro para eliminar.
     */
    onForceExit?: (reason: string) => void | Promise<void>;
    drainTimeoutMs?: number;
    log?: (message: string) => void;
}

interface SignalTarget {
    on: (signal: NodeJS.Signals, listener: () => void) => unknown;
}

const asMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/**
 * Mensagem de erro pronta para o stdout. O drain de logs do Render sai do
 * perímetro do processo, então o que vai para o stdout é o que efetivamente
 * escapa — e o `pg`, ao rejeitar `end()` sobre um pool quebrado, traz usuário do
 * Postgres e host interno do Supabase na mensagem (card `security-1`).
 */
const safeMessage = (error: unknown): string => redactErrorMessage(asMessage(error));

export const createShutdownHandler = (deps: GracefulShutdownDeps): ((signal: string) => void) => {
    const drainTimeoutMs = deps.drainTimeoutMs ?? resolveDrainTimeoutMs();
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

        // ANTES do `server.close`: enquanto `/health` responder 200, o balanceador
        // segue livre para rotear requisição nova por keep-alive já aberta.
        markDraining();

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
            void (async () => {
                // A drenagem pode ter concluído enquanto o timer esperava na fila.
                if (exited) return;
                const reason = `drenagem excedeu ${drainTimeoutMs}ms — saindo com requisições ainda em voo`;
                try {
                    await deps.onForceExit?.(reason);
                } catch (error) {
                    // Falhar ao publicar o alerta não pode impedir a saída.
                    log(`[shutdown] falha ao publicar o force-exit: ${safeMessage(error)}`);
                }
                exitOnce(reason);
            })();
        }, drainTimeoutMs);
        // Não segurar o event loop: se tudo drenar antes, este timer não deve
        // manter o processo vivo esperando o próprio timeout.
        const timerHandle = forceExitTimer as unknown as { unref?: () => void };
        if (typeof timerHandle.unref === 'function') timerHandle.unref();

        const drain = async (): Promise<void> => {
            try {
                await deps.closeResources();
                log('[shutdown] recursos encerrados');
            } catch (error) {
                // Falhar ao fechar recurso não pode virar processo zumbi que o
                // orquestrador precise matar com SIGKILL.
                log(`[shutdown] falha ao encerrar recursos: ${safeMessage(error)}`);
            }
            exitOnce('requisições em voo concluídas');
        };

        // `server.close` só chama o callback quando TODAS as conexões TCP
        // fecharam — keep-alive ociosas inclusive. Como o balanceador do Render
        // mantém keep-alive, sem isto o drain estouraria o teto praticamente
        // sempre, tornando o caminho feliz indistinguível do force-exit.
        if (typeof deps.server.closeIdleConnections === 'function') {
            deps.server.closeIdleConnections();
            log('[shutdown] conexões keep-alive ociosas liberadas');
        }

        deps.server.close((err?: Error) => {
            if (err) log(`[shutdown] server.close reportou: ${safeMessage(err)}`);
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
