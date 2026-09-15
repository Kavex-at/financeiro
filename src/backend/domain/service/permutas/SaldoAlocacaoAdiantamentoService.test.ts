import 'reflect-metadata';
import type {
    AlocacaoRow,
    default as PermutaAlocacaoRepository,
} from '../../repository/permutas/PermutaAlocacaoRepository.js';
import type {
    ConsumoExecucaoRow,
    default as PermutaExecucaoRepository,
} from '../../repository/permutas/PermutaExecucaoRepository.js';
import SaldoAlocacaoAdiantamentoService from './SaldoAlocacaoAdiantamentoService.js';

const T0 = new Date('2026-09-01T10:00:00Z');
const minutos = (base: Date, n: number): Date => new Date(base.getTime() + n * 60_000);

const alocacao = (over: Partial<AlocacaoRow> = {}): AlocacaoRow => ({
    adiantamentoDocCod: '12860',
    invoiceDocCod: 'INV1',
    valorAlocado: 49622.46,
    criadoEm: T0,
    atualizadoEm: T0,
    ...over,
});

const consumo = (over: Partial<ConsumoExecucaoRow> = {}): ConsumoExecucaoRow => ({
    adiantamentoDocCod: '12860',
    invoiceDocCod: 'INV1',
    status: 'settled',
    criadoEm: minutos(T0, 1),
    ...over,
});

const build = (opts: { alocacoes?: AlocacaoRow[]; consumos?: ConsumoExecucaoRow[] } = {}) => {
    const alocacaoRepository = {
        listByAdiantamento: jest.fn().mockResolvedValue(opts.alocacoes ?? []),
    } as unknown as jest.Mocked<PermutaAlocacaoRepository>;
    const execucaoRepository = {
        listConsumosFinalizados: jest.fn().mockResolvedValue(opts.consumos ?? []),
    } as unknown as jest.Mocked<PermutaExecucaoRepository>;
    const service = new SaldoAlocacaoAdiantamentoService(alocacaoRepository, execucaoRepository);
    return { service, alocacaoRepository, execucaoRepository };
};

describe('SaldoAlocacaoAdiantamentoService.naoConsumido (ADR-0046 D3, puro)', () => {
    const { service } = build();

    it('settled em borderô finalizado, execução da versão atual → 0 (o ERP já abateu)', () => {
        expect(service.naoConsumido(alocacao(), [consumo()])).toBe(0);
    });

    it('parcial: consome só a parte baixada → sobra o resíduo', () => {
        const al = alocacao({ valorAlocado: 100 });
        expect(
            service.naoConsumido(al, [consumo({ status: 'parcial', valorResidualUsd: 10 })]),
        ).toBe(10);
    });

    it('parcial sem valorResidualUsd → valorAlocado inteiro (conservador)', () => {
        const al = alocacao({ valorAlocado: 100 });
        expect(service.naoConsumido(al, [consumo({ status: 'parcial' })])).toBe(100);
    });

    it('parcial com resíduo acima do alocado → teto no alocado', () => {
        const al = alocacao({ valorAlocado: 100 });
        expect(
            service.naoConsumido(al, [consumo({ status: 'parcial', valorResidualUsd: 150 })]),
        ).toBe(100);
    });

    it('execução de versão ANTERIOR (criadoEm < atualizadoEm) não abate a versão atual', () => {
        const T1 = minutos(T0, 10);
        const T2 = minutos(T0, 20);
        const al = alocacao({ valorAlocado: 10, atualizadoEm: T2 });
        expect(service.naoConsumido(al, [consumo({ criadoEm: T1 })])).toBe(10);
    });

    it('execução criada no MESMO instante do UPSERT conta (>=)', () => {
        expect(service.naoConsumido(alocacao(), [consumo({ criadoEm: T0 })])).toBe(0);
    });

    it('sem consumo (rascunho, pending, error, borderô não finalizado/ausente) → valorAlocado', () => {
        expect(service.naoConsumido(alocacao(), [])).toBe(49622.46);
    });

    it('vários consumos do par na mesma versão → vale o de maior criadoEm', () => {
        const al = alocacao({ valorAlocado: 100 });
        const antigo = consumo({ status: 'settled', criadoEm: minutos(T0, 1) });
        const recente = consumo({
            status: 'parcial',
            valorResidualUsd: 30,
            criadoEm: minutos(T0, 5),
        });
        expect(service.naoConsumido(al, [recente, antigo])).toBe(30);
        expect(service.naoConsumido(al, [antigo, recente])).toBe(30);
    });

    it('consumo de OUTRO par do mesmo adto não afeta', () => {
        const al = alocacao({ valorAlocado: 100 });
        expect(service.naoConsumido(al, [consumo({ invoiceDocCod: 'OUTRA' })])).toBe(100);
    });

    it('consumo de OUTRO adto com a mesma invoice não afeta', () => {
        const al = alocacao({ valorAlocado: 100 });
        expect(service.naoConsumido(al, [consumo({ adiantamentoDocCod: '9999' })])).toBe(100);
    });
});

describe('SaldoAlocacaoAdiantamentoService.somaNaoConsumida (puro)', () => {
    const { service } = build();

    it('soma só a parte não consumida de cada alocação', () => {
        const alocacoes = [
            alocacao({ invoiceDocCod: 'A', valorAlocado: 100 }),
            alocacao({ invoiceDocCod: 'B', valorAlocado: 50 }),
            alocacao({ invoiceDocCod: 'C', valorAlocado: 70 }),
        ];
        const consumos = [
            consumo({ invoiceDocCod: 'A' }),
            consumo({ invoiceDocCod: 'C', status: 'parcial', valorResidualUsd: 20 }),
        ];
        expect(service.somaNaoConsumida(alocacoes, consumos)).toBeCloseTo(70, 6);
    });

    it('exclui o próprio par (re-alocação) quando informado', () => {
        const alocacoes = [
            alocacao({ invoiceDocCod: 'A', valorAlocado: 100 }),
            alocacao({ invoiceDocCod: 'B', valorAlocado: 50 }),
        ];
        expect(service.somaNaoConsumida(alocacoes, [], 'A')).toBe(50);
    });

    it('lista vazia → 0', () => {
        expect(service.somaNaoConsumida([], [])).toBe(0);
    });
});

describe('SaldoAlocacaoAdiantamentoService (I/O)', () => {
    it('carregarConsumosPorAdiantamento agrupa os consumos por adto (uma query só)', async () => {
        const { service, execucaoRepository } = build({
            consumos: [
                consumo({ adiantamentoDocCod: '1' }),
                consumo({ adiantamentoDocCod: '2', invoiceDocCod: 'X' }),
                consumo({ adiantamentoDocCod: '1', invoiceDocCod: 'Y' }),
            ],
        });
        const mapa = await service.carregarConsumosPorAdiantamento();
        expect(execucaoRepository.listConsumosFinalizados).toHaveBeenCalledTimes(1);
        expect(execucaoRepository.listConsumosFinalizados).toHaveBeenCalledWith();
        expect(mapa.get('1')?.map((c) => c.invoiceDocCod)).toEqual(['INV1', 'Y']);
        expect(mapa.get('2')).toHaveLength(1);
        expect(mapa.get('3')).toBeUndefined();
    });

    it('somaNaoConsumidaDoAdiantamento: lê alocações e consumos do adto e exclui o par', async () => {
        const { service, alocacaoRepository, execucaoRepository } = build({
            alocacoes: [
                alocacao({
                    adiantamentoDocCod: '9328',
                    invoiceDocCod: 'X',
                    valorAlocado: 35347.53,
                }),
                alocacao({ adiantamentoDocCod: '9328', invoiceDocCod: 'NOVA', valorAlocado: 500 }),
            ],
            consumos: [consumo({ adiantamentoDocCod: '9328', invoiceDocCod: 'X' })],
        });
        const soma = await service.somaNaoConsumidaDoAdiantamento('9328', 'NOVA');
        expect(soma).toBe(0);
        expect(alocacaoRepository.listByAdiantamento).toHaveBeenCalledWith('9328');
        expect(execucaoRepository.listConsumosFinalizados).toHaveBeenCalledWith('9328');
    });
});
