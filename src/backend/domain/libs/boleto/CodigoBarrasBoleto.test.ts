import 'reflect-metadata';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';

const cb = new CodigoBarrasBoleto();

describe('CodigoBarrasBoleto', () => {
    it('converte o exemplo publicado pela FEBRABAN (Banco do Brasil)', () => {
        expect(cb.paraLinhaDigitavel('00193373700000001000500940144816060680935031')).toBe(
            '00190500954014481606906809350314337370000000100',
        );
    });

    it('preserva fator de vencimento e valor no campo 5 (boleto real do fin124, ADP)', () => {
        const linha = cb.paraLinhaDigitavel('34193158000004815331090113433700004286589000');
        expect(linha).toHaveLength(47);
        expect(linha?.slice(0, 3)).toBe('341');
        // campo 4 = DV geral (5º dígito das barras); campo 5 = fator 1580 + R$ 4.815,33
        expect(linha?.slice(32, 33)).toBe('3');
        expect(linha?.slice(33)).toBe('15800000481533');
    });

    it('extrai o banco emissor', () => {
        expect(cb.bancoEmissor('42292157900001412007137000087483170003296912')).toBe('422');
    });

    it.each([
        ['vazio', undefined],
        ['curto', '3419315800000481533'],
        ['com letra', '3419315800000481533109011343370000428658900X'],
        ['arrecadação (começa com 8)', '84670000001435900240200240500024384221010811'],
    ])('recusa código inválido: %s', (_caso, codbar) => {
        expect(cb.paraLinhaDigitavel(codbar)).toBeUndefined();
        expect(cb.bancoEmissor(codbar)).toBeUndefined();
    });
});
