import 'reflect-metadata';
import type {
    ContaProjetoRow,
    ValidaConfigDocResult,
} from '../../interface/permutas/SolicitacaoNumerario.js';
import type { Processo } from '../../interface/recebimentos/GerDocProcesso.js';
import SnPayloadBuilder, { type SnPayloadInput } from './SnPayloadBuilder.js';

/**
 * SnPayloadBuilder — cobre os builders REAIS (`buildItems`/`buildSnRealPayload`/
 * `buildNotaDebitoRealPayload`) que corrigem o bug de produção (SN enviava `items:[]`/`gcdCod:0` →
 * SELECTION_ERROR). Também guarda o preview estático (`build`/`toSnGerDocPayload`) intocado.
 */

const processo: Processo = {
    priCod: 90001,
    priEspRefcliente: 'REF-1',
    filCod: 2,
    pesCod: 555,
    dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
    moeCod: 790,
};

// Data fixa (meia-noite UTC) para asserções determinísticas de docEspNumero/docDta.
const dataReferencia = new Date('2026-08-01T12:34:56.000Z');

const input = (over: Partial<SnPayloadInput> = {}): SnPayloadInput => ({
    processo,
    valorSn: 15000,
    dataReferencia,
    gcdCod: 150,
    ...over,
});

const config: ValidaConfigDocResult = {
    tpcCod: 700,
    cfoEspCod: '1.1.00.001',
    gcdVldFormaRateio: 1,
    gcdVldTela: 2,
    gcdVldPropria: 1,
    fisEspSerie: null,
};

describe('SnPayloadBuilder.buildItems', () => {
    it('mapeia rateio → itens com tmpMnyValor = round2(valor × total/100)', () => {
        const rateio: ContaProjetoRow[] = [
            { prjCod: 10, ctpCod: 690, tpcCod: 700, cfoEspCod: 'a', total: 60 },
            { prjCod: 11, ctpCod: 691, tpcCod: 701, cfoEspCod: 'b', total: 40 },
        ];
        const items = new SnPayloadBuilder().buildItems(rateio, 15000);
        expect(items).toHaveLength(2);
        expect(items[0].tmpMnyValor).toBe(9000);
        expect(items[1].tmpMnyValor).toBe(6000);
    });

    it('absorve o resíduo de arredondamento na última linha', () => {
        const rateio: ContaProjetoRow[] = [
            { prjCod: 10, ctpCod: 690, tpcCod: 700, cfoEspCod: 'a', total: 33.33 },
            { prjCod: 11, ctpCod: 691, tpcCod: 701, cfoEspCod: 'b', total: 33.33 },
            { prjCod: 12, ctpCod: 692, tpcCod: 702, cfoEspCod: 'c', total: 33.34 },
        ];
        const items = new SnPayloadBuilder().buildItems(rateio, 100);
        const soma = items.reduce((acc, it) => acc + it.tmpMnyValor, 0);
        expect(Math.round(soma * 100) / 100).toBe(100);
    });

    it('devolve [] quando o rateio vem vazio', () => {
        expect(new SnPayloadBuilder().buildItems([], 15000)).toEqual([]);
    });
});

/** Fonte (validaProcessoPessoa) — endCodFis/pdcDocFederal obrigatórios do HAR doc 18339. */
const pessoa = { endCodFis: 2, pdcDocFederal: '37032037000101' };

describe('SnPayloadBuilder.buildSnRealPayload', () => {
    it('é HEADER ONLY (SEM items), gcdDesNome UPPERCASE, tpcCod/cfoEspCod null, datas e docEspNumero', () => {
        const builder = new SnPayloadBuilder();
        const payload = builder.buildSnRealPayload(input(), config, pessoa);

        expect(payload.gcdCod).toBe(150);
        // gcdDesNome em CAIXA ALTA (HAR doc 18339).
        expect(payload.gcdDesNome).toBe('SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA');
        // NENHUM items no payload REAL da SN Encomenda.
        expect('items' in payload).toBe(false);
        // tpcCod/cfoEspCod/tpcDesNome são null na SN (NÃO herdam a config).
        expect(payload.tpcCod).toBeNull();
        expect(payload.cfoEspCod).toBeNull();
        expect(payload.tpcDesNome).toBeNull();
        // Flags de config presentes (do validaConfigDoc).
        expect(payload.gcdVldFormaRateio).toBe(1);
        expect(payload.gcdVldTela).toBe(2);
        expect(payload.gcdVldPropria).toBe(1);
        expect(payload.fisEspSerie).toBeNull();
        expect(payload.valor).toBe(15000);
        expect(payload.priCod).toBe(90001);
        // Data emissão/movimento = meia-noite UTC do dia de referência; número = DDMMYYYY.
        expect(payload.docDtaEmissao).toBe(Date.UTC(2026, 7, 1));
        expect(payload.docDtaMovimento).toBe(Date.UTC(2026, 7, 1));
        expect(payload.docEspNumero).toBe('01082026');
    });

    it('INCLUI SEMPRE pdcDocFederal/endCodFis (obrigatórios, threaded do validaProcessoPessoa)', () => {
        const payload = new SnPayloadBuilder().buildSnRealPayload(input(), config, {
            endCodFis: 2,
            pdcDocFederal: '37032037000101',
        });
        expect(payload.pdcDocFederal).toBe('37032037000101');
        expect(payload.endCodFis).toBe(2);
    });

    it('omite os flags de config ausentes (sem sujar o payload com undefined)', () => {
        const builder = new SnPayloadBuilder();
        const payload = builder.buildSnRealPayload(input(), {}, pessoa);
        expect('gcdVldTela' in payload).toBe(false);
        expect('gcdVldFormaRateio' in payload).toBe(false);
        expect('fisEspSerie' in payload).toBe(false);
    });
});

describe('SnPayloadBuilder.buildNotaDebitoRealPayload', () => {
    it('usa o gcd do com297 (não o 150 da SN) + produto + docEspNumero + items vazios', () => {
        const builder = new SnPayloadBuilder();
        const payload = builder.buildNotaDebitoRealPayload(
            input(),
            300,
            'NOTA DE DÉBITO ELETRÔNICA',
            config,
            41978,
            '0',
        );
        expect(payload.gcdCod).toBe(300);
        expect(payload.gcdCod).not.toBe(150);
        expect(payload.gcdDesNome).toBe('NOTA DE DÉBITO ELETRÔNICA');
        expect(payload.prdCod).toBe(41978);
        expect(payload.docEspNumero).toBe('0');
        expect(payload.items).toEqual([]);
        expect(payload.tpcCod).toBe(700);
    });
});

describe('SnPayloadBuilder — preview estático (intocado)', () => {
    it('build() ainda devolve o cabeçalho de preview com 1 item placeholder', () => {
        const dto = new SnPayloadBuilder().build(input());
        expect(dto.gcdCod).toBe(150);
        expect(dto.items).toHaveLength(1);
        expect(dto.items[0].tmpMnyValor).toBe(15000);
        expect(dto.moeCod).toBeNull();
    });

    it('toSnGerDocPayload() continua com items:[] (preview do wire)', () => {
        const payload = new SnPayloadBuilder().toSnGerDocPayload(input());
        expect(payload.gcdCod).toBe(150);
        expect(payload.items).toEqual([]);
    });
});
