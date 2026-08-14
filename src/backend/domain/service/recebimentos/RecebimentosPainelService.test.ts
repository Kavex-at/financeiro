import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import { CATEGORIAS_TESOURARIA } from '../../interface/recebimentos/constants.js';
import type RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import type TransacaoRepository from '../../repository/recebimentos/TransacaoRepository.js';
import RecebimentosPainelService from './RecebimentosPainelService.js';

const build = (
    o: {
        transacoes?: unknown[];
        kpis?: Record<string, number>;
        valores?: Record<string, { total: number; alocado: number; emAberto: number }>;
        falhas?: Map<string, unknown>;
    } = {},
) => {
    const transacaoRepo = {
        listParaPainel: jest.fn().mockResolvedValue(o.transacoes ?? []),
        contarKpis: jest.fn().mockResolvedValue(o.kpis ?? { importada: 1758, conciliada: 1 }),
        somarValorPorStatus: jest.fn().mockResolvedValue(
            o.valores ?? {
                importada: { total: 250000, alocado: 0, emAberto: 250000 },
                parcial: { total: 1000, alocado: 0, emAberto: 1000 },
            },
        ),
    } as unknown as jest.Mocked<TransacaoRepository>;

    const runRepo = {
        findLatestSuccessFinishedAt: jest.fn().mockResolvedValue('2026-07-30T12:00:00.000Z'),
    } as unknown as jest.Mocked<RecebimentoIngestaoRunRepository>;

    const base = {
        getFiliais: jest.fn().mockResolvedValue([{ filCod: 1 }, { filCod: 2 }]),
    } as unknown as jest.Mocked<ConexosBaseClient>;

    // A coluna de modalidade (ADR-0033) tem fontes próprias; estes testes são sobre KPIs/janela, e
    // os stubs vazios deixam `enriquecerComModalidade` num no-op observável (nenhuma `modalidade`).
    const processoProvider = {
        listProcessosDaFilial: jest.fn().mockResolvedValue([]),
    } as never;
    const execucaoRepo = {
        listModalidadePorTxnIds: jest.fn().mockResolvedValue(new Map()),
        listUltimaFalhaPorTxnIds: jest.fn().mockResolvedValue(o.falhas ?? new Map()),
    };

    return {
        transacaoRepo,
        runRepo,
        base,
        execucaoRepo,
        service: new RecebimentosPainelService(
            transacaoRepo,
            runRepo,
            base,
            processoProvider,
            execucaoRepo as never,
        ),
    };
};

describe('RecebimentosPainelService', () => {
    it('KPIs vêm do COUNT do banco, não da lista paginada', async () => {
        // Com o cap de 500, KPIs derivados da página contariam 500 de 1.759.
        const { service } = build({
            transacoes: [{}, {}],
            kpis: { importada: 1758, conciliada: 1 },
        });
        const painel = await service.montarPainel();

        expect(painel.transacoes).toHaveLength(2);
        expect(painel.kpis.importadas).toBe(1758);
        expect(painel.kpis.conciliadas).toBe(1);
    });

    it('esconde as categorias de tesouraria por default', async () => {
        const { service, transacaoRepo } = build();
        const painel = await service.montarPainel();

        expect(painel.categoriasOcultas).toEqual([...CATEGORIAS_TESOURARIA]);
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ categoriasExcluidas: [...CATEGORIAS_TESOURARIA] }),
        );
    });

    it('incluirTesouraria remove o filtro — o dado nunca foi apagado', async () => {
        const { service, transacaoRepo } = build();
        const painel = await service.montarPainel({ incluirTesouraria: true });

        expect(painel.categoriasOcultas).toEqual([]);
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ categoriasExcluidas: [] }),
        );
    });

    it('só lista CRÉDITO — débito não é recebimento', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel();
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ tipos: ['CREDITO'] }),
        );
    });

    it('usa as filiais permitidas do usuário quando existem', async () => {
        const { service, transacaoRepo, base } = build();
        await service.montarPainel({ filCodsPermitidas: [3] });
        expect(base.getFiliais).not.toHaveBeenCalled();
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ filCods: [3] }),
        );
    });

    it('sem allow-list cai para todas as filiais do ERP', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel();
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ filCods: [1, 2] }),
        );
    });

    it('marca truncado quando a lista bate no teto', async () => {
        const { service } = build({ transacoes: Array.from({ length: 10 }, () => ({})) });
        expect((await service.montarPainel({ limit: 10 })).truncado).toBe(true);
        expect((await service.montarPainel({ limit: 50 })).truncado).toBe(false);
    });

    it('o limit nunca ultrapassa o cap, mesmo pedido maior', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel({ limit: 99999 });
        const [{ limit }] = (transacaoRepo.listParaPainel as jest.Mock).mock.calls[0];
        expect(limit).toBe(500);
    });

    it('expõe a última ingestão e a fonte banco — sem caminho de demonstração', async () => {
        const { service } = build();
        const painel = await service.montarPainel();
        expect(painel.fonte).toBe('banco');
        expect(painel.ultimaIngestao).toBe('2026-07-30T12:00:00.000Z');
    });

    it('valorNaoAlocado soma importadas + parciais', async () => {
        const { service } = build();
        expect((await service.montarPainel()).kpis.valorNaoAlocado).toBe(251000);
    });
});

describe('RecebimentosPainelService — filtro de status e falhas (ADR-0034)', () => {
    it('valorNaoAlocado usa o saldo em aberto, já cortado em zero por crédito no SQL', async () => {
        const { service } = build({
            valores: {
                importada: { total: 250000, alocado: 0, emAberto: 250000 },
                parcial: { total: 100000, alocado: 90000, emAberto: 10000 },
            },
        });
        // 250.000 + 10.000. Antes o parcial entrava pelos 100 mil de face, com a tela rotulando a
        // linha como parcialmente baixada logo abaixo do KPI que a contava inteira.
        expect((await service.montarPainel()).kpis.valorNaoAlocado).toBe(260000);
    });

    it('valorNaoAlocado ignora processada', async () => {
        const { service } = build({
            valores: {
                importada: { total: 1000, alocado: 0, emAberto: 1000 },
                processada: { total: 50000, alocado: 50000, emAberto: 0 },
                erro: { total: 700, alocado: 300, emAberto: 400 },
            },
        });
        expect((await service.montarPainel()).kpis.valorNaoAlocado).toBe(1400);
    });

    it('sobre-alocação de um crédito NÃO cancela o saldo aberto de outro do mesmo grupo', async () => {
        const { service } = build({
            valores: {
                // Grupo com um crédito sobre-alocado (1.000 de face, 1.500 alocados) e outro intacto
                // (500 de face, 0 alocados). Somar `total − alocado` no grupo daria ZERO e esconderia
                // os 500 reais a distribuir. O SQL corta por linha, então chega 500 aqui.
                importada: { total: 1500, alocado: 1500, emAberto: 500 },
            },
        });
        expect((await service.montarPainel()).kpis.valorNaoAlocado).toBe(500);
    });

    it('expõe o KPI de processadas', async () => {
        const { service } = build({ kpis: { importada: 10, processada: 42 } });
        expect((await service.montarPainel()).kpis.processadas).toBe(42);
    });

    it('pendentes filtra tudo menos processada, e SÓ na lista', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel({ status: 'pendentes' });

        const [listArgs] = (transacaoRepo.listParaPainel as jest.Mock).mock.calls[0];
        expect(listArgs.statuses).toEqual(
            expect.arrayContaining(['importada', 'conciliada', 'parcial', 'manual', 'erro']),
        );
        expect(listArgs.statuses).not.toContain('processada');

        // O trap: se `statuses` escorregar para os KPIs, as contagens dos cards mudariam conforme a
        // aba aberta — exatamente o que a decisão nº 1 do serviço existe para prevenir.
        const [kpiArgs] = (transacaoRepo.contarKpis as jest.Mock).mock.calls[0];
        const [somaArgs] = (transacaoRepo.somarValorPorStatus as jest.Mock).mock.calls[0];
        expect(kpiArgs.statuses).toBeUndefined();
        expect(somaArgs.statuses).toBeUndefined();
    });

    it('todas (e ausente) não filtram status', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel({ status: 'todas' });
        await service.montarPainel();
        for (const [args] of (transacaoRepo.listParaPainel as jest.Mock).mock.calls) {
            expect(args.statuses).toBeUndefined();
        }
    });

    it('um status concreto vira lista de um', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel({ status: 'erro' });
        const [listArgs] = (transacaoRepo.listParaPainel as jest.Mock).mock.calls[0];
        expect(listArgs.statuses).toEqual(['erro']);
    });

    it('anexa a última falha SÓ na aba de erro', async () => {
        const falha = { priCod: 90001, etapa: 'fin014', mensagem: 'boom', interrompida: false };
        const { service, execucaoRepo } = build({
            transacoes: [{ id: 'txn-1' }],
            falhas: new Map([['txn-1', falha]]),
        });

        const comErro = await service.montarPainel({ status: 'erro' });
        expect(comErro.transacoes[0]?.ultimaFalha).toMatchObject(falha);

        (execucaoRepo.listUltimaFalhaPorTxnIds as jest.Mock).mockClear();
        const semErro = await service.montarPainel({ status: 'pendentes' });
        expect(execucaoRepo.listUltimaFalhaPorTxnIds).not.toHaveBeenCalled();
        expect(semErro.transacoes[0]?.ultimaFalha).toBeUndefined();
    });

    it('ledger indisponível tira a coluna de falha, não a carteira', async () => {
        const { service, execucaoRepo } = build({ transacoes: [{ id: 'txn-1' }] });
        (execucaoRepo.listUltimaFalhaPorTxnIds as jest.Mock).mockRejectedValue(
            new Error('ledger fora do ar'),
        );

        const painel = await service.montarPainel({ status: 'erro' });
        expect(painel.transacoes).toHaveLength(1);
        expect(painel.transacoes[0]?.ultimaFalha).toBeUndefined();
    });
});
