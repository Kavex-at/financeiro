import 'reflect-metadata';
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
        markError: jest.fn().mockResolvedValue(undefined),
        listByAdiantamento: jest.fn().mockResolvedValue([]),
        deleteBorderoCache: jest.fn().mockResolvedValue(1),
    };
    const relationalRepository = {
        findAdiantamento: jest
            .fn()
            .mockResolvedValue({ docCod: '2767', priCod: '1408', filCod: 4 }),
    };
    const logService = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
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
    );
    return {
        service,
        conexosClient,
        alocacaoRepository,
        execucaoRepository,
        relationalRepository,
        alocacaoService,
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
