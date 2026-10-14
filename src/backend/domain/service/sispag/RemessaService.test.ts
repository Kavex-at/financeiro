import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import RemessaEmDuvidaError from '../../errors/RemessaEmDuvidaError.js';
import type { LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type RemessaExecucaoRepository from '../../repository/sispag/RemessaExecucaoRepository.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import RetiradaCodigoBarrasService from './RetiradaCodigoBarrasService.js';
import type LogService from '../LogService.js';
import RemessaCnabValidator from '../../libs/cnab/RemessaCnabValidator.js';
import AnaliseCodigoBarrasRepetido from '../../libs/boleto/AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import DebitDateFrozenError from '../../errors/DebitDateFrozenError.js';
import DebitDateOutsideWindowError from '../../errors/DebitDateOutsideWindowError.js';
import DebitDateService from './DebitDateService.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import PayeeNotAuthorizedAtRemittanceError from '../../errors/PayeeNotAuthorizedAtRemittanceError.js';
import type { PayeeCheckResult } from '../../interface/sispag/AuthorizedPayeeInterface.js';
import type AuthorizedPayeeService from './AuthorizedPayeeService.js';
import DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import RemessaService from './RemessaService.js';

/** Linha digitável SINTÉTICA (DV válidos) usada como default "código distinto" (I16). */
const LINHA_DISTINTA = '00191234546789012345767890123457199990000012345';

/** Relógio default dos testes: terça 2026-09-22, meio-dia de Brasília. */
const AGORA = '2026-09-22T15:00:00Z';
/** Vencimento como o ERP grava (15:00Z do dia pretendido). Default: 2026-09-30. */
const VENC = Date.UTC(2026, 8, 30, 15);

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 2,
    conta: '55795-4',
    status: 'FINALIZADO',
    criadoPor: 'u1',
    versao: 3,
    itens: [
        {
            loteId: 'L1',
            filCod: 2,
            docCod: '801',
            titCod: '1',
            credor: 'CRONOS',
            valor: 258.4,
            vencimento: VENC,
            modalidade: 'CREDITO_CONTA',
            incluidoPor: 'u1',
            divergencia: false,
        },
    ],
    ...over,
});

/** Pendente do doc 802 — `pendente()` só sobrescreve o `raw`, então o topo vai à mão. */
const pendente802 = () => ({ ...pendente({ docCod: 802 }), docCod: '802' });

/** Lote com 2 itens — usado para exercitar o cenário de import PARCIAL no ERP. */
const loteCom2Itens = (): LotePagamento =>
    lote({
        itens: [
            ...lote().itens,
            {
                loteId: 'L1',
                filCod: 2,
                docCod: '802',
                titCod: '1',
                credor: 'OUTRO',
                valor: 100,
                vencimento: VENC,
                modalidade: 'CREDITO_CONTA',
                incluidoPor: 'u1',
                divergencia: false,
            },
        ],
    });

/** Linha do grid de pendentes — a identidade tem que voltar VERBATIM para o import. */
const pendente = (over: Record<string, unknown> = {}, temBoletoDda = false) => ({
    docCod: '801',
    titCod: '1',
    temBoletoDda,
    ddaLegivel: true,
    raw: {
        filCod: 2,
        docCod: 801,
        titCod: 1,
        docTip: 2,
        pesCod: 1161,
        dpeNomPessoa: 'CRONOS LOGISTICA LTDA',
        titMnyValor: 258.4,
        titDtaVencimento: 1_790_000_000_000,
        ...over,
    },
});

const buildLog = () =>
    ({
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    }) as unknown as LogService;

const buildEnv = (over: Record<string, unknown> = {}) =>
    ({
        getEnvironmentVars: jest.fn().mockResolvedValue({
            conexosWriteEnabled: true,
            // Kill-switch da frente. Default REAL é false (gate de go-live); os testes de
            // escrita ligam explicitamente para exercitar o caminho vivo.
            sispagLiveWriteEnabled: true,
            // Default REAL é true: é freio de incidente, não gate de go-live.
            sispagDdaAssocEnabled: true,
            conexosDryRun: false,
            ...over,
        }),
    }) as unknown as EnvironmentProvider;

const buildLoteRepo = (l: LotePagamento = lote()) => ({
    getLoteComItens: jest.fn().mockResolvedValue(l),
    setChavesNativas: jest.fn().mockResolvedValue(undefined),
    setDataDebito: jest.fn().mockResolvedValue(undefined),
    setFavorecidoAutorizadoItem: jest.fn().mockResolvedValue(1),
    setRemessaGerada: jest.fn().mockResolvedValue(undefined),
    transicionarStatus: jest.fn().mockResolvedValue(1),
    // ADR-0069 emenda 1 (I16d.3): remoção local + marca + trilha numa transação.
    retirarItemPorCodigoDeBarras: jest.fn().mockResolvedValue({ removido: true }),
});

/** Marcas ATIVAS por código de barras (I16h(c)) — só o par com o evento reconhece resíduo. */
const buildBloqueios = (
    marcas: Array<{
        filCod: number;
        docCod: string;
        titCod: string;
        origem: string;
        codigoMascarado?: string;
        tituloMantido?: { filCod: number; docCod: string; titCod: string };
    }> = [],
) => ({ listAtivosPorOrigem: jest.fn().mockResolvedValue(marcas) });

/** Chaves `fil:doc:tit` retiradas pelo sistema NESTE lote (a outra metade do par). */
const buildEventos = (chaves: string[] = []) => ({
    listarChavesRetiradasPeloSistema: jest.fn().mockResolvedValue(new Set(chaves)),
});

const buildLedger = (anterior: unknown = null) => ({
    findByIdempotencyKey: jest.fn().mockResolvedValue(anterior),
    beginExecution: jest.fn().mockResolvedValue({ status: 'reconciling', alreadySettled: false }),
    setNativeFlpCod: jest.fn().mockResolvedValue(undefined),
    setEtapa: jest.fn().mockResolvedValue(undefined),
    setRequestPayload: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
});

const buildWrite = () => ({
    criarLote: jest.fn().mockResolvedValue({ flpCod: 12, filCod: 2, bncCod: 4 }),
    // Estado do lote no ERP. Encoding medido em produção: 0 aberto · 1 finalizado ·
    // 2/3 cancelado. Default: lote aberto e vazio (o caso "morreu logo depois de criar").
    getLoteNativo: jest.fn().mockResolvedValue({
        filCod: 2,
        bncCod: 4,
        flpCod: 99,
        status: 0,
        titulosCount: 0,
        soma: 0,
    }),
    // Chaves já dentro do lote nativo. Default: vazio (nada importado ainda).
    listarChavesDoLote: jest.fn().mockResolvedValue(new Set<string>()),
    // Marca d'água: por default a filial já tem o lote 98, então a marca é 98.
    listarLotesNativos: jest
        .fn()
        .mockResolvedValue([
            { filCod: 2, bncCod: 4, flpCod: 98, status: 1, titulosCount: 1, soma: 10 },
        ]),
    listarTitulosPendentes: jest.fn().mockResolvedValue([pendente()]),
    importarTitulos: jest.fn().mockResolvedValue(undefined),
    finalizarLote: jest.fn().mockResolvedValue(undefined),
    sugerirRemessa: jest.fn().mockResolvedValue({ numRemessa: 12, nomeArquivo: 'PG210801.REM' }),
    gerarRemessa: jest.fn().mockResolvedValue({ sucesso: true }),
    // I16: default "códigos distintos" — a guarda de código repetido não dispara.
    listarLinhasDigitaveisDoLote: jest.fn().mockResolvedValue({
        itens: [
            { docCod: '801', titCod: '1', linhaDigitavel: LINHA_DISTINTA, filCod: 2, itsCodSeq: 1 },
        ],
        total: 1,
        dropped: 0,
        completa: true,
    }),
    // ADR-0069 emenda 1: o DELETE de item do rascunho (default: sem efeito — nada a retirar).
    removerItemDoRascunho: jest.fn().mockResolvedValue(undefined),
    listarArquivosRemessa: jest.fn().mockResolvedValue([
        // Arquivo ÓRFÃO de um lote antigo que reusou o mesmo flpCod — vem primeiro de propósito.
        { gabCod: 16, nomeArquivo: 'PG191101.REM', conteudo: 'ARQUIVO ANTIGO' },
        { gabCod: 52, nomeArquivo: 'PG210801.REM', conteudo: 'CNAB DO LOTE' },
    ]),
});

/**
 * A guarda do favorecido autorizado (ADR-0065, testada em `AuthorizedPayeeService.test.ts`). Por
 * padrão todo par TED/PIX está AUTORIZADO com o destino igual (`OK`); um teste específico injeta
 * outro resultado por `pesCod:modalidade`.
 */
const buildPayees = (resultados: Record<string, PayeeCheckResult> = {}) => ({
    verificarDestinoAutorizado: jest.fn(
        async (pares: Array<{ pesCod: string; modalidade: string }>) =>
            new Map(
                pares.map((p) => {
                    const k = `${p.pesCod}:${p.modalidade}`;
                    return [k, { resultado: resultados[k] ?? 'OK', autorizacaoId: 'AUT-1' }];
                }),
            ),
    ),
});

const buildSispag = () => ({
    listContasCorrentes: jest
        .fn()
        .mockResolvedValue([
            { ccoCod: 2, bncCod: 4, agencia: '0641', numeroConta: 55795, dvConta: '4', gerNum: 38 },
        ]),
    listContasFavorecido: jest
        .fn()
        .mockResolvedValue([
            { pctCodSeq: 1, banco: 341, agencia: '292', conta: '31404', padrao: true },
        ]),
    // ADR-0054/0061 — só são chamados com alguma flag TED/PIX/exceção ligada.
    listChavesPixFavorecido: jest.fn().mockResolvedValue([]),
    getTituloAPagar: jest.fn().mockResolvedValue({ pesCod: '1161' }),
    getDocumentoFavorecido: jest.fn().mockResolvedValue(undefined),
});

/**
 * `withAdvisoryLock` que concede o lock por padrão. Um teste específico simula "ocupado"
 * para provar que a segunda requisição concorrente é barrada antes de qualquer POST.
 */
const buildDb = (concede = true) => ({
    withAdvisoryLock: jest.fn(
        async (_k: number, onAcquired: () => Promise<unknown>, onBusy: () => Promise<unknown>) =>
            concede ? onAcquired() : onBusy(),
    ),
    // A retirada por código de barras abre UMA transação local por item (I16d.3).
    withTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
});

const make = (o: {
    loteRepo?: ReturnType<typeof buildLoteRepo>;
    ledger?: ReturnType<typeof buildLedger>;
    write?: ReturnType<typeof buildWrite>;
    sispag?: ReturnType<typeof buildSispag>;
    payees?: ReturnType<typeof buildPayees>;
    env?: EnvironmentProvider;
    lote?: LotePagamento;
    db?: ReturnType<typeof buildDb>;
    log?: LogService;
    bloqueios?: ReturnType<typeof buildBloqueios>;
    eventos?: ReturnType<typeof buildEventos>;
    /** Instante "agora" (ISO). Default: {@link AGORA}. */
    agora?: string;
}) => {
    const loteRepo = o.loteRepo ?? buildLoteRepo(o.lote);
    const calendar = BankingCalendar.withClock(() => new Date(o.agora ?? AGORA));
    const sispag = o.sispag ?? buildSispag();
    const write = o.write ?? buildWrite();
    const log = o.log ?? buildLog();
    const db = o.db ?? buildDb();
    const retirada = new RetiradaCodigoBarrasService(
        write as unknown as ConexosSispagWriteClient,
        loteRepo as unknown as LotePagamentoRepository,
        db as unknown as PostgreeDatabaseClient,
        new AnaliseCodigoBarrasRepetido(new CodigoBarrasBoleto()),
        log,
        (o.bloqueios ?? buildBloqueios()) as unknown as BloqueioDuplicidadeRepository,
        (o.eventos ?? buildEventos()) as unknown as VerificacaoEventoRepository,
    );
    return new RemessaService(
        loteRepo as unknown as LotePagamentoRepository,
        (o.ledger ?? buildLedger()) as unknown as RemessaExecucaoRepository,
        write as unknown as ConexosSispagWriteClient,
        sispag as unknown as ConexosSispagClient,
        o.env ?? buildEnv(),
        log,
        db as unknown as PostgreeDatabaseClient,
        new RemessaCnabValidator(),
        new DebitDateService(loteRepo as unknown as LotePagamentoRepository, calendar),
        calendar,
        new DestinoPagamentoResolver(sispag as unknown as ConexosSispagClient, new MaskDestino()),
        (o.payees ?? buildPayees()) as unknown as AuthorizedPayeeService,
        retirada,
    );
};

describe('RemessaService', () => {
    describe('gate de estado', () => {
        it('recusa lote que não está FINALIZADO', async () => {
            const loteRepo = buildLoteRepo(lote({ status: 'RASCUNHO' }));
            await expect(
                make({ loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
        });

        it('recusa lote vazio', async () => {
            const loteRepo = buildLoteRepo(lote({ itens: [] }));
            await expect(
                make({ loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
        });
    });

    describe('guarda L8 do favorecido autorizado (ADR-0065 I14e-3)', () => {
        const comModalidade = (modalidade: 'TED' | 'PIX' | 'BOLETO') =>
            lote({ itens: [{ ...lote().itens[0], modalidade }] as LotePagamento['itens'] });

        it.each([
            'FAVORECIDO_NAO_AUTORIZADO',
            'DESTINO_ALTERADO',
            'SEM_DADO_PAGAMENTO',
            'FALHA_LEITURA',
        ] as const)('regressão: TED %s sem lote nativo → PayeeNotAuthorizedAtRemittanceError, zero escrita e nenhuma linha no ledger', async (resultado) => {
            const write = buildWrite();
            const ledger = buildLedger();
            const payees = buildPayees({ '1161:TED': resultado });
            const err = await make({ lote: comModalidade('TED'), write, ledger, payees })
                .gerarRemessa({ loteId: 'L1', ator: 'u' })
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(PayeeNotAuthorizedAtRemittanceError);
            expect(err).toMatchObject({
                statusCode: 409,
                details: { itens: [{ item: '801/1', motivo: resultado }] },
            });
            for (const fn of Object.values(write)) expect(fn).not.toHaveBeenCalled();
            expect(ledger.beginExecution).not.toHaveBeenCalled();
            expect(ledger.setRequestPayload).not.toHaveBeenCalled();
        });

        it('favorecido do título ilegível no fin064 → barra como falha de leitura (falha fechada)', async () => {
            const sispag = buildSispag();
            sispag.getTituloAPagar.mockRejectedValue(new Error('HTTP 503'));
            const write = buildWrite();
            const err = await make({ lote: comModalidade('PIX'), sispag, write })
                .gerarRemessa({ loteId: 'L1', ator: 'u' })
                .catch((e: unknown) => e);
            expect(err).toMatchObject({
                code: 'FAVORECIDO_NAO_AUTORIZADO_NA_REMESSA',
                details: { itens: [{ item: '801/1', motivo: 'FALHA_LEITURA' }] },
            });
            expect(write.criarLote).not.toHaveBeenCalled();
        });

        it('regressão: COM lote nativo já criado (retomada ADR-0039) a guarda não roda', async () => {
            const payees = buildPayees({ '1161:TED': 'FAVORECIDO_NAO_AUTORIZADO' });
            const ledger = buildLedger({
                status: 'error',
                nativeFlpCod: 98,
                etapa: 'importar',
                dryRun: false,
            } as never);
            const write = buildWrite();
            await make({ lote: comModalidade('TED'), ledger, payees, write }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            });
            expect(payees.verificarDestinoAutorizado).not.toHaveBeenCalled();
            // Seguiu o destino congelado: reusou o lote nativo e importou, sem recriar.
            expect(write.criarLote).not.toHaveBeenCalled();
            expect(write.importarTitulos).toHaveBeenCalled();
        });

        it('boleto nunca passa pela guarda', async () => {
            const payees = buildPayees();
            await make({ lote: comModalidade('BOLETO'), payees })
                .gerarRemessa({ loteId: 'L1', ator: 'u', dryRunOverride: true })
                .catch(() => undefined);
            expect(payees.verificarDestinoAutorizado).not.toHaveBeenCalled();
        });

        it('autorizado: o congelamento grava no item SÓ o id da autorização', async () => {
            const loteRepo = buildLoteRepo(comModalidade('TED'));
            await make({ loteRepo, env: buildEnv({ sispagTedEnabled: true }) }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            });
            expect(loteRepo.setFavorecidoAutorizadoItem).toHaveBeenCalledWith({
                loteId: 'L1',
                filCod: 2,
                docCod: '801',
                titCod: '1',
                autorizacaoId: 'AUT-1',
            });
        });
    });

    describe('idempotência — a trava contra pagar duas vezes', () => {
        it('execução já `settled` curto-circuita SEM tocar o ERP', async () => {
            const ledger = buildLedger({
                status: 'settled',
                dryRun: false,
                nativeFlpCod: 12,
                nativeGabCod: 52,
            });
            const write = buildWrite();
            const res = await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(res.status).toBe('skipped');
            expect(res.nativeFlpCod).toBe(12);
            expect(write.criarLote).not.toHaveBeenCalled();
            expect(write.gerarRemessa).not.toHaveBeenCalled();
        });

        it('órfão com lote ABERTO e VAZIO retoma no import — não cria um segundo lote', async () => {
            // Antes isto era 409 para sempre. O ERP sabe o que aconteceu; perguntar troca
            // "não sei, não mexo" por "sei onde parou, continuo daqui".
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                nativeFlpCod: 99,
                etapa: 'importar',
            });
            const write = buildWrite();

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.criarLote).not.toHaveBeenCalled();
            expect(write.importarTitulos).toHaveBeenCalled();
            expect(write.gerarRemessa).toHaveBeenCalled();
        });

        it('órfão com títulos JÁ importados pula o import', async () => {
            // `titulosCount` só diz "tem alguma coisa" — QUAIS vem da lista de chaves.
            // Medido em HML: um lote com 3 itens reais reporta titulosCount=1.
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 0,
                titulosCount: 1,
                soma: 100,
            });
            write.listarChavesDoLote.mockResolvedValue(new Set(['2:801:1']));

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.importarTitulos).not.toHaveBeenCalled();
            expect(write.finalizarLote).toHaveBeenCalled();
        });

        it('órfão com lote FINALIZADO pula import e finalizar', async () => {
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 1,
                titulosCount: 1,
                soma: 100,
            });

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.importarTitulos).not.toHaveBeenCalled();
            expect(write.finalizarLote).not.toHaveBeenCalled();
            expect(write.gerarRemessa).toHaveBeenCalled();
        });

        it('órfão cuja remessa JÁ existe fecha o ledger e devolve o arquivo — sem gerar de novo', async () => {
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                nativeFlpCod: 99,
                // Write-ahead: o nome foi gravado ANTES do gerarRemessa.
                requestPayload: { flpCod: 99, nomeArquivo: 'PG210801.REM', numRemessa: 12 },
            });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 1,
                titulosCount: 1,
                soma: 100,
            });

            const r = await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.gerarRemessa).not.toHaveBeenCalled();
            expect(r.status).toBe('skipped');
            // Casou PELO NOME: a lista tem um órfão de lote antigo primeiro.
            expect(r.arquivo).toBe('PG210801.REM');
            expect(r.conteudo).toBe('CNAB DO LOTE');
            expect(ledger.settle).toHaveBeenCalled();
        });

        it("grava a MARCA D'ÁGUA antes do criarLote — é o que salva a janela sem flpCod", async () => {
            const ledger = buildLedger();
            const write = buildWrite();

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            const marca = ledger.setRequestPayload.mock.calls.find(
                (c: unknown[]) => (c[1] as { marcaFlpCods?: number[] })?.marcaFlpCods !== undefined,
            );
            expect(marca?.[1]).toMatchObject({ marcaFlpCods: [98], ccoCod: 2 });
            // ANTES do POST: senão a janela continua irrecuperável.
            const ordemMarca = ledger.setRequestPayload.mock.invocationCallOrder[0] ?? 0;
            const ordemCriar = write.criarLote.mock.invocationCallOrder[0] ?? 0;
            expect(ordemMarca).toBeLessThan(ordemCriar);
        });

        it('órfão sem flpCod ADOTA o único lote acima da marca — não cria um segundo', async () => {
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                etapa: 'criar_lote',
                requestPayload: { marcaFlpCods: [98], ccoCod: 2, dataDebito: 1_790_000_000_000 },
            });
            const write = buildWrite();
            write.listarLotesNativos.mockResolvedValue([
                { filCod: 2, bncCod: 4, flpCod: 98, status: 1, titulosCount: 1, soma: 10 },
                // O órfão: acima da marca, mesma conta e data, vazio.
                {
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 99,
                    status: 0,
                    titulosCount: 0,
                    soma: 0,
                    ccoCod: 2,
                    dataDebito: 1_790_000_000_000,
                },
            ]);
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 0,
                titulosCount: 0,
                soma: 0,
            });

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.criarLote).not.toHaveBeenCalled();
            expect(ledger.setNativeFlpCod).toHaveBeenCalledWith(expect.any(String), 99);
            expect(write.importarTitulos).toHaveBeenCalled();
        });

        it('ADOTA um lote com flpCod MENOR que o máximo — o ERP reaproveita números', async () => {
            // Medido em HML: um lote novo na filial 2 nasceu com flp 15 quando o maior era
            // 40. A marca é o CONJUNTO dos conhecidos, não o máximo — com "maior que",
            // este órfão ficaria invisível e o retry criaria um segundo lote.
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                etapa: 'criar_lote',
                requestPayload: {
                    marcaFlpCods: [40, 41],
                    ccoCod: 2,
                    dataDebito: 1_790_000_000_000,
                },
            });
            const write = buildWrite();
            write.listarLotesNativos.mockResolvedValue([
                { filCod: 2, bncCod: 4, flpCod: 40, status: 1, titulosCount: 1, soma: 10 },
                { filCod: 2, bncCod: 4, flpCod: 41, status: 1, titulosCount: 1, soma: 10 },
                {
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 15,
                    status: 0,
                    titulosCount: 0,
                    soma: 0,
                    ccoCod: 2,
                    dataDebito: 1_790_000_000_000,
                },
            ]);
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 15,
                status: 0,
                titulosCount: 0,
                soma: 0,
            });

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.criarLote).not.toHaveBeenCalled();
            expect(ledger.setNativeFlpCod).toHaveBeenCalledWith(expect.any(String), 15);
        });

        it('nenhum candidato novo → o criarLote não valeu, recomeça do zero', async () => {
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                etapa: 'criar_lote',
                requestPayload: { marcaFlpCods: [98], ccoCod: 2, dataDebito: 1_790_000_000_000 },
            });
            const write = buildWrite();

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.criarLote).toHaveBeenCalledTimes(1);
        });

        it('DOIS candidatos com a mesma assinatura é FAIL-CLOSED — não escolho por ninguém', async () => {
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                etapa: 'criar_lote',
                requestPayload: { marcaFlpCods: [98], ccoCod: 2, dataDebito: 1_790_000_000_000 },
            });
            const write = buildWrite();
            const vazio = (flpCod: number) => ({
                filCod: 2,
                bncCod: 4,
                flpCod,
                status: 0,
                titulosCount: 0,
                soma: 0,
                ccoCod: 2,
                dataDebito: 1_790_000_000_000,
            });
            write.listarLotesNativos.mockResolvedValue([vazio(99), vazio(100)]);

            await expect(
                make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toBeInstanceOf(RemessaEmDuvidaError);
            expect(write.criarLote).not.toHaveBeenCalled();
        });

        it('lote acima da marca com OUTRA conta não é candidato', async () => {
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                etapa: 'criar_lote',
                requestPayload: { marcaFlpCods: [98], ccoCod: 2, dataDebito: 1_790_000_000_000 },
            });
            const write = buildWrite();
            write.listarLotesNativos.mockResolvedValue([
                {
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 99,
                    status: 0,
                    titulosCount: 0,
                    soma: 0,
                    ccoCod: 7,
                    dataDebito: 1_790_000_000_000,
                },
            ]);

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            // Nenhum candidato → recomeça, em vez de adotar o lote de outra conta.
            expect(write.criarLote).toHaveBeenCalledTimes(1);
        });

        it("sem marca d'água gravada continua FAIL-CLOSED (execução antiga)", async () => {
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                etapa: 'criar_lote',
            });
            const write = buildWrite();

            await expect(
                make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toBeInstanceOf(RemessaEmDuvidaError);
            expect(write.criarLote).not.toHaveBeenCalled();
        });

        describe('lote anterior CANCELADO por uma pessoa', () => {
            const cancelado = () => {
                const write = buildWrite();
                write.getLoteNativo.mockResolvedValue({
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 99,
                    status: 2,
                    titulosCount: 0,
                    soma: 0,
                });
                return write;
            };
            const orfao = () =>
                buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });

            it('sem confirmação → 409 próprio, e NADA é criado', async () => {
                // O ERP não guarda a intenção de quem cancelou: "limpei o órfão" e
                // "abortei o pagamento" deixam o mesmo status. Quem separa é a pessoa.
                const write = cancelado();

                await expect(
                    make({ ledger: orfao(), write }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
                ).rejects.toMatchObject({
                    code: 'LOTE_ANTERIOR_CANCELADO',
                    statusCode: 409,
                    retryable: true,
                });
                expect(write.criarLote).not.toHaveBeenCalled();
            });

            it('com confirmação → cria um lote NOVO, sem reusar o cancelado', async () => {
                const write = cancelado();

                await make({ ledger: orfao(), write }).gerarRemessa({
                    loteId: 'L1',
                    ator: 'u',
                    confirmarNovoLote: true,
                });

                expect(write.criarLote).toHaveBeenCalledTimes(1);
                // O import vai para o lote NOVO (12, do mock), nunca para o 99 cancelado.
                expect(write.importarTitulos).toHaveBeenCalledWith(
                    expect.objectContaining({ flpCod: 12 }),
                );
            });
        });

        it('import PARCIAL importa SÓ o que falta — sem duplicar o que já entrou', async () => {
            // O ERP diz quais títulos entraram, então a diferença é computável. Antes isto
            // era 409 e uma ida ao fin015.
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 0,
                titulosCount: 1,
                soma: 100,
            });
            write.listarChavesDoLote.mockResolvedValue(new Set(['2:801:1']));
            write.listarTitulosPendentes.mockResolvedValue([pendente(), pendente802()]);

            await make({ ledger, write, lote: loteCom2Itens() }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            });

            expect(write.importarTitulos).toHaveBeenCalledTimes(1);
            const { itens } = write.importarTitulos.mock.calls[0][0];
            expect(itens).toHaveLength(1);
            // Número, não string: a identidade vai VERBATIM do grid do ERP.
            expect(itens[0]).toMatchObject({ docCod: 802 });
        });

        it('import parcial cujo conjunto JÁ está completo pula o import', async () => {
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 0,
                titulosCount: 1,
                soma: 100,
            });
            // titulosCount diz 1, mas a lista mostra as 2 chaves do lote.
            write.listarChavesDoLote.mockResolvedValue(new Set(['2:801:1', '2:802:1']));

            await make({ ledger, write, lote: loteCom2Itens() }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            });

            expect(write.importarTitulos).not.toHaveBeenCalled();
            expect(write.finalizarLote).toHaveBeenCalled();
        });

        it('título INTRUSO no lote nativo é FAIL-CLOSED — alguém mexeu pelo ERP', async () => {
            // Completar o import aqui misturaria a intenção de duas pessoas.
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 0,
                titulosCount: 1,
                soma: 100,
            });
            write.listarChavesDoLote.mockResolvedValue(new Set(['2:999:1']));

            await expect(
                make({ ledger, write, lote: loteCom2Itens() }).gerarRemessa({
                    loteId: 'L1',
                    ator: 'u',
                }),
            ).rejects.toBeInstanceOf(RemessaEmDuvidaError);
            expect(write.importarTitulos).not.toHaveBeenCalled();
        });

        it('falha ao LER os itens é FAIL-CLOSED — não é o mesmo que lote vazio', async () => {
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 0,
                titulosCount: 1,
                soma: 100,
            });
            write.listarChavesDoLote.mockResolvedValue(undefined);

            await expect(
                make({ ledger, write, lote: loteCom2Itens() }).gerarRemessa({
                    loteId: 'L1',
                    ator: 'u',
                }),
            ).rejects.toBeInstanceOf(RemessaEmDuvidaError);
            expect(write.importarTitulos).not.toHaveBeenCalled();
        });

        it('lote INEXISTENTE no ERP recomeça do zero — não há nada para duplicar', async () => {
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue(undefined);

            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.importarTitulos).toHaveBeenCalled();
        });

        it('`reconciling` de um DRY-RUN anterior não bloqueia (não houve escrita)', async () => {
            const ledger = buildLedger({ status: 'reconciling', dryRun: true });
            const write = buildWrite();
            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
            expect(write.criarLote).toHaveBeenCalled();
        });
    });

    describe('dry-run', () => {
        it('com escrita desabilitada não toca o ERP', async () => {
            const write = buildWrite();
            const res = await make({
                write,
                env: buildEnv({ conexosWriteEnabled: false }),
            }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(res.status).toBe('dry-run');
            expect(res.dryRun).toBe(true);
            expect(write.criarLote).not.toHaveBeenCalled();
        });

        it('`conexosDryRun` vence mesmo com escrita habilitada', async () => {
            const write = buildWrite();
            const res = await make({ write, env: buildEnv({ conexosDryRun: true }) }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            });
            expect(res.dryRun).toBe(true);
            expect(write.criarLote).not.toHaveBeenCalled();
        });
    });

    describe('conta pagadora e banco — nada de fallback silencioso', () => {
        it('G-13 — conta do lote que NÃO existe no fin005 da filial recusa, sem fallback', async () => {
            const write = buildWrite();
            const loteRepo = buildLoteRepo(lote({ conta: '99999-9' }));
            await expect(
                make({ write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toMatchObject({
                userMessage: expect.stringContaining('99999-9'),
            });
            // Antes caía na primeira conta do fin005 (ordem arbitrária, às vezes outro banco).
            expect(write.criarLote).not.toHaveBeenCalled();
        });

        it('G-13 — lote SEM conta definida recusa e manda escolher a conta', async () => {
            const write = buildWrite();
            const { conta: _conta, ...semConta } = lote();
            const loteRepo = buildLoteRepo(semConta as LotePagamento);
            await expect(
                make({ write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toMatchObject({
                userMessage: expect.stringContaining('não tem conta pagadora'),
            });
            expect(write.criarLote).not.toHaveBeenCalled();
        });

        it('banco fora do mapa FEBRABAN recusa — não vira Itaú (341)', async () => {
            const write = buildWrite();
            const sispag = buildSispag();
            sispag.listContasCorrentes.mockResolvedValue([
                {
                    ccoCod: 9,
                    bncCod: 999,
                    agencia: '0001',
                    numeroConta: 55795,
                    dvConta: '4',
                    gerNum: 1,
                },
            ]);
            await expect(
                make({ write, sispag }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toMatchObject({
                userMessage: expect.stringContaining('bncCod 999'),
            });
            expect(write.criarLote).not.toHaveBeenCalled();
        });
    });

    describe('caminho feliz', () => {
        it('executa a sequência na ordem e devolve o arquivo', async () => {
            const write = buildWrite();
            const loteRepo = buildLoteRepo();
            const ledger = buildLedger();
            const res = await make({ write, loteRepo, ledger }).gerarRemessa({
                loteId: 'L1',
                ator: 'analista',
            });

            expect(res.status).toBe('gerada');
            expect(res.nativeFlpCod).toBe(12);
            expect(res.arquivo).toBe('PG210801.REM');
            expect(res.numRemessa).toBe(12);
            expect(res.conteudo).toBe('CNAB DO LOTE');
            expect(write.criarLote).toHaveBeenCalledTimes(1);
            expect(write.finalizarLote).toHaveBeenCalledTimes(1);
            expect(write.gerarRemessa).toHaveBeenCalledTimes(1);
            expect(loteRepo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({ para: 'REMESSA_GERADA' }),
            );
            expect(ledger.settle).toHaveBeenCalledWith('remessa:L1', { nativeGabCod: 52 });
        });

        it('persiste o flpCod ANTES do import — é a pista do lote órfão', async () => {
            const ordem: string[] = [];
            const ledger = buildLedger();
            ledger.setNativeFlpCod.mockImplementation(async () => {
                ordem.push('ledger.setNativeFlpCod');
            });
            const write = buildWrite();
            write.importarTitulos.mockImplementation(async () => {
                ordem.push('importarTitulos');
            });
            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
            expect(ordem).toEqual(['ledger.setNativeFlpCod', 'importarTitulos']);
        });

        it('escolhe o arquivo PELO NOME, não o primeiro com conteúdo', async () => {
            // O ERP recicla flpCod: a lista traz um órfão de nov/2025 antes do nosso.
            const res = await make({}).gerarRemessa({ loteId: 'L1', ator: 'u' });
            expect(res.nativeGabCod).toBe(52);
            expect(res.conteudo).toBe('CNAB DO LOTE');
        });

        it('usa a numeração sugerida pelo ERP, não uma inventada', async () => {
            const write = buildWrite();
            write.sugerirRemessa.mockResolvedValue({ numRemessa: 7, nomeArquivo: 'PG010207.REM' });
            write.listarArquivosRemessa.mockResolvedValue([
                { gabCod: 60, nomeArquivo: 'PG010207.REM', conteudo: 'CNAB' },
            ]);
            await make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
            expect(write.gerarRemessa).toHaveBeenCalledWith(
                expect.objectContaining({ seqNum: 7, gabEspNomeArquivo: 'PG010207.REM' }),
            );
        });

        it('manda os campos de seleção nos DOIS níveis e a identidade verbatim', async () => {
            const write = buildWrite();
            await make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
            const [{ itens }] = write.importarTitulos.mock.calls[0];
            expect(itens[0]).toMatchObject({
                // identidade do grid, sem reescrita
                filCod: 2,
                docCod: 801,
                titCod: 1,
                filCodLote: 2,
                // seleção
                op: 1,
                bncCodFin015: 4,
                titVldReflexoDdaAssoc: 0,
                titVldReflexoDdaDesassoc: 0,
                // destino do favorecido
                pctCodSeq: 1,
                itsNumBanco: 341,
                conta: '31404',
            });
        });
    });

    describe('retry após falha — não pode vazar lote órfão', () => {
        it('reaproveita o lote nativo da tentativa anterior em vez de criar outro', async () => {
            // Ledger em `error` com flpCod já atribuído: foi uma falha de validação DEPOIS
            // do criarLote. Criar um segundo lote aqui deixaria o primeiro órfão no ERP.
            const ledger = buildLedger({
                status: 'error',
                dryRun: false,
                nativeFlpCod: 12,
                etapa: 'importar',
            });
            const write = buildWrite();
            const res = await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });

            expect(write.criarLote).not.toHaveBeenCalled();
            expect(res.nativeFlpCod).toBe(12);
            expect(write.importarTitulos).toHaveBeenCalledWith(
                expect.objectContaining({ flpCod: 12 }),
            );
        });

        it('cria o lote quando não há nenhum de tentativa anterior', async () => {
            const ledger = buildLedger({ status: 'error', dryRun: false, etapa: 'criar_lote' });
            const write = buildWrite();
            await make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
            expect(write.criarLote).toHaveBeenCalledTimes(1);
        });

        it('título inelegível falha SEM deixar um segundo lote para trás', async () => {
            const ledger = buildLedger({ status: 'error', dryRun: false, nativeFlpCod: 12 });
            const write = buildWrite();
            write.listarTitulosPendentes.mockResolvedValue([]);
            await expect(
                make({ ledger, write }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toThrow(/não está mais elegível/i);
            expect(write.criarLote).not.toHaveBeenCalled();
        });
    });

    describe('guarda do arquivo', () => {
        it('falha se o arquivo pedido não aparece na lista — não devolve outro', async () => {
            const write = buildWrite();
            write.listarArquivosRemessa.mockResolvedValue([
                { gabCod: 16, nomeArquivo: 'PG191101.REM', conteudo: 'ARQUIVO DE OUTRO LOTE' },
            ]);
            const ledger = buildLedger();
            await expect(
                make({ write, ledger }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toThrow(/não foi encontrado/i);
            expect(ledger.settle).not.toHaveBeenCalled();
        });
    });

    describe('invariantes que vieram da execução ao vivo', () => {
        it('recusa título de filial diferente da do lote', async () => {
            const write = buildWrite();
            write.listarTitulosPendentes.mockResolvedValue([pendente({ filCod: 1 })]);
            await expect(make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' })).rejects.toThrow(
                /filial/i,
            );
            expect(write.importarTitulos).not.toHaveBeenCalled();
        });

        it('recusa favorecido sem conta no banco do lote', async () => {
            const sispag = buildSispag();
            sispag.listContasFavorecido.mockResolvedValue([
                { pctCodSeq: 1, banco: 1, agencia: '3404', conta: '16767', padrao: true },
            ]);
            const write = buildWrite();
            await expect(
                make({ sispag, write }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toThrow(/conta ativa no banco/i);
            expect(write.importarTitulos).not.toHaveBeenCalled();
        });

        it('recusa título que saiu da lista de pendentes do ERP', async () => {
            const write = buildWrite();
            write.listarTitulosPendentes.mockResolvedValue([]);
            await expect(make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' })).rejects.toThrow(
                /não está mais elegível/i,
            );
        });

        it('usa a conta pagadora da FILIAL, nunca uma fixa', async () => {
            const loteRepo = buildLoteRepo(lote({ conta: '29949-2' }));
            const sispag = buildSispag();
            sispag.listContasCorrentes.mockResolvedValue([
                {
                    ccoCod: 9,
                    bncCod: 4,
                    agencia: '0870',
                    numeroConta: 29949,
                    dvConta: '2',
                    gerNum: 39,
                },
            ]);
            const write = buildWrite();
            await make({ sispag, write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' });
            expect(write.criarLote).toHaveBeenCalledWith(
                expect.objectContaining({
                    conta: expect.objectContaining({ ccoCod: 9, ccoEspAgcod: '0870' }),
                }),
            );
        });
    });

    describe('falha', () => {
        it('marca o ledger como error e propaga — sem retry', async () => {
            const write = buildWrite();
            write.finalizarLote.mockRejectedValue(new Error('LOTE VAZIO'));
            const ledger = buildLedger();
            await expect(
                make({ write, ledger }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toThrow('LOTE VAZIO');
            expect(ledger.fail).toHaveBeenCalledWith(
                'remessa:L1',
                expect.objectContaining({ mensagem: 'LOTE VAZIO' }),
            );
            expect(write.gerarRemessa).not.toHaveBeenCalled();
        });
    });
    describe('serialização por lote (regis: fault-tolerance-1)', () => {
        it('requisição concorrente é barrada ANTES de qualquer POST no ERP', async () => {
            // O ledger write-ahead cobre INTERRUPÇÃO, não CONCORRÊNCIA: duas requisições
            // simultâneas liam o ledger antes de qualquer uma escrever e ambas criavam lote.
            const write = buildWrite();
            const ledger = buildLedger();

            await expect(
                make({ write, ledger, db: buildDb(false) }).gerarRemessa({
                    loteId: 'L1',
                    ator: 'u',
                }),
            ).rejects.toMatchObject({ code: 'REMESSA_EM_ANDAMENTO', statusCode: 409 });

            expect(write.criarLote).not.toHaveBeenCalled();
            expect(write.importarTitulos).not.toHaveBeenCalled();
            // Nem sequer abre execução no ledger — a barreira é antes de tudo.
            expect(ledger.beginExecution).not.toHaveBeenCalled();
        });

        it('o lock é POR LOTE — a chave muda com o loteId', async () => {
            // Lock global serializaria lotes independentes sem necessidade.
            const dbA = buildDb();
            const dbB = buildDb();
            await make({ db: dbA }).gerarRemessa({ loteId: 'L1', ator: 'u' });
            await make({ db: dbB, loteRepo: buildLoteRepo(lote({ id: 'L2' })) }).gerarRemessa({
                loteId: 'L2',
                ator: 'u',
            });

            const chaveA = dbA.withAdvisoryLock.mock.calls[0]?.[0];
            const chaveB = dbB.withAdvisoryLock.mock.calls[0]?.[0];
            expect(typeof chaveA).toBe('number');
            expect(chaveA).not.toBe(chaveB);
        });

        it('o erro é retryable — a execução em curso vai terminar', async () => {
            await expect(
                make({ db: buildDb(false) }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toMatchObject({ retryable: true });
        });
    });
});

describe('RemessaService — boleto (código de barras via DDA)', () => {
    const loteBoleto = (temDda: boolean) => ({
        lote: lote({
            itens: [{ ...lote().itens[0], modalidade: 'BOLETO' as const }],
        }),
        pendentes: [pendente({}, temDda)],
    });

    it('BOLETO com boleto DDA → import pede a associação ao ERP', async () => {
        const { lote: l, pendentes } = loteBoleto(true);
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue(pendentes);
        const loteRepo = buildLoteRepo(l);

        await make({ write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' });

        expect(write.importarTitulos).toHaveBeenCalledWith(
            expect.objectContaining({ associarDda: true }),
        );
    });

    it('BOLETO SEM boleto DDA → BoletoSemCodigoBarrasError antes de qualquer escrita', async () => {
        // O barcode não está no título em lugar nenhum: sem DDA, a remessa sairia com
        // segmento J vazio — um pagamento que o banco não liquida.
        const { lote: l, pendentes } = loteBoleto(false);
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue(pendentes);
        const loteRepo = buildLoteRepo(l);

        await expect(
            make({ write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({
            code: 'BOLETO_SEM_CODIGO_BARRAS',
            // A tela abre o diálogo dos boletos DDA do título com estes dados (valor + data).
            details: expect.objectContaining({
                docCod: '801',
                titCod: '1',
                filCod: 2,
                valor: 258.4,
                vencimento: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
            }),
        });

        expect(write.importarTitulos).not.toHaveBeenCalled();
        expect(write.gerarRemessa).not.toHaveBeenCalled();
    });

    it('a mensagem nomeia o título — a analista precisa saber qual sanear', async () => {
        const { lote: l, pendentes } = loteBoleto(false);
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue(pendentes);
        await expect(
            make({ write, lote: l }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({
            userMessage: expect.stringContaining('801/1'),
        });
    });

    it('não manda mais titEspCodbar VAZIO no payload do import', async () => {
        // Era `titEspCodbar: raw.titEspCodbar ?? ''` — e o campo é null em 100% dos títulos
        // de produção. Mandar string vazia é exatamente o que produzia remessa sem código de
        // barras. O `raw` do ERP realmente traz a chave (com null), então o que precisa
        // sumir é a COERÇÃO para `''`, não a chave.
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue([pendente({ titEspCodbar: null })]);
        await make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        const [{ itens }] = write.importarTitulos.mock.calls[0];
        expect(itens[0].titEspCodbar).toBeNull();
        expect(itens[0].titEspCodbar).not.toBe('');
    });

    it('item não-boleto segue sem pedir associação (regressão)', async () => {
        const write = buildWrite();
        await make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        expect(write.importarTitulos).toHaveBeenCalledWith(
            expect.objectContaining({ associarDda: false }),
        );
    });

    it('lote misto → uma chamada por grupo, cada uma com o seu associarDda', async () => {
        const l = lote({
            itens: [
                { ...lote().itens[0], modalidade: 'CREDITO_CONTA' as const },
                {
                    loteId: 'L1',
                    filCod: 2,
                    docCod: '802',
                    titCod: '1',
                    credor: 'OUTRO',
                    valor: 100,
                    vencimento: VENC,
                    modalidade: 'BOLETO' as const,
                    incluidoPor: 'u1',
                    divergencia: false,
                },
            ],
        });
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue([
            pendente(),
            { ...pendente({ docCod: 802 }, true), docCod: '802' },
        ]);
        // O boleto do lote (802) é o que o ERP anexou o código; sem leitura a guarda aborta (I16c).
        write.listarLinhasDigitaveisDoLote.mockResolvedValue({
            itens: [
                {
                    docCod: '802',
                    titCod: '1',
                    linhaDigitavel: LINHA_DISTINTA,
                    filCod: 2,
                    itsCodSeq: 2,
                },
            ],
            total: 1,
            dropped: 0,
            completa: true,
        });

        await make({ write, lote: l }).gerarRemessa({ loteId: 'L1', ator: 'u' });

        const flags = write.importarTitulos.mock.calls.map(([p]) => p.associarDda);
        expect(flags).toEqual([false, true]);
        for (const [p] of write.importarTitulos.mock.calls) expect(p.itens).toHaveLength(1);
    });
});

describe('RemessaService — freio de incidente do DDA (SISPAG_DDA_ASSOC_ENABLED)', () => {
    const loteBoletoComDda = () => ({
        lote: lote({ itens: [{ ...lote().itens[0], modalidade: 'BOLETO' as const }] }),
        pendentes: [pendente({}, true)],
    });

    it('desligado, BOLETO com DDA passa a falhar em vez de associar', async () => {
        // O ponto do freio: conter o caminho DDA sem derrubar remessa de PIX/TED. O item
        // BOLETO falha ALTO (não sai com barras vazia), e o resto do lote segue.
        const { lote: l, pendentes } = loteBoletoComDda();
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue(pendentes);
        const env = buildEnv({ sispagDdaAssocEnabled: false });

        await expect(
            make({ write, lote: l, env }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({ code: 'BOLETO_SEM_CODIGO_BARRAS' });
        expect(write.importarTitulos).not.toHaveBeenCalled();
    });

    it('ligado (default), o mesmo item associa normalmente', async () => {
        const { lote: l, pendentes } = loteBoletoComDda();
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue(pendentes);

        await make({ write, lote: l }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        expect(write.importarTitulos).toHaveBeenCalledWith(
            expect.objectContaining({ associarDda: true }),
        );
    });

    it('desligado, item NÃO-boleto segue passando (o freio é só do caminho DDA)', async () => {
        const write = buildWrite();
        const env = buildEnv({ sispagDdaAssocEnabled: false });
        await make({ write, env }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        expect(write.importarTitulos).toHaveBeenCalledWith(
            expect.objectContaining({ associarDda: false }),
        );
        expect(write.gerarRemessa).toHaveBeenCalled();
    });
});

describe('RemessaService — gate de integridade do .REM', () => {
    /** Registro de detalhe CNAB 240 com o segmento na pos 14 e as barras na 18-61. */
    const linhaJ = (barras: string, subtipo = ''): string => {
        const buf = ' '.repeat(240).split('');
        '3410001300001'.split('').forEach((c, i) => {
            buf[i] = c;
        });
        buf[13] = 'J';
        (subtipo + barras).split('').forEach((c, i) => {
            buf[17 + i] = c;
        });
        return buf.join('');
    };
    const BARRAS_OK = '34199100000005720681234567890123456789012345';

    const comConteudo = (conteudo: string) => {
        const write = buildWrite();
        write.listarArquivosRemessa.mockResolvedValue([
            { gabCod: 52, nomeArquivo: 'PG210801.REM', conteudo },
        ]);
        return write;
    };

    it('remessa com segmento J SEM barras não vira entregável', async () => {
        // O arquivo existe no ERP — não dá para desgerar. O que o gate garante é que o lote
        // NÃO transiciona e o `baixarArquivo` não serve nada.
        const write = comConteudo([linhaJ(' '.repeat(44)), linhaJ('', '52')].join('\n'));
        const loteRepo = buildLoteRepo(lote());

        await expect(
            make({ write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({ code: 'REMESSA_CORROMPIDA' });

        expect(loteRepo.setRemessaGerada).not.toHaveBeenCalled();
        expect(loteRepo.transicionarStatus).not.toHaveBeenCalled();
    });

    it('remessa com DV inválido também é barrada', async () => {
        const write = comConteudo(linhaJ('34198100000005720681234567890123456789012345'));
        await expect(
            make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({ code: 'REMESSA_CORROMPIDA' });
    });

    it('a mensagem nomeia o arquivo e quantos boletos falharam', async () => {
        const write = comConteudo(linhaJ(' '.repeat(44)));
        await expect(
            make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({
            userMessage: expect.stringContaining('PG210801.REM'),
        });
    });

    it('remessa íntegra passa e o lote transiciona normalmente', async () => {
        const write = comConteudo([linhaJ(BARRAS_OK), linhaJ('', '52')].join('\n'));
        const loteRepo = buildLoteRepo(lote());
        const res = await make({ write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        expect(res.status).toBe('gerada');
        expect(loteRepo.setRemessaGerada).toHaveBeenCalled();
    });

    it('mesma barra em dois segmentos J (I16b) → BoletoCodigoBarrasRepetidoError modo arquivo, sem entregar', async () => {
        const write = comConteudo([linhaJ(BARRAS_OK), linhaJ(BARRAS_OK)].join('\n'));
        const loteRepo = buildLoteRepo(lote());
        const ledger = buildLedger();
        const err = await make({ write, loteRepo, ledger })
            .gerarRemessa({ loteId: 'L1', ator: 'u' })
            .catch((e: unknown) => e);
        expect(err).toMatchObject({
            code: 'BOLETO_CODIGO_BARRAS_REPETIDO',
            statusCode: 409,
            details: { modo: 'arquivo' },
        });
        expect(loteRepo.setRemessaGerada).not.toHaveBeenCalled();
        expect(loteRepo.transicionarStatus).not.toHaveBeenCalled();
        expect(ledger.settle).not.toHaveBeenCalled();
        expect(ledger.fail).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(ledger.fail.mock.calls)).not.toContain(BARRAS_OK);
        // Gate 5.1 continua ABORT-ONLY (I16b): a rede do arquivo nunca retira item.
        expect(loteRepo.retirarItemPorCodigoDeBarras).not.toHaveBeenCalled();
        expect(write.removerItemDoRascunho).not.toHaveBeenCalled();
    });

    it('modo arquivo: motivo no ledger e userMessage dizem que o lote JÁ está finalizado (flpCod + arquivo)', async () => {
        const write = comConteudo([linhaJ(BARRAS_OK), linhaJ(BARRAS_OK)].join('\n'));
        const ledger = buildLedger();
        const err = (await make({ write, ledger })
            .gerarRemessa({ loteId: 'L1', ator: 'u' })
            .catch((e: unknown) => e)) as { userMessage: string };

        const motivo = ledger.fail.mock.calls[0][1].mensagem as string;
        expect(motivo).toContain('flpCod 12');
        expect(motivo).toContain('PG210801.REM');
        expect(err.userMessage).toContain('PG210801.REM');
        expect(err.userMessage).toMatch(/lote nativo 12 está FINALIZADO/);
        expect(err.userMessage).toMatch(/NÃO envie este arquivo ao banco/);
        expect(err.userMessage).toMatch(/cancele o arquivo e o lote no Conexos/);
        expect(err.userMessage).not.toMatch(/interrompida antes de finalizar/);
        expect(err.userMessage).not.toMatch(/rascunho/);
        // Privacidade: só o mascarado.
        expect(JSON.stringify([motivo, err.userMessage])).not.toContain(BARRAS_OK);
    });

    it('barra inválida tem precedência: RemessaCorrompidaError, não o de repetido', async () => {
        const write = comConteudo(
            [
                linhaJ('34198100000005720681234567890123456789012345'),
                linhaJ(BARRAS_OK),
                linhaJ(BARRAS_OK),
            ].join('\n'),
        );
        await expect(
            make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({ code: 'REMESSA_CORROMPIDA' });
    });

    it('.REM sem conteúdo legível NÃO bloqueia — avisa e segue', async () => {
        // A garantia cai neste caso, e isso fica registrado em vez de virar recusa silenciosa.
        const write = buildWrite();
        write.listarArquivosRemessa.mockResolvedValue([
            { gabCod: 52, nomeArquivo: 'PG210801.REM', conteudo: '' },
        ]);
        const log = buildLog();
        const res = await make({ write, log }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        expect(res.status).toBe('gerada');
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('integridade NÃO verificada'),
            }),
        );
    });
});

describe('data de débito (I8, ADR-0049)', () => {
    const nadaEscrito = (
        ledger: ReturnType<typeof buildLedger>,
        write: ReturnType<typeof buildWrite>,
        loteRepo: ReturnType<typeof buildLoteRepo>,
    ) => {
        expect(ledger.beginExecution).not.toHaveBeenCalled();
        expect(write.listarLotesNativos).not.toHaveBeenCalled();
        expect(write.criarLote).not.toHaveBeenCalled();
        expect(write.importarTitulos).not.toHaveBeenCalled();
        expect(loteRepo.setDataDebito).not.toHaveBeenCalled();
    };

    describe('I8a — fora da janela é barrado antes de qualquer escrita', () => {
        /** Vencimento em 30/10: a janela cobre 12/10 (feriado) e fins de semana. */
        const loteLongo = () =>
            lote({ itens: [{ ...lote().itens[0], vencimento: Date.UTC(2026, 9, 30, 15) }] });

        it.each([
            ['depois do menor vencimento', '2026-10-01', 'depois_do_vencimento', lote],
            ['sábado', '2026-09-26', 'nao_util', loteLongo],
            ['feriado (12/10)', '2026-10-12', 'nao_util', loteLongo],
            ['antes de hoje', '2026-09-21', 'antes_de_hoje', loteLongo],
        ])('%s → DATA_DEBITO_FORA_DA_JANELA', async (_c, dataDebito, motivo, fabrica) => {
            const ledger = buildLedger();
            const write = buildWrite();
            const loteRepo = buildLoteRepo(fabrica());
            await expect(
                make({ ledger, write, loteRepo }).gerarRemessa({
                    loteId: 'L1',
                    ator: 'u',
                    dataDebito,
                }),
            ).rejects.toMatchObject({ code: 'DATA_DEBITO_FORA_DA_JANELA', details: { motivo } });
            nadaEscrito(ledger, write, loteRepo);
        });

        it('a recusa é um DebitDateOutsideWindowError', async () => {
            await expect(
                make({}).gerarRemessa({ loteId: 'L1', ator: 'u', dataDebito: '2026-10-01' }),
            ).rejects.toBeInstanceOf(DebitDateOutsideWindowError);
        });
    });

    describe('data escolhida numa criação nova', () => {
        it('sem data: usa o primeiro dia útil da janela e o devolve', async () => {
            const write = buildWrite();
            const res = await make({ write, agora: '2026-09-26T15:00:00Z' }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            });
            expect(res.dataDebito).toBe('2026-09-28');
            expect(write.criarLote).toHaveBeenCalledWith(
                expect.objectContaining({ dataDebito: Date.UTC(2026, 8, 28) }),
            );
        });

        it('23:30 de Brasília em 21/09 (02:30Z do dia 22) manda o dia 21 ao ERP', async () => {
            const write = buildWrite();
            const ledger = buildLedger();
            const res = await make({ write, ledger, agora: '2026-09-22T02:30:00Z' }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            });
            expect(res.dataDebito).toBe('2026-09-21');
            expect(write.criarLote).toHaveBeenCalledWith(
                expect.objectContaining({ dataDebito: Date.UTC(2026, 8, 21) }),
            );
            expect(ledger.setRequestPayload).toHaveBeenCalledWith(
                'remessa:L1',
                expect.objectContaining({ dataDebito: Date.UTC(2026, 8, 21) }),
            );
        });

        it('persiste a data ANTES do criarLote, e a marca d’água leva o mesmo epoch', async () => {
            const write = buildWrite();
            const ledger = buildLedger();
            const loteRepo = buildLoteRepo();
            const res = await make({ write, ledger, loteRepo }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
                dataDebito: '2026-09-24',
            });
            expect(res.dataDebito).toBe('2026-09-24');
            expect(loteRepo.setDataDebito).toHaveBeenCalledWith({
                loteId: 'L1',
                dataDebito: '2026-09-24',
            });
            const ordemPersistir = loteRepo.setDataDebito.mock.invocationCallOrder[0] ?? 0;
            const ordemCriar = write.criarLote.mock.invocationCallOrder[0] ?? 0;
            expect(ordemPersistir).toBeGreaterThan(0);
            expect(ordemPersistir).toBeLessThan(ordemCriar);
            expect(write.criarLote).toHaveBeenCalledWith(
                expect.objectContaining({ dataDebito: Date.UTC(2026, 8, 24) }),
            );
            expect(ledger.setRequestPayload).toHaveBeenCalledWith(
                'remessa:L1',
                expect.objectContaining({
                    marcaFlpCods: [98],
                    dataDebito: Date.UTC(2026, 8, 24),
                }),
            );
        });
    });

    describe('I8b — lote nativo existente congela a data', () => {
        /** Tentativa anterior falhou depois do criarLote: o ledger tem o flp e status `error`. */
        const ledgerComNativo = () =>
            buildLedger({ status: 'error', dryRun: false, nativeFlpCod: 12, etapa: 'importar' });
        const congelado = (dataDebito: string) =>
            buildLoteRepo(lote({ nativeFlpCod: 12, dataDebito }));

        it('data diferente da congelada → DebitDateFrozenError(diferente), nada escrito', async () => {
            const ledger = ledgerComNativo();
            const write = buildWrite();
            const loteRepo = congelado('2026-09-23');
            const erro = await make({ ledger, write, loteRepo })
                .gerarRemessa({ loteId: 'L1', ator: 'u', dataDebito: '2026-09-24' })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(DebitDateFrozenError);
            expect((erro as DebitDateFrozenError).details).toMatchObject({
                motivo: 'diferente',
                dataCongelada: '2026-09-23',
                nativeFlpCod: 12,
            });
            nadaEscrito(ledger, write, loteRepo);
        });

        it.each([
            ['a mesma data', '2026-09-23'],
            ['nenhuma data', undefined],
        ])('com %s segue com a congelada e não cria outro lote', async (_c, dataDebito) => {
            const ledger = ledgerComNativo();
            const write = buildWrite();
            const loteRepo = congelado('2026-09-23');
            const res = await make({ ledger, write, loteRepo }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
                ...(dataDebito !== undefined ? { dataDebito } : {}),
            });
            expect(res.status).toBe('gerada');
            expect(res.dataDebito).toBe('2026-09-23');
            expect(write.criarLote).not.toHaveBeenCalled();
            expect(loteRepo.setDataDebito).not.toHaveBeenCalled();
        });

        it('congelada no passado e o ERP ainda não importou → no_passado antes do ledger', async () => {
            // Órfão com lote aberto e vazio: retomar = importar → o finalizar ainda vai rodar,
            // e o ERP recusaria pelo R1.
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            const loteRepo = buildLoteRepo(lote({ nativeFlpCod: 99, dataDebito: '2026-09-21' }));
            await expect(
                make({ ledger, write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toMatchObject({
                code: 'DATA_DEBITO_CONGELADA',
                details: { motivo: 'no_passado', nativeFlpCod: 99 },
            });
            expect(ledger.beginExecution).not.toHaveBeenCalled();
            expect(write.importarTitulos).not.toHaveBeenCalled();
        });

        it('congelada no passado com retomada em `finalizar` → no_passado', async () => {
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 0,
                titulosCount: 1,
                soma: 258.4,
            });
            write.listarChavesDoLote.mockResolvedValue(new Set(['2:801:1']));
            const loteRepo = buildLoteRepo(lote({ nativeFlpCod: 99, dataDebito: '2026-09-21' }));
            await expect(
                make({ ledger, write, loteRepo }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
            ).rejects.toBeInstanceOf(DebitDateFrozenError);
            expect(write.finalizarLote).not.toHaveBeenCalled();
        });

        it('congelada no passado com o ledger em `error` (finalizar ainda vai rodar) → no_passado', async () => {
            const loteRepo = buildLoteRepo(lote({ nativeFlpCod: 12, dataDebito: '2026-09-21' }));
            await expect(
                make({ ledger: ledgerComNativo(), loteRepo }).gerarRemessa({
                    loteId: 'L1',
                    ator: 'u',
                }),
            ).rejects.toMatchObject({ details: { motivo: 'no_passado' } });
        });

        it('congelada no passado mas o ERP já finalizou (gerar_remessa) → segue', async () => {
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 1,
                titulosCount: 1,
                soma: 258.4,
            });
            const loteRepo = buildLoteRepo(lote({ nativeFlpCod: 99, dataDebito: '2026-09-21' }));
            const res = await make({ ledger, write, loteRepo }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            });
            expect(res.status).toBe('gerada');
            expect(res.dataDebito).toBe('2026-09-21');
            expect(write.finalizarLote).not.toHaveBeenCalled();
        });

        it('lote nativo cancelado + confirmarNovoLote → a nova data vale e substitui a antiga', async () => {
            const ledger = buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99 });
            const write = buildWrite();
            write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 2,
                titulosCount: 0,
                soma: 0,
            });
            const loteRepo = buildLoteRepo(lote({ nativeFlpCod: 99, dataDebito: '2026-09-23' }));
            const res = await make({ ledger, write, loteRepo }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
                confirmarNovoLote: true,
                dataDebito: '2026-09-25',
            });
            expect(res.dataDebito).toBe('2026-09-25');
            expect(loteRepo.setDataDebito).toHaveBeenCalledWith({
                loteId: 'L1',
                dataDebito: '2026-09-25',
            });
            expect(write.criarLote).toHaveBeenCalledWith(
                expect.objectContaining({ dataDebito: Date.UTC(2026, 8, 25) }),
            );
        });

        it('lote legado (nativo sem data persistida) segue, avisa e não grava palpite', async () => {
            const ledger = ledgerComNativo();
            const write = buildWrite();
            const loteRepo = buildLoteRepo(lote({ nativeFlpCod: 12 }));
            const log = buildLog();
            const res = await make({ ledger, write, loteRepo, log }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
                dataDebito: '2026-09-24',
            });
            expect(res.status).toBe('gerada');
            expect(res.dataDebito).toBeUndefined();
            expect(loteRepo.setDataDebito).not.toHaveBeenCalled();
            expect(write.criarLote).not.toHaveBeenCalled();
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'BUSINESS_WARN',
                    message: expect.stringContaining('legado'),
                }),
            );
        });
    });

    describe('dry-run', () => {
        it('valida a data: fora da janela recusa igual', async () => {
            await expect(
                make({ env: buildEnv({ conexosDryRun: true }) }).gerarRemessa({
                    loteId: 'L1',
                    ator: 'u',
                    dataDebito: '2026-09-27',
                }),
            ).rejects.toBeInstanceOf(DebitDateOutsideWindowError);
        });

        it('devolve e loga a data, sem persistir', async () => {
            const loteRepo = buildLoteRepo();
            const log = buildLog();
            const res = await make({
                loteRepo,
                log,
                env: buildEnv({ conexosDryRun: true }),
            }).gerarRemessa({ loteId: 'L1', ator: 'u', dataDebito: '2026-09-23' });
            expect(res.status).toBe('dry-run');
            expect(res.dataDebito).toBe('2026-09-23');
            expect(loteRepo.setDataDebito).not.toHaveBeenCalled();
            expect(log.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('DRY-RUN'),
                    data: expect.objectContaining({ dataDebito: '2026-09-23' }),
                }),
            );
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// ADR-0054 — TED/PIX e destino manual (tweak sispag-ted-pix)
// ═══════════════════════════════════════════════════════════════════════════════════════

/** Payload do import que o `main` montava para o fixture default (crédito em conta, Itaú). */
const PAYLOAD_MAIN_CREDITO = {
    ...pendente().raw,
    filCodLote: 2,
    bncCod: 4,
    flpCod: 12,
    itsVldModalidade: 1,
    pctCodSeq: 1,
    itsNumBanco: 341,
    agencia: '292',
    pctEspNumAgencia: '292',
    conta: '31404',
    itsEspNomeFav: 'CRONOS LOGISTICA LTDA',
    itsMnyValor: 258.4,
    itsMnyVlrPgto: 258.4,
    titMnyLiquido: 258.4,
    itsDtaPgto: 1_790_000_000_000,
    vldOk: 1,
    vldImporta: 1,
    avisos: '[]',
    op: 1,
    bncCodFin015: 4,
    titVldReflexoDdaAssoc: 0,
    titVldReflexoDdaDesassoc: 0,
};

describe('RemessaService — paridade com as flags TED/PIX desligadas', () => {
    it('crédito em conta: payload idêntico ao do main', async () => {
        const write = buildWrite();
        await make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        const [{ itens }] = write.importarTitulos.mock.calls[0];
        expect(itens).toEqual([PAYLOAD_MAIN_CREDITO]);
    });

    it('TED com flags desligadas: modalidade 1 e conta do banco do lote, como no main', async () => {
        const write = buildWrite();
        const l = lote({ itens: [{ ...lote().itens[0], modalidade: 'TED' as const }] });
        await make({ write, lote: l }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        const [{ itens }] = write.importarTitulos.mock.calls[0];
        expect(itens).toEqual([PAYLOAD_MAIN_CREDITO]);
    });

    it('PIX com flags desligadas: igual ao main (conta do banco do lote, modalidade 1)', async () => {
        const write = buildWrite();
        const l = lote({ itens: [{ ...lote().itens[0], modalidade: 'PIX' as const }] });
        await make({ write, lote: l }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        const [{ itens }] = write.importarTitulos.mock.calls[0];
        expect(itens).toEqual([PAYLOAD_MAIN_CREDITO]);
    });

    it('TED com flags desligadas mantém a guarda de mesmo banco (mensagem do main)', async () => {
        const sispag = buildSispag();
        sispag.listContasFavorecido.mockResolvedValue([
            { pctCodSeq: 7, banco: 237, agencia: '1', conta: '2', padrao: true },
        ]);
        const write = buildWrite();
        const l = lote({ itens: [{ ...lote().itens[0], modalidade: 'TED' as const }] });
        await expect(
            make({ write, sispag, lote: l }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toThrow(
            'favorecido de 801/1 não tem conta ativa no banco 341. Cadastre a conta ou escolha outra forma de pagamento.',
        );
        expect(write.importarTitulos).not.toHaveBeenCalled();
    });

    it('ledger sem chave nova quando as flags estão desligadas', async () => {
        const ledger = buildLedger();
        await make({ ledger }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        expect(ledger.setRequestPayload).toHaveBeenCalled();
        for (const [, payload] of ledger.setRequestPayload.mock.calls) {
            expect(payload).not.toHaveProperty('destinos');
        }
    });
});

describe('RemessaService — TED/PIX (flags ligadas, ADR-0054, ADR-0065)', () => {
    const FLAGS = {
        sispagTedEnabled: true,
        sispagPixEnabled: true,
    };
    const DOC_FAV = '11144477735';
    const CHAVE_CADASTRO = {
        cixCod: 31,
        chave: 'cadastro.pix@fornecedor.com.br',
        tipo: 'EMAIL' as const,
        padrao: true,
        pesCod: '1161',
    };
    /** Valores que NUNCA podem aparecer em ledger, log ou mensagem de erro (I10h). */
    const SENSIVEIS = ['cadastro.pix@fornecedor.com.br', DOC_FAV, '87654321'];

    const itemCom = (over: Record<string, unknown>) => ({ ...lote().itens[0], ...over });
    const sispagCom = (o: {
        contas?: unknown[];
        chaves?: unknown[];
        documento?: string | undefined;
    }) => {
        const s = buildSispag();
        s.listContasFavorecido.mockResolvedValue(
            o.contas ?? [
                { pctCodSeq: 42, banco: 237, agencia: '1234', conta: '87654321', padrao: true },
            ],
        );
        s.listChavesPixFavorecido.mockResolvedValue(o.chaves ?? []);
        s.getDocumentoFavorecido.mockResolvedValue('documento' in o ? o.documento : DOC_FAV);
        return s;
    };
    const payloadDe = (write: ReturnType<typeof buildWrite>, i = 0) =>
        write.importarTitulos.mock.calls.flatMap(([p]) => p.itens)[i] as Record<string, unknown>;

    it('caso 1 (regressão do bug): TED para OUTRO banco sai com modalidade 5 e o pctCodSeq', async () => {
        const write = buildWrite();
        const l = lote({ itens: [itemCom({ modalidade: 'TED' })] });
        await make({
            write,
            lote: l,
            sispag: sispagCom({}),
            env: buildEnv({ sispagTedEnabled: true }),
        }).gerarRemessa({
            loteId: 'L1',
            ator: 'u',
        });
        expect(payloadDe(write)).toMatchObject({
            itsVldModalidade: 5,
            pctCodSeq: 42,
            itsNumBanco: 237,
        });
    });

    it('caso 5: PIX do cadastro vai com itsVldChavePix=1 e a chave, sem pctCodSeq', async () => {
        const write = buildWrite();
        const l = lote({ itens: [itemCom({ modalidade: 'PIX' })] });
        await make({
            write,
            lote: l,
            sispag: sispagCom({ chaves: [CHAVE_CADASTRO] }),
            env: buildEnv({ sispagPixEnabled: true }),
        }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        const p = payloadDe(write);
        expect(p).toMatchObject({
            itsVldChavePix: 1,
            itsDesChavePix: 'cadastro.pix@fornecedor.com.br',
            // H4 — `MODALIDADE_PIX_NATIVA`, valor a confirmar no teste supervisionado.
            itsVldModalidade: 1,
        });
        expect(p.pctCodSeq).toBeUndefined();
    });

    it('caso 6 forçado: TED/PIX sem destino → DestinoPagamentoAusenteError ANTES do criarLote', async () => {
        const write = buildWrite();
        const l = lote({
            itens: [
                itemCom({ modalidade: 'PIX' }),
                { ...itemCom({ modalidade: 'TED' }), docCod: '802', credor: 'OUTRO' },
            ],
        });
        write.listarTitulosPendentes.mockResolvedValue([pendente(), pendente802()]);
        const ledger = buildLedger();
        await expect(
            make({
                write,
                ledger,
                lote: l,
                sispag: sispagCom({ contas: [], chaves: [] }),
                env: buildEnv(FLAGS),
            }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            }),
        ).rejects.toMatchObject({
            code: 'DESTINO_PAGAMENTO_AUSENTE',
            userMessage: expect.stringMatching(/801\/1.*802\/1/s),
        });
        expect(write.criarLote).not.toHaveBeenCalled();
        expect(write.importarTitulos).not.toHaveBeenCalled();
        // Falhou dentro da execução: o ledger fica em `error` (retry permitido), não órfão.
        expect(ledger.fail).toHaveBeenCalled();
    });

    it('caso 7: o destino entra na assinatura da marca d’água — só referências, nunca o valor', async () => {
        const ledger = buildLedger();
        const l = lote({
            itens: [
                itemCom({ modalidade: 'TED' }),
                { ...itemCom({ modalidade: 'PIX' }), docCod: '802' },
            ],
        });
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue([pendente(), pendente802()]);
        await make({
            ledger,
            write,
            lote: l,
            sispag: sispagCom({ chaves: [CHAVE_CADASTRO] }),
            env: buildEnv(FLAGS),
        }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        const [, marca] = ledger.setRequestPayload.mock.calls[0];
        expect(marca).toMatchObject({
            marcaFlpCods: [98],
            destinos: [
                { item: '2:801:1', origem: 'CADASTRO', pctCodSeq: 42 },
                { item: '2:802:1', origem: 'CADASTRO', cixCod: 31 },
            ],
        });
        // Todas as gravações seguintes carregam a assinatura (o payload é substituído a cada passo).
        for (const [, payload] of ledger.setRequestPayload.mock.calls) {
            expect(payload).toHaveProperty('destinos');
        }
    });

    it('caso 7: a retomada reenvia o destino PERSISTIDO (pctCodSeq fixado), não a nova default do cadastro', async () => {
        const ledger = buildLedger({
            status: 'error',
            dryRun: false,
            nativeFlpCod: 12,
            etapa: 'importar',
            requestPayload: {
                itens: 1,
                flpCod: 12,
                destinos: [{ item: '2:801:1', origem: 'CADASTRO', pctCodSeq: 7 }],
            },
        });
        const write = buildWrite();
        const sispag = sispagCom({
            contas: [
                { pctCodSeq: 9, banco: 1, agencia: '1', conta: '11110000', padrao: true },
                { pctCodSeq: 7, banco: 237, agencia: '2', conta: '22220000', padrao: false },
            ],
        });
        const l = lote({ dataDebito: '2026-09-23', itens: [itemCom({ modalidade: 'TED' })] });
        await make({ ledger, write, lote: l, sispag, env: buildEnv(FLAGS) }).gerarRemessa({
            loteId: 'L1',
            ator: 'u',
        });
        expect(write.criarLote).not.toHaveBeenCalled();
        expect(payloadDe(write)).toMatchObject({ pctCodSeq: 7, itsNumBanco: 237 });
    });

    it('caso 7: conta persistida sumiu do cadastro → falha fechada, sem import', async () => {
        const ledger = buildLedger({
            status: 'error',
            dryRun: false,
            nativeFlpCod: 12,
            etapa: 'importar',
            requestPayload: { destinos: [{ item: '2:801:1', origem: 'CADASTRO', pctCodSeq: 7 }] },
        });
        const write = buildWrite();
        const l = lote({ dataDebito: '2026-09-23', itens: [itemCom({ modalidade: 'TED' })] });
        await expect(
            make({
                ledger,
                write,
                lote: l,
                sispag: sispagCom({}),
                env: buildEnv(FLAGS),
            }).gerarRemessa({
                loteId: 'L1',
                ator: 'u',
            }),
        ).rejects.toMatchObject({ code: 'DESTINO_CONGELADO' });
        expect(write.importarTitulos).not.toHaveBeenCalled();
    });

    // ── fault-tolerance-1 (Regis-Review 2026-09-29): o pin sobrevive a flag desligada, a
    // assinatura ilegível e a retomada parcial ─────────────────────────────────────────
    const ledgerComPin = (destinos: unknown, over: Record<string, unknown> = {}) =>
        buildLedger({
            status: 'error',
            dryRun: false,
            nativeFlpCod: 12,
            etapa: 'importar',
            requestPayload: { itens: 1, flpCod: 12, destinos },
            ...over,
        });

    it.each([
        ['destino digitado por item, ADR-0054', { origem: 'MANUAL', auditId: 'aud-antigo' }],
        ['exceção de destino, ADR-0061', { origem: 'EXCECAO', excecaoId: 'EXC-antiga' }],
    ])('pin do formato LEGADO (%s) → falha fechada, não "ilegível"', async (_n, legado) => {
        const write = buildWrite();
        const l = lote({ dataDebito: '2026-09-23', itens: [itemCom({ modalidade: 'TED' })] });
        await expect(
            make({
                ledger: ledgerComPin([{ item: '2:801:1', ...legado }]),
                write,
                lote: l,
                sispag: sispagCom({}),
                env: buildEnv(FLAGS),
            }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({ code: 'DESTINO_CONGELADO' });
        expect(write.importarTitulos).not.toHaveBeenCalled();
    });

    it('flag TED desligada numa retomada com destino fixado → falha fechada, sem import', async () => {
        const write = buildWrite();
        const l = lote({ dataDebito: '2026-09-23', itens: [itemCom({ modalidade: 'TED' })] });
        await expect(
            make({
                ledger: ledgerComPin([{ item: '2:801:1', origem: 'CADASTRO', pctCodSeq: 42 }]),
                write,
                lote: l,
                sispag: sispagCom({}),
                env: buildEnv({}),
            }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({ code: 'DESTINO_CONGELADO' });
        expect(write.importarTitulos).not.toHaveBeenCalled();
    });

    it('flag só do PIX ligada e item TED fixado → também falha fechada', async () => {
        const write = buildWrite();
        const l = lote({ dataDebito: '2026-09-23', itens: [itemCom({ modalidade: 'TED' })] });
        await expect(
            make({
                ledger: ledgerComPin([{ item: '2:801:1', origem: 'CADASTRO', pctCodSeq: 42 }]),
                write,
                lote: l,
                sispag: sispagCom({}),
                env: buildEnv({ sispagPixEnabled: true }),
            }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({ code: 'DESTINO_CONGELADO' });
        expect(write.importarTitulos).not.toHaveBeenCalled();
    });

    it('assinatura de destinos ilegível no ledger → falha fechada (não segue sem pin)', async () => {
        const write = buildWrite();
        const l = lote({ dataDebito: '2026-09-23', itens: [itemCom({ modalidade: 'TED' })] });
        await expect(
            make({
                ledger: ledgerComPin([{ item: 7 }]),
                write,
                lote: l,
                sispag: sispagCom({}),
                env: buildEnv(FLAGS),
            }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toMatchObject({ code: 'DESTINO_CONGELADO' });
        expect(write.importarTitulos).not.toHaveBeenCalled();
    });

    it('retomada parcial: a assinatura regravada MESCLA a anterior (não perde o item já importado)', async () => {
        const write = buildWrite();
        write.getLoteNativo.mockResolvedValue({
            filCod: 2,
            bncCod: 4,
            flpCod: 12,
            status: 0,
            titulosCount: 1,
            soma: 1,
        });
        write.listarChavesDoLote.mockResolvedValue(new Set(['2:801:1']));
        write.listarTitulosPendentes.mockResolvedValue([pendente(), pendente802()]);
        const ledger = buildLedger({
            status: 'reconciling',
            dryRun: false,
            nativeFlpCod: 12,
            etapa: 'importar',
            filCod: 2,
            bncCod: 4,
            requestPayload: {
                destinos: [
                    { item: '2:801:1', origem: 'CADASTRO', pctCodSeq: 42 },
                    { item: '2:802:1', origem: 'CADASTRO', pctCodSeq: 42 },
                ],
            },
        });
        const l = lote({
            dataDebito: '2026-09-23',
            itens: [
                itemCom({ modalidade: 'TED' }),
                { ...itemCom({ modalidade: 'TED' }), docCod: '802' },
            ],
        });
        await make({
            ledger,
            write,
            lote: l,
            sispag: sispagCom({}),
            env: buildEnv(FLAGS),
        }).gerarRemessa({
            loteId: 'L1',
            ator: 'u',
        });
        // Só o 802 foi importado agora…
        expect(write.importarTitulos.mock.calls.flatMap(([p]) => p.itens)).toHaveLength(1);
        // …mas toda gravação do payload segue com os DOIS destinos fixados.
        for (const [, payload] of ledger.setRequestPayload.mock.calls) {
            expect(
                (payload as { destinos: Array<{ item: string }> }).destinos
                    .map((d) => d.item)
                    .sort(),
            ).toEqual(['2:801:1', '2:802:1']);
        }
    });

    it('I10h: ledger, logs e erros nunca carregam conta, chave ou documento', async () => {
        const ledger = buildLedger();
        const log = buildLog();
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue([
            pendente(),
            pendente802(),
            { ...pendente({ docCod: 803 }), docCod: '803' },
        ]);
        const l = lote({
            itens: [
                itemCom({ modalidade: 'TED' }),
                { ...itemCom({ modalidade: 'TED' }), docCod: '802' },
                { ...itemCom({ modalidade: 'PIX' }), docCod: '803' },
            ],
        });
        const sispag = sispagCom({ chaves: [CHAVE_CADASTRO] });
        await make({
            ledger,
            log,
            write,
            lote: l,
            sispag,
            env: buildEnv(FLAGS),
        }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        const registrado = JSON.stringify([
            ledger.setRequestPayload.mock.calls,
            ledger.beginExecution.mock.calls,
            ledger.settle.mock.calls,
            (log.info as jest.Mock).mock.calls,
            (log.warn as jest.Mock).mock.calls,
            (log.error as jest.Mock).mock.calls,
        ]);
        for (const v of SENSIVEIS) expect(registrado).not.toContain(v);

        // E no caminho de erro: a mensagem gravada no ledger também não.
        const ledger2 = buildLedger();
        await expect(
            make({
                ledger: ledger2,
                lote: l,
                write,
                sispag: sispagCom({ contas: [], chaves: [] }),
                env: buildEnv(FLAGS),
            }).gerarRemessa({ loteId: 'L1', ator: 'u' }),
        ).rejects.toBeDefined();
        const erro = JSON.stringify(ledger2.fail.mock.calls);
        for (const v of SENSIVEIS) expect(erro).not.toContain(v);
    });

    it('caso 9: lote misto boleto + TED + PIX — cada item com a sua modalidade, boleto inalterado', async () => {
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue([
            pendente({}, true),
            pendente802(),
            { ...pendente({ docCod: 803 }), docCod: '803' },
        ]);
        const l = lote({
            itens: [
                itemCom({ modalidade: 'BOLETO' }),
                { ...itemCom({ modalidade: 'TED' }), docCod: '802' },
                { ...itemCom({ modalidade: 'PIX' }), docCod: '803' },
            ],
        });
        await make({
            write,
            lote: l,
            sispag: sispagCom({ chaves: [CHAVE_CADASTRO] }),
            env: buildEnv(FLAGS),
        }).gerarRemessa({
            loteId: 'L1',
            ator: 'u',
        });
        const porDoc = new Map(
            write.importarTitulos.mock.calls
                .flatMap(([p]) => p.itens as Array<Record<string, unknown>>)
                .map((p) => [String(p.docCod), p]),
        );
        // Boleto DDA: exatamente o payload de antes (sem destino, modalidade 7 como palpite).
        const boletoMain = { ...PAYLOAD_MAIN_CREDITO, itsVldModalidade: 7 };
        for (const k of [
            'pctCodSeq',
            'itsNumBanco',
            'agencia',
            'pctEspNumAgencia',
            'conta',
        ] as const) {
            delete (boletoMain as Record<string, unknown>)[k];
        }
        expect(porDoc.get('801')).toEqual(boletoMain);
        expect(porDoc.get('802')).toMatchObject({ itsVldModalidade: 5, pctCodSeq: 42 });
        expect(porDoc.get('803')).toMatchObject({ itsVldChavePix: 1 });
    });

    it('não chama validacao/modalidadeTed|Pix (H1 não provado)', () => {
        const fonte = readFileSync(join(__dirname, 'RemessaService.ts'), 'utf8');
        expect(fonte).not.toMatch(/validacao\/modalidade/);
    });
});

describe('RemessaService — validador do .REM com TED/PIX (caso 8, só aviso)', () => {
    it('PIX que o arquivo não mostra como PIX: loga FORMA_DIVERGENTE_A_CONFIRMAR e NÃO bloqueia', async () => {
        const write = buildWrite();
        write.listarArquivosRemessa.mockResolvedValue([
            { gabCod: 52, nomeArquivo: 'PG210801.REM', conteudo: 'CNAB DO LOTE' },
        ]);
        const sispag = buildSispag();
        sispag.listChavesPixFavorecido.mockResolvedValue([
            { cixCod: 1, chave: 'x@y.com.br', tipo: 'EMAIL', padrao: true, pesCod: '1161' },
        ]);
        const log = buildLog();
        const l = lote({ itens: [{ ...lote().itens[0], modalidade: 'PIX' as const }] });
        const res = await make({
            write,
            sispag,
            log,
            lote: l,
            env: buildEnv({ sispagPixEnabled: true }),
        }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        expect(res.status).toBe('gerada');
        const integridade = (log.info as jest.Mock).mock.calls.find(
            ([e]) => e.message === 'remessa: verificação de integridade do .REM',
        );
        expect(JSON.stringify(integridade?.[0].data.avisos)).toContain(
            'FORMA_DIVERGENTE_A_CONFIRMAR',
        );
    });

    it('flags desligadas: o validador roda como antes (sem comparação de forma)', async () => {
        const log = buildLog();
        await make({ log }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        const integridade = (log.info as jest.Mock).mock.calls.find(
            ([e]) => e.message === 'remessa: verificação de integridade do .REM',
        );
        expect(integridade?.[0].data.avisos).toEqual([]);
    });
});

describe('RemessaService — guarda de código de barras que retira (ADR-0069 emenda 1, I16)', () => {
    const cb = new CodigoBarrasBoleto();
    const dvGeral = (semDv: string): string => {
        let soma = 0;
        let peso = 2;
        for (let i = semDv.length - 1; i >= 0; i -= 1) {
            soma += Number(semDv[i]) * peso;
            peso = peso === 9 ? 2 : peso + 1;
        }
        const dv = 11 - (soma % 11);
        return String(dv === 0 || dv === 10 || dv === 11 ? 1 : dv);
    };
    /** Barras SINTÉTICAS (44) com DV geral válido; a semente muda o campo livre. */
    const barras = (semente: number): string => {
        const livre = String(semente).padStart(25, '0');
        const meio = `1580${'0000141200'}${livre}`;
        return `3419${dvGeral(`3419${meio}`)}${meio}`;
    };
    const linha = (semente: number): string => cb.paraLinhaDigitavel(barras(semente)) as string;
    const BARRAS_A = barras(1111);
    const LINHA_A = linha(1111);
    const LINHA_B = linha(2222);
    const MASCARADO_A = `${BARRAS_A.slice(0, 5)}…${BARRAS_A.slice(-4)}`;
    const distintos = (i: number) => linha(5000 + i);

    const doc = (i: number) => String(1000 + i);
    const chave = (i: number, fil = 2) => `${fil}:${doc(i)}:1`;
    const itensBoleto = (n: number, venc = Date.UTC(2026, 9, 14, 15)) =>
        Array.from({ length: n }, (_, i) => ({
            loteId: 'L1',
            filCod: 2,
            docCod: doc(i),
            titCod: '1',
            credor: 'PEDRONI',
            valor: 1412,
            vencimento: venc,
            modalidade: 'BOLETO' as const,
            incluidoPor: 'u1',
            divergencia: false,
        }));
    const loteBoleto = (n = 3) => lote({ itens: itensBoleto(n) });
    const pendentesBoleto = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
            ...pendente({ docCod: 1000 + i }, true),
            docCod: doc(i),
        }));

    interface Nativo {
        docCod: string;
        itsCodSeq?: number;
        linha?: string;
        titCod?: string;
        filCod?: number;
        /** `true` = veio em `invalidos` (código presente, recusado no boundary). */
        invalido?: boolean;
    }
    const nat = (i: number, linhaDigitavel: string | undefined, over: Partial<Nativo> = {}) => ({
        docCod: doc(i),
        itsCodSeq: 10 + i,
        ...(linhaDigitavel !== undefined ? { linha: linhaDigitavel } : {}),
        ...over,
    });
    const leituraDe = (estado: Nativo[], over: Record<string, unknown> = {}) => {
        const validos = estado.filter((e) => !e.invalido);
        const invalidos = estado.filter((e) => e.invalido);
        return {
            itens: validos.map((e) => ({
                docCod: e.docCod,
                titCod: e.titCod ?? '1',
                linhaDigitavel: e.linha as string,
                filCod: e.filCod ?? 2,
                ...(e.itsCodSeq !== undefined ? { itsCodSeq: e.itsCodSeq } : {}),
            })),
            total: estado.length,
            dropped: invalidos.length,
            completa: true,
            ...(invalidos.length > 0
                ? {
                      invalidos: invalidos.map((e) => ({
                          docCod: e.docCod,
                          titCod: e.titCod ?? '1',
                          filCod: e.filCod ?? 2,
                          ...(e.itsCodSeq !== undefined ? { itsCodSeq: e.itsCodSeq } : {}),
                      })),
                  }
                : {}),
            ...over,
        };
    };

    /**
     * Rascunho nativo COM ESTADO. `deleteFalha` = o DELETE lança e nada sai; `deleteIgnorado` =
     * responde 200 e o item continua; `deleteErroMasSai` = lança 500 mas o item saiu.
     * `relerFalha` = a partir da 2ª leitura a lista não vem.
     */
    const nativoFake = (
        inicial: Nativo[],
        o: {
            n?: number;
            deleteFalha?: string[];
            deleteIgnorado?: string[];
            deleteErroMasSai?: string[];
            relerFalha?: boolean;
            leituraOver?: Record<string, unknown>;
        } = {},
    ) => {
        let estado = [...inicial];
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue(pendentesBoleto(o.n ?? inicial.length));
        let leituras = 0;
        write.listarLinhasDigitaveisDoLote.mockImplementation(async () => {
            leituras += 1;
            if (o.relerFalha && leituras > 1) throw new Error('HTTP 503');
            return leituraDe(estado, o.leituraOver) as never;
        });
        write.listarChavesDoLote.mockImplementation(
            async () =>
                new Set(estado.map((e) => `${e.filCod ?? 2}:${e.docCod}:${e.titCod ?? '1'}`)),
        );
        write.removerItemDoRascunho.mockImplementation(async (p: { itsCodSeq: number }) => {
            const alvo = estado.find((e) => e.itsCodSeq === p.itsCodSeq);
            if (alvo && o.deleteFalha?.includes(alvo.docCod)) throw new Error('HTTP 500');
            if (alvo && o.deleteIgnorado?.includes(alvo.docCod)) return;
            estado = estado.filter((e) => e.itsCodSeq !== p.itsCodSeq);
            if (alvo && o.deleteErroMasSai?.includes(alvo.docCod)) throw new Error('HTTP 500');
        });
        write.importarTitulos.mockImplementation(async () => {
            // Import parcial: os que faltavam entram com o código "distinto" do teste.
            for (const e of inicial)
                if (!estado.includes(e) && e.itsCodSeq === undefined) estado.push(e);
        });
        return {
            write,
            estado: () => estado,
            adicionar: (e: Nativo) => estado.push(e),
        };
    };

    /** Lote local COM ESTADO: a retirada tira o item e bumpa a `versao`, como o repositório. */
    const loteVivo = (inicial: LotePagamento) => {
        let itens = [...inicial.itens];
        let versao = inicial.versao;
        const repo = buildLoteRepo(inicial);
        repo.getLoteComItens.mockImplementation(async () => ({ ...inicial, itens, versao }));
        repo.retirarItemPorCodigoDeBarras.mockImplementation(
            async (p: { filCod: number; docCod: string; titCod: string }) => {
                const antes = itens.length;
                itens = itens.filter(
                    (i) =>
                        !(i.filCod === p.filCod && i.docCod === p.docCod && i.titCod === p.titCod),
                );
                if (itens.length === antes) return { removido: false };
                versao += 1;
                return { removido: true };
            },
        );
        return { repo, itens: () => itens };
    };

    const rodar = async (o: {
        lote: LotePagamento;
        nativo: ReturnType<typeof nativoFake>;
        ledger?: ReturnType<typeof buildLedger>;
        log?: LogService;
        bloqueios?: ReturnType<typeof buildBloqueios>;
        eventos?: ReturnType<typeof buildEventos>;
        ajustarRepo?: (repo: ReturnType<typeof buildLoteRepo>) => void;
    }) => {
        const vivo = loteVivo(o.lote);
        o.ajustarRepo?.(vivo.repo);
        const ledger = o.ledger ?? buildLedger();
        const svc = make({
            write: o.nativo.write,
            loteRepo: vivo.repo,
            ledger,
            ...(o.log ? { log: o.log } : {}),
            ...(o.bloqueios ? { bloqueios: o.bloqueios } : {}),
            ...(o.eventos ? { eventos: o.eventos } : {}),
        });
        const res = await svc
            .gerarRemessa({ loteId: 'L1', ator: 'u' })
            .then((r) => ({ res: r, err: undefined as unknown }))
            .catch((e: unknown) => ({ res: undefined, err: e }));
        return { ...res, loteRepo: vivo.repo, locais: vivo.itens, ledger, write: o.nativo.write };
    };

    // ── Caminho feliz: PEDRONI ──────────────────────────────────────────────

    it('3 itens com o mesmo código: 2 retirados, 1 fica; ordem local → DELETE → releitura → finalizar', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A), nat(2, LINHA_A)]);
        const r = await rodar({ lote: loteBoleto(3), nativo });

        expect(r.err).toBeUndefined();
        expect(r.res?.status).toBe('gerada');
        expect(r.res?.retiradosPorCodigoBarras?.map((x) => x.titulo.docCod)).toEqual([
            '1001',
            '1002',
        ]);
        expect(r.res?.retiradosPorCodigoBarras?.[0]).toMatchObject({
            titulo: { filCod: 2, docCod: '1001', titCod: '1' },
            motivo: 'CODIGO_BARRAS_REPETIDO',
            codigoMascarado: MASCARADO_A,
            tituloMantido: { filCod: 2, docCod: '1000', titCod: '1' },
            valor: 1412,
            vencimento: '2026-10-14',
        });
        expect(r.res?.avisos?.length).toBeGreaterThan(0);
        // Total do lote reflete o item removido.
        expect(r.res?.itens).toBe(1);
        expect(r.res?.valorTotal).toBe(1412);
        expect(r.locais().map((i) => i.docCod)).toEqual(['1000']);

        const ordem = (m: jest.Mock) => m.mock.invocationCallOrder;
        const leituras = ordem(r.write.listarLinhasDigitaveisDoLote);
        expect(ordem(r.loteRepo.retirarItemPorCodigoDeBarras)[0]).toBeLessThan(
            ordem(r.write.removerItemDoRascunho)[0] as number,
        );
        expect(ordem(r.write.removerItemDoRascunho)[0]).toBeLessThan(leituras[1] as number);
        expect(Math.max(...leituras)).toBeLessThan(ordem(r.write.finalizarLote)[0] as number);
        // `finalizarLote` só roda depois do último DELETE confirmado.
        expect(r.write.finalizarLote).toHaveBeenCalledTimes(1);
        // A versão usada na transição é a ATUAL (3 + 2 retiradas), não o snapshot do início.
        expect(r.loteRepo.transicionarStatus).toHaveBeenCalledWith(
            expect.objectContaining({ versaoEsperada: 5 }),
        );
    });

    it('o repositório recebe motivo, máscara e título mantido (nunca o código)', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)]);
        const r = await rodar({ lote: loteBoleto(2), nativo });
        expect(r.err).toBeUndefined();
        const [params] = r.loteRepo.retirarItemPorCodigoDeBarras.mock.calls[0];
        expect(params).toEqual({
            loteId: 'L1',
            filCod: 2,
            docCod: '1001',
            titCod: '1',
            motivo: 'CODIGO_BARRAS_REPETIDO',
            codigoMascarado: MASCARADO_A,
            tituloMantido: { filCod: 2, docCod: '1000', titCod: '1' },
        });
    });

    it('o itsCodSeq do DELETE é o da leitura MAIS RECENTE (a lista muda entre os DELETE)', async () => {
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue(pendentesBoleto(3));
        write.listarLinhasDigitaveisDoLote
            .mockResolvedValueOnce(
                leituraDe([
                    { docCod: '1000', linha: LINHA_A, itsCodSeq: 11 },
                    { docCod: '1001', linha: LINHA_A, itsCodSeq: 12 },
                    { docCod: '1002', linha: LINHA_A, itsCodSeq: 13 },
                ]) as never,
            )
            // Depois do 1º DELETE o ERP renumerou: o 1002 agora é o 23.
            .mockResolvedValueOnce(
                leituraDe([
                    { docCod: '1000', linha: LINHA_A, itsCodSeq: 21 },
                    { docCod: '1002', linha: LINHA_A, itsCodSeq: 23 },
                ]) as never,
            )
            .mockResolvedValueOnce(
                leituraDe([{ docCod: '1000', linha: LINHA_A, itsCodSeq: 21 }]) as never,
            );
        const vivo = loteVivo(loteBoleto(3));
        await make({ write, loteRepo: vivo.repo }).gerarRemessa({ loteId: 'L1', ator: 'u' });

        expect(write.removerItemDoRascunho.mock.calls.map(([p]) => p.itsCodSeq)).toEqual([12, 23]);
        expect(write.removerItemDoRascunho.mock.calls[0][0]).toMatchObject({
            filCod: 2,
            bncCod: 4,
            flpCod: 12,
            filCodItem: 2,
        });
        expect(write.finalizarLote).toHaveBeenCalledTimes(1);
    });

    it('sem repetição: nenhum DELETE, nenhuma marca, resultado sem os campos novos (regressão)', async () => {
        const nativo = nativoFake([
            nat(0, distintos(0)),
            nat(1, distintos(1)),
            nat(2, distintos(2)),
        ]);
        const r = await rodar({ lote: loteBoleto(3), nativo });
        expect(r.res?.status).toBe('gerada');
        expect(r.write.listarLinhasDigitaveisDoLote).toHaveBeenCalledTimes(1);
        expect(r.write.removerItemDoRascunho).not.toHaveBeenCalled();
        expect(r.loteRepo.retirarItemPorCodigoDeBarras).not.toHaveBeenCalled();
        expect(r.res).not.toHaveProperty('retiradosPorCodigoBarras');
        expect(r.res).not.toHaveProperty('avisos');
        expect(r.res?.itens).toBe(3);
    });

    it('lote sem BOLETO não consulta as linhas digitáveis', async () => {
        const write = buildWrite();
        await make({ write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
        expect(write.listarLinhasDigitaveisDoLote).not.toHaveBeenCalled();
    });

    it('dry-run não faz a leitura (não há import)', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)]);
        await make({ write: nativo.write, lote: loteBoleto(2) }).gerarRemessa({
            loteId: 'L1',
            ator: 'u',
            dryRunOverride: true,
        });
        expect(nativo.write.listarLinhasDigitaveisDoLote).not.toHaveBeenCalled();
    });

    it('homônimo cross-filial: mesmo docCod/titCod em outra filial não colapsa (chave com filCod)', async () => {
        const itens = [
            { ...itensBoleto(1)[0], filCod: 2, docCod: '1000' },
            { ...itensBoleto(1)[0], filCod: 3, docCod: '1000' },
        ];
        const nativo = nativoFake(
            [
                { docCod: '1000', linha: LINHA_A, itsCodSeq: 11, filCod: 2 },
                { docCod: '1000', linha: LINHA_A, itsCodSeq: 12, filCod: 3 },
            ],
            { n: 2 },
        );
        nativo.write.listarTitulosPendentes.mockResolvedValue([
            { ...pendente({ docCod: 1000, filCod: 2 }, true), docCod: '1000' },
            { ...pendente({ docCod: 1000, filCod: 3 }, true), docCod: '1000' },
        ]);
        const r = await rodar({ lote: lote({ itens }), nativo });
        expect(r.err).toBeUndefined();
        // Os dois têm o mesmo código: fica a filial 2 (menor filCod); sai a 3 — pela chave completa.
        expect(r.res?.retiradosPorCodigoBarras).toEqual([
            expect.objectContaining({
                titulo: { filCod: 3, docCod: '1000', titCod: '1' },
                tituloMantido: { filCod: 2, docCod: '1000', titCod: '1' },
            }),
        ]);
        expect(r.write.removerItemDoRascunho.mock.calls[0][0]).toMatchObject({
            itsCodSeq: 12,
            filCodItem: 3,
        });
    });

    // ── Ilegível ────────────────────────────────────────────────────────────

    it('ilegível (DV inválido lido): retirado com motivo próprio, sem título mantido; segue', async () => {
        const nativo = nativoFake([
            nat(0, distintos(0)),
            nat(1, distintos(1)),
            nat(2, undefined, { invalido: true }),
        ]);
        const r = await rodar({ lote: loteBoleto(3), nativo });
        expect(r.err).toBeUndefined();
        expect(r.res?.retiradosPorCodigoBarras).toEqual([
            {
                titulo: { filCod: 2, docCod: '1002', titCod: '1' },
                valor: 1412,
                vencimento: '2026-10-14',
                credor: 'PEDRONI',
                motivo: 'CODIGO_BARRAS_ILEGIVEL',
            },
        ]);
        expect(r.loteRepo.retirarItemPorCodigoDeBarras.mock.calls[0][0]).toMatchObject({
            motivo: 'CODIGO_BARRAS_ILEGIVEL',
            docCod: '1002',
        });
        expect(r.loteRepo.retirarItemPorCodigoDeBarras.mock.calls[0][0]).not.toHaveProperty(
            'tituloMantido',
        );
        expect(r.write.finalizarLote).toHaveBeenCalledTimes(1);
    });

    it('lote que esvazia pela cláusula de ilegível: erro nomeado, ledger failed, sem finalizar', async () => {
        const nativo = nativoFake([
            nat(0, undefined, { invalido: true }),
            nat(1, undefined, { invalido: true }),
        ]);
        const r = await rodar({ lote: loteBoleto(2), nativo });
        expect(r.err).toMatchObject({
            name: 'BoletoLoteEsvaziadoPorCodigoError',
            code: 'BOLETO_LOTE_ESVAZIADO_POR_CODIGO',
            statusCode: 409,
        });
        expect(r.write.finalizarLote).not.toHaveBeenCalled();
        expect(r.ledger.fail).toHaveBeenCalledTimes(1);
        expect(r.locais()).toEqual([]);
    });

    // ── Leitura incompleta aborta SEM retirar nada (I16c) ───────────────────

    describe.each([
        [
            'ausência pura (boleto do lote sem código lido)',
            () => nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)], { n: 3 }),
        ],
        [
            'lista truncada (completa=false)',
            () =>
                nativoFake([nat(0, LINHA_A), nat(1, LINHA_A), nat(2, LINHA_A)], {
                    leituraOver: { completa: false },
                }),
        ],
        [
            'item sem itsCodSeq',
            () =>
                nativoFake([
                    nat(0, LINHA_A),
                    nat(1, LINHA_A),
                    nat(2, LINHA_A, { itsCodSeq: undefined }),
                ]),
        ],
    ])('%s', (_nome, montar) => {
        it('aborta com erro nomeado, sem nenhuma remoção, ledger failed', async () => {
            const nativo = montar();
            const r = await rodar({ lote: loteBoleto(3), nativo });
            expect(r.err).toMatchObject({
                code: 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA',
                statusCode: 409,
                details: { modo: 'leitura' },
            });
            expect(r.loteRepo.retirarItemPorCodigoDeBarras).not.toHaveBeenCalled();
            expect(r.write.removerItemDoRascunho).not.toHaveBeenCalled();
            expect(r.write.finalizarLote).not.toHaveBeenCalled();
            expect(r.ledger.fail).toHaveBeenCalledTimes(1);
        });
    });

    it('falha de leitura da lista nativa: incompleta (nunca "limpo"), sem remoção', async () => {
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue(pendentesBoleto(3));
        write.listarLinhasDigitaveisDoLote.mockRejectedValue(new Error('HTTP 503'));
        const vivo = loteVivo(loteBoleto(3));
        const err = await make({ write, loteRepo: vivo.repo })
            .gerarRemessa({ loteId: 'L1', ator: 'u' })
            .catch((e: unknown) => e);
        expect(err).toMatchObject({
            code: 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA',
            details: { modo: 'leitura', causa: 'LISTA_ILEGIVEL' },
        });
        expect(vivo.repo.retirarItemPorCodigoDeBarras).not.toHaveBeenCalled();
        expect(write.finalizarLote).not.toHaveBeenCalled();
    });

    // ── Sucesso = ausência observada (I16d.3) ───────────────────────────────

    it('DELETE responde 200 mas a releitura ainda mostra o item: incompleta, ledger failed, sem finalizar', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)], {
            deleteIgnorado: ['1001'],
        });
        const r = await rodar({ lote: loteBoleto(2), nativo });
        expect(r.err).toMatchObject({
            name: 'BoletoCodigoBarrasRetiradaIncompletaError',
            details: { modo: 'limpeza', pendentes: [{ docCod: '1001', titCod: '1' }] },
        });
        expect(r.ledger.fail).toHaveBeenCalledTimes(1);
        expect(r.ledger.fail.mock.calls[0][1].mensagem).toContain(
            'LIMPEZA_CODIGO_REPETIDO_INCOMPLETA',
        );
        expect(r.write.finalizarLote).not.toHaveBeenCalled();
        expect(r.res).toBeUndefined();
    });

    it('DELETE falha (5xx) mas a releitura mostra ausência: observação vence o status; segue', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)], {
            deleteErroMasSai: ['1001'],
        });
        const r = await rodar({ lote: loteBoleto(2), nativo });
        expect(r.err).toBeUndefined();
        expect(r.res?.status).toBe('gerada');
        expect(r.write.finalizarLote).toHaveBeenCalledTimes(1);
    });

    it('releitura que não vem: incompleta (nunca "limpo"); os que faltam ficam pendentes', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A), nat(2, LINHA_A)], {
            relerFalha: true,
        });
        const r = await rodar({ lote: loteBoleto(3), nativo });
        expect(r.err).toMatchObject({
            code: 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA',
            details: {
                modo: 'limpeza',
                pendentes: [
                    { docCod: '1001', titCod: '1' },
                    { docCod: '1002', titCod: '1' },
                ],
            },
        });
        expect(r.write.finalizarLote).not.toHaveBeenCalled();
        // O 1º saiu do local (local primeiro) e só ele: o 2º nem foi tocado.
        expect(r.loteRepo.retirarItemPorCodigoDeBarras).toHaveBeenCalledTimes(1);
    });

    it('retirada local sem efeito (removido:false): nenhum DELETE, nada contado, erro com o pendente', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A), nat(2, LINHA_A)]);
        const r = await rodar({
            lote: loteBoleto(3),
            nativo,
            ajustarRepo: (repo) =>
                repo.retirarItemPorCodigoDeBarras.mockResolvedValue({ removido: false }),
        });
        expect(r.err).toMatchObject({
            code: 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA',
            details: {
                modo: 'limpeza',
                retirados: 0,
                pendentes: [
                    { docCod: '1001', titCod: '1' },
                    { docCod: '1002', titCod: '1' },
                ],
            },
        });
        expect(r.write.removerItemDoRascunho).not.toHaveBeenCalled();
        expect(r.write.finalizarLote).not.toHaveBeenCalled();
        expect(r.ledger.setEtapa).not.toHaveBeenCalledWith(expect.any(String), 'gerar_remessa');
    });

    it('transação local falha: nenhum DELETE, nada contado, erro com o pendente', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)]);
        const r = await rodar({
            lote: loteBoleto(2),
            nativo,
            ajustarRepo: (repo) =>
                repo.retirarItemPorCodigoDeBarras.mockRejectedValue(new Error('conexão perdida')),
        });
        expect(r.err).toMatchObject({
            code: 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA',
            details: { modo: 'limpeza', retirados: 0, pendentes: [{ docCod: '1001' }] },
        });
        expect(r.write.removerItemDoRascunho).not.toHaveBeenCalled();
        expect(r.write.finalizarLote).not.toHaveBeenCalled();
    });

    it('falha parcial: o 1º confirmado permanece retirado, o erro lista só o pendente', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A), nat(2, LINHA_A)], {
            deleteFalha: ['1002'],
        });
        const r = await rodar({ lote: loteBoleto(3), nativo });
        expect(r.err).toMatchObject({
            code: 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA',
            details: {
                modo: 'limpeza',
                retirados: 1,
                pendentes: [{ docCod: '1002', titCod: '1' }],
            },
        });
        // Local primeiro para os dois; o 1001 saiu do rascunho, o 1002 ficou lá (resíduo).
        expect(r.loteRepo.retirarItemPorCodigoDeBarras).toHaveBeenCalledTimes(2);
        expect(r.locais().map((i) => i.docCod)).toEqual(['1000']);
        expect(nativo.estado().map((e) => e.docCod)).toEqual(['1000', '1002']);
        expect(r.write.finalizarLote).not.toHaveBeenCalled();
        // O ledger fica retomável: etapa `finalizar` gravada ANTES da guarda, status `error`.
        expect(r.ledger.setEtapa).toHaveBeenCalledWith(expect.any(String), 'finalizar');
        expect(r.ledger.setEtapa).not.toHaveBeenCalledWith(expect.any(String), 'gerar_remessa');
    });

    // ── Privacidade e auditoria ─────────────────────────────────────────────

    it('log, ledger e erro só com o mascarado; um warn BUSINESS_WARN com contagens', async () => {
        const log = buildLog();
        const nativo = nativoFake([
            nat(0, LINHA_A),
            nat(1, LINHA_A),
            nat(2, LINHA_B),
            nat(3, LINHA_B),
        ]);
        const r = await rodar({ lote: loteBoleto(4), nativo, log });
        expect(r.err).toBeUndefined();

        const chamadas = [
            ...(log.info as jest.Mock).mock.calls,
            ...(log.warn as jest.Mock).mock.calls,
            ...(log.error as jest.Mock).mock.calls,
            ...r.ledger.fail.mock.calls,
            ...r.ledger.setRequestPayload.mock.calls,
            ...r.loteRepo.retirarItemPorCodigoDeBarras.mock.calls,
        ];
        const texto = JSON.stringify([chamadas, r.res]);
        for (const completo of [BARRAS_A, LINHA_A, LINHA_B, barras(2222)]) {
            for (let i = 0; i + 10 <= completo.length; i += 1) {
                expect(texto).not.toContain(completo.slice(i, i + 10));
            }
        }
        expect(texto).toContain(MASCARADO_A);

        const avisos = (log.warn as jest.Mock).mock.calls
            .map(([p]) => p)
            .filter((p) => String(p.message).includes('itens retirados do lote'));
        expect(avisos).toHaveLength(1);
        expect(avisos[0]).toMatchObject({
            type: 'BUSINESS_WARN',
            data: expect.objectContaining({
                loteId: 'L1',
                flpCod: 12,
                retirados: 2,
                pendentes: 0,
                motivos: ['CODIGO_BARRAS_REPETIDO'],
            }),
        });
        expect(avisos[0].data.mascarados).toHaveLength(2);
    });

    it('erro de limpeza incompleta também não vaza o código no ledger', async () => {
        const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)], { deleteIgnorado: ['1001'] });
        const r = await rodar({ lote: loteBoleto(2), nativo });
        const texto = JSON.stringify([r.ledger.fail.mock.calls, (r.err as Error).message]);
        for (let i = 0; i + 10 <= BARRAS_A.length; i += 1) {
            expect(texto).not.toContain(BARRAS_A.slice(i, i + 10));
        }
    });

    // ── Retomada (I16h) ─────────────────────────────────────────────────────

    describe('retomada e resíduos (I16h)', () => {
        const ledgerOrfao = (etapa: string) =>
            buildLedger({ status: 'reconciling', dryRun: false, nativeFlpCod: 99, etapa });
        const comNativoAberto = (n: ReturnType<typeof nativoFake>, titulos: number) => {
            n.write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 0,
                titulosCount: titulos,
                soma: 1412 * titulos,
            });
            return n;
        };
        /** Marca ATIVA + evento do sistema: o PAR que reconhece o resíduo (I16h(c)). */
        const par = (i: number) => ({
            bloqueios: buildBloqueios([
                {
                    filCod: 2,
                    docCod: doc(i),
                    titCod: '1',
                    origem: 'CODIGO_BARRAS_REPETIDO',
                    codigoMascarado: MASCARADO_A,
                    tituloMantido: { filCod: 2, docCod: '1000', titCod: '1' },
                },
            ]),
            eventos: buildEventos([chave(i)]),
        });

        it('(d) etapa finalizar direta (rascunho completo) ainda passa pela guarda e retira', async () => {
            const nativo = comNativoAberto(nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)]), 2);
            const r = await rodar({
                lote: loteBoleto(2),
                nativo,
                ledger: ledgerOrfao('finalizar'),
            });
            expect(r.err).toBeUndefined();
            expect(r.write.criarLote).not.toHaveBeenCalled();
            expect(r.write.importarTitulos).not.toHaveBeenCalled();
            expect(r.write.removerItemDoRascunho).toHaveBeenCalledTimes(1);
            expect(r.write.finalizarLote).toHaveBeenCalledWith(
                expect.objectContaining({ flpCod: 99 }),
            );
        });

        it('(e) resíduo + rascunho completo: limpa só o DELETE, sem reimportar nem mexer no local, e finaliza', async () => {
            // Lote local já sem o 1001 (retirado antes); o rascunho ainda o tem.
            const nativo = comNativoAberto(
                nativoFake([nat(0, distintos(0)), nat(1, LINHA_A)], { n: 1 }),
                2,
            );
            const r = await rodar({
                lote: loteBoleto(1),
                nativo,
                ledger: ledgerOrfao('finalizar'),
                ...par(1),
            });
            expect(r.err).toBeUndefined();
            expect(r.write.importarTitulos).not.toHaveBeenCalled();
            expect(r.write.criarLote).not.toHaveBeenCalled();
            expect(r.loteRepo.retirarItemPorCodigoDeBarras).not.toHaveBeenCalled();
            expect(r.write.removerItemDoRascunho).toHaveBeenCalledTimes(1);
            expect(r.write.removerItemDoRascunho.mock.calls[0][0]).toMatchObject({
                itsCodSeq: 11,
            });
            expect(r.write.finalizarLote).toHaveBeenCalledWith(
                expect.objectContaining({ flpCod: 99 }),
            );
            expect(nativo.estado().map((e) => e.docCod)).toEqual(['1000']);
            // O resíduo limpo aparece no resultado (com a máscara da marca).
            expect(r.res?.retiradosPorCodigoBarras).toEqual([
                expect.objectContaining({
                    titulo: { filCod: 2, docCod: '1001', titCod: '1' },
                    codigoMascarado: MASCARADO_A,
                }),
            ]);
        });

        it('(e) idempotente: reexecutar com o resíduo já ausente não faz DELETE nem evento', async () => {
            const nativo = comNativoAberto(nativoFake([nat(0, distintos(0))], { n: 1 }), 1);
            const r = await rodar({
                lote: loteBoleto(1),
                nativo,
                ledger: ledgerOrfao('finalizar'),
                ...par(1),
            });
            expect(r.err).toBeUndefined();
            expect(r.write.removerItemDoRascunho).not.toHaveBeenCalled();
            expect(r.loteRepo.retirarItemPorCodigoDeBarras).not.toHaveBeenCalled();
            expect(r.res).not.toHaveProperty('retiradosPorCodigoBarras');
        });

        it('(e) resíduo cujo DELETE falha: incompleta, ledger failed, sem finalizar', async () => {
            const nativo = comNativoAberto(
                nativoFake([nat(0, distintos(0)), nat(1, LINHA_A)], {
                    n: 1,
                    deleteFalha: ['1001'],
                }),
                2,
            );
            const r = await rodar({
                lote: loteBoleto(1),
                nativo,
                ledger: ledgerOrfao('finalizar'),
                ...par(1),
            });
            expect(r.err).toMatchObject({
                code: 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA',
                details: { modo: 'limpeza', pendentes: [{ docCod: '1001', titCod: '1' }] },
            });
            expect(r.write.finalizarLote).not.toHaveBeenCalled();
            expect(r.ledger.fail).toHaveBeenCalledTimes(1);
        });

        it('(a) item retirado nunca é reimportado: importação parcial manda só o que falta', async () => {
            // Local: 1000 e 1002. Rascunho: 1000 e o resíduo 1001. Falta o 1002.
            const lt = lote({ itens: [itensBoleto(1)[0], { ...itensBoleto(3)[2] }] });
            const nativo = comNativoAberto(
                nativoFake([nat(0, distintos(0)), nat(1, LINHA_A)], { n: 2 }),
                2,
            );
            nativo.write.listarTitulosPendentes.mockResolvedValue([
                { ...pendente({ docCod: 1002 }, true), docCod: '1002' },
            ]);
            // Depois do import o 1002 está lá, com código distinto.
            nativo.write.importarTitulos.mockImplementation(async () => {
                nativo.adicionar(nat(2, distintos(2)));
            });
            const r = await rodar({
                lote: lt,
                nativo,
                ledger: ledgerOrfao('importar'),
                ...par(1),
            });
            expect(r.err).toBeUndefined();
            const pedidas = nativo.write.listarTitulosPendentes.mock.calls[0][0]
                .chavesDesejadas as Set<string>;
            expect([...pedidas]).toEqual([chave(2)]);
            expect(nativo.write.importarTitulos).toHaveBeenCalledTimes(1);
            // O resíduo 1001 foi limpo; o 1002 entrou e o lote finaliza.
            expect(
                nativo
                    .estado()
                    .map((e) => e.docCod)
                    .sort(),
            ).toEqual(['1000', '1002']);
            expect(r.write.finalizarLote).toHaveBeenCalled();
        });

        it('(b) estranho no rascunho ⇒ indeterminado MESMO com resíduos; nada é deletado', async () => {
            const nativo = comNativoAberto(
                nativoFake([nat(0, distintos(0)), nat(1, LINHA_A), nat(9, distintos(9))], { n: 1 }),
                3,
            );
            const r = await rodar({
                lote: loteBoleto(1),
                nativo,
                ledger: ledgerOrfao('finalizar'),
                ...par(1),
            });
            expect(r.err).toMatchObject({ name: 'RemessaEmDuvidaError' });
            expect(r.write.removerItemDoRascunho).not.toHaveBeenCalled();
            expect(r.write.finalizarLote).not.toHaveBeenCalled();
            expect(r.loteRepo.retirarItemPorCodigoDeBarras).not.toHaveBeenCalled();
        });

        it.each([
            [
                'só a marca, sem evento neste lote',
                (i: number) => ({ ...par(i), eventos: buildEventos([]) }),
            ],
            [
                'só o evento, sem marca ATIVA',
                (i: number) => ({ ...par(i), bloqueios: buildBloqueios([]) }),
            ],
            [
                'retirada por duplicidade de título / I13j (nem marca de código, nem evento de código)',
                () => ({ bloqueios: buildBloqueios([]), eventos: buildEventos([]) }),
            ],
        ])('(c) %s: segue intruso (indeterminado)', async (_nome, fabrica) => {
            const nativo = comNativoAberto(
                nativoFake([nat(0, distintos(0)), nat(1, LINHA_A)], { n: 1 }),
                2,
            );
            const r = await rodar({
                lote: loteBoleto(1),
                nativo,
                ledger: ledgerOrfao('finalizar'),
                ...fabrica(1),
            });
            expect(r.err).toMatchObject({ name: 'RemessaEmDuvidaError' });
            expect(r.write.removerItemDoRascunho).not.toHaveBeenCalled();
        });

        it('lote nativo já finalizado com repetido: não mexe no local e manda cancelar o nativo', async () => {
            const nativo = nativoFake([nat(0, LINHA_A), nat(1, LINHA_A)]);
            nativo.write.getLoteNativo.mockResolvedValue({
                filCod: 2,
                bncCod: 4,
                flpCod: 99,
                status: 1,
                titulosCount: 2,
                soma: 2824,
            });
            const r = await rodar({
                lote: loteBoleto(2),
                nativo,
                ledger: buildLedger({
                    status: 'reconciling',
                    dryRun: false,
                    nativeFlpCod: 99,
                    etapa: 'gerar_remessa',
                    requestPayload: { nomeArquivo: 'PG999.REM' },
                }),
            });
            expect(r.err).toMatchObject({
                code: 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA',
                details: { modo: 'finalizado' },
            });
            expect(r.loteRepo.retirarItemPorCodigoDeBarras).not.toHaveBeenCalled();
            expect(r.write.removerItemDoRascunho).not.toHaveBeenCalled();
            expect(r.write.sugerirRemessa).not.toHaveBeenCalled();
        });
    });
});

describe('RemessaService.baixarArquivo', () => {
    const comRemessa = (over: Partial<LotePagamento> = {}) =>
        lote({
            status: 'REMESSA_GERADA',
            nativeFilCod: 2,
            nativeBncCod: 4,
            nativeFlpCod: 12,
            nativeGabCod: 52,
            remessaArquivo: 'PG210801.REM',
            remessaNum: 12,
            ...over,
        });
    const CNAB_DOWNLOAD = '34100000         2PG210801 HEADER VIA DOWNLOAD';
    const writeComDownload = (conteudo = CNAB_DOWNLOAD) => ({
        ...buildWrite(),
        baixarRemessa: jest.fn().mockResolvedValue(conteudo),
    });
    const fazer = (write: ReturnType<typeof writeComDownload>, l: LotePagamento | null) => {
        const loteRepo = buildLoteRepo();
        loteRepo.getLoteComItens.mockResolvedValue(l);
        return make({ write, loteRepo });
    };

    it('casa pelo nome registrado, nunca pelo primeiro da grade', async () => {
        const write = writeComDownload();
        const res = await fazer(write, comRemessa()).baixarArquivo('L1');
        expect(res).toEqual({ nomeArquivo: 'PG210801.REM', conteudo: 'CNAB DO LOTE' });
        expect(write.listarArquivosRemessa).toHaveBeenCalledWith({
            filCod: 2,
            bncCod: 4,
            flpCod: 12,
        });
        expect(write.baixarRemessa).not.toHaveBeenCalled();
    });

    it('nome fora da grade (página única de 20): baixa pelo gabCod REGISTRADO no lote', async () => {
        const write = writeComDownload();
        write.listarArquivosRemessa.mockResolvedValue([
            { gabCod: 16, nomeArquivo: 'PG191101.REM', conteudo: 'ARQUIVO ANTIGO' },
        ]);
        const res = await fazer(write, comRemessa()).baixarArquivo('L1');
        expect(write.baixarRemessa).toHaveBeenCalledWith({ filCod: 2, gabCod: 52 });
        expect(res).toEqual({ nomeArquivo: 'PG210801.REM', conteudo: CNAB_DOWNLOAD });
    });

    it('grade com o nome mas sem conteúdo: também cai no download por gabCod', async () => {
        const write = writeComDownload();
        write.listarArquivosRemessa.mockResolvedValue([
            { gabCod: 52, nomeArquivo: 'PG210801.REM' },
        ]);
        const res = await fazer(write, comRemessa()).baixarArquivo('L1');
        expect(write.baixarRemessa).toHaveBeenCalledWith({ filCod: 2, gabCod: 52 });
        expect(res?.conteudo).toBe(CNAB_DOWNLOAD);
    });

    it('lote sem remessa (ou inexistente) devolve null sem ir ao Conexos', async () => {
        const write = writeComDownload();
        expect(await fazer(write, lote()).baixarArquivo('L1')).toBeNull();
        expect(await fazer(write, null).baixarArquivo('L1')).toBeNull();
        expect(write.listarArquivosRemessa).not.toHaveBeenCalled();
    });

    it('arquivo não achado no Conexos: erro claro em português, não "sem remessa"', async () => {
        const write = writeComDownload('');
        write.listarArquivosRemessa.mockResolvedValue([]);
        await expect(fazer(write, comRemessa()).baixarArquivo('L1')).rejects.toMatchObject({
            code: 'REMESSA_ARQUIVO_INDISPONIVEL',
            statusCode: 404,
            userMessage: expect.stringContaining('PG210801.REM'),
        });
    });

    it('download que não é CNAB (JSON de erro com 200 → "[object Object]") não vira .REM', async () => {
        const write = writeComDownload('[object Object]');
        write.listarArquivosRemessa.mockResolvedValue([]);
        await expect(fazer(write, comRemessa()).baixarArquivo('L1')).rejects.toMatchObject({
            code: 'REMESSA_ARQUIVO_INDISPONIVEL',
        });
    });

    it('sem gabCod registrado e fora da grade: erro claro, sem tentar outro arquivo', async () => {
        const write = writeComDownload();
        write.listarArquivosRemessa.mockResolvedValue([
            { gabCod: 16, nomeArquivo: 'PG191101.REM', conteudo: 'ARQUIVO ANTIGO' },
        ]);
        await expect(
            fazer(write, comRemessa({ nativeGabCod: undefined })).baixarArquivo('L1'),
        ).rejects.toMatchObject({ code: 'REMESSA_ARQUIVO_INDISPONIVEL' });
        expect(write.baixarRemessa).not.toHaveBeenCalled();
    });
});
