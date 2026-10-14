import 'reflect-metadata';
import SugestaoBoletoCache, { SUGESTAO_BOLETO_CACHE_TTL_MS } from './SugestaoBoletoCache.js';

const adiavel = <T>() => {
    let resolver: (v: T) => void = () => undefined;
    let rejeitar: (e: unknown) => void = () => undefined;
    const promessa = new Promise<T>((res, rej) => {
        resolver = res;
        rejeitar = rej;
    });
    return { promessa, resolver, rejeitar };
};

describe('SugestaoBoletoCache (PERF-1)', () => {
    it('o TTL padrão é de 30 s', () => {
        expect(SUGESTAO_BOLETO_CACHE_TTL_MS).toBe(30_000);
    });

    it('miss calcula e guarda; hit devolve sem calcular', async () => {
        const cache = SugestaoBoletoCache.withClock(() => 0);
        const calcular = jest.fn().mockResolvedValue({ n: 1 });
        const a = await cache.obter(calcular);
        const b = await cache.obter(calcular);
        expect(calcular).toHaveBeenCalledTimes(1);
        expect(a).toEqual({ valor: { n: 1 }, hit: false });
        expect(b).toEqual({ valor: { n: 1 }, hit: true });
    });

    it('single-flight: chamadas concorrentes esperam a mesma promessa', async () => {
        const cache = SugestaoBoletoCache.withClock(() => 0);
        const d = adiavel<string>();
        const calcular = jest.fn(() => d.promessa);
        const a = cache.obter(calcular);
        const b = cache.obter(calcular);
        const c = cache.obter(calcular);
        d.resolver('pronto');
        const r = await Promise.all([a, b, c]);
        expect(calcular).toHaveBeenCalledTimes(1);
        expect(r.map((x) => x.valor)).toEqual(['pronto', 'pronto', 'pronto']);
        expect(r.filter((x) => !x.hit)).toHaveLength(1);
    });

    it('TTL: com o relógio injetado, expira exatamente no limite', async () => {
        let agora = 1_000;
        const cache = SugestaoBoletoCache.withClock(() => agora, 30_000);
        const calcular = jest.fn().mockResolvedValue('x');
        await cache.obter(calcular);
        agora += 29_999;
        await cache.obter(calcular);
        expect(calcular).toHaveBeenCalledTimes(1);
        agora += 1;
        await cache.obter(calcular);
        expect(calcular).toHaveBeenCalledTimes(2);
    });

    it('invalidar descarta o valor: a chamada seguinte recalcula', async () => {
        const cache = SugestaoBoletoCache.withClock(() => 0);
        const calcular = jest.fn().mockResolvedValueOnce('velho').mockResolvedValueOnce('novo');
        await cache.obter(calcular);
        cache.invalidar();
        const r = await cache.obter(calcular);
        expect(r).toEqual({ valor: 'novo', hit: false });
    });

    it('o que estava em voo quando a invalidação chegou NÃO vira cache', async () => {
        const cache = SugestaoBoletoCache.withClock(() => 0);
        const d = adiavel<string>();
        const calcular = jest
            .fn()
            .mockImplementationOnce(() => d.promessa)
            .mockResolvedValueOnce('depois');
        const emVoo = cache.obter(calcular);
        cache.invalidar();
        d.resolver('anterior-a-mudanca');
        expect((await emVoo).valor).toBe('anterior-a-mudanca');
        const proxima = await cache.obter(calcular);
        expect(proxima).toEqual({ valor: 'depois', hit: false });
    });

    it('falha não é guardada e solta a execução em voo', async () => {
        const cache = SugestaoBoletoCache.withClock(() => 0);
        const calcular = jest
            .fn()
            .mockRejectedValueOnce(new Error('falhou'))
            .mockResolvedValueOnce('ok');
        await expect(cache.obter(calcular)).rejects.toThrow('falhou');
        expect(await cache.obter(calcular)).toEqual({ valor: 'ok', hit: false });
    });

    it('concorrentes que esperam uma falha recebem a mesma falha', async () => {
        const cache = SugestaoBoletoCache.withClock(() => 0);
        const d = adiavel<string>();
        const calcular = jest.fn(() => d.promessa);
        const a = cache.obter(calcular);
        const b = cache.obter(calcular);
        d.rejeitar(new Error('banco fora'));
        await expect(a).rejects.toThrow('banco fora');
        await expect(b).rejects.toThrow('banco fora');
        expect(calcular).toHaveBeenCalledTimes(1);
    });
});
