import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type { LoteSispag, TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import MaskDestino from '../../libs/sispag/MaskDestino.js';
import DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import SispagPainelService from './SispagPainelService.js';

const DAY = 24 * 60 * 60 * 1000;

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    docCod: '100',
    titCod: '1',
    filCod: 2,
    valor: 1000,
    vencimento: Date.now() + 3 * DAY,
    liberado: true,
    pago: false,
    ...over,
});

const loteNativo = (): LoteSispag => ({
    filCod: 2,
    flpCod: 1,
    status: 1,
    envioConfirmado: true,
    retornoProcessado: false,
    titulosCount: 1,
    soma: 100,
    itensRetorno: 0,
});

const buildLog = () =>
    ({
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    }) as unknown as LogService & { warn: jest.Mock; info: jest.Mock };

const make = (
    over: {
        titulosAtivos?: TituloAPagar[];
        listLotes?: jest.Mock;
        ultimaRun?: Date | null;
        emRascunho?: Array<{
            filCod: number;
            docCod: string;
            titCod: string;
            loteId: string;
            automatico: boolean;
        }>;
        comprometidos?: Array<{
            filCod: number;
            docCod: string;
            titCod: string;
            id: string;
            status: 'FINALIZADO' | 'REMESSA_GERADA';
        }>;
        log?: LogService;
        retornoConfigs?: jest.Mock;
        retornoArquivos?: jest.Mock;
        getLoteComItens?: jest.Mock;
        getTituloAPagar?: jest.Mock;
        listContasFavorecido?: jest.Mock;
        listContasCorrentes?: jest.Mock;
        listChavesPixFavorecido?: jest.Mock;
        getDocumentoFavorecido?: jest.Mock;
        /** Variáveis extras do ambiente (as flags do ADR-0054). */
        envVars?: Record<string, unknown>;
        listChavesComBoleto?: jest.Mock;
        listarLinhasDigitaveisDoLote?: jest.Mock;
        remessaLedger?: { listReconcilingParadas: jest.Mock };
        conciliacaoLedger?: { listReconcilingParadas: jest.Mock };
    } = {},
) => {
    const { listChavesPixFavorecido = jest.fn().mockResolvedValue([]), envVars = {} } = over;
    const sispag = {
        listLotes: over.listLotes ?? jest.fn().mockResolvedValue([loteNativo()]),
        getTituloAPagar: over.getTituloAPagar ?? jest.fn().mockResolvedValue(null),
        listContasFavorecido: over.listContasFavorecido ?? jest.fn().mockResolvedValue([]),
        listContasCorrentes:
            over.listContasCorrentes ?? jest.fn().mockResolvedValue([{ ccoCod: 1, bncCod: 4 }]),
        listChavesPixFavorecido,
        getDocumentoFavorecido:
            over.getDocumentoFavorecido ?? jest.fn().mockResolvedValue(undefined),
    } as unknown as ConexosSispagClient;
    const retorno = {
        listConfigsRetorno: over.retornoConfigs ?? jest.fn().mockResolvedValue([]),
        listArquivosRetorno: over.retornoArquivos ?? jest.fn().mockResolvedValue([]),
    } as unknown as import('../../client/ConexosSispagRetornoClient.js').default;
    const base = {
        getFiliais: jest.fn().mockResolvedValue([{ filCod: 2 }, { filCod: 4 }]),
    } as unknown as ConexosBaseClient;
    const listChavesComBoleto =
        over.listChavesComBoleto ?? jest.fn().mockResolvedValue(new Set<string>());
    const tituloRepo = {
        listAtivos: jest.fn().mockResolvedValue(over.titulosAtivos ?? [titulo()]),
        listChavesComBoleto,
    } as unknown as TituloAPagarRepository;
    const runRepo = {
        findLatestSuccessFinishedAt: jest
            .fn()
            .mockResolvedValue(over.ultimaRun ?? new Date('2026-07-08T06:00:00Z')),
    } as unknown as PagamentoIngestaoRunRepository;
    const loteRepo = {
        listTitulosEmRascunho: jest.fn().mockResolvedValue(over.emRascunho ?? []),
        listTitulosEmLotesComprometidos: jest.fn().mockResolvedValue(over.comprometidos ?? []),
        getLoteComItens: over.getLoteComItens ?? jest.fn().mockResolvedValue(null),
    } as unknown as LotePagamentoRepository;
    const listarLinhasDigitaveisDoLote =
        over.listarLinhasDigitaveisDoLote ?? jest.fn().mockResolvedValue([]);
    const fin015 = {
        listarLinhasDigitaveisDoLote,
    } as unknown as import('../../client/ConexosSispagWriteClient.js').default;
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            conexosWriteEnabled: false,
            conexosDryRun: true,
            ...envVars,
        }),
    } as unknown as EnvironmentProvider;
    const log = over.log ?? buildLog();
    // Ledgers: por padrão sem nenhuma execução presa. Um teste específico injeta órfãos.
    const remessaLedger = (over.remessaLedger ?? {
        listReconcilingParadas: jest.fn().mockResolvedValue([]),
    }) as never;
    const conciliacaoLedger = (over.conciliacaoLedger ?? {
        listReconcilingParadas: jest.fn().mockResolvedValue([]),
    }) as never;
    const resolver = new DestinoPagamentoResolver(sispag, new MaskDestino());
    const service = new SispagPainelService(
        sispag,
        fin015,
        retorno,
        base,
        new BoundedConcurrency(),
        tituloRepo,
        runRepo,
        loteRepo,
        remessaLedger,
        conciliacaoLedger,
        env,
        log,
        resolver,
    );
    return {
        service,
        log,
        listChavesComBoleto,
        listarLinhasDigitaveisDoLote,
        resolver,
    };
};

describe('SispagPainelService.montarPainel — sem contadores de exceção (ADR-0065)', () => {
    it('o painel não tem mais o bloco de exceções de destino', async () => {
        const { service } = make({});
        const painel = await service.montarPainel();
        expect(painel).not.toHaveProperty('excecoes');
    });
});

describe('SispagPainelService.montarPainel', () => {
    it('lê títulos do banco (carteira), agrega contexto e marca somente-leitura', async () => {
        const { service } = make();
        const painel = await service.montarPainel();
        expect(painel.modo.somenteLeitura).toBe(true);
        expect(painel.modo.conexosWriteEnabled).toBe(false);
        // títulos vêm da carteira persistida (lista plana), não ×filiais
        expect(painel.titulos.length).toBe(1);
        expect(painel.kpis.titulosAVencer7d).toBe(1);
        // contexto ao vivo: 2 filiais × 1
        expect(painel.lotes.length).toBe(2);
        expect(painel.kpis.lotesEnviados).toBe(2);
        // proveniência da ingestão
        expect(painel.ingestao.ultimaRunEm).toBe('2026-07-08T06:00:00.000Z');
    });

    it('marca emLote nos títulos já num lote RASCUNHO', async () => {
        const { service } = make({
            titulosAtivos: [
                titulo({ docCod: '100', titCod: '1' }),
                titulo({ docCod: '200', titCod: '1' }),
            ],
            emRascunho: [{ filCod: 2, docCod: '100', titCod: '1', loteId: 'L1', automatico: true }],
        });
        const painel = await service.montarPainel();
        expect(painel.titulos.find((t) => t.docCod === '100')?.emLote).toBe(true);
        expect(painel.titulos.find((t) => t.docCod === '200')?.emLote).toBe(false);
    });

    it('ADR-0050: a linha carrega o lote RASCUNHO do título', async () => {
        const { service } = make({
            titulosAtivos: [
                titulo({ docCod: '100', titCod: '1' }),
                titulo({ docCod: '200', titCod: '1' }),
            ],
            emRascunho: [
                { filCod: 2, docCod: '100', titCod: '1', loteId: 'L1', automatico: false },
                // mesma chave de documento em OUTRA filial: não pode vazar para a filial 2
                { filCod: 4, docCod: '200', titCod: '1', loteId: 'L9', automatico: true },
            ],
        });

        const painel = await service.montarPainel();
        const porDoc = (d: string) => painel.titulos.find((t) => t.docCod === d);

        expect(porDoc('100')?.loteRascunho).toEqual({ id: 'L1', automatico: false });
        expect(porDoc('200')?.loteRascunho).toBeUndefined();
        expect(porDoc('200')?.emLote).toBe(false);
    });

    it('ADR-0064: título em lote FINALIZADO/REMESSA_GERADA carrega o lote comprometido', async () => {
        const { service } = make({
            titulosAtivos: [
                titulo({ docCod: '100', titCod: '1' }),
                titulo({ docCod: '200', titCod: '1' }),
            ],
            comprometidos: [
                { filCod: 2, docCod: '100', titCod: '1', id: 'F1', status: 'FINALIZADO' },
                { filCod: 4, docCod: '200', titCod: '1', id: 'R9', status: 'REMESSA_GERADA' },
            ],
        });

        const painel = await service.montarPainel();
        const porDoc = (d: string) => painel.titulos.find((t) => t.docCod === d);

        expect(porDoc('100')?.loteComprometido).toEqual({ id: 'F1', status: 'FINALIZADO' });
        expect(porDoc('200')?.loteComprometido).toBeUndefined();
    });

    it('tolera falha de UMA leitura de contexto (loga warn e segue)', async () => {
        const listLotes = jest
            .fn()
            .mockRejectedValueOnce(new Error('conexos 504'))
            .mockResolvedValue([loteNativo()]);
        const { service, log } = make({ listLotes });
        const painel = await service.montarPainel();
        expect(painel.titulos.length).toBe(1); // títulos do banco intactos
        expect((log as unknown as { warn: jest.Mock }).warn).toHaveBeenCalled();
    });

    it('não conta títulos pagos nos KPIs', async () => {
        const { service } = make({ titulosAtivos: [titulo({ pago: true })] });
        const painel = await service.montarPainel();
        expect(painel.titulos.length).toBe(0);
        expect(painel.kpis.titulosAVencer7d).toBe(0);
    });
});

describe('SispagPainelService.listRetornos', () => {
    it('agrega arquivos por filial × config (ger015) e ordena por garCodSeq desc', async () => {
        const retornoConfigs = jest.fn().mockResolvedValue([{ bncCod: 4, gtbCodSeq: 1 }]);
        const retornoArquivos = jest
            .fn()
            .mockResolvedValueOnce([{ filCod: 2, bncCod: 4, gtbCodSeq: 1, garCodSeq: 5 }])
            .mockResolvedValueOnce([{ filCod: 4, bncCod: 4, gtbCodSeq: 1, garCodSeq: 9 }]);
        const { service } = make({ retornoConfigs, retornoArquivos });
        const arquivos = await service.listRetornos();
        expect(arquivos.map((a) => a.garCodSeq)).toEqual([9, 5]); // desc
        expect(retornoArquivos).toHaveBeenCalledTimes(2); // 2 filiais × 1 config
    });
});

describe('SispagPainelService.modalidadesDisponiveisDoLote', () => {
    it('devolve as formas disponíveis por título (ao vivo) do fin064, sem TED/PIX', async () => {
        // Do `fin064` só se aproveita o que não é TED/PIX: TED/PIX vêm do cadastro, e só com a
        // guarda do favorecido autorizado ligada (ADR-0065).
        const getLoteComItens = jest.fn().mockResolvedValue({
            id: 'L1',
            itens: [{ filCod: 2, docCod: '100', titCod: '1' }],
        });
        const getTituloAPagar = jest
            .fn()
            .mockResolvedValue({ modalidadesDisponiveis: ['PIX', 'CREDITO_CONTA'] });
        const { service } = make({ getLoteComItens, getTituloAPagar });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(itens).toEqual([{ docCod: '100', titCod: '1', modalidades: ['CREDITO_CONTA'] }]);
    });

    it('lote inexistente → lista vazia', async () => {
        const { service } = make({ getLoteComItens: jest.fn().mockResolvedValue(null) });
        expect(await service.modalidadesDisponiveisDoLote('X')).toEqual([]);
    });

    it('sem a guarda do favorecido autorizado TED/PIX NÃO são oferecidos (I14k), nem do fin064', async () => {
        const getLoteComItens = jest.fn().mockResolvedValue({
            id: 'L1',
            itens: [{ filCod: 2, docCod: '100', titCod: '1' }],
        });
        const getTituloAPagar = jest
            .fn()
            .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: ['PIX', 'TED'] });
        const listContasFavorecido = jest.fn().mockResolvedValue([{ pctCodSeq: 9, banco: 341 }]);
        const { service } = make({
            envVars: { sispagTedEnabled: true, sispagPixEnabled: true },
            getLoteComItens,
            getTituloAPagar,
            listContasFavorecido,
        });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(itens).toEqual([{ docCod: '100', titCod: '1', modalidades: [] }]);
        expect(listContasFavorecido).not.toHaveBeenCalled();
    });

    it('título que falha no fin064 não derruba os demais itens do lote', async () => {
        const getLoteComItens = jest.fn().mockResolvedValue({
            id: 'L1',
            itens: [
                { filCod: 2, docCod: '100', titCod: '1' },
                { filCod: 2, docCod: '200', titCod: '1' },
            ],
        });
        const getTituloAPagar = jest
            .fn()
            .mockRejectedValueOnce(new Error('504'))
            .mockResolvedValueOnce({ pesCod: 'P1', modalidadesDisponiveis: ['BOLETO'] });
        const listContasFavorecido = jest.fn().mockResolvedValue([{ pctCodSeq: 9, banco: 341 }]);
        const { service } = make({ getLoteComItens, getTituloAPagar, listContasFavorecido });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(itens[0]).toEqual({ docCod: '100', titCod: '1', modalidades: [] });
        expect(itens[1].modalidades).toEqual(['BOLETO']);
    });
    describe('execuções presas (aviso na tela)', () => {
        it('reporta zero quando não há órfão', async () => {
            const { service } = make();
            const painel = await service.montarPainel();
            expect(painel.execucoesParadas).toMatchObject({ remessa: 0, conciliacao: 0 });
        });

        it('conta os órfãos e entrega o flpCod para o operador levar ao fin015', async () => {
            const { service } = make({
                remessaLedger: {
                    listReconcilingParadas: jest
                        .fn()
                        .mockResolvedValue([
                            { idempotencyKey: 'remessa:L1', nativeFlpCod: 42 },
                            { idempotencyKey: 'remessa:L2' },
                        ]),
                },
            });

            const painel = await service.montarPainel();

            expect(painel.execucoesParadas.remessa).toBe(2);
            // Só o que TEM número entra na lista; o outro é o caso "morreu antes de
            // registrarmos", que a tela trata com outra frase.
            expect(painel.execucoesParadas.lotesNativos).toEqual([42]);
        });

        it('falha ao ler o ledger NÃO derruba o painel', async () => {
            // Ficar sem o aviso é ruim; ficar sem a tela de pagamentos é pior.
            const { service } = make({
                remessaLedger: {
                    listReconcilingParadas: jest.fn().mockRejectedValue(new Error('db fora')),
                },
            });

            const painel = await service.montarPainel();

            expect(painel.execucoesParadas).toMatchObject({ remessa: 0, conciliacao: 0 });
            expect(painel.titulos).toBeDefined();
        });
    });
});

describe('SispagPainelService.modalidadesDisponiveisDoLote — BOLETO vem do banco', () => {
    const loteDe = (itens: Array<{ filCod: number; docCod: string; titCod: string }>) =>
        jest.fn().mockResolvedValue({ id: 'L1', itens });

    it('oferece BOLETO quando o título tem boleto DDA persistido', () => {
        // A ingestão já resolveu o flag de DDA; o painel lê do banco em vez de refazer
        // o grid de pendentes (que custava +7 requisições Conexos por abertura).
        return (async () => {
            const { service } = make({
                getLoteComItens: loteDe([{ filCod: 2, docCod: '100', titCod: '1' }]),
                getTituloAPagar: jest.fn().mockResolvedValue({ modalidadesDisponiveis: [] }),
                listChavesComBoleto: jest.fn().mockResolvedValue(new Set(['2:100:1'])),
            });
            const itens = await service.modalidadesDisponiveisDoLote('L1');
            expect(itens[0].modalidades).toEqual(['BOLETO']);
        })();
    });

    it('NÃO oferece BOLETO para título sem boleto persistido', async () => {
        const { service } = make({
            getLoteComItens: loteDe([{ filCod: 2, docCod: '100', titCod: '1' }]),
            getTituloAPagar: jest.fn().mockResolvedValue({ modalidadesDisponiveis: [] }),
            listChavesComBoleto: jest.fn().mockResolvedValue(new Set(['2:999:1'])),
        });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(itens[0].modalidades).toEqual([]);
    });

    it('NÃO vai ao Conexos para descobrir boleto — lê do banco', async () => {
        // Regressão do card performance-1: a versão anterior fazia listContasCorrentes +
        // listarLotesNativos + listarTitulosPendentes paginado por filial, a cada abertura.
        const listContas = jest.fn().mockResolvedValue([{ ccoCod: 1, bncCod: 4 }]);
        const listChavesComBoleto = jest.fn().mockResolvedValue(new Set<string>());
        const { service } = make({
            getLoteComItens: loteDe([{ filCod: 2, docCod: '100', titCod: '1' }]),
            getTituloAPagar: jest.fn().mockResolvedValue({ modalidadesDisponiveis: [] }),
            listContasCorrentes: listContas,
            listChavesComBoleto,
        });
        await service.modalidadesDisponiveisDoLote('L1');
        expect(listChavesComBoleto).toHaveBeenCalledWith(2);
        expect(listContas).not.toHaveBeenCalled();
    });

    it('uma consulta por FILIAL do lote (I4 garante que é uma só)', async () => {
        const listChavesComBoleto = jest.fn().mockResolvedValue(new Set<string>());
        const { service } = make({
            getLoteComItens: loteDe([
                { filCod: 2, docCod: '100', titCod: '1' },
                { filCod: 2, docCod: '200', titCod: '1' },
                { filCod: 2, docCod: '300', titCod: '1' },
            ]),
            getTituloAPagar: jest.fn().mockResolvedValue({ modalidadesDisponiveis: [] }),
            listChavesComBoleto,
        });
        await service.modalidadesDisponiveisDoLote('L1');
        expect(listChavesComBoleto).toHaveBeenCalledTimes(1);
    });
});

describe('SispagPainelService.linhasDigitaveisDoLote', () => {
    const loteGerado = (over: Record<string, unknown> = {}) => ({
        id: 'lote-1',
        filCod: 2,
        status: 'REMESSA_GERADA',
        nativeFilCod: 2,
        nativeBncCod: 4,
        nativeFlpCod: 7,
        itens: [],
        ...over,
    });

    it('devolve as linhas digitáveis do lote com remessa gerada', async () => {
        const linhas = [{ docCod: '10400', titCod: '1', linhaDigitavel: '1'.repeat(47) }];
        const { service, listarLinhasDigitaveisDoLote } = make({
            getLoteComItens: jest.fn().mockResolvedValue(loteGerado()),
            listarLinhasDigitaveisDoLote: jest.fn().mockResolvedValue(linhas),
        });
        await expect(service.linhasDigitaveisDoLote('lote-1')).resolves.toEqual(linhas);
        expect(listarLinhasDigitaveisDoLote).toHaveBeenCalledWith({
            filCod: 2,
            bncCod: 4,
            flpCod: 7,
        });
    });

    it('lote RASCUNHO → lista vazia SEM chamar o ERP', async () => {
        // Em rascunho o item nem existe no fin015: chamar seria gastar uma ida ao ERP para
        // receber vazio de volta.
        const { service, listarLinhasDigitaveisDoLote } = make({
            getLoteComItens: jest
                .fn()
                .mockResolvedValue(loteGerado({ status: 'RASCUNHO', nativeFlpCod: undefined })),
        });
        await expect(service.linhasDigitaveisDoLote('lote-1')).resolves.toEqual({
            itens: [],
            total: 0,
            dropped: 0,
        });
        expect(listarLinhasDigitaveisDoLote).not.toHaveBeenCalled();
    });

    it('lote inexistente → lista vazia, sem exceção', async () => {
        const { service } = make({ getLoteComItens: jest.fn().mockResolvedValue(null) });
        await expect(service.linhasDigitaveisDoLote('nao-existe')).resolves.toEqual({
            itens: [],
            total: 0,
            dropped: 0,
        });
    });

    it('falha do ERP → lista vazia + BUSINESS_WARN (o card não quebra por um botão)', async () => {
        const { service, log } = make({
            getLoteComItens: jest.fn().mockResolvedValue(loteGerado()),
            listarLinhasDigitaveisDoLote: jest.fn().mockRejectedValue(new Error('erp fora')),
        });
        await expect(service.linhasDigitaveisDoLote('lote-1')).resolves.toEqual({
            itens: [],
            total: 0,
            dropped: 0,
        });
        expect(log.warn).toHaveBeenCalled();
    });

    it('nunca loga a linha digitável completa', async () => {
        const completa = '1'.repeat(47);
        const { service, log } = make({
            getLoteComItens: jest.fn().mockResolvedValue(loteGerado()),
            listarLinhasDigitaveisDoLote: jest.fn().mockResolvedValue({
                itens: [{ docCod: '1', titCod: '1', linhaDigitavel: completa }],
                // `dropped > 0` para que o log NOVO (recusa no boundary) também entre na
                // varredura: é um sítio a mais de onde a linha poderia vazar.
                total: 2,
                dropped: 1,
            }),
        });
        await service.linhasDigitaveisDoLote('lote-1');
        const chamadas = (fn: unknown) => (fn as jest.Mock).mock.calls;
        const tudoQueFoiLogado = JSON.stringify([...chamadas(log.info), ...chamadas(log.warn)]);
        expect(tudoQueFoiLogado).not.toContain(completa);
    });

    it('linha recusada no boundary vira BUSINESS_WARN com a contagem', async () => {
        // A recusa não pode morrer no client: sem este log, a única testemunha de um código
        // corrompido seria a analista reparando num botão que faltou.
        const { service, log } = make({
            getLoteComItens: jest.fn().mockResolvedValue(loteGerado()),
            listarLinhasDigitaveisDoLote: jest
                .fn()
                .mockResolvedValue({ itens: [], total: 3, dropped: 3 }),
        });
        await service.linhasDigitaveisDoLote('lote-1');
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ total: 3, dropped: 3 }) }),
        );
    });

    it('sem recusa não há warn — o caminho normal é silencioso', async () => {
        const { service, log } = make({
            getLoteComItens: jest.fn().mockResolvedValue(loteGerado()),
            listarLinhasDigitaveisDoLote: jest
                .fn()
                .mockResolvedValue({ itens: [], total: 0, dropped: 0 }),
        });
        await service.linhasDigitaveisDoLote('lote-1');
        expect(log.warn).not.toHaveBeenCalled();
    });
});

describe('SispagPainelService.modalidadesDisponiveisDoLote — TED/PIX (ADR-0054, ADR-0065)', () => {
    const FLAGS = {
        sispagFavorecidoAutorizadoEnabled: true,
        sispagTedEnabled: true,
        sispagPixEnabled: true,
    };
    const loteCom = (itens: Array<Record<string, unknown>>) =>
        jest.fn().mockResolvedValue({ id: 'L1', itens });
    const item = { filCod: 2, docCod: '100', titCod: '1' };

    it('guarda ligada mas flag da modalidade desligada: só a ligada é oferecida', async () => {
        const { service } = make({
            envVars: { ...FLAGS, sispagTedEnabled: false },
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
            listContasFavorecido: jest.fn().mockResolvedValue([{ pctCodSeq: 9, banco: 237 }]),
        });
        const [r] = await service.modalidadesDisponiveisDoLote('L1');
        expect(r?.modalidades).toEqual(['PIX']);
        expect(r?.destinos).not.toHaveProperty('TED');
    });

    it('PIX do fin064 não vale: a fonte é o cmnPessoasPix', async () => {
        const { service } = make({
            envVars: FLAGS,
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: ['PIX'] }),
            listChavesPixFavorecido: jest.fn().mockResolvedValue([]),
        });
        const [r] = await service.modalidadesDisponiveisDoLote('L1');
        expect(r?.destinos?.PIX).toEqual({ origem: 'NENHUM' });
    });

    it('devolve origem e destino MASCARADO por modalidade, nunca o valor completo', async () => {
        const { service } = make({
            envVars: FLAGS,
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
            listContasFavorecido: jest.fn().mockResolvedValue([
                {
                    pctCodSeq: 9,
                    banco: 1,
                    agencia: '4321',
                    conta: '99887766',
                    dvConta: '5',
                    padrao: true,
                },
            ]),
            listChavesPixFavorecido: jest.fn().mockResolvedValue([
                {
                    cixCod: 3,
                    chave: 'pix.secreto@x.com.br',
                    tipo: 'EMAIL',
                    padrao: true,
                    pesCod: 'P1',
                },
            ]),
        });
        const [r] = await service.modalidadesDisponiveisDoLote('L1');
        expect(r?.modalidades).toEqual(['TED', 'PIX']);
        expect(r?.destinos).toEqual({
            TED: { origem: 'CADASTRO', destinoMascarado: 'banco 001 · ag. 4321 · cc ****7766-5' },
            PIX: { origem: 'CADASTRO', destinoMascarado: 'PIX e-mail p***@x.com.br' },
        });
        const json = JSON.stringify(r);
        for (const v of ['99887766', 'pix.secreto@x.com.br']) {
            expect(json).not.toContain(v);
        }
    });

    it('D12 — PIX por chave CPF/CNPJ do favorecido vem marcado (campo aditivo)', async () => {
        const { service } = make({
            envVars: FLAGS,
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
            listContasFavorecido: jest
                .fn()
                .mockResolvedValue([{ pctCodSeq: 9, banco: 237, conta: '55554444', padrao: true }]),
            listChavesPixFavorecido: jest.fn().mockResolvedValue([
                { cixCod: 3, chave: 'a@x.com.br', tipo: 'EMAIL', padrao: true, pesCod: 'P1' },
                { cixCod: 4, chave: '11144477735', tipo: 'CPF_CNPJ', padrao: false, pesCod: 'P1' },
            ]),
            getDocumentoFavorecido: jest.fn().mockResolvedValue('11144477735'),
        });
        const [r] = await service.modalidadesDisponiveisDoLote('L1');
        expect(r?.destinos?.PIX).toEqual({
            origem: 'CADASTRO',
            destinoMascarado: 'PIX CPF/CNPJ ***.444.777-**',
            chaveCpfCnpjDoFavorecido: true,
        });
        expect(r?.destinos?.TED).not.toHaveProperty('chaveCpfCnpjDoFavorecido');
        expect(JSON.stringify(r)).not.toContain('11144477735');
    });

    it('leitura de cadastro que falha: oferece com origem NENHUM (a verificação barra, I13b)', async () => {
        const { service } = make({
            envVars: FLAGS,
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
            listContasFavorecido: jest.fn().mockRejectedValue(new Error('504')),
            listChavesPixFavorecido: jest.fn().mockRejectedValue(new Error('504')),
        });
        const [r] = await service.modalidadesDisponiveisDoLote('L1');
        expect(r?.modalidades).toEqual(['TED', 'PIX']);
        expect(r?.destinos).toEqual({ TED: { origem: 'NENHUM' }, PIX: { origem: 'NENHUM' } });
    });

    // I10b: a origem que a tela mostra é a MESMA que o envio resolveria.
    const fixtures: Array<{ nome: string; contas: unknown[]; chaves: unknown[] }> = [
        {
            nome: 'conta em outro banco',
            contas: [{ pctCodSeq: 1, banco: 237, padrao: true }],
            chaves: [],
        },
        { nome: 'sem conta (só inativa, já filtrada)', contas: [], chaves: [] },
        {
            nome: 'duas contas',
            contas: [
                { pctCodSeq: 1, banco: 1 },
                { pctCodSeq: 2, banco: 341, padrao: true },
            ],
            chaves: [],
        },
        {
            nome: 'só chave PIX',
            contas: [],
            chaves: [{ cixCod: 1, chave: 'a@b.com', tipo: 'EMAIL', padrao: true, pesCod: 'P1' }],
        },
    ];
    for (const f of fixtures) {
        it(`oferta = envio: ${f.nome}`, async () => {
            const listContasFavorecido = jest.fn().mockResolvedValue(f.contas);
            const listChavesPixFavorecido = jest.fn().mockResolvedValue(f.chaves);
            const { service, resolver } = make({
                envVars: FLAGS,
                getLoteComItens: loteCom([item]),
                getTituloAPagar: jest
                    .fn()
                    .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
                listContasFavorecido,
                listChavesPixFavorecido,
            });
            const [oferta] = await service.modalidadesDisponiveisDoLote('L1');
            const flags = { ted: true, pix: true };
            for (const modalidade of ['TED', 'PIX'] as const) {
                const envio = await resolver.resolve(
                    { modalidade },
                    { flags, febrabanLote: 341, filCod: 2, pesCod: 'P1' },
                );
                expect(oferta?.modalidades).toContain(modalidade);
                expect(oferta?.destinos?.[modalidade]?.origem).toBe(envio.origem);
            }
        });
    }
});
