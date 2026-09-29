import 'reflect-metadata';
import type ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import type { ArquivoRetornoDetalhe } from '../../interface/sispag/Fin052Retorno.js';
import type { LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type ConciliacaoExecucaoRepository from '../../repository/sispag/ConciliacaoExecucaoRepository.js';
import type LogService from '../LogService.js';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosTitulosClient from '../../client/ConexosTitulosClient.js';
import type NotificacaoService from '../operacao/NotificacaoService.js';
import ConciliacaoRetornoService from './ConciliacaoRetornoService.js';
import DecisaoStatusLote from './DecisaoStatusLote.js';
import SincronizacaoLoteService from './SincronizacaoLoteService.js';

const CHAVE = { filCod: 2, bncCod: 4, gtbCodSeq: 1, garCodSeq: 5 };

/** Códigos do Itaú: `00` é o único com `tipoRetorno: 1` (pago); o resto rejeita. */
const EVENTOS = [
    { cod: '00', descricao: 'PAGAMENTO EFETUADO', tipo: 2, tipoRetorno: 1 },
    {
        cod: 'NA',
        descricao: 'PAGAMENTO CANCELADO POR FALTA DE AUTORIZAÇÃO',
        tipo: 2,
        tipoRetorno: 2,
    },
];

const detalhe = (over: Partial<ArquivoRetornoDetalhe> = {}): ArquivoRetornoDetalhe => ({
    filCod: 2,
    bncCod: 4,
    gtbCodSeq: 1,
    garCodSeq: 5,
    flpCod: 13,
    itsCodSeq: 1,
    docCod: '813',
    titCod: '1',
    eventoCod: '00',
    eventoDescricao: 'PAGAMENTO EFETUADO',
    borCod: 249,
    bxaCodSeq: 1,
    gerNum: 38,
    valorPago: 258.4,
    ...over,
});

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 2,
    status: 'REMESSA_GERADA',
    criadoPor: 'u1',
    versao: 4,
    itens: [
        {
            loteId: 'L1',
            filCod: 2,
            docCod: '813',
            titCod: '1',
            incluidoPor: 'u1',
            divergencia: false,
            bxaCodSeq: 1,
        },
    ],
    ...over,
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

/** O detalhe é consultado CÓDIGO A CÓDIGO — o ERP exige `fbeEspCod` exato. */
const buildRetorno = (
    porCodigo: Record<string, ArquivoRetornoDetalhe[]> = { '00': [detalhe()] },
) => ({
    processarArquivoRetorno: jest.fn().mockResolvedValue(undefined),
    // Estado do arquivo no ERP: por default existe e NÃO foi processado.
    getArquivoRetorno: jest.fn().mockResolvedValue({ ...CHAVE, processadoEm: undefined }),
    listEventosBancarios: jest.fn().mockResolvedValue(EVENTOS),
    listDetalhe: jest.fn(async (p: { eventoCod: string }) => porCodigo[p.eventoCod] ?? []),
});

/** O fechamento é do `SincronizacaoLoteService` (ADR-0055): aqui só se prova a delegação. */
const buildSinc = () => ({
    aplicarEventosRetorno: jest.fn().mockResolvedValue(null),
});

const buildLedger = (anterior: Record<string, unknown> | null = null) => ({
    findByIdempotencyKey: jest.fn().mockResolvedValue(anterior),
    beginExecution: jest.fn().mockResolvedValue({ status: 'reconciling', alreadySettled: false }),
    marcarProcessado: jest.fn().mockResolvedValue(undefined),
    settle: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
});

const buildRepo = (l: LotePagamento | null = lote()) => ({
    findByChaveNativa: jest.fn().mockResolvedValue(l ? l.id : null),
    getLoteComItens: jest.fn().mockResolvedValue(l),
});

const make = (o: {
    retorno?: ReturnType<typeof buildRetorno>;
    repo?: ReturnType<typeof buildRepo>;
    env?: EnvironmentProvider;
    ledger?: ReturnType<typeof buildLedger>;
    sinc?: ReturnType<typeof buildSinc> | SincronizacaoLoteService;
}) =>
    new ConciliacaoRetornoService(
        (o.retorno ?? buildRetorno()) as unknown as ConexosSispagRetornoClient,
        (o.repo ?? buildRepo()) as unknown as LotePagamentoRepository,
        o.env ?? buildEnv(),
        buildLog(),
        new BoundedConcurrency(),
        (o.ledger ?? buildLedger()) as unknown as ConciliacaoExecucaoRepository,
        (o.sinc ?? buildSinc()) as unknown as SincronizacaoLoteService,
    );

/** Eventos que chegaram ao fechamento de um lote, por item. */
const eventosEnviados = (sinc: ReturnType<typeof buildSinc>, loteId: string) =>
    sinc.aplicarEventosRetorno.mock.calls.find((c) => c[0] === loteId)?.[1] as
        | Map<string, Array<{ eventoCod: string; rejeitado: boolean }>>
        | undefined;

describe('ConciliacaoRetornoService', () => {
    describe('leitura do detalhe', () => {
        it('consulta código a código — o ERP não aceita filtro abrangente', async () => {
            const retorno = buildRetorno();
            await make({ retorno }).conciliar({ ...CHAVE, ator: 'u' });
            expect(retorno.listDetalhe).toHaveBeenCalledTimes(EVENTOS.length);
            expect(retorno.listDetalhe).toHaveBeenCalledWith(
                expect.objectContaining({ eventoCod: '00', eventoTipo: 2 }),
            );
        });

        it('um código AUSENTE do arquivo devolve lista vazia — e não é falha', async () => {
            // `NA` não está no arquivo: o ERP responde `rows: []`, sem exceção.
            const retorno = buildRetorno({ '00': [detalhe()] });
            const res = await make({ retorno }).conciliar({ ...CHAVE, ator: 'u' });
            expect(res.totalLinhas).toBe(1);
            expect(res.varreduraIncompleta).toBe(false);
        });

        it('uma FALHA de leitura não derruba a varredura, mas marca como incompleta', async () => {
            // O `catch {}` anterior chamava isso de "código não presente" e seguia calado.
            const retorno = buildRetorno();
            retorno.listDetalhe.mockImplementation(async (p: { eventoCod: string }) => {
                if (p.eventoCod === 'NA') throw new Error('socket hang up');
                return [detalhe()];
            });
            const res = await make({ retorno }).conciliar({ ...CHAVE, ator: 'u' });
            expect(res.totalLinhas).toBe(1);
            expect(res.varreduraIncompleta).toBe(true);
            expect(res.eventosNaoLidos).toEqual([{ evento: 'NA', motivo: 'socket hang up' }]);
        });

        it('varredura incompleta entrega o que FOI lido ao fechamento — o título decide (I11b/I11c)', async () => {
            // Desde a ADR-0055 a prova de pagamento é o fin064. O código de rejeição que falhou
            // não vira rejeição (nada não lido decide), e o ledger fica aberto para a 2ª passada.
            const sinc = buildSinc();
            const retorno = buildRetorno();
            retorno.listDetalhe.mockImplementation(async (p: { eventoCod: string }) => {
                if (p.eventoCod === 'NA') throw new Error('ETIMEDOUT');
                return [detalhe()];
            });
            await make({ retorno, sinc }).conciliar({ ...CHAVE, ator: 'u' });
            const eventos = eventosEnviados(sinc, 'L1');
            expect(eventos?.get('813:1')).toEqual([
                expect.objectContaining({ eventoCod: '00', rejeitado: false }),
            ]);
        });

        it('o fechamento é DELEGADO ao mesmo de L11 (DecisaoStatusLote via sincronização)', async () => {
            const sinc = buildSinc();
            await make({ sinc }).conciliar({ ...CHAVE, ator: 'u' });
            expect(sinc.aplicarEventosRetorno).toHaveBeenCalledTimes(1);
            expect(eventosEnviados(sinc, 'L1')?.get('813:1')).toEqual([
                {
                    eventoCod: '00',
                    descricao: 'PAGAMENTO EFETUADO',
                    rejeitado: false,
                    borCod: 249,
                    bxaCodSeq: 1,
                },
            ]);
        });
    });

    describe('classificação pago × rejeitado', () => {
        it('`00` (tipoRetorno 1) conta como pago', async () => {
            const res = await make({}).conciliar({ ...CHAVE, ator: 'u' });
            expect(res.pagos).toBe(1);
            expect(res.rejeitados).toBe(0);
            expect(res.itens[0]).toMatchObject({ rejeitado: false, borCod: 249, bxaCodSeq: 1 });
        });

        it('`NA` (tipoRetorno 2) conta como rejeitado', async () => {
            const retorno = buildRetorno({
                NA: [detalhe({ eventoCod: 'NA', borCod: undefined, bxaCodSeq: undefined })],
            });
            const res = await make({ retorno }).conciliar({ ...CHAVE, ator: 'u' });
            expect(res.rejeitados).toBe(1);
            expect(res.pagos).toBe(0);
        });
    });

    describe('casamento com o lote local', () => {
        it('REGRESSÃO (ADR-0055): .RET com duas filiais casa cada linha pelo filCod DA LINHA', async () => {
            // gar 9 (PG230901.REM): fil 1/flp 8 e fil 2/flp 24 no MESMO arquivo.
            const repo = buildRepo();
            const retorno = buildRetorno({
                '00': [
                    detalhe({ filCod: 1, flpCod: 8, docCod: '4030', titCod: '7' }),
                    detalhe({ filCod: 2, flpCod: 24, docCod: '38682', titCod: '1' }),
                ],
            });
            await make({ repo, retorno }).conciliar({ ...CHAVE, filCod: 1, ator: 'u' });
            expect(repo.findByChaveNativa).toHaveBeenCalledWith({
                nativeFilCod: 1,
                nativeBncCod: 4,
                nativeFlpCod: 8,
            });
            expect(repo.findByChaveNativa).toHaveBeenCalledWith({
                nativeFilCod: 2,
                nativeBncCod: 4,
                nativeFlpCod: 24,
            });
        });

        it('casa pela chave nativa (filial, banco e flp DA LINHA) e entrega ao fechamento', async () => {
            const repo = buildRepo();
            const sinc = buildSinc();
            await make({ repo, sinc }).conciliar({ ...CHAVE, ator: 'u' });
            expect(repo.findByChaveNativa).toHaveBeenCalledWith({
                nativeFilCod: 2,
                nativeBncCod: 4,
                nativeFlpCod: 13,
            });
            expect(sinc.aplicarEventosRetorno).toHaveBeenCalledWith('L1', expect.any(Map));
        });

        it('linha de lote que não é nosso é reportada, não gravada', async () => {
            const repo = buildRepo(null);
            const sinc = buildSinc();
            const res = await make({ repo, sinc }).conciliar({ ...CHAVE, ator: 'u' });
            expect(res.naoReconhecidos).toBe(1);
            expect(res.itens[0].reconhecido).toBe(false);
            expect(sinc.aplicarEventosRetorno).not.toHaveBeenCalled();
        });
    });

    describe('precedência por item (I11d) — com o fechamento de verdade', () => {
        /** `SincronizacaoLoteService` real, com os clients mockados: fin064 diz "em aberto". */
        const sincReal = (l: LotePagamento) => {
            const loteRepo = {
                getLoteComItens: jest.fn().mockResolvedValue(l),
                aplicarSincronizacao: jest.fn().mockResolvedValue('APLICADO'),
                tocarSincronizacao: jest.fn().mockResolvedValue(undefined),
            };
            const sinc = new SincronizacaoLoteService(
                loteRepo as unknown as LotePagamentoRepository,
                {
                    lerSituacaoTitulo: jest
                        .fn()
                        .mockResolvedValue({ legivel: true, vldPago: false, aberto: 258.4 }),
                } as unknown as ConexosSispagClient,
                { lerBaixasTitulo: jest.fn() } as unknown as ConexosTitulosClient,
                {} as unknown as ConexosSispagRetornoClient,
                new DecisaoStatusLote(),
                { emitir: jest.fn().mockResolvedValue(null) } as unknown as NotificacaoService,
                buildLog(),
                new BoundedConcurrency(),
            );
            return { sinc, loteRepo };
        };

        it.each([
            ['REJEITADO lido por último', ['00', 'NA']],
            ['REJEITADO lido primeiro', ['NA', '00']],
        ])('REJEITADO e 00 no mesmo item → REJEITADO, não last-write-wins (%s)', async (_n, ordem) => {
            const l = lote({ nativeFilCod: 2, nativeBncCod: 4, nativeFlpCod: 13 });
            const { sinc, loteRepo } = sincReal(l);
            const retorno = buildRetorno();
            retorno.listEventosBancarios.mockResolvedValue(
                ordem.map((cod) => EVENTOS.find((e) => e.cod === cod)),
            );
            retorno.listDetalhe.mockImplementation(async (p: { eventoCod: string }) => [
                detalhe({ eventoCod: p.eventoCod, borCod: undefined, bxaCodSeq: undefined }),
            ]);
            await make({ retorno, repo: buildRepo(l), sinc }).conciliar({ ...CHAVE, ator: 'u' });
            const aplicado = loteRepo.aplicarSincronizacao.mock.calls[0]?.[0];
            expect(aplicado.itens[0]).toEqual(
                expect.objectContaining({
                    situacao: 'REJEITADO',
                    retornoEvento: 'NA',
                    rejeitado: true,
                }),
            );
            expect(aplicado.para).toBe('RETORNADO');
        });
    });

    describe('gating', () => {
        it('dry-run do ERP não chama `processar`, mas grava o que OBSERVOU (I11g)', async () => {
            const retorno = buildRetorno();
            const sinc = buildSinc();
            const res = await make({
                retorno,
                sinc,
                env: buildEnv({ conexosDryRun: true }),
            }).conciliar({ ...CHAVE, ator: 'u', processar: true });

            expect(res.dryRun).toBe(true);
            expect(res.processado).toBe(false);
            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
            expect(sinc.aplicarEventosRetorno).toHaveBeenCalledTimes(1);
            expect(res.totalLinhas).toBe(1);
        });

        it('kill-switches todos desligados: processar bloqueado, gravação local acontece', async () => {
            const retorno = buildRetorno();
            const sinc = buildSinc();
            await make({
                retorno,
                sinc,
                env: buildEnv({
                    conexosWriteEnabled: false,
                    sispagLiveWriteEnabled: false,
                    conexosDryRun: true,
                }),
            }).conciliar({ ...CHAVE, ator: 'u', processar: true });
            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
            expect(sinc.aplicarEventosRetorno).toHaveBeenCalledTimes(1);
        });

        it('simulação explícita (`dryRun` do corpo) não grava nada', async () => {
            const sinc = buildSinc();
            const res = await make({ sinc }).conciliar({
                ...CHAVE,
                ator: 'u',
                dryRunOverride: true,
            });
            expect(res.dryRun).toBe(true);
            expect(sinc.aplicarEventosRetorno).not.toHaveBeenCalled();
        });

        it('`processar` só é chamado quando pedido explicitamente', async () => {
            const retorno = buildRetorno();
            await make({ retorno }).conciliar({ ...CHAVE, ator: 'u' });
            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();

            await make({ retorno }).conciliar({ ...CHAVE, ator: 'u', processar: true });
            expect(retorno.processarArquivoRetorno).toHaveBeenCalledWith(CHAVE);
        });
    });
    describe('kill-switch da frente (fault-tolerance-7)', () => {
        it('SISPAG_LIVE_WRITE_ENABLED=false força dry-run sem tocar Permutas/Recebimentos', async () => {
            // O `conexosDryRun` global segue true aqui: conter o SISPAG não pode exigir
            // desligar as outras frentes.
            const retorno = buildRetorno();
            const res = await make({
                retorno,
                env: buildEnv({ sispagLiveWriteEnabled: false }),
            }).conciliar({ ...CHAVE, ator: 'u', processar: true });

            expect(res.dryRun).toBe(true);
            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
        });
    });

    describe('ledger write-ahead (availability-1 / fault-tolerance-1)', () => {
        it('grava a intenção ANTES do `processar` irreversível', async () => {
            const ledger = buildLedger();
            const retorno = buildRetorno();
            await make({ ledger, retorno }).conciliar({ ...CHAVE, ator: 'u', processar: true });

            expect(ledger.beginExecution).toHaveBeenCalledWith(
                expect.objectContaining({
                    idempotencyKey: 'conciliacao:2:4:1:5',
                    filCod: 2,
                    garCodSeq: 5,
                    dryRun: false,
                }),
            );
            // `marcarProcessado` antes do PUT: morrer no meio deixa trilha.
            const ordemMarcar = ledger.marcarProcessado.mock.invocationCallOrder[0] ?? 0;
            const ordemPut = retorno.processarArquivoRetorno.mock.invocationCallOrder[0] ?? 0;
            expect(ordemMarcar).toBeLessThan(ordemPut);
        });

        it('curto-circuita quando o arquivo JÁ foi conciliado — não re-processa', async () => {
            // Dois cliques na tela. O segundo não pode gerar baixa em cima de baixa.
            const ledger = buildLedger({
                status: 'settled',
                dryRun: false,
                processou: true,
                totalLinhas: 3,
                pagos: 3,
                rejeitados: 0,
                varreduraIncompleta: false,
            });
            const retorno = buildRetorno();
            const res = await make({ ledger, retorno }).conciliar({
                ...CHAVE,
                ator: 'u',
                processar: true,
            });

            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
            expect(ledger.beginExecution).not.toHaveBeenCalled();
            expect(res.jaConciliado).toBe(true);
            expect(res.pagos).toBe(3);
        });

        it('`reconciling` órfão NUNCA re-processa às cegas — consulta o ERP antes', async () => {
            // A regra que não muda: o `processar` não é repetido por suposição. O que mudou
            // é que "não sei" virou uma pergunta ao ERP em vez de um beco sem saída.
            // Os três desfechos estão em 'retomada da conciliação'.
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                processou: true,
                varreduraIncompleta: false,
                criadoEm: '2026-08-24T12:00:00.000Z',
            });
            const retorno = buildRetorno();
            retorno.getArquivoRetorno.mockResolvedValue({ ...CHAVE, processadoEm: 1787000000000 });

            await make({ ledger, retorno }).conciliar({ ...CHAVE, ator: 'u', processar: true });

            expect(retorno.getArquivoRetorno).toHaveBeenCalled();
            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
        });

        it('conciliação bem-sucedida fecha o ledger em settled', async () => {
            const ledger = buildLedger();
            await make({ ledger }).conciliar({ ...CHAVE, ator: 'u' });

            expect(ledger.settle).toHaveBeenCalledWith(
                'conciliacao:2:4:1:5',
                expect.objectContaining({ totalLinhas: 1, pagos: 1, varreduraIncompleta: false }),
            );
            expect(ledger.fail).not.toHaveBeenCalled();
        });

        it('varredura incompleta NÃO fecha o ledger — a segunda passada tem que ser possível', async () => {
            const ledger = buildLedger();
            const retorno = buildRetorno();
            retorno.listDetalhe.mockImplementation(async (p: { eventoCod: string }) => {
                if (p.eventoCod === 'NA') throw new Error('ETIMEDOUT');
                return [detalhe()];
            });
            await make({ ledger, retorno }).conciliar({ ...CHAVE, ator: 'u' });

            expect(ledger.settle).not.toHaveBeenCalled();
            expect(ledger.fail).toHaveBeenCalledWith(
                'conciliacao:2:4:1:5',
                expect.stringContaining('NA'),
            );
        });
    });

    describe('fechamento por lote (fault-tolerance-4)', () => {
        it('falha ao fechar um lote propaga e o ledger não fecha em settled', async () => {
            // Itens + transição de CADA lote são uma transação no repositório (I6); uma queda aqui
            // não deixa lote meio gravado, e o arquivo continua reconciliável.
            const sinc = buildSinc();
            const ledger = buildLedger();
            sinc.aplicarEventosRetorno.mockRejectedValue(new Error('conexão caiu'));
            await expect(make({ sinc, ledger }).conciliar({ ...CHAVE, ator: 'u' })).rejects.toThrow(
                'conexão caiu',
            );
            expect(ledger.settle).not.toHaveBeenCalled();
        });
    });

    describe('retomada da conciliação (perguntar ao ERP)', () => {
        const orfao = () =>
            buildLedger({
                status: 'reconciling',
                dryRun: false,
                processou: true,
                varreduraIncompleta: false,
                criadoEm: '2026-08-25T12:00:00.000Z',
            });

        it('ERP já processou → NÃO chama `processar` de novo, segue da leitura', async () => {
            // O ERP carimba `processadoEm`. Repetir o PUT geraria baixa em cima de baixa.
            const retorno = buildRetorno();
            retorno.getArquivoRetorno.mockResolvedValue({ ...CHAVE, processadoEm: 1787000000000 });

            const res = await make({ ledger: orfao(), retorno }).conciliar({
                ...CHAVE,
                ator: 'u',
                processar: true,
            });

            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
            expect(res.processado).toBe(true);
            expect(res.totalLinhas).toBe(1);
        });

        it('ERP NÃO processou → refaz com segurança (não há baixa para duplicar)', async () => {
            const retorno = buildRetorno();
            retorno.getArquivoRetorno.mockResolvedValue({ ...CHAVE, processadoEm: undefined });

            await make({ ledger: orfao(), retorno }).conciliar({
                ...CHAVE,
                ator: 'u',
                processar: true,
            });

            expect(retorno.processarArquivoRetorno).toHaveBeenCalled();
        });

        it('estado do arquivo INDETERMINADO continua fail-closed', async () => {
            const retorno = buildRetorno();
            retorno.getArquivoRetorno.mockResolvedValue(undefined);

            await expect(
                make({ ledger: orfao(), retorno }).conciliar({
                    ...CHAVE,
                    ator: 'u',
                    processar: true,
                }),
            ).rejects.toMatchObject({ code: 'CONCILIACAO_EM_DUVIDA' });
            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
        });
    });

    describe('arquivo já processado no ERP — vale SEMPRE, não só na retomada', () => {
        it('conciliação NOVA sobre arquivo já processado NÃO chama `processar`', async () => {
            // Achado pelo gate ao vivo: com o ledger limpo, a checagem de `processadoEm`
            // não rodava e o `processar` era chamado de novo. O ERP recusou com
            // "O VALOR BAIXADO NÃO PODE SER ZERO" — quem protegeu foi ele, não nós.
            const retorno = buildRetorno();
            retorno.getArquivoRetorno.mockResolvedValue({ ...CHAVE, processadoEm: 1787000000000 });

            const res = await make({ retorno }).conciliar({
                ...CHAVE,
                ator: 'u',
                processar: true,
            });

            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
            expect(res.processado).toBe(true);
        });

        it('arquivo NÃO processado segue chamando `processar` normalmente', async () => {
            const retorno = buildRetorno();
            retorno.getArquivoRetorno.mockResolvedValue({ ...CHAVE, processadoEm: undefined });

            await make({ retorno }).conciliar({ ...CHAVE, ator: 'u', processar: true });

            expect(retorno.processarArquivoRetorno).toHaveBeenCalledTimes(1);
        });

        it('dry-run não consulta o estado do arquivo — não há o que proteger', async () => {
            const retorno = buildRetorno();

            await make({ retorno, env: buildEnv({ conexosDryRun: true }) }).conciliar({
                ...CHAVE,
                ator: 'u',
                processar: true,
            });

            expect(retorno.getArquivoRetorno).not.toHaveBeenCalled();
            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
        });
    });
});
