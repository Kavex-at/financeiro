/** Uma mensagem do envelope `{ messages: [...] }` do Conexos. `message` é a KEY, não o texto. */
export interface ErpMessage {
    valid?: string;
    message?: string;
    vars?: Record<string, unknown>;
}

/**
 * Leitura CRUA da resposta de erro do Conexos — o que o ERP disse, sem tradução nem julgamento
 * de negócio. Existe para que os dois lados que precisam desse dado leiam do MESMO lugar:
 *
 *   - `ConexosError`, que classifica a falha em RECUSA (determinística) × INDISPONIBILIDADE;
 *   - `ErpErrorInterpreter`, que traduz a razão para o texto que o analista lê.
 *
 * Sem este ponto único as duas leituras divergiriam com o tempo — e já divergiam: a política
 * central de retry declarava "4xx do ERP não é retentável" enquanto todo `ConexosError` nascia
 * `retryable: true`.
 *
 * Estático de propósito: é leitura pura de um payload, não tem estado nem dependência.
 * NUNCA lança — todo consumidor está num caminho de tratamento de erro, onde um throw vira
 * um 500 genérico justo no caso que o surfacing existe para explicar.
 */
export default class ErpResponseReader {
    /**
     * 4xx que NÃO são veredito do servidor sobre o pedido: 408 é o próprio timeout devolvido pelo
     * upstream e 429 é "peça de novo mais devagar". Ambos podem mudar de resultado numa retentativa.
     */
    private static readonly TRANSIENT_4XX: readonly number[] = [408, 429];

    /** Profundidade máxima ao andar pela cadeia de `cause` — barreira contra ciclo. */
    private static readonly MAX_DEPTH = 8;

    /**
     * A `response` do axios, esteja ela no erro ou aninhada num `cause` (um `ConexosError` pode
     * envolver outro). Anda a cadeia inteira: parar no primeiro nível perde o status.
     */
    public static responseOf = (err: unknown): { status?: number; data?: unknown } | undefined => {
        let current = err as { response?: { status?: number; data?: unknown }; cause?: unknown };
        for (let depth = 0; depth < ErpResponseReader.MAX_DEPTH; depth += 1) {
            if (current === null || typeof current !== 'object') return undefined;
            if (current.response !== undefined) return current.response;
            current = current.cause as typeof current;
        }
        return undefined;
    };

    /** O status HTTP do upstream, quando houve resposta (rede/timeout não têm). */
    public static statusOf = (err: unknown): number | undefined => {
        const status = ErpResponseReader.responseOf(err)?.status;
        return typeof status === 'number' ? status : undefined;
    };

    /**
     * O ERP RECUSOU o pedido — um veredito sobre o conteúdo, não uma indisponibilidade. Repetir
     * devolve exatamente a mesma resposta, então retentar só gasta chamada e atrasa o diagnóstico.
     */
    public static isDeterministicRefusal = (err: unknown): boolean => {
        const status = ErpResponseReader.statusOf(err);
        if (status === undefined) return false;
        return status >= 400 && status < 500 && !ErpResponseReader.TRANSIENT_4XX.includes(status);
    };

    /**
     * Prefere a 1ª mensagem `valid==='ERRO'`; senão a 1ª do envelope. Robusto a envelope malformado
     * (não-array, itens nulos).
     */
    public static pickMessage = (messages?: ErpMessage[]): ErpMessage | undefined => {
        if (!Array.isArray(messages)) return undefined;
        return messages.find((m) => m?.valid === 'ERRO') ?? messages[0];
    };

    /** `vars.msg` — a razão REAL, que o envelope `Generic.ERROR_MESSAGE` esconde. */
    public static reasonOf = (msg?: ErpMessage): string | undefined => {
        const raw = msg?.vars?.msg;
        if (typeof raw !== 'string') return undefined;
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    };

    /**
     * O que o ERP disse, em uma linha: razão real (`vars.msg`) quando existe, senão a KEY crua
     * (`CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE`, `FIN_014.*`, …). A KEY não é bonita, mas é
     * rastreável — é o que o suporte da Conexos procura no log deles.
     */
    public static rawReasonOf = (err: unknown): string | undefined => {
        const data = ErpResponseReader.responseOf(err)?.data as
            | { messages?: ErpMessage[] }
            | undefined;
        const picked = ErpResponseReader.pickMessage(data?.messages);
        return ErpResponseReader.reasonOf(picked) ?? picked?.message;
    };
}
