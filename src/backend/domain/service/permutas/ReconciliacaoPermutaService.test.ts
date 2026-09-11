import 'reflect-metadata';
import ReconciliacaoEmAndamentoError from '../../errors/ReconciliacaoEmAndamentoError.js';
import ErpErrorInterpreter from './ErpErrorInterpreter.js';
import ReconciliacaoPermutaService from './ReconciliacaoPermutaService.js';

// Guard-rails de escrita via EnvironmentProvider mockado (Rule #8). Mutável por teste.
const envFlags = { conexosWriteEnabled: false, conexosDryRun: true };

// `atualizado_em` da alocação entra na chave de idempotência (por estado da alocação).
const ATUALIZADO = new Date('2026-06-23T00:00:00Z');
const KEY = `permuta:2767:5078:${ATUALIZADO.getTime()}`;

const buildAloc = (over: Partial<Record<string, unknown>> = {}) => ({
    adiantamentoDocCod: '2767',
    invoiceDocCod: '5078',
    invoicePriCod: '1408',
    valorAlocado: 1000,
    moeda: 'USD',
    variacaoClassificacao: 'JUROS',
    variacaoResultado: 220,
    variacaoDelta: 220,
    taxaAdiantamento: 5.31,
    // 1000 × 5.0 = 5000 BRL = valor da baixa PARCIAL (≤ em-aberto 40 879,9 do mock).
    taxaInvoice: 5.0,
    criadoEm: new Date('2026-06-20'),
    atualizadoEm: ATUALIZADO,
    dataBase: new Date('2026-03-15T00:00:00Z'),
    ...over,
});

const buildDeps = () => {
    const conexosClient = {
        criarBordero: jest.fn().mockResolvedValue({ borCod: 1999, filCod: 4 }),
        validarTituloBaixa: jest
            .fn()
            .mockResolvedValue({ responseData: { bxaMnyValor: 40879.9, bxaCodGerDesconto: 94 } }),
        validarTituloPermuta: jest.fn().mockResolvedValue({
            responseData: {
                gerNumPermuta: 198,
                gerDesPermuta: 'ADTO FORNECEDOR INTERNACIONAIS',
                gerNum: 198,
                pesCod: 2658,
                dpeNomPessoa: 'TOP GLOBAL PARTS CO LTD',
                bxaMnyValorPermuta: 41175.97,
            },
        }),
        atualizarValorLiquido: jest
            .fn()
            .mockResolvedValue({ responseData: { bxaMnyLiquido: 41099.9 } }),
        gravarBaixaPermuta: jest.fn().mockResolvedValue({ bxaCodSeq: 1, borCod: 1999 }),
        getBordero: jest.fn().mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: null }),
        // Default: sem títulos → fallback p/ título 1 (compat). O teste multi-título sobrescreve.
        listTitulosAPagar: jest.fn().mockResolvedValue([]),
        // Limpeza do borderô órfão (I-Write-7) — só exercitada quando NENHUMA baixa confirma.
        listBaixas: jest.fn().mockResolvedValue([]),
        excluirBordero: jest.fn().mockResolvedValue(undefined),
    };
    const alocacaoRepository = { listAtivas: jest.fn().mockResolvedValue([buildAloc()]) };
    const execucaoRepository = {
        findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        deleteByKey: jest.fn().mockResolvedValue(1),
        renameKey: jest.fn().mockResolvedValue(1),
        beginExecution: jest
            .fn()
            .mockResolvedValue({ status: 'reconciling', alreadySettled: false }),
        setBorCod: jest.fn().mockResolvedValue(undefined),
        setRequestPayload: jest.fn().mockResolvedValue(undefined),
        markSettled: jest.fn().mockResolvedValue(undefined),
        markParcial: jest.fn().mockResolvedValue(undefined),
        markError: jest.fn().mockResolvedValue(undefined),
        listByAdiantamento: jest.fn().mockResolvedValue([]),
        deleteBorderoCache: jest.fn().mockResolvedValue(1),
        clearBorCod: jest.fn().mockResolvedValue(1),
    };
    const relationalRepository = {
        findAdiantamento: jest
            .fn()
            .mockResolvedValue({ docCod: '2767', priCod: '1408', filCod: 4 }),
    };
    const logService = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    // Advisory lock DE VERDADE (I-Recon-5): um Set de chaves EM VOO. Um mock que sempre chama
    // `onAcquired` tornaria o teste de concorrência decorativo — ele passaria mesmo com o lock
    // removido do serviço, que é exatamente o defeito P0 que este teste existe para provar.
    const chavesEmVoo = new Set<number>();
    const db = {
        withAdvisoryLock: jest.fn(
            async (
                lockKey: number,
                onAcquired: () => Promise<unknown>,
                onBusy: () => Promise<unknown>,
            ) => {
                if (chavesEmVoo.has(lockKey)) return onBusy();
                chavesEmVoo.add(lockKey);
                try {
                    return await onAcquired();
                } finally {
                    chavesEmVoo.delete(lockKey);
                }
            },
        ),
    };
    const environmentProvider = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            conexosWriteEnabled: envFlags.conexosWriteEnabled,
            conexosDryRun: envFlags.conexosDryRun,
        }),
    };
    // auto-alocação no Baixar (múltipla automática) — default: não elegível (não cria nada).
    const alocacaoService = {
        autoAlocarSeElegivel: jest.fn().mockResolvedValue(false),
        autoAlocarDeCasamento: jest.fn().mockResolvedValue(false),
    };
    const service = new ReconciliacaoPermutaService(
        conexosClient as never, // ConexosBaixaClient (fin010)
        conexosClient as never, // ConexosTitulosClient (listTitulosAPagar)
        environmentProvider as never,
        alocacaoRepository as never,
        execucaoRepository as never,
        relationalRepository as never,
        alocacaoService as never,
        logService as never,
        new ErpErrorInterpreter(), // interpretador real (puro, sem deps)
        // C-7: o PostgreeDatabaseClient entra no FIM da lista — inserir no meio quebraria a
        // injeção posicional dos 23 testes que já existiam neste arquivo.
        db as never,
    );
    return {
        service,
        conexosClient,
        alocacaoRepository,
        execucaoRepository,
        relationalRepository,
        alocacaoService,
        logService,
        db,
        chavesEmVoo,
    };
};

describe('ReconciliacaoPermutaService', () => {
    beforeEach(() => {
        envFlags.conexosWriteEnabled = false;
        envFlags.conexosDryRun = true;
    });

    it('dry-run (default): builds preview, persists payload, NEVER calls the ERP', async () => {
        const { service, conexosClient, execucaoRepository } = buildDeps();

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1782172800000,
        });

        expect(out.dryRun).toBe(true);
        expect(out.resultados[0].status).toBe('dry-run');
        expect(conexosClient.criarBordero).not.toHaveBeenCalled();
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
        // dry-run NÃO tem efeito no banco (I-Recon-4): nada de beginExecution/setRequestPayload.
        expect(execucaoRepository.beginExecution).not.toHaveBeenCalled();
        expect(execucaoRepository.setRequestPayload).not.toHaveBeenCalled();
        // preview tem o juros local, sem valor do ERP
        expect(out.resultados[0].payload?.bxaMnyJuros).toBe(220);
    });

    it('in-doubt (R-4): execução anterior reconciling+bor_cod NÃO é re-POSTada (anti super-pagamento)', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        // Órfão: o handshake anterior morreu entre o POST irreversível e o markSettled.
        (execucaoRepository.findByIdempotencyKey as jest.Mock).mockResolvedValue({
            status: 'reconciling',
            borCod: 1999,
            dryRun: false,
        });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        // FAIL-CLOSED: não re-POSTa nada e surface o par p/ conciliação manual.
        expect(conexosClient.criarBordero).not.toHaveBeenCalled();
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
        expect(execucaoRepository.beginExecution).not.toHaveBeenCalled();
        expect(out.resultados[0].status).toBe('error');
        expect(out.resultados[0].borCod).toBe(1999);
        expect(out.resultados[0].erro).toMatch(/estado indeterminado/i);
        expect(out.resultados[0].erro).toContain('borderô 1999');
    });

    it('forces dry-run when writeEnabled=false even if dryRun flag off', async () => {
        envFlags.conexosWriteEnabled = false;
        envFlags.conexosDryRun = false;
        const { service, conexosClient } = buildDeps();

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.dryRun).toBe(true);
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
    });

    it('real run: full 5-step handshake, marks settled with bxaCodSeq', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1782172800000,
        });

        expect(conexosClient.criarBordero).toHaveBeenCalledTimes(1);
        // Data do borderô = a data ESCOLHIDA pelo analista (dataMovto do request).
        expect(conexosClient.criarBordero).toHaveBeenCalledWith({
            filCod: 4,
            dataMovto: 1782172800000,
        });
        expect(conexosClient.validarTituloBaixa).toHaveBeenCalledTimes(1);
        expect(conexosClient.validarTituloPermuta).toHaveBeenCalledTimes(1);
        expect(conexosClient.atualizarValorLiquido).toHaveBeenCalledTimes(1);
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);

        // payload final do passo 5: baixa PARCIAL (valor alocado × taxa = 5000), não o título cheio.
        const payload = conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload;
        expect(payload).toMatchObject({
            docCod: 5078,
            bxaDocCod: 2767,
            bxaMnyValor: 5000,
            bxaMnyJuros: 220,
            bxaCodGerJuros: 131,
            gerNumPermuta: 198,
            bxaVldAdto: 1,
        });

        // comentário do borderô (spec): conta da variação + duas taxas + conta de juros, em MAIÚSCULAS
        // (o ERP exige uppercase — CnxValidatorDescr / not_in_uppercase).
        expect(payload.bxaEspComplemento).toBe(String(payload.bxaEspComplemento).toUpperCase());
        expect(payload.bxaEspComplemento).toContain('VARIACAO CAMBIAL');
        expect(payload.bxaEspComplemento).toContain('TAXA ADTO 5.31');
        expect(payload.bxaEspComplemento).toContain('TAXA INVOICE 5');
        expect(payload.bxaEspComplemento).toContain('131');

        expect(execucaoRepository.markSettled).toHaveBeenCalledWith(
            KEY,
            expect.objectContaining({ borCod: 1999, bxaCodSeq: 1, valorBaixado: 5000 }),
        );
        expect(out.resultados[0].status).toBe('settled');
        expect(out.resultados[0].bxaCodSeq).toBe(1);
    });

    it('multi-título: baixa CADA título (titCod 1 e 2) no MESMO borderô, rateando o valor/juros', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, alocacaoRepository, execucaoRepository } = buildDeps();
        // Invoice com 2 títulos (parcelas) — alocação cobre a invoice inteira (800 + 200 = 1000 USD).
        alocacaoRepository.listAtivas = jest
            .fn()
            .mockResolvedValue([
                buildAloc({ valorAlocado: 1000, taxaInvoice: 5.0, variacaoResultado: 220 }),
            ]);
        conexosClient.listTitulosAPagar = jest.fn().mockResolvedValue([
            { titCod: '1', valorNegociado: 800, taxa: 5.0 },
            { titCod: '2', valorNegociado: 200, taxa: 5.0 },
        ]);
        // em-aberto vivo por título (titCod 1 → 4000, titCod 2 → 1000).
        conexosClient.validarTituloBaixa = jest
            .fn()
            .mockImplementation((p: { titCod: number }) =>
                Promise.resolve({ responseData: { bxaMnyValor: p.titCod === 1 ? 4000 : 1000 } }),
            );

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        // UM borderô só; um handshake POR título.
        expect(conexosClient.criarBordero).toHaveBeenCalledTimes(1);
        expect(conexosClient.validarTituloBaixa).toHaveBeenCalledTimes(2);
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(2);
        const p1 = conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload;
        const p2 = conexosClient.gravarBaixaPermuta.mock.calls[1][0].payload;
        expect(p1.titCod).toBe(1);
        expect(p1.bxaMnyValor).toBe(4000); // 800 × 5
        expect(p1.bxaMnyJuros).toBe(176); // 220 × 800/1000
        expect(p2.titCod).toBe(2);
        expect(p2.bxaMnyValor).toBe(1000); // 200 × 5
        expect(p2.bxaMnyJuros).toBe(44); // 220 × 200/1000
        // settled AGREGA os títulos: total baixado 5000 (4000+1000), juros total 220 (176+44).
        expect(execucaoRepository.markSettled).toHaveBeenCalledWith(
            KEY,
            expect.objectContaining({ borCod: 1999, valorBaixado: 5000, juros: 220 }),
        );
        expect(out.resultados[0].status).toBe('settled');
    });

    it('âncora I-Write-6: full-consume de título único fecha o líquido no valor real do adto (zero resíduo)', async () => {
        // Regressão borderô 15593 (adto 17287 → invoice 18771): a variação por USD×taxa (taxa a 3 casas)
        // deixava 0,05 "à permutar" no adto. Com o adto consumido por inteiro, o líquido fecha no
        // bxaMnyValorPermuta do ERP e o resíduo é absorvido na conta de juros (131).
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const {
            service,
            conexosClient,
            execucaoRepository,
            relationalRepository,
            alocacaoRepository,
        } = buildDeps();
        relationalRepository.findAdiantamento = jest.fn().mockResolvedValue({
            docCod: '2767',
            priCod: '1408',
            filCod: 4,
            valorPermutar: 421241.43, // BRL saldo a permutar (adto inteiro em aberto)
            taxa: 5.158, // saldoNeg = 421241.43 / 5.158 ≈ 81667.59 USD ≈ valorAlocado → full-consume
        });
        conexosClient.validarTituloBaixa = jest
            .fn()
            .mockResolvedValue({ responseData: { bxaMnyValor: 408395.07 } });
        conexosClient.validarTituloPermuta = jest.fn().mockResolvedValue({
            responseData: {
                gerNumPermuta: 198,
                gerNum: 198,
                pesCod: 3965,
                dpeNomPessoa: 'VE STAAL EOOD',
                bxaMnyValorPermuta: 421241.43, // valor REAL do adto no ERP
            },
        });
        // ERP não devolve líquido → o código faz o fallback bxaMnyValor + juros − desconto.
        conexosClient.atualizarValorLiquido = jest.fn().mockResolvedValue({ responseData: {} });
        // Alocação com os números reais da permuta.
        alocacaoRepository.listAtivas = jest.fn().mockResolvedValue([
            buildAloc({
                valorAlocado: 81667.58,
                taxaAdiantamento: 5.158,
                taxaInvoice: 5.0007,
                variacaoClassificacao: 'JUROS',
                variacaoResultado: 12846.31,
                variacaoDelta: 12846.31,
            }),
        ]);

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'marilyn.mutafci@kavex.com',
            dataMovto: 1,
        });

        const payload = conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload;
        expect(payload.bxaMnyValor).toBe(408395.07);
        // juros ancorado: 12846.31 + 0.05 (resíduo) = 12846.36.
        expect(payload.bxaMnyJuros).toBe(12846.36);
        // líquido == valor real do adto → ZERO resíduo "à permutar".
        expect(payload.bxaMnyLiquido).toBe(421241.43);
        expect(payload.bxaMnyLiquido).toBe(payload.bxaMnyValorPermuta);
        // passo 4 recebe o juros JÁ ancorado.
        expect(conexosClient.atualizarValorLiquido).toHaveBeenCalledWith(
            expect.objectContaining({ juros: 12846.36, desconto: 0 }),
        );
        expect(execucaoRepository.markSettled).toHaveBeenCalledWith(
            KEY,
            expect.objectContaining({ valorBaixado: 408395.07, juros: 12846.36 }),
        );
        expect(out.resultados[0].status).toBe('settled');
    });

    it('âncora I-Write-6 NÃO dispara em permuta PARCIAL (adto não é consumido por inteiro)', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, relationalRepository } = buildDeps();
        // Adto grande (saldoNeg = 500000/5 = 100000 USD) vs alocado 1000 USD → parcial → sem âncora.
        relationalRepository.findAdiantamento = jest.fn().mockResolvedValue({
            docCod: '2767',
            priCod: '1408',
            filCod: 4,
            valorPermutar: 500000,
            taxa: 5.0,
        });

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        // juros permanece o rateado por taxa (220), sem absorção de resíduo.
        const payload = conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload;
        expect(payload.bxaMnyJuros).toBe(220);
    });

    it('âncora I-Write-6: resíduo acima do teto absoluto (R$1) NÃO é ancorado (anti-mascaramento)', async () => {
        // Full-consume, mas o valor do adto no ERP está R$5,05 acima do líquido → resíduo > R$1 →
        // pode ser saldo real, não arredondamento → NÃO ancora (mantém o rateio por taxa; loga warn).
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, relationalRepository, alocacaoRepository } = buildDeps();
        relationalRepository.findAdiantamento = jest.fn().mockResolvedValue({
            docCod: '2767',
            priCod: '1408',
            filCod: 4,
            valorPermutar: 421241.43,
            taxa: 5.158,
        });
        conexosClient.validarTituloBaixa = jest
            .fn()
            .mockResolvedValue({ responseData: { bxaMnyValor: 408395.07 } });
        conexosClient.validarTituloPermuta = jest.fn().mockResolvedValue({
            responseData: {
                gerNumPermuta: 198,
                gerNum: 198,
                pesCod: 3965,
                bxaMnyValorPermuta: 421246.43, // 5,05 acima do líquido 421241.38 → resíduo > R$1
            },
        });
        conexosClient.atualizarValorLiquido = jest.fn().mockResolvedValue({ responseData: {} });
        alocacaoRepository.listAtivas = jest.fn().mockResolvedValue([
            buildAloc({
                valorAlocado: 81667.58,
                taxaAdiantamento: 5.158,
                taxaInvoice: 5.0007,
                variacaoClassificacao: 'JUROS',
                variacaoResultado: 12846.31,
                variacaoDelta: 12846.31,
            }),
        ]);

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        const payload = conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload;
        // juros permanece o rateado por taxa (12846.31), líquido NÃO fecha no valor do adto.
        expect(payload.bxaMnyJuros).toBe(12846.31);
        expect(payload.bxaMnyLiquido).toBe(421241.38);
    });

    it('aborts (no write) when ERP reports zero em-aberto — anti-super-pagamento', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        conexosClient.validarTituloBaixa.mockResolvedValue({ responseData: { bxaMnyValor: 0 } });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
        expect(execucaoRepository.markError).toHaveBeenCalledTimes(1);
        expect(out.resultados[0].status).toBe('error');
    });

    it('idempotency: settled + borderô AINDA VÁLIDO no ERP → skipped (no write)', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        // já existe baixa settled, e o borderô segue válido (em cadastro) no ERP.
        execucaoRepository.findByIdempotencyKey.mockResolvedValue({
            status: 'settled',
            borCod: 14707,
        });
        conexosClient.getBordero.mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: null });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(conexosClient.criarBordero).not.toHaveBeenCalled();
        expect(execucaoRepository.renameKey).not.toHaveBeenCalled();
        expect(out.resultados[0].status).toBe('skipped');
    });

    it('idempotência viva: settled MAS borderô CANCELADO → libera re-baixa', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        execucaoRepository.findByIdempotencyKey.mockResolvedValue({
            status: 'settled',
            borCod: 14707,
        });
        // borderô da baixa anterior foi CANCELADO (borVldFinalizado=2) → baixa nula.
        conexosClient.getBordero.mockResolvedValue({ borVldFinalizado: 2, borCodEstornado: null });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        // libera: PRESERVA a linha do cancelado (renomeia a chave) e executa uma baixa NOVA.
        expect(execucaoRepository.renameKey).toHaveBeenCalled();
        expect(conexosClient.criarBordero).toHaveBeenCalledTimes(1);
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
        expect(out.resultados[0].status).toBe('settled');
    });

    it('records error (not settled) when the final POST throws', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        conexosClient.gravarBaixaPermuta.mockRejectedValue(new Error('ERP 500'));

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(execucaoRepository.markSettled).not.toHaveBeenCalled();
        expect(execucaoRepository.markError).toHaveBeenCalledWith(
            KEY,
            expect.objectContaining({ erroMensagem: 'ERP 500' }),
        );
        expect(out.resultados[0].status).toBe('error');
    });

    // ── I-Write-7: borderô órfão (casco vazio) ──────────────────────────────────────────────────
    // Regressão do borderô 18538 (2026-08-06): o passo 1 do handshake cria o borderô ANTES da baixa;
    // se a baixa falha, o casco fica no ERP e o "Aprovar" dele é recusado com "NÃO POSSUI ITENS".

    it('I-Write-7: todas as baixas falham → borderô criado aqui é removido do ERP', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        conexosClient.gravarBaixaPermuta.mockRejectedValue(new Error('ERP 500'));

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('error');
        expect(conexosClient.excluirBordero).toHaveBeenCalledWith({ filCod: 4, borCod: 1999 });
        expect(execucaoRepository.deleteBorderoCache).toHaveBeenCalledWith(4, 1999);
        // O `markError` grava o borCod ANTES da limpeza; como o borderô deixou de existir, o
        // ponteiro tem de ser zerado — senão o ERP reaproveita o número e o painel mostra ao
        // analista um borderô de outro fornecedor (medido 2026-09-11: 2771 → doc 6708).
        expect(execucaoRepository.clearBorCod).toHaveBeenCalledWith(1999);
    });

    it('borderô órfão NÃO removido (tem item no ERP): NÃO zera o ponteiro das execuções', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        conexosClient.gravarBaixaPermuta.mockRejectedValue(new Error('ERP 500'));
        // O ERP diz que o borderô TEM baixa (uma parcial entrou antes do erro) → não apaga.
        conexosClient.listBaixas.mockResolvedValue([{ docCod: 5078, bxaCodSeq: 1 }]);

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(conexosClient.excluirBordero).not.toHaveBeenCalled();
        // Borderô vivo ⇒ o ponteiro do ledger continua VÁLIDO e tem de ser preservado.
        expect(execucaoRepository.clearBorCod).not.toHaveBeenCalled();
    });

    // ── I-Write-9: distribuição por EM-ABERTO da parcela, não pela face ──────────────
    // Regressão do bug medido em prod (2026-09-11): invoice 7144 (processo 579) tem 2 parcelas
    // — tit 1 de 7.685,12 USD já quitado pelo adto 4635, tit 2 de 31.814,88 USD em aberto para o
    // adto 6833. O laço antigo recomeçava na parcela 1 usando a FACE, o ERP devolvia
    // `bxaMnyValor=0` e a baixa morria com "título 7144/1 sem valor em aberto no ERP".
    it('parcela já quitada é PULADA — a baixa vai para a parcela que ainda tem saldo', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, alocacaoRepository, execucaoRepository } = buildDeps();
        alocacaoRepository.listAtivas = jest
            .fn()
            .mockResolvedValue([buildAloc({ valorAlocado: 900, taxaInvoice: 5.0 })]);
        conexosClient.listTitulosAPagar = jest.fn().mockResolvedValue([
            // tit 1: face 100 e 500 BRL pagos ⇒ em-aberto 100 − 500/5 = 0 → QUITADA.
            { titCod: '1', valorNegociado: 100, taxa: 5.0, valorPago: 500, pago: 1 },
            // tit 2: face 900, nada pago ⇒ em-aberto 900.
            { titCod: '2', valorNegociado: 900, taxa: 5.0, valorPago: 0, pago: 3 },
        ]);
        conexosClient.validarTituloBaixa = jest.fn().mockImplementation((p: { titCod: number }) =>
            // O ERP reflete a realidade: parcela 1 sem saldo, parcela 2 com 4500 BRL.
            Promise.resolve({
                responseData: { bxaMnyValor: p.titCod === 1 ? 0 : 4500 },
            }),
        );

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        // A parcela quitada nem é tentada — antes do fix, ESTA chamada era feita com titCod 1
        // e derrubava a execução inteira.
        expect(conexosClient.validarTituloBaixa).toHaveBeenCalledTimes(1);
        expect(conexosClient.validarTituloBaixa.mock.calls[0][0].titCod).toBe(2);
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
        expect(conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload.titCod).toBe(2);
        expect(conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload.bxaMnyValor).toBe(4500);
        expect(out.resultados[0].status).toBe('settled');
        expect(execucaoRepository.markSettled).toHaveBeenCalledWith(
            KEY,
            expect.objectContaining({ valorBaixado: 4500 }),
        );
    });

    it('parcela PARCIALMENTE paga: consome só o em-aberto dela e transborda para a seguinte', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, alocacaoRepository } = buildDeps();
        alocacaoRepository.listAtivas = jest
            .fn()
            .mockResolvedValue([buildAloc({ valorAlocado: 800, taxaInvoice: 5.0 })]);
        conexosClient.listTitulosAPagar = jest.fn().mockResolvedValue([
            // tit 1: face 1000, 2500 BRL pagos ⇒ em-aberto 1000 − 500 = 500 (não 1000!).
            { titCod: '1', valorNegociado: 1000, taxa: 5.0, valorPago: 2500, pago: 2 },
            { titCod: '2', valorNegociado: 400, taxa: 5.0, valorPago: 0, pago: 3 },
        ]);
        conexosClient.validarTituloBaixa = jest.fn().mockImplementation((p: { titCod: number }) =>
            Promise.resolve({
                responseData: { bxaMnyValor: p.titCod === 1 ? 2500 : 2000 },
            }),
        );

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        const p1 = conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload;
        const p2 = conexosClient.gravarBaixaPermuta.mock.calls[1][0].payload;
        expect(p1.titCod).toBe(1);
        expect(p1.bxaMnyValor).toBe(2500); // 500 em-aberto × 5 — NÃO 1000 × 5
        expect(p2.titCod).toBe(2);
        expect(p2.bxaMnyValor).toBe(1500); // os 300 restantes × 5
    });

    // O `borCod` é compartilhado por todas as alocações (I-Write-3). Apagar na PRIMEIRA falha
    // destruiria o borderô que a alocação seguinte usa com sucesso — por isso a limpeza é no fim.
    it('I-Write-7: falha seguida de sucesso → borderô TEM item, NÃO é removido', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, alocacaoRepository } = buildDeps();
        alocacaoRepository.listAtivas.mockResolvedValue([
            buildAloc({ invoiceDocCod: '5078' }),
            buildAloc({ invoiceDocCod: '5079' }),
        ]);
        conexosClient.gravarBaixaPermuta
            .mockRejectedValueOnce(new Error('ERP 500')) // 1ª alocação falha
            .mockResolvedValue({ bxaCodSeq: 1, borCod: 1999 }); // 2ª entra no MESMO borderô

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados.map((r) => r.status)).toEqual(['error', 'settled']);
        expect(conexosClient.criarBordero).toHaveBeenCalledTimes(1);
        expect(conexosClient.excluirBordero).not.toHaveBeenCalled();
    });

    // Fail-safe: a fonte da verdade é o ERP. Se ele disser que há item (baixa parcial que entrou
    // antes do erro), o borderô NÃO é apagado — apagar levaria embora uma baixa real.
    it('I-Write-7: ERP relata item no borderô → não remove, só avisa', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient } = buildDeps();
        conexosClient.gravarBaixaPermuta.mockRejectedValue(new Error('ERP 500'));
        conexosClient.listBaixas.mockResolvedValue([{ docCod: 5078, bxaCodSeq: 1 }]);

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(conexosClient.excluirBordero).not.toHaveBeenCalled();
    });

    // A limpeza é higiene: se ela falhar, o erro que o analista precisa ver continua de pé.
    it('I-Write-7: falha ao excluir o órfão não derruba a reconciliação', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient } = buildDeps();
        conexosClient.gravarBaixaPermuta.mockRejectedValue(new Error('ERP 500'));
        conexosClient.excluirBordero.mockRejectedValue(new Error('período fechado'));

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('error');
        expect(out.resultados[0].erro).toBe('ERP 500'); // o erro REAL sobrevive à limpeza
    });

    it('erro Generic.ERROR_MESSAGE → erroMensagem surface a razão real (vars.msg)', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        // O ERP recusa a gravação com o envelope genérico; a razão real vem no vars.msg.
        conexosClient.gravarBaixaPermuta.mockRejectedValue(
            Object.assign(new Error('conexos'), {
                response: {
                    status: 400,
                    data: {
                        messages: [
                            {
                                valid: 'ERRO',
                                message: 'Generic.ERROR_MESSAGE',
                                vars: { msg: 'CONTA DE DESCONTO NÃO INFORMADA!!!' },
                            },
                        ],
                    },
                },
            }),
        );

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(execucaoRepository.markError).toHaveBeenCalledWith(
            KEY,
            expect.objectContaining({ erroMensagem: 'CONTA DE DESCONTO NÃO INFORMADA!!!' }),
        );
        expect(out.resultados[0].erro).toBe('CONTA DE DESCONTO NÃO INFORMADA!!!');
    });

    it('throws when adiantamento has no alocacoes', async () => {
        const { service, alocacaoRepository } = buildDeps();
        alocacaoRepository.listAtivas.mockResolvedValue([]);

        await expect(
            service.reconciliar({
                adiantamentoDocCod: '2767',
                executadoPor: 'yuri',
                dataMovto: 1,
            }),
        ).rejects.toThrow(/no alocacoes/);
    });

    it('DESCONTO classification routes the value to bxaMnyDesconto (juros=0)', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, alocacaoRepository } = buildDeps();
        alocacaoRepository.listAtivas.mockResolvedValue([
            buildAloc({ variacaoClassificacao: 'DESCONTO', variacaoResultado: 150 }),
        ]);

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        const payload = conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload;
        expect(payload.bxaMnyJuros).toBe(0);
        expect(payload.bxaMnyDesconto).toBe(150);
        // OBRIGATÓRIO: a conta de desconto (130 = VAR. CAMBIAL ATIVA) precisa ir setada — senão o ERP
        // recusa a FINALIZAÇÃO ("CONTA DE DESCONTO NÃO INFORMADA"). É uma CONSTANTE, não vem do ERP.
        expect(payload.bxaCodGerDesconto).toBe(130);
        expect(payload.gerDesDesconto).toBe('VARIAÇÃO CAMBIAL ATIVA REALIZADA');
        // No caso DESCONTO o lado de juros fica nulo (espelha o padrão validado da baixa de juros).
        expect(payload.bxaCodGerJuros).toBeNull();
        expect(payload.bxaMnyJuros).toBe(0);
        // Comentário nomeia a conta 130.
        expect(payload.bxaEspComplemento).toContain('130');
    });

    it('anti-drift (I-Write-1): aborts when the baixa exceeds the ERP em-aberto (over-pay)', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, execucaoRepository } = buildDeps();
        // baixa desejada = 1000 × 5.0 = 5000; em-aberto do ERP só 3000 → 5000 > 3000 → abort.
        conexosClient.validarTituloBaixa.mockResolvedValue({
            responseData: { bxaMnyValor: 3000 },
        });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
        expect(execucaoRepository.markError).toHaveBeenCalledWith(
            KEY,
            expect.objectContaining({ erroMensagem: expect.stringContaining('anti-drift') }),
        );
        expect(out.resultados[0].status).toBe('error');
    });

    it('aborts when a validacao step returns ERRO in the messages envelope', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient } = buildDeps();
        conexosClient.validarTituloBaixa.mockResolvedValue({
            messages: [{ valid: 'ERRO', message: 'FIN_XXX.TITULO_BLOQUEADO' }],
            responseData: { bxaMnyValor: 40879.9 },
        });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
        expect(out.resultados[0].status).toBe('error');
    });

    it('rounds money to 2 decimals before the ERP (CnxValidatorMny precision_not_supported)', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, conexosClient, alocacaoRepository } = buildDeps();
        // variação com ruído de ponto flutuante (caso real: 1000×(5.2887−4.9806)).
        alocacaoRepository.listAtivas.mockResolvedValue([
            buildAloc({ variacaoResultado: 308.1000000000005 }),
        ]);
        conexosClient.atualizarValorLiquido.mockResolvedValue({
            responseData: { bxaMnyLiquido: 5288.700000000001 },
        });

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        // step 4 recebe o juros já arredondado
        expect(conexosClient.atualizarValorLiquido.mock.calls[0][0].juros).toBe(308.1);
        // payload final do step 5 sem ruído de FP
        const payload = conexosClient.gravarBaixaPermuta.mock.calls[0][0].payload;
        expect(payload.bxaMnyJuros).toBe(308.1);
        expect(payload.bxaMnyLiquido).toBe(5288.7);
    });

    it('persists borCod before the handshake POSTs (orphan recovery)', async () => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
        const { service, execucaoRepository } = buildDeps();

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(execucaoRepository.setBorCod).toHaveBeenCalledWith(KEY, 1999);
    });
});

/**
 * I-Recon-5 (R-1, P0) — SERIALIZAÇÃO POR ADIANTAMENTO.
 *
 * O ledger write-ahead protege contra INTERRUPÇÃO, não contra CONCORRÊNCIA: duas requisições
 * simultâneas ao mesmo adto leem `findByIdempotencyKey` antes de qualquer uma escrever, as duas se
 * veem como "primeira tentativa", e as duas seguem o handshake — dois borderôs no fin010, duas
 * baixas para o mesmo par. Este é o único teste de concorrência do write path da permuta.
 */
describe('ReconciliacaoPermutaService — serialização por adiantamento (I-Recon-5)', () => {
    beforeEach(() => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
    });

    it('serializa dois POSTs concorrentes para o MESMO adto: 1 baixa, 1 borderô, 409 no perdedor', async () => {
        const { service, conexosClient, logService } = buildDeps();

        const [a, b] = await Promise.allSettled([
            service.reconciliar({
                adiantamentoDocCod: '2767',
                executadoPor: 'yuri',
                dataMovto: 1,
            }),
            service.reconciliar({
                adiantamentoDocCod: '2767',
                executadoPor: 'simone',
                dataMovto: 1,
            }),
        ]);

        // Exatamente UMA execução tocou o ERP — e o borderô conta tanto quanto a baixa: assertar só
        // `gravarBaixaPermuta` deixaria passar o borderô órfão duplicado.
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
        expect(conexosClient.criarBordero).toHaveBeenCalledTimes(1);

        const vencedora = a.status === 'fulfilled' ? a : b;
        const perdedora = a.status === 'rejected' ? a : b;
        expect(vencedora.status).toBe('fulfilled');
        expect(perdedora.status).toBe('rejected');
        const err = (perdedora as PromiseRejectedResult).reason;
        expect(err).toBeInstanceOf(ReconciliacaoEmAndamentoError);
        expect(err.statusCode).toBe(409);
        expect(err.retryable).toBe(true);
        expect(err.code).toBe('RECONCILIACAO_EM_ANDAMENTO');
        expect(err.userMessage).toMatch(/Aguarde/i);
        // O caller barrado é observável: WARN antes de lançar (espelha RemessaService).
        expect(logService.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('concorrente'),
                data: expect.objectContaining({ adiantamentoDocCod: '2767' }),
            }),
        );
    });

    it('o caller barrado NÃO toca o ERP (zero borderô, zero validação, zero baixa atribuível)', async () => {
        const { service, conexosClient } = buildDeps();

        await Promise.allSettled([
            service.reconciliar({
                adiantamentoDocCod: '2767',
                executadoPor: 'yuri',
                dataMovto: 1,
            }),
            service.reconciliar({
                adiantamentoDocCod: '2767',
                executadoPor: 'simone',
                dataMovto: 1,
            }),
        ]);

        // Uma execução completa = 1 borderô + 1 handshake (2 validações + 1 gravação). Os totais
        // batem com UMA execução ⇒ nada é atribuível à perdedora.
        expect(conexosClient.criarBordero).toHaveBeenCalledTimes(1);
        expect(conexosClient.validarTituloBaixa).toHaveBeenCalledTimes(1);
        expect(conexosClient.validarTituloPermuta).toHaveBeenCalledTimes(1);
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });

    it('adiantamentos DISTINTOS não se bloqueiam (o lock é por adto, não global)', async () => {
        const { service, conexosClient, alocacaoRepository } = buildDeps();
        alocacaoRepository.listAtivas = jest
            .fn()
            .mockResolvedValue([
                buildAloc(),
                buildAloc({ adiantamentoDocCod: '9999', invoiceDocCod: '5079' }),
            ]);

        const out = await Promise.all([
            service.reconciliar({
                adiantamentoDocCod: '2767',
                executadoPor: 'yuri',
                dataMovto: 1,
            }),
            service.reconciliar({
                adiantamentoDocCod: '9999',
                executadoPor: 'simone',
                dataMovto: 1,
            }),
        ]);

        expect(out).toHaveLength(2);
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(2);
    });

    it('a chave do lock é estável e distinta por adiantamento (hash int32)', async () => {
        const { service, db } = buildDeps();
        await service.reconciliar({ adiantamentoDocCod: '2767', executadoPor: 'y', dataMovto: 1 });
        await service.reconciliar({ adiantamentoDocCod: '2767', executadoPor: 'y', dataMovto: 1 });
        const chaves = (db.withAdvisoryLock as jest.Mock).mock.calls.map((c) => c[0] as number);
        expect(chaves[0]).toBe(chaves[1]); // estável
        expect(Number.isInteger(chaves[0])).toBe(true);
        expect(chaves[0]).toBeGreaterThanOrEqual(-(2 ** 31));
        expect(chaves[0]).toBeLessThanOrEqual(2 ** 31 - 1);
    });
});

/**
 * I-Write-8a — PRÉ-CHECAGEM DE COBERTURA (fail-closed antes do 1º POST).
 *
 * A cobertura é DERIVADA, não lida: `Σ (valorNegociado − valorPago/taxa)` sobre os títulos que o
 * ERP devolveu. NÃO é a soma da face — `titVldStatus#EQ 1` seleciona ATIVO (ciclo de vida do
 * registro), não "em aberto", e um título quitado volta com a face cheia (medido em produção,
 * 2026-09-08: doc 9320, face USD 83.476,12, aberto 0). Somar a face aprovaria uma cobertura
 * INEXISTENTE — o gate nasceria frouxo justo no caso que ele existe para recusar.
 */
describe('ReconciliacaoPermutaService — cobertura em aberto (I-Write-8a)', () => {
    beforeEach(() => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
    });

    it('aborta ANTES do 1º POST quando a cobertura < valorAlocado (nada escrito no ERP)', async () => {
        const { service, conexosClient, execucaoRepository } = buildDeps();
        // Σ aberto = 600 + 300 = 900 < 1000 alocado.
        conexosClient.listTitulosAPagar = jest.fn().mockResolvedValue([
            { titCod: '1', valorNegociado: 600, taxa: 5.0, valorPago: 0 },
            { titCod: '2', valorNegociado: 300, taxa: 5.0, valorPago: 0 },
        ]);

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('error');
        expect(out.resultados[0].erro).toMatch(/não cobrem|Re-aloque/i);
        // Nenhuma escrita: nem baixa, nem terminal na trilha.
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
        expect(execucaoRepository.markSettled).not.toHaveBeenCalled();
        expect(execucaoRepository.markParcial).not.toHaveBeenCalled();
        // O borderô criado nesta chamada é um casco vazio ⇒ a limpeza I-Write-7 o remove do ERP.
        expect(conexosClient.excluirBordero).toHaveBeenCalledWith(
            expect.objectContaining({ borCod: 1999 }),
        );
    });

    it('a cobertura é o ABERTO, não a face: título ATIVO e já quitado não contribui', async () => {
        const { service, conexosClient } = buildDeps();
        // Face 1000 (500 + 500), mas o segundo está QUITADO (pago 2500 BRL ÷ taxa 5 = 500 USD).
        // Cobertura real = 500 < 1000 alocado ⇒ aborta. Somando a face daria 1000 e aprovaria.
        conexosClient.listTitulosAPagar = jest.fn().mockResolvedValue([
            { titCod: '1', valorNegociado: 500, taxa: 5.0, valorPago: 0 },
            { titCod: '2', valorNegociado: 500, taxa: 5.0, valorPago: 2500, pago: 1 },
        ]);

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('error');
        expect(out.resultados[0].erro).toMatch(/não cobrem/i);
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
    });

    it('`pago === 1` divergindo do aberto derivado vira BUSINESS_WARN — nunca recusa', async () => {
        const { service, conexosClient, logService } = buildDeps();
        // Contrato do ERP em contradição consigo mesmo: diz TOTALMENTE PAGO e devolve pago=0.
        // Dois campos do ERP discordando é problema de quem mantém o contrato — a baixa segue.
        conexosClient.listTitulosAPagar = jest
            .fn()
            .mockResolvedValue([
                { titCod: '1', valorNegociado: 1000, taxa: 5.0, valorPago: 0, pago: 1 },
            ]);

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('settled');
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
        expect(logService.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('pago'),
                data: expect.objectContaining({ titCod: 1 }),
            }),
        );
    });

    it('NÃO dispara no fallback de título único — lista vazia (caminho majoritário em produção)', async () => {
        const { service, conexosClient } = buildDeps();
        conexosClient.listTitulosAPagar = jest.fn().mockResolvedValue([]);

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        // O fallback é SINTÉTICO (`[{titCod:1, usd: valorAlocado}]`), não uma medida do ERP: sua
        // soma iguala o alocado por construção. Aplicar 8a aqui não mede nada e quebraria a maior
        // parte do volume real.
        expect(out.resultados[0].status).toBe('settled');
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });

    it('NÃO dispara no fallback de título único — ERP indisponível (catch)', async () => {
        const { service, conexosClient } = buildDeps();
        conexosClient.listTitulosAPagar = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('settled');
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });

    it('a origem dos títulos é rastreada, não inferida por contagem: 1 título REAL do ERP dispara 8a', async () => {
        const { service, conexosClient } = buildDeps();
        // Uma invoice legítima de título único é INDISTINGUÍVEL do fallback por `titulos.length===1`.
        // Se a guarda fosse por contagem, este caso passaria batido — e ele é justamente um dos que
        // 8a existe para recusar.
        conexosClient.listTitulosAPagar = jest
            .fn()
            .mockResolvedValue([{ titCod: '1', valorNegociado: 900, taxa: 5.0, valorPago: 0 }]);

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('error');
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
    });

    it('fronteira da tolerância: −0,004 passa; −0,006 aborta (0,005 em MOEDA NEGOCIADA)', async () => {
        // Esta tolerância é distinta da anti-drift de `baixarTitulo`
        // (`Math.max(0.01, emAbertoErp*0.005)`, em BRL, POR TÍTULO, contra o em-aberto vivo do ERP).
        // Aqui é o agregado do par, na moeda negociada — as duas não se substituem.
        const dentro = buildDeps();
        dentro.conexosClient.listTitulosAPagar = jest
            .fn()
            .mockResolvedValue([{ titCod: '1', valorNegociado: 999.996, taxa: 5.0, valorPago: 0 }]);
        const okOut = await dentro.service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });
        expect(okOut.resultados[0].status).not.toBe('error');

        const fora = buildDeps();
        fora.conexosClient.listTitulosAPagar = jest
            .fn()
            .mockResolvedValue([{ titCod: '1', valorNegociado: 999.994, taxa: 5.0, valorPago: 0 }]);
        const badOut = await fora.service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });
        expect(badOut.resultados[0].status).toBe('error');
        expect(badOut.resultados[0].erro).toMatch(/não cobrem/i);
    });

    it('o 422 NÃO derruba o lote: o adto seguinte continua sendo processado', async () => {
        const { service, conexosClient, alocacaoRepository } = buildDeps();
        alocacaoRepository.listAtivas = jest.fn().mockResolvedValue([
            buildAloc(),
            buildAloc({
                invoiceDocCod: '5079',
                atualizadoEm: new Date('2026-06-24T00:00:00Z'),
            }),
        ]);
        conexosClient.listTitulosAPagar = jest
            .fn()
            .mockImplementation((p: { docCod: string }) =>
                Promise.resolve(
                    p.docCod === '5078'
                        ? [{ titCod: '1', valorNegociado: 900, taxa: 5.0, valorPago: 0 }]
                        : [{ titCod: '1', valorNegociado: 1000, taxa: 5.0, valorPago: 0 }],
                ),
            );

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados.map((r) => r.status)).toEqual(['error', 'settled']);
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });
});

/**
 * I-Recon-6/7 + I-Write-8b — TERMINAL `parcial`.
 *
 * `parcial` não é `settled` degradado nem `error` suavizado: é o registro fiel de uma escrita que
 * aconteceu pela metade. `settled` afirma "o alocado foi integralmente baixado"; declarar isso com
 * resíduo é uma afirmação falsa no livro-razão.
 */
describe('ReconciliacaoPermutaService — terminal parcial (I-Recon-6/7, I-Write-8b)', () => {
    beforeEach(() => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
    });

    /**
     * O RESÍDUO QUE 8a NÃO ALCANÇA, e por que ele existe.
     *
     * A pré-checagem compara a cobertura em aberto com o alocado ANTES do 1º POST — e passa aqui
     * (cobertura 1000 = alocado 1000). O resíduo nasce DEPOIS: `baixarTitulo` posta
     * `min(valorBaixaDesejado, emAbertoErp)`, e o em-aberto VIVO do passo 2 é 4.990 BRL, não os
     * 5.000 que a alocação previa (drift dentro da tolerância anti-drift de I-Write-1, que é
     * `max(0,01; 4990×0,005) = 24,95` — por isso a baixa não aborta, ela ENTRA MENOR).
     *
     * Baixamos 4.990 BRL ÷ taxa 5 = 998 USD dos 1.000 alocados. Antes desta mudança o laço debitava
     * `restanteUsd` pela INTENÇÃO (1.000) e a execução fechava `settled` — afirmando ter baixado
     * 2 USD que o ERP nunca recebeu. Este é o `settled` mudo que a ADR-0044 mata.
     */
    it('resíduo detectado APÓS o 1º POST ⇒ markParcial com resíduo, markSettled NUNCA', async () => {
        const { service, conexosClient, execucaoRepository } = buildDeps();
        conexosClient.listTitulosAPagar = jest
            .fn()
            .mockResolvedValue([{ titCod: '1', valorNegociado: 1000, taxa: 5.0, valorPago: 0 }]);
        conexosClient.validarTituloBaixa = jest
            .fn()
            .mockResolvedValue({ responseData: { bxaMnyValor: 4990 } });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
        expect(execucaoRepository.markSettled).not.toHaveBeenCalled();
        expect(execucaoRepository.markParcial).toHaveBeenCalledWith(
            KEY,
            expect.objectContaining({ borCod: 1999, valorResidualUsd: 2, valorBaixado: 4990 }),
        );
        expect(out.resultados[0].status).toBe('parcial');
        expect(out.resultados[0].valorResidualUsd).toBe(2);
    });

    it('parcial emite BUSINESS_WARN com os QUATRO campos de I-Recon-7(a)', async () => {
        const { service, conexosClient, logService } = buildDeps();
        conexosClient.listTitulosAPagar = jest
            .fn()
            .mockResolvedValue([{ titCod: '1', valorNegociado: 1000, taxa: 5.0, valorPago: 0 }]);
        conexosClient.validarTituloBaixa = jest
            .fn()
            .mockResolvedValue({ responseData: { bxaMnyValor: 4990 } });

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(logService.warn).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'BUSINESS_WARN',
                data: expect.objectContaining({
                    adiantamentoDocCod: 2767,
                    invoiceDocCod: 5078,
                    borCod: 1999,
                    valorResidualUsd: 2,
                }),
            }),
        );
    });

    it('parcial é PRESERVADO na re-execução da mesma chave (o dinheiro já se moveu)', async () => {
        const { service, conexosClient, execucaoRepository } = buildDeps();
        execucaoRepository.beginExecution = jest
            .fn()
            .mockResolvedValue({ status: 'parcial', alreadySettled: true });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('skipped');
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
    });

    it('parcial + borderô VIVO no ERP ⇒ skipped (I-Recon-1 preservado)', async () => {
        const { service, conexosClient, execucaoRepository } = buildDeps();
        execucaoRepository.findByIdempotencyKey = jest
            .fn()
            .mockResolvedValue({ status: 'parcial', borCod: 1999, dryRun: false });
        conexosClient.getBordero = jest
            .fn()
            .mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: null });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('skipped');
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
        expect(execucaoRepository.renameKey).not.toHaveBeenCalled();
    });

    it('C-8 — parcial + borderô CANCELADO no ERP ⇒ relançável (simetria com settled)', async () => {
        const { service, conexosClient, execucaoRepository } = buildDeps();
        // Sem esta simetria a tela (B3: "nenhum borderô válido ⇒ reabre") diria PENDENTE e o
        // ledger recusaria em silêncio com `skipped` — os dois lados discordando sobre dinheiro.
        execucaoRepository.findByIdempotencyKey = jest
            .fn()
            .mockResolvedValue({ status: 'parcial', borCod: 1999, dryRun: false });
        conexosClient.getBordero = jest.fn().mockResolvedValue({ borVldFinalizado: 2 });

        await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(execucaoRepository.renameKey).toHaveBeenCalledWith(KEY, `${KEY}:sup:1999`);
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });

    it('I-Write-7: um par `parcial` CONTA como baixa confirmada ⇒ o borderô NÃO é removido', async () => {
        const { service, conexosClient } = buildDeps();
        // Sem isto a limpeza do órfão apagaria do ERP um borderô que TEM baixa real dentro. Ela é
        // fail-safe via `listBaixas`, mas depender disso é depender de um catch.
        conexosClient.listTitulosAPagar = jest
            .fn()
            .mockResolvedValue([{ titCod: '1', valorNegociado: 1000, taxa: 5.0, valorPago: 0 }]);
        conexosClient.validarTituloBaixa = jest
            .fn()
            .mockResolvedValue({ responseData: { bxaMnyValor: 4990 } });

        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'yuri',
            dataMovto: 1,
        });

        expect(out.resultados[0].status).toBe('parcial');
        expect(conexosClient.excluirBordero).not.toHaveBeenCalled();
    });
});

/**
 * T2 (`testability-4`) — `borderoAindaValido` tem 5 ramos e nenhum era exercitado por inteiro.
 * É o método que decide se uma baixa já feita PODE ser refeita: cada ramo vale dinheiro.
 */
describe('ReconciliacaoPermutaService — borderoAindaValido, os 5 ramos (T2)', () => {
    beforeEach(() => {
        envFlags.conexosWriteEnabled = true;
        envFlags.conexosDryRun = false;
    });

    const comSettledExistente = (borCod?: number) => {
        const deps = buildDeps();
        deps.execucaoRepository.findByIdempotencyKey = jest.fn().mockResolvedValue({
            status: 'settled',
            dryRun: false,
            ...(borCod !== undefined ? { borCod } : {}),
        });
        return deps;
    };

    it('borCod undefined (settled sem borderô registrado) ⇒ LIBERA a re-baixa', async () => {
        const { service, conexosClient } = comSettledExistente();
        await service.reconciliar({ adiantamentoDocCod: '2767', executadoPor: 'y', dataMovto: 1 });
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });

    it('getBordero → null (borderô REMOVIDO do ERP) ⇒ LIBERA', async () => {
        const { service, conexosClient } = comSettledExistente(1999);
        conexosClient.getBordero = jest.fn().mockResolvedValue(null);
        await service.reconciliar({ adiantamentoDocCod: '2767', executadoPor: 'y', dataMovto: 1 });
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });

    it('borCodEstornado preenchido (ESTORNADO) ⇒ LIBERA', async () => {
        const { service, conexosClient } = comSettledExistente(1999);
        conexosClient.getBordero = jest
            .fn()
            .mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: 999 });
        await service.reconciliar({ adiantamentoDocCod: '2767', executadoPor: 'y', dataMovto: 1 });
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });

    it('borVldFinalizado === 2 (CANCELADO) ⇒ LIBERA', async () => {
        const { service, conexosClient } = comSettledExistente(1999);
        conexosClient.getBordero = jest.fn().mockResolvedValue({ borVldFinalizado: 2 });
        await service.reconciliar({ adiantamentoDocCod: '2767', executadoPor: 'y', dataMovto: 1 });
        expect(conexosClient.gravarBaixaPermuta).toHaveBeenCalledTimes(1);
    });

    it('getBordero REJEITA (ETIMEDOUT) ⇒ BLOQUEIA — incerto é conservador, de propósito', async () => {
        // Este é o ramo que aparece em incidente e o primeiro que alguém "otimizaria" ao contrário
        // ("o ERP caiu, deixa passar"). Não: sob incerteza sobre uma baixa que PODE existir,
        // re-POSTar é SUPER-PAGAMENTO — dinheiro que sai duas vezes e volta por processo manual.
        // Bloquear custa um `skipped` e uma conferência; liberar custa o pagamento em dobro.
        const { service, conexosClient } = comSettledExistente(1999);
        conexosClient.getBordero = jest.fn().mockRejectedValue(new Error('ETIMEDOUT'));
        const out = await service.reconciliar({
            adiantamentoDocCod: '2767',
            executadoPor: 'y',
            dataMovto: 1,
        });
        expect(out.resultados[0].status).toBe('skipped');
        expect(conexosClient.gravarBaixaPermuta).not.toHaveBeenCalled();
    });
});
