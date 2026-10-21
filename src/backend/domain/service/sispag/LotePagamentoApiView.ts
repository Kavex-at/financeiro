import { injectable } from 'tsyringe';
import type { GrupoNoLote } from '../../interface/sispag/GrupoNoLoteInterface.js';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';

/** Item do lote como sai na API. */
export type ItemLoteApi = ItemLote;

export type LotePagamentoApi = Omit<LotePagamento, 'itens' | 'grupos'> & {
    itens: ItemLoteApi[];
    /** Grupos de boleto do lote, um bloco por grupo (ADR-0077, I21j). */
    grupos?: GrupoNoLote[];
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
    public lote = (lote: LotePagamento): LotePagamentoApi => {
        const { grupos, ...resto } = lote;
        return {
            ...resto,
            itens: lote.itens.map(this.item),
            ...(grupos && grupos.length > 0 ? { grupos: grupos.map(this.grupo) } : {}),
        };
    };

    public lotes = (lotes: LotePagamento[]): LotePagamentoApi[] => lotes.map(this.lote);

    /**
     * O grupo de boleto sai PROJETADO campo a campo (ADR-0077, I17j): só a máscara 5+4 do código,
     * nunca outro campo que o grupo venha a ganhar.
     */
    private grupo = (g: GrupoNoLote): GrupoNoLote => ({
        grupoId: g.grupoId,
        codbarMascarado: g.codbarMascarado,
        valorBoleto: g.valorBoleto,
        vencimentoBoleto: g.vencimentoBoleto,
        ...(g.credor !== undefined ? { credor: g.credor } : {}),
        situacao: g.situacao,
        titulos: g.titulos.map((t) => ({ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod })),
    });

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
