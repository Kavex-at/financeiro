import { injectable } from 'tsyringe';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';

/** Item do lote como sai na API. */
export type ItemLoteApi = ItemLote;

export type LotePagamentoApi = Omit<LotePagamento, 'itens'> & { itens: ItemLoteApi[] };

/**
 * LotePagamentoApiView — a ÚNICA saída de lote para a API (ADR-0054 I10h, ADR-0060).
 *
 * Desde a ADR-0060 o item do lote NÃO carrega destino de pagamento: o destino é do cadastro do
 * Conexos ou de uma `ExcecaoDestino` (por favorecido, com o próprio resumo mascarado em
 * `ExcecaoDestinoService`). O item só leva `excecaoDestinoId`, que identifica a exceção usada sem
 * revelar o valor. Toda resposta com lote continua passando por aqui: se o item voltar a ganhar
 * um campo sensível, existe um único lugar para projetá-lo.
 */
@injectable()
export default class LotePagamentoApiView {
    public lote = (lote: LotePagamento): LotePagamentoApi => ({
        ...lote,
        itens: lote.itens.map(this.item),
    });

    public lotes = (lotes: LotePagamento[]): LotePagamentoApi[] => lotes.map(this.lote);

    private item = (item: ItemLote): ItemLoteApi => ({ ...item });
}
