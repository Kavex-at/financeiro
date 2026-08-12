import 'reflect-metadata';
import type ConexosCadastroClient from '../../client/ConexosCadastroClient.js';
import type ConexosFin014Client from '../../client/ConexosFin014Client.js';
import type ConexosGerDocProcessoClient from '../../client/ConexosGerDocProcessoClient.js';
import type ConexosNdeClient from '../../client/ConexosNdeClient.js';
import type ConexosNdeFiscalClient from '../../client/ConexosNdeFiscalClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type { SolicitacaoNumerarioExecucaoRepositoryInterface } from '../../interface/recebimentos/ports.js';
import { NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO } from '../../interface/recebimentos/constants.js';
import ContingenciaDecider from './ContingenciaDecider.js';
import ErpErrorInterpreter from '../permutas/ErpErrorInterpreter.js';
import RecebimentoNumerarioService from './RecebimentoNumerarioService.js';
import type { ProcessarAlocacaoInput } from './RecebimentoNumerarioService.js';
import SnPayloadBuilder from './SnPayloadBuilder.js';

/**
 * TESTES DE CARACTERIZAÇÃO — Reforma Tributária IBS/CBS (auditoria 2026-08-02).
 *
 * Estes testes PINAM o comportamento ATUAL confrontado com os requisitos RT-001..RT-014 de
 * `docs/reforma-tributaria/00_fonte_da_verdade_ibs_cbs.md` (§10). Eles NÃO afirmam que o
 * comportamento é o DESEJADO — documentam o estado auditado para que qualquer mudança futura
 * (fail-closed de CST, tipo de ND por hipótese, bloqueio de valor zero, juros/multa com destaque)
 * quebre um teste de propósito e force a decisão consciente.
 *
 * Mapa RT → teste:
 *   RT-001 → propaga `dprVldCstIbsCbs:"-1"` do template sem crítica (item da SN) e o RMW do
 *            com300 reenvia campos IBS/CBS intocados; nenhuma verificação pós-autorização.
 *   RT-002 → `fisVldTipoNfDebito` é SEMPRE 6 (Pagamento Antecipado) — hardcode único.
 *   RT-004 → fin014 envia `bxaMnyJuros/Multa/Desconto = 0` hard-zerados (líquido = valor).
 *   RT-007 → NDe homologada com `docMnyValor = 0` NÃO bloqueia (warn não-bloqueante).
 *
 * Ver `docs/reforma-tributaria/02_auditoria_gap_report.md`.
 */

const logStub = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const logService = logStub as never;

interface Mocks {
    gerDoc: jest.Mocked<ConexosGerDocProcessoClient>;
    fin014: jest.Mocked<ConexosFin014Client>;
    fiscal: jest.Mocked<ConexosNdeFiscalClient>;
    nde: jest.Mocked<ConexosNdeClient>;
    /** imp021 — `priVldTipo: 3` (POR ENCOMENDA) mantém a trilha fiscal completa destes testes. */
    cadastro: jest.Mocked<ConexosCadastroClient>;
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
            ...over,
        }),
    }) as never;

const buildMocks = (): Mocks => ({
    gerDoc: {
        validaProcessoPessoa: jest.fn().mockResolvedValue({
            pesCod: 194,
            endCodFis: 2,
            pdcDocFederal: '37032037000101',
        }),
        // Gate 1.5: o endereço do documento é o do CNPJ do processo (ver `resolverEndCodDaPessoa`).
        listEnderecosPessoa: jest
            .fn()
            .mockResolvedValue([{ endCod: 2, pdcDocFederal: '37032037000101', endVldDefault: 1 }]),
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
        listConfigDocProcesso: jest
            .fn()
            .mockResolvedValue([
                { gcdCod: 150, gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA' },
            ]),
        listContasProjeto: jest.fn().mockResolvedValue([]),
        resolveGcdCodByName: jest.fn().mockResolvedValue(300),
        validarGeracao: jest.fn().mockResolvedValue([]),
        gerarDocProcesso: jest.fn().mockResolvedValue({ docCod: 0, messages: [] }),
        finalizarDocumento: jest.fn().mockResolvedValue([]),
        adicionarProduto: jest.fn().mockResolvedValue([]),
        // A condição TEM que ser a do cliente do documento (`dpeNomPessoa` do `baseInput`) — o serviço
        // recusa gravar a de terceiro desde o fix do doc 731 do HML (2026-08-03).
        listCondPgtoPessoa: jest
            .fn()
            .mockResolvedValue([{ pgtCod: 109, pgtDesNome: 'CLIENTE EXEMPLO - DUPLICATA' }]),
        listContasProjetoCtb: jest.fn().mockResolvedValue([
            {
                ctpCod: 690,
                ctpDesNome: 'ADIANTAMENTO DE CLIENTE ENCOMENDA',
                ctpEspConta: '304001',
            },
        ]),
        getDocumento: jest.fn().mockResolvedValue({ docCod: 0, docMnyValor: 0, pgtCod: 1 }),
        atualizarDocumento: jest.fn().mockResolvedValue({}),
        // Template REAL do com299 comDocProdutos/initialValues (HAR): o servidor devolve o CST
        // IBS/CBS "não classificado" (`dprVldCstIbsCbs: "-1"`) — a solução o propaga no spread.
        comDocProdutosInitialValues: jest.fn().mockResolvedValue({
            prdCod: 2,
            tpcCod: 33,
            cfoEspCod: '9999A2',
            undCod: 3,
            dprVldCstIbsCbs: '-1',
        }),
        adicionarComDocProduto: jest.fn().mockResolvedValue({ dprCodSeq: 1 }),
    } as never,
    fin014: {
        criarBordero: jest
            .fn()
            .mockResolvedValue({ borCod: 77, dryRun: false, gerDes: 'BANCO BRASIL - CONTA 1' }),
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
        // finDocFiscal com um campo IBS/CBS hipotético preservado por passthrough — o RMW do
        // com300 reenvia o objeto INTEIRO mudando apenas fisVldTipoNfDebito.
        lerDocFiscal: jest.fn().mockResolvedValue({
            filCod: 7,
            docTip: 1,
            docCod: 18337,
            fisCod: 1,
            fisVldTipoNfDebito: 0,
            fisVldCstIbsCbs: '-1',
        }),
        gravarDocFiscal: jest.fn().mockResolvedValue({ fisVldTipoNfDebito: 6 }),
        lerObservacoes: jest.fn().mockResolvedValue({}),
        gerarObservacoes: jest.fn().mockResolvedValue({ fisEspObs: 'AJUSTE SINIEF /' }),
        listValidacoes: jest.fn().mockResolvedValue([]),
        // Etapa 3.5 — a descrição de impressão do item já vem do ERP (cadastro compatível): no-op.
        listItensNde: jest.fn().mockResolvedValue([
            {
                docCod: 18337,
                fisCod: 1,
                prdCod: 41978,
                dprCodSeq: 1,
                prdDesNome: 'PAGAMENTO ANTECIPADO',
                dprLngDescrNf: 'PAGAMENTO ANTECIPADO',
            },
        ]),
        lerItemNde: jest.fn().mockResolvedValue({}),
        gravarDescricaoItemNde: jest.fn().mockResolvedValue({}),
        preDescricaoProdutoNf: jest.fn().mockResolvedValue(undefined),
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
    cadastro: {
        listProcessos: jest.fn().mockResolvedValue([{ priCod: '90001', priVldTipo: 3 }]),
    } as never,
    env: buildEnv(),
});

const buildService = (m: Mocks): RecebimentoNumerarioService =>
    new RecebimentoNumerarioService(
        m.gerDoc,
        m.fin014,
        m.fiscal,
        m.nde,
        m.cadastro,
        new ContingenciaDecider(),
        m.env,
        new SnPayloadBuilder(),
        m.repo,
        m.ndeRepo as never,
        // Stub do repo de transação: o serviço só o usa para levar a transação a `processada`
        // (ADR-0033). Nenhum teste deste arquivo asserta sobre ele — o que importa é que a falha
        // dele nunca derrube a alocação, coberto em teste próprio.
        { marcarProcessada: jest.fn().mockResolvedValue(true) } as never,
        logService,
        new ErpErrorInterpreter(),
    );

const baseInput = (over: Partial<ProcessarAlocacaoInput> = {}): ProcessarAlocacaoInput => ({
    txnId: 'txn-rt',
    transacao: { gerNum: 55795, valor: 15000 },
    priCod: 90001,
    valor: 15000,
    processoFields: {
        filCod: 7,
        priEspRefcliente: 'REF-1',
        pesCod: 555,
        dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
        moeCod: 790,
    },
    ator: 'auditoria-rt',
    ...over,
});

const wireDocCods = (m: Mocks, snDocCod = 18200, ndDocCod = 18337): void => {
    (m.gerDoc.gerarDocProcesso as jest.Mock)
        .mockResolvedValueOnce({ docCod: snDocCod, messages: [] })
        .mockResolvedValueOnce({ docCod: ndDocCod, messages: [] });
};

afterEach(() => jest.clearAllMocks());

describe('RT-001 — CST IBS/CBS não classificado propagado sem crítica (GAP caracterizado)', () => {
    it('o item da SN reenvia dprVldCstIbsCbs="-1" do template e o fluxo conclui sem bloqueio', async () => {
        const m = buildMocks();
        wireDocCods(m);
        const out = await buildService(m).processarAlocacao(baseInput());

        // O spread do template reenviou o CST "não classificado" LITERALMENTE no POST do item.
        const itemArgs = (m.gerDoc.adicionarComDocProduto as jest.Mock).mock.calls[0][0];
        expect(itemArgs.payload).toEqual(expect.objectContaining({ dprVldCstIbsCbs: '-1' }));

        // E NADA bloqueou: settled/concluído, sem revisão humana, sem markError.
        expect(out.status).toBe('settled');
        expect(out.etapa).toBe('concluido');
        expect(out.revisaoHumana).toBe(false);
        expect(m.repo.markError).not.toHaveBeenCalled();
    });

    it('o RMW do com300 reenvia campos IBS/CBS do finDocFiscal intocados (só muda o tipo de ND)', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());

        const putArgs = (m.fiscal.gravarDocFiscal as jest.Mock).mock.calls[0][0];
        // O objeto inteiro volta com o CST hipotético "-1" preservado — nenhuma crítica/fail-closed.
        expect(putArgs.finDocFiscal).toEqual(
            expect.objectContaining({ fisVldCstIbsCbs: '-1', fisVldTipoNfDebito: 6 }),
        );
    });
});

describe('RT-002 — tipo da nota de débito é hardcode único (sempre 6 = Pagamento Antecipado)', () => {
    it('constante NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO vale 6 e é a única usada', () => {
        expect(NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO).toBe(6);
    });

    it('etapaFiscal grava fisVldTipoNfDebito=6 independente de qualquer campo da alocação', async () => {
        const m = buildMocks();
        wireDocCods(m);
        // Nenhum input do orquestrador carrega "hipótese da ND" (adiantamento × juros/multa ×
        // complemento) — o tipo é decidido por constante. Variar o input não muda o tipo.
        await buildService(m).processarAlocacao(baseInput({ valor: 999.99, txnId: 'txn-rt-2' }));
        expect(m.fiscal.gravarDocFiscal).toHaveBeenCalledWith(
            expect.objectContaining({
                finDocFiscal: expect.objectContaining({ fisVldTipoNfDebito: 6 }),
            }),
        );
    });
});

describe('RT-004 — fin014 hard-zera juros/multa/desconto na baixa (líquido = valor)', () => {
    it('gravarBaixa envia bxaMnyJuros=0, bxaMnyMulta=0, bxaMnyDesconto=0 e liquido=valor', async () => {
        const m = buildMocks();
        wireDocCods(m);
        await buildService(m).processarAlocacao(baseInput());

        expect(m.fin014.gravarBaixa).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({
                    bxaMnyJuros: 0,
                    bxaMnyMulta: 0,
                    bxaMnyDesconto: 0,
                    bxaMnyValor: 15000,
                    bxaMnyLiquido: 15000,
                }),
            }),
        );
    });
});

describe('RT-007 — NDe homologada com docMnyValor=0 NÃO bloqueia (warn não-bloqueante)', () => {
    it('valor zero pós-homologação: warn, sem markError, sem revisão humana, settled', async () => {
        const m = buildMocks();
        wireDocCods(m);
        (m.fiscal.lerDocParaPolling as jest.Mock)
            // 1) pré-condição da homologação
            .mockResolvedValueOnce({ vldTpNf: '10', vldAutorizado: 0 })
            // 2) pós-homologação: base ZERADA
            .mockResolvedValueOnce({ vldTpNf: '10', vldAutorizado: 0, docMnyValor: 0 })
            // 3) poll: SEFAZ autoriza o documento de valor 0
            .mockResolvedValue({ vldTpNf: '10', vldAutorizado: 1, docMnyValor: 0 });

        const out = await buildService(m).processarAlocacao(baseInput());

        expect(out.status).toBe('settled');
        expect(out.etapa).toBe('concluido');
        expect(out.ndeAutorizado).toBe(true);
        expect(out.revisaoHumana).toBe(false);
        expect(m.repo.markError).not.toHaveBeenCalled();
        expect(logStub.warn).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('docMnyValor=0') }),
        );
    });
});
