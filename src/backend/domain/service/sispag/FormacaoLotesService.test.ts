import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type { GrupoParaFormacao } from '../../repository/sispag/TituloAPagarRepository.js';
import type JobExecucaoRepository from '../../repository/operacao/JobExecucaoRepository.js';
import type LeituraGrupoBoleto from './LeituraGrupoBoleto.js';
import type LogService from '../LogService.js';
import type ContaPagadoraResolver from './ContaPagadoraResolver.js';
import type SituacaoPagamentoService from './SituacaoPagamentoService.js';
import type AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import type SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import FormacaoLotesService, { PIPELINE_FORMACAO_LOTES } from './FormacaoLotesService.js';
import PreSelecaoItemLote from './PreSelecaoItemLote.js';

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
        grupos?: GrupoParaFormacao[];
        situacaoDe?: (grupoId: string) => string;
        orfaos?: string[];
        /** Chaves `fil:doc:tit` com boleto confirmado no app (CONFIRMADA + par VIGENTE). */
        confirmados?: string[];
        /** Líquido do ledger do ajuste de centavos, em centavos, por chave do título novo. */
        liquidos?: Record<string, number>;
        /** Já existe formação concluída hoje (trilha `job_execucao`). */
        jaFormouHoje?: boolean;
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
    const jobRuns = {
        createRun: jest.fn().mockResolvedValue('run-1'),
        finishRun: jest.fn().mockResolvedValue(undefined),
        existeConcluidaDesde: jest.fn().mockResolvedValue(over.jaFormouHoje ?? false),
    };
    const service = new FormacaoLotesService(
        tituloRepo as unknown as TituloAPagarRepository,
        loteRepo as unknown as LotePagamentoRepository,
        db,
        log,
        { resolverPadrao } as unknown as ContaPagadoraResolver,
        over.calendar ?? new BankingCalendar(),
        { avaliarVarios } as unknown as SituacaoPagamentoService,
        grupoRepo as unknown as GrupoBoletoRepository,
        leituraGrupo as unknown as LeituraGrupoBoleto,
        new PreSelecaoItemLote(
            {
                chavesComConfirmacaoVigente: jest
                    .fn()
                    .mockResolvedValue(new Set(over.confirmados ?? [])),
            } as unknown as SugestaoBoletoRepository,
            {
                liquidosDeTitulosRenegociados: jest
                    .fn()
                    .mockResolvedValue(new Map(Object.entries(over.liquidos ?? {}))),
            } as unknown as AjusteCentavosExecucaoRepository,
        ),
        jobRuns as unknown as JobExecucaoRepository,
    );
    return {
        jobRuns,
        service,
        tituloRepo,
        loteRepo,
        resolverPadrao,
        avaliarVarios,
        grupoRepo,
        leituraGrupo,
        db,
        log,
    };
};

const situacoes = (bloqueados: Record<string, string>) =>
    jest.fn(async (titulos: TituloAPagar[]) => {
        const mapa = new Map<string, { estado: string; motivos: string[]; principal?: string }>();
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

describe('FormacaoLotesService — só títulos PRONTO (ADR-0075, D9)', () => {
    const DIA = Date.UTC(2026, 9, 8);

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

        it('boleto confirmado no app vai para o lote de BOLETOS, como BOLETO e com o líquido do ledger', async () => {
            // Produção 2026-10-28 (NELSON HEUSI): confirmado sem DDA no ERP e renegociado pelo
            // ajuste de centavos — caía no lote "resto", sem forma de pagamento e com o valor base.
            const elegiveis = [
                titulo({ docCod: '41027', titCod: '2', vencimento: DIA_1, valor: 647.56 }),
                titulo({ docCod: '7', vencimento: DIA_1, temBoleto: true }),
                titulo({ docCod: '8', vencimento: DIA_1 }),
            ];
            const { service, loteRepo } = make({
                elegiveis,
                confirmados: ['2:41027:2'],
                liquidos: { '2:41027:2': 64757 },
            });
            const r = await service.formar({ triggeredBy: 'cron' });
            expect(r.lotesFormados).toBe(2);
            const lotes = loteRepo.adicionarItens.mock.calls.map(
                (c: unknown[]) =>
                    c[1] as Array<{ docCod: string; modalidade?: string; valor: number }>,
            );
            const boletos = lotes.find((l) => l.some((i) => i.docCod === '7'));
            expect(boletos?.map((i) => [i.docCod, i.modalidade, i.valor]).sort()).toEqual([
                ['41027', 'BOLETO', 647.57],
                ['7', 'BOLETO', 1000],
            ]);
            const resto = lotes.find((l) => l.some((i) => i.docCod === '8'));
            expect(resto?.map((i) => [i.docCod, i.modalidade])).toEqual([['8', undefined]]);
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

describe('FormacaoLotesService — grupo de boleto como unidade (ADR-0077, P1-4, PI-8)', () => {
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
        // Grupo manual: os títulos vencem ANTES do boleto (I21g).
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
    ])('grupo %s não é lotado pelo cron (I21j/I21r) e é contado no log da rodada', async (situacao, over) => {
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

    it('grupo só é lotado quando TODOS os títulos estão PRONTOS: um bloqueado deixa o grupo inteiro de fora', async () => {
        const m = make({
            grupos: [grupoAuto('G1')],
            avaliarVarios: situacoes({ '38884': 'TIPO_PERMUTA' }),
        });
        const r = await m.service.formar({ triggeredBy: 'cron' });
        expect(m.loteRepo.adicionarGrupo).not.toHaveBeenCalled();
        expect(m.loteRepo.criarLote).not.toHaveBeenCalled();
        expect(r.gruposLotados).toBe(0);
    });

    it('grupo com todos os títulos PRONTOS é lotado', async () => {
        const m = make({ grupos: [grupoAuto('G1')] });
        const r = await m.service.formar({ triggeredBy: 'cron' });
        expect(r.gruposLotados).toBe(1);
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

/**
 * Formação AUTOMÁTICA (cron): dia útil, nunca antes das 06:30 BRT, no máximo uma rodada concluída
 * por dia de Brasília — conferida dentro do lock (v0.53.0, Gabriel 2026-10-30). Manual sem trava.
 */
describe('FormacaoLotesService — uma formação automática por dia útil (v0.53.0)', () => {
    // 2026-10-30 é sexta-feira (dia útil); 31/10 é sábado.
    const em = (iso: string) => BankingCalendar.withClock(() => new Date(iso));

    it('automática às 07:07 BRT de dia útil, sem formação hoje: forma e grava trilha', async () => {
        const { service, loteRepo, jobRuns } = make({
            elegiveis: [titulo()],
            calendar: em('2026-10-30T10:07:00Z'),
        });
        const r = await service.formar({ triggeredBy: 'cron', automatica: true });
        expect(r.pulado).toBeUndefined();
        expect(loteRepo.criarLote).toHaveBeenCalledTimes(1);
        expect(jobRuns.existeConcluidaDesde).toHaveBeenCalledWith(
            PIPELINE_FORMACAO_LOTES,
            new Date('2026-10-30T03:00:00Z'),
        );
        expect(jobRuns.createRun).toHaveBeenCalledWith({
            pipeline: PIPELINE_FORMACAO_LOTES,
            triggeredBy: 'cron',
        });
        expect(jobRuns.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: 'run-1',
                status: 'success',
                metricas: expect.objectContaining({ lotesFormados: 1, titulosLotados: 1 }),
            }),
        );
    });

    it('já formou hoje: pula sem tocar lote nem gravar trilha', async () => {
        const { service, loteRepo, jobRuns } = make({
            elegiveis: [titulo()],
            calendar: em('2026-10-30T15:13:00Z'),
            jaFormouHoje: true,
        });
        const r = await service.formar({ triggeredBy: 'cron', automatica: true });
        expect(r).toEqual({
            lotesFormados: 0,
            titulosLotados: 0,
            lotesDesfeitos: 0,
            pulado: 'ja_formado_hoje',
        });
        expect(loteRepo.desfazerAutomaticosVencidos).not.toHaveBeenCalled();
        expect(loteRepo.criarLote).not.toHaveBeenCalled();
        expect(jobRuns.createRun).not.toHaveBeenCalled();
    });

    it('antes das 06:30 BRT (slot das 05:07): não forma; 06:30 em ponto já forma', async () => {
        const cedo = make({ elegiveis: [titulo()], calendar: em('2026-10-30T09:29:59Z') });
        expect((await cedo.service.formar({ triggeredBy: 'cron', automatica: true })).pulado).toBe(
            'antes_das_0630',
        );
        expect(cedo.loteRepo.criarLote).not.toHaveBeenCalled();
        expect(cedo.jobRuns.existeConcluidaDesde).not.toHaveBeenCalled();

        const hora = make({ elegiveis: [titulo()], calendar: em('2026-10-30T09:30:00Z') });
        expect(
            (await hora.service.formar({ triggeredBy: 'cron', automatica: true })).pulado,
        ).toBeUndefined();
    });

    it('fim de semana: nenhuma formação automática', async () => {
        const { service, loteRepo } = make({
            elegiveis: [titulo()],
            calendar: em('2026-10-31T10:07:00Z'),
        });
        expect((await service.formar({ triggeredBy: 'cron', automatica: true })).pulado).toBe(
            'dia_nao_util',
        );
        expect(loteRepo.criarLote).not.toHaveBeenCalled();
    });

    it('fronteira do dia é Brasília: 23:30 BRT de ontem é "ontem" (início do dia = 03:00Z)', async () => {
        const { service, jobRuns } = make({ calendar: em('2026-10-30T02:30:00Z') });
        // 02:30Z de 30/10 = 23:30 BRT de 29/10 (quinta, útil, depois das 06:30).
        await service.formar({ triggeredBy: 'cron', automatica: true });
        expect(jobRuns.existeConcluidaDesde).toHaveBeenCalledWith(
            PIPELINE_FORMACAO_LOTES,
            new Date('2026-10-29T03:00:00Z'),
        );
    });

    it('manual não tem trava: forma mesmo com formação hoje, de madrugada ou no sábado', async () => {
        const { service, loteRepo, jobRuns } = make({
            elegiveis: [titulo()],
            calendar: em('2026-10-31T08:00:00Z'),
            jaFormouHoje: true,
        });
        const r = await service.formar({ triggeredBy: 'admin@kavex' });
        expect(r.pulado).toBeUndefined();
        expect(loteRepo.criarLote).toHaveBeenCalledTimes(1);
        expect(jobRuns.existeConcluidaDesde).not.toHaveBeenCalled();
        expect(jobRuns.createRun).toHaveBeenCalledWith({
            pipeline: PIPELINE_FORMACAO_LOTES,
            triggeredBy: 'admin@kavex',
        });
    });

    it('a checagem acontece DENTRO do lock: lock ocupado nem consulta a trilha', async () => {
        const { service, jobRuns } = make({ acquire: false, calendar: em('2026-10-30T10:07:00Z') });
        await expect(
            service.formar({ triggeredBy: 'cron', automatica: true }),
        ).rejects.toBeInstanceOf(IngestLockBusyError);
        expect(jobRuns.existeConcluidaDesde).not.toHaveBeenCalled();
    });

    it('falha na formação fecha a trilha como error e propaga', async () => {
        const { service, loteRepo, jobRuns } = make({
            elegiveis: [titulo()],
            calendar: em('2026-10-30T10:07:00Z'),
        });
        loteRepo.desfazerAutomaticosVencidos.mockRejectedValueOnce(new Error('banco fora'));
        await expect(service.formar({ triggeredBy: 'cron', automatica: true })).rejects.toThrow(
            'banco fora',
        );
        expect(jobRuns.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                runId: 'run-1',
                status: 'error',
                errorMessage: 'banco fora',
            }),
        );
    });
});
