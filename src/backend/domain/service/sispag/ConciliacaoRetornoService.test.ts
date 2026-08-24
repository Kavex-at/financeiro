import 'reflect-metadata';
import type ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import type { ArquivoRetornoDetalhe } from '../../interface/sispag/Fin052Retorno.js';
import type { LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
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
}) =>
    new ConciliacaoRetornoService(
        (o.retorno ?? buildRetorno()) as unknown as ConexosSispagRetornoClient,
        (o.repo ?? buildRepo()) as unknown as LotePagamentoRepository,
        o.env ?? buildEnv(),
        buildLog(),
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
            );
        });

        it('varredura completa e sem rejeição fecha o lote em BAIXADO', async () => {
            const repo = buildRepo();
            await make({ repo }).conciliar({ ...CHAVE, ator: 'u' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({ para: 'BAIXADO' }),
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
});
