import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type { GrupoParaFormacao } from '../../repository/sispag/TituloAPagarRepository.js';
import type LeituraGrupoBoleto from './LeituraGrupoBoleto.js';
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
        calendar?: BankingCalendar;
        grupos?: GrupoParaFormacao[];
        situacaoDe?: (grupoId: string) => string;
        orfaos?: string[];
    } = {},
) => {
    const resolverPadrao = jest
        .fn()
        .mockResolvedValue('conta' in over ? over.conta : { banco: 'ITAÚ', conta: '55795-4' });
    const tituloRepo = {
        listElegiveisParaFormacao: jest.fn().mockResolvedValue(over.elegiveis ?? []),
        listGruposParaFormacao: jest.fn().mockResolvedValue(over.grupos ?? []),
    };
    const grupoRepo = {
        buscarPorId: jest.fn(async (id: string) => ({
            id,
            estado: 'CONFIRMADO',
            ddcCod: 900,
            ditCod: 1,
        })),
        travar: jest.fn().mockResolvedValue(undefined),
    };
    const leituraGrupo = {
        orfao: jest.fn(async (g: { id: string }) =>
            over.orfaos?.includes(g.id)
                ? { orfao: true, motivo: 'BOLETO_FORA_DO_POOL' }
                : { orfao: false },
        ),
        situacao: jest.fn(async (g: { id: string }, ctx: { orfao?: boolean }) =>
            ctx.orfao ? 'ORFAO' : (over.situacaoDe?.(g.id) ?? 'DISPONIVEL'),
        ),
    };
    const loteRepo = {
        desfazerAutomaticosVencidos: jest.fn().mockResolvedValue(over.desfeitos ?? 0),
        criarLote: jest.fn().mockResolvedValue({ id: 'L1' }),
        adicionarItens: jest.fn().mockResolvedValue(undefined),
        adicionarGrupo: jest.fn().mockResolvedValue('APLICADO'),
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
    const log = buildLog();
    const service = new FormacaoLotesService(
        tituloRepo as unknown as TituloAPagarRepository,
        loteRepo as unknown as LotePagamentoRepository,
        db,
        log,
        { resolverPadrao } as unknown as ContaPagadoraResolver,
        over.calendar ?? new BankingCalendar(),
        grupoRepo as unknown as GrupoBoletoRepository,
        leituraGrupo as unknown as LeituraGrupoBoleto,
    );
    return { service, tituloRepo, loteRepo, resolverPadrao, grupoRepo, leituraGrupo, db, log };
};

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

describe('FormacaoLotesService — grupo de boleto como unidade (ADR-0076, P1-4, PI-8)', () => {
    const DIA_TITULO = Date.UTC(2026, 9, 20);
    const DIA_BOLETO = Date.UTC(2026, 9, 22);
    const grupoAuto = (
        grupoId: string,
        over: Partial<GrupoParaFormacao> = {},
    ): GrupoParaFormacao => ({
        grupoId,
        filCod: 2,
        pesCod: '9001',
        credor: 'PEDRONI',
        vencimentoBoleto: DIA_BOLETO,
        valorBoletoCentavos: 105_000,
        // Grupo manual: os títulos vencem ANTES do boleto (I19g).
        titulos: ['38883', '38884'].map((docCod) =>
            titulo({
                docCod,
                credor: 'PEDRONI',
                valor: 525,
                vencimento: DIA_TITULO,
                temBoleto: false,
            }),
        ),
        ...over,
    });
    const lotesCriados = (m: ReturnType<typeof make>) =>
        m.loteRepo.criarLote.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);

    it('grupo DISPONIVEL entra inteiro no lote de BOLETOS do dia do vencimento do BOLETO, junto dos boletos avulsos desse dia, numa transação', async () => {
        const m = make({
            elegiveis: [
                titulo({ docCod: '1', vencimento: DIA_BOLETO, temBoleto: true }),
                titulo({ docCod: '2', vencimento: DIA_BOLETO, temBoleto: false }),
            ],
            grupos: [grupoAuto('G1')],
        });
        m.loteRepo.criarLote
            .mockResolvedValueOnce({ id: 'LB' })
            .mockResolvedValueOnce({ id: 'LR' });
        const r = await m.service.formar({ triggeredBy: 'cron' });

        expect(r).toMatchObject({ lotesFormados: 2, titulosLotados: 4, gruposLotados: 1 });
        expect(m.loteRepo.adicionarGrupo).toHaveBeenCalledTimes(1);
        const [pedido, tx] = m.loteRepo.adicionarGrupo.mock.calls[0] as [
            Record<string, unknown>,
            unknown,
        ];
        expect(pedido).toEqual({
            loteId: 'LB',
            grupoId: 'G1',
            itens: [
                expect.objectContaining({ docCod: '38883', vencimento: DIA_TITULO, valor: 525 }),
                expect.objectContaining({ docCod: '38884', vencimento: DIA_TITULO, valor: 525 }),
            ],
            incluidoPor: 'cron',
        });
        expect(tx).toEqual({});
        // O avulso boleto do mesmo dia divide o lote com o grupo; o não-boleto fica no outro.
        const itensDoLote = m.loteRepo.adicionarItens.mock.calls.map((c: unknown[]) => [
            c[0],
            (c[1] as Array<{ docCod: string }>).map((i) => i.docCod),
        ]);
        expect(itensDoLote).toEqual([
            ['LB', ['1']],
            ['LR', ['2']],
        ]);
        // Uma transação por lote: o grupo entra na MESMA do lote LB.
        expect(m.db.withTransaction).toHaveBeenCalledTimes(2);
        // Sob os locks boleto → títulos (ordem fixa da T8), relido na transação.
        expect(m.grupoRepo.travar).toHaveBeenCalledWith({}, [
            'sispag:boleto:900:1',
            'sispag:titulo:2:38883:1',
            'sispag:titulo:2:38884:1',
        ]);
        expect(m.grupoRepo.buscarPorId).toHaveBeenLastCalledWith('G1', {});
    });

    it('sem boleto avulso no dia do boleto, o grupo forma um lote só dele (nunca vai para o dia do título)', async () => {
        const m = make({
            elegiveis: [titulo({ docCod: '9', vencimento: DIA_TITULO, temBoleto: true })],
            grupos: [grupoAuto('G1')],
        });
        m.loteRepo.criarLote
            .mockResolvedValueOnce({ id: 'LA' })
            .mockResolvedValueOnce({ id: 'LG' });
        await m.service.formar({ triggeredBy: 'cron' });
        expect(m.loteRepo.criarLote).toHaveBeenCalledTimes(2);
        const doGrupo = m.loteRepo.adicionarGrupo.mock.calls[0]?.[0] as { loteId: string };
        const doAvulso = m.loteRepo.adicionarItens.mock.calls.find(
            (c: unknown[]) => (c[1] as unknown[]).length > 0,
        )?.[0];
        expect(doGrupo.loteId).not.toBe(doAvulso);
        expect(lotesCriados(m).every((l) => l.automatico === true && l.filCod === 2)).toBe(true);
    });

    it('título de grupo nunca entra avulso: a carteira elegível não o traz, e o grupo vai inteiro mesmo com avulsos do mesmo credor no mesmo dia', async () => {
        const m = make({
            elegiveis: [
                titulo({
                    docCod: '77',
                    credor: 'PEDRONI',
                    vencimento: DIA_BOLETO,
                    temBoleto: true,
                }),
            ],
            grupos: [grupoAuto('G1')],
        });
        await m.service.formar({ triggeredBy: 'cron' });
        const avulsos = m.loteRepo.adicionarItens.mock.calls.flatMap((c: unknown[]) =>
            (c[1] as Array<{ docCod: string }>).map((i) => i.docCod),
        );
        expect(avulsos).toEqual(['77']);
        expect(m.loteRepo.adicionarGrupo.mock.calls[0]?.[0]).toMatchObject({ grupoId: 'G1' });
    });

    it.each([
        ['ORFAO', { orfaos: ['G1'] }],
        ['RETIDO', { situacaoDe: () => 'RETIDO' }],
        ['REJEITADO', { situacaoDe: () => 'REJEITADO' }],
    ])('grupo %s não é lotado pelo cron (I19j/I19r) e é contado no log da rodada', async (situacao, over) => {
        const m = make({ grupos: [grupoAuto('G1')], ...over });
        const r = await m.service.formar({ triggeredBy: 'cron' });
        expect(m.loteRepo.adicionarGrupo).not.toHaveBeenCalled();
        expect(m.loteRepo.criarLote).not.toHaveBeenCalled();
        expect(r.gruposLotados).toBe(0);
        expect(m.log.info).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'formação automática de lotes concluída',
                data: expect.objectContaining({ gruposNaoLotados: { [situacao]: 1 } }),
            }),
        );
    });

    it('grupo que deixou de estar CONFIRMADO entre a consulta e a leitura é ignorado', async () => {
        const m = make({ grupos: [grupoAuto('G1')] });
        m.grupoRepo.buscarPorId.mockResolvedValue({
            id: 'G1',
            estado: 'ANULADO',
            ddcCod: 900,
            ditCod: 1,
        });
        await m.service.formar({ triggeredBy: 'cron' });
        expect(m.loteRepo.adicionarGrupo).not.toHaveBeenCalled();
    });

    it('a janela e o desfazer usam o dia civil de Brasília (o "vencido" do grupo é o do boleto, no SQL)', async () => {
        const m = make({
            calendar: BankingCalendar.withClock(() => new Date('2026-10-23T01:30:00Z')),
        });
        await m.service.formar({ triggeredBy: 'cron' });
        const hoje = new Date('2026-10-22T00:00:00Z');
        expect(m.loteRepo.desfazerAutomaticosVencidos).toHaveBeenCalledWith(hoje);
        expect(m.tituloRepo.listGruposParaFormacao).toHaveBeenCalledWith(7, hoje);
    });

    it('grupo que não entra (conflito no INSERT) desfaz o lote inteiro: nunca parte do lote', async () => {
        const m = make({
            elegiveis: [titulo({ docCod: '1', vencimento: DIA_BOLETO, temBoleto: true })],
            grupos: [grupoAuto('G1')],
        });
        m.loteRepo.adicionarGrupo.mockResolvedValue('CONFLITO');
        await expect(m.service.formar({ triggeredBy: 'cron' })).rejects.toThrow(/G1/);
    });

    it('log da rodada em português, com a contagem de grupos lotados', async () => {
        const m = make({ grupos: [grupoAuto('G1'), grupoAuto('G2', { filCod: 4 })] });
        await m.service.formar({ triggeredBy: 'cron' });
        expect(m.log.info).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'formação automática de lotes concluída',
                data: expect.objectContaining({
                    gruposLotados: 2,
                    lotesFormados: 2,
                    titulosLotados: 4,
                }),
            }),
        );
    });
});

describe('FormacaoLotesService — grupo anulado durante a rodada', () => {
    it('relido sob o lock e já ANULADO ⇒ não entra (o lote segue com os avulsos)', async () => {
        const dia = Date.UTC(2026, 9, 22);
        const m = make({
            elegiveis: [titulo({ docCod: '1', vencimento: dia, temBoleto: true })],
            grupos: [
                {
                    grupoId: 'G1',
                    filCod: 2,
                    pesCod: '9001',
                    vencimentoBoleto: dia,
                    valorBoletoCentavos: 105_000,
                    titulos: ['3', '4'].map((docCod) => titulo({ docCod })),
                },
            ],
        });
        m.grupoRepo.buscarPorId
            .mockResolvedValueOnce({ id: 'G1', estado: 'CONFIRMADO', ddcCod: 900, ditCod: 1 })
            .mockResolvedValueOnce({ id: 'G1', estado: 'ANULADO', ddcCod: 900, ditCod: 1 });
        await m.service.formar({ triggeredBy: 'cron' });
        expect(m.loteRepo.adicionarGrupo).not.toHaveBeenCalled();
        expect(m.loteRepo.adicionarItens).toHaveBeenCalledTimes(1);
    });
});
