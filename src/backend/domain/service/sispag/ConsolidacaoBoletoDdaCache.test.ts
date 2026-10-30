import 'reflect-metadata';
import type { BoletoDdaConsolidado } from '../../interface/sispag/BoletoDda.js';
import ConsolidacaoBoletoDdaCache, {
    CONSOLIDACAO_DDA_CACHE_MAX_ENTRADAS,
    CONSOLIDACAO_DDA_CACHE_TTL_MS,
} from './ConsolidacaoBoletoDdaCache.js';

const lista = (ditCod: number): BoletoDdaConsolidado[] => [
    {
        ddcCod: 1,
        ditCod,
        valor: 1,
        vencido: false,
        arquivos: 1,
        situacao: 'SEM_TITULO',
        candidatos: [],
    },
];

/** Promessa controlada pelo teste. */
const adiada = <T>() => {
    let resolver: (v: T) => void = () => {};
    let rejeitar: (e: unknown) => void = () => {};
    const promessa = new Promise<T>((res, rej) => {
        resolver = res;
        rejeitar = rej;
    });
    return { promessa, resolver, rejeitar };
};

describe('ConsolidacaoBoletoDdaCache', () => {
    let agora = 0;
    const novo = () => ConsolidacaoBoletoDdaCache.withClock(() => agora);
    beforeEach(() => {
        agora = 0;
    });

    it('guarda por chave: a segunda chamada na mesma chave não recalcula', async () => {
        const cache = novo();
        const calcular = jest.fn(async () => lista(1));
        expect(await cache.obter('a', calcular)).toEqual(lista(1));
        expect(await cache.obter('a', calcular)).toEqual(lista(1));
        expect(calcular).toHaveBeenCalledTimes(1);
    });

    it('TTL padrão de 30 s: antes dele serve o guardado, depois recalcula', async () => {
        expect(CONSOLIDACAO_DDA_CACHE_TTL_MS).toBe(30_000);
        const cache = novo();
        const calcular = jest.fn(async () => lista(1));
        await cache.obter('a', calcular);
        agora = 29_999;
        await cache.obter('a', calcular);
        expect(calcular).toHaveBeenCalledTimes(1);
        agora = 30_000;
        await cache.obter('a', calcular);
        expect(calcular).toHaveBeenCalledTimes(2);
    });

    it('performance-2: no máximo 2 entradas (os dois escopos); a mais antiga sai', async () => {
        expect(CONSOLIDACAO_DDA_CACHE_MAX_ENTRADAS).toBe(2);
        const cache = novo();
        const calc = {
            a: jest.fn(async () => lista(1)),
            b: jest.fn(async () => lista(2)),
            c: jest.fn(async () => lista(3)),
        };
        await cache.obter('a', calc.a);
        await cache.obter('b', calc.b);
        await cache.obter('c', calc.c);
        await cache.obter('b', calc.b);
        await cache.obter('c', calc.c);
        expect(calc.b).toHaveBeenCalledTimes(1);
        expect(calc.c).toHaveBeenCalledTimes(1);
        await cache.obter('a', calc.a);
        expect(calc.a).toHaveBeenCalledTimes(2);
    });

    it('single-flight: chamadas concorrentes na mesma chave esperam UM cálculo', async () => {
        const cache = novo();
        const d = adiada<BoletoDdaConsolidado[]>();
        const calcular = jest.fn(() => d.promessa);
        const p1 = cache.obter('a', calcular);
        const p2 = cache.obter('a', calcular);
        d.resolver(lista(7));
        expect(await p1).toEqual(lista(7));
        expect(await p2).toEqual(lista(7));
        expect(calcular).toHaveBeenCalledTimes(1);
    });

    it('chaves diferentes calculam em paralelo, sem se misturar', async () => {
        const cache = novo();
        const [ra, rb] = await Promise.all([
            cache.obter('a', async () => lista(1)),
            cache.obter('b', async () => lista(2)),
        ]);
        expect(ra).toEqual(lista(1));
        expect(rb).toEqual(lista(2));
    });

    it('falha não fica guardada: a próxima chamada tenta de novo', async () => {
        const cache = novo();
        const calcular = jest
            .fn<Promise<BoletoDdaConsolidado[]>, []>()
            .mockRejectedValueOnce(new Error('banco fora'))
            .mockResolvedValue(lista(1));
        await expect(cache.obter('a', calcular)).rejects.toThrow('banco fora');
        expect(await cache.obter('a', calcular)).toEqual(lista(1));
        expect(calcular).toHaveBeenCalledTimes(2);
    });

    it('invalidar descarta o guardado', async () => {
        const cache = novo();
        const calcular = jest.fn(async () => lista(1));
        await cache.obter('a', calcular);
        cache.invalidar();
        await cache.obter('a', calcular);
        expect(calcular).toHaveBeenCalledTimes(2);
    });

    it('geração: resultado em voo quando chega a invalidação NÃO vira cache', async () => {
        const cache = novo();
        const velho = adiada<BoletoDdaConsolidado[]>();
        const emVoo = cache.obter('a', () => velho.promessa);
        cache.invalidar();
        // Depois da invalidação, a mesma chave não espera o cálculo antigo: calcula de novo.
        const novoCalculo = jest.fn(async () => lista(2));
        expect(await cache.obter('a', novoCalculo)).toEqual(lista(2));
        velho.resolver(lista(1));
        expect(await emVoo).toEqual(lista(1));
        // O resultado velho não sobrescreveu o novo.
        const terceiro = jest.fn(async () => lista(3));
        expect(await cache.obter('a', terceiro)).toEqual(lista(2));
        expect(terceiro).not.toHaveBeenCalled();
    });
});
