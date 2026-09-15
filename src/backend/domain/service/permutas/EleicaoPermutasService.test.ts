import 'reflect-metadata';
import EleicaoPermutasService from './EleicaoPermutasService.js';
import ElegibilidadeService from './ElegibilidadeService.js';
import CasamentoInvoiceService from './CasamentoInvoiceService.js';
import VariacaoCambialPermutaService from './VariacaoCambialPermutaService.js';
import AgingService from './AgingService.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type ConexosCadastroClient from '../../client/ConexosCadastroClient.js';
import type ConexosFinanceiroClient from '../../client/ConexosFinanceiroClient.js';
import type ConexosTitulosClient from '../../client/ConexosTitulosClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import PermutaSnapshotRepository from '../../repository/permutas/PermutaSnapshotRepository.js';
import type LogService from '../LogService.js';
import { LOG_TYPE } from '../../interface/log/LogInterface.js';
import {
    ESTADO_ELEGIBILIDADE,
    MOTIVO_BLOQUEIO,
} from '../../interface/permutas/EstadoElegibilidade.js';
import { GATE } from '../../interface/permutas/PermutaCandidata.js';
import ConexosError from '../../errors/ConexosError.js';

type LogCall = { type: string; data?: Record<string, unknown> };

const buildLogService = () => {
    const calls: LogCall[] = [];
    const capture = jest.fn(async (p: LogCall) => {
        calls.push(p);
    });
    const logService = {
        info: capture,
        warn: capture,
        error: capture,
        success: capture,
    } as unknown as LogService;
    return { logService, calls };
};

/**
 * Combined Conexos mock — the CC-2 split moved the methods used here across
 * three sub-clients (Cadastro/Financeiro/Titulos). The test fakes them all on
 * a single object and injects it into each sub-client slot via `buildEleicao`.
 */
type PublicShape<T> = { [K in keyof T]: T[K] };
type ConexosMock = PublicShape<ConexosCadastroClient> &
    PublicShape<ConexosFinanceiroClient> &
    PublicShape<ConexosTitulosClient>;

/**
 * Constructs the service from the single combined Conexos mock, injecting it
 * into the three sub-client constructor slots. `rest` mirrors the remaining
 * constructor params (elegibilidade … clienteFiltro) one-to-one.
 */
const buildEleicao = (
    conexos: ConexosMock,
    ...rest: ConstructorParameters<typeof EleicaoPermutasService> extends [
        ConexosCadastroClient,
        ConexosFinanceiroClient,
        ConexosTitulosClient,
        ...infer R,
    ]
        ? R
        : never
) =>
    new EleicaoPermutasService(
        conexos as unknown as ConexosCadastroClient,
        conexos as unknown as ConexosFinanceiroClient,
        conexos as unknown as ConexosTitulosClient,
        ...rest,
    );

const buildConexos = (over: Partial<jest.Mocked<ConexosMock>> = {}) =>
    ({
        listFiliais: jest.fn().mockResolvedValue([{ filCod: 2 }]),
        listAdiantamentosProforma: jest
            .fn()
            .mockResolvedValue({ adiantamentos: [], capHit: false }),
        listInvoicesFinalizadas: jest.fn().mockResolvedValue({ invoices: [], capHit: false }),
        getDetalheTitulos: jest.fn().mockResolvedValue({ valorPermutar: 1000, pago: true }),
        listDeclaracaoByProcesso: jest.fn().mockResolvedValue([{ variante: 'DI', priCod: '2048' }]),
        listFinanceiroAPagar: jest.fn().mockResolvedValue({ proformas: [], invoices: [] }),
        listTitulosAPagar: jest.fn().mockResolvedValue([]),
        listProcessos: jest.fn().mockResolvedValue([]),
        ...over,
    }) as unknown as ConexosMock;

/** Mock do ClienteFiltroRepository — sem clientes-filtro por padrão. */
const buildClienteFiltro = (pesCods: string[] = []) =>
    ({
        listPesCodsAtivos: jest.fn().mockResolvedValue(new Set(pesCods)),
    }) as unknown as jest.Mocked<
        import('../../repository/permutas/ClienteFiltroRepository.js').default
    >;

const buildRepo = () =>
    ({
        persistRun: jest.fn().mockResolvedValue('run-uuid'),
        findRunIdByIdempotencyKey: jest.fn().mockResolvedValue(null),
        recordIdempotencyKey: jest.fn().mockResolvedValue(undefined),
        findRunSummaryById: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PermutaSnapshotRepository>;

/**
 * Minimal DB-client mock. `withAdvisoryLock(key, onAcquired, _onBusy)` always
 * grants the lock here (single-process test) so the run proceeds normally.
 */
const buildDb = () =>
    ({
        withAdvisoryLock: jest.fn(async (_key: number, onAcquired: () => Promise<unknown>) =>
            onAcquired(),
        ),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const realServices = () => ({
    elegibilidade: new ElegibilidadeService(new CasamentoInvoiceService()),
    variacao: new VariacaoCambialPermutaService(),
    aging: new AgingService(),
    concurrency: new BoundedConcurrency(),
    db: buildDb(),
    clienteFiltro: buildClienteFiltro(),
});

const adiantamento = {
    docCod: 'A1',
    priCod: '2048',
    filCod: 2,
    dataEmissao: new Date('2026-03-01'),
    valor: 1000,
    moeda: 'USD',
    pago: true,
    valorPermutar: 1000,
};
const invoice = {
    docCod: 'I1',
    priCod: '2048',
    dataEmissao: new Date('2026-04-01'),
    valor: 1000,
    moeda: 'USD',
    pago: false,
};

describe('EleicaoPermutasService (orchestrator / job)', () => {
    it('runs the happy-path chain → 1 elegivel, persists snapshot, FLOW_COMPLETE', async () => {
        const conexos = buildConexos({
            listAdiantamentosProforma: jest
                .fn()
                .mockResolvedValue({ adiantamentos: [adiantamento], capHit: false }),
            listFinanceiroAPagar: jest
                .fn()
                .mockResolvedValue({ proformas: [], invoices: [invoice] }),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService, calls } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        const result = await service.executar({ triggeredBy: 'user-123' });

        expect(result.status).toBe('success');
        expect(result.totalElegiveis).toBe(1);
        expect(result.totalBloqueadas).toBe(0);
        expect(result.candidatas[0].estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.ELEGIVEL);

        // persistRun called once with status success + the candidatas.
        expect(repo.persistRun).toHaveBeenCalledTimes(1);
        const [runArg, candidatasArg] = repo.persistRun.mock.calls[0];
        expect(runArg.status).toBe('success');
        expect(runArg.triggeredBy).toBe('user-123');
        expect(candidatasArg).toHaveLength(1);

        // flowId present on EVERY log line and equal to the run's flow_id.
        expect(calls.length).toBeGreaterThan(0);
        const flowIds = new Set(calls.map((c) => c.data?.flowId));
        expect(flowIds.size).toBe(1);
        expect([...flowIds][0]).toBe(runArg.flowId);

        // FLOW_START + FLOW_COMPLETE summary (single line), uses named LogType.
        const types = calls.map((c) => c.type);
        expect(types).toContain(LOG_TYPE.FLOW_START);
        const complete = calls.filter((c) => c.type === LOG_TYPE.FLOW_COMPLETE);
        expect(complete).toHaveLength(1);
        expect(complete[0].data).toMatchObject({ totalCandidatas: 1, totalElegiveis: 1 });
    });

    it('hydrates valorTotal/valorAberto (progresso de pagamento) from the detalhe', async () => {
        const adtoNaoPago = { ...adiantamento, pago: false };
        const conexos = buildConexos({
            listAdiantamentosProforma: jest
                .fn()
                .mockResolvedValue({ adiantamentos: [adtoNaoPago], capHit: false }),
            // Parcialmente pago: face 1000, ainda 400 em aberto (⇒ Gate 3 reprova).
            getDetalheTitulos: jest.fn().mockResolvedValue({
                valorPermutar: 1000,
                pago: false,
                valorTotal: 1000,
                valorAberto: 400,
            }),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        const result = await service.executar({ triggeredBy: 'user-123' });

        expect(result.candidatas[0].adiantamento.valorTotal).toBe(1000);
        expect(result.candidatas[0].adiantamento.valorAberto).toBe(400);
    });

    // Cliente-filtro (Fase 1): adto de importador cadastrado, pago + com saldo, SEM
    // D.I → roteado para `permuta-manual` (em vez de bloqueada). Hidrata o importador.
    const buildFiltroConexos = (pago: boolean) =>
        buildConexos({
            listAdiantamentosProforma: jest.fn().mockResolvedValue({
                adiantamentos: [{ ...adiantamento, priCod: '1153' }],
                capHit: false,
            }),
            listProcessos: jest
                .fn()
                .mockResolvedValue([{ priCod: '1153', pesCod: '191', importador: 'INOX-TECH' }]),
            listDeclaracaoByProcesso: jest.fn().mockResolvedValue([]), // sem D.I → bloqueada
            getDetalheTitulos: jest.fn().mockResolvedValue({ valorPermutar: 1000, pago }),
        } as Partial<jest.Mocked<ConexosMock>>);

    const runWith = async (
        conexos: ConexosMock,
        clienteFiltro: ReturnType<typeof buildClienteFiltro>,
    ) => {
        const { elegibilidade, variacao, aging, concurrency, db } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            buildRepo() as unknown as PermutaSnapshotRepository,
            buildLogService().logService,
            concurrency,
            db,
            clienteFiltro,
        );
        return service.executar({ triggeredBy: 'u' });
    };

    it('routes a cliente-filtro adto (pago + saldo, sem D.I) to permuta-manual + hidrata importador', async () => {
        const result = await runWith(buildFiltroConexos(true), buildClienteFiltro(['191']));
        const c = result.candidatas[0];
        expect(c.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL);
        expect(c.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.CLIENTE_FILTRO);
        expect(c.adiantamento.pesCod).toBe('191');
        expect(c.adiantamento.importador).toBe('INOX-TECH');
    });

    it('non-filtro adto (mesmo setup) continua bloqueada por data-base-indisponivel', async () => {
        const result = await runWith(buildFiltroConexos(true), buildClienteFiltro([]));
        const c = result.candidatas[0];
        expect(c.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(c.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.DATA_BASE_INDISPONIVEL);
    });

    it('cliente-filtro NÃO pago continua bloqueada (a permuta manual exige pago)', async () => {
        const result = await runWith(buildFiltroConexos(false), buildClienteFiltro(['191']));
        expect(result.candidatas[0].estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
    });

    // ADR-0046 D1 — tolerância de R$ 1,00 aplicada na HIDRATAÇÃO do adiantamento (Gate 3) e no
    // roteamento de cliente-filtro (Gate 2). O `pago` estrito do wire não muda.
    const buildDetalheConexos = (detalhe: Record<string, unknown>, declaracoes: unknown[] = []) =>
        buildConexos({
            listAdiantamentosProforma: jest.fn().mockResolvedValue({
                adiantamentos: [{ ...adiantamento, priCod: '1153', pago: false }],
                capHit: false,
            }),
            listProcessos: jest
                .fn()
                .mockResolvedValue([{ priCod: '1153', pesCod: '191', importador: 'INOX-TECH' }]),
            listDeclaracaoByProcesso: jest.fn().mockResolvedValue(declaracoes),
            getDetalheTitulos: jest.fn().mockResolvedValue(detalhe),
        } as Partial<jest.Mocked<ConexosMock>>);

    it('doc 8721: em aberto R$ 0,02 (wire sem `pago`) → adiantamento.pago=true, motivo ≠ nao-pago', async () => {
        const result = await runWith(
            buildDetalheConexos({
                valorPermutar: 0,
                valorAberto: 0.02,
                valorPermutado: 20373009.87,
            }),
            buildClienteFiltro([]),
        );
        const c = result.candidatas[0];
        expect(c.adiantamento.pago).toBe(true);
        expect(c.motivoBloqueio).not.toBe(MOTIVO_BLOQUEIO.NAO_PAGO);
        expect(c.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.JA_PERMUTADO);
    });

    it('doc 3754: em aberto R$ 21,01 → BLOQUEADA(nao-pago), adiantamento.pago=false', async () => {
        const result = await runWith(
            buildDetalheConexos({ valorPermutar: 1000, valorAberto: 21.01 }),
            buildClienteFiltro([]),
        );
        const c = result.candidatas[0];
        expect(c.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(c.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.NAO_PAGO);
        expect(c.adiantamento.pago).toBe(false);
    });

    it('cliente-filtro com resíduo de R$ 0,10 (sem D.I, já permutado) NÃO roteia → JA_PERMUTADO', async () => {
        const result = await runWith(
            buildDetalheConexos({
                valorPermutar: 0.1,
                pago: true,
                valorAberto: 0,
                valorPermutado: 5000,
            }),
            buildClienteFiltro(['191']),
        );
        const c = result.candidatas[0];
        expect(c.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.JA_PERMUTADO);
        expect(c.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.JA_PERMUTADO);
    });

    it('cliente-filtro com saldo de R$ 1,01 (sem D.I) → PERMUTA_MANUAL/cliente-filtro', async () => {
        const result = await runWith(
            buildDetalheConexos({ valorPermutar: 1.01, pago: true, valorAberto: 0 }),
            buildClienteFiltro(['191']),
        );
        const c = result.candidatas[0];
        expect(c.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.PERMUTA_MANUAL);
        expect(c.motivoBloqueio).toBe(MOTIVO_BLOQUEIO.CLIENTE_FILTRO);
    });

    it('hydrates moedaNegociada from the título (moedaCod 220 → USD) on adiantamento + invoice', async () => {
        // Doc currency is BRL (default), but the NEGOCIADA currency of the título
        // is USD (moedaCod 220). The candidata must carry USD as moedaNegociada so
        // the Gestão column "Valor Moeda Negociada" labels the value as USD, not BRL.
        const adtoBrlDoc = { ...adiantamento, moeda: 'BRL' };
        const invBrlDoc = { ...invoice, moeda: 'BRL' };
        const conexos = buildConexos({
            listAdiantamentosProforma: jest
                .fn()
                .mockResolvedValue({ adiantamentos: [adtoBrlDoc], capHit: false }),
            listFinanceiroAPagar: jest
                .fn()
                .mockResolvedValue({ proformas: [], invoices: [invBrlDoc] }),
            // Both títulos negotiated in USD with a locked rate.
            listTitulosAPagar: jest.fn().mockResolvedValue([
                {
                    titCod: 'T1',
                    valorNegociado: 1100,
                    taxa: 5.0,
                    moedaCod: 220,
                    moedaNome: 'DOLAR DOS EUA',
                },
            ]),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        const result = await service.executar({ triggeredBy: 'user-123' });

        const c = result.candidatas[0];
        expect(c.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.ELEGIVEL);
        // doc currency stays BRL; negotiated currency is USD.
        expect(c.adiantamento.moeda).toBe('BRL');
        expect(c.adiantamento.moedaNegociada).toBe('USD');
        expect(c.adiantamento.valorMoedaNegociada).toBe(1100);
        expect(c.invoiceCasada?.moedaNegociada).toBe('USD');
    });

    it('hidrata valorAbertoNegociado na invoice casável (em-aberto vivo / taxa)', async () => {
        // Detalhe da invoice traz valorAberto 5000 BRL; taxa negociada 5.0 → 1000 USD
        // (teto vivo da distribuição Simples).
        const conexos = buildConexos({
            listAdiantamentosProforma: jest
                .fn()
                .mockResolvedValue({ adiantamentos: [adiantamento], capHit: false }),
            listFinanceiroAPagar: jest
                .fn()
                .mockResolvedValue({ proformas: [], invoices: [invoice] }),
            listTitulosAPagar: jest.fn().mockResolvedValue([
                {
                    titCod: 'T1',
                    valorNegociado: 1100,
                    taxa: 5.0,
                    moedaCod: 220,
                    moedaNome: 'DOLAR DOS EUA',
                },
            ]),
            // Mock por docCod: o `pago` do wire é `valorAberto === 0` (mapDetalheTitulos), então o
            // adto pago tem em aberto 0 e só a INVOICE traz os 5000 BRL em aberto (ADR-0046 D1: o
            // Gate 3 do adto passou a ler o `valorAberto`).
            getDetalheTitulos: jest
                .fn()
                .mockImplementation(async ({ docCod }: { docCod: string }) =>
                    docCod === adiantamento.docCod
                        ? { valorPermutar: 1000, pago: true, valorAberto: 0 }
                        : { valorPermutar: 1000, pago: false, valorAberto: 5000 },
                ),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        const result = await service.executar({ triggeredBy: 'user-123' });
        const c = result.candidatas[0];
        expect(c.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.ELEGIVEL);
        expect(c.invoiceCasada?.valorAbertoNegociado).toBeCloseTo(1000, 4);
    });

    it('sem valorAberto no detalhe → invoice fica SEM valorAbertoNegociado (fallback ao negociado)', async () => {
        // getDetalheTitulos default (sem valorAberto) → distribuição cai no valorMoedaNegociada.
        const conexos = buildConexos({
            listAdiantamentosProforma: jest
                .fn()
                .mockResolvedValue({ adiantamentos: [adiantamento], capHit: false }),
            listFinanceiroAPagar: jest
                .fn()
                .mockResolvedValue({ proformas: [], invoices: [invoice] }),
            listTitulosAPagar: jest.fn().mockResolvedValue([
                {
                    titCod: 'T1',
                    valorNegociado: 1100,
                    taxa: 5.0,
                    moedaCod: 220,
                    moedaNome: 'DOLAR DOS EUA',
                },
            ]),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        const result = await service.executar({ triggeredBy: 'user-123' });
        const c = result.candidatas[0];
        expect(c.invoiceCasada?.valorAbertoNegociado).toBeUndefined();
        expect(c.invoiceCasada?.valorMoedaNegociada).toBe(1100);
    });

    it('is idempotent: two runs produce the same candidate set', async () => {
        const conexos = buildConexos({
            listAdiantamentosProforma: jest
                .fn()
                .mockResolvedValue({ adiantamentos: [adiantamento], capHit: false }),
            listFinanceiroAPagar: jest
                .fn()
                .mockResolvedValue({ proformas: [], invoices: [invoice] }),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        const first = await service.executar({ triggeredBy: 'u' });
        const second = await service.executar({ triggeredBy: 'u' });
        expect(second.candidatas.map((c) => c.adiantamento.docCod)).toEqual(
            first.candidatas.map((c) => c.adiantamento.docCod),
        );
        expect(second.totalElegiveis).toBe(first.totalElegiveis);
    });

    it('emits BUSINESS_WARN capHit when pagination is truncated', async () => {
        const conexos = buildConexos({
            listAdiantamentosProforma: jest
                .fn()
                .mockResolvedValue({ adiantamentos: [], capHit: true }),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService, calls } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        await service.executar({ triggeredBy: 'u' });

        const warn = calls.find((c) => c.type === LOG_TYPE.BUSINESS_WARN);
        expect(warn).toBeDefined();
        expect(warn?.data).toMatchObject({ capHit: true, filCod: 2 });
    });

    it('blocks candidata with DETAIL_INDISPONIVEL when getDetalheTitulos fails after retries (P0-3)', async () => {
        const conexos = buildConexos({
            listAdiantamentosProforma: jest
                .fn()
                .mockResolvedValue({ adiantamentos: [adiantamento], capHit: false }),
            getDetalheTitulos: jest
                .fn()
                .mockRejectedValue(new ConexosError({ endpoint: 'com298/A1', priCod: 'A1' })),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService, calls } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        const result = await service.executar({ triggeredBy: 'u' });

        // Run still completes (no abort) — just one blocked candidata.
        expect(result.status).toBe('success');
        expect(result.totalBloqueadas).toBe(1);
        expect(result.candidatas[0].estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        expect(result.candidatas[0].motivoBloqueio).toBe(MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL);
        // Distinct from falha-gate: a BUSINESS_WARN is emitted, not a FLOW_ERROR.
        expect(calls.some((c) => c.type === LOG_TYPE.FLOW_ERROR)).toBe(false);
        const warn = calls.find((c) => c.data?.motivo === MOTIVO_BLOQUEIO.DETAIL_INDISPONIVEL);
        expect(warn).toBeDefined();
    });

    describe('Gate 3 (TOTALMENTE PAGO) hydrated from the DETAIL, not the list row', () => {
        // Regression (gate-3-pago-via-detail): in prod com298/list returns
        // mnyTitAberto/mnyTitPago = NULL, so the list-derived `pago` is always
        // false. The real status lives in GET /com298/{docCod} (mnyTitAberto).
        // `buildCandidata` MUST override `pago` from the detail before evaluating
        // gates. Fixtures use the real wire numbers probed 2026-06-18, filCod=2.
        const gate3Of = (candidata: { gatesAvaliados: { gate: string; passed: boolean }[] }) =>
            candidata.gatesAvaliados.find((g) => g.gate === GATE.TOTALMENTE_PAGO);

        it('NÃO pago (doc 26471, mnyTitAberto>0) → Gate 3 passed:false even if list said pago=true', async () => {
            // List row optimistically had pago=true; the detail is the source of truth.
            const adiantamentoListPagoTrue = { ...adiantamento, docCod: '26471', pago: true };
            const conexos = buildConexos({
                listAdiantamentosProforma: jest.fn().mockResolvedValue({
                    adiantamentos: [adiantamentoListPagoTrue],
                    capHit: false,
                }),
                listFinanceiroAPagar: jest
                    .fn()
                    .mockResolvedValue({ proformas: [], invoices: [invoice] }),
                // doc 26471 — mnyTitAberto = 384119.95 > 0 ⇒ pago=false.
                getDetalheTitulos: jest
                    .fn()
                    .mockResolvedValue({ valorPermutar: 1000, pago: false }),
            } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );

            const result = await service.executar({ triggeredBy: 'u' });

            expect(gate3Of(result.candidatas[0])?.passed).toBe(false);
            expect(result.candidatas[0].estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        });

        it('TOTALMENTE pago (doc 24166, mnyTitAberto===0) → Gate 3 passed:true even if list said pago=false', async () => {
            // List row had pago=false (prod NULL→false); the detail says paid.
            const adiantamentoListPagoFalse = { ...adiantamento, docCod: '24166', pago: false };
            const conexos = buildConexos({
                listAdiantamentosProforma: jest.fn().mockResolvedValue({
                    adiantamentos: [adiantamentoListPagoFalse],
                    capHit: false,
                }),
                listFinanceiroAPagar: jest
                    .fn()
                    .mockResolvedValue({ proformas: [], invoices: [invoice] }),
                // doc 24166 — mnyTitAberto = 0 ⇒ pago=true.
                getDetalheTitulos: jest
                    .fn()
                    .mockResolvedValue({ valorPermutar: 266350.43, pago: true }),
            } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );

            const result = await service.executar({ triggeredBy: 'u' });

            expect(gate3Of(result.candidatas[0])?.passed).toBe(true);
            expect(result.candidatas[0].estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.ELEGIVEL);
        });

        it('detail omits mnyTitAberto → pago undefined → Gate 3 reprova (conservative)', async () => {
            const adiantamentoListPagoTrue = { ...adiantamento, docCod: '99999', pago: true };
            const conexos = buildConexos({
                listAdiantamentosProforma: jest.fn().mockResolvedValue({
                    adiantamentos: [adiantamentoListPagoTrue],
                    capHit: false,
                }),
                listFinanceiroAPagar: jest
                    .fn()
                    .mockResolvedValue({ proformas: [], invoices: [invoice] }),
                // mnyTitAberto absent in detail ⇒ pago=undefined.
                getDetalheTitulos: jest
                    .fn()
                    .mockResolvedValue({ valorPermutar: 1000, pago: undefined }),
            } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );

            const result = await service.executar({ triggeredBy: 'u' });

            expect(gate3Of(result.candidatas[0])?.passed).toBe(false);
            expect(result.candidatas[0].estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        });
    });

    it('aborts on Conexos failure → FLOW_ERROR, status=error run, 0 snapshot rows', async () => {
        const boom = new Error('ensureSid failed');
        const conexos = buildConexos({
            listFiliais: jest.fn().mockRejectedValue(boom),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { logService, calls } = buildLogService();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            logService,
            concurrency,
            db,
            clienteFiltro,
        );

        await expect(service.executar({ triggeredBy: 'u' })).rejects.toThrow('ensureSid failed');

        // Error run persisted with empty candidatas (atomicity).
        expect(repo.persistRun).toHaveBeenCalledTimes(1);
        const [runArg, candidatasArg] = repo.persistRun.mock.calls[0];
        expect(runArg.status).toBe('error');
        expect(runArg.errorMessage).toBe('ensureSid failed');
        expect(candidatasArg).toHaveLength(0);

        expect(calls.some((c) => c.type === LOG_TYPE.FLOW_ERROR)).toBe(true);
    });

    describe('fan-out batching (P0-7) + parallelism (P0-4)', () => {
        const makeAdiantamentos = (n: number) =>
            Array.from({ length: n }, (_, i) => ({
                ...adiantamento,
                docCod: `A${i}`,
                priCod: String(1000 + i),
            }));

        it('batches Conexos calls per filial instead of per adiantamento (no N+1)', async () => {
            const adiantamentos = makeAdiantamentos(200);
            const listDeclaracaoByProcesso = jest.fn().mockResolvedValue([]);
            const listFinanceiroAPagar = jest
                .fn()
                .mockResolvedValue({ proformas: [], invoices: [] });
            const conexos = buildConexos({
                listFiliais: jest.fn().mockResolvedValue([{ filCod: 2 }]),
                listAdiantamentosProforma: jest
                    .fn()
                    .mockResolvedValue({ adiantamentos, capHit: false }),
                listDeclaracaoByProcesso,
                listFinanceiroAPagar,
            } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );

            const listFiliais = conexos.listFiliais as jest.Mock;
            const listAdiantamentosProforma = conexos.listAdiantamentosProforma as jest.Mock;
            await service.executar({ triggeredBy: 'u' });

            // P0-7 metric: with 200 adiantamentos on 1 filial, the heavy list
            // endpoints fire ONCE per filial (batched), not once per adiantamento.
            // Before: 200 + 200 = 400 list calls. After: 1 + 1 = 2.
            expect(listDeclaracaoByProcesso).toHaveBeenCalledTimes(1);
            expect(listFinanceiroAPagar).toHaveBeenCalledTimes(1);
            // The batched call carries ALL unique priCods, not a single one.
            expect(listDeclaracaoByProcesso.mock.calls[0][0].priCods).toHaveLength(200);
            expect(listFinanceiroAPagar.mock.calls[0][0].priCods).toHaveLength(200);

            // P0-7 metric (802→≤80): total LIST-endpoint round-trips per run — the
            // N+1 that grew O(A) — collapse to O(F). listFiliais(1) +
            // listAdiantamentosProforma(1) + listDeclaracao(1) + listFinanceiro(1)
            // = 4 for A=200,F=1. (Detail `getMnyTitPermutar` is per-doc by nature
            // but now runs concurrency-bounded — P0-4 — not serialized.)
            const listRoundTrips =
                listFiliais.mock.calls.length +
                listAdiantamentosProforma.mock.calls.length +
                listDeclaracaoByProcesso.mock.calls.length +
                listFinanceiroAPagar.mock.calls.length;
            expect(listRoundTrips).toBeLessThanOrEqual(80);
            expect(listRoundTrips).toBe(4);
        });

        it('indexes batched declaracoes/invoices back to the right priCod', async () => {
            const adiantamentos = [
                { ...adiantamento, docCod: 'A0', priCod: '1000' },
                { ...adiantamento, docCod: 'A1', priCod: '1001' },
            ];
            const conexos = buildConexos({
                listFiliais: jest.fn().mockResolvedValue([{ filCod: 2 }]),
                listAdiantamentosProforma: jest
                    .fn()
                    .mockResolvedValue({ adiantamentos, capHit: false }),
                // DI for 1000, none for 1001.
                listDeclaracaoByProcesso: jest
                    .fn()
                    .mockResolvedValue([{ variante: 'DI', priCod: '1000' }]),
                // invoice casada only for 1000.
                listFinanceiroAPagar: jest.fn().mockResolvedValue({
                    proformas: [],
                    invoices: [{ ...invoice, docCod: 'I0', priCod: '1000' }],
                }),
            } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );

            const result = await service.executar({ triggeredBy: 'u' });

            const c1000 = result.candidatas.find((c) => c.priCod === '1000');
            const c1001 = result.candidatas.find((c) => c.priCod === '1001');
            // 1000 has DI + invoice → elegivel; 1001 has neither → bloqueada.
            expect(c1000?.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.ELEGIVEL);
            expect(c1001?.estadoElegibilidade).toBe(ESTADO_ELEGIBILIDADE.BLOQUEADA);
        });

        it('runs filiais concurrently (≥5× speedup over sequential I/O)', async () => {
            const filiais = Array.from({ length: 5 }, (_, i) => ({ filCod: i + 1 }));
            let active = 0;
            let maxActive = 0;
            const conexos = buildConexos({
                listFiliais: jest.fn().mockResolvedValue(filiais),
                listAdiantamentosProforma: jest.fn().mockImplementation(async () => {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    await new Promise((r) => setTimeout(r, 20));
                    active -= 1;
                    return { adiantamentos: [], capHit: false };
                }),
            } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );

            await service.executar({ triggeredBy: 'u' });

            // P0-4 metric: 5 filiais processed concurrently (sequential would
            // observe maxActive=1). Bounded at FILIAIS_CONCURRENCY (5).
            expect(maxActive).toBe(5);
        });
    });

    describe('idempotency + advisory lock (P0-6)', () => {
        it('replays the existing run for a known Idempotency-Key, ZERO fan-out', async () => {
            const listFiliais = jest.fn().mockResolvedValue([{ filCod: 2 }]);
            const conexos = buildConexos({ listFiliais } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            (repo.findRunIdByIdempotencyKey as jest.Mock).mockResolvedValue('run-existing');
            (repo.findRunSummaryById as jest.Mock).mockResolvedValue({
                runId: 'run-existing',
                flowId: 'flow-existing',
                status: 'success',
                totalCandidatas: 8,
                totalElegiveis: 2,
                totalBloqueadas: 1,
                totalCasamentoManual: 2,
                totalPermutaManual: 2,
                totalJaPermutado: 1,
                bloqueadasByMotivo: { 'sem-invoice': 1 },
            });
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );

            const result = await service.executar({ triggeredBy: 'u', idempotencyKey: 'idem-1' });

            expect(result.runId).toBe('run-existing');
            expect(result.idempotentReplay).toBe(true);
            expect(result.totalElegiveis).toBe(2);
            // Os 3 buckets novos atravessam o REPLAY. Sem isto, uma run reaproveitada
            // devolveria zeros mudos nos buckets — e nenhum teste existente quebraria.
            expect(result.totalCasamentoManual).toBe(2);
            expect(result.totalPermutaManual).toBe(2);
            expect(result.totalJaPermutado).toBe(1);
            // No new fan-out: Conexos never touched, no new run persisted.
            expect(listFiliais).not.toHaveBeenCalled();
            expect(repo.persistRun).not.toHaveBeenCalled();
        });

        it('does not fire a second fan-out when the advisory lock is busy (concurrent dup)', async () => {
            const listFiliais = jest.fn().mockResolvedValue([{ filCod: 2 }]);
            const conexos = buildConexos({ listFiliais } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            // Key unknown on first check, then the winner's run appears once the
            // busy branch re-checks.
            (repo.findRunIdByIdempotencyKey as jest.Mock)
                .mockResolvedValueOnce(null)
                .mockResolvedValue('run-winner');
            (repo.findRunSummaryById as jest.Mock).mockResolvedValue({
                runId: 'run-winner',
                flowId: 'flow-winner',
                status: 'success',
                totalCandidatas: 1,
                totalElegiveis: 1,
                totalBloqueadas: 0,
                totalCasamentoManual: 0,
                totalPermutaManual: 0,
                totalJaPermutado: 0,
                bloqueadasByMotivo: {},
            });
            const { logService, calls } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, clienteFiltro } = realServices();
            // DB mock where the lock is BUSY → onBusy branch runs.
            const busyDb = {
                withAdvisoryLock: jest.fn(
                    async (
                        _k: number,
                        _onAcquired: () => Promise<unknown>,
                        onBusy: () => Promise<unknown>,
                    ) => onBusy(),
                ),
            } as unknown as jest.Mocked<PostgreeDatabaseClient>;
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                busyDb,
                clienteFiltro,
            );

            const result = await service.executar({ triggeredBy: 'u', idempotencyKey: 'idem-2' });

            // Returns the concurrent winner's run, never re-runs the fan-out.
            expect(result.runId).toBe('run-winner');
            expect(result.idempotentReplay).toBe(true);
            expect(listFiliais).not.toHaveBeenCalled();
            expect(repo.persistRun).not.toHaveBeenCalled();
            expect(calls.some((c) => c.type === LOG_TYPE.BUSINESS_WARN)).toBe(true);
        });

        it('records the Idempotency-Key after a fresh run completes', async () => {
            const conexos = buildConexos({
                listFiliais: jest.fn().mockResolvedValue([{ filCod: 2 }]),
                listAdiantamentosProforma: jest
                    .fn()
                    .mockResolvedValue({ adiantamentos: [adiantamento], capHit: false }),
                listFinanceiroAPagar: jest
                    .fn()
                    .mockResolvedValue({ proformas: [], invoices: [invoice] }),
            } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );

            const result = await service.executar({ triggeredBy: 'u', idempotencyKey: 'idem-3' });

            expect(result.status).toBe('success');
            // Fresh run persisted AND the key recorded under the lock.
            expect(repo.persistRun).toHaveBeenCalledTimes(1);
            expect(repo.recordIdempotencyKey).toHaveBeenCalledWith('idem-3', result.runId);
        });
    });

    // ── invoice-pago-detalhe (2026-08-28) ────────────────────────────────────
    describe('`pago` da INVOICE vem dos TÍTULOS (com308), não da row do com298/list', () => {
        // Relato Simone 2026-08-25: invoices já liquidadas na aba "Invoices em aberto".
        // A vista lê `permuta_invoice WHERE NOT pago`, e `pago` era persistido a partir
        // da row do com298/list — que NÃO popula mnyTitAberto/mnyTitPago (null em
        // 1146/1146 INVOICEs da filial 2, sonda `probe-invoice-pago` em PRD). Resultado:
        // `pago=false` para TODAS, filtro no-op, ~75% da aba era lixo.
        // Mesma classe de defeito de 01b99bf (Gate 3) e df90fa6 (busca da alocação).
        const invoiceDoList = {
            docCod: '14042',
            priCod: '1953',
            dataEmissao: new Date('2026-03-12'),
            valor: 2032384.41,
            moeda: 'BRL',
            // O list SEMPRE diz false — é exatamente o dado que não se pode usar.
            pago: false,
            faturada: false,
        };

        const runCompute = async (listTitulosAPagar: jest.Mock) => {
            const conexos = buildConexos({
                listInvoicesFinalizadas: jest
                    .fn()
                    .mockResolvedValue({ invoices: [invoiceDoList], capHit: false }),
                listTitulosAPagar,
            } as Partial<jest.Mocked<ConexosMock>>);
            const repo = buildRepo();
            const { logService } = buildLogService();
            const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } =
                realServices();
            const service = buildEleicao(
                conexos,
                elegibilidade,
                variacao,
                aging,
                repo as unknown as PermutaSnapshotRepository,
                logService,
                concurrency,
                db,
                clienteFiltro,
            );
            return service.computeCandidatas();
        };

        it('doc 14042 (face === pago) → pago:true, mesmo com o list dizendo false', async () => {
            // Números REAIS do wire (probe PRD 2026-08-28, filial 2).
            const { todasInvoices } = await runCompute(
                jest.fn().mockResolvedValue([
                    {
                        titCod: '1',
                        valorBrl: 2032384.41,
                        valorPago: 2032384.41,
                        valorNegociado: 386039.93,
                        taxa: 5.2647,
                        moedaCod: 220,
                        moedaNome: 'DOLAR DOS EUA',
                    },
                ]),
            );

            expect(todasInvoices).toHaveLength(1);
            expect(todasInvoices[0].inv.pago).toBe(true);
        });

        it('parcialmente paga (face > pago) → pago:false — segue na aba', async () => {
            const { todasInvoices } = await runCompute(
                jest
                    .fn()
                    .mockResolvedValue([{ titCod: '1', valorBrl: 2032384.41, valorPago: 1000000 }]),
            );

            expect(todasInvoices[0].inv.pago).toBe(false);
        });

        it('resíduo de centavos NÃO é quitação — regra estrita (residual-pago-centavos)', async () => {
            // Decisão Yuri 2026-06-18: Gate 3 permanece `=== 0`, sem epsilon. A aba
            // segue a MESMA regra; um resíduo de R$0,02 mantém a invoice visível.
            const { todasInvoices } = await runCompute(
                jest
                    .fn()
                    .mockResolvedValue([
                        { titCod: '1', valorBrl: 20373009.0, valorPago: 20373008.98 },
                    ]),
            );

            expect(todasInvoices[0].inv.pago).toBe(false);
        });

        it('múltiplos títulos: soma face vs soma pago', async () => {
            const { todasInvoices } = await runCompute(
                jest.fn().mockResolvedValue([
                    { titCod: '1', valorBrl: 1000, valorPago: 1000 },
                    { titCod: '2', valorBrl: 500, valorPago: 500 },
                ]),
            );

            expect(todasInvoices[0].inv.pago).toBe(true);
        });

        it('com308 indisponível → pago:false (conservador) e a invoice NÃO some', async () => {
            // Nunca inferir pago=true sem prova: esconder uma invoice em aberto tira
            // dinheiro do radar da analista; mostrar uma paga apenas incomoda.
            const { todasInvoices } = await runCompute(
                jest.fn().mockRejectedValue(new Error('com308 fora do ar')),
            );

            expect(todasInvoices).toHaveLength(1);
            expect(todasInvoices[0].inv.pago).toBe(false);
        });

        it('título sem titMnyTotPago → pago:false (não sei ≠ nada pago)', async () => {
            const { todasInvoices } = await runCompute(
                jest.fn().mockResolvedValue([{ titCod: '1', valorBrl: 2032384.41 }]),
            );

            expect(todasInvoices[0].inv.pago).toBe(false);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CASO CANÔNICO da invariante I5 (`business-rules/fidelidade-snapshot-eleicao.md`)
// — ADR-0043. Roda o serviço REAL contra o repositório REAL (só o cliente de
// banco é mock), porque a convergência header ↔ snapshot é uma propriedade da
// gravação, não do mock: um teste contra `persistRun` mockado provaria nada.
// ─────────────────────────────────────────────────────────────────────────────
describe('EleicaoPermutasService — fidelidade e convergência do snapshot (I5)', () => {
    /** Captura os INSERTs emitidos dentro da transação do repositório real. */
    const buildSnapshotDb = () => {
        const txInsert = jest.fn().mockResolvedValue(1);
        const tx = {
            insert: txInsert,
            selectMany: jest.fn().mockResolvedValue([]),
            selectFirst: jest.fn().mockResolvedValue(null),
            update: jest.fn().mockResolvedValue(0),
        };
        return {
            client: {
                insert: jest.fn().mockResolvedValue(1),
                selectMany: jest.fn().mockResolvedValue([]),
                selectFirst: jest.fn().mockResolvedValue(null),
                withTransaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
            } as unknown as PostgreeDatabaseClient,
            txInsert,
        };
    };

    /** Uma run com EXATAMENTE 1 candidata em cada um dos 5 estados. */
    const runCanonica = async () => {
        const adto = (docCod: string, priCod: string) => ({
            ...adiantamento,
            docCod,
            priCod,
        });
        const inv = (docCod: string, priCod: string) => ({ ...invoice, docCod, priCod });
        const conexos = buildConexos({
            listAdiantamentosProforma: jest.fn().mockResolvedValue({
                adiantamentos: [
                    adto('A-ELEG', 'P1'),
                    adto('A-BLOQ', 'P5'),
                    adto('A-CASA', 'P2'),
                    adto('A-PMAN', 'P3'),
                    adto('A-JAPE', 'P4'),
                ],
                capHit: false,
            }),
            // D.I só em P1/P2/P4 — P3 e P5 ficam sem âncora de data-base.
            listDeclaracaoByProcesso: jest.fn().mockResolvedValue([
                { variante: 'DI', priCod: 'P1' },
                { variante: 'DI', priCod: 'P2' },
                { variante: 'DI', priCod: 'P4' },
            ]),
            listFinanceiroAPagar: jest.fn().mockResolvedValue({
                proformas: [],
                // P2 tem DUAS invoices → N:M → casamento-manual.
                invoices: [inv('I1', 'P1'), inv('I2a', 'P2'), inv('I2b', 'P2'), inv('I4', 'P4')],
            }),
            // P3 é de cliente-filtro (pesCod 191) → permuta-manual cross-process.
            listProcessos: jest
                .fn()
                .mockResolvedValue([{ priCod: 'P3', pesCod: '191', importador: 'INOX-TECH' }]),
            getDetalheTitulos: jest.fn(async (params: { docCod: string; filCod: number }) =>
                params.docCod === 'A-JAPE'
                    ? // pago E saldo 100% consumido numa permuta anterior → T6.
                      { valorPermutar: 0, pago: true, valorPermutado: 378636.28 }
                    : { valorPermutar: 1000, pago: true },
            ),
        } as Partial<jest.Mocked<ConexosMock>>);

        const { client, txInsert } = buildSnapshotDb();
        const repo = new PermutaSnapshotRepository(client);
        const { elegibilidade, variacao, aging, concurrency, db } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo,
            buildLogService().logService,
            concurrency,
            db,
            buildClienteFiltro(['191']),
        );

        const result = await service.executar({ triggeredBy: 'analista' });
        const headerParams = txInsert.mock.calls[0][1] as Record<string, unknown>;
        const snapshotParams = txInsert.mock.calls[1][1] as Record<string, unknown>;
        const statusGravados = Object.entries(snapshotParams)
            .filter(([k]) => k.startsWith('status_'))
            .map(([, v]) => String(v));
        return { result, headerParams, statusGravados };
    };

    it('replay VAZIO (lock ocupado, vencedor ainda sem key) devolve os 5 buckets zerados', async () => {
        const repo = buildRepo();
        (repo.findRunIdByIdempotencyKey as jest.Mock).mockResolvedValue(null);
        const { elegibilidade, variacao, aging, concurrency, clienteFiltro } = realServices();
        const busyDb = {
            withAdvisoryLock: jest.fn(
                async (
                    _k: number,
                    _onAcquired: () => Promise<unknown>,
                    onBusy: () => Promise<unknown>,
                ) => onBusy(),
            ),
        } as unknown as jest.Mocked<PostgreeDatabaseClient>;
        const service = buildEleicao(
            buildConexos(),
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            buildLogService().logService,
            concurrency,
            busyDb,
            clienteFiltro,
        );

        const result = await service.executar({ triggeredBy: 'u', idempotencyKey: 'idem-vazio' });

        expect(result.idempotentReplay).toBe(true);
        expect(result.totalCasamentoManual).toBe(0);
        expect(result.totalPermutaManual).toBe(0);
        expect(result.totalJaPermutado).toBe(0);
    });

    it('run ABORTADA persiste os 5 buckets zerados no header, sem snapshot', async () => {
        const boom = new Error('conexos down');
        const conexos = buildConexos({
            listFiliais: jest.fn().mockRejectedValue(boom),
        } as Partial<jest.Mocked<ConexosMock>>);
        const repo = buildRepo();
        const { elegibilidade, variacao, aging, concurrency, db, clienteFiltro } = realServices();
        const service = buildEleicao(
            conexos,
            elegibilidade,
            variacao,
            aging,
            repo as unknown as PermutaSnapshotRepository,
            buildLogService().logService,
            concurrency,
            db,
            clienteFiltro,
        );

        await expect(service.executar({ triggeredBy: 'u' })).rejects.toThrow('conexos down');

        const [runArg, candidatasArg] = repo.persistRun.mock.calls[0];
        expect(runArg.status).toBe('error');
        expect(candidatasArg).toHaveLength(0);
        expect(runArg).toMatchObject({
            totalCandidatas: 0,
            totalElegiveis: 0,
            totalBloqueadas: 0,
            totalCasamentoManual: 0,
            totalPermutaManual: 0,
            totalJaPermutado: 0,
        });
    });

    it('grava 5 linhas de snapshot com 5 status DISTINTOS (fidelidade, cláusula 1)', async () => {
        const { statusGravados } = await runCanonica();

        expect(statusGravados).toHaveLength(5);
        expect([...statusGravados].sort()).toEqual([
            'bloqueada',
            'casamento-manual',
            'elegivel',
            'ja-permutado',
            'permuta-manual',
        ]);
    });

    it('total_bloqueadas da run canônica é 1 — não 3, não 2', async () => {
        const { result } = await runCanonica();

        expect(result.totalCandidatas).toBe(5);
        expect(result.totalElegiveis).toBe(1);
        // Contagem ESTRITA de BLOQUEADA: casamento-manual, permuta-manual e
        // ja-permutado saem do balde (ADR-0043 §1).
        expect(result.totalBloqueadas).toBe(1);
    });

    it('convergência I5 (cláusula 2): header.total_<s> === COUNT(snapshot WHERE status = s)', async () => {
        const { headerParams, statusGravados } = await runCanonica();

        const colunaDoEstado: Record<string, string> = {
            elegivel: 'totalElegiveis',
            bloqueada: 'totalBloqueadas',
            'casamento-manual': 'totalCasamentoManual',
            'permuta-manual': 'totalPermutaManual',
            'ja-permutado': 'totalJaPermutado',
        };
        for (const [estado, coluna] of Object.entries(colunaDoEstado)) {
            const noSnapshot = statusGravados.filter((s) => s === estado).length;
            expect({ [coluna]: headerParams[coluna] }).toEqual({ [coluna]: noSnapshot });
        }
        expect(headerParams.totalCandidatas).toBe(statusGravados.length);
    });
});
