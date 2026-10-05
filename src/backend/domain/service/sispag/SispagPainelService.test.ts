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
import type ExcecaoDestinoRepository from '../../repository/sispag/ExcecaoDestinoRepository.js';
import DestinoPagamentoResolver from './DestinoPagamentoResolver.js';
import type ExcecaoSubstituicaoService from './ExcecaoSubstituicaoService.js';
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
        /** Exceção APROVADA por tipo que o `findAprovada` devolve (ADR-0061). */
        excecaoAprovada?: Partial<Record<'CONTA' | 'CHAVE_PIX', unknown>>;
        substituicao?: { aposentar: jest.Mock };
        painelExcecoes?: { contarPorEstado: jest.Mock; contarPendentesAntigas: jest.Mock };
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
    const excecoes = {
        findAprovada: jest
            .fn()
            .mockImplementation(
                async (_pes: string, tipo: 'CONTA' | 'CHAVE_PIX') =>
                    over.excecaoAprovada?.[tipo] ?? null,
            ),
    };
    const substituicao = over.substituicao ?? {
        aposentar: jest.fn().mockResolvedValue({ aposentada: true, divergiu: false }),
    };
    // Contadores do painel (ADR-0061 T11) — só contagens.
    const painelExcecoes = over.painelExcecoes ?? {
        contarPorEstado: jest.fn().mockResolvedValue({
            PENDENTE: 2,
            APROVADA: 5,
            REJEITADA: 1,
            SUBSTITUIDA: 3,
            REVOGADA: 0,
        }),
        contarPendentesAntigas: jest.fn().mockResolvedValue(1),
    };
    const resolver = new DestinoPagamentoResolver(
        sispag,
        new MaskDestino(),
        excecoes as unknown as ExcecaoDestinoRepository,
        substituicao as unknown as ExcecaoSubstituicaoService,
    );
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
        painelExcecoes as unknown as ExcecaoDestinoRepository,
    );
    return {
        service,
        log,
        listChavesComBoleto,
        listarLinhasDigitaveisDoLote,
        resolver,
        painelExcecoes,
    };
};

describe('SispagPainelService.montarPainel — exceções de destino (ADR-0061, T11)', () => {
    it('flag ligada: contagem por estado e pendentes antigas, sem nenhum valor de destino', async () => {
        const { service, painelExcecoes } = make({
            envVars: { sispagExcecaoDestinoEnabled: true },
        });
        const painel = await service.montarPainel();
        expect(painelExcecoes.contarPendentesAntigas).toHaveBeenCalledWith(7);
        expect(painel.excecoes).toEqual({
            porEstado: { PENDENTE: 2, APROVADA: 5, REJEITADA: 1, SUBSTITUIDA: 3, REVOGADA: 0 },
            pendentesAntigas: 1,
            diasLimite: 7,
        });
    });

    it('flag desligada: o campo não existe e nada é consultado (paridade com o main)', async () => {
        const { service, painelExcecoes } = make({});
        const painel = await service.montarPainel();
        expect(painel).not.toHaveProperty('excecoes');
        expect(painelExcecoes.contarPorEstado).not.toHaveBeenCalled();
    });

    it('contagem que falha NÃO derruba o painel: omite o campo e avisa', async () => {
        const falha = {
            contarPorEstado: jest.fn().mockRejectedValue(new Error('banco fora')),
            contarPendentesAntigas: jest.fn().mockResolvedValue(0),
        };
        const { service, log } = make({
            envVars: { sispagExcecaoDestinoEnabled: true },
            painelExcecoes: falha,
        });
        const painel = await service.montarPainel();
        expect(painel).not.toHaveProperty('excecoes');
        expect(painel.titulosTotal).toBeGreaterThanOrEqual(0);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('contagem das exceções de destino'),
            }),
        );
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
    it('devolve as formas disponíveis por título (ao vivo) do fin064', async () => {
        // Do `fin064` só sai PIX. BOLETO saía de `titEspCodbar`, que é null em 100% dos
        // títulos de produção — a detecção nunca disparava. Agora vem do flag de DDA.
        const getLoteComItens = jest.fn().mockResolvedValue({
            id: 'L1',
            itens: [{ filCod: 2, docCod: '100', titCod: '1' }],
        });
        const getTituloAPagar = jest.fn().mockResolvedValue({ modalidadesDisponiveis: ['PIX'] });
        const { service } = make({ getLoteComItens, getTituloAPagar });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(itens).toEqual([{ docCod: '100', titCod: '1', modalidades: ['PIX'] }]);
    });

    it('lote inexistente → lista vazia', async () => {
        const { service } = make({ getLoteComItens: jest.fn().mockResolvedValue(null) });
        expect(await service.modalidadesDisponiveisDoLote('X')).toEqual([]);
    });

    it('TED/crédito vêm da conta do favorecido, não do fin064', async () => {
        const getLoteComItens = jest.fn().mockResolvedValue({
            id: 'L1',
            itens: [{ filCod: 2, docCod: '100', titCod: '1' }],
        });
        const getTituloAPagar = jest
            .fn()
            .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] });
        const listContasFavorecido = jest.fn().mockResolvedValue([{ pctCodSeq: 9, banco: 341 }]);
        const { service } = make({ getLoteComItens, getTituloAPagar, listContasFavorecido });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(itens[0].modalidades).toEqual(['TED']);
        expect(listContasFavorecido).toHaveBeenCalledWith('P1', 2);
    });

    it('agrupa por (filial, favorecido): 3 títulos do mesmo pesCod = 1 consulta de contas', async () => {
        const getLoteComItens = jest.fn().mockResolvedValue({
            id: 'L1',
            itens: [
                { filCod: 2, docCod: '100', titCod: '1' },
                { filCod: 2, docCod: '100', titCod: '2' },
                { filCod: 2, docCod: '200', titCod: '1' },
            ],
        });
        const getTituloAPagar = jest.fn().mockResolvedValue({ pesCod: 'P1' });
        const listContasFavorecido = jest.fn().mockResolvedValue([{ pctCodSeq: 9, banco: 341 }]);
        const { service } = make({ getLoteComItens, getTituloAPagar, listContasFavorecido });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(getTituloAPagar).toHaveBeenCalledTimes(3); // 1 por título — são títulos distintos
        expect(listContasFavorecido).toHaveBeenCalledTimes(1); // 1 por favorecido distinto
        expect(itens.every((i) => i.modalidades.includes('TED'))).toBe(true);
    });

    it('o mesmo favorecido em filiais diferentes são consultas diferentes', async () => {
        const getLoteComItens = jest.fn().mockResolvedValue({
            id: 'L1',
            itens: [
                { filCod: 2, docCod: '100', titCod: '1' },
                { filCod: 4, docCod: '200', titCod: '1' },
            ],
        });
        const getTituloAPagar = jest.fn().mockResolvedValue({ pesCod: 'P1' });
        const listContasFavorecido = jest.fn().mockResolvedValue([]);
        const { service } = make({ getLoteComItens, getTituloAPagar, listContasFavorecido });
        await service.modalidadesDisponiveisDoLote('L1');
        expect(listContasFavorecido).toHaveBeenCalledTimes(2);
        expect(listContasFavorecido).toHaveBeenCalledWith('P1', 2);
        expect(listContasFavorecido).toHaveBeenCalledWith('P1', 4);
    });

    it('consulta de contas que falha não vira TED/crédito (não promete destino inexistente)', async () => {
        const getLoteComItens = jest.fn().mockResolvedValue({
            id: 'L1',
            itens: [{ filCod: 2, docCod: '100', titCod: '1' }],
        });
        const getTituloAPagar = jest
            .fn()
            .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: ['PIX'] });
        const listContasFavorecido = jest.fn().mockRejectedValue(new Error('504'));
        const { service } = make({ getLoteComItens, getTituloAPagar, listContasFavorecido });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(itens[0].modalidades).toEqual(['PIX']);
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
        expect(itens[1].modalidades).toEqual(['BOLETO', 'TED']);
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

describe('SispagPainelService.modalidadesDisponiveisDoLote — TED/PIX (ADR-0054)', () => {
    const FLAGS = {
        sispagTedEnabled: true,
        sispagPixEnabled: true,
        sispagExcecaoDestinoEnabled: true,
    };
    const EXC_CONTA = {
        tipo: 'CONTA' as const,
        bancoCod: '001',
        agencia: '4321',
        conta: '99887766',
        contaDv: '5',
        titularDocumento: '11144477735',
    };
    const EXC_PIX = {
        tipo: 'CHAVE_PIX' as const,
        chavePixTipo: 'CPF_CNPJ' as const,
        chavePix: '11144477735',
        titularDocumento: '11144477735',
    };
    /** `ExcecaoDestino` APROVADA completa, como o repositório a devolve. */
    const aprovada = (destino: typeof EXC_CONTA | typeof EXC_PIX, id = 'EXC-1') => ({
        id,
        pesCod: 'P1',
        filCod: 2,
        destino,
        estado: 'APROVADA',
        origem: 'MANUAL',
        justificativa: 'j',
        cadastradoPor: 'ana',
        cadastradoEm: '2026-10-05T10:00:00.000Z',
        aprovadoPor: 'bia',
        versao: 2,
    });
    const loteCom = (itens: Array<Record<string, unknown>>) =>
        jest.fn().mockResolvedValue({ id: 'L1', itens });
    const item = { filCod: 2, docCod: '100', titCod: '1' };

    it('flags desligadas: a resposta não ganha o campo `destinos` (igual ao main)', async () => {
        const { service } = make({
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
            listContasFavorecido: jest.fn().mockResolvedValue([{ pctCodSeq: 9, banco: 237 }]),
        });
        const itens = await service.modalidadesDisponiveisDoLote('L1');
        expect(itens).toEqual([{ docCod: '100', titCod: '1', modalidades: ['TED'] }]);
    });

    it('PIX do fin064 deixa de valer com a flag PIX ligada (fonte certa é o cmnPessoasPix)', async () => {
        const { service } = make({
            envVars: { sispagPixEnabled: true },
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: ['PIX'] }),
            listChavesPixFavorecido: jest.fn().mockResolvedValue([]),
        });
        const [r] = await service.modalidadesDisponiveisDoLote('L1');
        expect(r?.modalidades).not.toContain('PIX');
    });

    it('devolve origem e destino MASCARADO por modalidade, nunca o valor completo', async () => {
        // TED: cadastro sem conta → exceção APROVADA. PIX: chave do cadastro (o cadastro vence).
        const { service } = make({
            envVars: FLAGS,
            excecaoAprovada: { CONTA: aprovada(EXC_CONTA) },
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
            listContasFavorecido: jest.fn().mockResolvedValue([]),
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
            TED: { origem: 'EXCECAO', destinoMascarado: 'banco 001 · ag. 4321 · cc ****7766-5' },
            PIX: { origem: 'CADASTRO', destinoMascarado: 'PIX e-mail p***@x.com.br' },
        });
        const json = JSON.stringify(r);
        for (const v of ['99887766', 'pix.secreto@x.com.br', '11144477735']) {
            expect(json).not.toContain(v);
        }
    });

    it('cadastro com conta ativa VENCE a exceção APROVADA: origem CADASTRO', async () => {
        const { service } = make({
            envVars: FLAGS,
            excecaoAprovada: { CONTA: aprovada(EXC_CONTA) },
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
            listContasFavorecido: jest
                .fn()
                .mockResolvedValue([{ pctCodSeq: 9, banco: 237, conta: '55554444', padrao: true }]),
        });
        const [r] = await service.modalidadesDisponiveisDoLote('L1');
        expect(r?.destinos?.TED?.origem).toBe('CADASTRO');
    });

    it('a oferta é LEITURA: nunca aposenta exceção (só o finalizar pede aposentarExcecao)', async () => {
        const substituicao = { aposentar: jest.fn() };
        const { service } = make({
            envVars: FLAGS,
            substituicao,
            excecaoAprovada: { CONTA: aprovada(EXC_CONTA) },
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
            listContasFavorecido: jest
                .fn()
                .mockResolvedValue([{ pctCodSeq: 9, banco: 237, conta: '55554444', padrao: true }]),
        });
        await service.modalidadesDisponiveisDoLote('L1');
        expect(substituicao.aposentar).not.toHaveBeenCalled();
        await service.modalidadesDisponiveisDoLote('L1', { aposentarExcecao: true });
        expect(substituicao.aposentar).toHaveBeenCalledTimes(1);
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

    it('D12 — exceção PIX (só CPF/CNPJ, I12i) também conta como do favorecido', async () => {
        const { service } = make({
            envVars: FLAGS,
            excecaoAprovada: { CHAVE_PIX: aprovada(EXC_PIX) },
            getLoteComItens: loteCom([item]),
            getTituloAPagar: jest
                .fn()
                .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
        });
        const [r] = await service.modalidadesDisponiveisDoLote('L1');
        expect(r?.destinos?.PIX).toMatchObject({
            origem: 'EXCECAO',
            chaveCpfCnpjDoFavorecido: true,
        });
    });

    it('leitura de cadastro que falha não oferece (na dúvida, não promete destino)', async () => {
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
        expect(r?.modalidades).toEqual([]);
    });

    // Caso 3 (I10b): oferta = envio. Para cada fixture, a oferta diz TED/PIX SE E SÓ SE o
    // resolver — o mesmo que o envio usa — resolve.
    const fixtures: Array<{
        nome: string;
        contas: unknown[];
        chaves: unknown[];
        excecao?: typeof EXC_CONTA;
    }> = [
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
        { nome: 'exceção APROVADA sem cadastro', contas: [], chaves: [], excecao: EXC_CONTA },
    ];
    for (const f of fixtures) {
        it(`oferta = envio: ${f.nome}`, async () => {
            const listContasFavorecido = jest.fn().mockResolvedValue(f.contas);
            const listChavesPixFavorecido = jest.fn().mockResolvedValue(f.chaves);
            const { service, resolver } = make({
                envVars: FLAGS,
                excecaoAprovada: f.excecao ? { CONTA: aprovada(f.excecao) } : {},
                getLoteComItens: loteCom([item]),
                getTituloAPagar: jest
                    .fn()
                    .mockResolvedValue({ pesCod: 'P1', modalidadesDisponiveis: [] }),
                listContasFavorecido,
                listChavesPixFavorecido,
            });
            const [oferta] = await service.modalidadesDisponiveisDoLote('L1');
            const flags = { ted: true, pix: true, excecao: true };
            for (const modalidade of ['TED', 'PIX'] as const) {
                const envio = await resolver.resolve(
                    { modalidade },
                    { flags, febrabanLote: 341, filCod: 2, pesCod: 'P1' },
                );
                expect(oferta?.modalidades.includes(modalidade)).toBe(envio.origem !== 'NENHUM');
            }
        });
    }
});
