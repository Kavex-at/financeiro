import ValorItemImport from './ValorItemImport.js';

describe('ValorItemImport (I17n, ADR-0073): o item é importado pelo LÍQUIDO do grid', () => {
    it('titMnyLiquido presente ⇒ é o valor do item (NELSON 462,49 + juros 0,01)', () => {
        expect(
            ValorItemImport.valorDoItem({
                titMnyValor: 462.49,
                titMnyJuros: 0.01,
                titMnyLiquido: 462.5,
            }),
        ).toEqual({ disponivel: true, valor: 462.5 });
    });

    it('titMnyLiquido presente vale também para título sem ajuste (juros nativo)', () => {
        expect(
            ValorItemImport.valorDoItem({ titMnyValor: 100, titMnyJuros: 3, titMnyLiquido: 103 }),
        ).toEqual({ disponivel: true, valor: 103 });
    });

    it.each([
        [{ titMnyValor: 258.4 }],
        [{ titMnyValor: 258.4, titMnyJuros: 0, titMnyDesconto: 0 }],
        [{ titMnyValor: 258.4, titMnyJuros: null, titMnyDesconto: null }],
        [{ titMnyValor: '258.4' }],
    ])('sem titMnyLiquido e sem juros/desconto ⇒ titMnyValor (%j)', (raw) => {
        expect(ValorItemImport.valorDoItem(raw)).toEqual({ disponivel: true, valor: 258.4 });
    });

    it.each([
        [{ titMnyValor: 462.49, titMnyJuros: 0.01 }, 462.5],
        [{ titMnyValor: 53.53, titMnyJuros: 0.01, titMnyDesconto: null }, 53.54],
        [{ titMnyValor: 178.78, titMnyDesconto: 0.01 }, 178.77],
        [{ titMnyValor: 178.78, titMnyLiquido: null, titMnyDesconto: 0.01 }, 178.77],
    ])('sem titMnyLiquido (o grid de PRD nunca traz, 3136/3136): valor + juros − desconto (%j)', (raw, valor) => {
        expect(ValorItemImport.valorDoItem(raw)).toEqual({ disponivel: true, valor });
    });

    it.each([
        [{ titMnyValor: 462.49, titMnyJuros: 'x' }],
        [{ titMnyValor: 178.78, titMnyDesconto: 'x' }],
        [{ titMnyValor: 0.01, titMnyDesconto: 0.02 }],
    ])('sem titMnyLiquido com juros/desconto ilegível ou líquido negativo ⇒ indisponível (%j)', (raw) => {
        expect(ValorItemImport.valorDoItem(raw)).toEqual({ disponivel: false });
    });

    it('sem titMnyLiquido nem titMnyValor ⇒ indisponível (nunca o snapshot do item)', () => {
        expect(ValorItemImport.valorDoItem({ itsMnyValor: 999 })).toEqual({ disponivel: false });
    });

    it('valores ilegíveis/não finitos ⇒ indisponível', () => {
        expect(ValorItemImport.valorDoItem({ titMnyLiquido: 'abc', titMnyJuros: 1 })).toEqual({
            disponivel: false,
        });
    });
});
