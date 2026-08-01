import 'reflect-metadata';
import EncomendaValorCalculator from './EncomendaValorCalculator.js';
import { ENCOMENDA_PERCENTUAIS_RESOLVED } from '../../interface/recebimentos/constants.js';

describe('EncomendaValorCalculator', () => {
    const calculator = new EncomendaValorCalculator();

    it('devolve o valor CRU da transação como valor da SN (regra não-resolvida)', () => {
        const { valorSn } = calculator.calcular({ valorTransacao: 857827.21 });
        expect(valorSn).toBe(857827.21);
    });

    it('espelha ENCOMENDA_PERCENTUAIS_RESOLVED em `regraResolvida` (tripwire)', () => {
        // Enquanto a regra de % não é resolvida, `regraResolvida` é false e a escrita real trava.
        // Quando alguém flipar a constante, este teste FORÇA a atualização do ramo de % no calculator.
        const { regraResolvida } = calculator.calcular({ valorTransacao: 100 });
        expect(regraResolvida).toBe(ENCOMENDA_PERCENTUAIS_RESOLVED);
    });
});
