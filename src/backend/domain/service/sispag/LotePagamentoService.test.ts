import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteFilialError from '../../errors/LoteFilialError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import ModalidadePendenteError from '../../errors/ModalidadePendenteError.js';
import RetencaoInexistenteError from '../../errors/RetencaoInexistenteError.js';
import TituloEmOutroLoteError from '../../errors/TituloEmOutroLoteError.js';
import TituloForaDeLoteError from '../../errors/TituloForaDeLoteError.js';
import TituloNaoElegivelError from '../../errors/TituloNaoElegivelError.js';
import type { LotePagamento, TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type RetencaoFormacaoRepository from '../../repository/sispag/RetencaoFormacaoRepository.js';
import type LogService from '../LogService.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import LotePagamentoService from './LotePagamentoService.js';

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 2,
    status: 'RASCUNHO',
    criadoPor: 'u1',
    versao: 1,
    itens: [],
    ...over,
});

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    docCod: '100',
    titCod: '1',
    filCod: 2,
    valor: 1000,
    vencimento: 1_700_000_000_000,
    liberado: true,
    pago: false,
    ...over,
});

const buildLog = () =>
    ({
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    }) as unknown as LogService;

// withTransaction roda fn com um tx dummy (o repo é mockado); withAdvisoryLock sempre "adquire".
const buildDb = () =>
    ({
        withTransaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
        withAdvisoryLock: jest.fn((_k: number, onAcquired: () => Promise<unknown>) => onAcquired()),
    }) as unknown as PostgreeDatabaseClient;

interface RepoMock {
    criarLote: jest.Mock;
    getLoteComItens: jest.Mock;
    listLotes: jest.Mock;
    loteRascunhoComTitulo: jest.Mock;
    adicionarItem: jest.Mock;
    removerItem: jest.Mock;
    contarItens: jest.Mock;
    tocarLote: jest.Mock;
    transicionarStatus: jest.Mock;
    marcarManual: jest.Mock;
    atualizarContaPagadora: jest.Mock;
    contarItensSemModalidade: jest.Mock;
    atualizarModalidadeItem: jest.Mock;
    lerEstadoParaEdicao: jest.Mock;
}

const buildRepo = (): RepoMock => ({
    criarLote: jest.fn(),
    getLoteComItens: jest.fn().mockResolvedValue(lote()),
    listLotes: jest.fn(),
    loteRascunhoComTitulo: jest.fn().mockResolvedValue(null),
    adicionarItem: jest.fn().mockResolvedValue(undefined),
    removerItem: jest.fn().mockResolvedValue(1),
    contarItens: jest.fn().mockResolvedValue(1),
    tocarLote: jest.fn().mockResolvedValue(undefined),
    transicionarStatus: jest.fn().mockResolvedValue(1),
    marcarManual: jest.fn().mockResolvedValue(undefined),
    atualizarContaPagadora: jest.fn().mockResolvedValue(1),
    contarItensSemModalidade: jest.fn().mockResolvedValue(0),
    atualizarModalidadeItem: jest.fn().mockResolvedValue(1),
    lerEstadoParaEdicao: jest.fn().mockResolvedValue({ status: 'RASCUNHO', automatico: false }),
});

/** Retenção da formação automática (ADR-0050): escrita sempre com o `tx` do serviço. */
const buildRetencaoRepo = () => ({
    insertAtiva: jest.fn().mockResolvedValue(undefined),
    liberarAtiva: jest.fn().mockResolvedValue(0),
    listAtivas: jest.fn().mockResolvedValue([]),
});

/** Carteira persistida: é DAQUI que sai o "tem boleto?" — nunca do `fin064`. */
const buildTituloRepo = (temBoleto = false) => ({
    temBoletoPersistido: jest.fn().mockResolvedValue(temBoleto),
});

const make = (
    repo: RepoMock,
    conexosTitulo: TituloAPagar | null = titulo(),
    tituloRepo = buildTituloRepo(),
    retencaoRepo = buildRetencaoRepo(),
) => {
    const conexos = {
        getTituloAPagar: jest.fn().mockResolvedValue(conexosTitulo),
    } as unknown as ConexosSispagClient;
    const service = new LotePagamentoService(
        repo as unknown as LotePagamentoRepository,
        tituloRepo as unknown as TituloAPagarRepository,
        conexos,
        buildDb(),
        buildLog(),
        retencaoRepo as unknown as RetencaoFormacaoRepository,
    );
    return { service, conexos, tituloRepo, retencaoRepo };
};

describe('LotePagamentoService — invariantes', () => {
    describe('incluirTitulo', () => {
        const input = { loteId: 'L1', filCod: 2, docCod: '100', titCod: '1', ator: 'u1' };

        it('I2 — rejeita título NÃO liberado', async () => {
            const repo = buildRepo();
            const { service } = make(repo, titulo({ liberado: false }));
            await expect(service.incluirTitulo(input)).rejects.toBeInstanceOf(
                TituloNaoElegivelError,
            );
            expect(repo.adicionarItem).not.toHaveBeenCalled();
        });

        it('I2 — rejeita título JÁ pago', async () => {
            const repo = buildRepo();
            const { service } = make(repo, titulo({ pago: true }));
            await expect(service.incluirTitulo(input)).rejects.toBeInstanceOf(
                TituloNaoElegivelError,
            );
            expect(repo.adicionarItem).not.toHaveBeenCalled();
        });

        it('I2 — rejeita título inexistente no Conexos', async () => {
            const repo = buildRepo();
            const { service } = make(repo, null);
            await expect(service.incluirTitulo(input)).rejects.toBeInstanceOf(
                TituloNaoElegivelError,
            );
        });

        it('I4 — rejeita título de outra filial', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(lote({ filCod: 2 }));
            const { service, conexos } = make(repo);
            await expect(service.incluirTitulo({ ...input, filCod: 3 })).rejects.toBeInstanceOf(
                LoteFilialError,
            );
            expect(conexos.getTituloAPagar as jest.Mock).not.toHaveBeenCalled();
        });

        it('I3 — rejeita título já em OUTRO lote RASCUNHO', async () => {
            const repo = buildRepo();
            repo.loteRascunhoComTitulo.mockResolvedValue('OUTRO-LOTE');
            const { service } = make(repo);
            await expect(service.incluirTitulo(input)).rejects.toBeInstanceOf(
                TituloEmOutroLoteError,
            );
            expect(repo.adicionarItem).not.toHaveBeenCalled();
        });

        it('rejeita incluir em lote não-RASCUNHO', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(lote({ status: 'FINALIZADO' }));
            const { service } = make(repo);
            await expect(service.incluirTitulo(input)).rejects.toBeInstanceOf(
                LoteEstadoInvalidoError,
            );
        });

        it('happy — inclui com snapshot e toca o lote', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await service.incluirTitulo(input);
            expect(repo.adicionarItem).toHaveBeenCalledWith(
                expect.objectContaining({
                    docCod: '100',
                    titCod: '1',
                    valor: 1000,
                    incluidoPor: 'u1',
                }),
                expect.anything(),
            );
            expect(repo.tocarLote).toHaveBeenCalled();
        });

        it('incluir num lote AUTOMÁTICO o adota (vira manual)', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(lote({ automatico: true }));
            const { service } = make(repo, titulo({ docCod: '200' }));
            await service.incluirTitulo({ ...input, docCod: '200' });
            expect(repo.marcarManual).toHaveBeenCalledWith('L1', expect.anything());
        });

        it('incluir num lote MANUAL não chama marcarManual', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(lote({ automatico: false }));
            const { service } = make(repo, titulo({ docCod: '200' }));
            await service.incluirTitulo({ ...input, docCod: '200' });
            expect(repo.marcarManual).not.toHaveBeenCalled();
        });

        it('idempotente — título já no lote não re-inclui', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(
                lote({
                    itens: [
                        { loteId: 'L1', filCod: 2, docCod: '100', titCod: '1', incluidoPor: 'u1' },
                    ],
                }),
            );
            const { service, conexos } = make(repo);
            await service.incluirTitulo(input);
            expect(repo.adicionarItem).not.toHaveBeenCalled();
            expect(conexos.getTituloAPagar as jest.Mock).not.toHaveBeenCalled();
        });
    });

    describe('finalizarLote (gate)', () => {
        const input = { loteId: 'L1', versao: 1, ator: 'u1' };

        it('I5 — rejeita finalizar lote VAZIO', async () => {
            const repo = buildRepo();
            repo.contarItens.mockResolvedValue(0);
            const { service } = make(repo);
            await expect(service.finalizarLote(input)).rejects.toBeInstanceOf(
                LoteEstadoInvalidoError,
            );
            expect(repo.transicionarStatus).not.toHaveBeenCalled();
        });

        it('happy — finaliza (RASCUNHO→FINALIZADO)', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await service.finalizarLote(input);
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    para: 'FINALIZADO',
                    versaoEsperada: 1,
                    finalizadoPor: 'u1',
                }),
            );
        });

        it('I6 — conflito de versão vira LoteVersaoConflitoError', async () => {
            const repo = buildRepo();
            repo.transicionarStatus.mockResolvedValue(0);
            // relê com versão diferente da esperada (1) → conflito.
            repo.getLoteComItens.mockResolvedValue(lote({ versao: 2 }));
            const { service } = make(repo);
            await expect(service.finalizarLote(input)).rejects.toBeInstanceOf(
                LoteVersaoConflitoError,
            );
        });
    });

    describe('marcarRetorno', () => {
        it('chama transição FINALIZADO→RETORNADO (de volta do Nexxera)', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await service.marcarRetorno({ loteId: 'L1', versao: 2, ator: 'u1' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    para: 'RETORNADO',
                    de: ['FINALIZADO'],
                    versaoEsperada: 2,
                }),
            );
        });
    });

    describe('reabrir / cancelar', () => {
        it('reabrir chama transição FINALIZADO→RASCUNHO', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await service.reabrirLote({ loteId: 'L1', versao: 3, ator: 'u1' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    para: 'RASCUNHO',
                    de: ['FINALIZADO'],
                    versaoEsperada: 3,
                }),
            );
        });

        it('cancelar chama transição {RASCUNHO,FINALIZADO}→CANCELADO', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await service.cancelarLote({ loteId: 'L1', versao: 1, ator: 'u1' });
            expect(repo.transicionarStatus).toHaveBeenCalledWith(
                expect.objectContaining({ para: 'CANCELADO' }),
            );
        });

        it('estado incompatível (versão bate, status não) vira LoteEstadoInvalidoError', async () => {
            const repo = buildRepo();
            repo.transicionarStatus.mockResolvedValue(0);
            // versão igual à esperada (1) mas status já CANCELADO → estado inválido, não conflito.
            repo.getLoteComItens.mockResolvedValue(lote({ versao: 1, status: 'CANCELADO' }));
            const { service } = make(repo);
            await expect(
                service.reabrirLote({ loteId: 'L1', versao: 1, ator: 'u1' }),
            ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
        });
    });

    describe('CRUD e concorrência', () => {
        it('criarLote persiste e audita', async () => {
            const repo = buildRepo();
            repo.criarLote.mockResolvedValue(lote());
            const { service } = make(repo);
            const l = await service.criarLote({ filCod: 2, ator: 'u1' });
            expect(l.id).toBe('L1');
            expect(repo.criarLote).toHaveBeenCalledWith(
                expect.objectContaining({ filCod: 2, criadoPor: 'u1' }),
            );
        });

        it('listarLotes e getLote delegam ao repo', async () => {
            const repo = buildRepo();
            repo.listLotes.mockResolvedValue([lote()]);
            const { service } = make(repo);
            expect(await service.listarLotes({ status: 'RASCUNHO' })).toHaveLength(1);
            expect(await service.getLote('L1')).toBeTruthy();
        });

        it('removerTitulo remove e toca o lote (RASCUNHO)', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await service.removerTitulo({
                loteId: 'L1',
                filCod: 2,
                docCod: '100',
                titCod: '1',
                ator: 'u1',
            });
            expect(repo.removerItem).toHaveBeenCalled();
            expect(repo.tocarLote).toHaveBeenCalled();
        });

        it('remover de um lote AUTOMÁTICO o adota (vira manual)', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(lote({ automatico: true }));
            repo.lerEstadoParaEdicao.mockResolvedValue({ status: 'RASCUNHO', automatico: true });
            const { service } = make(repo);
            await service.removerTitulo({
                loteId: 'L1',
                filCod: 2,
                docCod: '100',
                titCod: '1',
                ator: 'u1',
            });
            expect(repo.marcarManual).toHaveBeenCalledWith('L1', expect.anything());
        });

        it('removerTitulo rejeita em lote não-RASCUNHO', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(lote({ status: 'FINALIZADO' }));
            const { service } = make(repo);
            await expect(
                service.removerTitulo({
                    loteId: 'L1',
                    filCod: 2,
                    docCod: '100',
                    titCod: '1',
                    ator: 'u1',
                }),
            ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
        });

        it('onBusy do advisory lock (título travado por outro) vira LoteVersaoConflitoError', async () => {
            const repo = buildRepo();
            const conexos = {
                getTituloAPagar: jest.fn().mockResolvedValue(titulo()),
            } as unknown as ConexosSispagClient;
            const dbBusy = {
                withTransaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({})),
                // withAdvisoryLock invoca onBusy (3º arg) — lock não adquirido.
                withAdvisoryLock: jest.fn(
                    (
                        _k: number,
                        _onAcquired: () => Promise<unknown>,
                        onBusy: () => Promise<unknown>,
                    ) => onBusy(),
                ),
            } as unknown as PostgreeDatabaseClient;
            const service = new LotePagamentoService(
                repo as unknown as LotePagamentoRepository,
                buildTituloRepo() as unknown as TituloAPagarRepository,
                conexos,
                dbBusy,
                buildLog(),
                buildRetencaoRepo() as unknown as RetencaoFormacaoRepository,
            );
            await expect(
                service.incluirTitulo({
                    loteId: 'L1',
                    filCod: 2,
                    docCod: '100',
                    titCod: '1',
                    ator: 'u1',
                }),
            ).rejects.toBeInstanceOf(LoteVersaoConflitoError);
        });
    });

    describe('atualizarContaPagadora (A3)', () => {
        const input = {
            loteId: 'L1',
            versao: 1,
            banco: 'SANTANDER',
            conta: '13001274-8',
            ator: 'u1',
        };

        it('troca a conta pagadora (RASCUNHO) e persiste banco/conta/versao', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await service.atualizarContaPagadora(input);
            expect(repo.atualizarContaPagadora).toHaveBeenCalledWith({
                id: 'L1',
                banco: 'SANTANDER',
                conta: '13001274-8',
                versaoEsperada: 1,
            });
        });

        it('rowCount 0 + versão divergente → LoteVersaoConflitoError', async () => {
            const repo = buildRepo();
            repo.atualizarContaPagadora.mockResolvedValue(0);
            repo.getLoteComItens.mockResolvedValue(lote({ versao: 2 }));
            const { service } = make(repo);
            await expect(service.atualizarContaPagadora(input)).rejects.toBeInstanceOf(
                LoteVersaoConflitoError,
            );
        });

        it('rowCount 0 + mesma versão (não-RASCUNHO) → LoteEstadoInvalidoError', async () => {
            const repo = buildRepo();
            repo.atualizarContaPagadora.mockResolvedValue(0);
            repo.getLoteComItens.mockResolvedValue(lote({ versao: 1, status: 'FINALIZADO' }));
            const { service } = make(repo);
            await expect(service.atualizarContaPagadora(input)).rejects.toBeInstanceOf(
                LoteEstadoInvalidoError,
            );
        });
    });

    describe('modalidade (A2)', () => {
        const incluir = { loteId: 'L1', filCod: 2, docCod: '100', titCod: '1', ator: 'u1' };

        it('incluir default BOLETO quando a carteira diz que o título tem boleto DDA', async () => {
            const repo = buildRepo();
            const { service, tituloRepo } = make(repo, titulo(), buildTituloRepo(true));
            await service.incluirTitulo(incluir);
            expect(tituloRepo.temBoletoPersistido).toHaveBeenCalledWith({
                filCod: 2,
                docCod: '100',
                titCod: '1',
            });
            expect(repo.adicionarItem).toHaveBeenCalledWith(
                expect.objectContaining({ modalidade: 'BOLETO' }),
                expect.anything(),
            );
        });

        it('sem boleto DDA → modalidade "a definir" (undefined)', async () => {
            const repo = buildRepo();
            const { service } = make(repo, titulo(), buildTituloRepo(false));
            await service.incluirTitulo(incluir);
            expect(repo.adicionarItem).toHaveBeenCalledWith(
                expect.objectContaining({ modalidade: undefined }),
                expect.anything(),
            );
        });

        it('NÃO usa o temBoleto do fin064 — de lá ele é sempre false por construção', async () => {
            // Regressão do bug que a analista encontrou testando local: a pré-seleção lia
            // `getTituloAPagar().temBoleto`, e o `fin064` não sabe de boleto. Resultado: nunca
            // pré-selecionava, e ela escolhia a forma de pagamento item por item.
            const repo = buildRepo();
            const { service } = make(repo, titulo({ temBoleto: true }), buildTituloRepo(false));
            await service.incluirTitulo(incluir);
            expect(repo.adicionarItem).toHaveBeenCalledWith(
                expect.objectContaining({ modalidade: undefined }),
                expect.anything(),
            );
        });

        it('finalizar BLOQUEIA se houver item sem modalidade ("a definir")', async () => {
            const repo = buildRepo();
            repo.contarItensSemModalidade.mockResolvedValue(2);
            const { service } = make(repo);
            await expect(
                service.finalizarLote({ loteId: 'L1', versao: 1, ator: 'u1' }),
            ).rejects.toBeInstanceOf(ModalidadePendenteError);
            expect(repo.transicionarStatus).not.toHaveBeenCalled();
        });

        it('finalizar OK quando toda modalidade está definida', async () => {
            const repo = buildRepo();
            repo.contarItensSemModalidade.mockResolvedValue(0);
            const { service } = make(repo);
            await service.finalizarLote({ loteId: 'L1', versao: 1, ator: 'u1' });
            expect(repo.transicionarStatus).toHaveBeenCalled();
        });

        it('atualizarModalidadeItem troca a forma e toca o lote', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await service.atualizarModalidadeItem({
                loteId: 'L1',
                filCod: 2,
                docCod: '100',
                titCod: '1',
                modalidade: 'PIX',
                versao: 1,
                ator: 'u1',
            });
            expect(repo.atualizarModalidadeItem).toHaveBeenCalledWith(
                expect.objectContaining({ modalidade: 'PIX', versaoEsperada: 1 }),
                expect.anything(),
            );
            expect(repo.tocarLote).toHaveBeenCalled();
        });

        it('atualizarModalidadeItem — rowCount 0 + versão divergente → conflito', async () => {
            const repo = buildRepo();
            repo.atualizarModalidadeItem.mockResolvedValue(0);
            repo.getLoteComItens.mockResolvedValue(lote({ versao: 2 }));
            const { service } = make(repo);
            await expect(
                service.atualizarModalidadeItem({
                    loteId: 'L1',
                    filCod: 2,
                    docCod: '100',
                    titCod: '1',
                    modalidade: 'PIX',
                    versao: 1,
                    ator: 'u1',
                }),
            ).rejects.toBeInstanceOf(LoteVersaoConflitoError);
        });
    });
    describe('retenção da formação automática (ADR-0050, I9)', () => {
        const chave = { filCod: 2, docCod: '100', titCod: '1' };
        const TX = expect.anything();

        describe('removerTitulo (lixeira do lote)', () => {
            it('lote AUTOMÁTICO: lê automatico ANTES do marcarManual e retém, na mesma transação', async () => {
                const repo = buildRepo();
                repo.lerEstadoParaEdicao.mockResolvedValue({
                    status: 'RASCUNHO',
                    automatico: true,
                });
                const { service, retencaoRepo } = make(repo);

                await service.removerTitulo({ loteId: 'L1', ...chave, ator: 'u1' });

                expect(repo.lerEstadoParaEdicao).toHaveBeenCalledWith('L1', TX);
                expect(retencaoRepo.insertAtiva).toHaveBeenCalledWith(TX, {
                    ...chave,
                    marcadoPor: 'u1',
                });
                const leu = repo.lerEstadoParaEdicao.mock.invocationCallOrder[0];
                const virouManual = repo.marcarManual.mock.invocationCallOrder[0];
                expect(leu).toBeLessThan(virouManual);
                // o MESMO tx em todas as escritas
                const tx = repo.removerItem.mock.calls[0][1];
                expect(retencaoRepo.insertAtiva.mock.calls[0][0]).toBe(tx);
                expect(repo.marcarManual).toHaveBeenCalledWith('L1', tx);
            });

            it('lote MANUAL: remove sem reter', async () => {
                const repo = buildRepo();
                const { service, retencaoRepo } = make(repo);

                await service.removerTitulo({ loteId: 'L1', ...chave, ator: 'u1' });

                expect(repo.removerItem).toHaveBeenCalled();
                expect(retencaoRepo.insertAtiva).not.toHaveBeenCalled();
                expect(repo.marcarManual).not.toHaveBeenCalled();
            });

            it('item que já não estava no lote não gera retenção', async () => {
                const repo = buildRepo();
                repo.lerEstadoParaEdicao.mockResolvedValue({
                    status: 'RASCUNHO',
                    automatico: true,
                });
                repo.removerItem.mockResolvedValue(0);
                const { service, retencaoRepo } = make(repo);

                await service.removerTitulo({ loteId: 'L1', ...chave, ator: 'u1' });

                expect(retencaoRepo.insertAtiva).not.toHaveBeenCalled();
            });

            it('lote que saiu de RASCUNHO entre a leitura e o lock é recusado', async () => {
                const repo = buildRepo();
                repo.lerEstadoParaEdicao.mockResolvedValue({
                    status: 'FINALIZADO',
                    automatico: true,
                });
                const { service, retencaoRepo } = make(repo);

                await expect(
                    service.removerTitulo({ loteId: 'L1', ...chave, ator: 'u1' }),
                ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
                expect(repo.removerItem).not.toHaveBeenCalled();
                expect(retencaoRepo.insertAtiva).not.toHaveBeenCalled();
            });
        });

        describe('retirarDoLote (aba de títulos)', () => {
            it('acha o lote RASCUNHO do título, remove e retém com o motivo, numa transação', async () => {
                const repo = buildRepo();
                repo.loteRascunhoComTitulo.mockResolvedValue('L1');
                const { service, retencaoRepo } = make(repo);

                const l = await service.retirarDoLote({
                    ...chave,
                    motivo: 'fornecedor pediu para segurar',
                    ator: 'u1',
                });

                expect(l.id).toBe('L1');
                expect(repo.removerItem).toHaveBeenCalledWith({ loteId: 'L1', ...chave }, TX);
                expect(retencaoRepo.insertAtiva).toHaveBeenCalledWith(TX, {
                    ...chave,
                    motivo: 'fornecedor pediu para segurar',
                    marcadoPor: 'u1',
                });
                expect(repo.tocarLote).toHaveBeenCalledWith('L1', TX);
            });

            it('retém mesmo em lote MANUAL (a intenção é explícita)', async () => {
                const repo = buildRepo();
                repo.loteRascunhoComTitulo.mockResolvedValue('L1');
                const { service, retencaoRepo } = make(repo);

                await service.retirarDoLote({ ...chave, ator: 'u1' });

                expect(retencaoRepo.insertAtiva).toHaveBeenCalledWith(TX, {
                    ...chave,
                    marcadoPor: 'u1',
                });
                expect(repo.marcarManual).not.toHaveBeenCalled();
            });

            it('lote automático vira manual', async () => {
                const repo = buildRepo();
                repo.loteRascunhoComTitulo.mockResolvedValue('L1');
                repo.lerEstadoParaEdicao.mockResolvedValue({
                    status: 'RASCUNHO',
                    automatico: true,
                });
                const { service } = make(repo);

                await service.retirarDoLote({ ...chave, ator: 'u1' });

                expect(repo.marcarManual).toHaveBeenCalledWith('L1', TX);
            });

            it('título fora de lote RASCUNHO → TituloForaDeLoteError, nada gravado', async () => {
                const repo = buildRepo();
                repo.loteRascunhoComTitulo.mockResolvedValue(null);
                const { service, retencaoRepo } = make(repo);

                await expect(
                    service.retirarDoLote({ ...chave, ator: 'u1' }),
                ).rejects.toBeInstanceOf(TituloForaDeLoteError);
                expect(repo.removerItem).not.toHaveBeenCalled();
                expect(retencaoRepo.insertAtiva).not.toHaveBeenCalled();
            });

            it('item sumiu entre a busca e o lock → TituloForaDeLoteError, sem retenção', async () => {
                const repo = buildRepo();
                repo.loteRascunhoComTitulo.mockResolvedValue('L1');
                repo.removerItem.mockResolvedValue(0);
                const { service, retencaoRepo } = make(repo);

                await expect(
                    service.retirarDoLote({ ...chave, ator: 'u1' }),
                ).rejects.toBeInstanceOf(TituloForaDeLoteError);
                expect(retencaoRepo.insertAtiva).not.toHaveBeenCalled();
            });

            it('falha ao gravar a retenção propaga (a transação desfaz a remoção)', async () => {
                const repo = buildRepo();
                repo.loteRascunhoComTitulo.mockResolvedValue('L1');
                const retencaoRepo = buildRetencaoRepo();
                retencaoRepo.insertAtiva.mockRejectedValue(new Error('db down'));
                const { service } = make(repo, titulo(), buildTituloRepo(), retencaoRepo);

                await expect(service.retirarDoLote({ ...chave, ator: 'u1' })).rejects.toThrow(
                    'db down',
                );
                expect(repo.tocarLote).not.toHaveBeenCalled();
            });
        });

        it('incluirTitulo libera a retenção ativa na MESMA transação (incluido-no-lote)', async () => {
            const repo = buildRepo();
            const { service, retencaoRepo } = make(repo);

            await service.incluirTitulo({ loteId: 'L1', ...chave, ator: 'u9' });

            const tx = repo.adicionarItem.mock.calls[0][1];
            expect(retencaoRepo.liberarAtiva).toHaveBeenCalledWith(tx, {
                ...chave,
                removidoPor: 'u9',
                motivoRemocao: 'incluido-no-lote',
            });
        });

        describe('liberarRetencao', () => {
            it('soft delete com motivo liberado e autor', async () => {
                const repo = buildRepo();
                const retencaoRepo = buildRetencaoRepo();
                retencaoRepo.liberarAtiva.mockResolvedValue(1);
                const { service } = make(repo, titulo(), buildTituloRepo(), retencaoRepo);

                await service.liberarRetencao({ ...chave, ator: 'u1' });

                expect(retencaoRepo.liberarAtiva).toHaveBeenCalledWith(TX, {
                    ...chave,
                    removidoPor: 'u1',
                    motivoRemocao: 'liberado',
                });
            });

            it('sem retenção ativa → RetencaoInexistenteError', async () => {
                const { service } = make(buildRepo());
                await expect(
                    service.liberarRetencao({ ...chave, ator: 'u1' }),
                ).rejects.toBeInstanceOf(RetencaoInexistenteError);
            });
        });
    });
});
