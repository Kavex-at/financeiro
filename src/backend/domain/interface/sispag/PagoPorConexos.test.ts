import { PAGO_POR_CONEXOS, PagoPorConexosRotulo } from './PagoPorConexos.js';

describe('PagoPorConexosRotulo', () => {
    it('rotula os códigos documentados do Conexos (070-com3 FinTituloFin)', () => {
        expect(PagoPorConexosRotulo.de(PAGO_POR_CONEXOS.BOLETO)).toBe('BOLETO');
        expect(PagoPorConexosRotulo.de(2)).toBe('TEF');
        expect(PagoPorConexosRotulo.de(10)).toBe('TRANSAÇÃO AUTOMÁTICA');
    });

    it('ausente ou fora do domínio → undefined (quem exibe mostra "—")', () => {
        expect(PagoPorConexosRotulo.de(undefined)).toBeUndefined();
        expect(PagoPorConexosRotulo.de(0)).toBeUndefined();
        expect(PagoPorConexosRotulo.de(11)).toBeUndefined();
    });
});
