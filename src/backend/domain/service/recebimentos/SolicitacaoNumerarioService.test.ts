import 'reflect-metadata';
import NotImplementedError from '../../errors/NotImplementedError.js';
import { SOLICITACAO_NUMERARIO_DOC_CONFIG } from '../../interface/recebimentos/constants.js';
import { processoFixture } from '../../interface/recebimentos/__fixtures__/processo.fixture.js';
import SolicitacaoNumerarioService from './SolicitacaoNumerarioService.js';

const logStub = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never;

const buildService = (): SolicitacaoNumerarioService => new SolicitacaoNumerarioService(logStub);

const DATA = new Date('2026-07-28T12:00:00.000Z');

describe('SolicitacaoNumerarioService.gerar — dry-run payload build (com299/gerDocProcesso)', () => {
    afterEach(() => jest.clearAllMocks());

    it('builds the gcd config "Solicitação de Numerário - Encomenda"', () => {
        const out = buildService().gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.docConfig.gcdDesNome).toBe('Solicitação de Numerário - Encomenda');
        expect(out.docConfig.gcdCod).toBe(SOLICITACAO_NUMERARIO_DOC_CONFIG.gcdCod);
        expect(out.payload.gcdDesNome).toBe('Solicitação de Numerário - Encomenda');
    });

    it('maps filCod / priCod / cliente from the chosen processo', () => {
        const out = buildService().gerar({
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

    it('uses the raw transaction value as the SN amount (encomenda % rule unresolved)', () => {
        const out = buildService().gerar({
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

    it('always returns dryRun: true', () => {
        const out = buildService().gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        expect(out.dryRun).toBe(true);
    });

    it('emits emission/vencimento dates from dataReferencia', () => {
        const out = buildService().gerar({
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
        const out = service.gerar({
            processo: processoFixture,
            valorTransacao: 15000,
            dataReferencia: DATA,
            ator: 'analista',
        });
        await expect(service.enviarAoErp(out.payload)).rejects.toBeInstanceOf(NotImplementedError);
    });
});
