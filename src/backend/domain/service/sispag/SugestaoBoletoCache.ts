import { injectable, singleton } from 'tsyringe';

/** TTL padrão do cenário: curto, para a lista acompanhar o sync e as decisões de outras pessoas. */
export const SUGESTAO_BOLETO_CACHE_TTL_MS = 30_000;

interface Entrada {
    valor: unknown;
    expiraEm: number;
}

/**
 * SugestaoBoletoCache — guarda, EM PROCESSO, o cenário calculado das sugestões de boleto (o motor
 * sobre a carteira inteira mais as leituras de banco de que ele precisa). Uma tela do SISPAG
 * dispara várias listagens de uma vez; sem isto cada uma recalculava o motor inteiro (PERF-1).
 *
 * - **Single-flight**: chamadas concorrentes com o cache vazio esperam a MESMA promessa em voo;
 *   o motor roda uma única vez. Falha não é guardada: a próxima chamada tenta de novo.
 * - **TTL curto** (30 s, relógio injetável para teste).
 * - **Invalidação** (`invalidar`): confirmar, rejeitar, revogar, anular e o fim de uma
 *   sincronização do DDA chamam, no mesmo processo. Um resultado que estava em voo quando a
 *   invalidação chegou NÃO é guardado (seria anterior à mudança).
 * - **Nunca decide**: confirmar, rejeitar e anular releem o banco ao vivo (anti-TOCTOU, I15a);
 *   o cache serve só a LISTAGEM.
 *
 * LIMITE ASSUMIDO: é por processo. Com mais de uma instância, uma decisão tomada na instância A só
 * aparece na lista da instância B depois de, no máximo, o TTL (30 s). É aceito porque a lista é
 * informativa e toda decisão é revalidada ao vivo.
 */
@singleton()
@injectable()
export default class SugestaoBoletoCache {
    private clock: () => number = () => Date.now();
    private ttlMs = SUGESTAO_BOLETO_CACHE_TTL_MS;
    private entrada: Entrada | undefined;
    private emVoo: Promise<unknown> | undefined;
    /** Muda a cada invalidação: o que estava em voo antes dela não vira cache. */
    private geracao = 0;

    /** Instância com relógio e TTL controlados — para testes. */
    public static withClock = (clock: () => number, ttlMs?: number): SugestaoBoletoCache => {
        const cache = new SugestaoBoletoCache();
        cache.clock = clock;
        if (ttlMs !== undefined) cache.ttlMs = ttlMs;
        return cache;
    };

    /**
     * Devolve o cenário em cache, ou calcula UMA vez (single-flight). `hit` diz se saiu do cache
     * (ou de uma execução em voo de outra chamada); só quem calcula tem `hit = false`.
     */
    public obter = async <T>(calcular: () => Promise<T>): Promise<{ valor: T; hit: boolean }> => {
        const atual = this.entrada;
        if (atual && this.clock() < atual.expiraEm) {
            return { valor: atual.valor as T, hit: true };
        }
        if (this.emVoo) {
            return { valor: (await this.emVoo) as T, hit: true };
        }
        const geracao = this.geracao;
        const promessa = calcular().then((valor) => {
            if (this.geracao === geracao) {
                this.entrada = { valor, expiraEm: this.clock() + this.ttlMs };
            }
            return valor;
        });
        this.emVoo = promessa;
        try {
            return { valor: await promessa, hit: false };
        } finally {
            if (this.emVoo === promessa) this.emVoo = undefined;
        }
    };

    /** Descarta o cenário e solta a execução em voo (a próxima chamada recalcula). */
    public invalidar = (): void => {
        this.geracao += 1;
        this.entrada = undefined;
        this.emVoo = undefined;
    };
}
