import 'reflect-metadata';
import type ConexosFin014Client from '../../client/ConexosFin014Client.js';
import type ConexosGerDocProcessoClient from '../../client/ConexosGerDocProcessoClient.js';
import type ConexosNdeClient from '../../client/ConexosNdeClient.js';
import type ConexosNdeFiscalClient from '../../client/ConexosNdeFiscalClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type {
    SolicitacaoNumerarioExecucaoRepositoryInterface,
    SolicitacaoNumerarioExecucaoRow,
} from '../../interface/recebimentos/ports.js';
import ContingenciaDecider from './ContingenciaDecider.js';
import ErpErrorInterpreter from '../permutas/ErpErrorInterpreter.js';
import RecebimentoNumerarioService from './RecebimentoNumerarioService.js';
import type { ProcessarAlocacaoInput } from './RecebimentoNumerarioService.js';
import SnPayloadBuilder from './SnPayloadBuilder.js';

/**
 * RecebimentoNumerarioService — orquestrador REAL payment-driven (por alocação). Todos os clients
 * mockados: happy-path per-stage, retomada (skip do já-feito), guard SINIEF do com131, roteamento de
 * contingência, docVldComvalidacoes===2 (revisão humana), poll timeout (não-erro), docMnyValor==0
 * (continua), dry-run (nenhum POST).
 */

const logStub = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const logService = logStub as never;

interface Mocks {
    gerDoc: jest.Mocked<ConexosGerDocProcessoClient>;
    fin014: jest.Mocked<ConexosFin014Client>;
    fiscal: jest.Mocked<ConexosNdeFiscalClient>;
    nde: jest.Mocked<ConexosNdeClient>;
    repo: jest.Mocked<SolicitacaoNumerarioExecucaoRepositoryInterface>;
    ndeRepo: { save: jest.Mock; findByRecebimentoId: jest.Mock };
    env: jest.Mocked<EnvironmentProvider>;
}

const buildEnv = (over: Record<string, unknown> = {}): jest.Mocked<EnvironmentProvider> =>
    ({
        getEnvironmentVars: jest.fn().mockResolvedValue({
            conexosWriteEnabled: true,
            conexosDryRun: false,
            solicitacaoNumerarioGcdCod: 150,
            com297GcdNotaDebitoNome: 'NOTA DE DÉBITO ELETRÔNICA',
            com297GcdNotaDebito: undefined,
            ndePollTimeoutMs: 30,
            ndePollIntervalMs: 1,
            // Default de produção: o ajuste da condição de pagamento está LIGADO (o freio é opt-out).
            snCondPgtoAutoajuste: true,
            ...over,
        }),
    }) as never;

const buildMocks = (over: Partial<Mocks> = {}): Mocks => ({
    gerDoc: {
        validaProcessoPessoa: jest.fn().mockResolvedValue({
            pesCod: 194,
            endCodFis: 2,
            pdcDocFederal: '37032037000101',
        }),
        validaConfigDocPessoa: jest.fn().mockResolvedValue({
            gcdCod: 188,
            gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA',
        }),
        validaConfigDoc: jest.fn().mockResolvedValue({
            tpcCod: 700,
            cfoEspCod: '1.1.00.001',
            gcdVldFormaRateio: 1,
            gcdVldTela: 2,
            gcdVldPropria: 1,
            fisEspSerie: null,
        }),
        // Gate 3 do pré-flight: por padrão o gcd alvo (150) é elegível (sem ERRO no validaConfigDoc).
        verificarConfigElegivel: jest.fn().mockResolvedValue({ elegivel: true }),
        // Gate 3 AUTORITATIVO: o processo aceita a "SN - ENCOMENDA" (gcd 150) na lista ConfigDocProcesso.
        listConfigDocProcesso: jest.fn().mockResolvedValue([
            { gcdCod: 150, gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA' },
            { gcdCod: 90, gcdDesNome: 'CONTAS A RECEBER ANTES DO CONEXOS - TERCEIROS' },
        ]),
        listContasProjeto: jest
            .fn()
            .mockResolvedValue([
                { prjCod: 10, ctpCod: 690, tpcCod: 700, cfoEspCod: '1.1.00.001', total: 100 },
            ]),
        resolveGcdCodByName: jest.fn().mockResolvedValue(300),
        validarGeracao: jest.fn().mockResolvedValue([]),
        gerarDocProcesso: jest.fn().mockResolvedValue({ docCod: 0, messages: [] }),
        finalizarDocumento: jest.fn().mockResolvedValue([]),
        adicionarProduto: jest.fn().mockResolvedValue([]),
        // Completar o adiantamento SN (condição de pagamento + linha de item) antes de finalizar.
        // O LOV vem com a "DUPLICATA" de OUTRO cliente ANTES da do cliente do documento — é assim que o
        // ERP responde de verdade (HML 2026-08-03: `lov/CondPgtoPessoa` ignora o filtro `pesCod` e devolve
        // a lista GLOBAL ordenada por nome). O serviço tem que casar pelo nome do cliente, não pela ordem.
        listCondPgtoPessoa: jest.fn().mockResolvedValue([
            { pgtCod: 1, pgtDesNome: 'A VISTA' },
            { pgtCod: 103, pgtDesNome: 'BONDUELLE - DUPLICATA' },
            { pgtCod: 109, pgtDesNome: 'CLIENTE EXEMPLO - DUPLICATA' },
        ]),
        listContasProjetoCtb: jest.fn().mockResolvedValue([
            {
                ctpCod: 690,
                ctpDesNome: 'ADIANTAMENTO DE CLIENTE ENCOMENDA',
                ctpEspConta: '304001',
            },
        ]),
        // Documento COERENTE: o título que o ERP cria na geração bate com o valor do documento. É o
        // estado que a etapa tem que PRESERVAR (HML 2026-08-03, docs 736/737).
        getDocumento: jest
            .fn()
            .mockResolvedValue({ docCod: 0, docMnyValor: 15000, mnyTitValor: 15000, pgtCod: 1 }),
        atualizarDocumento: jest.fn().mockResolvedValue({}),
        comDocProdutosInitialValues: jest
            .fn()
            .mockResolvedValue({ prdCod: 2, tpcCod: 33, cfoEspCod: '9999A2', undCod: 3 }),
        adicionarComDocProduto: jest.fn().mockResolvedValue({ dprCodSeq: 1 }),
    } as never,
    fin014: {
        criarBordero: jest
            .fn()
            .mockResolvedValue({ borCod: 77, dryRun: false, gerDes: 'BANCO BRASIL - CONTA 1' }),
        // O título a-receber pertence AO doc da SN — docCod = o snDocCod (18200 no wireDocCods).
        listTitulosBorderoReceber: jest
            .fn()
            .mockResolvedValue([
                { docCod: 18200, titCod: 1, titEspNumero: '2082026', titMnyAberto: 15000 },
            ]),
        validarTituloBaixa: jest.fn().mockResolvedValue({
            messages: [],
            responseData: { bxaMnyValor: 15000, bxaVldCcorrente: 1 },
        }),
        gravarBaixa: jest.fn().mockResolvedValue({ bxaCodSeq: 1 }),
        finalizarBordero: jest.fn().mockResolvedValue(undefined),
    } as never,
    fiscal: {
        lerDocFiscal: jest.fn().mockResolvedValue({
            filCod: 2,
            docTip: 1,
            docCod: 18337,
            fisCod: 1,
            fisVldTipoNfDebito: 0,
        }),
        gravarDocFiscal: jest.fn().mockResolvedValue({ fisVldTipoNfDebito: 6 }),
        lerObservacoes: jest.fn().mockResolvedValue({}),
        gerarObservacoes: jest.fn().mockResolvedValue({ fisEspObs: 'AJUSTE SINIEF /' }),
        listValidacoes: jest.fn().mockResolvedValue([]),
        lerDocParaPolling: jest
            .fn()
            .mockResolvedValue({ vldTpNf: '10', vldAutorizado: 1, docMnyValor: 15000 }),
    } as never,
    nde: {
        homologar: jest.fn().mockResolvedValue({
            docVldComvalidacoes: 1,
            avisoValidacoesPendentes: false,
            erpResponse: {},
        }),
    } as never,
    repo: {
        findByIdempotencyKey: jest.fn().mockResolvedValue(null),
        beginExecution: jest
            .fn()
            .mockResolvedValue({ status: 'reconciling', alreadySettled: false }),
        setDocCod: jest.fn().mockResolvedValue(undefined),
        setRequestPayload: jest.fn().mockResolvedValue(undefined),
        setFin014BorCod: jest.fn().mockResolvedValue(undefined),
        setNdDocCod: jest.fn().mockResolvedValue(undefined),
        setEtapa: jest.fn().mockResolvedValue(undefined),
        setRevisaoHumana: jest.fn().mockResolvedValue(undefined),
        setNdeAutorizado: jest.fn().mockResolvedValue(undefined),
        markSettled: jest.fn().mockResolvedValue(undefined),
        markError: jest.fn().mockResolvedValue(undefined),
    } as never,
    ndeRepo: {
        save: jest.fn().mockImplementation((nde: unknown) => Promise.resolve(nde)),
        findByRecebimentoId: jest.fn().mockResolvedValue(null),
    },
    env: buildEnv(),
    ...over,
});

const buildService = (m: Mocks): RecebimentoNumerarioService =>
    new RecebimentoNumerarioService(
        m.gerDoc,
        m.fin014,
        m.fiscal,
        m.nde,
        new ContingenciaDecider(),
        m.env,
        new SnPayloadBuilder(),
        m.repo,
        m.ndeRepo as never,
        logService,
        new ErpErrorInterpreter(),
    );

// O pagamento vive na filial 1; o processo escolhido, na filial 7. TODO o fluxo Conexos roda na
// filial DO PROCESSO (7); a conta financeira (gerNum) segue sendo a do pagamento — é global.
const PROCESSO_FIL_COD = 7;
const PAGAMENTO_FIL_COD = 1;

const baseInput = (over: Partial<ProcessarAlocacaoInput> = {}): ProcessarAlocacaoInput => ({
    txnId: 'txn-1',
    transacao: { gerNum: 55795, filCod: PAGAMENTO_FIL_COD, valor: 15000 },
    priCod: 90001,
    valor: 15000,
    processoFields: {
        filCod: PROCESSO_FIL_COD,
        priEspRefcliente: 'REF-1',
        pesCod: 555,
        dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
        moeCod: 790,
    },
    ator: 'yuri',
    ...over,
});

/** Programa `gerarDocProcesso` para devolver SN docCod na 1ª chamada e NDe docCod na 2ª. */
const wireDocCods = (m: Mocks, snDocCod = 18200, ndDocCod = 18337): void => {
    (m.gerDoc.gerarDocProcesso as jest.Mock)
        .mockResolvedValueOnce({ docCod: snDocCod, messages: [] })
        .mockResolvedValueOnce({ docCod: ndDocCod, messages: [] });
};

afterEach(() => jest.clearAllMocks());

describe('RecebimentoNumerarioService.processarAlocacao — happy path (per-stage)', () => {
    it('roda SN → fin014 (gerNum do pagamento) → NDe → fiscal → obs → homologa → poll → settled', async () => {
        const m = buildMocks();
        wireDocCods(m);
        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('settled');
        expect(out.etapa).toBe('concluido');
        expect(out.snDocCod).toBe(18200);
        expect(out.borCod).toBe(77);
        expect(out.ndDocCod).toBe(18337);
        expect(out.ndeAutorizado).toBe(true);
        expect(out.dryRun).toBe(false);

        // fin014: a conta financeira é a gerNum do PAGAMENTO (55795), não uma env fixa.
        expect(m.fin014.criarBordero).toHaveBeenCalledWith(
            expect.objectContaining({ gerNum: 55795 }),
        );
        expect(m.fin014.gravarBaixa).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({ gerNum: 55795, docCod: 18200 }),
            }),
        );
        // fiscal: gravou fisVldTipoNfDebito=6 (RMW).
        expect(m.fiscal.gravarDocFiscal).toHaveBeenCalledWith(
            expect.objectContaining({
                finDocFiscal: expect.objectContaining({ fisVldTipoNfDebito: 6 }),
            }),
        );
    });

    it('roda TODA chamada Conexos na filial DO PROCESSO (7), nunca na do pagamento (1)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());

        const expectFilCod7 = (fn: jest.Mock): void => {
            expect(fn).toHaveBeenCalled();
            for (const call of fn.mock.calls) {
                expect(call[0]).toEqual(expect.objectContaining({ filCod: PROCESSO_FIL_COD }));
                expect(call[0]).not.toEqual(expect.objectContaining({ filCod: PAGAMENTO_FIL_COD }));
            }
        };

        // com299 (SN): validaProcessoPessoa / validaConfigDoc / validarGeracao / gerarDoc / finalizar.
        expectFilCod7(m.gerDoc.validaProcessoPessoa as jest.Mock);
        expectFilCod7(m.gerDoc.validaConfigDoc as jest.Mock);
        expectFilCod7(m.gerDoc.validarGeracao as jest.Mock);
        expectFilCod7(m.gerDoc.gerarDocProcesso as jest.Mock);
        expectFilCod7(m.gerDoc.finalizarDocumento as jest.Mock);
        expectFilCod7(m.gerDoc.resolveGcdCodByName as jest.Mock);
        // fin014: borderô / validar / baixa / finalizar — filial do processo.
        expectFilCod7(m.fin014.criarBordero as jest.Mock);
        expectFilCod7(m.fin014.validarTituloBaixa as jest.Mock);
        expectFilCod7(m.fin014.gravarBaixa as jest.Mock);
        expectFilCod7(m.fin014.finalizarBordero as jest.Mock);
        // cauda fiscal (com300/com131/com194/poll) — filial do processo.
        expectFilCod7(m.fiscal.lerDocFiscal as jest.Mock);
        expectFilCod7(m.fiscal.gravarDocFiscal as jest.Mock);
        expectFilCod7(m.fiscal.lerObservacoes as jest.Mock);
        expectFilCod7(m.fiscal.lerDocParaPolling as jest.Mock);
        // homologar (com297) — filial do processo.
        expectFilCod7(m.nde.homologar as jest.Mock);

        // …mas o gerNum da baixa segue sendo o do PAGAMENTO (global, válido na filial do processo).
        expect(m.fin014.criarBordero).toHaveBeenCalledWith(
            expect.objectContaining({ filCod: PROCESSO_FIL_COD, gerNum: 55795 }),
        );
        expect(m.fin014.gravarBaixa).toHaveBeenCalledWith(
            expect.objectContaining({
                filCod: PROCESSO_FIL_COD,
                payload: expect.objectContaining({ filCod: PROCESSO_FIL_COD, gerNum: 55795 }),
            }),
        );
        // O ledger (beginExecution) grava a filial do processo.
        expect(m.repo.beginExecution).toHaveBeenCalledWith(
            expect.objectContaining({ filCod: PROCESSO_FIL_COD }),
        );
    });

    it('a SN valida pelo WRAPPER com o gcd ALVO (env 150 — validaConfigDocPessoa é só nota) e gera com HEADER ONLY', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());

        // gcd = o ALVO da SN-Encomenda (env SN_GCD_COD=150). O validaConfigDocPessoa NÃO resolve o gcd
        // (devolve null p/ todo processo — inclusive o gerável 3254); vira nota, não decide. Rateio DROPADO.
        expect(m.gerDoc.validaConfigDoc).toHaveBeenCalledWith(
            expect.objectContaining({ tela: 'com299', gcdCod: 150 }),
        );
        expect(m.gerDoc.listContasProjeto).not.toHaveBeenCalled();

        // valida recebe o gcdCod ALVO (150) — o client monta o WRAPPER.
        const validaArgs = (m.gerDoc.validarGeracao as jest.Mock).mock.calls[0][0];
        expect(validaArgs).toEqual(expect.objectContaining({ tela: 'com299', gcdCod: 150 }));
        expect('payload' in validaArgs).toBe(false);

        // A SN e a NDe compartilham o mesmo gerarDocProcesso; a 1ª chamada é a SN (com299, gcd 150 alvo).
        const snGerPayload = (m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls[0][0].payload;
        expect(snGerPayload.gcdCod).toBe(150);
        // HEADER ONLY: sem items no corpo REAL da SN Encomenda.
        expect('items' in snGerPayload).toBe(false);
        // gcdDesNome UPPERCASE; flags de config presentes; tpcCod/cfoEspCod null.
        expect(snGerPayload.gcdDesNome).toBe('SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA');
        expect(snGerPayload.gcdVldTela).toBe(2);
        expect(snGerPayload.gcdVldFormaRateio).toBe(1);
        expect(snGerPayload.tpcCod).toBeNull();
        expect(snGerPayload.cfoEspCod).toBeNull();
        // Datas e número do documento presentes.
        expect(snGerPayload.docEspNumero).toMatch(/^\d{8}$/);
        expect(typeof snGerPayload.docDtaEmissao).toBe('number');
    });

    it('completa o adiantamento SN antes de finalizar: linha de item com o valor, sem tocar na condição', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());

        // Resolveu a conta "ADIANTAMENTO DE CLIENTE ENCOMENDA" e criou a linha de item com o valor.
        const itemArgs = (m.gerDoc.adicionarComDocProduto as jest.Mock).mock.calls[0][0];
        expect(itemArgs.payload).toEqual(
            expect.objectContaining({ dprPreValorun: 15000, prjCod: 1, ctpCod: 690, prdCod: 2 }),
        );

        // Sem validação pendente da com194, a condição de pagamento NÃO é tocada — o PUT destruiria o
        // título que o ERP já criou (medido no HML: docs 734/735).
        expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();

        // A linha de item é criada ANTES da finalização (senão a com194 trava por "sem valor/itens").
        const itemOrder = (m.gerDoc.adicionarComDocProduto as jest.Mock).mock
            .invocationCallOrder[0];
        const finalOrder = (m.gerDoc.finalizarDocumento as jest.Mock).mock.invocationCallOrder[0];
        expect(itemOrder).toBeLessThan(finalOrder);
    });
});

/**
 * O PUT do com299 que troca o `pgtCod` DESTRÓI as parcelas do documento e não as regenera — medido no
 * Conexos de homologação em 2026-08-03 (`docs/e2e/gap-titulos-diagnostico.md`):
 *   - doc 735: geração → título 123,45 · linha de item → título 123,45 · PUT da condição → título 0
 *   - docs 736/737: SEM o PUT a cadeia fecha (`docVldFinalizado:1` e o título aparece no
 *     `lov/TituloBorderoReceber`, que é o que a `etapaFin014` consulta)
 * O `vldRwCondpgt` NÃO é gatilho de regeneração: já vem `1` no GET, ao lado de `right:"RW"`.
 *
 * Por isso a condição virou passo CONDICIONAL: só quando a com194 acusa validação BLOQUEANTE de
 * condição de pagamento (o caso da pessoa 194 em produção, cujo cadastro sugere "L-FOUNDERS -
 * DUPLICATA"). E, aplicada, o resultado é VERIFICADO — título tem que continuar batendo com o
 * documento, senão a etapa falha em vez de finalizar um documento com as parcelas destruídas.
 */
describe('RecebimentoNumerarioService — condição de pagamento só quando a com194 exige', () => {
    /** Validação bloqueante de condição de pagamento, como o ERP a devolve (`fdvVldErr:2`). */
    const VALIDACAO_CONDICAO = {
        fdvCodSeq: 2,
        fdvVldErr: 2,
        fdvEspErr:
            'CONDIÇÃO DE PAGAMENTO DO DOCUMENTO DIFERENTE DA SUGERIDA NO CADASTRO DE PESSOA. ' +
            'PESSOA:555, SUGESTIVA: CLIENTE EXEMPLO - DUPLICATA',
    };

    const comValidacao = (validacoes: unknown[]): Mocks => {
        const m = buildMocks();
        wireDocCods(m);
        (m.fiscal.listValidacoes as jest.Mock).mockResolvedValue(validacoes);
        return m;
    };

    it('aplica a condição do cliente quando a com194 acusa a validação bloqueante', async () => {
        const m = comValidacao([VALIDACAO_CONDICAO]);
        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('settled');
        expect(m.gerDoc.listCondPgtoPessoa).toHaveBeenCalledWith(
            expect.objectContaining({ pesCod: 555 }),
        );
        const putArgs = (m.gerDoc.atualizarDocumento as jest.Mock).mock.calls[0][0];
        expect(putArgs.payload).toEqual(
            expect.objectContaining({ pgtCod: 109, pgtDesNome: 'CLIENTE EXEMPLO - DUPLICATA' }),
        );
    });

    it('a linha de item vem ANTES da leitura das validações e do PUT (o item preserva o título)', async () => {
        const m = comValidacao([VALIDACAO_CONDICAO]);
        await buildService(m).processarAlocacao(baseInput());

        const itemOrder = (m.gerDoc.adicionarComDocProduto as jest.Mock).mock
            .invocationCallOrder[0];
        const validacoesOrder = (m.fiscal.listValidacoes as jest.Mock).mock.invocationCallOrder[0];
        const putOrder = (m.gerDoc.atualizarDocumento as jest.Mock).mock.invocationCallOrder[0];
        expect(itemOrder).toBeLessThan(validacoesOrder);
        expect(validacoesOrder).toBeLessThan(putOrder);
    });

    it('NÃO toca na condição quando a validação bloqueante é de outro assunto', async () => {
        const m = comValidacao([
            { fdvCodSeq: 9, fdvVldErr: 2, fdvEspErr: 'PRODUTO 41978 SEM GTIN CADASTRADO' },
        ]);
        await buildService(m).processarAlocacao(baseInput());

        expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();
        expect(m.gerDoc.listCondPgtoPessoa).not.toHaveBeenCalled();
    });

    it('NÃO toca na condição quando a pendência de condição é só AVISO (fdvVldErr:1)', async () => {
        const m = comValidacao([{ ...VALIDACAO_CONDICAO, fdvVldErr: 1 }]);
        await buildService(m).processarAlocacao(baseInput());

        expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();
    });

    it('FAIL-CLOSED: se o PUT destruir o título, para na etapa sn e NÃO finaliza', async () => {
        const m = comValidacao([VALIDACAO_CONDICAO]);
        // Releituras: (1) montar o item, (2) montar o PUT, (3) VERIFICAR o efeito do PUT — nesta o
        // ERP mostra o título destruído, exatamente como no doc 735 do HML.
        (m.gerDoc.getDocumento as jest.Mock)
            .mockResolvedValueOnce({ docCod: 18200, docMnyValor: 15000, mnyTitValor: 15000 })
            .mockResolvedValueOnce({ docCod: 18200, docMnyValor: 15000, mnyTitValor: 15000 })
            .mockResolvedValue({ docCod: 18200, docMnyValor: 15000, mnyTitValor: 0 });
        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('error');
        expect(out.etapa).toBe('sn');
        expect(out.erro).toMatch(/t[íi]tulo/i);
        expect(out.erro).toContain('18200');
        expect(m.gerDoc.finalizarDocumento).not.toHaveBeenCalled();
        expect(m.repo.markError).toHaveBeenCalled();
    });

    it('a com194 indisponível não bloqueia: segue sem PUT (a finalização é o discriminador seguinte)', async () => {
        const m = comValidacao([]);
        (m.fiscal.listValidacoes as jest.Mock).mockRejectedValue(new Error('com194 fora do ar'));
        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('settled');
        expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();
        expect(m.gerDoc.finalizarDocumento).toHaveBeenCalled();
    });

    /**
     * Gate 0 (transporte × domínio): 401/403/404/405 do validador é bug de rota/permissão, NUNCA a
     * resposta "não há pendência". Tratá-los como domínio foi o que mascarou três bugs nas sondagens do
     * com299 — aqui a etapa tem que PARAR, não seguir com um palpite.
     */
    it.each([
        401, 403, 404, 405,
    ])('HTTP %i da com194 é falha de TRANSPORTE: para a etapa em vez de assumir "sem pendência"', async (status) => {
        const m = comValidacao([]);
        const erro = Object.assign(new Error('com194 recusou'), {
            response: { status },
        });
        (m.fiscal.listValidacoes as jest.Mock).mockRejectedValue(erro);
        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('error');
        expect(out.etapa).toBe('sn');
        expect(out.erro).toContain(String(status));
        expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();
        expect(m.gerDoc.finalizarDocumento).not.toHaveBeenCalled();
    });

    it('5xx do validador segue sendo best-effort (indisponibilidade, não bug de rota)', async () => {
        const m = comValidacao([]);
        const erro = Object.assign(new Error('com194 instável'), { response: { status: 503 } });
        (m.fiscal.listValidacoes as jest.Mock).mockRejectedValue(erro);
        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('settled');
        expect(m.gerDoc.finalizarDocumento).toHaveBeenCalled();
    });

    /**
     * O ramo condicional NÃO é exercitável em homologação (o cliente de teste do HML não tem condição
     * sugerida no cadastro) — sua primeira execução real é em produção. `SN_COND_PGTO_AUTOAJUSTE=false`
     * é o freio operacional: o documento fica íntegro (com item e título) e o analista ajusta na tela.
     */
    it('com o autoajuste DESLIGADO, anuncia a exigência e para sem tocar no documento', async () => {
        const m = comValidacao([VALIDACAO_CONDICAO]);
        m.env = buildEnv({ snCondPgtoAutoajuste: false });
        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('error');
        expect(out.erro).toContain('SN_COND_PGTO_AUTOAJUSTE');
        expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();
        expect(m.gerDoc.finalizarDocumento).not.toHaveBeenCalled();
    });

    it('anuncia com tipo próprio quando o ERP exige a condição (primeira ocorrência tem que ser visível)', async () => {
        const m = comValidacao([VALIDACAO_CONDICAO]);
        await buildService(m).processarAlocacao(baseInput());

        expect(logStub.info).toHaveBeenCalledWith(
            expect.objectContaining({
                message: expect.stringContaining('sn-cond-pgto-exigida-pelo-erp'),
                data: expect.objectContaining({ docCod: 18200, pesCod: 555 }),
            }),
        );
    });
});

/**
 * Regressão do bug REAL medido no Conexos de homologação (2026-08-03, SN com299 nº 731 —
 * `docs/e2e/fase-b-resultado-hml.md`): a SN do SKYJACK (pesCod 232) foi gravada com a condição
 * `pgtCod 103 "BONDUELLE - DUPLICATA"`, de outro cliente, porque o código pegava a PRIMEIRA
 * "DUPLICATA" da lista e o `lov/CondPgtoPessoa` do ERP ignora o filtro `pesCod` (devolve a lista
 * GLOBAL paginada, ordenada por nome). Condição de pagamento é DADO FINANCEIRO: não se chuta.
 */
describe('RecebimentoNumerarioService — condição de pagamento é a DO CLIENTE do documento', () => {
    /**
     * O caso real: cliente SKYJACK, lista global com a DUPLICATA da BONDUELLE vindo antes. A com194
     * devolve a validação bloqueante de condição de pagamento — é ela que ATIVA o passo da condição
     * (sem pendência o serviço não toca no `pgtCod`, para não destruir o título).
     */
    const skyjackMocks = (condicoes: Array<{ pgtCod: number; pgtDesNome: string }>): Mocks => {
        const m = buildMocks();
        (m.gerDoc.listCondPgtoPessoa as jest.Mock).mockResolvedValue(condicoes);
        (m.fiscal.listValidacoes as jest.Mock).mockResolvedValue([
            {
                fdvCodSeq: 2,
                fdvVldErr: 2,
                fdvEspErr:
                    'CONDIÇÃO DE PAGAMENTO DIFERENTE DA SUGERIDA NO CADASTRO DE PESSOA. PESSOA:232',
            },
        ]);
        wireDocCods(m);
        return m;
    };

    const skyjackInput = (): ProcessarAlocacaoInput =>
        baseInput({
            processoFields: {
                filCod: PROCESSO_FIL_COD,
                pesCod: 232,
                // Nome como o imp021 devolve: ABREVIADO/truncado pelo ERP.
                dpeNomPessoa: 'SKYJACK BRASIL IMPORTACAO E COMERCI',
                moeCod: 790,
            },
        });

    it('escolhe a condição do cliente mesmo com outra "DUPLICATA" ANTES na lista (BONDUELLE × SKYJACK)', async () => {
        const m = skyjackMocks([
            { pgtCod: 1, pgtDesNome: 'A VISTA' },
            { pgtCod: 103, pgtDesNome: 'BONDUELLE - DUPLICATA' },
            { pgtCod: 101, pgtDesNome: 'SKYJACK BRASIL - DUPLICATA' },
        ]);
        const out = await buildService(m).processarAlocacao(skyjackInput());

        expect(out.status).toBe('settled');
        const putArgs = (m.gerDoc.atualizarDocumento as jest.Mock).mock.calls[0][0];
        expect(putArgs.payload).toEqual(
            expect.objectContaining({ pgtCod: 101, pgtDesNome: 'SKYJACK BRASIL - DUPLICATA' }),
        );
    });

    it('casa mesmo quando o ERP abrevia o nome do cliente e não o da condição (prefixo bidirecional)', async () => {
        // O doc trazia "SKYJACK BRASIL IMPORTACAO E COMERCI" (truncado) e a condição pode vir com o nome
        // COMPLETO — o casamento é por prefixo de tokens nos dois sentidos, não igualdade.
        const m = skyjackMocks([
            { pgtCod: 103, pgtDesNome: 'BONDUELLE - DUPLICATA' },
            { pgtCod: 101, pgtDesNome: 'SKYJACK BRASIL IMPORTAÇÃO E COMÉRCIO LTDA - DUPLICATA' },
        ]);
        await buildService(m).processarAlocacao(skyjackInput());

        const putArgs = (m.gerDoc.atualizarDocumento as jest.Mock).mock.calls[0][0];
        expect(putArgs.payload).toMatchObject({ pgtCod: 101 });
    });

    it('prefere a condição MAIS específica quando duas do mesmo cliente casam', async () => {
        const m = skyjackMocks([
            { pgtCod: 99, pgtDesNome: 'SKYJACK - DUPLICATA' },
            { pgtCod: 101, pgtDesNome: 'SKYJACK BRASIL - DUPLICATA' },
        ]);
        await buildService(m).processarAlocacao(skyjackInput());

        const putArgs = (m.gerDoc.atualizarDocumento as jest.Mock).mock.calls[0][0];
        expect(putArgs.payload).toMatchObject({ pgtCod: 101 });
    });

    it('FAIL-CLOSED: sem condição do próprio cliente NÃO grava a de terceiro — erra na etapa sn', async () => {
        // Doutrina do `SN_CONTA_ADIANTAMENTO`: não se chuta dado financeiro. Antes, `cond === undefined`
        // apenas pulava o PUT e seguia; com a lista GLOBAL do ERP isso virou "grava a do primeiro cliente
        // alfabético" (o bug do doc 731). Agora a alocação para aqui, com a SN ainda incompleta no ERP.
        const m = skyjackMocks([
            { pgtCod: 1, pgtDesNome: 'A VISTA' },
            { pgtCod: 103, pgtDesNome: 'BONDUELLE - DUPLICATA' },
        ]);
        const out = await buildService(m).processarAlocacao(skyjackInput());

        expect(out.status).toBe('error');
        expect(out.etapa).toBe('sn');
        expect(out.erro).toContain('SKYJACK');
        expect(out.erro).toMatch(/condi[çc][ãa]o de pagamento/i);
        // NÃO gravou condição nenhuma e não finalizou um documento que o ERP recusaria. A linha de item
        // JÁ existe (é o primeiro passo agora) — e é inofensiva: o título segue íntegro no documento.
        expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();
        expect(m.gerDoc.finalizarDocumento).not.toHaveBeenCalled();
        expect(m.repo.markError).toHaveBeenCalled();
    });

    it('FAIL-CLOSED também quando a única "DUPLICATA" é genérica (sem nome de cliente)', async () => {
        const m = skyjackMocks([{ pgtCod: 7, pgtDesNome: 'DUPLICATA' }]);
        const out = await buildService(m).processarAlocacao(skyjackInput());

        expect(out.status).toBe('error');
        expect(m.gerDoc.atualizarDocumento).not.toHaveBeenCalled();
    });
});

describe('RecebimentoNumerarioService.processarAlocacao — happy path (per-stage, cont.)', () => {
    it('chama validaProcessoPessoa PRIMEIRO e threada endCodFis/pdcDocFederal (fonte da SN)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());

        // validaProcessoPessoa é chamado com o priCod + priEspRefcliente do processo (HAR doc 18339).
        expect(m.gerDoc.validaProcessoPessoa).toHaveBeenCalledWith(
            expect.objectContaining({
                tela: 'com299',
                priCod: 90001,
                priEspRefcliente: 'REF-1',
            }),
        );
        // Chamado ANTES de validaConfigDoc (ordem de invocação).
        const pessoaOrder = (m.gerDoc.validaProcessoPessoa as jest.Mock).mock
            .invocationCallOrder[0];
        const configOrder = (m.gerDoc.validaConfigDoc as jest.Mock).mock.invocationCallOrder[0];
        expect(pessoaOrder).toBeLessThan(configOrder);

        // endCodFis (2) + pdcDocFederal vindos do lookup entram no HEADER da SN.
        const snGerPayload = (m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls[0][0].payload;
        expect(snGerPayload.endCodFis).toBe(2);
        expect(snGerPayload.pdcDocFederal).toBe('37032037000101');
        // E o endCodFis real (2, não o default 1) + pdcDocFederal também entram no validaConfigDoc.
        expect(m.gerDoc.validaConfigDoc).toHaveBeenCalledWith(
            expect.objectContaining({
                tela: 'com299',
                endCodFis: 2,
                pdcDocFederal: '37032037000101',
            }),
        );
    });

    it('chama validaProcessoPessoa só com priCod quando o processo não tem priEspRefcliente', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(
            baseInput({
                processoFields: {
                    filCod: 2,
                    pesCod: 555,
                    dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
                    moeCod: 790,
                },
            }),
        );
        const pessoaArgs = (m.gerDoc.validaProcessoPessoa as jest.Mock).mock.calls[0][0];
        expect(pessoaArgs.priCod).toBe(90001);
        expect('priEspRefcliente' in pessoaArgs).toBe(false);
    });

    it('BLOQUEIA (graceful) quando validaProcessoPessoa não devolve endCodFis/pdcDocFederal', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.gerDoc.validaProcessoPessoa as jest.Mock).mockResolvedValue({ pesCod: 194 });
        const out = await buildService(m).processarAlocacao(baseInput());
        // O pré-flight classifica como BLOCKED_CADASTRO — falha graciosa, não um erro cru de etapa.
        expect(out.status).toBe('blocked');
        expect(out.classificacao).toBe('BLOCKED_CADASTRO');
        expect(out.etapa).toBe('sn');
        // Não gerou a SN sem os campos obrigatórios, e nem começou execução (write-ahead).
        expect(m.gerDoc.gerarDocProcesso).not.toHaveBeenCalled();
        expect(m.repo.beginExecution).not.toHaveBeenCalled();
    });

    it('a nota de débito usa o gcd do com297 (resolvido), NUNCA o gcdCod=150 da SN', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());

        // Resolveu o gcd do com297 pelo nome (env override ausente).
        expect(m.gerDoc.resolveGcdCodByName).toHaveBeenCalledWith(
            expect.objectContaining({ tela: 'com297' }),
        );
        expect(m.gerDoc.validaConfigDoc).toHaveBeenCalledWith(
            expect.objectContaining({ tela: 'com297', gcdCod: 300 }),
        );

        // 2ª chamada de gerarDocProcesso é a NDe (com297) — gcd 300, NÃO 150.
        const ndCall = (m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls.find(
            (c) => c[0].tela === 'com297',
        );
        expect(ndCall).toBeDefined();
        expect(ndCall[0].payload.gcdCod).toBe(300);
        expect(ndCall[0].payload.gcdCod).not.toBe(150);
        expect(ndCall[0].payload.prdCod).toBe(41978);
    });

    it('usa o env com297GcdNotaDebito override quando presente (sem resolver por nome)', async () => {
        const m = buildMocks({ env: buildEnv({ com297GcdNotaDebito: 321 }) });
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());

        expect(m.gerDoc.resolveGcdCodByName).not.toHaveBeenCalled();
        expect(m.gerDoc.validaConfigDoc).toHaveBeenCalledWith(
            expect.objectContaining({ tela: 'com297', gcdCod: 321 }),
        );
        const ndCall = (m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls.find(
            (c) => c[0].tela === 'com297',
        );
        expect(ndCall[0].payload.gcdCod).toBe(321);
    });

    it('falha fechado (GAP) quando o gcd do com297 não resolve', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.gerDoc.resolveGcdCodByName as jest.Mock).mockResolvedValue(undefined);
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('error');
        expect(out.etapa).toBe('nota-debito');
        expect(m.repo.markError).toHaveBeenCalled();
    });

    it('gera a nota de débito com o produto 41978 no HEADER (NÃO via com297/comDocProdutos)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());
        // O produto vai no HEADER do gerDocProcesso com297 (HAR 23-27 não faz comDocProdutos p/ a NDe).
        const ndCall = (m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls.find(
            (c) => c[0].tela === 'com297',
        );
        expect(ndCall[0].payload.prdCod).toBe(41978);
        expect(ndCall[0].payload.prdDesNome).toBe('PAGAMENTO ANTECIPADO');
        // NÃO adiciona produto via com297/comDocProdutos (falhava `docVldTipo required`).
        expect(m.gerDoc.adicionarProduto).not.toHaveBeenCalled();
    });
});

describe('RecebimentoNumerarioService — gcd ALVO dirige a SN (validaConfigDocPessoa é só nota)', () => {
    it('IGNORA o gcd do validaConfigDocPessoa (nota) e usa o ALVO (env 150) no payload da SN', async () => {
        const m = buildMocks();
        wireDocCods(m);
        // validaConfigDocPessoa devolve 107 — mas é gate-2 NOTA, não decide. Provado: esse endpoint devolve
        // null p/ todo processo (inclusive o gerável 3254), então o gcd NUNCA vem daqui; vem do env alvo 150.
        (m.gerDoc.validaConfigDocPessoa as jest.Mock).mockResolvedValue({
            gcdCod: 107,
            gcdDesNome: 'CONFIG QUALQUER',
        });
        await buildService(m).processarAlocacao(baseInput());

        // O gcd ALVO (150) manda em TODO o caminho da SN — NÃO o 107 do validaConfigDocPessoa.
        expect(m.gerDoc.validarGeracao).toHaveBeenCalledWith(
            expect.objectContaining({ tela: 'com299', gcdCod: 150 }),
        );
        expect(m.gerDoc.validaConfigDoc).toHaveBeenCalledWith(
            expect.objectContaining({ tela: 'com299', gcdCod: 150 }),
        );
        const snGerPayload = (m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls[0][0].payload;
        expect(snGerPayload.gcdCod).toBe(150);
        // gcdDesNome cai no constante UPPERCASE da SN-Encomenda (não no rótulo do resolver).
        expect(snGerPayload.gcdDesNome).toBe('SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA');
    });

    it('valida a ELEGIBILIDADE pela ConfigDocProcesso do processo (fonte autoritativa, não CFOP)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());
        expect(m.gerDoc.listConfigDocProcesso).toHaveBeenCalledWith(
            expect.objectContaining({ tela: 'com299', priCod: 90001, pesCod: 555 }),
        );
    });
});

describe('RecebimentoNumerarioService — pré-flight READ-ONLY classifica antes de gerar', () => {
    it('READY (cadastro + gcd resolvidos) → segue para geração (gera a SN)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('settled');
        expect(m.gerDoc.gerarDocProcesso).toHaveBeenCalled();
    });

    it('BLOCKED_CADASTRO (endCodFis/pdcDocFederal ausentes) → status blocked, NÃO gera', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.gerDoc.validaProcessoPessoa as jest.Mock).mockResolvedValue({ pesCod: 194 });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('blocked');
        expect(out.classificacao).toBe('BLOCKED_CADASTRO');
        expect(out.motivo).toContain('Cadastro');
        // Fail graceful: NÃO chamou validaConfigDocPessoa, NÃO gerou, NÃO começou execução.
        expect(m.gerDoc.validaConfigDocPessoa).not.toHaveBeenCalled();
        expect(m.gerDoc.gerarDocProcesso).not.toHaveBeenCalled();
        expect(m.repo.beginExecution).not.toHaveBeenCalled();
    });

    it('BLOCKED_CADASTRO quando endCodFis=0 (endereço fiscal inválido)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.gerDoc.validaProcessoPessoa as jest.Mock).mockResolvedValue({
            pesCod: 194,
            endCodFis: 0,
            pdcDocFederal: '37032037000101',
        });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('blocked');
        expect(out.classificacao).toBe('BLOCKED_CADASTRO');
    });

    it('BLOCKED_ELEGIBILIDADE (nenhuma SN na ConfigDocProcesso do processo) → blocked, NÃO gera', async () => {
        const m = buildMocks();
        wireDocCods(m);
        // Gate 3: o processo não tem NENHUMA "Solicitação de Numerário" na lista de configs válidas.
        (m.gerDoc.listConfigDocProcesso as jest.Mock).mockResolvedValue([
            { gcdCod: 90, gcdDesNome: 'CONTAS A RECEBER ANTES DO CONEXOS - TERCEIROS' },
        ]);
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('blocked');
        expect(out.classificacao).toBe('BLOCKED_ELEGIBILIDADE');
        expect(out.motivo).toContain('inelegível');
        expect(m.gerDoc.gerarDocProcesso).not.toHaveBeenCalled();
        expect(m.repo.beginExecution).not.toHaveBeenCalled();
    });

    it('só variante TERCEIROS (sem Encomenda) → AUTO-gera com gcd 151 + conta derivada "…TERCEIROS"', async () => {
        const m = buildMocks();
        wireDocCods(m);
        // Processo aceita só a variante TERCEIROS (gcd 151) — decisão do Yuri: tratar automaticamente.
        (m.gerDoc.listConfigDocProcesso as jest.Mock).mockResolvedValue([
            { gcdCod: 151, gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - TERCEIROS' },
        ]);
        // A conta de rateio da variante existe no LOV (nome com "TERCEIROS").
        (m.gerDoc.listContasProjetoCtb as jest.Mock).mockResolvedValue([
            { ctpCod: 701, ctpDesNome: 'ADIANTAMENTO DE CLIENTE TERCEIROS', ctpEspConta: '304002' },
        ]);
        await buildService(m).processarAlocacao(baseInput());
        // Gerou a SN com o gcd da variante (151), NÃO 150.
        const snGerPayload = (m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls[0][0].payload;
        expect(snGerPayload.gcdCod).toBe(151);
        // A linha de item usou a conta derivada da variante TERCEIROS.
        const itemArgs = (m.gerDoc.adicionarComDocProduto as jest.Mock).mock.calls[0][0];
        expect(itemArgs.payload).toEqual(expect.objectContaining({ ctpCod: 701 }));
    });

    it('variante sem conta correspondente no LOV → falha fechada (não chuta conta contábil)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.gerDoc.listConfigDocProcesso as jest.Mock).mockResolvedValue([
            { gcdCod: 151, gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - TERCEIROS' },
        ]);
        // O LOV só tem a conta de ENCOMENDA — a de TERCEIROS não existe → fail-closed na etapa de item.
        (m.gerDoc.listContasProjetoCtb as jest.Mock).mockResolvedValue([
            { ctpCod: 690, ctpDesNome: 'ADIANTAMENTO DE CLIENTE ENCOMENDA', ctpEspConta: '304001' },
        ]);
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('error');
        expect(out.erro).toContain('TERCEIROS');
    });

    it('READY resolve o gcd da Encomenda POR-PROCESSO da ConfigDocProcesso (não hardcoda 150)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        // A Encomenda deste processo é gcd 152 (varia por filial) — deve ser resolvida daqui, não 150.
        (m.gerDoc.listConfigDocProcesso as jest.Mock).mockResolvedValue([
            { gcdCod: 152, gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA' },
        ]);
        await buildService(m).processarAlocacao(baseInput());
        const snGerPayload = (m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls[0][0].payload;
        expect(snGerPayload.gcdCod).toBe(152);
    });

    it('TRANSPORT_ERROR quando um validador dá 405 (rota errada) → blocked, HALT (não vira elegibilidade)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.gerDoc.listConfigDocProcesso as jest.Mock).mockRejectedValue(
            new Error('Request failed with status code 405'),
        );
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('blocked');
        expect(out.classificacao).toBe('TRANSPORT_ERROR');
        expect(out.motivo).toContain('405');
        expect(m.gerDoc.gerarDocProcesso).not.toHaveBeenCalled();
    });

    it('UNKNOWN quando o validador falha num formato não reconhecido → blocked (fail-safe)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.gerDoc.validaProcessoPessoa as jest.Mock).mockRejectedValue(
            new Error('boom inesperado'),
        );
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('blocked');
        expect(out.classificacao).toBe('UNKNOWN');
        expect(m.gerDoc.gerarDocProcesso).not.toHaveBeenCalled();
    });

    it('o dry-run também carrega a classificação do pré-flight (preview READY)', async () => {
        const m = buildMocks({ env: buildEnv({ conexosDryRun: true }) });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('dry-run');
        expect(out.classificacao).toBe('READY');
    });
});

describe('RecebimentoNumerarioService — retomada (ledger mostra etapa concluída)', () => {
    it('com fin014-done no ledger, NÃO recria SN nem borderô (retoma da nota de débito)', async () => {
        const m = buildMocks();
        const existente: SolicitacaoNumerarioExecucaoRow = {
            idempotencyKey: 'sn-real:txn-1:90001:15000',
            filCod: 2,
            priCod: 90001,
            status: 'reconciling',
            dryRun: false,
            docCod: 18200,
            fin014BorCod: 77,
            etapa: 'fin014-done',
            criadoEm: new Date(),
            atualizadoEm: new Date(),
        };
        // checarBloqueio + rodarEtapas leem o ledger; devolve o existente.
        (m.repo.findByIdempotencyKey as jest.Mock).mockResolvedValue(existente);
        // gerarDocProcesso só será chamado para a NDe (retoma).
        (m.gerDoc.gerarDocProcesso as jest.Mock).mockResolvedValue({ docCod: 18337, messages: [] });

        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('settled');
        // SN não recriada, borderô não recriado.
        expect(m.gerDoc.validarGeracao).not.toHaveBeenCalled();
        expect(m.fin014.criarBordero).not.toHaveBeenCalled();
        // A NDe É gerada (etapa retomada).
        expect(m.gerDoc.gerarDocProcesso).toHaveBeenCalledTimes(1);
        expect(m.gerDoc.gerarDocProcesso).toHaveBeenCalledWith(
            expect.objectContaining({ tela: 'com297' }),
        );
    });

    it('com etapa obs-done no ledger, pula fiscal e observações (vai direto homologar)', async () => {
        const m = buildMocks();
        const existente: SolicitacaoNumerarioExecucaoRow = {
            idempotencyKey: 'k',
            filCod: 2,
            priCod: 90001,
            status: 'reconciling',
            dryRun: false,
            docCod: 18200,
            fin014BorCod: 77,
            ndDocCod: 18337,
            etapa: 'obs-done',
            criadoEm: new Date(),
            atualizadoEm: new Date(),
        };
        (m.repo.findByIdempotencyKey as jest.Mock).mockResolvedValue(existente);

        await buildService(m).processarAlocacao(baseInput());

        expect(m.fiscal.gravarDocFiscal).not.toHaveBeenCalled();
        expect(m.fiscal.gerarObservacoes).not.toHaveBeenCalled();
        expect(m.nde.homologar).toHaveBeenCalled();
    });
});

describe('RecebimentoNumerarioService — guard SINIEF do com131', () => {
    it('pula geraObs quando fisEspObs já contém AJUSTE SINIEF (idempotência)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.fiscal.lerObservacoes as jest.Mock).mockResolvedValue({
            fisEspObs: 'TEXTO AJUSTE SINIEF 123 /',
        });
        await buildService(m).processarAlocacao(baseInput());
        expect(m.fiscal.gerarObservacoes).not.toHaveBeenCalled();
    });

    it('chama geraObs quando fisEspObs vazio', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.fiscal.lerObservacoes as jest.Mock).mockResolvedValue({});
        await buildService(m).processarAlocacao(baseInput());
        expect(m.fiscal.gerarObservacoes).toHaveBeenCalled();
    });
});

describe('RecebimentoNumerarioService — roteamento de contingência (vldTpNf)', () => {
    it('roteia para contingência quando vldTpNf=11', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.fiscal.lerDocParaPolling as jest.Mock).mockResolvedValue({
            vldTpNf: '11',
            vldAutorizado: 1,
            docMnyValor: 15000,
        });
        await buildService(m).processarAlocacao(baseInput());
        expect(m.nde.homologar).toHaveBeenCalledWith(
            expect.objectContaining({ rota: expect.objectContaining({ contingencia: true }) }),
        );
    });

    it('falha fechado (status error) quando vldTpNf é desconhecido', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.fiscal.lerDocParaPolling as jest.Mock).mockResolvedValue({
            vldTpNf: '99',
            vldAutorizado: 0,
        });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('error');
        expect(m.nde.homologar).not.toHaveBeenCalled();
        expect(m.repo.markError).toHaveBeenCalled();
    });
});

describe('RecebimentoNumerarioService — docVldComvalidacoes===2 (revisão humana)', () => {
    it('marca revisão humana + coleta com194 quando homologa volta com aviso', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.nde.homologar as jest.Mock).mockResolvedValue({
            docVldComvalidacoes: 2,
            avisoValidacoesPendentes: true,
            erpResponse: {},
        });
        (m.fiscal.listValidacoes as jest.Mock).mockResolvedValue([
            { fdvCodSeq: 1, fdvEspErr: 'erro X' },
        ]);
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.revisaoHumana).toBe(true);
        expect(out.docVldComvalidacoes).toBe(2);
        expect(m.fiscal.listValidacoes).toHaveBeenCalled();
        expect(m.repo.setRevisaoHumana).toHaveBeenCalledWith(expect.any(String), true);
    });

    it('registra a NDe como entidade auditável (ndeRepository.save) na homologação', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.nde.homologar as jest.Mock).mockResolvedValue({
            docVldComvalidacoes: 2,
            avisoValidacoesPendentes: true,
            numeroNde: '12345',
            erpResponse: { docCod: 18200 },
        });
        await buildService(m).processarAlocacao(baseInput());
        expect(m.ndeRepo.save).toHaveBeenCalledWith(
            expect.objectContaining({
                recebimentoId: 'txn-1',
                valor: 15000,
                statusEmissao: 'emitida',
                numeroNde: '12345',
                emitidaPor: 'yuri',
                erpResponse: { docCod: 18200 },
            }),
        );
    });

    it('marca settled LOGO após homologar (não depende da autorização SEFAZ assíncrona)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        // SEFAZ ainda não autorizou (poll devolve 0) — mas o settle acontece na homologação.
        (m.fiscal.lerDocParaPolling as jest.Mock).mockResolvedValue({
            vldTpNf: '10',
            vldAutorizado: 0,
            docMnyValor: 15000,
        });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(m.repo.markSettled).toHaveBeenCalled();
        expect(out.status).toBe('settled');
        expect(out.ndeAutorizado).toBe(false);
    });
});

describe('RecebimentoNumerarioService — poll timeout NÃO é erro', () => {
    it('vldAutorizado continua 0 → settled sem autorizado, sem markError', async () => {
        const m = buildMocks();
        wireDocCods(m);
        // Homologa lê status (vldTpNf=10) + pós-homologa; depois o poll SEMPRE devolve 0.
        (m.fiscal.lerDocParaPolling as jest.Mock).mockResolvedValue({
            vldTpNf: '10',
            vldAutorizado: 0,
            docMnyValor: 15000,
        });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('settled');
        expect(out.ndeAutorizado).toBe(false);
        expect(out.etapa).toBe('homologado');
        expect(m.repo.markError).not.toHaveBeenCalled();
        expect(m.repo.setNdeAutorizado).not.toHaveBeenCalledWith(expect.any(String), true);
    });
});

describe('RecebimentoNumerarioService — valida QUESTION-passada segue para gerDocProcesso', () => {
    it('validarGeracao resolve como SUCESSO (soft-confirm auto-YES) → etapaSn gera a SN normalmente', async () => {
        const m = buildMocks();
        wireDocCods(m);
        // O client absorve o 400 QUESTION benigno e devolve SUCESSO sintético (não lança).
        (m.gerDoc.validarGeracao as jest.Mock).mockResolvedValue([
            { valid: 'SUCESSO', message: 'NAO_SERA_GERADO_DOC_SEM_VALOR_CONTINUAR' },
        ]);
        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('settled');
        expect(out.snDocCod).toBe(18200);
        // Prova que NÃO abortou na valida: gerDocProcesso da SN foi chamado (1ª chamada, com299).
        expect(m.gerDoc.gerarDocProcesso).toHaveBeenCalled();
        expect((m.gerDoc.gerarDocProcesso as jest.Mock).mock.calls[0][0]).toEqual(
            expect.objectContaining({ tela: 'com299' }),
        );
        expect(m.repo.markError).not.toHaveBeenCalled();
    });
});

describe('RecebimentoNumerarioService — docMnyValor==0 continua (não bloqueia)', () => {
    it('homologa com docMnyValor=0 → warn + segue para poll/settled', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.fiscal.lerDocParaPolling as jest.Mock)
            // 1) pré-condição homologar
            .mockResolvedValueOnce({ vldTpNf: '10', vldAutorizado: 0 })
            // 2) pós-homologa: docMnyValor=0
            .mockResolvedValueOnce({ vldTpNf: '10', vldAutorizado: 0, docMnyValor: 0 })
            // 3) poll: autorizado
            .mockResolvedValue({ vldTpNf: '10', vldAutorizado: 1, docMnyValor: 0 });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('settled');
        expect(logStub.warn).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('docMnyValor=0') }),
        );
    });
});

describe('RecebimentoNumerarioService — dry-run (nenhum POST)', () => {
    it('não faz beginExecution nem toca clients quando o gate está fechado', async () => {
        const m = buildMocks({ env: buildEnv({ conexosDryRun: true }) });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('dry-run');
        expect(out.dryRun).toBe(true);
        expect(m.repo.beginExecution).not.toHaveBeenCalled();
        expect(m.gerDoc.gerarDocProcesso).not.toHaveBeenCalled();
        expect(m.fin014.criarBordero).not.toHaveBeenCalled();
    });

    it('dryRunOverride força preview mesmo com a escrita ligada', async () => {
        const m = buildMocks();
        const out = await buildService(m).processarAlocacao(baseInput({ dryRunOverride: true }));
        expect(out.status).toBe('dry-run');
        expect(m.gerDoc.gerarDocProcesso).not.toHaveBeenCalled();
    });
});

describe('RecebimentoNumerarioService — idempotência (já settled)', () => {
    it('devolve skipped com os handles quando o ledger já está settled', async () => {
        const m = buildMocks();
        (m.repo.findByIdempotencyKey as jest.Mock).mockResolvedValue({
            idempotencyKey: 'k',
            filCod: 2,
            priCod: 90001,
            status: 'settled',
            dryRun: false,
            docCod: 18200,
            fin014BorCod: 77,
            ndDocCod: 18337,
            etapa: 'concluido',
            ndeAutorizado: true,
            criadoEm: new Date(),
            atualizadoEm: new Date(),
        });
        const out = await buildService(m).processarAlocacao(baseInput());
        expect(out.status).toBe('skipped');
        expect(out.snDocCod).toBe(18200);
        expect(out.ndDocCod).toBe(18337);
        expect(m.repo.beginExecution).not.toHaveBeenCalled();
    });
});
