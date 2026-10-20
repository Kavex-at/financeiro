import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import type ContaPagadoraResolver from './ContaPagadoraResolver.js';
import type SituacaoPagamentoService from './SituacaoPagamentoService.js';
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

const buildLog = () =>
    ({
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    }) as unknown as LogService & { info: jest.Mock; warn: jest.Mock };

const make = (
    over: {
        elegiveis?: TituloAPagar[];
        desfeitos?: number;
        acquire?: boolean;
        conta?: { banco: string; conta: string } | undefined;
        calendar?: BankingCalendar;
        avaliarVarios?: jest.Mock;
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
    // ADR-0075: por padrão toda situação é PRONTO; um teste específico bloqueia títulos.
    const avaliarVarios =
        over.avaliarVarios ??
        jest.fn(async (titulos: TituloAPagar[]) => {
            const mapa = new Map<string, { estado: string; motivos: string[] }>();
            for (const t of titulos) {
                mapa.set(`${t.filCod}:${t.docCod}:${t.titCod}`, { estado: 'PRONTO', motivos: [] });
            }
            return mapa;
        });
    const log = buildLog();
    const service = new FormacaoLotesService(
        tituloRepo as unknown as TituloAPagarRepository,
        loteRepo as unknown as LotePagamentoRepository,
        db,
        log,
        { resolverPadrao } as unknown as ContaPagadoraResolver,
        over.calendar ?? new BankingCalendar(),
        { avaliarVarios } as unknown as SituacaoPagamentoService,
    );
    return { service, tituloRepo, loteRepo, resolverPadrao, avaliarVarios, log };
};

describe('FormacaoLotesService — só títulos PRONTO (ADR-0075, D9)', () => {
    const DIA = Date.UTC(2026, 9, 8);
    const situacoes = (bloqueados: Record<string, string>) =>
        jest.fn(async (titulos: TituloAPagar[]) => {
            const mapa = new Map<
                string,
                { estado: string; motivos: string[]; principal?: string }
            >();
            for (const t of titulos) {
                const motivo = bloqueados[t.docCod];
                mapa.set(
                    `${t.filCod}:${t.docCod}:${t.titCod}`,
                    motivo
                        ? { estado: 'BLOQUEADO', motivos: [motivo], principal: motivo }
                        : { estado: 'PRONTO', motivos: [] },
                );
            }
            return mapa;
        });

    it('título bloqueado fica fora do lote automático; os prontos entram', async () => {
        const elegiveis = [
            titulo({ docCod: '1', vencimento: DIA }),
            titulo({ docCod: '2', vencimento: DIA }),
            titulo({ docCod: '3', vencimento: DIA }),
        ];
        const { service, loteRepo } = make({
            elegiveis,
            avaliarVarios: situacoes({ '2': 'TIPO_PERMUTA' }),
        });
        const r = await service.formar({ triggeredBy: 'cron' });
        expect(r.titulosLotados).toBe(2);
        const itens = loteRepo.adicionarItens.mock.calls.flatMap(
            (c: unknown[]) => c[1] as Array<{ docCod: string }>,
        );
        expect(itens.map((i) => i.docCod).sort()).toEqual(['1', '3']);
    });

    it('grupo inteiro bloqueado não cria lote nenhum', async () => {
        const { service, loteRepo } = make({
            elegiveis: [titulo({ docCod: '1', vencimento: DIA })],
            avaliarVarios: situacoes({ '1': 'BOLETO_SEM_DDA' }),
        });
        const r = await service.formar({ triggeredBy: 'cron' });
        expect(r.lotesFormados).toBe(0);
        expect(loteRepo.criarLote).not.toHaveBeenCalled();
    });

    it('registra quantos ficaram de fora e por qual motivo (a analista precisa saber por quê)', async () => {
        const { service, log } = make({
            elegiveis: [
                titulo({ docCod: '1', vencimento: DIA }),
                titulo({ docCod: '2', vencimento: DIA }),
                titulo({ docCod: '3', vencimento: DIA }),
            ],
            avaliarVarios: situacoes({ '2': 'TIPO_PERMUTA', '3': 'TIPO_PERMUTA' }),
        });
        await service.formar({ triggeredBy: 'cron' });
        expect(log.info).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    elegiveis: 3,
                    pagaveis: 1,
                    porMotivo: { TIPO_PERMUTA: 2 },
                }),
            }),
        );
    });

    it('situação indisponível: a formação segue como antes, com WARN (os guardas do finalizar valem)', async () => {
        const { service, log, loteRepo } = make({
            elegiveis: [titulo({ docCod: '1', vencimento: DIA })],
            avaliarVarios: jest.fn().mockRejectedValue(new Error('contexto fora')),
        });
        const r = await service.formar({ triggeredBy: 'cron' });
        expect(r.titulosLotados).toBe(1);
        expect(loteRepo.criarLote).toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('situação de pagamento indisponível'),
            }),
        );
    });

    it('sem elegíveis não consulta a situação', async () => {
        const { service, avaliarVarios } = make({ elegiveis: [] });
        await service.formar({ triggeredBy: 'cron' });
        expect(avaliarVarios).not.toHaveBeenCalled();
    });
});

describe('FormacaoLotesService', () => {
    describe('ADR-0064 — filial × vencimento, boletos juntos no fatiamento', () => {
        const DIA_1 = Date.UTC(2026, 9, 8); // 2026-10-08 00:00Z (o ERP grava 00:00Z do dia)
        const DIA_2 = Date.UTC(2026, 9, 9);
        const itensDe = (loteRepo: ReturnType<typeof make>['loteRepo']) =>
            loteRepo.adicionarItens.mock.calls.map(
                (c: unknown[]) => c[1] as Array<{ docCod: string; modalidade?: string }>,
            );

        it('mesma filial em dois vencimentos → dois lotes; mesmo dia → um lote', async () => {
            const elegiveis = [
                titulo({ docCod: '1', filCod: 2, vencimento: DIA_1 }),
                titulo({ docCod: '2', filCod: 2, vencimento: DIA_1 + 15 * 3_600_000 }), // 15:00Z
                titulo({ docCod: '3', filCod: 2, vencimento: DIA_2 }),
                titulo({ docCod: '4', filCod: 4, vencimento: DIA_1 }),
            ];
            const { service, loteRepo } = make({ elegiveis });
            const r = await service.formar({ triggeredBy: 'cron' });
            expect(r.lotesFormados).toBe(3);
            const grupos = itensDe(loteRepo).map((itens) => itens.map((i) => i.docCod).sort());
            expect(grupos).toEqual(expect.arrayContaining([['1', '2'], ['3'], ['4']]));
        });

        it('grupo grande com 15 boletos e 15 não-boletos → um lote só-boleto e um só-não-boleto', async () => {
            const elegiveis = Array.from({ length: 30 }, (_, i) =>
                titulo({
                    docCod: String(i + 1),
                    filCod: 2,
                    vencimento: DIA_1,
                    temBoleto: i % 2 === 0,
                }),
            );
            const { service, loteRepo } = make({ elegiveis });
            const r = await service.formar({ triggeredBy: 'cron' });
            expect(r.lotesFormados).toBe(2);
            const lotes = itensDe(loteRepo);
            const tipos = lotes.map((itens) => [...new Set(itens.map((i) => i.modalidade ?? '-'))]);
            expect(tipos).toEqual(expect.arrayContaining([['BOLETO'], ['-']]));
            expect(lotes.map((l) => l.length).sort()).toEqual([15, 15]);
        });

        it('sem teto de quantidade: 60 títulos do mesmo dia viram só dois lotes (boletos × outros)', async () => {
            const elegiveis = Array.from({ length: 60 }, (_, i) =>
                titulo({ docCod: String(i + 1), filCod: 2, vencimento: DIA_1, temBoleto: i >= 2 }),
            );
            const { service, loteRepo } = make({ elegiveis });
            const r = await service.formar({ triggeredBy: 'cron' });
            expect(r).toMatchObject({ lotesFormados: 2, titulosLotados: 60 });
            const lotes = itensDe(loteRepo);
            const boletos = lotes.find((l) => l[0]?.modalidade === 'BOLETO');
            const outros = lotes.find((l) => l[0]?.modalidade === undefined);
            expect(boletos).toHaveLength(58);
            expect(boletos?.every((i) => i.modalidade === 'BOLETO')).toBe(true);
            expect(outros).toHaveLength(2);
            expect(outros?.every((i) => i.modalidade === undefined)).toBe(true);
        });

        it('grupo pequeno misto também se divide: boletos nunca dividem lote com TED/PIX', async () => {
            const elegiveis = Array.from({ length: 10 }, (_, i) =>
                titulo({ docCod: String(i + 1), filCod: 2, vencimento: DIA_1, temBoleto: i < 4 }),
            );
            const { service, loteRepo } = make({ elegiveis });
            const r = await service.formar({ triggeredBy: 'cron' });
            expect(r.lotesFormados).toBe(2);
            expect(
                itensDe(loteRepo)
                    .map((l) => l.length)
                    .sort(),
            ).toEqual([4, 6]);
        });

        it('grupo só de boletos (ou só de outros) fica num lote só', async () => {
            const elegiveis = Array.from({ length: 40 }, (_, i) =>
                titulo({ docCod: String(i + 1), filCod: 2, vencimento: DIA_1, temBoleto: true }),
            );
            const { service } = make({ elegiveis });
            const r = await service.formar({ triggeredBy: 'cron' });
            expect(r.lotesFormados).toBe(1);
        });
    });
    it('agrupa por FILIAL (banco não conta) e forma um lote por grupo (automatico=true)', async () => {
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
        // 2 lotes (um por filial), 2 leituras do fin005 — uma por filial.
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

    it('desfaz os lotes automáticos vencidos antes de formar (conta no resultado)', async () => {
        const { service, loteRepo } = make({ elegiveis: [titulo()], desfeitos: 3 });
        const r = await service.formar({ triggeredBy: 'cron' });
        expect(loteRepo.desfazerAutomaticosVencidos).toHaveBeenCalled();
        expect(r.lotesDesfeitos).toBe(3);
        expect(r.lotesFormados).toBe(1);
    });

    it.each([
        ['09:00 BRT', '2026-10-14T12:00:00Z'],
        ['21:30 BRT (UTC já virou)', '2026-10-15T00:30:00Z'],
    ])('às %s, "hoje" do desfazer e da elegibilidade é o dia civil de Brasília', async (_r, instante) => {
        // Título que vence hoje não é vencido: comparar com now() desfazia o lote dele e o
        // deixava fora da formação (incidente 14/10: 15 lotes / 79 itens).
        const { service, loteRepo, tituloRepo } = make({
            calendar: BankingCalendar.withClock(() => new Date(instante)),
        });
        await service.formar({ triggeredBy: 'cron' });
        const hoje = new Date('2026-10-14T00:00:00Z');
        expect(loteRepo.desfazerAutomaticosVencidos).toHaveBeenCalledWith(hoje);
        expect(tituloRepo.listElegiveisParaFormacao).toHaveBeenCalledWith(7, hoje);
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
