import 'reflect-metadata';
import { injectable } from 'tsyringe';
import { ENCOMENDA_PERCENTUAIS_RESOLVED } from '../../interface/recebimentos/constants.js';

/** Resultado do cálculo do valor da SN + se a regra de % da encomenda já foi resolvida. */
export interface EncomendaValorResult {
    /** Montante da SN a mandar ao com299 (`docMnyValor`). */
    valorSn: number;
    /**
     * `false` enquanto a regra de % (0,1% / 0,9%) não for resolvida — nesse estado o valor é o CRU e
     * uma escrita REAL deve LANÇAR (o seam `enviarAoErp` consulta isto). Ver
     * `ENCOMENDA_PERCENTUAIS_RESOLVED`.
     */
    regraResolvida: boolean;
}

/**
 * EncomendaValorCalculator — seam PURO que isola a regra de % da encomenda (0,1% / 0,9%) do resto do
 * fluxo da SN. Hoje a regra é NÃO-RESOLVIDA (base de cálculo, contas de destino, arredondamento —
 * OfficeHours pendente), então o cálculo é passthrough do valor CRU da transação e `regraResolvida`
 * espelha a constante `ENCOMENDA_PERCENTUAIS_RESOLVED` (`false`).
 *
 * Quando a regra for resolvida: (1) flipar a constante para `true`, (2) implementar o ramo de % aqui,
 * (3) o teste-tripwire deste arquivo força a atualização. Isola a mudança a UM ponto — o serviço e a
 * rota não precisam saber da regra.
 */
@injectable()
export default class EncomendaValorCalculator {
    public calcular = (input: { valorTransacao: number }): EncomendaValorResult => {
        if (!ENCOMENDA_PERCENTUAIS_RESOLVED) {
            // Regra não-resolvida: valor CRU, sinalizado como não-resolvido (trava escrita real).
            return { valorSn: input.valorTransacao, regraResolvida: false };
        }

        // Quando a regra existir, o ramo de % da encomenda entra AQUI (base/contas/arredondamento).
        return { valorSn: input.valorTransacao, regraResolvida: true };
    };
}
