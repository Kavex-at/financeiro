import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import type ContaPagadoraResolver from './ContaPagadoraResolver.js';
import FormacaoLotesService from './FormacaoLotesService.js';

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    docCod: '100',
    titCod: '1',
    filCod: 2,
    valor: 1000,
    liberado: true,
    pago: false,
    banco: 'ITAÚ',
    ...over,
});

const buildLog = () => ({ info: jest.fn().mockResolvedValue(undefined) }) as unknown as LogService;

const make = (
    over: {
        elegiveis?: TituloAPagar[];
        desfeitos?: number;
        acquire?: boolean;
        conta?: { banco: string; conta: string } | undefined;
    } = {},
) => {
    const resolverPadrao = jest
        .fn()
        .mockResolvedValue('conta' in over ? over.conta : { banco: 'ITAÚ', conta: '55795-4' });
    const tituloRepo = {
        listElegiveisParaFormacao: jest.fn().mockResolvedValue(over.elegiveis ?? []),
    };
    const loteRepo = {
        desfazerAutomaticosVencidos: jest.fn().mockResolvedValue(over.desfeitos ?? 0),
        criarLote: jest.fn().mockResolvedValue({ id: 'L1' }),
        adicionarItens: jest.fn().mockResolvedValue(undefined),
        tocarLote: jest.fn().mockResolvedValue(undefined),
    };
    const acquire = over.acquire ?? true;
    const db = {
        withAdvisoryLock: jest.fn(
            (_k: number, onAcquired: () => Promise<unknown>, onBusy: () => Promise<unknown>) =>
                acquire ? onAcquired() : onBusy(),
        ),
        withTransaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
    } as unknown as PostgreeDatabaseClient;
    const service = new FormacaoLotesService(
        tituloRepo as unknown as TituloAPagarRepository,
        loteRepo as unknown as LotePagamentoRepository,
        db,
        buildLog(),
        { resolverPadrao } as unknown as ContaPagadoraResolver,
    );
    return { service, tituloRepo, loteRepo, resolverPadrao };
};

describe('FormacaoLotesService', () => {
    it('agrupa só por FILIAL (banco não conta) e forma um lote por grupo (automatico=true)', async () => {
        const elegiveis = [
            titulo({ docCod: '1', filCod: 2, banco: 'ITAÚ' }),
            titulo({ docCod: '2', filCod: 2, banco: 'ITAÚ' }), // mesmo grupo
            titulo({ docCod: '3', filCod: 2, banco: 'ITAÚ' }), // mesma filial → mesmo grupo
            titulo({ docCod: '4', filCod: 4, banco: 'ITAÚ' }), // filial difere
            titulo({ docCod: '5', filCod: 2, banco: 'C6' }), // banco NÃO separa
        ];
        const { service, loteRepo } = make({ elegiveis });
        const r = await service.formar({ triggeredBy: 'cron' });
        // grupos: (2)={1,2,3,5}, (4)={4} = 2 lotes
        expect(r).toMatchObject({ lotesFormados: 2, titulosLotados: 5, lotesDesfeitos: 0 });
        expect(loteRepo.criarLote).toHaveBeenCalledTimes(2);
        expect(loteRepo.adicionarItens).toHaveBeenCalledTimes(2);
        // total de itens inseridos = 5 (soma dos itens por lote)
        const totalItens = loteRepo.adicionarItens.mock.calls.reduce(
            (acc: number, call: unknown[]) => acc + (call[1] as unknown[]).length,
            0,
        );
        expect(totalItens).toBe(5);
        for (const call of loteRepo.criarLote.mock.calls) {
            expect(call[0]).toMatchObject({ automatico: true });
        }
    });

    it('G-13: a conta do lote vem da FILIAL (resolvida uma vez por filial), não de uma constante', async () => {
        const elegiveis = [
            titulo({ docCod: '1', filCod: 2 }),
            ...Array.from({ length: 30 }, (_, i) => titulo({ docCod: `9${i}`, filCod: 4 })),
        ];
        const { service, loteRepo, resolverPadrao } = make({ elegiveis });
        resolverPadrao.mockImplementation(async (filCod: number) =>
            filCod === 2
                ? { banco: 'ITAÚ', conta: '29949-2' }
                : { banco: 'ITAÚ', conta: '55795-4' },
        );
        await service.formar({ triggeredBy: 'cron' });
        const porFilial = Object.fromEntries(
            loteRepo.criarLote.mock.calls.map((c: [Record<string, unknown>]) => [
                `${c[0].filCod}:${c[0].conta}`,
                true,
            ]),
        );
        expect(Object.keys(porFilial).sort()).toEqual(['2:29949-2', '4:55795-4']);
        // 3 lotes (1 da filial 2, 25+5 da 4), mas só 2 leituras do fin005.
        expect(resolverPadrao).toHaveBeenCalledTimes(2);
    });

    it('G-13: filial sem conta inequívoca → o lote nasce SEM conta (a analista escolhe)', async () => {
        const { service, loteRepo } = make({
            elegiveis: [titulo({ docCod: '1', filCod: 7 })],
            conta: undefined,
        });
        await service.formar({ triggeredBy: 'cron' });
        const arg = loteRepo.criarLote.mock.calls[0][0];
        expect(arg).not.toHaveProperty('conta');
        expect(arg).not.toHaveProperty('banco');
    });

    it('fatia grupos grandes em lotes de no máx. 25 títulos (revisão humana)', async () => {
        const elegiveis = Array.from({ length: 30 }, (_, i) =>
            titulo({ docCod: String(i + 1), filCod: 2 }),
        );
        const { service, loteRepo } = make({ elegiveis });
        const r = await service.formar({ triggeredBy: 'cron' });
        // 30 no mesmo grupo → 25 + 5 = 2 lotes
        expect(r.lotesFormados).toBe(2);
        expect(r.titulosLotados).toBe(30);
        expect(loteRepo.criarLote).toHaveBeenCalledTimes(2);
    });

    it('desfaz os lotes automáticos vencidos antes de formar (conta no resultado)', async () => {
        const { service, loteRepo } = make({ elegiveis: [titulo()], desfeitos: 3 });
        const r = await service.formar({ triggeredBy: 'cron' });
        expect(loteRepo.desfazerAutomaticosVencidos).toHaveBeenCalled();
        expect(r.lotesDesfeitos).toBe(3);
        expect(r.lotesFormados).toBe(1);
    });

    it('sem elegíveis: nenhum lote formado', async () => {
        const { service, loteRepo } = make({ elegiveis: [] });
        const r = await service.formar({ triggeredBy: 'cron' });
        expect(r.lotesFormados).toBe(0);
        expect(loteRepo.criarLote).not.toHaveBeenCalled();
    });

    it('lock ocupado — outra formação rodando vira IngestLockBusyError', async () => {
        const { service } = make({ acquire: false });
        await expect(service.formar({ triggeredBy: 'cron' })).rejects.toBeInstanceOf(
            IngestLockBusyError,
        );
    });
});
