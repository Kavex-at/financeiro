import { inject, injectable } from 'tsyringe';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import ConferenciaLoteRule from '../../libs/sispag/ConferenciaLoteRule.js';

/** Item do lote como sai na API. */
export type ItemLoteApi = ItemLote;

export type LotePagamentoApi = Omit<LotePagamento, 'itens'> & {
    itens: ItemLoteApi[];
    /** ADR-0063 I13l — derivado: ≥1 item TED/PIX exige conferência por 2ª pessoa. */
    exigeConferencia: boolean;
};

/**
 * LotePagamentoApiView — a ÚNICA saída de lote para a API (ADR-0054 I10h, ADR-0061, ADR-0063).
 *
 * Desde a ADR-0061 o item do lote NÃO carrega destino de pagamento: o destino é do cadastro do
 * Conexos ou de uma `ExcecaoDestino` (por favorecido, com o próprio resumo mascarado em
 * `ExcecaoDestinoService`). O item só leva `excecaoDestinoId`, que identifica a exceção usada sem
 * revelar o valor. Desde a ADR-0063 leva também o que a verificação TED/PIX viu do destino — a
 * ORIGEM e a MÁSCARA, nunca o valor —, as alertas vivas (com a justificativa) e o lote expõe
 * `exigeConferencia` e os dados de conferência/devolução. Toda resposta com lote passa por aqui:
 * se o item voltar a ganhar um campo sensível, existe um único lugar para projetá-lo.
 */
@injectable()
export default class LotePagamentoApiView {
    public constructor(
        @inject(ConferenciaLoteRule) private readonly conferencia: ConferenciaLoteRule,
    ) {}

    public lote = (lote: LotePagamento): LotePagamentoApi => ({
        ...lote,
        itens: lote.itens.map(this.item),
        exigeConferencia: this.conferencia.exigeConferencia(lote),
    });

    public lotes = (lotes: LotePagamento[]): LotePagamentoApi[] => lotes.map(this.lote);

    private item = (item: ItemLote): ItemLoteApi => ({ ...item });
}
