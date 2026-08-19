import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import type ConexosNdeFiscalClient from '../../client/ConexosNdeFiscalClient.js';
import { CATEGORIAS_TESOURARIA } from '../../interface/recebimentos/constants.js';
import type { NdePainelRow } from '../../interface/recebimentos/ports.js';
import type RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import type TransacaoRepository from '../../repository/recebimentos/TransacaoRepository.js';
import RecebimentosPainelService from './RecebimentosPainelService.js';

const buildNde = (o: Partial<NdePainelRow> = {}): NdePainelRow => ({
    id: 'nde-1',
    origem: 'ferramenta',
    recebimentoId: 'txn-1',
    filCod: 4,
    correlationId: 'nde:txn-1:1',
    valor: 15000,
    moeda: 'BRL',
    statusEmissao: 'emitida',
    idempotencyKey: 'nde:txn-1:1',
    ...o,
});

const build = (
    o: {
        transacoes?: unknown[];
        kpis?: Record<string, number>;
        valores?: Record<string, { total: number; alocado: number; emAberto: number }>;
        falhas?: Map<string, unknown>;
        ndes?: NdePainelRow[];
        ndePendentes?: number;
        /** Linhas que o GRID do com297 devolve — a fonte da hidratação agora. */
        erpNdes?: unknown[];
        /** Processos abertos do `imp021` — insumo da PREVISÃO de modalidade. */
        processos?: unknown[];
        /** Modalidade de FATO por txnId, como o ledger a devolve. */
        modalidadesReais?: Map<string, { priVldTipo?: number; ndeDispensada?: boolean }>;
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

    // A coluna de modalidade (ADR-0033) tem fontes próprias; nos testes de KPI/janela os stubs
    // vazios deixam o enriquecimento num no-op observável (nenhuma `modalidade`).
    const processoProvider = {
        listProcessosDaFilial: jest.fn().mockResolvedValue(o.processos ?? []),
    };
    const execucaoRepo = {
        listModalidadePorTxnIds: jest.fn().mockResolvedValue(o.modalidadesReais ?? new Map()),
        listUltimaFalhaPorTxnIds: jest.fn().mockResolvedValue(o.falhas ?? new Map()),
        setNdeAutorizado: jest.fn().mockResolvedValue(undefined),
    };
    const ndeRepo = {
        listParaPainel: jest.fn().mockResolvedValue(o.ndes ?? []),
        contarPendentes: jest.fn().mockResolvedValue(o.ndePendentes ?? 0),
        updateNumeroNde: jest.fn().mockResolvedValue(undefined),
    };
    const fiscalClient = {
        listNdes: jest.fn().mockResolvedValue(o.erpNdes ?? []),
    } as unknown as jest.Mocked<ConexosNdeFiscalClient>;
    const logService = { warn: jest.fn().mockResolvedValue(undefined) };

    return {
        transacaoRepo,
        runRepo,
        base,
        processoProvider,
        execucaoRepo,
        ndeRepo,
        fiscalClient,
        logService,
        service: new RecebimentosPainelService(
            transacaoRepo,
            runRepo,
            base,
            processoProvider as never,
            execucaoRepo as never,
            ndeRepo as never,
            fiscalClient,
            logService as never,
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

/** Linha como o GRID do com297 a devolve (já projetada pelo client). */
const buildErp = (o: Record<string, unknown> = {}) => ({
    filCod: 4,
    docTip: 1,
    docCod: 18337,
    vldAutorizado: 0,
    ...o,
});

describe('RecebimentosPainelService — aba NDe (lista no painel, hidratação no enriquecimento)', () => {
    it('lista as NDes das filiais permitidas, com teto próprio', async () => {
        const { service, ndeRepo } = build({ ndes: [buildNde()] });
        const painel = await service.montarPainel({ filCodsPermitidas: [4] });

        expect(painel.ndes).toHaveLength(1);
        expect(painel.ndes[0]).toMatchObject({ id: 'nde-1', statusEmissao: 'emitida' });
        expect(ndeRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ filCods: [4], limit: 200 }),
        );
    });

    it('ndePendentes vem do COUNT do banco, não da lista capada', async () => {
        // Mesma doutrina dos KPIs de transação: a lista é uma página, o KPI é o universo.
        const { service } = build({ ndes: [buildNde()], ndePendentes: 37 });
        expect((await service.montarPainel()).kpis.ndePendentes).toBe(37);
    });

    it('hidrata com UM POST por filial, não um GET por linha', async () => {
        // A versão anterior fazia 1 GET por documento (até 20 por carga). O grid resolve tudo de uma vez.
        const ndes = Array.from({ length: 12 }, (_, i) =>
            buildNde({ id: `n-${i}`, idempotencyKey: `k-${i}`, ndDocCod: 2000 + i }),
        );
        const { service, fiscalClient } = build({ ndes });
        await service.montarEnriquecimento({ filCodsPermitidas: [4, 7] });

        expect(fiscalClient.listNdes).toHaveBeenCalledTimes(2);
        expect(fiscalClient.listNdes).toHaveBeenCalledWith({ filCod: 4 });
        expect(fiscalClient.listNdes).toHaveBeenCalledWith({ filCod: 7 });
    });

    it('SEFAZ autorizou → reconcilia o ledger, o número e o KPI de pendentes', async () => {
        const { service, execucaoRepo, ndeRepo } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
            ndePendentes: 3,
            erpNdes: [buildErp({ vldAutorizado: 1, docEspNumero: '180791' })],
        });
        const enriquecimento = await service.montarEnriquecimento();

        expect(enriquecimento.ndes[0]).toMatchObject({ ndeAutorizado: true, numeroNde: '180791' });
        expect(execucaoRepo.setNdeAutorizado).toHaveBeenCalledWith('k-a', true);
        // O número só chega DEPOIS (SEFAZ é assíncrono) — sem persistir, a linha voltaria a "—".
        expect(ndeRepo.updateNumeroNde).toHaveBeenCalledWith('k-a', '180791');
        expect(enriquecimento.ndePendentes).toBe(2);
    });

    it('linha já autorizada no banco NÃO é reescrita a cada carga de painel', async () => {
        const { service, execucaoRepo, ndeRepo } = build({
            ndes: [
                buildNde({
                    idempotencyKey: 'k-a',
                    ndDocCod: 18337,
                    ndeAutorizado: true,
                    numeroNde: '180791',
                }),
            ],
            erpNdes: [buildErp({ vldAutorizado: 1, docEspNumero: '180791' })],
        });
        await service.montarEnriquecimento();

        expect(execucaoRepo.setNdeAutorizado).not.toHaveBeenCalled();
        expect(ndeRepo.updateNumeroNde).not.toHaveBeenCalled();
    });

    it('NDe do ERP sem execução nossa aparece marcada como emitida FORA da ferramenta', async () => {
        // É o ponto da feature: uma nota fiscal real que a ferramenta não emitiu não pode desaparecer.
        const { service } = build({
            ndes: [],
            erpNdes: [
                buildErp({
                    docCod: 18790,
                    vldAutorizado: 1,
                    docEspNumero: '180792',
                    valor: 236143.79,
                    priCod: 3640,
                    processoRef: '0017DYS/26',
                    cliente: 'DYNAMIS IMPORTADORA E DISTRIBUIDORA LTDA',
                }),
            ],
        });
        const enriquecimento = await service.montarEnriquecimento({ filCodsPermitidas: [4] });

        expect(enriquecimento.ndes).toHaveLength(1);
        expect(enriquecimento.ndes[0]).toMatchObject({
            id: 'erp:4:18790',
            origem: 'erp',
            numeroNde: '180792',
            valor: 236143.79,
            cliente: 'DYNAMIS IMPORTADORA E DISTRIBUIDORA LTDA',
            processoRef: '0017DYS/26',
            ndeAutorizado: true,
        });
        // Não inventa rastro que não existe.
        expect(enriquecimento.ndes[0]?.correlationId).toBeUndefined();
        expect(enriquecimento.ndes[0]?.idempotencyKey).toBeUndefined();
    });

    it('NDe do ERP que casa com execução nossa NÃO duplica a linha', async () => {
        const { service } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337 })],
            erpNdes: [buildErp({ docCod: 18337, vldAutorizado: 1 })],
        });
        const enriquecimento = await service.montarEnriquecimento();

        expect(enriquecimento.ndes).toHaveLength(1);
        expect(enriquecimento.ndes[0]?.origem).toBe('ferramenta');
    });

    it('externa não autorizada entra no KPI de pendentes — o COUNT do banco não a conhece', async () => {
        const { service } = build({
            ndes: [],
            ndePendentes: 0,
            erpNdes: [buildErp({ docCod: 18999, vldAutorizado: 0 })],
        });
        expect((await service.montarEnriquecimento({ filCodsPermitidas: [4] })).ndePendentes).toBe(
            1,
        );
    });

    it('ERP fora do ar não derruba o painel — a aba volta com o que o banco sabe', async () => {
        const { service, fiscalClient, execucaoRepo, logService } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
            ndePendentes: 1,
        });
        (fiscalClient.listNdes as jest.Mock).mockRejectedValue(new Error('conexos down'));

        const enriquecimento = await service.montarEnriquecimento();

        expect(enriquecimento.ndes).toHaveLength(1);
        expect(enriquecimento.ndes[0]).toMatchObject({ ndeAutorizado: false });
        expect(enriquecimento.ndePendentes).toBe(1);
        expect(execucaoRepo.setNdeAutorizado).not.toHaveBeenCalled();
        // Degradar é aceitável; degradar em silêncio não.
        expect(logService.warn).toHaveBeenCalled();
    });

    it('uma filial que falha não zera as outras — aba parcial vale mais que aba vazia', async () => {
        const { service, fiscalClient } = build({ ndes: [] });
        (fiscalClient.listNdes as jest.Mock).mockImplementation(
            async ({ filCod }: { filCod: number }) => {
                if (filCod === 4) throw new Error('filial 4 fora');
                return [buildErp({ filCod: 7, docCod: 18888, vldAutorizado: 1 })];
            },
        );

        const enriquecimento = await service.montarEnriquecimento({ filCodsPermitidas: [4, 7] });
        expect(enriquecimento.ndes).toHaveLength(1);
        expect(enriquecimento.ndes[0]).toMatchObject({ id: 'erp:7:18888' });
    });

    it('ERP lento não segura o painel — o prazo por leitura corta', async () => {
        jest.useFakeTimers();
        try {
            const { service, fiscalClient } = build({
                ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
                ndePendentes: 1,
            });
            (fiscalClient.listNdes as jest.Mock).mockImplementation(() => new Promise(() => {}));

            const promessa = service.montarEnriquecimento();
            await jest.advanceTimersByTimeAsync(9_000);
            const enriquecimento = await promessa;

            expect(enriquecimento.ndes[0]).toMatchObject({ ndeAutorizado: false });
            expect(enriquecimento.ndePendentes).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('falha ao gravar o número NÃO grava o flag — senão a linha nunca mais seria reconciliada', async () => {
        const { service, execucaoRepo, ndeRepo, logService } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
            erpNdes: [buildErp({ vldAutorizado: 1, docEspNumero: '180791' })],
        });
        (ndeRepo.updateNumeroNde as jest.Mock).mockRejectedValue(new Error('db down'));

        await service.montarEnriquecimento();

        expect(execucaoRepo.setNdeAutorizado).not.toHaveBeenCalled();
        expect(logService.warn).toHaveBeenCalled();
    });
});

describe('RecebimentosPainelService — enriquecimento diferido (ADR-0038)', () => {
    const txn = (o: Record<string, unknown> = {}) => ({
        id: 'txn-1',
        contraparte: 'BROWN FORMAN BRASIL',
        status: 'importada',
        ...o,
    });

    it('o painel NÃO toca o ERP — nem o grid do com297, nem a varredura do imp021', async () => {
        // É a razão de ser da ADR-0038: a carteira e os KPIs só dependem do Postgres, e esperar o
        // ERP para pintar uma coluna deixava o analista olhando para uma tela vazia por segundos.
        const { service, fiscalClient, processoProvider } = build({
            transacoes: [txn()],
            ndes: [buildNde()],
        });

        await service.montarPainel({ filCodsPermitidas: [4] });

        expect(fiscalClient.listNdes).not.toHaveBeenCalled();
        expect(processoProvider.listProcessosDaFilial).not.toHaveBeenCalled();
    });

    it('o painel ainda traz a modalidade de FATO — ela vem do ledger, não do ERP', async () => {
        const { service } = build({
            transacoes: [txn()],
            modalidadesReais: new Map([['txn-1', { priVldTipo: 3, ndeDispensada: false }]]),
        });

        const painel = await service.montarPainel();

        expect(painel.transacoes[0]?.modalidade).toMatchObject({
            priVldTipo: 3,
            rotulo: 'POR ENCOMENDA',
            previsao: false,
        });
    });

    it('o enriquecimento prevê por txnId para quem NÃO tem fato', async () => {
        const { service } = build({
            transacoes: [txn()],
            processos: [
                { pesCod: 10, dpeNomPessoa: 'BROWN FORMAN BRASIL LTDA', priVldTipo: 3 },
                { pesCod: 10, dpeNomPessoa: 'BROWN FORMAN BRASIL LTDA', priVldTipo: 3 },
            ],
        });

        const { modalidades } = await service.montarEnriquecimento();

        expect(modalidades['txn-1']).toMatchObject({
            priVldTipo: 3,
            rotulo: 'POR ENCOMENDA',
            previsao: true,
            // POR ENCOMENDA é a única modalidade que emite NDe (ADR-0033).
            ndeDispensada: false,
        });
    });

    it('quem já tem fato fica FORA do mapa — previsão não sobrescreve dado real', async () => {
        // As duas respostas chegam à tela em momentos diferentes; devolver o fato aqui abriria uma
        // corrida em que o palpite pinta por cima da modalidade efetivamente executada.
        const { service } = build({
            transacoes: [txn()],
            modalidadesReais: new Map([['txn-1', { priVldTipo: 2, ndeDispensada: true }]]),
            processos: [{ pesCod: 10, dpeNomPessoa: 'BROWN FORMAN BRASIL LTDA', priVldTipo: 3 }],
        });

        const { modalidades } = await service.montarEnriquecimento();

        expect(modalidades).toEqual({});
    });

    it('cliente com modalidade ambígua não vira palpite — "—" honesto vale mais', async () => {
        const { service } = build({
            transacoes: [txn()],
            processos: [
                { pesCod: 10, dpeNomPessoa: 'BROWN FORMAN BRASIL LTDA', priVldTipo: 3 },
                { pesCod: 10, dpeNomPessoa: 'BROWN FORMAN BRASIL LTDA', priVldTipo: 1 },
            ],
        });

        expect((await service.montarEnriquecimento()).modalidades).toEqual({});
    });

    it('ERP fora do ar devolve mapa vazio, não erro — a carteira já está na tela', async () => {
        const { service, processoProvider } = build({ transacoes: [txn()] });
        (processoProvider.listProcessosDaFilial as jest.Mock).mockRejectedValue(
            new Error('imp021 fora'),
        );

        await expect(service.montarEnriquecimento()).resolves.toMatchObject({ modalidades: {} });
    });

    it('enriquecimento enxerga o MESMO recorte da carteira — senão preveria linha fora da tela', async () => {
        const { service, transacaoRepo } = build({ transacoes: [txn()] });

        await service.montarEnriquecimento({ filCodsPermitidas: [4], status: 'parcial' });

        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ filCods: [4], statuses: ['parcial'] }),
        );
    });
});
