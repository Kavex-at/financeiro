import 'reflect-metadata';
import type ConexosCadastroClient from '../../client/ConexosCadastroClient.js';
import type { ProcessoListItem } from '../../client/ConexosCadastroClient.js';
import type LogService from '../LogService.js';
import ProcessoProviderConexos from './ProcessoProviderConexos.js';

const linha = (o: Partial<ProcessoListItem> = {}): ProcessoListItem =>
    ({
        priCod: '31',
        pesCod: '116',
        priEspRefcliente: '00001BRW/25-OE',
        importador: 'BROWN-FORMAN BEVERAGES',
        ...o,
    }) as ProcessoListItem;

const build = (rows: ProcessoListItem[] = [linha()]) => {
    const cadastro = {
        listProcessos: jest.fn().mockResolvedValue(rows),
    } as unknown as jest.Mocked<ConexosCadastroClient>;
    const logService = {
        warn: jest.fn().mockResolvedValue(undefined),
        info: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LogService>;
    return { cadastro, logService, provider: new ProcessoProviderConexos(cadastro, logService) };
};

describe('ProcessoProviderConexos.listCandidatosParaTransacao', () => {
    it('com pesCod consulta o imp021 filtrado pelo cliente', async () => {
        const { provider, cadastro } = build();
        const r = await provider.listCandidatosParaTransacao({ filCod: 1, pesCod: 116 });

        expect(cadastro.listProcessos).toHaveBeenCalledWith({ filCod: 1, pesCods: ['116'] });
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ priCod: 31, pesCod: 116, filCod: 1 });
    });

    it('sem pesCod e sem contraparte devolve [] — nunca despeja a filial inteira no modal', async () => {
        const { provider, cadastro } = build();
        expect(await provider.listCandidatosParaTransacao({ filCod: 1 })).toEqual([]);
        expect(cadastro.listProcessos).not.toHaveBeenCalled();
    });

    it('com contraparte faz match frouxo sobre a lista da filial', async () => {
        const { provider } = build([
            linha({ priCod: '31', importador: 'BROWN-FORMAN BEVERAGES' }),
            linha({ priCod: '32', pesCod: '200', importador: 'INOX-TECH COMERCIO' }),
        ]);
        const r = await provider.listCandidatosParaTransacao({
            filCod: 1,
            contraparte: 'BROWN-FORMA',
        });
        expect(r.map((p) => p.priCod)).toEqual([31]);
    });

    it('descarta linha sem priCod/pesCod numérico em vez de coalescer para zero', async () => {
        // Um priCod: 0 viajaria até o payload do com299 e só apareceria no ERP.
        const { provider, logService } = build([
            linha(),
            linha({ priCod: '' }),
            linha({ pesCod: 'abc' }),
        ]);
        const clientes = await provider.listClientes({ filCod: 1 });
        expect(clientes).toHaveLength(1);
        expect(logService.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ descartados: 2, total: 3 }),
            }),
        );
    });

    it('marca moeCod como assumido — o imp021 não expõe moeda do processo', async () => {
        const { provider } = build();
        const [p] = await provider.listCandidatosParaTransacao({ filCod: 1, pesCod: 116 });
        expect(p.moeCod).toBe(790);
        expect(p.moeCodAssumido).toBe(true);
    });
});

describe('ProcessoProviderConexos.listClientes', () => {
    it('agrupa por pesCod, conta processos e ordena por nome', async () => {
        const { provider } = build([
            linha({ priCod: '31', pesCod: '116', importador: 'ZETA IMPORTS' }),
            linha({ priCod: '32', pesCod: '116', importador: 'ZETA IMPORTS' }),
            linha({ priCod: '33', pesCod: '200', importador: 'ALFA COMERCIO' }),
        ]);
        const clientes = await provider.listClientes({ filCod: 1 });

        expect(clientes.map((c) => c.dpeNomPessoa)).toEqual(['ALFA COMERCIO', 'ZETA IMPORTS']);
        expect(clientes.find((c) => c.pesCod === 116)?.processosAbertos).toBe(2);
    });

    it('cliente sem nome ganha rótulo identificável em vez de string vazia', async () => {
        const { provider } = build([linha({ importador: undefined })]);
        const [c] = await provider.listClientes({ filCod: 1 });
        expect(c.dpeNomPessoa).toContain('116');
    });
});

describe('ProcessoProviderConexos — cache', () => {
    it('reusa o resultado dentro do TTL (uma abertura de modal não vira full-scan)', async () => {
        const { provider, cadastro } = build();
        await provider.listClientes({ filCod: 1 });
        await provider.listClientes({ filCod: 1 });
        expect(cadastro.listProcessos).toHaveBeenCalledTimes(1);
    });

    it('cacheia por filial — filiais diferentes não se contaminam', async () => {
        const { provider, cadastro } = build();
        await provider.listClientes({ filCod: 1 });
        await provider.listClientes({ filCod: 2 });
        expect(cadastro.listProcessos).toHaveBeenCalledTimes(2);
    });

    it('invalidarCache força nova leitura', async () => {
        const { provider, cadastro } = build();
        await provider.listClientes({ filCod: 1 });
        provider.invalidarCache(1);
        await provider.listClientes({ filCod: 1 });
        expect(cadastro.listProcessos).toHaveBeenCalledTimes(2);
    });

    it('expira depois do TTL', async () => {
        jest.useFakeTimers();
        try {
            const { provider, cadastro } = build();
            await provider.listClientes({ filCod: 1 });
            jest.advanceTimersByTime(11 * 60 * 1000);
            await provider.listClientes({ filCod: 1 });
            expect(cadastro.listProcessos).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });
});
