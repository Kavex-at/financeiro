import 'reflect-metadata';
import type ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import type { ArquivoRetornoDetalhe } from '../../interface/sispag/Fin052Retorno.js';
import type { LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type ConciliacaoExecucaoRepository from '../../repository/sispag/ConciliacaoExecucaoRepository.js';
import type LogService from '../LogService.js';
import ConciliacaoRetornoService from './ConciliacaoRetornoService.js';

const CHAVE = { filCod: 2, bncCod: 4, gtbCodSeq: 1, garCodSeq: 5 };

/** Códigos do Itaú: `00` é o único com `tipoRetorno: 1` (pago); o resto rejeita. */
const EVENTOS = [
    { cod: '00', descricao: 'PAGAMENTO EFETUADO', tipo: 2, tipoRetorno: 1 },
    { cod: 'NA', descricao: 'PAGAMENTO CANCELADO POR FALTA DE AUTORIZAÇÃO', tipo: 2, tipoRetorno: 2 },
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
const buildRetorno = (porCodigo: Record<string, ArquivoRetornoDetalhe[]> = { '00': [detalhe()] }) => ({
    processarArquivoRetorno: jest.fn().mockResolvedValue(undefined),
    listEventosBancarios: jest.fn().mockResolvedValue(EVENTOS),
    listDetalhe: jest.fn(async (p: { eventoCod: string }) => porCodigo[p.eventoCod] ?? []),
});

/**
 * `withTransaction` que apenas executa o callback com um `tx` sentinela — o objetivo dos
 * testes aqui é provar que o `tx` CHEGA nos repositórios, não reimplementar Postgres.
 */
const TX = { marcador: 'tx' };
const buildDb = () => ({
    withTransaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
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
    registrarConciliacaoItem: jest.fn().mockResolvedValue(undefined),
    getLoteComItens: jest.fn().mockResolvedValue(l),
    transicionarStatus: jest.fn().mockResolvedValue(1),
});

const make = (o: {
    retorno?: ReturnType<typeof buildRetorno>;
    repo?: ReturnType<typeof buildRepo>;
    env?: EnvironmentProvider;
    ledger?: ReturnType<typeof buildLedger>;
    db?: ReturnType<typeof buildDb>;
}) =>
    new ConciliacaoRetornoService(
        (o.retorno ?? buildRetorno()) as unknown as ConexosSispagRetornoClient,
        (o.repo ?? buildRepo()) as unknown as LotePagamentoRepository,
        o.env ?? buildEnv(),
        buildLog(),
        new BoundedConcurrency(),
        (o.ledger ?? buildLedger()) as unknown as ConciliacaoExecucaoRepository,
        (o.db ?? buildDb()) as unknown as PostgreeDatabaseClient,
    );

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
            expect(res.eventosNaoLidos).toEqual([
                { evento: 'NA', motivo: 'socket hang up' },
            ]);
        });

        it('varredura incompleta NÃO fecha o lote em BAIXADO', async () => {
            // O caso caro: o código de REJEIÇÃO é justamente o que falhou. Sem ele,
            // "não vi rejeição" viraria "não houve rejeição" e o lote fecharia como pago.
            const repo = buildRepo();
            const retorno = buildRetorno();
            retorno.listDetalhe.mockImplementation(async (p: { eventoCod: string }) => {
                if (p.eventoCod === 'NA') throw new Error('ETIMEDOUT');
                return [detalhe()];
            });
            await make({ retorno, repo }).conciliar({ ...CHAVE, ator: 'u' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({ para: 'RETORNADO' }),
                TX,
            );
        });

        it('varredura completa e sem rejeição fecha o lote em BAIXADO', async () => {
            const repo = buildRepo();
            await make({ repo }).conciliar({ ...CHAVE, ator: 'u' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({ para: 'BAIXADO' }),
                TX,
            );
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
        it('grava a conciliação no item usando a chave nativa do arquivo', async () => {
            const repo = buildRepo();
            await make({ repo }).conciliar({ ...CHAVE, ator: 'u' });
            expect(repo.findByChaveNativa).toHaveBeenCalledWith({
                nativeFilCod: 2,
                nativeBncCod: 4,
                nativeFlpCod: 13,
            });
            expect(repo.registrarConciliacaoItem).toHaveBeenCalledWith(
                expect.objectContaining({
                    loteId: 'L1',
                    docCod: '813',
                    evento: '00',
                    rejeitado: false,
                    borCod: 249,
                    bxaCodSeq: 1,
                }),
                TX,
            );
        });

        it('linha de lote que não é nosso é reportada, não gravada', async () => {
            const repo = buildRepo(null);
            const res = await make({ repo }).conciliar({ ...CHAVE, ator: 'u' });
            expect(res.naoReconhecidos).toBe(1);
            expect(res.itens[0].reconhecido).toBe(false);
            expect(repo.registrarConciliacaoItem).not.toHaveBeenCalled();
        });
    });

    describe('transição do lote', () => {
        it('BAIXADO quando todos os itens têm baixa e nenhum foi rejeitado', async () => {
            const repo = buildRepo();
            await make({ repo }).conciliar({ ...CHAVE, ator: 'u' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({ para: 'BAIXADO' }),
                TX,
            );
        });

        it('fica em RETORNADO quando houve rejeição — exige tratamento humano', async () => {
            const repo = buildRepo(
                lote({
                    itens: [
                        { loteId: 'L1', filCod: 2, docCod: '813', titCod: '1', incluidoPor: 'u', rejeitado: true },
                    ],
                }),
            );
            await make({ repo }).conciliar({ ...CHAVE, ator: 'u' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({ para: 'RETORNADO' }),
                TX,
            );
        });

        it('fica em RETORNADO quando algum item ainda não tem baixa', async () => {
            const repo = buildRepo(
                lote({
                    itens: [
                        { loteId: 'L1', filCod: 2, docCod: '813', titCod: '1', incluidoPor: 'u', bxaCodSeq: 1 },
                        { loteId: 'L1', filCod: 2, docCod: '814', titCod: '1', incluidoPor: 'u' },
                    ],
                }),
            );
            await make({ repo }).conciliar({ ...CHAVE, ator: 'u' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({ para: 'RETORNADO' }),
                TX,
            );
        });
    });

    describe('gating', () => {
        it('dry-run não chama `processar` nem grava nada', async () => {
            const retorno = buildRetorno();
            const repo = buildRepo();
            const res = await make({
                retorno,
                repo,
                env: buildEnv({ conexosDryRun: true }),
            }).conciliar({ ...CHAVE, ator: 'u', processar: true });

            expect(res.dryRun).toBe(true);
            expect(res.processado).toBe(false);
            expect(retorno.processarArquivoRetorno).not.toHaveBeenCalled();
            expect(repo.registrarConciliacaoItem).not.toHaveBeenCalled();
            expect(repo.transicionarStatus).not.toHaveBeenCalled();
            // Mesmo em dry-run a LEITURA acontece: é o preview do que seria conciliado.
            expect(res.totalLinhas).toBe(1);
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
            const repo = buildRepo();
            const res = await make({
                repo,
                env: buildEnv({ sispagLiveWriteEnabled: false }),
            }).conciliar({ ...CHAVE, ator: 'u' });

            expect(res.dryRun).toBe(true);
            expect(repo.registrarConciliacaoItem).not.toHaveBeenCalled();
            expect(repo.transicionarStatus).not.toHaveBeenCalled();
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

        it('FAIL-CLOSED num `reconciling` órfão — 409, sem re-processar', async () => {
            const ledger = buildLedger({
                status: 'reconciling',
                dryRun: false,
                processou: true,
                varreduraIncompleta: false,
                criadoEm: '2026-08-24T12:00:00.000Z',
            });
            const retorno = buildRetorno();

            await expect(
                make({ ledger, retorno }).conciliar({ ...CHAVE, ator: 'u', processar: true }),
            ).rejects.toMatchObject({ code: 'CONCILIACAO_EM_DUVIDA', statusCode: 409 });
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

    describe('transação por arquivo (fault-tolerance-4)', () => {
        it('itens e transição rodam DENTRO da mesma transação', async () => {
            const db = buildDb();
            const repo = buildRepo();
            await make({ db, repo }).conciliar({ ...CHAVE, ator: 'u' });

            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            // Ambos recebem o MESMO `tx` — é isso que faz o rollback ser total.
            expect(repo.registrarConciliacaoItem).toHaveBeenCalledWith(expect.anything(), TX);
            expect(repo.transicionarStatus).toHaveBeenCalledWith(expect.anything(), TX);
        });

        it('falha no meio do loop propaga — a transação inteira desfaz', async () => {
            // Sem transação, uma queda aqui deixava parte dos itens com baixa gravada e o
            // lote ainda em REMESSA_GERADA: estado que nenhum código sabe ler, e que a
            // conciliação seguinte não corrige sozinha.
            const db = buildDb();
            const repo = buildRepo();
            repo.registrarConciliacaoItem.mockRejectedValue(new Error('conexão caiu'));

            await expect(
                make({ db, repo }).conciliar({ ...CHAVE, ator: 'u' }),
            ).rejects.toThrow('conexão caiu');

            // O erro sai de dentro do withTransaction (o driver dá ROLLBACK) e o lote
            // NÃO chega a ser transicionado.
            expect(repo.transicionarStatus).not.toHaveBeenCalled();
        });

        it('dry-run não abre escrita nenhuma dentro da transação', async () => {
            const db = buildDb();
            const repo = buildRepo();
            await make({ db, repo, env: buildEnv({ conexosDryRun: true }) }).conciliar({
                ...CHAVE,
                ator: 'u',
            });

            expect(repo.registrarConciliacaoItem).not.toHaveBeenCalled();
            expect(repo.transicionarStatus).not.toHaveBeenCalled();
        });
    });

});
