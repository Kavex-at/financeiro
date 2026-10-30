import 'reflect-metadata';
import ContaBeneficiariaBoleto from './ContaBeneficiariaBoleto.js';

const conta = new ContaBeneficiariaBoleto();

describe('ContaBeneficiariaBoleto — chave da conta do beneficiário nas barras (ADR-0081)', () => {
    // Barras reais do export de PRD de 30/10 (pool DDA).
    it('Bradesco 237: agência + conta', () => {
        expect(conta.chave('23797155500001521302370091362260338500207020')).toBe(
            '237:2370/0020702',
        );
        expect(conta.chave('23798155500017867832372090001854105400388850')).toBe(
            '237:2372/0038885',
        );
    });

    it('Itaú 341: agência + conta', () => {
        expect(conta.chave('34193155500000300001090049258469260408340000')).toBe('341:9260/40834');
        expect(conta.chave('34197155600003332781090152907542938093461000')).toBe('341:2938/09346');
    });

    it('Santander 033: código do beneficiário', () => {
        expect(conta.chave('03397155500003471149004518500000003221400101')).toBe('033:0045185');
    });

    it('BB 001: convênio de 7 quando o de 6 vem zerado (barras real)', () => {
        expect(conta.chave('00192155600001700000000002584814009000082017')).toBe('001:2584814');
    });

    it('BB 001: convênio de 6 dígitos (barras sintética — sem exemplo no export)', () => {
        const barras = `${'0019115560000170000'}${'123456'}${'0'.repeat(19)}`;
        expect(barras).toHaveLength(44);
        expect(conta.chave(barras)).toBe('001:123456');
    });

    it.each([
        ['Sicredi 748', '74899159100000515461126205338926063308900104', '748:26063308900'],
        ['Safra 422', '42299162200001087007137000087483170003357412', '422:13700008748317'],
        ['Citibank 745', '74599161800002853003180093620011000101315603', '745:093620011'],
        ['Caixa 104', '10499162500009135568143285000109040013638705', '104:814328'],
        ['Ailos 085', '08599162600008743481060041983883200000258701', '085:10600419838832'],
        ['Sicoob 756', '75692163100001621001301001585964600018112001', '756:3010/5859646'],
    ])('%s: layout validado em PRD (barras reais)', (_banco, barras, esperado) => {
        expect(conta.chave(barras)).toBe(esperado);
    });

    it('banco sem layout validado (329) não tem chave (não adivinha)', () => {
        expect(conta.chave('32995155600000257731126204724926063308900107')).toBeUndefined();
    });

    it('arrecadação (inicia por 8), tamanho errado, não numérico e vazio → undefined', () => {
        expect(conta.chave(`8${'1'.repeat(43)}`)).toBeUndefined();
        expect(conta.chave('2379715550000152130')).toBeUndefined();
        expect(conta.chave(`237${'a'.repeat(41)}`)).toBeUndefined();
        expect(conta.chave('')).toBeUndefined();
        expect(conta.chave(undefined)).toBeUndefined();
    });

    it('tolera espaços nas pontas', () => {
        expect(conta.chave(' 03397155500003471149004518500000003221400101 ')).toBe('033:0045185');
    });
});
