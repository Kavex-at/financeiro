import 'reflect-metadata';
import NotImplementedError from '../../errors/NotImplementedError.js';
import { processoFixture } from '../../interface/recebimentos/__fixtures__/processo.fixture.js';
import EncomendaValorCalculator from './EncomendaValorCalculator.js';
import SolicitacaoNumerarioService from './SolicitacaoNumerarioService.js';

const logStub = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never;

/** Constrói o serviço com um EnvironmentProvider stub (gcdCod = sentinela 0 por default). */
const buildService = (gcdCod = 0): SolicitacaoNumerarioService => {
    const envStub = {
        getEnvironmentVars: jest.fn().mockResolvedValue({ solicitacaoNumerarioGcdCod: gcdCod }),
    } as never;
    return new SolicitacaoNumerarioService(logStub, envStub, new EncomendaValorCalculator());
};

const DATA = new Date('2026-07-28T12:00:00.000Z');

describe('SolicitacaoNumerarioService.gerar — dry-run payload build (com299)', () => {
    afterEach(() => jest.clearAllMocks());

    it('usa o gcdCod do ambiente (SN_GCD_COD) — 150 quando confirmado', async () => {
        const out = await buildService(150).gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.docConfig.gcdDesNome).toBe('Solicitação de Numerário - Encomenda');
        expect(out.docConfig.gcdCod).toBe(150);
        expect(out.payload.gcdCod).toBe(150);
    });

    it('gcdCod = 0 (sentinela "não confirmado") quando SN_GCD_COD ausente', async () => {
        const out = await buildService().gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.docConfig.gcdCod).toBe(0);
    });

    it('emits the HAR-confirmed numeric contract (docTip=1, docVldTipo=9, adto=1, moeCod=null)', async () => {
        const out = await buildService().gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.payload.docTip).toBe(1);
        expect(out.payload.docVldTipo).toBe(9);
        expect(out.payload.docVldTipoAdto).toBe(1);
        // SN Encomenda não carrega moeda (BRL implícito) — a suposição 790 era errada.
        expect(out.payload.moeCod).toBeNull();
    });

    it('maps filCod / priCod / cliente from the chosen processo', async () => {
        const out = await buildService().gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.payload.filCod).toBe(processoFixture.filCod);
        expect(out.payload.priCod).toBe(processoFixture.priCod);
        expect(out.payload.priEspRefcliente).toBe(processoFixture.priEspRefcliente);
        expect(out.payload.pesCod).toBe(processoFixture.pesCod);
        expect(out.payload.dpeNomPessoa).toBe(processoFixture.dpeNomPessoa);
    });

    it('uses the raw transaction value as the SN amount (server totals rateio líquido)', async () => {
        const out = await buildService().gerar({
            processo: processoFixture,
            valorTransacao: 27890.55,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.payload.valor).toBe(27890.55);
        expect(out.payload.items).toHaveLength(1);
        expect(out.payload.items[0].total).toBe(27890.55);
        expect(out.payload.items[0].tmpMnyValor).toBe(27890.55);
    });

    it('always returns dryRun: true', async () => {
        const out = await buildService().gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.dryRun).toBe(true);
    });

    it('emits emission/vencimento dates from dataReferencia', async () => {
        const out = await buildService().gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.payload.docDtaEmissao).toBe(DATA.toISOString());
        expect(out.payload.dtaVencimento).toBe(DATA.toISOString());
    });
});

describe('SolicitacaoNumerarioService — NO reachable live ERP write path', () => {
    it('enviarAoErp throws NotImplementedError (dry-run only)', async () => {
        const service = buildService();
        const out = await service.gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        await expect(service.enviarAoErp(out.payload)).rejects.toBeInstanceOf(NotImplementedError);
    });
});
