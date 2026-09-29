import 'reflect-metadata';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import DestinoAprovacaoPendenteError from '../../errors/DestinoAprovacaoPendenteError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteFilialError from '../../errors/LoteFilialError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import ModalidadePendenteError from '../../errors/ModalidadePendenteError.js';
import TituloEmOutroLoteError from '../../errors/TituloEmOutroLoteError.js';
import TituloForaDeLoteError from '../../errors/TituloForaDeLoteError.js';
import TituloNaoElegivelError from '../../errors/TituloNaoElegivelError.js';
import type { LotePagamento, TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type LogService from '../LogService.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import DestinoAprovacaoRule from '../../libs/sispag/DestinoAprovacaoRule.js';
import DestinoManualValidator from '../../libs/sispag/DestinoManualValidator.js';
import LotePagamentoService from './LotePagamentoService.js';
import type SispagPainelService from './SispagPainelService.js';

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
    setDestinoManualItem: jest.Mock;
    aprovarDestinoManualItem: jest.Mock;
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
    setDestinoManualItem: jest.fn().mockResolvedValue({ atualizado: true, auditId: 'a-1' }),
    aprovarDestinoManualItem: jest.fn().mockResolvedValue({ atualizado: true, auditId: 'ap-1' }),
});

/**
 * Dependências do ADR-0054 (flags, validador, oferta, leitura do lote nativo). Por padrão as
 * flags estão DESLIGADAS — é o comportamento do `main`.
 */
const buildDestinoDeps = (envVars: Record<string, unknown> = {}) => ({
    env: {
        getEnvironmentVars: jest.fn().mockResolvedValue(envVars),
    } as unknown as EnvironmentProvider,
    conexos: {
        getTituloAPagar: jest.fn(),
        getDocumentoFavorecido: jest.fn().mockResolvedValue(undefined),
    },
    write: {
        getLoteNativo: jest.fn().mockResolvedValue(undefined),
        listarChavesDoLote: jest.fn().mockResolvedValue(new Set<string>()),
    },
    painel: { modalidadesDisponiveisDoLote: jest.fn().mockResolvedValue([]) },
    log: buildLog(),
});

/** Carteira persistida: é DAQUI que sai o "tem boleto?" — nunca do `fin064`. */
const buildTituloRepo = (temBoleto = false) => ({
    temBoletoPersistido: jest.fn().mockResolvedValue(temBoleto),
});

const make = (
    repo: RepoMock,
    conexosTitulo: TituloAPagar | null = titulo(),
    tituloRepo = buildTituloRepo(),
    deps = buildDestinoDeps(),
) => {
    deps.conexos.getTituloAPagar.mockResolvedValue(conexosTitulo);
    const conexos = deps.conexos as unknown as ConexosSispagClient;
    const service = new LotePagamentoService(
        repo as unknown as LotePagamentoRepository,
        tituloRepo as unknown as TituloAPagarRepository,
        conexos,
        buildDb(),
        deps.log,
        deps.env,
        new DestinoManualValidator(),
        deps.painel as unknown as SispagPainelService,
        deps.write as unknown as ConexosSispagWriteClient,
        new DestinoAprovacaoRule(),
    );
    return { service, conexos, tituloRepo };
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
                buildDestinoDeps().env,
                new DestinoManualValidator(),
                buildDestinoDeps().painel as unknown as SispagPainelService,
                buildDestinoDeps().write as unknown as ConexosSispagWriteClient,
                new DestinoAprovacaoRule(),
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

    describe('retirarDoLote (aba de títulos, ADR-0050)', () => {
        const chave = { filCod: 2, docCod: '100', titCod: '1' };

        it('acha o lote RASCUNHO do título e o remove, como a lixeira', async () => {
            const repo = buildRepo();
            repo.loteRascunhoComTitulo.mockResolvedValue('L1');
            const { service } = make(repo);
            await service.retirarDoLote({ ...chave, ator: 'u1' });
            expect(repo.loteRascunhoComTitulo).toHaveBeenCalledWith(chave);
            expect(repo.removerItem).toHaveBeenCalledWith(
                { loteId: 'L1', ...chave },
                expect.anything(),
            );
            expect(repo.marcarManual).not.toHaveBeenCalled();
        });

        it('lote automático vira manual', async () => {
            const repo = buildRepo();
            repo.loteRascunhoComTitulo.mockResolvedValue('L1');
            repo.getLoteComItens.mockResolvedValue(lote({ automatico: true }));
            const { service } = make(repo);
            await service.retirarDoLote({ ...chave, ator: 'u1' });
            expect(repo.marcarManual).toHaveBeenCalledWith('L1', expect.anything());
        });

        it('título fora de lote RASCUNHO → TituloForaDeLoteError, nada removido', async () => {
            const repo = buildRepo();
            const { service } = make(repo);
            await expect(service.retirarDoLote({ ...chave, ator: 'u1' })).rejects.toBeInstanceOf(
                TituloForaDeLoteError,
            );
            expect(repo.removerItem).not.toHaveBeenCalled();
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// ADR-0054 — destino manual no item e checagem leve do finalizar
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('LotePagamentoService — destino manual (ADR-0054)', () => {
    const DOC = '11144477735';
    const ENTRADA_CONTA = {
        tipo: 'CONTA',
        bancoCod: '237',
        agencia: '1234',
        conta: '99887766',
        contaDv: '1',
        titularDocumento: '111.444.777-35',
    };
    const ENTRADA_PIX = {
        tipo: 'CHAVE_PIX',
        chavePixTipo: 'EMAIL',
        chavePix: 'fornecedor@x.com.br',
        titularDocumento: DOC,
    };
    const FLAGS = {
        sispagTedEnabled: true,
        sispagPixEnabled: true,
        sispagDestinoManualEnabled: true,
    };
    const item = {
        loteId: 'L1',
        filCod: 2,
        docCod: '100',
        titCod: '1',
        modalidade: 'TED' as const,
        incluidoPor: 'u1',
    };
    const input = { loteId: 'L1', filCod: 2, docCod: '100', titCod: '1', versao: 1, ator: 'ana' };

    const montar = (o: {
        env?: Record<string, unknown>;
        lote?: LotePagamento;
        documento?: string | undefined;
        nativo?: unknown;
        chavesNativas?: Set<string> | undefined;
        oferta?: unknown[];
    }) => {
        const repo = buildRepo();
        repo.getLoteComItens.mockResolvedValue(o.lote ?? lote({ itens: [item] }));
        const deps = buildDestinoDeps(o.env ?? FLAGS);
        deps.conexos.getDocumentoFavorecido.mockResolvedValue('documento' in o ? o.documento : DOC);
        deps.write.getLoteNativo.mockResolvedValue(o.nativo);
        deps.write.listarChavesDoLote.mockResolvedValue(
            'chavesNativas' in o ? o.chavesNativas : new Set<string>(),
        );
        deps.painel.modalidadesDisponiveisDoLote.mockResolvedValue(o.oferta ?? []);
        const { service } = make(repo, titulo({ pesCod: 'P1' }), buildTituloRepo(), deps);
        return { service, repo, deps };
    };

    it('flag manual desligada → 403 e nada gravado', async () => {
        const { service, repo } = montar({ env: {} });
        await expect(
            service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
        ).rejects.toMatchObject({ code: 'DESTINO_MANUAL_DESABILITADO', statusCode: 403 });
        expect(repo.setDestinoManualItem).not.toHaveBeenCalled();
    });

    it('conta digitada exige a flag TED; chave digitada exige a flag PIX', async () => {
        const semTed = montar({
            env: { sispagDestinoManualEnabled: true, sispagPixEnabled: true },
        });
        await expect(
            semTed.service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
        ).rejects.toMatchObject({ code: 'DESTINO_MANUAL_DESABILITADO' });
        const semPix = montar({
            env: { sispagDestinoManualEnabled: true, sispagTedEnabled: true },
        });
        await expect(
            semPix.service.definirDestinoManualItem({ ...input, destino: ENTRADA_PIX }),
        ).rejects.toMatchObject({ code: 'DESTINO_MANUAL_DESABILITADO' });
    });

    it('formato inválido → 400 sem ecoar o valor', async () => {
        const { service, repo } = montar({});
        const err = await service
            .definirDestinoManualItem({ ...input, destino: { ...ENTRADA_CONTA, bancoCod: '99' } })
            .catch((e: unknown) => e);
        expect(err).toMatchObject({ code: 'DESTINO_MANUAL_INVALIDO', statusCode: 400 });
        expect(JSON.stringify(err)).not.toContain('99887766');
        expect(repo.setDestinoManualItem).not.toHaveBeenCalled();
    });

    it('I10e — lote fora de RASCUNHO recusa', async () => {
        const { service, repo } = montar({ lote: lote({ status: 'FINALIZADO', itens: [item] }) });
        await expect(
            service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
        ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
        expect(repo.setDestinoManualItem).not.toHaveBeenCalled();
    });

    it('item que não está no lote recusa', async () => {
        const { service } = montar({ lote: lote({ itens: [] }) });
        await expect(
            service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
        ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
    });

    it('I10i — titular divergente → 422 em PT, nada gravado', async () => {
        const { service, repo } = montar({ documento: '11222333000181' });
        await expect(
            service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
        ).rejects.toMatchObject({ code: 'DESTINO_TITULAR_DIVERGENTE', statusCode: 422 });
        expect(repo.setDestinoManualItem).not.toHaveBeenCalled();
    });

    it('documento do favorecido indisponível → falha fechada', async () => {
        const { service, repo } = montar({ documento: undefined });
        await expect(
            service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
        ).rejects.toMatchObject({ code: 'DOCUMENTO_FAVORECIDO_INDISPONIVEL' });
        expect(repo.setDestinoManualItem).not.toHaveBeenCalled();
    });

    it('versão errada → 409 de conflito, como nas outras edições', async () => {
        const { service, repo } = montar({});
        repo.setDestinoManualItem.mockResolvedValue({ atualizado: false });
        repo.getLoteComItens.mockResolvedValue(lote({ versao: 2, itens: [item] }));
        await expect(
            service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
        ).rejects.toBeInstanceOf(LoteVersaoConflitoError);
    });

    it('sucesso: grava o destino NORMALIZADO com o usuário do request; log sem o valor', async () => {
        const { service, repo, deps } = montar({});
        const r = await service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA });
        expect(repo.setDestinoManualItem).toHaveBeenCalledWith({
            loteId: 'L1',
            filCod: 2,
            docCod: '100',
            titCod: '1',
            versaoEsperada: 1,
            destino: { ...ENTRADA_CONTA, titularDocumento: DOC },
            usuario: 'ana',
        });
        expect(r.id).toBe('L1');
        const logado = JSON.stringify((deps.log.info as jest.Mock).mock.calls);
        expect(logado).not.toContain('99887766');
        expect(logado).not.toContain(DOC);
        expect(logado).toContain('definirDestinoManualItem');
    });

    describe('I10f — congelamento depois do import no fin015', () => {
        const loteNativo = lote({
            nativeFilCod: 2,
            nativeBncCod: 4,
            nativeFlpCod: 12,
            itens: [item],
        });

        it('item já dentro de um lote nativo vivo → recusa, mesmo com o lote reaberto', async () => {
            const { service, repo } = montar({
                lote: loteNativo,
                nativo: { status: 0, titulosCount: 1 },
                chavesNativas: new Set(['2:100:1']),
            });
            await expect(
                service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
            ).rejects.toMatchObject({ code: 'DESTINO_CONGELADO' });
            expect(repo.setDestinoManualItem).not.toHaveBeenCalled();
        });

        it('lote nativo cancelado no ERP → volta a ser editável', async () => {
            const { service, repo } = montar({
                lote: loteNativo,
                nativo: { status: 2, titulosCount: 0 },
                chavesNativas: new Set(['2:100:1']),
            });
            await service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA });
            expect(repo.setDestinoManualItem).toHaveBeenCalled();
        });

        it('lote nativo que não existe mais → editável', async () => {
            const { service, repo } = montar({ lote: loteNativo, nativo: undefined });
            await service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA });
            expect(repo.setDestinoManualItem).toHaveBeenCalled();
        });

        it('não dá para ler os itens do lote nativo → recusa (fail closed)', async () => {
            const { service } = montar({
                lote: loteNativo,
                nativo: { status: 0, titulosCount: 1 },
                chavesNativas: undefined,
            });
            await expect(
                service.definirDestinoManualItem({ ...input, destino: ENTRADA_CONTA }),
            ).rejects.toMatchObject({ code: 'DESTINO_CONGELADO' });
        });
    });

    it('limpar: grava sem destino, sob as mesmas regras', async () => {
        const { service, repo } = montar({});
        await service.limparDestinoManualItem(input);
        expect(repo.setDestinoManualItem).toHaveBeenCalledWith(
            expect.objectContaining({ versaoEsperada: 1, usuario: 'ana' }),
        );
        expect(repo.setDestinoManualItem.mock.calls[0]?.[0]).not.toHaveProperty('destino');
        const off = montar({ env: {} });
        await expect(off.service.limparDestinoManualItem(input)).rejects.toMatchObject({
            code: 'DESTINO_MANUAL_DESABILITADO',
        });
    });
});

describe('LotePagamentoService.finalizarLote — checagem LEVE do destino (Adendo)', () => {
    const itemTed = {
        loteId: 'L1',
        filCod: 2,
        docCod: '100',
        titCod: '1',
        credor: 'ACME',
        modalidade: 'TED' as const,
        incluidoPor: 'u1',
    };
    const input = { loteId: 'L1', versao: 1, ator: 'u1' };

    const montar = (env: Record<string, unknown>, oferta: unknown[], itens = [itemTed]) => {
        const repo = buildRepo();
        repo.getLoteComItens.mockResolvedValue(lote({ itens }));
        const deps = buildDestinoDeps(env);
        deps.painel.modalidadesDisponiveisDoLote.mockResolvedValue(oferta);
        const { service } = make(repo, titulo(), buildTituloRepo(), deps);
        return { service, repo, deps };
    };

    it('flags desligadas: nenhuma consulta nova (igual ao main)', async () => {
        const { service, deps, repo } = montar({}, []);
        await service.finalizarLote(input);
        expect(deps.painel.modalidadesDisponiveisDoLote).not.toHaveBeenCalled();
        expect(repo.transicionarStatus).toHaveBeenCalled();
    });

    it('TED sem opção ofertada e sem destino manual → recusa nomeando o item', async () => {
        const { service, repo } = montar({ sispagTedEnabled: true }, [
            { docCod: '100', titCod: '1', modalidades: [] },
        ]);
        await expect(service.finalizarLote(input)).rejects.toMatchObject({
            code: 'DESTINO_PAGAMENTO_AUSENTE',
            userMessage: expect.stringContaining('100/1'),
        });
        expect(repo.transicionarStatus).not.toHaveBeenCalled();
    });

    it('TED com opção ofertada (cadastro ou manual) → passa', async () => {
        const { service, repo } = montar({ sispagTedEnabled: true }, [
            { docCod: '100', titCod: '1', modalidades: ['TED'] },
        ]);
        await service.finalizarLote(input);
        expect(repo.transicionarStatus).toHaveBeenCalled();
    });

    it('item de modalidade cuja flag está desligada não é checado', async () => {
        const { service, repo } = montar({ sispagPixEnabled: true }, [
            { docCod: '100', titCod: '1', modalidades: [] },
        ]);
        await service.finalizarLote(input);
        expect(repo.transicionarStatus).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════════════
// ADR-0054 D10/D11 — aprovação da conta digitada
// ═══════════════════════════════════════════════════════════════════════════════════════

describe('LotePagamentoService — aprovação do destino digitado (D10/D11)', () => {
    const FLAGS = {
        sispagTedEnabled: true,
        sispagPixEnabled: true,
        sispagDestinoManualEnabled: true,
    };
    const CONTA = {
        tipo: 'CONTA' as const,
        bancoCod: '237',
        agencia: '1234',
        conta: '99887766',
        contaDv: '1',
        titularDocumento: '11144477735',
    };
    const CHAVE_CPF = {
        tipo: 'CHAVE_PIX' as const,
        chavePixTipo: 'CPF_CNPJ' as const,
        chavePix: '11144477735',
        titularDocumento: '11144477735',
    };
    const itemTed = {
        loteId: 'L1',
        filCod: 2,
        docCod: '100',
        titCod: '1',
        credor: 'ACME',
        modalidade: 'TED' as const,
        incluidoPor: 'u1',
        destinoManual: CONTA,
        destinoManualAuditId: 'grav-1',
        destinoManualInformadoPor: 'ana',
    };
    const input = { loteId: 'L1', filCod: 2, docCod: '100', titCod: '1', versao: 1, ator: 'ana' };

    const montar = (env: Record<string, unknown>, itens: LotePagamento['itens']) => {
        const repo = buildRepo();
        repo.getLoteComItens.mockResolvedValue(lote({ itens }));
        const deps = buildDestinoDeps(env);
        deps.painel.modalidadesDisponiveisDoLote.mockResolvedValue(
            itens.map((i) => ({ docCod: i.docCod, titCod: i.titCod, modalidades: ['TED', 'PIX'] })),
        );
        const { service } = make(repo, titulo({ pesCod: 'P1' }), buildTituloRepo(), deps);
        return { service, repo, deps };
    };

    describe('aprovarDestinoManualItem', () => {
        it('quem digitou pode aprovar a própria conta: grava APROVACAO com o ator; log sem o valor', async () => {
            const { service, repo, deps } = montar(FLAGS, [itemTed]);
            await service.aprovarDestinoManualItem(input);
            expect(repo.aprovarDestinoManualItem).toHaveBeenCalledWith({
                loteId: 'L1',
                filCod: 2,
                docCod: '100',
                titCod: '1',
                versaoEsperada: 1,
                usuario: 'ana',
            });
            const logado = JSON.stringify((deps.log.info as jest.Mock).mock.calls);
            expect(logado).toContain('aprovarDestinoManualItem');
            expect(logado).not.toContain('99887766');
            expect(logado).not.toContain('11144477735');
        });

        it('flags manual ou TED desligadas → 403, nada gravado', async () => {
            for (const env of [
                { sispagTedEnabled: true },
                { sispagDestinoManualEnabled: true, sispagPixEnabled: true },
            ]) {
                const { service, repo } = montar(env, [itemTed]);
                await expect(service.aprovarDestinoManualItem(input)).rejects.toMatchObject({
                    code: 'DESTINO_MANUAL_DESABILITADO',
                    statusCode: 403,
                });
                expect(repo.aprovarDestinoManualItem).not.toHaveBeenCalled();
            }
        });

        it('só RASCUNHO', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(
                lote({ status: 'FINALIZADO', itens: [itemTed] }),
            );
            const { service } = make(repo, titulo(), buildTituloRepo(), buildDestinoDeps(FLAGS));
            await expect(service.aprovarDestinoManualItem(input)).rejects.toBeInstanceOf(
                LoteEstadoInvalidoError,
            );
            expect(repo.aprovarDestinoManualItem).not.toHaveBeenCalled();
        });

        it('D11 — chave PIX CPF/CNPJ digitada não tem o que aprovar; item sem destino idem', async () => {
            for (const itens of [
                [{ ...itemTed, modalidade: 'PIX' as const, destinoManual: CHAVE_CPF }],
                [{ ...itemTed, destinoManual: undefined }],
            ]) {
                const { service, repo } = montar(FLAGS, itens);
                await expect(service.aprovarDestinoManualItem(input)).rejects.toBeInstanceOf(
                    LoteEstadoInvalidoError,
                );
                expect(repo.aprovarDestinoManualItem).not.toHaveBeenCalled();
            }
        });

        it('já aprovada → devolve o lote sem nova linha na trilha', async () => {
            const { service, repo } = montar(FLAGS, [
                { ...itemTed, destinoManualAprovadoPor: 'bia' },
            ]);
            const r = await service.aprovarDestinoManualItem(input);
            expect(r.id).toBe('L1');
            expect(repo.aprovarDestinoManualItem).not.toHaveBeenCalled();
        });

        it('versão mudou → 409 de conflito', async () => {
            const { service, repo } = montar(FLAGS, [itemTed]);
            repo.aprovarDestinoManualItem.mockResolvedValue({ atualizado: false });
            repo.getLoteComItens.mockResolvedValue(lote({ versao: 2, itens: [itemTed] }));
            await expect(service.aprovarDestinoManualItem(input)).rejects.toBeInstanceOf(
                LoteVersaoConflitoError,
            );
        });

        it('I10f — item congelado num lote nativo vivo → recusa', async () => {
            const repo = buildRepo();
            repo.getLoteComItens.mockResolvedValue(
                lote({ nativeFilCod: 2, nativeBncCod: 4, nativeFlpCod: 12, itens: [itemTed] }),
            );
            const deps = buildDestinoDeps(FLAGS);
            deps.write.getLoteNativo.mockResolvedValue({ status: 0, titulosCount: 1 });
            deps.write.listarChavesDoLote.mockResolvedValue(new Set(['2:100:1']));
            const { service } = make(repo, titulo(), buildTituloRepo(), deps);
            await expect(service.aprovarDestinoManualItem(input)).rejects.toMatchObject({
                code: 'DESTINO_CONGELADO',
            });
        });
    });

    describe('finalizarLote barra conta digitada pendente', () => {
        const fin = { loteId: 'L1', versao: 1, ator: 'u1' };

        it('pendente → 409 nomeando o item, sem banco/conta/CPF na mensagem', async () => {
            const { service, repo } = montar(FLAGS, [itemTed]);
            const err = await service.finalizarLote(fin).catch((e: unknown) => e);
            expect(err).toBeInstanceOf(DestinoAprovacaoPendenteError);
            expect(err).toMatchObject({
                code: 'DESTINO_APROVACAO_PENDENTE',
                statusCode: 409,
                userMessage: expect.stringContaining('100/1 (ACME)'),
            });
            const texto = JSON.stringify(err) + String((err as Error).message);
            expect(texto).not.toContain('99887766');
            expect(texto).not.toContain('11144477735');
            expect(texto).not.toContain('237');
            expect(repo.transicionarStatus).not.toHaveBeenCalled();
        });

        it('aprovada → finaliza', async () => {
            const { service, repo } = montar(FLAGS, [
                { ...itemTed, destinoManualAprovadoPor: 'bia' },
            ]);
            await service.finalizarLote(fin);
            expect(repo.transicionarStatus).toHaveBeenCalled();
        });

        it('D11 — chave PIX CPF/CNPJ digitada não bloqueia', async () => {
            const { service, repo } = montar(FLAGS, [
                { ...itemTed, modalidade: 'PIX' as const, destinoManual: CHAVE_CPF },
            ]);
            await service.finalizarLote(fin);
            expect(repo.transicionarStatus).toHaveBeenCalled();
        });

        it('flags desligadas: a conta persistida é ignorada e nada bloqueia (paridade com o main)', async () => {
            const { service, repo, deps } = montar({}, [itemTed]);
            await service.finalizarLote(fin);
            expect(repo.transicionarStatus).toHaveBeenCalled();
            expect(deps.painel.modalidadesDisponiveisDoLote).not.toHaveBeenCalled();
        });
    });
});
