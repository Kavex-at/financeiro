import ModoVinculoCodigoBarras, { MODO_VINCULO } from './ModoVinculoCodigoBarras.js';

const resolver = (filCod: number, bruto: string | undefined, live = true) =>
    ModoVinculoCodigoBarras.resolverModo(filCod, ModoVinculoCodigoBarras.parse(bruto), live);

describe('ModoVinculoCodigoBarras (I17k) — fail-closed', () => {
    it('"1:shadow,7:off": filial 1 shadow, 7 off, ausente off', () => {
        expect(resolver(1, '1:shadow,7:off')).toBe(MODO_VINCULO.SHADOW);
        expect(resolver(7, '1:shadow,7:off')).toBe(MODO_VINCULO.OFF);
        expect(resolver(2, '1:shadow,7:off')).toBe(MODO_VINCULO.OFF);
    });

    it.each([undefined, '', '   '])('vazio/ausente (%p) ⇒ off em todas as filiais', (bruto) => {
        expect(resolver(1, bruto)).toBe(MODO_VINCULO.OFF);
        expect(resolver(7, bruto)).toBe(MODO_VINCULO.OFF);
    });

    it('"1:on" liga a filial 1 e só ela', () => {
        expect(resolver(1, '1:on')).toBe(MODO_VINCULO.ON);
        expect(resolver(2, '1:on')).toBe(MODO_VINCULO.OFF);
    });

    // Escolha documentada: parse inválido NÃO vira parcial. Uma entrada com lixo derruba o mapa
    // inteiro para `off` — a configuração torta nunca liga uma filial "pela metade".
    it.each([
        ['maiúsculas', '1:ON'],
        ['modo desconhecido', '1:foo'],
        ['sem separador', 'abc'],
        ['vírgula sobrando', '1:on,'],
        ['filial duplicada', '1:on,1:off'],
        ['filial inválida', '0:on'],
        ['filial não inteira', '1.5:on'],
        ['uma boa e uma ruim', '1:on,7:foo'],
    ])('parse inválido (%s) ⇒ a entrada inteira cai em off', (_caso, bruto) => {
        expect(resolver(1, bruto)).toBe(MODO_VINCULO.OFF);
        expect(resolver(7, bruto)).toBe(MODO_VINCULO.OFF);
        expect(ModoVinculoCodigoBarras.parse(bruto).size).toBe(0);
    });

    it('o kill-switch `sispagLiveWriteEnabled=false` derruba também o vínculo', () => {
        expect(resolver(1, '1:on', false)).toBe(MODO_VINCULO.OFF);
        expect(resolver(1, '1:shadow', false)).toBe(MODO_VINCULO.OFF);
    });

    it('tolera espaços ao redor dos tokens', () => {
        expect(resolver(7, ' 1:shadow , 7:on ')).toBe(MODO_VINCULO.ON);
    });
});
