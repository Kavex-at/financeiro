import { injectable, singleton } from 'tsyringe';
import type { BoletoDdaConsolidado } from '../../interface/sispag/BoletoDda.js';

/** TTL da lista consolidada: o mesmo das sugestões (cobre lotes e grupos, que não têm marca). */
export const CONSOLIDACAO_DDA_CACHE_TTL_MS = 30_000;
/**
 * Entradas guardadas ao mesmo tempo: os dois escopos ("a vencer" e "todos"). Cada entrada é uma
 * consolidação inteira (~24 mil linhas em "todos"); versão velha de uma chave não tem uso.
 */
export const CONSOLIDACAO_DDA_CACHE_MAX_ENTRADAS = 2;

interface Entrada {
    valor: BoletoDdaConsolidado[];
    expiraEm: number;
}

/**
 * ConsolidacaoBoletoDdaCache — guarda, EM PROCESSO, a lista consolidada da aba "Boletos DDA" (pool
 * × carteira × lotes × grupos). Sem isto, toda troca de filtro, ordem ou página reconsolidava o
 * escopo inteiro (~24 mil linhas em "todos") — card performance-2.
 *
 * - **A chave é do chamador**: `escopo|hoje|sincronizadoEm|carteira|lotes|versão das sugestões`.
 *   Pool novo, carteira nova, lote alterado, virada do dia ou decisão sobre sugestão/grupo mudam a
 *   chave — inclusive quando a mudança veio de outra instância ou de um job.
 * - **TTL curto** (30 s, relógio injetável) como rede de segurança.
 * - **Single-flight** por chave; falha não é guardada.
 * - **`invalidar`**: fim de toda sincronização do DDA. O que estava em voo não vira cache.
 *
 * LIMITE ASSUMIDO: por processo, como o `SugestaoBoletoCache`. A lista é informativa; nada que
 * move dinheiro lê daqui.
 */
@singleton()
@injectable()
export default class ConsolidacaoBoletoDdaCache {
    private clock: () => number = () => Date.now();
    private ttlMs = CONSOLIDACAO_DDA_CACHE_TTL_MS;
    private readonly entradas = new Map<string, Entrada>();
    private readonly emVoo = new Map<string, Promise<BoletoDdaConsolidado[]>>();
    private geracao = 0;

    /** Instância com relógio e TTL controlados — para testes. */
    public static withClock = (clock: () => number, ttlMs?: number): ConsolidacaoBoletoDdaCache => {
        const cache = new ConsolidacaoBoletoDdaCache();
        cache.clock = clock;
        if (ttlMs !== undefined) cache.ttlMs = ttlMs;
        return cache;
    };

    public obter = async (
        chave: string,
        calcular: () => Promise<BoletoDdaConsolidado[]>,
    ): Promise<BoletoDdaConsolidado[]> => {
        const agora = this.clock();
        const atual = this.entradas.get(chave);
        if (atual && agora < atual.expiraEm) return atual.valor;
        const voando = this.emVoo.get(chave);
        if (voando) return voando;

        const geracao = this.geracao;
        const promessa = calcular().then((valor) => {
            if (this.geracao === geracao) this.guardar(chave, valor);
            return valor;
        });
        this.emVoo.set(chave, promessa);
        try {
            return await promessa;
        } finally {
            if (this.emVoo.get(chave) === promessa) this.emVoo.delete(chave);
        }
    };

    public invalidar = (): void => {
        this.geracao += 1;
        this.entradas.clear();
        this.emVoo.clear();
    };

    private guardar = (chave: string, valor: BoletoDdaConsolidado[]): void => {
        const agora = this.clock();
        for (const [k, e] of this.entradas) if (e.expiraEm <= agora) this.entradas.delete(k);
        this.entradas.delete(chave);
        while (this.entradas.size >= CONSOLIDACAO_DDA_CACHE_MAX_ENTRADAS) {
            const maisAntiga = this.entradas.keys().next().value;
            if (maisAntiga === undefined) break;
            this.entradas.delete(maisAntiga);
        }
        this.entradas.set(chave, { valor, expiraEm: agora + this.ttlMs });
    };
}
