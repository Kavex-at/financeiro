/** Superfície mínima — evita arrastar o tipo `Pool` do `pg` para quem só quer encerrar. */
export interface EndablePool {
    end: () => Promise<unknown>;
}

/**
 * Encerra um pool engolindo a rejeição (card `modifiability-1`).
 *
 * O idiom `void pool.end().catch(() => undefined)` aparecia em três sítios — o handler de `error`
 * e o `close()` do `PostgreeDatabaseClient`, e o handler do `conexosSessionStore`. Repetido, é
 * questão de tempo até alguém escrever `pool.end()` seco num quarto lugar e derrubar o processo
 * por unhandled rejection, que é exatamente o que o `.catch` está ali para impedir: `end()` sobre
 * um pool já quebrado **rejeita**.
 *
 * Deliberadamente silencioso. Quem chama está descartando um pool que já falhou, ou saindo — não
 * há a quem reportar, e um log aqui viraria ruído em todo shutdown.
 */
export const endPoolQuietly = (pool: EndablePool): void => {
    void pool.end().catch(() => undefined);
};

/** Versão aguardável, para o caminho de shutdown que precisa esperar as conexões voltarem. */
export const endPoolQuietlyAsync = async (pool: EndablePool): Promise<void> => {
    try {
        await pool.end();
    } catch {
        // Ver acima: pool já quebrado rejeita, e estamos descartando de qualquer forma.
    }
};
