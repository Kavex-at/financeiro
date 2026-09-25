import 'reflect-metadata';
import type { BoletoDdaConsolidado, BoletoDdaTitulo } from '../../interface/sispag/BoletoDda.js';
import PaginacaoBoletoDda, { BOLETO_DDA_TAMANHO_MAX } from './PaginacaoBoletoDda.js';

const paginacao = new PaginacaoBoletoDda();

const titulo = (over: Partial<BoletoDdaTitulo>): BoletoDdaTitulo => ({
    filCod: 1,
    docCod: '1',
    titCod: '1',
    ...over,
});

const linha = (over: Partial<BoletoDdaConsolidado>): BoletoDdaConsolidado => ({
    ddcCod: 1,
    ditCod: 1,
    valor: 100,
    vencido: false,
    situacao: 'SEM_TITULO',
    candidatos: [],
    ...over,
});

const ADP = linha({
    ditCod: 1,
    numero: '001532761',
    valor: 4815.33,
    situacao: 'CANDIDATO',
    candidatos: [titulo({ filCod: 1, docCod: '5046', credor: 'ADP BRASIL LTDA' })],
});
const PEDRONI = linha({
    ditCod: 2,
    numero: '329691',
    valor: 1412,
    situacao: 'AMBIGUO',
    candidatos: [
        titulo({ filCod: 2, docCod: '34685', credor: 'PEDRONI LOGISTICA LTDA' }),
        titulo({ filCod: 2, docCod: '34872', credor: 'PEDRONI LOGISTICA LTDA' }),
    ],
});
const VINCULADO = linha({
    ditCod: 3,
    numero: '998524434',
    valor: 611.86,
    situacao: 'VINCULADO',
    vinculo: titulo({ filCod: 4, docCod: '9823' }),
});
const LIVRE = linha({ ditCod: 4, numero: '7386000', valor: 4838.32 });
const TODAS = [ADP, PEDRONI, VINCULADO, LIVRE];

describe('PaginacaoBoletoDda', () => {
    it('conta por situação antes do filtro de situação, e filtra depois', () => {
        const r = paginacao.paginar(TODAS, { situacao: 'AMBIGUO', pagina: 1, tamanho: 20 });
        expect(r.contagem).toEqual({
            todas: 4,
            VINCULADO: 1,
            CANDIDATO: 1,
            AMBIGUO: 1,
            SEM_TITULO: 1,
        });
        expect(r.total).toBe(1);
        expect(r.boletos.map((b) => b.numero)).toEqual(['329691']);
    });

    it.each([
        ['valor sem máscara', '4815', '001532761'],
        ['valor com máscara brasileira', '4.815,33', '001532761'],
        ['credor, sem diferenciar maiúsculas', 'pedroni', '329691'],
        ['documento do título', '9823/1', '998524434'],
        ['número do boleto', '7386', '7386000'],
    ])('busca por %s', (_caso, busca, esperado) => {
        const r = paginacao.paginar(TODAS, { busca, pagina: 1, tamanho: 20 });
        expect(r.boletos.map((b) => b.numero)).toEqual([esperado]);
        expect(r.contagem.todas).toBe(1);
    });

    it('filial: filtra pela do vínculo ou do candidato único; boleto sem filial passa sempre', () => {
        const r = paginacao.paginar(TODAS, { filCod: 1, pagina: 1, tamanho: 20 });
        // ADP (fil 1) + PEDRONI (ambíguo → sem filial) + LIVRE (sem filial); VINCULADO é da fil 4.
        expect(r.boletos.map((b) => b.ditCod)).toEqual([1, 2, 4]);
        expect(r.filiais).toEqual([1, 4]);
    });

    it('pagina e limita a página pedida à última existente', () => {
        const muitas = Array.from({ length: 45 }, (_, i) => linha({ ditCod: i + 1 }));
        const p3 = paginacao.paginar(muitas, { pagina: 3, tamanho: 20 });
        expect(p3.boletos.map((b) => b.ditCod)).toEqual([41, 42, 43, 44, 45]);

        const alem = paginacao.paginar(muitas, { pagina: 99, tamanho: 20 });
        expect(alem.pagina).toBe(3);
        expect(alem.total).toBe(45);
    });

    it('nunca devolve mais que o teto por página', () => {
        const muitas = Array.from({ length: 500 }, (_, i) => linha({ ditCod: i + 1 }));
        const r = paginacao.paginar(muitas, { pagina: 1, tamanho: 10_000 });
        expect(r.boletos).toHaveLength(BOLETO_DDA_TAMANHO_MAX);
        expect(r.tamanho).toBe(BOLETO_DDA_TAMANHO_MAX);
    });

    it('lista vazia devolve página 1 sem linhas', () => {
        const r = paginacao.paginar([], { pagina: 5, tamanho: 20 });
        expect(r).toMatchObject({ boletos: [], total: 0, pagina: 1, filiais: [] });
    });
});
