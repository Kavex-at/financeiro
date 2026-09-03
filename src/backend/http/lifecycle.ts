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

/**
 * Recurso com nome. O nome não é enfeite: sem ele, o log de um drain que falhou diz
 * apenas "algo não fechou", e às 2h da manhã a diferença entre "o pool do Postgres"
 * e "o pool do session store" é a diferença entre saber e adivinhar.
 */
export interface NamedCloseable {
    nome: string;
    recurso: Closeable;
}

export interface CloseAllFailure {
    nome: string;
    erro: unknown;
}

export interface CloseAllResult {
    /** Falhas ao fechar, já com o nome do recurso. Vazio = todos fecharam limpos. */
    errors: CloseAllFailure[];
}

/**
 * Fecha todos em paralelo e **nunca rejeita**.
 *
 * Rejeitar aqui seria o pior desfecho possível: um recurso quebrado impediria os
 * demais de serem liberados e travaria o shutdown, trocando uma saída limpa por um
 * SIGKILL — exatamente o que o drain existe para evitar. Os erros voltam como dado,
 * nomeados, para quem quiser logar.
 */
export const closeAll = async (closeables: readonly NamedCloseable[]): Promise<CloseAllResult> => {
    const settled = await Promise.allSettled(
        closeables.map(async ({ nome, recurso }) => {
            try {
                // Recurso sem `close` é o caso comum (stateless sobre HTTP), não um erro.
                if (typeof recurso?.close !== 'function') return;
                await recurso.close();
            } catch (erro) {
                // Reembrulha para o nome sobreviver ao `allSettled`.
                const falha: CloseAllFailure = { nome, erro };
                throw falha;
            }
        }),
    );

    return {
        errors: settled
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map((result) => result.reason as CloseAllFailure),
    };
};
