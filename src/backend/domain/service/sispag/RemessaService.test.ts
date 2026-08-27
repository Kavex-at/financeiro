import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import RemessaEmDuvidaError from '../../errors/RemessaEmDuvidaError.js';
import type { LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type RemessaExecucaoRepository from '../../repository/sispag/RemessaExecucaoRepository.js';
import type LogService from '../LogService.js';
import RemessaService from './RemessaService.js';

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
            modalidade: 'CREDITO_CONTA',
            incluidoPor: 'u1',
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
                modalidade: 'CREDITO_CONTA',
                incluidoPor: 'u1',
            },
        ],
    });

/** Linha do grid de pendentes — a identidade tem que voltar VERBATIM para o import. */
const pendente = (over: Record<string, unknown> = {}, temBoletoDda = false) => ({
    docCod: '801',
    titCod: '1',
    temBoletoDda,
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
            conexosDryRun: false,
            ...over,
        }),
    }) as unknown as EnvironmentProvider;

const buildLoteRepo = (l: LotePagamento = lote()) => ({
    getLoteComItens: jest.fn().mockResolvedValue(l),
    setChavesNativas: jest.fn().mockResolvedValue(undefined),
    setRemessaGerada: jest.fn().mockResolvedValue(undefined),
    transicionarStatus: jest.fn().mockResolvedValue(1),
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
    listarArquivosRemessa: jest.fn().mockResolvedValue([
        // Arquivo ÓRFÃO de um lote antigo que reusou o mesmo flpCod — vem primeiro de propósito.
        { gabCod: 16, nomeArquivo: 'PG191101.REM', conteudo: 'ARQUIVO ANTIGO' },
        { gabCod: 52, nomeArquivo: 'PG210801.REM', conteudo: 'CNAB DO LOTE' },
    ]),
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
});

const make = (o: {
    loteRepo?: ReturnType<typeof buildLoteRepo>;
    ledger?: ReturnType<typeof buildLedger>;
    write?: ReturnType<typeof buildWrite>;
    sispag?: ReturnType<typeof buildSispag>;
    env?: EnvironmentProvider;
    lote?: LotePagamento;
    db?: ReturnType<typeof buildDb>;
}) =>
    new RemessaService(
        (o.loteRepo ?? buildLoteRepo(o.lote)) as unknown as LotePagamentoRepository,
        (o.ledger ?? buildLedger()) as unknown as RemessaExecucaoRepository,
        (o.write ?? buildWrite()) as unknown as ConexosSispagWriteClient,
        (o.sispag ?? buildSispag()) as unknown as ConexosSispagClient,
        o.env ?? buildEnv(),
        buildLog(),
        (o.db ?? buildDb()) as unknown as PostgreeDatabaseClient,
    );

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
            await make({ sispag, write }).gerarRemessa({ loteId: 'L1', ator: 'u' });
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
        ).rejects.toMatchObject({ code: 'BOLETO_SEM_CODIGO_BARRAS' });

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
                    modalidade: 'BOLETO' as const,
                    incluidoPor: 'u1',
                },
            ],
        });
        const write = buildWrite();
        write.listarTitulosPendentes.mockResolvedValue([
            pendente(),
            { ...pendente({ docCod: 802 }, true), docCod: '802' },
        ]);

        await make({ write, lote: l }).gerarRemessa({ loteId: 'L1', ator: 'u' });

        const flags = write.importarTitulos.mock.calls.map(([p]) => p.associarDda);
        expect(flags).toEqual([false, true]);
        for (const [p] of write.importarTitulos.mock.calls) expect(p.itens).toHaveLength(1);
    });
});
