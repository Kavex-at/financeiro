import { injectable } from 'tsyringe';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';

/** Item do lote como sai na API. */
export type ItemLoteApi = ItemLote;

export type LotePagamentoApi = Omit<LotePagamento, 'itens'> & {
    itens: ItemLoteApi[];
};

/**
 * LotePagamentoApiView — a ÚNICA saída de lote para a API (ADR-0054 I10h, ADR-0065).
 *
 * O item do lote NÃO carrega destino de pagamento: o destino é sempre o do cadastro do Conexos.
 * O item leva só o que a verificação viu — a MÁSCARA e o selo do favorecido autorizado
 * (`autorizacaoAviso`), nunca o valor —, as alertas vivas (com a justificativa) e, depois do
 * import, o id da autorização usada (`favorecidoAutorizadoId`). Toda resposta com lote passa por
 * aqui: se o item voltar a ganhar um campo sensível, existe um único lugar para projetá-lo.
 */
@injectable()
export default class LotePagamentoApiView {
    public lote = (lote: LotePagamento): LotePagamentoApi => ({
        ...lote,
        itens: lote.itens.map(this.item),
    });

    public lotes = (lotes: LotePagamento[]): LotePagamentoApi[] => lotes.map(this.lote);

    /**
     * O vínculo do código (ADR-0071) sai PROJETADO campo a campo: só máscara 5+4, origem, decisão,
     * quando e o lote nativo. Se `ItemLote.vinculoCodigoBarras` ganhar um campo, ele não vaza por
     * aqui sem ser escolhido.
     */
    private item = (item: ItemLote): ItemLoteApi => {
        const { vinculoCodigoBarras: v, ...resto } = item;
        return {
            ...resto,
            ...(v
                ? {
                      vinculoCodigoBarras: {
                          origem: v.origem,
                          ...(v.decisaoId !== undefined ? { decisaoId: v.decisaoId } : {}),
                          codigoMascarado: v.codigoMascarado,
                          aplicadoEm: v.aplicadoEm,
                          flpCod: v.flpCod,
                      },
                  }
                : {}),
        };
    };
}
