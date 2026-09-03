/**
 * Ciclo de vida dos recursos do processo (card `integrability-1`).
 *
 * Antes disto o shutdown chamava `container.resolve(PostgreeDatabaseClient).close()`
 * — acoplado à classe concreta. Cada novo client que segurasse recurso exigiria
 * editar o `index.ts`, e essa edição já tinha sido esquecida uma vez: o pool do
 * `conexosSessionStore` ficou fora do SIGTERM até o Regis-Review achá-lo.
 *
 * Aqui o shutdown fecha uma *coleção*, e entrar na coleção é o único requisito.
 */

/** O mínimo que `closeAll` precisa — deliberadamente menor que `IClient`. */
export interface Closeable {
    close?: () => Promise<void>;
}

export interface CloseAllResult {
    /** Erros de quem falhou ao fechar. Vazio = todos fecharam limpos. */
    errors: unknown[];
}

/**
 * Fecha todos em paralelo e **nunca rejeita**.
 *
 * Rejeitar aqui seria o pior desfecho possível: um client quebrado impediria os
 * demais de liberar seus recursos e travaria o shutdown, trocando uma saída limpa
 * por um SIGKILL — exatamente o que o drain existe para evitar. Os erros voltam
 * como dado para quem quiser logar.
 */
export const closeAll = async (closeables: readonly Closeable[]): Promise<CloseAllResult> => {
    const settled = await Promise.allSettled(
        closeables.map(async (closeable) => {
            // Client sem `close` é o caso comum (stateless sobre HTTP), não um erro.
            if (typeof closeable?.close !== 'function') return;
            await closeable.close();
        }),
    );

    return {
        errors: settled
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result) => result.reason),
    };
};
