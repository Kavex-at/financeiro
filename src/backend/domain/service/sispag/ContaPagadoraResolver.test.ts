import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type LogService from '../LogService.js';
import ContaPagadoraResolver from './ContaPagadoraResolver.js';

const conta = (over: Record<string, unknown> = {}) => ({
    ccoCod: 1,
    bncCod: 4,
    agencia: '0641',
    numeroConta: 55795,
    dvConta: '4',
    ...over,
});

const make = (contas: unknown[] | Error) => {
    const sispag = {
        listContasCorrentes:
            contas instanceof Error
                ? jest.fn().mockRejectedValue(contas)
                : jest.fn().mockResolvedValue(contas),
    };
    const log = { warn: jest.fn().mockResolvedValue(undefined) };
    const resolver = new ContaPagadoraResolver(
        sispag as unknown as ConexosSispagClient,
        log as unknown as LogService,
    );
    return { resolver, sispag, log };
};

describe('ContaPagadoraResolver (G-13)', () => {
    it('uma conta Itaú na filial → ela, mesmo que não seja a "preferida"', async () => {
        const { resolver } = make([
            conta({ bncCod: 38, numeroConta: 111, dvConta: '1' }),
            conta({ ccoCod: 7, numeroConta: 29949, dvConta: '2' }),
        ]);
        expect(await resolver.resolverPadrao(1)).toEqual({ banco: 'ITAÚ', conta: '29949-2' });
    });

    it('ignora contas de outro banco, em qualquer posição do fin005', async () => {
        const { resolver } = make([conta({ bncCod: 38, numeroConta: 111, dvConta: '1' }), conta()]);
        expect(await resolver.resolverPadrao(1)).toEqual({ banco: 'ITAÚ', conta: '55795-4' });
    });

    it('várias contas Itaú → a preferida, se estiver entre elas', async () => {
        const { resolver } = make([
            conta({ ccoCod: 2, numeroConta: 99999, dvConta: '9' }),
            conta(),
        ]);
        expect(await resolver.resolverPadrao(2)).toEqual({ banco: 'ITAÚ', conta: '55795-4' });
    });

    it('várias contas Itaú sem a preferida → sem conta (não chuta) e avisa', async () => {
        const { resolver, log } = make([
            conta({ numeroConta: 1, dvConta: '1' }),
            conta({ ccoCod: 2, numeroConta: 2, dvConta: '2' }),
        ]);
        expect(await resolver.resolverPadrao(2)).toBeUndefined();
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ filCod: 2, contasItau: ['1-1', '2-2'] }),
            }),
        );
    });

    it('filial sem conta Itaú → sem conta e avisa', async () => {
        const { resolver, log } = make([conta({ bncCod: 38 })]);
        expect(await resolver.resolverPadrao(1)).toBeUndefined();
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('fin005 ilegível → sem conta e avisa, não propaga', async () => {
        const { resolver, log } = make(new Error('403'));
        expect(await resolver.resolverPadrao(1)).toBeUndefined();
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ motivo: '403' }) }),
        );
    });
});
