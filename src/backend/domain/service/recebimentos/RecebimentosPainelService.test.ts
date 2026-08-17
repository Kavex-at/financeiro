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
        docStatus?: unknown;
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
        setNdeAutorizado: jest.fn().mockResolvedValue(undefined),
    };
    const ndeRepo = {
        listParaPainel: jest.fn().mockResolvedValue(o.ndes ?? []),
        contarPendentes: jest.fn().mockResolvedValue(o.ndePendentes ?? 0),
        updateNumeroNde: jest.fn().mockResolvedValue(undefined),
    };
    const fiscalClient = {
        lerDocParaPolling: jest.fn().mockResolvedValue(o.docStatus ?? {}),
    } as unknown as jest.Mocked<ConexosNdeFiscalClient>;
    const logService = { warn: jest.fn().mockResolvedValue(undefined) };

    return {
        transacaoRepo,
        runRepo,
        base,
        execucaoRepo,
        ndeRepo,
        fiscalClient,
        logService,
        service: new RecebimentosPainelService(
            transacaoRepo,
            runRepo,
            base,
            processoProvider,
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

describe('RecebimentosPainelService — aba NDe', () => {
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

    it('hidrata no com297 só as não autorizadas que têm docCod — e nunca as demais', async () => {
        const { service, fiscalClient } = build({
            ndes: [
                buildNde({ id: 'a', idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false }),
                buildNde({ id: 'b', idempotencyKey: 'k-b', ndDocCod: 18338, ndeAutorizado: true }),
                buildNde({ id: 'c', idempotencyKey: 'k-c' }),
            ],
            docStatus: { vldAutorizado: 0 },
        });
        await service.montarPainel();

        expect(fiscalClient.lerDocParaPolling).toHaveBeenCalledTimes(1);
        expect(fiscalClient.lerDocParaPolling).toHaveBeenCalledWith({ filCod: 4, docCod: 18337 });
    });

    it('SEFAZ autorizou → reconcilia o ledger, o número e o KPI de pendentes', async () => {
        const { service, execucaoRepo, ndeRepo } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
            ndePendentes: 3,
            docStatus: { vldAutorizado: 1, docEspNumero: '000123' },
        });
        const painel = await service.montarPainel();

        expect(painel.ndes[0]).toMatchObject({ ndeAutorizado: true, numeroNde: '000123' });
        expect(execucaoRepo.setNdeAutorizado).toHaveBeenCalledWith('k-a', true);
        // O número só chega DEPOIS (SEFAZ é assíncrono) — sem persistir, a linha voltaria a "—" no
        // próximo load, já que autorizada ela não é mais candidata a hidratação.
        expect(ndeRepo.updateNumeroNde).toHaveBeenCalledWith('k-a', '000123');
        // Uma pendência a menos foi resolvida NESTE request; o COUNT foi tirado antes dela.
        expect(painel.kpis.ndePendentes).toBe(2);
    });

    it('ERP fora do ar não derruba o painel — a aba volta com o que o banco sabe', async () => {
        const { service, fiscalClient, execucaoRepo } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
            ndePendentes: 1,
        });
        (fiscalClient.lerDocParaPolling as jest.Mock).mockRejectedValue(new Error('conexos down'));

        const painel = await service.montarPainel();

        expect(painel.ndes).toHaveLength(1);
        expect(painel.ndes[0]).toMatchObject({ ndeAutorizado: false });
        expect(painel.kpis.ndePendentes).toBe(1);
        expect(execucaoRepo.setNdeAutorizado).not.toHaveBeenCalled();
    });

    it('a hidratação é capada — uma carteira grande não vira uma rajada no ERP', async () => {
        const ndes = Array.from({ length: 50 }, (_, i) =>
            buildNde({ id: `n-${i}`, idempotencyKey: `k-${i}`, ndDocCod: 1000 + i }),
        );
        const { service, fiscalClient } = build({ ndes, docStatus: { vldAutorizado: 0 } });
        await service.montarPainel();

        expect((fiscalClient.lerDocParaPolling as jest.Mock).mock.calls).toHaveLength(20);
    });

    it('a concorrência é o FANOUT do módulo (4), não uma rajada de 20 sessões no Conexos', async () => {
        // O teto de 4 vem do incidente LOGIN_ERROR_MAX_SESSIONS. Sem medir o LOTE, trocar a
        // constante por 20 passaria verde — o teste do cap sozinho não protege a concorrência.
        const ndes = Array.from({ length: 12 }, (_, i) =>
            buildNde({ id: `n-${i}`, idempotencyKey: `k-${i}`, ndDocCod: 2000 + i }),
        );
        const { service, fiscalClient } = build({ ndes, docStatus: { vldAutorizado: 0 } });

        let emVoo = 0;
        let picoDeConcorrencia = 0;
        (fiscalClient.lerDocParaPolling as jest.Mock).mockImplementation(async () => {
            emVoo += 1;
            picoDeConcorrencia = Math.max(picoDeConcorrencia, emVoo);
            await new Promise((r) => setImmediate(r));
            emVoo -= 1;
            return { vldAutorizado: 0 };
        });

        await service.montarPainel();
        expect(picoDeConcorrencia).toBe(4);
    });

    it('ERP pendurado não segura o painel — o prazo por leitura corta e a linha volta do banco', async () => {
        jest.useFakeTimers();
        try {
            const { service, fiscalClient } = build({
                ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
                ndePendentes: 1,
            });
            // Uma leitura que NUNCA resolve — o caso do doc pendurado no com297.
            (fiscalClient.lerDocParaPolling as jest.Mock).mockImplementation(
                () => new Promise(() => {}),
            );

            const promessa = service.montarPainel();
            await jest.advanceTimersByTimeAsync(9_000);
            const painel = await promessa;

            expect(painel.ndes[0]).toMatchObject({ ndeAutorizado: false });
            expect(painel.kpis.ndePendentes).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('falha ao gravar o número NÃO grava o flag — senão a linha nunca mais seria reconciliada', async () => {
        // O flag é o ponto de commit: enquanto ele não está no banco, a linha segue candidata.
        const { service, execucaoRepo, ndeRepo, logService } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
            docStatus: { vldAutorizado: 1, docEspNumero: '000123' },
        });
        (ndeRepo.updateNumeroNde as jest.Mock).mockRejectedValue(new Error('db down'));

        await service.montarPainel();

        expect(execucaoRepo.setNdeAutorizado).not.toHaveBeenCalled();
        expect(logService.warn).toHaveBeenCalled();
    });

    it('falha na leitura do ERP é registrada — degradar em silêncio esconde regressão', async () => {
        const { service, fiscalClient, logService } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
        });
        (fiscalClient.lerDocParaPolling as jest.Mock).mockRejectedValue(new Error('conexos down'));

        await service.montarPainel();
        expect(logService.warn).toHaveBeenCalled();
    });

    it('docEspNumero "0" NÃO vira número de nota — o campo não é confirmado por HAR', async () => {
        // O único HAR observado mostra o documento com `docEspNumero` "0" logo após homologar.
        // Como a linha autorizada sai da fila de hidratação, gravar isso fixaria um número falso.
        const { service, ndeRepo } = build({
            ndes: [buildNde({ idempotencyKey: 'k-a', ndDocCod: 18337, ndeAutorizado: false })],
            docStatus: { vldAutorizado: 1, docEspNumero: '0' },
        });

        const painel = await service.montarPainel();

        expect(ndeRepo.updateNumeroNde).not.toHaveBeenCalled();
        expect(painel.ndes[0]?.numeroNde).toBeUndefined();
        // A autorização é fato e é gravada mesmo sem número.
        expect(painel.ndes[0]).toMatchObject({ ndeAutorizado: true });
    });
});
