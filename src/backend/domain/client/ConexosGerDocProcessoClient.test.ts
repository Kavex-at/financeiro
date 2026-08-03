import 'reflect-metadata';
import type { GerDocProcessoPayload } from '../interface/permutas/SolicitacaoNumerario.js';
import type LogService from '../service/LogService.js';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosGerDocProcessoClient from './ConexosGerDocProcessoClient.js';

const buildBase = (over: Partial<Record<string, jest.Mock>> = {}) =>
    ({
        ensureSid: jest.fn().mockResolvedValue(undefined),
        runWithRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
        postGeneric: jest.fn(),
        postGenericOnce: jest.fn(),
        putGenericOnce: jest.fn(),
        getGeneric: jest.fn(),
        listGenericPaginated: jest.fn(),
        ...over,
    }) as unknown as ConexosBaseClient;

const buildLog = () =>
    ({
        warn: jest.fn().mockResolvedValue(undefined),
        info: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
        success: jest.fn().mockResolvedValue(undefined),
    }) as unknown as LogService;

/** AxiosError-like: o HTTP layer lança em 400; o corpo QUESTION vive em `response.data`. */
const axios400 = (data: unknown): Error => {
    const err = new Error('Request failed with status code 400') as Error & {
        response?: { status: number; data: unknown };
    };
    err.response = { status: 400, data };
    return err;
};

const questionEnvelope = (over?: Record<string, unknown>) => ({
    type: 'QUESTION',
    questions: [
        {
            id: 'NAO_SERA_GERADO_DOC_SEM_VALOR_CONTINUAR',
            key: 'COM_068.NAO_SERA_GERADO_DOC_SEM_VALOR_CONTINUAR',
            answerList: [
                { id: 'YES', key: 'YES', type: 'SIMPLE' },
                { id: 'ABORT', key: 'NO', type: 'ABORT' },
            ],
            ...over,
        },
    ],
});

const payload = () =>
    ({
        docTip: 1,
        globalDocVldTipo: 9,
        frontModelName: 'gerDocProcesso',
        priCod: 212,
        endCodFis: 1,
        pesCod: 239,
        gcdCod: 150,
        gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA',
        valor: 100,
        items: [],
    }) as GerDocProcessoPayload;

describe('ConexosGerDocProcessoClient', () => {
    it('gerarDocProcesso usa postGenericOnce e extrai docCod de data.messages[].vars', async () => {
        const postGenericOnce = jest.fn().mockResolvedValue({
            data: { messages: [{ valid: 'SUCESSO', vars: { docCod: 77001 } }] },
        });
        const base = buildBase({ postGenericOnce });
        const client = new ConexosGerDocProcessoClient(base, buildLog());

        const r = await client.gerarDocProcesso({ filCod: 2, payload: payload() });
        expect(r.docCod).toBe(77001);
        expect(postGenericOnce).toHaveBeenCalledTimes(1);
        expect(postGenericOnce.mock.calls[0][0]).toBe('com299/gerDocProcesso');
    });

    it('gerarDocProcesso lança (ConexosError) quando a resposta não traz docCod', async () => {
        const base = buildBase({
            postGenericOnce: jest
                .fn()
                .mockResolvedValue({ data: { messages: [{ valid: 'AVISO' }] } }),
        });
        const client = new ConexosGerDocProcessoClient(base, buildLog());
        await expect(client.gerarDocProcesso({ filCod: 2, payload: payload() })).rejects.toThrow();
    });

    it('validarGeracao POSTa o WRAPPER (não o header) e devolve as messages do envelope', async () => {
        const postGeneric = jest.fn().mockResolvedValue({ messages: [{ valid: 'SUCESSO' }] });
        const base = buildBase({ postGeneric });
        const client = new ConexosGerDocProcessoClient(base, buildLog());
        const msgs = await client.validarGeracao({ filCod: 2, gcdCod: 150 });

        expect(msgs).toHaveLength(1);
        expect(msgs[0].valid).toBe('SUCESSO');
        // Path + WRAPPER exato do HAR (doc 18339): {items:[{titVldPagopor:null, gcdCod, items:[<stub null>]}]}.
        expect(postGeneric.mock.calls[0][0]).toBe('com299/gerDocProcesso/valida');
        expect(postGeneric.mock.calls[0][1]).toEqual({
            items: [
                {
                    titVldPagopor: null,
                    gcdCod: 150,
                    items: [
                        {
                            prjCod: null,
                            ctpCod: null,
                            tmpMnyValor: null,
                            ctpDesNome: null,
                            tpcCod: null,
                            tpcDesNome: null,
                            cfoEspCod: null,
                            total: null,
                        },
                    ],
                },
            ],
        });
    });

    it('validarGeracao trata o 400 QUESTION benigno (NAO_SERA_GERADO...) como PASSOU e loga BUSINESS_WARN', async () => {
        const postGeneric = jest.fn().mockRejectedValue(axios400(questionEnvelope()));
        const base = buildBase({ postGeneric });
        const log = buildLog();
        const client = new ConexosGerDocProcessoClient(base, log);

        const msgs = await client.validarGeracao({ filCod: 2, gcdCod: 150 });

        // Resolve (não lança) como SUCESSO sintético → o caller segue para gerDocProcesso.
        expect(msgs).toHaveLength(1);
        expect(msgs[0].valid).toBe('SUCESSO');
        expect(log.warn as jest.Mock).toHaveBeenCalledTimes(1);
        const warnArg = (log.warn as jest.Mock).mock.calls[0][0];
        expect(warnArg.type).toBe('BUSINESS_WARN');
        expect(JSON.stringify(warnArg.data.questionIds)).toContain(
            'NAO_SERA_GERADO_DOC_SEM_VALOR_CONTINUAR',
        );
    });

    it('validarGeracao trata QUESTION genérica com YES(SIMPLE)+ABORT como PASSOU mesmo sem o id conhecido', async () => {
        const generic = questionEnvelope({
            id: 'SOME_OTHER_CONTINUE',
            key: 'COM_068.SOME_OTHER_CONTINUE',
            answerList: [
                { id: 'YES', key: 'YES', type: 'SIMPLE' },
                { id: 'ABORT', key: 'NO', type: 'ABORT' },
            ],
        });
        const postGeneric = jest.fn().mockRejectedValue(axios400(generic));
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());

        const msgs = await client.validarGeracao({ filCod: 2, gcdCod: 150 });
        expect(msgs[0].valid).toBe('SUCESSO');
    });

    it('validarGeracao FAIL-CLOSED (lança) numa QUESTION desconhecida sem YES-to-continue', async () => {
        const scary = {
            type: 'QUESTION',
            questions: [
                {
                    id: 'CONFIRMAR_PAGAMENTO_EM_DUPLICIDADE',
                    key: 'FIN.CONFIRMAR_PAGAMENTO_EM_DUPLICIDADE',
                    answerList: [
                        { id: 'OPT_A', key: 'A', type: 'SIMPLE' },
                        { id: 'OPT_B', key: 'B', type: 'SIMPLE' },
                    ],
                },
            ],
        };
        const postGeneric = jest.fn().mockRejectedValue(axios400(scary));
        const log = buildLog();
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), log);

        await expect(client.validarGeracao({ filCod: 2, gcdCod: 150 })).rejects.toThrow();
        expect(log.warn as jest.Mock).not.toHaveBeenCalled();
    });

    it('validarGeracao re-lança um 400 que NÃO é QUESTION (falha genuína) como ConexosError', async () => {
        const postGeneric = jest
            .fn()
            .mockRejectedValue(axios400({ messages: [{ valid: 'ERRO', message: 'boom' }] }));
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        await expect(client.validarGeracao({ filCod: 2, gcdCod: 150 })).rejects.toThrow();
    });

    it('validaProcessoPessoa POSTa o body do HAR e devolve endCodFis/pdcDocFederal do responseData', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            responseData: {
                pesCod: 194,
                endCodFis: 2,
                pdcDocFederal: '37032037000101',
                endDesLogradouro: 'AVENIDA SANTO AMARO',
                ufEspSigla: 'SP',
            },
        });
        const base = buildBase({ postGeneric });
        const client = new ConexosGerDocProcessoClient(base, buildLog());

        const r = await client.validaProcessoPessoa({
            filCod: 2,
            docTip: 1,
            globalDocVldTipo: 9,
            priCod: 3254,
            priEspRefcliente: '0097LFL/26',
        });

        expect(r.endCodFis).toBe(2);
        expect(r.pdcDocFederal).toBe('37032037000101');
        expect(r.pesCod).toBe(194);
        // Passthrough do resto do endereço.
        expect(r.endDesLogradouro).toBe('AVENIDA SANTO AMARO');
        // Path + body exatos do HAR (doc 18339).
        expect(postGeneric.mock.calls[0][0]).toBe('com299/gerDoc/validaProcessoPessoa');
        expect(postGeneric.mock.calls[0][1]).toEqual({
            docTip: 1,
            frontModelName: 'gerDocProcesso',
            globalDocVldTipo: 9,
            priCod: 3254,
            priEspRefcliente: '0097LFL/26',
        });
    });

    it('validaProcessoPessoa chama só com priCod quando priEspRefcliente ausente', async () => {
        const postGeneric = jest
            .fn()
            .mockResolvedValue({ responseData: { endCodFis: 2, pdcDocFederal: '3703' } });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());

        await client.validaProcessoPessoa({
            filCod: 2,
            docTip: 1,
            globalDocVldTipo: 9,
            priCod: 3254,
        });

        expect('priEspRefcliente' in postGeneric.mock.calls[0][1]).toBe(false);
    });

    it('validaProcessoPessoa tolera o 400 QUESTION (não lança; devolve vazio best-effort)', async () => {
        const postGeneric = jest.fn().mockRejectedValue(axios400(questionEnvelope()));
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());

        const r = await client.validaProcessoPessoa({
            filCod: 2,
            docTip: 1,
            globalDocVldTipo: 9,
            priCod: 3254,
        });
        expect(r.endCodFis).toBeUndefined();
    });

    it('validaProcessoPessoa re-lança um 400 que NÃO é QUESTION como ConexosError', async () => {
        const postGeneric = jest
            .fn()
            .mockRejectedValue(axios400({ messages: [{ valid: 'ERRO', message: 'boom' }] }));
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        await expect(
            client.validaProcessoPessoa({
                filCod: 2,
                docTip: 1,
                globalDocVldTipo: 9,
                priCod: 3254,
            }),
        ).rejects.toThrow();
    });

    it('validaConfigDocPessoa POSTa o body do modelo e devolve gcdCod/gcdDesNome do responseData', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            responseData: {
                gcdCod: 188,
                gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA',
                gcdVldTela: 7,
            },
        });
        const base = buildBase({ postGeneric });
        const client = new ConexosGerDocProcessoClient(base, buildLog());

        const r = await client.validaConfigDocPessoa({
            filCod: 2,
            pesCod: 194,
            globalDocVldTipo: 9,
            docTip: 1,
            priCod: 3254,
        });

        expect(r.gcdCod).toBe(188);
        expect(r.gcdDesNome).toBe('SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA');
        // Passthrough do resto do responseData.
        expect(r.gcdVldTela).toBe(7);
        // Path = com299/gerDoc/validaConfigDocPessoa (mesmo prefixo gerDoc/ de validaProcessoPessoa;
        // sem ele o ERP devolve 405 — probe 2026-08-02).
        expect(postGeneric.mock.calls[0][0]).toBe('com299/gerDoc/validaConfigDocPessoa');
        // Body do modelo: {filCod, pesCod, globalDocVldTipo, docTip, priCod}.
        expect(postGeneric.mock.calls[0][1]).toEqual({
            filCod: 2,
            pesCod: 194,
            globalDocVldTipo: 9,
            docTip: 1,
            priCod: 3254,
        });
    });

    it('validaConfigDocPessoa devolve vazio (sem gcdCod) quando o processo não resolve config SN', async () => {
        const postGeneric = jest.fn().mockResolvedValue({ responseData: {} });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.validaConfigDocPessoa({
            filCod: 2,
            pesCod: 194,
            globalDocVldTipo: 9,
            docTip: 1,
            priCod: 3254,
        });
        expect(r.gcdCod).toBeUndefined();
    });

    it('validaConfigDocPessoa tolera o 400 QUESTION (não lança; devolve vazio best-effort)', async () => {
        const postGeneric = jest.fn().mockRejectedValue(axios400(questionEnvelope()));
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.validaConfigDocPessoa({
            filCod: 2,
            pesCod: 194,
            globalDocVldTipo: 9,
            docTip: 1,
            priCod: 3254,
        });
        expect(r.gcdCod).toBeUndefined();
    });

    it('validaConfigDocPessoa re-lança um 400 que NÃO é QUESTION como ConexosError', async () => {
        const postGeneric = jest
            .fn()
            .mockRejectedValue(axios400({ messages: [{ valid: 'ERRO', message: 'boom' }] }));
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        await expect(
            client.validaConfigDocPessoa({
                filCod: 2,
                pesCod: 194,
                globalDocVldTipo: 9,
                docTip: 1,
                priCod: 3254,
            }),
        ).rejects.toThrow();
    });

    it('validaConfigDocPessoa trata {gcdCod:null, gcdDesNome:null} como AUSENTE (não lança, não vira 0)', async () => {
        // O ERP devolve null p/ processo sem config resolvida — z.string() lançaria e z.coerce.number()
        // coagiria null→0. Regressão do fix 2026-08-02: null normaliza para undefined (elegibilidade quieta).
        const postGeneric = jest
            .fn()
            .mockResolvedValue({ responseData: { gcdCod: null, gcdDesNome: null } });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.validaConfigDocPessoa({
            filCod: 2,
            pesCod: 194,
            globalDocVldTipo: 9,
            docTip: 1,
            priCod: 3254,
        });
        expect(r.gcdCod).toBeUndefined();
        expect(r.gcdDesNome).toBeUndefined();
    });

    it('verificarConfigElegivel: messages ERRO → inelegível com o código da mensagem', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            messages: [{ valid: 'ERRO', message: 'COM_068.CFOP_INCOMPATIVEL_OU_ERROS' }],
            responseData: { gcdVldTela: 4 },
        });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.verificarConfigElegivel({
            filCod: 2,
            docTip: 1,
            globalDocVldTipo: 9,
            priCod: 459,
            pesCod: 156,
            endCodFis: 1,
            gcdCod: 107,
        });
        expect(r.elegivel).toBe(false);
        expect(r.motivo).toBe('COM_068.CFOP_INCOMPATIVEL_OU_ERROS');
        expect(postGeneric.mock.calls[0][0]).toBe('com299/gerDoc/validaConfigDoc');
    });

    it('verificarConfigElegivel: só AVISO → elegível, com o aviso preservado', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            messages: [{ valid: 'AVISO', message: 'COM_068.NAO_ENCONTRADO_CFOP_CONFIG_DOC' }],
            responseData: { gcdVldTela: 1 },
        });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.verificarConfigElegivel({
            filCod: 2,
            docTip: 1,
            globalDocVldTipo: 9,
            priCod: 459,
            pesCod: 156,
            endCodFis: 1,
            gcdCod: 188,
        });
        expect(r.elegivel).toBe(true);
        expect(r.aviso).toBe('COM_068.NAO_ENCONTRADO_CFOP_CONFIG_DOC');
    });

    it('verificarConfigElegivel: sem messages (gcd limpo, ex. 150) → elegível', async () => {
        const postGeneric = jest.fn().mockResolvedValue({ responseData: { gcdVldTela: 7 } });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.verificarConfigElegivel({
            filCod: 2,
            docTip: 1,
            globalDocVldTipo: 9,
            priCod: 459,
            pesCod: 156,
            endCodFis: 1,
            gcdCod: 150,
        });
        expect(r.elegivel).toBe(true);
        expect(r.aviso).toBeUndefined();
    });

    it('listConfigDocProcesso: lov filtrado por priCod/fPesCod/fEndCod → configs válidas do processo', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            rows: [
                { gcdCod: 151, gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - TERCEIROS', gcdVldTela: 7 },
                {
                    gcdCod: 90,
                    gcdDesNome: 'CONTAS A RECEBER ANTES DO CONEXOS - TERCEIROS',
                    gcdVldTela: 7,
                },
            ],
        });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.listConfigDocProcesso({
            filCod: 2,
            priCod: 3478,
            pesCod: 156,
            endCodFis: 1,
        });
        expect(postGeneric.mock.calls[0][0]).toBe('lov/ConfigDocProcesso');
        expect(postGeneric.mock.calls[0][1].filterList).toMatchObject({
            priCod: 3478,
            fPesCod: 156,
            fEndCod: 1,
        });
        expect(r).toHaveLength(2);
        expect(r[0]).toMatchObject({
            gcdCod: 151,
            gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - TERCEIROS',
        });
    });

    it('listCondPgtoPessoa POSTa lov/CondPgtoPessoa (pesCod + fdocTipPgto:1) e devolve as opções', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            rows: [
                { pgtCod: 1, pgtDesNome: 'A VISTA' },
                { pgtCod: 109, pgtDesNome: 'L-FOUNDERS - DUPLICATA' },
            ],
        });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.listCondPgtoPessoa({ filCod: 2, pesCod: 194 });
        expect(postGeneric.mock.calls[0][0]).toBe('lov/CondPgtoPessoa');
        expect(postGeneric.mock.calls[0][1].filterList).toEqual({ pesCod: 194, fdocTipPgto: 1 });
        expect(r).toHaveLength(2);
        expect(r[1]).toMatchObject({ pgtCod: 109, pgtDesNome: 'L-FOUNDERS - DUPLICATA' });
    });

    it('listContasProjetoCtb filtra por prjCod/priCod/tpdCod e devolve ctpCod/ctpDesNome', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            rows: [
                {
                    ctpCod: 690,
                    ctpDesNome: 'ADIANTAMENTO DE CLIENTE ENCOMENDA',
                    ctpEspConta: '304001',
                },
            ],
        });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const r = await client.listContasProjetoCtb({
            filCod: 2,
            prjCod: 1,
            priCod: 3254,
            tpdCod: 3,
        });
        expect(postGeneric.mock.calls[0][0]).toBe('lov/ContasProjetoCtb');
        expect(postGeneric.mock.calls[0][1].filterList).toMatchObject({
            prjCod: 1,
            priCod: 3254,
            tpdCod: 3,
            priCodProd: 3254,
        });
        expect(r[0]).toMatchObject({
            ctpCod: 690,
            ctpDesNome: 'ADIANTAMENTO DE CLIENTE ENCOMENDA',
        });
    });

    it('comDocProdutosInitialValues desaninha {COM299:{ComDocProdutos}} para o template flat', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            COM299: { ComDocProdutos: { prdCod: 2, tpcCod: 33, cfoEspCod: '9999A2', undCod: 3 } },
        });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGeneric }), buildLog());
        const t = await client.comDocProdutosInitialValues({ filCod: 2, doc: { docCod: 18342 } });
        expect(postGeneric.mock.calls[0][0]).toBe('com299/comDocProdutos/initialValues');
        expect(t).toEqual({ prdCod: 2, tpcCod: 33, cfoEspCod: '9999A2', undCod: 3 });
    });

    it('adicionarComDocProduto usa postGenericOnce (escrita) no com299/comDocProdutos', async () => {
        const postGenericOnce = jest.fn().mockResolvedValue({ dprCodSeq: 1 });
        const client = new ConexosGerDocProcessoClient(buildBase({ postGenericOnce }), buildLog());
        const r = await client.adicionarComDocProduto({
            filCod: 2,
            payload: { docCod: 18342, dprPreValorun: 100 },
        });
        expect(postGenericOnce.mock.calls[0][0]).toBe('com299/comDocProdutos');
        expect(r).toMatchObject({ dprCodSeq: 1 });
    });

    it('atualizarDocumento usa putGenericOnce (escrita) no com299', async () => {
        const putGenericOnce = jest.fn().mockResolvedValue({ docCod: 18342 });
        const client = new ConexosGerDocProcessoClient(buildBase({ putGenericOnce }), buildLog());
        await client.atualizarDocumento({ filCod: 2, payload: { docCod: 18342, pgtCod: 109 } });
        expect(putGenericOnce.mock.calls[0][0]).toBe('com299');
        expect(putGenericOnce.mock.calls[0][1]).toMatchObject({ pgtCod: 109 });
    });

    it('listContasProjeto parseia as linhas de rateio do envelope paginado', async () => {
        const base = buildBase({
            listGenericPaginated: jest.fn().mockResolvedValue({
                count: 1,
                rows: [
                    {
                        prjCod: 1,
                        ctpCod: 36,
                        tpcCod: 86,
                        cfoEspCod: '2353A8',
                        total: 100,
                    },
                ],
            }),
        });
        const client = new ConexosGerDocProcessoClient(base, buildLog());
        const rows = await client.listContasProjeto({
            filCod: 2,
            gcdCod: 150,
            pesCod: 239,
            endCodFis: 1,
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].cfoEspCod).toBe('2353A8');
    });
});
