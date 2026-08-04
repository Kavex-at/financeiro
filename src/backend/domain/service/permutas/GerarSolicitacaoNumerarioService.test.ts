import 'reflect-metadata';
import type ConexosFin014Client from '../../client/ConexosFin014Client.js';
import type ConexosGerDocProcessoClient from '../../client/ConexosGerDocProcessoClient.js';
import type { ContaProjetoRow } from '../../interface/permutas/SolicitacaoNumerario.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type NumerarioExecucaoRepository from '../../repository/permutas/NumerarioExecucaoRepository.js';
import type PermutaRelationalRepository from '../../repository/permutas/PermutaRelationalRepository.js';
import type ErpErrorInterpreter from './ErpErrorInterpreter.js';
import GerarSolicitacaoNumerarioService from './GerarSolicitacaoNumerarioService.js';
import type LogService from '../LogService.js';

const log = () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as LogService;

const adto = () => ({
    docCod: '18202',
    priCod: '212',
    pesCod: '239',
    filCod: 2,
    referenciaExterna: '0022THK/26',
    importador: 'THERMO KLIMA REFRIGERACAO LTDA',
    moedaNegociada: 'USD',
    pago: false,
    estadoElegibilidade: 'elegivel',
    stale: false,
});

const rateio = (rows?: ContaProjetoRow[]): ContaProjetoRow[] =>
    rows ?? [{ prjCod: 1, ctpCod: 36, tpcCod: 86, cfoEspCod: '2353A8', total: 100 }];

const build = (opts: {
    writeEnabled?: boolean;
    dryRun?: boolean;
    contas?: ContaProjetoRow[];
    existing?: unknown;
    conta?: number;
    gcdNd?: number;
    gcdResolved?: number;
}) => {
    const gerDocClient = {
        validaConfigDoc: jest.fn().mockResolvedValue({ tpcCod: 86, gcdVldFormaRateio: 3 }),
        listContasProjeto: jest.fn().mockResolvedValue(rateio(opts.contas)),
        validarGeracao: jest.fn().mockResolvedValue([]),
        gerarDocProcesso: jest
            .fn()
            .mockResolvedValueOnce({ docCod: 99001, messages: [] }) // SN (com299)
            .mockResolvedValue({ docCod: 77001, messages: [] }), // nota débito (com297)
        finalizarDocumento: jest.fn().mockResolvedValue([]),
        resolveGcdCodByName: jest.fn().mockResolvedValue(opts.gcdResolved),
        adicionarProduto: jest.fn().mockResolvedValue([]),
        homologarNfe: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ConexosGerDocProcessoClient>;

    const fin014Client = {
        criarBordero: jest.fn().mockResolvedValue({ borCod: 7300, filCod: 2, borDtaMvto: 0 }),
        validarTituloBaixa: jest.fn().mockResolvedValue({ responseData: { bxaMnyValor: 100 } }),
        gravarBaixa: jest.fn().mockResolvedValue({ bxaCodSeq: 55 }),
        finalizarBordero: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ConexosFin014Client>;

    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            conexosWriteEnabled: opts.writeEnabled ?? false,
            conexosDryRun: opts.dryRun ?? true,
            fin014ContaFinanceira: opts.conta,
            com297GcdNotaDebitoNome: 'NOTA DE DÉBITO ELETRÔNICA',
            com297GcdNotaDebito: opts.gcdNd,
        }),
    } as unknown as EnvironmentProvider;

    const relational = {
        findAdiantamento: jest.fn().mockResolvedValue(adto()),
    } as unknown as PermutaRelationalRepository;

    const repo = {
        findByIdempotencyKey: jest.fn().mockResolvedValue(opts.existing ?? null),
        beginExecution: jest
            .fn()
            .mockResolvedValue({ status: 'reconciling', alreadySettled: false }),
        setRequestPayload: jest.fn().mockResolvedValue(undefined),
        setSnDocCod: jest.fn().mockResolvedValue(undefined),
        setEtapa: jest.fn().mockResolvedValue(undefined),
        setFin014BorCod: jest.fn().mockResolvedValue(undefined),
        setNdDocCod: jest.fn().mockResolvedValue(undefined),
        markSettled: jest.fn().mockResolvedValue(undefined),
        markError: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NumerarioExecucaoRepository>;

    const interpreter = {
        interpret: jest.fn().mockReturnValue({ friendly: 'erro' }),
        describeMessage: jest.fn().mockReturnValue('detalhe'),
    } as unknown as ErpErrorInterpreter;

    const service = new GerarSolicitacaoNumerarioService(
        gerDocClient,
        fin014Client,
        env,
        relational,
        repo,
        log(),
        interpreter,
    );
    return { service, gerDocClient, fin014Client, repo };
};

const run = (service: GerarSolicitacaoNumerarioService, valor = 100) =>
    service.gerarNumerario({ adiantamentoDocCod: '18202', executadoPor: 'tester', valor });

describe('GerarSolicitacaoNumerarioService (3-tela flow)', () => {
    it('dry-run: monta payloads das 3 telas, sem POST nem trilha', async () => {
        const { service, gerDocClient, fin014Client, repo } = build({ writeEnabled: false });
        const r = await service.gerarNumerario({
            adiantamentoDocCod: '18202',
            executadoPor: 'tester',
            valor: 416671.6,
            dataEmissao: 1785456000000,
            numeroDocumento: '31072026',
        });
        expect(r.status).toBe('dry-run');
        expect(r.payload?.docEspNumero).toBe('31072026');
        expect(r.payloadNotaDebito?.prdCod).toBe(41978);
        expect(gerDocClient.gerarDocProcesso).not.toHaveBeenCalled();
        expect(fin014Client.criarBordero).not.toHaveBeenCalled();
        expect(repo.beginExecution).not.toHaveBeenCalled();
    });

    it('write: SN+finalize → fin014 (borderô/baixa/finaliza) → com297 gen+produto → GAP fiscal', async () => {
        const { service, gerDocClient, fin014Client, repo } = build({
            writeEnabled: true,
            dryRun: false,
            conta: 330037,
            gcdNd: 251,
        });
        const r = await run(service);
        expect(r.status).toBe('error');
        expect(r.etapa).toBe('nota-debito-fiscal'); // parou no GAP fiscal, DEPOIS de fin014 + com297 gen
        expect(r.docCod).toBe(99001);
        expect(r.notaDebitoDocCod).toBe(77001);
        expect(gerDocClient.finalizarDocumento).toHaveBeenCalledTimes(1);
        expect(fin014Client.criarBordero).toHaveBeenCalledTimes(1);
        expect(fin014Client.gravarBaixa).toHaveBeenCalledTimes(1);
        expect(fin014Client.finalizarBordero).toHaveBeenCalledTimes(1);
        expect(gerDocClient.adicionarProduto).toHaveBeenCalledTimes(1);
        expect(repo.setFin014BorCod).toHaveBeenCalledWith('numerario:18202:100', 7300);
    });

    it('fin014 sem conta financeira: FAIL-CLOSED na Tela 2 (SN já criada)', async () => {
        const { service, fin014Client } = build({
            writeEnabled: true,
            dryRun: false,
            conta: undefined,
        });
        const r = await run(service);
        expect(r.status).toBe('error');
        expect(r.etapa).toBe('fin014');
        expect(r.docCod).toBe(99001); // SN criada
        expect(fin014Client.criarBordero).not.toHaveBeenCalled();
    });

    it('gcd nota-débito não resolvido: FAIL-CLOSED na Tela 3', async () => {
        const { service, gerDocClient } = build({
            writeEnabled: true,
            dryRun: false,
            conta: 330037,
            gcdResolved: undefined,
        });
        const r = await run(service);
        expect(r.status).toBe('error');
        expect(r.etapa).toBe('nota-debito');
        expect(gerDocClient.resolveGcdCodByName).toHaveBeenCalled();
    });

    it('retomada: SN + fin014 já feitos → não recria; segue p/ com297', async () => {
        const { service, gerDocClient, fin014Client } = build({
            writeEnabled: true,
            dryRun: false,
            conta: 330037,
            gcdNd: 251,
            existing: {
                status: 'reconciling',
                dryRun: false,
                docCod: 88000,
                fin014BorCod: 7001,
                etapa: 'fin014-done',
            },
        });
        const r = await run(service);
        expect(gerDocClient.gerarDocProcesso).toHaveBeenCalledTimes(1); // só a nota débito (SN não recria)
        expect(fin014Client.criarBordero).not.toHaveBeenCalled(); // fin014 não refeito
        expect(r.docCod).toBe(88000);
        expect(r.etapa).toBe('nota-debito-fiscal');
    });

    it('idempotência: settled → skipped', async () => {
        const { service, fin014Client } = build({
            writeEnabled: true,
            dryRun: false,
            existing: { status: 'settled', dryRun: false, docCod: 5555, ndDocCod: 6001 },
        });
        const r = await run(service);
        expect(r.status).toBe('skipped');
        expect(r.docCod).toBe(5555);
        expect(fin014Client.criarBordero).not.toHaveBeenCalled();
    });
});
