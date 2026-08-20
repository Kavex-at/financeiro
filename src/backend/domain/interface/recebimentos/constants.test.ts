import { PRI_VLD_TIPO, previsaoNdeDoProcesso } from './constants.js';

describe('previsaoNdeDoProcesso', () => {
    it('POR ENCOMENDA é a única modalidade que emite NDe (ADR-0033)', () => {
        expect(previsaoNdeDoProcesso(PRI_VLD_TIPO.POR_ENCOMENDA)).toEqual({
            priVldTipo: 3,
            rotulo: 'POR ENCOMENDA',
            ndeDispensada: false,
        });
    });

    it('CONTA E ORDEM não emite — o repasse sai em nome do terceiro (ADR-0031)', () => {
        expect(previsaoNdeDoProcesso(PRI_VLD_TIPO.CONTA_E_ORDEM_TERCEIROS)).toEqual({
            priVldTipo: 2,
            rotulo: 'CONTA E ORDEM',
            ndeDispensada: true,
        });
    });

    it('PRÓPRIA não emite — não há terceiro a quem debitar', () => {
        expect(previsaoNdeDoProcesso(PRI_VLD_TIPO.PROPRIA)).toEqual({
            priVldTipo: 1,
            rotulo: 'PRÓPRIA',
            ndeDispensada: true,
        });
    });

    // O ponto da ADR-0031: o desconhecido PARA, não vira dispensa calada. `undefined` aqui é
    // "não dá para prever" — a tela avisa bloqueio, e o gate 0.5 barra de fato.
    it('modalidade ausente → sem previsão (nunca "não emite")', () => {
        expect(previsaoNdeDoProcesso(undefined)).toBeUndefined();
    });

    it('código fora do domínio conhecido → sem previsão', () => {
        expect(previsaoNdeDoProcesso(99)).toBeUndefined();
        expect(previsaoNdeDoProcesso(0)).toBeUndefined();
    });
});
